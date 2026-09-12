"""
[Gate M3] FR-015 複数経路比較(DOC-02 FR-015 / DOC-05 §7.2 route_options /
route_legs)。

RouteOption(採用前の経路候補)とRouteLeg(候補内の個別乗り継ぎ区間)の
CRUD、および候補をTravelSegment(FR-014、Gate M1)として採用する
`adopt`エンドポイントを提供する。外部ルーティングAPIは未導入のため、
本Gateでは`provider="manual"`(DOC-02「ルート取得不能時は手動区間を
登録できる」)のみをサポートする。

設計判断の詳細はdocs/adr/ADR-route-options.md参照。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Header
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user_or_guest
from app.core.plan_access import require_plan_access
from app.models.models import RouteOption, RouteLeg, TravelSegment, TravelEvent, Place, User
from app.services.quickdraft_idempotency import (
    claim_or_get_cached,
    finalize_success,
    finalize_failure,
    compute_payload_hash,
    IdempotencyKeyReused,
    IdempotencyInProgress,
)
# [Gate M3] Day/Event/Segment側の楽観ロック(If-Match)・ChangeSet記録は
# app/api/v1/plans.py の実装を正本として再利用する(重複実装しない)。
from app.api.v1.plans import (
    _get_owned_plan,
    _require_if_match,
    _record_change_and_bump_revision,
    _record_batch_change_and_bump_revision,
    _segment_to_dict,
)
from app.api.v1.segments import (
    MODES,
    _validate_endpoint_shape,
    _resolve_event_ref,
    _resolve_place_ref,
    _apply_haversine_fallback,
)

router = APIRouter(prefix="/plans", tags=["route_options"])

POST_ENDPOINT = "POST /v1/plans/route-options"

STATUSES = {"candidate", "adopted", "discarded"}
REALTIME_STATUSES = {"unknown", "on_time", "delayed", "cancelled"}


# ===== スキーマ =====

class RouteLegCreateRequest(BaseModel):
    mode: str
    line: Optional[str] = None
    operator: Optional[str] = None
    platform: Optional[str] = None
    from_label: Optional[str] = None
    to_label: Optional[str] = None
    departure_at: Optional[datetime] = None
    arrival_at: Optional[datetime] = None
    distance_km: Optional[float] = Field(None, ge=0)
    duration_minutes: Optional[float] = Field(None, ge=0)

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v):
        if v not in MODES:
            raise ValueError(f"mode must be one of {sorted(MODES)}")
        return v

    @field_validator("departure_at", "arrival_at")
    @classmethod
    def _require_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v


class RouteLegUpdateRequest(BaseModel):
    mode: Optional[str] = None
    line: Optional[str] = None
    operator: Optional[str] = None
    platform: Optional[str] = None
    from_label: Optional[str] = None
    to_label: Optional[str] = None
    departure_at: Optional[datetime] = None
    arrival_at: Optional[datetime] = None
    distance_km: Optional[float] = Field(None, ge=0)
    duration_minutes: Optional[float] = Field(None, ge=0)
    realtime_status: Optional[str] = None

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v):
        if v is not None and v not in MODES:
            raise ValueError(f"mode must be one of {sorted(MODES)}")
        return v

    @field_validator("realtime_status")
    @classmethod
    def _validate_realtime(cls, v):
        if v is not None and v not in REALTIME_STATUSES:
            raise ValueError(f"realtime_status must be one of {sorted(REALTIME_STATUSES)}")
        return v


class RouteOptionCreateRequest(BaseModel):
    from_event_id: Optional[str] = None
    from_place_id: Optional[str] = None
    to_event_id: Optional[str] = None
    to_place_id: Optional[str] = None
    total_duration_minutes: Optional[float] = Field(None, ge=0)
    total_cost: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    total_distance_km: Optional[float] = Field(None, ge=0)
    walking_minutes: Optional[float] = Field(None, ge=0)
    transfer_count: Optional[int] = Field(None, ge=0)
    accessibility_score: Optional[float] = Field(None, ge=0, le=1)
    scenic_score: Optional[float] = Field(None, ge=0, le=1)
    co2_estimate_kg: Optional[float] = Field(None, ge=0)
    duration_estimate_low_minutes: Optional[float] = Field(None, ge=0)
    duration_estimate_high_minutes: Optional[float] = Field(None, ge=0)
    legs: List[RouteLegCreateRequest] = Field(default_factory=list)

    @field_validator("currency")
    @classmethod
    def _validate_currency(cls, v):
        if v is not None and (not v.isalpha() or v != v.upper()):
            raise ValueError("currency must be an uppercase 3-letter ISO 4217 code")
        return v

    @model_validator(mode="after")
    def _check_cost_currency(self):
        if (self.total_cost is None) != (self.currency is None):
            raise ValueError("total_cost and currency must be specified together")
        if (
            self.duration_estimate_low_minutes is not None
            and self.duration_estimate_high_minutes is not None
            and self.duration_estimate_high_minutes < self.duration_estimate_low_minutes
        ):
            raise ValueError("duration_estimate_high_minutes must not be less than duration_estimate_low_minutes")
        return self


class RouteOptionUpdateRequest(BaseModel):
    status: Optional[str] = None
    total_duration_minutes: Optional[float] = Field(None, ge=0)
    total_cost: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    total_distance_km: Optional[float] = Field(None, ge=0)
    walking_minutes: Optional[float] = Field(None, ge=0)
    transfer_count: Optional[int] = Field(None, ge=0)
    accessibility_score: Optional[float] = Field(None, ge=0, le=1)
    scenic_score: Optional[float] = Field(None, ge=0, le=1)
    co2_estimate_kg: Optional[float] = Field(None, ge=0)

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v):
        if v is not None and v not in STATUSES:
            raise ValueError(f"status must be one of {sorted(STATUSES)}")
        return v


# ===== 変換ヘルパー =====

def _leg_to_response(leg: RouteLeg) -> dict:
    return jsonable_encoder({
        "id": str(leg.id),
        "route_option_id": str(leg.route_option_id),
        "leg_order": leg.leg_order,
        "mode": leg.mode,
        "line": leg.line,
        "operator": leg.operator,
        "platform": leg.platform,
        "from_label": leg.from_label,
        "to_label": leg.to_label,
        "departure_at": leg.departure_at,
        "arrival_at": leg.arrival_at,
        "distance_km": leg.distance_km,
        "duration_minutes": leg.duration_minutes,
        "realtime_status": leg.realtime_status,
        "created_at": leg.created_at,
        "updated_at": leg.updated_at,
    })


def _option_to_response(option: RouteOption, db: Session) -> dict:
    legs = (
        db.query(RouteLeg)
        .filter(RouteLeg.route_option_id == option.id)
        .order_by(RouteLeg.leg_order.asc())
        .all()
    )
    return jsonable_encoder({
        "id": str(option.id),
        "plan_id": str(option.plan_id),
        "from_event_id": str(option.from_event_id) if option.from_event_id else None,
        "from_place_id": str(option.from_place_id) if option.from_place_id else None,
        "to_event_id": str(option.to_event_id) if option.to_event_id else None,
        "to_place_id": str(option.to_place_id) if option.to_place_id else None,
        "status": option.status,
        "total_duration_minutes": option.total_duration_minutes,
        "total_cost": str(option.total_cost) if option.total_cost is not None else None,
        "currency": option.currency,
        "total_distance_km": option.total_distance_km,
        "walking_minutes": option.walking_minutes,
        "transfer_count": option.transfer_count,
        "accessibility_score": option.accessibility_score,
        "scenic_score": option.scenic_score,
        "co2_estimate_kg": option.co2_estimate_kg,
        "duration_estimate_low_minutes": option.duration_estimate_low_minutes,
        "duration_estimate_high_minutes": option.duration_estimate_high_minutes,
        "provider": option.provider,
        "retrieved_at": option.retrieved_at,
        "expires_at": option.expires_at,
        "is_estimate": option.is_estimate,
        "algorithm_version": option.algorithm_version,
        "revision": option.revision,
        "created_at": option.created_at,
        "updated_at": option.updated_at,
        "legs": [_leg_to_response(l) for l in legs],
    })


def _option_to_dict(option: RouteOption) -> dict:
    """Undo用スナップショット(plans.pyの_segment_to_dict相当)。"""
    return {
        "id": str(option.id),
        "plan_id": str(option.plan_id),
        "from_event_id": str(option.from_event_id) if option.from_event_id else None,
        "from_place_id": str(option.from_place_id) if option.from_place_id else None,
        "to_event_id": str(option.to_event_id) if option.to_event_id else None,
        "to_place_id": str(option.to_place_id) if option.to_place_id else None,
        "status": option.status,
        "total_duration_minutes": option.total_duration_minutes,
        "total_cost": str(option.total_cost) if option.total_cost is not None else None,
        "currency": option.currency,
        "total_distance_km": option.total_distance_km,
        "walking_minutes": option.walking_minutes,
        "transfer_count": option.transfer_count,
        "accessibility_score": option.accessibility_score,
        "scenic_score": option.scenic_score,
        "co2_estimate_kg": option.co2_estimate_kg,
        "duration_estimate_low_minutes": option.duration_estimate_low_minutes,
        "duration_estimate_high_minutes": option.duration_estimate_high_minutes,
        "provider": option.provider,
        "retrieved_at": option.retrieved_at.isoformat() if option.retrieved_at else None,
        "expires_at": option.expires_at.isoformat() if option.expires_at else None,
        "is_estimate": option.is_estimate,
        "algorithm_version": option.algorithm_version,
    }


def _get_option_or_404(db: Session, plan_id, option_id: str) -> RouteOption:
    try:
        oid = uuid.UUID(str(option_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="経路候補が見つかりません")
    option = db.query(RouteOption).filter(RouteOption.id == oid, RouteOption.plan_id == plan_id).first()
    if not option:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="経路候補が見つかりません")
    return option


def _get_leg_or_404(db: Session, option_id, leg_id: str) -> RouteLeg:
    try:
        lid = uuid.UUID(str(leg_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="乗り継ぎ区間が見つかりません")
    leg = db.query(RouteLeg).filter(RouteLeg.id == lid, RouteLeg.route_option_id == option_id).first()
    if not leg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="乗り継ぎ区間が見つかりません")
    return leg


# ===== エンドポイント =====

@router.get("/{plan_id}/route-options", response_model=list)
def list_route_options(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (
        db.query(RouteOption)
        .filter(RouteOption.plan_id == plan.id)
        .order_by(RouteOption.created_at.asc())
        .all()
    )
    return [_option_to_response(o, db) for o in rows]


@router.get("/{plan_id}/route-options/{option_id}", response_model=dict)
def get_route_option(
    plan_id: str,
    option_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    option = _get_option_or_404(db, plan.id, option_id)
    return _option_to_response(option, db)


@router.post("/{plan_id}/route-options", status_code=201, response_model=dict)
def create_route_option(
    plan_id: str,
    payload: RouteOptionCreateRequest,
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
            from_event_id = _resolve_event_ref(db, plan, payload.from_event_id)
            from_place_id = _resolve_place_ref(db, payload.from_place_id)
            to_event_id = _resolve_event_ref(db, plan, payload.to_event_id)
            to_place_id = _resolve_place_ref(db, payload.to_place_id)

            option = RouteOption(
                plan_id=plan.id,
                from_event_id=from_event_id,
                from_place_id=from_place_id,
                to_event_id=to_event_id,
                to_place_id=to_place_id,
                status="candidate",
                total_duration_minutes=payload.total_duration_minutes,
                total_cost=payload.total_cost,
                currency=payload.currency,
                total_distance_km=payload.total_distance_km,
                walking_minutes=payload.walking_minutes,
                transfer_count=payload.transfer_count,
                accessibility_score=payload.accessibility_score,
                scenic_score=payload.scenic_score,
                co2_estimate_kg=payload.co2_estimate_kg,
                duration_estimate_low_minutes=payload.duration_estimate_low_minutes,
                duration_estimate_high_minutes=payload.duration_estimate_high_minutes,
                provider="manual",
                retrieved_at=datetime.now(dt_timezone.utc),
                is_estimate=True,
                algorithm_version="manual-v1",
            )
            db.add(option)
            db.flush()

            for i, leg_payload in enumerate(payload.legs):
                db.add(RouteLeg(
                    route_option_id=option.id,
                    leg_order=i,
                    mode=leg_payload.mode,
                    line=leg_payload.line,
                    operator=leg_payload.operator,
                    platform=leg_payload.platform,
                    from_label=leg_payload.from_label,
                    to_label=leg_payload.to_label,
                    departure_at=leg_payload.departure_at,
                    arrival_at=leg_payload.arrival_at,
                    distance_km=leg_payload.distance_km,
                    duration_minutes=leg_payload.duration_minutes,
                    realtime_status="unknown",
                ))
            db.flush()

        _record_change_and_bump_revision(
            db, plan, current_user, "manual", "route_option", option.id, "create",
            before_json=None, after_json=_option_to_dict(option),
        )
        db.refresh(option)
        response_body = _option_to_response(option, db)

        finalize_success(db, record.id, 201, response_body)
        return response_body

    except HTTPException as e:
        finalize_failure(db, record.id, {"code": "VALIDATION_ERROR", "message": str(e.detail)})
        raise
    except Exception:
        finalize_failure(db, record.id, {"code": "INTERNAL_ERROR", "message": "internal error"})
        raise


@router.patch("/{plan_id}/route-options/{option_id}", response_model=dict)
def update_route_option(
    plan_id: str,
    option_id: str,
    payload: RouteOptionUpdateRequest,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _require_if_match(plan, if_match)
    option = _get_option_or_404(db, plan.id, option_id)

    before = _option_to_dict(option)
    data = payload.model_dump(exclude_unset=True)

    merged_cost = data.get("total_cost", option.total_cost)
    merged_currency = data.get("currency", option.currency)
    if (merged_cost is None) != (merged_currency is None):
        raise HTTPException(status_code=422, detail="total_costとcurrencyは同時に指定してください")

    for field in (
        "status", "total_duration_minutes", "total_cost", "currency", "total_distance_km",
        "walking_minutes", "transfer_count", "accessibility_score", "scenic_score", "co2_estimate_kg",
    ):
        if field in data:
            setattr(option, field, data[field])

    option.revision += 1
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "route_option", option.id, "update",
        before_json=before, after_json=_option_to_dict(option),
    )
    db.refresh(option)
    return _option_to_response(option, db)


@router.delete("/{plan_id}/route-options/{option_id}", response_model=dict)
def delete_route_option(
    plan_id: str,
    option_id: str,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _require_if_match(plan, if_match)
    option = _get_option_or_404(db, plan.id, option_id)

    before = _option_to_dict(option)
    option_id_uuid = option.id

    legs = db.query(RouteLeg).filter(RouteLeg.route_option_id == option.id).all()
    for leg in legs:
        db.delete(leg)
    db.flush()

    db.delete(option)
    db.flush()

    new_revision = _record_change_and_bump_revision(
        db, plan, current_user, "manual", "route_option", option_id_uuid, "delete",
        before_json=before, after_json=None,
    )
    return {"message": "経路候補を削除しました", "revision": new_revision}


@router.post("/{plan_id}/route-options/{option_id}/legs", status_code=201, response_model=dict)
def add_route_leg(
    plan_id: str,
    option_id: str,
    payload: RouteLegCreateRequest,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _require_if_match(plan, if_match)
    option = _get_option_or_404(db, plan.id, option_id)

    max_order = db.query(RouteLeg).filter(RouteLeg.route_option_id == option.id).count()
    leg = RouteLeg(
        route_option_id=option.id,
        leg_order=max_order,
        mode=payload.mode,
        line=payload.line,
        operator=payload.operator,
        platform=payload.platform,
        from_label=payload.from_label,
        to_label=payload.to_label,
        departure_at=payload.departure_at,
        arrival_at=payload.arrival_at,
        distance_km=payload.distance_km,
        duration_minutes=payload.duration_minutes,
        realtime_status="unknown",
    )
    db.add(leg)
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "route_leg", leg.id, "create",
        before_json=None, after_json=_leg_to_response(leg),
    )
    db.refresh(leg)
    return _leg_to_response(leg)


@router.patch("/{plan_id}/route-options/{option_id}/legs/{leg_id}", response_model=dict)
def update_route_leg(
    plan_id: str,
    option_id: str,
    leg_id: str,
    payload: RouteLegUpdateRequest,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _require_if_match(plan, if_match)
    option = _get_option_or_404(db, plan.id, option_id)
    leg = _get_leg_or_404(db, option.id, leg_id)

    before = _leg_to_response(leg)
    data = payload.model_dump(exclude_unset=True)
    for field in (
        "mode", "line", "operator", "platform", "from_label", "to_label",
        "departure_at", "arrival_at", "distance_km", "duration_minutes", "realtime_status",
    ):
        if field in data:
            setattr(leg, field, data[field])
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "route_leg", leg.id, "update",
        before_json=before, after_json=_leg_to_response(leg),
    )
    db.refresh(leg)
    return _leg_to_response(leg)


@router.delete("/{plan_id}/route-options/{option_id}/legs/{leg_id}", response_model=dict)
def delete_route_leg(
    plan_id: str,
    option_id: str,
    leg_id: str,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _require_if_match(plan, if_match)
    option = _get_option_or_404(db, plan.id, option_id)
    leg = _get_leg_or_404(db, option.id, leg_id)

    before = _leg_to_response(leg)
    leg_id_uuid = leg.id
    db.delete(leg)
    db.flush()

    new_revision = _record_change_and_bump_revision(
        db, plan, current_user, "manual", "route_leg", leg_id_uuid, "delete",
        before_json=before, after_json=None,
    )
    return {"message": "乗り継ぎ区間を削除しました", "revision": new_revision}


@router.post("/{plan_id}/route-options/{option_id}/adopt", response_model=dict)
def adopt_route_option(
    plan_id: str,
    option_id: str,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """[Gate M3] RouteOption(候補)をTravelSegment(FR-014、採用済みの移動
    区間)として採用する。既にこのRouteOptionから採用済みのSegmentが
    存在する場合は、その内容を更新する(同じRouteOptionを二重採用しても
    Segmentが重複作成されない)。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _require_if_match(plan, if_match)
    option = _get_option_or_404(db, plan.id, option_id)

    if option.status == "discarded":
        raise HTTPException(status_code=422, detail="discarded状態の経路候補は採用できません")

    existing_segment = (
        db.query(TravelSegment)
        .filter(TravelSegment.plan_id == plan.id, TravelSegment.route_option_id == option.id)
        .first()
    )

    option_before = _option_to_dict(option)
    changes = []

    fields = {
        "from_event_id": option.from_event_id,
        "from_place_id": option.from_place_id,
        "to_event_id": option.to_event_id,
        "to_place_id": option.to_place_id,
        "mode": "mixed",
        "distance_km": option.total_distance_km,
        "duration_minutes": option.total_duration_minutes,
    }
    fields = _apply_haversine_fallback(db, fields)

    if existing_segment:
        segment_before = _segment_to_dict(existing_segment)
        existing_segment.distance_km = fields["distance_km"] or existing_segment.distance_km
        existing_segment.duration_minutes = fields["duration_minutes"] or existing_segment.duration_minutes
        existing_segment.cost = option.total_cost
        existing_segment.currency = option.currency
        existing_segment.transfer_count = option.transfer_count
        existing_segment.revision += 1
        db.flush()
        changes.append(("travel_segment", existing_segment.id, "update", segment_before, _segment_to_dict(existing_segment)))
        segment = existing_segment
    else:
        segment = TravelSegment(
            plan_id=plan.id,
            from_event_id=option.from_event_id,
            from_place_id=option.from_place_id,
            to_event_id=option.to_event_id,
            to_place_id=option.to_place_id,
            mode="mixed",
            status="planned",
            distance_km=fields["distance_km"],
            duration_minutes=fields["duration_minutes"],
            cost=option.total_cost,
            currency=option.currency,
            transfer_count=option.transfer_count,
            route_option_id=option.id,
            is_estimate=fields["is_estimate"],
            provider=fields["provider"],
            algorithm_version=fields["algorithm_version"],
            computed_at=fields["computed_at"],
        )
        db.add(segment)
        db.flush()
        changes.append(("travel_segment", segment.id, "create", None, _segment_to_dict(segment)))

    option.status = "adopted"
    option.revision += 1
    db.flush()
    changes.append(("route_option", option.id, "update", option_before, _option_to_dict(option)))

    new_revision = _record_batch_change_and_bump_revision(db, plan, current_user, "manual", changes)
    db.refresh(option)
    db.refresh(segment)
    return {
        "revision": new_revision,
        "route_option": _option_to_response(option, db),
        "segment_id": str(segment.id),
    }
