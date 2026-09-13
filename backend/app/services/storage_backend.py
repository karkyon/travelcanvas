"""
[Gate M5] FR-013文書ウォレットのObject Storage実連携。

実クラウドストレージ(AWS S3等)のAPIキーは未提供のため(他の外部連携
機能と同じ制約。route_estimator.pyのGoogle Directions未導入と同様)、
本Gateでは`LocalFilesystemBackend`(dockerボリューム上のローカルディスク)
を実装する。`StorageBackend`インターフェースを介して抽象化しており、
将来実クラウドproviderの認証情報が提供された場合は、同インターフェースを
実装するアダプタ(例: `S3Backend`)へ設定一つで差し替えられる設計とする。

保存するファイル内容自体は、既存のFernet field encryption
(app/core/crypto.py、ENCRYPTION_KEY)で暗号化してからディスクへ書き込む
(DOC-02 FR-013「暗号化を適用する」に対応)。`Document.encryption_key_ref`
列は、KMSによるper-file envelope encryption鍵への参照用に予約されている
別概念であり、KMS未導入の本Gateでは常にNULLのままとする(DOC-05 §6.5)。
"""
import hashlib
import hmac
import os
import time
import uuid
from pathlib import Path
from typing import Optional, Tuple

from app.core.config import settings
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload
from app.utils.validators import ALLOWED_DOCUMENT_EXTENSIONS, ALLOWED_IMAGE_EXTENSIONS

# [Gate M5] DOC-02 FR-013の対象文書種別(予約確認書/旅券写し/保険/ビザ/
# 領収書/地図/案内)を包含する許可拡張子。画像(スキャン・写真)とPDF/
# オフィス文書の双方を許可する。
ALLOWED_UPLOAD_EXTENSIONS = ALLOWED_DOCUMENT_EXTENSIONS | ALLOWED_IMAGE_EXTENSIONS

# 拡張子と、先頭バイト列(マジックナンバー)による簡易検証。
# python-magic等の外部ライブラリを追加導入せずに、宣言された拡張子と
# 実際のファイル内容が食い違う単純な偽装を検出する(本格的なウイルス
# スキャンの代替ではない。DOC-02「ファイルウイルス検査」は外部AVエンジン
# 未導入のため本Gateのスコープ外とし、ADR-object-storage.mdに明記する)。
_MAGIC_SIGNATURES = {
    ".pdf": [b"%PDF-"],
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".png": [b"\x89PNG\r\n\x1a\n"],
    ".gif": [b"GIF87a", b"GIF89a"],
    ".bmp": [b"BM"],
    ".webp": [b"RIFF"],
    # doc/docx/txt/mdはコンテナ形式(zip)またはテキストで多様なため、
    # 拡張子のみの検証に留める(誤検知でユーザーの正当な文書を拒否
    # しないため)。
}


class UnsupportedFileTypeError(ValueError):
    """許可拡張子/マジックナンバーと一致しないファイル。"""


class FileTooLargeError(ValueError):
    """DOCUMENT_MAX_UPLOAD_SIZE_BYTESを超過。"""


class DownloadSigningNotConfigured(RuntimeError):
    """DOCUMENT_DOWNLOAD_SIGNING_KEY未設定。"""


class DownloadTokenInvalid(ValueError):
    """署名不一致、期限切れ、または形式不正なダウンロードトークン。"""


def validate_upload(filename: str, content: bytes) -> Tuple[str, str]:
    """[Gate M5] アップロードされたファイルの拡張子・サイズ・マジック
    ナンバーを検証する。戻り値は (正規化された拡張子, mime_type)。
    不正な場合はUnsupportedFileTypeError/FileTooLargeErrorを送出する。
    """
    if len(content) > settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES:
        raise FileTooLargeError(
            f"ファイルサイズが上限({settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES}バイト)を"
            "超えています"
        )

    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise UnsupportedFileTypeError(f"許可されていないファイル形式です: {ext or '(拡張子なし)'}")

    signatures = _MAGIC_SIGNATURES.get(ext)
    if signatures and not any(content.startswith(sig) for sig in signatures):
        raise UnsupportedFileTypeError(
            f"ファイル内容が拡張子({ext})と一致しません(内容の偽装の可能性)"
        )

    import mimetypes
    mime_type, _ = mimetypes.guess_type(filename)
    return ext, mime_type or "application/octet-stream"


def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class StorageBackend:
    """[Gate M5] Object Storageの抽象インターフェース。実クラウド
    provider追加時はこのインターフェースを実装する。"""

    def save(self, storage_key: str, content: bytes) -> None:
        raise NotImplementedError

    def load(self, storage_key: str) -> bytes:
        raise NotImplementedError

    def delete(self, storage_key: str) -> None:
        raise NotImplementedError

    def exists(self, storage_key: str) -> bool:
        raise NotImplementedError


class LocalFilesystemBackend(StorageBackend):
    """[Gate M5] dockerボリューム上のローカルディスクをObject Storage
    として使う既定実装。storage_keyはplan_idごとのサブディレクトリを
    含む相対パスとする(`{plan_id}/{uuid}{ext}`)ことで、他planの
    ファイルへのpath traversalを構造的に防ぐ(APIレイヤーでの追加検証は
    行わない設計上の理由: storage_keyはAPIが生成しclientからは受け取ら
    ないため。§7参照)。
    """

    def __init__(self, base_dir: Optional[str] = None):
        self._base_dir = Path(base_dir or settings.DOCUMENT_STORAGE_DIR)

    def _resolve(self, storage_key: str) -> Path:
        # [Gate M5] "../" 等によるpath traversalを拒否する(storage_key自体は
        # APIが生成するため通常は安全だが、防御的に検証する)。
        candidate = (self._base_dir / storage_key).resolve()
        base_resolved = self._base_dir.resolve()
        if base_resolved not in candidate.parents and candidate != base_resolved:
            raise ValueError(f"不正なstorage_keyです: {storage_key}")
        return candidate

    def save(self, storage_key: str, content: bytes) -> None:
        path = self._resolve(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + f".tmp-{uuid.uuid4().hex}")
        with open(tmp_path, "wb") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)

    def load(self, storage_key: str) -> bytes:
        path = self._resolve(storage_key)
        with open(path, "rb") as f:
            return f.read()

    def delete(self, storage_key: str) -> None:
        path = self._resolve(storage_key)
        if path.exists():
            path.unlink()

    def exists(self, storage_key: str) -> bool:
        try:
            return self._resolve(storage_key).exists()
        except ValueError:
            return False


def get_storage_backend() -> StorageBackend:
    """[Gate M5] 設定されたObject Storage backendを返す。現時点では
    LocalFilesystemBackendのみ(§背景参照)。"""
    return LocalFilesystemBackend()


def generate_storage_key(plan_id, ext: str) -> str:
    return f"{plan_id}/{uuid.uuid4().hex}{ext}"


def save_encrypted_file(backend: StorageBackend, storage_key: str, content: bytes) -> None:
    """[Gate M5] ファイル内容をFernet暗号化してから保存する。
    ENCRYPTION_KEY未設定の場合はEncryptionNotConfiguredを送出する
    (呼び出し側でHTTPExceptionへ変換する)。"""
    ciphertext = encrypt_payload(content)
    backend.save(storage_key, ciphertext)


def load_decrypted_file(backend: StorageBackend, storage_key: str) -> bytes:
    ciphertext = backend.load(storage_key)
    return decrypt_payload(ciphertext)


# ===== [Gate M5] 期限付きダウンロードURL =====

def _get_download_signing_key() -> bytes:
    key = settings.DOCUMENT_DOWNLOAD_SIGNING_KEY
    if not key:
        raise DownloadSigningNotConfigured(
            "DOCUMENT_DOWNLOAD_SIGNING_KEYが設定されていません。期限付き"
            "ダウンロードURLを有効にするには.envへ設定してください。"
        )
    return key.encode("utf-8")


def issue_download_token(document_id, ttl_seconds: Optional[int] = None) -> Tuple[str, int]:
    """[Gate M5] DOC-02 FR-013「期限付きURL」対応。document_id+有効期限を
    HMAC署名したトークンを発行する。戻り値は(トークン, 有効期限unix秒)。"""
    ttl = ttl_seconds if ttl_seconds is not None else settings.DOCUMENT_DOWNLOAD_URL_TTL_SECONDS
    expires_at = int(time.time()) + ttl
    payload = f"{document_id}.{expires_at}"
    signature = hmac.new(_get_download_signing_key(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    token = f"{payload}.{signature}"
    return token, expires_at


def verify_download_token(token: str) -> str:
    """トークンを検証し、document_id(文字列)を返す。無効・期限切れの
    場合はDownloadTokenInvalidを送出する。"""
    try:
        document_id, expires_at_str, signature = token.split(".", 2)
        expires_at = int(expires_at_str)
    except (ValueError, AttributeError):
        raise DownloadTokenInvalid("トークンの形式が不正です")

    payload = f"{document_id}.{expires_at_str}"
    expected_signature = hmac.new(
        _get_download_signing_key(), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(signature, expected_signature):
        raise DownloadTokenInvalid("トークンの署名が一致しません")
    if time.time() > expires_at:
        raise DownloadTokenInvalid("トークンの有効期限が切れています")

    return document_id
