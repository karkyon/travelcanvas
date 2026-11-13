"""
[Gate Remaining-5] サーバー側の PDF・画像(FR-035・FR-046)・埋め込み(FR-042)・カレンダーの購読(FR-036)・顔の検査の接続口(FR-037)。

検証する主な性質:
- しおりの版の PDF(%PDF で始まる・ページ数)と NOW/NEXT の PNG。字体が無い環境は 503 font_unavailable
- 埋め込み: 所有者が「埋め込み」を選んだ・合言葉なし・回数の制限なしの共有だけ。CSP の frame-ancestors・スクリプトなし・
  旅程の項目は共有の規則どおり(選ばれていない住所は出ない)
- カレンダーの購読: 推測できない URL で ICS。作り直すと前の URL は 404。止めると 404。住所は入らない
- 顔の検査: 鍵が無い時は configured=false(送らない)。鍵がある時は顔の数を返す(写真は自分の分だけ)
"""
import uuid

import httpx
import pytest
from PIL import ImageFont

from app.services import face_check
from app.services import provider_secrets as ps
from app.services import server_render as sr

SECTIONS = ["cover", "schedule", "reservations", "packing", "notes"]


@pytest.fixture()
def font(monkeypatch):
    """CI に日本語の字体が無くても動くように、無い時は Pillow の既定の字体にする(四角になるだけ)"""
    if sr.find_font() is None:
        monkeypatch.setattr(sr, "_font", lambda size: ImageFont.load_default(size))


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "京都の旅", "destination": "京都"}).json()["id"]
    d = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-20", "timezone_id": "Asia/Tokyo"},
                    headers=_ik()).json()
    client.post(f"/api/v1/plans/{p}/events", json={"day_id": d["id"], "title": "清水寺", "local_start_time": "09:00",
                                                   "address": "京都市東山区清水1-294"}, headers=_ik())
    return p


def test_booklet_pdf_and_font_unavailable(auth_client, font, monkeypatch):
    client, _ = auth_client
    p = _plan(client)
    ex = client.post(f"/api/v1/plans/{p}/booklet-exports", json={"sections": SECTIONS, "format": "web"})
    assert ex.status_code == 201, ex.text
    eid = ex.json()["export"]["id"]
    r = client.get(f"/api/v1/plans/{p}/booklet-exports/{eid}/pdf")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert "attachment" in r.headers["content-disposition"] and r.headers["cache-control"] == "no-store"

    def no_font(size):
        raise sr.FontUnavailable("x")

    monkeypatch.setattr(sr, "_font", no_font)
    r2 = client.get(f"/api/v1/plans/{p}/booklet-exports/{eid}/pdf")
    assert r2.status_code == 503 and r2.json()["detail"]["code"] == "font_unavailable"


def test_booklet_pdf_many_days_paginates(font):
    snap = {"cover": {"title": "長い旅"}, "schedule": {"days": [
        {"date": f"2026-11-{i:02d}", "events": [{"title": f"予定{j}", "local_start_time": "09:00"} for j in range(12)]}
        for i in range(1, 11)]}, "notes": ["メモ"]}
    data, pages = sr.booklet_pdf(snap)
    assert data.startswith(b"%PDF") and pages >= 3


def test_today_card_png(auth_client, font):
    client, _ = auth_client
    p = _plan(client)
    r = client.get(f"/api/v1/plans/{p}/today/card.png")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")


def _share(client, p, fields, **kw):
    body = {"permission": "view", "fields": fields, **kw}
    r = client.post(f"/api/v1/travel-plans/{p}/share", json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()["url"].rsplit("/", 1)[-1]


def test_embed_only_when_opted_in(auth_client):
    client, _ = auth_client
    p = _plan(client)
    plain = _share(client, p, ["event_times"])
    assert client.get(f"/api/v1/public/embed/{plain}").status_code == 404
    locked = _share(client, p, ["event_times", "embed"], passcode="abcd1234")
    assert client.get(f"/api/v1/public/embed/{locked}").status_code == 404
    ok = _share(client, p, ["event_times", "embed"])
    r = client.get(f"/api/v1/public/embed/{ok}")
    assert r.status_code == 200, r.text
    assert "清水寺" in r.text and "09:00" in r.text and "<script" not in r.text
    assert "東山区" not in r.text  # 住所は選ばれていない
    csp = r.headers["content-security-policy"]
    assert "frame-ancestors *" in csp and "default-src 'none'" in csp
    assert r.headers["x-frame-options"] != "DENY"
    js = client.get("/api/v1/public/embed.js")
    assert js.status_code == 200 and "data-travelcanvas-embed" in js.text


def test_calendar_feed_lifecycle(auth_client):
    client, _ = auth_client
    p = _plan(client)
    assert client.get(f"/api/v1/plans/{p}/calendar-feed").json()["enabled"] is False
    feed = client.post(f"/api/v1/plans/{p}/calendar-feed").json()
    assert feed["webcal_url"].startswith("webcal://") and feed["url"].endswith(".ics")
    path = "/api/v1" + feed["url"].split("/api/v1", 1)[1]
    r = client.get(path, headers={"Authorization": ""})
    assert r.status_code == 200 and r.text.startswith("BEGIN:VCALENDAR") and "清水寺" in r.text
    assert "東山区" not in r.text
    assert client.get(f"/api/v1/plans/{p}/calendar-feed").json()["url"] == feed["url"]
    again = client.post(f"/api/v1/plans/{p}/calendar-feed").json()
    assert again["url"] != feed["url"] and client.get(path).status_code == 404
    client.delete(f"/api/v1/plans/{p}/calendar-feed")
    assert client.get("/api/v1" + again["url"].split("/api/v1", 1)[1]).status_code == 404


def test_face_check_requires_key_and_counts(auth_client, monkeypatch):
    client, _ = auth_client
    p = _plan(client)
    r = client.post(f"/api/v1/plans/{p}/memories/publications/face-check", json={"photo_ids": [str(uuid.uuid4())]})
    assert r.status_code == 200 and r.json()["configured"] is False
    monkeypatch.setattr(ps, "resolve", lambda db, slot: "vision-test-key-0123")
    face_check.set_transport(httpx.MockTransport(lambda req: httpx.Response(200, json={
        "responses": [{"faceAnnotations": [{}, {}]}]})))
    try:
        from io import BytesIO

        from PIL import Image

        buf = BytesIO()
        Image.new("RGB", (40, 40), "white").save(buf, "JPEG")
        assert face_check.count_faces(None, [buf.getvalue(), b"not-an-image"]) == [2, -1]
        r2 = client.post(f"/api/v1/plans/{p}/memories/publications/face-check",
                         json={"photo_ids": [str(uuid.uuid4())]})
        assert r2.json()["configured"] is True and r2.json()["results"] == []
    finally:
        face_check.set_transport(None)
