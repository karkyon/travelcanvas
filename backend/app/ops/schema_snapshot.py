"""[Gate G3] CI-02 DB の構造(schema)の写し。migration の前後の差分を CI の証拠として残す。

    python -m app.ops.schema_snapshot > head.txt          # 今の DB の構造(決まった順の文字)
    python -m app.ops.schema_snapshot --diff a.txt b.txt  # 2つの写しの差分(unified diff)

pg_dump を使わない(CI・backend のコンテナに PostgreSQL のクライアントが無い時もある)。SQLAlchemy の
inspector で、表・列(型・NULL・既定値)・主キー・一意・検査・外部キー・索引を、名前の順に書き出す。
値(行)は読まない。接続先は DATABASE_URL(app.core.config.settings)。
"""
import argparse
import difflib
import sys
from typing import List, Optional

from sqlalchemy import create_engine, inspect


def snapshot(url: str) -> str:
    engine = create_engine(url)
    try:
        insp = inspect(engine)
        lines: List[str] = []
        for table in sorted(insp.get_table_names(schema="public")):
            lines.append("TABLE %s" % table)
            for col in insp.get_columns(table, schema="public"):
                default = col.get("default")
                lines.append("  COLUMN %s %s%s%s" % (
                    col["name"], str(col["type"]).upper(), "" if col.get("nullable", True) else " NOT NULL",
                    " DEFAULT %s" % default if default is not None else ""))
            pk = insp.get_pk_constraint(table, schema="public") or {}
            if pk.get("constrained_columns"):
                lines.append("  PRIMARY KEY (%s)" % ", ".join(pk["constrained_columns"]))
            for uq in sorted(insp.get_unique_constraints(table, schema="public"), key=lambda u: u.get("name") or ""):
                lines.append("  UNIQUE %s (%s)" % (uq.get("name"), ", ".join(uq["column_names"])))
            try:
                checks = insp.get_check_constraints(table, schema="public")
            except NotImplementedError:  # pragma: no cover
                checks = []
            for ck in sorted(checks, key=lambda c: c.get("name") or ""):
                lines.append("  CHECK %s %s" % (ck.get("name"), " ".join(str(ck.get("sqltext", "")).split())))
            for fk in sorted(insp.get_foreign_keys(table, schema="public"), key=lambda f: f.get("name") or ""):
                opts = fk.get("options") or {}
                lines.append("  FOREIGN KEY %s (%s) -> %s(%s)%s" % (
                    fk.get("name"), ", ".join(fk["constrained_columns"]), fk["referred_table"],
                    ", ".join(fk["referred_columns"]),
                    "".join(" %s %s" % (k.upper(), v) for k, v in sorted(opts.items()) if v)))
            for ix in sorted(insp.get_indexes(table, schema="public"), key=lambda i: i.get("name") or ""):
                cols = [c if c is not None else "(expr)" for c in ix.get("column_names") or []]
                where = (ix.get("dialect_options") or {}).get("postgresql_where")
                kind = "UNIQUE " if ix.get("unique") else ""
                cond = " WHERE %s" % where if where is not None else ""
                lines.append("  INDEX %s%s (%s)%s" % (kind, ix.get("name"), ", ".join(cols), cond))
        return "\n".join(lines) + "\n"
    finally:
        engine.dispose()


def diff(a_path: str, b_path: str) -> str:
    with open(a_path, encoding="utf-8") as f:
        a = f.read().splitlines(keepends=True)
    with open(b_path, encoding="utf-8") as f:
        b = f.read().splitlines(keepends=True)
    return "".join(difflib.unified_diff(a, b, fromfile=a_path, tofile=b_path))


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--diff", nargs=2, metavar=("BEFORE", "AFTER"))
    args = p.parse_args(argv)
    if args.diff:
        sys.stdout.write(diff(*args.diff) or "(差分なし)\n")
        return 0
    from app.core.config import settings

    sys.stdout.write(snapshot(settings.DATABASE_URL))
    return 0


if __name__ == "__main__":
    sys.exit(main())
