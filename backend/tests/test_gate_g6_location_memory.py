"""[Gate G6] LOC-02 守る範囲と位置のぼかし(書き出し・旅行記) / MEM-01 旅行記の公開・失効・記録の削除の取り消し。"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import itinerary_export as export_api
from app.api.v1 import memories as memories_api
from app.api.v1 import memory_publish as publish_api
from app.api.v1 import privacy_zones as zones_api
from app.models.models import Memory, MemoryPublication, MemoryTrash, PrivacyZone
from app.services import location_privacy as lp

from tests.test_gate_p12_memories import PNG, _act_as, _member, _setup, _upload, storage  # noqa: F401


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    for mod in (memories_api, publish_api, zones_api, export_api):
        if hasattr(mod, "record_audit_event"):
            monkeypatch.setattr(mod, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(publish_api, "check_rate_limit", lambda *a, **kw: True)


HOME = (35.0116, 135.7681)


# ---------------------------------------------------------------- LOC-02 純粋関数

def test_zones_and_track_projection():
    zones = [(HOME[0], HOME[1], 300)]
    assert lp.in_zones(35.0117, 135.7682, zones) and not lp.in_zones(35.05, 135.80, zones)
    assert lp.project_point(35.0117, 135.7682, zones) == (None, None)
    assert lp.project_point(35.123456, 135.654321, zones, 3) == (35.123, 135.654)
    # 自宅から出て、1km 先まで行って戻る軌跡: 両端と自宅の周りは出さず、格子(約1km)にまとめる
    pts = [{"t": f"2026-11-01T09:{i:02d}:00Z", "lat": HOME[0] + i * 0.001, "lng": HOME[1]} for i in range(0, 30)]
    pts += [{"t": f"2026-11-01T10:{i:02d}:00Z", "lat": HOME[0] + (29 - i) * 0.001, "lng": HOME[1]} for i in range(30)]
    out = lp.project_track(pts, zones)
    assert out and all(not lp.in_zones(p["lat"], p["lng"], zones) for p in out)
    assert all(round(p["lat"], 2) == p["lat"] for p in out)
    assert all(abs(p["lat"] - HOME[0]) > 0.003 for p in out)  # 出発・帰着の近くは出ない
    assert lp.project_track(pts[:2], []) == []  # 300m 未満の軌跡は何も出さない
    assert lp.in_zones(1.0, 1.0, [(0.0, 0.0, -1)])  # 読めない範囲は全てを除く
    for bad in (("", 1, 1, 500), ("自宅", 91, 1, 500), ("自宅", 1, 1, 50), ("自宅", 1, 1, True)):
        with pytest.raises(lp.ZoneInputError):
            lp.clean_zone(*bad)


def test_privacy_zone_api_is_encrypted_and_own_only(auth_client, make_user, db_session):
    client, owner = auth_client
    r = client.post("/api/v1/privacy-zones", json={"label": "自宅", "latitude": HOME[0], "longitude": HOME[1],
                                                   "radius_m": 300})
    assert r.status_code == 201, r.text
    zid = r.json()["id"]
    row = db_session.query(PrivacyZone).filter(PrivacyZone.id == uuid.UUID(zid)).one()
    assert str(HOME[0]).encode() not in row.center_ciphertext  # 中心は暗号文だけ
    listed = client.get("/api/v1/privacy-zones").json()
    assert listed["zones"][0]["latitude"] == HOME[0] and listed["zones"][0]["readable"]
    assert client.post("/api/v1/privacy-zones", json={"label": "x", "latitude": 1, "longitude": 1,
                                                      "radius_m": 99999}).status_code == 422
    other, _ = make_user()
    _act_as(other)
    assert client.get("/api/v1/privacy-zones").json()["zones"] == []
    assert client.delete(f"/api/v1/privacy-zones/{zid}").status_code == 404
    _act_as(owner)
    assert client.delete(f"/api/v1/privacy-zones/{zid}").status_code == 200


def test_gpx_export_drops_points_in_owner_zones(auth_client, make_user, db_session):
    client, owner, p, base, days, ev = _setup(auth_client)
    rev = client.get(f"/api/v1/plans/{p}").json()["revision"]
    for name, (lat, lng) in (("清水寺", (34.9949, 135.7850)), ("昼食", (HOME[0] + 0.0005, HOME[1]))):
        r = client.put(f"{base}/events/{ev[name]['id']}", json={"latitude": lat, "longitude": lng},
                       headers={"If-Match": str(rev)})
        assert r.status_code == 200, r.text
        rev = client.get(f"/api/v1/plans/{p}").json()["revision"]
    before = client.get(f"{base}/exports/places.gpx")
    assert before.headers["x-export-count"] == "2"
    client.post("/api/v1/privacy-zones", json={"label": "自宅", "latitude": HOME[0], "longitude": HOME[1],
                                               "radius_m": 300})
    after = client.get(f"{base}/exports/places.gpx")
    assert after.headers["x-export-count"] == "1" and "135.768" not in after.text and "昼食" not in after.text
    # メンバーが書き出しても、所有者の守る範囲は外す
    member = _member(db_session, make_user, p, role="viewer")
    _act_as(member)
    kml = client.get(f"{base}/exports/places.kml")
    assert kml.status_code == 200 and "昼食" not in kml.text and "清水寺" in kml.text
    _act_as(owner)


# ---------------------------------------------------------------- MEM-01

def _note(client, base, body, **kw):
    r = client.post(f"{base}/memories", json={"body": body, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_publish_requires_acknowledgement_and_hides_coordinates(auth_client, make_user, db_session):
    client, owner, p, base, days, ev = _setup(auth_client)
    member = _member(db_session, make_user, p, username="hanako")
    _note(client, base, "清水寺は朝が静か", event_id=ev["清水寺"]["id"], place_name="清水の舞台",
          latitude=34.9949, longitude=135.7850)
    _note(client, base, "家の近くのパン屋", place_name="自宅の近所", latitude=HOME[0], longitude=HOME[1])
    _note(client, base, "予約番号 ABC12345 を控えた hanako と")
    photo = _upload(client, base, event_id=ev["美術館"]["id"]).json()
    client.post("/api/v1/privacy-zones", json={"label": "自宅", "latitude": HOME[0], "longitude": HOME[1],
                                               "radius_m": 500})
    _act_as(member)
    _note(client, base, "他の人の記録(公開しない)", visibility="members")
    _act_as(owner)

    pre = client.post(f"{base}/memories/publications/preview", json={"location_level": "area",
                                                                     "include_photos": True}).json()
    codes = {a["code"] for a in pre["required_acknowledgements"]}
    assert {"photo_people", "member_name", "reservation_like", "place_names"} <= codes
    text = json.dumps(pre, ensure_ascii=False)
    assert "135.785" not in text and "34.9949" not in text and "他の人の記録" not in text
    assert "清水の舞台" in text and "自宅の近所" not in text and pre["hidden_places"] == 1
    assert pre["photo_ids"] == [photo["id"]]

    missing = client.post(f"{base}/memories/publications", json={"location_level": "area", "include_photos": True,
                                                                 "acknowledge": ["photo_people"]})
    assert missing.status_code == 422 and missing.json()["detail"]["code"] == "acknowledgement_required"
    r = client.post(f"{base}/memories/publications", json={"location_level": "area", "include_photos": True,
                                                           "acknowledge": sorted(codes), "title": "京都の旅行記"})
    assert r.status_code == 201, r.text
    pub = r.json()
    token = pub["url"].rsplit("/", 1)[-1]
    row = db_session.query(MemoryPublication).filter(MemoryPublication.id == uuid.UUID(pub["id"])).one()
    assert row.token_hash != token and token not in json.dumps(row.snapshot, ensure_ascii=False)
    assert row.acknowledged["codes"]

    # 公開の閲覧(資格情報なし)
    from app.core.auth import get_current_user
    from app.main import app

    app.dependency_overrides.pop(get_current_user, None)
    view = client.get(f"/api/v1/public/journal/{token}")
    assert view.status_code == 200 and view.headers["x-robots-tag"].startswith("noindex")
    assert view.headers["cache-control"] == "no-store"
    vtext = view.text
    assert "京都の旅行記" in vtext and "清水寺は朝が静か" in vtext and "135.785" not in vtext
    assert "他の人の記録" not in vtext and "latitude\": 3" not in vtext
    img = client.get(f"/api/v1/public/journal/{token}/photos/{photo['id']}")
    assert img.status_code == 200 and img.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"/api/v1/public/journal/{token}/photos/{uuid.uuid4()}").status_code == 404
    assert client.get("/api/v1/public/journal/wrongtoken").status_code == 404

    # 失効するとすぐ開けない
    _act_as(owner)
    assert client.delete(f"{base}/memories/publications/{pub['id']}").json()["is_active"] is False
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get(f"/api/v1/public/journal/{token}").status_code == 404
    assert client.get(f"/api/v1/public/journal/{token}/photos/{photo['id']}").status_code == 404
    _act_as(owner)
    assert client.get(f"{base}/memories/publications").json()[0]["view_count"] == 1


def test_publish_none_location_and_guest_cannot_publish(auth_client, db_session):
    client, owner, p, base, days, ev = _setup(auth_client)
    _note(client, base, "メモだけ", place_name="どこか", latitude=34.9, longitude=135.7)
    pre = client.post(f"{base}/memories/publications/preview", json={"location_level": "none"}).json()
    assert "どこか" not in json.dumps(pre, ensure_ascii=False) and pre["required_acknowledgements"] == []
    assert pre["route"] if "route" in pre else True
    r = client.post(f"{base}/memories/publications", json={"location_level": "none"})
    assert r.status_code == 201 and r.json()["include_photos"] is False
    assert client.post(f"{base}/memories/publications", json={"location_level": "exact"}).status_code == 422
    owner.user_type = "guest"
    db_session.flush()
    g = client.post(f"{base}/memories/publications", json={"location_level": "none"})
    assert g.status_code == 403 and g.json()["detail"]["code"] == "members_only"


def test_memory_delete_can_be_restored_then_purged(auth_client, make_user, db_session, storage):  # noqa: F811
    client, owner, p, base, days, ev = _setup(auth_client)
    note = _note(client, base, "消して戻すメモ", place_name="駅")
    photo = _upload(client, base).json()
    d = client.delete(f"{base}/memories/{note['id']}")
    assert d.status_code == 204 and d.headers["x-restore-until"]
    assert client.delete(f"{base}/memories/{photo['id']}").status_code == 204
    trash = db_session.query(MemoryTrash).filter(MemoryTrash.memory_id == uuid.UUID(note["id"])).one()
    assert b"\xe6\xb6\x88" not in trash.row_ciphertext  # 本文は暗号文だけ
    listed = client.get(f"{base}/memories/trash").json()
    assert {x["memory_id"] for x in listed} == {note["id"], photo["id"]}
    assert next(x for x in listed if x["memory_id"] == note["id"])["summary"] == "消して戻すメモ"
    # 他のメンバーは戻せない
    other = _member(db_session, make_user, p)
    _act_as(other)
    assert client.post(f"{base}/memories/{note['id']}/restore").status_code == 404
    _act_as(owner)
    r = client.post(f"{base}/memories/{note['id']}/restore")
    assert r.status_code == 201
    restored = db_session.query(Memory).filter(Memory.id == uuid.UUID(note["id"])).one()
    assert restored.body == "消して戻すメモ" and restored.place_name == "駅" and restored.revision == 2
    assert client.post(f"{base}/memories/{note['id']}/restore").status_code == 404
    # 期限の後は定期の処理がファイルごと消し、戻せない
    later = datetime.now(timezone.utc) + timedelta(days=8)
    result = publish_api.purge_trash(db_session, later)
    assert result == {"purged": 1, "files": 1, "failed": 0}
    assert list(storage.rglob("*.png")) == []
    assert client.post(f"{base}/memories/{photo['id']}/restore").status_code == 404
    assert PNG  # 写真の中身は保管の間だけ残る
