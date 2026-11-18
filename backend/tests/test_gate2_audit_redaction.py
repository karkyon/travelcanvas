"""Gate2 G2-08-B: 監査ログdetailsの機密値マスキング。"""

from unittest.mock import Mock

from app.services import audit_service


def test_record_audit_event_redacts_sensitive_values_before_persisting(monkeypatch):
    session = Mock()
    monkeypatch.setattr(audit_service, "SessionLocal", lambda: session)

    audit_service.record_audit_event(
        "security_event",
        "account",
        details={
            "access_token": "secret-token",
            "nested": {
                "contact_email": "traveler@example.test",
                "reservation_code": "ABC123",
                "result_count": 3,
            },
            "message": "Authorization: Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature",
        },
    )

    entry = session.add.call_args.args[0]
    assert entry.details == {
        "access_token": "[REDACTED]",
        "nested": {
            "contact_email": "[REDACTED]",
            "reservation_code": "[REDACTED]",
            "result_count": 3,
        },
        "message": "Authorization: Bearer [REDACTED]",
    }
    assert "secret-token" not in repr(entry.details)
    assert "traveler@example.test" not in repr(entry.details)
    session.commit.assert_called_once()


def _saved(monkeypatch, details):
    session = Mock()
    monkeypatch.setattr(audit_service, "SessionLocal", lambda: session)
    audit_service.record_audit_event("security_event", "account", details=details)
    return session.add.call_args.args[0].details


def test_redaction_keeps_harmless_values_and_handles_odd_shapes(monkeypatch):
    saved = _saved(monkeypatch, {
        "provider": "yahoo_local", "result_count": 0, "mapping": "ok", "max_tokens": 200,
        "items": [{"api_key": "sk-fake"}, "Bearer abc.def-ghi", 5, None],
        "pin": "1234", "座標": "keep-unicode-key", "latitude": 34.46,
        "note": "x" * 5000,
    })
    assert saved["provider"] == "yahoo_local" and saved["result_count"] == 0
    assert saved["mapping"] == "ok" and saved["max_tokens"] == 200
    assert saved["items"] == [{"api_key": "[REDACTED]"}, "Bearer [REDACTED]", 5, None]
    assert saved["pin"] == "[REDACTED]" and saved["latitude"] == "[REDACTED]"
    assert saved["座標"] == "keep-unicode-key"
    assert len(saved["note"]) == 5000


def test_redaction_never_breaks_the_audit_write(monkeypatch):
    assert _saved(monkeypatch, {"a": {1: {"password": "x"}}, "b": (1, 2)}) == {
        "a": {"1": {"password": "[REDACTED]"}}, "b": [1, 2]}
    assert audit_service.sanitize_audit_details(None) is None
    assert audit_service.sanitize_audit_details({}) is None
