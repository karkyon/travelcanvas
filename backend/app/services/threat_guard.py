"""[Gate S6] SEC-16/17 攻撃の兆候の自動検知と、段階的な自動遮断(接続元ごと)。

AI を使った攻撃は、1つ1つは「普通の失敗」に見える要求(ログインの失敗・他人の ID の推測・期限切れ URL の
使い回し・別サイトからの操作)を、休まず大量に・組み合わせて送ってくる。回数制限(Gate S3)は入口ごとの数しか
見ないので、入口を変えながら続く攻撃を止められない。ここでは接続元(IP)ごとに「怪しさの点数」を時間窓で
合計し、段階的に対応する。

- 点数の付け方(SIGNAL_WEIGHTS): ログインの失敗・無効なトークン・他人のデータへの 403/404・URL の拒否・
  別サイトからの操作・上限超え・ウイルス・回数制限に引っかかった、など。成功した要求は点数にしない。
- 段階:
  1. 注意(GUARD_WARN_SCORE 以上): 監査・計数(security_events_total{kind="guard_warn"})だけ
  2. 遮断(GUARD_BLOCK_SCORE 以上): その接続元からの API を GUARD_BLOCK_SECONDS の間 429 にする
     (/health・/ready・/metrics は止めない)。監査 ``ip_blocked``
  3. 再犯(遮断が明けて24時間以内にまた遮断): 遮断の時間を GUARD_REPEAT_MULTIPLIER 倍にする(上限24時間)
- 数え方は回数制限と同じ Redis(全プロセス共有)、届かない時はプロセス内。キーは sha256 で IP を残さない。
- 信頼する接続元(GUARD_TRUSTED_IPS。監視・運用の機械)は数えない・止めない。
- 誤って止めた時は ``reset(ip)`` / ``reset_all()``(Runbook §3.9)。

利用者(アカウント)単位の対応(全セッションの失効)は、refresh token の再利用検知(Gate #28/S2)が既に行っている。
"""
from __future__ import annotations

import hashlib
import ipaddress
import logging
import threading
import time
from typing import Dict, Optional, Tuple

from app.core.config import settings
from app.utils import rate_limiter as _rl

logger = logging.getLogger(__name__)

SIGNAL_WEIGHTS: Dict[str, int] = {
    "login_failed": 5,
    "invalid_token": 3,
    "forbidden": 2,          # 403(他人のデータ・権限の無い操作)
    "not_found_probe": 2,    # ID を含む API への 404(推測による探索)
    "download_denied": 5,
    "cross_site_blocked": 10,
    "body_too_large": 10,
    "malware_rejected": 25,
    "rate_limited": 3,
    "refresh_reuse": 25,
    "challenge_failed": 5,   # [Gate S7] 計算の確認の偽造・使い回し
    "challenge_unsolved": 2,
    "mfa_failed": 5,         # [Gate S11] 確認コード・再認証のパスワードの誤り、期限切れ・偽造の合図  # [Gate S7] 確認を求められても解かずに送り続ける(解かない攻撃も最後は遮断する)
}

BUCKET_SECONDS = 300
_EXEMPT_PREFIXES = ("/health", "/ready", "/metrics", "/api/v1/health")

# ---------------------------------------------------------------- プロセス内(予備)
_mem_lock = threading.Lock()
_mem_scores: Dict[Tuple[str, int], int] = {}
_mem_blocks: Dict[str, Tuple[float, int]] = {}   # key -> (until, strikes)
_mem_strikes: Dict[str, Tuple[float, int]] = {}  # key -> (expires, strikes)
MAX_MEMORY_KEYS = 50_000


def _now() -> float:
    return time.time()


def _enabled() -> bool:
    return bool(getattr(settings, "GUARD_ENABLED", True))


def _hash(ip: Optional[str]) -> str:
    return hashlib.sha256(("guard|" + (ip or "")).encode("utf-8")).hexdigest()[:40]


def _ns() -> str:
    return f"{_rl.namespace()}:guard"


def is_trusted(ip: Optional[str]) -> bool:
    if not ip:
        return True
    trusted = getattr(settings, "GUARD_TRUSTED_IPS", "") or ""
    entries = [t.strip() for t in (trusted.split(",") if isinstance(trusted, str) else trusted) if t and t.strip()]
    if not entries:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip in entries
    for entry in entries:
        try:
            if addr in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            continue
    return False


def _window_buckets(now: float) -> Tuple[int, ...]:
    window = int(getattr(settings, "GUARD_WINDOW_SECONDS", 900))
    current = int(now // BUCKET_SECONDS)
    count = max(1, window // BUCKET_SECONDS)
    return tuple(current - i for i in range(count))


def _count(name: str) -> None:
    try:
        from app.ops import metrics

        metrics.registry.count_security_event(name)
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------- 点数

def _add_score_redis(key: str, weight: int, now: float) -> int:
    client = _rl._client()
    buckets = _window_buckets(now)
    pipe = client.pipeline()
    head = f"{_ns()}:s:{key}:{buckets[0]}"
    pipe.incrby(head, weight)
    pipe.expire(head, int(getattr(settings, "GUARD_WINDOW_SECONDS", 900)) + BUCKET_SECONDS)
    for b in buckets[1:]:
        pipe.get(f"{_ns()}:s:{key}:{b}")
    results = pipe.execute()
    total = int(results[0])
    for value in results[2:]:
        total += int(value or 0)
    return total


def _add_score_memory(key: str, weight: int, now: float) -> int:
    buckets = _window_buckets(now)
    with _mem_lock:
        _mem_scores[(key, buckets[0])] = _mem_scores.get((key, buckets[0]), 0) + weight
        if len(_mem_scores) > MAX_MEMORY_KEYS:
            oldest = min(b for _, b in _mem_scores)
            for k in [k for k in _mem_scores if k[1] == oldest]:
                del _mem_scores[k]
        return sum(_mem_scores.get((key, b), 0) for b in buckets)


def _use_redis() -> bool:
    return _rl._redis_available()


def _blocked_until_redis(key: str) -> float:
    value = _rl._client().get(f"{_ns()}:b:{key}")
    return float(value) if value else 0.0


def _blocked_until_memory(key: str, now: float) -> float:
    with _mem_lock:
        entry = _mem_blocks.get(key)
        if entry and entry[0] <= now:
            del _mem_blocks[key]
            return 0.0
        return entry[0] if entry else 0.0


def blocked_until(ip: Optional[str], now: Optional[float] = None) -> float:
    """遮断中なら明ける時刻(unix 秒)、そうでなければ 0。"""
    if not _enabled() or is_trusted(ip):
        return 0.0
    now = _now() if now is None else now
    key = _hash(ip)
    if _use_redis():
        try:
            until = _blocked_until_redis(key)
            return until if until > now else 0.0
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
    return _blocked_until_memory(key, now)


def current_score(ip: Optional[str], now: Optional[float] = None) -> int:
    """[Gate S7] 今の点数(数えない)。無効・信頼する接続元は 0。"""
    if not _enabled() or is_trusted(ip):
        return 0
    now = _now() if now is None else now
    key = _hash(ip)
    buckets = _window_buckets(now)
    if _use_redis():
        try:
            values = _rl._client().mget([f"{_ns()}:s:{key}:{b}" for b in buckets])
            return sum(int(v or 0) for v in values)
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
    with _mem_lock:
        return sum(_mem_scores.get((key, b), 0) for b in buckets)


def _block(key: str, now: float) -> Tuple[float, int]:
    base = int(getattr(settings, "GUARD_BLOCK_SECONDS", 900))
    mult = int(getattr(settings, "GUARD_REPEAT_MULTIPLIER", 4))
    if _use_redis():
        try:
            client = _rl._client()
            strikes = int(client.incr(f"{_ns()}:k:{key}"))
            client.expire(f"{_ns()}:k:{key}", 24 * 3600)
            seconds = min(base * (mult ** (strikes - 1)), 24 * 3600)
            until = now + seconds
            client.set(f"{_ns()}:b:{key}", f"{until:.3f}", ex=int(seconds) + 1)
            # 遮断した窓の点数は消す(明けた直後にまた同じ点数で止めない)
            for b in _window_buckets(now):
                client.delete(f"{_ns()}:s:{key}:{b}")
            return until, strikes
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
    with _mem_lock:
        exp, strikes = _mem_strikes.get(key, (0.0, 0))
        strikes = strikes + 1 if exp > now else 1
        _mem_strikes[key] = (now + 24 * 3600, strikes)
        seconds = min(base * (mult ** (strikes - 1)), 24 * 3600)
        until = now + seconds
        _mem_blocks[key] = (until, strikes)
        for b in _window_buckets(now):
            _mem_scores.pop((key, b), None)
        return until, strikes


def record_signal(ip: Optional[str], signal: str, *, path: Optional[str] = None) -> Optional[str]:
    """怪しい出来事を1件数える。戻り値は段階の変化("warn" / "block")か None。"""
    if not _enabled() or is_trusted(ip):
        return None
    weight = SIGNAL_WEIGHTS.get(signal)
    if not weight:
        return None
    now = _now()
    key = _hash(ip)
    score = None
    if _use_redis():
        try:
            score = _add_score_redis(key, weight, now)
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
    if score is None:
        score = _add_score_memory(key, weight, now)
    # [Gate S8] 警戒モードの間は閾値を下げる(既定は半分)
    factor = _lockdown_factor()
    warn = int(int(getattr(settings, "GUARD_WARN_SCORE", 60)) * factor)
    block = int(int(getattr(settings, "GUARD_BLOCK_SCORE", 150)) * factor)
    if score >= block and blocked_until(ip, now) == 0.0:
        until, strikes = _block(key, now)
        _count("guard_block")
        logger.warning("guard: 接続元を一時遮断しました(点数 %d、%d 回目、%d 秒)", score, strikes, int(until - now))
        _audit("ip_blocked", {"score": score, "strikes": strikes, "seconds": int(until - now), "last_signal": signal})
        return "block"
    if score >= warn and score - weight < warn:
        _count("guard_warn")
        _audit("guard_warn", {"score": score, "last_signal": signal})
        return "warn"
    return None


def _lockdown_factor() -> float:
    try:
        from app.services import incident

        return incident.guard_factor()
    except Exception:  # noqa: BLE001
        return 1.0


def _audit(action: str, details: Dict[str, object]) -> None:
    try:
        from app.services.audit_service import record_audit_event

        record_audit_event(action=action, resource_type="security", details=details)
    except Exception:  # noqa: BLE001
        pass


def classify_response(method: str, path: str, status: int, has_bearer: bool) -> Optional[str]:
    """応答から、点数にする出来事の種類を決める(成功・公開の入口・監視は数えない)。"""
    if status < 400 or path.startswith(_EXEMPT_PREFIXES) or not path.startswith("/api/"):
        return None
    if status == 401:
        if path.endswith("/auth/login"):
            return "login_failed"
        return "invalid_token" if has_bearer else None
    if status == 403:
        return "forbidden"
    if status == 404 and _has_id_segment(path):
        return "not_found_probe"
    if status == 429:
        return "rate_limited"
    if status == 413:
        return "body_too_large"
    return None


def _has_id_segment(path: str) -> bool:
    for part in path.split("/"):
        if len(part) == 36 and part.count("-") == 4:
            return True
    return False


def is_exempt_path(path: str) -> bool:
    return path.startswith(_EXEMPT_PREFIXES) or not path.startswith("/api/")


def client_ip(request_or_scope) -> Optional[str]:
    """要求(Request)または ASGI の scope から接続元の IP。"""
    client = getattr(request_or_scope, "client", None)
    if client is None and isinstance(request_or_scope, dict):
        client = request_or_scope.get("client")
        return client[0] if client else None
    return client.host if client else None


def signal(request_or_scope, name: str) -> Optional[str]:
    """ハンドラ・ミドルウェアから明示的に出来事を数える(失敗しても本来の処理を止めない)。"""
    try:
        return record_signal(client_ip(request_or_scope), name)
    except Exception:  # noqa: BLE001
        logger.warning("guard: 出来事を数えられませんでした")
        return None


BLOCKED_DETAIL = "短時間に不審な操作が続いたため、一時的に利用を制限しています。しばらくしてから再試行してください。"


def reset(ip: str) -> None:
    key = _hash(ip)
    with _mem_lock:
        _mem_blocks.pop(key, None)
        _mem_strikes.pop(key, None)
        for k in [k for k in _mem_scores if k[0] == key]:
            del _mem_scores[k]
    if _use_redis():
        try:
            client = _rl._client()
            for k in client.scan_iter(match=f"{_ns()}:*:{key}*", count=500):
                client.delete(k)
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)


def reset_all() -> int:
    with _mem_lock:
        _mem_blocks.clear()
        _mem_strikes.clear()
        _mem_scores.clear()
    removed = 0
    if _rl.current_backend() != "memory":
        try:
            client = _rl._client()
            for k in client.scan_iter(match=f"{_ns()}:*", count=500):
                client.delete(k)
                removed += 1
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
    return removed
