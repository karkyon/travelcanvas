"""
[Gate G8] FR-004・O02 定期の処理の実行の記録(ops_job_runs)と、続いて動いているかの判定。

- 処理を包むと、始め・終わり・成否・件数だけを残す(名前・本文は残さない)。例外は失敗として残し、そのまま上げる
- 判定: ok / failing(最後が失敗・続けての失敗の回数) / overdue(最後の成功が間隔×2+10分より前) / never(記録なし)
- 30日より古い記録は次の実行で消す
- 監視(opslib.evaluate_monitor)は overdue・failing を注意にする(never は判定しない)
- 管理の画面 GET /admin/ops/jobs は管理者だけ
- 既存の定期の処理(Webhook の再送・アカウントの削除)が記録を残す
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.database import SessionLocal
from app.models.models import OpsJobRun
from app.ops import job_runs, opslib

JOB = "zz-test-job"


@pytest.fixture()
def test_job(monkeypatch):
    monkeypatch.setattr(job_runs, "EXPECTED_MINUTES", {JOB: 5})
    yield JOB
    db = SessionLocal()
    try:
        db.query(OpsJobRun).filter(OpsJobRun.job == JOB).delete()
        db.commit()
    finally:
        db.close()


def _status():
    db = SessionLocal()
    try:
        return job_runs.status(db)[0]
    finally:
        db.close()


def test_recorded_success_failure_and_states(test_job):
    assert _status()["state"] == "never"
    out = job_runs.recorded(JOB, lambda: {"ok": True, "deleted": 3, "names": ["秘密"], "nested": {"a": 1, "b": "x"}})
    assert out["deleted"] == 3
    st = _status()
    assert st["state"] == "ok" and st["last_ok"] is True and st["consecutive_failures"] == 0
    assert st["last_summary"] == {"ok": True, "deleted": 3, "nested": {"a": 1}}  # 件数・真偽だけ
    with pytest.raises(RuntimeError):
        job_runs.recorded(JOB, lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    job_runs.recorded(JOB, lambda: {"failed": 2})
    st = _status()
    assert st["state"] == "failing" and st["consecutive_failures"] == 2 and st["last_error"] is None
    # 最後の成功を古くすると overdue
    db = SessionLocal()
    try:
        old = datetime.now(timezone.utc) - timedelta(minutes=60)
        db.query(OpsJobRun).filter(OpsJobRun.job == JOB, OpsJobRun.ok.is_(True)).update(
            {"started_at": old, "finished_at": old})
        db.commit()
    finally:
        db.close()
    st = _status()
    assert st["state"] == "overdue" and st["minutes_since_success"] >= 59
    with pytest.raises(ValueError):
        job_runs.recorded("unknown-job", lambda: None)


def test_old_runs_are_pruned(test_job):
    db = SessionLocal()
    try:
        db.add(OpsJobRun(job=JOB, started_at=datetime.now(timezone.utc) - timedelta(days=31),
                         finished_at=datetime.now(timezone.utc) - timedelta(days=31), ok=True))
        db.commit()
    finally:
        db.close()
    job_runs.recorded(JOB, lambda: {"ok": True})
    db = SessionLocal()
    try:
        assert db.query(OpsJobRun).filter(OpsJobRun.job == JOB).count() == 1
    finally:
        db.close()


def test_monitor_flags_overdue_and_failing_only():
    snap = {"jobs": [
        {"job": "webhook-retry", "state": "overdue", "minutes_since_success": 47},
        {"job": "poll-deadlines", "state": "failing", "consecutive_failures": 3},
        {"job": "email-outbox", "state": "never"},
        {"job": "abuse-scan", "state": "ok"},
    ]}
    found = {f["code"]: f for f in opslib.evaluate_monitor(snap, None)}
    assert set(found) == {"job_overdue:webhook-retry", "job_failing:poll-deadlines"}
    assert "47 分" in found["job_overdue:webhook-retry"]["message"]
    assert found["job_failing:poll-deadlines"]["level"] == "warning"


def test_admin_jobs_endpoint_requires_admin(auth_client, make_user, db_session):
    client, user = auth_client
    assert client.get("/api/v1/admin/ops/jobs").status_code in (401, 403)
    from app.api.v1 import admin as admin_api
    from app.main import app

    admin_user, _ = make_user()
    app.dependency_overrides[admin_api.require_admin] = lambda: admin_user
    try:
        r = client.get("/api/v1/admin/ops/jobs")
        assert r.status_code == 200, r.text
        names = [j["job"] for j in r.json()["jobs"]]
        assert "account-deletions" in names and "plan-purge" in names and "webhook-retry" in names
        assert all(j["state"] in ("ok", "overdue", "failing", "never") for j in r.json()["jobs"])
    finally:
        app.dependency_overrides.pop(admin_api.require_admin, None)


def test_existing_jobs_record_runs():
    from app.ops import account_deletions

    db = SessionLocal()
    try:
        before = db.query(OpsJobRun).filter(OpsJobRun.job == "account-deletions").count()
    finally:
        db.close()
    assert account_deletions.main([]) == 0
    db = SessionLocal()
    try:
        rows = (db.query(OpsJobRun).filter(OpsJobRun.job == "account-deletions")
                .order_by(OpsJobRun.started_at.desc()).all())
        assert len(rows) == before + 1 and rows[0].ok is True and rows[0].finished_at is not None
        assert isinstance(rows[0].summary, dict)
        db.query(OpsJobRun).filter(OpsJobRun.id == rows[0].id).delete()
        db.commit()
    finally:
        db.close()
