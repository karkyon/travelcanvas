"""[Gate O1] DB の点検(表ごとの正確な件数・alembic の版・保存ファイルを参照している行)。

コンテナ内で実行する(接続文字列はコンテナの ``DATABASE_URL`` から作り、標準出力へは出さない):

    python -m app.ops.db_inventory --database travelcanvas_restore_drill

出力は JSON 1行。件数と版だけで、行の中身は出さない。``--storage-keys`` を付けた時だけ、
保存ファイルの照合のため storage_key の一覧を出す(呼び出し側は件数だけを記録に残す)。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Dict, List, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

from app.ops.opslib import database_name, replace_database


def engine_for(database: Optional[str]) -> Engine:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL が設定されていません")
    if database:
        url = replace_database(url, database)
    return create_engine(url, poolclass=NullPool, hide_parameters=True)


def table_counts(engine: Engine) -> Dict[str, int]:
    with engine.connect() as conn:
        names = [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
                )
            )
        ]
        out: Dict[str, int] = {}
        for name in names:
            quoted = '"' + name.replace('"', '""') + '"'
            out[name] = int(conn.execute(text("SELECT count(*) FROM public." + quoted)).scalar() or 0)
        return out


def alembic_revision(engine: Engine) -> Optional[str]:
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT to_regclass('public.alembic_version')")).scalar()
        if not exists:
            return None
        rows = [r[0] for r in conn.execute(text("SELECT version_num FROM alembic_version ORDER BY version_num"))]
    return ",".join(rows) if rows else None


def expected_storage_keys(engine: Engine) -> List[str]:
    """実ファイルがあるはずの storage_key。

    - documents: 削除されておらず、sha256 が記録されている行(Gate M6 以降の実アップロード。
      R3-6 の「メタデータだけ」の行はファイルを持たないので除く)
    - memories: 写真・音声の行
    """
    keys: List[str] = []
    with engine.connect() as conn:
        if conn.execute(text("SELECT to_regclass('public.documents')")).scalar():
            keys += [
                r[0]
                for r in conn.execute(
                    text("SELECT storage_key FROM documents WHERE deleted_at IS NULL AND sha256 IS NOT NULL")
                )
            ]
        if conn.execute(text("SELECT to_regclass('public.memories')")).scalar():
            keys += [
                r[0] for r in conn.execute(text("SELECT storage_key FROM memories WHERE storage_key IS NOT NULL"))
            ]
    return sorted(k for k in keys if k)


def inventory(database: Optional[str], with_storage_keys: bool = False) -> Dict[str, object]:
    engine = engine_for(database)
    try:
        result: Dict[str, object] = {
            "database": database or database_name(os.environ.get("DATABASE_URL", "")),
            "alembic_revision": alembic_revision(engine),
            "tables": table_counts(engine),
        }
        if with_storage_keys:
            result["storage_keys"] = expected_storage_keys(engine)
        return result
    finally:
        engine.dispose()


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DB の件数・版の点検(行の中身は出さない)")
    parser.add_argument("--database", help="点検する DB 名(省略時は DATABASE_URL の DB)")
    parser.add_argument("--storage-keys", action="store_true", help="保存ファイルの照合用に storage_key も出す")
    args = parser.parse_args(argv)
    print(json.dumps(inventory(args.database, args.storage_keys), ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
