"""
[Gate R2-5] QuickDraft / idempotency_records の retention purge。

docs/adr/ADR-quick-draft.md §8 で約束していたが、R2-1〜R2-4では未実装
だった処理(独立clone調査で確認した既知のギャップ)。

方針(ADR §8準拠):
- quick_drafts:
    - status='ACTIVE' かつ expires_at 経過 -> 'EXPIRED' へ遷移(論理)。
    - status='EXPIRED' かつ expires_at から7日経過 -> 物理delete。
      ただし promoted_plan_id が設定されている行(=promote済み)は
      監査目的で90日保持し、それまでpurge対象から除外する。
    - status='PROMOTED' の行はexpires_atに関わらず即purge対象にしない
      (90日保持ルールが優先される)。
- idempotency_records:
    - status IN ('COMPLETED','FAILED') かつ expires_at 経過 -> 物理delete。
    - status='IN_PROGRESS' が STALE_IN_PROGRESS_MINUTES を超えて放置されて
      いる場合は 'FAILED' へ強制遷移する(claim_or_get_cachedのcrash
      recoveryと同じ基準)。これにより次回の同一Idempotency-Keyでの
      再試行が可能になる。

このモジュールは同期SQLAlchemy Sessionを1つ受け取って動作する
(呼び出し側がcron/APScheduler/手動実行いずれからでも呼べるようにするため、
スケジューラ自体はこのGateのスコープ外とし、関数として提供するに留める)。
"""
from datetime import datetime, timedelta, timezone
from typing import Dict

from sqlalchemy.orm import Session

from app.models.models import IdempotencyRecord, QuickDraft
from app.services.quickdraft_idempotency import STALE_IN_PROGRESS_MINUTES

QUICK_DRAFT_EXPIRED_RETENTION_DAYS = 7
QUICK_DRAFT_PROMOTED_RETENTION_DAYS = 90


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def purge_expired_quickdrafts(db: Session) -> Dict[str, int]:
    """QuickDraft/idempotency_recordsのretention purgeを1回分実行する。
    戻り値は各カテゴリの処理件数(観測・テスト用)。"""
    now = _now()
    counts = {
        "quick_drafts_marked_expired": 0,
        "quick_drafts_purged": 0,
        "idempotency_records_purged": 0,
        "stale_in_progress_recovered": 0,
    }

    # 1. ACTIVE -> EXPIRED (論理遷移)
    active_drafts = db.query(QuickDraft).filter(QuickDraft.status == "ACTIVE").all()
    for draft in active_drafts:
        if _aware(draft.expires_at) <= now:
            draft.status = "EXPIRED"
            counts["quick_drafts_marked_expired"] += 1
    if counts["quick_drafts_marked_expired"]:
        db.commit()

    # 2. EXPIRED行の物理delete(promote済みは90日保持、それ以外は7日保持)
    expired_drafts = db.query(QuickDraft).filter(QuickDraft.status == "EXPIRED").all()
    for draft in expired_drafts:
        retention_days = (
            QUICK_DRAFT_PROMOTED_RETENTION_DAYS
            if draft.promoted_plan_id is not None
            else QUICK_DRAFT_EXPIRED_RETENTION_DAYS
        )
        if _aware(draft.expires_at) + timedelta(days=retention_days) <= now:
            db.delete(draft)
            counts["quick_drafts_purged"] += 1
    if counts["quick_drafts_purged"]:
        db.commit()

    # 3. stale IN_PROGRESS の crash recovery (claim_or_get_cachedと同じ基準)
    in_progress_records = (
        db.query(IdempotencyRecord).filter(IdempotencyRecord.status == "IN_PROGRESS").all()
    )
    for record in in_progress_records:
        created = record.created_at
        if not created:
            continue
        created = _aware(created)
        if now - created > timedelta(minutes=STALE_IN_PROGRESS_MINUTES):
            record.status = "FAILED"
            record.error_json = {"code": "STALE_IN_PROGRESS_TIMEOUT_PURGED"}
            counts["stale_in_progress_recovered"] += 1
    if counts["stale_in_progress_recovered"]:
        db.commit()

    # 4. COMPLETED/FAILEDのidempotency_recordsをexpires_at経過で物理delete
    purgeable = (
        db.query(IdempotencyRecord)
        .filter(
            IdempotencyRecord.status.in_(("COMPLETED", "FAILED")),
            IdempotencyRecord.expires_at <= now,
        )
        .all()
    )
    for record in purgeable:
        db.delete(record)
        counts["idempotency_records_purged"] += 1
    if counts["idempotency_records_purged"]:
        db.commit()

    return counts
