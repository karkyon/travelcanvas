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

[Gate F45] FR-045(CA-003)項目単位の共有の規則。リンクごとの policy(app/services/share_policy.py)で
説明・日程の見出し・時刻(INTERNAL)と住所・メモ・予約の概要(CONFIDENTIAL、明示の確認つき)を出し分ける。
許可されていない項目はキーごと出さない。RESTRICTED(予約番号・チケット・文書・連絡先・正確な位置・支払い)は
どの policy でも出力候補に無い。所有者の共有前プレビュー(share.py)も同じ build_public_view を使う。

[Gate G4] COL-05 Guest Travel View(app/services/share_view.py):
- GET  /{token}/info  : 使用回数を使わない確認(合言葉が要るか・見える項目/見えない項目・期限・複製できるか)。旅行の中身は返さない
- POST /{token}/resolve の応答に view_token(一時トークン)・policy の説明・allow_clone を足す
- GET  /{token}/view  : X-Share-View の一時トークンで見直す(使用回数を使わない。失効・期限・合言葉の変更で即無効)
- POST /{token}/clone : ログインした人が、許可された項目だけを自分の新しい旅行へ複製する(所有者が allow_clone にした時だけ)
[Gate G4] FC-097 POST /{token}/report: 濫用の通報(app/services/abuse.py。無効なリンクでも同じ応答)。
"""
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, NoReturn, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.models import PlanShareLink, Reservation, ShareAccessLog, TravelDay, TravelEvent, TravelPlan
from app.core.auth import get_current_active_user
from app.models.models import User
from app.services import abuse, share_policy, share_view
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/public/share", tags=["public-share"])


# [Gate P4] FR-035 / DOC-06: 公開ページは検索エンジンから除外し、リンク元へURL(トークン)を送らない。
# エラー応答にも同じヘッダーを付ける。
PUBLIC_HEADERS = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
}


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ResolveShareRequest(BaseModel):
    passcode: Optional[str] = None


def _public_event(event: TravelEvent, fields: Optional[List[str]] = None) -> Dict[str, Any]:
    """[Gate #34] イベントの公開投影。ホワイトリストされたフィールドのみ。
    latitude/longitude(正確な位置)、spot_id/place_id/day_id/plan_id(内部ID)は
    どの policy でも含めない。[Gate F45] 時刻は event_times、住所の文字列は event_address、
    説明(メモ)は event_notes が許可された時だけ出す。"""
    allowed = share_policy.fields_of(None) if fields is None else fields
    show_time = "event_times" in allowed
    out: Dict[str, Any] = {
        "title": event.title,
        "event_type": event.event_type,
        "local_start_time": event.local_start_time if show_time else None,
        "is_all_day": bool(event.is_all_day) if show_time else False,
    }
    if "event_address" in allowed and event.address:
        out["address"] = event.address
    if "event_notes" in allowed and event.description:
        out["notes"] = event.description
    return out


def _public_day(day: TravelDay, events: List[TravelEvent], fields: Optional[List[str]] = None) -> Dict[str, Any]:
    allowed = share_policy.fields_of(None) if fields is None else fields
    return {
        "date": day.local_date.isoformat() if day.local_date else None,
        "title": day.title if "day_titles" in allowed else None,
        "events": [_public_event(e, allowed) for e in events],
    }


def _build_public_days(db: Session, plan_id, fields: Optional[List[str]] = None) -> List[Dict[str, Any]]:
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

    return [_public_day(d, events_by_day.get(d.id, []), fields) for d in days]


def _local_time_text(value: Optional[datetime], tz_name: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    try:
        from zoneinfo import ZoneInfo
        local = value.astimezone(ZoneInfo(tz_name)) if tz_name else value
    except Exception:
        local = value
    return local.strftime("%Y-%m-%d %H:%M")


def _public_reservations(db: Session, plan_id) -> List[Dict[str, Any]]:
    """[Gate F45] 予約の概要(CONFIDENTIAL)。種類・施設名・日時・状態だけ。予約番号(伏せた形も)・PIN・
    予約者名・連絡先・URL・金額・メモ・内部IDは出さない。"""
    rows = (
        db.query(Reservation)
        .filter(Reservation.plan_id == plan_id, Reservation.deleted_at.is_(None))
        .order_by(Reservation.start_at.asc().nullslast(), Reservation.created_at.asc())
        .all()
    )
    return [
        {
            "type": r.type,
            "provider_name": r.provider_name,
            "status": r.status,
            "start": _local_time_text(r.start_at, r.timezone_id),
            "end": _local_time_text(r.end_at, r.timezone_id),
        }
        for r in rows
    ]


def build_public_view(db: Session, plan: TravelPlan, fields: List[str], permission: str) -> Dict[str, Any]:
    """公開閲覧と所有者の共有前プレビューで共通の投影。"""
    view: Dict[str, Any] = {
        "plan_id": str(plan.id),
        "title": plan.title,
        "description": plan.description if "plan_description" in fields else None,
        "destination": plan.destination,
        "start_date": plan.start_date.isoformat() if plan.start_date else None,
        "end_date": plan.end_date.isoformat() if plan.end_date else None,
        "days": _build_public_days(db, plan.id, fields),
        "permission": permission,
        "can_edit": False,
        "fields": list(fields),
    }
    if "reservation_summary" in fields:
        view["reservations"] = _public_reservations(db, plan.id)
    return view


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _log_access(db: Session, *, share_id, token_hash: str, ip: str, result: str) -> None:
    db.add(ShareAccessLog(share_id=share_id, token_hash=token_hash, ip_address=ip, result=result))
    db.commit()


def _invalid_link() -> NoReturn:
    # 存在しない/失効済み/期限切れ/使用回数上限のいずれも同一の404で応答し、
    # 有効なtokenが存在するかどうかを外部から推測できないようにする。
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="この共有リンクは無効です",
                        headers=PUBLIC_HEADERS)


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
    response.headers.update(PUBLIC_HEADERS)

    ip = _client_ip(request)
    token_hash = _hash_token(token)

    # [Gate #31.5B] IPベースのレート制限(token総当たり緩和)。
    if not check_rate_limit(f"public_share_resolve:{ip}", settings.RATE_LIMIT_PUBLIC_SHARE, 60):
        _log_access(db, share_id=None, token_hash=token_hash, ip=ip, result="rate_limited")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="リクエストが多すぎます。しばらく待ってから再試行してください。",
            headers=PUBLIC_HEADERS,
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
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="パスコードが正しくありません",
                                headers=PUBLIC_HEADERS)

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
        .returning(PlanShareLink.plan_id, PlanShareLink.permission, PlanShareLink.policy)
    )
    result_row = db.execute(stmt).first()
    db.commit()

    if result_row is None:
        # 事前チェックと原子的UPDATEの間に他リクエストが上限へ到達させた
        # (同時アクセスによるレースコンディション)。
        _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="invalid")
        _invalid_link()

    plan_id, permission, policy = result_row

    # [Gate B-012] 論理削除済みプランの共有は無効(削除時にリンクも失効させているが二重に防ぐ)
    plan = db.query(TravelPlan).filter(TravelPlan.id == plan_id, TravelPlan.deleted_at.is_(None)).first()
    if not plan:
        _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="invalid")
        _invalid_link()

    _log_access(db, share_id=share.id, token_hash=token_hash, ip=ip, result="success")

    # [Gate #34] 公開ビューは正規化テーブル(travel_days/travel_events)
    # から固定スキーマで構築する。旧`plan.itinerary`は一切参照しない。
    # [Gate F45] リンクの policy で見せる項目を出し分ける。
    view = build_public_view(db, plan, share_policy.fields_of(policy), permission)
    # [Gate G4] COL-05 見直し・複製は一時トークンで(使用回数を使わない)
    view.update(share_view.issue(share))
    view["allow_clone"] = bool(share.allow_clone)
    view["policy_explained"] = share_view.explain(share)
    return view


def _active_share(db: Session, token: str) -> Any:
    share: Any = db.query(PlanShareLink).filter(PlanShareLink.token_hash == _hash_token(token)).first()
    now = datetime.now(timezone.utc)
    if share is None or share.revoked_at is not None or (share.expires_at is not None and share.expires_at <= now):
        return None
    return share


def _limit(request: Request, name: str, limit: int, window: int = 60) -> None:
    if not check_rate_limit(f"{name}:{_client_ip(request)}", limit, window):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="リクエストが多すぎます。しばらく待ってから再試行してください。", headers=PUBLIC_HEADERS)


@router.get("/{token}/info")
async def share_info(token: str, request: Request, response: Response, db: Session = Depends(get_db)):
    """[Gate G4] COL-05 開く前の確認(使用回数を使わない・中身を返さない)。"""
    response.headers.update(PUBLIC_HEADERS)
    _limit(request, "public_share_resolve", settings.RATE_LIMIT_PUBLIC_SHARE)
    share = _active_share(db, token)
    if share is None or (share.max_uses is not None and share.use_count >= share.max_uses):
        _invalid_link()
    return {
        "needs_passcode": share.passcode_hash is not None,
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "remaining_uses": None if share.max_uses is None else max(0, share.max_uses - share.use_count),
        "allow_clone": bool(share.allow_clone),
        "policy_explained": share_view.explain(share),
    }


def _viewable(db: Session, token: str, view_token: Optional[str]):
    share = _active_share(db, token)
    if share is None:
        _invalid_link()
    try:
        share_view.verify(view_token, share)
    except share_view.ViewTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, headers=PUBLIC_HEADERS, detail={
            "code": "share_view_expired", "message": "閲覧の時間が過ぎました。もう一度リンクを開いてください"})
    plan = db.query(TravelPlan).filter(TravelPlan.id == share.plan_id, TravelPlan.deleted_at.is_(None)).first()
    if plan is None:
        _invalid_link()
    return share, plan


@router.get("/{token}/view")
async def share_view_again(token: str, request: Request, response: Response, db: Session = Depends(get_db),
                           x_share_view: Optional[str] = Header(None, alias="X-Share-View")):
    """[Gate G4] COL-05 一時トークンで見直す(使用回数を使わない)。"""
    response.headers.update(PUBLIC_HEADERS)
    _limit(request, "public_share_view", 120)
    share, plan = _viewable(db, token, x_share_view)
    view = build_public_view(db, plan, share_policy.fields_of(share.policy), share.permission)
    view["allow_clone"] = bool(share.allow_clone)
    view["policy_explained"] = share_view.explain(share)
    return view


class CloneInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(default=None, max_length=200)


@router.post("/{token}/clone", status_code=201)
async def share_clone(token: str, request: Request, response: Response, body: CloneInput = CloneInput(),
                      db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user),
                      x_share_view: Optional[str] = Header(None, alias="X-Share-View")):
    """[Gate G4] COL-05 許可された項目だけを自分の新しい旅行へ複製する。"""
    response.headers.update(PUBLIC_HEADERS)
    _limit(request, "public_share_clone", 10, 3600)
    share, plan = _viewable(db, token, x_share_view)
    if not share.allow_clone:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, headers=PUBLIC_HEADERS, detail={
            "code": "clone_not_allowed", "message": "この共有では複製が許されていません"})
    title = (body.title or "").strip() or None
    new = share_view.clone_plan(db, plan, share, current_user, title)
    db.commit()
    record_audit_event(action="share_cloned", resource_type="plan", user_id=current_user.id, resource_id=new.id,
                       details={"share_id": str(share.id), "fields": share_policy.fields_of(share.policy)})
    return {"plan_id": str(new.id), "link": "/planner/%s" % new.id, "message": "自分の旅行として複製しました"}


class ReportInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., pattern="^(phishing|malware|spam|scraping|privacy|other)$")
    note: Optional[str] = Field(None, max_length=500)


@router.post("/{token}/report", status_code=202)
async def share_report(token: str, body: ReportInput, request: Request, response: Response,
                       db: Session = Depends(get_db)):
    """[Gate G4] FC-097 濫用の通報。無効なリンクでも同じ応答にする(有効なリンクかを推測させない)。"""
    response.headers.update(PUBLIC_HEADERS)
    _limit(request, "public_share_report", abuse.REPORT_LIMIT, 3600)
    share = db.query(PlanShareLink).filter(PlanShareLink.token_hash == _hash_token(token)).first()
    result = abuse.file_report(db, share, body.reason, body.note, _client_ip(request))
    if result["recorded"] and share is not None:
        record_audit_event(action="share_abuse_reported", resource_type="share_link", resource_id=share.id,
                           details={"reason": body.reason, "auto_revoked": result["auto_revoked"]})
    return {"message": "通報を受け付けました。ありがとうございます"}
