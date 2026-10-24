"""[Gate G6] LOC-02 守る範囲(自宅・職場など、書き出し・公開から外す範囲)の登録(app/services/location_privacy.py)。

- GET    /privacy-zones          : 自分の範囲(中心の座標は本人にだけ返す)
- POST   /privacy-zones          : 足す(10件まで。中心は利用者のデータ鍵で暗号化して保存)
- DELETE /privacy-zones/{id}     : 消す
監査には件数と半径だけを残す(座標・名前は残さない)。
"""
import uuid
from typing import Any, Dict, Optional, cast

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured
from app.core.database import get_db
from app.models.models import PrivacyZone, User
from app.services import location_privacy as lp
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/privacy-zones", tags=["privacy"])
_NO_STORE = {"Cache-Control": "no-store"}


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _zone_dict(z: Any) -> Dict[str, Any]:
    center = lp.open_center(z.center_ciphertext)
    return {"id": str(z.id), "label": z.label, "radius_m": z.radius_m,
            "latitude": center[0] if center else None, "longitude": center[1] if center else None,
            "readable": center is not None, "created_at": z.created_at.isoformat() if z.created_at else None}


def _audit(action: str, request: Request, user: User, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="user", user_id=user.id, resource_id=user.id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255], details=details)


@router.get("")
def list_zones(response: Response, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    response.headers.update(_NO_STORE)
    rows = db.query(PrivacyZone).filter(PrivacyZone.user_id == current_user.id).order_by(PrivacyZone.created_at).all()
    return {"zones": [_zone_dict(z) for z in rows], "max_zones": lp.MAX_ZONES,
            "radius_range": [lp.MIN_RADIUS_M, lp.MAX_RADIUS_M]}


@router.post("", status_code=201)
def create_zone(request: Request, response: Response, payload: Optional[dict] = Body(None),
                db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    p = payload if isinstance(payload, dict) else {}
    try:
        label, lat, lng, radius = lp.clean_zone(p.get("label"), p.get("latitude"), p.get("longitude"),
                                                p.get("radius_m", 500))
    except lp.ZoneInputError as e:
        raise _bad(e.code, str(e))
    if db.query(PrivacyZone).filter(PrivacyZone.user_id == current_user.id).count() >= lp.MAX_ZONES:
        raise _bad("too_many_privacy_zones", f"守る範囲は{lp.MAX_ZONES}件までです", 409)
    try:
        sealed = lp.seal_center(cast(uuid.UUID, current_user.id), lat, lng)
    except EncryptionNotConfigured:
        raise _bad("encryption_not_configured", "位置の暗号化が設定されていません(管理者に連絡してください)", 503)
    z = PrivacyZone(id=uuid.uuid4(), user_id=current_user.id, label=label, center_ciphertext=sealed, radius_m=radius)
    db.add(z)
    db.commit()
    db.refresh(z)
    _audit("privacy_zone_created", request, current_user, {"radius_m": radius})
    response.headers.update(_NO_STORE)
    return _zone_dict(z)


@router.delete("/{zone_id}")
def delete_zone(zone_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    z = db.query(PrivacyZone).filter(PrivacyZone.id == zone_id, PrivacyZone.user_id == current_user.id).first()
    if z is None:
        raise _bad("privacy_zone_not_found", "守る範囲が見つかりません", 404)
    db.delete(z)
    db.commit()
    _audit("privacy_zone_deleted", request, current_user, {})
    return {"deleted": True}
