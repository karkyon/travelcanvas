"""[Gate Remaining-2] 無料の外部サービス(為替・気象警報・逆ジオコーディング・祝日)と有料の接続口の共通部分。

- 送り先は各モジュールの固定の URL か設定の値だけ(利用者の入力で送り先を変えない。SSRF を作らない)
- 予定の名前・利用者は送らない(座標・通貨・日付・地域の番号だけ)
- 結果は名前ごとの使い回し(TTL 付き)。失敗は短く覚えて送り続けない
- CI の模擬(PROVIDER_HTTP_STUB)の時は、試験が差し替えた名前だけ送る(他は「取れない」= 手入力)
- 試験は set_transport(name, httpx.MockTransport) で差し替える
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Optional, Tuple

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

USER_AGENT = "TravelCanvas/1.0 (+https://github.com/karkyon/travelcanvas)"
FAIL_REMEMBER_SECONDS = 300
MAX_CACHE = 5000

_transports: Dict[str, httpx.BaseTransport] = {}
_cache: "OrderedDict[Tuple[str, str], Tuple[float, Any]]" = OrderedDict()
_lock = threading.Lock()
_last_call: Dict[str, float] = {}


class Unavailable(Exception):
    """外部サービスが使えない(無効・未設定・失敗)。呼び出し側は手入力へ戻す"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def set_transport(name: str, transport: Optional[httpx.BaseTransport]) -> None:
    """試験用: その名前の送信を差し替える(None で元に戻す)。差し替えの時はその名前の使い回しも消す"""
    with _lock:
        if transport is None:
            _transports.pop(name, None)
        else:
            _transports[name] = transport
        for k in [k for k in _cache if k[0] == name]:
            _cache.pop(k, None)
        _last_call.pop(name, None)


def clear_cache() -> None:
    with _lock:
        _cache.clear()
        _last_call.clear()


def allowed(name: str, flag: Optional[str] = None) -> bool:
    """送ってよいか。模擬の時は差し替えた名前だけ。flag は設定の有効・無効(既定は有効)"""
    if flag is not None and not bool(getattr(settings, flag, True)):
        return False
    if getattr(settings, "PROVIDER_HTTP_STUB", False) and name not in _transports:
        return False
    return True


def _throttle(name: str, min_interval: float) -> None:
    """提供元の利用の条件(例: Nominatim は 1 秒に 1 回)を守る。試験の差し替えの時は待たない"""
    if min_interval <= 0 or name in _transports:
        return
    with _lock:
        last = _last_call.get(name, 0.0)
        wait = last + min_interval - time.monotonic()
        _last_call[name] = max(time.monotonic(), last + min_interval)
    if wait > 0:
        time.sleep(min(wait, min_interval))


def get_json(name: str, url: str, *, params: Optional[Dict[str, Any]] = None,
             headers: Optional[Dict[str, str]] = None, timeout: float = 6.0, min_interval: float = 0.0) -> Any:
    """GET して JSON を返す。失敗は Unavailable(呼び出し側で手入力へ)"""
    _throttle(name, min_interval)
    h = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    h.update(headers or {})
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout), transport=_transports.get(name), headers=h,
                          follow_redirects=False) as client:
            r = client.get(url, params=params)
            if r.status_code in (401, 403):
                raise Unavailable("rejected")
            if r.status_code == 404:
                raise Unavailable("not_found")
            r.raise_for_status()
            return r.json()
    except Unavailable:
        raise
    except (httpx.HTTPError, ValueError) as error:
        logger.info("%s unavailable (%s)", name, type(error).__name__)
        raise Unavailable("failed")


def post_form(name: str, url: str, data: Dict[str, Any], *, headers: Optional[Dict[str, str]] = None,
              timeout: float = 8.0) -> Any:
    """[Gate Remaining-7] フォームを POST して JSON を返す(OAuth の token の交換)。401/403 は rejected、400 は bad_request"""
    h = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    h.update(headers or {})
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout), transport=_transports.get(name), headers=h,
                          follow_redirects=False) as client:
            r = client.post(url, data=data)
            if r.status_code in (401, 403):
                raise Unavailable("rejected")
            if r.status_code == 400:
                raise Unavailable("bad_request")
            r.raise_for_status()
            return r.json() if r.content else {}
    except Unavailable:
        raise
    except (httpx.HTTPError, ValueError) as error:
        logger.info("%s unavailable (%s)", name, type(error).__name__)
        raise Unavailable("failed")


def cached(name: str, key: str, ttl: int, fn: Callable[[], Any]) -> Any:
    """名前と鍵ごとに結果を使い回す。失敗(Unavailable)は FAIL_REMEMBER_SECONDS だけ覚える"""
    now = time.time()
    with _lock:
        hit = _cache.get((name, key))
        if hit is not None and hit[0] > now:
            _cache.move_to_end((name, key))
            value = hit[1]
            if isinstance(value, Unavailable):
                raise value
            return value
    try:
        value = fn()
        expires = now + max(int(ttl), 1)
    except Unavailable as error:
        value = error
        expires = now + min(FAIL_REMEMBER_SECONDS, max(int(ttl), 1))
    with _lock:
        _cache[(name, key)] = (expires, value)
        _cache.move_to_end((name, key))
        while len(_cache) > MAX_CACHE:
            _cache.popitem(last=False)
    if isinstance(value, Unavailable):
        raise value
    return value
