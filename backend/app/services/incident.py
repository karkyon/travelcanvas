"""[Gate S8] SEC-19/20 侵害が疑われる時の封じ込め(運用者が使う。画面・API からは使えない)。

使い方は Runbook §9(``python3 scripts/ops/tcops.py security …``)。backend のコンテナの中で
``scripts/security_incident.py`` から呼ぶ。

- 警戒モード(lockdown): 期限付き。全プロセスで共有(Redis、届かない時はこのプロセスだけ)。
  - ログイン・登録・ゲスト開始・昇格に、点数に関わらず計算の確認を求める(Gate S7)
  - 自動遮断の閾値を下げる(GUARD_LOCKDOWN_FACTOR 倍。既定は半分)
  - 指定すれば新規登録・ゲスト開始を止める(503)
- セッションの失効: 1人の全端末、または全員(鍵の漏洩が疑われる時)。アクセストークンも次の要求から使えない
  (API は毎回セッションを確かめる。Gate #28)。
- 遮断の確認・解除は ``threat_guard``(Gate S6)。

全ての操作は監査ログに残す(誰が=運用者、何を、いつ)。
"""
from __future__ import annotations

import json
import threading
import time
from typing import Dict, Optional

from app.core.config import settings
from app.utils import rate_limiter as _rl

_lock = threading.Lock()
_local: Dict[str, object] = {"state": None}
_cache: Dict[str, object] = {"at": 0.0, "state": None}
CACHE_SECONDS = 5.0
MAX_LOCKDOWN_MINUTES = 7 * 24 * 60


def _key() -> str:
    return f"{_rl.namespace()}:lockdown"


def _now() -> float:
    return time.time()


def set_lockdown(minutes: int, *, close_signup: bool = False, reason: str = "") -> Dict[str, object]:
    minutes = max(1, min(int(minutes), MAX_LOCKDOWN_MINUTES))
    state = {"until": _now() + minutes * 60, "close_signup": bool(close_signup), "reason": reason[:200]}
    stored_shared = False
    if _rl.current_backend() != "memory" and _rl._redis_available():
        try:
            _rl._client().set(_key(), json.dumps(state), ex=minutes * 60 + 1)
            stored_shared = True
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
    with _lock:
        _local["state"] = state
        _cache["at"] = 0.0
    _audit("lockdown_on", {"minutes": minutes, "close_signup": bool(close_signup), "reason": reason[:200],
                           "shared": stored_shared})
    return {**state, "shared": stored_shared}


def clear_lockdown() -> bool:
    cleared_shared = False
    if _rl.current_backend() != "memory" and _rl._redis_available():
        try:
            cleared_shared = bool(_rl._client().delete(_key()))
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
    with _lock:
        _local["state"] = None
        _cache["at"] = 0.0
    _audit("lockdown_off", {"shared": cleared_shared})
    return True


def lockdown_state(*, fresh: bool = False) -> Optional[Dict[str, object]]:
    """今の警戒モード(期限切れなら None)。数秒は覚えておき、要求ごとに Redis を読まない。"""
    now = _now()
    with _lock:
        if not fresh and now - float(_cache["at"]) < CACHE_SECONDS:
            state = _cache["state"]
            return state if state and float(state["until"]) > now else None  # type: ignore[index]
    state: Optional[Dict[str, object]] = None
    if _rl.current_backend() != "memory" and _rl._redis_available():
        try:
            raw = _rl._client().get(_key())
            state = json.loads(raw) if raw else None
        except Exception as error:  # noqa: BLE001
            _rl._mark_down(error)
            state = _local["state"]  # type: ignore[assignment]
    else:
        state = _local["state"]  # type: ignore[assignment]
    with _lock:
        _cache["at"] = now
        _cache["state"] = state
    if state and float(state.get("until", 0)) > now:
        return state
    return None


def lockdown_active() -> bool:
    return lockdown_state() is not None


def signup_closed() -> bool:
    state = lockdown_state()
    return bool(state and state.get("close_signup"))


def guard_factor() -> float:
    """警戒モードの間は自動遮断の閾値をこの倍にする(1.0 = そのまま)。"""
    if not lockdown_active():
        return 1.0
    return max(0.1, min(1.0, float(getattr(settings, "GUARD_LOCKDOWN_FACTOR", 0.5))))


# ---------------------------------------------------------------- セッション

def revoke_sessions(db, *, email: Optional[str] = None, all_users: bool = False, reason: str = "") -> int:
    """セッションを失効させる。戻り値は失効させた数。email か all_users のどちらか。"""
    from app.models.models import User, UserSession

    if bool(email) == bool(all_users):
        raise ValueError("email か all_users のどちらか一方を指定してください")
    query = db.query(UserSession).filter(UserSession.is_active.is_(True))
    user_id = None
    if email:
        user = db.query(User).filter(User.email == email.strip().lower()).first()
        if user is None:
            user = db.query(User).filter(User.email == email.strip()).first()
        if user is None:
            raise LookupError("その利用者は見つかりません")
        user_id = user.id
        query = query.filter(UserSession.user_id == user.id)
    count = query.update({UserSession.is_active: False}, synchronize_session=False)
    db.commit()
    _audit("sessions_revoked_by_operator",
           {"count": int(count), "scope": "all" if all_users else "user", "reason": reason[:200]},
           user_id=user_id)
    return int(count)


def _audit(action: str, details: Dict[str, object], user_id=None) -> None:
    try:
        from app.services.audit_service import record_audit_event

        record_audit_event(action=action, resource_type="security", user_id=user_id, details=details)
    except Exception:  # noqa: BLE001
        pass
