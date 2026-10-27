"""[Gate G6] MEM-01 削除してから7日を過ぎた記録の保管(memory_trash)をファイルごと消す(tcops.py jobs memory-trash、毎日)。

出力は件数だけの1行の JSON。"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.api.v1 import memory_publish
    from app.core.database import SessionLocal

    from app.ops.job_runs import recorded

    def run():
        db = SessionLocal()
        try:
            return memory_publish.purge_trash(db)
        finally:
            db.close()

    # [Gate G8] FR-004 実行の記録(最後の成功の時刻。件数だけ)
    result = recorded("memory-trash", run)
    print(json.dumps({"ok": result.get("failed", 0) == 0, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
