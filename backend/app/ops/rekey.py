"""[Gate G1] SEC-F1 暗号化の鍵の版の切り替え(掛け直し)と、鍵ごとの件数の確認。

    python -m app.ops.rekey status [--database NAME] [--no-files]
        暗号化した全ての列(public の bytea 列 ``*_ciphertext``)と保存ファイルについて、
        どの鍵(版)の暗号文が何件あるか、どの鍵でも読めない物が何件あるかを数える。何も変えない。
    python -m app.ops.rekey run [--database NAME] [--batch 500] [--no-files] [--max-rows N]
        前の鍵(ENCRYPTION_KEYS_PREVIOUS)の暗号文を、今の鍵(ENCRYPTION_KEY)で掛け直す。

性質(docs/ops/KEY-INVENTORY.md・Runbook §8.2):
- 何度実行しても同じ結果になる(今の鍵の暗号文は触らない)。途中で止めても、もう一度実行すれば続きから進む。
- 1回の更新は ``batch`` 行ごとに確定する。更新は「読んだ時の値のままなら」だけ書く(同時に利用者が書き換えた行を
  上書きしない。その行は次の実行で掛け直す)。
- どの鍵でも読めない値(壊れた・失効した鍵の暗号文)は変えずに隔離し、件数と「表.列」だけを出す(中身・ID は出さない)。
- 保存ファイルは一時ファイルに書いてから置き換える(途中で止まっても壊れたファイルを残さない)。
- 出力は件数だけの1行の JSON。平文・暗号文・鍵の値は出さない。

鍵の失効(前の鍵を外す)は、``status`` で前の鍵の件数が全て0になってから行う。外した後は、外した鍵の暗号文は
``status`` で「読めない」に数えられる(試験 tests/test_gate_g1_keys.py)。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

from sqlalchemy import text

from app.ops.db_inventory import engine_for
from app.ops.decrypt_check import encrypted_columns

FERNET_PREFIX = b"gAAAAA"
TMP_SUFFIX = ".rekey-tmp"


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def primary_key(conn, table: str) -> Optional[str]:
    """単一列の主キー(複合の主キーの表は対象外にする。今は全て単一の id)。"""
    rows = conn.execute(
        text(
            "SELECT a.attname FROM pg_index i "
            "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
            "WHERE i.indrelid = CAST(:t AS regclass) AND i.indisprimary"
        ),
        {"t": "public." + _quote(table)},
    ).fetchall()
    return rows[0][0] if len(rows) == 1 else None


def _empty_counts(ring: List[str]) -> Dict[str, int]:
    return {kid: 0 for kid in ring}


def _scan_column(conn, table: str, column: str, pk: str, batch: int) -> Iterator[List[Tuple[object, bytes]]]:
    last = None
    while True:
        where = "%s IS NOT NULL" % _quote(column)
        params: Dict[str, object] = {"n": batch}
        if last is not None:
            where += " AND %s > :last" % _quote(pk)
            params["last"] = last
        rows = conn.execute(
            text(
                "SELECT %s, %s FROM public.%s WHERE %s ORDER BY %s LIMIT :n"
                % (_quote(pk), _quote(column), _quote(table), where, _quote(pk))
            ),
            params,
        ).fetchall()
        if not rows:
            return
        yield [(r[0], bytes(r[1])) for r in rows]
        last = rows[-1][0]


def process_database(database: Optional[str], *, apply: bool, batch: int = 500,
                     max_rows: Optional[int] = None, tables: Optional[List[str]] = None,
                     _before_update=None) -> Dict[str, object]:
    """``tables`` を渡すとその表だけを対象にする。``_before_update`` は試験用(更新の直前に呼ぶ)。"""
    from app.core import crypto

    ring = crypto.keyring_ids()
    active = ring[0]
    engine = engine_for(database)
    columns: List[Dict[str, object]] = []
    totals = {"by_key": _empty_counts(ring), "undecryptable": 0, "reencrypted": 0, "skipped_concurrent": 0}
    quarantined: List[str] = []
    budget = max_rows
    try:
        with engine.connect() as conn:
            cols = [c for c in encrypted_columns(conn) if not tables or c["table"] in tables]
            pks = {c["table"]: primary_key(conn, c["table"]) for c in cols}
        for col in cols:
            table, column = col["table"], col["column"]
            pk = pks[table]
            entry: Dict[str, object] = {"table": table, "column": column, "by_key": _empty_counts(ring),
                                        "undecryptable": 0, "reencrypted": 0}
            if pk is None:
                entry["skipped"] = "単一列の主キーが無い"
                columns.append(entry)
                continue
            with engine.connect() as conn:
                for rows in _scan_column(conn, table, column, pk, batch):
                    updates: List[Tuple[object, bytes, bytes]] = []
                    for ident, value in rows:
                        kid = crypto.key_id_of(value)
                        if kid is None:
                            entry["undecryptable"] = int(entry["undecryptable"]) + 1  # type: ignore[arg-type]
                            continue
                        entry["by_key"][kid] += 1  # type: ignore[index]
                        if apply and kid != active and (budget is None or budget > 0):
                            new, _, changed = crypto.reencrypt(value)
                            if changed:
                                updates.append((ident, value, new))
                                if budget is not None:
                                    budget -= 1
                    if updates:
                        if _before_update is not None:
                            _before_update(table, column)
                        with engine.begin() as tx:
                            for ident, old, new in updates:
                                res = tx.execute(
                                    text(
                                        "UPDATE public.%s SET %s = :new WHERE %s = :id AND %s = :old"
                                        % (_quote(table), _quote(column), _quote(pk), _quote(column))
                                    ),
                                    {"new": new, "id": ident, "old": old},
                                )
                                if res.rowcount == 1:
                                    entry["reencrypted"] = int(entry["reencrypted"]) + 1  # type: ignore[arg-type]
                                else:
                                    totals["skipped_concurrent"] += 1  # type: ignore[operator]
            if entry["undecryptable"]:
                quarantined.append("%s.%s" % (table, column))
            for kid, n in entry["by_key"].items():  # type: ignore[union-attr]
                totals["by_key"][kid] += n  # type: ignore[index]
            totals["undecryptable"] += int(entry["undecryptable"])  # type: ignore[operator,arg-type]
            totals["reencrypted"] += int(entry["reencrypted"])  # type: ignore[operator,arg-type]
            columns.append(entry)
    finally:
        engine.dispose()
    return {"columns": columns, "totals": totals, "quarantined_columns": quarantined}


def _storage_files(root: Path) -> Iterator[Path]:
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file() or path.name.endswith(TMP_SUFFIX):
            continue
        yield path


def process_files(root: Optional[str], *, apply: bool, max_files: Optional[int] = None) -> Dict[str, object]:
    from app.core import crypto
    from app.core.config import settings

    base = Path(root or settings.DOCUMENT_STORAGE_DIR)
    ring = crypto.keyring_ids()
    active = ring[0]
    out: Dict[str, object] = {"by_key": _empty_counts(ring), "undecryptable": 0, "not_encrypted": 0, "reencrypted": 0}
    budget = max_files
    for path in _storage_files(base):
        data = path.read_bytes()
        if not data.startswith(FERNET_PREFIX):
            out["not_encrypted"] = int(out["not_encrypted"]) + 1  # type: ignore[arg-type]
            continue
        kid = crypto.key_id_of(data)
        if kid is None:
            out["undecryptable"] = int(out["undecryptable"]) + 1  # type: ignore[arg-type]
            continue
        out["by_key"][kid] += 1  # type: ignore[index]
        if not apply or kid == active or (budget is not None and budget <= 0):
            continue
        new, _, changed = crypto.reencrypt(data)
        if not changed:
            continue
        tmp = path.with_name(path.name + TMP_SUFFIX)
        mode = path.stat().st_mode & 0o777
        with open(tmp, "wb") as f:
            f.write(new)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
        out["reencrypted"] = int(out["reencrypted"]) + 1  # type: ignore[arg-type]
        if budget is not None:
            budget -= 1
    return out


def summarize(db: Dict[str, object], files: Optional[Dict[str, object]], ring: List[str]) -> Dict[str, object]:
    active, previous = ring[0], ring[1:]
    totals = db["totals"]  # type: ignore[assignment]
    # by_key は読んだ時点の件数。run では掛け直した分を引いた残りが「前の鍵のまま」
    remaining_db = sum(totals["by_key"][k] for k in previous) - int(totals["reencrypted"])  # type: ignore[index]
    remaining_files = 0
    if files:
        remaining_files = sum(files["by_key"][k] for k in previous) - int(files["reencrypted"])  # type: ignore[index]
    undecryptable = int(totals["undecryptable"]) + (int(files["undecryptable"]) if files else 0)  # type: ignore[index]
    return {
        "ok": undecryptable == 0,
        "active_key": active,
        "previous_keys": previous,
        "rows": dict(totals),  # type: ignore[call-overload]
        "files": files,
        "remaining_on_previous_keys": remaining_db + remaining_files,
        # 前の鍵を外してよいか(前の鍵の暗号文が0件で、読めない物も無い)
        "previous_keys_removable": bool(previous) and remaining_db + remaining_files == 0 and undecryptable == 0,
        "quarantined_columns": db["quarantined_columns"],
        "columns": len(db["columns"]),  # type: ignore[arg-type]
    }


def main(argv: Optional[List[str]] = None) -> int:
    from app.core import crypto

    parser = argparse.ArgumentParser(description="暗号化の鍵の版の切り替え(掛け直し)と件数の確認(中身は出さない)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("status", "run"):
        p = sub.add_parser(name)
        p.add_argument("--database", help="対象の DB 名(省略時は DATABASE_URL の DB)")
        p.add_argument("--no-files", action="store_true", help="保存ファイルを対象にしない")
        p.add_argument("--files-root", help="保存ファイルの場所(既定 DOCUMENT_STORAGE_DIR)")
        p.add_argument("--table", action="append", dest="tables", help="この表だけを対象にする(複数可)")
        if name == "run":
            p.add_argument("--batch", type=int, default=500)
            p.add_argument("--max-rows", type=int, help="この件数で止める(段階的に進める時)")
    args = parser.parse_args(argv)
    apply = args.cmd == "run"
    batch = getattr(args, "batch", 500)
    if batch < 1 or batch > 10000:
        raise SystemExit("--batch は1〜10000にしてください")
    max_rows = getattr(args, "max_rows", None)
    ring = crypto.keyring_ids()
    if apply and len(ring) == 1:
        print(json.dumps({"ok": True, "active_key": ring[0], "previous_keys": [],
                          "note": "前の鍵(ENCRYPTION_KEYS_PREVIOUS)が無いため、掛け直す物はありません"},
                         ensure_ascii=False, sort_keys=True))
        return 0
    db = process_database(args.database, apply=apply, batch=batch, max_rows=max_rows, tables=args.tables)
    files = None if args.no_files else process_files(args.files_root, apply=apply, max_files=max_rows)
    result = summarize(db, files, ring)
    result["mode"] = args.cmd
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
