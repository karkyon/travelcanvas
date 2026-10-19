"""
[Gate C1] FR-020 共同編集(準リアルタイム): 同じ旅行を開いている人と、編集中の予定。

短い間だけの情報のため DB には持たない。Redis(回数制限と同じ接続・名前空間。app/utils/rate_limiter.py)に
旅行ごとのハッシュで置き、各端末は数秒ごとに「開いている」と知らせる(POST /plans/{id}/presence)。
最後の知らせから TTL_SECONDS を過ぎた端末は「いない」とする。Redis に届かない時はプロセス内で続ける
(1つのプロセスの中でだけ見える。回数制限と同じ方針)。

持つのは 利用者の ID・端末の印(画面が作る乱数)・編集中の予定の ID・時刻 だけ。予定の内容・座標は持たない。
"""
from __future__ import annotations

import json
import threading
import time
from typing import Dict, List, Optional

from app.utils import rate_limiter as rl

TTL_SECONDS = 40
KEY_TTL_SECONDS = 120
MAX_ENTRIES_PER_PLAN = 200

_memory: Dict[str, Dict[str, dict]] = {}
_lock = threading.Lock()


def _key(plan_id: str) -> str:
    return f"{rl.namespace()}:presence:{plan_id}"


def _use_redis() -> bool:
    return rl._redis_available()  # noqa: SLF001 - 回数制限と同じ判定(届かない間はプロセス内)


def _memory_touch(plan_id: str, member: str, entry: dict, now: float) -> None:
    with _lock:
        bucket = _memory.setdefault(plan_id, {})
        bucket[member] = entry
        stale = [k for k, v in bucket.items() if now - float(v.get("at", 0)) > TTL_SECONDS]
        for k in stale:
            bucket.pop(k, None)
        if len(bucket) > MAX_ENTRIES_PER_PLAN:
            oldest = sorted(bucket.items(), key=lambda kv: float(kv[1].get("at", 0)))
            for k, _v in oldest[:len(bucket) - MAX_ENTRIES_PER_PLAN]:
                bucket.pop(k, None)
        if len(_memory) > 5000:  # 旅行の数が増え続けないよう、空の旅行と古い旅行を捨てる
            for pid in [p for p, b in _memory.items() if not b][:1000]:
                _memory.pop(pid, None)


def touch(plan_id: str, member: str, entry: dict, now: Optional[float] = None) -> None:
    """端末が開いていることを記録する(entry は {"user_id", "editing"} 。at は ここで入れる)。"""
    now = time.time() if now is None else now
    data = dict(entry, at=now)
    if _use_redis():
        try:
            client = rl._client()  # noqa: SLF001
            key = _key(plan_id)
            pipe = client.pipeline()
            pipe.hset(key, member, json.dumps(data, separators=(",", ":")))
            pipe.expire(key, KEY_TTL_SECONDS)
            pipe.execute()
            return
        except Exception as e:  # noqa: BLE001 - Redis の失敗で画面を止めない
            rl._mark_down(e)  # noqa: SLF001
    _memory_touch(plan_id, member, data, now)


def leave(plan_id: str, member: str) -> None:
    if _use_redis():
        try:
            rl._client().hdel(_key(plan_id), member)  # noqa: SLF001
        except Exception as e:  # noqa: BLE001
            rl._mark_down(e)  # noqa: SLF001
    with _lock:
        (_memory.get(plan_id) or {}).pop(member, None)


def entries(plan_id: str, now: Optional[float] = None) -> List[dict]:
    """いま開いている端末(古い知らせは捨てる)。各要素は {"member", "user_id", "editing", "at"}。"""
    now = time.time() if now is None else now
    raw: Dict[str, dict] = {}
    if _use_redis():
        try:
            client = rl._client()  # noqa: SLF001
            key = _key(plan_id)
            stale = []
            for member, value in (client.hgetall(key) or {}).items():
                m = member.decode() if isinstance(member, bytes) else str(member)
                try:
                    data = json.loads(value)
                except (TypeError, ValueError):
                    stale.append(m)
                    continue
                if now - float(data.get("at", 0)) > TTL_SECONDS:
                    stale.append(m)
                else:
                    raw[m] = data
            if stale:
                client.hdel(key, *stale)
        except Exception as e:  # noqa: BLE001
            rl._mark_down(e)  # noqa: SLF001
            raw = {}
    with _lock:
        for m, data in (_memory.get(plan_id) or {}).items():
            if now - float(data.get("at", 0)) <= TTL_SECONDS:
                raw.setdefault(m, data)
    return [dict(v, member=k) for k, v in raw.items()]


def reset_for_testing() -> None:
    with _lock:
        _memory.clear()
