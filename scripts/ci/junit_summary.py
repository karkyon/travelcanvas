#!/usr/bin/env python3
"""[Gate G3] CI-02 JUnit の結果を GitHub の job の要約(GITHUB_STEP_SUMMARY)へ書く。落ちた試験の名前と
メッセージの先頭を、ログを開かずに見られるようにする(標準ライブラリだけ)。

    python3 scripts/ci/junit_summary.py --title "backend pytest" ci-results/backend-junit.xml [...]

GITHUB_STEP_SUMMARY が無い時は標準出力へ書く。結果のファイルが無くても失敗にしない(要約は補助)。
"""
import argparse
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Tuple


def summarize(paths: List[str]) -> Tuple[dict, List[Tuple[str, str]]]:
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    failed: List[Tuple[str, str]] = []
    for raw in paths:
        p = Path(raw)
        if not p.is_file():
            continue
        try:
            root = ET.parse(str(p)).getroot()
        except ET.ParseError:
            continue
        for case in root.iter("testcase"):
            totals["tests"] += 1
            name = "%s::%s" % (case.get("classname", ""), case.get("name", ""))
            for tag in ("failure", "error"):
                el = case.find(tag)
                if el is not None:
                    totals["failures" if tag == "failure" else "errors"] += 1
                    msg = (el.get("message") or el.text or "").strip().splitlines()
                    failed.append((name, (msg[0] if msg else "")[:300]))
            if case.find("skipped") is not None:
                totals["skipped"] += 1
    return totals, failed


def render(title: str, totals: dict, failed: List[Tuple[str, str]]) -> str:
    ok = not totals["failures"] and not totals["errors"]
    lines = ["### %s %s" % ("✅" if ok else "❌", title), "",
             "| 試験 | 失敗 | エラー | 飛ばし |", "|---:|---:|---:|---:|",
             "| %d | %d | %d | %d |" % (totals["tests"], totals["failures"], totals["errors"], totals["skipped"]), ""]
    if failed:
        lines += ["落ちた試験(最大50件):", ""]
        for name, msg in failed[:50]:
            lines.append("- `%s` — %s" % (name.replace("`", "'"), msg.replace("\n", " ")))
        lines.append("")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("files", nargs="+")
    args = ap.parse_args(argv)
    totals, failed = summarize(args.files)
    text = render(args.title, totals, failed)
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
