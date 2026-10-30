#!/usr/bin/env python3
"""[Gate CI-Redis] JUnit の結果で、必須の試験が「実行されて合格」したことと、禁止の理由の飛ばしが 0 件であることを確かめる
(標準ライブラリだけ)。

    python3 scripts/ci/check_required_tests.py --junit ci-results/backend-junit.xml \
        --forbid-skip-reason Redis --require tests/test_gate_fr059c_shared_suspension.py --min-run 10

- ``--require <ファイル>``: そのファイルの試験が1件以上あり、全て実行されて合格していること(飛ばし・失敗は不可)
- ``--forbid-skip-reason <文字>``: 飛ばした理由にこの文字を含む試験が1件でもあれば失敗
- ``--min-run <数>``: ``--require`` の試験のうち実行されて合格した数の下限(試験が消えて0件で通るのを防ぐ)
飛ばした試験の一覧と理由は、合否に関わらず全て出す(隠さない)。
"""
import argparse
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List


def _module(classname: str) -> str:
    return classname.replace(".", "/") + ".py"


def check(junit: Path, require: List[str], forbid: List[str], min_run: int) -> List[str]:
    root = ET.parse(str(junit)).getroot()
    problems: List[str] = []
    skipped: List[str] = []
    required: Dict[str, Dict[str, int]] = {r: {"passed": 0, "other": 0} for r in require}
    for case in root.iter("testcase"):
        name = "%s::%s" % (case.get("classname", ""), case.get("name", ""))
        skip = case.find("skipped")
        failed = case.find("failure") is not None or case.find("error") is not None
        if skip is not None:
            reason = (skip.get("message") or skip.text or "").strip()
            skipped.append("%s | %s" % (name, reason[:160]))
            if any(word in reason for word in forbid):
                problems.append("禁止の理由で飛ばした: %s(%s)" % (name, reason[:160]))
        module = _module(case.get("classname", ""))
        for r in require:
            if module.endswith(r):
                if skip is None and not failed:
                    required[r]["passed"] += 1
                else:
                    required[r]["other"] += 1
                    problems.append("必須の試験が実行・合格していない: %s" % name)
    total_run = 0
    for r, c in required.items():
        print("[required-tests] %s: 合格 %d・飛ばし/失敗 %d" % (r, c["passed"], c["other"]))
        if c["passed"] + c["other"] == 0:
            problems.append("必須の試験のファイルの結果がありません: %s" % r)
        total_run += c["passed"]
    if total_run < min_run:
        problems.append("必須の試験の合格が %d 件で、下限 %d 件より少ない" % (total_run, min_run))
    print("[required-tests] 飛ばした試験 %d 件" % len(skipped))
    for line in skipped:
        print("  - " + line)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### 必須の試験(Redis)\n\n合格 %d 件・飛ばした試験 %d 件・問題 %d 件\n\n" % (total_run, len(skipped), len(problems)))
            for line in skipped:
                f.write("- 飛ばし: `%s`\n" % line.replace("`", "'"))
            for line in problems:
                f.write("- **%s**\n" % line.replace("`", "'"))
    return problems


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--junit", required=True)
    p.add_argument("--require", action="append", default=[])
    p.add_argument("--forbid-skip-reason", action="append", default=[])
    p.add_argument("--min-run", type=int, default=0)
    a = p.parse_args(argv)
    path = Path(a.junit)
    if not path.is_file():
        print("[required-tests] JUnit の結果がありません: %s" % path)
        return 1
    problems = check(path, a.require, a.forbid_skip_reason, a.min_run)
    for line in problems:
        print("[required-tests] ✗ " + line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
