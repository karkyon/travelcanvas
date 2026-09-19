"""
[Gate M10 CORSバグ修正] Playwright E2Eで`/documents`系エンドポイントのみが
「CORS policyでブロック」として失敗し続けていた問題(TravelCanvas_Gate-M10_
ハンドオフ_2026-09-19.md参照)の恒久回帰テスト。

根本原因は2つ複合していた:

1. `DOCUMENT_STORAGE_DIR`の既定値(`/app/storage/documents`)が、backend
   サービスのbind mount(`./backend:/app`)配下の未管理パスであり、docker
   による所有権初期化が行われない。実行時は非root `appuser`がそこへ
   `mkdir`/`write`しようとして権限不一致(PermissionError)になり得た。
2. `upload_document`はEncryptionNotConfigured以外の例外を一切捕捉して
   おらず、上記PermissionError(OSError)が未処理例外としてFastAPI/
   Starletteのグローバル`Exception`ハンドラ(ServerErrorMiddleware)まで
   伝播していた。このハンドラはCORSMiddlewareの外側で実行されるため、
   本来ならCORSMiddlewareが付与するはずの
   `Access-Control-Allow-Origin`ヘッダーが一切付かない500レスポンスに
   なり、ブラウザからは実体(500)ではなく「CORS policyでブロック」と
   しか見えなかった。

このテストファイルは、
(a) `DOCUMENT_STORAGE_DIR`の既定値がdocker管理下の書き込み可能な
    volume配下(`/app/uploads`配下)を指すこと、
(b) ストレージ書き込みでOSError(権限不足等)が起きても、
    未処理例外にならずCORSヘッダー付きの明確な503になること、
(c) documentsに限らず、他の未処理例外(グローバルハンドラ行き)でも
    CORSヘッダーが付与されること(防御的多重化)、
の3点を固定する。
"""
import io

import pytest

from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.core import crypto as crypto_module
from app.core.database import get_db
from app.main import app
from app.services import storage_backend as storage_module
from fastapi.testclient import TestClient


PLAN_ENDPOINT = "/api/v1/travel-plans/"
_ORIGIN = "http://localhost:4173"


def test_document_storage_dir_default_is_under_docker_managed_volume():
    """[回帰] 既定値がbind mountのみの`/app/storage/...`へ逆戻りしていないこと。
    `travelcanvas_uploads`という名前付きvolume(docker-compose.yml)が
    `/app/uploads`にマウントされ、Dockerfileのbuild時にappuser所有で
    初期化されるため、その配下であれば権限問題が起きない。

    (このファイルの他のテストはautouse `_keys`フィクスチャでtmp_pathへ
    monkeypatchしてしまうため、生きている`settings`インスタンスではなく
    Settingsクラスのフィールド既定値を直接見る。)
    """
    default = type(settings).model_fields["DOCUMENT_STORAGE_DIR"].default
    assert default.startswith("/app/uploads/")


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_DOWNLOAD_SIGNING_KEY", "test-only-download-signing-key")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    monkeypatch.setattr(settings, "DOCUMENT_MAX_UPLOAD_SIZE_BYTES", 1024)
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="Gate M10 CORS回帰テスト"):
    res = client.post(PLAN_ENDPOINT, json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_upload_storage_permission_error_returns_503_with_cors_headers(auth_client, monkeypatch):
    """[回帰] 保存先ディレクトリへの書き込みでOSError(omega-dev2実運用での
    PermissionErrorを模擬)が起きても、未処理例外(CORSヘッダー欠落の500)
    ではなく、CORSヘッダー付きの明確な503になること。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    def _raise_permission_error(self, storage_key, content):
        raise PermissionError(13, "Permission denied", storage_key)

    monkeypatch.setattr(storage_module.LocalFilesystemBackend, "save", _raise_permission_error)

    files = {"file": ("receipt.pdf", io.BytesIO(b"%PDF-1.4\nmock\n"), "application/pdf")}
    res = client.post(
        f"/api/v1/plans/{plan_id}/documents/upload",
        files=files,
        headers={"Origin": _ORIGIN},
    )

    assert res.status_code == 503, res.text
    assert res.headers.get("access-control-allow-origin") == _ORIGIN
    assert res.headers.get("access-control-allow-credentials") == "true"


def test_list_documents_unaffected_by_storage_errors(auth_client, monkeypatch):
    """[回帰] 一覧取得(list_documents)はストレージに一切触れないため、
    ストレージ書き込みが失敗する状況でも通常通り200かつCORSヘッダー付きで
    応答すること(ハンドオフ資料で「GETも巻き込まれてCORS失敗した」と
    誤認されていた症状が、実際にはPOST側の問題であったことの裏付け)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    def _raise_permission_error(self, storage_key, content):
        raise PermissionError(13, "Permission denied", storage_key)

    monkeypatch.setattr(storage_module.LocalFilesystemBackend, "save", _raise_permission_error)

    res = client.get(f"/api/v1/plans/{plan_id}/documents", headers={"Origin": _ORIGIN})
    assert res.status_code == 200, res.text
    assert res.json() == []
    assert res.headers.get("access-control-allow-origin") == _ORIGIN


def test_unrelated_unhandled_exception_still_carries_cors_headers(db_session, make_user, monkeypatch):
    """[回帰・防御的多重化] documents以外のエンドポイントで想定外の未処理例外が
    発生した場合でも、グローバルExceptionハンドラがCORSヘッダーを明示的に
    付与すること(FastAPI/Starletteの既知の挙動: グローバルExceptionハンドラは
    CORSMiddlewareの外側=ServerErrorMiddleware側で実行されるため、対策なしでは
    ヘッダーが一切付かない)。

    Starletteの`TestClient.raise_server_exceptions`はコンストラクタ時にしか
    反映されないため、ここでは明示的に`raise_server_exceptions=False`で
    TestClientを構築する。
    """
    user, _password = make_user()

    def _override_get_db():
        yield db_session

    def _override_current_user():
        return AuthResult(user=user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_current_user

    from app.api.v1 import plans as plans_module

    def _boom(*_a, **_kw):
        raise RuntimeError("simulated unrelated bug, unrelated to documents")

    monkeypatch.setattr(plans_module, "require_plan_access", _boom)

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            res = client.get(
                "/api/v1/plans/00000000-0000-0000-0000-000000000000/today",
                headers={"Origin": _ORIGIN},
            )
            assert res.status_code == 500
            assert res.headers.get("access-control-allow-origin") == _ORIGIN
            assert res.headers.get("access-control-allow-credentials") == "true"
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def test_unrelated_unhandled_exception_no_cors_headers_for_disallowed_origin(db_session, make_user, monkeypatch):
    """[回帰] CORSMiddlewareと同じ判定基準であること: 許可リストに無いOriginには
    ヘッダーを付与しない(オープンリダイレクト的にどんなOriginでも許可する
    実装になっていないことの確認)。"""
    user, _password = make_user()

    def _override_get_db():
        yield db_session

    def _override_current_user():
        return AuthResult(user=user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_current_user

    from app.api.v1 import plans as plans_module

    def _boom(*_a, **_kw):
        raise RuntimeError("simulated unrelated bug")

    monkeypatch.setattr(plans_module, "require_plan_access", _boom)

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            res = client.get(
                "/api/v1/plans/00000000-0000-0000-0000-000000000000/today",
                headers={"Origin": "http://evil.example.com"},
            )
            assert res.status_code == 500
            assert "access-control-allow-origin" not in res.headers
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
