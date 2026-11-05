"""[Gate WishPlaces] URL・画像の読み取りと、行きたい場所の一覧。"""
from pathlib import Path

import httpx
import pytest

from app.services import reservation_extract as rx
from app.services import url_place as up

FIXTURES = Path(__file__).parent / "fixtures"
PAGE = """<html><head><title>長い題名 | サイト</title><meta property="og:title" content="og の名前">
<meta property="og:description" content="説明">
<script type="application/ld+json">{"@type":"Restaurant","name":"海の見える食堂",
"address":{"addressRegion":"三重県","addressLocality":"鳥羽市","streetAddress":"1-2-3"},
"geo":{"latitude":34.48,"longitude":136.84}}</script></head></html>"""


def test_ページの構造化データから場所を読む():
    got = up.parse_page(PAGE, "https://example.com/a")
    assert (got.name, got.address, got.latitude) == ("海の見える食堂", "三重県 鳥羽市 1-2-3", 34.48)
    assert up.parse_page("<title>題名だけ</title>", "https://e.com").name == "題名だけ"


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://169.254.169.254/latest/", "http://10.0.0.1/", "http://[::1]/",  # noqa: E501
                                 "http://localhost/", "ftp://example.com/", "https://example.com:8443/",
                                 "https://user:pw@example.com/"])
def test_内部のアドレスや特殊な_URL_は読まない(url):
    with pytest.raises(up.PageUnavailable):
        up.check_url(url)


def test_転送先が内部なら読まない(monkeypatch):
    monkeypatch.setattr(up, "public_addresses", lambda host, port: (_ for _ in ()).throw(up.PageUnavailable("x"))
                        if host == "169.254.169.254" else ["93.184.216.34"])
    monkeypatch.setattr(up, "transport", httpx.MockTransport(
        lambda request: httpx.Response(302, headers={"location": "http://169.254.169.254/"})))
    with pytest.raises(up.PageUnavailable):
        up.read_page("https://example.com/")


def test_公開のページはアドレスへ直接つなぎ_HTML_だけ読む(monkeypatch):
    seen = []

    def handler(request):
        seen.append((request.url.host, request.headers["host"]))
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=PAGE)

    monkeypatch.setattr(up, "public_addresses", lambda host, port: ["93.184.216.34"])
    monkeypatch.setattr(up, "transport", httpx.MockTransport(handler))
    assert up.read_page("https://example.com/a").name == "海の見える食堂"
    assert seen == [("93.184.216.34", "example.com")]
    monkeypatch.setattr(up, "transport", httpx.MockTransport(lambda r: httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"x")))  # noqa: E501
    with pytest.raises(up.PageUnavailable):
        up.read_page("https://example.com/a")


def test_画像の文字から場所の名前らしい行を拾う():
    assert up.place_lines("いいね 120件\n伊勢神宮\nhttps://a.example\n12345\nおかげ横丁 #赤福") == ["伊勢神宮", "おかげ横丁 #赤福"]


def test_API_読めない_URL_は読めないと返す(auth_client):
    client, _ = auth_client
    body = client.post("/api/v1/spots/read-url", json={"url": "http://127.0.0.1/admin"}).json()
    assert body["ok"] is False and body["reason"]


@pytest.mark.skipif(not rx.ocr_available(), reason="tesseract が無い")
def test_API_画像を読む(auth_client):
    client, _ = auth_client
    name = "receipt_jp_photo.jpg"
    res = client.post("/api/v1/spots/read-image", files={"file": (name, (FIXTURES / name).read_bytes(), "image/jpeg")})
    assert res.status_code == 200 and isinstance(res.json()["words"], list)


def test_一覧の_mine_は本人の場所だけ(auth_client, make_user, db_session):
    from app.models.models import Spot
    client, user = auth_client
    other, _ = make_user()
    db_session.add(Spot(name="他人の公開", category="other", is_public=True, created_by=other.id))
    db_session.commit()
    assert client.post("/api/v1/spots/", json={"name": "自分の場所"}).status_code == 201
    names = [s["name"] for s in client.get("/api/v1/spots/?mine=true").json()]
    assert names == ["自分の場所"]
    assert client.get("/api/v1/spots/categories/list").json()["categories"]
