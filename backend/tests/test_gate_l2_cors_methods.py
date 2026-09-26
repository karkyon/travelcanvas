"""
[Gate L2] CORSの許可メソッドが、backendに実在する全ルートのメソッドを含むことの回帰テスト。

以前は allow_methods に PATCH が無く、別オリジンのfrontendからのPATCH
(区間・経路候補・経路区間・予約×イベント紐付け・制約の編集)がブラウザの
プリフライトで拒否され、一度も送信されていなかった。
"""
import pytest

from app.main import CORS_ALLOWED_METHODS, app

_ORIGIN = "http://localhost:4173"


def _route_methods():
    methods = set()
    for route in app.routes:
        if getattr(route, "path", "").startswith("/api/v1"):
            methods.update(m for m in (getattr(route, "methods", None) or ()) if m != "HEAD")
    return methods


def test_every_route_method_is_allowed_by_cors():
    missing = _route_methods() - set(CORS_ALLOWED_METHODS)
    assert not missing, f"CORSで許可されていないメソッドのルートがあります: {sorted(missing)}"
    assert "PATCH" in _route_methods()


@pytest.mark.parametrize("method,path", [
    ("PATCH", "/api/v1/plans/00000000-0000-0000-0000-000000000000/constraints/00000000-0000-0000-0000-000000000001"),
    ("PATCH", "/api/v1/plans/00000000-0000-0000-0000-000000000000/segments/00000000-0000-0000-0000-000000000001"),
    ("PUT", "/api/v1/auth/me"),
    ("DELETE", "/api/v1/plans/00000000-0000-0000-0000-000000000000/constraints/00000000-0000-0000-0000-000000000001"),
])
def test_preflight_allows_the_method(client, method, path):
    res = client.options(path, headers={
        "Origin": _ORIGIN,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "if-match,content-type,authorization",
    })
    assert res.status_code == 200, res.text
    assert method in res.headers["access-control-allow-methods"]
    assert res.headers["access-control-allow-origin"] == _ORIGIN


def test_preflight_from_unknown_origin_is_still_rejected(client):
    res = client.options(
        "/api/v1/plans/x/constraints/y",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "PATCH"},
    )
    assert res.status_code == 400
