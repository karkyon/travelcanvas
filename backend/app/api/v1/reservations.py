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
from app.core.crypto import (
    SUFFIX_LOOKUP_LENGTH,
    EncryptionNotConfigured,
    LookupIndexNotConfigured,
    compute_lookup_hash,
    compute_participant_name_lookup_hash,
    compute_suffix_lookup_hash,
    decrypt_payload,
    encrypt_payload,
)
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    EventReservation,
    Reservation,
    ReservationEventRelationType,
    ReservationParticipant,
    ReservationStatus,
    ReservationType,
    Ticket,
    TicketSharePolicy,
    TicketStatus,
    TravelEvent,
    User,
)
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["reservations"])

_VALID_TYPES = {t.value for t in ReservationType}
_VALID_STATUSES = {s.value for s in ReservationStatus}
_VALID_RELATION_TYPES = {t.value for t in ReservationEventRelationType}
_VALID_TICKET_STATUSES = {s.value for s in TicketStatus}
_VALID_SHARE_POLICIES = {p.value for p in TicketSharePolicy}


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


def _decrypt_or_none(ciphertext: Optional[bytes]) -> Optional[str]:
    """[Gate R3-8] 復号ヘルパー。ciphertextが無い、または復号失敗時はNoneを返す
    (呼び出し側で旧平文列へのフォールバックに使う)。"""
    if not ciphertext:
        return None
    try:
        return decrypt_payload(ciphertext).decode("utf-8")
    except (EncryptionNotConfigured, ValueError):
        return None


def _encrypt_or_raise(raw: Optional[str], field_label: str) -> Optional[bytes]:
    """[Gate R3-8] 暗号化ヘルパー。rawがNone/空文字ならNoneを返す(暗号化しない)。"""
    if not raw:
        return None
    try:
        return encrypt_payload(raw.encode("utf-8"))
    except EncryptionNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{field_label}の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )


def _compute_lookup_hash_or_none(raw: Optional[str]) -> Optional[str]:
    """[Gate R3-13] blind index計算ヘルパー。rawがNone/空文字ならNoneを返す。
    LOOKUP_INDEX_KEY未設定の場合は例外を送出せずNoneを返す(ENCRYPTION_KEYと
    異なり、この索引は検索機能のみに影響し予約の作成・編集自体を妨げては
    ならないため。索引が無い予約は単に検索対象から漏れるだけとなる)。"""
    if not raw:
        return None
    try:
        return compute_lookup_hash(raw)
    except LookupIndexNotConfigured:
        return None


def _compute_suffix_lookup_hash_or_none(raw: Optional[str]) -> Optional[str]:
    """[Gate R3-14] 末尾検索用blind index計算ヘルパー。_compute_lookup_hash_or_none
    と同じ理由でLOOKUP_INDEX_KEY未設定時はNoneを返す(検索機能のみへ影響)。
    正規化後4文字未満の場合はcompute_suffix_lookup_hash自体がNoneを返す。"""
    if not raw:
        return None
    try:
        return compute_suffix_lookup_hash(raw)
    except LookupIndexNotConfigured:
        return None


def _compute_participant_name_lookup_hash_or_none(raw: Optional[str]) -> Optional[str]:
    """[Gate R3-15] 参加者氏名検索用blind index計算ヘルパー。他のヘルパーと
    同じ理由でLOOKUP_INDEX_KEY未設定時はNoneを返す(検索機能のみへ影響)。"""
    if not raw:
        return None
    try:
        return compute_participant_name_lookup_hash(raw)
    except LookupIndexNotConfigured:
        return None


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
        holder_name=_decrypt_or_none(r.holder_name_ciphertext) or r.holder_name,
        guest_count=r.guest_count,
        start_at=r.start_at,
        end_at=r.end_at,
        timezone_id=r.timezone_id,
        total_amount=r.total_amount,
        currency=r.currency,
        payment_status=r.payment_status,
        cancellation_deadline=r.cancellation_deadline,
        contact_phone=_decrypt_or_none(r.contact_phone_ciphertext) or r.contact_phone,
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


def _require_if_match(r, if_match: Optional[str]) -> None:
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


def _sync_primary_event_link(db: Session, reservation: Reservation) -> None:
    """[Gate R3-3] 後方互換同期。Reservation.event_id(単一FK)が設定されて
    いる場合、対応するevent_reservationsのprimaryリンクが存在しなければ
    作成する。既存の複数イベントリンク(required/related)には一切触れない。
    event_idがNoneの場合は何もしない(既存リンクの自動削除は行わない。
    リンクの削除は専用DELETEエンドポイントを介した明示操作とする)。
    """
    if not reservation.event_id:
        return
    exists = (
        db.query(EventReservation)
        .filter(
            EventReservation.event_id == reservation.event_id,
            EventReservation.reservation_id == reservation.id,
        )
        .first()
    )
    if exists is None:
        db.add(
            EventReservation(
                event_id=reservation.event_id,
                reservation_id=reservation.id,
                relation_type=ReservationEventRelationType.PRIMARY.value,
                is_locked=False,
            )
        )
        db.commit()


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
        guest_count=payload.guest_count,
        start_at=payload.start_at,
        end_at=payload.end_at,
        timezone_id=payload.timezone_id,
        total_amount=payload.total_amount,
        currency=payload.currency,
        payment_status=payload.payment_status,
        cancellation_deadline=payload.cancellation_deadline,
        contact_url=payload.contact_url,
        notes=payload.notes,
    )
    # [Gate R3-8] holder_name/contact_phoneは暗号化列のみへ書き込む
    # (旧平文列は後方互換のためモデルに残すが、新規行では常にNULLのまま)。
    r.holder_name_ciphertext = _encrypt_or_raise(payload.holder_name, "名義")
    r.contact_phone_ciphertext = _encrypt_or_raise(payload.contact_phone, "連絡先電話番号")

    if payload.confirmation_number:
        try:
            r.confirmation_number_ciphertext = encrypt_payload(payload.confirmation_number.encode("utf-8"))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="予約番号の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )
        r.confirmation_number_masked = _mask_confirmation_number(payload.confirmation_number)
        r.confirmation_number_lookup_hash = _compute_lookup_hash_or_none(payload.confirmation_number)
        r.confirmation_number_suffix_lookup_hash = _compute_suffix_lookup_hash_or_none(
            payload.confirmation_number
        )

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
    _sync_primary_event_link(db, r)

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


@router.get("/{plan_id}/reservations/search", response_model=List[ReservationResponse])
def search_reservations(
    plan_id: str,
    confirmation_number: Optional[str] = None,
    confirmation_number_suffix: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """[Gate R3-13/R3-14] DOC-11 §6.3 / DOC-08 §19 / POC-03「完全一致または
    末尾検索だけに制限」に対応するblind index検索。confirmation_numberは
    暗号化されており平文WHERE検索ができないため、2種類のHMAC blind index
    のいずれかで照合する。

    - `confirmation_number`: 完全一致(confirmation_number_lookup_hash)。
    - `confirmation_number_suffix`: 末尾4文字での一致
      (confirmation_number_suffix_lookup_hash、app/core/crypto.py
      SUFFIX_LOOKUP_LENGTH参照)。DOC-04 SC-17の既定マスク表示("****1234")
      と同じ末尾4文字単位。4文字以外の長さで渡された場合は400とする
      (索引の粒度と一致しない検索は常に空振りになり、利用者に無意味な
      「該当なし」を返してしまうため)。

    どちらか一方を必須とする(両方指定/どちらも未指定は400)。パスは
    `{reservation_id}`より前に定義し、"search"がUUIDとして誤って解釈
    されないようにする。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")

    has_exact = bool(confirmation_number and confirmation_number.strip())
    has_suffix = bool(confirmation_number_suffix and confirmation_number_suffix.strip())

    if has_exact and has_suffix:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="confirmation_numberとconfirmation_number_suffixは同時に指定できません",
        )
    if not has_exact and not has_suffix:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="confirmation_numberまたはconfirmation_number_suffixのいずれかが必要です",
        )

    if has_suffix:
        normalized_suffix = confirmation_number_suffix.strip()
        if len(normalized_suffix) != SUFFIX_LOOKUP_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"confirmation_number_suffixは{SUFFIX_LOOKUP_LENGTH}文字である必要があります",
            )
        try:
            target_hash = compute_suffix_lookup_hash(normalized_suffix)
        except LookupIndexNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="予約番号検索が設定されていません(サーバー側のLOOKUP_INDEX_KEY未設定)",
            )
        filter_column = Reservation.confirmation_number_suffix_lookup_hash
    else:
        try:
            target_hash = compute_lookup_hash(confirmation_number)
        except LookupIndexNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="予約番号検索が設定されていません(サーバー側のLOOKUP_INDEX_KEY未設定)",
            )
        filter_column = Reservation.confirmation_number_lookup_hash

    rows = (
        db.query(Reservation)
        .filter(
            Reservation.plan_id == plan.id,
            Reservation.deleted_at.is_(None),
            filter_column == target_hash,
        )
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
            r.confirmation_number_lookup_hash = _compute_lookup_hash_or_none(raw)
            r.confirmation_number_suffix_lookup_hash = _compute_suffix_lookup_hash_or_none(raw)
        else:
            r.confirmation_number_ciphertext = None
            r.confirmation_number_masked = None
            r.confirmation_number_lookup_hash = None
            r.confirmation_number_suffix_lookup_hash = None

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

    if "holder_name" in data:
        raw = data.pop("holder_name")
        r.holder_name_ciphertext = _encrypt_or_raise(raw, "名義")
        r.holder_name = None  # [Gate R3-8] 旧平文列は以後更新しない

    if "contact_phone" in data:
        raw = data.pop("contact_phone")
        r.contact_phone_ciphertext = _encrypt_or_raise(raw, "連絡先電話番号")
        r.contact_phone = None  # [Gate R3-8] 旧平文列は以後更新しない

    for field, value in data.items():
        setattr(r, field, value)

    r.revision += 1
    db.commit()
    db.refresh(r)
    _sync_primary_event_link(db, r)

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
        name=_decrypt_or_none(p.name_ciphertext) or p.name or "",
        seat=_decrypt_or_none(p.seat_ciphertext) or p.seat,
        special_request=_decrypt_or_none(p.special_request_ciphertext) or p.special_request,
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
    )
    # [Gate R3-8] name/seat/special_requestは暗号化列のみへ書き込む
    # (旧平文列は後方互換のためモデルに残すが、新規行では常にNULLのまま)。
    p.name_ciphertext = _encrypt_or_raise(payload.name, "参加者氏名")
    p.seat_ciphertext = _encrypt_or_raise(payload.seat, "座席")
    p.special_request_ciphertext = _encrypt_or_raise(payload.special_request, "特別リクエスト")
    p.name_lookup_hash = _compute_participant_name_lookup_hash_or_none(payload.name)
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


@router.get(
    "/{plan_id}/reservations/participants/search",
    response_model=List[ParticipantResponse],
)
def search_participants(
    plan_id: str,
    name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """[Gate R3-15] DOC-11 §6.3 blind indexによる参加者氏名の完全一致検索。
    reservation_participants.nameは暗号化されており平文WHERE検索が
    できないため、HMAC blind index(name_lookup_hash)で照合する。予約
    個別ではなく`plan_id`配下の全予約の参加者を横断検索する(「この旅行の
    予約に田中さんはいるか」という使い方を想定)。パスの segment 数が
    `/{reservation_id}/participants`(2segments)や
    `/{reservation_id}/participants/{participant_id}`(3segments)と
    一致しないため、定義順に関わらず衝突しない。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")

    if not name or not name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="nameは必須です")

    try:
        target_hash = compute_participant_name_lookup_hash(name)
    except LookupIndexNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="参加者氏名検索が設定されていません(サーバー側のLOOKUP_INDEX_KEY未設定)",
        )

    rows = (
        db.query(ReservationParticipant)
        .join(Reservation, ReservationParticipant.reservation_id == Reservation.id)
        .filter(
            Reservation.plan_id == plan.id,
            Reservation.deleted_at.is_(None),
            ReservationParticipant.deleted_at.is_(None),
            ReservationParticipant.name_lookup_hash == target_hash,
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

    if "name" in data:
        raw = data.pop("name")
        p.name_ciphertext = _encrypt_or_raise(raw, "参加者氏名")
        p.name = None  # [Gate R3-8] 旧平文列は以後更新しない
        p.name_lookup_hash = _compute_participant_name_lookup_hash_or_none(raw)

    if "seat" in data:
        raw = data.pop("seat")
        p.seat_ciphertext = _encrypt_or_raise(raw, "座席")
        p.seat = None

    if "special_request" in data:
        raw = data.pop("special_request")
        p.special_request_ciphertext = _encrypt_or_raise(raw, "特別リクエスト")
        p.special_request = None

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


# ==========================================================================
# [Gate R3-3] イベント複数紐付け(event_reservations)
# ==========================================================================
# DOC-05 §6.2: 1予約が複数イベントに紐付くケース(連泊等)に対応する。
# 既存のReservation.event_id(単一FK)との関係は_sync_primary_event_link()
# 参照。

class EventLinkCreateRequest(BaseModel):
    event_id: str
    relation_type: str = ReservationEventRelationType.PRIMARY.value
    is_locked: bool = False

    @field_validator("relation_type")
    @classmethod
    def _validate_relation_type(cls, v: str) -> str:
        if v not in _VALID_RELATION_TYPES:
            raise ValueError(f"relation_typeは次のいずれかである必要があります: {sorted(_VALID_RELATION_TYPES)}")
        return v


class EventLinkUpdateRequest(BaseModel):
    relation_type: Optional[str] = None
    is_locked: Optional[bool] = None

    @field_validator("relation_type")
    @classmethod
    def _validate_relation_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_RELATION_TYPES:
            raise ValueError(f"relation_typeは次のいずれかである必要があります: {sorted(_VALID_RELATION_TYPES)}")
        return v


class EventLinkResponse(BaseModel):
    id: str
    event_id: str
    reservation_id: str
    relation_type: str
    is_locked: bool
    created_at: datetime
    updated_at: Optional[datetime]


def _to_event_link_response(link: EventReservation) -> EventLinkResponse:
    return EventLinkResponse(
        id=str(link.id),
        event_id=str(link.event_id),
        reservation_id=str(link.reservation_id),
        relation_type=link.relation_type,
        is_locked=link.is_locked,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


def _get_event_link_or_404(db: Session, reservation_id, link_id) -> EventReservation:
    link = (
        db.query(EventReservation)
        .filter(
            EventReservation.id == link_id,
            EventReservation.reservation_id == reservation_id,
        )
        .first()
    )
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="イベント紐付けが見つかりません")
    return link


@router.post(
    "/{plan_id}/reservations/{reservation_id}/events",
    response_model=EventLinkResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_event_link(
    plan_id: str,
    reservation_id: str,
    payload: EventLinkCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """予約へイベントを追加で紐付ける(連泊等、1予約=複数イベント)。
    紐付け先イベントは同一planに属している必要がある(他planのイベントを
    誤って紐付けないため)。同一(event_id, reservation_id)の重複は409。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)

    event = (
        db.query(TravelEvent)
        .filter(TravelEvent.id == payload.event_id, TravelEvent.plan_id == plan.id)
        .first()
    )
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="紐付け先のイベントが見つかりません(同一旅行プラン内である必要があります)",
        )

    existing = (
        db.query(EventReservation)
        .filter(
            EventReservation.event_id == event.id,
            EventReservation.reservation_id == r.id,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="このイベントは既に紐付け済みです")

    link = EventReservation(
        event_id=event.id,
        reservation_id=r.id,
        relation_type=payload.relation_type,
        is_locked=payload.is_locked,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _to_event_link_response(link)


@router.get(
    "/{plan_id}/reservations/{reservation_id}/events",
    response_model=List[EventLinkResponse],
)
def list_event_links(
    plan_id: str,
    reservation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    r = _get_reservation_or_404(db, plan.id, reservation_id)

    rows = (
        db.query(EventReservation)
        .filter(EventReservation.reservation_id == r.id)
        .order_by(EventReservation.created_at.asc())
        .all()
    )
    return [_to_event_link_response(link) for link in rows]


@router.patch(
    "/{plan_id}/reservations/{reservation_id}/events/{link_id}",
    response_model=EventLinkResponse,
)
def update_event_link(
    plan_id: str,
    reservation_id: str,
    link_id: str,
    payload: EventLinkUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    link = _get_event_link_or_404(db, r.id, link_id)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(link, field, value)

    db.commit()
    db.refresh(link)
    return _to_event_link_response(link)


@router.delete(
    "/{plan_id}/reservations/{reservation_id}/events/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_event_link(
    plan_id: str,
    reservation_id: str,
    link_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """イベント紐付けを解除する(ハード削除。中間表そのものはsoft delete概念を
    持たない。ただしis_locked=Trueのリンクは、確定済み予定として誤操作から
    保護するため解除不可とする)。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    link = _get_event_link_or_404(db, r.id, link_id)

    if link.is_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="このイベント紐付けはロックされているため解除できません(先にis_locked解除が必要です)",
        )

    db.delete(link)
    db.commit()
    return None


# ==========================================================================
# [Gate R3-5] チケット(tickets、FR-012 QR・チケット)
# ==========================================================================

class TicketCreateRequest(BaseModel):
    ticket_type: str = Field(..., max_length=100)
    holder_member_id: Optional[str] = None
    payload: Optional[str] = Field(None, max_length=4000)
    barcode_format: Optional[str] = Field(None, max_length=50)
    valid_from: Optional[datetime] = None
    valid_to: Optional[datetime] = None
    status: str = TicketStatus.ACTIVE.value
    offline_allowed: bool = True
    share_policy: str = TicketSharePolicy.OWNER_EDITOR.value

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in _VALID_TICKET_STATUSES:
            raise ValueError(f"statusは次のいずれかである必要があります: {sorted(_VALID_TICKET_STATUSES)}")
        return v

    @field_validator("share_policy")
    @classmethod
    def _validate_share_policy(cls, v: str) -> str:
        if v not in _VALID_SHARE_POLICIES:
            raise ValueError(f"share_policyは次のいずれかである必要があります: {sorted(_VALID_SHARE_POLICIES)}")
        return v


class TicketUpdateRequest(BaseModel):
    ticket_type: Optional[str] = Field(None, max_length=100)
    holder_member_id: Optional[str] = None
    payload: Optional[str] = Field(None, max_length=4000)
    barcode_format: Optional[str] = Field(None, max_length=50)
    valid_from: Optional[datetime] = None
    valid_to: Optional[datetime] = None
    status: Optional[str] = None
    offline_allowed: Optional[bool] = None
    share_policy: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_TICKET_STATUSES:
            raise ValueError(f"statusは次のいずれかである必要があります: {sorted(_VALID_TICKET_STATUSES)}")
        return v

    @field_validator("share_policy")
    @classmethod
    def _validate_share_policy(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_SHARE_POLICIES:
            raise ValueError(f"share_policyは次のいずれかである必要があります: {sorted(_VALID_SHARE_POLICIES)}")
        return v


class TicketResponse(BaseModel):
    id: str
    reservation_id: str
    ticket_type: str
    holder_member_id: Optional[str]
    has_payload: bool
    barcode_format: Optional[str]
    valid_from: Optional[datetime]
    valid_to: Optional[datetime]
    status: str
    offline_allowed: bool
    share_policy: str
    revision: int
    created_at: datetime
    updated_at: Optional[datetime]


class TicketRevealResponse(BaseModel):
    id: str
    payload: Optional[str]
    barcode_format: Optional[str]


def _to_ticket_response(t: Ticket) -> TicketResponse:
    return TicketResponse(
        id=str(t.id),
        reservation_id=str(t.reservation_id),
        ticket_type=t.ticket_type,
        holder_member_id=str(t.holder_member_id) if t.holder_member_id else None,
        has_payload=t.payload_ciphertext is not None,
        barcode_format=t.barcode_format,
        valid_from=t.valid_from,
        valid_to=t.valid_to,
        status=t.status,
        offline_allowed=t.offline_allowed,
        share_policy=t.share_policy,
        revision=t.revision,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def _get_ticket_or_404(db: Session, reservation_id, ticket_id) -> Ticket:
    t = (
        db.query(Ticket)
        .filter(
            Ticket.id == ticket_id,
            Ticket.reservation_id == reservation_id,
            Ticket.deleted_at.is_(None),
        )
        .first()
    )
    if t is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="チケットが見つかりません")
    return t


def _min_role_for_reveal(ticket: Ticket) -> str:
    """share_policyに応じてreveal可能な最低ロールを決める(DOC-05 §6.4)。"""
    if ticket.share_policy == TicketSharePolicy.ALL_COLLABORATORS.value:
        return "viewer"
    return "editor"


@router.post(
    "/{plan_id}/reservations/{reservation_id}/tickets",
    response_model=TicketResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_ticket(
    plan_id: str,
    reservation_id: str,
    payload: TicketCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)

    t = Ticket(
        reservation_id=r.id,
        ticket_type=payload.ticket_type,
        holder_member_id=payload.holder_member_id or None,
        barcode_format=payload.barcode_format,
        valid_from=payload.valid_from,
        valid_to=payload.valid_to,
        status=payload.status,
        offline_allowed=payload.offline_allowed,
        share_policy=payload.share_policy,
    )

    if payload.payload:
        try:
            t.payload_ciphertext = encrypt_payload(payload.payload.encode("utf-8"))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="チケットpayloadの暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )

    db.add(t)
    db.commit()
    db.refresh(t)

    record_audit_event(
        action="ticket_created",
        resource_type="ticket",
        user_id=current_user.id,
        resource_id=t.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "reservation_id": str(r.id), "ticket_type": t.ticket_type},
    )

    return _to_ticket_response(t)


@router.get("/{plan_id}/reservations/{reservation_id}/tickets", response_model=List[TicketResponse])
def list_tickets(
    plan_id: str,
    reservation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    r = _get_reservation_or_404(db, plan.id, reservation_id)

    rows = (
        db.query(Ticket)
        .filter(Ticket.reservation_id == r.id, Ticket.deleted_at.is_(None))
        .order_by(Ticket.created_at.asc())
        .all()
    )
    return [_to_ticket_response(t) for t in rows]


@router.get(
    "/{plan_id}/reservations/{reservation_id}/tickets/{ticket_id}",
    response_model=TicketResponse,
)
def get_ticket(
    plan_id: str,
    reservation_id: str,
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    t = _get_ticket_or_404(db, r.id, ticket_id)
    return _to_ticket_response(t)


@router.patch(
    "/{plan_id}/reservations/{reservation_id}/tickets/{ticket_id}",
    response_model=TicketResponse,
)
def update_ticket(
    plan_id: str,
    reservation_id: str,
    ticket_id: str,
    payload: TicketUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
    if_match: Optional[str] = Header(None, alias="If-Match"),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    t = _get_ticket_or_404(db, r.id, ticket_id)
    _require_if_match(t, if_match)

    data = payload.model_dump(exclude_unset=True)

    if "payload" in data:
        raw = data.pop("payload")
        if raw:
            try:
                t.payload_ciphertext = encrypt_payload(raw.encode("utf-8"))
            except EncryptionNotConfigured:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="チケットpayloadの暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
                )
        else:
            t.payload_ciphertext = None

    for field, value in data.items():
        setattr(t, field, value)

    t.revision += 1
    db.commit()
    db.refresh(t)

    record_audit_event(
        action="ticket_updated",
        resource_type="ticket",
        user_id=current_user.id,
        resource_id=t.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "fields": sorted(data.keys())},
    )

    return _to_ticket_response(t)


@router.delete(
    "/{plan_id}/reservations/{reservation_id}/tickets/{ticket_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_ticket(
    plan_id: str,
    reservation_id: str,
    ticket_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
    if_match: Optional[str] = Header(None, alias="If-Match"),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    t = _get_ticket_or_404(db, r.id, ticket_id)
    _require_if_match(t, if_match)

    t.deleted_at = datetime.now(dt_timezone.utc)
    t.revision += 1
    db.commit()

    record_audit_event(
        action="ticket_deleted",
        resource_type="ticket",
        user_id=current_user.id,
        resource_id=t.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id)},
    )
    return None


@router.post(
    "/{plan_id}/reservations/{reservation_id}/tickets/{ticket_id}/reveal",
    response_model=TicketRevealResponse,
)
def reveal_ticket(
    plan_id: str,
    reservation_id: str,
    ticket_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """[DOC-05 §6.4/§19] payload(QR/バーコード生データ)の完全開示。
    share_policyに応じて必要ロールが変わる(既定owner_editor: owner/editor
    のみ。all_collaborators: viewerも可)。呼び出しを必ず監査ログへ記録する。
    """
    # まずviewer以上でプラン自体へのアクセスを確認してからticketのshare_policyを見る
    # (存在有無を漏らさないため、権限判定の前にオブジェクトを読む)。
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    r = _get_reservation_or_404(db, plan.id, reservation_id)
    t = _get_ticket_or_404(db, r.id, ticket_id)

    required_role = _min_role_for_reveal(t)
    from app.core.plan_access import _ROLE_RANK
    if _ROLE_RANK.get(role, 0) < _ROLE_RANK.get(required_role, 99):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"このチケットの表示には{required_role}以上の権限が必要です",
        )

    payload_value = None
    if t.payload_ciphertext:
        try:
            payload_value = decrypt_payload(t.payload_ciphertext).decode("utf-8")
        except (EncryptionNotConfigured, ValueError):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="チケットpayloadの復号に失敗しました",
            )

    record_audit_event(
        action="ticket_revealed",
        resource_type="ticket",
        user_id=current_user.id,
        resource_id=t.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "reservation_id": str(r.id)},
    )

    return TicketRevealResponse(id=str(t.id), payload=payload_value, barcode_format=t.barcode_format)
