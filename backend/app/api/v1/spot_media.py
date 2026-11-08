"""[Gate SpotFromMedia] 写真・動画・投稿から、予定に入れる場所の候補を出す(読むだけで保存しない)。

- POST /spots/places-from-text: 説明欄・投稿の文から場所の名前の候補(文の規則だけ・外へ送らない・無料)
- POST /plans/{plan_id}/spot-ai/places-image: 写真に写っている場所の候補(同意の上で OpenAI へ送る。AI の回数を 1 回使う)。
  候補ごとに住所・位置を場所の自動取得で補う(旅行の予定の位置の近く・都道府県で絞る)
- POST /plans/{plan_id}/spot-ai/places-text: 説明欄・投稿の文から場所の名前(同意の上で OpenAI。規則で拾った物と合わせる)
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import TravelEvent, User
from app.services import cost_guard as cg
from app.services import free_usage, provider_calls
from app.services import provider_secrets as ps
from app.services import reservation_extract as rx
from app.services import video_places
from app.utils.rate_limiter import check_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(tags=["spots"])

MAX_AI_PLACES = 5


def _limit(user: User, name: str, count: int = 30) -> None:
    if not check_rate_limit(f"{name}:{user.id}", count, 600):
        raise HTTPException(status_code=429, detail={"code": "too_many_requests", "message": "回数が多すぎます。しばらく待ってください"})


class TextIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(..., min_length=1, max_length=20000)
    title: Optional[str] = Field(None, max_length=300)


@router.post("/spots/places-from-text")
def places_from_text(body: TextIn, current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    _limit(current_user, "spot-text")
    return {"places": video_places.from_text(body.text, body.title), "ai": "off"}


def _plan_center(db: Session, plan_id: Any) -> Tuple[Optional[float], Optional[float]]:
    rows = db.query(TravelEvent.latitude, TravelEvent.longitude).filter(
        TravelEvent.plan_id == plan_id, TravelEvent.latitude.isnot(None),
        TravelEvent.longitude.isnot(None)).limit(200).all()
    if not rows:
        return None, None
    lats = sorted(r[0] for r in rows)
    lngs = sorted(r[1] for r in rows)
    return lats[len(lats) // 2], lngs[len(lngs) // 2]


def _ai_items(text: str) -> List[Dict[str, Any]]:
    try:
        items = json.loads(text).get("places") or []
    except (ValueError, AttributeError):
        return []
    out = []
    for it in items:
        if not isinstance(it, dict) or not str(it.get("name") or "").strip():
            continue
        try:
            conf = max(0.0, min(1.0, float(it.get("confidence") or 0)))
        except (TypeError, ValueError):
            conf = 0.0
        out.append({"name": str(it["name"]).strip()[:120], "area": str(it.get("area") or "").strip()[:120],
                    "kind": str(it.get("kind") or "other"), "reason": str(it.get("reason") or "").strip()[:200],
                    "confidence": round(conf, 2)})
    return out


def _ai_error(error: Exception) -> HTTPException:
    if isinstance(error, cg.CostGuardError):
        return HTTPException(status_code=error.status, detail=error.detail())
    if isinstance(error, ps.SecretUnavailable):
        return HTTPException(status_code=503, detail={"code": "provider_not_configured",
                                                      "message": "AI の鍵が未設定か確認が切れています(運用コンソールで直せます)"})
    if isinstance(error, provider_calls.ProviderRejected):
        return HTTPException(status_code=502, detail={"code": "provider_rejected",
                                                      "message": "AI の提供元が要求を受け付けませんでした(鍵・権限・残高)"})
    return HTTPException(status_code=502, detail={"code": "provider_unavailable", "message": "AI を呼び出せませんでした"})


@router.post("/plans/{plan_id}/spot-ai/places-image")
async def places_from_image(plan_id: str, file: UploadFile = File(...), consent: bool = Form(False),
                            db: Session = Depends(get_db),
                            current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    if not consent:
        raise HTTPException(status_code=422, detail={"code": "consent_required",
                                                     "message": "写真を AI(OpenAI)へ送ることに同意してください"})
    _limit(current_user, "spot-ai-image", 10)
    content = await file.read(rx.MAX_IMAGE_BYTES + 1)
    try:
        jpeg = await run_in_threadpool(rx.prepare_image, content)  # 撮影情報(位置など)を消して縮める
    except rx.ExtractInputError as error:
        raise HTTPException(status_code=413 if error.code == "file_too_large" else 422,
                            detail={"code": error.code, "message": str(error)})
    hint = str(getattr(plan, "destination", "") or "")
    try:
        payload, _usage = provider_calls.ai_places_from_image(db, plan, current_user, jpeg, hint, str(uuid.uuid4()))
    except Exception as error:  # noqa: BLE001 - 理由を返す(画像は保存していない)
        if not isinstance(error, (cg.CostGuardError, ps.SecretUnavailable, provider_calls.ProviderRejected)):
            logger.exception("写真の場所の AI の呼び出しに失敗しました")
        if not db.is_active:
            db.rollback()
        raise _ai_error(error)
    items = _ai_items(payload.get("text") or "")[:MAX_AI_PLACES]
    places = await _enrich(db, current_user, plan.id, items)
    db.commit()
    return {"places": places, "ai": "used"}


async def _enrich(db: Session, user: User, plan_id: Any, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """AI の候補ごとに、住所・位置・電話・公式サイトを場所の自動取得で補う(見つからなければ名前だけ)"""
    from app.services import place_lookup as pl

    lat, lng = _plan_center(db, plan_id)

    def record(provider: str, code: str) -> None:
        free_usage.record(db, user, pl.USAGE.get(provider, provider), "spot.ai_enrich", result_code=code)

    out = []
    for it in items:
        found: Dict[str, Any] = {}
        try:
            r = await pl.lookup(db, it["name"], lat, lng, record)
            found = (r.get("candidates") or [{}])[0]
            if found and pl.name_score(it["name"], found.get("name")) < 0.45:
                found = {}
        except Exception:  # noqa: BLE001 - 補えなくても候補は残す
            found = {}
        out.append({**it, "address": found.get("address"), "latitude": found.get("latitude"),
                    "longitude": found.get("longitude"), "phone": found.get("phone"), "website": found.get("website"),
                    "category": found.get("category") or it.get("kind")})
    return out


class AiTextIn(TextIn):
    consent: bool = False


@router.post("/plans/{plan_id}/spot-ai/places-text")
def places_from_text_ai(plan_id: str, body: AiTextIn, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    rules = video_places.from_text(body.text, body.title)
    if not body.consent:
        raise HTTPException(status_code=422, detail={"code": "consent_required",
                                                     "message": "文を AI(OpenAI)へ送ることに同意してください"})
    _limit(current_user, "spot-ai-text", 10)
    text = (f"題名: {body.title}\n" if body.title else "") + body.text
    try:
        payload, _usage = provider_calls.ai_places_from_text(db, plan, current_user, text, str(uuid.uuid4()))
    except Exception as error:  # noqa: BLE001
        if not isinstance(error, (cg.CostGuardError, ps.SecretUnavailable, provider_calls.ProviderRejected)):
            logger.exception("説明欄の場所の AI の呼び出しに失敗しました")
        if not db.is_active:
            db.rollback()
        raise _ai_error(error)
    seen = {p["name"].replace(" ", "") for p in rules}
    merged = list(rules)
    for it in _ai_items(payload.get("text") or ""):
        key = it["name"].replace(" ", "")
        # 本文に書かれていない名前は捨てる(AI が足した場所を出さない)
        if key in seen or it["name"] not in text:
            continue
        seen.add(key)
        merged.append({"name": it["name"], "time": None, "context": it["reason"], "quoted": False, "ai": True})
    db.commit()
    return {"places": merged[:video_places.MAX_ITEMS + 10], "ai": "used"}
