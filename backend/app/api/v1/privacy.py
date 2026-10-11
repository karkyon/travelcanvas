"""
[Gate P9] FR-039 アカウント単位の削除と同意の撤回(DOC-04 SC-29、DOC-11 §15)。

エンドポイント(本人のみ。ゲストも利用できる):
- GET  /privacy/account-deletion : 削除で何が起きるかの説明(所有する旅行と参加者数、参加している旅行で消えるもの・
                                   残るもの、保持期間)。DBは変えない。
- POST /privacy/account-deletion : 確認の文字と(登録ユーザーは)パスワードで本人確認して削除する。取り消せない。
                                   セッション・refresh cookieも失効する。処理は app/services/account_deletion.py。
- GET  /privacy/consents         : 目的別の同意(AI・位置・分析・お知らせメール)。
- PUT  /privacy/consents         : 同意する/撤回する。監査には目的と新しい値だけを記録する。
"""
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.api.v1.auth import REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH
from app.api.v1.data_export import retention_info
from app.core.auth import auth_manager, get_current_user_or_guest
from app.core.database import get_db
from app.models.models import User
from app.services import account_deletion as ad
from app.services import consents as cs
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


@router.post("/account-deletion", response_model=dict)
def delete_account(payload: AccountDeletionRequest, request: Request, response: Response,
                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    if user.is_superuser or user.role == "admin":
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
    summary = ad.delete_account(db, user)
    db.commit()
    _audit(request, user, "account_deleted", {"summary": summary})
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    response.headers["Cache-Control"] = "no-store"
    return {"deleted": True, "summary": summary, "plan_delete_grace_days": ad.preview_grace_days()}


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
    db.commit()
    if changed:
        _audit(request, user, "privacy_consent_updated", {"changes": {k: payload.consents[k] for k in changed}})
    return cs.view(user)
