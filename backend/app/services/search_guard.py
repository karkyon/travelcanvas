"""[Gate SearchUAT-S3] OpenStreetMap の公開の server(Overpass)への送り方の守り。

1. 待機(cooldown): 429 は Retry-After(無ければ 60 秒)の間、403/406(要求を受け付けない)は 10 分の間、
   アプリから同じ server へ送らない。待機中の検索は送らずに ``rate_limited`` / ``blocked`` と残り秒数を返す
   (回数の制限を越えて送り続けると、運営者は接続元を遮断する。406 を繰り返さない)
2. 短い時間の保存(cache): 同じ条件(カテゴリ・言葉・基点・半径)の成功した結果を ``OVERPASS_CACHE_SECONDS``(既定 45 分)
   の間だけ使い回す。提供元が失敗した時は ``OVERPASS_STALE_SECONDS``(既定 6 時間)までの古い結果を「前の結果」として
   示せる(新しい結果のふりをしない)。
   - キーは条件の SHA-256 だけ(利用者の ID・入力の原文・個人の情報を含めない)。基点は小数 3 桁(約 100m)に丸める
   - 保存した結果を使った時は、提供元へ送っていない(``called`` に入れない・無料の送信の回数に数えない)

保存の先は Redis(既定)。Redis に届かない時はプロセス内(worker ごと)で続ける(検索は止めない)。
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

PROVIDER = "overpass"
DEFAULT_RETRY_AFTER = 60
MAX_RETRY_AFTER = 900
BLOCKED_COOLDOWN = 600
REDIS_TIMEOUT = 0.3

_lock = threading.Lock()
_state: Dict[str, Any] = {"backend": "auto", "client": None, "down_until": 0.0}
_memory: Dict[str, Tuple[float, str]] = {}  # key -> (期限の時刻, 値)


def _settings():
    from app.core.config import settings

    return settings


def cache_seconds() -> int:
    return max(0, int(getattr(_settings(), "OVERPASS_CACHE_SECONDS", 2700) or 0))


def stale_seconds() -> int:
    return max(cache_seconds(), int(getattr(_settings(), "OVERPASS_STALE_SECONDS", 21600) or 0))


def use_backend(name: str) -> None:
    """'auto'(Redis、届かなければプロセス内)/ 'memory'(プロセス内だけ。試験用)"""
    if name not in ("auto", "memory"):
        raise ValueError(name)
    with _lock:
        _state["backend"] = name
        _state["down_until"] = 0.0


def reset() -> None:
    with _lock:
        _memory.clear()
    if _state["backend"] != "memory" and _redis() is not None:
        try:
            client = _redis()
            for k in client.scan_iter(match=_ns() + "*", count=200):
                client.delete(k)
        except Exception:  # noqa: BLE001
            pass


def _ns() -> str:
    return f"{getattr(_settings(), 'RATE_LIMIT_NAMESPACE', None) or 'tc'}:osm:"


def _redis():
    if _state["backend"] == "memory" or time.time() < float(_state["down_until"]):
        return None
    with _lock:
        if _state["client"] is None:
            try:
                import redis

                _state["client"] = redis.Redis.from_url(_settings().REDIS_URL, socket_timeout=REDIS_TIMEOUT,
                                                        socket_connect_timeout=REDIS_TIMEOUT)
            except Exception as exc:  # noqa: BLE001
                _down(exc)
                return None
        return _state["client"]


def _down(exc: BaseException) -> None:
    _state["down_until"] = time.time() + 30
    logger.warning("search_guard: Redis に届かないため、プロセス内の保存で続けます(%s)", type(exc).__name__)


def _get(key: str) -> Optional[str]:
    client = _redis()
    if client is not None:
        try:
            raw = client.get(_ns() + key)
            return raw.decode("utf-8") if isinstance(raw, bytes) else raw
        except Exception as exc:  # noqa: BLE001
            _down(exc)
    with _lock:
        item = _memory.get(key)
        if item and item[0] > time.time():
            return item[1]
        _memory.pop(key, None)
    return None


def _set(key: str, value: str, ttl: int) -> None:
    if ttl <= 0:
        return
    client = _redis()
    if client is not None:
        try:
            client.set(_ns() + key, value, ex=int(ttl))
            return
        except Exception as exc:  # noqa: BLE001
            _down(exc)
    with _lock:
        _memory[key] = (time.time() + ttl, value)


def _ttl(key: str) -> int:
    client = _redis()
    if client is not None:
        try:
            return max(0, int(client.ttl(_ns() + key)))
        except Exception as exc:  # noqa: BLE001
            _down(exc)
    with _lock:
        item = _memory.get(key)
    return max(0, int(item[0] - time.time())) if item else 0


# ===================================================================== 待機(cooldown)

def cooldown_remaining() -> Optional[Dict[str, Any]]:
    """待機中なら {"code": "rate_limited" | "blocked", "retry_after": 秒}。待機していなければ None。"""
    raw = _get("cooldown")
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    left = _ttl("cooldown")
    if left <= 0:
        return None
    return {"code": str(data.get("code") or "rate_limited"), "retry_after": left, "status": data.get("status")}


def note_failure(code: str, status: Optional[int], retry_after: Optional[int]) -> Optional[int]:
    """失敗を受けて待機を始める。待機の秒数(待機しない失敗は None)。"""
    if code == "rate_limited":
        seconds = retry_after if retry_after and retry_after > 0 else DEFAULT_RETRY_AFTER
        seconds = min(int(seconds), MAX_RETRY_AFTER)
    elif code == "blocked":
        seconds = BLOCKED_COOLDOWN
    else:
        return None
    _set("cooldown", json.dumps({"code": code, "status": status}), seconds)
    return seconds


def parse_retry_after(value: Optional[str]) -> Optional[int]:
    """Retry-After の秒数(秒の数か HTTP の日時)。読めなければ None。"""
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return int(value)
    try:
        from email.utils import parsedate_to_datetime

        when = parsedate_to_datetime(value)
        return max(0, int(when.timestamp() - time.time()))
    except (TypeError, ValueError):
        return None


# ===================================================================== 短い時間の保存

def cache_key(query: str, latitude: float, longitude: float, radius_km: float, category: str) -> str:
    """条件の SHA-256(入力の原文・利用者を含めない)。言葉は空白と大文字小文字をそろえる。"""
    norm = " ".join((query or "").split()).lower()
    spec = json.dumps([category, norm, round(float(latitude), 3), round(float(longitude), 3),
                       round(float(radius_km), 2)], ensure_ascii=False)
    return "c:" + hashlib.sha256(spec.encode("utf-8")).hexdigest()


def _encode(rows: List[Dict[str, Any]], partial: bool) -> str:
    def conv(r: Dict[str, Any]) -> Dict[str, Any]:
        out = dict(r)
        if isinstance(out.get("retrieved_at"), datetime):
            out["retrieved_at"] = out["retrieved_at"].isoformat()
        return out
    return json.dumps({"saved": time.time(), "partial": partial, "rows": [conv(r) for r in rows]},
                      ensure_ascii=False)


def store(key: str, rows: List[Dict[str, Any]], partial: bool) -> None:
    """成功した結果だけを保存する(一部だけの結果は保存しない)。"""
    if cache_seconds() <= 0 or partial:
        return
    _set(key, _encode(rows, partial), stale_seconds())


def load(key: str, allow_stale: bool = False) -> Optional[Dict[str, Any]]:
    """保存した結果。{"rows", "age_seconds", "stale"}。新しい(cache の時間内)か、allow_stale なら古い結果まで。"""
    if cache_seconds() <= 0:
        return None
    raw = _get(key)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    age = max(0, int(time.time() - float(data.get("saved") or 0)))
    stale = age > cache_seconds()
    if stale and (not allow_stale or age > stale_seconds()):
        return None
    rows = []
    for r in data.get("rows") or []:
        r = dict(r)
        try:
            r["retrieved_at"] = datetime.fromisoformat(r["retrieved_at"]) if r.get("retrieved_at") else None
        except (TypeError, ValueError):
            r["retrieved_at"] = None
        rows.append(r)
    return {"rows": rows, "age_seconds": age, "stale": stale}
