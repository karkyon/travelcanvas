"""
[Gate P13] FR-038 任意の位置軌跡の統合テスト(実PostgreSQL)。

検証する主な性質:
- 記録は明示的に開始し、位置情報の利用への同意(P9)と旅行の期間が必要。既定の保存先は「この端末だけ」(座標を送らない)
- 精度の選択で保存する座標を丸める。点は暗号化して保存し、DBに座標の平文が残らない
- 再送(同じbatch_id)は二重に保存しない。期間外・精度の悪い点・不正な点は理由ごとの件数だけ返す
- 一時停止・再開・停止(If-Match)。旅行の期間を過ぎたら自動で止まる。同意を撤回するとすぐ止まる
- 軌跡は本人だけのもの: 旅行の所有者を含む他の人には一覧・詳細・削除のどれからも見えない
- 任意の時間帯の点の削除・軌跡の削除。書き出しは本人の分だけ。アカウント削除で消える。監査に座標を残さない
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.api.v1 import location_tracks as api_mod
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import LocationPointBatch, LocationTrack, PlanCollaborator
from app.services import location_tracks as lt

NOW = datetime(2026, 11, 1, 1, 0, tzinfo=timezone.utc)  # 旅行1日目の10:00(Asia/Tokyo)


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(api_mod, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


@pytest.fixture
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(api_mod, "_now", lambda: state["now"])
    return state


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _consent(client, granted=True):
    r = client.put("/api/v1/privacy/consents", json={"consents": {"location": granted}})
    assert r.status_code == 200, r.text


def _setup(auth_client, days=True):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "軌跡テスト"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    if days:
        for d in ("2026-11-01", "2026-11-02"):
            client.post(f"{base}/days", json={"local_date": d, "timezone_id": "Asia/Tokyo"}, headers=_ik())
    return client, owner, p, base


def _pt(minutes, lat=34.994856, lng=135.785046, acc=8.0):
    return {"recorded_at": (NOW + timedelta(minutes=minutes)).isoformat(), "latitude": lat, "longitude": lng,
            "accuracy_m": acc}


# ---------------------------------------------------------------- 単体

def test_pure_functions():
    w = lt.trip_window([(date(2026, 11, 2), "Asia/Tokyo"), (date(2026, 11, 1), "Asia/Tokyo")], None, None)
    assert w == (datetime(2026, 10, 31, 15, tzinfo=timezone.utc), datetime(2026, 11, 2, 15, tzinfo=timezone.utc))
    assert lt.trip_window([], None, None) is None
    utc = timezone.utc
    by_dates = lt.trip_window([], datetime(2026, 11, 1, tzinfo=utc), datetime(2026, 11, 3, tzinfo=utc))
    assert by_dates[1] == datetime(2026, 11, 4, tzinfo=timezone.utc)
    pts, rej = lt.clean_points([
        _pt(5), _pt(1, lat=35.0, lng=135.0, acc=None), _pt(-30), _pt(10, acc=5000), {"recorded_at": "x"},
        {"recorded_at": "2026-11-01T10:00:00", "latitude": 1, "longitude": 1}, _pt(2, lat=91), "bad",
        _pt(3, acc=-1), _pt(4, lat=True),
    ], "low", NOW, NOW + timedelta(hours=1))
    assert [p["t"] for p in pts] == [_pt(1)["recorded_at"], _pt(5)["recorded_at"]]  # 時刻順
    assert pts[1] == {"t": _pt(5)["recorded_at"], "lat": 34.995, "lng": 135.785, "acc": 8.0}  # low=小数3桁
    assert rej == {"outside_period": 1, "low_accuracy": 1, "invalid": 6}
    assert lt.clean_points([_pt(0)], "high", NOW, NOW + timedelta(hours=1))[0][0]["lat"] == 34.99486
    d = lt.distance_m([{"t": "a", "lat": 35.0, "lng": 135.0}, {"t": "b", "lat": 35.01, "lng": 135.0}])
    assert 1100 < d < 1120
    keep, n = lt.split_range([{"t": _pt(m)["recorded_at"]} for m in (0, 5, 10)], NOW + timedelta(minutes=4),
                             NOW + timedelta(minutes=10))
    assert n == 2 and len(keep) == 1


# ---------------------------------------------------------------- API

def test_start_requires_consent_period_and_defaults(auth_client, clock):
    client, owner, p, base = _setup(auth_client)
    listed = client.get(f"{base}/location-tracks").json()
    assert listed["location_consent"] is False and listed["can_start"] is False and listed["in_trip_period"] is True
    r = client.post(f"{base}/location-tracks", json={})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "consent_required"
    _consent(client)
    clock["now"] = NOW - timedelta(days=3)
    r = client.post(f"{base}/location-tracks", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "outside_trip_period"
    clock["now"] = NOW
    r = client.post(f"{base}/location-tracks", json={})
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["mode"] == "device_only" and t["precision"] == "standard" and t["status"] == "recording"
    assert t["auto_stop_at"] == "2026-11-02T15:00:00+00:00"
    r = client.post(f"{base}/location-tracks", json={"mode": "synced"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "track_active"
    # この端末だけ: 座標はサーバーへ送れない
    one = {"batch_id": str(uuid.uuid4()), "points": [_pt(1)]}
    r = client.post(f"{base}/location-tracks/{t['id']}/points", json=one)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "device_only"
    for bad in ({"mode": "cloud"}, {"precision": "max"}, {"mode": "synced", "user_id": str(uuid.uuid4())}):
        assert client.post(f"{base}/location-tracks", json=bad).status_code == 422

    _c, _o, p2, base2 = _setup(auth_client, days=False)
    r = client.post(f"{base2}/location-tracks", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_trip_period"


def test_synced_points_encrypted_idempotent_and_lifecycle(auth_client, db_session, clock, audit_calls):
    client, owner, p, base = _setup(auth_client)
    _consent(client)
    t = client.post(f"{base}/location-tracks", json={"mode": "synced", "precision": "high"}).json()
    url = f"{base}/location-tracks/{t['id']}"
    batch = {"batch_id": str(uuid.uuid4()), "points": [_pt(1), _pt(2, lat=35.0), _pt(-60), _pt(3, acc=9999)]}
    r = client.post(f"{url}/points", json=batch)
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "rejected": {"outside_period": 1, "low_accuracy": 1}, "point_count": 2,
                        "replayed": False, "status": "recording"}
    again = client.post(f"{url}/points", json=batch).json()
    assert again["replayed"] is True and again["point_count"] == 2
    stored = db_session.query(LocationPointBatch).all()
    assert len(stored) == 1 and b"34.99" not in stored[0].points_ciphertext  # 暗号化して保存
    detail = client.get(url).json()
    assert [pt["latitude"] for pt in detail["points"]] == [34.99486, 35.0] and detail["distance_m"] > 500

    # 一時停止・再開・停止(If-Match)
    assert client.patch(url, json={"action": "pause"}).status_code == 400
    assert client.patch(url, json={"action": "pause"}, headers={"If-Match": "9"}).status_code == 409
    paused = client.patch(url, json={"action": "pause"}, headers={"If-Match": str(t["revision"])}).json()
    assert paused["status"] == "paused"
    r = client.post(f"{url}/points", json={"batch_id": str(uuid.uuid4()), "points": [_pt(5)]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "paused"
    resumed = client.patch(url, json={"action": "resume"}, headers={"If-Match": str(paused["revision"])}).json()
    assert resumed["status"] == "recording"
    r = client.patch(url, json={"action": "fly"}, headers={"If-Match": str(resumed["revision"])})
    assert r.status_code == 422
    stopped = client.patch(url, json={"action": "stop"}, headers={"If-Match": str(resumed["revision"])}).json()
    assert stopped["status"] == "stopped" and stopped["stopped_reason"] == "user"
    r = client.post(f"{url}/points", json={"batch_id": str(uuid.uuid4()), "points": [_pt(6)]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "stopped"
    assert all("34.99" not in str(c) and "135.78" not in str(c) for c in audit_calls)  # 監査に座標を残さない


def test_auto_stop_and_consent_withdrawal(auth_client, clock):
    client, owner, p, base = _setup(auth_client)
    _consent(client)
    t = client.post(f"{base}/location-tracks", json={"mode": "synced"}).json()
    clock["now"] = NOW + timedelta(days=3)
    listed = client.get(f"{base}/location-tracks").json()
    assert listed["tracks"][0]["status"] == "stopped" and listed["tracks"][0]["stopped_reason"] == "trip_ended"
    assert listed["can_start"] is False and listed["in_trip_period"] is False

    clock["now"] = NOW
    _c, _o, p2, base2 = _setup(auth_client)
    t2 = client.post(f"{base2}/location-tracks", json={"mode": "synced"}).json()
    _consent(client, False)  # 撤回で止まる(実時刻で止めるため、停止時刻は検査しない)
    got = client.get(f"{base2}/location-tracks/{t2['id']}").json()
    assert got["status"] == "stopped" and got["stopped_reason"] == "consent_withdrawn"
    one = {"batch_id": str(uuid.uuid4()), "points": [_pt(1)]}
    r = client.post(f"{base2}/location-tracks/{t2['id']}/points", json=one)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "consent_required"
    assert t["id"] != t2["id"]


def test_tracks_are_private_to_the_recorder(auth_client, make_user, db_session, clock):
    client, owner, p, base = _setup(auth_client)
    _consent(client)
    mine = client.post(f"{base}/location-tracks", json={"mode": "synced"}).json()
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    try:
        _act_as(viewer)
        listed = client.get(f"{base}/location-tracks").json()
        assert listed["tracks"] == [] and listed["active_track_id"] is None
        for method, path in (("get", ""), ("delete", ""), ("post", "/points")):
            kwargs = {"json": {"batch_id": str(uuid.uuid4()), "points": []}} if method == "post" else {}
            assert getattr(client, method)(f"{base}/location-tracks/{mine['id']}{path}", **kwargs).status_code == 404
        _consent(client)
        theirs = client.post(f"{base}/location-tracks", json={"mode": "synced"})
        assert theirs.status_code == 201  # 閲覧者も自分の軌跡は記録できる
        theirs_id = theirs.json()["id"]
    finally:
        _act_as(owner)
    # 旅行の所有者にも他の人の軌跡は見えない
    ids = [x["id"] for x in client.get(f"{base}/location-tracks").json()["tracks"]]
    assert ids == [mine["id"]]
    assert client.get(f"{base}/location-tracks/{theirs_id}").status_code == 404
    stranger, _ = make_user()
    try:
        _act_as(stranger)
        assert client.get(f"{base}/location-tracks").status_code == 403
    finally:
        _act_as(owner)


def test_delete_range_track_export_and_account_deletion(auth_client, make_user, db_session, clock):
    client, owner, p, base = _setup(auth_client)
    _consent(client)
    t = client.post(f"{base}/location-tracks", json={"mode": "synced", "precision": "standard"}).json()
    url = f"{base}/location-tracks/{t['id']}"
    b1 = {"batch_id": str(uuid.uuid4()), "points": [_pt(m) for m in (1, 2, 3)]}
    client.post(f"{url}/points", json=b1)
    client.post(f"{url}/points", json={"batch_id": str(uuid.uuid4()), "points": [_pt(m) for m in (10, 11)]})
    start = (NOW + timedelta(minutes=2)).isoformat()
    end = (NOW + timedelta(minutes=10)).isoformat()
    assert client.delete(f"{url}/points", params={"start": start, "end": "2026-11-01T10:00:00"}).status_code == 422
    r = client.delete(f"{url}/points", params={"start": start, "end": end})
    assert r.status_code == 200 and r.json()["removed"] == 3 and r.json()["point_count"] == 2
    remaining = [x["recorded_at"] for x in client.get(url).json()["points"]]
    assert remaining == [_pt(1)["recorded_at"], _pt(11)["recorded_at"]]
    # 消した点は同じbatch_idの再送で戻らない
    assert client.post(f"{url}/points", json=b1).json()["replayed"] is True
    assert client.get(url).json()["point_count"] == 2

    member, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=member.id, email=member.email, role="editor",
                                    status="accepted"))
    db_session.commit()
    try:
        _act_as(member)
        _consent(client)
        mt = client.post(f"{base}/location-tracks", json={"mode": "synced"}).json()
        client.post(f"{base}/location-tracks/{mt['id']}/points",
                    json={"batch_id": str(uuid.uuid4()), "points": [_pt(1, lat=10.0, lng=10.0)]})
    finally:
        _act_as(owner)

    exp = client.get(f"{base}/data-export").json()["plans"][0]["tables"]["location_tracks"]
    assert [x["id"] for x in exp] == [t["id"]] and len(exp[0]["points"]) == 2
    assert "points_ciphertext" not in str(exp)

    from app.services import account_deletion
    assert account_deletion.preview(db_session, member)["deleted_in_member_plans"]["location_tracks"] == 1
    summary = account_deletion.delete_account(db_session, member)
    db_session.commit()
    assert summary["location_tracks"] == 1
    assert db_session.query(LocationTrack).filter(LocationTrack.user_id == member.id).count() == 0

    assert client.delete(url).status_code == 204
    assert client.get(url).status_code == 404
    assert db_session.query(LocationPointBatch).count() == 0
