"""
TravelCanvas Backend - 監査ログ永続化サービス (Gate R2-7)

docs/trace/gate-r2-trace.md のR2-5行が「未達」としていた
「audit/metric基盤(監査イベントの永続化・ダッシュボード)」を実装する。

app/core/logging.py の log_security_event() 等はファイル/標準出力への
構造化ログ出力のみで、DB永続化・検索可能なAPIが存在しなかった
(schemas.AuditLog/AuditLogResponse は定義済みだが対応するテーブルも
書き込み経路も無いゴーストスキーマだった)。本サービスはその実体を提供する。

設計方針:
- 監査ログの書き込み失敗が本来のビジネスロジック(ログイン/promote/管理操作)
  を失敗させてはならない。そのため例外は internal で握りつぶし、
  application loggerへwarningを出すのみとする。
- 呼び出し元の進行中トランザクションを阻害しないよう、専用の
  `SessionLocal()` を新規に開いて独立コミットする(ログイン失敗時のように
  呼び出し元がこの後 rollback / raise する可能性があるケースでも、
  監査ログ自体は確実に残す必要があるため)。
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Dict, Optional

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.models.models import AuditLog

logger = get_logger(__name__)

_SENSITIVE_DETAIL_PARTS = (
    "password", "passwd", "secret", "token", "authorization", "cookie", "apikey", "credential",
    "email", "phone", "telephone", "address", "latitude", "longitude", "coordinate",
    "reservation", "confirmation", "passenger", "ticket", "qr", "pin",
)
_INLINE_SECRET_RE = re.compile(
    r"(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]\s*[^\s,;]+"
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_JWT_RE = re.compile(r"\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")


def sanitize_audit_details(details: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """監査ログdetailsから機密値・旅行個人情報を除き、文字列内の認証値も伏せる。"""
    if not details:
        return None

    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            result: Dict[str, Any] = {}
            for key, item in value.items():
                normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
                if any(part in normalized for part in _SENSITIVE_DETAIL_PARTS):
                    result[str(key)] = "[REDACTED]"
                else:
                    result[str(key)] = clean(item)
            return result
        if isinstance(value, (list, tuple)):
            return [clean(item) for item in value]
        if isinstance(value, str):
            value = _BEARER_RE.sub("Bearer [REDACTED]", value)
            value = _INLINE_SECRET_RE.sub(
                lambda match: match.group(0).split("=")[0].split(":")[0] + "=[REDACTED]", value
            )
            return _JWT_RE.sub("[REDACTED]", value)
        return value

    sanitized = clean(details)
    return sanitized if sanitized else None


def record_audit_event(
    action: str,
    resource_type: str,
    user_id: Optional[Any] = None,
    resource_id: Optional[Any] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    """監査イベントを audit_logs テーブルへ永続化する。

    呼び出し元の DB セッション/トランザクション状態に依存しないよう、
    独立した短命セッションを使用する。失敗時は例外を外へ伝播させない
    (監査ログの欠落よりも、本来のユーザー操作の失敗の方が実害が大きいため)。
    """
    session = SessionLocal()
    try:
        entry = AuditLog(
            id=uuid.uuid4(),
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=(ip_address[:255] if ip_address else None),
            user_agent=(user_agent[:500] if user_agent else None),
            details=sanitize_audit_details(details),
        )
        session.add(entry)
        session.commit()
    except Exception:  # noqa: BLE001 - 監査ログ失敗で本処理を止めない
        session.rollback()
        # [Gate S4] F18 失敗を数える(/metrics の travelcanvas_security_events_total{kind="audit_write_failed"})。
        # 黙って欠落し続けないよう、監視で警報にできる。
        from app.ops import metrics as ops_metrics

        ops_metrics.registry.count_security_event("audit_write_failed")
        logger.warning(
            "audit log write failed",
            extra={"extra_data": {"action": action, "resource_type": resource_type}},
        )
    finally:
        session.close()
