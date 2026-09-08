#!/usr/bin/env python3
"""
[Gate R2-5] QuickDraft/idempotency_records retention purgeのCLIラッパー。

cron等から定期実行することを想定する(このGate自体はcron設定やジョブ
スケジューラの導入までは行わない — インフラ/運用設定は別スコープとし、
実行可能なスクリプトの提供に留める)。

実行例(コンテナ内):
    docker compose exec backend python scripts/run_quickdraft_purge.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal
from app.services.quickdraft_purge import purge_expired_quickdrafts


def main() -> int:
    session = SessionLocal()
    try:
        counts = purge_expired_quickdrafts(session)
    finally:
        session.close()

    print("QuickDraft purge完了:")
    for key, value in counts.items():
        print(f"  {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
