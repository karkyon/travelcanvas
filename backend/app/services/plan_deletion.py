"""
[Gate B-012] プランの2段階削除(論理削除 → 猶予期間 → 完全削除)。

DOC-02 §5「登録旅行: 猶予後削除 / ゲスト: 即時共有失効 / 予約・文書: 削除 / 監査: 独立保持」、
EX-015「削除済みプランへ更新を適用しない」、FC-099「Object・共有を追跡削除」に対応する。

- soft_delete_plan: deleted_at・削除者・purge_after(既定30日後)を記録し、共有リンクを即時失効。
  以後 require_plan_access 等はこのプランを存在しない(404)ものとして扱う。
- restore_plan: 猶予期間内なら所有者が復元できる。共有リンクは失効したまま(再発行が必要)。
- purge_plan: 文書の実ファイルを先に消し(1件でも失敗したら保留して次回再試行)、その後
  `DELETE FROM travel_plans` 1文で子データごと物理削除する。プラン内の横の参照
  (予約→予定、参加者→共同編集者等)は DEFERRABLE なので、SET CONSTRAINTS ALL DEFERRED で
  検査をコミット時まで遅らせる(migration e5b9c2d8f341)。
- purge_expired_plans: purge_after を過ぎた論理削除済みプランを完全削除する(運用バッチ)。

監査ログにはプランIDと件数だけを記録し、題名等の内容は記録しない。
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from sqlalchemy import delete, func, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import Document, DocumentPurgeStatus, PlanShareLink, TravelPlan
from app.services.audit_service import record_audit_event
from app.services.storage_backend import get_storage_backend

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def grace_period() -> timedelta:
    return timedelta(days=max(0, int(settings.PLAN_DELETE_GRACE_DAYS)))


def soft_delete_plan(
    db: Session, plan: TravelPlan, user_id: Optional[uuid.UUID], now: Optional[datetime] = None,
) -> int:
    """論理削除し、共有リンクを即時失効させる。戻り値は失効させた共有リンク数。呼出側でcommitする。"""
    now = now or _now()
    plan.deleted_at = now
    plan.deleted_by_user_id = user_id
    plan.purge_after = now + grace_period()
    revoked = (
        db.query(PlanShareLink)
        .filter(PlanShareLink.plan_id == plan.id, PlanShareLink.revoked_at.is_(None))
        .update({PlanShareLink.revoked_at: now}, synchronize_session=False)
    )
    return int(revoked or 0)


def restore_plan(plan: TravelPlan) -> None:
    """論理削除を取り消す。呼出側で猶予期間内か・所有者かを確認し、commitする。"""
    plan.deleted_at = None
    plan.deleted_by_user_id = None
    plan.purge_after = None


def _purge_documents(db: Session, plan_id: uuid.UUID) -> bool:
    """プランの文書を論理削除扱いにして実ファイルを消す。全て消せたらTrue。"""
    docs: List[Document] = db.query(Document).filter(Document.plan_id == plan_id).all()
    if not docs:
        return True
    backend = get_storage_backend()
    now = _now()
    ok = True
    for d in docs:
        if d.deleted_at is None:
            d.deleted_at = now
        if d.purge_status == DocumentPurgeStatus.PURGED.value:
            continue
        try:
            backend.delete(d.storage_key)
            d.purge_status = DocumentPurgeStatus.PURGED.value
        except (OSError, ValueError):
            d.purge_status = DocumentPurgeStatus.FAILED.value
            ok = False
    db.commit()
    return ok


def _row_counts(db: Session, plan_id: uuid.UUID) -> Dict[str, int]:
    counts = {}
    for table in ("travel_days", "travel_events", "reservations", "documents", "travel_segments", "route_options"):
        sql = text(f"SELECT count(*) FROM {table} WHERE plan_id = :p")
        counts[table] = int(db.execute(sql, {"p": plan_id}).scalar())
    return counts


def purge_plan(
    db: Session, plan: TravelPlan, actor_user_id: Optional[uuid.UUID] = None, reason: str = "expired",
) -> bool:
    """論理削除済みプランを子データごと物理削除する。文書ファイルを消せなければFalse(再試行待ち)。"""
    if plan.deleted_at is None:
        raise ValueError("論理削除されていないプランは完全削除できません")
    plan_id = plan.id
    if not _purge_documents(db, plan_id):
        logger.warning("plan purge postponed: document file deletion failed plan_id=%s", plan_id)
        return False
    counts = _row_counts(db, plan_id)
    try:
        db.execute(text("SET CONSTRAINTS ALL DEFERRED"))
        db.execute(delete(TravelPlan).where(TravelPlan.id == plan_id))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("plan purge failed plan_id=%s", plan_id)
        raise
    db.expire_all()
    record_audit_event(
        action="plan.purge", resource_type="travel_plan", user_id=actor_user_id, resource_id=plan_id,
        details={"reason": reason, "counts": counts},
    )
    return True


def purge_expired_plans(db: Session, now: Optional[datetime] = None, batch_limit: int = 50) -> Dict[str, int]:
    """猶予期間を過ぎた論理削除済みプランを完全削除する。戻り値は件数(観測・テスト用)。"""
    now = now or _now()
    result = {"purged": 0, "postponed": 0, "failed": 0}
    plans = (
        db.query(TravelPlan)
        .filter(TravelPlan.deleted_at.isnot(None), TravelPlan.purge_after <= now)
        .order_by(TravelPlan.purge_after.asc())
        .limit(batch_limit)
        .all()
    )
    for plan in plans:
        try:
            if purge_plan(db, plan, reason="expired"):
                result["purged"] += 1
            else:
                result["postponed"] += 1
        except Exception:
            result["failed"] += 1
    return result


def count_deleted_plans(db: Session) -> int:
    return int(db.query(func.count(TravelPlan.id)).filter(TravelPlan.deleted_at.isnot(None)).scalar() or 0)
