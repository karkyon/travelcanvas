"""[Gate G1] SEC-F2 鍵の点検(値は出さない)。

    python -m app.ops.keys check

鍵ごとの設定の有無・版の名前(指紋)・導出元と、用途を越えた使い回し・弱い鍵を1行の JSON で出す。
本番(APP_ENV=production)では同じ点検で起動を止める(app/core/config.py の production_problems)。
開発環境ではここで先に見つけられる。問題があれば終了コード 1。
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import List, Optional


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="鍵の点検(値は出さない)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    parser.parse_args(argv)

    from app.core.config import _weak_secret, settings
    from app.core.key_inventory import KEYS, report

    result = report(settings)
    weak = []
    for entry in KEYS:
        if not entry.get("required_in_production"):
            continue
        value = getattr(settings, str(entry["name"]), None)
        reason = _weak_secret(value)
        if reason:
            weak.append("%s: %s" % (entry["name"], reason))
    result["weak_or_missing"] = weak
    result["environment"] = settings.APP_ENV
    result["ok"] = not result["reuse_problems"]
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
