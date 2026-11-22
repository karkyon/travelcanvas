"""[Gate② FC-064] 既読の確認: 重大な変更・集合の変更のお知らせと、メンバーごとの「確認しました」。

DOC-02 FC-064「重大変更、集合変更、B2B改訂の閲覧確認を保持」(B2B は対象外)。
"""
import uuid

from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import Notification, PlanCollaborator, PlanNoticeAck


def _as(user):
    app.dependency_overrides[get_current_user] = (
        lambda: AuthResult(user=user, is_authenticated=True, is_guest=False))


def _plan_with(client, db_session, owner, *members):
    p = client.post("/api/v1/travel-plans/", json={"title": "集合の旅"}).json()["id"]
    for user, role in members:
        db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=user.id, email=user.email, role=role,
                                        status="accepted"))
    db_session.flush()
    return p


def test_notice_reaches_members_and_keeps_who_confirmed(auth_client, make_user, db_session):
    client, owner = auth_client
    a, _ = make_user()
    b, _ = make_user()
    p = _plan_with(client, db_session, owner, (a, "viewer"), (b, "editor"))
    res = client.post(f"/api/v1/plans/{p}/notices",
                      json={"kind": "meeting_change", "title": "集合は伊勢市駅の北口 9:00 に変更", "body": "雨のため"})
    assert res.status_code == 201, res.text
    nid = res.json()["id"]
    assert res.json()["ack_count"] == 0 and res.json()["member_count"] == 2
    # メンバー 2 人に通知(出した本人には出さない)。通知の本文は題名だけ
    notes = db_session.query(Notification).filter(Notification.type == "important_notice").all()
    assert {n.user_id for n in notes} == {a.id, b.id}
    assert all("雨のため" not in (n.message or "") for n in notes)
    try:
        _as(a)
        mine = client.get(f"/api/v1/plans/{p}/notices").json()
        assert mine["items"][0]["needs_my_ack"] is True and "members" not in mine["items"][0]  # 閲覧だけの人に一覧は出さない
        r1 = client.post(f"/api/v1/plans/{p}/notices/{nid}/ack")
        r2 = client.post(f"/api/v1/plans/{p}/notices/{nid}/ack")  # 二度押しても 1 行
        assert r1.status_code == 200 and r2.status_code == 200 and r2.json()["acknowledged"] is True
    finally:
        _as(owner)
    assert db_session.query(PlanNoticeAck).filter(PlanNoticeAck.notice_id == uuid.UUID(nid)).count() == 1
    view = client.get(f"/api/v1/plans/{p}/notices").json()["items"][0]
    assert view["ack_count"] == 1 and view["member_count"] == 2
    assert [m["acknowledged"] for m in view["members"]] == [False, True]  # まだの人が先


def test_only_editors_post_and_outsiders_see_nothing(auth_client, make_user, db_session):
    client, owner = auth_client
    viewer, _ = make_user()
    stranger, _ = make_user()
    p = _plan_with(client, db_session, owner, (viewer, "viewer"))
    nid = client.post(f"/api/v1/plans/{p}/notices", json={"kind": "major_change", "title": "2 日目を取りやめ"}).json()["id"]
    try:
        _as(viewer)
        assert client.post(f"/api/v1/plans/{p}/notices", json={"kind": "major_change", "title": "x"}).status_code == 403
        _as(stranger)
        assert client.get(f"/api/v1/plans/{p}/notices").status_code in (403, 404)
        assert client.post(f"/api/v1/plans/{p}/notices/{nid}/ack").status_code in (403, 404)
    finally:
        _as(owner)
    assert client.post(f"/api/v1/plans/{p}/notices", json={"kind": "other", "title": "x"}).status_code == 422
