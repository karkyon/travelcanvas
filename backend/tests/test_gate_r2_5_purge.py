"""
[Gate R2-5] quickdraft_purge のテスト。
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.models import Device, IdempotencyRecord, QuickDraft, TravelPlan, User
from app.services.quickdraft_purge import (
    QUICK_DRAFT_EXPIRED_RETENTION_DAYS,
    QUICK_DRAFT_PROMOTED_RETENTION_DAYS,
    purge_expired_quickdrafts,
)


def _make_device(db_session):
    token = secrets.token_urlsafe(16)
    device = Device(
        token_digest=hashlib.sha256(token.encode()).digest(),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db_session.add(device)
    db_session.commit()
    return device


def _make_plan(db_session):
    user = User(
        username=f"purge_test_{uuid.uuid4().hex[:8]}",
        email=f"purge_{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="x",
    )
    db_session.add(user)
    db_session.flush()
    plan = TravelPlan(user_id=user.id, title="purge test plan")
    db_session.add(plan)
    db_session.commit()
    return plan


def test_active_draft_past_expiry_is_marked_expired(db_session):
    device = _make_device(db_session)
    draft = QuickDraft(
        device_id=device.id,
        payload_ciphertext=b"x",
        status="ACTIVE",
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db_session.add(draft)
    db_session.commit()

    counts = purge_expired_quickdrafts(db_session)

    db_session.refresh(draft)
    assert draft.status == "EXPIRED"
    assert counts["quick_drafts_marked_expired"] == 1


def test_active_draft_not_yet_expired_is_untouched(db_session):
    device = _make_device(db_session)
    draft = QuickDraft(
        device_id=device.id,
        payload_ciphertext=b"x",
        status="ACTIVE",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(draft)
    db_session.commit()

    purge_expired_quickdrafts(db_session)

    db_session.refresh(draft)
    assert draft.status == "ACTIVE"


def test_expired_unpromoted_draft_purged_after_retention(db_session):
    device = _make_device(db_session)
    draft = QuickDraft(
        device_id=device.id,
        payload_ciphertext=b"x",
        status="EXPIRED",
        expires_at=datetime.now(timezone.utc)
        - timedelta(days=QUICK_DRAFT_EXPIRED_RETENTION_DAYS, minutes=1),
    )
    db_session.add(draft)
    db_session.commit()
    draft_id = draft.id

    counts = purge_expired_quickdrafts(db_session)

    assert counts["quick_drafts_purged"] == 1
    assert db_session.query(QuickDraft).filter(QuickDraft.id == draft_id).first() is None


def test_expired_unpromoted_draft_kept_within_retention(db_session):
    device = _make_device(db_session)
    draft = QuickDraft(
        device_id=device.id,
        payload_ciphertext=b"x",
        status="EXPIRED",
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),  # < 7日
    )
    db_session.add(draft)
    db_session.commit()
    draft_id = draft.id

    purge_expired_quickdrafts(db_session)

    assert db_session.query(QuickDraft).filter(QuickDraft.id == draft_id).first() is not None


def test_promoted_expired_draft_kept_90_days_not_7(db_session):
    device = _make_device(db_session)
    draft = QuickDraft(
        device_id=device.id,
        payload_ciphertext=b"x",
        status="EXPIRED",
        promoted_plan_id=_make_plan(db_session).id,
        # 7日は過ぎているが90日は過ぎていない -> 保持されるはず
        expires_at=datetime.now(timezone.utc) - timedelta(days=10),
    )
    db_session.add(draft)
    db_session.commit()
    draft_id = draft.id

    counts = purge_expired_quickdrafts(db_session)

    assert counts["quick_drafts_purged"] == 0
    assert db_session.query(QuickDraft).filter(QuickDraft.id == draft_id).first() is not None


def test_promoted_expired_draft_purged_after_90_days(db_session):
    device = _make_device(db_session)
    draft = QuickDraft(
        device_id=device.id,
        payload_ciphertext=b"x",
        status="EXPIRED",
        promoted_plan_id=_make_plan(db_session).id,
        expires_at=datetime.now(timezone.utc)
        - timedelta(days=QUICK_DRAFT_PROMOTED_RETENTION_DAYS, minutes=1),
    )
    db_session.add(draft)
    db_session.commit()
    draft_id = draft.id

    counts = purge_expired_quickdrafts(db_session)

    assert counts["quick_drafts_purged"] == 1
    assert db_session.query(QuickDraft).filter(QuickDraft.id == draft_id).first() is None


def test_stale_in_progress_idempotency_record_recovered_to_failed(db_session):
    device = _make_device(db_session)
    record = IdempotencyRecord(
        key=str(uuid.uuid4()),
        endpoint="POST /v1/quick-drafts",
        payload_hash=hashlib.sha256(b"x").digest(),
        status="IN_PROGRESS",
        device_id=device.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db_session.add(record)
    db_session.commit()
    # created_atはserver_default=func.now()なので直接過去へ書き換える。
    db_session.execute(
        IdempotencyRecord.__table__.update()
        .where(IdempotencyRecord.id == record.id)
        .values(created_at=datetime.now(timezone.utc) - timedelta(minutes=30))
    )
    db_session.commit()

    counts = purge_expired_quickdrafts(db_session)

    db_session.refresh(record)
    assert record.status == "FAILED"
    assert counts["stale_in_progress_recovered"] == 1


def test_completed_idempotency_record_purged_after_expiry(db_session):
    device = _make_device(db_session)
    record = IdempotencyRecord(
        key=str(uuid.uuid4()),
        endpoint="POST /v1/quick-drafts",
        payload_hash=hashlib.sha256(b"x").digest(),
        status="COMPLETED",
        device_id=device.id,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db_session.add(record)
    db_session.commit()
    record_id = record.id

    counts = purge_expired_quickdrafts(db_session)

    assert counts["idempotency_records_purged"] == 1
    assert (
        db_session.query(IdempotencyRecord).filter(IdempotencyRecord.id == record_id).first()
        is None
    )


def test_completed_idempotency_record_kept_before_expiry(db_session):
    device = _make_device(db_session)
    record = IdempotencyRecord(
        key=str(uuid.uuid4()),
        endpoint="POST /v1/quick-drafts",
        payload_hash=hashlib.sha256(b"x").digest(),
        status="COMPLETED",
        device_id=device.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(record)
    db_session.commit()
    record_id = record.id

    purge_expired_quickdrafts(db_session)

    assert (
        db_session.query(IdempotencyRecord).filter(IdempotencyRecord.id == record_id).first()
        is not None
    )
