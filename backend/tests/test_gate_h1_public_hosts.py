"""[Gate H1] 画面を omega-dev2・LAN の IP で開いた時に API を呼べる(CORS・CSRF の許可に TC_PUBLIC_HOSTS の :4173 を足す)。"""
from app.core.config import Settings, production_problems


def test_public_hosts_extend_cors_origins():
    s = Settings(CORS_ORIGINS="http://localhost:4173,http://127.0.0.1:4173",
                 TC_PUBLIC_HOSTS="omega-dev2, 192.168.1.20,bad host,")
    assert s.cors_allowed_origins == [
        "http://localhost:4173", "http://127.0.0.1:4173", "http://omega-dev2:4173", "http://192.168.1.20:4173"]
    # omega の backend コンテナには .env の TC_PUBLIC_HOSTS が環境変数で入るため、空を明示する
    assert Settings(CORS_ORIGINS="http://localhost:4173", TC_PUBLIC_HOSTS="").cors_allowed_origins == [
        "http://localhost:4173"]


def test_public_hosts_flagged_in_production_checks():
    s = Settings(TC_PUBLIC_HOSTS="omega-dev2")
    assert any("TC_PUBLIC_HOSTS" in p for p in production_problems(s))
    assert not any("TC_PUBLIC_HOSTS" in p for p in production_problems(Settings(TC_PUBLIC_HOSTS="")))


def test_preflight_from_public_host_is_allowed(client, monkeypatch):
    from app import main
    monkeypatch.setattr(main, "_ALLOWED_CORS_ORIGINS", main._ALLOWED_CORS_ORIGINS)  # 起動時の一覧を使う
    allowed = main._ALLOWED_CORS_ORIGINS[0]
    r = client.options("/api/v1/auth/login", headers={"Origin": allowed, "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") == allowed
    evil = {"Origin": "http://evil.example:4173", "Access-Control-Request-Method": "POST"}
    r = client.options("/api/v1/auth/login", headers=evil)
    assert r.headers.get("access-control-allow-origin") is None


def test_uat_https_port_adds_https_origins_only_when_set():
    """[Gate AdminUAT] 音声の UAT 用の https の入口(caddy)。ポートを設定した時だけ https://<名前>:<port> を足す"""
    s = Settings(CORS_ORIGINS="http://localhost:4173", TC_PUBLIC_HOSTS="192.168.1.11,omega-dev2",
                 TC_UAT_HTTPS_PORT="4443")
    assert s.cors_allowed_origins == [
        "http://localhost:4173", "http://192.168.1.11:4173", "https://192.168.1.11:4443",
        "http://omega-dev2:4173", "https://omega-dev2:4443"]
    assert "https://192.168.1.11:4443" not in Settings(
        CORS_ORIGINS="http://localhost:4173", TC_PUBLIC_HOSTS="192.168.1.11", TC_UAT_HTTPS_PORT="").cors_allowed_origins
    bad = Settings(CORS_ORIGINS="http://localhost:4173", TC_PUBLIC_HOSTS="192.168.1.11", TC_UAT_HTTPS_PORT="44;3")
    assert not any(o.startswith("https://") for o in bad.cors_allowed_origins)
    assert any("TC_UAT_HTTPS_PORT" in p for p in production_problems(Settings(TC_UAT_HTTPS_PORT="4443")))
