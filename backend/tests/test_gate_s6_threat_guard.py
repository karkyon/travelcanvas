"""[Gate S6] SEC-16/17/27 攻撃の兆候の自動検知・段階的な自動遮断と、攻撃の型の回帰試験。

ここでは「1つ1つは普通の失敗に見える要求を、入口を変えながら休まず送る」攻撃を再現し、
回数制限(入口ごと)では止まらないものが、接続元ごとの点数で止まることを確かめる。
"""
import uuid

import pytest

from app.core.config import settings
from app.ops import metrics as ops_metrics
from app.services import threat_guard as guard
from app.utils import rate_limiter

PASSWORD = "Gate-S6-Guard-Pass1"


@pytest.fixture(autouse=True)
def _guard_on(monkeypatch):
    monkeypatch.setattr(settings, "GUARD_ENABLED", True)
    monkeypatch.setattr(settings, "GUARD_TRUSTED_IPS", "")
    monkeypatch.setattr(settings, "GUARD_WARN_SCORE", 20)
    monkeypatch.setattr(settings, "GUARD_BLOCK_SCORE", 40)
    monkeypatch.setattr(settings, "GUARD_BLOCK_SECONDS", 600)
    monkeypatch.setattr(settings, "GUARD_WINDOW_SECONDS", 900)
    guard.reset_all()
    yield
    guard.reset_all()


def _register(client):
    suffix = uuid.uuid4().hex[:10]
    res = client.post("/api/v1/auth/register", json={
        "username": f"s6_{suffix}", "email": f"s6_{suffix}@example.com", "password": PASSWORD,
    })
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ===== 段階 =====

def test_score_reaches_warning_then_block():
    ip = "203.0.113.10"
    assert guard.record_signal(ip, "forbidden") is None
    results = [guard.record_signal(ip, "login_failed") for _ in range(4)]  # 2 + 20 = 22 -> warn
    assert "warn" in results
    assert guard.blocked_until(ip) == 0.0
    results = [guard.record_signal(ip, "login_failed") for _ in range(4)]  # 42 -> block
    assert results[-1] == "block" or "block" in results
    assert guard.blocked_until(ip) > 0


def test_repeat_offender_gets_longer_block(monkeypatch):
    ip = "203.0.113.11"
    for _ in range(8):
        guard.record_signal(ip, "login_failed")
    first = guard.blocked_until(ip)
    assert first > 0
    # 遮断が明けたことにして、もう一度
    monkeypatch.setattr(guard, "_now", lambda: first + 1)
    assert guard.blocked_until(ip) == 0.0
    for _ in range(8):
        guard.record_signal(ip, "login_failed")
    second = guard.blocked_until(ip)
    assert second - (first + 1) >= 4 * 600 - 1


def test_trusted_ips_are_never_counted(monkeypatch):
    monkeypatch.setattr(settings, "GUARD_TRUSTED_IPS", "10.0.0.0/8, 192.0.2.5")
    for _ in range(50):
        assert guard.record_signal("10.1.2.3", "malware_rejected") is None
        assert guard.record_signal("192.0.2.5", "malware_rejected") is None
    assert guard.blocked_until("10.1.2.3") == 0.0


def test_disabled_guard_does_nothing(monkeypatch):
    monkeypatch.setattr(settings, "GUARD_ENABLED", False)
    for _ in range(50):
        guard.record_signal("203.0.113.12", "malware_rejected")
    assert guard.blocked_until("203.0.113.12") == 0.0


def test_reset_unblocks():
    ip = "203.0.113.13"
    for _ in range(3):
        guard.record_signal(ip, "malware_rejected")
    assert guard.blocked_until(ip) > 0
    guard.reset(ip)
    assert guard.blocked_until(ip) == 0.0


def test_classification():
    c = guard.classify_response
    pid = str(uuid.uuid4())
    assert c("POST", "/api/v1/auth/login", 401, False) == "login_failed"
    assert c("GET", "/api/v1/auth/me", 401, True) == "invalid_token"
    assert c("GET", "/api/v1/auth/me", 401, False) is None  # 未ログインの画面表示は数えない
    assert c("GET", f"/api/v1/plans/{pid}", 403, True) == "forbidden"
    assert c("GET", f"/api/v1/plans/{pid}", 404, True) == "not_found_probe"
    assert c("GET", "/api/v1/nothing", 404, True) is None
    assert c("GET", f"/api/v1/plans/{pid}", 200, True) is None
    assert c("GET", "/health", 503, False) is None
    assert c("GET", "/metrics", 403, False) is None


# ===== HTTP で(攻撃の型の回帰試験) =====

def test_id_enumeration_across_endpoints_gets_blocked(client):
    """他人の ID を、入口を変えながら推測し続ける(回数制限では止まらない)。"""
    token = _register(client)
    statuses = []
    for i in range(40):
        pid = str(uuid.uuid4())
        path = ["/api/v1/travel-plans/{}", "/api/v1/plans/{}/reservations", "/api/v1/plans/{}/documents",
                "/api/v1/plans/{}/memories"][i % 4].format(pid)
        statuses.append(client.get(path, headers=_h(token)).status_code)
    assert 429 in statuses
    blocked = client.get("/api/v1/travel-plans/", headers=_h(token))
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    # 監視の入口は止めない
    assert client.get("/health").status_code == 200


def test_credential_stuffing_with_rotating_emails_gets_blocked(client):
    """メールを毎回変えたパスワードリスト攻撃(メールごとの回数制限には引っかからない)。

    点数: 失敗 6 回(5×6=30)で計算の確認が始まり、解かずに送り続けると 2 点ずつ上がって 40 で遮断。
    [Gate G10-Q] 確認を出した後の最初の解なしの1回は点数にしない(正しい利用者も最初は解なしで送る)ため、
    遮断は以前より1回遅れる(12 回目 → 14 回目)。
    """
    statuses = []
    for i in range(14):
        rate_limiter.reset_all()  # IP ごとの回数制限を外しても、点数で止まることを確かめる
        res = client.post("/api/v1/auth/login", json={"email": f"victim{i}@example.com", "password": "Spring2026!"})
        statuses.append(res.status_code)
    assert statuses[0] == 401
    assert statuses[-1] == 429


def test_forged_token_spray_gets_blocked(client):
    statuses = [client.get("/api/v1/auth/me", headers=_h(f"forged.{i}.token")).status_code for i in range(20)]
    assert statuses[0] == 401 and statuses[-1] == 429


def test_normal_use_is_not_blocked(client):
    token = _register(client)
    plan = client.post("/api/v1/travel-plans/", json={"title": "普段の利用"}, headers=_h(token)).json()["id"]
    for _ in range(60):
        assert client.get(f"/api/v1/travel-plans/{plan}", headers=_h(token)).status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401  # 未ログインの確認は数えない
    assert guard.blocked_until("testclient") == 0.0


def test_block_response_has_cors_and_security_headers(client):
    for _ in range(3):
        guard.record_signal("testclient", "malware_rejected")
    allowed = settings.CORS_ORIGINS[0] if isinstance(settings.CORS_ORIGINS, list) else settings.CORS_ORIGINS
    res = client.get("/api/v1/travel-plans/", headers={"Origin": allowed})
    assert res.status_code == 429
    assert res.headers.get("access-control-allow-origin") == allowed
    assert res.headers.get("x-content-type-options") == "nosniff"


def test_block_and_warn_are_counted(client):
    before = ops_metrics.registry.security_event_count("guard_block")
    for _ in range(3):
        guard.record_signal("203.0.113.20", "malware_rejected")
    assert ops_metrics.registry.security_event_count("guard_block") == before + 1


def test_explicit_signals_from_handlers_count(client):
    """別サイトからの更新は 403 + 追加の点数になる。"""
    for _ in range(4):
        client.post("/api/v1/auth/refresh", headers={"Origin": "https://evil.example"})
    assert client.post("/api/v1/auth/refresh", headers={"Origin": "https://evil.example"}).status_code == 429


@pytest.mark.parametrize("backend", ["redis"])
def test_guard_state_is_shared_through_redis(backend):
    try:
        import redis

        client = redis.Redis.from_url(settings.REDIS_URL, socket_timeout=0.5, socket_connect_timeout=0.5)
        client.ping()
    except Exception:  # noqa: BLE001
        pytest.skip("Redis に届かない")
    ns = f"s6test{uuid.uuid4().hex[:6]}"
    old = settings.RATE_LIMIT_NAMESPACE
    settings.RATE_LIMIT_NAMESPACE = ns
    rate_limiter.set_redis_client_for_testing(client)
    rate_limiter.use_backend("redis")
    try:
        ip = "203.0.113.30"
        for _ in range(3):
            guard.record_signal(ip, "malware_rejected")
        assert guard.blocked_until(ip) > 0
        keys = [k.decode() for k in client.scan_iter(match=f"{ns}:guard:*")]
        assert keys and all(ip not in k for k in keys)
        guard._mem_blocks.clear()  # 別のプロセスに見立てる(プロセス内には何も無い)
        assert guard.blocked_until(ip) > 0
        guard.reset_all()
        assert not list(client.scan_iter(match=f"{ns}:guard:*"))
    finally:
        rate_limiter.use_backend("memory")
        rate_limiter.set_redis_client_for_testing(None)
        settings.RATE_LIMIT_NAMESPACE = old


def test_oversized_bodies_are_counted(client):
    """上限を超える本文を送り続ける(メモリ・帯域を使わせる攻撃)。413 も点数になる。"""
    token = _register(client)
    big = b"x" * (settings.API_MAX_BODY_BYTES + 10)
    headers = {**_h(token), "Content-Type": "application/json"}
    statuses = [client.post("/api/v1/travel-plans/", content=big, headers=headers).status_code for _ in range(4)]
    # 大きすぎる本文は読まずに 413 で返す(遮断中でも、読まない方が安い)。その後の普通の要求は止まる
    assert statuses == [413, 413, 413, 413]
    assert client.get("/api/v1/travel-plans/", headers=_h(token)).status_code == 429


def test_requests_refused_by_the_guard_are_not_counted_again(client):
    for _ in range(3):
        guard.record_signal("testclient", "malware_rejected")
    until = guard.blocked_until("testclient")
    for _ in range(20):
        assert client.get("/api/v1/auth/me", headers=_h("forged.token")).status_code == 429
    # 遮断で返した 429 は点数にしない(遮断が延びたり、再犯の数が増えたりしない)
    assert guard.blocked_until("testclient") == until


# ===== 監視(SEC-18) =====

def test_monitor_reports_blocks_spikes_and_audit_failures():
    from app.ops import opslib

    prev = {"guard_blocks_total": 2, "security_events_total": 10, "audit_write_failed_total": 0}
    quiet = opslib.evaluate_monitor(dict(prev), prev)
    assert not [f for f in quiet if f["code"] in ("guard_blocked", "security_events_spike", "audit_write_failed")]
    busy = {"guard_blocks_total": 3, "security_events_total": 80, "audit_write_failed_total": 1}
    codes = {f["code"]: f["level"] for f in opslib.evaluate_monitor(busy, prev)}
    assert codes["guard_blocked"] == "warning"
    assert codes["security_events_spike"] == "warning"
    assert codes["audit_write_failed"] == "critical"
    # 再起動で数が戻った時は、今の数を増分とみなす
    assert "guard_blocked" in {f["code"] for f in opslib.evaluate_monitor({"guard_blocks_total": 1}, prev)}
