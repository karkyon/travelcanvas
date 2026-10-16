#!/usr/bin/env python3
"""[Gate O1] TravelCanvas の運用コマンド(B-010)の入口。本体は backend/app/ops/cli.py。

リポジトリ直下で実行する(標準ライブラリだけで動く。ホストに追加のパッケージは要らない):

    python3 scripts/ops/tcops.py --help

手順は docs/ops/RUNBOOK.md。
"""
import sys
from pathlib import Path

# ホストで backend/ の下に __pycache__ を作らない(backend はコンテナへバインドマウントされている)
sys.dont_write_bytecode = True

_BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(_BACKEND))

from app.ops.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
