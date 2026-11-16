"""[Gate BookletShare] しおりの版を同行者へ送る(共有の画面の材料と、アプリからのメール)。

- GET  /plans/{plan_id}/booklet-exports/{export_id}/share : 共有の画面の材料
    公開の URL のパス(作り直せる時だけ)・公開できるか・PDF を付けられるか・メールを送れるか・送り先の候補(メンバー)
- POST /plans/{plan_id}/booklet-exports/{export_id}/email : アプリからメールで送る(PDF の添付・リンク)

守ること:
- 送り先は、この旅行のメンバー(承認済みの共同編集者と所有者)だけ。任意のアドレスへは送らない(踏み台にしない)。
  送る人には相手のアドレスを返さない(宛先は 1 人ずつ別のメールにし、ほかの人のアドレスも見せない)。
- 機密項目を含む版は PDF を付けない(作成者だけが見られる版のため)。公開していない版のリンクは入れない。
- メールの中のリンクの土台(https://…)は、許可した画面のオリジン(CORS の一覧)だけ。
- 回数の上限(利用者ごと 1 時間 10 回)。監査には件数と添付の有無だけを残し、宛先・本文は残さない。
- 送信の設定(SMTP_HOST・EMAIL_FROM)が無い環境では 503(画面は「メールアプリで送る」などを案内する)。
"""
import smtplib
import ssl
import uuid
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1 import booklet as booklet_api
from app.core.auth import get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.models.models import PlanCollaborator, User
from app.services import member_policy
from app.services import notify
from app.services import server_render as sr
from app.services.audit_service import record_audit_event
from app.services.readiness import member_names
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/plans", tags=["booklet-share"])

EMAIL_RATE_LIMIT = 10
EMAIL_RATE_WINDOW = 3600
MAX_RECIPIENTS = 30
# 開発用の確認の受信箱(docker-compose の mailpit)。ここへ送ったメールは外へ届かない
SANDBOX_SMTP_HOSTS = ("mailpit",)


def email_sandbox() -> bool:
    return (settings.SMTP_HOST or "").strip().lower() in SANDBOX_SMTP_HOSTS


def _recipients(db: Session, plan: Any, me: User) -> List[Dict[str, Any]]:
    """送り先の候補: 所有者と承認済みの共同編集者(自分を除く)。アドレスは返さない(持っているかだけ)。"""
    rows: Dict[uuid.UUID, Dict[str, Any]] = {}
    owner = db.query(User).filter(User.id == plan.user_id).first()
    if owner is not None:
        rows[owner.id] = {"user": owner, "role": "owner"}
    for c, u in (
        db.query(PlanCollaborator, User)
        .join(User, User.id == PlanCollaborator.user_id)
        .filter(PlanCollaborator.plan_id == plan.id, PlanCollaborator.status == "accepted")
        .all()
    ):
        rows.setdefault(u.id, {"user": u, "role": c.role})
    rows.pop(me.id, None)
    names = member_names(db, set(rows))
    out = []
    for uid, r in rows.items():
        u = r["user"]
        out.append({"user_id": str(uid), "name": names.get(uid, "メンバー"), "role": r["role"],
                    "has_email": bool((u.email or "").strip()),
                    "_email": (u.email or "").strip()})
    rank = {"owner": 0, "editor": 1, "viewer": 2}
    out.sort(key=lambda m: (rank.get(str(m["role"]), 3), str(m["name"])))
    return out


def _load(db: Session, plan_id: str, export_id: str, user: User):
    plan, role, _hidden = member_policy.require_access(db, plan_id, user, "editor")
    e = booklet_api._get_export(db, plan, export_id)
    now = booklet_api._now()
    state = booklet_api._state(e, now)
    if state != "active":
        raise HTTPException(status_code=410, detail={"code": state, "message": "失効・期限切れの版は共有できません"})
    if e.contains_sensitive and e.created_by_user_id != user.id:
        raise HTTPException(status_code=403, detail={
            "code": "sensitive_creator_only", "message": "機密情報を含む版は作成者だけが扱えます"})
    return plan, role, e


@router.get("/{plan_id}/booklet-exports/{export_id}/share", response_model=dict)
def share_info(plan_id: str, export_id: str, response: Response, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    plan, role, e = _load(db, plan_id, export_id, current_user)
    can_manage = e.created_by_user_id == current_user.id or role == "owner"
    path = booklet_api.public_path_for(e) if can_manage else None
    response.headers["Cache-Control"] = "no-store"
    return {
        "export_id": str(e.id),
        "version_no": e.version_no,
        "is_public": bool(e.public_token_hash),
        # 公開中でも、以前の作り方(乱数)の版は URL を出せない。作り直すと前の URL は使えなくなる
        "public_path": path,
        "public_url_recoverable": path is not None,
        "can_publish": can_manage and not e.contains_sensitive,
        "contains_sensitive": e.contains_sensitive,
        "can_attach_pdf": not e.contains_sensitive,
        "app_path": f"/planner/{plan.id}/booklet/{e.id}",
        "email_available": notify.email_available(),
        "email_sandbox": email_sandbox(),
        "recipients": [{k: v for k, v in r.items() if not k.startswith("_")}
                       for r in _recipients(db, plan, current_user)],
        "max_recipients": MAX_RECIPIENTS,
    }


class EmailIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_ids: List[str] = Field(min_length=1, max_length=MAX_RECIPIENTS)
    message: str = Field(default="", max_length=1000)
    attach_pdf: bool = True
    include_web_link: bool = True
    include_app_link: bool = True
    # メールの中のリンクの土台。許可した画面のオリジンだけ(画面は window.location.origin を送る)
    app_origin: str = Field(max_length=200)


def _subject(title: str) -> str:
    return f"[TravelCanvas] 旅のしおり「{title[:60]}」"


def _body(sender: str, title: str, message: str, web_url: Optional[str], app_url: Optional[str], attached: bool) -> str:
    lines = [f"{sender} さんから、旅のしおり「{title}」が届きました。", ""]
    if message.strip():
        lines += [message.strip(), ""]
    if web_url:
        lines += ["■ しおりを見る(ログインなしで開けます)", web_url, ""]
    if app_url:
        lines += ["■ TravelCanvas で開く(旅行のメンバーとしてログインして開きます)", app_url, ""]
    if attached:
        lines += ["■ PDF を添付しています。印刷や、電波の無い所で見る時に使えます。", ""]
    lines += ["このメールは TravelCanvas から、旅行のメンバーの方にだけ送っています。",
              "心当たりが無い場合は、このメールを破棄してください。"]
    return "\n".join(lines)


def _send(to_email: str, subject: str, body: str, pdf: Optional[bytes], pdf_name: str) -> None:
    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = formataddr(("TravelCanvas", settings.EMAIL_FROM))
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain", "utf-8"))
    if pdf is not None:
        part = MIMEApplication(pdf, _subtype="pdf")
        part.add_header("Content-Disposition", "attachment", filename=("utf-8", "", pdf_name))
        msg.attach(part)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
        if settings.SMTP_USE_TLS:
            server.starttls(context=ssl.create_default_context())
        if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(settings.EMAIL_FROM, [to_email], msg.as_string())


@router.post("/{plan_id}/booklet-exports/{export_id}/email", response_model=dict)
def send_email(plan_id: str, export_id: str, payload: EmailIn, request: Request, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    plan, role, e = _load(db, plan_id, export_id, current_user)
    if not notify.email_available():
        raise HTTPException(status_code=503, detail={
            "code": "email_unavailable",
            "message": "この環境にはメールを送る設定がありません(管理者がメールサーバーを設定すると使えます)"})
    origin = payload.app_origin.strip().rstrip("/")
    if origin not in [o.rstrip("/") for o in settings.cors_allowed_origins]:
        raise HTTPException(status_code=422, detail={"code": "origin_not_allowed", "message": "リンクの土台が許可されていません"})
    if not (payload.attach_pdf or payload.include_web_link or payload.include_app_link):
        raise HTTPException(status_code=422, detail={"code": "nothing_to_send", "message": "PDF かリンクを 1 つ以上選んでください"})
    if payload.attach_pdf and e.contains_sensitive:
        raise HTTPException(status_code=409, detail={
            "code": "sensitive_no_attachment", "message": "機密項目を含む版は PDF をメールに付けられません"})
    web_path = booklet_api.public_path_for(e) if payload.include_web_link else None
    if payload.include_web_link and web_path is None:
        raise HTTPException(status_code=409, detail={
            "code": "not_public", "message": "Web のページとして公開していない版です(公開するか、リンクを外してください)"})

    candidates = {r["user_id"]: r for r in _recipients(db, plan, current_user)}
    wanted = list(dict.fromkeys(payload.user_ids))
    unknown = [u for u in wanted if u not in candidates]
    if unknown:
        raise HTTPException(status_code=422, detail={"code": "not_member", "message": "旅行のメンバーにだけ送れます"})
    targets = [candidates[u] for u in wanted if candidates[u]["has_email"]]
    if not targets:
        raise HTTPException(status_code=422, detail={"code": "no_address", "message": "メールアドレスのある送り先がいません"})
    if not check_rate_limit(f"booklet-email:{current_user.id}", EMAIL_RATE_LIMIT, EMAIL_RATE_WINDOW):
        raise HTTPException(status_code=429, detail={
            "code": "rate_limited", "message": "送る回数が上限に達しました。1 時間ほど待ってから送ってください"})

    snapshot = booklet_api.get_export(plan_id, export_id, request, Response(), db, current_user)["booklet"]
    title = str((snapshot.get("cover") or {}).get("title") or "旅のしおり")
    pdf: Optional[bytes] = None
    if payload.attach_pdf:
        try:
            pdf, _pages = sr.booklet_pdf(snapshot)
        except sr.FontUnavailable:
            raise HTTPException(status_code=503, detail={
                "code": "font_unavailable", "message": "この環境には日本語の字体が無いため、PDF を作れません"})
        except ValueError:
            raise HTTPException(status_code=422, detail={"code": "too_many_pages", "message": "長すぎて PDF にできません"})
    safe = "".join(ch for ch in title if ch not in '\\/:*?"<>|\r\n')[:60] or "しおり"
    sender = member_names(db, {current_user.id}).get(current_user.id, "メンバー")
    web_url = f"{origin}{web_path}" if web_path else None
    app_url = f"{origin}/planner/{quote(str(plan.id))}/booklet/{quote(str(e.id))}" if payload.include_app_link else None
    body = _body(sender, title, payload.message, web_url, app_url, pdf is not None)

    sent = failed = 0
    for t in targets:
        try:
            _send(t["_email"], _subject(title), body, pdf, f"{safe}.pdf")
            sent += 1
        except Exception:  # noqa: BLE001 — 1 人の失敗で全体を止めない(理由・宛先はログへ出さない)
            failed += 1
    record_audit_event(action="booklet_emailed", resource_type="booklet_export", user_id=current_user.id,
                       resource_id=e.id, details={"plan_id": str(plan.id), "version_no": e.version_no, "sent": sent,
                                                  "failed": failed, "pdf": pdf is not None,
                                                  "web_link": web_url is not None, "app_link": app_url is not None},
                       ip_address=request.client.host if request.client else None)
    if sent == 0:
        raise HTTPException(status_code=502, detail={
            "code": "send_failed", "message": "メールを送れませんでした(メールサーバーの設定を確かめてください)"})
    return {"sent": sent, "failed": failed, "skipped_no_address": len(wanted) - len(targets),
            "sandbox": email_sandbox()}
