"""[Gate G4] COL-03 通知のまとめのメールを作り(1日1回の人の分)、送信待ちのメールを送る(tcops.py jobs email-outbox、5分ごと)。

出力は件数だけの1行の JSON(宛先・件名・本文は出さない)。送信の設定(SMTP_HOST・EMAIL_FROM)が無い環境では何もしない。
"""
from __future__ import annotations

import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    from app.core.database import SessionLocal
    from app.services import notify

    from app.ops.job_runs import recorded

    def run():
        db = SessionLocal()
        try:
            return {"digest": notify.build_digests(db), "outbox": notify.deliver_outbox(db)}
        finally:
            db.close()

    # [Gate G8] FR-004 実行の記録(最後の成功の時刻。件数だけ)
    out = recorded("email-outbox", run)
    digest, sent = out["digest"], out["outbox"]
    print(json.dumps({"ok": True, "digest": digest, "outbox": sent}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
