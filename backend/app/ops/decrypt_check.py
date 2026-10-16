"""[Gate O1] 復元した DB の暗号化列が、今の ``ENCRYPTION_KEY`` で復号できるかの確認。

バックアップは「DB のダンプ」と「暗号鍵(.env)」が揃って初めて使える。鍵を取り違えると、
復元に成功しても予約番号・チケット・秘匿制約・位置などが一切読めない。演習でそれを検出する。

    python -m app.ops.decrypt_check --database travelcanvas_restore_drill --sample 5

対象: public スキーマで名前が ``*_ciphertext`` の bytea 列。各列から最大 ``--sample`` 件を取り、
``app.core.crypto.decrypt_payload`` で復号を試す。出力は件数だけ(復号した中身は出さない・保持しない)。
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Dict, List, Optional

from sqlalchemy import text

from app.ops.db_inventory import engine_for


def encrypted_columns(conn) -> List[Dict[str, str]]:
    rows = conn.execute(
        text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND data_type = 'bytea' AND column_name LIKE '%\\_ciphertext' ESCAPE '\\' "
            "ORDER BY table_name, column_name"
        )
    )
    return [{"table": r[0], "column": r[1]} for r in rows]


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def check(database: Optional[str], sample: int = 5) -> Dict[str, object]:
    from app.core.crypto import decrypt_payload  # 鍵(設定)を読むので、ここで import する

    if sample < 1 or sample > 100:
        raise SystemExit("--sample は1〜100にしてください")
    engine = engine_for(database)
    columns: List[Dict[str, object]] = []
    decrypted = failed = 0
    try:
        with engine.connect() as conn:
            for col in encrypted_columns(conn):
                sql = "SELECT %s FROM public.%s WHERE %s IS NOT NULL LIMIT :n" % (
                    _quote(col["column"]),
                    _quote(col["table"]),
                    _quote(col["column"]),
                )
                ok = ng = 0
                for (value,) in conn.execute(text(sql), {"n": sample}):
                    try:
                        decrypt_payload(bytes(value))
                        ok += 1
                    except Exception:
                        ng += 1
                columns.append({"table": col["table"], "column": col["column"], "decrypted": ok, "failed": ng})
                decrypted += ok
                failed += ng
    finally:
        engine.dispose()
    return {
        "ok": failed == 0,
        "columns": len(columns),
        "columns_with_data": sum(1 for c in columns if c["decrypted"] or c["failed"]),
        "decrypted": decrypted,
        "failed": failed,
        "failed_columns": ["%s.%s" % (c["table"], c["column"]) for c in columns if c["failed"]],
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="暗号化列が今の鍵で復号できるかの確認(中身は出さない)")
    parser.add_argument("--database", help="確認する DB 名(省略時は DATABASE_URL の DB)")
    parser.add_argument("--sample", type=int, default=5)
    args = parser.parse_args(argv)
    result = check(args.database, args.sample)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
