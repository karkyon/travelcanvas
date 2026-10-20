#!/usr/bin/env python3
"""[Gate G1] DEP-05 frontend の bundle の大きさの上限(標準ライブラリだけ)。`npx vite build` の後に実行する。

    python3 scripts/ci/check_bundle_budget.py [--dist frontend/dist]

- 入口の JS(index.html が読む `type="module"` の script)と、それが先読みする JS(modulepreload)の合計を
  「最初に読む JS」とし、生のサイズ・gzip 後のサイズの上限を確かめる。
- どの JS の塊(chunk)も上限を超えないこと(遅延読込の画面が一つで大きくなりすぎるのを防ぐ)。

上限を超えたら終了コード 1。地図・QR・管理・組織などの重い依存は、画面ごとの遅延読込(React.lazy)へ移す。
kB は 1000 バイト(vite の表示と同じ)。
"""
from __future__ import annotations

import argparse
import gzip
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUDGET = {
    "initial_js_kb": 450.0,       # 最初に読む JS の合計(生)
    "initial_js_gzip_kb": 150.0,  # 同(gzip 後)
    "chunk_kb": 500.0,            # どの JS の塊も
}


def kb(n: int) -> float:
    return round(n / 1000.0, 2)


def gz_size(data: bytes) -> int:
    return len(gzip.compress(data, compresslevel=9, mtime=0))


def initial_scripts(dist: Path):
    html = (dist / "index.html").read_text(encoding="utf-8")
    entries = re.findall(r'<script[^>]+type="module"[^>]+src="([^"]+\.js)"', html)
    preloads = re.findall(r'<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"', html)
    out = []
    for ref in entries + preloads:
        rel = ref.split("?", 1)[0].lstrip("/")
        path = dist / rel
        if path.is_file() and path not in out:
            out.append(path)
    return out


def check(dist: Path) -> int:
    if not (dist / "index.html").is_file():
        print("bundle-budget: %s/index.html がありません(先に vite build)" % dist)
        return 1
    problems = []
    initial = initial_scripts(dist)
    if not initial:
        problems.append("index.html から入口の JS が見つからない")
    raw = sum(p.stat().st_size for p in initial)
    gz = sum(gz_size(p.read_bytes()) for p in initial)
    if kb(raw) > BUDGET["initial_js_kb"]:
        problems.append("最初に読む JS が %.2f kB(上限 %.0f kB)" % (kb(raw), BUDGET["initial_js_kb"]))
    if kb(gz) > BUDGET["initial_js_gzip_kb"]:
        problems.append("最初に読む JS が gzip 後 %.2f kB(上限 %.0f kB)" % (kb(gz), BUDGET["initial_js_gzip_kb"]))
    chunks = sorted((dist / "assets").glob("*.js")) if (dist / "assets").is_dir() else []
    largest = max(chunks, key=lambda p: p.stat().st_size, default=None)
    for p in chunks:
        if kb(p.stat().st_size) > BUDGET["chunk_kb"]:
            problems.append("%s が %.2f kB(1つの塊の上限 %.0f kB)" % (p.name, kb(p.stat().st_size), BUDGET["chunk_kb"]))
    summary = "最初に読む JS %d 個 %.2f kB(gzip %.2f kB)、塊 %d 個、最大 %s" % (
        len(initial), kb(raw), kb(gz), len(chunks),
        "%s %.2f kB" % (largest.name, kb(largest.stat().st_size)) if largest else "なし")
    if problems:
        print("bundle-budget: 上限を超えました: " + summary)
        for p in problems:
            print("  - " + p)
        return 1
    print("bundle-budget: OK " + summary)
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="frontend の bundle の大きさの上限")
    parser.add_argument("--dist", default=str(ROOT / "frontend" / "dist"))
    args = parser.parse_args(argv)
    return check(Path(args.dist))


if __name__ == "__main__":
    sys.exit(main())
