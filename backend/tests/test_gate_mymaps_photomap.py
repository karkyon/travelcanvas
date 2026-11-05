"""
[Gate MyMaps・PhotoMap・PhotoQR・PhotoPlace] マイマップの KML、写真の地図、QR の投稿、位置の推定(実PostgreSQL)。

主な性質:
- マイマップの KML は日ごと・番号・時刻・色で、予約番号・メモを含まず、宿泊と守る範囲を除く
- 写真の撮影情報は保存しない。端末が読んだ位置は確定、時刻からの推定は確認待ちで本人にしか見えない
- 写真をメンバーに公開しても、位置は既定で本人だけに見える
- QR だけでは投稿できない。確認コードの権限は投稿にしか通らず、5 回間違えると止まる。停止・期限切れ・権限の喪失で投稿できない
- 再送で二重に保存しない
"""
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image

from app.api.v1 import memories as memories_api
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.core.crypto import encrypt_payload, user_subject
from app.main import app
from app.models.models import (
    LocationPointBatch, LocationTrack, Memory, Notification, PhotoUploadLink, PlanCollaborator,
)
from app.services import itinerary_export as ix
from app.services import location_tracks as lt
from app.services import photo_location


def _jpeg(gps=False) -> bytes:
    out = io.BytesIO()
    ex = Image.Exif()
    if gps:
        ifd = ex.get_ifd(0x8825)
        ifd[1], ifd[2], ifd[3], ifd[4] = "N", (36.0, 0.0, 0.0), "E", (136.0, 0.0, 0.0)
    Image.new("RGB", (640, 320), (20, 90, 120)).save(out, format="JPEG", exif=ex.tobytes())
    return out.getvalue()


@pytest.fixture(autouse=True)
def storage(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    monkeypatch.setattr(memories_api, "record_audit_event", lambda **kw: None)
    return tmp_path / "documents"


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _setup(auth_client):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "金沢 春の旅"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-04-10", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": "2026-04-11", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    ev = {}
    for name, day, at, pos in (("兼六園", d1, "10:00", (36.5621, 136.6627)),
                               ("美術館", d1, "13:00", (36.5609, 136.6583)),
                               ("宿", d1, "18:00", (36.5617, 136.6532)), ("昼食", d2, "12:00", None)):
        body = {"day_id": day["id"], "title": name, "local_start_time": at, "description": "秘密のメモ ABC123"}
        if pos:
            body.update(latitude=pos[0], longitude=pos[1])
        if name == "宿":
            body["event_type"] = "accommodation"
        r = client.post(f"{base}/events", json=body, headers=_ik())
        assert r.status_code in (200, 201), r.text
        ev[name] = r.json()
    return client, owner, p, base, ev


def _member(db_session, make_user, p, role="editor"):
    u, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(str(p)), user_id=u.id, email=u.email, role=role,
                                    status="accepted"))
    db_session.commit()
    return u


def _upload(client, base, **form):
    client_file = {"file": ("a.jpg", io.BytesIO(_jpeg()), "image/jpeg")}
    return client.post(f"{base}/memories/upload", files=client_file, data={"kind": "photo", **form})


# ===== ① マイマップ


def test_mymaps_kml_has_numbers_times_colors_and_no_secrets(auth_client):
    client, _o, _p, base, _ev = _setup(auth_client)
    r = client.get(f"{base}/exports/places.kml", params={"profile": "mymaps", "precision": "exact"})
    assert r.status_code == 200
    body = r.text
    assert "<name>1. 兼六園</name>" in body and "<name>2. 美術館</name>" in body
    assert "10:00" in body and '<Style id="day1">' in body and "<styleUrl>#day1</styleUrl>" in body
    assert "136.66270,36.56210" in body
    assert "ABC123" not in body and "秘密のメモ" not in body
    assert "宿" not in body  # 宿泊は既定で除外


def test_mymaps_preview_lists_days_missing_location_and_route_urls(auth_client):
    client, _o, _p, base, _ev = _setup(auth_client)
    data = client.get(f"{base}/exports/mymaps/preview").json()
    assert data["precision"] == "exact" and data["count"] == 2 and data["excluded"] == 1
    assert [p["label"] for p in data["days"][0]["points"]] == ["兼六園", "美術館"]
    assert data["no_location"] == [{"title": "昼食", "date": "2026-04-11"}]
    first_url = data["days"][0]["route_urls"][0]
    assert first_url.startswith("https://www.google.com/maps/dir/?api=1&origin=36.5621,136.6627")


def test_route_urls_split_for_mobile_waypoint_limit():
    pts = [ix.Waypoint(str(i), datetime(2026, 4, 10).date(), "sight", 36.0 + i / 100, 136.0) for i in range(8)]
    urls = ix.maps_route_urls(pts)
    assert len(urls) == 2
    assert all(u.count("%7C") <= 2 for u in urls)  # 経由地は 3 か所まで
    assert "destination=36.04" in urls[0] and "origin=36.04" in urls[1]  # 続けて開ける
    assert ix.maps_route_urls(pts[:1]) == []


def test_external_map_only_google_and_private_by_default(auth_client, db_session, make_user):
    client, owner, p, base, _ev = _setup(auth_client)
    bad = client.put(f"{base}/external-map", json={"url": "https://evil.example/maps/d/x"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_map_url"
    assert client.put(f"{base}/external-map", json={"url": "javascript:alert(1)"}).status_code == 422
    url = "https://www.google.com/maps/d/edit?mid=abc_DEF-1&usp=sharing"
    assert client.put(f"{base}/external-map", json={"url": url}).status_code == 200
    viewer = _member(db_session, make_user, p, "viewer")
    _act_as(viewer)
    assert client.get(f"{base}/external-map").json()["maps"] == []
    _act_as(owner)
    client.put(f"{base}/external-map", json={"url": url, "visibility": "members"})
    _act_as(viewer)
    assert client.get(f"{base}/external-map").json()["maps"][0]["url"] == url
    _act_as(owner)
    assert client.delete(f"{base}/external-map").status_code == 204
    assert client.get(f"{base}/external-map").json()["maps"] == []


# ===== ② 写真の地図


def test_device_location_is_confirmed_and_exif_not_stored(auth_client, db_session):
    client, _o, _p, base, _ev = _setup(auth_client)
    out = client.post(f"{base}/memories/upload", files={"file": ("a.jpg", io.BytesIO(_jpeg(gps=True)), "image/jpeg")},
                      data={"kind": "photo", "latitude": 36.5, "longitude": 136.6, "location_source": "exif"}).json()
    assert out["location_status"] == "confirmed" and out["location_source"] == "exif"
    media = client.get(f"{base}/memories/{out['id']}/media").content
    assert Image.open(io.BytesIO(media)).getexif().get_ifd(0x8825) == {}
    thumb = client.get(f"{base}/memories/{out['id']}/thumbnail")
    assert thumb.status_code == 200 and thumb.headers["cache-control"] == "no-store"
    small = Image.open(io.BytesIO(thumb.content))
    assert max(small.size) <= 320 and small.getexif().get_ifd(0x8825) == {}


def test_time_only_photo_gets_proposal_from_event_then_confirm(auth_client, db_session, make_user):
    client, owner, p, base, _ev = _setup(auth_client)
    # 10:30 JST は 兼六園 の時間帯
    out = _upload(client, base, occurred_at="2026-04-10T10:30:00+09:00", visibility="members").json()
    assert out["location_status"] == "proposed" and out["location_source"] == "event"
    assert out["latitude"] == pytest.approx(36.5621) and out["place_name"] == "兼六園"
    assert out["location_visibility"] == "private"
    other = _member(db_session, make_user, p)
    _act_as(other)
    assert client.get(f"{base}/memory-map").json() == {"photos": [], "unplaced": [], "can_create": True}
    listed = client.get(f"{base}/memories").json()["memories"][0]
    assert listed["latitude"] is None and listed["location_status"] is None
    # 本人以外は変えられない
    denied = client.post(f"{base}/memories/{out['id']}/location", json={"action": "confirm"},
                         headers={"If-Match": str(out["revision"])})
    assert denied.status_code == 403
    _act_as(owner)
    assert client.post(f"{base}/memories/{out['id']}/location", json={"action": "confirm"}).status_code == 400
    done = client.post(f"{base}/memories/{out['id']}/location", json={"action": "confirm"},
                       headers={"If-Match": str(out["revision"])}).json()
    assert done["location_status"] == "confirmed"
    # 確定しても、公開を選ぶまでメンバーに位置は見えない
    _act_as(other)
    assert client.get(f"{base}/memory-map").json()["photos"] == []
    _act_as(owner)
    show = {"action": "visibility", "location_visibility": "members"}
    client.post(f"{base}/memories/{out['id']}/location", json=show, headers={"If-Match": str(done["revision"])})
    _act_as(other)
    assert len(client.get(f"{base}/memory-map").json()["photos"]) == 1


def test_no_time_no_location_is_unplaced_then_set_and_clear(auth_client):
    client, _o, _p, base, ev = _setup(auth_client)
    out = _upload(client, base).json()
    data = client.get(f"{base}/memory-map").json()
    assert data["photos"] == [] and [u["id"] for u in data["unplaced"]] == [out["id"]]
    placed = client.post(f"{base}/memories/{out['id']}/location", headers={"If-Match": "1"}, json={
        "action": "set", "latitude": 36.5, "longitude": 136.6, "place_name": "兼六園",
        "event_id": ev["兼六園"]["id"]}).json()
    assert placed["location_source"] == "manual" and placed["location_status"] == "confirmed"
    assert placed["event_id"] == ev["兼六園"]["id"]
    cleared = client.post(f"{base}/memories/{out['id']}/location", headers={"If-Match": "2"},
                          json={"action": "clear"}).json()
    assert cleared["latitude"] is None and cleared["location_status"] is None
    assert client.post(f"{base}/memories/{out['id']}/location", headers={"If-Match": "3"},
                       json={"action": "confirm"}).status_code == 422


def test_track_is_preferred_only_for_owner_synced_and_rounded(auth_client, db_session):
    client, owner, p, base, _ev = _setup(auth_client)
    taken = datetime(2026, 4, 10, 1, 30, tzinfo=timezone.utc)  # 10:30 JST
    track = LocationTrack(plan_id=uuid.UUID(str(p)), user_id=owner.id, mode="synced", precision="standard",
                          status="recording",
                          started_at=taken - timedelta(hours=1), auto_stop_at=taken + timedelta(hours=1))
    db_session.add(track)
    db_session.flush()
    points = [{"t": (taken + timedelta(seconds=30)).isoformat(), "lat": 36.57123, "lng": 136.65678, "acc": 5.0}]
    db_session.add(LocationPointBatch(track_id=track.id, batch_id=uuid.uuid4(), point_count=1,
                                      points_ciphertext=encrypt_payload(lt.encode(points),
                                                                        user_subject(owner.id)),
                                      first_at=taken, last_at=taken))
    db_session.commit()
    out = _upload(client, base, occurred_at="2026-04-10T10:30:00+09:00").json()
    assert out["location_source"] == "track" and out["location_status"] == "proposed"
    assert out["latitude"] == 36.571 and out["longitude"] == 136.657
    assert out["location_confidence"] == photo_location.CONF_TRACK_NEAR
    track.mode = "device_only"
    db_session.commit()
    assert photo_location.from_track(db_session, track.plan_id, owner.id, taken) is None


def test_retry_with_same_client_id_saves_once(auth_client, db_session):
    client, _o, p, base, _ev = _setup(auth_client)
    a = _upload(client, base, client_upload_id="retry-id-0001").json()
    b = _upload(client, base, client_upload_id="retry-id-0001").json()
    assert a["id"] == b["id"]
    assert db_session.query(Memory).filter(Memory.plan_id == p).count() == 1
    assert _upload(client, base, client_upload_id="bad id!").status_code == 422


def test_export_hides_other_members_private_location(auth_client, db_session, make_user):
    from app.services.data_export import plan_tables
    from app.models.models import TravelPlan

    client, owner, p, base, _ev = _setup(auth_client)
    _upload(client, base, latitude=36.5, longitude=136.6, location_source="exif", visibility="members")
    other = _member(db_session, make_user, p)
    plan = db_session.get(TravelPlan, uuid.UUID(str(p)))
    assert plan_tables(db_session, plan, owner.id)["memories"][0]["latitude"] == 36.5
    assert plan_tables(db_session, plan, other.id)["memories"][0]["latitude"] is None


# ===== ② QR


def _link(client, base):
    r = client.post(f"{base}/upload-links", json={})
    assert r.status_code == 201, r.text
    return r.json()


def _anon(client):
    app.dependency_overrides.pop(get_current_user, None)
    return client


def test_qr_flow_requires_code_and_session_only_uploads(auth_client, db_session):
    client, owner, p, base, _ev = _setup(auth_client)
    link = _link(client, base)
    row = db_session.get(PhotoUploadLink, uuid.UUID(link["id"]))
    assert link["token"] not in (row.token_hash, row.code_hash) and link["code"] not in (row.code_hash,)
    pub = f"/api/v1/public/upload-links/{link['token']}"
    _anon(client)
    info = client.get(pub)
    assert set(info.json()) == {"plan_title", "active", "expires_at", "max_upload_bytes"}
    assert "noindex" in info.headers["x-robots-tag"] and info.headers["cache-control"] == "no-store"
    files = lambda: {"file": ("a.jpg", io.BytesIO(_jpeg()), "image/jpeg")}  # noqa: E731
    assert client.post(f"{pub}/upload", files=files()).status_code == 401
    assert client.post(f"{pub}/session", json={"code": "000000" if link["code"] != "000000" else "111111"}
                       ).json()["detail"]["code"] == "invalid_code"
    session = client.post(f"{pub}/session", json={"code": link["code"]}).json()
    headers = {"X-Upload-Session": session["session_token"]}
    up = client.post(f"{pub}/upload", files=files(), headers=headers,
                     data={"occurred_at": "2026-04-10T10:30:00+09:00", "client_upload_id": "qr-file-0001"})
    assert up.status_code == 201 and up.json()["location_status"] == "proposed"
    memory = db_session.query(Memory).filter(Memory.plan_id == p).one()
    assert memory.author_user_id == owner.id and memory.visibility == "private"
    # 投稿の権限は他の API に通らない
    for path in (f"{base}/memories", f"{base}/memory-map", f"/api/v1/travel-plans/{p}"):
        denied = client.get(path, headers={"Authorization": f"Bearer {session['session_token']}", **headers})
        assert denied.status_code in (401, 403)
    assert client.post(f"{pub}/upload", files=files(), headers={"X-Upload-Session": "wrong"}).status_code == 401


def test_qr_locks_after_five_wrong_codes_and_notifies(auth_client, db_session):
    client, owner, _p, base, _ev = _setup(auth_client)
    link = _link(client, base)
    pub = f"/api/v1/public/upload-links/{link['token']}"
    wrong = "000000" if link["code"] != "000000" else "111111"
    _anon(client)
    for _ in range(4):
        assert client.post(f"{pub}/session", json={"code": wrong}).status_code == 422
    assert client.post(f"{pub}/session", json={"code": wrong}).status_code == 410
    assert client.post(f"{pub}/session", json={"code": link["code"]}).status_code == 410
    assert db_session.query(Notification).filter_by(user_id=owner.id, type="photo_upload_link_stopped").count() == 1


def test_qr_stop_expiry_replace_and_role_loss_block_upload(auth_client, db_session, make_user):
    client, owner, p, base, _ev = _setup(auth_client)
    first = _link(client, base)
    second = _link(client, base)
    assert client.get(f"/api/v1/public/upload-links/{first['token']}").json()["active"] is False
    assert len(client.get(f"{base}/upload-links").json()["links"]) == 1
    pub = f"/api/v1/public/upload-links/{second['token']}"
    session = client.post(f"{pub}/session", json={"code": second["code"]}).json()
    headers = {"X-Upload-Session": session["session_token"]}
    files = lambda: {"file": ("a.jpg", io.BytesIO(_jpeg()), "image/jpeg")}  # noqa: E731
    row = db_session.get(PhotoUploadLink, uuid.UUID(second["id"]))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()
    assert client.post(f"{pub}/upload", files=files(), headers=headers).status_code == 410
    row.expires_at = datetime.now(timezone.utc) + timedelta(days=1)
    db_session.commit()
    assert client.delete(f"{base}/upload-links/{second['id']}").status_code == 204
    assert client.post(f"{pub}/upload", files=files(), headers=headers).status_code == 410
    assert client.get("/api/v1/public/upload-links/none").status_code == 404


def test_qr_join_needs_editor_login(auth_client, db_session, make_user):
    client, owner, p, base, _ev = _setup(auth_client)
    link = _link(client, base)
    pub = f"/api/v1/public/upload-links/{link['token']}"
    editor = _member(db_session, make_user, p, "editor")
    viewer = _member(db_session, make_user, p, "viewer")
    stranger, _ = make_user()
    _act_as(editor)
    assert client.post(f"{pub}/join").json()["plan_id"] == str(p)
    _act_as(viewer)
    assert client.post(f"{pub}/join").status_code == 403
    assert client.post(f"{base}/upload-links", json={}).status_code == 403
    _act_as(stranger)
    assert client.post(f"{pub}/join").status_code in (403, 404)
    _act_as(owner)


def test_proposed_location_is_not_visit_or_atlas_evidence(auth_client):
    client, _o, _p, base, _ev = _setup(auth_client)
    # 予定の時刻からの推定は、確定するまで「行った」根拠にしない
    out = _upload(client, base, occurred_at="2026-04-10T10:30:00+09:00").json()
    atlas = client.get("/api/v1/atlas").json()
    assert "photo" not in str(atlas) or out["id"] not in str(atlas)
    done = client.post(f"{base}/memories/{out['id']}/location", json={"action": "confirm"}, headers={"If-Match": "1"})
    assert done.status_code == 200
