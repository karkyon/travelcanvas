#!/usr/bin/env python3
"""[Gate G10-Q] V3 再監査: 58 FR の状態(docs/trace/fr-status.json)を、VERIFIED の証拠の台帳
(docs/trace/v1-verification-ledger.json)と E2E の spec(frontend/e2e)に突き合わせる(標準ライブラリだけ)。

    python3 scripts/ci/audit_v3.py            # 集計と検査の結果を Markdown で出す
    python3 scripts/ci/audit_v3.py --check    # 規則に反する FR があれば終了コード 1(backend の試験から呼ぶ)

規則(どれも「実装があるだけで昇格させない」ための検査):
  R1 VERIFIED の集合と台帳の集合が同じ(片方だけにある FR が無い)
  R2 (部分)の FR は VERIFIED にしない(未達の能力が残る)
  R3 VERIFIED は E2E の印が ✓
  R4 E2E の印が ✓ の FR は、その番号を名乗る spec が1本以上ある(印だけの ✓ を残さない)
  R5 E2E の印が ✗ の FR を名乗る spec が無い(✗ のまま試験が増えたら印を直す)
  R6 VERIFIED の台帳の E2E のうち1本以上が、その FR の番号を名乗る
  R7 VERIFIED でない FR は、主な不足(gaps)を書く(何が残っているかを空にしない)
  R8 RELEASED は本番の公開の証拠が要る。今は本番の環境が無いため 0 件のはず
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[2]
FR_STATUS = ROOT / "docs" / "trace" / "fr-status.json"
LEDGER = ROOT / "docs" / "trace" / "v1-verification-ledger.json"
E2E = ROOT / "frontend" / "e2e"


def _load() -> Tuple[dict, dict, Dict[str, str]]:
    status = json.loads(FR_STATUS.read_text(encoding="utf-8"))
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    specs = {p.name: p.read_text(encoding="utf-8") for p in sorted(E2E.glob("*.spec.ts"))}
    return status, ledger, specs


def _names(fr: str, text: str) -> bool:
    return re.search(r"\b%s\b" % re.escape(fr), text) is not None


def audit() -> Tuple[dict, List[str]]:
    status, ledger, specs = _load()
    feats = status["features"]
    weights = status["_meta"]["weights"]
    led = ledger["features"]
    problems: List[str] = []

    verified = {fr for fr, f in feats.items() if f["status"] == "VERIFIED"}
    in_ledger = {fr for fr, f in led.items() if f.get("status") == "VERIFIED"}
    for fr in sorted(verified - in_ledger):
        problems.append("R1 %s: VERIFIED だが台帳に証拠が無い" % fr)
    for fr in sorted(in_ledger - verified):
        problems.append("R1 %s: 台帳は VERIFIED だが fr-status.json は %s" % (fr, feats.get(fr, {}).get("status")))
    for fr, f in feats.items():
        named = [n for n, t in specs.items() if _names(fr, t)]
        if f["partial"] and f["status"] == "VERIFIED":
            problems.append("R2 %s: (部分)なのに VERIFIED" % fr)
        if f["status"] == "VERIFIED" and f["e2e"] != "✓":
            problems.append("R3 %s: VERIFIED なのに E2E の印が %s" % (fr, f["e2e"]))
        if f["e2e"] == "✓" and not named:
            problems.append("R4 %s: E2E の印は ✓ だが番号を名乗る spec が無い" % fr)
        if f["e2e"] == "✗" and named:
            problems.append("R5 %s: E2E の印は ✗ だが spec がある(%s)" % (fr, ", ".join(named)))
        if f["status"] == "VERIFIED" and fr in led:
            texts = [(ROOT / r).read_text(encoding="utf-8") for r in led[fr]["e2e"] if r.startswith("frontend/e2e/")]
            if not any(_names(fr, t) for t in texts):
                problems.append("R6 %s: 台帳の E2E がどれも番号を名乗らない" % fr)
        if f["status"] != "VERIFIED" and not (f.get("gaps") or "").strip():
            problems.append("R7 %s: VERIFIED でないのに主な不足が空" % fr)
        if f["status"] == "RELEASED":
            problems.append("R8 %s: 本番の環境が無いのに RELEASED" % fr)

    counts: Dict[str, int] = {}
    for f in feats.values():
        counts[f["status"]] = counts.get(f["status"], 0) + 1
    total = len(feats)
    weighted = sum(weights[f["status"]] for f in feats.values()) / total
    partial = sum(1 for f in feats.values() if f["partial"])
    # 厳しめ: (部分)は IMPLEMENTED(コードあり)の重みで数える
    strict = sum((weights["IMPLEMENTED"] if f["partial"] else weights[f["status"]]) for f in feats.values()) / total
    at_least_integrated = sum(1 for f in feats.values() if weights[f["status"]] >= weights["INTEGRATED"])
    summary = {
        "revision": status["_meta"]["revision"], "total": total, "counts": counts, "partial": partial,
        "weighted": round(weighted * 100, 1), "weighted_strict": round(strict * 100, 1),
        "integrated_or_more": at_least_integrated, "specs": len(specs),
    }
    return summary, problems


def render(summary: dict, problems: List[str]) -> str:
    c = summary["counts"]
    t = summary["total"]
    lines = [
        "# V3 再監査の結果(scripts/ci/audit_v3.py)", "",
        "| 指標 | 値 |", "|---|---|",
        "| 台帳の版 | %s |" % summary["revision"],
        "| VERIFIED | %d/%d(%.1f%%) |" % (c.get("VERIFIED", 0), t, 100 * c.get("VERIFIED", 0) / t),
        "| INTEGRATED | %d(うち(部分)%d) |" % (c.get("INTEGRATED", 0), summary["partial"]),
        "| SPECIFIED | %d |" % c.get("SPECIFIED", 0),
        "| RELEASED | %d |" % c.get("RELEASED", 0),
        "| コード・画面まで(INTEGRATED 以上) | %d/%d |" % (summary["integrated_or_more"], t),
        "| 加重の進捗(台帳の定義) | %.1f%% |" % summary["weighted"],
        "| 加重の進捗(厳しめ: (部分)をコードありの重みで) | %.1f%% |" % summary["weighted_strict"],
        "| E2E の spec | %d 本 |" % summary["specs"],
        "",
        "## 規則に反する FR", "",
    ]
    lines += ["- " + p for p in problems] if problems else ["なし(R1〜R8 を全て満たす)"]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    summary, problems = audit()
    sys.stdout.write(render(summary, problems))
    return 1 if (args.check and problems) else 0


if __name__ == "__main__":
    sys.exit(main())
