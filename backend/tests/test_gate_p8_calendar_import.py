"""
[Gate P8] FR-036 カレンダー(ICS)の取込の統合テスト(実PostgreSQL)。

検証する主な性質:
- 解析: 行の折り返し・エスケープ・UTC/TZID/浮動時刻/日付のみ。ICSでない・大きすぎる・UTF-8でないは422
- 取り込み案(プレビュー)はDBを変えない。追加・変更(前後の値)・取り込まない理由(繰り返し・取消・変更なし・確定済み・
  重複・日程なし)。TravelCanvasが書き出したICSは同じ予定の変更として扱う(書き出し→外部で編集→取り込み)
- 適用: If-Match必須、全件検査してから適用、1つの変更セットで「元に戻す」で全て戻る、日程が無い日は選んだ時だけ作る
- 説明(DESCRIPTION)は取り込まない。権限はeditor以上。監査は件数のみ
"""
import uuid

import pytest

from app.api.v1 import calendar_import as import_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator, TravelEvent
from app.services import calendar_import as ci


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(import_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _ics(*vevents: str) -> bytes:
    body = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//JA", *vevents, "END:VCALENDAR"])
    return (body + "\r\n").encode("utf-8")


def _vevent(uid, summary, dtstart, extra=()):
    return "\r\n".join(["BEGIN:VEVENT", f"UID:{uid}", f"SUMMARY:{summary}", dtstart, *extra, "END:VEVENT"])


def _setup(auth_client):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "取込テスト"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    a = client.post(f"{base}/events", json={"day_id": d1["id"], "title": "清水寺", "local_start_time": "10:00"},
                    headers=_ik()).json()
    b = client.post(f"{base}/events", json={"day_id": d1["id"], "title": "昼食", "local_start_time": "12:00"},
                    headers=_ik()).json()
    return client, owner, p, base, d1, a, b


def _preview(client, base, data: bytes, create_missing_days=False):
    return client.post(f"{base}/calendar-import/preview", files={"file": ("cal.ics", data, "text/calendar")},
                       data={"create_missing_days": "true" if create_missing_days else "false"})


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


# ---------------------------------------------------------------- 解析(単体)

def test_parse_ics_variants():
    data = _ics(
        _vevent("a", "長い\r\n  題名\\, カンマ", "DTSTART:20261101T010000Z", ["LOCATION:京都市\\;東山区"]),
        _vevent("b", "TZ付き", "DTSTART;TZID=Asia/Tokyo:20261101T150000"),
        _vevent("c", "浮動", "DTSTART:20261102T080000"),
        _vevent("d", "終日", "DTSTART;VALUE=DATE:20261103"),
        _vevent("e", "毎週", "DTSTART:20261101T010000Z", ["RRULE:FREQ=WEEKLY"]),
        "BEGIN:VEVENT\r\nUID:nostart\r\nSUMMARY:開始なし\r\nEND:VEVENT",
    )
    evs = ci.parse_ics(data)
    assert [e.uid for e in evs] == ["a", "b", "c", "d", "e"]
    assert evs[0].summary == "長い 題名, カンマ" and evs[0].location == "京都市;東山区"
    assert ci.to_local(evs[0], "Asia/Tokyo")[1] == "10:00"
    assert ci.to_local(evs[1], "UTC")[1] == "06:00"
    assert ci.to_local(evs[2], "Asia/Tokyo") == (evs[2].floating_local.date(), "08:00", False)
    assert ci.to_local(evs[3], "Asia/Tokyo")[2] is True and evs[4].recurring
    for bad in (b"hello", "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:2026-11-01\r\nEND:VEVENT".encode(),
                b"\xff\xfe", b"BEGIN:VCALENDAR\n" + b"x" * ci.MAX_BYTES):
        with pytest.raises(ci.IcsError):
            ci.parse_ics(bad)


# ---------------------------------------------------------------- プレビュー

def test_preview_candidates_and_no_db_change(auth_client, db_session, audit_calls):
    client, owner, p, base, d1, a, b = _setup(auth_client)
    db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(b["id"])).update({"locked": True})
    db_session.commit()
    rev = _rev(client, p)
    data = _ics(
        _vevent(f"event-{a['id']}@travelcanvas.app", "清水寺(朝)", "DTSTART:20261101T000000Z",
                ["DESCRIPTION:会議URL https://x/secret パスコード 1234"]),
        _vevent(f"event-{b['id']}@travelcanvas.app", "昼食", "DTSTART:20261101T040000Z"),
        _vevent("ext-1", "水族館", "DTSTART;TZID=Asia/Tokyo:20261101T150000", ["LOCATION:京都水族館"]),
        _vevent("ext-2", "清水寺", "DTSTART:20261101T010000Z"),
        _vevent("ext-3", "翌日の予定", "DTSTART;VALUE=DATE:20261102"),
        _vevent("ext-4", "毎週の会議", "DTSTART:20261101T010000Z", ["RRULE:FREQ=WEEKLY"]),
        _vevent("ext-5", "取消", "DTSTART:20261101T010000Z", ["STATUS:CANCELLED"]),
    )
    res = _preview(client, base, data)
    assert res.status_code == 200, res.text
    body = res.json()
    assert _rev(client, p) == rev  # DBは変えない
    c = {x["uid"]: x for x in body["candidates"]}
    own_a = c[f"event-{a['id']}@travelcanvas.app"]
    assert own_a["action"] == "update" and own_a["event_id"] == a["id"]
    assert own_a["changes"] == {"title": {"before": "清水寺", "after": "清水寺(朝)"},
                                "local_start_time": {"before": "10:00", "after": "09:00"}}
    assert c[f"event-{b['id']}@travelcanvas.app"]["reason"] == "locked"
    assert c["ext-1"]["action"] == "create" and c["ext-1"]["address"] == "京都水族館"
    assert c["ext-1"]["local_start_time"] == "15:00"
    assert c["ext-2"]["reason"] == "duplicate"
    assert c["ext-3"]["reason"] == "no_day" and c["ext-3"]["is_all_day"] is True
    assert c["ext-4"]["reason"] == "recurring" and c["ext-5"]["reason"] == "cancelled"
    assert body["summary"] == {"total": 7, "create": 1, "update": 1, "skip": 5, "skipped_by_reason": {
        "locked": 1, "duplicate": 1, "no_day": 1, "recurring": 1, "cancelled": 1}}
    assert "secret" not in res.text and "1234" not in res.text
    assert audit_calls[-1]["action"] == "calendar_import_previewed" and "水族館" not in str(audit_calls)
    with_days = _preview(client, base, data, create_missing_days=True).json()
    assert next(x for x in with_days["candidates"] if x["uid"] == "ext-3")["action"] == "create"
    assert _preview(client, base, b"not ics").status_code == 422


# ---------------------------------------------------------------- 適用・Undo

def test_apply_and_undo(auth_client, audit_calls):
    client, owner, p, base, d1, a, b = _setup(auth_client)
    data = _ics(
        _vevent(f"event-{a['id']}@travelcanvas.app", "清水寺(朝)", "DTSTART:20261101T000000Z"),
        _vevent("ext-1", "水族館", "DTSTART;TZID=Asia/Tokyo:20261101T150000", ["LOCATION:京都水族館"]),
        _vevent("ext-3", "翌日の予定", "DTSTART;VALUE=DATE:20261102"),
    )
    preview = _preview(client, base, data, create_missing_days=True).json()
    items = [x for x in preview["candidates"] if x["action"] != "skip"]
    url = f"{base}/calendar-import/apply"
    # If-Matchが無いと400(本案の他の更新APIと同じ)、日程が無い日を作ると選んでいないと422
    assert client.post(url, json={"items": items, "create_missing_days": True}).status_code == 400
    no_days = client.post(url, json={"items": items}, headers={"If-Match": str(preview["plan_revision"])})
    assert no_days.status_code == 422
    rev = preview["plan_revision"]
    res = client.post(url, json={"items": items, "create_missing_days": True}, headers={"If-Match": str(rev)})
    assert res.status_code == 200, res.text
    assert res.json() == {"plan_revision": rev + 1, "created": 2, "updated": 1, "created_days": 1}
    detail = client.get(f"/api/v1/plans/{p}").json()
    got = sorted((d["local_date"], e["local_start_time"], e["title"]) for d in detail["days"] for e in d["events"])
    assert got == [("2026-11-01", "09:00", "清水寺(朝)"), ("2026-11-01", "12:00", "昼食"),
                   ("2026-11-01", "15:00", "水族館"), ("2026-11-02", None, "翌日の予定")]
    aquarium = next(e for d in detail["days"] for e in d["events"] if e["title"] == "水族館")
    assert aquarium["address"] == "京都水族館"
    assert audit_calls[-1]["details"]["created"] == 2
    # 古い版では適用できない
    assert client.post(url, json={"items": items, "create_missing_days": True},
                       headers={"If-Match": str(rev)}).status_code == 409
    undo = client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)})
    assert undo.status_code == 200, undo.text
    detail = client.get(f"/api/v1/plans/{p}").json()
    got = sorted((d["local_date"], e["local_start_time"], e["title"]) for d in detail["days"] for e in d["events"])
    assert got == [("2026-11-01", "10:00", "清水寺"), ("2026-11-01", "12:00", "昼食")]
    assert [d["local_date"] for d in detail["days"]] == ["2026-11-01"]


def test_apply_validation_and_permissions(auth_client, make_user, db_session):
    client, owner, p, base, d1, a, b = _setup(auth_client)
    url = f"{base}/calendar-import/apply"
    rev = _rev(client, p)
    h = {"If-Match": str(rev)}
    ok = {"action": "create", "title": "X", "local_date": "2026-11-01", "local_start_time": "09:00"}
    assert client.post(url, json={"items": [{**ok, "local_start_time": "25:00"}]}, headers=h).status_code == 422
    assert client.post(url, json={"items": [{**ok, "action": "delete"}]}, headers=h).status_code == 422
    assert client.post(url, json={"items": [{**ok, "action": "update", "event_id": str(uuid.uuid4())}]},
                       headers=h).status_code == 409
    db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(b["id"])).update({"locked": True})
    db_session.commit()
    res = client.post(url, json={"items": [ok, {**ok, "action": "update", "event_id": b["id"]}]}, headers=h)
    assert res.status_code == 409 and _rev(client, p) == rev  # 全件検査してから適用
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    _act_as(viewer)
    assert _preview(client, base, _ics()).status_code == 403
    assert client.post(url, json={"items": [ok]}, headers=h).status_code == 403


def test_export_then_import_roundtrip(auth_client):
    """書き出したICSをそのまま取り込むと「変更なし」になる(同じ予定として認識する)。"""
    client, owner, p, base, d1, a, b = _setup(auth_client)
    ics = client.get(f"/api/v1/plans/{p}/exports/calendar.ics").content
    body = _preview(client, base, ics).json()
    reasons = {x["title"]: (x["action"], x["reason"]) for x in body["candidates"]}
    assert reasons == {"清水寺": ("skip", "unchanged"), "昼食": ("skip", "unchanged")}
