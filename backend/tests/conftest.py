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

from app.core.database import engine, SessionLocal, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.core.auth import get_current_user, AuthResult  # noqa: E402
from app.models.models import User, UserType  # noqa: E402
from app.api.v1.auth import hash_password  # noqa: E402
from app.utils.rate_limiter import _rate_limit_storage  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """[Gate #28] レート制限はプロセス内メモリ(モジュールグローバル辞書)で
    管理されており、DBトランザクションのロールバックでは戻らない。
    TestClientは常に同一の疑似IP('testclient')を使うため、これをテスト毎に
    クリアしないと、あるテストでの試行回数が別テストのレート制限判定に
    漏れ出し、テスト同士が意図せず干渉してしまう。"""
    _rate_limit_storage.clear()
    yield
    _rate_limit_storage.clear()


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
