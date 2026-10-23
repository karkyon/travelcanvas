"""[Gate G4] COL-02 合意の決定(定足数・同点・締切・採用・元に戻す)/ COL-03 対象ごとのコメントと通知の設定・まとめ・メールの再送。"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import decisions as decisions_api  # noqa: F401 - 経路の登録
from app.api.v1 import discussion as discussion_api
from app.api.v1 import candidates as candidates_api
from app.api.v1 import notifications as notifications_api
from app.core.config import settings
from app.models.models import (
    EmailOutbox, Notification, NotificationPreference, PlanCandidate, Poll, TravelEvent, User,
)
from app.services import consensus, notify, poll_deadlines

from tests.test_gate_p3_discussion import _act_as, _group, _opt, _poll, _vote


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(discussion_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(candidates_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(notifications_api, "record_audit_event", lambda **kw: None)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _patch(client, p, poll, body):
    return client.patch(f"/api/v1/plans/{p}/polls/{poll['id']}", json=body, headers={"If-Match": str(poll["revision"])})


# ---------------------------------------------------------------- 単体

def test_phase_tie_and_quorum():
    st = {"a": {"state": "agreed", "score": 3, "responders": {1}},
          "b": {"state": "agreed", "score": 3, "responders": {2}},
          "c": {"state": "blocked", "score": 9, "responders": {3}}}
    assert consensus.tied_leaders(st, ["a", "b", "c"]) == ["a", "b"]
    st["b"]["score"] = 1
    assert consensus.tied_leaders(st, ["a", "b", "c"]) == []
    assert consensus.phase(False, None, False, 1, 3) == "voting"
    assert consensus.phase(True, None, False, 1, 3) == "no_quorum"
    assert consensus.phase(True, None, False, 3, 3) == "closed"
    assert consensus.phase(True, "a", False, 3, None) == "decided"
    assert consensus.phase(True, "a", True, 3, None) == "adopted"


# ---------------------------------------------------------------- COL-02

def test_quorum_tie_and_decision_lock(auth_client, make_user, db_session):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    poll = _poll(client, p, quorum=2).json()
    assert poll["quorum"] == 2 and poll["phase"] == "voting"
    _vote(client, p, poll, [{"option_id": _opt(poll, "寿司")["id"], "value": "love"},
                            {"option_id": _opt(poll, "焼肉")["id"], "value": "love"}])
    poll = client.get(f"/api/v1/plans/{p}/polls/{poll['id']}").json()
    assert len(poll["tied_option_ids"]) == 2 and poll["quorum_met"] is False
    r = _patch(client, p, poll, {"decided_option_id": _opt(poll, "寿司")["id"]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "quorum_not_met"
    _act_as(viewer)
    try:
        _vote(client, p, poll, [{"option_id": _opt(poll, "寿司")["id"], "value": "ok"}])
    finally:
        _act_as(owner)
    poll = client.get(f"/api/v1/plans/{p}/polls/{poll['id']}").json()
    assert poll["quorum_met"] is True and poll["tied_option_ids"] == []
    r = _patch(client, p, poll, {"decided_option_id": _opt(poll, "寿司")["id"]})
    assert r.status_code == 200, r.text
    poll = r.json()
    assert poll["phase"] == "decided" and poll["closed_reason"] == "decided" and poll["can_adopt"] is True
    # 決定の後は回答できない
    assert _vote(client, p, poll, [{"option_id": _opt(poll, "焼肉")["id"], "value": "ok"}]).status_code == 409
    # 採用(名前だけの選択肢: 旅程は変えない)
    rev = _rev(client, p)
    pv = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adoption-preview", json={}).json()
    assert pv["kind"] == "record_only" and pv["can_adopt"] and pv["problems"] == []
    a = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt", json={}, headers={"If-Match": str(rev)})
    assert a.status_code == 200, a.text
    assert a.json()["poll"]["phase"] == "adopted" and a.json()["plan_revision"] == rev
    poll = a.json()["poll"]
    for body in ({"status": "open"}, {"decided_option_id": None}):
        r = _patch(client, p, poll, body)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "poll_adopted"
    assert client.delete(f"/api/v1/plans/{p}/polls/{poll['id']}",
                         headers={"If-Match": str(poll["revision"])}).status_code == 409
    # viewer は採用できない
    _act_as(viewer)
    try:
        assert client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt/undo", json={},
                           headers={"If-Match": str(rev)}).status_code == 403
    finally:
        _act_as(owner)
    u = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt/undo", headers={"If-Match": str(rev)})
    assert u.status_code == 200, u.text
    assert u.json()["poll"]["phase"] == "decided"


def test_adopt_candidate_option_and_remove_others_with_undo(auth_client, make_user, db_session):
    client, p, owner, _others = _group(auth_client, make_user, db_session, roles=())
    day = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-03", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()
    ev_a = client.post(f"/api/v1/plans/{p}/events", json={"day_id": day["id"], "title": "案A"}, headers=_ik()).json()
    cid = client.post(f"/api/v1/plans/{p}/candidates", json={"title": "錦市場"}).json()["id"]
    bad = _poll(client, p, options=[{"candidate_id": cid}, {"candidate_id": cid}])
    assert bad.status_code == 422
    assert _poll(client, p, options=[{"candidate_id": cid, "event_id": ev_a["id"]}]).status_code == 422
    poll = _poll(client, p, options=[{"candidate_id": cid}, {"event_id": ev_a["id"]}]).json()
    assert _opt(poll, "錦市場")["candidate_id"] == cid
    _vote(client, p, poll, [{"option_id": _opt(poll, "錦市場")["id"], "value": "love"}])
    poll = _patch(client, p, poll, {"decided_option_id": _opt(poll, "錦市場")["id"]}).json()
    pv = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adoption-preview", json={"remove_others": True}).json()
    assert pv["can_adopt"] is False and pv["problems"][0]["code"] == "day_required"
    body = {"day_id": day["id"], "local_start_time": "10:00", "remove_others": True}
    pv = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adoption-preview", json=body).json()
    assert pv["can_adopt"] and any("案A" in e for e in pv["effects"]) and any("錦市場" in e for e in pv["effects"])
    rev = _rev(client, p)
    assert client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt", json=body,
                       headers={"If-Match": str(rev - 1)}).status_code == 409
    a = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt", json=body, headers={"If-Match": str(rev)})
    assert a.status_code == 200, a.text
    titles = sorted(e.title for e in db_session.query(TravelEvent).filter(TravelEvent.plan_id == uuid.UUID(p)).all())
    assert titles == ["錦市場"]
    assert db_session.query(PlanCandidate).filter(PlanCandidate.id == uuid.UUID(cid)).one().status == "scheduled"
    again = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt", json=body,
                        headers={"If-Match": str(a.json()["plan_revision"])})
    assert again.json()["detail"]["code"] == "already_adopted"
    u = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt/undo",
                    headers={"If-Match": str(a.json()["plan_revision"])})
    assert u.status_code == 200, u.text
    db_session.expire_all()
    titles = sorted(e.title for e in db_session.query(TravelEvent).filter(TravelEvent.plan_id == uuid.UUID(p)).all())
    assert titles == ["案A"]
    cands = client.get(f"/api/v1/plans/{p}/candidates").json()["items"]
    assert next(c for c in cands if c["id"] == cid)["status"] == "open"


def test_adoption_undo_refused_after_later_change(auth_client, make_user, db_session):
    client, p, owner, _ = _group(auth_client, make_user, db_session, roles=())
    day = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-03", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()
    ev_a = client.post(f"/api/v1/plans/{p}/events", json={"day_id": day["id"], "title": "案A"}, headers=_ik()).json()
    ev_b = client.post(f"/api/v1/plans/{p}/events", json={"day_id": day["id"], "title": "案B"}, headers=_ik()).json()
    poll = _poll(client, p, options=[{"event_id": ev_a["id"]}, {"event_id": ev_b["id"]}]).json()
    _vote(client, p, poll, [{"option_id": _opt(poll, "案A")["id"], "value": "love"}])
    poll = _patch(client, p, poll, {"decided_option_id": _opt(poll, "案A")["id"]}).json()
    rev = _rev(client, p)
    a = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt", json={"remove_others": True},
                    headers={"If-Match": str(rev)})
    assert a.status_code == 200, a.text
    rev = a.json()["plan_revision"]
    client.post(f"/api/v1/plans/{p}/events", json={"day_id": day["id"], "title": "後で足した"}, headers=_ik())
    rev = _rev(client, p)
    u = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/adopt/undo", headers={"If-Match": str(rev)})
    assert u.status_code == 409 and u.json()["detail"]["code"] == "undo_not_latest"


def test_deadline_sweep_reminds_then_closes(auth_client, make_user, db_session):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    soon = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    poll = _poll(client, p, deadline_at=soon, quorum=3).json()
    _vote(client, p, poll, [{"option_id": _opt(poll, "寿司")["id"], "value": "love"}])
    db_session.query(Notification).delete()
    db_session.commit()
    r = poll_deadlines.sweep(db_session)
    assert r["reminded"] == 2 and r["closed"] == 0  # 回答していない2人
    assert poll_deadlines.sweep(db_session)["reminded"] == 0  # 1回だけ
    later = datetime.now(timezone.utc) + timedelta(hours=3)
    r = poll_deadlines.sweep(db_session, now=later)
    assert r["closed"] == 1 and r["notified"] == 3
    db_session.expire_all()
    pl = db_session.query(Poll).filter(Poll.id == uuid.UUID(poll["id"])).one()
    assert pl.status == "closed" and pl.closed_reason == "deadline"
    n = db_session.query(Notification).filter(Notification.type == "poll_closed").first()
    assert "定足数" in n.message and n.target_type == "poll"


# ---------------------------------------------------------------- COL-03

def test_comment_notifications_follow_preferences_and_target_visibility(auth_client, make_user, db_session):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    # viewer には費用を隠す
    mp = client.put(f"/api/v1/plans/{p}/member-policy", json={"roles": {"viewer": ["costs"]}},
                    headers={"If-Match": str(_rev(client, p))})
    assert mp.status_code == 200, mp.text
    day = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-03", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()
    ev = client.post(f"/api/v1/plans/{p}/events", json={"day_id": day["id"], "title": "清水寺"}, headers=_ik()).json()
    # editor は自分あてだけ
    _act_as(editor)
    try:
        assert client.put("/api/v1/notifications/settings", json={"level": "mentions"}).status_code == 200
    finally:
        _act_as(owner)
    db_session.query(Notification).delete()
    db_session.commit()
    c = client.post(f"/api/v1/plans/{p}/comments", json={"target_type": "event", "target_id": ev["id"],
                                                         "body": "朝早めに", "mentions": [str(viewer.id)]})
    assert c.status_code == 201, c.text
    n = db_session.query(Notification).filter(Notification.user_id == viewer.id).one()
    assert n.type == "comment_mention" and n.target_type == "event" and str(n.target_id) == ev["id"]
    assert "朝早め" not in (n.message or "")
    # 返信は返信先を書いた人へ
    _act_as(editor)
    try:
        r = client.post(f"/api/v1/plans/{p}/comments", json={"target_type": "event", "target_id": ev["id"],
                                                             "body": "了解", "parent_id": c.json()["id"]})
        assert r.status_code == 201
        lst = client.get("/api/v1/notifications/").json()
        assert lst == []  # editor は mentions のみ。自分あてが無い
    finally:
        _act_as(owner)
    mine = client.get("/api/v1/notifications/").json()
    reply = next(x for x in mine if x["type"] == "comment_reply")
    assert reply["link"] == f"/planner/{p}/discussion?target=event&id={ev['id']}"
    dg = client.get("/api/v1/notifications/digest").json()
    assert dg["total"] >= 1 and dg["groups"][0]["plan_id"] == p
    # 費用を見られない人はメンションできない
    exp = client.post(f"/api/v1/plans/{p}/expenses", json={"title": "夕食", "amount": "3000", "currency": "JPY",
                                                           "paid_by_user_id": str(owner.id)}, headers=_ik())
    assert exp.status_code == 201, exp.text
    r = client.post(f"/api/v1/plans/{p}/comments", json={"target_type": "expense", "target_id": exp.json()["id"],
                                                         "body": "高い", "mentions": [str(viewer.id)]})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "mention_target_hidden"
    # 旅行ごとの設定 none は作らない
    _act_as(viewer)
    try:
        assert client.put(f"/api/v1/notifications/settings/plans/{p}", json={"level": "none"}).status_code == 200
        st = client.get("/api/v1/notifications/settings").json()
        assert st["plans"][0]["level"] == "none" and st["email_available"] in (True, False)
    finally:
        _act_as(owner)
    before = db_session.query(Notification).filter(Notification.user_id == viewer.id).count()
    client.post(f"/api/v1/plans/{p}/comments", json={"target_type": "event", "target_id": ev["id"], "body": "x",
                                                     "mentions": [str(viewer.id)]})
    assert db_session.query(Notification).filter(Notification.user_id == viewer.id).count() == before


def test_digest_and_outbox_retry(db_session, make_user, monkeypatch):
    user, _ = make_user()
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.test")
    monkeypatch.setattr(settings, "EMAIL_FROM", "noreply@example.test")
    db_session.add(NotificationPreference(user_id=user.id, plan_id=None, level="all", email_digest="daily"))
    db_session.add(Notification(id=uuid.uuid4(), user_id=user.id, type="info", title="t", message="m"))
    db_session.commit()
    r = notify.build_digests(db_session)
    assert r["queued"] >= 1
    assert notify.build_digests(db_session)["queued"] == 0  # 1日1回
    row = db_session.query(EmailOutbox).filter(EmailOutbox.user_id == user.id).one()
    assert "1 件" in row.subject and "m" not in row.body.replace("メール", "")
    calls = []

    def failing(to, subject, body):
        calls.append(to)
        raise OSError("down")

    now = datetime.now(timezone.utc)
    res = notify.deliver_outbox(db_session, now=now, send=failing)
    assert res["failed"] >= 1
    db_session.refresh(row)
    assert row.status == "failed" and row.attempts == 1 and row.next_attempt_at > now
    assert notify.deliver_outbox(db_session, now=now, send=failing)["attempted"] == 0  # 間を空ける
    sent = []
    res = notify.deliver_outbox(db_session, now=now + timedelta(hours=7), send=lambda t, s, b: sent.append(t))
    db_session.refresh(row)
    assert row.status == "sent" and sent == [user.email]
    # 上限で dead
    row2 = EmailOutbox(user_id=user.id, kind="digest", subject="s", body="b", attempts=notify.MAX_ATTEMPTS - 1)
    db_session.add(row2)
    db_session.commit()
    notify.deliver_outbox(db_session, now=now + timedelta(days=1), send=failing)
    db_session.refresh(row2)
    assert row2.status == "dead"
    assert notify.backoff(1) == timedelta(minutes=5) and notify.backoff(20) == timedelta(hours=6)


def test_email_digest_requires_email_configuration(auth_client, monkeypatch):
    client, owner = auth_client
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    r = client.put("/api/v1/notifications/settings", json={"email_digest": "daily"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "email_unavailable"
    assert notify.build_digests.__doc__
    assert User  # noqa
