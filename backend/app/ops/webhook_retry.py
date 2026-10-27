"""[Gate G2] FR-042 Webhook の自動の再送(定期実行: tcops.py jobs webhook-retry、5分ごと)。

時刻の来た失敗の送信(org_webhook_deliveries の status=failed・pending、next_attempt_at <= いま)を送り直す。
上限(app/services/org_api.MAX_ATTEMPTS)に達したら dead(dead-letter。組織の画面から手で送り直せる)。
出力は件数だけの1行の JSON(URL・本文・署名は出さない)。
"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.services import org_api

    from app.ops.job_runs import recorded

    def run():
        db = SessionLocal()
        try:
            return org_api.retry_due(db)
        finally:
            db.close()

    # [Gate G8] FR-004 実行の記録(最後の成功の時刻。件数だけ)
    result = recorded("webhook-retry", run)
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
