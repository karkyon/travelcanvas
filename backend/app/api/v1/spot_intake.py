"""[Gate WishPlaces] 行きたい場所・予定の追加で使う、URL と画像の読み取り(SC-47)。読むだけで保存しない。

- POST /spots/read-url  : SNS は公式の oEmbed、ほかの Web ページは url_place で 1 ページ読む
- POST /spots/read-image: 画像の文字(OCR)から場所の名前らしい行を拾う。画像は外へ送らず保存しない
- POST /spots/place-info: [Gate PlanSpotEdit] 名前・位置から住所・電話番号・種類を読む(押した時の 1 回。place_lookup)
- POST /spots/geocode: [Gate PlaceLookupJP] 住所から地図の位置の候補
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import User
from app.services import candidates as cs
from app.services import free_usage
from app.services import place_info as pi
from app.services import reservation_extract as rx
from app.services import url_place as up
from app.services.media_providers import registry
from app.services.media_providers.social import platform_of
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/spots", tags=["spots"])


class ReadUrlIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(..., max_length=2000)


def _limit(user: User, name: str) -> None:
    if not check_rate_limit(f"{name}:{user.id}", 30, 600):
        raise HTTPException(status_code=429, detail={"code": "too_many_requests", "message": "回数が多すぎます。しばらく待ってください"})


@router.post("/read-url")
async def read_url(body: ReadUrlIn, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    _limit(current_user, "spot-url")
    try:
        url = cs.canonical_url(body.url)
    except cs.CandidateInputError as error:
        raise HTTPException(status_code=422, detail={"code": error.code, "message": str(error)})
    if not url:
        raise HTTPException(status_code=422, detail={"code": "invalid_field", "message": "URL を入力してください"})
    if platform_of(url):
        preview = await registry.social_provider().preview(url)
        if preview.status in ("ok", "unavailable"):
            free_usage.record(db, current_user, "oembed", "social.preview",
                              result_code="ok" if preview.status == "ok" else "unavailable")
            db.commit()
        data = preview.to_dict()
        return {"kind": "sns", "ok": preview.status == "ok", "url": url, "name": None, "title": data.get("title"),
                "author": data.get("author"), "reason": data.get("reason"), "description": None, "address": None,
                "latitude": None, "longitude": None, "suggestions": data.get("place_suggestions") or []}
    try:
        page = await run_in_threadpool(up.read_page, url)
    except up.PageUnavailable as error:
        return {"kind": "page", "ok": False, "url": url, "name": None, "title": None, "author": None, "reason": str(error),  # noqa: E501
                "description": None, "address": None, "latitude": None, "longitude": None, "suggestions": []}
    return {"kind": "page", "ok": True, "url": page.url, "name": page.name, "title": page.name, "author": None, "reason": None,  # noqa: E501
            "description": page.description, "address": page.address, "latitude": page.latitude,
            "longitude": page.longitude, "suggestions": []}


@router.post("/read-image")
async def read_image(file: UploadFile = File(...), current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:  # noqa: E501
    _limit(current_user, "spot-image")
    content = await file.read(rx.MAX_IMAGE_BYTES + 1)
    try:
        rx.prepare_image(content)
    except rx.ExtractInputError as error:
        raise HTTPException(status_code=413 if error.code == "file_too_large" else 422,
                            detail={"code": error.code, "message": str(error)})
    text = await run_in_threadpool(rx.ocr_image, content, "jpn+eng")
    return {"words": up.place_lines(text), "ocr_available": rx.ocr_available()}


class PlaceInfoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(None, max_length=200)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


def _recorder(db: Session, user: User, operation: str):
    from app.services import place_lookup as pl

    def record(provider: str, code: str) -> None:
        free_usage.record(db, user, pl.USAGE.get(provider, provider), operation, result_code=code)
    return record


@router.post("/place-info")
async def place_info(body: PlaceInfoIn, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    """[Gate PlanSpotEdit][Gate PlaceLookupJP] 場所の住所・電話・公式サイト・種類・位置の候補(保存しない)。
    Yahoo!ローカルサーチ・楽天トラベル・ホットペッパー(鍵がある時)と OpenStreetMap・Wikidata・国土地理院から集めてまとめる。
    出典は sources(各提供元のクレジット)。"""
    from app.services import place_lookup as pl

    has_point = body.latitude is not None and body.longitude is not None
    if not (body.name or "").strip() and not has_point:
        raise HTTPException(status_code=422, detail={"code": "invalid_field", "message": "名前か位置を入れてください"})
    _limit(current_user, "place-info")
    result = await pl.lookup(db, body.name, body.latitude, body.longitude,
                             _recorder(db, current_user, "event.place_info"))
    db.commit()
    # 以前の形(OpenStreetMap の出典)も残す(古い画面のため)
    return {"provider": "multi", "attribution": pi.ATTRIBUTION, "license": pi.LICENSE, "license_url": pi.LICENSE_URL,
            "candidates": result["candidates"], "sources": result["sources"],
            "keyed_providers": result["keyed_providers"], "cached": result["cached"],
            "unavailable": result["unavailable"],
            "error_code": "server_error" if result["unavailable"] else None}


class GeocodeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(..., min_length=1, max_length=200)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


@router.post("/geocode")
async def geocode(body: GeocodeIn, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    """[Gate PlaceLookupJP] 住所(または名前)から地図の位置の候補(保存しない)。
    Yahoo!ジオコーダ(鍵がある時)→ 国土地理院の住所検索 → OpenStreetMap の順に、見つかるまで引く。"""
    from app.services import place_lookup as pl

    if not body.query.strip():
        raise HTTPException(status_code=422, detail={"code": "invalid_field", "message": "住所を入れてください"})
    _limit(current_user, "place-info")
    result = await pl.geocode(db, body.query, body.latitude, body.longitude,
                              _recorder(db, current_user, "event.geocode"))
    db.commit()
    return result
