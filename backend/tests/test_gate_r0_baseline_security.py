"""
[Gate R0] baseline security / contract cleanup の回帰テスト。

対象:
- backend/app/core/security.py が削除され、参照が残っていないこと
- backend/app/core/config.py のCORS既定値から旧IP(192.168.1.248)が
  除去されていること
- 診断用エンドポイント(/test, /api/v1/auth/test,
  /api/v1/travel-plans/test/ping, /api/v1/spots/test/ping)が
  settings.DEBUG=Falseで404になり、settings.DEBUG=Trueでは従来通り
  200を返すこと
- /api/v1/health のendpoint列挙から診断用/api/v1/auth/testが
  除去されていること
"""
import importlib

import pytest

from app.core.config import settings

_DIAGNOSTIC_PATHS = [
    "/test",
    "/api/v1/auth/test",
    "/api/v1/travel-plans/test/ping",
    "/api/v1/spots/test/ping",
]


def test_dead_security_module_removed():
    """[Gate R0-2] 消費者ゼロの固定SECRET_KEYモジュールを削除済みであること。"""
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("app.core.security")


def test_cors_origins_default_has_no_stale_ip():
    """[Gate R0-3] CORS既定値に廃止済み192.168.1.248が含まれないこと。"""
    origins = settings.CORS_ORIGINS
    joined = ",".join(origins) if isinstance(origins, list) else str(origins)
    assert "192.168.1.248" not in joined


@pytest.mark.parametrize("path", _DIAGNOSTIC_PATHS)
def test_diagnostic_endpoints_return_404_when_debug_disabled(client, path, monkeypatch):
    """[Gate R0-6] 診断用エンドポイントはDEBUG=Falseで到達不能であること。"""
    monkeypatch.setattr(settings, "DEBUG", False)
    response = client.get(path)
    assert response.status_code == 404


@pytest.mark.parametrize("path", _DIAGNOSTIC_PATHS)
def test_diagnostic_endpoints_reachable_when_debug_enabled(client, path, monkeypatch):
    """[Gate R0-6] DEBUG=Trueでは従来通り200を返すこと
    (test_routes_order.pyのルート順序回帰テストとの両立を確認する)。
    """
    monkeypatch.setattr(settings, "DEBUG", True)
    response = client.get(path)
    assert response.status_code == 200


def test_api_health_no_longer_advertises_auth_test_endpoint(client):
    """[Gate R0-6] /api/v1/healthのendpoint列挙から診断用/auth/testを除去したこと。"""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert "/api/v1/auth/test" not in body.get("endpoints", [])
