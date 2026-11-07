"""
[Gate BookingImport] 予約メール・画像からの候補の作成(FR-011)。

- 規則の読み取りは費用も外部送信も無い。候補を作るだけで、確定までは予約を作らない
- AI へ送る文章は予約番号・PIN・氏名・電話・メールを伏せる。本文に無い引用の値・メールの中の指示は採らない
- 画像は同意が無いと送らない。撮影情報を残さない
- 元の文章は保存しない
"""
import base64
import io
import json
import pathlib
import uuid

import httpx
import pytest
from PIL import Image

from app.models.models import AuditLog, ExtractionCandidate, Reservation
from app.services import cost_guard as cg
from app.services import provider_calls as pc
from app.services import provider_http as ph
from app.services import provider_secrets as ps
from app.services import reservation_extract as rx

HOTEL = """件名: 【じゃらん】ご予約確認
差出人: "じゃらんnet" <info@example.jp>

金沢 太郎 様
予約番号：ＡＢＣ１２３４５
予約者氏名: 金沢 太郎 様
チェックイン：２０２６年４月１０日（金） １５：００
チェックアウト：2026年4月11日(土) 10:00
宿泊人数：大人2名
お支払い金額（税込）：¥24,800
TEL: 076-000-0000
キャンセル期限 2026/04/08 18:00
"""
FLIGHT = """ANA 便名 NH123 搭乗日 2026-04-10 08:30
Booking reference: XY7Q2Z
Total: JPY 15,200"""


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(auth_client):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "金沢"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    client.post(f"{base}/days", json={"local_date": "2026-04-10", "timezone_id": "Asia/Tokyo"}, headers=_ik())
    return client, owner, p, base


def _png_with_exif() -> bytes:
    out = io.BytesIO()
    ex = Image.Exif()
    ex[0x010F] = "SecretMaker"
    Image.new("RGB", (2400, 1200), (250, 250, 250)).save(out, format="PNG", exif=ex.tobytes())
    return out.getvalue()


def test_rules_read_japanese_hotel_mail():
    got = {c.field: c.value for c in rx.rule_extract(HOTEL).candidates}
    assert got["type"] == "accommodation" and got["provider_name"] == "じゃらん"
    assert got["confirmation_number"] == "ABC12345" and got["holder_name"] == "金沢 太郎"
    assert got["start_at"] == "2026-04-10T15:00:00+09:00" and got["end_at"] == "2026-04-11T10:00:00+09:00"
    assert got["guest_count"] == "2" and got["total_amount"] == "24800" and got["currency"] == "JPY"
    assert got["contact_phone"] == "076-000-0000" and got["cancellation_deadline"].startswith("2026-04-08T18:00")


def test_rules_read_english_flight():
    got = {c.field: c.value for c in rx.rule_extract(FLIGHT).candidates}
    assert got["type"] == "flight" and got["provider_name"] == "ANA" and got["confirmation_number"] == "XY7Q2Z"
    assert got["start_at"] == "2026-04-10T08:30:00+09:00" and got["total_amount"] == "15200"


# 実際の予約メールの形(番号は架空)。メールの送信日時の「日時」を開始日時にしないこと
REAL_STAY = """件名: 【Yahoo!トラベル】ご予約確認
日時: 2026年10月31日 20:34
●予約番号　　　　　　：IK0000000000
●施設名　　　　　　　：都リゾート 奥志摩 アクアフォレスト
●チェックイン日　　　：2026年11月28日（土）
●チェックイン可能時間：15:00～18:00
●チェックアウト日　　：2026年11月29日（日）
●チェックアウト時間　：～11:00
●到着予定時間　　　　：15:00
●宿泊日数　　　　　　：1泊
●プラン名称　　　　　：【飲み放題付】大自然＆ブッフェ満喫！伊勢志摩リゾートステイ（夕朝食付）
●食事　　　　　　　　：夕朝食付
●お部屋　　　　　　　：【最上階】メゾネットルーム（禁煙）（ペット不可）(ツイン) × 1部屋
●宿泊人数　　　　　　：大人4名
"""


def _stay_checks(got):
    assert got["type"] == "accommodation"
    assert got["start_at"] == "2026-11-28T15:00:00+09:00" and got["end_at"] == "2026-11-29T11:00:00+09:00"
    assert got["guest_count"] == "4" and got["confirmation_number"] == "IK0000000000"
    assert "アクアフォレスト" in got["provider_name"] and got["detail.meal"] == "夕朝食付"
    assert "メゾネットルーム" in got["detail.room"] and "伊勢志摩リゾートステイ" in got["detail.plan_name"]
    assert got["detail.checkin_window"].startswith("15:00") and "11:00" in got["detail.checkout_limit"]


def test_real_stay_mail_reads_every_field():
    got = {c.field: c.value for c in rx.rule_extract(REAL_STAY).candidates}
    _stay_checks(got)
    assert got["provider_name"] == "都リゾート 奥志摩 アクアフォレスト"
    assert got["detail.booking_site"] == "Yahoo!トラベル" and got["detail.nights"] == "1泊"
    assert got["detail.room"].startswith("【最上階】") and got["detail.plan_name"].startswith("【飲み放題付】")


def test_year_is_taken_from_trip_when_mail_has_none():
    text = "チェックイン日:11月28日\nチェックアウト日:11月29日"
    got = {c.field: c.value for c in rx.rule_extract(text, year=2026).candidates}
    assert got["start_at"].startswith("2026-11-28") and got["end_at"].startswith("2026-11-29")


def test_mail_sent_date_is_never_a_start_date():
    got = {c.field: c.value for c in rx.rule_extract("日時: 2026年10月31日 20:34\n予約番号: AB12345").candidates}
    assert "start_at" not in got


@pytest.mark.skipif(not rx.ocr_available(), reason="tesseract なし")
@pytest.mark.parametrize("name", ["booking_mail_pc.png", "booking_mail_phone.png"])
def test_real_screenshot_is_read_by_ocr(name):
    # 実際の画面の画像を OCR にかける(模擬なし)
    content = (pathlib.Path(__file__).parent / "fixtures" / name).read_bytes()
    _stay_checks({c.field: c.value for c in rx.rule_extract(rx.ocr_image(content)).candidates})


@pytest.mark.skipif(not rx.ocr_available(), reason="tesseract なし")
def test_image_endpoint_needs_no_key_or_ai_then_apply_creates_booking_and_event(auth_client, db_session, monkeypatch):
    client, _o, p, base = _plan(auth_client)
    monkeypatch.setattr(pc, "ai_extract_reservation", lambda *a, **k: pytest.fail("AI を呼ばない"))
    content = (pathlib.Path(__file__).parent / "fixtures" / "booking_mail_pc.png").read_bytes()
    day = client.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()
    job = client.post(f"{base}/imports/extract/file", files={"file": ("s.png", io.BytesIO(content), "image/png")})
    assert job.status_code == 201, job.text
    body = job.json()
    assert body["provider"] == "ocr" and body["ai_status"] == "off"
    fields = {c["field_path"]: c["value"] for c in body["candidates"]}
    fields["provider_name"] = "都リゾート 奥志摩 アクアフォレスト"  # 利用者が直した
    done = client.post(f"{base}/imports/{body['id']}/apply", json={"fields": fields, "add_to_itinerary": True})
    assert done.status_code == 200, done.text
    res = db_session.query(Reservation).filter(Reservation.plan_id == p).one()
    assert res.provider_name == "都リゾート 奥志摩 アクアフォレスト" and res.guest_count == 4
    assert "部屋: 【最上階】メゾネットルーム" in res.notes and "食事: 夕朝食付" in res.notes
    assert res.event_id is not None and done.json()["event_id"] == str(res.event_id)
    plan = client.get(f"{base}").json()
    events = [e for d in plan["days"] if d["id"] == day["id"] for e in d["events"]]
    assert [(e["title"], e["local_start_time"]) for e in events] == [("都リゾート 奥志摩 アクアフォレスト", "15:00")]


def test_apply_outside_trip_keeps_booking_and_explains(auth_client, db_session):
    client, _o, p, base = _plan(auth_client)
    job = client.post(f"{base}/imports/extract/text", json={"text": REAL_STAY}).json()
    fields = {c["field_path"]: c["value"] for c in job["candidates"]}
    fields["guest_count"] = None  # 空にした項目は使わない
    fields["start_at"] = "bad"
    assert client.post(f"{base}/imports/{job['id']}/apply", json={"fields": fields}).status_code == 422
    fields["start_at"] = "2026-11-28T15:00:00+09:00"
    fields["unknown"] = "x"
    assert client.post(f"{base}/imports/{job['id']}/apply", json={"fields": fields}).status_code == 422
    del fields["unknown"]
    out = client.post(f"{base}/imports/{job['id']}/apply", json={"fields": fields, "add_to_itinerary": True}).json()
    assert out["event_id"] is None and "旅程" in out["itinerary_note"]
    assert db_session.query(Reservation).filter(Reservation.plan_id == p).one().guest_count is None


def test_expired_key_never_gives_500_and_keeps_rules(auth_client, monkeypatch):
    # 実際に起きた不具合: 鍵の確認切れの例外を捕まえず 500 になった
    client, _o, _p, base = _plan(auth_client)

    def unavailable(*a, **k):
        raise ps.SecretUnavailable("secret_verification_expired")

    monkeypatch.setattr(pc, "ai_extract_reservation", unavailable)
    kept = client.post(f"{base}/imports/extract/text", json={"text": "ホテル 予約番号: AAA11111", "use_ai": True})
    assert kept.status_code == 201 and kept.json()["ai_status"] == "denied" and "鍵" in kept.json()["ai_message"]
    plain = _png_with_exif()
    no_text = client.post(f"{base}/imports/extract/file", data={"ai_consent": "true"},
                          files={"file": ("a.png", io.BytesIO(plain), "image/png")})
    assert no_text.status_code == 422 and "鍵" in no_text.json()["detail"]["message"]

    def boom(*a, **k):
        raise RuntimeError("x")

    monkeypatch.setattr(pc, "ai_extract_reservation", boom)
    assert client.post(f"{base}/imports/extract/text",
                       json={"text": "ホテル 予約番号: AAA11111", "use_ai": True}).status_code == 201


def test_rules_do_not_invent_values():
    assert rx.rule_extract("こんにちは。来週の予定を教えてください。").candidates == []


def test_eml_decodes_iso2022jp_html_and_ignores_attachments():
    from email.mime.application import MIMEApplication
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    msg = MIMEMultipart()
    msg["Subject"] = "予約確認"
    msg.attach(MIMEText("<style>x{}</style><p>予約番号: QWE98765</p><p>チェックイン 2026/4/10 15:00</p>", "html", "iso-2022-jp"))
    msg.attach(MIMEApplication(b"secret attachment", Name="予約番号 ZZZ99999.pdf"))
    text = rx.parse_eml(msg.as_bytes())
    assert "QWE98765" in text and "x{}" not in text and "secret attachment" not in text
    with pytest.raises(rx.ExtractInputError):
        rx.parse_eml(b"x" * (rx.MAX_EML_BYTES + 1))


def test_mask_hides_identifiers():
    masked = rx.mask_for_ai(HOTEL + "\nカード 4111 1111 1111 1111\n連絡 taro@example.jp 090-1234-5678\nPIN: 1234")
    for secret in ("ABC12345", "金沢 太郎 様\n予約番号", "4111", "taro@example.jp", "090-1234", "1234\n", "info@example.jp"):
        assert secret not in masked
    assert "2026年4月10日" in masked and "[予約番号]" in masked


def test_merge_ai_rejects_unquoted_sensitive_and_invalid_values():
    out = rx.Extraction()
    masked = "ホテル金沢 2026-04-10 15:00 [予約番号]"
    body = json.dumps({"fields": [
        {"field": "provider_name", "value": "ホテル金沢", "quote": "ホテル金沢"},
        {"field": "start_at", "value": "2026-04-10 15:00", "quote": "2026-04-10 15:00"},
        {"field": "total_amount", "value": "99999", "quote": "本文に無い"},
        {"field": "confirmation_number", "value": "HACK1", "quote": "[予約番号]"},
        {"field": "type", "value": "wire_transfer", "quote": "ホテル金沢"},
        {"field": "contact_url", "value": "https://evil.example", "quote": "ホテル金沢"},
    ]})
    assert rx.merge_ai(out, body, "Asia/Tokyo", source="AI", masked_text=masked) == 2
    assert {c.field for c in out.candidates} == {"provider_name", "start_at"}
    assert rx.merge_ai(rx.Extraction(), "not json", "Asia/Tokyo", source="AI", masked_text=masked) == 0


def test_text_endpoint_makes_candidates_then_confirm_creates_reservation(auth_client, db_session, monkeypatch):
    client, _o, p, base = _plan(auth_client)
    called = []
    monkeypatch.setattr(pc, "ai_extract_reservation", lambda *a, **k: called.append(1))
    r = client.post(f"{base}/imports/extract/text", json={"text": HOTEL})
    assert r.status_code == 201, r.text
    job = r.json()
    assert called == [] and job["provider"] == "rules" and job["status"] == "review_required"
    assert job["ai_status"] == "off" and job["warnings"] == []
    assert db_session.query(Reservation).filter(Reservation.plan_id == p).count() == 0
    # 元の文章はどこにも保存しない。値は暗号文
    row = db_session.query(ExtractionCandidate).filter_by(import_job_id=job["id"], field_path="holder_name").one()
    assert "金沢".encode() not in row.candidate_value_ciphertext
    for c in job["candidates"]:
        assert client.post(f"{base}/imports/{job['id']}/candidates/{c['id']}/accept", headers=_ik()).status_code == 200
    done = client.post(f"{base}/imports/{job['id']}/confirm")
    assert done.status_code == 200, done.text
    res = db_session.query(Reservation).filter(Reservation.plan_id == p).one()
    assert res.type == "accommodation" and res.provider_name == "じゃらん"
    assert res.confirmation_number_masked.endswith("2345")
    audit = db_session.query(AuditLog).filter_by(action="import_job_extracted").all()
    assert not audit or "金沢" not in json.dumps(audit[0].details, ensure_ascii=False)


def test_warns_when_outside_trip_and_empty_is_rejected(auth_client):
    client, _o, _p, base = _plan(auth_client)
    far = HOTEL.replace("２０２６年４月１０日", "2027年1月5日")
    job = client.post(f"{base}/imports/extract/text", json={"text": far}).json()
    assert "日程の外" in job["warnings"][0]
    empty = client.post(f"{base}/imports/extract/text", json={"text": "こんにちは"})
    assert empty.status_code == 422 and empty.json()["detail"]["code"] == "nothing_extracted"


def test_ai_gets_masked_text_only_when_requested_and_denial_keeps_rules(auth_client, monkeypatch):
    client, _o, _p, base = _plan(auth_client)
    seen = {}

    def fake(db, plan, caller, instructions, schema, text, image, key):
        seen["text"], seen["image"] = text, image
        return {"text": json.dumps({"fields": [{"field": "start_at", "value": "2026-04-10 09:00",
                                                "quote": "2026-04-10 09:00"}]})}, {}

    monkeypatch.setattr(pc, "ai_extract_reservation", fake)
    mail = "ホテル利用 2026-04-10 09:00 予約番号: AAA11111\ntaro@example.jp"
    job = client.post(f"{base}/imports/extract/text", json={"text": mail, "use_ai": True}).json()
    assert job["provider"] == "rules+openai" and job["ai_status"] == "used"
    assert "AAA11111" not in seen["text"] and "taro@" not in seen["text"] and seen["image"] is None

    def denied(*a, **k):
        raise cg.CostGuardError("tier_feature_not_included", 403, "このクラスには AI が含まれません")

    monkeypatch.setattr(pc, "ai_extract_reservation", denied)
    kept = client.post(f"{base}/imports/extract/text", json={"text": mail, "use_ai": True}).json()
    assert kept["provider"] == "rules" and kept["ai_status"] == "denied" and "AI" in kept["ai_message"]
    full = client.post(f"{base}/imports/extract/text", json={"text": HOTEL, "use_ai": True}).json()
    assert full["ai_status"] == "not_needed"


def test_eml_file_endpoint(auth_client):
    client, _o, _p, base = _plan(auth_client)
    raw = f"Subject: x\nContent-Type: text/plain; charset=utf-8\n\n{HOTEL}".encode()
    eml = {"file": ("m.eml", io.BytesIO(raw), "message/rfc822")}
    job = client.post(f"{base}/imports/extract/file", files=eml).json()
    assert job["provider"] == "rules" and any(c["field_path"] == "confirmation_number" for c in job["candidates"])


def test_openai_request_shape_for_image():
    sent = {}

    def handler(request):
        sent.update(json.loads(request.content))
        return httpx.Response(200, json={"output": []})

    ph.set_transport(httpx.MockTransport(handler))
    try:
        jpeg = base64.b64encode(b"\xff\xd8\xff").decode()
        image = {"type": "input_image", "image_url": f"data:image/jpeg;base64,{jpeg}"}
        content = [{"role": "user", "content": [image]}]
        pc._openai_request("k", content, 600, rx.AI_INSTRUCTIONS, rx.ai_schema())
    finally:
        ph.set_transport(None)
    assert sent["store"] is False and sent["input"][0]["content"][0]["type"] == "input_image"
    assert sent["text"]["format"]["strict"] is True
    assert "データ" in sent["instructions"]


def test_image_sent_to_ai_only_with_consent_and_rebuilt(auth_client, monkeypatch):
    client, _o, _p, base = _plan(auth_client)
    seen = {}

    def fake(db, plan, caller, instructions, schema, text, image, key):
        seen["image"] = image
        return {"text": json.dumps({"fields": [{"field": "type", "value": "flight", "quote": ""},
                                               {"field": "start_at", "value": "2026-04-10 08:30", "quote": ""}]})}, {}

    monkeypatch.setattr(pc, "ai_extract_reservation", fake)
    monkeypatch.setattr(rx, "ocr_image", lambda content: "")
    files = lambda: {"file": ("shot.png", io.BytesIO(_png_with_exif()), "image/png")}  # noqa: E731
    no = client.post(f"{base}/imports/extract/file", files=files())
    assert no.status_code == 422 and "image" not in seen
    job = client.post(f"{base}/imports/extract/file", files=files(), data={"ai_consent": "true"}).json()
    assert job["provider"] == "ocr+openai" and b"SecretMaker" not in seen["image"]
    assert max(Image.open(io.BytesIO(seen["image"])).size) == rx.AI_IMAGE_EDGE
    exe = {"file": ("x.jpg", io.BytesIO(b"MZ" * 50), "image/jpeg")}
    assert client.post(f"{base}/imports/extract/file", files=exe).json()["detail"]["code"] == "unsupported_image"


# ===== 旅行の日程の変更


def _trip(auth_client, dates=("2026-11-28", "2026-11-29")):
    client = auth_client[0]
    p = client.post("/api/v1/travel-plans/", json={"title": "鳥羽"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    days = [client.post(f"{base}/days", json={"local_date": d, "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()
            for d in dates]
    for i, d in enumerate(days):
        client.post(f"{base}/events", json={"day_id": d["id"], "title": f"予定{i + 1}", "local_start_time": "10:00",
                                            "start_at": f"{dates[i]}T01:00:00Z"}, headers=_ik())
    return client, p, base


def _rev(client, base):
    return {"If-Match": str(client.get(base).json()["revision"])}


def _dates(client, base):
    return [(d["local_date"], [e["title"] for e in d["events"]]) for d in client.get(base).json()["days"]]


def test_reschedule_moves_days_and_events_including_overlap(auth_client):
    client, p, base = _trip(auth_client)
    r = client.post(f"{base}/reschedule", json={"start_date": "2026-11-29", "end_date": "2026-11-30"},
                    headers=_rev(client, base))
    assert r.status_code == 200, r.text
    assert _dates(client, base) == [("2026-11-29", ["予定1"]), ("2026-11-30", ["予定2"])]
    first = client.get(base).json()["days"][0]["events"][0]
    assert first["start_at"].startswith("2026-11-29T01:00") and first["local_start_time"] == "10:00"
    plan = client.get(f"/api/v1/travel-plans/{p}").json()
    assert plan["start_date"].startswith("2026-11-29") and plan["end_date"].startswith("2026-11-30")
    back = client.post(f"{base}/reschedule", json={"start_date": "2026-11-28", "end_date": "2026-11-29"},
                       headers=_rev(client, base))
    assert back.status_code == 200 and _dates(client, base)[0][0] == "2026-11-28"


def test_reschedule_extends_and_shortens_with_confirmation(auth_client):
    client, _p, base = _trip(auth_client)
    longer = client.post(f"{base}/reschedule", json={"start_date": "2026-12-01", "end_date": "2026-12-03"},
                         headers=_rev(client, base))
    assert longer.json()["days"] == 3
    assert [d for d, _e in _dates(client, base)] == ["2026-12-01", "2026-12-02", "2026-12-03"]
    body = {"start_date": "2026-12-01", "end_date": "2026-12-01"}
    blocked = client.post(f"{base}/reschedule", json=body, headers=_rev(client, base))
    assert blocked.status_code == 409 and blocked.json()["detail"]["days"][0]["events"] == ["予定2"]
    assert len(_dates(client, base)) == 3
    done = client.post(f"{base}/reschedule", json={**body, "remove_days_with_events": True}, headers=_rev(client, base))
    assert done.status_code == 200 and _dates(client, base) == [("2026-12-01", ["予定1"])]


def test_reschedule_rejects_bad_input_and_stale_revision(auth_client):
    client, _p, base = _trip(auth_client)
    good = _rev(client, base)
    assert client.post(f"{base}/reschedule", json={"start_date": "2026-12-05", "end_date": "2026-12-01"},
                       headers=good).status_code == 422
    assert client.post(f"{base}/reschedule", json={"start_date": "2026-01-01", "end_date": "2026-12-01"},
                       headers=good).status_code == 422
    assert client.post(f"{base}/reschedule", json={"start_date": "2026-12-01", "end_date": "2026-12-02"},
                       headers={"If-Match": "999"}).status_code in (409, 412)


def test_reschedule_can_be_undone_in_both_directions(auth_client):
    # ChangeItem の順序に依らず、重なる日付へ動かしても戻せること(日数を多くして順序の偶然を減らす)
    dates = ("2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29")
    client, _p, base = _trip(auth_client, dates)
    original = _dates(client, base)
    for start, end in (("2026-11-25", "2026-11-30"), ("2026-11-23", "2026-11-28")):
        body = {"start_date": start, "end_date": end}
        moved = client.post(f"{base}/reschedule", json=body, headers=_rev(client, base))
        assert moved.status_code == 200, moved.text
        undone = client.post(f"{base}/undo", headers=_rev(client, base))
        assert undone.status_code == 200, undone.text
        assert _dates(client, base) == original
    longer = client.post(f"{base}/reschedule", json={"start_date": "2026-11-25", "end_date": "2026-12-02"},
                         headers=_rev(client, base))
    assert longer.status_code == 200
    assert client.post(f"{base}/undo", headers=_rev(client, base)).status_code == 200
    assert _dates(client, base) == original
    shorter = {"start_date": "2026-11-25", "end_date": "2026-11-26", "remove_days_with_events": True}
    assert client.post(f"{base}/reschedule", json=shorter, headers=_rev(client, base)).status_code == 200
    assert client.post(f"{base}/undo", headers=_rev(client, base)).status_code == 200
    assert _dates(client, base) == original


# [Gate BookingImportYahoo] Yahoo!トラベルの予約の確認の画面を選んで写した文(表の枠はタブ。番号・名前・電話は架空)
YAHOO_PAGE = (pathlib.Path(__file__).parent / "fixtures" / "yahoo_travel_page.txt").read_text(encoding="utf-8")


def test_yahoo_travel_page_copy_reads_every_field():
    got = {c.field: c.value for c in rx.rule_extract(YAHOO_PAGE).candidates}
    assert got["provider_name"] == "都リゾート 奥志摩 アクアフォレスト"  # 次の行の電話を名前に付けない
    assert got["contact_phone"] == "0599-00-0000"
    assert got["guest_count"] == "2" and got["holder_name"].startswith("山田 花子")
    assert got["start_at"] == "2026-11-28T15:00:00+09:00" and got["end_at"] == "2026-11-29T11:00:00+09:00"
    assert got["detail.checkout_limit"] == "~11:00" and got["detail.checkin_window"] == "15:00~18:00"
    assert got["detail.meal"] == "夕朝食付"  # 1 行に 2 組の見出しと値(料金・サービス料 / 食事)
    assert got["total_amount"] == "84100" and got["currency"] == "JPY"  # お支払い金額(1 泊 1 人の額ではない)
    assert got["detail.cancel_policy"].startswith("3日前まで 無料 / 2日前 20%")
    assert got["cancellation_deadline"] == "2026-11-25T23:59:00+09:00"  # 2日前から料金 → 3日前の 23:59 まで無料
    assert "決済" not in got.get("cancellation_deadline", "")
    assert got["detail.booking_site"] == "Yahoo!トラベル"


def test_explicit_free_cancel_deadline_wins_and_meal_from_plan_name():
    text = ("宿泊施設: 海の宿\nチェックイン日: 2026年8月1日\n無料キャンセル期限: 2026年7月29日 18:00\n"
            "キャンセル規定\n前日 50%\nプラン: 朝食付きプラン\n大人：3名")
    got = {c.field: c.value for c in rx.rule_extract(text).candidates}
    assert got["cancellation_deadline"] == "2026-07-29T18:00:00+09:00"
    assert got["detail.meal"] == "朝食付き" and got["guest_count"] == "3"
    tz = rx._zone("Asia/Tokyo")
    assert rx.free_cancel_deadline("前日 50% / 当日 100%", (2026, 8, 1), tz).startswith("2026-07-30T23:59")
    assert rx.free_cancel_deadline("無料", (2026, 8, 1), tz) is None


def _ascii_pdf(lines):
    """文字の PDF(Helvetica・英数字だけ)を作る(試験用)"""
    content = "BT /F1 12 Tf 50 750 Td 14 TL " + " ".join(f"({x}) Tj T*" for x in lines) + " ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
            "/Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


@pytest.mark.skipif(not rx.pdf_available(), reason="pdftotext なし")
def test_pdf_file_endpoint_reads_text(auth_client):
    client, _owner, _p, base = _plan(auth_client)
    pdf = _ascii_pdf(["ANA Flight NH123", "Booking reference: XY7Q2Z", "Departure: 2026-04-10 08:30",
                      "Total: JPY 15,200"])
    assert "XY7Q2Z" in rx.pdf_text(pdf)
    r = client.post(f"{base}/imports/extract/file", files={"file": ("booking.pdf", pdf, "application/pdf")})
    assert r.status_code == 201, r.text
    got = {c["field_path"]: c["value"] for c in r.json()["candidates"]}
    assert got["confirmation_number"] == "XY7Q2Z" and got["total_amount"] == "15200"
    bad = client.post(f"{base}/imports/extract/file", files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 422


def test_delete_import_job_removes_job_and_candidates_but_keeps_reservation(auth_client, db_session):
    client, _owner, _p, base = _plan(auth_client)
    job = client.post(f"{base}/imports/extract/text", json={"text": HOTEL}).json()
    jid = job["id"]
    assert client.delete(f"{base}/imports/{jid}").status_code == 204
    assert all(j["id"] != jid for j in client.get(f"{base}/imports").json())
    left = db_session.query(ExtractionCandidate).filter(ExtractionCandidate.import_job_id == uuid.UUID(jid))
    assert left.count() == 0
    assert client.delete(f"{base}/imports/{jid}").status_code == 404
    # 登録まで済んだジョブを消しても、予約は残る
    job2 = client.post(f"{base}/imports/extract/text", json={"text": HOTEL}).json()
    fields = {c["field_path"]: c["value"] for c in job2["candidates"]}
    applied = client.post(f"{base}/imports/{job2['id']}/apply", json={"fields": fields})
    assert applied.status_code == 200, applied.text
    rid = applied.json()["reservation_id"]
    assert client.delete(f"{base}/imports/{job2['id']}").status_code == 204
    assert db_session.get(Reservation, uuid.UUID(rid)) is not None
