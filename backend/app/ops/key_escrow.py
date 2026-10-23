"""[Gate G3] SEC-F5 データ鍵(data_keys)のバックアップの写し(escrow)。

DB のバックアップ(pg_dump)は data_keys の行を含めない(``--exclude-table-data``)。データ鍵は別のファイル
(``<ID>.keys.jsonl``。ENCRYPTION_KEY で包んだまま)に写し、旅行・利用者を消して鍵を破棄したら、全ての世代の
写しからその鍵を消す(``tcops.py keys purge-escrow``。中身の無い「破棄した」記録だけを残す)。これで、
バックアップの DB に暗号文が残っていても、破棄した鍵の分は復元しても読めない。

    python -m app.ops.key_escrow export            # 標準出力へ JSON lines(包んだ鍵。平文の鍵は出さない)
    python -m app.ops.key_escrow import < keys.jsonl  # DATABASE_URL の DB へ入れる(復元の時。同じ ID は飛ばす)
    python -m app.ops.key_escrow destroyed-ids     # 破棄した鍵の ID(1行の JSON)

出力・入力の各行: {"id", "subject_type", "subject_id", "wrapped"(base64 か null), "destroyed"(bool), "created_at"}
"""
import argparse
import base64
import json
import sys
import uuid
from typing import Dict, Iterable, List, Optional

from sqlalchemy import create_engine, text


def _engine():
    from app.core.config import settings

    return create_engine(settings.DATABASE_URL)


def export_rows(conn) -> Iterable[Dict[str, object]]:
    rows = conn.execute(text(
        "SELECT id, subject_type, subject_id, wrapped_key_ciphertext, destroyed_at, created_at "
        "FROM data_keys ORDER BY created_at, id"))
    for r in rows:
        yield {
            "id": str(r[0]), "subject_type": r[1], "subject_id": str(r[2]),
            "wrapped": base64.b64encode(bytes(r[3])).decode("ascii") if r[3] is not None else None,
            "destroyed": r[4] is not None,
            "created_at": r[5].isoformat() if r[5] is not None else None,
        }


def parse_line(line: str) -> Optional[Dict[str, object]]:
    line = line.strip()
    if not line:
        return None
    obj = json.loads(line)
    uuid.UUID(str(obj["id"]))
    uuid.UUID(str(obj["subject_id"]))
    if obj.get("subject_type") not in ("plan", "user"):
        raise ValueError("subject_type が不正です")
    if bool(obj.get("destroyed")) == (obj.get("wrapped") is not None):
        raise ValueError("破棄した鍵は中身を持たない・使える鍵は中身を持つ")
    return obj


def import_rows(conn, items: Iterable[Dict[str, object]]) -> Dict[str, int]:
    inserted = skipped = 0
    for obj in items:
        wrapped = base64.b64decode(str(obj["wrapped"])) if obj.get("wrapped") is not None else None
        res = conn.execute(text(
            "INSERT INTO data_keys (id, subject_type, subject_id, wrapped_key_ciphertext, destroyed_at, "
            "destroy_reason, created_at) VALUES (:id, :t, :s, :w, CASE WHEN :d THEN now() END, "
            "CASE WHEN :d THEN 'erased' END, COALESCE(CAST(:c AS timestamptz), now())) "
            "ON CONFLICT (id) DO NOTHING"),
            {"id": uuid.UUID(str(obj["id"])), "t": obj["subject_type"], "s": uuid.UUID(str(obj["subject_id"])),
             "w": wrapped, "d": bool(obj.get("destroyed")), "c": obj.get("created_at")})
        if res.rowcount == 1:
            inserted += 1
        else:
            skipped += 1
    return {"inserted": inserted, "skipped": skipped}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("export")
    sub.add_parser("import")
    sub.add_parser("destroyed-ids")
    args = ap.parse_args(argv)
    engine = _engine()
    try:
        if args.cmd == "export":
            with engine.connect() as conn:
                for obj in export_rows(conn):
                    sys.stdout.write(json.dumps(obj, ensure_ascii=False, sort_keys=True) + "\n")
            return 0
        if args.cmd == "import":
            items = [o for o in (parse_line(ln) for ln in sys.stdin) if o is not None]
            with engine.begin() as conn:
                res = import_rows(conn, items)
            print(json.dumps({"ok": True, **res}, sort_keys=True))
            return 0
        with engine.connect() as conn:
            ids = [str(r[0]) for r in conn.execute(text("SELECT id FROM data_keys WHERE destroyed_at IS NOT NULL"))]
        print(json.dumps({"ok": True, "ids": ids}, sort_keys=True))
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
