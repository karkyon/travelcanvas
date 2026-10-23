"""[Gate G4] COL-05 Guest Travel View(確認・一時トークン・複製)/ FC-097 濫用(通報・自動の失効・自動の検知・管理者の対応)。"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import admin as admin_api
from app.api.v1 import public_share as public_api
from app.api.v1 import share as share_api
from app.core.config import settings
from app.models.models import (
    AbuseReport, Notification, PlanShareLink, ShareAccessLog, TravelDay, TravelEvent, TravelPlan,
)
from app.services import abuse, share_view

from tests.test_gate_c2_candidates_places import _act_as
from tests.test_gate_f45_share_policy import CONF, _seed


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    for mod in (public_api, share_api, admin_api):
        monkeypatch.setattr(mod, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(public_api, "check_rate_limit", lambda *a, **kw: True)


def _token(url):
    return url.rsplit("/", 1)[-1]


def _share(client, plan_id, **body):
    r = client.post(f"/api/v1/travel-plans/{plan_id}/share", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_info_does_not_consume_and_view_token_does_not_consume(auth_client, db_session):
    client, _owner = auth_client
    plan_id = _seed(client)
    sh = _share(client, plan_id, max_uses=2, passcode="あいことば1")
    tok = _token(sh["url"])
    info = client.get(f"/api/v1/public/share/{tok}/info")
    assert info.status_code == 200 and info.headers["cache-control"] == "no-store"
    body = info.json()
    assert body["needs_passcode"] and body["remaining_uses"] == 2 and body["allow_clone"] is False
    assert "清水寺" not in info.text and "F45共有" not in info.text  # 中身を返さない
    assert any(x["key"] == "event_times" for x in body["policy_explained"]["shown"])
    assert "予約番号・PIN" in body["policy_explained"]["never"]
    for _ in range(3):
        client.get(f"/api/v1/public/share/{tok}/info")
    assert client.post(f"/api/v1/public/share/{tok}/resolve", json={"passcode": "ちがう"}).status_code == 401
    r = client.post(f"/api/v1/public/share/{tok}/resolve", json={"passcode": "あいことば1"})
    assert r.status_code == 200 and r.json()["view_token"]
    vt = r.json()["view_token"]
    db_session.expire_all()
    assert db_session.query(PlanShareLink).filter(PlanShareLink.id == uuid.UUID(sh["id"])).one().use_count == 1
    for _ in range(4):
        v = client.get(f"/api/v1/public/share/{tok}/view", headers={"X-Share-View": vt})
        assert v.status_code == 200 and v.json()["days"][0]["events"][0]["title"] == "清水寺"
        assert CONF not in v.text and "34.99" not in v.text
    db_session.expire_all()
    assert db_session.query(PlanShareLink).filter(PlanShareLink.id == uuid.UUID(sh["id"])).one().use_count == 1
    assert client.get(f"/api/v1/public/share/{tok}/view").status_code == 401
    assert client.get(f"/api/v1/public/share/{tok}/view", headers={"X-Share-View": vt + "x"}).status_code == 401
    # 合言葉を変えると一時トークンは使えない
    upd = client.put(f"/api/v1/travel-plans/{plan_id}/share/{sh['id']}", json={"passcode": "あたらしい2"})
    assert upd.status_code == 200
    assert client.get(f"/api/v1/public/share/{tok}/view", headers={"X-Share-View": vt}).status_code == 401
    # 失効したら info も view も 404
    r = client.post(f"/api/v1/public/share/{tok}/resolve", json={"passcode": "あたらしい2"})
    vt2 = r.json()["view_token"]
    client.post(f"/api/v1/travel-plans/{plan_id}/share/{sh['id']}/revoke")
    assert client.get(f"/api/v1/public/share/{tok}/info").status_code == 404
    assert client.get(f"/api/v1/public/share/{tok}/view", headers={"X-Share-View": vt2}).status_code == 404
    listed = client.get(f"/api/v1/travel-plans/{plan_id}/share").json()[0]
    assert listed["revoked_reason"] == "owner"


def test_view_token_expiry_and_binding():
    s1 = PlanShareLink(id=uuid.uuid4(), token_hash="a" * 64, passcode_hash=None)
    s2 = PlanShareLink(id=uuid.uuid4(), token_hash="b" * 64, passcode_hash=None)
    t = share_view.issue(s1, now=1000.0)["view_token"]
    share_view.verify(t, s1, now=1001.0)
    with pytest.raises(share_view.ViewTokenError):
        share_view.verify(t, s2, now=1001.0)
    with pytest.raises(share_view.ViewTokenError):
        share_view.verify(t, s1, now=1000.0 + settings.SHARE_VIEW_TTL_SECONDS + 1)


def test_clone_copies_only_allowed_fields(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id = _seed(client)
    no = _share(client, plan_id)
    tok = _token(no["url"])
    vt = client.post(f"/api/v1/public/share/{tok}/resolve", json={}).json()["view_token"]
    assert client.post(f"/api/v1/public/share/{tok}/clone", json={},
                       headers={"X-Share-View": vt}).json()["detail"]["code"] == "clone_not_allowed"
    sh = _share(client, plan_id, preset="minimal", allow_clone=True)
    assert sh["allow_clone"] is True
    tok = _token(sh["url"])
    vt = client.post(f"/api/v1/public/share/{tok}/resolve", json={}).json()["view_token"]
    other, _ = make_user()
    _act_as(other)
    try:
        assert client.post(f"/api/v1/public/share/{tok}/clone", json={}).status_code == 401
        r = client.post(f"/api/v1/public/share/{tok}/clone", json={"title": "まねる旅"}, headers={"X-Share-View": vt})
        assert r.status_code == 201, r.text
    finally:
        _act_as(owner)
    new_id = uuid.UUID(r.json()["plan_id"])
    new = db_session.query(TravelPlan).filter(TravelPlan.id == new_id).one()
    assert new.user_id == other.id and new.title == "まねる旅" and new.description is None
    ev = db_session.query(TravelEvent).filter(TravelEvent.plan_id == new_id).one()
    assert ev.title == "清水寺" and ev.local_start_time is None and ev.address is None and ev.description is None
    assert ev.latitude is None and ev.place_id is None
    day = db_session.query(TravelDay).filter(TravelDay.plan_id == new_id).one()
    assert day.title is None
    from app.models.models import Reservation
    assert db_session.query(Reservation).filter(Reservation.plan_id == new_id).count() == 0
    # 標準の項目なら時刻と見出しも写る
    sh2 = _share(client, plan_id, allow_clone=True)
    tok2 = _token(sh2["url"])
    vt2 = client.post(f"/api/v1/public/share/{tok2}/resolve", json={}).json()["view_token"]
    r2 = client.post(f"/api/v1/public/share/{tok2}/clone", json={}, headers={"X-Share-View": vt2})
    ev2 = db_session.query(TravelEvent).filter(TravelEvent.plan_id == uuid.UUID(r2.json()["plan_id"])).one()
    assert ev2.local_start_time == "10:00" and ev2.address is None


def test_reports_auto_revoke_and_admin_actions(auth_client, db_session, monkeypatch):
    client, owner = auth_client
    plan_id = _seed(client)
    sh = _share(client, plan_id)
    tok = _token(sh["url"])
    # 無効なリンクでも同じ応答
    assert client.post("/api/v1/public/share/nonexistent-token/report", json={"reason": "spam"}).status_code == 202
    assert client.post(f"/api/v1/public/share/{tok}/report", json={"reason": "bogus"}).status_code == 422
    assert client.post(f"/api/v1/public/share/{tok}/report", json={"reason": "phishing", "note": "ログインを求める"}
                       ).status_code == 202
    share = db_session.query(PlanShareLink).filter(PlanShareLink.id == uuid.UUID(sh["id"])).one()
    # 同じ人(接続元)が何回送っても1人
    abuse.file_report(db_session, share, "phishing", None, "testclient")
    db_session.refresh(share)
    assert share.revoked_at is None
    abuse.file_report(db_session, share, "malware", None, "10.0.0.2")
    db_session.refresh(share)
    assert share.revoked_at is None
    res = abuse.file_report(db_session, share, "phishing", None, "10.0.0.3")
    db_session.refresh(share)
    assert res["auto_revoked"] and share.revoked_reason == "abuse_auto"
    assert db_session.query(Notification).filter(Notification.user_id == owner.id,
                                                 Notification.type == "share_revoked_abuse").count() == 1
    assert client.get(f"/api/v1/public/share/{tok}/info").status_code == 404
    rows = db_session.query(AbuseReport).filter(AbuseReport.share_id == share.id).all()
    assert all(r.reporter_hash != "testclient" for r in rows)  # 接続元をそのまま残さない

    # 管理者
    assert client.get("/api/v1/admin/abuse").status_code == 403
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    owner.user_type = "admin"
    db_session.flush()
    lst = client.get("/api/v1/admin/abuse", params={"status": "all"}).json()
    assert lst["counts"]["open"] >= 4 and lst["reports"][0]["share"]["revoked_reason"] == "abuse_auto"
    assert CONF not in str(lst)
    rid = next(r["id"] for r in lst["reports"] if r["status"] == "open")
    r = client.post(f"/api/v1/admin/abuse/{rid}/action", json={"action": "restore_share", "note": "誤報"})
    assert r.status_code == 200, r.text
    db_session.refresh(share)
    assert share.revoked_at is None
    r = client.post(f"/api/v1/admin/abuse/{rid}/action", json={"action": "revoke_share"})
    db_session.refresh(share)
    assert r.status_code == 200 and share.revoked_reason == "admin_abuse"
    assert client.post(f"/api/v1/admin/abuse/{rid}/action", json={"action": "nuke"}).status_code == 422
    assert client.post(f"/api/v1/admin/abuse/{uuid.uuid4()}/action", json={"action": "dismiss"}).status_code == 404
    # 所有者が自分で失効させても、理由は管理者の物のまま
    client.post(f"/api/v1/travel-plans/{plan_id}/share/{sh['id']}/revoke")
    db_session.refresh(share)
    assert share.revoked_reason == "admin_abuse"


def test_scan_detects_scraping_bruteforce_spam(auth_client, db_session):
    client, owner = auth_client
    plan_id = _seed(client)
    sh = _share(client, plan_id)
    sid = uuid.UUID(sh["id"])
    now = datetime.now(timezone.utc)
    for i in range(abuse.SCRAPING_IPS):
        db_session.add(ShareAccessLog(share_id=sid, token_hash="x", ip_address="10.1.%d.%d" % (i // 250, i % 250),
                                      result="success"))
    for _ in range(abuse.PASSCODE_FAILS):
        db_session.add(ShareAccessLog(share_id=sid, token_hash="x", ip_address="10.9.9.9", result="passcode_failed"))
    for _ in range(abuse.SPAM_SHARES):
        db_session.add(PlanShareLink(id=uuid.uuid4(), plan_id=uuid.UUID(plan_id), token_hash=uuid.uuid4().hex,
                                     token_prefix="spam0000"))
    db_session.commit()
    out = abuse.scan(db_session, now=now + timedelta(seconds=1))
    assert out["scraping"] == 1 and out["passcode_bruteforce"] == 1 and out["spam"] == 1
    again = abuse.scan(db_session, now=now + timedelta(seconds=2))
    assert again == {"scraping": 0, "passcode_bruteforce": 0, "spam": 0, "malware": 0}  # 24時間に1回


def test_cron_runs_g4_jobs():
    from app.ops import opslib, cli

    block = opslib.render_cron_block("/home/x/tc")
    for job in ("poll-deadlines", "email-outbox", "abuse-scan"):
        assert "jobs %s" % job in block and job in cli.JOBS
