"""
[Gate P9] FR-039 アカウント単位の削除と同意の撤回(DOC-04 SC-29、DOC-11 §15)。

エンドポイント(本人のみ。ゲストも利用できる):
- GET  /privacy/account-deletion : 削除で何が起きるかの説明(所有する旅行と参加者数、参加している旅行で消えるもの・
                                   残るもの、保持期間)。DBは変えない。
- POST /privacy/account-deletion : 確認の文字と(登録ユーザーは)パスワードで本人確認して削除する。取り消せない。
                                   セッション・refresh cookieも失効する。処理は app/services/account_deletion.py。
- POST /privacy/account-deletion/schedule : [Gate G7] 猶予つきの削除を申し込む(既定14日後。本人確認は即時の削除と同じ。
                                   登録した会員だけ)。その間はいつも通り使え、取り消せる
- POST /privacy/account-deletion/cancel   : [Gate G7] 申し込みを取り消す(ログインしている本人)
- GET  /privacy/consents         : 目的別の同意(AI・位置・分析・お知らせメール)。
- PUT  /privacy/consents         : 同意する/撤回する。監査には目的と新しい値だけを記録する。
- GET/POST /privacy/support-grants, POST /privacy/support-grants/{id}/revoke : [Gate G2] FR-040 サポートへの閲覧の許可
                                   (本人だけが作る。パスワードで本人確認・目的・1〜72時間。いつでも取り消せる)
"""
import uuid
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.api.v1.auth import REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH
from app.api.v1.data_export import retention_info
from app.api.v1 import location_tracks
from app.core.auth import auth_manager, get_current_user_or_guest
from app.core.database import get_db
from app.models.models import SupportGrant, User
from app.services import account_deletion as ad
from app.services import consents as cs
from app.services import support_access as sa_
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/privacy", tags=["privacy"])
DELETE_ATTEMPTS_PER_HOUR = 5


def _db_user(db: Session, current: User) -> User:
    """ゲストの認証結果はDBの行ではないため、本人の行を読み直す。"""
    user = db.query(User).filter(User.id == current.id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")
    return user


def _audit(request: Request, user: User, action: str, details: dict) -> None:
    record_audit_event(
        action=action, resource_type="user", user_id=user.id, resource_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255], details=details,
    )


@router.get("/account-deletion", response_model=dict)
def get_account_deletion(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    return {**ad.preview(db, user), "retention": retention_info()}


class AccountDeletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: str = Field(..., max_length=50)
    password: Optional[str] = Field(None, max_length=200)


def _confirm_deletion(payload: "AccountDeletionRequest", request: Request, user: User) -> None:
    """削除の本人確認(即時・猶予つきで同じ)。管理者・回数・確認の文字・パスワード。"""
    if ad.is_admin(user):
        raise HTTPException(status_code=403, detail={
            "code": "admin_account", "message": "管理者のアカウントはこの画面から削除できません。管理者の権限を外してから削除してください"})
    if not check_rate_limit(f"account_delete:{user.id}", DELETE_ATTEMPTS_PER_HOUR, 3600):
        raise HTTPException(status_code=429, detail={
            "code": "rate_limited", "message": "試行回数が多すぎます。しばらくしてからやり直してください"})
    if payload.confirmation.strip() != ad.CONFIRMATION_TEXT:
        raise HTTPException(status_code=422, detail={
            "code": "confirmation_mismatch", "message": f"確認のため「{ad.CONFIRMATION_TEXT}」と入力してください"})
    if ad.requires_password(user):
        if not payload.password or not auth_manager.verify_password(payload.password, user.hashed_password):
            _audit(request, user, "account_deletion_reauth_failed", {})
            raise HTTPException(status_code=403, detail={
                "code": "reauth_failed", "message": "パスワードが正しくありません"})


@router.post("/account-deletion", response_model=dict)
def delete_account(payload: AccountDeletionRequest, request: Request, response: Response,
                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    _confirm_deletion(payload, request, user)
    summary = ad.delete_account(db, user)
    db.commit()
    _audit(request, user, "account_deleted", {"summary": summary})
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    response.headers["Cache-Control"] = "no-store"
    return {"deleted": True, "summary": summary, "plan_delete_grace_days": ad.preview_grace_days()}


@router.post("/account-deletion/schedule", response_model=dict)
def schedule_account_deletion(payload: AccountDeletionRequest, request: Request, db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_user_or_guest)):
    """[Gate G7] FR-039 猶予つきの削除を申し込む。"""
    user = _db_user(db, current_user)
    if not ad.can_schedule(user):
        raise HTTPException(status_code=422, detail={
            "code": "schedule_not_available",
            "message": "ゲストのアカウントは猶予つきの削除を使えません(今すぐ削除するか、会員登録してください)"})
    _confirm_deletion(payload, request, user)
    due = ad.schedule(db, user)
    db.commit()
    _audit(request, user, "account_deletion_scheduled", {"grace_days": ad.account_grace_days()})
    return {"scheduled": ad.schedule_view(user), "account_delete_grace_days": ad.account_grace_days(),
            "due_at": due.isoformat()}


@router.post("/account-deletion/cancel", response_model=dict)
def cancel_account_deletion(request: Request, db: Session = Depends(get_db),
                            current_user: User = Depends(get_current_user_or_guest)):
    """[Gate G7] FR-039 申し込みを取り消す。"""
    user = _db_user(db, current_user)
    if not ad.cancel(db, user):
        raise HTTPException(status_code=409, detail={
            "code": "not_scheduled", "message": "削除の申し込みはありません"})
    db.commit()
    _audit(request, user, "account_deletion_cancelled", {})
    return {"scheduled": None}


@router.get("/consents", response_model=dict)
def get_consents(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    return cs.view(_db_user(db, current_user))


class ConsentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consents: Dict[str, bool] = Field(..., min_length=1)

    @field_validator("consents")
    @classmethod
    def _v(cls, v):
        unknown = sorted(set(v) - set(cs.PURPOSE_KEYS))
        if unknown:
            raise ValueError(f"不明な目的です: {', '.join(unknown)}")
        return v


@router.put("/consents", response_model=dict)
def put_consents(payload: ConsentUpdate, request: Request, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    changed = cs.update(user, payload.consents)
    if "location" in changed and payload.consents.get("location") is False:
        # [Gate P13] 位置情報の同意を撤回したら、記録中・一時停止中の軌跡をすぐ止める
        location_tracks.stop_active_tracks(db, user.id, "consent_withdrawn")
    db.commit()
    if changed:
        _audit(request, user, "privacy_consent_updated", {"changes": {k: payload.consents[k] for k in changed}})
    return cs.view(user)


# ---------------------------------------------------------------------------
# [Gate G2] FR-040 サポートへの閲覧の許可(本人だけが作る・取り消す)。app/services/support_access.py が正本。
# ---------------------------------------------------------------------------

SUPPORT_GRANT_ATTEMPTS_PER_HOUR = 20


class SupportGrantCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purpose: str = Field(..., max_length=sa_.PURPOSE_MAX * 2)
    hours: int = Field(sa_.DEFAULT_HOURS)
    plan_id: Optional[str] = Field(None, max_length=64)
    ticket_ref: Optional[str] = Field(None, max_length=sa_.TICKET_MAX * 2)
    password: Optional[str] = Field(None, max_length=200)


def _support_error(e: "sa_.SupportError") -> HTTPException:
    return HTTPException(status_code=e.status, detail={"code": e.code, "message": e.message})


@router.get("/support-grants", response_model=dict)
def list_support_grants(response: Response, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    rows = (db.query(SupportGrant).filter(SupportGrant.user_id == user.id)
            .order_by(SupportGrant.created_at.desc()).limit(50).all())
    response.headers["Cache-Control"] = "no-store"
    return {"grants": [sa_.owner_view(db, g) for g in rows], "limits": {
        "min_hours": sa_.MIN_HOURS, "max_hours": sa_.MAX_HOURS, "default_hours": sa_.DEFAULT_HOURS,
        "max_active": sa_.MAX_ACTIVE_PER_USER, "purpose_max": sa_.PURPOSE_MAX},
        "requires_password": ad.requires_password(user)}


@router.post("/support-grants", response_model=dict, status_code=201)
def create_support_grant(payload: SupportGrantCreate, request: Request, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    if not check_rate_limit(f"support_grant:{user.id}", SUPPORT_GRANT_ATTEMPTS_PER_HOUR, 3600):
        raise HTTPException(status_code=429, detail={
            "code": "rate_limited", "message": "試行回数が多すぎます。しばらくしてからやり直してください"})
    if ad.requires_password(user):
        if not payload.password or not auth_manager.verify_password(payload.password, user.hashed_password):
            _audit(request, user, "support_grant_reauth_failed", {})
            raise HTTPException(status_code=403, detail={"code": "reauth_failed", "message": "パスワードが正しくありません"})
    try:
        data = sa_.clean_input(payload.model_dump(exclude={"password"}))
        grant = sa_.create(db, user, data)
    except sa_.SupportError as e:
        raise _support_error(e)  # 判定は書き込みの前に行う(取り消す変更は無い)
    db.commit()
    db.refresh(grant)
    # 目的・問い合わせ番号の本文は監査に残さない(長さと対象の種類だけ)
    _audit(request, user, "support_grant_created", {"grant_id": str(grant.id), "hours": data["hours"],
                                                    "scope": "plan" if grant.plan_id else "account"})
    return sa_.owner_view(db, grant)


@router.post("/support-grants/{grant_id}/revoke", response_model=dict)
def revoke_support_grant(grant_id: str, request: Request, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    try:
        gid = uuid.UUID(grant_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="許可が見つかりません")
    grant = db.query(SupportGrant).filter(SupportGrant.id == gid, SupportGrant.user_id == user.id).first()
    if grant is None:
        raise HTTPException(status_code=404, detail="許可が見つかりません")
    if grant.revoked_at is None:
        grant.revoked_at = sa_.now()
        db.commit()
        _audit(request, user, "support_grant_revoked", {"grant_id": str(grant.id)})
    return sa_.owner_view(db, grant)
