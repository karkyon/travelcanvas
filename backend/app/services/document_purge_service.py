"""
[Gate M7] FR-013文書ウォレットのstorage file purge / retention処理。

2026-09-13監査P0-04: `DELETE /plans/{plan_id}/documents/{id}`はDB上の
soft delete(`deleted_at`)のみを行い、storage backend上の実ファイルを
一切削除していなかった。app/api/v1/documents.pyのdelete_documentは
soft delete直後に実ファイル削除を即時試行するよう是正済みだが、
プロセスクラッシュやストレージ障害時にはその場では失敗しうる。
本サービスは、削除済み(`deleted_at IS NOT NULL`)かつまだ
`purge_status='purged'`になっていない文書を再試行可能な形で処理する
(既に無いファイルへの再削除試行はidempotentに成功として扱う)。

`retention_until`超過分についても、Gate M7時点ではまだsoft delete状態へ
自動遷移させる処理が存在しないため、本サービスで
`retention_until`経過分をsoft delete対象へ遷移させる(DOC-11の
retention要件対応)。実ファイルのpurgeは責務を分離し
`purge_deleted_documents`に委ねる(soft delete直後にDBが即座に
`deleted_at`を持つ状態になるため、次回purge実行時に自然に処理される)。

実行スケジュール(cron/APScheduler等)の導入自体は本Gateのスコープ外とし
(既存のquickdraft_purge.pyと同じ運用方針)、同期SQLAlchemy Sessionを
1つ受け取って動作する関数として提供するに留める。呼び出し例は
`scripts/run_document_purge.py`を参照。
"""
from datetime import datetime, timezone
from typing import Dict

from sqlalchemy.orm import Session

from app.models.models import Document, DocumentPurgeStatus
from app.services.storage_backend import get_storage_backend


def _now() -> datetime:
    return datetime.now(timezone.utc)


def soft_delete_expired_retention_documents(db: Session, batch_limit: int = 200) -> Dict[str, int]:
    """`retention_until`を超過した未削除文書を論理削除(soft delete)へ
    遷移させる。実ファイルのpurgeは`purge_deleted_documents`に委ねる
    (責務分離。soft delete後は次回のpurge実行で自然に処理対象になる)。"""
    now = _now()
    counts = {"marked_deleted": 0}

    rows = (
        db.query(Document)
        .filter(
            Document.deleted_at.is_(None),
            Document.retention_until.isnot(None),
            Document.retention_until <= now,
        )
        .limit(batch_limit)
        .all()
    )
    for d in rows:
        d.deleted_at = now
        d.revision += 1
        counts["marked_deleted"] += 1
    if rows:
        db.commit()
    return counts


def purge_deleted_documents(db: Session, batch_limit: int = 200) -> Dict[str, int]:
    """soft delete済み(`deleted_at IS NOT NULL`)でまだpurgeされていない
    文書のstorage fileを削除する。戻り値は処理件数(観測・テスト用)。

    ファイルが既に存在しない場合(前回試行が実際には成功していた場合や、
    元々アップロード失敗で実体が無かった場合)も、`StorageBackend.delete`
    自体がidempotentに正常終了するため`purged`扱いとする。"""
    counts = {"purged": 0, "failed": 0}
    backend = get_storage_backend()

    rows = (
        db.query(Document)
        .filter(
            Document.deleted_at.isnot(None),
            Document.purge_status != DocumentPurgeStatus.PURGED.value,
        )
        .limit(batch_limit)
        .all()
    )
    for d in rows:
        try:
            backend.delete(d.storage_key)
            d.purge_status = DocumentPurgeStatus.PURGED.value
            counts["purged"] += 1
        except (OSError, ValueError):
            d.purge_status = DocumentPurgeStatus.FAILED.value
            counts["failed"] += 1
    if rows:
        db.commit()
    return counts
