"""[Gate G7] MEM-03 の一部(同行者の属性・移動手段の傾向) / FR-039 猶予つきのアカウント削除 の試験(実PostgreSQL)。

- 同じ同行者の属性(子ども連れ・高齢の方・1人か複数か)の旅行で傾向が出せればそちらを使う(basis=same_party)
- 移動手段の傾向: 同じ手段の区間の後に平均10分以上遅れて着く(3件以上)→ その手段の区間の前の余裕を足す提案。
  適用は区間の変更として1つの変更セットに残り、元に戻せる。入力が変わると409
- 猶予つきの削除: 本人確認(即時の削除と同じ)、ゲストは使えない、取り消し、期限前は削除しない、期限を過ぎたら定期の処理が
  削除する(管理者は削除しない)。申し込みの印は削除の後に残らない
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import memory_replan as replan_api
from app.api.v1 import movement as movement_api
from app.api.v1 import privacy as privacy_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import ChangeSet, TravelSegment, User, UserType
from app.services import account_deletion as ad
from app.services import memory_replan as mr

PASSWORD = "TestPass123!"


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    for mod in (replan_api, movement_api, privacy_api):
        monkeypatch.setattr(mod, "record_audit_event", lambda **kw: calls.append(kw))
    from app.services import audit_service

    monkeypatch.setattr(audit_service, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


# ================================================================ MEM-03 単体

def test_party_basis_and_transport_units():
    kids = {"with_children": True, "with_seniors": False, "group": "group"}
    solo = {"with_children": False, "with_seniors": False, "group": "solo"}
    assert mr.same_party(kids, dict(kids)) and not mr.same_party(kids, solo) and not mr.same_party(None, kids)
    assert mr.party_label(kids) == "子ども連れ・複数人"
    samples = []
    for party, actual in ((kids, 170), (kids, 175), (solo, 120), (solo, 125)):
        samples.append({"plan_id": "x", "plan_title": "旅", "event_type": "museum", "title": "美術館",
                        "status": "visited", "planned_minutes": 120, "actual_minutes": actual, "start_diff": 0,
                        "party": party})
    every = mr.insights(samples)
    assert [(i["kind"], i["minutes"], i["basis"]) for i in every] == [("stay_longer", 30, "all")]
    same = mr.insights(samples, kids)
    assert [(i["kind"], i["minutes"], i["basis"]) for i in same] == [("stay_longer", 50, "same_party")]
    assert same[0]["party_label"] == "子ども連れ・複数人"
    # 1人旅では同じ属性の旅行に傾向が無いので、全ての旅行の傾向(30分)を使う
    alone = mr.insights(samples, solo)
    assert alone == [] or alone[0]["basis"] == "all"
    rows = [{"plan_title": "旅", "mode": "bus", "delay": d, "label": "バス → 寺", "party": kids} for d in (15, 20, 25)]
    rows += [{"plan_title": "旅", "mode": "train", "delay": 2, "label": "鉄道 → 寺", "party": kids}] * 3
    tr = mr.transport_insights(rows, kids)
    assert [(i["mode"], i["minutes"], i["basis"]) for i in tr] == [("bus", 20, "same_party")]
    props = mr.transport_proposals(tr, [
        {"id": "s1", "mode": "bus", "status": "planned", "buffer_before_minutes": 110, "label": "A → B"},
        {"id": "s2", "mode": "bus", "status": "cancelled", "buffer_before_minutes": 0, "label": "B → C"},
        {"id": "s3", "mode": "train", "status": "planned", "buffer_before_minutes": 0, "label": "C → D"},
    ])
    assert len(props) == 1
    assert props[0]["changes"] == [{"segment_id": "s1", "label": "A → B", "from": 110, "to": 120}]


# ================================================================ MEM-03 API

def _trip(client, title, date_str, items, segments=(), party=None):
    """items: (名前, 時刻, 実績の到着 'HH:MM' | None)。segments: (from, to, mode)"""
    p = client.post("/api/v1/travel-plans/", json={"title": title}).json()["id"]
    base = f"/api/v1/plans/{p}"
    if party:
        assert client.put(f"{base}/movement-settings", json={"settings": {"party": party}},
                          headers={"If-Match": "0"}).status_code == 200
    d = client.post(f"{base}/days", json={"local_date": date_str, "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()
    ev = {}
    for name, t, arrived in items:
        ev[name] = client.post(f"{base}/events", json={"day_id": d["id"], "title": name, "event_type": "sightseeing",
                                                       "local_start_time": t}, headers=_ik()).json()
        if arrived:
            r = client.put(f"{base}/journey/events/{ev[name]['id']}", json={
                "status": "visited", "actual_start_at": f"{date_str}T{arrived}:00+09:00",
                "actual_end_at": f"{date_str}T{arrived}:00+09:00"})
            assert r.status_code == 200, r.text
    segs = []
    for a, b, mode in segments:
        body = {"from_event_id": ev[a]["id"], "to_event_id": ev[b]["id"], "mode": mode, "duration_minutes": 20}
        r = client.post(f"{base}/segments", json=body, headers=_ik())
        assert r.status_code == 201, r.text
        segs.append(r.json())
    return p, base, ev, segs


def test_transport_tendency_proposal_apply_and_undo(auth_client, db_session, audit_calls):
    client, _owner = auth_client
    kids = {"with_children": True}
    # 過去の子ども連れの旅行: バスの後はいつも約20分遅れて着く
    for n, delays in enumerate(((20, 25), (15,))):
        items = [("駅", "09:00", "09:00")]
        segs = []
        for i, dl in enumerate(delays):
            t = f"{10 + i * 2:02d}:00"
            items.append((f"寺{i}", t, f"{10 + i * 2:02d}:{dl:02d}"))
            segs.append(("駅" if i == 0 else f"寺{i - 1}", f"寺{i}", "bus"))
        _trip(client, f"過去{n}", f"2025-0{n + 4}-01", items, segs, party=kids)
    p, base, ev, segs = _trip(client, "滋賀2026", "2026-11-21",
                              [("美冨久", "10:00", None), ("藤居本家", "13:00", None)],
                              [("美冨久", "藤居本家", "bus")], party=kids)
    body = client.get(f"{base}/memory-replan").json()
    assert body["party"]["with_children"] is True and body["party_label"].startswith("子ども連れ")
    assert body["algorithm_version"] == "memory-replan-v2" and body["transport_sample_count"] == 3
    slow = next(i for i in body["insights"] if i["kind"] == "slow_transport")
    assert slow["mode"] == "bus" and slow["minutes"] == 20 and slow["basis"] == "same_party"
    prop = next(x for x in body["proposals"] if x["kind"] == "slow_transport")
    assert prop["changes"] == [{"segment_id": segs[0]["id"], "label": "美冨久 → 藤居本家", "from": 0, "to": 20}]
    rev = client.get(f"/api/v1/plans/{p}").json()["revision"]
    url = f"{base}/memory-replan/apply"
    payload = {"proposal_id": prop["id"], "input_fingerprint": body["input_fingerprint"]}
    r = client.post(url, json=payload, headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    assert r.json()["applied"] == 1
    db_session.expire_all()
    seg = db_session.get(TravelSegment, uuid.UUID(segs[0]["id"]))
    assert seg.buffer_before_minutes == 20
    cs = db_session.query(ChangeSet).filter(ChangeSet.plan_id == uuid.UUID(p),
                                            ChangeSet.resulting_revision == rev + 1).one()
    assert cs.source == "memory_replan" and cs.items[0].entity_type == "travel_segment"
    assert "美冨久" not in str(audit_calls)
    again = client.post(url, json=payload, headers={"If-Match": str(rev + 1)})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "replan_stale"
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    db_session.expire_all()
    assert db_session.get(TravelSegment, uuid.UUID(segs[0]["id"])).buffer_before_minutes == 0


# ================================================================ FR-039 猶予つきの削除

def test_schedule_cancel_and_preview(auth_client, make_user, db_session, audit_calls):
    client, me = auth_client
    base = "/api/v1/privacy/account-deletion"
    pre = client.get(base).json()
    assert pre["can_schedule"] is True and pre["scheduled"] is None and pre["account_delete_grace_days"] == 14
    assert client.post(f"{base}/schedule", json={"confirmation": "削除", "password": PASSWORD}).status_code == 422
    assert client.post(f"{base}/schedule", json={"confirmation": "退会する", "password": "x"}).status_code == 403
    r = client.post(f"{base}/schedule", json={"confirmation": "退会する", "password": PASSWORD})
    assert r.status_code == 200, r.text
    due = datetime.fromisoformat(r.json()["due_at"])
    assert timedelta(days=13, hours=23) < due - datetime.now(timezone.utc) <= timedelta(days=14)
    assert client.get(base).json()["scheduled"]["due_at"] == r.json()["due_at"]
    # 2回目の申し込みは同じ時刻のまま
    r2 = client.post(f"{base}/schedule", json={"confirmation": "退会する", "password": PASSWORD})
    assert r2.json()["due_at"] == r.json()["due_at"]
    # 期限前は削除しない
    assert ad.run_due(db_session)["deleted"] == 0
    db_session.expire_all()
    assert db_session.get(User, me.id).is_active is True
    assert client.post(f"{base}/cancel").json() == {"scheduled": None}
    assert client.post(f"{base}/cancel").status_code == 409
    actions = [c["action"] for c in audit_calls]
    assert "account_deletion_scheduled" in actions and "account_deletion_cancelled" in actions
    # ゲストは使えない
    guest, _ = make_user()
    guest.user_type = UserType.GUEST
    guest.hashed_password = None
    db_session.commit()
    _act_as(guest)
    g = client.post(f"{base}/schedule", json={"confirmation": "退会する"})
    assert g.status_code == 422 and g.json()["detail"]["code"] == "schedule_not_available"


def test_due_requests_are_deleted_by_job_except_admins(auth_client, make_user, db_session, audit_calls):
    client, me = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "残す旅行"}).json()["id"]
    base = "/api/v1/privacy/account-deletion"
    assert client.post(f"{base}/schedule", json={"confirmation": "退会する", "password": PASSWORD}).status_code == 200
    admin, _ = make_user()
    admin.is_superuser = True
    now = datetime.now(timezone.utc)
    admin.deletion_requested_at = now - timedelta(days=20)
    admin.deletion_due_at = now - timedelta(days=6)
    db_session.commit()
    later = now + timedelta(days=15)
    counts = ad.run_due(db_session, now=later)
    assert counts == {"deleted": 1, "skipped_admin": 1, "failed": 0}
    db_session.expire_all()
    gone = db_session.get(User, me.id)
    assert gone.is_active is False and gone.email is None and gone.deletion_due_at is None
    assert gone.deletion_requested_at is None
    assert db_session.get(User, admin.id).is_active is True
    deleted = [c for c in audit_calls if c["action"] == "account_deleted"]
    assert deleted and deleted[-1]["details"]["reason"] == "scheduled" and "残す旅行" not in str(audit_calls)
    from app.models.models import TravelPlan

    assert db_session.get(TravelPlan, uuid.UUID(p)).deleted_at is not None  # 所有する旅行は論理削除
    # 二度目は何もしない
    assert ad.run_due(db_session, now=later) == {"deleted": 0, "skipped_admin": 1, "failed": 0}


def test_job_entry_and_schedule_line(capsys):
    from app.ops import account_deletions, cli, opslib

    assert cli.JOBS["account-deletions"] == ["-m", "app.ops.account_deletions"]
    assert "20 4 * * * cd /home/x/tc && " in opslib.render_cron_block("/home/x/tc")
    assert "jobs account-deletions" in opslib.render_cron_block("/home/x/tc")
    assert account_deletions.main([]) == 0
    out = capsys.readouterr().out.strip().splitlines()[-1]
    assert '"ok": true' in out and '"deleted"' in out
