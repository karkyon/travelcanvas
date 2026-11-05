"""[Gate PhotoQR] QR コードから写真を投稿する。

- QR の URL(/u/<token>)だけでは投稿できない。旅行の編集者以上の会員としてログインするか(join)、
  発行した本人の PC に出た 6 桁の確認コードを入れる(session)。トークンとコードの本体は保存しない。
- 確認コードで受け取る権限は、この QR の投稿 API にしか通らない(通常のログインにならない)。
- 保存は旅行の画面と同じ処理(形式・ウイルス・撮影情報の除去・暗号化・件数の上限)を通す。
- ログインしていない人に見せるのは旅行名と有効かどうかだけ。監査に座標・ファイル名を残さない。
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.v1.memories import handle_upload
from app.core.auth import get_current_active_user, get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.utils.rate_limiter import check_rate_limit
from app.models.models import Notification, PhotoUploadLink, PhotoUploadSession, TravelDay, TravelPlan, User
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["photo-upload"])
public_router = APIRouter(prefix="/public/upload-links", tags=["public"])

PUBLIC_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer"}
MAX_DAYS = 30
MIN_AFTER_TODAY = timedelta(days=7)
SESSION_HOURS = 12
MAX_CODE_FAILURES = 5
MAX_UPLOADS_PER_LINK = 1000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message}, headers=PUBLIC_HEADERS)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _active(link: PhotoUploadLink) -> bool:
    return link.revoked_at is None and _aware(link.expires_at) > _now()


def _default_expiry(db: Session, plan: TravelPlan) -> datetime:
    """既定は旅行の最終日の翌日の終わりまで。旅行が終わった後の投稿は、発行から 7 日。最長 30 日。"""
    days = [d.local_date for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all() if d.local_date]
    now = _now()
    latest = now + MIN_AFTER_TODAY
    if days:
        last = max(days) + timedelta(days=2)
        end = datetime(last.year, last.month, last.day, tzinfo=timezone.utc)
        latest = max(end, latest)
    return min(latest, now + timedelta(days=MAX_DAYS))


def _link_dict(link: PhotoUploadLink) -> Dict[str, Any]:
    return {"id": str(link.id), "plan_id": str(link.plan_id), "expires_at": _iso(_aware(link.expires_at)),
            "revoked_at": _iso(link.revoked_at), "revoked_reason": link.revoked_reason, "active": _active(link),
            "upload_count": link.upload_count, "last_used_at": _iso(link.last_used_at),
            "created_at": _iso(link.created_at)}


def _audit(action: str, user_id: Any, link: PhotoUploadLink, details: Optional[Dict[str, Any]] = None) -> None:
    record_audit_event(action=action, resource_type="photo_upload_link", user_id=user_id, resource_id=link.id,
                       details={"plan_id": str(link.plan_id), **(details or {})})


class LinkCreate(BaseModel):
    expires_in_days: Optional[int] = Field(None, ge=1, le=MAX_DAYS)


@router.post("/{plan_id}/upload-links", status_code=201)
def create_link(plan_id: str, body: LinkCreate, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    """QR を発行する。トークンと確認コードはこの応答でだけ返す。同じ人の以前の QR は止める。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    now = _now()
    db.query(PhotoUploadLink).filter(PhotoUploadLink.plan_id == plan.id,
                                     PhotoUploadLink.created_by_user_id == current_user.id,
                                     PhotoUploadLink.revoked_at.is_(None)).update(
        {"revoked_at": now, "revoked_reason": "replaced"}, synchronize_session=False)
    token = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = now + timedelta(days=body.expires_in_days) if body.expires_in_days else _default_expiry(db, plan)
    link = PhotoUploadLink(id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id,
                           token_hash=_hash(token), code_hash=_hash(f"{token}:{code}"), expires_at=expires)
    db.add(link)
    db.commit()
    db.refresh(link)
    _audit("photo_upload_link.create", current_user.id, link)
    return {**_link_dict(link), "token": token, "code": code}


@router.get("/{plan_id}/upload-links")
def list_links(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    rows = db.query(PhotoUploadLink).filter(PhotoUploadLink.plan_id == plan.id,
                                            PhotoUploadLink.created_by_user_id == current_user.id,
                                            PhotoUploadLink.revoked_at.is_(None)).all()
    return {"links": [_link_dict(r) for r in rows if _active(r)]}


@router.delete("/{plan_id}/upload-links/{link_id}", status_code=204)
def revoke_link(plan_id: str, link_id: str, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    try:
        lid = uuid.UUID(link_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="QR が見つかりません")
    link = db.query(PhotoUploadLink).filter(PhotoUploadLink.id == lid, PhotoUploadLink.plan_id == plan.id,
                                            PhotoUploadLink.created_by_user_id == current_user.id).first()
    if link is None:
        raise HTTPException(status_code=404, detail="QR が見つかりません")
    if link.revoked_at is None:
        link.revoked_at, link.revoked_reason = _now(), "stopped"
        db.commit()
        _audit("photo_upload_link.revoke", current_user.id, link)
    return Response(status_code=204)


# ===================================================================== 投稿ページ

def _rate(request: Request, name: str, limit: int) -> None:
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"photo_upload_{name}:{ip}", limit, 60):
        raise _bad("rate_limited", "アクセスが多すぎます。しばらく待ってください", 429)


def _find(db: Session, token: str) -> PhotoUploadLink:
    link = None
    if token and len(token) <= 100:
        link = db.query(PhotoUploadLink).filter(PhotoUploadLink.token_hash == _hash(token)).first()
    if link is None:
        raise _bad("link_not_found", "この QR コードは見つかりません", 404)
    return link


def _require_active(link: PhotoUploadLink) -> None:
    if not _active(link):
        raise _bad("link_inactive", "この QR コードは期限が切れたか、停止されています。新しい QR を発行してもらってください", 410)


def _plan_of(db: Session, link: PhotoUploadLink) -> TravelPlan:
    plan = db.query(TravelPlan).filter(TravelPlan.id == link.plan_id, TravelPlan.deleted_at.is_(None)).first()
    if plan is None:
        raise _bad("link_not_found", "この QR コードは見つかりません", 404)
    return plan


@public_router.get("/{token}")
def view_link(token: str, request: Request, response: Response, db: Session = Depends(get_db)):
    """ログイン前に見せるのは旅行名と有効かどうかだけ。"""
    _rate(request, "view", 60)
    link = _find(db, token)
    plan = _plan_of(db, link)
    response.headers.update(PUBLIC_HEADERS)
    return {"plan_title": plan.title, "active": _active(link), "expires_at": _iso(_aware(link.expires_at)),
            "max_upload_bytes": settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES}


@public_router.post("/{token}/join")
def join_link(token: str, request: Request, response: Response, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_active_user)):
    """ログイン済みの会員が投稿する先の旅行を受け取る。旅行の編集者以上でなければ断る(通常の権限のまま)。"""
    _rate(request, "join", 30)
    link = _find(db, token)
    _require_active(link)
    plan, role = require_plan_access(db, str(link.plan_id), current_user, min_role="editor")
    link.last_used_at = _now()
    db.commit()
    response.headers.update(PUBLIC_HEADERS)
    return {"plan_id": str(plan.id), "plan_title": plan.title, "role": role}


class SessionCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=12)


@public_router.post("/{token}/session")
def open_session(token: str, body: SessionCreate, request: Request, response: Response,
                 db: Session = Depends(get_db)):
    """確認コードで、この QR への投稿だけの権限を発行する。5 回間違えると QR を止めて発行した人へ知らせる。"""
    _rate(request, "session", 20)
    link = _find(db, token)
    _require_active(link)
    code = "".join(ch for ch in body.code if ch.isdigit())
    if not hmac.compare_digest(_hash(f"{token}:{code}"), link.code_hash):
        # 同時の要求でも数え落とさないよう、DB の値で増やす
        link.failed_attempts = PhotoUploadLink.failed_attempts + 1
        db.commit()
        db.refresh(link)
        if link.failed_attempts >= MAX_CODE_FAILURES:
            link.revoked_at, link.revoked_reason = _now(), "code_failures"
            db.add(Notification(user_id=link.created_by_user_id, type="photo_upload_link_stopped",
                                title="写真投稿の QR を止めました",
                                message="確認コードを何度も間違えたため、安全のため QR を止めました。必要なら発行し直してください。",
                                related_plan_id=link.plan_id))
            db.commit()
            _audit("photo_upload_link.locked", link.created_by_user_id, link)
            raise _bad("link_inactive", "確認コードを何度も間違えたため、この QR を止めました", 410)
        raise _bad("invalid_code", "確認コードが違います")
    expires = min(_now() + timedelta(hours=SESSION_HOURS), _aware(link.expires_at))
    session_token = secrets.token_urlsafe(32)
    db.add(PhotoUploadSession(id=uuid.uuid4(), link_id=link.id, token_hash=_hash(session_token), expires_at=expires))
    link.failed_attempts, link.last_used_at = 0, _now()
    db.commit()
    _audit("photo_upload_link.session", link.created_by_user_id, link)
    response.headers.update(PUBLIC_HEADERS)
    return {"session_token": session_token, "expires_at": _iso(expires)}


@public_router.post("/{token}/upload", status_code=201)
async def upload_with_session(
    token: str,
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    occurred_at: Optional[datetime] = Form(None),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    location_source: Optional[str] = Form(None),
    visibility: str = Form("private"),
    client_upload_id: Optional[str] = Form(None),
    x_upload_session: Optional[str] = Header(None, alias="X-Upload-Session"),
    db: Session = Depends(get_db),
):
    """確認コードで開いた端末からの写真の投稿。記録は QR を発行した本人のものになる。"""
    _rate(request, "upload", 120)
    link = _find(db, token)
    _require_active(link)
    session = None
    if x_upload_session and len(x_upload_session) <= 100:
        session = db.query(PhotoUploadSession).filter(PhotoUploadSession.link_id == link.id,
                                                      PhotoUploadSession.token_hash == _hash(x_upload_session)).first()
    if session is None or _aware(session.expires_at) <= _now():
        raise _bad("session_required", "確認コードをもう一度入れてください", 401)
    if link.upload_count >= MAX_UPLOADS_PER_LINK:
        raise _bad("too_many_uploads", "この QR で投稿できる枚数の上限です。新しい QR を発行してください", 429)
    owner = db.query(User).filter(User.id == link.created_by_user_id, User.is_active.is_(True)).first()
    if owner is None:
        raise _bad("link_inactive", "この QR コードは使えません", 410)
    # 発行した人が旅行の権限を失っていれば投稿できない
    plan, _role = require_plan_access(db, str(link.plan_id), owner, min_role="editor")
    result = await handle_upload(request, db, plan, owner, file, "photo", None, None, None, occurred_at, None,
                                 latitude, longitude, visibility, True, location_source, client_upload_id)
    link.upload_count, link.last_used_at = PhotoUploadLink.upload_count + 1, _now()
    db.commit()
    response.headers.update(PUBLIC_HEADERS)
    return {"id": result["id"], "location_status": result["location_status"],
            "location_source": result["location_source"], "place_name": result["place_name"]}
