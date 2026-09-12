"""
[Gate M1] FR-014 移動区間(DOC-02 FR-014 / DOC-05 §7.1 travel_segments)。

Event/Place間の計画済み移動(TravelSegment)のCRUD。既存の
`/plans/{plan_id}/days/{day_id}/route-preview`・`insertion-preview`
(app/api/v1/plans.py)は非永続のプレビュー計算のままとし、本モジュールの
永続CRUDとは独立に維持する(混同しない)。

設計判断の詳細はdocs/adr/ADR-travel-segment.md、要件⇔実装の対応表は
docs/trace/gate-m1-fr014-trace.mdを参照。

スコープ外(将来Gate): FR-015 route_options/route_legs(複数経路比較)、
外部Directions API、リアルタイム運行情報、frontend UI。
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Header
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user_or_guest
from app.core.plan_access import require_plan_access
from app.models.models import TravelSegment, TravelEvent, Place, Reservation, User
from app.services.route_estimator import estimate_leg
from app.services.quickdraft_idempotency import (
    claim_or_get_cached,
    finalize_success,
    finalize_failure,
    compute_payload_hash,
    IdempotencyKeyReused,
    IdempotencyInProgress,
)
# [Gate M1] Day/Event側の楽観ロック(If-Match)・ChangeSet記録は
# app/api/v1/plans.py の実装を正本として再利用する(重複実装しない)。
from app.api.v1.plans import (
    _get_owned_plan,
    _require_if_match,
    _record_change_and_bump_revision,
    _segment_to_dict,
)

router = APIRouter(prefix="/plans", tags=["segments"])

POST_ENDPOINT = "POST /v1/plans/segments"

MODES = {"walking", "driving", "train", "bus", "ferry", "flight", "bicycle", "taxi", "mixed"}
STATUSES = {"planned", "confirmed", "cancelled"}


# ===== スキーマ =====

class SegmentCreateRequest(BaseModel):
    from_event_id: Optional[str] = None
    from_place_id: Optional[str] = None
    to_event_id: Optional[str] = None
    to_place_id: Optional[str] = None
    mode: str
    status: str = "planned"
    planned_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    distance_km: Optional[float] = Field(None, ge=0)
    duration_minutes: Optional[float] = Field(None, ge=0)
    cost: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    preparation_minutes: int = Field(0, ge=0)
    buffer_before_minutes: int = Field(0, ge=0)
    buffer_after_minutes: int = Field(0, ge=0)
    transport_number: Optional[str] = Field(None, max_length=100)
    platform: Optional[str] = Field(None, max_length=100)
    transfer_count: Optional[int] = Field(None, ge=0)
    luggage_note: Optional[str] = None
    reservation_id: Optional[str] = None

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v):
        if v not in MODES:
            raise ValueError(f"mode must be one of {sorted(MODES)}")
        return v

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v):
        if v not in STATUSES:
            raise ValueError(f"status must be one of {sorted(STATUSES)}")
        return v

    @field_validator("currency")
    @classmethod
    def _validate_currency(cls, v):
        if v is not None and (not v.isalpha() or v != v.upper()):
            raise ValueError("currency must be an uppercase 3-letter ISO 4217 code")
        return v

    @field_validator("planned_departure_at", "planned_arrival_at")
    @classmethod
    def _require_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v


class SegmentUpdateRequest(BaseModel):
    """PATCH用。全フィールドOptionalとし、`exclude_unset`で部分更新する。
    endpoint XOR等の相互検証は、既存値とマージした後にAPI側で実施する
    (単独フィールドの妥当性はここでの型/vocab検証のみ担う)。"""
    from_event_id: Optional[str] = None
    from_place_id: Optional[str] = None
    to_event_id: Optional[str] = None
    to_place_id: Optional[str] = None
    mode: Optional[str] = None
    status: Optional[str] = None
    planned_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    distance_km: Optional[float] = Field(None, ge=0)
    duration_minutes: Optional[float] = Field(None, ge=0)
    cost: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    preparation_minutes: Optional[int] = Field(None, ge=0)
    buffer_before_minutes: Optional[int] = Field(None, ge=0)
    buffer_after_minutes: Optional[int] = Field(None, ge=0)
    transport_number: Optional[str] = Field(None, max_length=100)
    platform: Optional[str] = Field(None, max_length=100)
    transfer_count: Optional[int] = Field(None, ge=0)
    luggage_note: Optional[str] = None
    reservation_id: Optional[str] = None

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v):
        if v is not None and v not in MODES:
            raise ValueError(f"mode must be one of {sorted(MODES)}")
        return v

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v):
        if v is not None and v not in STATUSES:
            raise ValueError(f"status must be one of {sorted(STATUSES)}")
        return v

    @field_validator("currency")
    @classmethod
    def _validate_currency(cls, v):
        if v is not None and (not v.isalpha() or v != v.upper()):
            raise ValueError("currency must be an uppercase 3-letter ISO 4217 code")
        return v

    @field_validator("planned_departure_at", "planned_arrival_at")
    @classmethod
    def _require_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v


class SegmentResponse(BaseModel):
    id: str
    plan_id: str
    from_event_id: Optional[str] = None
    from_place_id: Optional[str] = None
    to_event_id: Optional[str] = None
    to_place_id: Optional[str] = None
    mode: str
    status: str
    planned_departure_at: Optional[datetime] = None
    planned_arrival_at: Optional[datetime] = None
    distance_km: Optional[float] = None
    duration_minutes: Optional[float] = None
    cost: Optional[Decimal] = None
    currency: Optional[str] = None
    preparation_minutes: int
    buffer_before_minutes: int
    buffer_after_minutes: int
    transport_number: Optional[str] = None
    platform: Optional[str] = None
    transfer_count: Optional[int] = None
    luggage_note: Optional[str] = None
    reservation_id: Optional[str] = None
    is_estimate: bool
    provider: str
    algorithm_version: str
    computed_at: datetime
    # [Gate M1 §7] DB正本ではなくレスポンス派生値。
    recommended_departure_at: Optional[datetime] = None
    revision: int
    created_at: datetime
    updated_at: Optional[datetime] = None


# ===== 検証ヘルパー =====

def _endpoint_xor_error(side: str) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail=f"{side}_event_idと{side}_place_idはちょうど一方のみ指定してください",
    )


def _validate_endpoint_shape(from_event_id, from_place_id, to_event_id, to_place_id):
    if (from_event_id is not None) == (from_place_id is not None):
        raise _endpoint_xor_error("from")
    if (to_event_id is not None) == (to_place_id is not None):
        raise _endpoint_xor_error("to")
    if from_event_id is not None and to_event_id is not None and from_event_id == to_event_id:
        raise HTTPException(status_code=422, detail="fromとtoに同一のeventを指定できません")
    if from_place_id is not None and to_place_id is not None and from_place_id == to_place_id:
        raise HTTPException(status_code=422, detail="fromとtoに同一のplaceを指定できません")


def _validate_time_order(planned_departure_at, planned_arrival_at):
    if planned_departure_at and planned_arrival_at and planned_arrival_at < planned_departure_at:
        raise HTTPException(
            status_code=422, detail="planned_arrival_atはplanned_departure_atより前にできません"
        )


def _validate_cost_currency(cost, currency):
    if (cost is None) != (currency is None):
        raise HTTPException(status_code=422, detail="costとcurrencyは同時に指定してください")


def _resolve_event_ref(db: Session, plan, event_id: Optional[str]) -> Optional[uuid.UUID]:
    """[Gate M1] event_idが指定されている場合、そのEventが対象planに
    所属することを検証する。cross-plan参照は「存在しない」と同じ422で
    応答し、他planへの参照可否で情報を漏洩しない。"""
    if event_id is None:
        return None
    try:
        eid = uuid.UUID(str(event_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="event_idの形式が不正です")
    event = db.query(TravelEvent).filter(TravelEvent.id == eid, TravelEvent.plan_id == plan.id).first()
    if not event:
        raise HTTPException(status_code=422, detail="指定されたeventがこのプラン内に見つかりません")
    return eid


def _resolve_place_ref(db: Session, place_id: Optional[str]) -> Optional[uuid.UUID]:
    """[Gate M1] PlaceはPlanに属さないグローバルなエンティティのため、
    存在確認のみを行う(plan scoping対象外)。"""
    if place_id is None:
        return None
    try:
        pid = uuid.UUID(str(place_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="place_idの形式が不正です")
    place = db.query(Place).filter(Place.id == pid).first()
    if not place:
        raise HTTPException(status_code=422, detail="指定されたplaceが見つかりません")
    return pid


def _resolve_reservation_ref(db: Session, plan, reservation_id: Optional[str]) -> Optional[uuid.UUID]:
    if reservation_id is None:
        return None
    try:
        rid = uuid.UUID(str(reservation_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="reservation_idの形式が不正です")
    reservation = (
        db.query(Reservation)
        .filter(Reservation.id == rid, Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None))
        .first()
    )
    if not reservation:
        raise HTTPException(status_code=422, detail="指定されたreservationがこのプラン内に見つかりません")
    return rid


def _event_coordinates(event: Optional[TravelEvent], db: Session):
    """[Gate M1] Haversine fallback用の座標解決。Event自身の座標を優先し、
    無ければevent.place_idのPlace座標を使う(§8参照)。"""
    if event is None:
        return None, None
    if event.latitude is not None and event.longitude is not None:
        return event.latitude, event.longitude
    if event.place_id:
        place = db.query(Place).filter(Place.id == event.place_id).first()
        if place and place.latitude is not None and place.longitude is not None:
            return place.latitude, place.longitude
    return None, None


def _resolve_coordinates(db: Session, event_id: Optional[uuid.UUID], place_id: Optional[uuid.UUID]):
    if event_id is not None:
        event = db.query(TravelEvent).filter(TravelEvent.id == event_id).first()
        return _event_coordinates(event, db)
    if place_id is not None:
        place = db.query(Place).filter(Place.id == place_id).first()
        if place and place.latitude is not None and place.longitude is not None:
            return place.latitude, place.longitude
    return None, None


def _apply_haversine_fallback(db: Session, seg_fields: dict) -> dict:
    """[Gate M1 §8] distance/durationが未指定で、両端座標が取得できる場合
    だけhaversine概算を補完する。座標不足ならnullのまま(捏造しない)。
    利用者が明示的に距離・時間を指定した場合はprovider=manualとする。"""
    if seg_fields.get("distance_km") is not None or seg_fields.get("duration_minutes") is not None:
        seg_fields.setdefault("is_estimate", False)
        seg_fields.setdefault("provider", "manual")
        seg_fields.setdefault("algorithm_version", "manual-v1")
        seg_fields.setdefault("computed_at", datetime.now(dt_timezone.utc))
        return seg_fields

    from_lat, from_lon = _resolve_coordinates(db, seg_fields.get("from_event_id"), seg_fields.get("from_place_id"))
    to_lat, to_lon = _resolve_coordinates(db, seg_fields.get("to_event_id"), seg_fields.get("to_place_id"))

    estimate = None
    if from_lat is not None and to_lat is not None:
        estimate = estimate_leg(from_lat, from_lon, to_lat, to_lon, mode=seg_fields.get("mode", "walking"))

    if estimate:
        seg_fields["distance_km"] = estimate["distance_km"]
        seg_fields["duration_minutes"] = estimate["duration_minutes"]
        seg_fields["is_estimate"] = True
        seg_fields["provider"] = estimate["provider"]
        seg_fields["algorithm_version"] = estimate["algorithm_version"]
        seg_fields["computed_at"] = estimate["computed_at"]
    else:
        # 座標不足。架空値を作らずnullのままにし、provenanceだけ記録する。
        seg_fields["is_estimate"] = True
        seg_fields["provider"] = "unknown"
        seg_fields["algorithm_version"] = "haversine-v1"
        seg_fields["computed_at"] = datetime.now(dt_timezone.utc)

    return seg_fields


def _compute_recommended_departure_at(seg: TravelSegment, db: Session) -> Optional[datetime]:
    """[Gate M1 §7] レスポンス派生値。DB正本ではなくここで都度算出する。"""
    arrival_basis = seg.planned_arrival_at
    if arrival_basis is None and seg.to_event_id:
        to_event = db.query(TravelEvent).filter(TravelEvent.id == seg.to_event_id).first()
        if to_event and to_event.start_at:
            arrival_basis = to_event.start_at

    if arrival_basis is None or seg.duration_minutes is None:
        return None

    total_minutes = seg.duration_minutes + seg.preparation_minutes + seg.buffer_before_minutes
    return arrival_basis - timedelta(minutes=total_minutes)


def _to_response(seg: TravelSegment, db: Session) -> dict:
    body = {
        "id": str(seg.id),
        "plan_id": str(seg.plan_id),
        "from_event_id": str(seg.from_event_id) if seg.from_event_id else None,
        "from_place_id": str(seg.from_place_id) if seg.from_place_id else None,
        "to_event_id": str(seg.to_event_id) if seg.to_event_id else None,
        "to_place_id": str(seg.to_place_id) if seg.to_place_id else None,
        "mode": seg.mode,
        "status": seg.status,
        "planned_departure_at": seg.planned_departure_at,
        "planned_arrival_at": seg.planned_arrival_at,
        "distance_km": seg.distance_km,
        "duration_minutes": seg.duration_minutes,
        "cost": seg.cost,
        "currency": seg.currency,
        "preparation_minutes": seg.preparation_minutes,
        "buffer_before_minutes": seg.buffer_before_minutes,
        "buffer_after_minutes": seg.buffer_after_minutes,
        "transport_number": seg.transport_number,
        "platform": seg.platform,
        "transfer_count": seg.transfer_count,
        "luggage_note": seg.luggage_note,
        "reservation_id": str(seg.reservation_id) if seg.reservation_id else None,
        "is_estimate": seg.is_estimate,
        "provider": seg.provider,
        "algorithm_version": seg.algorithm_version,
        "computed_at": seg.computed_at,
        "recommended_departure_at": _compute_recommended_departure_at(seg, db),
        "revision": seg.revision,
        "created_at": seg.created_at,
        "updated_at": seg.updated_at,
    }
    return jsonable_encoder(SegmentResponse(**body))


# ===== エンドポイント =====

@router.get("/{plan_id}/segments", response_model=list)
def list_segments(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (
        db.query(TravelSegment)
        .filter(TravelSegment.plan_id == plan.id)
        .order_by(TravelSegment.created_at.asc())
        .all()
    )
    return [_to_response(s, db) for s in rows]


@router.get("/{plan_id}/segments/{segment_id}", response_model=dict)
def get_segment(
    plan_id: str,
    segment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    seg = _get_segment_or_404(db, plan.id, segment_id)
    return _to_response(seg, db)


def _get_segment_or_404(db: Session, plan_id, segment_id: str) -> TravelSegment:
    try:
        sid = uuid.UUID(str(segment_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="移動区間が見つかりません")
    seg = db.query(TravelSegment).filter(TravelSegment.id == sid, TravelSegment.plan_id == plan_id).first()
    if not seg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="移動区間が見つかりません")
    return seg


@router.post("/{plan_id}/segments", status_code=201, response_model=dict)
def create_segment(
    plan_id: str,
    payload: SegmentCreateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")

    if not idempotency_key:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_REQUEST", "message": "Idempotency-Key header is required"},
        )

    payload_dict = jsonable_encoder(payload)
    payload_hash = compute_payload_hash({"plan_id": str(plan.id), **payload_dict})

    try:
        outcome, record = claim_or_get_cached(
            db, idempotency_key, POST_ENDPOINT, payload_hash, user_id=current_user.id,
        )
    except IdempotencyKeyReused:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "IDEMPOTENCY_KEY_REUSED",
                "message": "this Idempotency-Key was already used with a different request body",
            },
        )
    except IdempotencyInProgress:
        raise HTTPException(
            status_code=409,
            detail={"code": "OPERATION_IN_PROGRESS", "message": "この操作は現在処理中です"},
        )

    if outcome == "cached":
        return record.response_json

    try:
        with db.begin_nested():
            _validate_endpoint_shape(
                payload.from_event_id, payload.from_place_id, payload.to_event_id, payload.to_place_id
            )
            _validate_time_order(payload.planned_departure_at, payload.planned_arrival_at)
            _validate_cost_currency(payload.cost, payload.currency)

            from_event_id = _resolve_event_ref(db, plan, payload.from_event_id)
            from_place_id = _resolve_place_ref(db, payload.from_place_id)
            to_event_id = _resolve_event_ref(db, plan, payload.to_event_id)
            to_place_id = _resolve_place_ref(db, payload.to_place_id)
            reservation_id = _resolve_reservation_ref(db, plan, payload.reservation_id)

            fields = {
                "from_event_id": from_event_id,
                "from_place_id": from_place_id,
                "to_event_id": to_event_id,
                "to_place_id": to_place_id,
                "mode": payload.mode,
                "distance_km": payload.distance_km,
                "duration_minutes": payload.duration_minutes,
            }
            fields = _apply_haversine_fallback(db, fields)

            seg = TravelSegment(
                plan_id=plan.id,
                from_event_id=from_event_id,
                from_place_id=from_place_id,
                to_event_id=to_event_id,
                to_place_id=to_place_id,
                mode=payload.mode,
                status=payload.status,
                planned_departure_at=payload.planned_departure_at,
                planned_arrival_at=payload.planned_arrival_at,
                distance_km=fields["distance_km"],
                duration_minutes=fields["duration_minutes"],
                cost=payload.cost,
                currency=payload.currency,
                preparation_minutes=payload.preparation_minutes,
                buffer_before_minutes=payload.buffer_before_minutes,
                buffer_after_minutes=payload.buffer_after_minutes,
                transport_number=payload.transport_number,
                platform=payload.platform,
                transfer_count=payload.transfer_count,
                luggage_note=payload.luggage_note,
                reservation_id=reservation_id,
                is_estimate=fields["is_estimate"],
                provider=fields["provider"],
                algorithm_version=fields["algorithm_version"],
                computed_at=fields["computed_at"],
            )
            db.add(seg)
            db.flush()

        # [重要] SAVEPOINTはここまでで正常解放(=外側transactionへ統合、まだ
        # 物理commitはしていない)。_record_change_and_bump_revisionは内部で
        # db.commit()を呼ぶため、SAVEPOINTブロックの外で実行する必要がある
        # (quickdraft_idempotency.pyのPhase Bと同じ理由。ブロック内で呼ぶと
        # 「Can't operate on closed transaction」になる)。
        _record_change_and_bump_revision(
            db, plan, current_user, "manual", "travel_segment", seg.id, "create",
            before_json=None, after_json=_segment_to_dict(seg),
        )
        db.refresh(seg)
        response_body = _to_response(seg, db)

        finalize_success(db, record.id, 201, response_body)
        return response_body

    except HTTPException as e:
        finalize_failure(db, record.id, {"code": "VALIDATION_ERROR", "message": str(e.detail)})
        raise
    except Exception:
        finalize_failure(db, record.id, {"code": "INTERNAL_ERROR", "message": "internal error"})
        raise


@router.patch("/{plan_id}/segments/{segment_id}", response_model=dict)
def update_segment(
    plan_id: str,
    segment_id: str,
    payload: SegmentUpdateRequest,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _require_if_match(plan, if_match)
    seg = _get_segment_or_404(db, plan.id, segment_id)

    before = _segment_to_dict(seg)
    data = payload.model_dump(exclude_unset=True)

    # マージ後の状態で相互検証する(部分更新でも常に完全な状態を検証する)。
    merged_from_event = data.get("from_event_id", str(seg.from_event_id) if seg.from_event_id else None)
    merged_from_place = data.get("from_place_id", str(seg.from_place_id) if seg.from_place_id else None)
    merged_to_event = data.get("to_event_id", str(seg.to_event_id) if seg.to_event_id else None)
    merged_to_place = data.get("to_place_id", str(seg.to_place_id) if seg.to_place_id else None)
    merged_departure = data.get("planned_departure_at", seg.planned_departure_at)
    merged_arrival = data.get("planned_arrival_at", seg.planned_arrival_at)
    merged_cost = data.get("cost", seg.cost)
    merged_currency = data.get("currency", seg.currency)

    _validate_endpoint_shape(merged_from_event, merged_from_place, merged_to_event, merged_to_place)
    _validate_time_order(merged_departure, merged_arrival)
    _validate_cost_currency(merged_cost, merged_currency)

    if "from_event_id" in data:
        seg.from_event_id = _resolve_event_ref(db, plan, data["from_event_id"])
    if "from_place_id" in data:
        seg.from_place_id = _resolve_place_ref(db, data["from_place_id"])
    if "to_event_id" in data:
        seg.to_event_id = _resolve_event_ref(db, plan, data["to_event_id"])
    if "to_place_id" in data:
        seg.to_place_id = _resolve_place_ref(db, data["to_place_id"])
    if "reservation_id" in data:
        seg.reservation_id = _resolve_reservation_ref(db, plan, data["reservation_id"])

    for field in (
        "mode", "status", "planned_departure_at", "planned_arrival_at",
        "preparation_minutes", "buffer_before_minutes", "buffer_after_minutes",
        "transport_number", "platform", "transfer_count", "luggage_note",
    ):
        if field in data:
            setattr(seg, field, data[field])

    if "cost" in data:
        seg.cost = data["cost"]
    if "currency" in data:
        seg.currency = data["currency"]

    if "distance_km" in data or "duration_minutes" in data:
        if "distance_km" in data:
            seg.distance_km = data["distance_km"]
        if "duration_minutes" in data:
            seg.duration_minutes = data["duration_minutes"]
        seg.is_estimate = False
        seg.provider = "manual"
        seg.algorithm_version = "manual-v1"
        seg.computed_at = datetime.now(dt_timezone.utc)

    seg.revision += 1
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_segment", seg.id, "update",
        before_json=before, after_json=_segment_to_dict(seg),
    )
    db.refresh(seg)
    return _to_response(seg, db)


@router.delete("/{plan_id}/segments/{segment_id}", response_model=dict)
def delete_segment(
    plan_id: str,
    segment_id: str,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _require_if_match(plan, if_match)
    seg = _get_segment_or_404(db, plan.id, segment_id)

    before = _segment_to_dict(seg)
    seg_id = seg.id
    db.delete(seg)
    db.flush()

    new_revision = _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_segment", seg_id, "delete",
        before_json=before, after_json=None,
    )
    return {"message": "移動区間を削除しました", "revision": new_revision}
