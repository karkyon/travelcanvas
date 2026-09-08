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

import uuid
from typing import Any, Dict, Optional

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.models.models import AuditLog

logger = get_logger(__name__)


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
            details=details or None,
        )
        session.add(entry)
        session.commit()
    except Exception:  # noqa: BLE001 - 監査ログ失敗で本処理を止めない
        session.rollback()
        logger.warning(
            "audit log write failed",
            extra={"extra_data": {"action": action, "resource_type": resource_type}},
        )
    finally:
        session.close()
