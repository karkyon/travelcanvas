"""[Gate G6] OFF-01 端末ごとのオフラインの鍵と失効 / OFF-02 日程・並び・予約のオフラインの操作と依存の順。"""
import uuid

import pytest

from app.api.v1 import offline_pack as offline_api
from app.api.v1 import sync as sync_api
from app.core.config import settings
from app.models.models import OfflineDevice, SyncOperation, TravelDay
from app.services import offline_keys as ok
from app.services import sync as sy

from tests.test_gate_p11_sync import _events, _ik, _rev, _setup

KEY_URL = "/api/v1/offline-pack/key"


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(offline_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(sync_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(offline_api, "check_rate_limit", lambda *a, **kw: True)
    monkeypatch.setattr(settings, "OFFLINE_PACK_KEY_SECRET", "test-only-offline-pack-secret")


def _register_secret(value: str) -> None:
    from tests.conftest import LEAK_COLLECTOR

    LEAK_COLLECTOR.add_secret(value)


# ---------------------------------------------------------------- OFF-01

def test_device_keys_are_separate_and_revocable(auth_client, db_session):
    client, user = auth_client
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    ka = client.get(KEY_URL, params={"device_id": a}, headers={"User-Agent": "Mozilla/5.0 (iPhone) Safari/605"})
    kb = client.get(KEY_URL, params={"device_id": b}, headers={"User-Agent": "Mozilla/5.0 (Windows) Chrome/120"})
    assert ka.status_code == 200 and kb.status_code == 200, ka.text
    for r in (ka, kb):
        _register_secret(r.json()["key"])
        assert r.headers["cache-control"] == "no-store"
    assert ka.json()["key"] != kb.json()["key"]
    assert ka.json()["device_id"] == a and ka.json()["expires_at"]
    legacy = client.get(KEY_URL).json()  # 古い画面の互換(利用者ごとの鍵)
    _register_secret(legacy["key"])
    assert legacy["key"] not in (ka.json()["key"], kb.json()["key"]) and "device_id" not in legacy
    # 同じ端末なら同じ鍵(再ログインでも変わらない)
    again = client.get(KEY_URL, params={"device_id": a}).json()
    assert again["key"] == ka.json()["key"]
    listed = client.get("/api/v1/offline-pack/devices", params={"device_id": a}).json()
    assert [d["label"] for d in listed["devices"]] == ["Chrome(Windows)", "Safari(iPhone)"] or \
        sorted(d["label"] for d in listed["devices"]) == ["Chrome(Windows)", "Safari(iPhone)"]
    assert next(d for d in listed["devices"] if d["is_current"])["label"] == "Safari(iPhone)"
    # 端末 A を失効: A には配らない(410)、B はそのまま
    dev_a = next(d for d in listed["devices"] if d["is_current"])
    r = client.post(f"/api/v1/offline-pack/devices/{dev_a['id']}/revoke")
    assert r.status_code == 200 and r.json()["revoked_at"]
    gone = client.get(KEY_URL, params={"device_id": a})
    assert gone.status_code == 410 and gone.json()["detail"]["code"] == "offline_device_revoked"
    assert client.get(KEY_URL, params={"device_id": b}).json()["key"] == kb.json()["key"]
    # 版を上げる(全ての端末の失効)と B の鍵も変わる
    rot = client.post("/api/v1/offline-pack/key/rotate", headers={"If-Match": "1"})
    _register_secret(rot.json()["key"])
    nb = client.get(KEY_URL, params={"device_id": b}).json()
    _register_secret(nb["key"])
    assert nb["key"] != kb.json()["key"] and nb["key_version"] == 2
    assert ok.derive_device_key(user.id, 2, b) != ok.derive_device_key(user.id, 2, a)
    assert client.get(KEY_URL, params={"device_id": "not-a-uuid"}).status_code == 422
    assert client.post(f"/api/v1/offline-pack/devices/{uuid.uuid4()}/revoke").status_code == 404


def test_device_limit(auth_client, db_session):
    client, user = auth_client
    for _ in range(ok.MAX_DEVICES):
        r = client.get(KEY_URL, params={"device_id": str(uuid.uuid4())})
        assert r.status_code == 200
        _register_secret(r.json()["key"])
    over = client.get(KEY_URL, params={"device_id": str(uuid.uuid4())})
    assert over.status_code == 409 and over.json()["detail"]["code"] == "too_many_offline_devices"
    assert db_session.query(OfflineDevice).filter(OfflineDevice.user_id == user.id).count() == ok.MAX_DEVICES


def test_devices_are_own_only(auth_client, make_user):
    """他の利用者の端末は一覧に出ず、失効もできない(404)。失効した端末は数えず、新しい端末を登録できる"""
    from tests.test_gate_p12_memories import _act_as

    client, owner = auth_client
    dev = str(uuid.uuid4())
    _register_secret(client.get(KEY_URL, params={"device_id": dev}).json()["key"])
    mine = client.get("/api/v1/offline-pack/devices").json()["devices"][0]
    other, _ = make_user()
    _act_as(other)
    assert client.get("/api/v1/offline-pack/devices").json()["devices"] == []
    assert client.post(f"/api/v1/offline-pack/devices/{mine['id']}/revoke").status_code == 404
    # 他の利用者が同じ端末の ID を使っても、別の端末として別の鍵になる
    theirs = client.get(KEY_URL, params={"device_id": dev}).json()
    _register_secret(theirs["key"])
    _act_as(owner)
    assert client.get("/api/v1/offline-pack/devices").json()["devices"][0]["revoked_at"] is None
    assert client.get(KEY_URL, params={"device_id": dev}).json()["key"] != theirs["key"]


def test_device_label_keeps_only_families():
    assert ok.device_label("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537") == "Chrome(Android)"
    assert ok.device_label("Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Firefox/120") == "Firefox(Mac)"
    assert ok.device_label(None) == "ブラウザ"


# ---------------------------------------------------------------- OFF-02

def _op(entity_type, action, **kw):
    return {"operation_id": str(uuid.uuid4()), "entity_type": entity_type, "action": action, **kw}


def test_dependency_order_unit():
    ops = [
        {"action": "update", "entity_id": "tmp-e", "fields": {"title": "x"}},
        {"action": "create", "temp_id": "tmp-e", "fields": {"day_id": "tmp-d", "title": "y"}},
        {"action": "create", "temp_id": "tmp-d", "fields": {"local_date": "2026-11-05"}},
        {"action": "update", "entity_id": str(uuid.uuid4()), "fields": {"title": "z"}},
    ]
    assert sy.dependency_order(ops) == [2, 1, 0, 3]
    cyc = [{"action": "create", "temp_id": "a", "fields": {"day_id": "b"}},
           {"action": "create", "temp_id": "b", "fields": {"day_id": "a"}}]
    assert sy.dependency_order(cyc) == [0, 1]
    with pytest.raises(sy.SyncError):
        sy.clean_order({"day_id": "d", "order": ["a", "a"]})
    with pytest.raises(sy.SyncError):
        sy.clean_day_fields({"local_date": "2026-13-40"}, "create")
    with pytest.raises(sy.SyncError):
        sy.clean_day_fields({"local_date": "2026-11-01", "timezone_id": "Mars/Base"}, "create")
    assert sy.clean_day_fields({"title": " 2日目 "}, "update") == {"title": "2日目"}


def test_offline_day_event_and_order_in_one_batch_out_of_order(auth_client):
    client, owner, p, base, day, ev = _setup(auth_client)
    rev = _rev(client, p)
    ops = [
        # 送られた順は依存と逆(並び → 予定の作成 → 日程の作成)
        _op("order", "reorder", base_revision=rev, fields={"day_id": "tmp-day", "order": ["tmp-ev2", "tmp-ev1"]}),
        _op("event", "create", temp_id="tmp-ev1",
            fields={"day_id": "tmp-day", "title": "朝市", "local_start_time": "07:00"}),
        _op("event", "create", temp_id="tmp-ev2", fields={"day_id": "tmp-day", "title": "温泉"}),
        _op("day", "create", temp_id="tmp-day", fields={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo",
                                                        "title": "2日目"}),
        _op("reservation", "update", entity_id=str(uuid.uuid4()), base_revision=rev, fields={"status": "cancelled"}),
    ]
    r = client.post(f"{base}/sync", json={"device_id": "dev-1", "operations": ops})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert [x["status"] for x in res] == ["applied", "applied", "applied", "applied", "rejected"]
    assert res[4]["code"] == "online_required" and "本人確認" in res[4]["message"]
    days = client.get(f"/api/v1/plans/{p}").json()["days"]
    second = next(d for d in days if d["local_date"] == "2026-11-02")
    assert second["title"] == "2日目"
    assert [e["title"] for e in sorted(second["events"], key=lambda e: e["sort_order"])] == ["温泉", "朝市"]
    # 再送は二重に適用しない
    again = client.post(f"{base}/sync", json={"device_id": "dev-1", "operations": ops}).json()["results"]
    assert [x["status"] for x in again[:4]] == ["already_applied"] * 4
    assert len([d for d in client.get(f"/api/v1/plans/{p}").json()["days"] if d["local_date"] == "2026-11-02"]) == 1


def test_day_create_merges_existing_date_and_update_conflict(auth_client):
    client, owner, p, base, day, ev = _setup(auth_client)
    rev = _rev(client, p)
    r = client.post(f"{base}/sync", json={"operations": [
        _op("day", "create", temp_id="d1", fields={"local_date": "2026-11-01"}),
        _op("event", "create", temp_id="e1", fields={"day_id": "d1", "title": "追加"}),
    ]}).json()["results"]
    assert r[0]["status"] == "applied" and r[0]["code"] == "merged_existing" and r[0]["entity_id"] == day["id"]
    assert "追加" in _events(client, p)
    # 日程の名前: 端末とサーバーの両方で変えると競合
    cur = _rev(client, p)
    assert client.put(f"{base}/days/{day['id']}", json={"title": "サーバーで変えた"},
                      headers={"If-Match": str(cur)}).status_code == 200
    r = client.post(f"{base}/sync", json={"operations": [
        _op("day", "update", entity_id=day["id"], base_revision=rev, fields={"title": "端末で変えた"})]}).json()
    assert r["results"][0]["status"] == "conflicted" and r["results"][0]["code"] == "changed_on_server"
    conflicts = client.get(f"{base}/sync/conflicts").json()["conflicts"]
    c = next(x for x in conflicts if x["entity_type"] == "day")
    assert c["conflict"]["server"] == {"title": "サーバーで変えた"}
    cur = _rev(client, p)
    ok_ = client.post(f"{base}/sync/conflicts/{c['operation_id']}/resolve", json={"resolution": "use_mine"},
                      headers={"If-Match": str(cur)})
    assert ok_.status_code == 200 and ok_.json()["status"] == "resolved_mine"
    assert next(d for d in client.get(f"/api/v1/plans/{p}").json()["days"] if d["id"] == day["id"])["title"] == \
        "端末で変えた"


def test_order_conflict_when_server_added_event_and_locked(auth_client, db_session):
    client, owner, p, base, day, ev = _setup(auth_client)
    rev = _rev(client, p)
    # サーバーで予定が足された後の、古い並び
    assert client.post(f"{base}/events", json={"day_id": day["id"], "title": "サーバーの予定"},
                       headers=_ik()).status_code == 201
    mine = [ev["museum"]["id"], ev["lunch"]["id"], ev["temple"]["id"]]
    r = client.post(f"{base}/sync", json={"operations": [
        _op("order", "reorder", base_revision=rev, fields={"day_id": day["id"], "order": mine})]}).json()["results"][0]
    assert r["status"] == "conflicted" and r["code"] == "changed_on_server"
    conflict = next(x for x in client.get(f"{base}/sync/conflicts").json()["conflicts"] if x["entity_type"] == "order")
    assert "サーバーの予定" in [e["title"] for e in conflict["conflict"]["server"]["order"]]
    cur = _rev(client, p)
    still = client.post(f"{base}/sync/conflicts/{conflict['operation_id']}/resolve", json={"resolution": "use_mine"},
                        headers={"If-Match": str(cur)})
    assert still.status_code == 409 and still.json()["detail"]["code"] == "changed_on_server"
    assert client.post(f"{base}/sync/conflicts/{conflict['operation_id']}/resolve",
                       json={"resolution": "keep_server"}).json()["status"] == "resolved_server"
    # 確定(ロック)した予定は位置を変えない
    from app.models.models import TravelEvent

    db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(ev["temple"]["id"])).update({"locked": True})
    db_session.commit()
    events = sorted(client.get(f"/api/v1/plans/{p}").json()["days"][0]["events"], key=lambda e: e["sort_order"])
    ids = [e["id"] for e in events]
    moved = ids[1:] + ids[:1]
    r = client.post(f"{base}/sync", json={"operations": [
        _op("order", "reorder", base_revision=_rev(client, p), fields={"day_id": day["id"], "order": moved})]})
    assert r.json()["results"][0]["code"] == "locked"
    same = client.post(f"{base}/sync", json={"operations": [
        _op("order", "reorder", base_revision=_rev(client, p), fields={"day_id": day["id"], "order": ids})]})
    assert same.json()["results"][0]["code"] == "no_change"


def test_day_delete_only_when_empty_and_viewer_cannot_sync(auth_client, make_user, db_session):
    client, owner, p, base, day, ev = _setup(auth_client)
    rev = _rev(client, p)
    r = client.post(f"{base}/sync", json={"operations": [
        _op("day", "delete", entity_id=day["id"], base_revision=rev)]}).json()["results"][0]
    assert r["status"] == "rejected" and r["code"] == "day_not_empty"
    empty = client.post(f"{base}/days", json={"local_date": "2026-11-09", "timezone_id": "UTC"}, headers=_ik()).json()
    r = client.post(f"{base}/sync", json={"operations": [
        _op("day", "delete", entity_id=empty["id"], base_revision=_rev(client, p))]}).json()["results"][0]
    assert r["status"] == "applied"
    assert db_session.query(TravelDay).filter(TravelDay.id == uuid.UUID(empty["id"])).first() is None
    # 元に戻せる(変更セット source=sync)
    assert client.post(f"{base}/undo", headers={"If-Match": str(_rev(client, p))}).status_code == 200
    db_session.expire_all()
    assert db_session.query(TravelDay).filter(TravelDay.id == uuid.UUID(empty["id"])).first() is not None
    # 不正な組み合わせ・閲覧者
    bad = client.post(f"{base}/sync", json={"operations": [_op("order", "create", fields={})]})
    assert bad.status_code == 422
    viewer, _ = make_user()
    from app.models.models import PlanCollaborator
    from tests.test_gate_p11_sync import _act_as

    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    _act_as(viewer)
    assert client.post(f"{base}/sync", json={"operations": [
        _op("day", "create", temp_id="x", fields={"local_date": "2026-12-01"})]}).status_code == 403
    _act_as(owner)
    assert db_session.query(SyncOperation).filter(SyncOperation.user_id == viewer.id).count() == 0
