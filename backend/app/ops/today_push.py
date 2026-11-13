"""[Gate TDay-Push] 旅の当日の端末への通知(tcops.py jobs today-push、2分ごと)。出力は件数だけの1行の JSON。"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.ops.job_runs import recorded
    from app.services import today_push

    def run():
        db = SessionLocal()
        try:
            return today_push.sweep(db)
        finally:
            db.close()

    result = recorded("today-push", run)
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
