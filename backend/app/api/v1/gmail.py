"""[Gate Remaining-7] FR-011 Gmail の連携(読み取りだけ・押した時だけ取り込む)。

- GET    /integrations/gmail            : 連携の状態(使えるか・つないでいるか・前に取り込んだ時)
- POST   /integrations/gmail/connect    : Google の許可の画面の URL(state は署名つき・10 分)
- GET    /integrations/gmail/callback   : Google から戻る先。許可を保存して設定の画面へ戻す
- POST   /integrations/gmail/sync       : 予約らしいメールを最大 20 通読み、旅行の予約の読み取り(候補)にする
- DELETE /integrations/gmail            : 連携を外す(Google へ取り消しを送り、許可を消す)

監査には件数だけを残す(メールの本文・件名・差出人は残さない)。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_active_user
from app.core.config import settings
from app.core.crypto import EncryptionNotConfigured
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import GmailConnection, User
from app.services import gmail_connector as gc
from app.services import inbound_mail as im
from app.services import notify
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/integrations/gmail", tags=["integrations"])


def _err(error: gc.GmailError) -> HTTPException:
    return HTTPException(status_code=error.status, detail={"code": error.code, "message": error.message})


def _row(db: Session, user: User) -> Optional[GmailConnection]:
    return db.query(GmailConnection).filter(GmailConnection.user_id == user.id).first()


def _front(path: str, **params: str) -> str:
    origins = list(getattr(settings, "cors_allowed_origins", None) or [])
    base = (origins[0] if origins else "").rstrip("/")
    return f"{base}{path}" + (f"?{urlencode(params)}" if params else "")


class ConnectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_id: Optional[str] = Field(None, max_length=40)


class SyncIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_id: str = Field(..., max_length=40)
    days: int = Field(gc.DEFAULT_DAYS, ge=1, le=180)


@router.get("")
def status(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return gc.summary(db, _row(db, current_user))


@router.post("/connect")
def connect(body: ConnectIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    if body.plan_id:
        require_plan_access(db, body.plan_id, current_user, min_role="editor")
    try:
        return {"authorize_url": gc.authorize_url(db, current_user.id, body.plan_id)}
    except gc.GmailError as error:
        raise _err(error)


@router.get("/callback")
def callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None,
             db: Session = Depends(get_db)):
    """Google の許可の画面から戻る先(ブラウザの移動。ログインの token は無いため state で利用者を確かめる)。"""
    try:
        data = gc.read_state(state or "")
    except gc.GmailError:
        return RedirectResponse(_front("/settings", gmail="invalid_state"), status_code=303)
    back = f"/planner/{data['p']}/imports" if data.get("p") else "/settings"
    if error or not code:
        return RedirectResponse(_front(back, gmail="denied"), status_code=303)
    user = db.query(User).filter(User.id == data["u"], User.is_active.is_(True)).first()
    if user is None:
        return RedirectResponse(_front("/settings", gmail="invalid_state"), status_code=303)
    try:
        gc.exchange_code(db, user.id, code[:2000])
        db.commit()
    except gc.GmailError as err:
        db.rollback()
        return RedirectResponse(_front(back, gmail=err.code), status_code=303)
    except EncryptionNotConfigured:
        db.rollback()
        return RedirectResponse(_front(back, gmail="encryption_not_configured"), status_code=303)
    record_audit_event(action="gmail.connected", resource_type="user", user_id=user.id, resource_id=user.id,
                       details={})
    return RedirectResponse(_front(back, gmail="connected"), status_code=303)


@router.post("/sync")
async def sync(body: SyncIn, request: Request, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_active_user)):
    from app.api.v1.inbound_mail import import_mail

    plan, _ = require_plan_access(db, body.plan_id, current_user, min_role="editor")
    row = _row(db, current_user)
    if row is None:
        raise HTTPException(status_code=409, detail={"code": "gmail_not_connected", "message": "Gmail とつないでいません"})
    if not check_rate_limit(f"gmail-sync:{current_user.id}", 10, 3600):
        raise HTTPException(status_code=429, detail={"code": "too_many_requests",
                                                     "message": "回数が多すぎます。しばらく待ってください"})
    try:
        messages = gc.fetch_new_messages(db, row, body.days)
    except gc.GmailError as error:
        db.commit()  # 失敗の理由(last_error)を残す
        raise _err(error)
    jobs = fields = 0
    read: list = []
    for mid, raw in messages:
        try:
            msg, _rcpts = im.parse(raw)
        except (ValueError, TypeError, LookupError):
            read.append(mid)
            continue
        j, f, _parts = await import_mail(request, db, plan, current_user, raw, msg)
        jobs += j
        fields += f
        read.append(mid)
    row = _row(db, current_user)
    assert row is not None
    gc.mark_seen(row, read)
    row.imported_count = (row.imported_count or 0) + jobs
    row.last_sync_at = datetime.now(timezone.utc)
    row.last_error = None
    if jobs:
        notify.deliver(db, plan, [current_user.id], "booking_mail", "Gmail から予約のメールを読み取りました(%d 件)" % jobs,
                       "「%s」の取り込みの画面で、読み取った項目を確かめて確定してください(自動では予約を作りません)。" % plan.title,
                       target_type="plan", target_id=plan.id, direct_ids=[current_user.id])
    db.commit()
    record_audit_event(action="gmail.synced", resource_type="plan", user_id=current_user.id, resource_id=plan.id,
                       details={"plan_id": str(plan.id), "messages": len(read), "jobs": jobs, "fields": fields})
    return {"messages": len(read), "jobs": jobs, "fields": fields, **gc.summary(db, row)}


@router.delete("")
def disconnect(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    row = _row(db, current_user)
    if row is not None:
        gc.revoke(db, row)
        db.delete(row)
        db.commit()
        record_audit_event(action="gmail.disconnected", resource_type="user", user_id=current_user.id,
                           resource_id=current_user.id, details={})
    return gc.summary(db, None)
