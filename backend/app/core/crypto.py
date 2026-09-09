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
import hmac
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class EncryptionNotConfigured(RuntimeError):
    """ENCRYPTION_KEY が.envに設定されていない場合に送出する。"""


class LookupIndexNotConfigured(RuntimeError):
    """[Gate R3-13] LOOKUP_INDEX_KEY が.envに設定されていない場合に送出する。"""


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


@lru_cache(maxsize=1)
def _get_lookup_index_key() -> bytes:
    """[Gate R3-13] DOC-08 §19「Lookup: HMAC blind index、用途別key」に従い、
    データ暗号化用のENCRYPTION_KEYとは別鍵にする(用途別の鍵分離。片方が
    漏洩してももう片方の保護には影響しない設計)。"""
    key = getattr(settings, "LOOKUP_INDEX_KEY", None)
    if not key:
        raise LookupIndexNotConfigured(
            "LOOKUP_INDEX_KEY が設定されていません。予約番号等の完全一致検索を"
            "有効にするには .env へ LOOKUP_INDEX_KEY を設定してください。"
        )
    return key.encode("utf-8")


def reset_cache_for_tests() -> None:
    """テストでENCRYPTION_KEY/LOOKUP_INDEX_KEYの有無を切り替える際にキャッシュを
    破棄するためのヘルパー。アプリケーション本体からは呼ばない。"""
    _get_fernet.cache_clear()
    _get_lookup_index_key.cache_clear()


def normalize_lookup_value(raw: str) -> str:
    """[Gate R3-13] blind index計算前の正規化(前後空白除去+大文字化)。登録時と
    検索時で同一の正規化を適用しないとHMACが一致しないため、この関数を
    両方の経路(作成/更新/検索)から必ず経由する。"""
    return raw.strip().upper()


def compute_lookup_hash(raw: str) -> str:
    """[Gate R3-13] DOC-11 §6.3 / DOC-08 §19 blind index。confirmation_number等の
    暗号化フィールドに対する完全一致検索のためのHMAC-SHA256決定的ハッシュを
    16進文字列で返す。POC-03「完全一致または末尾検索だけに制限」のうち
    完全一致側のみを実装する(末尾検索は次Gateスコープ、ADR参照)。"""
    mac = hmac.new(_get_lookup_index_key(), normalize_lookup_value(raw).encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()


def encrypt_payload(plaintext: bytes) -> bytes:
    return _get_fernet().encrypt(plaintext)


def decrypt_payload(ciphertext: bytes) -> bytes:
    try:
        return _get_fernet().decrypt(ciphertext)
    except InvalidToken as e:
        raise ValueError("payload_ciphertextの復号に失敗しました") from e
