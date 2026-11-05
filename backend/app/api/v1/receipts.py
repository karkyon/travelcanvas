"""[Gate Receipt] レシートの読み取り。POST /plans/{plan_id}/expenses/extract-receipt

画像から支出の候補を返すだけで、何も保存しない(登録は確かめた後に POST /expenses)。
権限は支出の登録と同じ(editor・費用を隠された参加者は 403)。監査には読めた項目の名前だけを残す。
AI は同意がある時だけ、OCR で足りない時だけ呼ぶ(FR-059 の ai.generate の枠)。"""
import logging
import uuid
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.api.v1 import finance as fin
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import TravelDay, User
from app.services import cost_guard as cg
from app.services import provider_calls
from app.services import provider_secrets as ps
from app.services import receipt_extract as rc
from app.services import reservation_extract as rx
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/plans", tags=["finance"])

RATE_LIMIT = 30
RATE_WINDOW = 600


def _error(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _ai(db: Session, plan: Any, user: User, found: Dict[str, rc.Found], image: bytes) -> Any:
    try:
        payload, _usage = provider_calls.ai_extract_receipt(db, plan, user, rc.INSTRUCTIONS, rc.ai_schema(), image,
                                                            str(uuid.uuid4()))
    except cg.CostGuardError as error:
        return "denied", error.message
    except ps.SecretUnavailable:
        return "denied", "AI の鍵の確認が切れているか未設定のため、AI は使いませんでした。管理画面の鍵の確認で直せます"
    except provider_calls.ProviderRejected:
        return "denied", "AI の提供元が要求を受け付けませんでした(鍵・権限・残高)。AI は使いませんでした"
    except Exception:  # noqa: BLE001 - AI の失敗で読み取り全体を失わない(画像の内容はログに残さない)
        logger.exception("レシートの読み取りの AI の呼び出しに失敗しました")
        if not db.is_active:
            db.rollback()
        return "denied", "AI の呼び出しに失敗したため、AI は使いませんでした"
    return "used", None if rc.merge_ai(found, payload["text"]) else "AI でも足りない項目を読み取れませんでした"


@router.post("/{plan_id}/expenses/extract-receipt", response_model=dict)
async def extract_receipt(plan_id: str, request: Request, file: UploadFile = File(...), ai_consent: bool = Form(False),
                          db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = fin.require_plan_access(db, plan_id, current_user, min_role="editor")
    if not check_rate_limit(f"receipt:{current_user.id}", RATE_LIMIT, RATE_WINDOW):
        raise _error("too_many_requests", "読み取りの回数が多すぎます。しばらく待ってください", 429)
    content = await file.read(rx.MAX_IMAGE_BYTES + 1)
    try:
        image = rx.prepare_image(content)
    except rx.ExtractInputError as error:
        raise _error(error.code, str(error), 413 if error.code == "file_too_large" else 422)
    days: List[date] = [d.local_date for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
                        .order_by(TravelDay.local_date).all() if d.local_date]
    first, last = (days[0], days[-1]) if days else (None, None)
    text = await run_in_threadpool(rx.ocr_image, content, "jpn+eng")
    found = rc.rule_extract(text, first.year if first else None) if text else {}
    ai_status: str = "off"
    ai_message: Optional[str] = None
    if ai_consent:
        if rc.needs_ai(found):
            ai_status, ai_message = _ai(db, plan, current_user, found, image)
        else:
            ai_status = "not_needed"
    if not found:
        if not rx.ocr_available() and not ai_consent:
            raise _error("ocr_unavailable", "このサーバーでは画像の文字を読めません(OCR が未導入)。手で入力してください", 503)
        raise _error("nothing_extracted", ai_message or "レシートの文字を読み取れませんでした。"
                     "明るい場所で、レシート全体がまっすぐ写るように撮り直すか、AI の読み取りを選んでください")
    base = fin._base_currency(db, plan)
    record_audit_event(action="receipt_extracted", resource_type="plan", user_id=current_user.id, resource_id=plan.id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255],
                       details={"plan_id": str(plan.id), "fields": sorted(found), "ai": ai_status})
    return {
        "fields": {k: {"value": v.value, "confidence": v.confidence, "evidence": v.evidence} for k, v in found.items()},
        "ai_status": ai_status, "ai_message": ai_message, "warnings": rc.warnings(found, first, last, base),
    }
