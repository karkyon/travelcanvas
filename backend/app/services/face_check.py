"""[Gate Remaining-5] FR-037 公開の前の顔の検査の接続口(Google Cloud Vision の FACE_DETECTION。鍵が要る・有料)。

- 鍵は運用コンソールで登録した google_vision_key だけ。無い時は configured()=False で、画面は今までどおり
  「顔の自動判定はしていません。写っている人の了解を確かめてください」(作り話の判定を出さない)
- 送るのは公開しようとしている写真(撮影情報を除いた物)だけ。1 回の確かめで MAX_PHOTOS 枚まで。結果は顔の数だけ使い、
  顔の位置・表情などは保存しない
- 判定は手がかり(見落とし・誤りがある)。公開の確認(了解を得た)は人が行う
"""
from __future__ import annotations

import base64
import io
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from app.services import provider_secrets as ps

SLOT = "google_vision_key"
URL = "https://vision.googleapis.com/v1/images:annotate"
MAX_PHOTOS = 10
MAX_SIDE = 1024
_transport = None


def set_transport(transport) -> None:
    global _transport
    _transport = transport


def configured(db: Session) -> bool:
    try:
        ps.resolve(db, SLOT)
        return True
    except ps.SecretUnavailable:
        return False


def _shrink(data: bytes) -> bytes:
    """送る前に小さくし、撮影情報(EXIF)を落とす"""
    from PIL import Image

    with Image.open(io.BytesIO(data)) as src:
        im = src.convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE))
        out = io.BytesIO()
        im.save(out, "JPEG", quality=85)
        return out.getvalue()


def count_faces(db: Session, photos: List[bytes]) -> List[int]:
    """写真ごとの顔の数(読めない写真は -1)。鍵が無い・失敗は ValueError"""
    try:
        key = ps.resolve(db, SLOT)
    except ps.SecretUnavailable:
        raise ValueError("not_configured")
    reqs: List[Dict[str, Any]] = []
    index: List[int] = []
    out = [-1] * len(photos)
    for i, raw in enumerate(photos[:MAX_PHOTOS]):
        try:
            img = _shrink(raw)
        except Exception:  # noqa: BLE001 - 読めない写真は飛ばす
            continue
        reqs.append({"image": {"content": base64.b64encode(img).decode()},
                     "features": [{"type": "FACE_DETECTION", "maxResults": 20}]})
        index.append(i)
    if not reqs:
        return out
    try:
        with httpx.Client(timeout=httpx.Timeout(20.0), transport=_transport) as client:
            r = client.post(URL, params={"key": key}, json={"requests": reqs})
            r.raise_for_status()
            body = r.json()
    except (httpx.HTTPError, ValueError):
        raise ValueError("failed")
    for i, resp in zip(index, body.get("responses") or []):
        if isinstance(resp, dict) and not resp.get("error"):
            out[i] = len(resp.get("faceAnnotations") or [])
    return out


def face_boxes(db: Session, photos: List[bytes]) -> List[Optional[List[List[float]]]]:
    """[FR-063] 写真ごとの顔の枠(0〜1 の x, y, 幅, 高さ。縮めた絵の大きさで割る)。読めない写真は None。保存しない。
    鍵が無い・失敗は ValueError。顔の絵そのものは返さない(ぼかすのは端末の Canvas)"""
    try:
        key = ps.resolve(db, SLOT)
    except ps.SecretUnavailable:
        raise ValueError("not_configured")
    from PIL import Image

    reqs: List[Dict[str, Any]] = []
    index: List[int] = []
    sizes: List[Any] = []
    out: List[Optional[List[List[float]]]] = [None] * len(photos)
    for i, raw in enumerate(photos[:MAX_PHOTOS]):
        try:
            img = _shrink(raw)
            with Image.open(io.BytesIO(img)) as im:
                sizes.append(im.size)
        except Exception:  # noqa: BLE001 - 読めない写真は飛ばす
            continue
        reqs.append({"image": {"content": base64.b64encode(img).decode()},
                     "features": [{"type": "FACE_DETECTION", "maxResults": 20}]})
        index.append(i)
    if not reqs:
        return out
    try:
        with httpx.Client(timeout=httpx.Timeout(20.0), transport=_transport) as client:
            r = client.post(URL, params={"key": key}, json={"requests": reqs})
            r.raise_for_status()
            body = r.json()
    except (httpx.HTTPError, ValueError):
        raise ValueError("failed")
    for i, (w, h), resp in zip(index, sizes, body.get("responses") or []):
        if not isinstance(resp, dict) or resp.get("error"):
            continue
        boxes = []
        for face in resp.get("faceAnnotations") or []:
            vs = ((face.get("fdBoundingPoly") or face.get("boundingPoly") or {}).get("vertices")) or []
            xs = [float(v.get("x", 0)) for v in vs if isinstance(v, dict)]
            ys = [float(v.get("y", 0)) for v in vs if isinstance(v, dict)]
            if xs and ys and w and h:
                boxes.append([round(min(xs) / w, 4), round(min(ys) / h, 4),
                              round((max(xs) - min(xs)) / w, 4), round((max(ys) - min(ys)) / h, 4)])
        out[i] = boxes
    return out
