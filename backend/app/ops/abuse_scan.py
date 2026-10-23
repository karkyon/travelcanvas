"""[Gate G4] FC-097 濫用の自動の検知(tcops.py jobs abuse-scan、1時間ごと)。出力は件数だけの1行の JSON。"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.services import abuse

    db = SessionLocal()
    try:
        result = abuse.scan(db)
    finally:
        db.close()
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
