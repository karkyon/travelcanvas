"""
[Gate P3] FR-022 合意形成(投票・懸念) / FR-024 コメント・メンション通知の統合テスト(実PostgreSQL)。

検証する主な性質:
- 選択肢ごとに Love/OK/懸念/不可/棄権。懸念・不可は理由必須、block_with_alternative では不可に代替案必須
- 合意状態: 未回答(pending)・不可で不成立(blocked)・懸念あり・合意(agreed)、未回答者の可視化、最有力の選択肢
- 懸念・不可の解決(本人か編集者)、回答を変えると解決は外れる。advisory では不可でも不成立にしない
- 締切後は回答できない。決定は不成立の選択肢にできない
- 匿名の投票は3人未満の間は件数を出さず、他人のLove/OK/棄権を個別に出さない
- コメント: 対象・返信・メンション通知(本文を含めない)・機密らしき文字列の警告・編集/解決/削除の権限・削除後のスレッド
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.api.v1 import discussion as discussion_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import Comment, Notification, PlanCollaborator, Poll, Vote
from app.services import consensus


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(discussion_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _group(auth_client, make_user, db_session, roles=("editor", "viewer")):
    client, owner = auth_client
    res = client.post("/api/v1/travel-plans/", json={"title": "相談テスト旅行"})
    p = res.json()["id"]
    others = []
    for role in roles:
        u, _ = make_user()
        db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=u.id, email=u.email, role=role,
                                        status="accepted"))
        others.append(u)
    db_session.commit()
    return client, p, owner, others


def _poll(client, p, **body):
    payload = {"title": "2日目の夕食", "options": [{"label": "寿司"}, {"label": "焼肉"}]}
    payload.update(body)
    return client.post(f"/api/v1/plans/{p}/polls", json=payload)


def _vote(client, p, poll, answers):
    return client.put(f"/api/v1/plans/{p}/polls/{poll['id']}/votes", json={"votes": answers})


def _opt(poll, label):
    return next(o for o in poll["options"] if o["label"] == label)


# ---------------------------------------------------------------- 集計(単体)

def test_option_state_rules():
    members = {"a", "b", "c"}
    V = consensus.VoteView
    assert consensus.option_state([V("a", "love", False)], members, "block", False)["state"] == "pending"
    st = consensus.option_state([V("a", "love", False), V("b", "ok", False), V("c", "veto", False)], members,
                                "block", False)
    assert st["state"] == "blocked" and st["unresolved_vetoes"] == 1
    st = consensus.option_state([V("a", "love", False), V("b", "ok", False), V("c", "veto", True)], members,
                                "block", False)
    assert st["state"] == "agreed"
    st = consensus.option_state([V("a", "love", False), V("b", "ok", False), V("c", "veto", False)], members,
                                "advisory", False)
    assert st["state"] == "has_concerns" and st["score"] == 1
    st = consensus.option_state([V("a", "love", False), V("b", "concern", False)], members, "block", True)
    assert st["state"] == "has_concerns" and st["unanswered"] == {"c"}
    assert consensus.option_state([], members, "block", True)["state"] == "pending"


# ---------------------------------------------------------------- 投票

def test_poll_lifecycle_consensus_and_notifications(auth_client, make_user, db_session, audit_calls):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    res = _poll(client, p, description="候補から選ぶ")
    assert res.status_code == 201, res.text
    poll = res.json()
    assert poll["state"] == "voting" and poll["veto_policy"] == "block" and poll["can_manage"] is True
    assert {u["user_id"] for u in poll["unanswered"]} == {str(owner.id), str(editor.id), str(viewer.id)}
    notes = db_session.query(Notification).filter(Notification.type == "poll_created").all()
    assert {n.user_id for n in notes} == {editor.id, viewer.id}
    assert "2日目の夕食" not in repr(audit_calls)

    sushi, yakiniku = _opt(poll, "寿司")["id"], _opt(poll, "焼肉")["id"]
    first = [{"option_id": sushi, "value": "love"}, {"option_id": yakiniku, "value": "ok"}]
    assert _vote(client, p, poll, first).status_code == 200
    _act_as(editor)
    assert _vote(client, p, poll, [{"option_id": sushi, "value": "ok"},
                                   {"option_id": yakiniku, "value": "concern"}]).status_code == 422  # 理由なし
    _vote(client, p, poll, [{"option_id": sushi, "value": "ok"},
                            {"option_id": yakiniku, "value": "concern", "reason": "前日も焼肉"}])
    _act_as(viewer)
    res = _vote(client, p, poll, [{"option_id": sushi, "value": "veto", "reason": "生魚が苦手"},
                                  {"option_id": yakiniku, "value": "love"}])
    assert res.status_code == 200, res.text
    body = res.json()
    assert _opt(body, "寿司")["state"] == "blocked" and _opt(body, "焼肉")["state"] == "has_concerns"
    assert _opt(body, "焼肉")["is_leading"] is True and body["unanswered"] == []
    assert body["can_manage"] is False and _opt(body, "寿司")["my_vote"] == "veto"

    # 決定は不成立の選択肢にできない
    _act_as(owner)
    assert client.patch(f"/api/v1/plans/{p}/polls/{poll['id']}", json={"decided_option_id": sushi},
                        headers={"If-Match": "1"}).status_code == 409
    # 懸念を解決(編集者=所有者)→ 焼肉は合意
    concern = next(v for v in _opt(body, "焼肉")["votes"] if v["value"] == "concern")
    res = client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/votes/{concern['id']}/resolution",
                      json={"resolved": True, "note": "前日は和食に変更"})
    assert res.status_code == 200
    yak = _opt(res.json(), "焼肉")
    assert yak["state"] == "agreed" and res.json()["state"] == "agreed"
    assert next(v for v in yak["votes"] if v["value"] == "concern")["resolution_note"] == "前日は和食に変更"
    res = client.patch(f"/api/v1/plans/{p}/polls/{poll['id']}", json={"decided_option_id": yakiniku},
                       headers={"If-Match": "1"})
    assert res.status_code == 200 and res.json()["state"] == "decided" and res.json()["status"] == "closed"
    assert _opt(res.json(), "焼肉")["is_decided"] is True
    # 締切後は回答できない
    assert _vote(client, p, poll, [{"option_id": sushi, "value": "ok"}]).status_code == 409


def test_resolution_permissions_and_reset_on_change(auth_client, make_user, db_session):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    poll = _poll(client, p).json()
    sushi = _opt(poll, "寿司")["id"]
    _act_as(viewer)
    body = _vote(client, p, poll, [{"option_id": sushi, "value": "concern", "reason": "高い"}]).json()
    vote_id = _opt(body, "寿司")["votes"][0]["id"]
    _act_as(editor)
    assert client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/votes/{vote_id}/resolution",
                       json={"resolved": True}).status_code == 200
    _act_as(viewer)
    # 理由を変えると解決は外れる
    body = _vote(client, p, poll, [{"option_id": sushi, "value": "concern", "reason": "かなり高い"}]).json()
    assert _opt(body, "寿司")["votes"][0]["is_resolved"] is False
    # 本人も解決できる。Love/OKには解決を記録できない
    assert client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/votes/{vote_id}/resolution",
                       json={"resolved": True}).status_code == 200
    _act_as(owner)
    body = _vote(client, p, poll, [{"option_id": sushi, "value": "love"}]).json()
    love_id = next(v["id"] for v in _opt(body, "寿司")["votes"] if v["value"] == "love")
    assert client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/votes/{love_id}/resolution",
                       json={"resolved": True}).status_code == 422
    other, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=other.id, email=other.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    _act_as(other)
    assert client.post(f"/api/v1/plans/{p}/polls/{poll['id']}/votes/{vote_id}/resolution",
                       json={"resolved": False}).status_code == 403


def test_veto_policies(auth_client, make_user, db_session):
    client, p, owner, (editor,) = _group(auth_client, make_user, db_session, roles=("editor",))
    strict = _poll(client, p, veto_policy="block_with_alternative").json()
    sushi = _opt(strict, "寿司")["id"]
    assert _vote(client, p, strict, [{"option_id": sushi, "value": "veto", "reason": "苦手"}]).status_code == 422
    assert _vote(client, p, strict, [{"option_id": sushi, "value": "veto", "reason": "苦手",
                                      "alternative": "天ぷら"}]).status_code == 200
    advisory = _poll(client, p, title="参考", veto_policy="advisory").json()
    a_sushi = _opt(advisory, "寿司")["id"]
    _vote(client, p, advisory, [{"option_id": a_sushi, "value": "veto", "reason": "苦手"}])
    _act_as(editor)
    body = _vote(client, p, advisory, [{"option_id": a_sushi, "value": "love"}]).json()
    assert _opt(body, "寿司")["state"] == "has_concerns"
    assert _poll(client, p, veto_policy="anything").status_code == 422


def test_poll_validation_and_permissions(auth_client, make_user, db_session):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    assert _poll(client, p, options=[]).status_code == 422
    assert _poll(client, p, options=[{"label": "a"}, {"label": "a"}]).status_code == 422
    assert _poll(client, p, options=[{"label": str(i)} for i in range(11)]).status_code == 422
    assert _poll(client, p, options=[{"event_id": str(uuid.uuid4())}]).status_code == 422
    assert _poll(client, p, deadline_at="2026-11-01T10:00:00").status_code == 422
    d = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                    headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    ev = client.post(f"/api/v1/plans/{p}/events", json={"day_id": d["id"], "title": "金閣寺"},
                     headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    poll = _poll(client, p, options=[{"event_id": ev["id"]}, {"label": "銀閣寺"}]).json()
    assert _opt(poll, "金閣寺")["event_label"] == "金閣寺"
    _act_as(viewer)
    assert _poll(client, p).status_code == 403
    assert client.patch(f"/api/v1/plans/{p}/polls/{poll['id']}", json={"status": "closed"},
                        headers={"If-Match": "1"}).status_code == 403
    _act_as(owner)
    assert client.patch(f"/api/v1/plans/{p}/polls/{poll['id']}", json={"status": "closed"}).status_code == 428
    res = client.patch(f"/api/v1/plans/{p}/polls/{poll['id']}", json={"status": "closed"}, headers={"If-Match": "1"})
    assert res.status_code == 200 and res.json()["is_closed"] is True
    res = client.patch(f"/api/v1/plans/{p}/polls/{poll['id']}", json={"status": "open"}, headers={"If-Match": "2"})
    assert res.json()["is_closed"] is False
    assert client.delete(f"/api/v1/plans/{p}/polls/{poll['id']}", headers={"If-Match": "3"}).status_code == 200
    assert client.get(f"/api/v1/plans/{p}/polls/{poll['id']}").status_code == 404


def test_deadline_closes_voting(auth_client, make_user, db_session):
    client, p, owner, _ = _group(auth_client, make_user, db_session, roles=())
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    poll = _poll(client, p, deadline_at=past).json()
    assert poll["is_closed"] is True and poll["status"] == "open"
    assert _vote(client, p, poll, [{"option_id": _opt(poll, "寿司")["id"], "value": "ok"}]).status_code == 409


def test_anonymous_poll_hides_individuals_until_threshold(auth_client, make_user, db_session):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    poll = _poll(client, p, is_anonymous=True).json()
    sushi = _opt(poll, "寿司")["id"]
    _vote(client, p, poll, [{"option_id": sushi, "value": "love"}])
    _act_as(editor)
    body = _vote(client, p, poll, [{"option_id": sushi, "value": "concern", "reason": "予算"}]).json()
    opt = _opt(body, "寿司")
    assert body["counts_hidden"] is True and opt["counts"] is None and opt["score"] is None
    assert [v["value"] for v in opt["votes"]] == ["concern"]  # 自分の懸念だけ
    assert opt["votes"][0]["is_mine"] is True and opt["votes"][0]["name"] is not None
    _act_as(owner)
    owner_view = _opt(client.get(f"/api/v1/plans/{p}/polls/{poll['id']}").json(), "寿司")
    concern = next(v for v in owner_view["votes"] if v["value"] == "concern")
    assert concern["name"] is None and concern["user_id"] is None and concern["reason"] == "予算"
    _act_as(viewer)
    body = _vote(client, p, poll, [{"option_id": sushi, "value": "ok"}]).json()
    assert body["counts_hidden"] is False and _opt(body, "寿司")["counts"]["love"] == 1


# ---------------------------------------------------------------- コメント

def test_comment_thread_mentions_and_warning(auth_client, make_user, db_session, audit_calls):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    res = client.post(f"/api/v1/plans/{p}/comments", json={
        "body": "宿の予約番号は ABC12345 です", "mentions": [str(editor.id), str(owner.id)]})
    assert res.status_code == 201, res.text
    c = res.json()
    assert c["sensitive_warning"] is True and set(c["sensitive_reasons"]) >= {"keyword", "code"}
    assert {m["user_id"] for m in c["mentions"]} == {str(editor.id), str(owner.id)}
    notes = db_session.query(Notification).filter(Notification.type == "comment_mention").all()
    assert [n.user_id for n in notes] == [editor.id]  # 自分自身には通知しない
    assert "ABC12345" not in (notes[0].message or "") and "ABC12345" not in notes[0].title
    assert "ABC12345" not in repr(audit_calls)

    _act_as(viewer)
    reply = client.post(f"/api/v1/plans/{p}/comments", json={"body": "了解です", "parent_id": c["id"]})
    assert reply.status_code == 201 and reply.json()["parent_id"] == c["id"]
    assert reply.json()["sensitive_warning"] is False
    assert client.patch(f"/api/v1/plans/{p}/comments/{c['id']}", json={"body": "x"},
                        headers={"If-Match": "1"}).status_code == 403
    assert client.delete(f"/api/v1/plans/{p}/comments/{c['id']}", headers={"If-Match": "1"}).status_code == 403
    outsider, _ = make_user()
    bad = {"body": "a", "mentions": [str(outsider.id)]}
    assert client.post(f"/api/v1/plans/{p}/comments", json=bad).status_code == 422

    _act_as(owner)
    edited = client.patch(f"/api/v1/plans/{p}/comments/{c['id']}", json={"body": "宿は予約済みです"},
                          headers={"If-Match": "1"})
    assert edited.status_code == 200 and edited.json()["edited_at"] is not None
    assert edited.json()["sensitive_warning"] is False
    assert client.delete(f"/api/v1/plans/{p}/comments/{c['id']}", headers={"If-Match": "2"}).status_code == 200
    thread = client.get(f"/api/v1/plans/{p}/comments", params={"target_type": "plan"}).json()
    parent = next(x for x in thread if x["id"] == c["id"])
    assert parent["is_deleted"] is True and parent["body"] is None and parent["mentions"] == []
    assert len(thread) == 2


def test_comment_targets_and_resolution(auth_client, make_user, db_session):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    poll = _poll(client, p).json()
    url = f"/api/v1/plans/{p}/comments"
    on_poll = client.post(url, json={"target_type": "poll", "target_id": poll["id"], "body": "締切は明日でいい?"})
    assert on_poll.status_code == 201
    assert client.post(url, json={"target_type": "poll", "body": "x"}).status_code == 422
    missing = {"target_type": "event", "target_id": str(uuid.uuid4()), "body": "x"}
    assert client.post(url, json=missing).status_code == 422
    assert client.post(url, json={"target_id": poll["id"], "body": "x"}).status_code == 422
    assert client.post(url, json={"body": "  "}).status_code == 422
    # 返信は同じ対象に限る
    assert client.post(url, json={"body": "x", "parent_id": on_poll.json()["id"]}).status_code == 422
    listed = client.get(f"/api/v1/plans/{p}/comments", params={"target_type": "poll", "target_id": poll["id"]}).json()
    assert [x["id"] for x in listed] == [on_poll.json()["id"]]
    assert client.get(f"/api/v1/plans/{p}/comments", params={"target_type": "plan"}).json() == []
    _act_as(editor)
    res = client.patch(f"/api/v1/plans/{p}/comments/{on_poll.json()['id']}", json={"status": "resolved"},
                       headers={"If-Match": "1"})
    assert res.status_code == 200 and res.json()["status"] == "resolved"
    _act_as(viewer)
    assert client.patch(f"/api/v1/plans/{p}/comments/{on_poll.json()['id']}", json={"status": "open"},
                        headers={"If-Match": "2"}).status_code == 403


def test_outsider_and_purge(auth_client, make_user, db_session):
    client, p, owner, _ = _group(auth_client, make_user, db_session, roles=())
    poll = _poll(client, p).json()
    _vote(client, p, poll, [{"option_id": _opt(poll, "寿司")["id"], "value": "ok"}])
    client.post(f"/api/v1/plans/{p}/comments", json={"body": "hello"})
    outsider, _ = make_user()
    _act_as(outsider)
    assert client.get(f"/api/v1/plans/{p}/polls").status_code == 403
    assert client.get(f"/api/v1/plans/{p}/comments").status_code == 403
    _act_as(owner)
    db_session.execute(text("SET CONSTRAINTS ALL DEFERRED"))
    db_session.execute(text("DELETE FROM travel_plans WHERE id = :p"), {"p": p})
    db_session.flush()
    assert db_session.query(Poll).filter(Poll.plan_id == uuid.UUID(p)).count() == 0
    assert db_session.query(Vote).filter(Vote.poll_id == uuid.UUID(poll["id"])).count() == 0
    assert db_session.query(Comment).filter(Comment.plan_id == uuid.UUID(p)).count() == 0
