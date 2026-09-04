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

[Gate #31.5B] 以下を追加で是正した(監査 R-05/R-06):
1. 使用回数(use_count)の消費をread-modify-write(競合すると上限を
   超過しうる)から、DB上のUPDATE...WHERE...RETURNINGによる単一の原子的
   操作へ変更した。同時に複数リクエストが解決を試みても、max_uses以上の
   消費は起こり得ない。
2. 匿名公開ビューへ返すitineraryにfield policy(危険キーの再帰的除去)を
   適用し、予約番号・QR/Barcode・連絡先・パスワード・正確な緯度経度等を
   既定で除外するようにした。
3. IPベースのレート制限、Cache-Control: no-store、全アクセス試行の監査
   ログ(ShareAccessLog)を追加した。
"""
import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.models import PlanShareLink, ShareAccessLog, TravelPlan
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/public/share", tags=["public-share"])


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ResolveShareRequest(BaseModel):
    passcode: Optional[str] = None


# [Gate #31.5B] フィールドポリシー: 匿名公開ビューへ絶対に含めないキーの
# パターン(大文字小文字を区別しない)。予約番号・QR/Barcode・連絡先・
# 認証情報・正確な位置情報等。itineraryは自由形式JSON(Dict[str, Any])で
# ありスキーマが強制されていないため、キー名ベースのブロックリスト方式で
# 再帰的に除去する(ホワイトリスト方式にすると既存の正当なフィールドまで
# 過剰に消してしまうため、既知の危険パターンの除去を優先する設計)。
_SENSITIVE_KEY_PATTERN = re.compile(
    r"(reservation|confirmation|booking[_-]?number|qr[_-]?code|barcode|"
    r"phone|tel(ephone)?|email|contact|passport|credit[_-]?card|"
    r"card[_-]?number|password|secret|api[_-]?key|token|"
    r"latitude|longitude|^lat$|^lng$|^lon$|coordinates?|geo|"
    r"personal|ssn|my[_-]?number)",
    re.IGNORECASE,
)


def _redact_for_public_view(value: Any) -> Any:
    """itinerary(自由形式JSON)から機微なキーを再帰的に除去する。"""
    if isinstance(value, dict):
        return {
            k: _redact_for_public_view(v)
            for k, v in value.items()
            if not _SENSITIVE_KEY_PATTERN.search(str(k))
        }
    if isinstance(value, list):
        return [_redact_for_public_view(v) for v in value]
    return value


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _log_access(db: Session, *, share_id, token_hash: str, ip: str, result: str) -> None:
    db.add(ShareAccessLog(share_id=share_id, token_hash=token_hash, ip_address=ip, result=result))
    db.commit()


def _invalid_link():
    # 存在しない/失効済み/期限切れ/使用回数上限のいずれも同一の404で応答し、
    # 有効なtokenが存在するかどうかを外部から推測できないようにする。
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="この共有リンクは無効です")


@router.post("/{token}/resolve")
async def resolve_share_token(
    token: str,
    request: Request,
    response: Response,
    payload: ResolveShareRequest = ResolveShareRequest(),
    db: Session = Depends(get_db),
):
    """共有トークンを解決し、閲覧用のプラン情報を返す。
    生トークンはURLパスにのみ含まれる。レスポンス・エラーメッセージ・
    ログには一切トークン文字列そのものを含めない(token_hashのみ記録)。"""
    # [Gate #31.5B] レスポンスをキャッシュさせない(共有プランの内容や
    # 失効状態が中間キャッシュ・ブラウザに残らないようにする)。
    response.headers["Cache-Control"] = "no-store"

    ip = _client_ip(request)
    token_hash = _hash_token(token)

    # [Gate #31.5B] IPベースのレート制限(token総当たり緩和)。
    if not check_rate_limit(f"public_share_resolve:{ip}", settings.RATE_LIMIT_PUBLIC_SHARE, 60):
        _log_access(db, share_id=None, token_hash=token_hash, ip=ip, result="rate_limited")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="リクエストが多すぎます。しばらく待ってから再試行してください。",
        )

    share = db.query(PlanShareLink).filter(PlanShareLink.token_hash == token_hash).first()

    if not share:
        _log_access(db, share_id=None, token_hash=token_hash, ip=ip, result="invalid")
        _invalid_link()
    if share.revoked_at is not None:
        _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="invalid")
        _invalid_link()
    now = datetime.now(timezone.utc)
    if share.expires_at is not None and share.expires_at <= now:
        _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="invalid")
        _invalid_link()
    if share.max_uses is not None and share.use_count >= share.max_uses:
        _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="invalid")
        _invalid_link()

    if share.passcode_hash:
        supplied = payload.passcode or ""
        if _hash_token(supplied) != share.passcode_hash:
            _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="passcode_failed")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="パスコードが正しくありません")

    # [Gate #31.5B] 使用回数消費の原子化。ここまでのチェックはユーザーへ
    # 分かりやすいエラー(404/401)を返すための事前確認に過ぎず、実際の
    # 消費可否の最終判定はこのUPDATE文のWHERE句がDB上で単一操作として
    # 再評価する。同時に複数リクエストが到達しても、行ロックにより
    # 逐次化され、max_usesを超えて消費されることはない。
    stmt = (
        update(PlanShareLink)
        .where(
            PlanShareLink.id == share.id,
            PlanShareLink.revoked_at.is_(None),
            (PlanShareLink.expires_at.is_(None)) | (PlanShareLink.expires_at > now),
            (PlanShareLink.max_uses.is_(None)) | (PlanShareLink.use_count < PlanShareLink.max_uses),
        )
        .values(use_count=PlanShareLink.use_count + 1)
        .returning(PlanShareLink.plan_id, PlanShareLink.permission)
    )
    result_row = db.execute(stmt).first()
    db.commit()

    if result_row is None:
        # 事前チェックと原子的UPDATEの間に他リクエストが上限へ到達させた
        # (同時アクセスによるレースコンディション)。
        _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="invalid")
        _invalid_link()

    plan_id, permission = result_row

    plan = db.query(TravelPlan).filter(TravelPlan.id == plan_id).first()
    if not plan:
        _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="invalid")
        _invalid_link()

    _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="success")

    # フィールドポリシー: 匿名公開ビューでは budget/preferences に加えて
    # itinerary内の予約番号・連絡先・正確な位置情報等を再帰的に除去する。
    return {
        "plan_id": str(plan.id),
        "title": plan.title,
        "description": plan.description,
        "destination": plan.destination,
        "start_date": plan.start_date.isoformat() if plan.start_date else None,
        "end_date": plan.end_date.isoformat() if plan.end_date else None,
        "itinerary": _redact_for_public_view(plan.itinerary),
        "permission": permission,
        "can_edit": False,
    }
