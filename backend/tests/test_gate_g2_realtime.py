"""[Gate G2] FR-020 即時の共同編集の通知(GET /plans/{id}/events/stream、Server-Sent Events)。

- 見られる人だけ(関係のない人は 403)。最初に ready(いまの版)。知っている版が古ければすぐ revision
- 版が上がると revision、開いている人・編集中の予定が変わると presence。決めた時間で reconnect を送って閉じる
- 旅行を見られなくなる(参加者から外れる・旅行が消される)と access_lost を送って閉じる
- 1人あたりの同時の接続の上限(超えると 429)。閉じた接続は数えない
"""
import json
import uuid

import pytest

from app.api.v1 import presence as presence_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator, TravelPlan
from app.services import presence as pr


class _NoClose:
    def __init__(self, s):
        self._s = s

    def __getattr__(self, name):
        return getattr(self._s, name)

    def close(self):
        self._s.expire_all()


@pytest.fixture(autouse=True)
def _fast(monkeypatch, db_session):
    monkeypatch.setattr(presence_api, "STREAM_SECONDS", 1.5)
    monkeypatch.setattr(presence_api, "STREAM_TICK_SECONDS", 0.05)
    monkeypatch.setattr(presence_api, "STREAM_HEARTBEAT_SECONDS", 0.5)
    monkeypatch.setattr(presence_api, "_session_factory", lambda: _NoClose(db_session))
    pr.reset_for_testing()
    presence_api._streams.clear()
    yield
    pr.reset_for_testing()
    presence_api._streams.clear()


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _on_poll(monkeypatch, at_call, fn):
    """接続の中で状態を読む回数が at_call になった時に fn を呼ぶ(試験の client は応答を最後にまとめて返すため、
    接続の途中の変化は、接続の中から起こす)。"""
    real = presence_api._poll_state
    calls = {"n": 0}

    def wrapped(plan_uuid, user_id):
        calls["n"] += 1
        if calls["n"] == at_call:
            fn()
        return real(plan_uuid, user_id)
    monkeypatch.setattr(presence_api, "_poll_state", wrapped)


def _events(client, url, headers=None):
    out = []
    with client.stream("GET", url, headers=headers or {}) as r:
        assert r.status_code == 200, r.read()
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers["cache-control"] == "no-store"
        cur = {}
        for line in r.iter_lines():
            if line.startswith("event: "):
                cur["event"] = line[7:]
            elif line.startswith("data: "):
                cur["data"] = json.loads(line[6:])
            elif line.startswith("id: "):
                cur["id"] = line[4:]
            elif line == "" and cur:
                out.append(cur)
                cur = {}
    return out


def _plan(client):
    return client.post("/api/v1/travel-plans/", json={"title": "即時G2"}).json()["id"]


def test_stream_ready_revision_presence_and_reconnect(auth_client, make_user, db_session, monkeypatch):
    client, owner = auth_client
    p = _plan(client)
    url = f"/api/v1/plans/{p}/events/stream"
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).first()
    start = plan.revision

    def change():
        plan.revision = start + 1
        db_session.flush()
        pr.touch(p, f"{uuid.uuid4()}:abcdefgh", {"user_id": str(owner.id), "editing": None})

    _on_poll(monkeypatch, 3, change)
    evs = _events(client, url, headers={"Last-Event-ID": str(start - 1) if start > 0 else "0"})
    kinds = [e["event"] for e in evs]
    assert kinds[0] == "ready" and evs[0]["data"]["revision"] == start
    assert "revision" in kinds and "presence" in kinds and kinds[-1] == "reconnect"
    revs = [e["data"]["revision"] for e in evs if e["event"] == "revision"]
    assert revs[-1] == start + 1
    assert evs[-1]["data"]["revision"] == start + 1 and evs[-1]["id"] == str(start + 1)
    assert presence_api._streams == {}  # 閉じた接続は数えない


def test_stream_access_rules_and_limit(auth_client, make_user, db_session, monkeypatch):
    client, owner = auth_client
    p = _plan(client)
    url = f"/api/v1/plans/{p}/events/stream"
    stranger, _ = make_user()
    _act_as(stranger)
    assert client.get(url).status_code == 403
    member, _ = make_user()
    collab = PlanCollaborator(plan_id=uuid.UUID(p), user_id=member.id, email=member.email, role="viewer",
                              status="accepted")
    db_session.add(collab)
    db_session.flush()
    _act_as(member)

    def remove():
        db_session.delete(collab)
        db_session.flush()

    _on_poll(monkeypatch, 2, remove)
    evs = _events(client, url)
    assert evs[-1]["event"] == "access_lost"
    monkeypatch.undo()
    monkeypatch.setattr(presence_api, "STREAM_SECONDS", 1.5)
    monkeypatch.setattr(presence_api, "STREAM_TICK_SECONDS", 0.05)
    monkeypatch.setattr(presence_api, "_session_factory", lambda: _NoClose(db_session))

    # 同時の接続の上限
    monkeypatch.setattr(presence_api, "MAX_STREAMS_PER_USER", 1)
    _act_as(owner)
    token = presence_api._stream_open(str(owner.id))
    assert token
    r = client.get(url)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "too_many_streams"
    presence_api._stream_close(str(owner.id), token)
    assert [e["event"] for e in _events(client, url)][0] == "ready"


def test_poll_state_real_queries(auth_client, db_session):
    client, owner = auth_client
    p = _plan(client)
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).first()
    assert presence_api._poll_state(plan.id, owner.id) == plan.revision
    assert presence_api._poll_state(uuid.uuid4(), owner.id) is None
    assert presence_api._poll_state(plan.id, uuid.uuid4()) is None
