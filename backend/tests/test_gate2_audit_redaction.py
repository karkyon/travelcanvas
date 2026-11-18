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
