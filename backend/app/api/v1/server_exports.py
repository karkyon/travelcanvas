"""[Gate Remaining-5] サーバー側の PDF・画像(FR-035・FR-046)と、ほかのサイトへの埋め込み(FR-042)。

- GET /plans/{plan_id}/booklet-exports/{export_id}/pdf : しおりの版を PDF でダウンロード(版を見られる人。機密の版は作成者だけ)
- GET /public/booklets/{token}/pdf                    : 公開したしおりの版の PDF(機密の版は公開されない)
- GET /plans/{plan_id}/today/card.png                 : 旅の当日の NOW/NEXT のカードの画像(viewer 以上)
- GET /public/embed/{token}                           : 共有リンクの旅程を、ほかのサイトに埋め込む小さな HTML(スクリプトなし)。
                                                        所有者が共有の項目で「ほかのサイトへの埋め込み」を選び、合言葉・回数の
                                                        制限が無いリンクだけ。frame-ancestors は EMBED_ALLOWED_ORIGINS(空なら *)
- GET /public/embed.js                                : <div data-travelcanvas-embed="…"> を iframe にする部品
- GET/POST/DELETE /plans/{plan_id}/calendar-feed      : カレンダーの購読の URL(FR-036。外のカレンダーが自動で追う。webcal)
- GET /public/calendar/{token}.ics                    : 購読の中身(作った人に見える予定。住所は入れない)
- POST /plans/{plan_id}/memories/publications/face-check : 公開する自分の写真の顔の検査(FR-037。鍵 google_vision_key がある時だけ)
生成は監査に残す(種類・ページ数・大きさだけ)。
"""
import base64
import html
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1 import booklet as booklet_api
from app.api.v1 import public_share as ps_api
from app.core.auth import get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.models.models import TravelPlan, User
from app.services import face_check
from app.services import server_render as sr
from app.services import share_policy
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(tags=["server-exports"])


def _font_error() -> HTTPException:
    return HTTPException(status_code=503, detail={
        "code": "font_unavailable", "message": "この環境には日本語の字体が無いため、PDF・画像を作れません(管理者の設定が必要です)"})


def _filename(title: str, ext: str) -> str:
    safe = "".join(ch for ch in title if ch not in '\\/:*?"<>|\r\n')[:60] or "travelcanvas"
    return f"attachment; filename=\"travelcanvas.{ext}\"; filename*=UTF-8''{quote(safe + '.' + ext)}"


def _pdf_response(data: bytes, title: str) -> Response:
    return Response(content=data, media_type="application/pdf", headers={
        "Content-Disposition": _filename(title, "pdf"), "Cache-Control": "no-store"})


@router.get("/plans/{plan_id}/booklet-exports/{export_id}/pdf")
def booklet_pdf(plan_id: str, export_id: str, request: Request, response: Response, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    body = booklet_api.get_export(plan_id, export_id, request, response, db, current_user)
    snapshot = body["booklet"]
    try:
        data, pages = sr.booklet_pdf(snapshot)
    except sr.FontUnavailable:
        raise _font_error()
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "too_many_pages", "message": "長すぎて PDF にできません"})
    record_audit_event(action="booklet_pdf_generated", resource_type="booklet_export", user_id=current_user.id,
                       resource_id=body["export"]["id"], details={"plan_id": plan_id, "pages": pages,
                                                                  "bytes": len(data)})
    title = str((snapshot.get("cover") or {}).get("title") or "しおり")
    return _pdf_response(data, title)


@router.get("/public/booklets/{token}/pdf")
def public_booklet_pdf(token: str, request: Request, response: Response, db: Session = Depends(get_db)):
    body = booklet_api.view_public_booklet(token, request, response, db)
    try:
        data, pages = sr.booklet_pdf(body["booklet"])
    except sr.FontUnavailable:
        raise _font_error()
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "too_many_pages", "message": "長すぎて PDF にできません"})
    title = str((body["booklet"].get("cover") or {}).get("title") or "しおり")
    out = _pdf_response(data, title)
    out.headers.update(booklet_api.PUBLIC_HEADERS)
    return out


@router.get("/plans/{plan_id}/today/card.png")
async def today_card(plan_id: str, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)):
    from app.api.v1.plans import get_today

    today = await get_today(plan_id, current_user, db)
    plan = db.query(TravelPlan).filter(TravelPlan.id == today.plan_id).first()

    def item(ev: Any) -> Optional[Dict[str, Any]]:
        if ev is None:
            return None
        return {"title": ev.title, "time": ev.local_start_time, "place": ev.address}

    try:
        data = sr.now_next_png(plan.title if plan else "旅行", item(today.now_event), item(today.next_event),
                               today.today_date.isoformat() if today.today_date else None)
    except sr.FontUnavailable:
        raise _font_error()
    record_audit_event(action="today_card_generated", resource_type="plan", user_id=current_user.id,
                       resource_id=today.plan_id, details={"bytes": len(data)})
    return Response(content=data, media_type="image/png", headers={
        "Content-Disposition": _filename(plan.title if plan else "today", "png"), "Cache-Control": "no-store"})


# ===================================================================== 埋め込み(FR-042)

EMBED_FIELD = "embed"


def _frame_ancestors() -> str:
    raw = (getattr(settings, "EMBED_ALLOWED_ORIGINS", "") or "").strip()
    if not raw:
        return "*"
    parts = [p.strip() for p in raw.split(",") if p.strip().startswith("https://")]
    return " ".join(parts) or "'none'"


def _embed_headers() -> Dict[str, str]:
    return {
        "Content-Security-Policy": (f"default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; "
                                    f"frame-ancestors {_frame_ancestors()}; base-uri 'none'; form-action 'none'"),
        # frame-ancestors が X-Frame-Options より優先される(既定の DENY を付けさせない)
        "X-Frame-Options": "ALLOWALL",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
    }


def _embed_page(view: Dict[str, Any]) -> str:
    e = html.escape
    rows = []
    for d in view.get("days") or []:
        rows.append(f"<h2>{e(str(d.get('local_date') or ''))} {e(str(d.get('title') or ''))}</h2><ul>")
        for ev in d.get("events") or []:
            t = "終日" if ev.get("is_all_day") else (ev.get("local_start_time") or "")
            rows.append(f"<li><span class='t'>{e(str(t))}</span> {e(str(ev.get('title') or ''))}</li>")
        rows.append("</ul>")
    span = " 〜 ".join(x for x in (view.get("start_date"), view.get("end_date")) if x)
    return ("<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>{e(str(view.get('title') or '旅程'))}</title><style>"
            "body{font-family:system-ui,'Hiragino Sans','Noto Sans JP',sans-serif;margin:0;padding:16px;color:#18202f;"
            "background:#fff}h1{font-size:20px;margin:0 0 4px;color:#1e40af}p.m{margin:0 0 12px;color:#5a6478;"
            "font-size:13px}h2{font-size:15px;margin:14px 0 6px;border-top:1px solid #e2e6ee;padding-top:10px}"
            "ul{list-style:none;margin:0;padding:0}li{padding:3px 0;font-size:14px}.t{display:inline-block;"
            "min-width:3.5em;color:#5a6478}footer{margin-top:14px;font-size:11px;color:#8a93a6}</style></head><body>"
            f"<h1>{e(str(view.get('title') or ''))}</h1>"
            f"<p class='m'>{e(' ・ '.join(x for x in (view.get('destination'), span) if x))}</p>"
            + "".join(rows) +
            "<footer>TravelCanvas の共有の旅程(読むだけ)</footer></body></html>")


@router.get("/public/embed/{token}")
def embed(token: str, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"public_embed:{ip}", 120, 60):
        raise HTTPException(status_code=429, detail="アクセスが多すぎます", headers=ps_api.PUBLIC_HEADERS)
    if not token or len(token) > 200:
        raise HTTPException(status_code=404, detail="Not Found")
    share = ps_api._active_share(db, token)
    if (share is None or share.passcode_hash or share.max_uses is not None
            or EMBED_FIELD not in share_policy.fields_of(share.policy) or share.permission != "view"):
        raise HTTPException(status_code=404, detail="埋め込みできる共有ではありません")
    plan = db.query(TravelPlan).filter(TravelPlan.id == share.plan_id, TravelPlan.deleted_at.is_(None)).first()
    if plan is None:
        raise HTTPException(status_code=404, detail="Not Found")
    view = ps_api.build_public_view(db, plan, share_policy.fields_of(share.policy), share.permission)
    return Response(content=_embed_page(view), media_type="text/html; charset=utf-8", headers=_embed_headers())


EMBED_JS = """(function(){
  var s=document.currentScript; var base=(s&&s.src)?s.src.replace(/\\/embed\\.js.*$/,''):'';
  var els=document.querySelectorAll('[data-travelcanvas-embed]');
  for(var i=0;i<els.length;i++){var el=els[i]; if(el.getAttribute('data-tc-done'))continue;
    var t=el.getAttribute('data-travelcanvas-embed'); if(!/^[A-Za-z0-9_-]{8,200}$/.test(t))continue;
    var f=document.createElement('iframe'); f.src=base+'/embed/'+encodeURIComponent(t);
    f.title=el.getAttribute('data-title')||'旅程'; f.loading='lazy'; f.referrerPolicy='no-referrer';
    f.setAttribute('sandbox',''); f.style.width='100%'; f.style.border='1px solid #e2e6ee';
    f.style.borderRadius='8px'; f.style.height=(el.getAttribute('data-height')||'480')+'px';
    el.appendChild(f); el.setAttribute('data-tc-done','1');}
})();
"""


@router.get("/public/embed.js")
def embed_js():
    return Response(content=EMBED_JS, media_type="application/javascript; charset=utf-8", headers={
        "Cache-Control": "public, max-age=3600", "Cross-Origin-Resource-Policy": "cross-origin",
        "Content-Security-Policy": "default-src 'none'"})


# ===================================================================== 顔の検査(FR-037。鍵がある時だけ)

class FaceCheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    photo_ids: List[str] = Field(..., min_length=1, max_length=face_check.MAX_PHOTOS)


@router.post("/plans/{plan_id}/memories/publications/face-check")
def publication_face_check(plan_id: str, body: FaceCheckIn, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user_or_guest)):
    """公開しようとしている自分の写真に顔が写っているかを Google Cloud Vision で確かめる(押した時だけ・鍵がある時だけ)"""
    from app.core.plan_access import require_plan_access
    from app.models.models import Memory
    from app.services.storage_backend import get_storage_backend, load_decrypted_file

    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if not face_check.configured(db):
        return {"configured": False, "results": [], "source": "Google Cloud Vision",
                "message": "顔の自動の判定の提供元が未設定です。写っている人の了解を確かめてください"}
    ids = []
    for x in body.photo_ids:
        try:
            ids.append(uuid.UUID(x))
        except ValueError:
            continue
    rows = db.query(Memory).filter(Memory.plan_id == plan.id, Memory.id.in_(ids), Memory.kind == "photo",
                                   Memory.author_user_id == current_user.id).all()
    backend = get_storage_backend()
    blobs, keep = [], []
    for m in rows:
        if not m.storage_key:
            continue
        try:
            blobs.append(load_decrypted_file(backend, m.storage_key))
            keep.append(m)
        except Exception:  # noqa: BLE001 - 読めない写真は飛ばす
            continue
    try:
        counts = face_check.count_faces(db, blobs)
    except ValueError:
        raise HTTPException(status_code=503, detail={"code": "face_check_failed",
                                                     "message": "顔の判定を取れませんでした。写っている人の了解を確かめてください"})
    results: List[Dict[str, Any]] = [{"memory_id": str(m.id), "faces": int(c)} for m, c in zip(keep, counts)]
    record_audit_event(action="face_check", resource_type="plan", user_id=current_user.id, resource_id=plan.id,
                       details={"photos": len(results), "with_faces": sum(1 for c in counts if c > 0)})
    with_faces = sum(1 for c in counts if c > 0)
    return {"configured": True, "results": results, "source": "Google Cloud Vision",
            "message": (f"{len(results)} 枚のうち {with_faces} 枚に顔が写っています(自動の判定。見落としがあります)"
                        if results else "確かめられる写真がありませんでした")}


# ===================================================================== カレンダーの購読(FR-036。外のカレンダーが自動で追う)

FEED_KEY = "calendar_feed"


def _feed_hash(token: str) -> str:
    import hashlib

    return hashlib.sha256(("tc-calfeed:" + token).encode()).hexdigest()


def _feed_state(plan: TravelPlan) -> Optional[Dict[str, Any]]:
    prefs = plan.preferences if isinstance(plan.preferences, dict) else {}
    feed = prefs.get(FEED_KEY)
    return feed if isinstance(feed, dict) and feed.get("token_hash") else None


def _feed_view(request: Request, plan: TravelPlan, token: Optional[str]) -> Dict[str, Any]:
    feed = _feed_state(plan)
    if feed is None:
        return {"enabled": False, "url": None, "webcal_url": None}
    if token is None:
        from app.core.crypto import decrypt_payload as _dec

        try:
            token = _dec(base64.b64decode(feed["token_ct"])).decode()
        except Exception:  # noqa: BLE001 - 鍵の破棄など。作り直してもらう
            return {"enabled": True, "url": None, "webcal_url": None, "created_at": feed.get("created_at")}
    base = str(request.base_url).rstrip("/")
    url = f"{base}/api/v1/public/calendar/{token}.ics"
    return {"enabled": True, "url": url, "webcal_url": "webcal://" + url.split("://", 1)[1],
            "created_at": feed.get("created_at")}


@router.get("/plans/{plan_id}/calendar-feed")
def get_calendar_feed(plan_id: str, request: Request, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    from app.core.plan_access import require_plan_access

    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    feed = _feed_state(plan)
    if feed is not None and feed.get("user_id") != str(current_user.id):
        return {"enabled": True, "url": None, "webcal_url": None, "by_other": True}
    return _feed_view(request, plan, None)


@router.post("/plans/{plan_id}/calendar-feed")
def create_calendar_feed(plan_id: str, request: Request, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user_or_guest)):
    """購読の URL を作る・作り直す(前の URL は使えなくなる)。旅行に 1 つ。作った人に見える予定だけを書き出す"""
    import secrets
    from datetime import datetime, timezone

    from app.core.crypto import encrypt_payload, plan_subject
    from app.core.plan_access import require_plan_access

    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    token = secrets.token_urlsafe(24)
    prefs = dict(plan.preferences) if isinstance(plan.preferences, dict) else {}
    prefs[FEED_KEY] = {"token_hash": _feed_hash(token), "user_id": str(current_user.id),
                       "token_ct": base64.b64encode(encrypt_payload(token.encode(), plan_subject(plan.id))).decode(),
                       "created_at": datetime.now(timezone.utc).isoformat()}
    plan.preferences = prefs
    db.commit()
    record_audit_event(action="calendar_feed_created", resource_type="travel_plan", user_id=current_user.id,
                       resource_id=plan.id, details={})
    return _feed_view(request, plan, token)


@router.delete("/plans/{plan_id}/calendar-feed")
def delete_calendar_feed(plan_id: str, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user_or_guest)):
    from app.core.plan_access import require_plan_access

    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    prefs = dict(plan.preferences) if isinstance(plan.preferences, dict) else {}
    prefs.pop(FEED_KEY, None)
    plan.preferences = prefs
    db.commit()
    record_audit_event(action="calendar_feed_revoked", resource_type="travel_plan", user_id=current_user.id,
                       resource_id=plan.id, details={})
    return {"enabled": False, "url": None, "webcal_url": None}


@router.get("/public/calendar/{token}.ics")
def calendar_feed(token: str, request: Request, db: Session = Depends(get_db)):
    from sqlalchemy import String, cast
    from sqlalchemy.dialects.postgresql import JSONB

    from app.api.v1 import itinerary_export as ie
    from app.models.models import PlanCollaborator
    from app.services import itinerary_export as ix
    from app.services import member_policy

    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"calendar_feed:{ip}", 60, 60):
        raise HTTPException(status_code=429, detail="アクセスが多すぎます")
    if not token or len(token) > 100:
        raise HTTPException(status_code=404, detail="Not Found")
    h = _feed_hash(token)
    plan = (db.query(TravelPlan).filter(TravelPlan.deleted_at.is_(None),
                                        cast(cast(TravelPlan.preferences, JSONB)[FEED_KEY]["token_hash"].astext,
                                             String) == h).first())
    feed = _feed_state(plan) if plan is not None else None
    if plan is None or feed is None:
        raise HTTPException(status_code=404, detail="Not Found")
    user = db.query(User).filter(User.id == uuid.UUID(feed["user_id"])).first()
    if user is None or not getattr(user, "is_active", True):
        raise HTTPException(status_code=404, detail="Not Found")
    role = "owner" if plan.user_id == user.id else None
    if role is None:
        c = db.query(PlanCollaborator).filter(PlanCollaborator.plan_id == plan.id, PlanCollaborator.user_id == user.id,
                                              PlanCollaborator.status == "accepted").first()
        role = c.role if c is not None and c.role in ("editor", "viewer") else None
    if role is None:
        raise HTTPException(status_code=404, detail="Not Found")
    hidden = member_policy.hidden_for(db, plan, role, user)
    days, events, segs = ie._collect(db, plan, hidden)
    body = ix.build_ics(plan.title, days[0].timezone_id if days else None, plan.revision, events, segs, False,
                        ie._now())
    return Response(content=body.encode("utf-8"), media_type="text/calendar; charset=utf-8", headers={
        "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"})
