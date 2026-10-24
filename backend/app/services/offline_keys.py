"""
[Gate K1] B-008 / FR-032・FR-048 オフラインパックの鍵(docs/adr/ADR-offline-keys.md)。

以前は端末がその時のアクセストークンから PBKDF2 で鍵を作っていたため、トークンの更新・再ログインで
保存したパックが読めなくなり、失効の手段も無かった。ここでは利用者ごと・版ごとの鍵を backend の秘密から
決定的に導出して配る。

- master  = SHA-256(OFFLINE_PACK_KEY_SECRET)  (未設定なら HMAC(SHA-256(ENCRYPTION_KEY), 用途ラベル))
- 鍵      = HMAC-SHA256(master, "travelcanvas/offline-pack/v1|<user_id>|<版>")  (32バイト = AES-256)
- 版      = users.preferences["offline_pack_key"]["version"](既定1)。失効は版を1つ上げる。

DB に鍵そのものは保存しない(版の数字だけ)。migration は不要。
"""
import base64
import hashlib
import hmac
import uuid
from typing import Any, Dict, Optional

from app.core.config import settings

KEY_LABEL = "travelcanvas/offline-pack/v1"
_MASTER_FROM_ENCRYPTION_LABEL = b"travelcanvas/offline-pack/master/v1"
PREFERENCE_KEY = "offline_pack_key"
ALGORITHM = "AES-256-GCM"


class OfflineKeyNotConfigured(RuntimeError):
    """鍵の元になる秘密(OFFLINE_PACK_KEY_SECRET / ENCRYPTION_KEY)が無い"""


def _master_secret() -> bytes:
    own = (settings.OFFLINE_PACK_KEY_SECRET or "").strip()
    if own:
        return hashlib.sha256(own.encode("utf-8")).digest()
    enc = (settings.ENCRYPTION_KEY or "").strip()
    if enc:
        base = hashlib.sha256(enc.encode("utf-8")).digest()
        return hmac.new(base, _MASTER_FROM_ENCRYPTION_LABEL, hashlib.sha256).digest()
    raise OfflineKeyNotConfigured("OFFLINE_PACK_KEY_SECRET も ENCRYPTION_KEY も設定されていません")


def is_configured() -> bool:
    try:
        _master_secret()
        return True
    except OfflineKeyNotConfigured:
        return False


def current_version(preferences: Optional[Dict[str, Any]]) -> int:
    entry = (preferences or {}).get(PREFERENCE_KEY)
    if isinstance(entry, dict):
        try:
            version = int(entry.get("version", 1))
        except (TypeError, ValueError):
            return 1
        return version if version >= 1 else 1
    return 1


def derive_key(user_id: uuid.UUID, version: int) -> bytes:
    if version < 1:
        raise ValueError("version は1以上")
    message = f"{KEY_LABEL}|{uuid.UUID(str(user_id))}|{int(version)}".encode("utf-8")
    return hmac.new(_master_secret(), message, hashlib.sha256).digest()


# [Gate G6] OFF-01 端末ごとの鍵。端末(device_id)ごとに別の鍵を導出し、1台を失効しても他の端末の鍵は変わらない。
DEVICE_KEY_TTL_DAYS = 30
MAX_DEVICES = 10


def derive_device_key(user_id: uuid.UUID, version: int, device_id: str) -> bytes:
    if version < 1:
        raise ValueError("version は1以上")
    device = str(uuid.UUID(str(device_id)))
    message = f"{KEY_LABEL}|{uuid.UUID(str(user_id))}|{int(version)}|device|{device}".encode("utf-8")
    return hmac.new(_master_secret(), message, hashlib.sha256).digest()


def device_label(user_agent: Optional[str]) -> str:
    """端末の一覧に出す名前(利用者の識別に使える細かい値は残さない。ブラウザと OS の種類だけ)。"""
    ua = (user_agent or "").lower()
    browser = next((name for key, name in (("edg/", "Edge"), ("chrome/", "Chrome"), ("firefox/", "Firefox"),
                                           ("safari/", "Safari")) if key in ua), "ブラウザ")
    os_name = next((name for key, name in (("iphone", "iPhone"), ("ipad", "iPad"), ("android", "Android"),
                                           ("windows", "Windows"), ("mac os", "Mac"), ("linux", "Linux"))
                    if key in ua), "")
    return f"{browser}({os_name})" if os_name else browser


def encode_key(raw: bytes) -> str:
    """base64url(パディングなし)。32バイトなら43文字"""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def next_preferences(preferences: Optional[Dict[str, Any]], rotated_at_iso: str) -> Dict[str, Any]:
    """版を1つ上げた preferences を新しい dict で返す(JSON 列の変更を SQLAlchemy に検知させるため)"""
    updated = dict(preferences or {})
    updated[PREFERENCE_KEY] = {"version": current_version(preferences) + 1, "rotated_at": rotated_at_iso}
    return updated
