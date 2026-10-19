"""[Gate S11] SEC-24 main の保護と CI の合格の待ち合わせ(scripts/ops/ci_gate.py)。

- 必須の CI(ci_gate.REQUIRED_CHECKS)が .github/workflows/ci.yml のジョブと一致し、gate/** への push でも CI が走る
- 合否の判定: 全部 success で合格、1つでも failure・skipped・cancelled なら不合格、未完了・未登録は待つ
- 保護の設定: 必須の CI・管理者にも適用・強制 push と削除の禁止・直線の履歴。足りない点を指摘する
- トークンが無い時は画面での手順を出して 3 で終わる(トークンの値は表示しない)

リポジトリの根(.github・scripts)が無い場所(omega-dev2 の backend コンテナは backend だけを持つ)では飛ばす。
CI の backend ジョブ(リポジトリ全体がある)で必ず走る。
"""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ops" / "ci_gate.py"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"

pytestmark = pytest.mark.skipif(not (SCRIPT.is_file() and WORKFLOW.is_file()),
                                reason="リポジトリの根が無い(backend コンテナの中)")


@pytest.fixture(scope="module")
def ci_gate():
    spec = importlib.util.spec_from_file_location("ci_gate_s11", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_required_checks_are_the_ci_jobs_and_gate_branches_run_ci(ci_gate):
    import yaml

    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert set(ci_gate.REQUIRED_CHECKS) == set(workflow["jobs"])
    triggers = workflow.get("on") or workflow.get(True)
    assert "gate/**" in triggers["push"]["branches"] and "main" in triggers["push"]["branches"]


def _run(name, status="completed", conclusion="success", started="2026-10-19T00:00:00Z"):
    return {"name": name, "status": status, "conclusion": conclusion, "started_at": started}


def test_verdict(ci_gate):
    ok = [_run(n) for n in ci_gate.REQUIRED_CHECKS]
    assert ci_gate.verdict(ci_gate.summarize(ok))[0] == "success"
    assert ci_gate.verdict(ci_gate.summarize(ok[:-1]))[0] == "pending"
    running = ok[:-1] + [_run("e2e", status="in_progress", conclusion=None)]
    assert ci_gate.verdict(ci_gate.summarize(running))[0] == "pending"
    skipped = ok[:-1] + [_run("e2e", conclusion="skipped")]
    result, notes = ci_gate.verdict(ci_gate.summarize(skipped))
    assert result == "failure" and notes == ["e2e: skipped"]
    # 同じ名前が2つあれば新しい方(再実行で合格した)
    rerun = ok + [_run("backend", conclusion="failure", started="2026-10-18T00:00:00Z")]
    assert ci_gate.verdict(ci_gate.summarize(rerun))[0] == "success"
    # 関係のない check run は数えない
    assert ci_gate.verdict(ci_gate.summarize(ok + [_run("other", conclusion="failure")]))[0] == "success"


def test_protection_body_and_problems(ci_gate):
    body = ci_gate.protection_body()
    assert body["enforce_admins"] is True and body["allow_force_pushes"] is False
    assert body["required_pull_request_reviews"] is None
    assert [c["context"] for c in body["required_status_checks"]["checks"]] == list(ci_gate.REQUIRED_CHECKS)
    good = {
        "required_status_checks": {"strict": True, "checks": [{"context": n} for n in ci_gate.REQUIRED_CHECKS]},
        "enforce_admins": {"enabled": True},
        "allow_force_pushes": {"enabled": False},
        "allow_deletions": {"enabled": False},
        "required_linear_history": {"enabled": True},
    }
    assert ci_gate.protection_problems(good) == []
    weak = dict(good, enforce_admins={"enabled": False},
                required_status_checks={"strict": False, "contexts": ["backend"]})
    problems = " / ".join(ci_gate.protection_problems(weak))
    assert "管理者" in problems and "e2e" in problems and "追いついていない" in problems


def test_protect_without_token_prints_ui_steps(ci_gate, monkeypatch, capsys):
    monkeypatch.setattr(ci_gate, "token", lambda: None)
    assert ci_gate.cmd_protect(dry_run=False) == ci_gate.EXIT_NO_TOKEN
    out = capsys.readouterr().out
    assert "settings/branches" in out and all(n in out for n in ci_gate.REQUIRED_CHECKS)


def test_wait_rejects_bad_sha(ci_gate):
    assert ci_gate.cmd_wait("main", 10, 10) == ci_gate.EXIT_UNREACHABLE


# ---------------------------------------------------------------- [Gate L5-r2] 再実行・落ちた内容の表示


def test_latest_run_prefers_higher_id_even_before_it_starts(ci_gate):
    old = dict(_run("e2e", conclusion="failure", started="2026-10-19T00:00:00Z"), id=10)
    queued = dict(_run("e2e", status="queued", conclusion=None, started=None), id=11)
    states = ci_gate.summarize([old, queued])
    assert states["e2e"] == ("queued", None)


def test_rerunnable_only_when_e2e_alone_failed(ci_gate):
    ok = {n: ("completed", "success") for n in ci_gate.REQUIRED_CHECKS}
    assert ci_gate.rerunnable(ok) is False
    assert ci_gate.rerunnable(dict(ok, e2e=("completed", "failure"))) is True
    assert ci_gate.rerunnable(dict(ok, e2e=("completed", "failure"), backend=("completed", "failure"))) is False
    assert ci_gate.rerunnable(dict(ok, backend=("completed", "failure"))) is False
    assert ci_gate.rerunnable(dict(ok, frontend=("completed", "skipped"), e2e=("completed", "skipped"))) is False


def test_log_excerpt_picks_playwright_failures(ci_gate):
    log = "\n".join([
        "2026-10-18T23:03:00.0000000Z Running 45 tests using 1 worker",
        "2026-10-18T23:03:01.0000000Z   \x1b[32m✓\x1b[39m   1 [chromium] › e2e/a11y.spec.ts:20:3 › ok (1.2s)",
        "2026-10-18T23:03:05.0000000Z   ✘  2 [chromium] › e2e/x.spec.ts:9:1 › 壊れた試験 (3.1s)",
        "2026-10-18T23:04:00.0000000Z   1) [chromium] › e2e/x.spec.ts:9:1 › 壊れた試験 ───",
        "2026-10-18T23:04:00.0000000Z     Error: expect(locator).toHaveText(expected) failed",
        "2026-10-18T23:04:00.0000000Z     Expected: \"A\"",
        "2026-10-18T23:04:01.0000000Z   1 failed",
        "2026-10-18T23:04:01.0000000Z     [chromium] › e2e/x.spec.ts:9:1 › 壊れた試験",
        "2026-10-18T23:04:01.0000000Z   44 passed (2.1m)",
    ])
    out = ci_gate.log_excerpt(log)
    joined = "\n".join(out)
    assert "1) [chromium] › e2e/x.spec.ts:9:1" in joined and "Error: expect(locator)" in joined
    assert "1 failed" in joined and "44 passed" in joined and "\x1b" not in joined
    assert not any(line.startswith("2026-") for line in out)
    assert ci_gate.log_excerpt("a\nb")[0].startswith("(Playwright の失敗の行が見つかりません")


def test_workflow_pins_runner_and_playwright_reports_to_github(ci_gate):
    import yaml

    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert {job["runs-on"] for job in workflow["jobs"].values()} == {"ubuntu-24.04"}
    config = (ROOT / "frontend" / "playwright.config.ts").read_text(encoding="utf-8")
    assert "['github']" in config
