"""
[Gate R1] OpenAPI契約スキーマ生成のスモークテスト。

正式ロードマップ(DOC-09 Gate R1)は「OpenAPI JSONを生成・schema/contract
test」を要求している。本テストはFastAPIアプリからOpenAPIスキーマが
例外なく生成できること、および本Gateで開放した正規化API(/plans/*の
day/event CRUD)のパスがスキーマに存在することを確認する、最小限の
契約smoke testである。

[スコープ注記] 本格的なcontract test(レスポンススキーマの詳細な差分
検知、破壊的変更のブロック等)は、専用ツール(schemathesis等)の導入を
伴う別Gateとしてスコープ外とする。本テストは「生成できること」と
「主要パスが失われていないこと」のみを保証する。
"""
from app.main import app


def test_openapi_schema_generates_without_error():
    schema = app.openapi()
    assert schema is not None
    assert "paths" in schema
    assert "openapi" in schema


def test_openapi_schema_includes_normalized_plan_crud_paths():
    schema = app.openapi()
    paths = schema["paths"]

    expected_paths = [
        "/api/v1/plans/{plan_id}",
        "/api/v1/plans/{plan_id}/days",
        "/api/v1/plans/{plan_id}/days/{day_id}",
        "/api/v1/plans/{plan_id}/events",
        "/api/v1/plans/{plan_id}/events/{event_id}",
        "/api/v1/plans/{plan_id}/events/{event_id}/move",
        "/api/v1/plans/{plan_id}/undo",
    ]
    for path in expected_paths:
        assert path in paths, f"OpenAPI schema is missing expected path: {path}"


def test_openapi_schema_includes_guest_auth_paths():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/auth/guest" in paths
    assert "/api/v1/auth/guest/upgrade" in paths
