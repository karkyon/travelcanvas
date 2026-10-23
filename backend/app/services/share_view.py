"""[Gate G4] COL-05 Guest Travel View(FR-044): 共有の閲覧の一時トークン・項目の説明・許可された項目だけの複製。

- リンクを開く(resolve)と使用回数を1回使い、一時トークン(view token。既定2時間)を返す。見直し(再読み込み・
  詳細を開く・複製)はこのトークンで行い、使用回数を使わない
- トークンは「その共有(share_id)・そのリンク(token_hash)・その合言葉(passcode_hash)・期限」に結び付けて署名する。
  共有を失効・期限切れ・合言葉の変更をすると、そのトークンはすぐ使えない
- 確認(info)は使用回数を使わず、合言葉が要るか・見える項目・見えない項目・期限・複製できるかだけを返す(旅行の中身は返さない)
- 複製は、所有者が許した共有(allow_clone)だけ。見せる項目(policy)の値だけを新しい旅行へ写す。予約・チケット・文書・
  位置・費用・メンバー・コメントは写さない(どの policy でも)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import PlanShareLink, TravelDay, TravelEvent, TravelPlan
from app.services import share_policy

TOKEN_VERSION = 1


class ViewTokenError(ValueError):
    pass


def _key() -> bytes:
    secret = getattr(settings, "SHARE_VIEW_SIGNING_KEY", "") or settings.JWT_SECRET_KEY
    return hashlib.sha256(("tc-share-view|" + str(secret)).encode("utf-8")).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _bind(share: PlanShareLink) -> str:
    raw = "%s|%s|%s" % (share.id, share.token_hash, share.passcode_hash or "")
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def issue(share: PlanShareLink, now: Optional[float] = None) -> Dict[str, Any]:
    now = now or time.time()
    exp = int(now) + int(settings.SHARE_VIEW_TTL_SECONDS)
    body = _b64(json.dumps({"v": TOKEN_VERSION, "s": str(share.id), "b": _bind(share), "e": exp},
                           separators=(",", ":")).encode())
    sig = _b64(hmac.new(_key(), body.encode(), hashlib.sha256).digest())
    return {"view_token": "%s.%s" % (body, sig), "view_expires_in": exp - int(now)}


def verify(token: Optional[str], share: PlanShareLink, now: Optional[float] = None) -> None:
    if not token or token.count(".") != 1 or len(token) > 1000:
        raise ViewTokenError("missing")
    body, sig = token.split(".")
    want = _b64(hmac.new(_key(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(want, sig):
        raise ViewTokenError("signature")
    try:
        data = json.loads(_unb64(body))
    except (ValueError, TypeError):
        raise ViewTokenError("format")
    if data.get("v") != TOKEN_VERSION or data.get("s") != str(share.id) or data.get("b") != _bind(share):
        raise ViewTokenError("binding")
    if int(data.get("e", 0)) <= int(now or time.time()):
        raise ViewTokenError("expired")


def explain(share: Any) -> Dict[str, Any]:
    """閲覧者向けの説明(何が見えて、何が見えないか)。"""
    fields = share_policy.fields_of(share.policy)
    cat = share_policy.catalog()
    return {
        "always": cat["always"],
        "shown": [{"key": f["key"], "label": f["label"]} for f in cat["fields"] if f["key"] in fields],
        "hidden": [{"key": f["key"], "label": f["label"]} for f in cat["fields"] if f["key"] not in fields],
        "never": [r["label"] for r in cat["restricted"]],
    }


def clone_plan(db: Session, plan: Any, share: Any, user: Any, title: Optional[str]) -> Any:
    """許可された項目だけを写した新しい旅行を作る(呼んだ側が commit する)。"""
    fields = share_policy.fields_of(share.policy)
    new = TravelPlan(user_id=user.id, title=(title or "%s(共有から複製)" % plan.title)[:200],
                     description=plan.description if "plan_description" in fields else None,
                     destination=plan.destination, start_date=plan.start_date, end_date=plan.end_date,
                     status="draft")
    db.add(new)
    db.flush()
    days: List[TravelDay] = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
                             .order_by(TravelDay.local_date.asc(), TravelDay.sort_order.asc()).all())
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).order_by(TravelEvent.sort_order).all() \
        if days else []
    by_day: Dict[Any, List[TravelEvent]] = {}
    for e in events:
        by_day.setdefault(e.day_id, []).append(e)
    for i, d in enumerate(days):
        nd = TravelDay(plan_id=new.id, local_date=d.local_date, timezone_id=d.timezone_id,
                       title=d.title if "day_titles" in fields else None, sort_order=i)
        db.add(nd)
        db.flush()
        for j, e in enumerate(by_day.get(d.id, [])):
            # 位置(緯度経度)・場所・予約との結び付き・ロックは写さない
            db.add(TravelEvent(plan_id=new.id, day_id=nd.id, title=e.title, event_type=e.event_type,
                               local_start_time=e.local_start_time if "event_times" in fields else None,
                               is_all_day=bool(e.is_all_day) if "event_times" in fields else False,
                               address=e.address if "event_address" in fields else None,
                               description=e.description if "event_notes" in fields else None, sort_order=j))
    db.flush()
    return new
