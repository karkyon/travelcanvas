"""[Gate PlanB-P8] もしもの案(itinerary_branches)の下書きを、日ごとの控えの案(プランB)へ移す。

- 対象: 状態が下書き(draft)で消していない案だけ。採用済み・破棄済みの案は移さない(採用の結果は本案と変更の履歴にある)
- 案の中で本案と違う日ごとに、その日付の今の案を写した控えの案を作り、案の中身(外した予定・時刻・題名・種類・並び・
  足した予定・別の日から移した予定)を当てる。名前 = 案の題名、理由 = 想定(雨→雨、遅延→遅れ、欠席→人数、予算・疲れ、
  自由→その他)。1 つの案から複数の日に作った時は「案の組」(一緒に切り替えられる)
- 写すもの: 予定(全ての列)・日の中で両端がそろう移動区間。予約そのものは写さない(つながりも写さない)
- 1 日の案は 5 つ(A〜E)まで。空きが無い日は移さない(移行の記録に出す)
- 何度実行しても同じ(移した案は variant_conditions.migrated_from_branch で分かる)。表 itinerary_branches は残す
  (確かめのため 1 版残し、次の版で消す)
- downgrade: この移行で作った控えの案(と予定・区間)だけを消す
"""
import json
import logging
import uuid
from typing import Any, Dict, List

import sqlalchemy as sa
from alembic import op

revision = "f3a8c1d5e9b2"
down_revision = "e2b7c4a9d1f3"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

FIELDS = ("title", "event_type", "local_start_time", "is_all_day", "sort_order")
REASON = {"rain": "rain", "delay": "delay", "absence": "party", "budget": "budget", "fatigue": "fatigue",
          "custom": "other"}
LABELS = ("A", "B", "C", "D", "E")


def _j(v: Any) -> Any:
    if isinstance(v, (dict, list)) or v is None:
        return v
    return json.loads(v)


def _copy_event(conn, events: sa.Table, src_id, new_id, day_id, fields: Dict[str, Any]) -> None:
    """予定を写す。列の型は DB から読んだ表(events)を使う(JSONB の urls・dining などを正しく渡す)"""
    keep = [c for c in events.c if c.name not in ("id", "day_id", "variant_standby", "parent_event_id", "created_at",
                                                    "updated_at")]
    row = conn.execute(sa.select(*keep).where(events.c.id == uuid.UUID(str(src_id)))).mappings().first()
    if row is None:
        return
    vals = dict(row)
    vals.update(fields)
    vals.update({"id": new_id, "day_id": day_id, "variant_standby": True})
    conn.execute(sa.insert(events).values(**vals))


def upgrade() -> None:
    run(op.get_bind())


def run(conn) -> Dict[str, int]:
    """移行の本体(試験からも呼ぶ)。作った案の数を返す"""
    # 列の型(JSONB・UUID・時刻)を DB から読む。型の無い表で写すと、JSONB の値(辞書・配列)を渡せない
    md = sa.MetaData()
    events = sa.Table("travel_events", md, autoload_with=conn)
    segments = sa.Table("travel_segments", md, autoload_with=conn)
    branches = conn.execute(sa.text(
        "SELECT id, plan_id, title, scenario_type, base_snapshot, content FROM itinerary_branches "
        "WHERE status = 'draft' AND deleted_at IS NULL ORDER BY created_at")).mappings().all()
    made = skipped_full = 0
    for b in branches:
        bid = str(b["id"])
        done = conn.execute(sa.text(
            "SELECT 1 FROM travel_days WHERE plan_id = :p AND variant_conditions ->> 'migrated_from_branch' = :b LIMIT 1"),
            {"p": b["plan_id"], "b": bid}).first()
        if done:
            continue
        base = _j(b["base_snapshot"]) or {}
        content = _j(b["content"]) or []
        base_ev = {e["source_event_id"]: e for e in base.get("events", [])}
        # 案の中で変わった日(外した・変えた予定の元の日、移した先の日、足した予定の日)
        touched: set = set()
        for item in content:
            src = item.get("source_event_id")
            if src is None:
                touched.add(item.get("day_id"))
                continue
            be = base_ev.get(src)
            if be is None:
                continue
            if item.get("removed") or any(item.get(f) != be.get(f) for f in FIELDS) or item.get("day_id") != be["day_id"]:
                touched.add(be["day_id"])
                touched.add(item.get("day_id"))
        touched.discard(None)
        days = []
        for day_id in touched:
            d = conn.execute(sa.text(
                "SELECT id, plan_id, local_date, timezone_id, title, sort_order FROM travel_days "
                "WHERE id = :d AND plan_id = :p AND variant_status = 'active'"),
                {"d": day_id, "p": b["plan_id"]}).mappings().first()
            if d is not None:
                days.append(d)
        if not days:
            continue
        group = uuid.uuid4() if len(days) > 1 else None
        for d in sorted(days, key=lambda x: x["local_date"]):
            used = [r[0] for r in conn.execute(sa.text(
                "SELECT variant_label FROM travel_days WHERE plan_id = :p AND local_date = :ld"),
                {"p": b["plan_id"], "ld": d["local_date"]}).all()]
            live = conn.execute(sa.text(
                "SELECT count(*) FROM travel_days WHERE plan_id = :p AND local_date = :ld AND variant_status <> 'archived'"),
                {"p": b["plan_id"], "ld": d["local_date"]}).scalar()
            label = next((x for x in LABELS if x not in used), None)
            if label is None or live >= 5:
                skipped_full += 1
                continue
            nd = uuid.uuid4()
            cond = {"note": f"もしもの案「{b['title'][:60]}」から移しました", "migrated_from_branch": bid}
            conn.execute(sa.text(
                "INSERT INTO travel_days (id, plan_id, local_date, timezone_id, title, sort_order, variant_status, "
                "variant_label, variant_name, variant_reason, variant_conditions, variant_group_id, copied_from_day_id) "
                "VALUES (:id, :p, :ld, :tz, :t, :so, 'standby', :lb, :nm, :rs, CAST(:c AS JSONB), :g, :src)"),
                {"id": nd, "p": b["plan_id"], "ld": d["local_date"], "tz": d["timezone_id"], "t": d["title"],
                 "so": d["sort_order"], "lb": label, "nm": (b["title"] or "もしもの案")[:40],
                 "rs": REASON.get(b["scenario_type"], "other"), "c": json.dumps(cond, ensure_ascii=False),
                 "g": group, "src": d["id"]})
            # この日の案の予定 = 案の中身で、この日にあって外していない予定
            idmap: Dict[str, uuid.UUID] = {}
            for item in content:
                if item.get("removed") or item.get("day_id") != str(d["id"]):
                    continue
                fields = {f: item.get(f) for f in FIELDS}
                new_id = uuid.uuid4()
                src = item.get("source_event_id")
                if src is not None:
                    _copy_event(conn, events, src, new_id, nd, fields)
                    idmap[src] = new_id
                else:
                    conn.execute(sa.insert(events).values(id=new_id, plan_id=b["plan_id"], day_id=nd,
                                                          variant_standby=True, locked=False, **fields))
            # 案に無い今の予定(案を作った後に本案へ足した予定)も写す
            for (eid,) in conn.execute(sa.text("SELECT id FROM travel_events WHERE day_id = :d"), {"d": d["id"]}).all():
                if str(eid) not in idmap and str(eid) not in base_ev:
                    new_id = uuid.uuid4()
                    _copy_event(conn, events, eid, new_id, nd, {})
                    idmap[str(eid)] = new_id
            # 移動区間: 両端が写した予定の区間
            if idmap:
                keep = [c for c in segments.c if c.name not in ("id", "created_at", "updated_at", "variant_standby")]
                rows = conn.execute(sa.select(*keep).where(
                    segments.c.to_event_id.in_([uuid.UUID(k) for k in idmap]))).mappings().all()
                for r in rows:
                    vals = dict(r)
                    frm = str(vals["from_event_id"]) if vals.get("from_event_id") else None
                    if frm is not None and frm not in idmap:
                        continue
                    vals["to_event_id"] = idmap[str(vals["to_event_id"])]
                    if frm is not None:
                        vals["from_event_id"] = idmap[frm]
                    vals.update({"id": uuid.uuid4(), "variant_standby": True})
                    conn.execute(sa.insert(segments).values(**vals))
            made += 1
    log.info("[PlanB-P8] もしもの案の下書き %d 件から控えの案を %d 件作りました(案が 5 つの日で作れなかった %d 件)",
             len(branches), made, skipped_full)
    return {"branches": len(branches), "made": made, "skipped_full": skipped_full}


def downgrade() -> None:
    conn = op.get_bind()
    ids = [r[0] for r in conn.execute(sa.text(
        "SELECT id FROM travel_days WHERE variant_conditions ->> 'migrated_from_branch' IS NOT NULL")).all()]
    if not ids:
        return
    for sql in ("DELETE FROM travel_segments WHERE to_event_id IN (SELECT id FROM travel_events WHERE day_id = ANY(:ids))",
                "DELETE FROM travel_events WHERE day_id = ANY(:ids)",
                "DELETE FROM travel_days WHERE id = ANY(:ids)"):
        conn.execute(sa.text(sql), {"ids": ids})
