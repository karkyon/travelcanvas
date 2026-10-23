"""[Gate G3] CI-02・CI-03・DEP-04 の CI の道具。

- schema_snapshot: 実 PostgreSQL の構造を決まった順で写し、表・列・索引・外部キーを含む。差分を出せる
- junit_summary: 落ちた試験の名前とメッセージを要約へ書く(結果のファイルが無くても失敗にしない)
- check_test_output: 標準エラーが1行でもあれば失敗
- check_mypy_baseline: 基準に無い誤りを数える(行番号を含めない)
- CI の workflow が上の道具を使い、結果を残す
"""
import importlib.util
import json
import os
import sys
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CI = ROOT / "scripts" / "ci"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"

needs_repo = pytest.mark.skipif(not (CI.is_dir() and WORKFLOW.is_file()),
                                reason="リポジトリの根が無い(backend コンテナの中)")


def _load(name):
    spec = importlib.util.spec_from_file_location(name, CI / ("%s.py" % name))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_schema_snapshot_is_deterministic_and_complete(db_session):
    from app.core.config import settings
    from app.ops import schema_snapshot as ss

    a = ss.snapshot(settings.DATABASE_URL)
    b = ss.snapshot(settings.DATABASE_URL)
    assert a == b
    assert "TABLE travel_plans\n" in a
    assert "  COLUMN id UUID NOT NULL" in a
    assert "  FOREIGN KEY " in a and "  INDEX " in a and "  PRIMARY KEY (" in a
    tables = [ln for ln in a.splitlines() if ln.startswith("TABLE ")]
    assert tables == sorted(tables)


def test_schema_snapshot_diff(tmp_path, capsys):
    from app.ops import schema_snapshot as ss

    (tmp_path / "a.txt").write_text("TABLE x\n  COLUMN id UUID NOT NULL\n")
    (tmp_path / "b.txt").write_text("TABLE x\n  COLUMN id UUID NOT NULL\n  COLUMN note TEXT\n")
    out = ss.diff(str(tmp_path / "a.txt"), str(tmp_path / "b.txt"))
    assert "+  COLUMN note TEXT" in out
    assert ss.main(["--diff", str(tmp_path / "a.txt"), str(tmp_path / "a.txt")]) == 0
    assert "(差分なし)" in capsys.readouterr().out


@needs_repo
def test_junit_summary_lists_failures(tmp_path, monkeypatch):
    js = _load("junit_summary")
    xml = tmp_path / "r.xml"
    xml.write_text('<testsuites><testsuite name="s"><testcase classname="tests.a" name="ok"/>'
                   '<testcase classname="tests.a" name="bad">'
                   '<failure message="assert 1 == 2">trace</failure></testcase>'
                   '<testcase classname="tests.a" name="sk"><skipped/></testcase></testsuite></testsuites>')
    out = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(out))
    assert js.main(["--title", "backend", str(xml), str(tmp_path / "missing.xml")]) == 0
    text = out.read_text()
    assert "❌ backend" in text and "| 3 | 1 | 0 | 1 |" in text
    assert "`tests.a::bad` — assert 1 == 2" in text


@needs_repo
def test_check_test_output(tmp_path):
    ct = _load("check_test_output")
    empty = tmp_path / "e.txt"
    empty.write_text("\n  \n")
    assert ct.main([str(empty)]) == 0
    noisy = tmp_path / "n.txt"
    noisy.write_text("Warning: An update to X inside a test was not wrapped in act(...)\n")
    assert ct.main([str(noisy)]) == 1
    assert ct.main([str(tmp_path / "none.txt")]) == 1


@needs_repo
def test_mypy_baseline_counts_new_errors(tmp_path, monkeypatch):
    mb = _load("check_mypy_baseline")
    monkeypatch.chdir(tmp_path)
    base = Counter({"app/a.py: [arg-type] bad arg": 1})
    mb.write_baseline(base)
    assert mb.read_baseline() == base
    monkeypatch.setattr(mb, "run_mypy", lambda: Counter({"app/a.py: [arg-type] bad arg": 1}))
    assert mb.main([]) == 0
    monkeypatch.setattr(mb, "run_mypy", lambda: Counter({"app/a.py: [arg-type] bad arg": 2}))
    assert mb.main([]) == 1
    monkeypatch.setattr(mb, "run_mypy", lambda: Counter())
    assert mb.main([]) == 0  # 減った時は合格(書き直しを促す)
    m = mb.LINE.match('app/x.py:12: error: Incompatible types in assignment  [assignment]')
    assert m and m.group("code") == "assignment" and m.group("path") == "app/x.py"


@needs_repo
def test_workflow_uses_ci_tools_and_keeps_results():
    wf = WORKFLOW.read_text(encoding="utf-8")
    assert "check_test_output.py ../ci-results/vitest-stderr.txt" in wf
    assert "--coverage.reportsDirectory=../ci-results/frontend-coverage" in wf
    assert "--cov=app" in wf and "backend-coverage.xml" in wf
    assert "migration-schema-diff.txt" in wf
    assert "diff -u ../ci-results/schema-head.txt ../ci-results/schema-head-again.txt" in wf
    assert "check_mypy_baseline.py" in wf
    assert wf.count("junit_summary.py") >= 2
    assert (ROOT / "backend" / "mypy-baseline.txt").is_file()
    assert "retry: 0" in (ROOT / "frontend" / "vitest.config.ts").read_text(encoding="utf-8")


def test_new_modules_are_strictly_typed_in_mypy_config():
    cfg = (Path(__file__).resolve().parents[1] / "mypy.ini").read_text(encoding="utf-8")
    assert "disallow_untyped_defs = True" in cfg
    assert "app.ops.schema_snapshot" in cfg
    assert os.path.basename(sys.executable)


@needs_repo
def test_e2e_flaky_report_counts_retried_tests_separately(tmp_path, monkeypatch, capsys):
    fr = _load("e2e_flaky_report")
    report = {"suites": [{"file": "a.spec.ts", "specs": [
        {"title": "ok", "tests": [{"status": "expected", "results": [{"status": "passed"}]}]},
        {"title": "retried", "tests": [{"status": "flaky", "results": [
            {"status": "failed", "error": {"message": "Timeout 15000ms exceeded\nmore"}}, {"status": "passed"}]}]},
        {"title": "bad", "tests": [{"status": "unexpected", "results": [{"status": "failed"}]}]},
    ], "suites": [{"file": "a.spec.ts", "specs": [{"title": "nested", "tests": [{"status": "skipped"}]}]}]}]}
    counts, flaky = fr.collect(report)
    assert counts == {"passed": 1, "failed": 1, "flaky": 1, "skipped": 1}
    assert flaky == [("a.spec.ts", "retried", "Timeout 15000ms exceeded")]
    p = tmp_path / "r.json"
    p.write_text(json.dumps(report))
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    assert fr.main([str(p), "--issue"]) == 0
    out = capsys.readouterr().out
    assert "::warning file=frontend/a.spec.ts::E2E flaky" in out and "| 1 | 1 | 1 | 1 |" in out
    assert fr.main([str(tmp_path / "none.json")]) == 0


@needs_repo
def test_e2e_specs_do_not_sleep_for_fixed_time():
    """[Gate G3] CI-04 E2E は固定の待ち時間(waitForTimeout・setTimeout)を使わず、応答・状態を待つ。"""
    import re

    bad = []
    for spec in sorted((ROOT / "frontend" / "e2e").rglob("*.ts")):
        for n, line in enumerate(spec.read_text(encoding="utf-8").splitlines(), 1):
            if "allow-fixed-wait:" in line:  # 画面から観測できないサーバーの時間窓を待つ時だけ(理由を書く)
                continue
            if re.search(r"waitForTimeout\(|(?<!test\.)(?<!\.)setTimeout\(", line):
                bad.append("%s:%d" % (spec.name, n))
    assert bad == []
    wf = WORKFLOW.read_text(encoding="utf-8")
    assert "e2e_flaky_report.py frontend/e2e-results/report.json --issue" in wf
    assert "PLAYWRIGHT_JSON_OUTPUT" in (ROOT / "frontend" / "playwright.config.ts").read_text(encoding="utf-8")
