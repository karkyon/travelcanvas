"""
[Gate #27] backendには自動テスト基盤が一切存在しなかった(監査 A-010)。
本ファイルは pytest 用の最小限の共通fixtureを提供する。

方針:
- 実PostgreSQL(環境変数 DATABASE_URL で指定されたテストDB)に対して実行する。
  SQLiteなどの代替DBは、PostgreSQL固有の型(UUID等)や制約の挙動差を隠して
  しまうため使用しない。
- 各テストはトランザクションを開始し、テスト終了時にロールバックすることで
  DBを汚さずに独立性を保つ(fixture `db_session`)。
- FastAPIの `get_db` 依存性を、このトランザクション付きセッションを返す
  ものへ dependency_overrides で差し替える。
- 実行前提: `alembic upgrade head` 済みのテストDBに対して実行すること。
  誤って本番/開発DBへ向けないよう、DATABASE_URL に "test" という文字列を
  含まない場合は安全のためテスト収集自体を失敗させる。
"""
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

# 本番/開発DBを誤って対象にしないための安全確認
_db_url = os.environ.get("DATABASE_URL", "")
if "test" not in _db_url:
    raise RuntimeError(
        "DATABASE_URLに'test'という文字列が含まれていません。"
        "誤って本番/開発DBに対してpytestを実行しないよう、"
        "テスト専用DBのURLを設定してください。"
    )

from app.core.database import engine, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.core.auth import get_current_user, AuthResult  # noqa: E402
from app.models.models import User, UserType  # noqa: E402
from app.api.v1.auth import hash_password  # noqa: E402
from app.utils import rate_limiter as _rate_limiter  # noqa: E402
from app.utils.rate_limiter import _rate_limit_storage  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """[Gate #28] レート制限はプロセス内メモリ(モジュールグローバル辞書)で
    管理されており、DBトランザクションのロールバックでは戻らない。
    TestClientは常に同一の疑似IP('testclient')を使うため、これをテスト毎に
    クリアしないと、あるテストでの試行回数が別テストのレート制限判定に
    漏れ出し、テスト同士が意図せず干渉してしまう。
    [Gate S3] 本番は Redis で数えるが、試験は既定でプロセス内だけを使う(試験の間で数が残らず、CI の backend ジョブには
    Redis が無いため)。Redis を使う試験(test_gate_s3_rate_limit.py)は自分で切り替えて、終わったら戻す。"""
    _rate_limiter.use_backend("memory")
    _rate_limit_storage.clear()
    yield
    _rate_limit_storage.clear()
    _rate_limiter.use_backend("memory")


@pytest.fixture()
def db_session():
    """トランザクション境界を持つテスト用DBセッション。テスト終了時に必ずロールバックする。"""
    connection = engine.connect()
    transaction = connection.begin()
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=connection)
    session = TestingSessionLocal()

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture()
def client(db_session):
    """DB依存性をテスト用トランザクションセッションに差し替えたTestClient。"""

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def make_user(db_session):
    """テスト用ユーザーを作成するファクトリ。"""

    def _make(email: str = None, username: str = None, password: str = "TestPass123!"):
        email = email or f"user_{uuid.uuid4().hex[:10]}@example.com"
        username = username or f"user_{uuid.uuid4().hex[:10]}"
        user = User(
            id=uuid.uuid4(),
            email=email,
            username=username,
            hashed_password=hash_password(password),
            user_type=UserType.REGISTERED,
            is_active=True,
            is_verified=True,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        return user, password

    return _make


@pytest.fixture()
def auth_client(client, make_user, db_session):
    """認証済みユーザーとして振る舞うTestClient。get_current_userを直接差し替える
    (login経由のセッション/Redis往復を挟まず、ルートの実装自体を単体で検証するため)。"""

    user, password = make_user()

    def _override_current_user():
        return AuthResult(user=user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _override_current_user
    yield client, user
    app.dependency_overrides.pop(get_current_user, None)


# ---------------------------------------------------------------------------
# [Gate O2] ログの個人情報・秘密の自動検査(B-009)
#
# 試験の全実行中に出力されるすべてのログ(DEBUG 以上。SQLAlchemy は WARNING 以上)を整形して検査し、
# メールアドレス・JWT・暗号文・パスワードのハッシュ・Bearer・接続文字列の資格情報・URL のトークン・
# SQL の値、および試験中に発行・使用された秘密の値(secrets.token_* の出力、ハッシュ化・照合した
# パスワード、文書ダウンロードのトークン)が含まれていないかを見る。
# 結果は最後に実行される tests/test_zz_log_leak_scan.py が判定する。
# ---------------------------------------------------------------------------
import logging as _logging  # noqa: E402
import secrets as _secrets  # noqa: E402

from passlib.context import CryptContext as _CryptContext  # noqa: E402

from app.core.log_safety import LeakCollector as _LeakCollector  # noqa: E402
from app.services import storage_backend as _storage_backend  # noqa: E402

LEAK_COLLECTOR = _LeakCollector()


def _register_result(func, min_len=16):
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        value = result[0] if isinstance(result, tuple) else result
        if isinstance(value, str) and len(value) >= min_len:
            LEAK_COLLECTOR.add_secret(value)
        return result

    wrapper.__wrapped__ = func
    return wrapper


def _register_password(method):
    def wrapper(self, secret, *args, **kwargs):
        if isinstance(secret, str):
            LEAK_COLLECTOR.add_secret(secret)
        return method(self, secret, *args, **kwargs)

    wrapper.__wrapped__ = method
    return wrapper


def pytest_configure(config):
    if getattr(config, "_tc_leak_collector", None) is not None:
        return
    config._tc_leak_collector = LEAK_COLLECTOR
    _secrets.token_urlsafe = _register_result(_secrets.token_urlsafe)
    _secrets.token_hex = _register_result(_secrets.token_hex)
    _storage_backend.issue_download_token = _register_result(_storage_backend.issue_download_token)
    import app.api.v1.documents as _documents_api

    _documents_api.issue_download_token = _register_result(_documents_api.issue_download_token)
    _CryptContext.hash = _register_password(_CryptContext.hash)
    _CryptContext.verify = _register_password(_CryptContext.verify)
    from app.core import log_safety as _log_safety

    _log_safety.set_raw_inspector(LEAK_COLLECTOR.inspect_raw)
    root = _logging.getLogger()
    root.addHandler(LEAK_COLLECTOR)
    root.setLevel(_logging.DEBUG)
    # SQL は件数が多いので通常は WARNING 以上だけ。値が伏せられることは test_gate_o2 で別に確かめる。
    _logging.getLogger("sqlalchemy").setLevel(_logging.WARNING)
