"""[Gate G4] COL-02 投票の締切の処理(tcops.py jobs poll-deadlines、15分ごと)。出力は件数だけの1行の JSON。"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.services import poll_deadlines

    db = SessionLocal()
    try:
        result = poll_deadlines.sweep(db)
    finally:
        db.close()
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
