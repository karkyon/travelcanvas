"""
[Gate #30] 共有リンクトークンによる公開閲覧(未認証)API。

/api/v1/travel-plans/{plan_id}/share (share.py, owner専用の管理CRUD) とは
明確にrouteを分離する(監査指摘: "/share/{token}と/share/:planIdの衝突を
解消し、管理画面と公開画面を別routeにする")。本routerは認証不要で、
tokenの生値はDBに一切保存せずSHA-256ハッシュのみで照合する。

[Gate #30 スコープ] 共有リンクのpermission="edit"は「将来、承諾済み
コラボレーターとして編集可能にする」意図のフラグとして保持するが、
匿名の未認証ユーザーによる直接書き込みは本Gateでは実装しない(安全側の
判断。書き込みには依然としてログインとcollaborator登録が必要)。
"""
import hashlib
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import PlanShareLink, TravelPlan

router = APIRouter(prefix="/public/share", tags=["public-share"])


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ResolveShareRequest(BaseModel):
    passcode: Optional[str] = None


def _invalid_link():
    # 存在しない/失効済み/期限切れ/使用回数上限のいずれも同一の404で応答し、
    # 有効なtokenが存在するかどうかを外部から推測できないようにする。
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="この共有リンクは無効です")


@router.post("/{token}/resolve")
async def resolve_share_token(
    token: str,
    payload: ResolveShareRequest = ResolveShareRequest(),
    db: Session = Depends(get_db),
):
    """共有トークンを解決し、閲覧用のプラン情報を返す。
    生トークンはURLパスにのみ含まれる。レスポンス・エラーメッセージ・
    ログには一切トークン文字列そのものを含めない。"""
    token_hash = _hash_token(token)
    share = db.query(PlanShareLink).filter(PlanShareLink.token_hash == token_hash).first()

    if not share:
        _invalid_link()
    if share.revoked_at is not None:
        _invalid_link()
    if share.expires_at is not None and share.expires_at <= datetime.now(timezone.utc):
        _invalid_link()
    if share.max_uses is not None and share.use_count >= share.max_uses:
        _invalid_link()

    if share.passcode_hash:
        supplied = payload.passcode or ""
        if _hash_token(supplied) != share.passcode_hash:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="パスコードが正しくありません")

    plan = db.query(TravelPlan).filter(TravelPlan.id == share.plan_id).first()
    if not plan:
        _invalid_link()

    share.use_count = (share.use_count or 0) + 1
    db.commit()

    # フィールドポリシー: 匿名公開ビューでは budget / preferences を含めない。
    return {
        "plan_id": str(plan.id),
        "title": plan.title,
        "description": plan.description,
        "destination": plan.destination,
        "start_date": plan.start_date.isoformat() if plan.start_date else None,
        "end_date": plan.end_date.isoformat() if plan.end_date else None,
        "itinerary": plan.itinerary,
        "permission": share.permission,
        "can_edit": False,
    }
