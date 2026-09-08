"""
[Gate R2-2] QuickDraft payload field encryption.

settings.ENCRYPTION_KEY を基にした対称鍵暗号化(Fernet)。QuickDraftの
payload_ciphertextを対象としたfield encryptionであり、DOC-11 §6.3が
本来求めるDEK/KMSによるenvelope encryption(鍵ローテーション、per-value
data key、KMS wrap)ではない。これは意図的なスコープ限定であり、
docs/adr/ADR-quick-draft.md §8にfollow-upとして明記している。

ENCRYPTION_KEYはSettings上Optionalとした(config.py参照)。既存の必須
設定(DATABASE_URL/JWT_SECRET_KEY等)と異なり、これを必須にすると
omega-dev2の.envに未設定の場合にbackend全体が起動不能になる
(QuickDraftという新機能1つのために既存の全APIを道連れにする)ため、
未設定時はQuickDraft関連の呼び出し時にのみ明確なエラーを返す設計とする。
"""
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class EncryptionNotConfigured(RuntimeError):
    """ENCRYPTION_KEY が.envに設定されていない場合に送出する。"""


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    key = getattr(settings, "ENCRYPTION_KEY", None)
    if not key:
        raise EncryptionNotConfigured(
            "ENCRYPTION_KEY が設定されていません。QuickDraft機能を有効にするには "
            ".env へ ENCRYPTION_KEY を設定してください。"
        )
    # 任意長の文字列を、Fernetが要求する32byte urlsafe base64 keyへ決定的に導出する。
    derived = base64.urlsafe_b64encode(hashlib.sha256(key.encode("utf-8")).digest())
    return Fernet(derived)


def reset_cache_for_tests() -> None:
    """テストでENCRYPTION_KEYの有無を切り替える際にキャッシュを破棄するための
    ヘルパー。アプリケーション本体からは呼ばない。"""
    _get_fernet.cache_clear()


def encrypt_payload(plaintext: bytes) -> bytes:
    return _get_fernet().encrypt(plaintext)


def decrypt_payload(ciphertext: bytes) -> bytes:
    try:
        return _get_fernet().decrypt(ciphertext)
    except InvalidToken as e:
        raise ValueError("payload_ciphertextの復号に失敗しました") from e
