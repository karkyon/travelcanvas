"""[Gate CI-Redis] scripts/ci/check_required_tests.py(必須の試験が実行されて合格し、Redis の理由の飛ばしが 0 件か)。"""
import importlib.util
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def _load():
    path = ROOT / "scripts" / "ci" / "check_required_tests.py"
    spec = importlib.util.spec_from_file_location("check_required_tests", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _junit(tmp_path, cases):
    body = "".join(cases)
    p = tmp_path / "j.xml"
    p.write_text('<testsuites><testsuite name="pytest">%s</testsuite></testsuites>' % body, encoding="utf-8")
    return p


PASS = '<testcase classname="tests.test_gate_fr059c_shared_suspension" name="test_a"/>'
SKIP_REDIS = ('<testcase classname="tests.test_gate_fr059c_shared_suspension" name="test_b">'
              '<skipped message="Redis に届かない環境"/></testcase>')
SKIP_OTHER = ('<testcase classname="tests.test_gate_g3_perf" name="test_c">'
              '<skipped message="大きいデータの性能の検査は毎晩(TC_PERF=1)"/></testcase>')
FAIL = ('<testcase classname="tests.test_gate_fr059c_shared_suspension" name="test_d">'
        '<failure message="boom"/></testcase>')


def test_passes_when_required_tests_ran(tmp_path, capsys):
    mod = _load()
    j = _junit(tmp_path, [PASS, SKIP_OTHER])
    assert mod.main(["--junit", str(j), "--forbid-skip-reason", "Redis",
                     "--require", "tests/test_gate_fr059c_shared_suspension.py", "--min-run", "1"]) == 0
    out = capsys.readouterr().out
    assert "飛ばした試験 1 件" in out and "test_gate_g3_perf::test_c" in out  # 許した飛ばしも隠さず出す


def test_fails_on_redis_skip_failure_missing_and_too_few(tmp_path):
    mod = _load()
    args = ["--forbid-skip-reason", "Redis", "--require", "tests/test_gate_fr059c_shared_suspension.py"]
    assert mod.main(["--junit", str(_junit(tmp_path, [PASS, SKIP_REDIS]))] + args) == 1
    assert mod.main(["--junit", str(_junit(tmp_path, [PASS, FAIL]))] + args) == 1
    assert mod.main(["--junit", str(_junit(tmp_path, [SKIP_OTHER]))] + args) == 1  # 必須のファイルの結果が無い
    assert mod.main(["--junit", str(_junit(tmp_path, [PASS]))] + args + ["--min-run", "2"]) == 1
    assert mod.main(["--junit", str(tmp_path / "missing.xml")] + args) == 1


def test_ci_backend_job_runs_redis_and_requires_it():
    ci = yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8"))
    job = ci["jobs"]["backend"]
    assert "redis" in job["services"]
    assert job["env"]["TC_REQUIRE_REDIS"] == "1" and job["env"]["REDIS_URL"].startswith("redis://localhost:6379")
    step = next(s for s in job["steps"] if s.get("name", "").startswith("Redis を使う試験の実行の確認"))
    assert "--forbid-skip-reason Redis" in step["run"] and "test_gate_fr059c_shared_suspension.py" in step["run"]
