"""
[Gate R3-7] FR-011予約取込 最小実装API(import_jobs/extraction_candidates)。

スコープ限定の理由はapp/models/models.pyのImportJobクラス直上コメントと
docs/adr/ADR-import-minimal.mdを参照。要旨: AI/OCR providerが未導入の
ため、ジョブはuploaded/scanning/extractingを自動遷移せず作成時点で
review_requiredとなり、候補(extraction_candidates)は利用者が登録する。
「確定前に本テーブルからドメインへ反映しない」(DOC-05 §6.7)という制約は
confirmエンドポイントでのみReservationを生成することで維持する。

権限:
- ジョブ作成/候補登録・レビュー/confirm/reject: owner/editor
- 閲覧(一覧・詳細): viewer以上。候補のcandidate_valueは一覧・詳細では
  マスクせず復号して返す(reservation側と異なり、確定前の"下書き"データ
  であり、レビューのためには内容を見えなければ判断できないため。ただし
  confirm操作自体はowner/editor限定かつ監査ログ必須とすることで、実際の
  ドメインデータ生成には制御を残す)。
"""
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    Document,
    ExtractionCandidate,
    ExtractionCandidateReviewStatus,
    ImportJob,
    ImportJobStatus,
    Reservation,
    ReservationStatus,
    ReservationType,
    User,
)
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["imports"])

_VALID_REVIEW_STATUSES = {s.value for s in ExtractionCandidateReviewStatus}

# [スコープ限定] confirm時にReservationへ反映可能なfield_pathのみ許可する
# (reservations.pyのReservationCreateRequestと同じフィールド集合)。
_VALID_RESERVATION_FIELD_PATHS = {
    "type", "status", "provider_name", "confirmation_number", "pin",
    "holder_name", "guest_count", "start_at", "end_at", "timezone_id",
    "total_amount", "currency", "payment_status", "cancellation_deadline",
    "contact_phone", "contact_url", "notes",
}
_VALID_RESERVATION_TYPES = {t.value for t in ReservationType}


# ==========================================
# スキーマ
# ==========================================

class ImportJobCreateRequest(BaseModel):
    document_id: Optional[str] = None
    consent_given: bool = False


class CandidateCreateRequest(BaseModel):
    field_path: str = Field(..., max_length=100)
    value: str = Field(..., max_length=2000)
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    evidence_locator: Optional[str] = Field(None, max_length=500)

    @field_validator("field_path")
    @classmethod
    def _validate_field_path(cls, v: str) -> str:
        if v not in _VALID_RESERVATION_FIELD_PATHS:
            raise ValueError(
                f"field_pathは次のいずれかである必要があります: {sorted(_VALID_RESERVATION_FIELD_PATHS)}"
            )
        return v


class ImportJobResponse(BaseModel):
    id: str
    plan_id: str
    document_id: Optional[str]
    provider: str
    status: str
    consent_given: bool
    error_message: Optional[str]
    result_reservation_id: Optional[str]
    started_at: datetime
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]


class CandidateResponse(BaseModel):
    id: str
    import_job_id: str
    field_path: str
    value: Optional[str]
    confidence: float
    evidence_locator: Optional[str]
    review_status: str
    reviewed_by_user_id: Optional[str]
    reviewed_at: Optional[datetime]
    created_at: datetime


class ImportJobDetailResponse(ImportJobResponse):
    candidates: List[CandidateResponse]


# ==========================================
# ヘルパー
# ==========================================

def _decrypt_candidate_value(c: ExtractionCandidate) -> Optional[str]:
    try:
        return decrypt_payload(c.candidate_value_ciphertext).decode("utf-8")
    except (EncryptionNotConfigured, ValueError):
        return None


def _to_job_response(j: ImportJob) -> ImportJobResponse:
    return ImportJobResponse(
        id=str(j.id),
        plan_id=str(j.plan_id),
        document_id=str(j.document_id) if j.document_id else None,
        provider=j.provider,
        status=j.status,
        consent_given=j.consent_given,
        error_message=j.error_message,
        result_reservation_id=str(j.result_reservation_id) if j.result_reservation_id else None,
        started_at=j.started_at,
        completed_at=j.completed_at,
        created_at=j.created_at,
        updated_at=j.updated_at,
    )


def _to_candidate_response(c: ExtractionCandidate) -> CandidateResponse:
    return CandidateResponse(
        id=str(c.id),
        import_job_id=str(c.import_job_id),
        field_path=c.field_path,
        value=_decrypt_candidate_value(c),
        confidence=c.confidence,
        evidence_locator=c.evidence_locator,
        review_status=c.review_status,
        reviewed_by_user_id=str(c.reviewed_by_user_id) if c.reviewed_by_user_id else None,
        reviewed_at=c.reviewed_at,
        created_at=c.created_at,
    )


def _get_job_or_404(db: Session, plan_id, job_id) -> ImportJob:
    j = db.query(ImportJob).filter(ImportJob.id == job_id, ImportJob.plan_id == plan_id).first()
    if j is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="取込ジョブが見つかりません")
    return j


def _get_candidate_or_404(db: Session, job_id, candidate_id) -> ExtractionCandidate:
    c = (
        db.query(ExtractionCandidate)
        .filter(ExtractionCandidate.id == candidate_id, ExtractionCandidate.import_job_id == job_id)
        .first()
    )
    if c is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="抽出候補が見つかりません")
    return c


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:255]


def _require_review_required(j: ImportJob) -> None:
    if j.status != ImportJobStatus.REVIEW_REQUIRED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"このジョブは現在'{j.status}'状態のため、この操作は実行できません"
            f"(review_required状態でのみ許可されます)",
        )


# ==========================================
# エンドポイント: import_jobs
# ==========================================

@router.post("/{plan_id}/imports", response_model=ImportJobResponse, status_code=status.HTTP_201_CREATED)
def create_import_job(
    plan_id: str,
    payload: ImportJobCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")

    if not payload.consent_given:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="取込には同意(consent_given)が必要です(DOC-05 §6.7)",
        )

    document = None
    if payload.document_id:
        document = (
            db.query(Document)
            .filter(Document.id == payload.document_id, Document.plan_id == plan.id, Document.deleted_at.is_(None))
            .first()
        )
        if document is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="指定された文書が見つかりません(同一旅行プラン内である必要があります)",
            )

    j = ImportJob(
        plan_id=plan.id,
        document_id=document.id if document else None,
        created_by_user_id=current_user.id,
        provider="manual",
        # [スコープ限定] AI/OCR provider未導入のためscanning/extractingを
        # 経由せず直接review_requiredで作成する(上部モジュールdocstring参照)。
        status=ImportJobStatus.REVIEW_REQUIRED.value,
        consent_given=True,
    )
    db.add(j)
    db.commit()
    db.refresh(j)

    record_audit_event(
        action="import_job_created",
        resource_type="import_job",
        user_id=current_user.id,
        resource_id=j.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id)},
    )

    return _to_job_response(j)


@router.get("/{plan_id}/imports", response_model=List[ImportJobResponse])
def list_import_jobs(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (
        db.query(ImportJob)
        .filter(ImportJob.plan_id == plan.id)
        .order_by(ImportJob.created_at.desc())
        .all()
    )
    return [_to_job_response(j) for j in rows]


@router.get("/{plan_id}/imports/{job_id}", response_model=ImportJobDetailResponse)
def get_import_job(
    plan_id: str,
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    j = _get_job_or_404(db, plan.id, job_id)
    candidates = (
        db.query(ExtractionCandidate)
        .filter(ExtractionCandidate.import_job_id == j.id)
        .order_by(ExtractionCandidate.created_at.asc())
        .all()
    )
    base = _to_job_response(j)
    return ImportJobDetailResponse(**base.model_dump(), candidates=[_to_candidate_response(c) for c in candidates])


# ==========================================
# エンドポイント: extraction_candidates
# ==========================================

@router.post(
    "/{plan_id}/imports/{job_id}/candidates",
    response_model=CandidateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_candidate(
    plan_id: str,
    job_id: str,
    payload: CandidateCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    j = _get_job_or_404(db, plan.id, job_id)
    _require_review_required(j)

    try:
        ciphertext = encrypt_payload(payload.value.encode("utf-8"))
    except EncryptionNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="候補値の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )

    c = ExtractionCandidate(
        import_job_id=j.id,
        field_path=payload.field_path,
        candidate_value_ciphertext=ciphertext,
        confidence=payload.confidence,
        evidence_locator=payload.evidence_locator,
        review_status=ExtractionCandidateReviewStatus.PENDING.value,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _to_candidate_response(c)


def _review_candidate(
    plan_id: str, job_id: str, candidate_id: str, new_status: str,
    db: Session, current_user: User,
) -> CandidateResponse:
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    j = _get_job_or_404(db, plan.id, job_id)
    _require_review_required(j)
    c = _get_candidate_or_404(db, j.id, candidate_id)

    c.review_status = new_status
    c.reviewed_by_user_id = current_user.id
    c.reviewed_at = datetime.now(dt_timezone.utc)
    db.commit()
    db.refresh(c)
    return _to_candidate_response(c)


@router.post(
    "/{plan_id}/imports/{job_id}/candidates/{candidate_id}/accept",
    response_model=CandidateResponse,
)
def accept_candidate(
    plan_id: str,
    job_id: str,
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    return _review_candidate(
        plan_id, job_id, candidate_id, ExtractionCandidateReviewStatus.ACCEPTED.value, db, current_user
    )


@router.post(
    "/{plan_id}/imports/{job_id}/candidates/{candidate_id}/reject",
    response_model=CandidateResponse,
)
def reject_candidate(
    plan_id: str,
    job_id: str,
    candidate_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    return _review_candidate(
        plan_id, job_id, candidate_id, ExtractionCandidateReviewStatus.REJECTED.value, db, current_user
    )


# ==========================================
# エンドポイント: confirm / reject(ジョブ全体)
# ==========================================

def _coerce_reservation_field(field_path: str, raw_value: str) -> Any:
    """extraction_candidatesの平文値(常に文字列)をReservationモデルの
    型へ変換する。変換できない場合は422を返す。"""
    if field_path in ("start_at", "end_at", "cancellation_deadline"):
        try:
            return datetime.fromisoformat(raw_value)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{field_path}の値がISO 8601形式ではありません: {raw_value}",
            )
    if field_path == "guest_count":
        try:
            return int(raw_value)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"guest_countは整数である必要があります: {raw_value}",
            )
    if field_path == "total_amount":
        try:
            return float(raw_value)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"total_amountは数値である必要があります: {raw_value}",
            )
    return raw_value


@router.post("/{plan_id}/imports/{job_id}/confirm", response_model=ImportJobResponse)
def confirm_import_job(
    plan_id: str,
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """[DOC-05 §6.7/§18.2] review_status="accepted"の候補のみをReservation
    へ反映して確定する。候補が1件も無い、またはtype未確定(必須)の場合は
    422。確定前にドメインへ一切反映しないことを本関数内でのみ実行することで
    保証する。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    j = _get_job_or_404(db, plan.id, job_id)
    _require_review_required(j)

    accepted = (
        db.query(ExtractionCandidate)
        .filter(
            ExtractionCandidate.import_job_id == j.id,
            ExtractionCandidate.review_status == ExtractionCandidateReviewStatus.ACCEPTED.value,
        )
        .all()
    )
    if not accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="acceptされた候補が1件もありません(確定にはaccept済み候補が必要です)",
        )

    fields: Dict[str, Any] = {}
    for c in accepted:
        raw_value = _decrypt_candidate_value(c)
        if raw_value is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="候補値の復号に失敗しました",
            )
        fields[c.field_path] = _coerce_reservation_field(c.field_path, raw_value)

    reservation_type = fields.get("type")
    if reservation_type not in _VALID_RESERVATION_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"typeフィールドのaccepted候補が必要です(次のいずれか: {sorted(_VALID_RESERVATION_TYPES)})",
        )

    reservation_status = fields.get("status", ReservationStatus.CONFIRMED.value)
    r = Reservation(
        plan_id=plan.id,
        type=reservation_type,
        status=reservation_status,
        provider_name=fields.get("provider_name"),
        holder_name=fields.get("holder_name"),
        guest_count=fields.get("guest_count"),
        start_at=fields.get("start_at"),
        end_at=fields.get("end_at"),
        timezone_id=fields.get("timezone_id"),
        total_amount=fields.get("total_amount"),
        currency=fields.get("currency"),
        payment_status=fields.get("payment_status"),
        cancellation_deadline=fields.get("cancellation_deadline"),
        contact_phone=fields.get("contact_phone"),
        contact_url=fields.get("contact_url"),
        notes=fields.get("notes"),
    )

    if "confirmation_number" in fields:
        try:
            r.confirmation_number_ciphertext = encrypt_payload(str(fields["confirmation_number"]).encode("utf-8"))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="予約番号の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )
        raw = str(fields["confirmation_number"]).strip()
        r.confirmation_number_masked = ("*" * max(len(raw) - 4, 0)) + raw[-4:] if len(raw) > 4 else "*" * len(raw)

    if "pin" in fields:
        try:
            r.pin_ciphertext = encrypt_payload(str(fields["pin"]).encode("utf-8"))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="PINの暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )

    db.add(r)
    db.flush()

    j.status = ImportJobStatus.CONFIRMED.value
    j.result_reservation_id = r.id
    j.completed_at = datetime.now(dt_timezone.utc)

    db.commit()
    db.refresh(j)
    db.refresh(r)

    record_audit_event(
        action="import_job_confirmed",
        resource_type="import_job",
        user_id=current_user.id,
        resource_id=j.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "result_reservation_id": str(r.id)},
    )

    return _to_job_response(j)


@router.post("/{plan_id}/imports/{job_id}/reject", response_model=ImportJobResponse)
def reject_import_job(
    plan_id: str,
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    j = _get_job_or_404(db, plan.id, job_id)
    _require_review_required(j)

    j.status = ImportJobStatus.REJECTED.value
    j.completed_at = datetime.now(dt_timezone.utc)
    db.commit()
    db.refresh(j)

    record_audit_event(
        action="import_job_rejected",
        resource_type="import_job",
        user_id=current_user.id,
        resource_id=j.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id)},
    )

    return _to_job_response(j)
