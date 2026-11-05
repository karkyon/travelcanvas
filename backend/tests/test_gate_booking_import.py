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
import uuid

import httpx
import pytest
from PIL import Image

from app.models.models import AuditLog, ExtractionCandidate, Reservation
from app.services import cost_guard as cg
from app.services import provider_calls as pc
from app.services import provider_http as ph
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


def _png_with_exif() -> bytes:
    out = io.BytesIO()
    ex = Image.Exif()
    ex[0x010F] = "SecretMaker"
    Image.new("RGB", (2400, 1200), (250, 250, 250)).save(out, format="PNG", exif=ex.tobytes())
    return out.getvalue()


def test_image_needs_consent_and_is_rebuilt_before_send(auth_client, monkeypatch, db_session):
    client, _o, _p, base = _plan(auth_client)
    seen = {}

    def fake(db, plan, caller, instructions, schema, text, image, key):
        seen["image"] = image
        return {"text": json.dumps({"fields": [
            {"field": "type", "value": "flight", "quote": ""},
            {"field": "confirmation_number", "value": "IMG12345", "quote": ""},
            {"field": "start_at", "value": "2026-04-10 08:30", "quote": ""}]})}, {}

    monkeypatch.setattr(pc, "ai_extract_reservation", fake)
    files = lambda: {"file": ("shot.png", io.BytesIO(_png_with_exif()), "image/png")}  # noqa: E731
    no = client.post(f"{base}/imports/extract/file", files=files())
    assert no.status_code == 422 and no.json()["detail"]["code"] == "ai_consent_required" and "image" not in seen
    job = client.post(f"{base}/imports/extract/file", files=files(), data={"ai_consent": "true"}).json()
    assert job["provider"] == "openai_image"
    assert {c["field_path"] for c in job["candidates"]} == {"type", "confirmation_number", "start_at"}
    assert b"SecretMaker" not in seen["image"]
    assert max(Image.open(io.BytesIO(seen["image"])).size) == rx.AI_IMAGE_EDGE
    exe = {"file": ("x.jpg", io.BytesIO(b"MZ" * 50), "image/jpeg")}
    fake_exe = client.post(f"{base}/imports/extract/file", files=exe, data={"ai_consent": "true"})
    assert fake_exe.status_code == 422 and fake_exe.json()["detail"]["code"] == "unsupported_image"


def test_image_denied_for_class_without_ai_returns_guard_error(auth_client, monkeypatch):
    client, _o, _p, base = _plan(auth_client)

    def denied(*a, **k):
        raise cg.CostGuardError("tier_feature_not_included", 403, "このクラスには AI が含まれません")

    monkeypatch.setattr(pc, "ai_extract_reservation", denied)
    r = client.post(f"{base}/imports/extract/file", data={"ai_consent": "true"},
                    files={"file": ("a.png", io.BytesIO(_png_with_exif()), "image/png")})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "tier_feature_not_included"


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
