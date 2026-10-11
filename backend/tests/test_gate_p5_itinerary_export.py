"""
[Gate P5] FR-036 カレンダー・地図の書き出し(ICS/GPX/KML/CSV)の統合テスト(実PostgreSQL)。

検証する主な性質:
- ICS: RFC 5545(CRLF・75オクテット折り返し・エスケープ)、予定ごとに固定のUID、SEQUENCE=旅程の版、UTC時刻、
  時刻未定は推測せず終日「(時刻未定)」、移動区間もVEVENT、取消はSTATUS:CANCELLED
- 予約番号・チケット・メモは含めない。住所は選んだ時だけ
- GPX/KML: 既定は約1km単位に丸め、宿泊場所を除外し、精度を明記。日ごとの順路
- CSV: BOM・見出し・CSV injection対策
- viewerも書き出せる。部外者は403。監査には形式・選択・件数だけ
"""
import csv
import io
import uuid
import xml.etree.ElementTree as ET
from datetime import date

import pytest

from app.api.v1 import itinerary_export as export_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator
from app.services import itinerary_export as ix

CONFIRMATION = "ZZ98765432"
DESCRIPTION_SECRET = "金庫の暗証番号1234"


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(export_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _setup(auth_client, make_user, db_session):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "京都, 秋の旅; 2026"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1, d2 = (client.post(f"{base}/days", json={"local_date": d, "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()
              for d in ("2026-11-01", "2026-11-02"))

    def ev(day, **body):
        res = client.post(f"{base}/events", json={"day_id": day["id"], **body}, headers=_ik())
        assert res.status_code == 201, res.text
        return res.json()

    a = ev(d1, title="清水寺", event_type="sightseeing", local_start_time="10:00", address="京都市東山区清水1-294",
           latitude=34.994856, longitude=135.785046, description=DESCRIPTION_SECRET)
    b = ev(d1, title="=HYPERLINK(\"http://x\")", event_type="meal", local_start_time="12:30",
           latitude=35.003674, longitude=135.778649)
    c = ev(d1, title="京の宿", event_type="accommodation", local_start_time="16:00",
           latitude=35.01, longitude=135.77)
    ev(d2, title="自由行動", event_type="activity")
    ev(d2, title="終日イベント", event_type="activity", is_all_day=True)
    r = client.post(f"{base}/reservations", json={
        "type": "accommodation", "provider_name": "京の宿", "confirmation_number": CONFIRMATION, "event_id": c["id"]})
    assert r.status_code == 201, r.text
    for body in ({"from_event_id": a["id"], "to_event_id": b["id"], "mode": "bus", "transport_number": "206",
                  "planned_departure_at": "2026-11-01T02:30:00Z", "planned_arrival_at": "2026-11-01T03:00:00Z"},
                 {"from_event_id": b["id"], "to_event_id": c["id"], "mode": "taxi", "status": "cancelled",
                  "planned_departure_at": "2026-11-01T06:00:00Z"},
                 {"from_event_id": b["id"], "to_event_id": c["id"], "mode": "walking"}):
        res = client.post(f"{base}/segments", json=body, headers=_ik())
        assert res.status_code == 201, res.text
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    revision = client.get(f"/api/v1/plans/{p}").json()["revision"]
    return client, p, owner, viewer, revision, a


def _unfold(text: str) -> list:
    return text.replace("\r\n ", "").split("\r\n")


# ---------------------------------------------------------------- 単体

def test_ics_escape_and_fold():
    assert ix.ics_escape("a,b;c\\d\ne") == "a\\,b\\;c\\\\d\\ne"
    line = "SUMMARY:" + "あ" * 40
    folded = ix.ics_fold(line)
    assert all(len(part.encode("utf-8")) <= 75 for part in folded.split("\r\n"))
    assert folded.replace("\r\n ", "") == line


def test_csv_safe():
    assert ix.csv_safe("=1+1") == "'=1+1"
    assert ix.csv_safe("-5") == "'-5"
    assert ix.csv_safe("@SUM") == "'@SUM"
    assert ix.csv_safe("清水寺") == "清水寺"
    assert ix.csv_safe(None) == ""


def test_waypoints_precision_and_lodging():
    e = ix.ExportEvent(id="1", title="宿", event_type="accommodation", local_date=date(2026, 11, 1),
                       timezone_id="Asia/Tokyo", start=None, end=None, is_all_day=False, local_start_time=None,
                       place_name=None, address=None, latitude=35.123456, longitude=135.987654, locked=False,
                       is_accommodation=True)
    pts, no_loc, lodging = ix.waypoints([e], "approx", True)
    assert pts == [] and lodging == 1 and no_loc == 0
    pts, _, _ = ix.waypoints([e], "exact", False)
    assert (pts[0].latitude, pts[0].longitude) == (35.12346, 135.98765)
    pts, _, _ = ix.waypoints([e], "approx", False)
    assert (pts[0].latitude, pts[0].longitude) == (35.12, 135.99)


# ---------------------------------------------------------------- ICS

def test_ics_calendar(auth_client, make_user, db_session, audit_calls):
    client, p, owner, viewer, revision, a = _setup(auth_client, make_user, db_session)
    res = client.get(f"/api/v1/plans/{p}/exports/calendar.ics")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/calendar")
    disposition = res.headers["content-disposition"]
    assert "attachment" in disposition and "filename*=UTF-8''" in disposition
    assert res.headers["cache-control"] == "no-store"
    text = res.content.decode("utf-8")
    assert "\r\n" in text and "\n" not in text.replace("\r\n", "")
    lines = _unfold(text)
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-2] == "END:VCALENDAR"
    assert "X-WR-CALNAME:京都\\, 秋の旅\\; 2026" in lines and "X-WR-TIMEZONE:Asia/Tokyo" in lines
    assert lines.count("BEGIN:VEVENT") == 7  # 予定5件 + 時刻のある移動2件
    assert res.headers["x-export-count"] == "7" and res.headers["x-export-skipped"] == "1"
    assert f"UID:event-{a['id']}@travelcanvas.app" in lines
    assert lines.count(f"SEQUENCE:{revision}") == 7
    i = lines.index(f"UID:event-{a['id']}@travelcanvas.app")
    assert lines[i + 3] == "DTSTART:20261101T010000Z"  # 10:00 JST
    assert "SUMMARY:(時刻未定) 自由行動" in lines and "DTSTART;VALUE=DATE:20261102" in lines
    assert "SUMMARY:終日イベント" in lines and "DTEND;VALUE=DATE:20261103" in lines
    assert "SUMMARY:バス: 清水寺 → =HYPERLINK(\"http://x\") (206)" in lines
    assert "STATUS:CANCELLED" in lines
    assert "DESCRIPTION:種類: 宿泊 / 予約あり(予約番号はアプリで確認してください)" in lines
    for secret in (CONFIRMATION, DESCRIPTION_SECRET, "清水1-294"):
        assert secret not in text
    assert audit_calls[-1]["action"] == "itinerary_exported"
    assert audit_calls[-1]["details"] == {"plan_id": p, "format": "ics", "include_addresses": False, "count": 7}

    with_addr = client.get(f"/api/v1/plans/{p}/exports/calendar.ics", params={"include_addresses": True})
    assert "LOCATION:京都市東山区清水1-294" in _unfold(with_addr.content.decode("utf-8"))

    # UIDは再出力しても変わらない(カレンダーアプリが同じ予定の更新として扱える)
    again = client.get(f"/api/v1/plans/{p}/exports/calendar.ics").content.decode("utf-8")
    assert f"UID:event-{a['id']}@travelcanvas.app" in again


def test_ics_sequence_advances(auth_client, make_user, db_session):
    client, p, owner, viewer, revision, a = _setup(auth_client, make_user, db_session)
    res = client.put(f"/api/v1/plans/{p}/events/{a['id']}", json={"title": "清水寺(朝)"},
                     headers={"If-Match": str(revision)})
    assert res.status_code == 200, res.text
    lines = _unfold(client.get(f"/api/v1/plans/{p}/exports/calendar.ics").content.decode("utf-8"))
    assert f"SEQUENCE:{revision + 1}" in lines and "SUMMARY:清水寺(朝)" in lines


# ---------------------------------------------------------------- GPX / KML

def test_gpx_and_kml(auth_client, make_user, db_session, audit_calls):
    client, p, *_ = _setup(auth_client, make_user, db_session)
    res = client.get(f"/api/v1/plans/{p}/exports/places.gpx")
    assert res.status_code == 200 and res.headers["content-type"].startswith("application/gpx+xml")
    root = ET.fromstring(res.content)
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    wpts = root.findall("g:wpt", ns)
    assert [w.find("g:name", ns).text for w in wpts] == ["清水寺", "=HYPERLINK(\"http://x\")"]
    assert (wpts[0].get("lat"), wpts[0].get("lon")) == ("34.99", "135.79")
    assert "約1km単位" in root.find("g:metadata/g:desc", ns).text
    assert len(root.findall("g:rte", ns)) == 1 and len(root.findall("g:rte/g:rtept", ns)) == 2
    assert (res.headers["x-export-count"], res.headers["x-export-skipped"], res.headers["x-export-excluded"]) == \
        ("2", "2", "1")
    assert "京の宿" not in res.content.decode("utf-8")

    exact = client.get(f"/api/v1/plans/{p}/exports/places.gpx",
                       params={"precision": "exact", "exclude_accommodation": False})
    root = ET.fromstring(exact.content)
    assert [w.get("lat") for w in root.findall("g:wpt", ns)] == ["34.99486", "35.00367", "35.01000"]
    assert exact.headers["x-export-excluded"] == "0"
    assert audit_calls[-1]["details"] == {"plan_id": p, "format": "gpx", "precision": "exact",
                                          "exclude_accommodation": False, "count": 3}
    assert client.get(f"/api/v1/plans/{p}/exports/places.gpx", params={"precision": "best"}).status_code == 422

    kml = client.get(f"/api/v1/plans/{p}/exports/places.kml")
    assert kml.status_code == 200 and "kml" in kml.headers["content-type"]
    kroot = ET.fromstring(kml.content)
    kns = {"k": "http://www.opengis.net/kml/2.2"}
    folders = kroot.findall("k:Document/k:Folder", kns)
    assert [f.find("k:name", kns).text for f in folders] == ["2026-11-01"]
    coords = [c.text for c in kroot.iter("{http://www.opengis.net/kml/2.2}coordinates")]
    assert coords[0] == "135.79,34.99,0" and coords[-1] == "135.79,34.99,0 135.78,35.00,0"


# ---------------------------------------------------------------- CSV

def test_csv(auth_client, make_user, db_session):
    client, p, *_ = _setup(auth_client, make_user, db_session)
    res = client.get(f"/api/v1/plans/{p}/exports/itinerary.csv")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    text = res.content.decode("utf-8")
    assert text.startswith("﻿")
    rows = list(csv.reader(io.StringIO(text[1:])))
    assert rows[0] == ix.CSV_HEADER
    assert rows[1][:5] == ["2026-11-01", "10:00", "", "観光", "清水寺"] and rows[1][6] == ""
    assert rows[2][4] == "'=HYPERLINK(\"http://x\")"
    assert rows[3][7] == "accommodation"
    assert rows[4][1] == "未定" and rows[5][1] == "終日"
    assert CONFIRMATION not in text and DESCRIPTION_SECRET not in text
    with_addr = list(csv.reader(io.StringIO(client.get(
        f"/api/v1/plans/{p}/exports/itinerary.csv", params={"include_addresses": True}).content.decode("utf-8")[1:])))
    assert with_addr[1][6] == "京都市東山区清水1-294"


# ---------------------------------------------------------------- 権限

def test_permissions(auth_client, make_user, db_session):
    client, p, owner, viewer, *_ = _setup(auth_client, make_user, db_session)
    _act_as(viewer)
    for path in ("calendar.ics", "places.gpx", "places.kml", "itinerary.csv"):
        assert client.get(f"/api/v1/plans/{p}/exports/{path}").status_code == 200
    stranger, _ = make_user()
    _act_as(stranger)
    for path in ("calendar.ics", "places.gpx", "places.kml", "itinerary.csv"):
        assert client.get(f"/api/v1/plans/{p}/exports/{path}").status_code == 403


def test_empty_plan(auth_client):
    client, _ = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "空の旅"}).json()["id"]
    ics = client.get(f"/api/v1/plans/{p}/exports/calendar.ics")
    assert ics.status_code == 200 and "BEGIN:VEVENT" not in ics.text and ics.headers["x-export-count"] == "0"
    gpx = ET.fromstring(client.get(f"/api/v1/plans/{p}/exports/places.gpx").content)
    assert gpx.findall("{http://www.topografix.com/GPX/1/1}wpt") == []
    assert client.get(f"/api/v1/plans/{p}/exports/itinerary.csv").text.count("\r\n") == 1
