#!/usr/bin/env python3
"""
[Gate B-012] 猶予期間(PLAN_DELETE_GRACE_DAYS、既定30日)を過ぎた論理削除済みプランの完全削除CLI。

cron等から定期実行することを想定する(スケジューラ設定自体の導入はスコープ外。
scripts/run_document_purge.py・run_quickdraft_purge.pyと同じ運用パターン)。

実行例(コンテナ内):
    docker compose exec backend python scripts/run_plan_purge.py

本番/開発DBへ直接接続するため、実行前にDATABASE_URLが意図した環境を
指しているか必ず確認すること(本スクリプト自体はDB向き先を検証しない)。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.services.plan_deletion import purge_expired_plans  # noqa: E402


def main() -> int:
    session = SessionLocal()
    try:
        counts = purge_expired_plans(session)
    finally:
        session.close()
    print("Plan purge完了:")
    for key, value in counts.items():
        print(f"  {key}: {value}")
    return 1 if counts.get("failed") else 0


if __name__ == "__main__":
    sys.exit(main())
