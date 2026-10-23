"""[Gate G3] CI-05 性能の回帰の検査。

いつも流す(CI の backend ジョブ・パッチ):
- 外部キー(単一列)に索引が無い物が 0(旅行の予定の一覧・旅行の完全削除の連鎖の削除が件数に比例して遅くなる)
- 主な読み取りの経路の SQL の数が、データの件数に比例して増えない(N+1 の検出。少ない時と多い時を比べる)
- 主な問い合わせが索引を使える(EXPLAIN。結果を TC_PERF_OUT の場所へ残す)

大きいデータ(TC_PERF=1。毎晩の .github/workflows/perf.yml):
- 1つの旅行に予定 TC_PERF_EVENTS 件(既定 10,000)、通知 TC_PERF_RECORDS 件(既定 100,000)を入れ、主な画面の API の
  p95(20回の中の95パーセンタイル)が上限以下・SQL の数が少ない時と同じであることを確かめ、結果を JSON で残す
"""
import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import event, text

from app.core.database import engine
from app.services.booklet import SECTIONS as BOOKLET_SECTIONS
from app.models.models import Notification, Reservation, TravelDay, TravelEvent, TravelPlan

OUT = os.environ.get("TC_PERF_OUT")
BIG = os.environ.get("TC_PERF") == "1"
N_EVENTS = int(os.environ.get("TC_PERF_EVENTS", "10000"))
N_RECORDS = int(os.environ.get("TC_PERF_RECORDS", "100000"))

# p95 の上限(ミリ秒。CI の標準の機械で十分な余裕を持たせた値。超えたら毎晩の検査が落ちる)
P95_LIMIT_MS = {
    # サンドボックス(2026-10-22、予定 10,000・通知 100,000)の実測の約3倍。CI の機械の遅さを見込む
    "plan_detail": 2500,      # 実測 738ms(以前は日ごとの N+1 で SQL 367回)
    "plan_search": 2000,      # 533ms
    "plan_list": 800,         # 7ms
    "reservations": 1500,     # 12ms
    "calendar_ics": 4000,     # 978ms
    "notifications": 800,     # 17ms
    "journey": 7000,          # 2,262ms
    "visits": 2000,           # 480ms
    "booklet_preview": 3000,  # 779ms
    "validation_run": 8000,   # 2,556ms
}


@contextmanager
def count_queries():
    box = {"n": 0}

    def before(conn, cursor, statement, params, context, executemany):
        if not statement.lstrip().upper().startswith(("SAVEPOINT", "RELEASE", "ROLLBACK")):
            box["n"] += 1

    event.listen(engine, "before_cursor_execute", before)
    try:
        yield box
    finally:
        event.remove(engine, "before_cursor_execute", before)


def _seed(db, owner, events, reservations=0, notifications=0, days=None):
    plan = TravelPlan(id=uuid.uuid4(), user_id=owner.id, title="性能G3", revision=1)
    db.add(plan)
    db.flush()
    n_days = days or max(1, min(365, events // 30 or 1))
    start = date(2027, 1, 1)
    day_rows = [TravelDay(id=uuid.uuid4(), plan_id=plan.id, local_date=start + timedelta(days=i),
                          timezone_id="Asia/Tokyo", sort_order=i) for i in range(n_days)]
    db.add_all(day_rows)
    db.flush()
    db.add_all([TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=day_rows[i % n_days].id, title="予定 %d" % i,
                            event_type="activity", local_start_time="%02d:%02d" % (8 + (i // 60) % 12, i % 60),
                            sort_order=i) for i in range(events)])
    db.add_all([Reservation(id=uuid.uuid4(), plan_id=plan.id, type="restaurant", provider_name="店 %d" % i)
                for i in range(reservations)])
    db.add_all([Notification(id=uuid.uuid4(), user_id=owner.id, type="info", title="通知 %d" % i)
                for i in range(notifications)])
    db.flush()
    return str(plan.id)


SCENARIOS = {
    "plan_detail": lambda p: "/api/v1/plans/%s" % p,
    "plan_search": lambda p: "/api/v1/plans/%s/search?q=%s" % (p, "予定"),
    "plan_list": lambda p: "/api/v1/travel-plans/",
    "reservations": lambda p: "/api/v1/plans/%s/reservations" % p,
    "calendar_ics": lambda p: "/api/v1/plans/%s/exports/calendar.ics" % p,
    "notifications": lambda p: "/api/v1/notifications/",
    "journey": lambda p: "/api/v1/plans/%s/journey" % p,
    "visits": lambda p: "/api/v1/plans/%s/visits" % p,
    "booklet_preview": lambda p: ("POST", "/api/v1/plans/%s/booklet/preview" % p, {"sections": list(BOOKLET_SECTIONS)}),
    "validation_run": lambda p: ("POST", "/api/v1/plans/%s/validation-runs" % p, None),
}


def _measure(client, path, repeat=1):
    method, url, body = path if isinstance(path, tuple) else ("GET", path, None)
    times, queries, status = [], [], None
    for _ in range(repeat):
        with count_queries() as q:
            t = time.perf_counter()
            res = client.request(method, url, json=body)
            times.append((time.perf_counter() - t) * 1000)
        status = res.status_code
        queries.append(q["n"])
    times.sort()
    p95 = times[min(len(times) - 1, int(round(0.95 * (len(times) - 1))))]
    return {"status": status, "p95_ms": round(p95, 1), "queries": max(queries)}


def _write(name, data):
    if not OUT:
        return
    Path(OUT).mkdir(parents=True, exist_ok=True)
    (Path(OUT) / name).write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")


def test_every_foreign_key_has_an_index(db_session):
    rows = db_session.execute(text(
        "SELECT c.conrelid::regclass::text, a.attname FROM pg_constraint c "
        "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] "
        "WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND NOT EXISTS ("
        "SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])")).fetchall()
    assert [("%s.%s" % r) for r in rows] == []


def test_read_paths_do_not_issue_queries_per_row(auth_client, db_session):
    """N+1 の検出: 予定・日・予約・通知が10倍になっても、1回の要求の SQL の数は増えない。"""
    client, owner = auth_client
    small = _seed(db_session, owner, events=20, reservations=3, notifications=5, days=4)
    big = _seed(db_session, owner, events=200, reservations=30, notifications=50, days=40)
    report = {}
    for name, path in SCENARIOS.items():
        a = _measure(client, path(small))
        b = _measure(client, path(big))
        assert a["status"] in (200, 201) and b["status"] in (200, 201), (name, a, b)
        report[name] = {"small_queries": a["queries"], "big_queries": b["queries"]}
        assert b["queries"] <= a["queries"] + 2, "%s: SQL の数が件数に比例して増えている(N+1): %s" % (name, report[name])
    _write("perf-queries.json", report)


def test_main_queries_can_use_indexes(db_session):
    """主な問い合わせ(旅行ごとの予定・日・予約、利用者ごとの通知・旅行)が索引を使える(順次の読み取りに頼らない)。"""
    plan_id, user_id = uuid.uuid4(), uuid.uuid4()
    queries = {
        "events_by_plan": ("SELECT * FROM travel_events WHERE plan_id = :p ORDER BY sort_order", {"p": plan_id}),
        "events_by_day": ("SELECT * FROM travel_events WHERE day_id = :p", {"p": plan_id}),
        "days_by_plan": ("SELECT * FROM travel_days WHERE plan_id = :p", {"p": plan_id}),
        "reservations_by_plan": ("SELECT * FROM reservations WHERE plan_id = :p", {"p": plan_id}),
        "notifications_by_user": ("SELECT * FROM notifications WHERE user_id = :u", {"u": user_id}),
        "plans_by_user": ("SELECT * FROM travel_plans WHERE user_id = :u", {"u": user_id}),
        "collaborators_by_plan": ("SELECT * FROM plan_collaborators WHERE plan_id = :p", {"p": plan_id}),
        "sessions_by_user": ("SELECT * FROM user_sessions WHERE user_id = :u", {"u": user_id}),
    }
    db_session.execute(text("SET LOCAL enable_seqscan = off"))
    plans = {}
    for name, (sql, params) in queries.items():
        plan = db_session.execute(text("EXPLAIN (FORMAT JSON) " + sql), params).scalar()
        plans[name] = plan
        dump = json.dumps(plan)
        assert "Seq Scan" not in dump, "%s が索引を使えない: %s" % (name, dump[:400])
    _write("perf-explain.json", plans)


@pytest.mark.skipif(not BIG, reason="大きいデータの性能の検査は毎晩(TC_PERF=1)")
def test_large_data_latency_budget(auth_client, db_session):
    client, owner = auth_client
    small = _seed(db_session, owner, events=50, reservations=5, notifications=10, days=10)
    big = _seed(db_session, owner, events=N_EVENTS, reservations=200, notifications=N_RECORDS, days=365)
    db_session.execute(text("ANALYZE travel_events"))
    db_session.execute(text("ANALYZE notifications"))
    report = {"events": N_EVENTS, "records": N_RECORDS, "scenarios": {}}
    problems = []
    for name, path in SCENARIOS.items():
        _measure(client, path(big))  # 温める
        base = _measure(client, path(small))
        res = _measure(client, path(big), repeat=20)
        res["small_queries"] = base["queries"]
        report["scenarios"][name] = res
        if res["status"] not in (200, 201):
            problems.append("%s: %s" % (name, res["status"]))
        if res["p95_ms"] > P95_LIMIT_MS[name]:
            problems.append("%s: p95 %.0fms > 上限 %dms" % (name, res["p95_ms"], P95_LIMIT_MS[name]))
        if res["queries"] > base["queries"] + 2:
            problems.append("%s: SQL の数 %d(少ない時 %d)" % (name, res["queries"], base["queries"]))
    _write("perf-large.json", report)
    assert problems == [], problems
