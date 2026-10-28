"""回数制限(レート制限)。

[Gate S3] SEC-12(セキュリティ監査 F07)
以前はプロセス内の dict/deque だけで数えていた。
- 複数の worker・複数のコンテナ(Cloud Run の複数インスタンス)では、それぞれが別々に数えるため、
  上限が「インスタンスの数」倍に緩む。AI を使った分散攻撃(多数の IP・多数の要求)に対して、
  「同じアカウントへのログイン試行は1分5回」という制限が実質効かなかった。
- 再起動で数がリセットされた。
- 空になったキーも消えず、キーの数に上限が無かった(大量の偽 IP・偽メールでメモリを増やせた)。

今は Redis(settings.REDIS_URL。セッションと同じ)の sorted set による「滑る時間窓」で、全ての worker・
インスタンスが同じ数を見る。判定と追加は Lua スクリプトで1回の往復・原子的に行う。
- キーはハッシュにする(login_email:<メール> のように個人情報を含むため、Redis に平文で残さない)。
- Redis に届かない時は、プロセス内の制限で続ける(全て拒否すると認証が止まり、全て許すと守りが無くなるため、
  その間だけ「インスタンスごとの制限」に下がる)。切り替わったことは /metrics と警告ログで分かる。
- 拒否した回数は種類(キーの「:」より前)ごとに /metrics へ出す(連続攻撃の検知に使う)。
"""
from __future__ import annotations

import hashlib
import logging
import threading
import time
import uuid
from collections import OrderedDict, deque
from typing import Any, Deque, Dict, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------- プロセス内(予備)

MAX_MEMORY_KEYS = 50_000
# 試験(conftest)が直接 clear() する互換のため、名前と型(dict 互換)を保つ
_rate_limit_storage: "OrderedDict[str, Deque[float]]" = OrderedDict()
_memory_lock = threading.Lock()


def _memory_check(key: str, limit: int, window_seconds: int, now: float) -> bool:
    with _memory_lock:
        timestamps = _rate_limit_storage.get(key)
        if timestamps is None:
            timestamps = deque()
            _rate_limit_storage[key] = timestamps
            while len(_rate_limit_storage) > MAX_MEMORY_KEYS:  # 古いキーから捨てる(上限)
                _rate_limit_storage.popitem(last=False)
        else:
            _rate_limit_storage.move_to_end(key)
        window_start = now - window_seconds
        while timestamps and timestamps[0] <= window_start:
            timestamps.popleft()
        if len(timestamps) >= limit:
            return False
        timestamps.append(now)
        return True


def _memory_count(key: str, window_seconds: int, now: float) -> int:
    with _memory_lock:
        timestamps = _rate_limit_storage.get(key)
        if not timestamps:
            return 0
        window_start = now - window_seconds
        while timestamps and timestamps[0] <= window_start:
            timestamps.popleft()
        if not timestamps:
            del _rate_limit_storage[key]  # 空になったキーは消す
            return 0
        return len(timestamps)


def prune_memory(now: Optional[float] = None, max_window_seconds: int = 24 * 3600) -> int:
    """空・古いキーを消す(戻り値は消した数)。"""
    now = time.time() if now is None else now
    removed = 0
    with _memory_lock:
        for key in list(_rate_limit_storage.keys()):
            timestamps = _rate_limit_storage[key]
            while timestamps and timestamps[0] <= now - max_window_seconds:
                timestamps.popleft()
            if not timestamps:
                del _rate_limit_storage[key]
                removed += 1
    return removed


# ---------------------------------------------------------------- Redis(共有)

_LUA_HIT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  redis.call('PEXPIRE', key, window)
  return 0
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return 1
"""

_state: Dict[str, Any] = {"backend": "auto", "client": None, "script": None, "down_until": 0.0, "warned": 0.0}
_state_lock = threading.Lock()
REDIS_RETRY_SECONDS = 30
REDIS_TIMEOUT_SECONDS = 0.5


def namespace() -> str:
    try:
        from app.core.config import settings

        return getattr(settings, "RATE_LIMIT_NAMESPACE", None) or "tc"
    except Exception:  # noqa: BLE001
        return "tc"


def redis_key(key: str) -> str:
    """Redis のキー。元のキー(メール・IP を含む)はハッシュにする。"""
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:40]
    return f"{namespace()}:rl:{digest}"


def use_backend(name: str) -> None:
    """'auto'(Redis、届かなければプロセス内)/ 'memory'(プロセス内だけ。試験用)/ 'redis'(Redis だけ)"""
    if name not in ("auto", "memory", "redis"):
        raise ValueError(name)
    with _state_lock:
        _state["backend"] = name
        _state["down_until"] = 0.0


def current_backend() -> str:
    return str(_state["backend"])


def _client():
    with _state_lock:
        if _state["client"] is not None:
            return _state["client"]
        import redis

        from app.core.config import settings

        client = redis.Redis.from_url(
            settings.REDIS_URL, socket_timeout=REDIS_TIMEOUT_SECONDS,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS, health_check_interval=30)
        _state["client"] = client
        _state["script"] = client.register_script(_LUA_HIT)
        return client


def set_redis_client_for_testing(client) -> None:
    with _state_lock:
        _state["client"] = client
        _state["script"] = client.register_script(_LUA_HIT) if client is not None else None
        _state["down_until"] = 0.0


def _mark_down(error: Exception) -> None:
    now = time.time()
    _state["down_until"] = now + REDIS_RETRY_SECONDS
    _count_fallback()
    if now - float(_state["warned"]) > 60:
        _state["warned"] = now
        logger.warning("rate limiter: Redis に届かないため、プロセス内の制限で続けます(%s)", type(error).__name__)


def _redis_available() -> bool:
    backend = _state["backend"]
    if backend == "memory":
        return False
    if backend == "auto" and time.time() < float(_state["down_until"]):
        return False
    return True


def _redis_hit(key: str, limit: int, window_seconds: int, now: float) -> bool:
    _client()
    script = _state["script"]
    member = f"{now:.6f}-{uuid.uuid4().hex[:8]}"
    result = script(keys=[redis_key(key)], args=[int(now * 1000), int(window_seconds * 1000), int(limit), member])
    return int(result) == 1


def _redis_count(key: str, window_seconds: int, now: float) -> int:
    client = _client()
    k = redis_key(key)
    return int(client.zcount(k, int((now - window_seconds) * 1000) + 1, "+inf"))


# ---------------------------------------------------------------- 監視

def _count_denied(key: str) -> None:
    try:
        from app.ops import metrics

        metrics.registry.count_rate_limited(key.split(":", 1)[0] or "unknown")
    except Exception:  # noqa: BLE001 - 監視の失敗で判定を止めない
        pass


def _count_fallback() -> None:
    try:
        from app.ops import metrics

        metrics.registry.count_rate_limiter_fallback()
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------- 公開の関数(従来と同じ形)

def check_rate_limit(key: str, limit: int, window_seconds: int) -> bool:
    """制限内なら True(この要求を1回として数える)、超えていれば False。"""
    now = time.time()
    allowed: Optional[bool] = None
    if _redis_available():
        try:
            allowed = _redis_hit(key, limit, window_seconds, now)
        except Exception as error:  # noqa: BLE001
            if _state["backend"] == "redis":
                raise
            _mark_down(error)
    if allowed is None:
        allowed = _memory_check(key, limit, window_seconds, now)
    if not allowed:
        _count_denied(key)
    return allowed


def get_remaining_attempts(key: str, limit: int, window_seconds: int) -> int:
    """残り試行回数"""
    now = time.time()
    if _redis_available():
        try:
            return max(0, limit - _redis_count(key, window_seconds, now))
        except Exception as error:  # noqa: BLE001
            if _state["backend"] == "redis":
                raise
            _mark_down(error)
    return max(0, limit - _memory_count(key, window_seconds, now))


def reset_rate_limit(key: str) -> None:
    """レート制限をリセット"""
    with _memory_lock:
        _rate_limit_storage.pop(key, None)
    if _redis_available():
        try:
            _client().delete(redis_key(key))
        except Exception as error:  # noqa: BLE001
            _mark_down(error)


def reset_all() -> int:
    """全ての制限を消す(試験・E2E の前の準備用)。戻り値は Redis で消したキーの数。"""
    with _memory_lock:
        _rate_limit_storage.clear()
    removed = 0
    if _state["backend"] != "memory":
        try:
            client = _client()
            for k in client.scan_iter(match=f"{namespace()}:rl:*", count=500):
                client.delete(k)
                removed += 1
        except Exception as error:  # noqa: BLE001
            _mark_down(error)
    return removed
