"""
[Gate② 縦断] 作成の口の再送の印(Idempotency-Key・任意)の共通の処理。

二重押し・通信のやり直し(ログインの更新の後の送り直し・圏外からの復帰)で、同じ作成の要求が 2 回届いても 1 つだけ作る。

使い方(作成の口で):
    replay = idempotent_create.begin(db, plan, user, key, ENDPOINT, payload)
    if replay is not None:
        return 先に作った物の応答(replay は作った物の ID の文字列)
    ...作る(db.add / flush で ID を決める)...
    idempotent_create.remember(db, user, key, ENDPOINT, payload, created.id)   # commit の前に呼ぶ
    db.commit()

- 印が無ければ何もしない(今までと同じ)。
- 同じ印・同じ内容は先に作った物の ID を返す。同じ印・違う内容は 409(idempotency_key_reused)。
- 同時の 2 つは旅行の行を押さえて 1 つずつにする。印の記録は作った物と同じ transaction で書くので、
  先の要求の commit の後に後の要求が印を読み、二重に作らない。
- 印の記録は idempotency_records(既存の表。migration は要らない)。期限は表の既定(7 日)。
"""
import hashlib
import json
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.plan_access import lock_plan_row
from app.models.models import IdempotencyRecord, TravelPlan, User

MAX_KEY_LENGTH = 100


def _clean(key: Optional[str]) -> Optional[str]:
    k = (key or "").strip() or None
    if k is not None and (len(k) > MAX_KEY_LENGTH or not k.isprintable()):
        raise HTTPException(status_code=422, detail="Idempotency-Keyは100文字までの印字できる文字です")
    return k


def _hash(payload: Any) -> str:
    data = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()


def begin(db: Session, plan: Optional[TravelPlan], user: User, key: Optional[str], endpoint: str,
          payload: Any) -> Optional[str]:
    """印があれば旅行の行(旅行がまだ無い作成では本人の行)を押さえて、先に作った物の ID を返す(無ければ None)。
    違う内容なら 409。"""
    k = _clean(key)
    if k is None:
        return None
    if plan is not None:
        lock_plan_row(db, plan)
    else:
        db.query(User.id).filter(User.id == user.id).with_for_update().first()
    done = (db.query(IdempotencyRecord)
            .filter(IdempotencyRecord.key == k, IdempotencyRecord.user_id == user.id,
                    IdempotencyRecord.endpoint == endpoint).first())
    if done is None:
        return None
    body = done.response_json or {}
    if body.get("hash") != _hash(payload):
        raise HTTPException(status_code=409, detail={
            "code": "idempotency_key_reused", "message": "同じ操作の印で、違う内容が送られました"})
    return str(body.get("id"))


def remember(db: Session, user: User, key: Optional[str], endpoint: str, payload: Any, created_id: Any) -> None:
    """作った物の ID を印と結び付けて残す(commit の前に呼ぶ。作った物と同じ transaction)。"""
    k = _clean(key)
    if k is None:
        return
    db.add(IdempotencyRecord(key=k, user_id=user.id, endpoint=endpoint, response_status=201,
                             response_json={"id": str(created_id), "hash": _hash(payload)}))
