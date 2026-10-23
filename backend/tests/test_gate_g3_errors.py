"""[Gate G3] UX-04 エラーの応答の決まり(app/core/error_catalog.py・docs/spec/error-catalog.md)。

- 全てのエラーの応答に問い合わせ番号(request_id。X-Request-ID と同じ)・再試行の可否(retry)・code を足す(detail は以前のまま)
- 5xx は決まった文と問い合わせ番号だけ(例外の文を出さない)
- 入力の検証(422)は送った値(input)を返さない
- エラーの一覧の文書がコードと一致する
"""
import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import error_catalog
from app.core.auth import AuthResult, get_current_user
from app.core.database import get_db
from app.main import app

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("status,code,expected", [
    (429, None, "later"), (500, None, "later"), (503, "scan_unavailable", "later"),
    (409, "revision_conflict", "after_reload"), (409, "optimization_stale", "after_reload"),
    (409, "replan_conflict", "after_reload"), (409, "already_member", "no"), (409, None, "after_reload"),
    (428, "if_match_required", "after_reload"), (412, None, "after_reload"),
    (400, None, "no"), (403, "member_field_hidden", "no"), (404, None, "no"), (422, None, "no"),
])
def test_retry_policy(status, code, expected):
    assert error_catalog.retry_for(status, code) == expected


def test_error_responses_carry_request_id_retry_and_code(auth_client):
    client, _ = auth_client
    # ルートが無い 404
    r = client.get("/api/v1/no-such-endpoint")
    body = r.json()
    assert r.status_code == 404 and body["request_id"] == r.headers["x-request-id"] and body["retry"] == "no"
    # 構造化した detail(code つき)の 4xx は detail をそのまま残し、code を上にも出す
    p = client.post("/api/v1/travel-plans/", json={"title": "G3エラー"}).json()["id"]
    r = client.post(f"/api/v1/plans/{p}/candidates/00000000-0000-0000-0000-000000000000/merge", json={})
    assert r.status_code >= 400
    body = r.json()
    assert "detail" in body and body["request_id"] == r.headers["x-request-id"] and body["retry"] in (
        "later", "after_reload", "no")
    if isinstance(body["detail"], dict) and body["detail"].get("code"):
        assert body["code"] == body["detail"]["code"]


def test_validation_errors_do_not_echo_input(auth_client):
    client, _ = auth_client
    secret = "S3cret-value-should-not-come-back"
    r = client.post("/api/v1/travel-plans/", json={"title": {"nested": secret}})
    assert r.status_code == 422
    body = r.json()
    assert secret not in r.text
    assert isinstance(body["detail"], list) and body["detail"] and "msg" in body["detail"][0]
    assert all("input" not in e for e in body["detail"])
    assert body["retry"] == "no" and body["request_id"]


def test_internal_errors_are_generic_with_support_id(db_session, make_user, monkeypatch):
    user, _ = make_user()
    app.dependency_overrides[get_db] = lambda: (yield db_session)
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)
    from app.api.v1 import plans as plans_module

    def _boom(*_a, **_kw):
        raise RuntimeError("SELECT secret FROM users -- internal detail")

    monkeypatch.setattr(plans_module, "require_plan_access", _boom)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            r = client.get("/api/v1/plans/00000000-0000-0000-0000-000000000000/today")
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
    assert r.status_code == 500
    body = r.json()
    assert body["code"] == "internal_error" and body["retry"] == "later" and body["request_id"]
    assert body["detail"] == error_catalog.INTERNAL_ERROR_MESSAGE
    assert "SELECT" not in r.text and "internal detail" not in r.text


@pytest.mark.skipif(not (ROOT / "scripts" / "ci" / "render_error_catalog.py").is_file(),
                    reason="リポジトリの根が無い(backend コンテナの中)")
def test_error_catalog_document_matches_code():
    spec = importlib.util.spec_from_file_location("render_error_catalog", ROOT / "scripts" / "ci" /
                                                  "render_error_catalog.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.main(["--check"]) == 0
    found = mod.collect()
    for code in ("member_field_hidden", "revision_conflict", "too_many_streams", "scan_unavailable"):
        assert code in found
