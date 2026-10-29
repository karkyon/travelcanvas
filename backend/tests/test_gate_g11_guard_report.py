"""[Gate G11] CI の E2E の接続元の点数の報告(scripts/ci/e2e_guard_report.py)。

- threat_guard.classify_response と同じ分け方で点数にする(成功・監視の入口・公開の 401 の扱い)
- 経路の UUID・共有の token を伏せ、query を落とす(秘密・個人の値を CI の要約に出さない)
- 時間窓の最大を出し、遮断の log を拾う。時刻の無い log でも壊れない
"""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ci" / "e2e_guard_report.py"

pytestmark = pytest.mark.skipif(not SCRIPT.is_file(), reason="リポジトリの根が無い(backend コンテナの中)")


@pytest.fixture(scope="module")
def report():
    spec = importlib.util.spec_from_file_location("e2e_guard_report", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ID = "3f2b8c1e-1d2a-4f3b-9c8d-0a1b2c3d4e5f"


def _line(ts, method, path, status):
    access = f'"{method} {path} HTTP/1.1" {status} X'
    return f"backend-1  | 2026-10-29T01:{ts}.123456789Z INFO:     172.18.0.1:5555 - {access}"


def test_weights_match_classify_response(report):
    from app.services import threat_guard

    cases = [("POST", "/api/v1/auth/login", 401), ("GET", f"/api/v1/plans/{ID}", 403),
             ("GET", f"/api/v1/plans/{ID}", 404), ("GET", "/api/v1/plans/", 404),
             ("POST", "/api/v1/auth/register", 429), ("GET", "/health", 401),
             ("GET", "/api/v1/travel-plans/", 200), ("POST", "/api/v1/x", 413)]
    weights = threat_guard.SIGNAL_WEIGHTS
    for method, path, status in cases:
        kind = threat_guard.classify_response(method, path, status, True)
        assert report.weight(method, path, status) == (weights[kind] if kind else 0), (method, path, status)


def test_masks_ids_tokens_and_query(report):
    assert report.template(f"/api/v1/plans/{ID}/days?x=1") == "/api/v1/plans/{id}/days"
    shared = report.template("/api/v1/public/share/AbCdEfGhIjKlMnOpQrStUv123/info")
    assert shared == "/api/v1/public/share/{token}/info"


def test_peak_window_and_blocks(report):
    lines = [
        _line("00:00", "POST", "/api/v1/auth/login", 401),
        _line("05:00", "GET", f"/api/v1/plans/{ID}", 403),
        _line("20:00", "POST", "/api/v1/auth/register", 429),   # 窓(900秒)の外の前の2件は落ちる
        _line("20:01", "GET", "/api/v1/travel-plans/", 200),
        "backend-1  | 2026-10-29T01:20:02.1Z WARNING:app.services.threat_guard:guard: 接続元を一時遮断しました(点数 150、1 回目、900 秒)",
        'INFO:     127.0.0.1:1 - "GET /api/v1/auth/me HTTP/1.1" 401 Unauthorized',  # 時刻なし
        "読めない行",
    ]
    r = report.analyse(lines)
    assert r["points"] == 5 + 2 + 3 + 3
    assert r["peak"] == 7 and r["peak_at"] == "01:05:00"
    assert r["blocks"] and "点数 150" in r["blocks"][0]
    text = report.render(r)
    assert "`POST /api/v1/auth/login 401`" in text and ID not in text and "172.18" not in text
