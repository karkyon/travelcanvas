"""[Gate Remaining-3] FR-011 予約メールの転送アドレス。

- GET    /plans/{plan_id}/inbound-mail  : 自分の転送用のアドレス(editor 以上)。設定が無い環境は configured=false
- POST   /plans/{plan_id}/inbound-mail  : アドレスを作る・作り直す(前のアドレスは使えなくなる)
- DELETE /plans/{plan_id}/inbound-mail  : アドレスを止める
- POST   /inbound-mail                  : 受信サービスからの転送(合言葉 X-TC-Inbound-Secret または ?secret=)。
                                          生のメール(message/rfc822 等の本文)か、multipart の email(SendGrid の raw)・
                                          body-mime(Mailgun)を受け付ける。読み取った候補は持ち主が画面で確かめて確定する

監査には件数だけを残す(本文・差出人・宛先は残さない)。
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import TravelPlan, User
from app.services import inbound_mail as im
from app.services import notify
from app.services import reservation_extract as rx
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(tags=["inbound-mail"])


def _audit(action: str, user_id: Any, plan_id: Any, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="plan", user_id=user_id, resource_id=plan_id,
                       details={"plan_id": str(plan_id), **details})


@router.get("/plans/{plan_id}/inbound-mail")
def get_address(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    return im.summary(db, im.active(db, plan.id, current_user.id))


@router.post("/plans/{plan_id}/inbound-mail")
def create_address(plan_id: str, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    if not im.configured():
        raise HTTPException(status_code=409, detail={
            "code": "inbound_mail_unavailable",
            "message": "この環境ではメールの転送を受け付けていません(管理者の設定が必要です)。本文の貼り付け・ファイルで取り込めます"})
    row, _token = im.create(db, plan.id, current_user.id)
    db.commit()
    _audit("inbound_mail.address_created", current_user.id, plan.id, {})
    return im.summary(db, row)


@router.delete("/plans/{plan_id}/inbound-mail")
def delete_address(plan_id: str, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    n = im.revoke(db, plan.id, current_user.id)
    db.commit()
    _audit("inbound_mail.address_revoked", current_user.id, plan.id, {"revoked": n})
    return im.summary(db, None)


async def _raw_mail(request: Request) -> tuple:
    """(生のメール, 受信サービスが教える宛先の一覧)"""
    ctype = (request.headers.get("content-type") or "").lower()
    extra: List[str] = []
    if ctype.startswith("multipart/form-data") or ctype.startswith("application/x-www-form-urlencoded"):
        form = await request.form()
        for key in ("to", "recipient", "envelope"):
            v = form.get(key)
            if isinstance(v, str):
                extra.append(v)
        for key in ("email", "body-mime", "message", "mime"):
            v = form.get(key)
            if v is None:
                continue
            data = await v.read() if hasattr(v, "read") else str(v).encode("utf-8", "replace")
            return data, extra
        return b"", extra
    return await request.body(), extra


@router.post("/inbound-mail")
async def receive(request: Request, db: Session = Depends(get_db)):
    secret = request.headers.get("x-tc-inbound-secret") or request.query_params.get("secret")
    if not im.configured():
        raise HTTPException(status_code=404, detail="Not Found")
    if not im.secret_ok(secret):
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "合言葉が違います"})
    raw, extra = await _raw_mail(request)
    if not raw:
        raise HTTPException(status_code=422, detail={"code": "no_mail", "message": "メールの本文がありません"})
    try:
        msg, rcpts = im.parse(raw)
    except (ValueError, TypeError, LookupError):
        raise HTTPException(status_code=422, detail={"code": "unreadable_mail", "message": "メールを読めませんでした"})
    tokens = im.tokens_in(rcpts + extra)
    results = {"matched": 0, "jobs": 0, "skipped": 0}
    for token in tokens[:5]:
        row = im.find(db, token)
        if row is None:
            results["skipped"] += 1
            continue
        results["matched"] += 1
        jobs = await _process(request, db, row, raw, msg)
        results["jobs"] += jobs
    return {"ok": True, **results}


async def _process(request: Request, db: Session, row: Any, raw: bytes, msg: Any) -> int:
    from app.api.v1 import imports as imports_api

    plan = db.query(TravelPlan).filter(TravelPlan.id == row.plan_id, TravelPlan.deleted_at.is_(None)).first()
    user = db.query(User).filter(User.id == row.user_id).first()
    if plan is None or user is None or not getattr(user, "is_active", True):
        return 0
    try:
        require_plan_access(db, str(plan.id), user, min_role="editor")
    except HTTPException:
        return 0
    if not check_rate_limit(f"inbound-mail:{row.id}", int(settings.INBOUND_MAIL_DAILY_LIMIT), 86400):
        _audit("inbound_mail.rate_limited", user.id, plan.id, {})
        return 0
    row.received_count = (row.received_count or 0) + 1
    row.last_received_at = datetime.now(timezone.utc)
    db.commit()
    texts: List[tuple] = []
    try:
        body = rx.parse_eml(raw) if len(raw) <= rx.MAX_EML_BYTES else _head_text(msg)
        texts.append((body, "mail"))
    except rx.ExtractInputError:
        pass
    if rx.pdf_available():
        for pdf in im.pdf_attachments(msg):
            try:
                text = await run_in_threadpool(rx.pdf_text, pdf)
            except Exception:  # noqa: BLE001 - 読めない PDF は飛ばす
                continue
            if text.strip():
                texts.append((text, "pdf"))
    jobs = 0
    found_fields = 0
    for text, source in texts:
        try:
            out = imports_api._run_text(db, request, plan, user, text[:rx.MAX_TEXT_CHARS], False, source)
        except HTTPException:
            db.rollback()
            continue
        jobs += int((out.get("split") or {}).get("count") or 1)  # [Gate Remaining-6] 1 通から複数の予約
        found_fields += len(out.get("candidates") or [])
    if jobs:
        title = "転送された予約のメールを読み取りました(%d 件)" % jobs
        message = "「%s」の取り込みの画面で、読み取った項目を確かめて確定してください(自動では予約を作りません)。" % plan.title
    else:
        title = "転送されたメールから予約を読み取れませんでした"
        message = "「%s」の取り込みの画面で、本文を貼り付けて読み取るか、項目を手で入れてください。" % plan.title
    notify.deliver(db, plan, [user.id], "booking_mail", title, message, target_type="plan", target_id=plan.id,
                   direct_ids=[user.id])
    db.commit()
    _audit("inbound_mail.received", user.id, plan.id, {"jobs": jobs, "fields": found_fields, "parts": len(texts)})
    return jobs


def _head_text(msg: Any) -> str:
    try:
        body = msg.get_body(preferencelist=("plain", "html"))
        text: Optional[str] = body.get_content() if body is not None else ""
        if body is not None and body.get_content_type() == "text/html":
            text = rx.html_to_text(text or "")
        return f"件名: {msg.get('subject', '')}\n差出人: {msg.get('from', '')}\n{text or ''}"
    except (ValueError, LookupError, UnicodeError, AttributeError, KeyError):
        raise rx.ExtractInputError("unreadable_mail", "メールを読めませんでした")
