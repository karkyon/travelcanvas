"""
[Gate HomePlace] 自宅の場所(本人だけ)。説明は app/models/models.py の UserHomePlace。

- GET    /privacy/home-place : 自分の自宅の場所と、使い方の選択(登録が無ければ configured=false)
- PUT    /privacy/home-place : 保存(If-Match: 版。まだ無ければ 0)。住所・座標・使い方の選択
- DELETE /privacy/home-place : 消す(地図・旅程の経路にも使われなくなる)

他人の自宅を読む口は無い(同行者・共有・運用管理者にも)。監査には「保存した・消した」と選択だけを残す
(住所・座標は残さない)。
"""
import json
import math
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload, user_subject
from app.core.database import get_db
from app.models.models import User, UserHomePlace
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/privacy", tags=["home-place"])


class HomePlaceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field("自宅", max_length=40)
    address: Optional[str] = Field(None, max_length=200)
    latitude: float
    longitude: float
    show_on_map: bool = True
    use_for_routes: bool = True
    send_to_route_provider: bool = False


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _if_match(value: Optional[str]) -> int:
    if value is None or not value.strip():
        raise _bad("if_match_required", "If-Match(保存されている版。まだ無ければ 0)が必要です", 428)
    try:
        return int(value.strip().strip('"'))
    except ValueError:
        raise _bad("invalid_if_match", "If-Match の形式が不正です", 400)


def _clean(payload: HomePlaceIn) -> Dict[str, Any]:
    lat, lng = payload.latitude, payload.longitude
    if not (math.isfinite(lat) and math.isfinite(lng)) or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        raise _bad("invalid_position", "位置(緯度・経度)が正しくありません")
    label = (payload.label or "").strip() or "自宅"
    address = (payload.address or "").strip() or None
    return {"label": label, "address": address, "latitude": round(lat, 6), "longitude": round(lng, 6)}


def _open(row: Optional[UserHomePlace]) -> Optional[Dict[str, Any]]:
    """復号した場所。行が無い・復号できない時は None。"""
    if row is None:
        return None
    try:
        data = json.loads(decrypt_payload(row.place_ciphertext).decode("utf-8"))
    except (EncryptionNotConfigured, ValueError):
        return None
    return data if isinstance(data, dict) else None


def get_row(db: Session, user_id) -> Optional[UserHomePlace]:
    return db.query(UserHomePlace).filter(UserHomePlace.user_id == user_id).first()


def body_for(db: Session, user: User) -> Dict[str, Any]:
    row = get_row(db, user.id)
    place = _open(row)
    return {
        "configured": row is not None,
        "readable": row is None or place is not None,
        "revision": row.revision if row else 0,
        "place": place,
        "show_on_map": bool(row.show_on_map) if row else True,
        "use_for_routes": bool(row.use_for_routes) if row else True,
        "send_to_route_provider": bool(row.send_to_route_provider) if row else False,
    }


def _audit(request: Request, user: User, action: str, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="home_place", user_id=user.id, resource_id=user.id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255], details=details)


@router.get("/home-place")
def get_home_place(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    return body_for(db, current_user)


@router.put("/home-place")
def put_home_place(payload: HomePlaceIn, request: Request, if_match: Optional[str] = Header(None, alias="If-Match"),
                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    expected = _if_match(if_match)
    place = _clean(payload)
    row = get_row(db, current_user.id)
    current = row.revision if row else 0
    if expected != current:
        raise _bad("revision_mismatch", "ほかの画面で変更されました。読み込み直してください", 409)
    try:
        cipher = encrypt_payload(json.dumps(place, ensure_ascii=False).encode("utf-8"), user_subject(current_user.id))
    except EncryptionNotConfigured:
        raise _bad("encryption_unavailable", "暗号化が設定されていないため保存できません", 503)
    if row is None:
        row = UserHomePlace(user_id=current_user.id, place_ciphertext=cipher, revision=1)
        db.add(row)
    else:
        row.place_ciphertext = cipher
        row.revision += 1
    row.show_on_map = payload.show_on_map
    row.use_for_routes = payload.use_for_routes
    row.send_to_route_provider = payload.send_to_route_provider
    db.commit()
    _audit(request, current_user, "home_place_saved", {
        "show_on_map": payload.show_on_map, "use_for_routes": payload.use_for_routes,
        "send_to_route_provider": payload.send_to_route_provider})
    return body_for(db, current_user)


@router.delete("/home-place", status_code=204)
def delete_home_place(request: Request, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    row = get_row(db, current_user.id)
    if row is not None:
        db.delete(row)
        db.commit()
        _audit(request, current_user, "home_place_deleted", {})
    return Response(status_code=204)


def export_for(db: Session, user: User) -> Optional[Dict[str, Any]]:
    """アカウントの書き出し(本人だけ)。"""
    row = get_row(db, user.id)
    if row is None:
        return None
    return {"place": _open(row), "show_on_map": row.show_on_map, "use_for_routes": row.use_for_routes,
            "send_to_route_provider": row.send_to_route_provider, "revision": row.revision}
