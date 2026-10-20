#!/usr/bin/env python3
"""[Gate G1] GOV-01 DOC-10 の FR の表と集計を docs/trace/fr-status.json から作る(標準ライブラリだけ)。

    python3 scripts/ci/render_doc10.py           # docs/spec/DOC-10_*.md の印の間を書き換える
    python3 scripts/ci/render_doc10.py --check   # 書き換えが要るなら 1(CI・試験で使う)

DOC-10 の本文のうち、`<!-- generated:fr-table -->` 〜 `<!-- /generated:fr-table -->` と
`<!-- generated:summary -->` 〜 `<!-- /generated:summary -->` の間はこの道具だけが書く。
状態を変える時は fr-status.json を直してから、この道具を実行する(手で表を直すと CI が落ちる)。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
FR_STATUS = ROOT / "docs" / "trace" / "fr-status.json"
LEDGER = ROOT / "docs" / "trace" / "v1-verification-ledger.json"
SPEC_DIR = ROOT / "docs" / "spec"
VERSIONS = ROOT / "backend" / "alembic" / "versions"
STATES = ("IDEA", "SPECIFIED", "SCAFFOLDED", "IMPLEMENTED", "INTEGRATED", "VERIFIED", "RELEASED")


def doc10_path() -> Path:
    found = sorted(SPEC_DIR.glob("DOC-10_*.md"))
    if len(found) != 1:
        raise SystemExit("docs/spec に DOC-10 がちょうど1つ必要です(%d 個)" % len(found))
    return found[0]


def load_status() -> dict:
    return json.loads(FR_STATUS.read_text(encoding="utf-8"))


def label(f: dict) -> str:
    return f["status"] + ("(部分)" if f.get("partial") else "")


def summary_numbers(status: dict) -> Dict[str, object]:
    feats = status["features"]
    weights = status["_meta"]["weights"]
    n = len(feats)
    by: Dict[str, int] = {}
    for f in feats.values():
        by[f["status"]] = by.get(f["status"], 0) + 1
    integrated_up = sum(by.get(s, 0) for s in ("INTEGRATED", "VERIFIED", "RELEASED"))
    implemented_up = integrated_up + by.get("IMPLEMENTED", 0)
    weighted = sum(float(weights.get(f["status"], 0)) for f in feats.values()) / n
    return {
        "total": n,
        "by_status": by,
        "implemented_up": implemented_up,
        "integrated_up": integrated_up,
        "verified": by.get("VERIFIED", 0) + by.get("RELEASED", 0),
        "released": by.get("RELEASED", 0),
        "partial": sum(1 for f in feats.values() if f.get("partial")),
        "weighted_percent": round(weighted * 100, 1),
        "verified_list": [fr for fr, f in feats.items() if f["status"] == "VERIFIED"],
        "not_started": [fr for fr, f in feats.items() if f["status"] in ("IDEA", "SPECIFIED")],
    }


def render_table(status: dict) -> str:
    lines = ["| FR | 機能 | 状態 | E2E | 主な Gate | 主な不足 |", "|---|---|---|---|---|---|"]
    for fr, f in status["features"].items():
        lines.append("| %s | %s | %s | %s | %s | %s |" % (fr, f["title"], label(f), f["e2e"], f["gates"], f["gaps"]))
    return "\n".join(lines)


def render_summary(status: dict) -> str:
    s = summary_numbers(status)
    n = s["total"]

    def pct(x: int) -> str:
        return "%d/%d = %d%%" % (x, n, round(100.0 * x / n))

    return "\n".join([
        "| 見方 | 値 |",
        "|---|---|",
        "| コードがある機能(IMPLEMENTED 以上) | %s |" % pct(s["implemented_up"]),  # type: ignore[arg-type]
        "| INTEGRATED 以上 | %s(うち(部分) %d) |" % (pct(s["integrated_up"]), s["partial"]),  # type: ignore[arg-type]
        "| VERIFIED | %s |" % pct(s["verified"]),  # type: ignore[arg-type]
        "| RELEASED | %s |" % pct(s["released"]),  # type: ignore[arg-type]
        "| 加重進捗(SPECIFIED 0・IMPLEMENTED 0.4・INTEGRATED 0.7・VERIFIED 0.9・RELEASED 1.0) | 約%s%% |"
        % s["weighted_percent"],
        "| 未着手(SPECIFIED 以下) | %s |" % ("、".join(s["not_started"]) or "なし"),  # type: ignore[arg-type]
        "",
        "VERIFIED の一覧: %s。" % "/".join(fr[3:] for fr in s["verified_list"]),  # type: ignore[union-attr]
    ])


BLOCKS = {"fr-table": render_table, "summary": render_summary}


def replace_block(text: str, name: str, body: str) -> str:
    pattern = re.compile(r"(<!-- generated:%s -->\n).*?(<!-- /generated:%s -->)" % (name, name), re.S)
    if not pattern.search(text):
        raise SystemExit("DOC-10 に印 <!-- generated:%s --> がありません" % name)
    return pattern.sub(lambda m: m.group(1) + body + "\n" + m.group(2), text)


def rendered(text: str, status: dict) -> str:
    for name, fn in BLOCKS.items():
        text = replace_block(text, name, fn(status))
    return text


def alembic_heads() -> List[str]:
    revs: Dict[str, Tuple[str, ...]] = {}
    for path in VERSIONS.glob("*.py"):
        body = path.read_text(encoding="utf-8")
        m = re.search(r"^revision[^=]*=\s*['\"]([0-9a-f]+)['\"]", body, re.M)
        d = re.search(r"^down_revision[^=]*=\s*(.+)$", body, re.M)
        if not m:
            continue
        downs = tuple(re.findall(r"['\"]([0-9a-f]+)['\"]", d.group(1))) if d else ()
        revs[m.group(1)] = downs
    parents = {p for downs in revs.values() for p in downs}
    return sorted(r for r in revs if r not in parents)


def stated(text: str, key: str) -> Optional[str]:
    """DOC-10 §0 の表から `| key | `値` …` の最初の `…` の値を読む。"""
    m = re.search(r"^\| %s \| `([^`]+)`" % re.escape(key), text, re.M)
    return m.group(1) if m else None


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    path = doc10_path()
    text = path.read_text(encoding="utf-8")
    new = rendered(text, load_status())
    if "--check" in args:
        if new != text:
            print("DOC-10 の生成部分が fr-status.json と一致しません。`python3 scripts/ci/render_doc10.py` を実行してください")
            return 1
        print("DOC-10: 生成部分は fr-status.json と一致")
        return 0
    if new != text:
        path.write_text(new, encoding="utf-8")
        print("DOC-10 を更新しました: %s" % path.relative_to(ROOT))
    else:
        print("DOC-10 は最新です")
    return 0


if __name__ == "__main__":
    sys.exit(main())
