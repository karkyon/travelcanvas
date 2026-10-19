"""
[Gate V2] FR-049 Visited Area Layer・FR-050 訪問判定・信頼度・FR-051 訪問訂正・Privacy除外の試験(実PostgreSQL)。

検証する主な性質:
- 判定の規則 visit-v1(DOC-14): 精度100m超を除く・種類ごとの半径・訪問2点2分・滞在10分・通過15km/h/2分・
  信頼度の重み(距離0.35/滞在0.25/精度0.15/証拠0.25)・高/要確認/候補・強い証拠2種以上でだけ VERIFIED_VISIT
- 自動の判定は確定せず、予定・実績を変えない。本人の訂正(確定・通過・取消・非表示・戻す)は If-Match で守り、
  判定をやり直しても本人の訂正を上書きしない
- 端末だけに座標を置くモードは数値だけを受け付ける(座標の項目は拒否)
- 隠した地点・行っていない地点は Atlas に出さない(地点単位の除外)。軌跡を消すと自動の判定も消える
- 本人以外には判定を見せない。根拠・応答・監査に本人の軌跡の座標を出さない。書き出し・退会で扱う
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import atlas as atlas_api
from app.api.v1 import location_tracks as tracks_api
from app.api.v1 import visits as visits_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import EventActual, Memory, PlanCollaborator, VisitAssessment
from app.services import data_export as dx
from app.services import visit_assessment as va

NOW = datetime(2026, 11, 1, 1, 0, tzinfo=timezone.utc)
KYOTO = (34.9948, 135.7850)
STATION = (34.9858, 135.7588)
OSAKA = (34.7025, 135.4959)


def _off(lat, lng, north_m=0.0, east_m=0.0):
    """(lat, lng) から北・東へ何m ずらした点(試験用の近似)"""
    import math
    return lat + north_m / 111_320, lng + east_m / (111_320 * math.cos(math.radians(lat)))


def _p(minutes, lat, lng, acc=10.0):
    return {"t": (NOW + timedelta(minutes=minutes)).isoformat(), "lat": lat, "lng": lng, "acc": acc}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    calls = []
    monkeypatch.setattr(visits_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(visits_api, "_now", lambda: NOW)
    monkeypatch.setattr(atlas_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(atlas_api, "_now", lambda: NOW)
    monkeypatch.setattr(tracks_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(tracks_api, "_now", lambda: NOW)
    return calls


# ---------------------------------------------------------------------------------------------- 純粋関数


def test_radius_by_category():
    assert va.radius_for("restaurant") == 50 and va.radius_for("transportation") == 300
    assert va.radius_for("sightseeing") == 200 and va.radius_for(None) == va.DEFAULT_RADIUS_M
    assert all(50 <= r <= 300 for r in va.CATEGORY_RADIUS_M.values())


def _metrics(points, radius=200, center=KYOTO):
    return va.visit_metrics(center[0], center[1], radius, points)


def test_stay_is_likely_visit_and_review_without_evidence():
    pts = [_p(m, *_off(*KYOTO, north_m=20)) for m in range(0, 13, 2)]
    m = _metrics(pts)
    assert m["points_inside"] == 7 and m["dwell_seconds"] == 720 and m["speed_kmh"] == 0.0
    r = va.assess(m, 200, {})
    assert r["state"] == "LIKELY_VISIT" and r["reasons"]["stayed"] is True
    # 距離 0.9×0.35 + 滞在 1×0.25 + 精度 0.9×0.15 + 証拠 0 = 0.70 → 要確認
    assert r["confidence"] == 0.70 and r["level"] == "review"
    assert r["reasons"]["strong_evidence"] == ["gps_stay"] and r["algorithm_version"] == "visit-v1"
    assert va.needs_confirmation(r["state"], "auto", r["confidence"]) is True
    assert "lat" not in json.dumps(r) and "lng" not in json.dumps(r)


def test_two_strong_evidence_kinds_make_verified():
    pts = [_p(m, *_off(*KYOTO, north_m=20)) for m in range(0, 13, 2)]
    r = va.assess(_metrics(pts), 200, {"photo": True})
    assert r["state"] == "VERIFIED_VISIT" and r["confidence"] == 0.83 and r["level"] == "high"
    # 滞在が短ければ GPS は強い証拠にならず、写真だけでは確定しない
    short = [_p(m, *_off(*KYOTO, north_m=20)) for m in (0, 1, 3)]
    r2 = va.assess(_metrics(short), 200, {"photo": True})
    assert r2["state"] == "LIKELY_VISIT" and r2["reasons"]["stayed"] is False


def test_pass_through_fast_and_short():
    fast = [_p(0, *_off(*KYOTO, north_m=-150)), _p(0.5, *_off(*KYOTO, north_m=150))]
    m = _metrics(fast)
    assert m["speed_kmh"] > 15
    r = va.assess(m, 200, {})
    assert r["state"] == "PASS_THROUGH" and r["reasons"]["pass_reason"] == "fast"
    short = [_p(0, *KYOTO), _p(1, *KYOTO)]
    r2 = va.assess(_metrics(short), 200, {"manual": True})
    assert r2["state"] == "PASS_THROUGH" and r2["reasons"]["pass_reason"] == "short"


def test_low_accuracy_points_are_ignored():
    pts = [_p(m, *KYOTO, acc=150) for m in range(0, 20, 2)]
    m = _metrics(pts)
    assert m["points_low_accuracy"] == 10 and m["points_inside"] == 0
    r = va.assess(m, 200, {})
    assert r["state"] == "PLANNED_ONLY" and r["confidence"] == 0.0
    # 精度がちょうど100mの点は使う
    assert _metrics([_p(0, *KYOTO, acc=100)])["points_inside"] == 1


def test_manual_and_reservation_without_gps():
    empty = _metrics([])
    assert va.assess(empty, 200, {"manual": True})["state"] == "MANUAL"
    r = va.assess(empty, 200, {"manual": True, "reservation": True})
    assert r["state"] == "VERIFIED_VISIT" and r["reasons"]["basis"] == "manual" and r["confidence"] == 0.25


def test_gap_splits_runs_and_outside_points_break_run():
    pts = [_p(m, *KYOTO) for m in (0, 1, 3)] + [_p(m, *KYOTO) for m in (45, 47, 50)]
    m = _metrics(pts)
    assert m["runs"] == 2 and m["dwell_seconds"] == 300 and m["best_run_points"] == 3
    out = [_p(0, *KYOTO), _p(2, *OSAKA), _p(4, *KYOTO)]
    assert _metrics(out)["runs"] == 2


def test_clean_metrics_rejects_coordinates_and_inconsistency():
    ok = {"points_total": 8, "points_valid": 7, "points_inside": 6, "dwell_seconds": 700,
          "median_distance_m": 30, "median_accuracy_m": 12.5, "speed_kmh": 0.4}
    c = va.clean_metrics(ok)
    assert c["points_low_accuracy"] == 1 and c["runs"] == 1
    assert va.clean_metrics({**ok, "latitude": 35.0}) is None
    assert va.clean_metrics({**ok, "points_inside": 9}) is None
    assert va.clean_metrics({**ok, "dwell_seconds": -1}) is None
    assert va.clean_metrics({**ok, "median_distance_m": 301}) is None
    assert va.clean_metrics({**ok, "points_total": True}) is None
    assert va.clean_metrics({**ok, "dwell_seconds": 1.5}) is None
    assert va.clean_metrics({k: v for k, v in ok.items() if k != "points_total"}) is None


def test_layer_state_mapping():
    assert va.layer_state(None, False, False) == "PLANNED"
    assert va.layer_state("REJECTED", False, False) == "PLANNED"
    assert va.layer_state("VERIFIED_VISIT", True, True) == "HIDDEN"
    assert va.layer_state("VERIFIED_VISIT", False, False) == "VERIFIED"
    assert va.layer_state("LIKELY_VISIT", False, True) == "STAYED"
    assert va.layer_state("MANUAL", False, False) == "VISITED"
    assert va.layer_state("PASS_THROUGH", False, False) == "PASS_THROUGH"


# ---------------------------------------------------------------------------------------------- API


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _setup(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "訪問の判定"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                    headers=_ik()).json()
    ev = {}
    for name, loc, kind in (("清水寺", KYOTO, "sightseeing"), ("京都駅", STATION, "transportation"),
                            ("大阪城", OSAKA, "sightseeing"), ("未定", None, "activity")):
        body = {"day_id": d["id"], "title": name, "event_type": kind}
        if loc:
            body.update(latitude=loc[0], longitude=loc[1])
        r = client.post(f"{base}/events", json=body, headers=_ik())
        assert r.status_code in (200, 201), r.text
        ev[name] = r.json()["id"]
    return p, base, ev


def _track(client, base, points):
    assert client.put("/api/v1/privacy/consents", json={"consents": {"location": True}}).status_code == 200
    t = client.post(f"{base}/location-tracks", json={"mode": "synced", "precision": "high"})
    assert t.status_code == 201, t.text
    tid = t.json()["id"]
    up = client.post(f"{base}/location-tracks/{tid}/points", json={"batch_id": str(uuid.uuid4()), "points": [
        {"recorded_at": p["t"], "latitude": p["lat"], "longitude": p["lng"], "accuracy_m": p["acc"]}
        for p in points]})
    assert up.status_code == 200, up.text
    return tid


def _item(body, event_id):
    return next(i for i in body["items"] if i["event_id"] == event_id)


def test_visit_flow(auth_client, make_user, db_session, _env):
    client, owner = auth_client
    p, base, ev = _setup(client)
    stay = [_p(m, *_off(*KYOTO, north_m=20)) for m in range(0, 13, 2)]
    passing = [_p(30, *_off(*STATION, east_m=-250)), _p(30.5, *_off(*STATION, east_m=250))]
    tid = _track(client, base, stay + passing)

    # 判定の前: 位置のある予定は「予定」、位置の無い予定は件数だけ
    g = client.get(f"{base}/visits").json()
    assert [i["title"] for i in g["items"]] == ["清水寺", "京都駅", "大阪城"]
    assert g["events_without_location"] == 1 and g["tracks"] == {"synced": 1, "device": 0}
    assert all(i["layer_state"] == "PLANNED" and i["assessment"] is None for i in g["items"])
    assert g["rules"]["algorithm_version"] == "visit-v1" and g["rules"]["max_accuracy_m"] == 100

    r = client.post(f"{base}/visits/assess")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"] == {"created": 2, "changed": 0, "unchanged": 0, "skipped": 1}
    kiyomizu, station, osaka = (_item(body, ev[n]) for n in ("清水寺", "京都駅", "大阪城"))
    assert kiyomizu["layer_state"] == "STAYED" and kiyomizu["radius_m"] == 200
    a = kiyomizu["assessment"]
    assert a["state"] == "LIKELY_VISIT" and a["source"] == "auto" and a["level"] == "review"
    assert a["needs_confirmation"] is True and a["reasons"]["dwell_seconds"] == 720
    assert station["layer_state"] == "PASS_THROUGH" and station["assessment"]["reasons"]["pass_reason"] == "fast"
    assert osaka["layer_state"] == "PLANNED" and osaka["assessment"] is None
    assert body["counts"]["STAYED"] == 1 and body["counts"]["PASS_THROUGH"] == 1 and body["needs_confirmation"] == 2
    # 応答・監査に本人の軌跡の座標を出さない(予定の場所の座標だけ)

    def keys(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                yield k
                yield from keys(v)
        elif isinstance(obj, list):
            for v in obj:
                yield from keys(v)

    for it in body["items"]:
        assert not {"lat", "lng", "latitude", "longitude", "points"} & set(keys(it["assessment"] or {}))
    assert (kiyomizu["latitude"], kiyomizu["longitude"]) == KYOTO
    assert (station["latitude"], station["longitude"]) == STATION
    assert "points" not in body
    assert _env[-1]["action"] == "visit.assess" and "清水寺" not in json.dumps(_env[-1], ensure_ascii=False, default=str)
    # 自動の判定は実績を作らない(予定・実績は変えない)
    assert db_session.query(EventActual).filter(EventActual.plan_id == uuid.UUID(p)).count() == 0
    # 同じ材料でやり直しても変わらない(冪等)
    assert client.post(f"{base}/visits/assess").json()["result"]["unchanged"] == 2

    # 訂正: If-Match が必要。古い revision は 409
    url = f"{base}/visits/{ev['清水寺']}"
    assert client.patch(url, json={"action": "confirm"}).status_code == 400
    assert client.patch(url, json={"action": "confirm"}, headers={"If-Match": "99"}).status_code == 409
    assert client.patch(url, json={"action": "fly"}, headers={"If-Match": "1"}).status_code == 422
    c = client.patch(url, json={"action": "confirm"}, headers={"If-Match": str(a["revision"])})
    assert c.status_code == 200, c.text
    assert c.json()["layer_state"] == "VERIFIED" and c.json()["assessment"]["source"] == "user"
    assert c.json()["assessment"]["needs_confirmation"] is False
    assert _env[-1]["details"]["action"] == "confirm" and _env[-1]["details"]["from"] == "LIKELY_VISIT"

    # やり直しても本人の訂正は上書きしない(自動の判定との差を示す)
    again = _item(client.post(f"{base}/visits/assess").json(), ev["清水寺"])["assessment"]
    assert again["state"] == "VERIFIED_VISIT" and again["auto_state"] == "LIKELY_VISIT"
    assert again["differs_from_auto"] is True

    # Atlas: 隠す前は清水寺の区画が出る。隠すと、その場所の半径の中の軌跡も出さない
    def atlas_keys():
        return {c["key"] for c in client.get("/api/v1/atlas").json()["cells"]}

    assert "0.1:34.9:135.7" in atlas_keys()
    h = client.patch(url, json={"action": "hide"}, headers={"If-Match": str(again["revision"])}).json()
    assert h["layer_state"] == "HIDDEN" and h["assessment"]["state"] == "VERIFIED_VISIT"
    keys = atlas_keys()
    # 京都駅の通過(区画 0.1:34.9:135.7 にある)も同じ区画のため、駅の点だけが残る
    atlas = client.get("/api/v1/atlas").json()
    cell = next(c for c in atlas["cells"] if c["key"] == "0.1:34.9:135.7")
    # 清水寺の予定・滞在の点(7点)は出さず、京都駅の予定と通過の2点だけが残る
    assert cell["state"] == "PASS_THROUGH" and cell["evidence"] == {"planned": 1, "track": 2}
    assert keys
    uh = client.patch(url, json={"action": "unhide"}, headers={"If-Match": str(h["assessment"]["revision"])}).json()
    assert uh["layer_state"] == "VERIFIED"

    # 判定の無い予定にも訂正できる(行っていない)。行っていない予定は Atlas の予定にも出さない
    rj = client.patch(f"{base}/visits/{ev['大阪城']}", json={"action": "reject"})
    assert rj.status_code == 200 and rj.json()["assessment"]["state"] == "REJECTED"
    assert rj.json()["layer_state"] == "PLANNED"
    # 自動の判定に戻す: 自動の判定が無い行は消える
    back = client.patch(f"{base}/visits/{ev['大阪城']}", json={"action": "reset"},
                        headers={"If-Match": str(rj.json()["assessment"]["revision"])})
    assert back.status_code == 200 and back.json()["assessment"] is None
    assert client.patch(f"{base}/visits/{ev['大阪城']}", json={"action": "unhide"}).status_code == 404
    # 自動の判定に戻す: 清水寺は自動の判定(訪問の可能性)へ
    rs = client.patch(url, json={"action": "reset"}, headers={"If-Match": str(uh["assessment"]["revision"])}).json()
    assert rs["assessment"]["state"] == "LIKELY_VISIT" and rs["assessment"]["source"] == "auto"
    # 位置の無い予定・他の旅行の予定は 404
    assert client.patch(f"{base}/visits/{ev['未定']}", json={"action": "confirm"}).status_code == 404
    assert client.patch(f"{base}/visits/{uuid.uuid4()}", json={"action": "confirm"}).status_code == 404

    # 他の人には見せない(参加者は自分の判定だけ)
    member, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=member.id, email=member.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    stranger, _ = make_user()
    try:
        _act_as(member)
        mg = client.get(f"{base}/visits").json()
        assert all(i["assessment"] is None for i in mg["items"])
        # 参加者の判定には所有者の軌跡を使わない
        assert client.post(f"{base}/visits/assess").json()["result"]["created"] == 0
        _act_as(stranger)
        assert client.get(f"{base}/visits").status_code in (403, 404)
        assert client.post(f"{base}/visits/assess").status_code in (403, 404)
    finally:
        _act_as(owner)

    # 書き出しは本人の判定だけ
    tables = dx.plan_tables(db_session, db_session.get(dx.m.TravelPlan, uuid.UUID(p)), owner.id)
    assert {r["event_id"] for r in tables["visit_assessments"]} == {ev["清水寺"], ev["京都駅"]}

    # 軌跡を消すと自動の判定も消える。本人の訂正は状態を残し、自動の結果だけ消す
    sid = ev["京都駅"]
    st = _item(client.get(f"{base}/visits").json(), sid)["assessment"]
    client.patch(f"{base}/visits/{sid}", json={"action": "confirm"}, headers={"If-Match": str(st["revision"])})
    assert client.delete(f"{base}/location-tracks/{tid}").status_code == 204
    after = client.get(f"{base}/visits").json()
    assert _item(after, ev["清水寺"])["assessment"] is None
    s2 = _item(after, sid)["assessment"]
    assert s2["state"] == "VERIFIED_VISIT" and s2["auto_state"] is None and s2["reasons"] == {}


def test_device_results_and_evidence(auth_client, db_session):
    client, owner = auth_client
    p, base, ev = _setup(client)
    good = {"points_total": 9, "points_valid": 8, "points_inside": 7, "dwell_seconds": 900,
            "median_distance_m": 25.0, "median_accuracy_m": 8.0, "speed_kmh": 0.3}
    url = f"{base}/visits/device-results"
    assert client.post(url, json={"results": [{"event_id": ev["清水寺"],
                                               "metrics": {**good, "latitude": 34.99}}]}).status_code == 422
    assert client.post(url, json={"results": [{"event_id": ev["未定"], "metrics": good}]}).status_code == 422
    assert client.post(url, json={"results": [{"event_id": ev["清水寺"], "metrics": good},
                                              {"event_id": ev["清水寺"], "metrics": good}]}).status_code == 422
    assert client.post(url, json={"results": [{"event_id": ev["清水寺"], "metrics": good, "x": 1}]}).status_code == 422
    # 写真(予定に紐付け)・予約・手動の実績を証拠として数える
    db_session.add(Memory(plan_id=uuid.UUID(p), author_user_id=owner.id, kind="photo",
                          event_id=uuid.UUID(ev["清水寺"]), storage_key="memories/test.png",
                          mime_type="image/png", size=10, sha256="0" * 64, visibility="private"))
    db_session.commit()
    r = client.post(url, json={"results": [{"event_id": ev["清水寺"], "metrics": good}]})
    assert r.status_code == 200, r.text
    a = _item(r.json(), ev["清水寺"])["assessment"]
    assert a["source"] == "device" and a["state"] == "VERIFIED_VISIT"
    assert a["reasons"]["evidence"] == ["photo"] and set(a["reasons"]["strong_evidence"]) == {"photo", "gps_stay"}
    # サーバーに軌跡が無い時のやり直しは、端末の結果を消さない
    assert _item(client.post(f"{base}/visits/assess").json(), ev["清水寺"])["assessment"]["source"] == "device"
    # 手動の実績だけ(GPS無し)は MANUAL
    client.put(f"{base}/journey/events/{ev['大阪城']}", json={"status": "visited"})
    m = _item(client.post(f"{base}/visits/assess").json(), ev["大阪城"])
    assert m["assessment"]["state"] == "MANUAL" and m["layer_state"] == "VISITED"

    # 退会で本人の判定を消す
    from app.services import account_deletion as ad

    ad.delete_account(db_session, owner)
    db_session.commit()
    assert db_session.query(VisitAssessment).filter(VisitAssessment.user_id == owner.id).count() == 0
