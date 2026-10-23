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

[Gate G1] SEC-F1 鍵の版の切り替え(docs/ops/KEY-INVENTORY.md・Runbook §8.2):
- ``ENCRYPTION_KEY`` は「今の鍵」(新しく暗号化する時はこれだけを使う)。
- ``ENCRYPTION_KEYS_PREVIOUS`` (カンマ区切り)は「前の鍵」。復号だけに使う(retired)。
  ここから外した鍵は失効(revoked)し、その鍵の暗号文は読めなくなる。
- 鍵の版は、鍵から作る指紋(``key_id``、SHA-256 の先頭12桁)で表す。値は表示・保存しない。
- 既存の暗号文の書式(Fernet)は変えない。どの鍵の暗号文かは、各鍵で検証して判定する(``key_id_of``)。
  そのため DB の変更(migration)は要らない。
- 前の鍵の暗号文を今の鍵へ掛け直すのは ``python -m app.ops.rekey run``(途中で止めても再開できる)。
"""
import base64
import hashlib
import hmac
from functools import lru_cache
from typing import List, Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings


class EncryptionNotConfigured(RuntimeError):
    """ENCRYPTION_KEY が.envに設定されていない場合に送出する。"""


class LookupIndexNotConfigured(RuntimeError):
    """[Gate R3-13] LOOKUP_INDEX_KEY が.envに設定されていない場合に送出する。"""


def key_id(secret: Optional[str]) -> Optional[str]:
    """[Gate G1] 鍵の版の名前(指紋)。運用の道具(app/ops/opslib.key_fingerprint)と同じ式。値そのものは出さない。"""
    if not secret:
        return None
    return hashlib.sha256(("travelcanvas-key-fingerprint:" + secret).encode("utf-8")).hexdigest()[:12]


def _fernet_for(secret: str) -> Fernet:
    # 任意長の文字列を、Fernetが要求する32byte urlsafe base64 keyへ決定的に導出する。
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest()))


def parse_previous_keys(raw: Optional[str]) -> List[str]:
    """[Gate G1] ENCRYPTION_KEYS_PREVIOUS(カンマ区切り。前後の空白は無視・空の要素と重複は捨てる)。"""
    out: List[str] = []
    for part in (raw or "").split(","):
        part = part.strip()
        if part and part not in out:
            out.append(part)
    return out


@lru_cache(maxsize=1)
def _keyring() -> Tuple[Tuple[str, Fernet], ...]:
    """[Gate G1] (key_id, Fernet) の並び。先頭が今の鍵、続いて前の鍵(設定の順)。"""
    key = getattr(settings, "ENCRYPTION_KEY", None)
    if not key:
        raise EncryptionNotConfigured(
            "ENCRYPTION_KEY が設定されていません。QuickDraft機能を有効にするには "
            ".env へ ENCRYPTION_KEY を設定してください。"
        )
    ring = [(str(key_id(key)), _fernet_for(key))]
    for old in parse_previous_keys(getattr(settings, "ENCRYPTION_KEYS_PREVIOUS", None)):
        if old == key:
            continue
        ring.append((str(key_id(old)), _fernet_for(old)))
    return tuple(ring)


@lru_cache(maxsize=1)
def _get_fernet() -> MultiFernet:
    """暗号化は先頭(今の鍵)、復号は全ての鍵を順に試す。"""
    return MultiFernet([f for _, f in _keyring()])


def active_key_id() -> str:
    return _keyring()[0][0]


def keyring_ids() -> List[str]:
    """[Gate G1] 今の鍵・前の鍵の版(指紋)。先頭が今の鍵。"""
    return [kid for kid, _ in _keyring()]


def key_id_of(ciphertext: bytes) -> Optional[str]:
    """[Gate G1] この暗号文がどの鍵で作られたか(どの鍵でも検証できなければ None = 壊れている・失効した鍵)。

    [Gate G3] データ鍵の暗号文(tc2:dek:)は、データ鍵が読めれば今の鍵の版を返す(データ鍵を包む鍵の切り替えは
    data_keys の行を掛け直すので、値そのものは掛け直さない)。破棄したデータ鍵なら None。
    TOTP の鍵の暗号文(tc2:mfa:)は ``"mfa:" + 版`` を返す。"""
    token = bytes(ciphertext)
    env = parse_envelope(token)
    if env is not None:
        kind, ref, body = env
        if kind == "dek":
            from app.services import data_keys

            try:
                data_keys.key_for(ref).decrypt(body)
            except (data_keys.DataKeyDestroyed, InvalidToken, ValueError):
                return None
            return active_key_id()
        if kind == "mfa":
            for kid, f in _mfa_keyring():
                if kid == ref:
                    try:
                        f.decrypt(body)
                        return "mfa:" + kid
                    except InvalidToken:
                        return None
            return None
        return None
    for kid, f in _keyring():
        try:
            f.decrypt(token)
            return kid
        except InvalidToken:
            continue
    return None


def reencrypt(ciphertext: bytes) -> Tuple[bytes, Optional[str], bool]:
    """[Gate G1] 前の鍵の暗号文を今の鍵で掛け直す。戻り値: (新しい暗号文, 元の鍵の版, 掛け直したか)。

    今の鍵の暗号文はそのまま返す(何度実行しても同じ結果)。どの鍵でも読めない暗号文は ValueError。
    中身(平文)は呼び出し側へ返さない。"""
    token = bytes(ciphertext)
    kid = key_id_of(token)
    if kid is None:
        raise ValueError("どの鍵でも復号できない暗号文です")
    if kid.startswith("mfa:"):
        if kid == "mfa:" + _mfa_keyring()[0][0]:
            return token, kid, False
        return encrypt_mfa(decrypt_payload(token)), kid, True
    if kid == active_key_id():
        return token, kid, False
    return _get_fernet().rotate(token), kid, True


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
    _keyring.cache_clear()
    _get_fernet.cache_clear()
    _get_lookup_index_key.cache_clear()
    _mfa_keyring.cache_clear()
    from app.services import data_keys

    data_keys.reset_cache()


def normalize_lookup_value(raw: str) -> str:
    """[Gate R3-13] blind index計算前の正規化(前後空白除去+大文字化)。登録時と
    検索時で同一の正規化を適用しないとHMACが一致しないため、この関数を
    両方の経路(作成/更新/検索)から必ず経由する。"""
    return raw.strip().upper()


def compute_lookup_hash(raw: str) -> str:
    """[Gate R3-13] DOC-11 §6.3 / DOC-08 §19 blind index。confirmation_number等の
    暗号化フィールドに対する完全一致検索のためのHMAC-SHA256決定的ハッシュを
    16進文字列で返す。POC-03「完全一致または末尾検索だけに制限」のうち
    完全一致側を実装する(末尾検索は下記compute_suffix_lookup_hash参照)。"""
    mac = hmac.new(_get_lookup_index_key(), normalize_lookup_value(raw).encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()


# [Gate R3-14] DOC-04 SC-17「予約番号: 既定表示=末尾4桁」/ SC-10「予約番号は
# 末尾検索を可能にしても結果画面ではマスクする」に合わせ、末尾検索の単位を
# 4文字に固定する(confirmation_number_maskedの表示単位と揃える)。
SUFFIX_LOOKUP_LENGTH = 4


def compute_suffix_lookup_hash(raw: str, length: int = SUFFIX_LOOKUP_LENGTH):
    """[Gate R3-14] POC-03「blind indexで予約番号末尾検索」に対応する、末尾N文字
    専用のHMAC blind index。完全一致用の`compute_lookup_hash`とは別の索引で
    あり、値の衝突を避けるため入力に固定タグ(`SUFFIXn:`)を付与してから
    HMAC計算する(同じ鍵を使っても、完全一致索引・末尾索引・将来追加され得る
    他の索引が互いに推測材料にならないようにするドメイン分離)。

    正規化後の文字列が`length`未満の場合はNoneを返す(索引を作らない)。
    短い予約番号に対して末尾一致検索を許すと、実質的に完全一致検索と
    同程度の絞り込み精度になり、末尾マスク表示("****1234"相当)が提供する
    はずの秘匿性を損なうため。
    """
    normalized = normalize_lookup_value(raw)
    if len(normalized) < length:
        return None
    suffix = normalized[-length:]
    mac = hmac.new(
        _get_lookup_index_key(), f"SUFFIX{length}:{suffix}".encode("utf-8"), hashlib.sha256
    )
    return mac.hexdigest()


def compute_participant_name_lookup_hash(raw: str) -> str:
    """[Gate R3-15] reservation_participants.nameに対する完全一致blind index。
    `compute_lookup_hash`(confirmation_number用)とは別ドメイン
    (`"PARTICIPANT_NAME:"`タグ)のHMACとする。異なるフィールド間で索引値の
    相関を取れないようにするドメイン分離であり、Gate R3-14の
    `compute_suffix_lookup_hash`と同じ考え方。"""
    mac = hmac.new(
        _get_lookup_index_key(),
        f"PARTICIPANT_NAME:{normalize_lookup_value(raw)}".encode("utf-8"),
        hashlib.sha256,
    )
    return mac.hexdigest()


# ---------------------------------------------------------------------------
# [Gate G3] 暗号文の封筒(envelope)。``tc2:<種類>:<鍵の参照>:<Fernet の暗号文>``
#   dek: 旅行・利用者ごとのデータ鍵(app/services/data_keys.py。鍵の破棄による削除、SEC-F5)
#   mfa: TOTP の秘密を包む鍵(MFA_KEY・MFA_KEYS_PREVIOUS。版つき、SEC-F6)
# 封筒の無い暗号文は以前と同じ ENCRYPTION_KEY(と前の鍵)の Fernet。
# ---------------------------------------------------------------------------
ENVELOPE_PREFIX = b"tc2:"


def parse_envelope(token: bytes) -> Optional[Tuple[str, str, bytes]]:
    if not token.startswith(ENVELOPE_PREFIX):
        return None
    parts = token[len(ENVELOPE_PREFIX):].split(b":", 2)
    if len(parts) != 3:
        return None
    try:
        return parts[0].decode("ascii"), parts[1].decode("ascii"), parts[2]
    except UnicodeDecodeError:
        return None


def plan_subject(plan_id):
    """[Gate G3] 旅行のデータ鍵で暗号化する対象(ID が無ければ None = ENCRYPTION_KEY だけ)。"""
    from app.services.data_keys import subject

    return subject("plan", plan_id)


def user_subject(user_id):
    """[Gate G3] 利用者のデータ鍵で暗号化する対象。"""
    from app.services.data_keys import subject

    return subject("user", user_id)


def encrypt_payload(plaintext: bytes, subject=None) -> bytes:
    """暗号化する。``subject``(plan_subject・user_subject)を渡すと、その対象のデータ鍵で暗号化する
    (対象を消すと鍵を破棄し、バックアップからも読めなくなる)。渡さなければ ENCRYPTION_KEY。"""
    if subject is not None:
        _get_fernet()  # ENCRYPTION_KEY が無ければ EncryptionNotConfigured(以前と同じ)
        from app.services import data_keys

        dek_id, f = data_keys.active_key(subject)
        return ENVELOPE_PREFIX + b"dek:" + dek_id.encode("ascii") + b":" + f.encrypt(plaintext)
    return _get_fernet().encrypt(plaintext)


def decrypt_payload(ciphertext: bytes) -> bytes:
    token = bytes(ciphertext)
    env = parse_envelope(token)
    try:
        if env is not None:
            kind, ref, body = env
            if kind == "dek":
                from app.services import data_keys

                return data_keys.key_for(ref).decrypt(body)
            if kind == "mfa":
                ring = dict(_mfa_keyring())
                f = ring.get(ref)
                if f is None:
                    raise ValueError("TOTP の鍵(MFA_KEY)の版が見つかりません")
                return f.decrypt(body)
            raise ValueError("暗号文の種類が不明です")
        return _get_fernet().decrypt(token)
    except InvalidToken as e:
        raise ValueError("payload_ciphertextの復号に失敗しました") from e


@lru_cache(maxsize=1)
def _mfa_keyring() -> Tuple[Tuple[str, Fernet], ...]:
    """[Gate G3] SEC-F6 TOTP の秘密を包む鍵(今の鍵が先頭)。MFA_KEY が無ければ空。"""
    key = getattr(settings, "MFA_KEY", None)
    if not key:
        return tuple()
    ring = [(str(key_id(key)), _fernet_for("travelcanvas-mfa-kek:" + key))]
    for old in parse_previous_keys(getattr(settings, "MFA_KEYS_PREVIOUS", None)):
        if old != key:
            ring.append((str(key_id(old)), _fernet_for("travelcanvas-mfa-kek:" + old)))
    return tuple(ring)


def mfa_key_configured() -> bool:
    return bool(_mfa_keyring())


def mfa_keyring_ids() -> List[str]:
    return [kid for kid, _ in _mfa_keyring()]


def encrypt_mfa(plaintext: bytes) -> bytes:
    """[Gate G3] SEC-F6 TOTP の秘密の暗号化。MFA_KEY があれば今の版で(封筒つき)、無ければ以前と同じ ENCRYPTION_KEY。"""
    ring = _mfa_keyring()
    if not ring:
        return _get_fernet().encrypt(plaintext)
    kid, f = ring[0]
    return ENVELOPE_PREFIX + b"mfa:" + kid.encode("ascii") + b":" + f.encrypt(plaintext)
