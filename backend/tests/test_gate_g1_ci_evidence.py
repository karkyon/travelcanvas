"""[Gate G1] CI の証拠(CI-01/02、GOV-03、DEP-05、REP-01)。

- VERIFIED の証拠の試験が「この実行で合格した」かの照合(scripts/ci/check_ledger_results.py): 無い・失敗・skip を見つける
- bundle の上限(scripts/ci/check_bundle_budget.py): 最初に読む JS の合計・gzip 後・1つの塊
- main の保護の設定の記録(scripts/ops/ci_gate.py の protection_evidence): トークン・URL を含めず、足りない点を書く
- 追跡してはいけないファイル(.env・鍵・Redis のダンプ)を秘密の検査が見つける
- CI がこれらを blocking で実行し、結果(JUnit・SBOM・E2E の報告)を残す

リポジトリの根(.github・scripts)が無い場所(omega-dev2 の backend コンテナ)では飛ばす。
"""
import gzip
import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"

pytestmark = pytest.mark.skipif(not (SCRIPTS.is_dir() and WORKFLOW.is_file()),
                                reason="リポジトリの根が無い(backend コンテナの中)")


def _load(rel, name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / rel)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def ledger_check():
    return _load("ci/check_ledger_results.py", "check_ledger_results_g1")


@pytest.fixture(scope="module")
def budget():
    return _load("ci/check_bundle_budget.py", "check_bundle_budget_g1")


@pytest.fixture(scope="module")
def ci_gate():
    return _load("ops/ci_gate.py", "ci_gate_g1")


def _junit(path, cases):
    parts = ['<?xml version="1.0"?><testsuites><testsuite name="s">']
    for cls, name, outcome in cases:
        inner = {"failed": "<failure message='x'/>", "skipped": "<skipped/>", "error": "<error/>"}.get(outcome, "")
        parts.append('<testcase classname="%s" name="%s">%s</testcase>' % (cls, name, inner))
    parts.append("</testsuite></testsuites>")
    path.write_text("".join(parts), encoding="utf-8")
    return path


def test_ledger_results_backend(ledger_check, tmp_path):
    refs = {"backend/tests/test_a.py::test_ok", "backend/tests/test_a.py::test_param",
            "backend/tests/test_b.py::test_gone", "backend/tests/test_b.py::test_red",
            "backend/tests/test_b.py::test_skip"}
    cases = ledger_check.load_cases(_junit(tmp_path / "j.xml", [
        ("tests.test_a", "test_ok", "passed"),
        ("tests.test_a", "test_param[1]", "passed"), ("tests.test_a", "test_param[2]", "passed"),
        ("tests.test_b", "test_red", "failed"), ("tests.test_b", "test_skip", "skipped"),
        ("tests.test_b", "test_gone_but_longer", "passed"),
    ]))
    problems = "\n".join(ledger_check.check_backend(cases, refs))
    assert "test_gone: この実行の結果に無い" in problems
    assert "test_red: 失敗した" in problems and "test_skip: 飛ばされた" in problems
    assert "test_ok" not in problems and "test_param" not in problems


def test_ledger_results_e2e(ledger_check, tmp_path):
    cases = ledger_check.load_cases(_junit(tmp_path / "e.xml", [
        ("search.spec.ts", "finds", "passed"), ("visits.spec.ts", "a", "passed"), ("visits.spec.ts", "b", "failed"),
        ("mfa.spec.ts", "c", "skipped"),
    ]))
    problems = "\n".join(ledger_check.check_e2e(cases, {
        "frontend/e2e/search.spec.ts", "frontend/e2e/visits.spec.ts", "frontend/e2e/mfa.spec.ts",
        "frontend/e2e/atlas.spec.ts"}))
    assert "visits.spec.ts: 失敗" in problems and "mfa.spec.ts: 合格した試験が無い" in problems
    assert "atlas.spec.ts: この実行の結果に無い" in problems and "search.spec.ts" not in problems


def test_ledger_refs_cover_cross_cutting_and_verified_only(ledger_check):
    doc = json.loads((ROOT / "docs" / "trace" / "v1-verification-ledger.json").read_text(encoding="utf-8"))
    backend, e2e = ledger_check.ledger_refs(doc)
    assert set(doc["cross_cutting"]["authz"]) <= backend
    assert e2e and all(r.startswith("frontend/e2e/") for r in e2e)
    status = json.loads((ROOT / "docs" / "trace" / "fr-status.json").read_text(encoding="utf-8"))
    assert ledger_check.check_partial(doc, status) == []
    doc["features"]["FR-007"] = {"status": "VERIFIED"}
    assert ledger_check.check_partial(doc, status) == ["FR-007: DOC-10 で(部分)なのに VERIFIED"]


def _dist(tmp_path, entry_bytes, chunk_bytes=1000, preload_bytes=0):
    (tmp_path / "assets").mkdir(parents=True)
    (tmp_path / "assets" / "index-a.js").write_bytes(os.urandom(entry_bytes))
    (tmp_path / "assets" / "page-b.js").write_bytes(b"a" * chunk_bytes)
    preload = ""
    if preload_bytes:
        (tmp_path / "assets" / "vendor-c.js").write_bytes(os.urandom(preload_bytes))
        preload = '<link rel="modulepreload" crossorigin href="/assets/vendor-c.js">'
    (tmp_path / "index.html").write_text(
        '<html><head><script type="module" crossorigin src="/assets/index-a.js"></script>%s</head></html>' % preload,
        encoding="utf-8")
    return tmp_path


def test_bundle_budget(budget, tmp_path, capsys):
    assert budget.check(_dist(tmp_path / "ok", 100_000)) == 0
    assert budget.check(_dist(tmp_path / "big", 300_000, preload_bytes=200_000)) == 1  # 合計が上限を超える
    assert "最初に読む JS" in capsys.readouterr().out
    assert budget.check(_dist(tmp_path / "chunk", 10_000, chunk_bytes=600_000)) == 1
    assert budget.check(tmp_path / "missing") == 1
    assert budget.gz_size(b"a" * 10000) == len(gzip.compress(b"a" * 10000, 9, mtime=0))


def test_protection_evidence_records_policy_without_secrets(ci_gate):
    good = {
        "url": "https://api.github.com/repos/x/y/branches/main/protection",
        "required_status_checks": {"strict": True, "checks": [{"context": n} for n in ci_gate.REQUIRED_CHECKS]},
        "enforce_admins": {"enabled": True}, "required_linear_history": {"enabled": True},
        "allow_force_pushes": {"enabled": False}, "allow_deletions": {"enabled": False},
    }
    rec = ci_gate.protection_evidence(good, "karkyon/travelcanvas", "2026-10-20T00:00:00Z",
                                      {"visibility": "public"}, True)
    assert rec["meets_policy"] is True and rec["problems"] == []
    assert rec["required_status_checks"] == sorted(ci_gate.REQUIRED_CHECKS)
    assert rec["visibility"] == "public" and rec["private_vulnerability_reporting"] is True
    assert "url" not in rec and "api.github.com" not in json.dumps(rec)
    weak = dict(good, enforce_admins={"enabled": False}, allow_force_pushes={"enabled": True})
    rec2 = ci_gate.protection_evidence(weak, "x/y", "t")
    assert rec2["meets_policy"] is False and len(rec2["problems"]) == 2


def test_recorded_branch_protection_meets_policy(ci_gate):
    path = ROOT / "docs" / "ops" / "evidence" / "branch-protection.json"
    if not path.is_file():
        pytest.skip("main の保護の記録がまだ無い(ci_gate.py export。トークンのある omega-dev2 のパッチが作る)")
    rec = json.loads(path.read_text(encoding="utf-8"))
    assert rec["meets_policy"] is True, rec["problems"]
    assert set(ci_gate.REQUIRED_CHECKS) <= set(rec["required_status_checks"])
    assert rec["enforce_admins"] and not rec["allow_force_pushes"] and not rec["allow_deletions"]


def test_secret_scanner_rejects_forbidden_files_and_nothing_is_tracked():
    scanner = _load("security/scan_secrets.py", "scan_secrets_g1")
    assert scanner.self_test() == 0
    assert scanner.forbidden_path("backend/dump.rdb") == "redis_dump"
    assert scanner.forbidden_path(".env.example") is None
    try:
        tracked = scanner.tracked_files()
    except Exception:  # noqa: BLE001 - git の無い場所
        pytest.skip("git が無い")
    assert [p for p in tracked if scanner.forbidden_path(p)] == []
    assert "backend/dump.rdb" not in tracked


def test_workflow_keeps_results_and_checks_evidence():
    import yaml

    wf = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    jobs = wf["jobs"]

    def runs(job):
        return "\n".join(str(step.get("run", "")) for step in jobs[job]["steps"])

    assert "--junitxml=../ci-results/backend-junit.xml" in runs("backend")
    assert "check_ledger_results.py backend" in runs("backend")
    assert "check_ledger_results.py e2e" in runs("e2e")
    assert "check_bundle_budget.py" in runs("frontend")
    assert "npm sbom" in runs("dependency-audit")
    checkout = next(s for s in jobs["backend"]["steps"] if str(s.get("uses", "")).startswith("actions/checkout"))
    assert checkout.get("with", {}).get("fetch-depth") == 0
    uploads = [s for j in jobs.values() for s in j["steps"]
               if str(s.get("uses", "")).startswith("actions/upload-artifact")]
    always = [s for s in uploads if s.get("if") == "always()"]
    assert len(always) >= 3  # SBOM・backend の JUnit・E2E の結果は合否に関わらず残す
    e2e_env = next(s for s in jobs["e2e"]["steps"] if s.get("name", "").startswith("Playwright E2E"))["env"]
    assert e2e_env["PLAYWRIGHT_JUNIT_OUTPUT"] == "e2e-results/junit.xml"
    config = (ROOT / "frontend" / "playwright.config.ts").read_text(encoding="utf-8")
    assert "PLAYWRIGHT_JUNIT_OUTPUT" in config and "'junit'" in config


def test_export_writes_record_and_rejects_weak_settings(ci_gate, tmp_path, monkeypatch):
    good = {
        "required_status_checks": {"strict": True, "checks": [{"context": n} for n in ci_gate.REQUIRED_CHECKS]},
        "enforce_admins": {"enabled": True}, "required_linear_history": {"enabled": True},
        "allow_force_pushes": {"enabled": False}, "allow_deletions": {"enabled": False},
    }
    answers = {}

    def fake_request(method, path, *, body=None, tok=None, timeout=20.0):
        assert tok == "t0ken-not-written"
        if path.endswith("/branches/main/protection"):
            return answers["protection"]
        if path.endswith("/private-vulnerability-reporting"):
            return 200, {"enabled": True}
        return 200, {"visibility": "public"}

    monkeypatch.setattr(ci_gate, "token", lambda: "t0ken-not-written")
    monkeypatch.setattr(ci_gate, "request", fake_request)
    out = tmp_path / "evidence" / "bp.json"
    answers["protection"] = (200, good)
    assert ci_gate.cmd_export(str(out)) == ci_gate.EXIT_OK
    raw = out.read_text(encoding="utf-8")
    rec = json.loads(raw)
    assert rec["meets_policy"] and rec["visibility"] == "public" and rec["private_vulnerability_reporting"] is True
    assert "t0ken-not-written" not in raw and (out.stat().st_mode & 0o777) == 0o644
    answers["protection"] = (200, dict(good, enforce_admins={"enabled": False}))
    assert ci_gate.cmd_export(str(out)) == ci_gate.EXIT_FAILED
    answers["protection"] = (404, {"message": "Branch not protected"})
    assert ci_gate.cmd_export(str(tmp_path / "none.json")) == ci_gate.EXIT_FAILED
    monkeypatch.setattr(ci_gate, "token", lambda: None)
    assert ci_gate.cmd_export(str(tmp_path / "none.json")) == ci_gate.EXIT_NO_TOKEN
    assert not (tmp_path / "none.json").exists()
