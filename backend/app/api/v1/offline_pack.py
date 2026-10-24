"""
[Gate K1] B-008 / FR-032・FR-048 オフラインパックの鍵の配布と失効(docs/adr/ADR-offline-keys.md)。

- GET  /offline-pack/key        : 自分の現在の版の鍵(AES-256、base64url)を返す。ゲストも可。
                                  応答はキャッシュさせない(no-store)。1時間120回まで。
- POST /offline-pack/key/rotate : 版を1つ上げて、これまでの鍵を全て無効にする(全ての端末のオフラインデータが
                                  読めなくなり、次に鍵を受け取った時に端末から消える)。If-Match に今の版が必要
                                  (無ければ400、違えば409)。1時間10回まで。監査には版の数字だけを残す。

鍵は利用者ごと・版ごとに backend の秘密から導出し、DB には保存しない(app/services/offline_keys.py)。

[Gate G6] OFF-01 端末ごとの鍵と失効:
- GET  /offline-pack/key?device_id=<UUID> : その端末の鍵(利用者・版・端末から導出)。初めての端末は登録する(10台まで)。
                                            失効した端末には 410 offline_device_revoked(端末は保存したデータを消す)。
                                            expires_at(30日)を過ぎた鍵は、端末は通信できるまで使わない
- GET  /offline-pack/devices              : 自分の端末の一覧(名前はブラウザと OS の種類だけ)
- POST /offline-pack/devices/{id}/revoke  : その端末だけを失効する(他の端末はそのまま使える)
device_id を付けない要求は、以前の利用者ごとの鍵を返す(古い画面の互換)。
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import OfflineDevice, User
from app.services import offline_keys as ok
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/offline-pack", tags=["offline-pack"])

KEY_RATE_LIMIT = 120
ROTATE_RATE_LIMIT = 10
_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message}, headers=_NO_STORE)


def _load_user(db: Session, current: User) -> User:
    """トークンの利用者を DB から読み直す(無効化・存在しない利用者には配らない)"""
    user = db.query(User).filter(User.id == current.id).first()
    if user is None or user.is_active is False:
        raise _error(404, "offline_key_unavailable", "この利用者のオフライン鍵はありません")
    return user


def _key_payload(user: User) -> dict:
    version = ok.current_version(user.preferences)
    raw = ok.derive_key(user.id, version)
    return {
        "user_id": str(user.id),
        "key_version": version,
        "key": ok.encode_key(raw),
        "algorithm": ok.ALGORITHM,
        "key_bits": len(raw) * 8,
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }


def _require_configured() -> None:
    if not ok.is_configured():
        raise _error(503, "offline_key_not_configured", "オフライン保存の鍵が設定されていません(管理者に連絡してください)")


def _device_row(db: Session, user: User, device_id: str, request: Request) -> OfflineDevice:
    try:
        dev = str(uuid.UUID(device_id))
    except ValueError:
        raise _error(422, "invalid_device_id", "端末の ID の形が正しくありません")
    row = db.query(OfflineDevice).filter(OfflineDevice.user_id == user.id, OfflineDevice.device_id == dev).first()
    if row is None:
        active = db.query(OfflineDevice).filter(OfflineDevice.user_id == user.id,
                                                OfflineDevice.revoked_at.is_(None)).count()
        if active >= ok.MAX_DEVICES:
            raise _error(409, "too_many_offline_devices",
                         f"オフライン保存に使える端末は{ok.MAX_DEVICES}台までです。設定のオフラインで使わない端末を失効してください")
        row = OfflineDevice(id=uuid.uuid4(), user_id=user.id, device_id=dev,
                            label=ok.device_label(request.headers.get("user-agent")))
        db.add(row)
        db.flush()
        record_audit_event(action="offline_device_registered", resource_type="user", user_id=user.id,
                           resource_id=user.id, ip_address=request.client.host if request.client else None,
                           details={"device": str(row.id)})
    if row.revoked_at is not None:
        raise _error(410, "offline_device_revoked", "この端末のオフライン保存は失効しています。保存したデータは端末から消えます")
    return row


@router.get("/key")
async def get_offline_key(
    request: Request,
    response: Response,
    device_id: Optional[str] = Query(None, max_length=64),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    _require_configured()
    user = _load_user(db, current_user)
    if not check_rate_limit(f"offline_key:{user.id}", KEY_RATE_LIMIT, 3600):
        raise _error(429, "rate_limited", "オフライン鍵の取得回数が上限に達しました。しばらく待ってください")
    response.headers.update(_NO_STORE)
    if device_id is None:
        return _key_payload(user)
    row: Any = _device_row(db, user, device_id, request)
    now = datetime.now(timezone.utc)
    row.last_key_at = now
    db.commit()
    version = ok.current_version(cast(Any, user).preferences)
    raw = ok.derive_device_key(cast(Any, user).id, version, row.device_id)
    return {**_key_payload(user), "key": ok.encode_key(raw), "device_id": row.device_id, "device": str(row.id),
            "expires_at": (now + timedelta(days=ok.DEVICE_KEY_TTL_DAYS)).isoformat()}


def _device_dict(d: OfflineDevice, current: Optional[str]) -> dict:
    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {"id": str(d.id), "label": d.label, "created_at": iso(d.created_at), "last_key_at": iso(d.last_key_at),
            "revoked_at": iso(d.revoked_at), "is_current": current is not None and d.device_id == current}


@router.get("/devices")
async def list_offline_devices(
    response: Response,
    device_id: Optional[str] = Query(None, max_length=64),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    user = _load_user(db, current_user)
    try:
        current = str(uuid.UUID(device_id)) if device_id else None
    except ValueError:
        current = None
    rows = (db.query(OfflineDevice).filter(OfflineDevice.user_id == user.id)
            .order_by(OfflineDevice.revoked_at.isnot(None), OfflineDevice.created_at.desc()).all())
    response.headers.update(_NO_STORE)
    return {"devices": [_device_dict(d, current) for d in rows], "max_devices": ok.MAX_DEVICES}


@router.post("/devices/{device_ref}/revoke")
async def revoke_offline_device(
    device_ref: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    user = _load_user(db, current_user)
    row = db.query(OfflineDevice).filter(OfflineDevice.id == device_ref, OfflineDevice.user_id == user.id).first()
    if row is None:
        raise _error(404, "offline_device_not_found", "端末が見つかりません")
    if row.revoked_at is None:
        row.revoked_at, row.revoked_reason = datetime.now(timezone.utc), "user"
        db.commit()
        record_audit_event(action="offline_device_revoked", resource_type="user", user_id=user.id,
                           resource_id=user.id, ip_address=request.client.host if request.client else None,
                           details={"device": str(row.id)})
    return _device_dict(row, None)


@router.post("/key/rotate")
async def rotate_offline_key(
    request: Request,
    response: Response,
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    _require_configured()
    user = _load_user(db, current_user)
    if if_match is None or not if_match.strip().strip('"').isdigit():
        raise _error(400, "if_match_required", "If-Match に今の鍵の版(数字)を指定してください")
    if not check_rate_limit(f"offline_key_rotate:{user.id}", ROTATE_RATE_LIMIT, 3600):
        raise _error(429, "rate_limited", "無効化の回数が上限に達しました。しばらく待ってください")
    current = ok.current_version(user.preferences)
    expected = int(if_match.strip().strip('"'))
    if expected != current:
        raise _error(409, "offline_key_version_mismatch", "鍵の版が変わっています。画面を読み込み直してください")
    user.preferences = ok.next_preferences(user.preferences, datetime.now(timezone.utc).isoformat())
    db.add(user)
    db.commit()
    db.refresh(user)
    record_audit_event(
        action="offline_key_rotated",
        resource_type="user",
        user_id=user.id,
        resource_id=user.id,
        ip_address=request.client.host if request.client else None,
        details={"from_version": current, "to_version": ok.current_version(user.preferences)},
    )
    response.headers.update(_NO_STORE)
    return {"previous_version": current, **_key_payload(user)}
