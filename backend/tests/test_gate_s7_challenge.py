"""[Gate S7] SEC-07 段階的な計算の確認(proof of work)。

点数(Gate S6)が上がった接続元からのログイン・登録・ゲスト開始・昇格に、計算の確認を求めること、
正しい解なら通り、偽造・使い回し・別の入口・別の接続元・期限切れ・易しすぎる解は通らないことを確かめる。
"""
import uuid

import pytest

from app.core.config import settings
from app.ops import metrics as ops_metrics
from app.services import challenge, threat_guard as guard

PASSWORD = "Gate-S7-Challenge-Pass1"
IP = "testclient"


@pytest.fixture(autouse=True)
def _on(monkeypatch):
    monkeypatch.setattr(settings, "GUARD_ENABLED", True)
    monkeypatch.setattr(settings, "GUARD_TRUSTED_IPS", "")
    monkeypatch.setattr(settings, "GUARD_WARN_SCORE", 1000)
    monkeypatch.setattr(settings, "GUARD_BLOCK_SCORE", 2000)
    monkeypatch.setattr(settings, "CHALLENGE_ENABLED", True)
    monkeypatch.setattr(settings, "CHALLENGE_SCORE", 30)
    monkeypatch.setattr(settings, "CHALLENGE_SCORE_STEP", 30)
    monkeypatch.setattr(settings, "CHALLENGE_BASE_DIFFICULTY", 8)  # 試験を速くする
    monkeypatch.setattr(settings, "CHALLENGE_ALWAYS", "")
    guard.reset_all()
    challenge.reset_used()
    yield
    guard.reset_all()
    challenge.reset_used()


def _suspicious(points=30, ip=IP):
    for _ in range(points // 10):
        guard.record_signal(ip, "cross_site_blocked")


def _solved_headers(res):
    token = res.headers["x-tc-challenge"]
    difficulty = int(res.headers["x-tc-challenge-difficulty"])
    return {"X-TC-Challenge": token, "X-TC-Challenge-Solution": challenge.solve(token, difficulty)}, token, difficulty


def _register_body():
    suffix = uuid.uuid4().hex[:10]
    return {"username": f"s7_{suffix}", "email": f"s7_{suffix}@example.com", "password": PASSWORD}


def test_low_score_needs_nothing(client):
    res = client.post("/api/v1/auth/register", json=_register_body())
    assert res.status_code == 200


def test_suspicious_client_must_solve_then_passes(client):
    _suspicious()
    body = _register_body()
    first = client.post("/api/v1/auth/register", json=body)
    assert first.status_code == 428
    assert first.json()["detail"] == challenge.CHALLENGE_DETAIL
    assert first.headers["x-tc-challenge-algorithm"] == challenge.ALGORITHM
    assert first.headers["cache-control"] == "no-store"
    headers, _, difficulty = _solved_headers(first)
    assert difficulty == 8
    second = client.post("/api/v1/auth/register", json=body, headers=headers)
    assert second.status_code == 200, second.text


def test_login_guest_and_upgrade_are_protected(client):
    _suspicious()
    assert client.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "nope"}).status_code == 428
    first = client.post("/api/v1/auth/guest")
    assert first.status_code == 428
    headers, _, _ = _solved_headers(first)
    guest = client.post("/api/v1/auth/guest", headers=headers)
    assert guest.status_code == 201
    token = guest.json()["access_token"]
    up = client.post("/api/v1/auth/guest/upgrade", json=_register_body(), headers={"Authorization": f"Bearer {token}"})
    assert up.status_code == 428


def test_difficulty_rises_with_score(client):
    _suspicious(30)
    assert int(client.post("/api/v1/auth/guest").headers["x-tc-challenge-difficulty"]) == 8
    _suspicious(60)  # 90 点
    assert int(client.post("/api/v1/auth/guest").headers["x-tc-challenge-difficulty"]) == 10


def test_solution_cannot_be_reused(client):
    _suspicious()
    first = client.post("/api/v1/auth/guest")
    headers, _, _ = _solved_headers(first)
    assert client.post("/api/v1/auth/guest", headers=headers).status_code == 201
    again = client.post("/api/v1/auth/guest", headers=headers)
    assert again.status_code == 428
    assert again.headers["x-tc-challenge-reason"] == "replayed"


@pytest.mark.parametrize("tamper", ["signature", "solution", "kind", "malformed"])
def test_forged_or_wrong_solutions_are_refused(client, tamper):
    _suspicious()
    first = client.post("/api/v1/auth/guest")
    headers, token, difficulty = _solved_headers(first)
    if tamper == "signature":
        body, _sig = token.split(".", 1)
        headers["X-TC-Challenge"] = body + ".AAAAAAAAAAAAAAAAAAAAAAAAAAA"
    elif tamper == "solution":
        counter = 0
        while challenge.solution_ok(token, str(counter), difficulty):
            counter += 1
        headers["X-TC-Challenge-Solution"] = str(counter)
    elif tamper == "kind":
        other = challenge.issue(IP, "login", difficulty)
        headers = {"X-TC-Challenge": other, "X-TC-Challenge-Solution": challenge.solve(other, difficulty)}
    else:
        headers["X-TC-Challenge-Solution"] = "12a"
    res = client.post("/api/v1/auth/guest", headers=headers)
    assert res.status_code == 428
    assert res.headers["x-tc-challenge-reason"] in ("bad_signature", "wrong_solution", "wrong_kind", "malformed")


def test_token_is_bound_to_client_and_time(client, monkeypatch):
    _suspicious()
    other_ip = challenge.issue("198.51.100.7", "guest", 8)
    res = client.post("/api/v1/auth/guest", headers={
        "X-TC-Challenge": other_ip, "X-TC-Challenge-Solution": challenge.solve(other_ip, 8)})
    assert res.headers["x-tc-challenge-reason"] == "wrong_client"
    token = challenge.issue(IP, "guest", 8)
    solution = challenge.solve(token, 8)
    real_now = challenge._now()
    monkeypatch.setattr(challenge, "_now", lambda: real_now + settings.CHALLENGE_TTL_SECONDS + 5)
    res = client.post("/api/v1/auth/guest", headers={"X-TC-Challenge": token, "X-TC-Challenge-Solution": solution})
    assert res.headers["x-tc-challenge-reason"] == "expired"


def test_easier_solution_after_score_rose_is_refused(client):
    _suspicious()
    easy = challenge.issue(IP, "guest", 8)
    _suspicious(60)
    res = client.post("/api/v1/auth/guest", headers={
        "X-TC-Challenge": easy, "X-TC-Challenge-Solution": challenge.solve(easy, 8)})
    assert res.status_code == 428
    assert res.headers["x-tc-challenge-reason"] == "too_easy"
    assert int(res.headers["x-tc-challenge-difficulty"]) == 10


def test_forgery_adds_to_the_score():
    before = guard.current_score(IP)
    _suspicious()
    after_suspicious = guard.current_score(IP)
    assert after_suspicious >= before + 30


def test_always_mode_and_trusted_and_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "CHALLENGE_ALWAYS", "register")
    assert client.post("/api/v1/auth/register", json=_register_body()).status_code == 428
    assert client.post("/api/v1/auth/guest").status_code == 201
    monkeypatch.setattr(settings, "GUARD_TRUSTED_IPS", IP)
    assert client.post("/api/v1/auth/register", json=_register_body()).status_code == 200
    monkeypatch.setattr(settings, "GUARD_TRUSTED_IPS", "")
    monkeypatch.setattr(settings, "CHALLENGE_ENABLED", False)
    assert client.post("/api/v1/auth/register", json=_register_body()).status_code == 200


def test_challenge_headers_are_exposed_to_the_browser(client):
    _suspicious()
    origin = settings.CORS_ORIGINS[0] if isinstance(settings.CORS_ORIGINS, list) else settings.CORS_ORIGINS
    res = client.post("/api/v1/auth/guest", headers={"Origin": origin})
    assert res.status_code == 428
    exposed = res.headers.get("access-control-expose-headers", "").lower()
    assert "x-tc-challenge" in exposed and "x-tc-challenge-difficulty" in exposed


def test_counted_in_metrics(client):
    issued = ops_metrics.registry.security_event_count("challenge_issued")
    passed = ops_metrics.registry.security_event_count("challenge_passed")
    _suspicious()
    first = client.post("/api/v1/auth/guest")
    headers, _, _ = _solved_headers(first)
    client.post("/api/v1/auth/guest", headers=headers)
    assert ops_metrics.registry.security_event_count("challenge_issued") == issued + 1
    assert ops_metrics.registry.security_event_count("challenge_passed") == passed + 1


def test_solver_matches_frontend_vectors():
    """frontend/src/utils/challengeSolver.test.ts と同じ値(言語をまたいで同じ計算)。"""
    assert challenge.solve("eyJ0ZXN0IjoxfQ.c2lnbmF0dXJl", 8) == "284"
    assert challenge.solve("eyJ0ZXN0IjoxfQ.c2lnbmF0dXJl", 12) == "8599"
    assert challenge.solve("a-b_c.d", 14) == "44074"


def test_ignoring_the_challenge_eventually_gets_blocked(client, monkeypatch):
    """確認を解かずに送り続ける攻撃も、点数が積み上がって遮断される(428 を返し続けるだけにしない)。"""
    monkeypatch.setattr(settings, "GUARD_BLOCK_SCORE", 60)
    _suspicious(30)
    statuses = [client.post("/api/v1/auth/guest").status_code for _ in range(20)]
    assert statuses[0] == 428
    assert statuses[-1] == 429
