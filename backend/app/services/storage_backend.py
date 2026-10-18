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
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

from app.core.config import settings
from app.core.crypto import decrypt_payload, encrypt_payload
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


_TOKEN_VERSION = "v2"


def _sign(payload: str) -> str:
    return hmac.new(_get_download_signing_key(), payload.encode("utf-8"), hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class DownloadGrant:
    """[Gate S4] F08 ダウンロード URL に結び付けた条件。受け取り時に、今も同じ条件かを確かめる。"""
    document_id: str
    user_id: Optional[str]
    revision: Optional[int]
    session_id: Optional[str]
    expires_at: int


def issue_download_token(document_id, ttl_seconds: Optional[int] = None, *, user_id=None, revision=None,
                         session_id=None) -> Tuple[str, int]:
    """[Gate M5] DOC-02 FR-013「期限付きURL」対応。戻り値は(トークン, 有効期限unix秒)。

    [Gate S4] F08 発行した利用者・文書の版(revision)・ログインのセッションを署名に含める。受け取り時に
    その利用者が今も見られるか(共有の取消・分類の変更・ログアウトを反映)を確かめるため。
    user_id を渡さない古い形のトークンは、受け取り口では拒否される(期限切れの確認など試験用)。"""
    ttl = ttl_seconds if ttl_seconds is not None else settings.DOCUMENT_DOWNLOAD_URL_TTL_SECONDS
    expires_at = int(time.time()) + ttl
    if user_id is None:
        payload = f"{document_id}.{expires_at}"
        return f"{payload}.{_sign(payload)}", expires_at
    parts = [
        _TOKEN_VERSION, str(document_id), str(user_id), str(int(revision or 0)),
        str(session_id) if session_id else "-", str(expires_at),
    ]
    payload = ".".join(parts)
    return f"{payload}.{_sign(payload)}", expires_at


def verify_download_token(token: str) -> str:
    """トークンを検証し、document_id(文字列)を返す。無効・期限切れの
    場合はDownloadTokenInvalidを送出する。"""
    return read_download_grant(token, allow_unbound=True).document_id


def read_download_grant(token: str, allow_unbound: bool = False) -> DownloadGrant:
    """[Gate S4] 署名と期限を確かめ、結び付いた条件を返す。allow_unbound=False では古い形(利用者の無い)を拒否する。"""
    if not isinstance(token, str) or len(token) > 512:
        raise DownloadTokenInvalid("トークンの形式が不正です")
    payload, _, signature = token.rpartition(".")
    if not payload or not signature:
        raise DownloadTokenInvalid("トークンの形式が不正です")
    if not hmac.compare_digest(signature, _sign(payload)):
        raise DownloadTokenInvalid("トークンの署名が一致しません")
    fields = payload.split(".")
    try:
        if fields[0] == _TOKEN_VERSION and len(fields) == 6:
            grant = DownloadGrant(
                document_id=fields[1], user_id=fields[2], revision=int(fields[3]),
                session_id=None if fields[4] == "-" else fields[4], expires_at=int(fields[5]),
            )
        elif len(fields) == 2:
            grant = DownloadGrant(document_id=fields[0], user_id=None, revision=None, session_id=None,
                                  expires_at=int(fields[1]))
        else:
            raise ValueError
    except ValueError:
        raise DownloadTokenInvalid("トークンの形式が不正です")
    if time.time() > grant.expires_at:
        raise DownloadTokenInvalid("トークンの有効期限が切れています")
    if grant.user_id is None and not allow_unbound:
        raise DownloadTokenInvalid("古い形式のトークンです。もう一度ダウンロードしてください")
    return grant


# ===== [Gate S4] F09 受け取りの上限 =====

async def read_upload_limited(upload, max_bytes: int) -> bytes:
    """アップロードを少しずつ読み、上限を超えた時点で FileTooLargeError にする(全部を読んでから測らない)。"""
    chunks = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise FileTooLargeError(f"ファイルサイズが上限({max_bytes}バイト)を超えています")
        chunks.append(chunk)
    return b"".join(chunks)
