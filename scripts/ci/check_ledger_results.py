#!/usr/bin/env python3
"""[Gate G1] GOV-03 VERIFIED の証拠が「実在する」だけでなく「この実行で合格した」ことを確かめる(標準ライブラリだけ)。

    python3 scripts/ci/check_ledger_results.py backend --junit ci-results/backend-junit.xml
    python3 scripts/ci/check_ledger_results.py e2e --junit frontend/e2e-results/junit.xml

- backend: docs/trace/v1-verification-ledger.json が参照する backend の試験(``backend/tests/x.py::関数``)が、
  pytest の結果(JUnit XML)で1件以上合格し、失敗・エラー・飛ばし(skip)が無いこと。
  パラメータ付きの試験(``関数[...]``)は全ての組で合格を求める。
- e2e: 台帳が参照する E2E の spec ごとに、Playwright の結果(JUnit XML)で1件以上合格し、失敗が無いこと。
- どちらも、DOC-10 で「(部分)」の機能(docs/trace/fr-status.json の partial)が VERIFIED に入っていないことも確かめる。

証拠の試験を消す・名前を変える・skip にする・落ちたまま、のどれでも失敗する(終了コード 1)。
"""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "docs" / "trace" / "v1-verification-ledger.json"
FR_STATUS = ROOT / "docs" / "trace" / "fr-status.json"


def load_cases(path: Path) -> List[Tuple[str, str, str]]:
    """(classname, name, 結果)。結果は passed / failed / skipped。"""
    root = ET.parse(str(path)).getroot()
    out = []
    for case in root.iter("testcase"):
        outcome = "passed"
        for child in case:
            if child.tag in ("failure", "error"):
                outcome = "failed"
                break
            if child.tag == "skipped":
                outcome = "skipped"
        out.append((case.get("classname") or "", case.get("name") or "", outcome))
    return out


def ledger_refs(doc: dict) -> Tuple[Set[str], Set[str]]:
    backend: Set[str] = set()
    e2e: Set[str] = set()
    for block in ("authz", "security", "ops"):
        backend.update(doc["cross_cutting"][block])
    for fr, f in doc["features"].items():
        if f.get("status") != "VERIFIED":
            continue
        for col in ("authz", "conflict", "security"):
            backend.update(r for r in f.get(col, []) if "::" in r)
        e2e.update(r for r in f.get("e2e", []) if r.startswith("frontend/e2e/"))
    return backend, e2e


def _classname(ref_path: str) -> str:
    rel = ref_path[len("backend/"):] if ref_path.startswith("backend/") else ref_path
    return rel[:-3].replace("/", ".") if rel.endswith(".py") else rel


def check_backend(cases: List[Tuple[str, str, str]], refs: Set[str]) -> List[str]:
    problems = []
    for ref in sorted(refs):
        path, func = ref.split("::", 1)
        cls = _classname(path)
        hits = [o for c, n, o in cases if c == cls and (n == func or n.startswith(func + "["))]
        if not hits:
            problems.append("%s: この実行の結果に無い(消えた・名前が変わった・収集されていない)" % ref)
        elif any(o == "failed" for o in hits):
            problems.append("%s: 失敗した" % ref)
        elif any(o == "skipped" for o in hits):
            problems.append("%s: 飛ばされた(skip)。VERIFIED の証拠にならない" % ref)
    return problems


def check_e2e(cases: List[Tuple[str, str, str]], refs: Set[str]) -> List[str]:
    problems = []
    for ref in sorted(refs):
        spec = Path(ref).name
        hits = [o for c, n, o in cases if Path(c).name == spec or c.endswith("/" + spec) or spec in c]
        if not hits:
            problems.append("%s: この実行の結果に無い" % ref)
        elif any(o == "failed" for o in hits):
            problems.append("%s: 失敗した試験がある" % ref)
        elif not any(o == "passed" for o in hits):
            problems.append("%s: 合格した試験が無い(全て skip)" % ref)
    return problems


def check_partial(doc: dict, status: dict) -> List[str]:
    partial = {fr for fr, f in status["features"].items() if f.get("partial")}
    verified = {fr for fr, f in doc["features"].items() if f.get("status") == "VERIFIED"}
    return ["%s: DOC-10 で(部分)なのに VERIFIED" % fr for fr in sorted(partial & verified)]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="VERIFIED の証拠がこの実行で合格したかの確認")
    parser.add_argument("kind", choices=("backend", "e2e"))
    parser.add_argument("--junit", required=True)
    args = parser.parse_args(argv)
    doc = json.loads(LEDGER.read_text(encoding="utf-8"))
    status = json.loads(FR_STATUS.read_text(encoding="utf-8"))
    path = Path(args.junit)
    if not path.is_file():
        print("ledger-results: 結果のファイルがありません: %s" % path)
        return 1
    cases = load_cases(path)
    backend_refs, e2e_refs = ledger_refs(doc)
    problems = check_partial(doc, status)
    if args.kind == "backend":
        problems += check_backend(cases, backend_refs)
        n = len(backend_refs)
    else:
        problems += check_e2e(cases, e2e_refs)
        n = len(e2e_refs)
    if problems:
        print("ledger-results: VERIFIED の証拠に問題があります(%s):" % args.kind)
        for p in problems:
            print("  - " + p)
        return 1
    print("ledger-results: %s の証拠 %d 件がこの実行で合格(結果 %d 件)" % (args.kind, n, len(cases)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
