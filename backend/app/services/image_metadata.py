"""[Gate Q1] 写真の撮影情報(EXIF・XMP・IPTC・PNG の文字情報)を取り除く(DOC-15 CA-009「写真EXIFも同じ公開Policyで除去」、
DOC-14 §12「EXIFは公開成果物から既定除去する」)。

写真の記録(P12)は以前、上げられたファイルをそのまま保存・配信しており、撮影位置(GPS)・機種・撮影日時が残っていた
(メンバーに公開した写真から撮影位置が分かりえた)。

- 画質を落とさないよう、ファイルの構造の該当部分だけを切り取る(JPEG のセグメント・PNG のチャンク・WebP の RIFF チャンク)。
- JPEG の向き(EXIF の Orientation)が 1 以外なら、向きを画素に反映してから保存する(EXIF を消すと横向きに見えるため)。
  この時だけ Pillow で再圧縮する(品質 92)。
- 構造を読めないファイルは、撮影情報の印(Exif・XMP)が無ければそのまま、有れば受け付けない(MetadataUnremovable)。
- GIF は撮影情報を持たないためそのまま。
"""
import io
import struct
from typing import Tuple

JPEG_KEEP_APP = {0xE0, 0xE2, 0xEE}  # APP0(JFIF)・APP2(ICC 色の情報)・APP14(Adobe の色の変換)
PNG_DROP = {b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"tIME"}
WEBP_DROP = {b"EXIF", b"XMP "}
MARKERS = (b"Exif\x00\x00", b"http://ns.adobe.com/xap", b"<x:xmpmeta", b"Photoshop 3.0\x00")


class MetadataUnremovable(ValueError):
    pass


def has_metadata_marker(content: bytes) -> bool:
    return any(m in content for m in MARKERS)


def _jpeg_orientation(content: bytes) -> int:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(content)) as im:
            return int(im.getexif().get(0x0112, 1) or 1)
    except Exception:  # noqa: BLE001 - 向きが読めなければ回さない
        return 1


def _jpeg_transpose(content: bytes) -> bytes:
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(content)) as im:
        icc = im.info.get("icc_profile")
        fixed = ImageOps.exif_transpose(im)
        out = io.BytesIO()
        kwargs = {"quality": 92, "optimize": True}
        if icc:
            kwargs["icc_profile"] = icc
        fixed.convert("RGB").save(out, format="JPEG", **kwargs)
        return out.getvalue()


def _strip_jpeg(content: bytes) -> bytes:
    if not content.startswith(b"\xff\xd8"):
        raise ValueError("not jpeg")
    out = bytearray(b"\xff\xd8")
    i = 2
    n = len(content)
    while i < n:
        if content[i] != 0xFF:
            raise ValueError("bad marker")
        while i < n and content[i] == 0xFF:  # 埋め草の 0xFF
            i += 1
        if i >= n:
            raise ValueError("truncated")
        marker = content[i]
        i += 1
        if marker == 0xDA:  # SOS: ここからは画像のデータ(終わりまでそのまま写す)
            out += b"\xff\xda" + content[i:]
            return bytes(out)
        if marker == 0xD9:
            out += b"\xff\xd9"
            return bytes(out)
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            out += bytes((0xFF, marker))
            continue
        if i + 2 > n:
            raise ValueError("truncated")
        length = struct.unpack(">H", content[i:i + 2])[0]
        if length < 2 or i + length > n:
            raise ValueError("bad length")
        segment = content[i:i + length]
        i += length
        drop = (0xE0 <= marker <= 0xEF and marker not in JPEG_KEEP_APP) or marker == 0xFE  # APPn(EXIF/XMP/IPTC)・COM
        if not drop:
            out += bytes((0xFF, marker)) + segment
    raise ValueError("no image data")


def _strip_png(content: bytes) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    if not content.startswith(sig):
        raise ValueError("not png")
    out = bytearray(sig)
    i = len(sig)
    n = len(content)
    while i < n:
        if i + 8 > n:
            raise ValueError("truncated")
        length = struct.unpack(">I", content[i:i + 4])[0]
        ctype = content[i + 4:i + 8]
        end = i + 12 + length
        if end > n or not ctype.isalpha():
            raise ValueError("bad chunk")
        if ctype not in PNG_DROP:
            out += content[i:end]
        i = end
        if ctype == b"IEND":
            return bytes(out)
    raise ValueError("no IEND")


def _strip_webp(content: bytes) -> bytes:
    if not (content[:4] == b"RIFF" and content[8:12] == b"WEBP"):
        raise ValueError("not webp")
    i = 12
    n = len(content)
    chunks = []
    while i < n:
        if i + 8 > n:
            raise ValueError("truncated")
        ctype = content[i:i + 4]
        size = struct.unpack("<I", content[i + 4:i + 8])[0]
        end = i + 8 + size + (size & 1)
        if end > n:
            raise ValueError("bad chunk")
        if ctype not in WEBP_DROP:
            data = bytearray(content[i:end])
            if ctype == b"VP8X" and size >= 10:
                data[8] &= ~0x0C & 0xFF  # EXIF(0x08)・XMP(0x04)の印を外す
            chunks.append(bytes(data))
        i = end
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def strip(ext: str, content: bytes) -> Tuple[bytes, bool]:
    """(取り除いた後のファイル, 取り除いた・向きを直したか)。読めないファイルに撮影情報の印があれば MetadataUnremovable。"""
    ext = ext.lower()
    original = content
    try:
        if ext in (".jpg", ".jpeg"):
            if _jpeg_orientation(content) not in (1, 0):
                content = _jpeg_transpose(content)
            cleaned = _strip_jpeg(content)
        elif ext == ".png":
            cleaned = _strip_png(content)
        elif ext == ".webp":
            cleaned = _strip_webp(content)
        else:
            return content, False
    except Exception:  # noqa: BLE001 - 構造を読めない
        if has_metadata_marker(content):
            raise MetadataUnremovable("撮影情報を取り除けないファイルです")
        return original, False
    return cleaned, cleaned != original
