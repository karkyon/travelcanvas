"""[Gate Remaining-3] FR-010 予約の取消期限の知らせ(tcops.py jobs cancel-deadlines、15分ごと)。出力は件数だけの1行の JSON。"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.ops.job_runs import recorded
    from app.services import cancel_deadlines

    def run():
        db = SessionLocal()
        try:
            return cancel_deadlines.sweep(db)
        finally:
            db.close()

    result = recorded("cancel-deadlines", run)
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
