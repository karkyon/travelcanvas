"""[Gate G4] FC-097 濫用の自動の検知(tcops.py jobs abuse-scan、1時間ごと)。出力は件数だけの1行の JSON。"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.services import abuse

    from app.ops.job_runs import recorded

    def run():
        db = SessionLocal()
        try:
            return abuse.scan(db)
        finally:
            db.close()

    # [Gate G8] FR-004 実行の記録(最後の成功の時刻。件数だけ)
    result = recorded("abuse-scan", run)
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
