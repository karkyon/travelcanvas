"""
[Gate Remaining-3] FR-010 取消期限の知らせ・FR-024 メールの即時の配信と端末への通知・FR-011 予約メールの転送アドレス。

検証する主な性質(実 PostgreSQL。外へは送らない):
- 取消期限: 48 時間前・6 時間前に 1 回ずつ、所有者と予約を隠されていない編集者へ。取消済み・期限切れは対象外
- instant: 自分あて・急ぎの通知だけ outbox に入れる(本文は題名と案内だけ)。メールの設定が無ければ入れない
- 端末への通知(notice): 15 分以内の読んでいない自分あての通知を 1 回だけ
- 転送アドレス: 設定が無い時は作れない。作り直すと前は無効。合言葉が違えば 403。届いたメールは候補(確定しない)
  になり、持ち主へ通知。宛先の文字は暗号文と sha256 だけを持つ
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models.models import (
    EmailOutbox, ImportJob, InboundMailAddress, Notification, NotificationPreference, PlanCollaborator, Reservation,
)
from app.services import cancel_deadlines, notify, today_push
from app.services import web_push as wp


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(client, title="取消期限"):
    p = client.post("/api/v1/travel-plans/", json={"title": title}).json()["id"]
    return p, f"/api/v1/plans/{p}"


def _reservation(db, plan_id, deadline, status="confirmed"):
    r = Reservation(plan_id=uuid.UUID(plan_id), type="accommodation", status=status, provider_name="嵐山の宿",
                    cancellation_deadline=deadline, timezone_id="Asia/Tokyo")
    db.add(r)
    db.commit()
    return r


# ===== 取消期限

def test_cancel_deadline_reminds_once_per_stage(auth_client, db_session, make_user):
    client, owner = auth_client
    p, _base = _plan(client)
    editor, _ = make_user()
    viewer, _ = make_user()
    for u, role in ((editor, "editor"), (viewer, "viewer")):
        db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=u.id, email=u.email, role=role,
                                        status="accepted"))
    db_session.commit()
    now = datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc)
    r = _reservation(db_session, p, now + timedelta(hours=30))
    _reservation(db_session, p, now + timedelta(hours=30), status="cancelled")
    _reservation(db_session, p, now - timedelta(hours=1))
    _reservation(db_session, p, now + timedelta(hours=80))
    first = cancel_deadlines.sweep(db_session, now)
    assert first["reservations"] == 1 and first["notified"] == 2  # 所有者・編集者(閲覧者には送らない)
    rows = db_session.query(Notification).filter(Notification.target_id == r.id).all()
    assert {n.user_id for n in rows} == {owner.id, editor.id}
    assert "宿「嵐山の宿」の取消期限まで48時間" in rows[0].title and "11/21 15:00" in rows[0].title
    # 同じ段階は 1 回だけ
    assert cancel_deadlines.sweep(db_session, now + timedelta(minutes=15))["reservations"] == 0
    # 6 時間前の段階は別に 1 回
    later = cancel_deadlines.sweep(db_session, now + timedelta(hours=25))
    assert later["reservations"] == 1
    assert db_session.query(Notification).filter(Notification.target_id == r.id).count() == 4


def test_cancel_deadline_job_is_scheduled():
    from app.ops import opslib
    from app.ops.cli import JOBS
    from app.ops.job_runs import EXPECTED_MINUTES

    assert JOBS["cancel-deadlines"] == ["-m", "app.ops.cancel_deadlines"]
    assert EXPECTED_MINUTES["cancel-deadlines"] == 15
    assert "jobs cancel-deadlines" in opslib.render_cron_block("/home/x/tc")


# ===== instant のメール

def test_instant_email_only_for_direct_or_urgent(auth_client, db_session, make_user, monkeypatch):
    client, owner = auth_client
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAIL_FROM", "tc@example.com")
    r = client.put("/api/v1/notifications/settings", json={"email_digest": "instant"})
    assert r.status_code == 200 and r.json()["email_digest"] == "instant"
    p, _ = _plan(client)
    from app.models.models import TravelPlan

    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).first()
    notify.deliver(db_session, plan, [owner.id], "poll_created", "投票が始まりました", "本文")
    db_session.commit()
    assert db_session.query(EmailOutbox).filter(EmailOutbox.user_id == owner.id).count() == 0
    notify.deliver(db_session, plan, [owner.id], "comment_mention", "メンションされました", "コメントの本文は送らない",
                   direct_ids=[owner.id])
    notify.deliver(db_session, plan, [owner.id], "cancel_deadline", "宿の取消期限まで6時間", "x")
    db_session.commit()
    mails = db_session.query(EmailOutbox).filter(EmailOutbox.user_id == owner.id).order_by(EmailOutbox.created_at).all()
    assert [m.kind for m in mails] == ["instant", "instant"]
    assert mails[0].subject == "TravelCanvas: メンションされました"
    assert "コメントの本文" not in mails[0].body and "取消期限" in mails[1].subject


def test_instant_requires_email_setting(auth_client, monkeypatch):
    client, _ = auth_client
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    r = client.put("/api/v1/notifications/settings", json={"email_digest": "instant"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "email_unavailable"


# ===== 端末への通知(notice)

def test_notice_push_sends_recent_direct_once(auth_client, db_session, monkeypatch):
    client, owner = auth_client
    p, _ = _plan(client)
    now = datetime.now(timezone.utc)
    db_session.add(Notification(id=uuid.uuid4(), user_id=owner.id, type="comment_mention", title="メンション",
                                message="m", related_plan_id=uuid.UUID(p), created_at=now - timedelta(minutes=3)))
    db_session.add(Notification(id=uuid.uuid4(), user_id=owner.id, type="poll_created", title="投票",
                                message="m", created_at=now - timedelta(minutes=3)))
    db_session.add(Notification(id=uuid.uuid4(), user_id=owner.id, type="comment_reply", title="古い返信",
                                message="m", created_at=now - timedelta(hours=2)))
    db_session.commit()
    msgs = today_push.notice_messages(db_session, owner, now)
    assert [m[1]["body"] for m in msgs] == ["メンション"]
    assert msgs[0][1]["url"] == f"/planner/{p}"
    sent = []
    monkeypatch.setattr(wp, "enabled", lambda: True)
    monkeypatch.setattr(today_push, "_push_users", lambda db: [owner])
    monkeypatch.setattr(wp, "subscriptions", lambda user: [{"id": "s"}])
    ok = {"sent": 1, "removed": 0, "failed": 0}
    monkeypatch.setattr(wp, "send_to_user", lambda user, msg, **kw: sent.append(msg) or ok)
    today_push.reset_for_testing()
    counts = {"users": 0, "plans": 0, "sent": 0, "removed": 0, "failed": 0}
    today_push._notice_sweep(db_session, now, None, counts)
    today_push._notice_sweep(db_session, now, None, counts)
    assert counts["sent"] == 1 and len(sent) == 1


# ===== 予約メールの転送アドレス

@pytest.fixture()
def inbound_on(monkeypatch):
    monkeypatch.setattr(settings, "INBOUND_MAIL_DOMAIN", "in.example.com")
    monkeypatch.setattr(settings, "INBOUND_MAIL_SECRET", "inbound-test-secret-0123456789")


MAIL = (
    "From: 予約サイト <noreply@booking.example>\r\n"
    "To: {to}\r\n"
    "Subject: =?UTF-8?B?44GU5LqI57SE44Gu56K66KqN?=\r\n"
    "MIME-Version: 1.0\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Transfer-Encoding: 8bit\r\n\r\n"
    "ご予約ありがとうございます。\r\n予約番号: ABC12345\r\n宿泊施設: 嵐山の宿\r\n"
    "チェックイン: 2026年11月20日 15:00\r\nチェックアウト: 2026年11月21日 10:00\r\n"
)


def test_inbound_address_requires_configuration(auth_client, monkeypatch):
    client, _ = auth_client
    monkeypatch.setattr(settings, "INBOUND_MAIL_DOMAIN", "")
    _p, base = _plan(client)
    assert client.get(f"{base}/inbound-mail").json()["configured"] is False
    r = client.post(f"{base}/inbound-mail")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "inbound_mail_unavailable"
    assert client.post("/api/v1/inbound-mail", content=b"x").status_code == 404


def test_inbound_mail_creates_candidates_and_notifies(auth_client, db_session, inbound_on):
    client, owner = auth_client
    p, base = _plan(client, "京都")
    info = client.post(f"{base}/inbound-mail").json()
    address = info["address"]
    assert address.endswith("@in.example.com") and len(address.split("@")[0]) == 20
    row = db_session.query(InboundMailAddress).filter(InboundMailAddress.plan_id == uuid.UUID(p)).one()
    assert address.split("@")[0].encode() not in bytes(row.token_ciphertext)  # 平文で持たない
    raw = MAIL.format(to=address).encode("utf-8")
    assert client.post("/api/v1/inbound-mail", content=raw,
                       headers={"X-TC-Inbound-Secret": "wrong", "Content-Type": "message/rfc822"}).status_code == 403
    r = client.post("/api/v1/inbound-mail", content=raw,
                    headers={"X-TC-Inbound-Secret": "inbound-test-secret-0123456789", "Content-Type": "message/rfc822"})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "matched": 1, "jobs": 1, "skipped": 0}
    jobs = db_session.query(ImportJob).filter(ImportJob.plan_id == uuid.UUID(p)).all()
    assert len(jobs) == 1 and jobs[0].status == "review_required"
    assert db_session.query(Reservation).filter(Reservation.plan_id == uuid.UUID(p)).count() == 0  # 自動で確定しない
    n = (db_session.query(Notification)
         .filter(Notification.user_id == owner.id, Notification.type == "booking_mail").one())
    assert "読み取りました(1 件)" in n.title
    assert client.get(f"{base}/inbound-mail").json()["received_count"] == 1
    # multipart(SendGrid の raw・Mailgun の body-mime)でも受ける
    r2 = client.post("/api/v1/inbound-mail?secret=inbound-test-secret-0123456789",
                     files={"email": ("m.eml", raw, "message/rfc822")}, data={"to": address})
    assert r2.json()["jobs"] == 1
    # 作り直すと前のアドレスは使えない
    new = client.post(f"{base}/inbound-mail").json()["address"]
    assert new != address
    hdr = {"X-TC-Inbound-Secret": "inbound-test-secret-0123456789", "Content-Type": "message/rfc822"}
    r3 = client.post("/api/v1/inbound-mail", content=raw, headers=hdr)
    assert r3.json()["matched"] == 0
    assert client.delete(f"{base}/inbound-mail").json()["address"] is None


def test_inbound_mail_ignored_when_owner_lost_access(auth_client, db_session, make_user, inbound_on):
    client, owner = auth_client
    p, base = _plan(client)
    address = client.post(f"{base}/inbound-mail").json()["address"]
    row = db_session.query(InboundMailAddress).filter(InboundMailAddress.plan_id == uuid.UUID(p)).one()
    other, _ = make_user()
    row.user_id = other.id  # 旅行に参加していない人のアドレス
    db_session.commit()
    r = client.post("/api/v1/inbound-mail", content=MAIL.format(to=address).encode(),
                    headers={"X-TC-Inbound-Secret": "inbound-test-secret-0123456789"})
    assert r.json()["matched"] == 1 and r.json()["jobs"] == 0
    assert db_session.query(ImportJob).filter(ImportJob.plan_id == uuid.UUID(p)).count() == 0


def test_notification_preference_accepts_instant(db_session, make_user):
    u, _ = make_user()
    db_session.add(NotificationPreference(user_id=u.id, plan_id=None, level="all", email_digest="instant"))
    db_session.commit()
