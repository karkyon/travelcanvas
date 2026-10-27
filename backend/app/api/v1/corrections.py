"""
[Gate G8] FR-039 出典・確認・履歴つきの訂正(DOC-11 §15 Correction、DOC-04 SC-29)。

本人のアカウントの値(本人が直す):
- GET  /privacy/corrections               : 訂正の履歴(本人だけ。前後の値は本人のデータ鍵で復号)と、所有者への申し出の一覧
- POST /privacy/corrections               : 表示名・メールアドレスを訂正する。出典(本人の申告・公的な書類・予約の確認書・その他)
                                            と補足を必ず記録する。メールアドレスはパスワードで本人確認し、確認済みの印を外して
                                            他の端末のセッションを失効させる(PUT /auth/me と同じ)
- POST /privacy/corrections/{id}/revert   : 訂正を取り消す(今の値が訂正の後の値のままの時だけ。メールアドレスはパスワード)

共同の旅行の中の本人に関わる情報(旅行の所有者が直す):
- POST /plans/{plan_id}/correction-requests            : 参加者が所有者へ訂正を申し出る(内容は旅行のデータ鍵で暗号化)
- GET  /plans/{plan_id}/correction-requests            : 所有者は全て、参加者は自分の申し出だけ
- POST /plans/{plan_id}/correction-requests/{id}/resolve : 所有者が「対応した」「見送る」を理由つきで記録する(申し出た人へ通知)

監査には ID・項目の種類・出典の種類・結果だけを残す(値・補足は残さない)。
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field, TypeAdapter, ValidationError, field_validator
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.auth import auth_manager, get_current_session_id, get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import DataCorrection, TravelPlan, User
from app.services import notify
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(tags=["corrections"])

SOURCES = {
    "self_statement": "本人の申告",
    "official_document": "公的な書類",
    "booking_document": "予約の確認書",
    "other": "その他",
}
SELF_FIELDS = {"username": "表示名", "email": "メールアドレス"}
REQUESTS_PER_HOUR = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _enc(value: Dict[str, Any], subject) -> bytes:
    try:
        return crypto.encrypt_payload(json.dumps(value, ensure_ascii=False).encode("utf-8"), subject)
    except crypto.EncryptionNotConfigured:
        # 訂正の前後の値・申し出の内容は暗号化して残す決まり。暗号化できない時は何も変えずに止める
        raise HTTPException(status_code=503, detail={
            "code": "encryption_not_configured", "message": "暗号化が設定されていないため記録できません(サーバー側の設定)"})


def _dec(blob: Optional[bytes]) -> Optional[Dict[str, Any]]:
    if not blob:
        return None
    try:
        return json.loads(crypto.decrypt_payload(bytes(blob)).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, crypto.EncryptionNotConfigured):
        return None  # 鍵を破棄した(削除済み)・暗号化の未設定など。読めない値は出さない


def _db_user(db: Session, current: User) -> Any:
    user = db.query(User).filter(User.id == current.id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")
    return user


def _audit(request: Request, user: User, action: str, c: DataCorrection, extra: Optional[Dict] = None) -> None:
    record_audit_event(
        action=action, resource_type="data_correction", user_id=user.id, resource_id=c.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        details={"kind": c.kind, "field": c.field, "source": c.source, "verification": c.verification,
                 **({"plan_id": str(c.plan_id)} if c.plan_id else {}), **(extra or {})},
    )


def _reauth(request: Request, user: Any, password: Optional[str], purpose: str) -> None:
    if not check_rate_limit(f"reauth:{user.id}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(status_code=429, detail={
            "code": "rate_limited", "message": "確認の回数が上限に達しました。しばらく待ってから再試行してください"})
    if not user.hashed_password or not password or not auth_manager.verify_password(password, user.hashed_password):
        record_audit_event(action="reauth_failed", resource_type="user", user_id=user.id, resource_id=user.id,
                           ip_address=request.client.host if request.client else None, details={"purpose": purpose})
        raise HTTPException(status_code=403, detail={"code": "reauth_failed", "message": "パスワードが正しくありません"})


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def _self_view(c: Any) -> Dict[str, Any]:
    p = _dec(cast(Optional[bytes], c.payload_ciphertext)) or {}
    return {"id": str(c.id), "kind": "self", "field": c.field, "field_label": SELF_FIELDS.get(c.field, c.field),
            "before": p.get("before"), "after": p.get("after"), "source": c.source,
            "source_label": SOURCES.get(c.source, c.source), "source_note": p.get("source_note"),
            "verification": c.verification, "status": c.status, "created_at": _iso(c.created_at),
            "reverted_at": _iso(c.resolved_at)}


def _request_view(db: Session, c: Any, *, for_owner: bool) -> Dict[str, Any]:
    p = _dec(cast(Optional[bytes], c.payload_ciphertext)) or {}
    note = _dec(cast(Optional[bytes], c.resolution_note_ciphertext)) or {}
    out = {"id": str(c.id), "kind": "request", "plan_id": str(c.plan_id), "field": c.field,
           "field_label": p.get("field_label"), "current_value": p.get("current_value"),
           "proposed_value": p.get("proposed_value"), "source": c.source,
           "source_label": SOURCES.get(c.source, c.source), "source_note": p.get("source_note"),
           "status": c.status, "resolution_note": note.get("note"), "created_at": _iso(c.created_at),
           "resolved_at": _iso(c.resolved_at)}
    if for_owner:
        u = db.query(User).filter(User.id == c.user_id).first()
        out["requester_name"] = (u.username if u and u.username else None) or "メンバー"
    return out


# ===================================================================== 本人の訂正

class CorrectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str
    value: str = Field(..., min_length=1, max_length=254)
    source: str
    source_note: Optional[str] = Field(None, max_length=500)
    password: Optional[str] = Field(None, max_length=200)

    @field_validator("field")
    @classmethod
    def _v_field(cls, v):
        if v not in SELF_FIELDS:
            raise ValueError(f"訂正できる項目は {list(SELF_FIELDS)} です")
        return v

    @field_validator("source")
    @classmethod
    def _v_source(cls, v):
        if v not in SOURCES:
            raise ValueError(f"出典は {list(SOURCES)} のどれかです")
        return v


class RevertBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: Optional[str] = Field(None, max_length=200)


_EMAIL: TypeAdapter[str] = TypeAdapter(EmailStr)


def _normalize(field: str, value: str) -> str:
    v = value.strip()
    if field == "username":
        if not 1 <= len(v) <= 50 or any(ord(ch) < 32 for ch in v):
            raise HTTPException(status_code=422, detail="表示名は1〜50文字で入力してください")
        return v
    try:
        return str(_EMAIL.validate_python(v))
    except ValidationError:
        raise HTTPException(status_code=422, detail="メールアドレスの形式が正しくありません")


def _apply_value(db: Session, user: Any, field: str, value: str, request: Request,
                 session_id: Optional[str]) -> None:
    if field == "username":
        taken = db.query(User).filter(User.username == value, User.id != user.id).first()
        if taken:
            raise HTTPException(status_code=409, detail={"code": "username_taken",
                                                         "message": "この表示名は既に使われています"})
        user.username = value
        return
    taken = db.query(User).filter(User.email == value, User.id != user.id).first()
    if taken:
        raise HTTPException(status_code=409, detail={"code": "email_taken",
                                                     "message": "このメールアドレスは既に使われています"})
    user.email = value
    user.is_verified = False


@router.get("/privacy/corrections", response_model=dict)
def list_corrections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    rows = (db.query(DataCorrection).filter(DataCorrection.user_id == user.id)
            .order_by(DataCorrection.created_at.desc()).limit(200).all())
    requests = []
    for c in rows:
        if c.kind != "request":
            continue
        view = _request_view(db, c, for_owner=False)
        plan = db.query(TravelPlan).filter(TravelPlan.id == c.plan_id).first()
        view["plan_title"] = plan.title if plan is not None and plan.deleted_at is None else None
        requests.append(view)
    return {
        "history": [_self_view(c) for c in rows if c.kind == "self"],
        "requests": requests,
        "fields": [{"field": k, "label": v, "requires_password": k == "email"} for k, v in SELF_FIELDS.items()],
        "sources": [{"source": k, "label": v} for k, v in SOURCES.items()],
        "current": {"username": user.username, "email": user.email},
    }


@router.post("/privacy/corrections", status_code=201, response_model=dict)
def create_correction(payload: CorrectionCreate, request: Request, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest),
                      session_id: Optional[str] = Depends(get_current_session_id)):
    user = _db_user(db, current_user)
    if user.user_type == "guest" or not user.hashed_password:
        raise HTTPException(status_code=403, detail={
            "code": "registered_only", "message": "訂正の記録は会員登録したアカウントだけが使えます"})
    value = _normalize(payload.field, payload.value)
    before = getattr(user, payload.field)
    if before == value:
        raise HTTPException(status_code=422, detail={"code": "no_change", "message": "今の値と同じです"})
    verification = "session"
    if payload.field == "email":
        _reauth(request, user, payload.password, "correction_email")
        verification = "password"
    elif payload.password:
        _reauth(request, user, payload.password, "correction")
        verification = "password"
    # 先に暗号化する(暗号化できない時は値を変えずに 503)
    ciphertext = _enc({"before": before, "after": value, "source_note": (payload.source_note or "").strip() or None},
                      crypto.user_subject(user.id))
    _apply_value(db, user, payload.field, value, request, session_id)
    c = DataCorrection(
        id=uuid.uuid4(), user_id=user.id, kind="self", field=payload.field, source=payload.source, created_at=_now(),
        verification=verification, status="applied", payload_ciphertext=ciphertext,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    if payload.field == "email":
        auth_manager.revoke_all_user_sessions(str(user.id), db, except_session_id=session_id)
    _audit(request, user, "data_corrected", c)
    return _self_view(c)


@router.post("/privacy/corrections/{correction_id}/revert", response_model=dict)
def revert_correction(correction_id: str, payload: RevertBody, request: Request, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest),
                      session_id: Optional[str] = Depends(get_current_session_id)):
    user = _db_user(db, current_user)
    try:
        cid = uuid.UUID(correction_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="訂正の記録が見つかりません")
    c: Any = (db.query(DataCorrection)
              .filter(DataCorrection.id == cid, DataCorrection.user_id == user.id, DataCorrection.kind == "self")
              .with_for_update().first())
    if c is None:
        raise HTTPException(status_code=404, detail="訂正の記録が見つかりません")
    if c.status != "applied":
        raise HTTPException(status_code=409, detail={"code": "already_reverted", "message": "既に取り消しています"})
    p = _dec(cast(Optional[bytes], c.payload_ciphertext))
    if p is None or getattr(user, c.field) != p.get("after"):
        raise HTTPException(status_code=409, detail={
            "code": "changed_since", "message": "訂正の後に値が変わっているため取り消せません(新しく訂正してください)"})
    if c.field == "email":
        _reauth(request, user, payload.password, "correction_revert")
    restored = p.get("before")
    if restored is None:
        raise HTTPException(status_code=409, detail={"code": "no_previous", "message": "元の値が無いため取り消せません"})
    _apply_value(db, user, cast(str, c.field), restored, request, session_id)
    c.status = "reverted"
    c.resolved_at = _now()
    db.commit()
    db.refresh(c)
    if c.field == "email":
        auth_manager.revoke_all_user_sessions(str(user.id), db, except_session_id=session_id)
    _audit(request, user, "data_correction_reverted", c)
    return _self_view(c)


# ===================================================================== 所有者への申し出

class CorrectionRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field_label: str = Field(..., min_length=1, max_length=80)
    current_value: Optional[str] = Field(None, max_length=500)
    proposed_value: str = Field(..., min_length=1, max_length=500)
    source: str
    source_note: Optional[str] = Field(None, max_length=500)

    @field_validator("source")
    @classmethod
    def _v_source(cls, v):
        if v not in SOURCES:
            raise ValueError(f"出典は {list(SOURCES)} のどれかです")
        return v


class CorrectionResolve(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    note: Optional[str] = Field(None, max_length=500)

    @field_validator("status")
    @classmethod
    def _v_status(cls, v):
        if v not in ("resolved", "declined"):
            raise ValueError("status は resolved か declined です")
        return v


@router.post("/plans/{plan_id}/correction-requests", status_code=201, response_model=dict)
def create_request(plan_id: str, payload: CorrectionRequestCreate, request: Request, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if role == "owner":
        raise HTTPException(status_code=422, detail={
            "code": "owner_can_edit", "message": "所有者は旅行の画面で直接直せます"})
    if not check_rate_limit(f"correction_request:{current_user.id}", REQUESTS_PER_HOUR, 3600):
        raise HTTPException(status_code=429, detail={
            "code": "rate_limited", "message": "申し出が多すぎます。しばらくしてからやり直してください"})
    c = DataCorrection(
        id=uuid.uuid4(), user_id=current_user.id, kind="request", plan_id=plan.id, field="plan_data", created_at=_now(),
        source=payload.source, verification="session", status="open",
        payload_ciphertext=_enc({"field_label": payload.field_label.strip(),
                                 "current_value": (payload.current_value or "").strip() or None,
                                 "proposed_value": payload.proposed_value.strip(),
                                 "source_note": (payload.source_note or "").strip() or None},
                                crypto.plan_subject(plan.id)),
    )
    db.add(c)
    notify.deliver(db, plan, [cast(uuid.UUID, plan.user_id)], "correction_request", "情報の訂正の申し出",
                   f"「{plan.title}」の情報について、参加者から訂正の申し出が届きました。共有の画面で確かめてください。",
                   target_type="plan", target_id=cast(uuid.UUID, plan.id), direct_ids=[cast(uuid.UUID, plan.user_id)])
    db.commit()
    db.refresh(c)
    _audit(request, current_user, "data_correction_requested", c)
    return _request_view(db, c, for_owner=False)


@router.get("/plans/{plan_id}/correction-requests", response_model=List[dict])
def list_requests(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    q = db.query(DataCorrection).filter(DataCorrection.plan_id == plan.id, DataCorrection.kind == "request")
    if role != "owner":
        q = q.filter(DataCorrection.user_id == current_user.id)
    rows = q.order_by(DataCorrection.created_at.desc()).limit(200).all()
    return [_request_view(db, c, for_owner=role == "owner") for c in rows]


@router.post("/plans/{plan_id}/correction-requests/{request_id}/resolve", response_model=dict)
def resolve_request(plan_id: str, request_id: str, payload: CorrectionResolve, request: Request,
                    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="owner")
    try:
        rid = uuid.UUID(request_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="申し出が見つかりません")
    c: Any = (db.query(DataCorrection)
              .filter(DataCorrection.id == rid, DataCorrection.plan_id == plan.id, DataCorrection.kind == "request")
              .with_for_update().first())
    if c is None:
        raise HTTPException(status_code=404, detail="申し出が見つかりません")
    if c.status != "open":
        raise HTTPException(status_code=409, detail={"code": "already_resolved", "message": "既に対応を記録しています"})
    c.status = payload.status
    c.resolved_at = _now()
    c.resolved_by_user_id = current_user.id
    if payload.note and payload.note.strip():
        c.resolution_note_ciphertext = _enc({"note": payload.note.strip()}, crypto.plan_subject(plan.id))
    label = "対応しました" if payload.status == "resolved" else "見送りました"
    notify.deliver(db, plan, [cast(uuid.UUID, c.user_id)], "correction_request", f"訂正の申し出: 所有者が{label}",
                   f"「{plan.title}」への訂正の申し出に、所有者が{label}。データとプライバシーの画面で確かめられます。",
                   target_type="plan", target_id=cast(uuid.UUID, plan.id), direct_ids=[cast(uuid.UUID, c.user_id)])
    db.commit()
    db.refresh(c)
    _audit(request, current_user, "data_correction_request_resolved", c, {"status": payload.status})
    return _request_view(db, c, for_owner=True)


def export_rows(db: Session, user_id: Any) -> Dict[str, List[Dict[str, Any]]]:
    """アカウントの書き出し(FR-039)へ入れる本人の訂正の履歴・申し出(復号した値)。"""
    rows = db.query(DataCorrection).filter(DataCorrection.user_id == user_id).order_by(DataCorrection.created_at).all()
    return {"history": [_self_view(c) for c in rows if c.kind == "self"],
            "requests": [_request_view(db, c, for_owner=False) for c in rows if c.kind == "request"]}
