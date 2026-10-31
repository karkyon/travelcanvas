"""[Gate SecretPolicy] 外部 API の鍵。取得元は「運用コンソールで登録した有効な版(provider_secrets)」だけ。

- 鍵は ENCRYPTION_KEY で暗号化して provider_secrets に持つ。平文を返す API は無い(``resolve`` はサーバーの中で使うだけ)
- **.env・プロセスの環境変数・settings へは戻らない**。有効な版が無い・無効化済み・復号できない・サンプル値の時は
  ``SecretUnavailable`` を投げ、呼び出し側はその提供元へ送らない(fail closed)
- 旧 .env の値は「あるかどうか」だけを表示し、使わない。使いたい時は管理者の明示操作 ``import_from_env`` で、
  通常の取得とは別に、登録の検査(サンプル値の拒否など)を通して新しい版にする
- 「登録した」「取得できる」「提供元が認めた」は別の状態。このモジュールが答えるのは前の2つだけで、提供元の認証は
  常に ``unverified``(検証の機能は別 Gate)。つまり鍵の登録だけでは送信可能にならない
- 画面・応答・監査に出すのは末尾4文字・版・登録の日時・状態だけ
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.config import settings
from app.models.models import ProviderSecret

# slot → 表示の名前・使う提供元・旧 .env の名前(移行の検出だけに使う)
SLOTS: Dict[str, Dict[str, Any]] = {
    "openai_api_key": {"label": "OpenAI の API キー", "providers": ["openai"], "env": "OPENAI_API_KEY",
                       "hint": "OpenAI Platform の API キー(sk-…)。ChatGPT の契約とは別"},
    "google_maps_browser_key": {"label": "Google Maps のブラウザ用キー", "providers": ["google_maps_js"],
                                "env": "GOOGLE_MAPS_API_KEY",
                                "hint": "HTTP referrer と Maps JavaScript API だけに制限したキー。現在の地図は OpenStreetMap のため使いません"},
    "google_maps_server_key": {"label": "Google Maps Platform のサーバー用キー",
                               "providers": ["google_places", "google_routes"], "env": "GOOGLE_PLACES_API_KEY",
                               "hint": "Places API (New)・Routes API だけに制限したサーバー用のキー"},
}
MIN_LEN, MAX_LEN = 8, 512

# 保管先。db_encrypted は暫定(ENCRYPTION_KEY で暗号化した provider_secrets 表)。最終の正本は gcp_secret_manager だが、
# 実行ID・最小IAM・版の固定・復旧が整うまで未接続(選ばれたら鍵を取得せず fail closed。db_encrypted へ黙って戻らない)
BACKENDS = ("db_encrypted", "gcp_secret_manager")

# 全体がこの値(大文字・- は _ に正規化)ならサンプル。本物の鍵に偶然含まれる部分文字列では拒否しない
_PLACEHOLDER_EXACT = frozenset({
    "PLACEHOLDER", "EXAMPLE", "SAMPLE", "DUMMY", "TODO", "TBD", "NONE", "NULL", "NIL", "UNDEFINED", "EMPTY",
    "API_KEY", "APIKEY", "SECRET", "TEST_KEY", "TESTKEY", "YOUR_API_KEY", "XXXXXXXX",
})
# 先頭がこれならサンプル(CHANGE_ME_MANUAL_ROTATION_REQUIRED・YOUR_OPENAI_KEY_HERE など)
_PLACEHOLDER_PREFIXES = ("CHANGE_ME", "CHANGEME", "REPLACE_ME", "REPLACEME", "REPLACE_WITH", "YOUR_", "INSERT_",
                         "ENTER_", "PUT_YOUR", "PASTE_")
_PLACEHOLDER_PATTERNS = (re.compile(r"^X{4,}$"), re.compile(r"^\*{3,}$"), re.compile(r"^\.{3,}$"),
                         re.compile(r"^<.*>$"), re.compile(r"^\$\{.*\}$"), re.compile(r"^\{\{.*\}\}$"))


def backend() -> str:
    """設定で明示された保管先。未設定は unset、知らない値は invalid(どちらも使えない扱い)。自動で別の保管先へ切り替えない。"""
    value = (getattr(settings, "SECRET_BACKEND", None) or "").strip().lower()
    if not value:
        return "unset"  # 明示されていない。既定の保管先は無い(DB へも自動で選ばない)
    return value if value in BACKENDS else "invalid"


def backend_ready() -> bool:
    return backend() == "db_encrypted"


class SecretError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class SecretUnavailable(RuntimeError):
    """送信に使える鍵が無い。code は secret_missing / secret_disabled / secret_decrypt_failed /
    secret_placeholder / secret_invalid / secret_backend_unavailable。呼び出し側は送らない(.env など別の取得元へ戻らない)。"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def classify_format(value: Any) -> str:
    """鍵の形の判定。acceptable / placeholder / malformed。CMS 入力・移行・保存済み・.env の検出で同じ規則を使う。"""
    if not isinstance(value, str):
        return "malformed"
    text = value.strip()
    if not text:
        return "malformed"
    norm = text.upper().replace("-", "_")
    if (norm in _PLACEHOLDER_EXACT or norm.startswith(_PLACEHOLDER_PREFIXES)
            or any(p.match(text) or p.match(norm) for p in _PLACEHOLDER_PATTERNS)):
        return "placeholder"
    if any(ch.isspace() for ch in text) or not text.isprintable():
        return "malformed"
    if not MIN_LEN <= len(text) <= MAX_LEN:
        return "malformed"
    return "acceptable"


def slot_for_provider(provider: str) -> Optional[str]:
    for slot, spec in SLOTS.items():
        if provider in spec["providers"]:
            return slot
    return None


def _legacy_env_raw(slot: str) -> Optional[str]:
    """旧 .env(settings・プロセスの環境変数)の値。**移行と検出だけ**。resolve・state の値としては使わない。"""
    name = SLOTS[slot]["env"]
    value = getattr(settings, name, None) or os.environ.get(name)
    return value or None


def legacy_env_info(slot: str) -> Dict[str, Any]:
    """旧 .env に値があるか(値は返さない)。placeholder は、サンプル値が残っているという意味。"""
    raw = _legacy_env_raw(slot)
    if raw is None:
        return {"present": False, "placeholder": False, "importable": False}
    fmt = classify_format(raw)
    return {"present": True, "placeholder": fmt == "placeholder", "importable": fmt == "acceptable"}


def _iso(moment: Optional[datetime]) -> Optional[str]:
    return moment.replace(microsecond=0).isoformat() if moment else None


def _active(db: Session, slot: str) -> Optional[ProviderSecret]:
    return (db.query(ProviderSecret).filter(ProviderSecret.slot == slot, ProviderSecret.status == "active")
            .first())


def _latest(db: Session, slot: str) -> Optional[ProviderSecret]:
    return (db.query(ProviderSecret).filter(ProviderSecret.slot == slot)
            .order_by(ProviderSecret.version.desc()).first())


def _read_active(row: ProviderSecret) -> str:
    """有効な版を復号して形を検査する。使えなければ SecretUnavailable(.env へは戻らない)。"""
    try:
        plain = crypto.decrypt_payload(bytes(row.secret_ciphertext)).decode("utf-8")
    except Exception:  # noqa: BLE001 - 値・例外の内容は出さない
        raise SecretUnavailable("secret_decrypt_failed")
    fmt = classify_format(plain)
    if fmt == "placeholder":
        raise SecretUnavailable("secret_placeholder")
    if fmt != "acceptable":
        raise SecretUnavailable("secret_invalid")
    return plain


def resolve(db: Session, slot: str) -> str:
    """サーバーの中で provider を呼ぶ時だけ使う(画面・応答・ログに出さない)。
    有効な登録版だけが取得元。無い・無効化済み・復号不能・サンプル値は SecretUnavailable(送らない)。"""
    if slot not in SLOTS:
        raise SecretUnavailable("secret_missing")
    if not backend_ready():
        raise SecretUnavailable("secret_backend_unavailable")
    row = _active(db, slot)
    if row is None:
        latest = _latest(db, slot)
        raise SecretUnavailable("secret_disabled" if latest is not None and latest.status == "disabled"
                                else "secret_missing")
    return _read_active(row)


def state(db: Session, slot: str) -> Dict[str, Any]:
    """鍵の状態(値は含まない)。status: missing / disabled / configured(登録済み・取得でき形は正しい) /
    placeholder / invalid / decrypt_failed。configured は「提供元が認めた」ではない(provider_auth は unverified)。"""
    out: Dict[str, Any] = {"status": "missing", "source": None, "version": None, "last4": None, "registered_at": None,
                           "format": None, "retrieval": None, "provider_auth": "unverified",
                           "backend": backend(), "env_legacy": legacy_env_info(slot)}
    if not backend_ready():
        out["status"] = "backend_unavailable"  # 保管先が未接続・不正。鍵があるかは言わない(取得もしない)
        return out
    row = _active(db, slot)
    if row is None:
        latest = _latest(db, slot)
        if latest is not None and latest.status == "disabled":
            out.update(status="disabled", version=latest.version, last4=latest.last4,
                       registered_at=_iso(latest.created_at))
        return out
    out.update(source="cms", version=row.version, last4=row.last4, registered_at=_iso(row.created_at))
    try:
        _read_active(row)
        out.update(status="configured", format="acceptable", retrieval="readable")
    except SecretUnavailable as error:
        mapping = {"secret_decrypt_failed": ("decrypt_failed", None, "decrypt_failed"),
                   "secret_placeholder": ("placeholder", "placeholder", "readable"),
                   "secret_invalid": ("invalid", "malformed", "readable")}
        status, fmt, retrieval = mapping[error.code]
        out.update(status=status, format=fmt, retrieval=retrieval)
    return out


def history(db: Session, slot: str, limit: int = 10) -> List[Dict[str, Any]]:
    rows = (db.query(ProviderSecret).filter(ProviderSecret.slot == slot)
            .order_by(ProviderSecret.version.desc()).limit(limit).all())
    return [{"version": r.version, "status": r.status, "last4": r.last4, "reason": r.reason,
             "created_at": r.created_at.replace(microsecond=0).isoformat() if r.created_at else None,
             "disabled_at": r.disabled_at.replace(microsecond=0).isoformat() if r.disabled_at else None}
            for r in rows]


Hook = Callable[[Session, ProviderSecret], None]


def _commit(db: Session, row: ProviderSecret, on_before_commit: Optional[Hook]) -> None:
    """鍵の変更と監査を同じトランザクションで確定する。監査が書けなければ鍵の変更も取り消す(fail closed)。"""
    try:
        if on_before_commit is not None:
            on_before_commit(db, row)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise SecretError("secret_conflict", "同時に別の登録・無効化が行われました。画面を読み直してもう一度操作してください")
    except Exception:  # noqa: BLE001 - 監査の失敗など。鍵は変えない
        db.rollback()
        raise SecretError("audit_unavailable", "監査を残せなかったため、鍵は変更しませんでした")


def register(db: Session, slot: str, value: Any, reason: str, actor_id: uuid.UUID,
             on_before_commit: Optional[Hook] = None) -> ProviderSecret:
    """新しい版を有効にし、前の有効な版を superseded にする。サンプル値・形が正しくない値は何も変えずに SecretError。"""
    if slot not in SLOTS:
        raise SecretError("unknown_secret_slot", "知らない鍵の種類です")
    if not backend_ready():
        raise SecretError("secret_backend_unavailable", "鍵の保管先(SECRET_BACKEND)が未接続か不正なため、操作できません")
    if not isinstance(value, str):
        raise SecretError("invalid_secret_value", "鍵は文字列で入力してください")
    value = value.strip()
    fmt = classify_format(value)
    if fmt == "placeholder":
        raise SecretError("placeholder_secret", "サンプルの値(CHANGE_ME など)は鍵として登録できません。提供元で発行した本物の鍵を入力してください")
    if fmt != "acceptable":
        raise SecretError("invalid_secret_value", f"鍵は空白を含まない {MIN_LEN}〜{MAX_LEN} 文字で入力してください")
    try:
        ciphertext = crypto.encrypt_payload(value.encode("utf-8"))
    except Exception:  # noqa: BLE001 - ENCRYPTION_KEY が無い
        raise SecretError("secret_encryption_unavailable", "サーバーの暗号化の鍵(ENCRYPTION_KEY)が無いため保存できません")
    current = (db.query(ProviderSecret).filter(ProviderSecret.slot == slot, ProviderSecret.status == "active")
               .with_for_update().first())
    next_version = int(db.query(func.coalesce(func.max(ProviderSecret.version), 0))
                       .filter(ProviderSecret.slot == slot).scalar() or 0) + 1
    if current is not None:
        current.status = "superseded"
        current.disabled_at = datetime.now(timezone.utc)
        current.disabled_by = actor_id
        db.flush()
    row = ProviderSecret(id=uuid.uuid4(), slot=slot, version=next_version, status="active",
                         secret_ciphertext=ciphertext, last4=value[-4:], reason=reason[:200], created_by=actor_id)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise SecretError("secret_conflict", "同時に別の登録が行われました。画面を読み直してもう一度操作してください")
    _commit(db, row, on_before_commit)
    db.refresh(row)
    return row


def import_from_env(db: Session, slot: str, reason: str, actor_id: uuid.UUID,
                    on_before_commit: Optional[Hook] = None) -> ProviderSecret:
    """旧 .env の値を、管理者の明示操作で新しい版として登録する(通常の取得には混ぜない)。
    サンプル値・形が正しくない値は register と同じ検査で拒否。.env の値は消さない・値を応答に出さない。"""
    if slot not in SLOTS:
        raise SecretError("unknown_secret_slot", "知らない鍵の種類です")
    if not backend_ready():
        raise SecretError("secret_backend_unavailable", "鍵の保管先(SECRET_BACKEND)が未接続か不正なため、操作できません")
    raw = _legacy_env_raw(slot)
    if raw is None:
        raise SecretError("env_value_missing", "旧 .env に取り込める値がありません")
    return register(db, slot, raw, reason, actor_id, on_before_commit)


def disable(db: Session, slot: str, actor_id: uuid.UUID,
            on_before_commit: Optional[Hook] = None) -> Optional[ProviderSecret]:
    """有効な版を無効にする。以後 resolve は SecretUnavailable(.env・古い版へは戻らない)。無ければ None。"""
    if slot not in SLOTS:
        raise SecretError("unknown_secret_slot", "知らない鍵の種類です")
    if not backend_ready():
        raise SecretError("secret_backend_unavailable", "鍵の保管先(SECRET_BACKEND)が未接続か不正なため、操作できません")
    row = (db.query(ProviderSecret).filter(ProviderSecret.slot == slot, ProviderSecret.status == "active")
           .with_for_update().first())
    if row is None:
        return None
    row.status = "disabled"
    row.disabled_at = datetime.now(timezone.utc)
    row.disabled_by = actor_id
    _commit(db, row, on_before_commit)
    return row
