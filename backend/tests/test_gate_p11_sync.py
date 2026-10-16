"""
[Gate P11] FR-033 オフライン編集・同期の統合テスト(実PostgreSQL)。

検証する主な性質:
- 操作ごとの結果(applied / already_applied / conflicted / rejected)。一部成功を200だけで隠さない
- 同じoperation_idの再送は二重に適用しない(already_applied)。端末で作った予定の仮ID(temp_id)を後続の操作で使える
- 競合は項目単位: 編集開始後にサーバーで別の値に変わった項目だけが競合。同じ値・別の項目なら適用する
- サーバーで削除済みの予定の変更は競合、削除は適用済み扱い。編集後に変わった予定の削除は競合
- 確定(ロック)・紐付きのある予定はオフラインでは変更・削除しない(rejected)
- 競合の解決: サーバーの内容を残す / 自分の変更を使う(If-Match)。適用は変更セット(source=sync)で「元に戻す」可能
- 権限: viewerは同期できない。他人の競合は見えない。監査に内容を残さない
"""
import uuid

import pytest

from app.api.v1 import sync as sync_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import ChangeSet, PlanCollaborator, TravelEvent
from app.services import sync as sy


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(sync_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _setup(auth_client):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "同期テスト"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()
    ev = {}
    for name, t in (("temple", "09:00"), ("lunch", "12:00"), ("museum", "14:00")):
        ev[name] = client.post(f"{base}/events", json={"day_id": day["id"], "title": name, "local_start_time": t},
                               headers=_ik()).json()
    return client, owner, p, base, day, ev


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _op(action, **kw):
    return {"operation_id": str(uuid.uuid4()), "entity_type": "event", "action": action, **kw}


def _events(client, p):
    return {e["title"]: e for d in client.get(f"/api/v1/plans/{p}").json()["days"] for e in d["events"]}


# ---------------------------------------------------------------- 単体

def test_clean_fields_and_conflicts():
    assert sy.clean_fields({"title": " 朝食 ", "local_start_time": "08:00"}, "update") == {
        "title": "朝食", "local_start_time": "08:00"}
    for bad in ({"title": ""}, {"local_start_time": "25:00"}, {"locked": True}, {"latitude": 100}, {}):
        with pytest.raises(sy.SyncError):
            sy.clean_fields(bad, "update")
    with pytest.raises(sy.SyncError):
        sy.clean_fields({"title": "x"}, "create")  # 日程が無い
    base = {"title": "A", "local_start_time": "09:00"}
    assert sy.field_conflicts(base, {"title": "B", "local_start_time": "09:00"}, {"title": "C"}) == ["title"]
    assert sy.field_conflicts(base, {"title": "B", "local_start_time": "09:00"}, {"title": "B"}) == []
    assert sy.field_conflicts(base, {"title": "B", "local_start_time": "09:00"}, {"local_start_time": "10:00"}) == []


# ---------------------------------------------------------------- API

def test_offline_create_update_delete_with_temp_id_and_replay(auth_client, db_session, audit_calls):
    client, owner, p, base, day, ev = _setup(auth_client)
    rev = _rev(client, p)
    create = _op("create", temp_id="tmp-1", fields={"day_id": day["id"], "title": "カフェ", "local_start_time": "15:30"})
    rename = _op("update", entity_id="tmp-1", base_revision=rev, fields={"title": "喫茶店"})
    move = _op("update", entity_id=ev["temple"]["id"], base_revision=rev, fields={"local_start_time": "09:30"})
    delete = _op("delete", entity_id=ev["museum"]["id"], base_revision=rev)
    res = client.post(f"{base}/sync", json={"device_id": "phone-1", "operations": [create, rename, move, delete]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [r["status"] for r in body["results"]] == ["applied"] * 4
    assert body["summary"] == {"applied": 4, "already_applied": 0, "conflicted": 0, "rejected": 0}
    assert body["plan_revision"] == rev + 4 and body["pack_refresh_required"] is True
    created_id = body["results"][0]["entity_id"]
    assert body["results"][0]["temp_id"] == "tmp-1" and body["results"][1]["entity_id"] == created_id
    events = _events(client, p)
    assert events["喫茶店"]["id"] == created_id and events["喫茶店"]["local_start_time"] == "15:30"
    assert events["temple"]["local_start_time"] == "09:30" and "museum" not in events
    sources = {cs.source for cs in db_session.query(ChangeSet).filter(ChangeSet.plan_id == uuid.UUID(p),
                                                                      ChangeSet.resulting_revision > rev)}
    assert sources == {"sync"}
    assert "喫茶店" not in str(audit_calls) and audit_calls[-1]["details"]["applied"] == 4

    # 再送(通信が切れて結果を受け取れなかった)は二重に適用しない
    again = client.post(f"{base}/sync", json={"device_id": "phone-1", "operations": [create, rename, move, delete]})
    assert [r["status"] for r in again.json()["results"]] == ["already_applied"] * 4
    assert again.json()["plan_revision"] == rev + 4 and len(_events(client, p)) == 3
    # 最後の変更(削除)は「元に戻す」で戻る
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 4)}).status_code == 200
    assert "museum" in _events(client, p)


def test_field_level_conflicts_and_resolution(auth_client):
    client, owner, p, base, day, ev = _setup(auth_client)
    rev = _rev(client, p)  # 端末はこの版で編集を始めた
    # 同じ間にサーバーで: templeの名前を変える、lunchの時刻を変える
    assert client.put(f"/api/v1/plans/{p}/events/{ev['temple']['id']}", json={"title": "清水寺"},
                      headers={"If-Match": str(rev)}).status_code == 200
    assert client.put(f"/api/v1/plans/{p}/events/{ev['lunch']['id']}", json={"local_start_time": "12:30"},
                      headers={"If-Match": str(rev + 1)}).status_code == 200
    ops = [
        _op("update", entity_id=ev["temple"]["id"], base_revision=rev, fields={"title": "金閣寺"}),  # 競合
        _op("update", entity_id=ev["temple"]["id"], base_revision=rev, fields={"title": "清水寺"}),  # 同じ値
        _op("update", entity_id=ev["lunch"]["id"], base_revision=rev, fields={"title": "昼ごはん"}),  # 別の項目
        _op("delete", entity_id=ev["lunch"]["id"], base_revision=rev),  # サーバーで変更済みの予定の削除
    ]
    body = client.post(f"{base}/sync", json={"operations": ops}).json()
    assert [r["status"] for r in body["results"]] == ["conflicted", "applied", "applied", "conflicted"]
    c0 = body["results"][0]
    assert c0["code"] == "changed_on_server" and c0["conflict"]["fields"] == ["title"]
    assert c0["conflict"]["mine"] == {"title": "金閣寺"} and c0["conflict"]["server"] == {"title": "清水寺"}
    assert body["results"][1]["code"] == "no_change"
    events = _events(client, p)
    assert events["昼ごはん"]["local_start_time"] == "12:30"  # サーバーの時刻と端末の名前の両方が残る
    listed = client.get(f"{base}/sync/conflicts").json()["conflicts"]
    assert [(c["action"], c["title"]) for c in listed] == [("update", "清水寺"), ("delete", "昼ごはん")]
    assert listed[0]["current"]["title"] == "清水寺" and listed[1]["conflict"]["deleted_by_me"] is True

    url = f"{base}/sync/conflicts"
    rev2 = _rev(client, p)
    # 自分の変更を使う(If-Match必須)
    assert client.post(f"{url}/{c0['operation_id']}/resolve", json={"resolution": "use_mine"}).status_code == 400
    done = client.post(f"{url}/{c0['operation_id']}/resolve", json={"resolution": "use_mine"},
                       headers={"If-Match": str(rev2)})
    assert done.status_code == 200 and done.json()["status"] == "resolved_mine"
    assert "金閣寺" in _events(client, p)
    # サーバーの内容を残す(削除しない)
    keep = client.post(f"{url}/{body['results'][3]['operation_id']}/resolve", json={"resolution": "keep_server"})
    assert keep.status_code == 200 and "昼ごはん" in _events(client, p)
    assert client.get(url).json()["conflicts"] == []
    again = client.post(f"{url}/{c0['operation_id']}/resolve", json={"resolution": "keep_server"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "not_conflicted"


def test_deleted_locked_related_and_rejections(auth_client, db_session):
    client, owner, p, base, day, ev = _setup(auth_client)
    rev = _rev(client, p)
    assert client.delete(f"/api/v1/plans/{p}/events/{ev['museum']['id']}",
                         headers={"If-Match": str(rev)}).status_code == 200
    db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(ev["temple"]["id"])).update({"locked": True})
    db_session.commit()
    assert client.post(f"{base}/reservations", json={
        "type": "restaurant", "provider_name": "料亭", "event_id": ev["lunch"]["id"]}).status_code == 201
    ops = [
        _op("update", entity_id=ev["museum"]["id"], base_revision=rev, fields={"title": "美術館"}),
        _op("delete", entity_id=ev["museum"]["id"], base_revision=rev),
        _op("update", entity_id=ev["temple"]["id"], base_revision=rev, fields={"title": "x"}),
        _op("delete", entity_id=ev["lunch"]["id"], base_revision=rev),
        _op("update", entity_id="tmp-unknown", base_revision=rev, fields={"title": "x"}),
        _op("update", entity_id=ev["lunch"]["id"], fields={"title": "x"}),
        _op("create", fields={"day_id": str(uuid.uuid4()), "title": "x"}),
        _op("update", entity_id=ev["lunch"]["id"], base_revision=rev, fields={"locked": False}),
    ]
    body = client.post(f"{base}/sync", json={"operations": ops}).json()
    got = [(r["status"], r["code"]) for r in body["results"]]
    assert got == [("conflicted", "deleted_on_server"), ("applied", "already_deleted"), ("rejected", "locked"),
                   ("rejected", "has_relations"), ("rejected", "unknown_entity"),
                   ("rejected", "base_revision_required"), ("rejected", "day_missing"), ("rejected", "unknown_fields")]
    assert all(r["message"] for r in body["results"] if r["status"] == "rejected")
    # サーバーで削除済みの予定に「自分の変更を使う」はできない
    op_id = body["results"][0]["operation_id"]
    res = client.post(f"{base}/sync/conflicts/{op_id}/resolve", json={"resolution": "use_mine"},
                      headers={"If-Match": str(_rev(client, p))})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "deleted_on_server"
    assert client.post(f"{base}/sync", json={"operations": [ops[0], ops[0]]}).status_code == 422


def test_permissions_and_isolation(auth_client, make_user, db_session):
    client, owner, p, base, day, ev = _setup(auth_client)
    viewer, _ = make_user()
    editor, _ = make_user()
    for u, role in ((viewer, "viewer"), (editor, "editor")):
        db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=u.id, email=u.email, role=role,
                                        status="accepted"))
    db_session.commit()
    rev = _rev(client, p)
    client.put(f"/api/v1/plans/{p}/events/{ev['temple']['id']}", json={"title": "清水寺"},
               headers={"If-Match": str(rev)})
    op = _op("update", entity_id=ev["temple"]["id"], base_revision=rev, fields={"title": "金閣寺"})
    assert client.post(f"{base}/sync", json={"operations": [op]}).json()["results"][0]["status"] == "conflicted"
    _act_as(viewer)
    viewer_op = _op("delete", entity_id=ev["lunch"]["id"], base_revision=rev)
    assert client.post(f"{base}/sync", json={"operations": [viewer_op]}).status_code == 403
    _act_as(editor)
    assert client.get(f"{base}/sync/conflicts").json()["conflicts"] == []  # 他人の競合は見えない
    assert client.post(f"{base}/sync/conflicts/{op['operation_id']}/resolve",
                       json={"resolution": "keep_server"}).status_code == 404
    # 同じoperation_idでも利用者が違えば別の操作
    res = client.post(f"{base}/sync", json={"operations": [op]}).json()
    assert res["results"][0]["status"] == "conflicted"
