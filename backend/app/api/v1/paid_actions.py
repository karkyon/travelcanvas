"""[Gate ProviderConnect] 旅行の中で有料の提供元を使う、利用者の明示の操作(押した時だけ送る)。

- POST /plans/{plan_id}/paid/ai-suggest     : AI の案(OpenAI Responses)。旅行には保存しない(未確認の案として返す)
- POST /plans/{plan_id}/paid/places-search  : 場所の検索(Places API (New) Text Search)。旅行には保存しない
- POST /plans/{plan_id}/paid/route          : 2つの予定の間の経路(Routes API)。旅行には保存しない
共通: 旅行の編集者以上・Idempotency-Key 必須・会員のクラスと 1旅行 50円(cost_guard)を送る前に確認・
鍵は確認済みの有効な版だけ。管理者でもクラス・上限を迂回しない。失敗しても手で続けられる。
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_active_user
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import TravelEvent, User
from app.services import cost_guard as cg
from app.services import provider_calls as pc
from app.services import provider_secrets as ps

router = APIRouter(prefix="/plans", tags=["paid-actions"])

_SECRET_MESSAGE = {
    "secret_unverified": "管理者が鍵の有効性をまだ確かめていないため、送りません",
    "secret_verification_expired": "鍵の確認の期限が切れたため、送りません(管理者が確認し直します)",
    "secret_verification_stale": "設定が変わったため、鍵の確認をやり直すまで送りません",
    "secret_rejected": "提供元が鍵を受け付けていないため、送りません",
}


def _bad(code: str, message: str, status: int = 422, extra: Optional[Dict[str, Any]] = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message,
                                                     "fallbacks": list(cg.FALLBACKS), **(extra or {})})


def _key(value: Optional[str]) -> str:
    key = (value or "").strip()
    if not key or len(key) > 80:
        raise _bad("idempotency_key_required", "Idempotency-Key(80文字まで)が要ります")
    return key


def _run(fn):
    try:
        return fn()
    except cg.CostGuardError as error:
        raise HTTPException(status_code=error.status, detail=error.detail())
    except ps.SecretUnavailable as error:
        message = _SECRET_MESSAGE.get(error.code, "外部の提供元の準備が整っていないため、送りません。手で続けられます")
        raise _bad("provider_not_ready", message, 503, {"reason": error.code})
    except pc.ProviderRejected as error:
        raise _bad("provider_rejected", "提供元が要求を受け付けませんでした(鍵・権限・課金)。枠は使っていません。手で続けられます",
                   503, {"reason": error.code})


def _text(payload: Any, name: str, limit: int) -> str:
    value = payload.get(name) if isinstance(payload, dict) else None
    if not isinstance(value, str) or not value.strip():
        raise _bad("invalid_input", f"{name} を入力してください")
    if len(value) > limit:
        raise _bad("input_too_long", f"{name} は {limit} 文字までです")
    return value.strip()


def _coord(payload: Any, name: str) -> Optional[float]:
    value = payload.get(name) if isinstance(payload, dict) else None
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _bad("invalid_input", f"{name} は数で指定してください")
    return float(value)


@router.post("/{plan_id}/paid/ai-suggest")
def ai_suggest(plan_id: str, payload: Dict[str, Any] = Body(...),
               idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
               current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    prompt = _text(payload, "prompt", pc.AI_MAX_PROMPT_CHARS)
    key = _key(idempotency_key)
    result, usage = _run(lambda: pc.ai_suggest(db, plan, current_user, prompt, key))
    return {"result": result, "usage": usage, "saved": False,
            "notice": "AI の案です。営業時間・料金・空きは確かめていません(要確認)。旅行には保存していません"}


@router.post("/{plan_id}/paid/places-search")
def places_search(plan_id: str, payload: Dict[str, Any] = Body(...),
                  idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                  current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    query = _text(payload, "query", 120)
    lat, lng = _coord(payload, "latitude"), _coord(payload, "longitude")
    if (lat is None) != (lng is None):
        raise _bad("invalid_input", "緯度と経度は両方を指定してください")
    key = _key(idempotency_key)
    places, usage = _run(lambda: pc.places_search(db, plan, current_user, query, lat, lng, key))
    return {"results": places, "usage": usage, "saved": False, "attribution": "Google",
            "notice": "Google の検索の結果です。旅行には保存していません(追加は候補として手で行います)"}


@router.post("/{plan_id}/paid/route")
def route(plan_id: str, payload: Dict[str, Any] = Body(...),
          idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
          current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    body = payload if isinstance(payload, dict) else {}
    mode = body.get("mode") or "driving"
    if mode not in pc.ROUTE_MODES:
        raise _bad("invalid_input", "移動の手段は driving・walking・bicycling・transit のどれかです")
    events = {}
    for name in ("from_event_id", "to_event_id"):
        ev = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id,
                                          TravelEvent.id == _uuid(body.get(name))).first()
        if ev is None:
            raise _bad("event_not_found", "この旅行の予定を2つ選んでください", 404)
        if ev.latitude is None or ev.longitude is None:
            raise _bad("event_without_location", "場所(座標)の無い予定の経路は調べられません(送っていません)")
        events[name] = ev
    key = _key(idempotency_key)
    a, b = events["from_event_id"], events["to_event_id"]
    assert a.latitude is not None and a.longitude is not None and b.latitude is not None and b.longitude is not None
    origin = (float(a.latitude), float(a.longitude))  # 上で None でないことを確かめた
    dest = (float(b.latitude), float(b.longitude))
    summary, usage = _run(lambda: pc.route_between(db, plan, current_user, origin, dest, mode, key))
    return {"result": summary, "mode": mode, "usage": usage, "saved": False, "attribution": "Google",
            "notice": "Google の経路の結果です。旅行には保存していません"}


def _uuid(value: Any):
    import uuid
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise _bad("event_not_found", "この旅行の予定を2つ選んでください", 404)
