"""
[Gate R3-0] FR-010予約管理 最小実装API。

DOC-06本文には予約専用エンドポイントの明記が無いため(DOC-05 §6.1の
reservationsテーブル定義のみ存在)、既存の`/api/v1/plans/{plan_id}/...`
配下の慣習(days/events等)に合わせ、`/api/v1/plans/{plan_id}/reservations`
として実装する。

スコープ限定の理由はapp/models/models.pyのReservationクラス直上コメントと
docs/adr/ADR-reservation-minimal.mdを参照。

権限(DOC-04 §9 SC-11マトリクス):
- 作成/更新/削除: owner/editor
- 閲覧(一覧・詳細): viewer以上。ただしconfirmation_number/pinはmaskして返す。
- reveal(完全開示): owner/editorのみ。呼び出しをrecord_audit_event()で
  監査ログに残す(DOC-05 §18.1)。
"""
from datetime import datetime, timezone as dt_timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import Reservation, ReservationParticipant, ReservationStatus, ReservationType, User
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["reservations"])

_VALID_TYPES = {t.value for t in ReservationType}
_VALID_STATUSES = {s.value for s in ReservationStatus}


# ==========================================
# スキーマ(このGate専用。既存の巨大なschemas.pyには追加せず、
# quickdrafts.py同様このファイル内に自己完結させる)
# ==========================================

class ReservationCreateRequest(BaseModel):
    type: str
    status: str = ReservationStatus.CONFIRMED.value
    provider_name: Optional[str] = None
    confirmation_number: Optional[str] = Field(None, max_length=200)
    pin: Optional[str] = Field(None, max_length=100)
    holder_name: Optional[str] = Field(None, max_length=200)
    guest_count: Optional[int] = Field(None, ge=1, le=100)
    event_id: Optional[str] = None
    place_id: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    timezone_id: Optional[str] = None
    total_amount: Optional[float] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    payment_status: Optional[str] = None
    cancellation_deadline: Optional[datetime] = None
    contact_phone: Optional[str] = None
    contact_url: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in _VALID_TYPES:
            raise ValueError(f"typeは次のいずれかである必要があります: {sorted(_VALID_TYPES)}")
        return v

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in _VALID_STATUSES:
            raise ValueError(f"statusは次のいずれかである必要があります: {sorted(_VALID_STATUSES)}")
        return v


class ReservationUpdateRequest(BaseModel):
    """全フィールド任意。指定されたフィールドのみ更新する(PATCHセマンティクス)。"""
    type: Optional[str] = None
    status: Optional[str] = None
    provider_name: Optional[str] = None
    confirmation_number: Optional[str] = Field(None, max_length=200)
    pin: Optional[str] = Field(None, max_length=100)
    holder_name: Optional[str] = Field(None, max_length=200)
    guest_count: Optional[int] = Field(None, ge=1, le=100)
    event_id: Optional[str] = None
    place_id: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    timezone_id: Optional[str] = None
    total_amount: Optional[float] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    payment_status: Optional[str] = None
    cancellation_deadline: Optional[datetime] = None
    contact_phone: Optional[str] = None
    contact_url: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_TYPES:
            raise ValueError(f"typeは次のいずれかである必要があります: {sorted(_VALID_TYPES)}")
        return v

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"statusは次のいずれかである必要があります: {sorted(_VALID_STATUSES)}")
        return v


class ReservationResponse(BaseModel):
    id: str
    plan_id: str
    event_id: Optional[str]
    place_id: Optional[str]
    type: str
    status: str
    provider_name: Optional[str]
    # maskされた表示値のみ(例: "****1234")。完全開示はrevealエンドポイント。
    confirmation_number_masked: Optional[str]
    has_pin: bool
    holder_name: Optional[str]
    guest_count: Optional[int]
    start_at: Optional[datetime]
    end_at: Optional[datetime]
    timezone_id: Optional[str]
    total_amount: Optional[float]
    currency: Optional[str]
    payment_status: Optional[str]
    cancellation_deadline: Optional[datetime]
    contact_phone: Optional[str]
    contact_url: Optional[str]
    notes: Optional[str]
    revision: int
    created_at: datetime
    updated_at: Optional[datetime]


class ReservationRevealResponse(BaseModel):
    id: str
    confirmation_number: Optional[str]
    pin: Optional[str]


# ==========================================
# ヘルパー
# ==========================================

def _mask_confirmation_number(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    raw = raw.strip()
    if len(raw) <= 4:
        return "*" * len(raw)
    return "*" * (len(raw) - 4) + raw[-4:]


def _to_response(r: Reservation) -> ReservationResponse:
    return ReservationResponse(
        id=str(r.id),
        plan_id=str(r.plan_id),
        event_id=str(r.event_id) if r.event_id else None,
        place_id=str(r.place_id) if r.place_id else None,
        type=r.type,
        status=r.status,
        provider_name=r.provider_name,
        confirmation_number_masked=r.confirmation_number_masked,
        has_pin=r.pin_ciphertext is not None,
        holder_name=r.holder_name,
        guest_count=r.guest_count,
        start_at=r.start_at,
        end_at=r.end_at,
        timezone_id=r.timezone_id,
        total_amount=r.total_amount,
        currency=r.currency,
        payment_status=r.payment_status,
        cancellation_deadline=r.cancellation_deadline,
        contact_phone=r.contact_phone,
        contact_url=r.contact_url,
        notes=r.notes,
        revision=r.revision,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _get_reservation_or_404(db: Session, plan_id, reservation_id) -> Reservation:
    r = (
        db.query(Reservation)
        .filter(
            Reservation.id == reservation_id,
            Reservation.plan_id == plan_id,
            Reservation.deleted_at.is_(None),
        )
        .first()
    )
    if r is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="予約が見つかりません")
    return r


def _require_if_match(r: Reservation, if_match: Optional[str]) -> None:
    if if_match is None or if_match.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="If-Matchヘッダーが必要です(現在のリビジョンをGETで取得してから指定してください)",
        )
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="If-Matchの形式が不正です")
    if expected != r.revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"予約が他の変更で更新されています(現在のリビジョン: {r.revision})",
        )


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:255]


# ==========================================
# エンドポイント
# ==========================================

@router.post(
    "/{plan_id}/reservations",
    response_model=ReservationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reservation(
    plan_id: str,
    payload: ReservationCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")

    r = Reservation(
        plan_id=plan.id,
        event_id=payload.event_id or None,
        place_id=payload.place_id or None,
        type=payload.type,
        status=payload.status,
        provider_name=payload.provider_name,
        holder_name=payload.holder_name,
        guest_count=payload.guest_count,
        start_at=payload.start_at,
        end_at=payload.end_at,
        timezone_id=payload.timezone_id,
        total_amount=payload.total_amount,
        currency=payload.currency,
        payment_status=payload.payment_status,
        cancellation_deadline=payload.cancellation_deadline,
        contact_phone=payload.contact_phone,
        contact_url=payload.contact_url,
        notes=payload.notes,
    )

    if payload.confirmation_number:
        try:
            r.confirmation_number_ciphertext = encrypt_payload(payload.confirmation_number.encode("utf-8"))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="予約番号の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )
        r.confirmation_number_masked = _mask_confirmation_number(payload.confirmation_number)

    if payload.pin:
        try:
            r.pin_ciphertext = encrypt_payload(payload.pin.encode("utf-8"))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="PINの暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )

    db.add(r)
    db.commit()
    db.refresh(r)

    record_audit_event(
        action="reservation_created",
        resource_type="reservation",
        user_id=current_user.id,
        resource_id=r.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "type": r.type},
    )

    return _to_response(r)


@router.get("/{plan_id}/reservations", response_model=List[ReservationResponse])
def list_reservations(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")

    rows = (
        db.query(Reservation)
        .filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None))
        .order_by(Reservation.start_at.asc().nullslast(), Reservation.created_at.asc())
        .all()
    )
    return [_to_response(r) for r in rows]


@router.get("/{plan_id}/reservations/{reservation_id}", response_model=ReservationResponse)
def get_reservation(
    plan_id: str,
    reservation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    return _to_response(r)


@router.patch("/{plan_id}/reservations/{reservation_id}", response_model=ReservationResponse)
def update_reservation(
    plan_id: str,
    reservation_id: str,
    payload: ReservationUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
    if_match: Optional[str] = Header(None, alias="If-Match"),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    _require_if_match(r, if_match)

    data = payload.model_dump(exclude_unset=True)

    if "confirmation_number" in data:
        raw = data.pop("confirmation_number")
        if raw:
            try:
                r.confirmation_number_ciphertext = encrypt_payload(raw.encode("utf-8"))
            except EncryptionNotConfigured:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="予約番号の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
                )
            r.confirmation_number_masked = _mask_confirmation_number(raw)
        else:
            r.confirmation_number_ciphertext = None
            r.confirmation_number_masked = None

    if "pin" in data:
        raw = data.pop("pin")
        if raw:
            try:
                r.pin_ciphertext = encrypt_payload(raw.encode("utf-8"))
            except EncryptionNotConfigured:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="PINの暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
                )
        else:
            r.pin_ciphertext = None

    for field, value in data.items():
        setattr(r, field, value)

    r.revision += 1
    db.commit()
    db.refresh(r)

    record_audit_event(
        action="reservation_updated",
        resource_type="reservation",
        user_id=current_user.id,
        resource_id=r.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "fields": sorted(data.keys())},
    )

    return _to_response(r)


@router.delete("/{plan_id}/reservations/{reservation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reservation(
    plan_id: str,
    reservation_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
    if_match: Optional[str] = Header(None, alias="If-Match"),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    _require_if_match(r, if_match)

    r.deleted_at = datetime.now(dt_timezone.utc)
    r.revision += 1
    db.commit()

    record_audit_event(
        action="reservation_deleted",
        resource_type="reservation",
        user_id=current_user.id,
        resource_id=r.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id)},
    )
    return None


@router.post("/{plan_id}/reservations/{reservation_id}/reveal", response_model=ReservationRevealResponse)
def reveal_reservation(
    plan_id: str,
    reservation_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """[DOC-05 §18.1 / DOC-04 §9] confirmation_number/pinの完全開示。
    owner/editorのみ許可し、呼び出しを必ず監査ログへ記録する
    (viewerへは既定非公開。DOC-02 FR-021「予約番号・実位置・RESTRICTED
    資料は既定非公開」の方針に整合)。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)

    confirmation_number = None
    pin = None
    if r.confirmation_number_ciphertext:
        try:
            confirmation_number = decrypt_payload(r.confirmation_number_ciphertext).decode("utf-8")
        except (EncryptionNotConfigured, ValueError):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="予約番号の復号に失敗しました",
            )
    if r.pin_ciphertext:
        try:
            pin = decrypt_payload(r.pin_ciphertext).decode("utf-8")
        except (EncryptionNotConfigured, ValueError):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="PINの復号に失敗しました",
            )

    record_audit_event(
        action="reservation_revealed",
        resource_type="reservation",
        user_id=current_user.id,
        resource_id=r.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id)},
    )

    return ReservationRevealResponse(id=str(r.id), confirmation_number=confirmation_number, pin=pin)


# ==========================================================================
# [Gate R3-1] 予約参加者(reservation_participants)
# ==========================================================================

class ParticipantCreateRequest(BaseModel):
    name: str = Field(..., max_length=200)
    seat: Optional[str] = Field(None, max_length=50)
    special_request: Optional[str] = None
    plan_member_id: Optional[str] = None


class ParticipantUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    seat: Optional[str] = Field(None, max_length=50)
    special_request: Optional[str] = None
    plan_member_id: Optional[str] = None


class ParticipantResponse(BaseModel):
    id: str
    reservation_id: str
    plan_member_id: Optional[str]
    name: str
    seat: Optional[str]
    special_request: Optional[str]
    revision: int
    created_at: datetime
    updated_at: Optional[datetime]


def _to_participant_response(p: ReservationParticipant) -> ParticipantResponse:
    return ParticipantResponse(
        id=str(p.id),
        reservation_id=str(p.reservation_id),
        plan_member_id=str(p.plan_member_id) if p.plan_member_id else None,
        name=p.name,
        seat=p.seat,
        special_request=p.special_request,
        revision=p.revision,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _get_participant_or_404(db: Session, reservation_id, participant_id) -> ReservationParticipant:
    p = (
        db.query(ReservationParticipant)
        .filter(
            ReservationParticipant.id == participant_id,
            ReservationParticipant.reservation_id == reservation_id,
            ReservationParticipant.deleted_at.is_(None),
        )
        .first()
    )
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="参加者が見つかりません")
    return p


@router.post(
    "/{plan_id}/reservations/{reservation_id}/participants",
    response_model=ParticipantResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_participant(
    plan_id: str,
    reservation_id: str,
    payload: ParticipantCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)

    p = ReservationParticipant(
        reservation_id=r.id,
        plan_member_id=payload.plan_member_id or None,
        name=payload.name,
        seat=payload.seat,
        special_request=payload.special_request,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_participant_response(p)


@router.get(
    "/{plan_id}/reservations/{reservation_id}/participants",
    response_model=List[ParticipantResponse],
)
def list_participants(
    plan_id: str,
    reservation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    r = _get_reservation_or_404(db, plan.id, reservation_id)

    rows = (
        db.query(ReservationParticipant)
        .filter(
            ReservationParticipant.reservation_id == r.id,
            ReservationParticipant.deleted_at.is_(None),
        )
        .order_by(ReservationParticipant.created_at.asc())
        .all()
    )
    return [_to_participant_response(p) for p in rows]


@router.patch(
    "/{plan_id}/reservations/{reservation_id}/participants/{participant_id}",
    response_model=ParticipantResponse,
)
def update_participant(
    plan_id: str,
    reservation_id: str,
    participant_id: str,
    payload: ParticipantUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    p = _get_participant_or_404(db, r.id, participant_id)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(p, field, value)
    p.revision += 1

    db.commit()
    db.refresh(p)
    return _to_participant_response(p)


@router.delete(
    "/{plan_id}/reservations/{reservation_id}/participants/{participant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_participant(
    plan_id: str,
    reservation_id: str,
    participant_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    p = _get_participant_or_404(db, r.id, participant_id)

    p.deleted_at = datetime.now(dt_timezone.utc)
    p.revision += 1
    db.commit()
    return None
