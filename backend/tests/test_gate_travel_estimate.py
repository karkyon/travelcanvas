"""[Gate TravelEstimate] 移動の見積もり v2: 手段ごとの参考値・管理者の条件・区間の計算し直し。外部の API は呼ばない。"""
import uuid

import pytest

from app.core.config import settings
from app.services import travel_estimate as te
from tests.test_gate_m1_travel_segments import (
    _create_day, _create_event, _create_plan, _minimal_segment_body, _plan_revision, _post_segment,
)


# 1 度の緯度 ≒ 111.2km
def _pt(km_north: float):
    return 35.0 + km_north / 111.195, 135.0


def _est(mode: str, km: float, params=None):
    a, b = _pt(0), _pt(km)
    return te.estimate(a[0], a[1], b[0], b[1], mode, params)


def test_walking_uses_adult_average_speed():
    r = _est("walking", 1.0)
    # 1km × 迂回 1.25 ÷ 4.8km/h = 15.6 分
    assert r["distance_km"] == 1.2 or r["distance_km"] == 1.3
    assert 15 <= r["duration_minutes"] <= 16
    assert r["provider"] == "tc_estimate" and r["is_estimate"] is True
    assert r["basis"].startswith("直線 1.0km")


def test_car_has_local_and_highway_and_uses_faster():
    short = _est("driving", 5.0)
    assert [v["key"] for v in short["variants"]] == ["local"]
    far = _est("driving", 60.0)
    keys = {v["key"]: v for v in far["variants"]}
    assert set(keys) == {"local", "highway"}
    assert keys["highway"]["duration_minutes"] < keys["local"]["duration_minutes"]
    assert far["duration_minutes"] == keys["highway"]["duration_minutes"]
    taxi = _est("taxi", 5.0)
    assert taxi["duration_minutes"] == short["duration_minutes"] + 5  # タクシーを待つ 5 分


def test_train_transfers_and_shinkansen_option():
    near = _est("train", 3.0)["variants"]
    assert near[0]["label"] == "各駅停車・乗り換え 0 回"
    mid = _est("train", 60.0)["variants"]
    assert mid[0]["label"].startswith("快速・急行・乗り換え 2 回")
    far = _est("train", 400.0)["variants"]
    assert [v["key"] for v in far] == ["recommended", "shinkansen"]
    assert far[1]["duration_minutes"] < far[0]["duration_minutes"]


def test_flight_is_airborne_time_only_and_helicopter_not_estimated():
    r = _est("flight", 800.0)
    # 800 × 1.08 ÷ 800km/h × 60 + 20 = 84.8 分(搭乗手続き・保安検査は含めない)
    assert 84 <= r["duration_minutes"] <= 86
    assert "含みません" in r["variants"][0]["note"]
    assert _est("helicopter", 10.0) is None
    assert te.estimate(None, None, 35.0, 135.0, "walking") is None


def test_validate_rejects_out_of_range_and_merged_ignores_bad_values():
    params, errors = te.validate({"walking": {"speed_kmh": 20}, "car": {"local_speed_kmh": "速い"}})
    assert len(errors) == 2 and "2〜8km/h" in errors[0]
    ok, errors = te.validate({"walking": {"speed_kmh": 4}})
    assert not errors and ok["walking"]["speed_kmh"] == 4
    assert te.diff_from_defaults(ok) == {"walking": {"speed_kmh": 4.0}}
    assert te.merged({"walking": {"speed_kmh": 99}})["walking"]["speed_kmh"] == 4.8


def test_segment_recomputed_when_mode_changes_and_after_coordinates_added(auth_client):
    client, _ = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    a = _create_event(client, plan_id, day_id, "A", latitude=35.0, longitude=135.0)
    b = _create_event(client, plan_id, day_id, "B")  # 座標なし
    seg = _post_segment(client, plan_id, _minimal_segment_body(a, b)).json()
    assert seg["duration_minutes"] is None and seg["provider"] == "unknown"
    # 後から座標を入れると、区間を読んだ時に計算し直す(「未計算」のまま残さない)
    lat, lng = _pt(10.0)
    res = client.put(f"/api/v1/plans/{plan_id}/events/{b}", json={"latitude": lat, "longitude": lng},
                     headers={"If-Match": str(_plan_revision(client, plan_id))})
    assert res.status_code == 200, res.text
    listed = client.get(f"/api/v1/plans/{plan_id}/segments").json()[0]
    assert listed["provider"] == "tc_estimate" and listed["duration_minutes"] > 100  # 歩いて 10km
    # 手段を変えると見積もりも変わる
    res = client.patch(f"/api/v1/plans/{plan_id}/segments/{seg['id']}", json={"mode": "driving"},
                       headers={"If-Match": str(_plan_revision(client, plan_id))})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "driving" and body["duration_minutes"] < 40
    assert body["estimate_variants"][0]["label"] == "下道"
    # 手で入れた値は計算し直さない
    res = client.patch(f"/api/v1/plans/{plan_id}/segments/{seg['id']}", json={"duration_minutes": 50},
                       headers={"If-Match": str(_plan_revision(client, plan_id))})
    assert res.json()["provider"] == "manual"
    assert client.get(f"/api/v1/plans/{plan_id}/segments").json()[0]["duration_minutes"] == 50


@pytest.fixture()
def admin_client(auth_client, db_session, monkeypatch):
    client, user = auth_client
    user.user_type = "admin"
    db_session.flush()
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    return client, user


def test_admin_tunes_conditions_and_segments_follow(admin_client):
    client, _ = admin_client
    got = client.get("/api/v1/admin/ops/travel-estimate").json()
    assert got["revision"] == 0 and got["params"]["walking"]["speed_kmh"] == 4.8
    assert any(f["key"] == "highway_speed_kmh" for f in got["schema"]) and got["sample"]
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    a = _create_event(client, plan_id, day_id, "A", latitude=35.0, longitude=135.0)
    lat, lng = _pt(2.0)
    b = _create_event(client, plan_id, day_id, "B", latitude=lat, longitude=lng)
    before = _post_segment(client, plan_id, _minimal_segment_body(a, b)).json()["duration_minutes"]

    params = got["params"]
    params["walking"]["speed_kmh"] = 4.0
    bad = client.put("/api/v1/admin/ops/travel-estimate",
                     json={"params": {"walking": {"speed_kmh": 30}}, "reason": "試験"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "travel_estimate_invalid"
    assert client.put("/api/v1/admin/ops/travel-estimate", json={"params": params}).status_code == 422  # 理由が必須
    prev = client.post("/api/v1/admin/ops/travel-estimate/preview", json={"params": params})
    assert prev.status_code == 200 and prev.json()["sample"]
    saved = client.put("/api/v1/admin/ops/travel-estimate", json={"params": params, "reason": "高齢の家族に合わせる"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1 and saved.json()["params"]["walking"]["speed_kmh"] == 4.0
    after = client.get(f"/api/v1/plans/{plan_id}/segments").json()[0]
    assert after["duration_minutes"] > before and after["algorithm_version"].endswith("+r1")


def test_non_admin_cannot_read_or_change(auth_client):
    client, _ = auth_client
    assert client.get("/api/v1/admin/ops/travel-estimate").status_code == 403
    res = client.put("/api/v1/admin/ops/travel-estimate", json={"params": {}, "reason": str(uuid.uuid4())})
    assert res.status_code == 403
