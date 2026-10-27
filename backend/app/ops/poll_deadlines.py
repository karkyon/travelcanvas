"""[Gate G4] COL-02 投票の締切の処理(tcops.py jobs poll-deadlines、15分ごと)。出力は件数だけの1行の JSON。"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.services import poll_deadlines

    from app.ops.job_runs import recorded

    def run():
        db = SessionLocal()
        try:
            return poll_deadlines.sweep(db)
        finally:
            db.close()

    # [Gate G8] FR-004 実行の記録(最後の成功の時刻。件数だけ)
    result = recorded("poll-deadlines", run)
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
