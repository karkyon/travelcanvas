"""[Gate2 G2-04] 日の時刻帯: 新しい旅行・日を追加で端末の時刻帯を付けられる。UTC で作られた日は、予定の「壁の時計」を保ったまま付け替えられる。

背景: 時刻帯を送らないと日は UTC になり、日本の 10:00 の予定が「9 時間後」と見え、朝 9 時前は今日が空になった(Gate② 2026-11-18)。
"""
import uuid
from datetime import datetime, timezone

from app.services import today_mode

H = lambda: {"Idempotency-Key": str(uuid.uuid4())}  # noqa: E731
D = "2026-11-21"
JST_0830 = datetime(2026, 11, 20, 23, 30, tzinfo=timezone.utc)  # 2026-11-21 08:30 JST
JST_1005 = datetime(2026, 11, 21, 1, 5, tzinfo=timezone.utc)    # 2026-11-21 10:05 JST


def _promote(client, **extra):
    body = {"title": "近場", "start_date": D, "end_date": D,
            "events": [{"title": "朝のカフェ", "local_date": D, "start_time": "10:00"}]}
    draft = client.post("/api/v1/quick-drafts", json=body, headers=H()).json()
    r = client.post(f"/api/v1/quick-drafts/{draft['id']}/promote",
                    json={"device_token": draft["device_token"], **extra}, headers=H())
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _today(client, p, monkeypatch, now):
    monkeypatch.setattr(today_mode, "utcnow", lambda: now)
    return client.get(f"/api/v1/plans/{p}/today").json()


def test_promote_without_timezone_keeps_utc_default(auth_client):
    client, _ = auth_client
    p = _promote(client)
    assert [d["timezone_id"] for d in client.get(f"/api/v1/plans/{p}").json()["days"]] == ["UTC"]


def test_promote_with_timezone_makes_today_and_next_correct(auth_client, monkeypatch):
    client, _ = auth_client
    p = _promote(client, timezone_id="Asia/Tokyo")
    assert [d["timezone_id"] for d in client.get(f"/api/v1/plans/{p}").json()["days"]] == ["Asia/Tokyo"]
    early = _today(client, p, monkeypatch, JST_0830)
    assert early["today_date"] == D and early["next_event"]["title"] == "朝のカフェ"
    assert early["minutes_until_next"] == 90
    late = _today(client, p, monkeypatch, JST_1005)
    assert late["now_event"]["title"] == "朝のカフェ"


def test_utc_day_is_the_wrong_by_nine_hours_before_the_fix(auth_client, monkeypatch):
    """UTC の日がどう壊れて見えるか(これが直す対象)。朝 9 時前は今日が空、10:05 に「次」は約 9 時間後"""
    client, _ = auth_client
    p = _promote(client)
    assert _today(client, p, monkeypatch, JST_0830)["today_date"] is None
    assert _today(client, p, monkeypatch, JST_1005)["minutes_until_next"] == 535


def test_promote_rejects_unknown_timezone(auth_client):
    client, _ = auth_client
    body = {"title": "x", "start_date": D, "end_date": D, "events": []}
    draft = client.post("/api/v1/quick-drafts", json=body, headers=H()).json()
    r = client.post(f"/api/v1/quick-drafts/{draft['id']}/promote",
                    json={"device_token": draft["device_token"], "timezone_id": "Mars/Base"}, headers=H())
    assert r.status_code == 422


def test_create_day_accepts_iana_timezone(auth_client):
    client, _ = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "t"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    ok = client.post(f"{base}/days", json={"local_date": D, "timezone_id": "Asia/Tokyo"}, headers=H())
    assert ok.status_code == 201 and ok.json()["timezone_id"] == "Asia/Tokyo"


def test_update_day_timezone_keeps_wall_clock_and_fixes_today(auth_client, monkeypatch):
    client, _ = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "t"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": D}, headers=H()).json()
    assert day["timezone_id"] == "UTC"
    ev = client.post(
        f"{base}/events",
        json={
            "day_id": day["id"], "title": "朝のカフェ", "event_type": "other",
            "start_at": "2026-11-21T10:00:00Z", "end_at": "2026-11-21T11:00:00Z",
        },
        headers=H(),
    )
    assert ev.status_code in (200, 201), ev.text  # UTC の日の 10:00-11:00(壁の時計)
    rev = client.get(base).json()["revision"]
    r = client.put(f"{base}/days/{day['id']}", json={"timezone_id": "Asia/Tokyo"}, headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    assert r.json()["timezone_id"] == "Asia/Tokyo"
    plan = client.get(base).json()
    e = plan["days"][0]["events"][0]
    assert e["start_at"].startswith("2026-11-21T01:00")  # 10:00 JST = 01:00 UTC(壁の時計の 10:00 はそのまま)
    assert e["end_at"].startswith("2026-11-21T02:00")
    now = _today(client, p, monkeypatch, JST_0830)
    assert now["today_date"] == D and now["minutes_until_next"] == 90
    # 取り消し(Undo)は日と予定の両方を元に戻す
    u = client.post(f"{base}/undo", headers={"If-Match": str(client.get(base).json()["revision"])})
    assert u.status_code == 200, u.text
    back = client.get(base).json()["days"][0]
    assert back["timezone_id"] == "UTC" and back["events"][0]["start_at"].startswith("2026-11-21T10:00")


def test_update_day_rejects_unknown_timezone_and_ignores_same_zone(auth_client):
    client, _ = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "t"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": D, "timezone_id": "Asia/Tokyo"}, headers=H()).json()
    rev = client.get(base).json()["revision"]
    bad = client.put(f"{base}/days/{day['id']}", json={"timezone_id": "Mars/Base"}, headers={"If-Match": str(rev)})
    assert bad.status_code == 422
    same = client.put(
        f"{base}/days/{day['id']}",
        json={"timezone_id": "Asia/Tokyo", "title": "朝"},
        headers={"If-Match": str(rev)},
    )
    assert same.status_code == 200 and same.json()["title"] == "朝" and same.json()["timezone_id"] == "Asia/Tokyo"
