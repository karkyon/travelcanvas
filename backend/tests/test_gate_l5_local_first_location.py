"""[Gate L5] FR-055 Local-first Location(DOC-15 CA-013)・FR-056 適応型GPS(CA-014)の統合テスト(実PostgreSQL)。

- 旅行ごとの位置の扱い: 未選択(初期は記録していない)/ 記録しない / この端末だけ / 訪問地域だけ同期 / 暗号化して同期。
  「記録しない」では始められず、記録中に「記録しない」へ変えると止まる。保存先の違う軌跡は始められない。If-Match
- 訪問地域だけ同期: 生の座標は受けない(points は 409)。区画(0.1度の格子)と滞在時間だけを受け、格子に乗らない・
  期間外・滞在が時間幅より長い区画は拒否。送り直しても増えず、合わせる(広げる・大きい方)
- 区画は Atlas に滞在時間に応じた状態で載る。本人以外には見えない。書き出し・時間帯の削除・軌跡の削除・アカウント削除
- 記録の観測値: 数値だけを受け、座標・知らない項目は拒否。欠測率・電池の消費を計算する
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import location_tracks as api_mod
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import LocationAreaCell, PlanCollaborator, TripLocationSetting
from app.services import location_tracks as lt

NOW = datetime(2026, 11, 1, 1, 0, tzinfo=timezone.utc)


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


def _setup(auth_client):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "L5"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    for d in ("2026-11-01", "2026-11-02"):
        client.post(f"{base}/days", json={"local_date": d, "timezone_id": "Asia/Tokyo"}, headers=_ik())
    r = client.put("/api/v1/privacy/consents", json={"consents": {"location": True}})
    assert r.status_code == 200, r.text
    return client, owner, p, base


def _set_mode(client, base, mode, rev):
    return client.put(f"{base}/location-settings", json={"mode": mode}, headers={"If-Match": str(rev)})


def _cell(key, start_min, end_min, dwell, samples=3):
    return {"key": key, "first_at": (NOW + timedelta(minutes=start_min)).isoformat(),
            "last_at": (NOW + timedelta(minutes=end_min)).isoformat(), "dwell_seconds": dwell, "samples": samples}


def test_pure_cells_and_sampling():
    assert lt.valid_cell_key("0.1:34.9:135.7") and lt.valid_cell_key("0.1:-0.1:-180.0")
    for bad in ("0.1:34.95:135.7", "1:34:135", "0.1:91.0:0.0", "0.1:34.9:180.0", 5, "0.1:34.9"):
        assert not lt.valid_cell_key(bad)
    assert lt.cell_center("0.1:34.9:135.7") == (34.95, 135.75)
    assert [lt.area_state(s) for s in (0, 599, 600, 1799, 1800)] == \
        ["PASS_THROUGH", "PASS_THROUGH", "VISITED", "VISITED", "STAYED"]
    cells, rej = lt.clean_cells([
        _cell("0.1:34.9:135.7", 0, 40, 2000), _cell("0.1:34.9:135.7", 50, 60, 100),
        _cell("0.1:35.0:135.7", 0, 5, 9999),
        _cell("0.1:35.0:135.8", -60, -50, 10), {"key": "bad"}, "x", _cell("0.1:35.1:135.7", 10, 5, 0),
    ], NOW, NOW + timedelta(hours=3))
    assert len(cells) == 1 and cells[0]["dwell_seconds"] == 2000
    assert cells[0]["last_at"] == NOW + timedelta(minutes=60)
    assert rej == {"invalid": 4, "outside_period": 1}
    s = lt.clean_sampling({"battery_start": 0.8, "battery_end": 0.65, "expected_samples": 100, "kept_samples": 90,
                           "missed_samples": 10, "manual_points": 1, "max_gap_seconds": 600,
                           "tier_seconds": {"moving": 300, "stationary": 1200}})
    assert s["missed_ratio"] == 0.1 and s["battery_used"] == 0.15
    assert lt.clean_sampling({"charging_seen": True, "battery_start": 0.2, "battery_end": 0.9})["battery_used"] is None
    for bad in ({"latitude": 35.0}, {"battery_start": 2}, {"tier_seconds": {"walking": 1}}, {"kept_samples": -1},
                {"expected_samples": True}, []):
        with pytest.raises(lt.TrackInputError):
            lt.clean_sampling(bad)


def test_trip_mode_controls_recording(auth_client, clock, db_session):
    client, owner, p, base = _setup(auth_client)
    st = client.get(f"{base}/location-settings").json()
    assert st == {"mode": None, "revision": 0, "updated_at": None}
    assert client.get(f"{base}/location-tracks").json()["trip_mode"] is None

    assert client.put(f"{base}/location-settings", json={"mode": "off"}).status_code == 400  # If-Match が要る
    assert _set_mode(client, base, "everywhere", 0).status_code == 422
    r = _set_mode(client, base, "off", 0)
    assert r.status_code == 200 and r.json()["mode"] == "off" and r.json()["revision"] == 1
    assert _set_mode(client, base, "synced", 0).status_code == 409  # 古い revision
    listing = client.get(f"{base}/location-tracks").json()
    assert listing["trip_mode"] == "off" and listing["can_start"] is False
    r = client.post(f"{base}/location-tracks", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "location_off"

    assert _set_mode(client, base, "areas_only", 1).json()["revision"] == 2
    r = client.post(f"{base}/location-tracks", json={"mode": "synced"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "mode_mismatch"
    t = client.post(f"{base}/location-tracks", json={}).json()
    assert t["mode"] == "areas_only" and t["status"] == "recording" and t["sampling"] is None
    # 記録中は保存先を変えられない。「記録しない」にすると止まる
    r = _set_mode(client, base, "synced", 2)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "track_active"
    r = _set_mode(client, base, "off", 2)
    assert r.json()["stopped_tracks"] == 1
    stopped = client.get(f"{base}/location-tracks/{t['id']}").json()
    assert stopped["status"] == "stopped" and stopped["stopped_reason"] == "mode_off"


def test_first_start_records_the_choice(auth_client, clock, db_session):
    client, owner, p, base = _setup(auth_client)
    t = client.post(f"{base}/location-tracks", json={"mode": "synced"}).json()
    assert t["mode"] == "synced"
    assert client.get(f"{base}/location-settings").json()["mode"] == "synced"
    row = db_session.query(TripLocationSetting).filter(TripLocationSetting.plan_id == uuid.UUID(p)).one()
    assert row.user_id == owner.id


def test_areas_only_accepts_cells_not_points(auth_client, clock, db_session, make_user):
    client, owner, p, base = _setup(auth_client)
    _set_mode(client, base, "areas_only", 0)
    t = client.post(f"{base}/location-tracks", json={}).json()
    tb = f"{base}/location-tracks/{t['id']}"
    r = client.post(f"{tb}/points", json={"batch_id": str(uuid.uuid4()), "points": [
        {"recorded_at": NOW.isoformat(), "latitude": 35.0, "longitude": 135.7, "accuracy_m": 5}]})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "areas_only"

    cells = [_cell("0.1:34.9:135.7", 0, 50, 2400), _cell("0.1:35.0:135.7", 55, 60, 120),
             _cell("0.1:34.95:1.0", 0, 1, 0)]
    r = client.post(f"{tb}/area-cells", json={"cells": cells})
    assert r.status_code == 200, r.text
    assert r.json() == {"added": 2, "updated": 0, "rejected": {"invalid": 1}, "cell_count": 2, "status": "recording"}
    # 送り直しても増えない。合わせる
    r = client.post(f"{tb}/area-cells", json={"cells": [_cell("0.1:35.0:135.7", 55, 90, 900, samples=9)]})
    assert r.json()["added"] == 0 and r.json()["updated"] == 1 and r.json()["cell_count"] == 2
    detail = client.get(tb).json()
    assert detail["points"] == [] and detail["point_count"] == 0
    states = {c["key"]: c["state"] for c in detail["cells"]}
    assert states == {"0.1:34.9:135.7": "STAYED", "0.1:35.0:135.7": "VISITED"}
    # DB に座標の値は無い(区画の印と時刻・件数だけ)
    row = db_session.query(LocationAreaCell).filter(LocationAreaCell.cell_key == "0.1:35.0:135.7").one()
    assert row.dwell_seconds == 900 and row.samples == 9

    # Atlas に載る(滞在時間に応じた状態、根拠の種類は area)
    atlas = client.get("/api/v1/atlas", params={"precision": "region"}).json()
    by_key = {c["key"]: c for c in atlas["cells"]}
    assert by_key["0.1:34.9:135.7"]["state"] == "STAYED" and by_key["0.1:34.9:135.7"]["evidence"] == {"area": 1}

    # 本人以外(旅行の所有者でない共同編集者)には見えない
    other, _pw = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=other.id, email=other.email, role="editor",
                                    status="accepted"))
    db_session.commit()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=other, is_authenticated=True, is_guest=False)
    assert client.get(tb).status_code == 404
    assert client.post(f"{tb}/area-cells", json={"cells": cells[:1]}).status_code == 404
    assert client.get(f"{base}/location-settings").json()["mode"] is None
    atlas_other = client.get("/api/v1/atlas", params={"precision": "region"}).json()
    assert all("area" not in c["evidence"] for c in atlas_other["cells"])
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=owner, is_authenticated=True, is_guest=False)

    # 書き出し(本人の分): 区画と設定が含まれる
    export = client.get(f"/api/v1/plans/{p}/data-export")
    assert export.status_code == 200, export.text
    import json as _json
    text = export.content.decode("utf-8")
    assert '"area_cells"' in text and "0.1:34.9:135.7" in text and '"location_settings"' in text
    assert _json.loads(text)

    # 時間帯の削除: 重なる区画を消す
    r = client.delete(f"{tb}/points", params={"start": (NOW + timedelta(minutes=58)).isoformat(),
                                              "end": (NOW + timedelta(minutes=59)).isoformat()})
    assert r.json()["removed"] == 1
    assert [c["key"] for c in client.get(tb).json()["cells"]] == ["0.1:34.9:135.7"]
    # 軌跡を消すと区画も消える
    assert client.delete(tb).status_code == 204
    assert db_session.query(LocationAreaCell).filter(LocationAreaCell.plan_id == uuid.UUID(p)).count() == 0


def test_cells_require_areas_only_and_period_and_consent(auth_client, clock):
    client, owner, p, base = _setup(auth_client)
    t = client.post(f"{base}/location-tracks", json={"mode": "device_only"}).json()
    one = [_cell("0.1:34.9:135.7", 0, 1, 0)]
    r = client.post(f"{base}/location-tracks/{t['id']}/area-cells", json={"cells": one})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_areas_only"
    client.patch(f"{base}/location-tracks/{t['id']}", json={"action": "stop"}, headers={"If-Match": "1"})
    _set_mode(client, base, "areas_only", 1)
    t2 = client.post(f"{base}/location-tracks", json={}).json()
    tb = f"{base}/location-tracks/{t2['id']}"
    r = client.post(f"{tb}/area-cells", json={"cells": [_cell("0.1:34.9:135.7", 60 * 48, 60 * 49, 0)]})
    assert r.json()["rejected"] == {"outside_period": 1} and r.json()["added"] == 0
    assert client.post(f"{tb}/area-cells", json={"cells": [{}] * (lt.MAX_CELLS_PER_REQUEST + 1)}).status_code == 422
    client.put("/api/v1/privacy/consents", json={"consents": {"location": False}})
    r = client.post(f"{tb}/area-cells", json={"cells": [_cell("0.1:34.9:135.7", 0, 1, 0)]})
    assert r.status_code == 403
    assert client.get(tb).json()["stopped_reason"] == "consent_withdrawn"


def test_sampling_report(auth_client, clock):
    client, owner, p, base = _setup(auth_client)
    t = client.post(f"{base}/location-tracks", json={"mode": "device_only"}).json()
    tb = f"{base}/location-tracks/{t['id']}"
    r = client.put(f"{tb}/sampling", json={"sampling": {
        "battery_start": 0.9, "battery_end": 0.7, "expected_samples": 40, "kept_samples": 30, "missed_samples": 4,
        "manual_points": 2, "max_gap_seconds": 900, "tier_seconds": {"moving": 600, "low_power": 1200}}})
    assert r.status_code == 200, r.text
    s = r.json()["sampling"]
    assert s["missed_ratio"] == 0.1 and s["battery_used"] == 0.2 and s["reported_at"]
    assert client.get(f"{base}/location-tracks").json()["tracks"][0]["sampling"]["missed_ratio"] == 0.1
    r = client.put(f"{tb}/sampling", json={"sampling": {"latitude": 35.0, "longitude": 135.0}})
    assert r.status_code == 422
    assert client.put(f"{tb}/sampling", json={"sampling": {}, "points": []}).status_code == 422
