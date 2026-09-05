"""
[Gate #34] G0正本化・旧経路完全廃止の回帰テスト。

2026-09-05付監査(TravelCanvas_最新コード_再監査評価_a0475d2)で指摘された
P0-01〜P0-05に対応する:
- P0-01/4.2: /travel-plansがitineraryの書込みを受け付けてしまう二重正本状態
- P0-03: 内部例外文字列(str(e))のクライアントへの漏えい
- P0-05: 認証routerのImportErrorを握り潰して「基本機能のみ」で起動を続ける問題
- P1-06: /healthがDB/migration状態を一切確認しない問題
"""
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# P0-01 / 4.2: 旧itinerary書込み封鎖
# ---------------------------------------------------------------------------

def test_update_travel_plan_rejects_itinerary_field(auth_client):
    client, _user = auth_client
    create_res = client.post("/api/v1/travel-plans/", json={"title": "itinerary拒否テスト"})
    plan_id = create_res.json()["id"]

    res = client.put(
        f"/api/v1/travel-plans/{plan_id}",
        json={"itinerary": {"days": [{"date": "2026-10-01", "events": []}]}},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["error_code"] == "LEGACY_ITINERARY_WRITE_REJECTED"


def test_update_travel_plan_still_accepts_metadata_fields(auth_client):
    """[Gate #34] itinerary拒否がmetadata CRUD自体を壊していないことを確認する。"""
    client, _user = auth_client
    create_res = client.post("/api/v1/travel-plans/", json={"title": "metadata更新テスト"})
    plan_id = create_res.json()["id"]

    res = client.put(f"/api/v1/travel-plans/{plan_id}", json={"title": "更新後タイトル", "budget": 50000})
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "更新後タイトル"
    assert body["budget"] == 50000


def test_travel_plan_response_no_longer_writable_via_itinerary_and_stays_none(auth_client, db_session):
    """[Gate #34 回帰] itinerary書込みを試みても実データが変化しないことを、
    APIレスポンスだけでなくDB上の値でも確認する。"""
    from app.models.models import TravelPlan

    client, _user = auth_client
    create_res = client.post("/api/v1/travel-plans/", json={"title": "DB確認テスト"})
    plan_id = create_res.json()["id"]

    client.put(f"/api/v1/travel-plans/{plan_id}", json={"itinerary": {"days": []}})

    plan = db_session.query(TravelPlan).filter(TravelPlan.id == plan_id).first()
    assert plan.itinerary is None


# ---------------------------------------------------------------------------
# P0-03: 内部例外の非漏えい
# ---------------------------------------------------------------------------

def test_travel_plan_update_failure_does_not_leak_internal_exception(auth_client, monkeypatch):
    """[Gate #34] DB commit失敗時、detailに例外文字列(SQL文言等)が
    含まれないことを確認する。旧実装は f"...エラー: {str(e)}" を直接返していた。"""
    client, _user = auth_client
    create_res = client.post("/api/v1/travel-plans/", json={"title": "例外漏えい確認"})
    plan_id = create_res.json()["id"]

    def _boom_commit(self):
        raise RuntimeError("password=hunter2 connection to db failed at 10.0.0.5:5432")

    from sqlalchemy.orm import Session as SASession
    monkeypatch.setattr(SASession, "commit", _boom_commit, raising=True)

    res = client.put(f"/api/v1/travel-plans/{plan_id}", json={"title": "コミット失敗テスト"})
    assert res.status_code == 500
    body_text = res.text
    assert "hunter2" not in body_text
    assert "10.0.0.5" not in body_text
    assert "RuntimeError" not in body_text


# ---------------------------------------------------------------------------
# P1-06: readiness (/ready) 分離
# ---------------------------------------------------------------------------

def test_health_endpoint_is_pure_liveness(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "OK"


def test_ready_endpoint_reports_database_and_router_checks(client):
    res = client.get("/ready")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] is True
    assert body["checks"]["migration"] is True
    assert body["checks"]["required_routers"] is True


def test_ready_endpoint_returns_503_when_database_unreachable(client, monkeypatch):
    from app.main import _check_database_ready as _real_check  # noqa: F401
    import app.main as main_module

    monkeypatch.setattr(main_module, "_check_database_ready", lambda: False)
    res = client.get("/ready")
    assert res.status_code == 503
    assert res.json()["status"] == "not_ready"
    assert res.json()["checks"]["database"] is False


# ---------------------------------------------------------------------------
# P0-05: 認証router欠落時のfail-fast
# ---------------------------------------------------------------------------

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def test_auth_router_import_failure_crashes_startup_instead_of_degrading(monkeypatch):
    """[Gate #34] 以前は`except ImportError`で握り潰し、認証APIが完全に
    欠落した状態のまま「基本機能のみ」で起動を継続していた。本Gate以降は
    認証routerのimport失敗がそのままプロセスの起動失敗として伝播することを、
    実際に別プロセスでbuiltins.__import__を差し替えて検証する。"""
    import os

    code = textwrap.dedent(
        """
        import builtins
        real_import = builtins.__import__

        def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "app.api.v1.auth":
                raise ImportError("simulated auth import failure for Gate #34 test")
            return real_import(name, globals, locals, fromlist, level)

        builtins.__import__ = fake_import
        import app.main  # noqa: F401  -- must raise, not print-and-continue
        print("UNEXPECTED_SUCCESS")
        """
    )
    env = dict(os.environ)
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=str(_BACKEND_ROOT),
        env=env,
        timeout=30,
    )
    assert "UNEXPECTED_SUCCESS" not in proc.stdout
    assert proc.returncode != 0
