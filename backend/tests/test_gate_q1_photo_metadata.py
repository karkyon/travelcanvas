"""
[Gate Q1] 写真の撮影情報(EXIF・XMP・IPTC・PNG の文字情報)を取り除く(DOC-15 CA-009、DOC-14 §12)。

検証する主な性質:
- JPEG・PNG・WebP の撮影位置(GPS)・機種・XMP・コメントを取り除き、画像の中身(画素)は変えない(再圧縮しない)
- JPEG の向き(Orientation)が 1 以外なら、向きを画素に反映してから取り除く(横向きにならない)
- 構造を読めないファイルは、撮影情報の印が無ければそのまま、有れば受け付けない
- 写真の記録の保存(upload)で取り除き、保存した大きさ・ハッシュは取り除いた後のもの。Q1 より前に保存した写真も配信の時に取り除く
"""
import io
import uuid

import pytest
from PIL import Image

from app.api.v1 import memories as memories_api
from app.core.config import settings
from app.models.models import Memory
from app.services import image_metadata as im
from app.services.storage_backend import (
    compute_sha256, generate_storage_key, get_storage_backend, load_decrypted_file, save_encrypted_file,
)

GPS_IFD = 0x8825


def _exif(orientation: int = 1) -> Image.Exif:
    ex = Image.Exif()
    ex[0x010F] = "TestMaker"   # Make
    ex[0x0110] = "TestCam 1"   # Model
    ex[0x0112] = orientation   # Orientation
    gps = ex.get_ifd(GPS_IFD)
    gps[1] = "N"
    gps[2] = (35.0, 0.0, 0.0)
    gps[3] = "E"
    gps[4] = (135.0, 45.0, 0.0)
    return ex


def _image(w=40, h=20) -> Image.Image:
    img = Image.new("RGB", (w, h), (200, 30, 30))
    for x in range(w // 2):
        for y in range(h):
            img.putpixel((x, y), (20, 40, 220))
    return img


def _jpeg(orientation=1, xmp=True) -> bytes:
    out = io.BytesIO()
    _image().save(out, format="JPEG", quality=90, exif=_exif(orientation).tobytes())
    data = out.getvalue()
    if xmp:
        payload = b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta><exif:GPSLatitude>35,0N</exif:GPSLatitude></x:xmpmeta>"
        com = b"secret comment"
        seg = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
        seg += b"\xff\xfe" + (len(com) + 2).to_bytes(2, "big") + com
        data = data[:2] + seg + data[2:]
    return data


def _png() -> bytes:
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", "GPS 35.0N 135.75E")
    info.add_itxt("XML:com.adobe.xmp", "<x:xmpmeta>gps</x:xmpmeta>")
    out = io.BytesIO()
    _image().save(out, format="PNG", pnginfo=info, exif=_exif().tobytes())
    return out.getvalue()


def _webp() -> bytes:
    out = io.BytesIO()
    _image().save(out, format="WEBP", lossless=True, exif=_exif().tobytes(), xmp=b"<x:xmpmeta>gps</x:xmpmeta>")
    return out.getvalue()


def _pixels(data: bytes):
    with Image.open(io.BytesIO(data)) as img:
        return img.size, list(img.convert("RGB").getdata())


def _no_metadata(data: bytes):
    with Image.open(io.BytesIO(data)) as img:
        assert len(img.getexif()) == 0
        assert "xmp" not in img.info and "XML:com.adobe.xmp" not in img.info and "Comment" not in img.info
    assert not im.has_metadata_marker(data)
    assert b"TestMaker" not in data and b"secret comment" not in data


# ---------------------------------------------------------------- 単体


def test_jpeg_metadata_removed_without_recompression():
    src = _jpeg()
    assert im.has_metadata_marker(src) and b"TestMaker" in src
    out, changed = im.strip(".jpg", src)
    assert changed is True
    _no_metadata(out)
    # 画像のデータ(SOS 以降)はそのまま(再圧縮しない)
    assert out[out.index(b"\xff\xda"):] == src[src.index(b"\xff\xda"):]
    assert _pixels(out) == _pixels(src)
    # もう一度かけても変わらない
    assert im.strip(".jpg", out) == (out, False)


def test_jpeg_orientation_applied_before_removal():
    src = _jpeg(orientation=6, xmp=False)  # 時計回りに90度回して見る写真
    out, changed = im.strip(".jpeg", src)
    assert changed is True
    _no_metadata(out)
    with Image.open(io.BytesIO(out)) as img:
        assert img.size == (20, 40)  # 縦横が入れ替わる(画素に向きを反映した)


def test_png_and_webp_metadata_removed():
    for ext, src in ((".png", _png()), (".webp", _webp())):
        assert im.has_metadata_marker(src) or b"TestMaker" in src, ext
        out, changed = im.strip(ext, src)
        assert changed is True, ext
        _no_metadata(out)
        assert _pixels(out) == _pixels(src), ext


def test_gif_and_unparseable_files():
    gif = io.BytesIO()
    _image().save(gif, format="GIF")
    assert im.strip(".gif", gif.getvalue()) == (gif.getvalue(), False)
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    assert im.strip(".png", fake_png) == (fake_png, False)
    with pytest.raises(im.MetadataUnremovable):
        im.strip(".jpg", b"\xff\xd8\xff\xe1\x00" + b"Exif\x00\x00" + b"\x00" * 20)


# ---------------------------------------------------------------- API


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    monkeypatch.setattr(memories_api, "record_audit_event", lambda **kw: None)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def test_upload_and_media_have_no_metadata(auth_client, db_session):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "写真の撮影情報"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    src = _jpeg()
    r = client.post(f"{base}/memories/upload", data={"kind": "photo"},
                    files={"file": ("gps.jpg", io.BytesIO(src))})
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    row = db_session.get(Memory, uuid.UUID(mid))
    stored = load_decrypted_file(get_storage_backend(), row.storage_key)
    _no_metadata(stored)
    assert row.size == len(stored) and row.sha256 == compute_sha256(stored)
    media = client.get(f"{base}/memories/{mid}/media")
    assert media.status_code == 200
    _no_metadata(media.content)
    assert _pixels(media.content) == _pixels(src)

    # 取り除けないファイルは受け付けない
    bad = b"\xff\xd8\xff\xe1\x00" + b"Exif\x00\x00" + b"\x00" * 20
    r2 = client.post(f"{base}/memories/upload", data={"kind": "photo"}, files={"file": ("x.jpg", io.BytesIO(bad))})
    assert r2.status_code == 422 and r2.json()["detail"]["code"] == "metadata_unremovable"

    # Q1 より前に保存した写真(撮影情報が残っている)も、配信の時に取り除く
    key = generate_storage_key(uuid.UUID(p), ".png")
    old = _png()
    save_encrypted_file(get_storage_backend(), key, old)
    m = Memory(plan_id=uuid.UUID(p), author_user_id=owner.id, kind="photo", storage_key=key, mime_type="image/png",
               size=len(old), sha256=compute_sha256(old), visibility="private")
    db_session.add(m)
    db_session.commit()
    legacy = client.get(f"{base}/memories/{m.id}/media")
    assert legacy.status_code == 200
    _no_metadata(legacy.content)
    assert _pixels(legacy.content) == _pixels(old)
