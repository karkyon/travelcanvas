"""
[Gate G11] 外部の画像・SNS の投稿の確認(docs/ux/G11_UIUX全範囲_実装仕様.md §2.4・§5、UIX-M09・UIX-M14)。

- GET  /media-providers/status                         : 使える provider(画面は止めてある項目を出さない)
- GET  /media-providers/images?q=&lat=&lng=             : 外部の画像の候補(作者・ライセンス・出典・取り込めるか)
- GET  /media-providers/images/thumb?provider=&id=      : 候補の縮小画像(サーバーが provider から取り直して中継する。
                                                          ブラウザから外部へ直接読みに行かない。短い間だけ端末にキャッシュ)
- POST /plans/{plan_id}/memories/import-external        : 外部の画像を非公開の記録として取り込む({provider, provider_id}。
                                                          サーバーが取り直す。ライセンスが許すものだけ。記録と同じ検査・暗号化)
- POST /plans/{plan_id}/candidates/social-preview       : SNS の投稿 URL の確認(保存しない。取れない時は URL とメモで保存できる)

全てログインが要る(ゲストも可)。監査には provider と ID だけを残す(画像の本文・題名は残さない)。
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import User
from app.services import candidates as cs
from app.services.audit_service import record_audit_event
from app.services import free_usage
from app.services.media_providers import ProviderUnavailable, now
from app.services.media_providers import registry
from app.services.media_providers.wikimedia import IMAGE_MIMES

logger = logging.getLogger(__name__)
router = APIRouter(tags=["media-providers"])
plan_router = APIRouter(prefix="/plans", tags=["media-providers"])

MIME_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
THUMB_MAX_BYTES = 2 * 1024 * 1024


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _provider(name: str):
    p = registry.image_providers().get(name)
    if p is None:
        raise _bad("provider_disabled", "この画像の提供元は使えません(止めてあります)", 404)
    return p


_UNAVAILABLE = {
    "license_not_allowed": ("license_not_allowed", "この画像はライセンス(非商用・改変禁止・不明など)のため取り込めません", 422),
    "too_large": ("file_too_large", "画像が大きすぎます", 413),
    "not_found": ("not_found", "画像が見つかりません(消えたか、取り違えています)", 404),
    "invalid_id": ("invalid_field", "画像の ID の形式が不正です", 422),
    "unsupported_type": ("unsupported_type", "対応していない形式の画像です", 422),
}


def _unavailable(e: ProviderUnavailable) -> HTTPException:
    code, msg, status = _UNAVAILABLE.get(e.code, ("provider_unavailable", "画像の提供元に今はつながりません", 503))
    return _bad(code, msg, status)


def _record_free(db: Session, user: User, provider: str, operation: str, code: str, plan_id=None) -> None:
    """[Gate FR059-D11] 無料の provider へ送った1回を記録する(言葉・画像の ID・URL は残さない)"""
    if provider in free_usage.FREE_PROVIDERS:
        free_usage.record(db, user, provider, operation, result_code=code, plan_id=plan_id)
        db.commit()


@router.get("/media-providers/status")
def media_status(current_user: User = Depends(get_current_user_or_guest)):
    return registry.status()


@router.get("/media-providers/images")
async def search_images(q: Optional[str] = Query(None, max_length=200),
                        lat: Optional[float] = Query(None, ge=-90, le=90),
                        lng: Optional[float] = Query(None, ge=-180, le=180),
                        current_user: User = Depends(get_current_user_or_guest), db: Session = Depends(get_db)):
    if (lat is None) != (lng is None):
        raise _bad("invalid_field", "緯度と経度は両方を指定してください")
    if not (q and q.strip()) and lat is None:
        raise _bad("invalid_field", "探す言葉か場所を指定してください")
    results: List[Dict[str, Any]] = []
    unavailable: List[Dict[str, str]] = []
    for name, p in registry.image_providers().items():
        code = "ok"
        try:
            found = [c.to_dict() for c in await p.search(q, lat, lng, 12)]
            results.extend(found)
            code = "ok" if found else "empty"
        except ProviderUnavailable as e:
            unavailable.append({"provider": name, "reason": e.code})
            code = "unavailable"
        except Exception:  # noqa: BLE001 - 1つの提供元の失敗で他を止めない。値は作らない
            logger.warning("image provider %s failed", name)
            unavailable.append({"provider": name, "reason": "network"})
            code = "unavailable"
        if name in free_usage.FREE_PROVIDERS:  # [Gate FR059-D11] 無料の provider の使用の記録
            free_usage.record(db, current_user, name, "images.search", result_code=code)
    db.commit()
    return {"images": results, "unavailable": unavailable, "retrieved_at": now().isoformat()}


@router.get("/media-providers/images/thumb")
async def image_thumb(provider: str = Query(..., max_length=40), id: str = Query(..., max_length=260),
                      current_user: User = Depends(get_current_user_or_guest),
                      db: Session = Depends(get_db)) -> Response:
    p = _provider(provider)
    try:
        img = await p.thumbnail(id, THUMB_MAX_BYTES)
    except ProviderUnavailable as e:
        _record_free(db, current_user, provider, "images.thumb", "unavailable")
        raise _unavailable(e)
    _record_free(db, current_user, provider, "images.thumb", "ok")
    if img.mime not in IMAGE_MIMES:
        raise _bad("unsupported_type", "対応していない形式の画像です")
    return Response(content=img.content, media_type=img.mime, headers={
        "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
    })


class ImportExternal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(..., max_length=40)
    provider_id: str = Field(..., max_length=260)
    body: Optional[str] = Field(None, max_length=2000)
    event_id: Optional[str] = None


@plan_router.post("/{plan_id}/memories/import-external", status_code=201)
async def import_external(plan_id: str, payload: ImportExternal, request: Request, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user_or_guest)):
    from app.api.v1 import memories as memories_api

    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    p = _provider(payload.provider)
    try:
        img = await p.fetch(payload.provider_id, settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES)
    except ProviderUnavailable as e:
        _record_free(db, current_user, payload.provider, "images.fetch", "unavailable", plan.id)
        raise _unavailable(e)
    _record_free(db, current_user, payload.provider, "images.fetch", "ok", plan.id)
    ext = MIME_EXT.get(img.mime)
    if ext is None:
        raise _bad("unsupported_type", "対応していない形式の画像です")
    meta = img.meta
    source = {
        "kind": "external", "provider": meta.provider, "provider_id": meta.provider_id,
        "source_page_url": meta.source_page_url, "author": meta.author, "license": meta.license,
        "license_url": meta.license_url, "attribution": meta.attribution, "retrieved_at": meta.retrieved_at.isoformat(),
        "modified": None,
    }
    m = await memories_api.save_photo(request, db, plan, current_user, img.content, f"external{ext}",
                                      body=payload.body or meta.title, event_id=payload.event_id, source=source,
                                      include_in_journal=False)
    record_audit_event(action="memory.import_external", resource_type="memory", user_id=current_user.id,
                       resource_id=m.id, details={"plan_id": str(plan.id), "provider": meta.provider,
                                                  "license": meta.license})
    return memories_api._to_dict(m, current_user, plan, memories_api._names(db, plan))


class SocialPreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(..., max_length=4000)


@plan_router.post("/{plan_id}/candidates/social-preview")
async def social_preview(plan_id: str, payload: SocialPreviewIn, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user_or_guest)):
    require_plan_access(db, plan_id, current_user, min_role="editor")
    try:
        url = cs.canonical_url(payload.url)
    except cs.CandidateInputError as e:
        raise _bad(e.code, str(e))
    if not url:
        raise _bad("invalid_field", "URL を入力してください")
    preview = await registry.social_provider().preview(url)
    if preview.status in ("ok", "unavailable"):  # 外へ送った時だけ(未対応・無効は送っていない)
        free_usage.record(db, current_user, "oembed", "social.preview", plan_id=_plan_uuid(plan_id),
                          result_code="ok" if preview.status == "ok" else "unavailable")
        db.commit()
    return preview.to_dict()


def _plan_uuid(plan_id: str):
    import uuid as _uuid

    try:
        return _uuid.UUID(str(plan_id))
    except ValueError:
        return None
