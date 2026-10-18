"""
[Gate S3] SEC-12 共有の回数制限(セキュリティ監査 F07)。

以前はプロセス内だけで数えており、複数の worker・インスタンスでは上限がその数倍に緩み、再起動で消え、
キーが増え続けた。今は Redis の sorted set で全てのプロセスが同じ数を見る(Lua で原子的に判定)。
Redis に届かない時はプロセス内で続け、/metrics に出す。

Redis を使う試験は、試験ごとに別の名前空間(RATE_LIMIT_NAMESPACE)を使い、終わったら消す。
Redis に届かない環境(CI の backend ジョブ)では Redis の試験だけを飛ばす。
"""
import threading
import uuid

import pytest
import redis as redis_lib

from app.core.config import settings
from app.ops import metrics
from app.utils import rate_limiter as rl


def _redis_reachable() -> bool:
    try:
        redis_lib.Redis.from_url(settings.REDIS_URL, socket_timeout=0.5, socket_connect_timeout=0.5).ping()
        return True
    except Exception:  # noqa: BLE001
        return False


needs_redis = pytest.mark.skipif(not _redis_reachable(), reason="Redis に届かない環境(CI の backend ジョブ等)")


@pytest.fixture()
def shared(monkeypatch):
    """Redis を使う。名前空間は試験ごとに別にし、終わったら消す。"""
    monkeypatch.setattr(settings, "RATE_LIMIT_NAMESPACE", f"tc-test-{uuid.uuid4().hex[:8]}")
    rl.set_redis_client_for_testing(None)
    rl.use_backend("redis")
    yield
    rl.reset_all()
    rl.use_backend("memory")
    rl.set_redis_client_for_testing(None)


# ---------------------------------------------------------------- プロセス内(予備)

def test_memory_limit_and_window():
    key = f"t:{uuid.uuid4().hex}"
    assert all(rl.check_rate_limit(key, 3, 60) for _ in range(3))
    assert rl.check_rate_limit(key, 3, 60) is False
    assert rl.get_remaining_attempts(key, 3, 60) == 0
    rl.reset_rate_limit(key)
    assert rl.check_rate_limit(key, 3, 60) is True


def test_memory_keys_are_bounded_and_empty_keys_removed(monkeypatch):
    monkeypatch.setattr(rl, "MAX_MEMORY_KEYS", 50)
    for i in range(200):
        rl.check_rate_limit(f"flood:{i}", 5, 60)
    assert len(rl._rate_limit_storage) <= 50
    rl._rate_limit_storage.clear()
    rl.check_rate_limit("old:1", 5, 1)
    assert rl.prune_memory(now=10**12) == 1 and not rl._rate_limit_storage


def test_denials_are_counted_by_kind_without_values():
    metrics.registry.reset()
    email_key = "login_email:victim.person@example.com"
    for _ in range(4):
        rl.check_rate_limit(email_key, 2, 60)
    text = metrics.registry.render()
    assert 'travelcanvas_rate_limited_total{kind="login_email"} 2' in text
    assert "victim.person" not in text


# ---------------------------------------------------------------- Redis(共有)

@needs_redis
def test_redis_counts_are_shared_between_processes(shared):
    key = "login_email:shared.case@example.com"
    for _ in range(5):
        assert rl.check_rate_limit(key, 5, 60)
    rl._rate_limit_storage.clear()  # 別のプロセス(このプロセスの記憶は無い)と同じ状態
    assert rl.check_rate_limit(key, 5, 60) is False
    assert rl.get_remaining_attempts(key, 5, 60) == 0


@needs_redis
def test_redis_keys_do_not_contain_identifiers(shared):
    rl.check_rate_limit("login_email:pii.check@example.com", 5, 60)
    client = redis_lib.Redis.from_url(settings.REDIS_URL)
    keys = [k.decode() for k in client.scan_iter(match=f"{settings.RATE_LIMIT_NAMESPACE}:rl:*")]
    assert len(keys) == 1
    assert "pii.check" not in keys[0] and "example.com" not in keys[0]
    members = [m.decode() for m in client.zrange(keys[0], 0, -1)]
    assert all("pii" not in m for m in members)
    assert client.pttl(keys[0]) > 0  # 期限付き(放っておいても消える)


@needs_redis
def test_redis_limit_is_atomic_under_concurrency(shared):
    key = f"burst:{uuid.uuid4().hex}"
    results = []
    barrier = threading.Barrier(20)

    def hit():
        barrier.wait()
        results.append(rl.check_rate_limit(key, 5, 60))

    threads = [threading.Thread(target=hit) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert results.count(True) == 5 and results.count(False) == 15


@needs_redis
def test_reset_all_only_touches_its_namespace(shared):
    client = redis_lib.Redis.from_url(settings.REDIS_URL)
    other = f"tc-other-{uuid.uuid4().hex[:6]}:rl:keep"
    client.set(other, "1", ex=60)
    try:
        rl.check_rate_limit("a:1", 5, 60)
        rl.check_rate_limit("b:2", 5, 60)
        assert rl.reset_all() == 2
        assert client.exists(other) == 1
    finally:
        client.delete(other)


def test_falls_back_to_memory_when_redis_is_unreachable(monkeypatch):
    metrics.registry.reset()
    monkeypatch.setattr(settings, "RATE_LIMIT_NAMESPACE", f"tc-test-{uuid.uuid4().hex[:8]}")
    dead = redis_lib.Redis(host="127.0.0.1", port=1, socket_timeout=0.2, socket_connect_timeout=0.2)
    rl.set_redis_client_for_testing(dead)
    rl.use_backend("auto")
    try:
        key = f"fallback:{uuid.uuid4().hex}"
        assert all(rl.check_rate_limit(key, 2, 60) for _ in range(2))
        assert rl.check_rate_limit(key, 2, 60) is False  # プロセス内で制限は続く
        assert "travelcanvas_rate_limiter_fallback_total 1" in metrics.registry.render()
    finally:
        rl.use_backend("memory")
        rl.set_redis_client_for_testing(None)


def test_refresh_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_REFRESH", 3)
    codes = [client.post("/api/v1/auth/refresh").status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]
