"""[Gate G7] FR-039 猶予を過ぎたアカウントの削除の申し込みを削除する(tcops.py jobs account-deletions、毎日)。

出力は件数だけの1行の JSON(誰を削除したかは出さない。監査には件数と理由だけ)。"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.services import account_deletion

    from app.ops.job_runs import recorded

    def run():
        db = SessionLocal()
        try:
            return account_deletion.run_due(db)
        finally:
            db.close()

    # [Gate G8] FR-004 実行の記録(最後の成功の時刻。件数だけ)
    result = recorded("account-deletions", run)
    print(json.dumps({"ok": result.get("failed", 0) == 0, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
