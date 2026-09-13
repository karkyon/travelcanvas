#!/usr/bin/env python3
"""
[Gate M7] FR-013文書ウォレットのretention/purge CLIラッパー。

cron等から定期実行することを想定する(スケジューラ設定自体の導入は
本Gateのスコープ外。運用手順はdocs/adr/ADR-object-storage.md
「Gate M7改訂」を参照。既存のscripts/run_quickdraft_purge.pyと
同じ運用パターンを踏襲する)。

実行例(コンテナ内):
    docker compose exec backend python scripts/run_document_purge.py

本番/開発DBへ直接接続するため、実行前にDATABASE_URLが意図した環境を
指しているか必ず確認すること(本スクリプト自体はDB向き先を検証しない)。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal
from app.services.document_purge_service import (
    purge_deleted_documents,
    soft_delete_expired_retention_documents,
)


def main() -> int:
    session = SessionLocal()
    try:
        retention_counts = soft_delete_expired_retention_documents(session)
        purge_counts = purge_deleted_documents(session)
    finally:
        session.close()

    print("Document retention/purge完了:")
    for key, value in retention_counts.items():
        print(f"  retention.{key}: {value}")
    for key, value in purge_counts.items():
        print(f"  purge.{key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
