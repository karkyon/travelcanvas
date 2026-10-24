"""[Gate G6] MEM-01 旅行記の公開(URL)と、記録の削除の取り消し。

旅行のメンバー向け(/plans/{plan_id} 配下):
- POST   /memories/publications/preview : 公開する内容と確認の項目(保存しない)
- POST   /memories/publications         : 公開する(確認の項目を全て acknowledge に入れる。トークンはこの応答だけ)
- GET    /memories/publications         : 自分の公開の一覧
- DELETE /memories/publications/{id}    : 公開をやめる(URL はすぐ開けなくなる)
- GET    /memories/trash                : 自分が消した記録(元に戻せる間)
- POST   /memories/{id}/restore         : 消した記録を元に戻す(消した本人・書いた本人)

公開する物(app/services/memories.build_journal_draft):
- 本人の記録だけ(他のメンバーの記録は入れない)。公開範囲「自分だけ」の記録も、本人が公開を選んだ時だけ入る
- 座標は出さない。location_level=area は地名だけ(守る範囲の中の記録は地名も出さない)、none は場所を全く出さない
- 写真は include_photos の時だけ(撮影情報は取り除いて配る)。音声は出さない
- 公開の前の確認: 写っている人(顔の自動判定はしない)・同行者の名前・予約番号や電話番号のような文字列・地名

公開の閲覧(/public/journal/{token}): 資格情報なし。noindex・no-store・回数制限。失効・旅行の削除で 404。
"""
import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload, plan_subject
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    LocationPointBatch, LocationTrack, Memory, MemoryPublication, MemoryTrash, TravelDay, TravelEvent, TravelPlan,
    User,
)
from app.services import image_metadata
from app.services import location_privacy as lp
from app.services import memories as mem
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import member_user_ids
from app.services.readiness import member_names
from app.services.storage_backend import get_storage_backend, load_decrypted_file
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/plans", tags=["memories"])
public_router = APIRouter(prefix="/public/journal", tags=["public"])

TRASH_DAYS = 7
MAX_PUBLICATIONS = 20
MIME_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
PUBLIC_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer"}
ACK_CODES = ("photo_people", "member_name", "reservation_like", "phone_like", "place_names")
ACK_MESSAGES = {
    "photo_people": "写真に写っている人の了解を得ている(顔の自動判定はしていません)",
    "member_name": "同行者の名前を出してよいと確かめた",
    "reservation_like": "予約番号のような文字列が予約番号ではない(または消した)と確かめた",
    "phone_like": "電話番号のような文字列を出してよいと確かめた",
    "place_names": "地名(宿・自宅に近い場所が無いか)を確かめた",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def _bad(code: str, message: str, status_code: int = 422, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _audit(action: str, user: User, plan_id, details: Optional[Dict[str, Any]] = None) -> None:
    record_audit_event(action=action, resource_type="travel_plan", user_id=user.id, resource_id=plan_id,
                       details={"plan_id": str(plan_id), **(details or {})})


def _options(payload: Optional[dict]) -> Dict[str, Any]:
    p = payload if isinstance(payload, dict) else {}
    level = p.get("location_level", "none")
    if level not in ("none", "area"):
        raise _bad("invalid_location_level", "場所の出し方は「出さない」か「地名だけ」です")
    photos = p.get("include_photos", False)
    if not isinstance(photos, bool):
        raise _bad("invalid_field", "include_photos は真偽値です")
    title = p.get("title")
    if title is not None and (not isinstance(title, str) or not title.strip() or len(title.strip()) > 200):
        raise _bad("invalid_field", "題名は200文字までです")
    ack = p.get("acknowledge", [])
    if not isinstance(ack, list) or not all(isinstance(x, str) for x in ack):
        raise _bad("invalid_field", "acknowledge は確認した項目の一覧です")
    return {"location_level": level, "include_photos": photos, "title": title.strip() if title else None,
            "acknowledge": sorted(set(ack))}


def _own_track_route(db: Session, plan: TravelPlan, user: User, zones) -> List[Dict[str, float]]:
    """[LOC-02] 本人の軌跡を外へ出せる形(守る範囲を除き、両端を切り落とし、約1kmの格子)にする。"""
    points: List[Dict[str, Any]] = []
    for tr in db.query(LocationTrack).filter(LocationTrack.plan_id == plan.id, LocationTrack.user_id == user.id).all():
        b: Any
        for b in db.query(LocationPointBatch).filter(LocationPointBatch.track_id == tr.id).all():
            try:
                data = json.loads(decrypt_payload(b.points_ciphertext).decode("utf-8"))
            except Exception:  # noqa: BLE001 - 読めない軌跡は使わない
                continue
            if isinstance(data, list):
                points.extend(p for p in data if isinstance(p, dict))
    return lp.project_track(points, zones)


def _build(db: Session, plan: TravelPlan, user: User, opts: Dict[str, Any]) -> Dict[str, Any]:
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    rows: List[Any] = db.query(Memory).filter(Memory.plan_id == plan.id, Memory.author_user_id == user.id).all()
    zones = lp.zones_for(db, {plan.user_id, user.id})
    others = [n for uid, n in member_names(db, set(member_user_ids(db, plan))).items() if uid != user.id]
    hidden_place = 0
    memories = []
    for r in rows:
        if r.kind == "audio":
            continue  # 音声は公開しない
        place = r.place_name if opts["location_level"] == "area" else None
        if place and lp.in_zones(r.latitude, r.longitude, zones):
            place, hidden_place = None, hidden_place + 1
        memories.append({"id": r.id, "kind": r.kind, "body": r.body, "event_id": r.event_id, "day_id": r.day_id,
                         "occurred_at": r.occurred_at, "place_name": place, "latitude": None, "longitude": None,
                         "video_url": r.video_url, "by_me": True, "include_in_journal": r.include_in_journal})
    draft = mem.build_journal_draft(
        str(opts["title"] or plan.title or "旅行記"),
        [{"id": d.id, "local_date": d.local_date, "title": d.title} for d in days],
        [{"id": e.id, "day_id": e.day_id, "title": e.title, "local_start_time": e.local_start_time,
          "sort_order": e.sort_order} for e in events],
        memories, others, include_locations=False, include_media=opts["include_photos"], include_others=False,
        generated_at=_now())
    included_ids = {v["id"] for d in draft["days"] for en in d["entries"] for v in en["memories"]} | \
        {v["id"] for d in draft["days"] for v in d["day_memories"]} | {v["id"] for v in draft["other_memories"]}
    photo_ids = sorted(str(r.id) for r in rows if r.kind == "photo" and str(r.id) in included_ids
                       and opts["include_photos"])
    codes = {c["code"] for c in draft["checks"]}
    required = [c for c in ACK_CODES if c in codes]
    if opts["location_level"] == "area" and any(m["place_name"] for m in memories):
        required.append("place_names")
    draft.pop("markdown", None)
    if opts["location_level"] == "area":
        draft["route"] = _own_track_route(db, plan, user, zones)
    draft["location_level"] = opts["location_level"]
    draft["hidden_places"] = hidden_place
    return {"snapshot": draft, "photo_ids": photo_ids, "required": required}


def _pub_dict(p: MemoryPublication, token: Optional[str] = None) -> Dict[str, Any]:
    return {"id": str(p.id), "plan_id": str(p.plan_id), "title": p.title, "location_level": p.location_level,
            "include_photos": bool(p.include_photos), "photos": len(p.photo_ids or []),
            "view_count": p.view_count, "created_at": _iso(p.created_at), "revoked_at": _iso(p.revoked_at),
            "is_active": p.revoked_at is None, "token_prefix": p.token_prefix,
            "url": f"/journal/{token}" if token else None}


@router.post("/{plan_id}/memories/publications/preview")
def preview_publication(plan_id: str, payload: Optional[dict] = Body(None), db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    built = _build(db, plan, current_user, _options(payload))
    return {**built["snapshot"], "photo_ids": built["photo_ids"],
            "required_acknowledgements": [{"code": c, "message": ACK_MESSAGES[c]} for c in built["required"]]}


@router.post("/{plan_id}/memories/publications", status_code=201)
def create_publication(plan_id: str, payload: Optional[dict] = Body(None), db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if getattr(current_user, "user_type", None) == "guest":
        raise _bad("members_only", "旅行記の公開は会員だけができます(会員登録すると公開できます)", 403)
    opts = _options(payload)
    built = _build(db, plan, current_user, opts)
    missing = [c for c in built["required"] if c not in opts["acknowledge"]]
    if missing:
        raise _bad("acknowledgement_required", "公開の前に確認の項目を全て確かめてください", 422,
                   required=[{"code": c, "message": ACK_MESSAGES[c]} for c in missing])
    summary = built["snapshot"]["summary"]
    if not summary["memories"]:
        raise _bad("nothing_to_publish", "公開できる自分の記録がありません(旅行記に含める記録を書いてください)")
    active = db.query(MemoryPublication).filter(MemoryPublication.user_id == current_user.id,
                                                MemoryPublication.revoked_at.is_(None)).count()
    if active >= MAX_PUBLICATIONS:
        raise _bad("too_many_publications", f"公開中の旅行記は{MAX_PUBLICATIONS}件までです", 409)
    token = secrets.token_urlsafe(24)
    p = MemoryPublication(id=uuid.uuid4(), plan_id=plan.id, user_id=current_user.id, token_hash=_hash(token),
                          token_prefix=token[:8], title=built["snapshot"]["title"][:200],
                          location_level=opts["location_level"], include_photos=opts["include_photos"],
                          snapshot=built["snapshot"], photo_ids=built["photo_ids"],
                          acknowledged={"codes": built["required"], "at": _now().isoformat()})
    db.add(p)
    db.commit()
    db.refresh(p)
    _audit("journal_published", current_user, plan.id,
           {"location_level": p.location_level, "photos": len(p.photo_ids or []), "memories": summary["memories"]})
    return _pub_dict(p, token)


@router.get("/{plan_id}/memories/publications")
def list_publications(plan_id: str, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (db.query(MemoryPublication).filter(MemoryPublication.plan_id == plan.id,
                                               MemoryPublication.user_id == current_user.id)
            .order_by(MemoryPublication.created_at.desc()).all())
    return [_pub_dict(p) for p in rows]


@router.delete("/{plan_id}/memories/publications/{publication_id}")
def revoke_publication(plan_id: str, publication_id: uuid.UUID, db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    p = db.query(MemoryPublication).filter(MemoryPublication.id == publication_id,
                                           MemoryPublication.plan_id == plan.id,
                                           MemoryPublication.user_id == current_user.id).first()
    if p is None:
        raise _bad("publication_not_found", "公開が見つかりません", 404)
    if p.revoked_at is None:
        p.revoked_at = _now()
        db.commit()
        _audit("journal_unpublished", current_user, plan.id)
    return _pub_dict(p)


# ===== 削除の取り消し(memory_trash)

def to_trash(db: Session, plan: TravelPlan, m: Memory, user: User) -> datetime:
    """記録を一時の保管へ移す(行は消す。ファイルは保管の間は残す)。戻り値は元に戻せる期限。"""
    row = {c.name: getattr(m, c.name) for c in Memory.__table__.columns}
    row = {k: (v.isoformat() if isinstance(v, datetime) else str(v) if isinstance(v, uuid.UUID) else v)
           for k, v in row.items()}
    sealed = encrypt_payload(json.dumps(row, ensure_ascii=False).encode("utf-8"), plan_subject(plan.id))
    expires = _now() + timedelta(days=TRASH_DAYS)
    db.add(MemoryTrash(id=uuid.uuid4(), memory_id=m.id, plan_id=plan.id, deleted_by_user_id=user.id,
                       author_user_id=m.author_user_id, row_ciphertext=sealed, storage_key=m.storage_key,
                       expires_at=expires))
    db.delete(m)
    return expires


@router.get("/{plan_id}/memories/trash")
def list_trash(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (db.query(MemoryTrash).filter(MemoryTrash.plan_id == plan.id, MemoryTrash.expires_at > _now(),
                                         (MemoryTrash.deleted_by_user_id == current_user.id)
                                         | (MemoryTrash.author_user_id == current_user.id))
            .order_by(MemoryTrash.deleted_at.desc()).all())
    out = []
    t: Any
    for t in rows:
        try:
            data = json.loads(decrypt_payload(t.row_ciphertext).decode("utf-8"))
        except Exception:  # noqa: BLE001
            data = {}
        out.append({"memory_id": str(t.memory_id), "kind": data.get("kind"),
                    "summary": (data.get("body") or data.get("place_name") or "")[:60],
                    "deleted_at": _iso(t.deleted_at), "restore_until": _iso(t.expires_at)})
    return out


@router.post("/{plan_id}/memories/{memory_id}/restore", status_code=201)
def restore_memory(plan_id: str, memory_id: uuid.UUID, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t: Any = db.query(MemoryTrash).filter(MemoryTrash.plan_id == plan.id, MemoryTrash.memory_id == memory_id).first()
    if t is None or t.expires_at <= _now() or current_user.id not in (t.deleted_by_user_id, t.author_user_id):
        raise _bad("trash_not_found", "元に戻せる記録が見つかりません(期限は削除から7日です)", 404)
    if db.query(Memory.id).filter(Memory.id == memory_id).first() is not None:
        raise _bad("already_restored", "この記録はすでに戻っています", 409)
    try:
        data = json.loads(decrypt_payload(t.row_ciphertext).decode("utf-8"))
    except (EncryptionNotConfigured, Exception):  # noqa: BLE001
        raise _bad("trash_unreadable", "この記録は読めないため戻せません", 409)
    m: Any = Memory(**_memory_values(data))
    m.revision = int(data.get("revision") or 1) + 1
    db.add(m)
    db.delete(t)
    db.commit()
    _audit("memory.restore", current_user, plan.id, {"kind": m.kind})
    return {"memory_id": str(m.id), "restored": True}


UUID_COLUMNS = ("id", "plan_id", "author_user_id", "event_id", "day_id")
TIME_COLUMNS = ("occurred_at", "created_at", "updated_at")


def _memory_values(data: Dict[str, Any]) -> Dict[str, Any]:
    """保管した行(JSON)を Memory の列の値へ戻す。"""
    names = {c.name for c in Memory.__table__.columns}
    out: Dict[str, Any] = {}
    for k, v in data.items():
        if k not in names:
            continue
        if v is not None and k in UUID_COLUMNS:
            v = uuid.UUID(str(v))
        elif v is not None and k in TIME_COLUMNS:
            v = datetime.fromisoformat(str(v))
        out[k] = v
    return out


def purge_trash(db: Session, now: Optional[datetime] = None) -> Dict[str, int]:
    """期限の過ぎた保管を消す(ファイルも)。定期の処理(tcops jobs memory-trash)から呼ぶ。"""
    now = now or _now()
    rows = db.query(MemoryTrash).filter(MemoryTrash.expires_at <= now).all()
    backend = get_storage_backend()
    files = failed = 0
    t: Any
    for t in rows:
        if t.storage_key:
            try:
                backend.delete(t.storage_key)
                files += 1
            except (OSError, ValueError):
                failed += 1
                continue
        db.delete(t)
    db.commit()
    return {"purged": len(rows) - failed, "files": files, "failed": failed}


# ===== 公開の閲覧

def _publication(db: Session, token: str) -> MemoryPublication:
    if not token or len(token) > 100:
        raise HTTPException(status_code=404, detail="旅行記が見つかりません", headers=PUBLIC_HEADERS)
    p = db.query(MemoryPublication).filter(MemoryPublication.token_hash == _hash(token)).first()
    if p is None or p.revoked_at is not None:
        raise HTTPException(status_code=404, detail="旅行記が見つかりません", headers=PUBLIC_HEADERS)
    plan = db.query(TravelPlan).filter(TravelPlan.id == p.plan_id).first()
    if plan is None or getattr(plan, "deleted_at", None) is not None:
        raise HTTPException(status_code=404, detail="旅行記が見つかりません", headers=PUBLIC_HEADERS)
    return p


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@public_router.get("/{token}")
def view_publication(token: str, request: Request, response: Response, db: Session = Depends(get_db)):
    if not check_rate_limit(f"public_journal:{_ip(request)}", 60, 60):
        raise HTTPException(status_code=429, detail="アクセスが多すぎます。しばらく待ってください", headers=PUBLIC_HEADERS)
    p: Any = _publication(db, token)
    p.view_count = int(p.view_count or 0) + 1
    db.commit()
    response.headers.update(PUBLIC_HEADERS)
    snap = dict(p.snapshot or {})
    return {"title": p.title, "published_at": _iso(p.created_at), "location_level": p.location_level,
            "days": snap.get("days", []), "other_memories": snap.get("other_memories", []),
            "summary": snap.get("summary", {}), "route": snap.get("route", []),
            "photo_ids": list(p.photo_ids or [])}


@public_router.get("/{token}/photos/{memory_id}")
def view_publication_photo(token: str, memory_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    if not check_rate_limit(f"public_journal_photo:{_ip(request)}", 300, 60):
        raise HTTPException(status_code=429, detail="アクセスが多すぎます。しばらく待ってください", headers=PUBLIC_HEADERS)
    p = _publication(db, token)
    if str(memory_id) not in (p.photo_ids or []):
        raise HTTPException(status_code=404, detail="写真が見つかりません", headers=PUBLIC_HEADERS)
    m: Any = db.query(Memory).filter(Memory.id == memory_id, Memory.plan_id == p.plan_id,
                                     Memory.author_user_id == p.user_id, Memory.kind == "photo").first()
    if m is None or not m.storage_key:
        raise HTTPException(status_code=404, detail="写真が見つかりません", headers=PUBLIC_HEADERS)
    try:
        content = load_decrypted_file(get_storage_backend(), m.storage_key)
        content, _ = image_metadata.strip(MIME_EXT.get(m.mime_type or "", ""), content)
    except (FileNotFoundError, EncryptionNotConfigured, image_metadata.MetadataUnremovable):
        raise HTTPException(status_code=404, detail="写真が見つかりません", headers=PUBLIC_HEADERS)
    return Response(content=content, media_type=m.mime_type or "application/octet-stream", headers={
        **PUBLIC_HEADERS, "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox"})
