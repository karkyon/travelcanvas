"""[Gate SpotOwnPhoto] 行きたい場所に自分の写真(ファイル・クリップボードから)を入れる。

- 撮影情報を取り除き、利用者のデータ鍵で暗号化して保存。応答に保存の場所を出さない
- 本文は持ち主だけが読める。差し替え・外す・場所の削除でファイルも消す
- provider=own を利用者が勝手に指すことはできない(今の写真をそのまま残す時だけ)
"""
import io

import pytest
from PIL import Image

from app.core.config import settings


def _jpeg_with_gps() -> bytes:
    ex = Image.Exif()
    ex[0x010F] = "MyCam"
    gps = ex.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (26.0, 12.0, 0.0)
    out = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 80, 40)).save(out, format="JPEG", exif=ex.tobytes())
    return out.getvalue()


@pytest.fixture(autouse=True)
def storage(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    yield tmp_path / "documents"


def _spot(client):
    r = client.post("/api/v1/spots/", json={"name": "首里そば", "category": "restaurant"})
    assert r.status_code == 201, r.text
    return r.json()


def _files(store):
    return [p for p in store.rglob("*") if p.is_file()]


def test_upload_read_replace_and_delete(auth_client, storage):
    client, _user = auth_client
    s = _spot(client)
    r = client.post(f"/api/v1/spots/{s['id']}/photo",
                    files={"file": ("clipboard-1.jpg", _jpeg_with_gps(), "image/jpeg")})
    assert r.status_code == 200, r.text
    photo = r.json()["photo"]
    assert photo["provider"] == "own" and len(photo["provider_id"]) == 32
    assert "storage_key" not in photo and "mime_type" not in photo
    files = _files(storage)
    assert len(files) == 1 and b"MyCam" not in files[0].read_bytes()  # 暗号化して保存
    media = client.get(f"/api/v1/spots/{s['id']}/photo/media")
    assert media.status_code == 200 and media.headers["content-type"] == "image/jpeg"
    assert b"MyCam" not in media.content  # 撮影情報を取り除いた
    assert Image.open(io.BytesIO(media.content)).size == (40, 30)
    # 今の写真を残したまま他を直す
    keep = client.put(f"/api/v1/spots/{s['id']}", json={"name": "首里そば 本店", "photo": photo})
    assert keep.status_code == 200 and keep.json()["photo"]["provider_id"] == photo["provider_id"]
    assert len(_files(storage)) == 1
    # 差し替えると前のファイルを消す
    r2 = client.post(f"/api/v1/spots/{s['id']}/photo", files={"file": ("b.png", _png(), "image/png")})
    assert r2.status_code == 200 and r2.json()["photo"]["provider_id"] != photo["provider_id"]
    assert len(_files(storage)) == 1
    # 外すと消す
    assert client.put(f"/api/v1/spots/{s['id']}", json={"photo": None}).status_code == 200
    assert _files(storage) == []
    assert client.get(f"/api/v1/spots/{s['id']}/photo/media").status_code == 404
    # 場所の削除でも消す
    client.post(f"/api/v1/spots/{s['id']}/photo", files={"file": ("c.png", _png(), "image/png")})
    assert len(_files(storage)) == 1
    assert client.delete(f"/api/v1/spots/{s['id']}").status_code == 200
    assert _files(storage) == []


def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (10, 10), (0, 120, 90)).save(out, format="PNG")
    return out.getvalue()


def test_cannot_point_to_own_photo_freely(auth_client):
    client, _user = auth_client
    s = _spot(client)
    fake = {"provider": "own", "provider_id": "0" * 32}
    assert client.put(f"/api/v1/spots/{s['id']}", json={"photo": fake}).status_code == 422
    r = client.post("/api/v1/spots/", json={"name": "x", "category": "other", "photo": fake})
    assert r.status_code == 422
    bad = {"provider": "own", "provider_id": "../../etc"}
    assert client.put(f"/api/v1/spots/{s['id']}", json={"photo": bad}).status_code == 422


def test_rejects_non_image_and_other_users(auth_client, make_user):
    from app.core.auth import AuthResult, get_current_user
    from app.main import app

    client, _owner = auth_client
    s = _spot(client)
    r = client.post(f"/api/v1/spots/{s['id']}/photo", files={"file": ("a.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 422
    ok = client.post(f"/api/v1/spots/{s['id']}/photo", files={"file": ("a.png", _png(), "image/png")})
    assert ok.status_code == 200
    stranger, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=stranger, is_authenticated=True, is_guest=False)
    assert client.get(f"/api/v1/spots/{s['id']}/photo/media").status_code == 404
    assert client.post(f"/api/v1/spots/{s['id']}/photo",
                       files={"file": ("a.png", _png(), "image/png")}).status_code == 403
