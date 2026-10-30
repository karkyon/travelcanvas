"""[Gate CI-Redis] Redis を使う試験の共通の判定。

- 既定: Redis に届かない環境では、その試験だけを飛ばす(手元で Redis を起動していない開発者のため)
- ``TC_REQUIRE_REDIS=1``(CI の backend ジョブ): 飛ばさない。Redis に届かなければ試験を失敗させる
  (以前は CI に Redis が無く、Redis を使う試験が全て飛ばされたまま CI は合格になっていた)
"""
import os

import pytest

from app.core.config import settings

REQUIRED = os.environ.get("TC_REQUIRE_REDIS", "").strip() == "1"
SKIP_REASON = "Redis に届かない環境(手元で Redis を起動していない)"


def redis_reachable() -> bool:
    try:
        import redis

        redis.Redis.from_url(settings.REDIS_URL, socket_timeout=0.5, socket_connect_timeout=0.5).ping()
        return True
    except Exception:  # noqa: BLE001
        return False


_REACHABLE = redis_reachable()

if REQUIRED and not _REACHABLE:
    raise RuntimeError(
        "TC_REQUIRE_REDIS=1 なのに Redis(%s)に届きません。CI の Redis の service を確かめてください"
        % settings.REDIS_URL.split("@")[-1])

needs_redis = pytest.mark.skipif(not _REACHABLE, reason=SKIP_REASON)
