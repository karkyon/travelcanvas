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
import logging
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload, plan_subject
from app.core.database import get_db
from app.services import cost_guard as cg
from app.services import member_policy, provider_calls, usage
from app.services import provider_secrets as ps
from app.services import reservation_extract as rx
from app.models.models import (
    Document,
    ExtractionCandidate,
    ExtractionCandidateReviewStatus,
    ImportJob,
    ImportJobStatus,
    Reservation,
    ReservationStatus,
    ReservationType,
    TravelDay,
    TravelEvent,
    EventReservation,
    User,
)
from app.services.audit_service import record_audit_event

# [Gate G2] FR-045 所有者が「reservations・documents」のどれかを隠した参加者には、この機能の API は 403
require_plan_access = member_policy.guarded("reservations", "documents")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plans", tags=["imports"])

_VALID_REVIEW_STATUSES = {s.value for s in ExtractionCandidateReviewStatus}

# [スコープ限定] confirm時にReservationへ反映可能なfield_pathのみ許可する
# (reservations.pyのReservationCreateRequestと同じフィールド集合)。
_VALID_RESERVATION_FIELD_PATHS = {
    "type", "status", "provider_name", "confirmation_number", "pin",
    "holder_name", "guest_count", "start_at", "end_at", "timezone_id",
    "total_amount", "currency", "payment_status", "cancellation_deadline",
    "contact_phone", "contact_url", "notes",
} | set(rx.DETAIL_FIELDS)
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

# ==========================================
# [Gate BookingImport] 予約メール・画像からの読み取り
# ==========================================

class ExtractTextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=rx.MAX_TEXT_CHARS)
    use_ai: bool = False


def _extract_error(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _plan_dates(db: Session, plan) -> Any:
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).order_by(TravelDay.local_date).all()
    dates = [d.local_date for d in days if d.local_date]
    zone = next((d.timezone_id for d in days if d.timezone_id), "Asia/Tokyo")
    return (dates[0] if dates else None), (dates[-1] if dates else None), zone


def _save_extraction(db: Session, request: Request, plan, user: User, found: rx.Extraction, provider: str,
                     source: str, ai_status: str, ai_message: Optional[str], first, last) -> Dict[str, Any]:
    """候補を保存する(確定はしない)。値は暗号化し、元の文章・画像は保存しない。"""
    values = {c.field: c.value for c in found.candidates}
    job = ImportJob(plan_id=plan.id, created_by_user_id=user.id, provider=provider,
                    status=ImportJobStatus.REVIEW_REQUIRED.value, consent_given=True)
    usage.charge(db, "user", plan.user_id, "imports")
    db.add(job)
    db.flush()
    try:
        for c in found.candidates:
            db.add(ExtractionCandidate(
                import_job_id=job.id, field_path=c.field,
                candidate_value_ciphertext=encrypt_payload(c.value.encode("utf-8"), plan_subject(plan.id)),
                confidence=c.confidence, evidence_locator=c.evidence,
                review_status=ExtractionCandidateReviewStatus.PENDING.value))
    except EncryptionNotConfigured:
        db.rollback()
        raise _extract_error("encryption_not_configured", "候補の暗号化が設定されていません(サーバー側の設定)", 503)
    db.commit()
    db.refresh(job)
    record_audit_event(action="import_job_extracted", resource_type="import_job", user_id=user.id, resource_id=job.id,
                       ip_address=_client_ip(request), user_agent=_user_agent(request),
                       details={"plan_id": str(plan.id), "source": source, "provider": provider,
                                "fields": sorted(values), "ai": ai_status})
    candidates = db.query(ExtractionCandidate).filter(ExtractionCandidate.import_job_id == job.id).all()
    return {**_to_job_response(job).model_dump(mode="json"),
            "candidates": [_to_candidate_response(c).model_dump(mode="json") for c in candidates],
            "ai_status": ai_status, "ai_message": ai_message, "warnings": rx.out_of_trip(values, first, last)}


_SECRET_NOTE = "AI の鍵の確認が切れているか未設定のため、AI は使いませんでした。管理画面の鍵の確認で直せます"


def _ai_fill(db: Session, plan, user: User, found: rx.Extraction, zone: str, *, text: str, image: Optional[bytes],
             masked: Optional[str], source: str) -> Any:
    """AI で足りない項目を補う。どの失敗でも 500 にせず、理由を返して読み取りの結果を残す。"""
    try:
        payload, _usage = provider_calls.ai_extract_reservation(
            db, plan, user, rx.AI_INSTRUCTIONS, rx.ai_schema(), text, image, str(uuid.uuid4()))
    except cg.CostGuardError as error:
        return "denied", error.message
    except ps.SecretUnavailable:
        return "denied", _SECRET_NOTE
    except provider_calls.ProviderRejected:
        return "denied", "AI の提供元が要求を受け付けませんでした(鍵・権限・残高)。AI は使いませんでした"
    except Exception:  # noqa: BLE001 - AI の失敗で読み取り全体を失わない
        logger.exception("予約の読み取りの AI の呼び出しに失敗しました")
        if not db.is_active:
            db.rollback()
        return "denied", "AI の呼び出しに失敗したため、AI は使いませんでした"
    added = rx.merge_ai(found, payload["text"], zone, source=source, masked_text=masked)
    return "used", None if added else "AI でも足りない項目を読み取れませんでした"


def _run_text(db: Session, request: Request, plan, user: User, text: str, use_ai: bool, source: str) -> Dict[str, Any]:
    first, last, zone = _plan_dates(db, plan)
    found = rx.rule_extract(text, zone, first.year if first else None)
    provider, ai_status, ai_message = "rules", "off", None
    if use_ai:
        if rx.CORE_FIELDS <= found.fields():
            ai_status = "not_needed"
        else:
            masked = rx.mask_for_ai(text)
            ai_status, ai_message = _ai_fill(db, plan, user, found, zone, text=masked, image=None, masked=masked,
                                             source="AI")
            if ai_status == "used":
                provider = "rules+openai"
    if not found.candidates:
        raise _extract_error("nothing_extracted", ai_message or "予約の項目を読み取れませんでした。手で項目を入れてください")
    return _save_extraction(db, request, plan, user, found, provider, source, ai_status, ai_message, first, last)


@router.post("/{plan_id}/imports/extract/text", status_code=status.HTTP_201_CREATED)
def extract_from_text(plan_id: str, payload: ExtractTextRequest, request: Request, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    """貼り付けたメールの本文から候補を作る。AI は use_ai の時だけ(番号・氏名などを伏せて送る)。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    return _run_text(db, request, plan, current_user, payload.text, payload.use_ai, "text")


@router.post("/{plan_id}/imports/extract/file", status_code=status.HTTP_201_CREATED)
async def extract_from_file(plan_id: str, request: Request, file: UploadFile = File(...), use_ai: bool = Form(False),
                            ai_consent: bool = Form(False), db: Session = Depends(get_db),
                            current_user: User = Depends(get_current_user_or_guest)):
    """.eml または画像から候補を作る。画像はまずサーバーの中で文字を読み(OCR・無料・外部へ送らない)、
    同意がある時だけ、足りない項目を AI で補う。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    content = await file.read(rx.MAX_IMAGE_BYTES + 1)
    name = (file.filename or "").lower()
    try:
        if name.endswith((".eml", ".txt")):
            text = content.decode("utf-8", "replace") if name.endswith(".txt") else rx.parse_eml(content)
            return _run_text(db, request, plan, current_user, text[:rx.MAX_TEXT_CHARS], use_ai, "eml")
        image = rx.prepare_image(content)
    except rx.ExtractInputError as error:
        raise _extract_error(error.code, str(error), 413 if error.code == "file_too_large" else 422)
    first, last, zone = _plan_dates(db, plan)
    ocr_text = await run_in_threadpool(rx.ocr_image, content)
    found = rx.rule_extract(ocr_text, zone, first.year if first else None) if ocr_text else rx.Extraction()
    provider, ai_status, ai_message = ("ocr" if found.candidates else "none"), "off", None
    if ai_consent and not rx.CORE_FIELDS <= found.fields():
        ai_status, ai_message = _ai_fill(db, plan, current_user, found, zone, text="", image=image, masked=None,
                                         source="画像")
        if ai_status == "used":
            provider = "ocr+openai"
    elif ai_consent:
        ai_status = "not_needed"
    if not found.candidates:
        if not rx.ocr_available() and not ai_consent:
            raise _extract_error("ocr_unavailable", "このサーバーでは画像の文字を読めません(OCR が未導入)。"
                                 "配備をやり直すか、本文を貼り付けてください", 503)
        raise _extract_error("nothing_extracted", ai_message or "画像から予約の項目を読み取れませんでした。"
                             "文字がはっきり写った画像を使うか、本文を貼り付けてください")
    return _save_extraction(db, request, plan, current_user, found, provider, "image", ai_status, ai_message, first,
                            last)


class ApplyExtractionRequest(BaseModel):
    fields: Dict[str, Optional[str]]
    add_to_itinerary: bool = False


_EVENT_TYPE_OF = {"accommodation": "accommodation", "flight": "transport", "train": "transport", "bus": "transport",
                  "ferry": "transport", "rental_car": "transport", "restaurant": "meal"}


@router.post("/{plan_id}/imports/{job_id}/apply")
def apply_extraction(plan_id: str, job_id: str, payload: ApplyExtractionRequest, request: Request,
                     db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    """確認フォームの内容で予約を登録する。空にした項目は使わない。求められた時は旅程にも予定を足す。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    j = _get_job_or_404(db, plan.id, job_id)
    _require_review_required(j)
    rows = db.query(ExtractionCandidate).filter(ExtractionCandidate.import_job_id == j.id).all()
    existing = {c.field_path: c for c in rows}
    for path in payload.fields:
        if path not in _VALID_RESERVATION_FIELD_PATHS:
            raise _extract_error("invalid_field", "対応していない項目があります")
    try:
        for path, row in existing.items():
            if path not in payload.fields:
                row.review_status = ExtractionCandidateReviewStatus.REJECTED.value
        for path, raw in payload.fields.items():
            value = (raw or "").strip()
            current = existing.get(path)
            if not value:
                if current is not None:
                    current.review_status = ExtractionCandidateReviewStatus.REJECTED.value
                continue
            _coerce_reservation_field(path, value)  # 形が合わなければ 422
            cipher = encrypt_payload(value.encode("utf-8"), plan_subject(plan.id))
            if current is None:
                db.add(ExtractionCandidate(import_job_id=j.id, field_path=path, candidate_value_ciphertext=cipher,
                                           confidence=1.0, evidence_locator="利用者が入力",
                                           review_status=ExtractionCandidateReviewStatus.ACCEPTED.value))
            else:
                current.candidate_value_ciphertext = cipher
                current.review_status = ExtractionCandidateReviewStatus.ACCEPTED.value
    except EncryptionNotConfigured:
        db.rollback()
        raise _extract_error("encryption_not_configured", "候補の暗号化が設定されていません(サーバー側の設定)", 503)
    db.commit()
    job = confirm_import_job(plan_id, job_id, request, db, current_user)
    reservation = db.get(Reservation, uuid.UUID(job.result_reservation_id or ""))
    assert reservation is not None  # confirm が作った直後の行
    event_id, itinerary_note = None, None
    if payload.add_to_itinerary:
        event_id, itinerary_note = _add_reservation_event(db, plan, current_user, reservation)
    return {"job": job.model_dump(mode="json"), "reservation_id": str(reservation.id), "event_id": event_id,
            "itinerary_note": itinerary_note}


def _add_reservation_event(db: Session, plan, user: User, reservation: Reservation) -> Any:
    """予約の開始日の旅程へ予定を足して紐付ける。その日が旅程に無ければ足さずに理由を返す。"""
    from app.api.v1.plans import _event_to_dict, _record_change_and_bump_revision

    if reservation.start_at is None:
        return None, "開始日が無いので旅程には入れていません"
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()
    day = None
    for candidate in days:
        local = reservation.start_at.astimezone(rx._zone(candidate.timezone_id or "Asia/Tokyo"))
        if local.date() == candidate.local_date:
            day, moment = candidate, local
            break
    if day is None:
        return None, "開始日が旅程の日程にないので、旅程には入れていません。日程を変えるか、旅程から追加してください"
    count = db.query(TravelEvent).filter(TravelEvent.day_id == day.id).count()
    has_time = moment.hour != 0 or moment.minute != 0
    event = TravelEvent(plan_id=plan.id, day_id=day.id, title=reservation.provider_name or "予約",
                        event_type=_EVENT_TYPE_OF.get(reservation.type, "activity"),
                        local_start_time=moment.strftime("%H:%M") if has_time else None, sort_order=count)
    db.add(event)
    db.flush()
    reservation.event_id = event.id
    db.add(EventReservation(event_id=event.id, reservation_id=reservation.id, relation_type="primary"))
    db.flush()
    _record_change_and_bump_revision(db, plan, user, "manual", "travel_event", event.id, "create", None,
                                     _event_to_dict(event))
    db.commit()
    return str(event.id), None


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
    usage.charge(db, "user", plan.user_id, "imports")  # [Gate G5] BILL-02
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
        ciphertext = encrypt_payload(payload.value.encode("utf-8"), plan_subject(plan.id))
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

def _notes_with_details(fields: Dict[str, Any]) -> Optional[str]:
    """[Gate BookingFix] 部屋・食事・プランなどはメモの先頭に項目ごとの行で残す(予約の画面で読める)。"""
    lines = [f"{label}: {fields[f'detail.{key}']}" for key, label in rx.DETAIL_LABELS.items()
             if fields.get(f"detail.{key}")]
    if fields.get("notes"):
        lines.append(str(fields["notes"]))
    return "\n".join(lines) or None


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
        guest_count=fields.get("guest_count"),
        start_at=fields.get("start_at"),
        end_at=fields.get("end_at"),
        timezone_id=fields.get("timezone_id"),
        total_amount=fields.get("total_amount"),
        currency=fields.get("currency"),
        payment_status=fields.get("payment_status"),
        cancellation_deadline=fields.get("cancellation_deadline"),
        contact_url=fields.get("contact_url"),
        notes=_notes_with_details(fields),
    )

    # [Gate R3-8] holder_name/contact_phoneは暗号化列のみへ書き込む。
    if fields.get("holder_name"):
        try:
            r.holder_name_ciphertext = encrypt_payload(str(fields["holder_name"]).encode("utf-8"),
                                                       plan_subject(plan.id))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="名義の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )

    if fields.get("contact_phone"):
        try:
            r.contact_phone_ciphertext = encrypt_payload(str(fields["contact_phone"]).encode("utf-8"),
                                                         plan_subject(plan.id))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="連絡先電話番号の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )

    if "confirmation_number" in fields:
        try:
            r.confirmation_number_ciphertext = encrypt_payload(str(fields["confirmation_number"]).encode("utf-8"),
                                                               plan_subject(plan.id))
        except EncryptionNotConfigured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="予約番号の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
            )
        raw = str(fields["confirmation_number"]).strip()
        r.confirmation_number_masked = ("*" * max(len(raw) - 4, 0)) + raw[-4:] if len(raw) > 4 else "*" * len(raw)

    if "pin" in fields:
        try:
            r.pin_ciphertext = encrypt_payload(str(fields["pin"]).encode("utf-8"), plan_subject(plan.id))
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
