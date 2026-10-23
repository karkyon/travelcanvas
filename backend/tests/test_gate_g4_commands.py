"""[Gate G4] MAP-03 検索のコマンド(>予定を追加 等)。

- 読み取り(preview)は何も変えない。実行は Idempotency-Key・If-Match が必須で、同じキーの再送は同じ結果(二重に作らない)
- 閲覧だけの人は実行できない(403)。preview では allowed=false
- 元に戻す: 本人だけ。その後に別の変更があれば 409(後の変更を巻き戻さない)。候補は使われていなければ消す
- 監査にコマンドの名前だけを残し、予定の名前を残さない
"""
import uuid
from datetime import date

import pytest

from app.api.v1 import commands as commands_api
from app.api.v1 import candidates as candidates_api
from app.models.models import CommandRun, PlanCandidate, PlanCollaborator, TravelDay, TravelEvent
from app.services import commands as cmds

from tests.test_gate_c2_candidates_places import _act_as


@pytest.fixture()
def audits(monkeypatch):
    calls = []
    monkeypatch.setattr(commands_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(candidates_api, "record_audit_event", lambda **kw: None)
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


# ---------------------------------------------------------------- 読み取り(純粋関数)

def test_parse_commands():
    days = [date(2026, 11, 2), date(2026, 11, 3)]
    p = cmds.parse(">予定を追加 11/3 9:05 清水寺 と 二年坂", days, 2026)
    assert p.command.name == "add_event"
    assert p.args == {"date": "2026-11-03", "time": "09:05", "title": "清水寺 と 二年坂"}
    assert cmds.parse("予定を追加 2日目 夕食", days, 2026).args == {"date": "2026-11-03", "time": None, "title": "夕食"}
    assert cmds.parse(">日程を追加 2026-11-04", days, 2026).args == {"date": "2026-11-04"}
    assert cmds.parse(">日程を追加 11/5", [], 2027).args == {"date": "2027-11-05"}
    assert cmds.parse(">候補を追加　錦市場", days, 2026).args == {"title": "錦市場"}
    assert cmds.parse(">検証を実行", days, 2026).command.name == "run_validation"
    assert cmds.parse(">予約", days, 2026).command.kind == "navigate"
    for bad, code in ((">", "command_empty"), (">踊る", "command_unknown"), (">予定を追加 清水寺", "command_invalid"),
                      (">予定を追加 11/3", "command_invalid"), (">予定を追加 3日目 x", "command_invalid"),
                      (">予定を追加 2/30 x", "command_invalid"), (">日程を追加 2日目", "command_invalid"),
                      (">検証を実行 いま", "command_invalid"), (">候補を追加 " + "あ" * 201, "command_invalid")):
        with pytest.raises(cmds.CommandError) as e:
            cmds.parse(bad, days, 2026)
        assert e.value.code == code, bad
    reg = {c["name"]: c for c in cmds.registry("viewer")}
    assert reg["add_event"]["allowed"] is False and reg["run_validation"]["allowed"] is True
    assert all(c["allowed"] for c in cmds.registry("editor"))


# ---------------------------------------------------------------- API

def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "G4コマンド"}).json()["id"]
    client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-03", "timezone_id": "Asia/Tokyo"},
                headers=_ik())
    return p


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def test_preview_is_read_only_and_execute_is_idempotent(auth_client, db_session, audits):
    client, _owner = auth_client
    p = _plan(client)
    base = f"/api/v1/plans/{p}/commands"
    assert any(c["name"] == "add_event" for c in client.get(base).json()["commands"])
    rev = _rev(client, p)
    pv = client.post(f"{base}/preview", json={"text": ">予定を追加 11/3 10:00 清水寺"})
    assert pv.status_code == 200, pv.text
    body = pv.json()
    assert body["allowed"] and body["needs_confirmation"] and body["undoable"] and body["problem"] is None
    assert "清水寺" in body["summary"][0]
    assert _rev(client, p) == rev and db_session.query(TravelEvent).filter(
        TravelEvent.plan_id == uuid.UUID(p)).count() == 0
    # 日程の無い日は preview で知らせ、実行は 409
    pv2 = client.post(f"{base}/preview", json={"text": ">予定を追加 11/9 夕食"}).json()
    assert pv2["problem"]["code"] == "day_not_found"
    assert client.post(f"{base}/preview", json={"text": ">踊る"}).status_code == 422

    text = {"text": ">予定を追加 11/3 10:00 清水寺"}
    assert client.post(f"{base}/execute", json=text, headers={"If-Match": str(rev)}).status_code == 400
    assert client.post(f"{base}/execute", json=text, headers={**_ik()}).status_code == 400
    assert client.post(f"{base}/execute", json=text, headers={**_ik(), "If-Match": str(rev - 1)}).status_code == 409
    key = _ik()
    r1 = client.post(f"{base}/execute", json=text, headers={**key, "If-Match": str(rev)})
    assert r1.status_code == 201, r1.text
    r2 = client.post(f"{base}/execute", json=text, headers={**key, "If-Match": str(rev)})
    assert r2.status_code == 201 and r2.json()["run_id"] == r1.json()["run_id"]
    evs = db_session.query(TravelEvent).filter(TravelEvent.plan_id == uuid.UUID(p)).all()
    assert len(evs) == 1 and evs[0].title == "清水寺" and evs[0].local_start_time == "10:00"
    assert r1.json()["plan_revision"] == rev + 1
    assert [a["details"]["command"] for a in audits] == ["add_event"]
    assert "清水寺" not in repr(audits)
    nav = client.post(f"{base}/execute", json={"text": ">予約"}, headers={**_ik(), "If-Match": str(rev + 1)})
    assert nav.status_code == 422


def test_undo_only_latest_and_only_own(auth_client, make_user, db_session, audits):
    client, owner = auth_client
    p = _plan(client)
    base = f"/api/v1/plans/{p}/commands"
    rev = _rev(client, p)
    day = client.post(f"{base}/execute", json={"text": ">日程を追加 11/4"}, headers={**_ik(), "If-Match": str(rev)})
    assert day.status_code == 201, day.text
    rev = day.json()["plan_revision"]
    ev = client.post(f"{base}/execute", json={"text": ">予定を追加 11/4 夕食"}, headers={**_ik(), "If-Match": str(rev)})
    rev = ev.json()["plan_revision"]
    # 日程の追加の後に予定を足したので、日程の追加は元に戻せない(後の変更を巻き戻さない)
    r = client.post(f"{base}/{day.json()['run_id']}/undo", headers={"If-Match": str(rev)})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "undo_not_latest"
    # 他人は戻せない
    other, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=other.id, email=other.email, role="editor",
                                    status="accepted"))
    db_session.commit()
    _act_as(other)
    try:
        assert client.post(f"{base}/{ev.json()['run_id']}/undo", headers={"If-Match": str(rev)}).status_code == 404
    finally:
        _act_as(owner)
    u = client.post(f"{base}/{ev.json()['run_id']}/undo", headers={"If-Match": str(rev)})
    assert u.status_code == 200, u.text
    assert db_session.query(TravelEvent).filter(TravelEvent.plan_id == uuid.UUID(p)).count() == 0
    assert client.post(f"{base}/{ev.json()['run_id']}/undo",
                       headers={"If-Match": str(u.json()["plan_revision"])}).status_code == 409
    u2 = client.post(f"{base}/{day.json()['run_id']}/undo", headers={"If-Match": str(u.json()["plan_revision"])})
    assert u2.status_code == 200, u2.text
    assert db_session.query(TravelDay).filter(TravelDay.plan_id == uuid.UUID(p),
                                              TravelDay.local_date == date(2026, 11, 4)).count() == 0
    assert [a["action"] for a in audits][-2:] == ["plan.command.undo", "plan.command.undo"]


def test_candidate_command_and_undo(auth_client, db_session, audits):
    client, _owner = auth_client
    p = _plan(client)
    base = f"/api/v1/plans/{p}/commands"
    rev = _rev(client, p)
    r = client.post(f"{base}/execute", json={"text": ">候補を追加 錦市場"}, headers={**_ik(), "If-Match": str(rev)})
    assert r.status_code == 201, r.text
    cid = r.json()["candidate_id"]
    assert r.json()["plan_revision"] == rev  # 候補は旅程の revision を進めない
    assert db_session.query(PlanCandidate).filter(PlanCandidate.id == uuid.UUID(cid)).one().title == "錦市場"
    run = r.json()["run_id"]
    # 予定に置いた候補は戻せない
    day_id = str(db_session.query(TravelDay).filter(TravelDay.plan_id == uuid.UUID(p)).first().id)
    s = client.post(f"/api/v1/plans/{p}/candidates/{cid}/schedule", json={"day_id": day_id},
                    headers={"If-Match": "1"})
    assert s.status_code == 201, s.text
    rev = _rev(client, p)
    assert client.post(f"{base}/{run}/undo", headers={"If-Match": str(rev)}).status_code == 409
    r = client.post(f"{base}/execute", json={"text": ">候補を追加 嵐山"}, headers={**_ik(), "If-Match": str(rev)})
    u = client.post(f"{base}/{r.json()['run_id']}/undo", headers={"If-Match": str(rev)})
    assert u.status_code == 200, u.text
    assert db_session.query(PlanCandidate).filter(PlanCandidate.id == uuid.UUID(r.json()["candidate_id"])).count() == 0
    assert db_session.query(CommandRun).filter(CommandRun.id == uuid.UUID(r.json()["run_id"])).one().status == "undone"


def test_viewer_can_preview_and_validate_but_not_mutate(auth_client, make_user, db_session, audits):
    client, owner = auth_client
    p = _plan(client)
    base = f"/api/v1/plans/{p}/commands"
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    rev = _rev(client, p)
    stranger, _ = make_user()
    _act_as(viewer)
    try:
        pv = client.post(f"{base}/preview", json={"text": ">予定を追加 11/3 x"}).json()
        assert pv["allowed"] is False and pv["reason"]
        r = client.post(f"{base}/execute", json={"text": ">予定を追加 11/3 x"}, headers={**_ik(), "If-Match": str(rev)})
        assert r.status_code == 403
        v = client.post(f"{base}/execute", json={"text": ">検証を実行"}, headers={**_ik(), "If-Match": str(rev)})
        assert v.status_code == 201, v.text
        assert v.json()["validation_run_id"] and v.json()["undoable"] is False
        assert client.post(f"{base}/{v.json()['run_id']}/undo", headers={"If-Match": str(rev)}).status_code == 403
    finally:
        _act_as(owner)
    _act_as(stranger)
    try:
        assert client.post(f"{base}/preview", json={"text": ">予約"}).status_code in (403, 404)
    finally:
        _act_as(owner)
