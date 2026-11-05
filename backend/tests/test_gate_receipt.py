"""[Gate Receipt] レシートの読み取り。規則・OCR(紙を撮った状態に近い画像)・API・AI の失敗・権限・保存しないこと。"""
from pathlib import Path

import pytest

from app.services import provider_calls, receipt_extract as rc, reservation_extract as rx

FIXTURES = Path(__file__).parent / "fixtures"


def _vals(text, year=2026):
    return {k: v.value for k, v in rc.rule_extract(text, year).items()}


def test_合計はお預かりやお釣りや小計ではない():
    got = _vals("居酒屋 まつり\n令和8年11月22日\n生ビール 1,400\n小計 4,200\n消費税 420\nお会計 ¥4,620\nお預り ¥5,000\nお釣り ¥380\n")
    assert got["amount"] == "4620" and got["tax_amount"] == "420" and got["currency"] == "JPY"
    assert got["local_date"] == "2026-11-22" and got["title"] == "居酒屋 まつり" and got["category"] == "food"


def test_外貨と日付の形():
    assert _vals("CAFE ROMA\n05-Nov-2026\nSubtotal 9,00\nTOTAL €10,50\nCash 20,00")["amount"] == "10.50"
    us = _vals("BLUE CAFE\nNov 22, 2026\nSubtotal 9.75\nTax 0.84\nTOTAL $10.59\nChange 9.41")
    assert (us["amount"], us["currency"], us["local_date"], us["tax_amount"]) == ("10.59", "USD", "2026-11-22", "0.84")
    assert _vals("NOODLE HOUSE\n2026/12/19\nTotal NT$280")["currency"] == "TWD"


def test_合計が読めない時は確かでないと示す():
    found = rc.rule_extract("お店\n2026/11/05\nうどん ¥800\nそば ¥900\n", 2026)
    assert found["amount"].value == "900" and found["amount"].confidence < 0.7
    assert rc.needs_ai(found)
    assert any("金額を確かめて" in w for w in rc.warnings(found, None, None, "JPY"))


@pytest.mark.skipif(not rx.ocr_available(), reason="tesseract が無い")
@pytest.mark.parametrize("name,amount,currency", [("receipt_jp_photo.jpg", "1260", "JPY"), ("receipt_en_photo.jpg", "10.59", "USD")])
def test_傾きとぼけのある画像を読む(name, amount, currency):
    got = _vals(rx.ocr_image((FIXTURES / name).read_bytes(), "jpn+eng"))
    assert got["amount"] == amount and got["currency"] == currency


def test_AI_の値は形を確かめ_確かな値は変えない():
    found = {"amount": rc.Found("1260", 0.9, "x")}
    body = '{"fields":[{"field":"amount","value":"9999"},{"field":"title","value":"店"},{"field":"local_date","value":"昨日"},{"field":"category","value":"hack"},{"field":"title","value":"https://evil.example"}]}'
    assert rc.merge_ai(found, body) == 1
    assert found["amount"].value == "1260" and found["title"].value == "店" and "local_date" not in found


def _setup(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "レシート"}).json()["id"]
    client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-21", "timezone_id": "Asia/Tokyo"})
    return f"/api/v1/plans/{p}/expenses"


def _files(name="receipt_jp_photo.jpg"):
    return {"file": (name, (FIXTURES / name).read_bytes(), "image/jpeg")}


@pytest.mark.skipif(not rx.ocr_available(), reason="tesseract が無い")
def test_API_候補を返すだけで支出は作らない(auth_client):
    client, _ = auth_client
    base = _setup(client)
    res = client.post(f"{base}/extract-receipt", files=_files())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["fields"]["amount"]["value"] == "1260" and body["ai_status"] == "off"
    assert client.get(base).json() == []


def test_AI_は同意がある時だけで_失敗しても_500_にしない(auth_client, monkeypatch):
    client, _ = auth_client
    base = _setup(client)
    called = []

    def boom(*a, **k):
        called.append(1)
        raise RuntimeError("x")

    monkeypatch.setattr(provider_calls, "ai_extract_receipt", boom)
    monkeypatch.setattr(rx, "ocr_image", lambda *a, **k: "")
    off = client.post(f"{base}/extract-receipt", files=_files())
    assert off.status_code == 422 and off.json()["detail"]["code"] in ("nothing_extracted", "ocr_unavailable") and not called
    on = client.post(f"{base}/extract-receipt", files=_files(), data={"ai_consent": "true"})
    assert on.status_code == 422 and called and "AI" in on.json()["detail"]["message"]


def test_AI_で足りない項目を補う(auth_client, monkeypatch):
    client, _ = auth_client
    base = _setup(client)
    monkeypatch.setattr(rx, "ocr_image", lambda *a, **k: "")
    monkeypatch.setattr(provider_calls, "ai_extract_receipt", lambda *a, **k: (
        {"text": '{"fields":[{"field":"amount","value":"1,500"},{"field":"title","value":"茶店"},{"field":"local_date","value":"2026-11-21"}]}'}, {}))
    body = client.post(f"{base}/extract-receipt", files=_files(), data={"ai_consent": "true"}).json()
    assert body["ai_status"] == "used" and body["fields"]["amount"]["value"] == "1500"


def test_画像以外は断る(auth_client):
    client, _ = auth_client
    base = _setup(client)
    res = client.post(f"{base}/extract-receipt", files={"file": ("a.txt", b"hello", "text/plain")})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "unsupported_image"


def test_閲覧者は読み取れない(auth_client, make_user, db_session):
    from app.core.auth import AuthResult, get_current_user
    from app.main import app
    client, _ = auth_client
    base = _setup(client)
    other, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=other, is_authenticated=True, is_guest=False)
    assert client.post(f"{base}/extract-receipt", files=_files()).status_code in (403, 404)
