"""[Gate OpsSecrets] 運用コンソールで登録した外部 API の鍵。

- 鍵は ENCRYPTION_KEY で暗号化して provider_secrets に持つ。平文を返す API は無い(``resolve`` はサーバーの中で使うだけ)
- 使う順: 運用コンソールで登録した有効な版 → 無ければ環境変数(.env)の値 → 無ければ None
- 画面・応答・監査に出すのは末尾4文字・版・登録の日時・出典(cms/env)だけ
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.config import settings
from app.models.models import ProviderSecret

# slot → 表示の名前・使う提供元・環境変数(.env)の名前
SLOTS: Dict[str, Dict[str, Any]] = {
    "openai_api_key": {"label": "OpenAI の API キー", "providers": ["openai"], "env": "OPENAI_API_KEY",
                       "hint": "OpenAI Platform の API キー(sk-…)。ChatGPT の契約とは別"},
    "google_maps_browser_key": {"label": "Google Maps のブラウザ用キー", "providers": ["google_maps_js"],
                                "env": "GOOGLE_MAPS_API_KEY",
                                "hint": "HTTP referrer と Maps JavaScript API だけに制限したキー"},
    "google_maps_server_key": {"label": "Google Maps Platform のサーバー用キー",
                               "providers": ["google_places", "google_routes"], "env": "GOOGLE_PLACES_API_KEY",
                               "hint": "Places API (New)・Routes API だけに制限したサーバー用のキー"},
}
MIN_LEN, MAX_LEN = 8, 512


class SecretError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def slot_for_provider(provider: str) -> Optional[str]:
    for slot, spec in SLOTS.items():
        if provider in spec["providers"]:
            return slot
    return None


def _env_value(slot: str) -> Optional[str]:
    name = SLOTS[slot]["env"]
    value = getattr(settings, name, None) or os.environ.get(name)
    return value or None


def _active(db: Session, slot: str) -> Optional[ProviderSecret]:
    return (db.query(ProviderSecret).filter(ProviderSecret.slot == slot, ProviderSecret.status == "active")
            .first())


def resolve(db: Session, slot: str) -> Optional[str]:
    """サーバーの中で provider を呼ぶ時だけ使う(画面・応答・ログに出さない)。"""
    row = _active(db, slot)
    if row is not None:
        return crypto.decrypt_payload(bytes(row.secret_ciphertext)).decode("utf-8")
    return _env_value(slot)


def state(db: Session, slot: str) -> Dict[str, Any]:
    """鍵の状態(値は含まない)。"""
    row = _active(db, slot)
    if row is not None:
        return {"status": "configured", "source": "cms", "version": row.version, "last4": row.last4,
                "registered_at": row.created_at.replace(microsecond=0).isoformat() if row.created_at else None}
    env = _env_value(slot)
    if env:
        return {"status": "configured", "source": "env", "version": None, "last4": env[-4:] if len(env) >= 8 else None,
                "registered_at": None}
    return {"status": "missing", "source": None, "version": None, "last4": None, "registered_at": None}


def history(db: Session, slot: str, limit: int = 10) -> List[Dict[str, Any]]:
    rows = (db.query(ProviderSecret).filter(ProviderSecret.slot == slot)
            .order_by(ProviderSecret.version.desc()).limit(limit).all())
    return [{"version": r.version, "status": r.status, "last4": r.last4, "reason": r.reason,
             "created_at": r.created_at.replace(microsecond=0).isoformat() if r.created_at else None,
             "disabled_at": r.disabled_at.replace(microsecond=0).isoformat() if r.disabled_at else None}
            for r in rows]


def register(db: Session, slot: str, value: Any, reason: str, actor_id: uuid.UUID) -> ProviderSecret:
    """新しい版を有効にし、前の有効な版を superseded にする。値の形が正しくなければ SecretError。"""
    if slot not in SLOTS:
        raise SecretError("unknown_secret_slot", "知らない鍵の種類です")
    if not isinstance(value, str):
        raise SecretError("invalid_secret_value", "鍵は文字列で入力してください")
    value = value.strip()
    if not MIN_LEN <= len(value) <= MAX_LEN or any(ch.isspace() for ch in value) or not value.isprintable():
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
    db.commit()
    db.refresh(row)
    return row


def disable(db: Session, slot: str, actor_id: uuid.UUID) -> Optional[ProviderSecret]:
    """有効な版を無効にする(この後は .env の値があればそれを使う)。無ければ None。"""
    if slot not in SLOTS:
        raise SecretError("unknown_secret_slot", "知らない鍵の種類です")
    row = (db.query(ProviderSecret).filter(ProviderSecret.slot == slot, ProviderSecret.status == "active")
           .with_for_update().first())
    if row is None:
        return None
    row.status = "disabled"
    row.disabled_at = datetime.now(timezone.utc)
    row.disabled_by = actor_id
    db.commit()
    return row
