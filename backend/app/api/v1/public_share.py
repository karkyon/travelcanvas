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
2. 匿名公開ビューへ返す内容へfield policyを適用した。
3. IPベースのレート制限、Cache-Control: no-store、全アクセス試行の監査
   ログ(ShareAccessLog)を追加した。

[Gate #34 P0-01/4.3] 2026-09-05監査で指摘された通り、本APIは従来
`plan.itinerary`(自由形式JSON blob、旧正本)をそのまま(キー名の
ブロックリスト除去のみ行って)返しており、Gate #29で導入された
正規化正本(`travel_days`/`travel_events`)と表示内容が食い違い得る
状態だった。本Gateで、公開ビューは常に`TravelDay`/`TravelEvent`から
明示的なホワイトリストのフィールドのみを組み立てて構築するよう変更する。
これにより:
- 表示されるday/eventは常に正本(`/plans/*`経由で更新される正規化
  テーブル)と一致する(旧itineraryとの分岐が構造的に発生し得ない)。
- 予約番号・confirmation・QR/barcode・連絡先・正確な緯度経度・内部ID・
  notes等はブロックリストではなく、そもそも出力候補に含めない
  (ホワイトリスト方式)。
- 公開投影の形は固定スキーマ(`days: [{date, title, events: [...]}]`)
  であり、任意dictの再帰下降が不要になる。
"""
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.models import PlanShareLink, ShareAccessLog, TravelDay, TravelEvent, TravelPlan
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/public/share", tags=["public-share"])


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ResolveShareRequest(BaseModel):
    passcode: Optional[str] = None


def _public_event(event: TravelEvent) -> Dict[str, Any]:
    """[Gate #34] イベントの公開投影。ホワイトリストされたフィールドのみ。
    address/latitude/longitude(正確な位置)、spot_id/place_id/day_id/
    plan_id(内部ID)、description(自由記述、機密混入の恐れ)は既定で
    含めない。"""
    return {
        "title": event.title,
        "event_type": event.event_type,
        "local_start_time": event.local_start_time,
        "is_all_day": event.is_all_day,
    }


def _public_day(day: TravelDay, events: List[TravelEvent]) -> Dict[str, Any]:
    return {
        "date": day.local_date.isoformat() if day.local_date else None,
        "title": day.title,
        "events": [_public_event(e) for e in events],
    }


def _build_public_days(db: Session, plan_id) -> List[Dict[str, Any]]:
    days = (
        db.query(TravelDay)
        .filter(TravelDay.plan_id == plan_id)
        .order_by(TravelDay.local_date.asc(), TravelDay.sort_order.asc())
        .all()
    )
    if not days:
        return []

    events = (
        db.query(TravelEvent)
        .filter(TravelEvent.day_id.in_([d.id for d in days]))
        .order_by(TravelEvent.sort_order.asc())
        .all()
    )
    events_by_day: Dict[Any, List[TravelEvent]] = {}
    for e in events:
        events_by_day.setdefault(e.day_id, []).append(e)

    return [_public_day(d, events_by_day.get(d.id, [])) for d in days]


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

    # [Gate #34] 公開ビューは正規化テーブル(travel_days/travel_events)
    # から固定スキーマで構築する。旧`plan.itinerary`は一切参照しない。
    return {
        "plan_id": str(plan.id),
        "title": plan.title,
        "description": plan.description,
        "destination": plan.destination,
        "start_date": plan.start_date.isoformat() if plan.start_date else None,
        "end_date": plan.end_date.isoformat() if plan.end_date else None,
        "days": _build_public_days(db, plan.id),
        "permission": permission,
        "can_edit": False,
    }
