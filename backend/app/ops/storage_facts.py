"""[Gate O1] 保存ファイルの一覧と鍵の指紋(バックアップの目録・復元の照合に使う)。

    python -m app.ops.storage_facts            # 一覧と指紋(JSON)
    python -m app.ops.storage_facts --no-files # 指紋だけ

- 保存ファイルの根(uploads)は ``DOCUMENT_STORAGE_DIR`` の親(既定 ``/app/uploads``)。
  文書・写真・音声は ``DOCUMENT_STORAGE_DIR`` の下にある。
- 鍵は値を出さず、取り違えの検出用の指紋(SHA-256 の先頭12桁)だけを出す。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

from app.ops.opslib import key_fingerprint, sha256_file

# [Gate K1] OFFLINE_PACK_KEY_SECRET を追加(変わると端末のオフラインデータが読めなくなるため、復元時に指紋を照合する)
# [Gate G1] ENCRYPTION_KEYS_PREVIOUS(鍵の切り替えの途中の前の鍵)も照合する
KEY_NAMES = (
    "ENCRYPTION_KEY", "ENCRYPTION_KEYS_PREVIOUS", "LOOKUP_INDEX_KEY", "DOCUMENT_DOWNLOAD_SIGNING_KEY", "JWT_SECRET_KEY",
    "OFFLINE_PACK_KEY_SECRET",
)


def storage_roots() -> Dict[str, str]:
    from app.core.config import settings

    doc_dir = Path(settings.DOCUMENT_STORAGE_DIR).resolve()
    root = Path(os.environ.get("OPS_UPLOADS_ROOT") or doc_dir.parent).resolve()
    try:
        prefix = doc_dir.relative_to(root).as_posix()
    except ValueError:
        prefix = ""
    return {"uploads_root": str(root), "documents_prefix": prefix}


def list_files(root: str) -> Dict[str, Dict[str, object]]:
    base = Path(root)
    out: Dict[str, Dict[str, object]] = {}
    if not base.is_dir():
        return out
    for path in sorted(base.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(base).as_posix()
        out[rel] = {"size": path.stat().st_size, "sha256": sha256_file(str(path))}
    return out


def fingerprints() -> Dict[str, Optional[str]]:
    from app.core.config import settings

    return {name: key_fingerprint(getattr(settings, name, None)) for name in KEY_NAMES}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="保存ファイルの一覧と鍵の指紋")
    parser.add_argument("--no-files", action="store_true")
    args = parser.parse_args(argv)
    roots = storage_roots()
    result: Dict[str, object] = dict(roots)
    result["key_fingerprints"] = fingerprints()
    if not args.no_files:
        result["files"] = list_files(roots["uploads_root"])
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
