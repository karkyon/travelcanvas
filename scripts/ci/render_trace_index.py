#!/usr/bin/env python3
"""[Gate G1] GOV-04 docs/trace/INDEX.md(trace の一覧と、VERIFIED でない FR の残り)を作る(標準ライブラリだけ)。

    python3 scripts/ci/render_trace_index.py          # 書き換える
    python3 scripts/ci/render_trace_index.py --check  # 書き換えが要るなら 1
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRACE = ROOT / "docs" / "trace"
INDEX = TRACE / "INDEX.md"

HEAD = """# trace の索引と今の状態(Gate G1・GOV-04)

> **今の状態の正本は `docs/trace/fr-status.json`(人が読む版は `docs/spec/DOC-10_*.md`)。** 各 trace は、その Gate の時点の
> 要件ごとの証拠。後の Gate で解消した行には `SUPERSEDED BY <Gate>` を書いてある。trace の `NOT STARTED`・`PARTIAL` を
> 全文検索して残件を判断しない(この索引の §2 か fr-status.json を見る)。
> この文書は `python3 scripts/ci/render_trace_index.py` が作る(手で直さない)。

## 1. trace の一覧

数は、その trace の中で `SUPERSEDED BY` の無い `NOT STARTED`・`PARTIAL` の行と、`SUPERSEDED BY` を付けた行。

| trace | 題 | NOT STARTED | PARTIAL | SUPERSEDED |
|---|---|---|---|---|
"""

TAIL = """
VERIFIED の証拠は [v1-verification-ledger.json](v1-verification-ledger.json)、全 FR の状態は [fr-status.json](fr-status.json)。

## 2. VERIFIED でない FR の残り(fr-status.json から)

| FR | 機能 | 状態 | 主な不足 |
|---|---|---|---|
{gaps}

## 3. 棚卸しの規則

- 後の Gate で解消したら、古い trace の行の最後に `※ **SUPERSEDED BY Gate <名前> …**` を足す(行は消さない。当時の証拠のため)。
- 解消した能力が FR の(部分)の理由だったなら、同じ commit で fr-status.json の `gaps` と `partial` を直し、
  `python3 scripts/ci/render_doc10.py` と `python3 scripts/ci/render_trace_index.py` を実行する。
- `backend/tests/test_gate_g1_doc10.py` が、この索引が最新であることと、既知の解消済みの行に `SUPERSEDED BY` があることを確かめる。
"""


def render() -> str:
    rows = []
    for p in sorted(TRACE.glob("gate-*-trace.md")):
        lines = p.read_text(encoding="utf-8").splitlines()
        title = next((ln.lstrip("# ").strip() for ln in lines if ln.startswith("#")), p.stem).replace("|", "/")
        table = [ln for ln in lines if ln.startswith("|")]
        ns = sum(1 for ln in table if re.search(r"\|\s*NOT STARTED\s*\|", ln) and "SUPERSEDED BY" not in ln)
        pa = sum(1 for ln in table if re.search(r"\|\s*PARTIAL[^|]*\|", ln) and "SUPERSEDED BY" not in ln)
        sup = sum(1 for ln in lines if "SUPERSEDED BY" in ln)
        rows.append("| [%s](%s) | %s | %d | %d | %d |" % (p.name, p.name, title, ns, pa, sup))
    status = json.loads((TRACE / "fr-status.json").read_text(encoding="utf-8"))
    gaps = ["| %s | %s | %s%s | %s |" % (fr, f["title"], f["status"], "(部分)" if f["partial"] else "", f["gaps"])
            for fr, f in status["features"].items() if f["status"] != "VERIFIED"]
    return HEAD + "\n".join(rows) + "\n" + TAIL.format(gaps="\n".join(gaps))


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    new = render()
    old = INDEX.read_text(encoding="utf-8") if INDEX.is_file() else ""
    if "--check" in args:
        if new != old:
            print("docs/trace/INDEX.md が古い。python3 scripts/ci/render_trace_index.py を実行してください")
            return 1
        print("docs/trace/INDEX.md: 最新")
        return 0
    if new != old:
        INDEX.write_text(new, encoding="utf-8")
        print("docs/trace/INDEX.md を更新しました")
    return 0


if __name__ == "__main__":
    sys.exit(main())
