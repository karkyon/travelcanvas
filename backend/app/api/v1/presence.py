"""
[Gate C1] FR-020 共同編集(準リアルタイム)。

- POST   /plans/{plan_id}/presence             : この端末で旅行を開いていることを知らせ、同じ旅行を開いている人・
                                                 編集中の予定・知っている版より後の変更(誰が何を)を受け取る
- DELETE /plans/{plan_id}/presence/{client_id} : 画面を閉じた(この端末の知らせを消す)
- GET    /plans/{plan_id}/events/stream         : [Gate G2] 即時の通知(Server-Sent Events。サーバーから画面へ一方向に
                                                 送り続ける仕組み)。版が上がった(revision)・開いている人や編集中の
                                                 予定が変わった(presence)を、その場で知らせる。画面は知らせを受けたら
                                                 すぐ POST presence で中身を取りに行く(ポーリングの間隔を待たない)。
                                                 STREAM_SECONDS で接続を閉じ、画面は Last-Event-ID(知っている版)を付けて
                                                 つなぎ直す。旅行を見られなくなった時は access_lost を送って閉じる。
                                                 1人あたりの同時の接続は MAX_STREAMS_PER_USER まで(超えると 429)

閲覧者以上(旅行を見られる人)だけが使える。他の人の名前は利用者名(メールアドレスは出さない。ゲストは「ゲスト」)。
変更は ChangeSet(予定・日の変更の記録)から作る。予定の題名は旅行の参加者が見られる情報のため、そのまま出す。
同じ予定を2人が編集した時は、先に保存した方が通り、後の保存は版の不一致(409)で止まる(黙って上書きしない)。
"""
import asyncio
import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import SessionLocal, get_db
from app.core.plan_access import require_plan_access, resolve_plan_role
from app.models.models import ChangeSet, PlanCollaborator, TravelEvent, TravelPlan, User
from app.services import presence as pr

router = APIRouter(prefix="/plans", tags=["presence"])

CLIENT_ID_PATTERN = r"^[A-Za-z0-9_-]{8,64}$"
MAX_CHANGES = 20
POLL_WITH_OTHERS = 5
POLL_ALONE = 15


class EditingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["event"]
    id: uuid.UUID


class PresenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str = Field(pattern=CLIENT_ID_PATTERN)
    known_revision: Optional[int] = Field(None, ge=0)
    editing: Optional[EditingIn] = None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=dt_timezone.utc).isoformat()


def _iso_dt(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _roles(db: Session, plan: TravelPlan) -> Dict[str, str]:
    """いま旅行に参加している人(所有者・承諾済みの共同編集者)と役割。外れた人の端末は数えない。"""
    roles = {str(plan.user_id): "owner"}
    for user_id, role in db.query(PlanCollaborator.user_id, PlanCollaborator.role).filter(
            PlanCollaborator.plan_id == plan.id, PlanCollaborator.status == "accepted",
            PlanCollaborator.user_id.isnot(None)).all():
        if role in ("viewer", "editor"):  # plan_access.resolve_plan_role と同じ(ほかの役割は旅行を見られない)
            roles.setdefault(str(user_id), str(role))
    return roles


def _labels(db: Session, user_ids, me: User) -> Dict[str, str]:
    ids = [uuid.UUID(u) for u in set(user_ids) if u]
    out: Dict[str, str] = {}
    if not ids:
        return out
    for u in db.query(User.id, User.username, User.user_type).filter(User.id.in_(ids)).all():
        guest = str(getattr(u.user_type, "value", u.user_type) or "") == "guest"
        out[str(u.id)] = "ゲスト" if guest or not u.username else str(u.username)
    out[str(me.id)] = "あなた"
    return out


def _item_label(item) -> Optional[str]:
    for data in (item.after_json, item.before_json):
        if isinstance(data, dict):
            if item.entity_type == "travel_event" and data.get("title"):
                return str(data["title"])[:200]
            if item.entity_type == "travel_day" and data.get("local_date"):
                return str(data["local_date"])
    return None


def _changes(db: Session, plan: TravelPlan, known: Optional[int], me: User) -> List[dict]:
    if known is None or known >= plan.revision:
        return []
    sets = (db.query(ChangeSet).filter(ChangeSet.plan_id == plan.id, ChangeSet.resulting_revision > known)
            .order_by(ChangeSet.resulting_revision.desc()).limit(MAX_CHANGES).all())
    labels = _labels(db, [str(s.actor_user_id) for s in sets if s.actor_user_id], me)
    out = []
    for s in reversed(sets):
        actor = str(s.actor_user_id) if s.actor_user_id else None
        items = list(s.items or [])
        out.append({
            "revision": s.resulting_revision,
            "actor_label": labels.get(actor or "", "だれか"),
            "is_self": actor == str(me.id),
            "source": s.source,
            "undone": s.undone_at is not None,
            "count": len(items),
            "items": [{"entity_type": i.entity_type, "action": i.action, "label": _item_label(i)} for i in items[:5]],
            "at": _iso_dt(s.applied_at),
        })
    return out


@router.post("/{plan_id}/presence")
def heartbeat(plan_id: str, payload: PresenceIn, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    editing = None
    if payload.editing is not None:
        # 旅行の外の予定・消された予定は「編集中」にしない(他の人の画面に出さない)
        ev = db.query(TravelEvent.id).filter(TravelEvent.id == payload.editing.id,
                                             TravelEvent.plan_id == plan.id).first()
        if ev is not None:
            editing = {"kind": "event", "id": str(payload.editing.id)}
    now = time.time()
    me = str(current_user.id)
    pr.touch(str(plan.id), f"{me}:{payload.client_id}", {"user_id": me, "editing": editing}, now)

    roles = _roles(db, plan)
    people: Dict[str, dict] = {}
    for e in pr.entries(str(plan.id), now):
        uid = str(e.get("user_id") or "")
        if uid not in roles:
            continue
        p = people.setdefault(uid, {"user_id": uid, "role": roles[uid], "is_self": uid == me, "devices": 0,
                                    "seen_at": 0.0, "editing": None, "_editing_at": 0.0})
        p["devices"] += 1
        at = float(e.get("at", 0))
        p["seen_at"] = max(p["seen_at"], at)
        if e.get("editing") and at >= p["_editing_at"]:
            p["editing"], p["_editing_at"] = e["editing"], at

    titles: Dict[str, str] = {}
    editing_ids = [uuid.UUID(p["editing"]["id"]) for p in people.values() if p["editing"]]
    if editing_ids:
        for ev_id, title in db.query(TravelEvent.id, TravelEvent.title).filter(
                TravelEvent.id.in_(editing_ids), TravelEvent.plan_id == plan.id).all():
            titles[str(ev_id)] = title or "予定"
    labels = _labels(db, list(people), current_user)
    viewers = []
    for uid, p in sorted(people.items(), key=lambda kv: (not kv[1]["is_self"], labels.get(kv[0], ""))):
        ed = p["editing"]
        if ed and ed["id"] not in titles:
            ed = None  # 編集中だった予定が消された
        viewers.append({
            "user_id": uid, "label": labels.get(uid, "だれか"), "role": p["role"], "is_self": p["is_self"],
            "devices": p["devices"], "seen_at": _iso(p["seen_at"]),
            "editing": ({"kind": "event", "id": ed["id"], "label": titles[ed["id"]]} if ed else None),
        })
    others = sum(1 for v in viewers if not v["is_self"])
    return {
        "plan_id": str(plan.id),
        "revision": plan.revision,
        "viewers": viewers,
        "changes": _changes(db, plan, payload.known_revision, current_user),
        "poll_seconds": POLL_WITH_OTHERS if others else POLL_ALONE,
        "ttl_seconds": pr.TTL_SECONDS,
    }


@router.delete("/{plan_id}/presence/{client_id}", status_code=204)
def leave(plan_id: str, client_id: str, db: Session = Depends(get_db),
          current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if re.match(CLIENT_ID_PATTERN, client_id):
        pr.leave(str(plan.id), f"{current_user.id}:{client_id}")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# [Gate G2] FR-020 即時の共同編集の通知(Server-Sent Events)
# ---------------------------------------------------------------------------
STREAM_SECONDS = 45
STREAM_TICK_SECONDS = 1.0
STREAM_HEARTBEAT_SECONDS = 15
MAX_STREAMS_PER_USER = 4

# 利用者ごとの接続の印と始めた時刻。始まる前に切れた接続(finally が走らない)も、時間で数えなくなる
_streams: Dict[str, Dict[str, float]] = {}
_streams_lock = threading.Lock()


def _session_factory():
    """接続の間に何度も読むため、要求ごとの DB セッション(get_db)とは別に短いセッションを使う(試験で差し替える)。"""
    return SessionLocal()


def _presence_signature(plan_id: str, now: float) -> str:
    """開いている人(利用者)と編集中の予定の組。変わった時だけ presence を送る(端末の知らせの時刻では変えない)。"""
    parts = sorted({f"{e.get('user_id')}:{(e.get('editing') or {}).get('id') or ''}"
                    for e in pr.entries(plan_id, now)})
    return "|".join(parts)


def _poll_state(plan_uuid: uuid.UUID, user_id) -> Optional[int]:
    """(DB) いまの版。旅行が消された・見られなくなった時は None。"""
    db = _session_factory()
    try:
        plan = db.query(TravelPlan).filter(TravelPlan.id == plan_uuid, TravelPlan.deleted_at.is_(None)).first()
        if plan is None:
            return None
        user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
        if user is None or resolve_plan_role(db, plan, user) is None:
            return None
        return int(plan.revision)
    finally:
        db.close()


def _sse(event: str, data: dict, event_id: Optional[int] = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {json.dumps(data, separators=(',', ':'), ensure_ascii=False)}\n\n"


def _stream_open(user_key: str) -> Optional[str]:
    now = time.monotonic()
    with _streams_lock:
        mine = {k: t for k, t in _streams.get(user_key, {}).items() if now - t < STREAM_SECONDS + 30}
        if len(mine) >= MAX_STREAMS_PER_USER:
            _streams[user_key] = mine
            return None
        token = uuid.uuid4().hex
        mine[token] = now
        _streams[user_key] = mine
        return token


def _stream_close(user_key: str, token: str) -> None:
    with _streams_lock:
        mine = _streams.get(user_key) or {}
        mine.pop(token, None)
        if not mine:
            _streams.pop(user_key, None)


async def _event_stream(plan_uuid: uuid.UUID, user_id, start_revision: int, known: Optional[int], user_key: str,
                        token: str):
    plan_key = str(plan_uuid)
    try:
        last_rev = start_revision
        sig = _presence_signature(plan_key, time.time())
        yield "retry: 3000\n\n"
        yield _sse("ready", {"revision": start_revision, "stream_seconds": STREAM_SECONDS}, start_revision)
        if known is not None and known < start_revision:
            yield _sse("revision", {"revision": start_revision, "known_revision": known}, start_revision)
        started = time.monotonic()
        last_beat = started
        while time.monotonic() - started < STREAM_SECONDS:
            await asyncio.sleep(STREAM_TICK_SECONDS)
            rev = await asyncio.to_thread(_poll_state, plan_uuid, user_id)
            if rev is None:
                yield _sse("access_lost", {"reason": "plan_unavailable"})
                return
            if rev != last_rev:
                yield _sse("revision", {"revision": rev, "known_revision": last_rev}, rev)
                last_rev = rev
            new_sig = _presence_signature(plan_key, time.time())
            if new_sig != sig:
                sig = new_sig
                yield _sse("presence", {"people": len({p.split(':')[0] for p in sig.split('|') if p})}, last_rev)
            if time.monotonic() - last_beat >= STREAM_HEARTBEAT_SECONDS:
                last_beat = time.monotonic()
                yield ": keep-alive\n\n"
        yield _sse("reconnect", {"revision": last_rev}, last_rev)
    finally:
        _stream_close(user_key, token)


@router.get("/{plan_id}/events/stream")
def event_stream(plan_id: str, last_event_id: Optional[str] = Header(None, alias="Last-Event-ID"),
                 known_revision: Optional[int] = Query(None, ge=0), db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    known = known_revision
    if last_event_id is not None and last_event_id.strip().isdigit():
        known = int(last_event_id.strip())
    user_key = str(current_user.id)
    token = _stream_open(user_key)
    if token is None:
        raise HTTPException(status_code=429, detail={
            "code": "too_many_streams", "message": "同時に開いている画面が多すぎます。使っていない画面を閉じてください"})
    gen = _event_stream(plan.id, current_user.id, int(plan.revision), known, user_key, token)
    return StreamingResponse(gen, media_type="text/event-stream", headers={
        "Cache-Control": "no-store", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
