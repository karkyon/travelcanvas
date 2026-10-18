"""[Gate S7] SEC-07 段階的な「計算の確認」(proof of work。外部サービスを使わない人間確認の代わり)。

AI を使った攻撃は、ログイン・登録・ゲスト開始を、多数の接続元から休まず大量に試す。CAPTCHA は外部サービス
(鍵・通信先)が要り、画面の操作も増える。ここでは、怪しい接続元(Gate S6 の点数が上がっている)からの
入口の要求にだけ、「ブラウザが少し計算しないと通れない」条件を付ける。

- 普通の利用者: 点数が低いので何も起きない。点数が上がっていても、画面(APIクライアント)が自動で計算して
  再送する(数十〜数百ミリ秒。操作は増えない)。
- 攻撃者: 要求ごとに計算が要り、点数が高いほど難しくなる(2倍ずつ)。大量の試行の費用が上がる。

流れ:
1. 入口(login / register / guest / guest_upgrade)で ``require(request, kind)`` を呼ぶ。
2. 要るのに付いていなければ 428 と、ヘッダー ``X-TC-Challenge``(token)・``X-TC-Challenge-Difficulty`` を返す。
3. 画面は ``sha256(token + ":" + counter)`` の先頭の 0 のビット数が difficulty 以上になる counter を探し、
   ``X-TC-Challenge: <token>`` と ``X-TC-Challenge-Solution: <counter>`` を付けて同じ要求を送り直す。
4. backend は署名・期限・接続元・入口・難しさを確かめ、使った token を記録する(使い回し不可)。

token は HMAC で署名した自己完結の値(DB 不要)。接続元の IP は sha256 にして入れる(IP を返さない)。
使った token の記録は回数制限と同じ Redis(全プロセス共有)、届かない時はプロセス内。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from typing import Dict, Optional

from fastapi import HTTPException, Request

from app.core.config import settings
from app.services import threat_guard
from app.utils import rate_limiter as _rl

ALGORITHM = "sha256-leading-zero-bits"
HEADER_TOKEN = "x-tc-challenge"
HEADER_SOLUTION = "x-tc-challenge-solution"
KINDS = ("login", "register", "guest", "guest_upgrade")
MAX_DIFFICULTY = 24
MAX_COUNTER_LENGTH = 20

_used_lock = threading.Lock()
_used: Dict[str, float] = {}
MAX_MEMORY_USED = 50_000


HEADER_DIFFICULTY = "x-tc-challenge-difficulty"
HEADER_ALGORITHM = "x-tc-challenge-algorithm"
CHALLENGE_DETAIL = "確認のための計算が必要です。もう一度お試しください。"


class ChallengeRequired(HTTPException):
    """428。問題はヘッダーで渡す(detail は他の失敗と同じ文字列のまま。画面の共通のエラー表示を崩さない)。"""

    def __init__(self, token: str, difficulty: int, reason: str):
        super().__init__(
            status_code=428,
            detail=CHALLENGE_DETAIL,
            headers={
                "X-TC-Challenge": token,
                "X-TC-Challenge-Difficulty": str(difficulty),
                "X-TC-Challenge-Algorithm": ALGORITHM,
                "X-TC-Challenge-Reason": reason,
                "Cache-Control": "no-store",
            },
        )


def _now() -> float:
    return time.time()


def _key() -> bytes:
    secret = getattr(settings, "CHALLENGE_SECRET_KEY", "") or settings.JWT_SECRET_KEY
    return hashlib.sha256(("tc-challenge|" + str(secret)).encode("utf-8")).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _ip_tag(ip: Optional[str]) -> str:
    return hashlib.sha256(("challenge|" + (ip or "")).encode("utf-8")).hexdigest()[:16]


def _sign(body: str) -> str:
    return _b64(hmac.new(_key(), body.encode("ascii"), hashlib.sha256).digest()[:20])


def issue(ip: Optional[str], kind: str, difficulty: int) -> str:
    payload = {
        "v": 1,
        "k": kind,
        "d": int(difficulty),
        "n": secrets.token_urlsafe(12),
        "e": int(_now()) + int(getattr(settings, "CHALLENGE_TTL_SECONDS", 120)),
        "i": _ip_tag(ip),
    }
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    return f"{body}.{_sign(body)}"


def leading_zero_bits(digest: bytes) -> int:
    bits = 0
    for byte in digest:
        if byte == 0:
            bits += 8
            continue
        bits += 8 - byte.bit_length()
        break
    return bits


def solution_ok(token: str, counter: str, difficulty: int) -> bool:
    digest = hashlib.sha256(f"{token}:{counter}".encode("utf-8")).digest()
    return leading_zero_bits(digest) >= difficulty


def solve(token: str, difficulty: int, limit: int = 50_000_000) -> str:
    """試験・運用の確認用(画面は frontend/src/utils/challengeSolver.ts で同じ計算をする)。"""
    for counter in range(limit):
        if solution_ok(token, str(counter), difficulty):
            return str(counter)
    raise RuntimeError("解が見つかりませんでした")


def required_difficulty(ip: Optional[str], kind: str) -> int:
    """この接続元・入口に要る難しさ。0 なら確認は要らない。"""
    if not getattr(settings, "CHALLENGE_ENABLED", True) or threat_guard.is_trusted(ip):
        return 0
    base = int(getattr(settings, "CHALLENGE_BASE_DIFFICULTY", 16))
    always = {k.strip() for k in str(getattr(settings, "CHALLENGE_ALWAYS", "") or "").split(",") if k.strip()}
    score = threat_guard.current_score(ip)
    start = int(getattr(settings, "CHALLENGE_SCORE", 30))
    if score < start:
        # [Gate S8] 警戒モードの間は、点数に関わらず全ての入口で求める
        from app.services import incident

        return base if (kind in always or incident.lockdown_active()) else 0
    step = max(1, int(getattr(settings, "CHALLENGE_SCORE_STEP", 30)))
    return min(MAX_DIFFICULTY, base + (score - start) // step)


def _parse(token: str) -> Optional[dict]:
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    if not hmac.compare_digest(sig, _sign(body)):
        return None
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError):
        return None
    return payload if isinstance(payload, dict) and payload.get("v") == 1 else None


def _mark_used(nonce: str, expires: int) -> bool:
    """初めて使う token なら True(記録する)、使用済みなら False。"""
    ttl = max(1, expires - int(_now()) + 5)
    if _rl._redis_available():
        try:
            client = _rl._client()
            return bool(client.set(f"{_rl.namespace()}:chal:{nonce}", "1", nx=True, ex=ttl))
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
    now = _now()
    with _used_lock:
        if len(_used) > MAX_MEMORY_USED:
            for k in [k for k, exp in _used.items() if exp <= now]:
                del _used[k]
        if nonce in _used and _used[nonce] > now:
            return False
        _used[nonce] = now + ttl
        return True


def verify(request: Request, kind: str, difficulty: int) -> Optional[str]:
    """付いている解を確かめる。問題が無ければ None、あれば理由。"""
    token = request.headers.get(HEADER_TOKEN) or ""
    counter = request.headers.get(HEADER_SOLUTION) or ""
    if not token or not counter:
        return "missing"
    if len(token) > 512 or len(counter) > MAX_COUNTER_LENGTH or not counter.isdigit():
        return "malformed"
    payload = _parse(token)
    if payload is None:
        return "bad_signature"
    if payload.get("k") != kind:
        return "wrong_kind"
    if int(payload.get("e", 0)) < _now():
        return "expired"
    if payload.get("i") != _ip_tag(threat_guard.client_ip(request)):
        return "wrong_client"
    issued_difficulty = int(payload.get("d", 0))
    if issued_difficulty < difficulty:
        return "too_easy"  # 発行の後に点数が上がった
    if not solution_ok(token, counter, issued_difficulty):
        return "wrong_solution"
    if not _mark_used(str(payload.get("n")), int(payload.get("e", 0))):
        return "replayed"
    return None


def require(request: Request, kind: str) -> None:
    """入口の最初に呼ぶ。要るのに解が無い・誤りなら 428(新しい問題を付ける)。"""
    ip = threat_guard.client_ip(request)
    difficulty = required_difficulty(ip, kind)
    if difficulty <= 0:
        return
    problem = verify(request, kind, difficulty)
    if problem is None:
        _count("challenge_passed")
        return
    _count("challenge_issued" if problem == "missing" else "challenge_failed")
    if problem == "missing":
        threat_guard.signal(request, "challenge_unsolved")
    elif problem not in ("expired", "too_easy"):
        threat_guard.signal(request, "challenge_failed")
    raise ChallengeRequired(issue(ip, kind, difficulty), difficulty, problem)


def _count(kind: str) -> None:
    try:
        from app.ops import metrics

        metrics.registry.count_security_event(kind)
    except Exception:  # noqa: BLE001
        pass


def reset_used() -> None:
    with _used_lock:
        _used.clear()
