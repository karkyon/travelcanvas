"""[Gate TDay] 同行者への「到着予定だけ」の共有(期限つき)。

位置(座標)は持たない。持つのは 利用者の ID・向かっている予定の ID・到着予定の時刻・共有の期限 だけ。
短い間だけの情報のため DB には持たず、presence と同じ Redis(届かない時はプロセス内)に旅行ごとのハッシュで置く。
期限(until)を過ぎた共有は読む時に捨てる。期限は最長 MAX_HOURS 時間。本人はいつでも止められる(DELETE)。
"""
from __future__ import annotations

import json
import threading
import time
from typing import Dict, List, Optional

from app.utils import rate_limiter as rl

MAX_HOURS = 24
KEY_TTL_SECONDS = MAX_HOURS * 3600

_memory: Dict[str, Dict[str, dict]] = {}
_lock = threading.Lock()


def _key(plan_id: str) -> str:
    return f"{rl.namespace()}:eta:{plan_id}"


def put(plan_id: str, user_id: str, entry: dict) -> None:
    """entry は {"event_id", "arrive_at"(ISO), "until"(epoch 秒)}。at はここで入れる"""
    data = dict(entry, at=time.time())
    if rl._redis_available():  # noqa: SLF001 - 回数制限と同じ判定
        try:
            client = rl._client()  # noqa: SLF001
            pipe = client.pipeline()
            pipe.hset(_key(plan_id), user_id, json.dumps(data, separators=(",", ":")))
            pipe.expire(_key(plan_id), KEY_TTL_SECONDS)
            pipe.execute()
            return
        except Exception as e:  # noqa: BLE001 - Redis の失敗で画面を止めない
            rl._mark_down(e)  # noqa: SLF001
    with _lock:
        _memory.setdefault(plan_id, {})[user_id] = data


def remove(plan_id: str, user_id: str) -> None:
    if rl._redis_available():  # noqa: SLF001
        try:
            rl._client().hdel(_key(plan_id), user_id)  # noqa: SLF001
        except Exception as e:  # noqa: BLE001
            rl._mark_down(e)  # noqa: SLF001
    with _lock:
        (_memory.get(plan_id) or {}).pop(user_id, None)


def entries(plan_id: str, now: Optional[float] = None) -> List[dict]:
    """期限内の共有。各要素は {"user_id", "event_id", "arrive_at", "until", "at"}"""
    now = time.time() if now is None else now
    raw: Dict[str, dict] = {}
    if rl._redis_available():  # noqa: SLF001
        try:
            client = rl._client()  # noqa: SLF001
            stale = []
            for member, value in (client.hgetall(_key(plan_id)) or {}).items():
                m = member.decode() if isinstance(member, bytes) else str(member)
                try:
                    data = json.loads(value)
                except (TypeError, ValueError):
                    stale.append(m)
                    continue
                if float(data.get("until", 0)) <= now:
                    stale.append(m)
                else:
                    raw[m] = data
            if stale:
                client.hdel(_key(plan_id), *stale)
        except Exception as e:  # noqa: BLE001
            rl._mark_down(e)  # noqa: SLF001
            raw = {}
    with _lock:
        bucket = _memory.get(plan_id) or {}
        for m in [k for k, v in bucket.items() if float(v.get("until", 0)) <= now]:
            bucket.pop(m, None)
        for m, data in bucket.items():
            raw.setdefault(m, data)
    return [dict(v, user_id=k) for k, v in raw.items()]


def reset_for_testing() -> None:
    with _lock:
        _memory.clear()
