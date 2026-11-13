"""
[Gate TDay-Push] 端末への通知(Web Push)の購読と設定(app/services/web_push.py)。

- GET    /push/config                : 使えるか・送り手の公開鍵・通知の種類の設定・この人の端末の一覧(送り先は出さない)
- POST   /push/subscriptions         : この端末の購読を登録する(ブラウザの窓口の URL だけ受け付ける)
- POST   /push/subscriptions/remove  : この端末の購読を外す(endpoint で指す)
- PUT    /push/settings              : 通知の種類(出発・雨・朝・同行者)を切り替える
- POST   /push/test                  : この人の端末へ試しの通知を送る(回数の制限あり)
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import User
from app.services import web_push as wp
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/push", tags=["push"])


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _require_enabled() -> None:
    if not wp.enabled():
        raise _bad("push_unavailable", "この環境では端末への通知は使えません", 503)


def _view(user: User) -> Dict[str, Any]:
    on = wp.enabled()
    return {"available": on, "public_key": wp.public_key() if on else None, "kinds": wp.kinds_of(user),
            "devices": wp.summary(user),
            "notice": "通知の中身は端末の鍵で暗号化して、ブラウザの会社の窓口(無料)を通して届けます。"
                      "https で開いた画面でだけ使えます(iPhone はホーム画面に追加したアプリから)"}


@router.get("/config")
def push_config(current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    return _view(current_user)


class SubKeys(BaseModel):
    model_config = ConfigDict(extra="ignore")
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=60)


class SubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    endpoint: str = Field(..., max_length=1024)
    keys: SubKeys
    label: Optional[str] = Field(None, max_length=60)


@router.post("/subscriptions")
def add_subscription(body: SubscriptionIn, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    _require_enabled()
    if not check_rate_limit(f"push-sub:{current_user.id}", 30, 3600):
        raise _bad("too_many_requests", "回数が多すぎます。しばらく待ってください", 429)
    from app.core.crypto import EncryptionNotConfigured

    try:
        wp.add_subscription(current_user, body.endpoint, body.keys.p256dh, body.keys.auth, body.label)
    except wp.PushError as e:
        raise _bad(e.code, str(e))
    except EncryptionNotConfigured:
        raise _bad("encryption_not_configured", "暗号化の鍵が無いため登録できません", 503)
    db.commit()
    return _view(current_user)


class EndpointIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: str = Field(..., max_length=1024)


@router.post("/subscriptions/remove")
def remove_subscription(body: EndpointIn, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    wp.remove_endpoint(current_user, body.endpoint)
    db.commit()
    return _view(current_user)


class KindsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    depart: Optional[bool] = None
    rain: Optional[bool] = None
    morning: Optional[bool] = None
    crew: Optional[bool] = None


@router.put("/settings")
def put_settings(body: KindsIn, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    wp.set_kinds(current_user, body.model_dump(exclude_none=True))
    db.commit()
    return _view(current_user)


@router.post("/test")
def send_test(db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    _require_enabled()
    if not check_rate_limit(f"push-test:{current_user.id}", 6, 600):
        raise _bad("too_many_requests", "試しの通知は10分に6回までです", 429)
    msg = wp.message("TravelCanvas の通知", "この端末に通知が届きます。旅の当日に出発の合図などをお知らせします",
                     "/", "tc-test", "test")
    result = wp.send_to_user(current_user, msg, urgency="normal", ttl=300)
    db.commit()
    return {**result, **_view(current_user)}
