"""
[Gate K1] B-008 / FR-032・FR-048 オフラインパックの鍵の配布と失効(docs/adr/ADR-offline-keys.md)。

- GET  /offline-pack/key        : 自分の現在の版の鍵(AES-256、base64url)を返す。ゲストも可。
                                  応答はキャッシュさせない(no-store)。1時間120回まで。
- POST /offline-pack/key/rotate : 版を1つ上げて、これまでの鍵を全て無効にする(全ての端末のオフラインデータが
                                  読めなくなり、次に鍵を受け取った時に端末から消える)。If-Match に今の版が必要
                                  (無ければ400、違えば409)。1時間10回まで。監査には版の数字だけを残す。

鍵は利用者ごと・版ごとに backend の秘密から導出し、DB には保存しない(app/services/offline_keys.py)。
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import User
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


@router.get("/key")
async def get_offline_key(
    response: Response,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    _require_configured()
    user = _load_user(db, current_user)
    if not check_rate_limit(f"offline_key:{user.id}", KEY_RATE_LIMIT, 3600):
        raise _error(429, "rate_limited", "オフライン鍵の取得回数が上限に達しました。しばらく待ってください")
    response.headers.update(_NO_STORE)
    return _key_payload(user)


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
