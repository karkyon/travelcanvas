"""[Gate A2] Redis の接続先の設定(REDIS_URL が無い時は REDIS_HOST 等から作る)。

docker-compose は backend に REDIS_HOST=redis を渡すが、以前の設定は REDIS_URL しか読まず、無ければ localhost だった
(CI の backend は Redis に届かず、回数制限・怪しさの点数・共同編集の知らせがプロセスの中だけになっていた)。
"""
import pytest

from app.core.config import Settings

BASE = {"DATABASE_URL": "postgresql://dummy:dummy@h/db_test", "JWT_SECRET_KEY": "x" * 40}


@pytest.fixture(autouse=True)
def _no_redis_env(monkeypatch):
    """環境変数の REDIS_*(CI・サンドボックスの設定)に左右されないようにする。"""
    for name in ("REDIS_URL", "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD", "REDIS_DB"):
        monkeypatch.delenv(name, raising=False)


def _settings(**env):
    return Settings(_env_file=None, **BASE, **env)


def test_explicit_url_wins():
    s = _settings(REDIS_URL="redis://cache.example:6390/2", REDIS_HOST="ignored")
    assert s.REDIS_URL == "redis://cache.example:6390/2"


def test_built_from_host_port_password():
    assert _settings(REDIS_HOST="redis").REDIS_URL == "redis://redis:6379/0"
    s = _settings(REDIS_HOST="redis", REDIS_PORT=6380, REDIS_PASSWORD="p@ss:w/rd", REDIS_DB=3)
    assert s.REDIS_URL == "redis://:p%40ss%3Aw%2Frd@redis:6380/3"


def test_default_is_localhost():
    assert _settings().REDIS_URL == "redis://localhost:6379/0"
    assert _settings(REDIS_URL="  ", REDIS_HOST=" ").REDIS_URL == "redis://localhost:6379/0"
