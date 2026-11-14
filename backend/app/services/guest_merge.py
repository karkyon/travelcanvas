"""[Gate Remaining-7] FR-002 ゲストの持ち物を既存のアカウントへまとめる(重複の統合)。

既にアカウントを持つ人がゲストで旅行を作った時、ゲストを新しいアカウントへ昇格する代わりに、既存のアカウントへ
ゲストの全ての持ち物(旅行・思い出・予約・持ち物・支出・制約 など)を移す。

- 移す列は「users.id を指す外部キー」から自動で選ぶ(表を足しても移し漏れない)。除く表・列は下の EXCLUDE
- 一意の制約に当たる行(既存のアカウントに同じ物がある)は移さずにゲストに残し、数を返す(上書きしない)
- 既存のアカウントの旅行へゲストが共同編集者として入っていた行は消す(自分の旅行の共同編集者にしない)
- ゲストの行は無効にし(is_active=False)、ゲストのセッションは全て失効させる。ゲストの行は消さない(監査の参照を残す)
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Tuple

from sqlalchemy import Column, Table, and_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import Base

# 移さない: 監査・セッション・冪等の記録・原価の記録・利用者 1 行の表(主キーが利用者)・本人の設定の秘密
EXCLUDE_TABLES = {
    "audit_logs", "user_sessions", "idempotency_records", "sync_operations", "command_runs",
    "provider_usage_reservations", "provider_usage_events", "provider_secret_verifications", "provider_secrets",
    "mfa_reset_requests", "support_grants", "billing_customers", "billing_subscriptions", "billing_payments",
    "user_mfa", "user_private_profiles", "trip_location_settings", "plan_external_maps", "private_profile_links",
    "webauthn_credentials", "gmail_connections", "email_outbox", "organization_members", "organization_seat_events",
    "data_corrections", "offline_devices", "location_area_cells",
}
# 誰が操作したか(管理者の操作・承認)の列は移さない
EXCLUDE_COLUMNS = {"approved_by", "requested_by", "updated_by", "disabled_by",
                   "created_by_user_id@organization_domains",
                   "resolved_by_user_id", "handled_by_user_id", "override_by_user_id", "last_accessed_by",
                   "published_by", "actor_id"}


def _user_columns() -> List[Tuple[Any, Any]]:
    out = []
    for table in Base.metadata.sorted_tables:
        if table.name in EXCLUDE_TABLES or table.name == "users":
            continue
        for col in table.columns:
            if col.primary_key:
                continue
            if col.name in EXCLUDE_COLUMNS or f"{col.name}@{table.name}" in EXCLUDE_COLUMNS:
                continue
            if any(fk.target_fullname == "users.id" for fk in col.foreign_keys):
                out.append((table, col))
    return out


def merge(db: Session, guest_id: uuid.UUID, target_id: uuid.UUID) -> Dict[str, object]:
    """ゲストの持ち物を target へ移す。呼び出し元が commit する。返す値: 移した行の数・残した行の数(表ごと)。"""
    moved: Dict[str, int] = {}
    kept: Dict[str, int] = {}
    tables = {t.name: t for t in Base.metadata.sorted_tables}
    # 既存のアカウントの旅行の共同編集者のゲストの行は消す(自分の旅行に自分を招かない)
    collab, plans = tables["plan_collaborators"], tables["travel_plans"]
    target_plans = select(plans.c.id).where(plans.c.user_id == target_id)
    db.execute(collab.delete().where(and_(collab.c.user_id == guest_id, collab.c.plan_id.in_(target_plans))))

    for table_, col_ in _user_columns():
        table: Table = table_
        col: Column = col_
        key = f"{table.name}.{col.name}"
        try:
            with db.begin_nested():
                n = db.execute(update(table).where(col == guest_id).values({col.name: target_id})).rowcount
            if n:
                moved[key] = moved.get(key, 0) + n
            continue
        except IntegrityError:
            pass
        # 一意の制約に当たる行がある: 1 行ずつ移し、当たる行はゲストに残す
        pk = list(table.primary_key.columns)
        if not pk:
            kept[key] = kept.get(key, 0) + 1
            continue
        rows = db.execute(select(*pk).where(col == guest_id)).all()
        for row in rows:
            cond = and_(*[c == v for c, v in zip(pk, row)])
            try:
                with db.begin_nested():
                    db.execute(update(table).where(cond).values({col.name: target_id}))
                moved[key] = moved.get(key, 0) + 1
            except IntegrityError:
                kept[key] = kept.get(key, 0) + 1
    return {"moved": moved, "kept": kept, "moved_total": sum(moved.values()), "kept_total": sum(kept.values())}
