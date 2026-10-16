"""[Gate O1] 運用(B-010): バックアップ・復元演習・監視・rollback 計画の試験。

- 純粋関数(app/ops/opslib.py)は網羅的に検査する。
- /metrics・/ready(migration の最新確認)は TestClient で検査する。
- DB の点検(件数・復号)は実 PostgreSQL のテストDBで検査する。
- 復元演習の通し試験(pg_dump → 別DBへ pg_restore → 件数・復号・migration の往復)は、
  pg_dump がある環境(サンドボックス・CI)でだけ実行する。backend コンテナには PostgreSQL の
  クライアントが無いので、omega-dev2 ではパッチが ``tcops.py drill`` を docker compose 経由で実行する。
"""
import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.ops import metrics as ops_metrics
from app.ops import opslib

BACKEND_ROOT = Path(__file__).resolve().parent.parent
UTC = timezone.utc


# ---------------------------------------------------------------- 接続文字列・DB名


def test_database_name_and_replace_keep_credentials_and_params():
    url = "postgresql://app:s3cr3t@postgres:5432/travelcanvas?sslmode=disable"
    assert opslib.database_name(url) == "travelcanvas"
    assert (
        opslib.replace_database(url, "travelcanvas_restore_drill")
        == "postgresql://app:s3cr3t@postgres:5432/travelcanvas_restore_drill?sslmode=disable"
    )
    with pytest.raises(ValueError):
        opslib.replace_database(url, "bad;name")
    with pytest.raises(ValueError):
        opslib.replace_database(url, "Travel")
    with pytest.raises(ValueError):
        opslib.database_name("not a url")


def test_mask_url_hides_credentials_and_key_values():
    s = "connect postgresql://travelcanvas_app:pw@postgres/x failed password=abc token=t1 ok"
    masked = opslib.mask_url(s)
    assert "pw@" not in masked and "abc" not in masked and "t1" not in masked
    assert "postgresql://***@postgres/x" in masked


@pytest.mark.parametrize(
    "name,live,ok",
    [
        ("travelcanvas_restore_drill", "travelcanvas", True),
        ("travelcanvas_restore_20261016", "travelcanvas", True),
        ("travelcanvas", "travelcanvas", False),  # 運用中のDB
        ("travelcanvas_copy", "travelcanvas", False),  # restore を含まない
        ("travelcanvas_restore_test", "travelcanvas", False),  # 試験用DBの名前
        ("restore; drop", "travelcanvas", False),  # 記号
        ("", "travelcanvas", False),
    ],
)
def test_check_drill_database_name(name, live, ok):
    if ok:
        opslib.check_drill_database_name(name, live)
    else:
        with pytest.raises(ValueError):
            opslib.check_drill_database_name(name, live)


# ---------------------------------------------------------------- バックアップID・manifest


def test_backup_id_roundtrip_and_listing():
    now = datetime(2026, 10, 16, 3, 10, 5, tzinfo=UTC)
    bid = opslib.new_backup_id(now)
    assert bid == "tc-20261016T031005Z"
    assert opslib.parse_backup_id(bid) == now
    assert opslib.backup_file_name(bid, "database") == bid + ".db.dump"
    with pytest.raises(ValueError):
        opslib.new_backup_id(datetime(2026, 1, 1))
    with pytest.raises(ValueError):
        opslib.parse_backup_id("tc-2026")
    names = [
        bid + ".manifest.json",
        bid + ".db.dump",
        "tc-20261015T031000Z.manifest.json",
        ".tc-20261017T000000Z.db.dump.partial",
        "tc-bad.manifest.json",
        "notes.txt",
    ]
    assert opslib.backup_ids_in(names) == [bid, "tc-20261015T031000Z"]


def _files(db_sha="a" * 64, up_sha="b" * 64):
    return {
        "database": {"name": "x.db.dump", "size": 10, "sha256": db_sha},
        "uploads": {"name": "x.uploads.tar.gz", "size": 3, "sha256": up_sha},
    }


def test_manifest_build_and_problems():
    m = opslib.build_manifest(
        backup_id="tc-20261016T031005Z",
        created_at=datetime(2026, 10, 16, 3, 10, tzinfo=UTC),
        git_commit="abc",
        alembic_revision="d3f9b1c5e7a4",
        source_database="travelcanvas",
        files=_files(),
        table_counts={"b": 2, "a": 1},
        upload_files={"documents/x": {"size": 1, "sha256": "c" * 64}},
        key_fingerprints={"ENCRYPTION_KEY": "123456789abc"},
    )
    assert m["format"] == "travelcanvas-backup" and list(m["table_counts"]) == ["a", "b"]
    assert m["created_at"] == "2026-10-16T03:10:00Z"
    assert opslib.manifest_problems(m, _files()) == []
    probs = opslib.manifest_problems(m, {"database": {"size": 11, "sha256": "f" * 64}})
    assert any("サイズ" in p for p in probs) and any("ハッシュ" in p for p in probs)
    assert any("uploads のファイルがありません" in p for p in probs)
    assert opslib.manifest_problems({"format": "other"}, {}) == ["manifest の形式が違います"]
    with pytest.raises(ValueError):
        opslib.build_manifest(
            backup_id="x",
            created_at=datetime.now(UTC),
            git_commit=None,
            alembic_revision=None,
            source_database="d",
            files=_files(db_sha="nothex"),
            table_counts={},
            upload_files={},
            key_fingerprints={},
        )


def test_key_fingerprint_does_not_reveal_key_and_detects_mismatch():
    fp = opslib.key_fingerprint("super-secret-key")
    assert fp and len(fp) == 12 and "secret" not in fp
    assert opslib.key_fingerprint(None) is None and opslib.key_fingerprint("") is None
    assert opslib.key_fingerprint("super-secret-key") == fp
    assert opslib.fingerprint_mismatches({"A": "1", "B": "2", "C": None}, {"A": "1", "B": "3", "C": "4"}) == ["B"]


def test_sha256_file(tmp_path):
    p = tmp_path / "f"
    p.write_bytes(b"abc")
    assert opslib.sha256_file(str(p)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


# ---------------------------------------------------------------- 保持期間


def test_select_backups_to_prune_keeps_daily_weekly_and_minimum():
    now = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)
    ids = [opslib.new_backup_id(now - timedelta(days=d, hours=h)) for d in range(60) for h in (2, 9)]
    victims = set(opslib.select_backups_to_prune(ids, now, keep_daily=7, keep_weekly=4, keep_min=3))
    kept = [i for i in ids if i not in victims]
    # 直近3件は必ず残る
    assert all(i in kept for i in sorted(ids, reverse=True)[:3])
    # 直近7日は各日1件以上
    for d in range(7):
        day = (now - timedelta(days=d, hours=2)).strftime("%Y%m%d")
        assert any(i[3:11] == day for i in kept)
    # 4週より前は残らない
    assert all(opslib.parse_backup_id(i) > now - timedelta(weeks=4) for i in kept)
    assert len(kept) < 20
    # 未来の日時(時計ずれ)は消さない
    future = opslib.new_backup_id(now + timedelta(days=3))
    assert future not in opslib.select_backups_to_prune(ids + [future], now)
    with pytest.raises(ValueError):
        opslib.select_backups_to_prune(ids, now, keep_min=0)


# ---------------------------------------------------------------- 復元の検証


def test_compare_table_counts():
    before = {"a": 1, "b": 5, "c": 2, "d": 3}
    after = {"a": 1, "b": 6, "c": 2, "d": 3}
    ok = opslib.compare_table_counts(before, after, {"a": 1, "b": 5, "c": 2, "d": 3})
    assert ok["ok"] and ok["unstable"] == ["b"] and ok["rows"] == 11
    bad = opslib.compare_table_counts(before, after, {"a": 0, "b": 9, "c": 2, "e": 1})
    assert not bad["ok"]
    assert {m["table"] for m in bad["mismatched"]} == {"a", "b"}
    assert bad["missing"] == ["d"] and bad["extra"] == ["e"]


def test_compare_file_listings_and_archive_paths():
    src = {"documents/a": {"size": 1, "sha256": "x"}, "documents/b": {"size": 2, "sha256": "y"}}
    assert opslib.compare_file_listings(src, dict(src))["ok"]
    res = opslib.compare_file_listings(
        src, {"documents/a": {"size": 1, "sha256": "z"}, "c": {"size": 1, "sha256": "w"}}
    )
    assert (
        not res["ok"]
        and res["missing"] == ["documents/b"]
        and res["changed"] == ["documents/a"]
        and res["extra"] == ["c"]
    )
    assert opslib.safe_archive_member("./documents/a.pdf")
    for bad in ("/etc/passwd", "../x", "a/../../x", "", "a\\b", "."):
        assert not opslib.safe_archive_member(bad)
    assert opslib.normalize_archive_path("./documents//a") == "documents/a"
    assert opslib.documents_without_files(["p/1.pdf", "p/2.png"], ["./documents/p/1.pdf"], "documents") == ["p/2.png"]


# ---------------------------------------------------------------- rollback 計画


def _real_graph():
    graph = {}
    for path in sorted((BACKEND_ROOT / "alembic" / "versions").glob("*.py")):
        rev, downs = opslib.parse_migration_source(path.read_text(encoding="utf-8"))
        graph[rev] = downs
    return graph


def test_real_migration_graph_has_single_head_matching_alembic():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    graph = _real_graph()
    heads = opslib.migration_heads(graph)
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    assert heads == sorted(ScriptDirectory.from_config(cfg).get_heads())
    assert len(heads) == 1


def test_rollback_plan_on_real_graph():
    graph = _real_graph()
    head = opslib.migration_heads(graph)[0]
    assert opslib.rollback_plan(graph, graph)["downgrade_to"] is None
    # 最新の migration が無い版(1つ前)へ戻す
    older = {k: v for k, v in graph.items() if k != head}
    plan = opslib.rollback_plan(graph, older)
    assert plan["ok"] and plan["steps"] == [head] and plan["downgrade_to"] == graph[head][0]
    # 2つ前
    prev = graph[head][0]
    older2 = {k: v for k, v in older.items() if k != prev}
    plan2 = opslib.rollback_plan(graph, older2)
    assert plan2["steps"] == [head, prev]
    # 枝分かれ(戻し先にだけある migration)は自動で戻せない
    branched = dict(older)
    branched["zz_other"] = (graph[head][0],)
    bad = opslib.rollback_plan(graph, branched)
    assert not bad["ok"] and bad["downgrade_to"] is None


def test_parse_migration_source_variants():
    assert opslib.parse_migration_source("revision = 'abc'\ndown_revision = None\n") == ("abc", ())
    assert opslib.parse_migration_source('revision: str = "abc"\ndown_revision: Union[str, None] = "x1"\n') == (
        "abc",
        ("x1",),
    )
    assert opslib.parse_migration_source("revision = 'm'\ndown_revision = ('a', 'b')\n") == ("m", ("a", "b"))
    with pytest.raises(ValueError):
        opslib.parse_migration_source("nothing")


# ---------------------------------------------------------------- 監視の判定

PROM = """# HELP x
travelcanvas_http_requests_total{method="GET",route="/a",status="2xx"} 90
travelcanvas_http_requests_total{method="GET",route="/a",status="5xx"} 10
travelcanvas_http_request_duration_seconds_bucket{route="/a",le="0.5"} 50
travelcanvas_http_request_duration_seconds_bucket{route="/a",le="1"} 90
travelcanvas_http_request_duration_seconds_bucket{route="/a",le="+Inf"} 100
"""


def test_parse_prometheus_and_quantile():
    m = opslib.parse_prometheus(PROM)
    assert opslib.metric_sum(m, "travelcanvas_http_requests_total") == 100
    assert opslib.metric_sum(m, "travelcanvas_http_requests_total", status="5xx") == 10
    b = opslib.histogram_buckets(m, "travelcanvas_http_request_duration_seconds")
    assert b[0.5] == 50 and b[float("inf")] == 100
    assert opslib.histogram_quantile(b, 0.5) == pytest.approx(0.5)
    assert opslib.histogram_quantile(b, 0.95) == pytest.approx(1.0)  # +Inf 区間は直前の上限
    assert opslib.histogram_quantile({}, 0.5) is None
    assert (
        opslib.counter_delta(5, 10) == 5 and opslib.counter_delta(15, 10) == 5 and opslib.counter_delta(1, None) == 0
    )


def _codes(findings):
    return {f["code"] for f in findings}


def test_evaluate_monitor_healthy_and_problems():
    healthy = {
        "health_ok": True,
        "ready": {"database": True, "migration_current": True},
        "containers": {"backend": "healthy", "frontend": "running"},
        "http_requests_total": 100,
        "http_5xx_total": 0,
        "disk_free_bytes": 50 * 1024**3,
        "disk_total_bytes": 100 * 1024**3,
        "last_backup_age_hours": 3,
        "last_drill_age_days": 2,
    }
    assert opslib.evaluate_monitor(healthy, None) == []
    down = dict(healthy, health_ok=False, ready=None, containers={"backend": "unhealthy"})
    assert {"backend_down", "container_unhealthy"} <= _codes(opslib.evaluate_monitor(down, None))
    not_ready = dict(healthy, ready={"database": True, "migration_current": False})
    f = opslib.evaluate_monitor(not_ready, None)
    assert _codes(f) == {"backend_not_ready"} and "migration_current" in f[0]["message"]
    prev = dict(
        healthy,
        http_requests_total=50,
        http_5xx_total=0,
        latency_buckets={"0.5": 50, "1.0": 50, "5.0": 50, "+Inf": 50},
    )
    cur = dict(
        healthy,
        http_requests_total=100,
        http_5xx_total=6,
        latency_buckets={"0.5": 55, "1.0": 60, "5.0": 100, "+Inf": 100},
    )
    f = opslib.evaluate_monitor(cur, prev)
    assert {"http_5xx", "slow_responses"} <= _codes(f)
    stale = dict(healthy, last_backup_age_hours=30, last_drill_age_days=10, disk_free_bytes=1024**3)
    assert {"backup_stale", "restore_drill_stale", "disk_low"} <= _codes(opslib.evaluate_monitor(stale, None))
    missing = dict(healthy, last_backup_age_hours=None, last_drill_age_days=None)
    assert {"backup_missing", "restore_drill_missing"} <= _codes(opslib.evaluate_monitor(missing, None))
    # 再起動(カウンタが減った)は増分=現在値として扱い、誤検知しない
    restarted = dict(healthy, http_requests_total=3, http_5xx_total=0)
    assert "http_5xx" not in _codes(opslib.evaluate_monitor(restarted, dict(healthy, http_5xx_total=4)))


def test_alert_transitions_only_on_change():
    f = [{"code": "a", "level": "warning", "message": ""}, {"code": "b", "level": "critical", "message": ""}]
    t = opslib.alert_transitions(["a", "c"], f)
    assert t == {"raised": ["b"], "resolved": ["c"], "active": ["a", "b"]}
    assert opslib.alert_transitions(["a", "b"], f)["raised"] == []


# ---------------------------------------------------------------- 定期実行


def test_cron_block_render_and_idempotent_merge():
    block = opslib.render_cron_block("/home/karkyon/projects/travelcanvas", "/usr/bin/python3")
    assert block.startswith(opslib.CRON_BEGIN) and block.rstrip().endswith(opslib.CRON_END)
    for cmd in ("backup --prune", "purge", "drill --from-latest", "monitor --quiet"):
        assert cmd in block
    existing = "MAILTO=me\n0 1 * * * /usr/bin/other\n"
    merged = opslib.merge_cron(existing, block)
    assert merged.startswith(existing) and block in merged
    assert opslib.merge_cron(merged, block) == merged  # 2回入れても1つ
    assert opslib.merge_cron(merged, None) == existing  # 取り除くと元どおり
    with pytest.raises(ValueError):
        opslib.render_cron_block("relative/path")
    with pytest.raises(ValueError):
        opslib.render_cron_block("/home/x y")
    with pytest.raises(ValueError):
        opslib.merge_cron(opslib.CRON_BEGIN + "\nabc\n", block)


def test_drill_report_has_no_secrets():
    report = opslib.render_drill_report(
        {
            "drill_id": "drill-1",
            "ok": False,
            "errors": ["failed postgresql://u:pw@h/db password=x"],
            "backup": {"backup_id": "tc-1", "database_sha256": "a" * 64},
            "restore": {"counts": {"ok": True}},
        }
    )
    assert "pw@" not in report and "password=x" not in report and "不合格" in report


# ---------------------------------------------------------------- /metrics


def test_metrics_registry_render_and_cardinality():
    reg = ops_metrics.MetricsRegistry(buckets=(0.1, 1.0))
    reg.observe("get", "/a/{id}", 200, 0.05)
    reg.observe("GET", "/a/{id}", 503, 2.0)
    reg.count_exception()
    out = reg.render()
    parsed = opslib.parse_prometheus(out)
    assert opslib.metric_sum(parsed, "travelcanvas_http_requests_total", route="/a/{id}") == 2
    assert opslib.metric_sum(parsed, "travelcanvas_http_requests_total", status="5xx") == 1
    b = opslib.histogram_buckets(parsed, "travelcanvas_http_request_duration_seconds")
    assert b == {0.1: 1, 1.0: 1, float("inf"): 2}
    assert opslib.metric_sum(parsed, "travelcanvas_unhandled_exceptions_total") == 1
    assert ops_metrics.status_class(404) == "4xx" and ops_metrics.status_class(42) == "other"


def test_metrics_access_rule():
    allowed = ops_metrics.metrics_access_allowed
    assert (
        allowed("127.0.0.1", None, None) and allowed("192.168.1.11", None, None) and allowed("172.18.0.1", None, None)
    )
    assert not allowed("203.0.113.5", None, None) and not allowed(None, None, None) and not allowed("x", None, None)
    assert allowed("203.0.113.5", "Bearer tok", "tok")
    assert not allowed("127.0.0.1", None, "tok") and not allowed("127.0.0.1", "Bearer bad", "tok")


def test_metrics_endpoint_records_route_template_not_ids(client, monkeypatch):
    from app.core.config import settings

    ops_metrics.registry.reset()
    pid = str(uuid.uuid4())
    client.get(f"/api/v1/plans/{pid}")
    client.get("/no/such/path/" + pid)
    res = client.get("/metrics")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/plain")
    assert pid not in res.text
    assert 'route="/api/v1/plans/{plan_id}"' in res.text
    assert 'route="<unmatched>",status="4xx"' in res.text
    monkeypatch.setattr(settings, "METRICS_TOKEN", "o1-token", raising=False)
    assert client.get("/metrics").status_code == 404
    assert client.get("/metrics", headers={"Authorization": "Bearer o1-token"}).status_code == 200
    assert "/metrics" not in json.dumps(app.openapi())


def test_unhandled_exception_counts_as_5xx(client, monkeypatch):
    import app.main as main_module

    ops_metrics.registry.reset()

    def boom():
        raise RuntimeError("boom")

    monkeypatch.setattr(main_module, "_check_required_routers_registered", boom)
    with TestClient(app, raise_server_exceptions=False) as c:
        assert c.get("/ready").status_code == 500
    parsed = opslib.parse_prometheus(ops_metrics.registry.render())
    assert opslib.metric_sum(parsed, "travelcanvas_http_requests_total", route="/ready", status="5xx") == 1
    assert opslib.metric_sum(parsed, "travelcanvas_unhandled_exceptions_total") == 1


# ---------------------------------------------------------------- /ready の migration 最新確認


def test_ready_reports_migration_current(client):
    body = client.get("/ready").json()
    assert body["checks"]["migration_current"] is True


def test_ready_is_503_when_db_is_behind_code(client, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(main_module, "_alembic_script_heads", lambda: frozenset({"ffffffffffff"}))
    res = client.get("/ready")
    assert res.status_code == 503
    assert res.json()["checks"]["migration_current"] is False
    assert res.json()["checks"]["migration"] is True


# ---------------------------------------------------------------- DB の点検


def test_db_inventory_counts_and_revision():
    from app.ops.db_inventory import inventory

    inv = inventory(None, with_storage_keys=True)
    heads = opslib.migration_heads(_real_graph())
    assert inv["alembic_revision"] == heads[0]
    assert "travel_plans" in inv["tables"] and "alembic_version" in inv["tables"]
    assert all(isinstance(v, int) for v in inv["tables"].values())
    assert isinstance(inv["storage_keys"], list)


def test_decrypt_check_detects_undecryptable_values():
    from app.core.crypto import encrypt_payload
    from app.core.database import engine
    from app.ops.decrypt_check import check

    table = "zz_o1_probe_" + uuid.uuid4().hex[:8]
    with engine.begin() as conn:
        conn.execute(text(f'CREATE TABLE "{table}" (id serial primary key, secret_ciphertext bytea)'))
    try:
        with engine.begin() as conn:
            conn.execute(
                text(f'INSERT INTO "{table}" (secret_ciphertext) VALUES (:a), (:b)'),
                {"a": encrypt_payload(b"ok"), "b": b"not-a-fernet-token"},
            )
        res = check(None, sample=5)
        assert not res["ok"] and res["failed"] == 1 and f"{table}.secret_ciphertext" in res["failed_columns"]
        assert "ok" not in json.dumps(res["failed_columns"]).replace('"ok"', "")  # 中身は出さない
    finally:
        with engine.begin() as conn:
            conn.execute(text(f'DROP TABLE "{table}"'))


def test_storage_facts_lists_files_and_fingerprints_only(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.ops import storage_facts

    (tmp_path / "documents" / "p").mkdir(parents=True)
    (tmp_path / "documents" / "p" / "a.bin").write_bytes(b"abc")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    roots = storage_facts.storage_roots()
    assert roots == {"uploads_root": str(tmp_path.resolve()), "documents_prefix": "documents"}
    files = storage_facts.list_files(roots["uploads_root"])
    assert files == {
        "documents/p/a.bin": {"size": 3, "sha256": opslib.sha256_file(str(tmp_path / "documents/p/a.bin"))}
    }
    fps = storage_facts.fingerprints()
    for name in storage_facts.KEY_NAMES:
        value = getattr(settings, name, None)
        assert fps[name] == opslib.key_fingerprint(value)
        if value:
            assert value not in json.dumps(fps)


# ---------------------------------------------------------------- CLI(ホスト側)の部品


def test_cli_archive_listing_rejects_path_traversal(tmp_path):
    from app.ops import cli

    good = tmp_path / "g.tar.gz"
    with tarfile.open(str(good), "w:gz") as tar:
        info = tarfile.TarInfo("./documents/a")
        info.size = 2
        tar.addfile(info, io.BytesIO(b"hi"))
    listing = cli.archive_listing(str(good), extract_to=str(tmp_path / "out"))
    assert listing == {"documents/a": {"size": 2, "sha256": opslib.sha256_file(str(tmp_path / "out/documents/a"))}}
    evil = tmp_path / "e.tar.gz"
    with tarfile.open(str(evil), "w:gz") as tar:
        info = tarfile.TarInfo("../evil")
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))
    with pytest.raises(cli.OpsError):
        cli.archive_listing(str(evil), extract_to=str(tmp_path / "out2"))
    assert not (tmp_path / "evil").exists()


def test_cli_dotenv_reader_reads_one_value(tmp_path, monkeypatch):
    from app.ops import cli

    (tmp_path / ".env").write_text("# c\nA=1\nOPS_ALERT_WEBHOOK_URL='https://hooks.example/x'\nB = 2\n")
    monkeypatch.setattr(cli, "REPO", tmp_path)
    monkeypatch.delenv("OPS_ALERT_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("B", raising=False)
    assert cli.read_dotenv_value("OPS_ALERT_WEBHOOK_URL") == "https://hooks.example/x"
    assert cli.read_dotenv_value("B") == "2"
    assert cli.read_dotenv_value("NONE") is None


def test_cli_compose_commands_never_embed_credentials():
    from app.ops import cli

    ex = cli.ComposeExecutor()
    captured = []

    def fake_run(argv, **kw):
        captured.append(list(argv))
        return subprocess.CompletedProcess(argv, 0, b"", b"")

    ex.run = fake_run  # type: ignore[assignment]
    ex.backend_alembic(["downgrade", "-1"], "travelcanvas_restore_drill")
    ex.recreate_database("travelcanvas_restore_drill")
    ex.backend_python(["-m", "app.ops.db_inventory"], target_db="travelcanvas_restore_drill")
    flat = " ".join(" ".join(c) for c in captured)
    assert "DATABASE_URL=" in flat and "postgresql://" not in flat and "PASSWORD" not in flat
    assert all(c[:4] == ["docker", "compose", "exec", "-T"] for c in captured)


def _pg_tools_match_server():
    if not shutil.which("pg_dump") or not shutil.which("pg_restore") or not shutil.which("psql"):
        return False
    from app.core.database import engine

    try:
        out = subprocess.run(["pg_dump", "--version"], stdout=subprocess.PIPE, timeout=10).stdout.decode()
        client_major = int(re.search(r"(\d+)\.", out).group(1))
        with engine.connect() as conn:
            server_major = int(conn.execute(text("SHOW server_version_num")).scalar()) // 10000
        return client_major >= server_major
    except Exception:
        return False


@pytest.mark.skipif(not _pg_tools_match_server(), reason="PostgreSQL のクライアント(サーバー以上の版)が無い環境")
def test_local_drill_end_to_end(tmp_path, monkeypatch):
    """バックアップ → 別DBへ復元 → 件数・保存ファイル・復号・鍵の指紋 → migration の往復 → 記録 → 演習DBの削除。"""
    from app.core.config import settings
    from app.core.database import engine
    from app.ops import cli

    uploads = tmp_path / "uploads"
    (uploads / "documents" / "p1").mkdir(parents=True)
    (uploads / "documents" / "p1" / "f.bin").write_bytes(os.urandom(64))
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(uploads / "documents"))
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(uploads / "documents"))
    monkeypatch.setattr(cli, "REPO", tmp_path)
    monkeypatch.setenv("OPS_STATE_DIR", str(tmp_path / "state"))

    def fake_get(url, token=None, timeout=5.0):
        path = "/" + url.split("/", 3)[3]
        with TestClient(app) as c:
            r = c.get(path)
        return r.status_code, r.text

    monkeypatch.setattr(cli, "http_get", fake_get)
    ex = cli.LocalExecutor()
    ex.backend_dir = str(BACKEND_ROOT)
    dest = tmp_path / "backups"
    dest.mkdir()
    report = tmp_path / "drill.md"
    target = "travelcanvas_restore_o1test"
    try:
        result = cli.cmd_drill(
            ex,
            dest,
            from_latest=False,
            backup_id=None,
            target="travelcanvas_restore_o1check",
            report=str(report),
            keep_db=False,
        )
        assert result["ok"], result.get("errors")
        assert result["restore"]["counts"]["ok"] and result["restore"]["files"]["files"] == 1
        assert result["migration_roundtrip"]["ok"]
        assert "合格" in report.read_text()
        with engine.connect() as conn:
            assert (
                conn.execute(text("SELECT 1 FROM pg_database WHERE datname = 'travelcanvas_restore_o1check'")).first()
                is None
            )
        bid = opslib.backup_ids_in(os.listdir(str(dest)))[0]
        for role in ("database", "uploads", "manifest"):
            assert (os.stat(str(dest / opslib.backup_file_name(bid, role))).st_mode & 0o077) == 0
        # 改ざんしたバックアップからは復元しない
        with open(str(dest / opslib.backup_file_name(bid, "database")), "ab") as fh:
            fh.write(b"x")
        with pytest.raises(cli.OpsError):
            cli.cmd_restore(ex, dest, bid, target)
    finally:
        ex.drop_database(target)
        ex.drop_database("travelcanvas_restore_o1check")
