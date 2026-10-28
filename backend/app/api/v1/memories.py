"""
[Gate P12] FR-037 写真・メモ・旅行記(DOC-04 SC-28、DOC-14 §4.5 MEMORY、DOC-15 CA-012)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET    /memories                     : 見える記録の一覧(自分の記録と、メンバーに公開された記録。viewer以上)
- POST   /memories                     : 文章のメモ・動画の参照(URL)を記録する(editor以上)
- POST   /memories/upload              : 写真・音声メモをファイル付きで記録する(editor以上、multipart)
- PATCH  /memories/{id}                : 記録を変える(書いた本人だけ。If-Match: 記録のrevision)
- DELETE /memories/{id}                : 記録を消す(書いた本人、またはメンバーに公開された記録を旅行の所有者が)。
                                         [Gate G6] 7日の間は元に戻せる(memory_publish.py の restore。ファイルはその後に消す)
- GET    /memories/{id}/media          : 写真・音声のファイル(見える人だけ。キャッシュさせない)
- POST   /memories/journal-draft       : 計画と実績から旅行記の下書きを作り、公開前の検査結果を返す(保存しない・旅程は変えない)

記録の公開範囲は既定で「自分だけ」(private)。他人の「自分だけ」の記録は、件数も含めて返さない。
監査には種類・公開範囲・サイズだけを記録する(本文・場所・ファイル名は残さない)。
"""
import logging
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, Optional, Sequence

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.config import settings
from app.core.crypto import EncryptionNotConfigured
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import Memory, TravelDay, TravelEvent, TravelPlan, User
from app.ops import metrics as ops_metrics
from app.services import malware_scan, usage
from app.services import memories as mem
from app.services import threat_guard
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import member_user_ids
from app.services.readiness import member_names
from app.services import image_metadata
from app.services.storage_backend import (
    FileTooLargeError, compute_sha256, generate_storage_key, get_storage_backend, load_decrypted_file,
    read_upload_limited, save_encrypted_file,
)

logger = logging.getLogger(__name__)
# [Gate Q1] 保存した写真の MIME から、撮影情報を取り除く時の形式を決める
MIME_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}

router = APIRouter(prefix="/plans", tags=["memories"])


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _uuid(value: Optional[str], label: str) -> Optional[uuid.UUID]:
    if value is None or value == "":
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise _bad("invalid_field", f"{label}の形式が不正です")


def _visible(m: Memory, user: User) -> bool:
    return m.author_user_id == user.id or m.visibility == "members"


def _to_dict(m: Memory, user: User, plan: TravelPlan, names: Dict[uuid.UUID, str]) -> Dict[str, Any]:
    by_me = m.author_user_id == user.id
    return {
        "id": str(m.id), "plan_id": str(m.plan_id), "kind": m.kind, "body": m.body,
        "event_id": str(m.event_id) if m.event_id else None, "day_id": str(m.day_id) if m.day_id else None,
        "occurred_at": _iso(m.occurred_at), "place_name": m.place_name,
        "latitude": m.latitude, "longitude": m.longitude, "video_url": m.video_url,
        "has_media": m.storage_key is not None, "mime_type": m.mime_type, "size": m.size,
        "visibility": m.visibility, "include_in_journal": bool(m.include_in_journal),
        "author_name": names.get(m.author_user_id, "退会したメンバー"),
        "by_me": by_me, "can_edit": by_me, "can_delete": by_me or plan.user_id == user.id,
        "revision": m.revision, "created_at": _iso(m.created_at), "updated_at": _iso(m.updated_at),
        "source": _source_summary(m),  # [Gate G11] 外部の写真の出典(手で上げた写真は null)
    }


def _source_summary(m: Memory) -> Optional[Dict[str, Any]]:
    from app.services.plan_cover import source_summary
    return source_summary(m)


def _names(db: Session, plan: TravelPlan, extra: Sequence[uuid.UUID] = ()) -> Dict[uuid.UUID, str]:
    return member_names(db, set(member_user_ids(db, plan)) | set(extra))


def _require_rev(m: Memory, if_match: Optional[str]) -> None:
    if if_match is None or not if_match.strip():
        raise HTTPException(status_code=400, detail="If-Matchヘッダーが必要です(記録のrevision)")
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
    if expected != m.revision:
        raise _bad("revision_conflict", f"記録が他の変更で更新されています(現在のrevision: {m.revision})", 409)


def _check_target(db: Session, plan: TravelPlan, event_id: Optional[uuid.UUID], day_id: Optional[uuid.UUID]):
    """予定・日がこの旅行のものか確認し、予定から日を補う。戻り値は (event_id, day_id)。"""
    if event_id:
        ev = db.query(TravelEvent).filter(TravelEvent.id == event_id, TravelEvent.plan_id == plan.id).first()
        if not ev:
            raise _bad("event_not_found", "指定した予定が見つかりません")
        if day_id and day_id != ev.day_id:
            raise _bad("invalid_field", "予定と日が一致しません")
        day_id = ev.day_id
    if day_id and not db.query(TravelDay.id).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first():
        raise _bad("day_not_found", "指定した日が見つかりません")
    return event_id, day_id


def _count_check(db: Session, plan: TravelPlan) -> None:
    if db.query(Memory.id).filter(Memory.plan_id == plan.id).count() >= mem.MAX_MEMORIES_PER_PLAN:
        raise _bad("too_many_memories", f"1つの旅行の記録は{mem.MAX_MEMORIES_PER_PLAN}件までです")


def _get_visible(db: Session, plan: TravelPlan, memory_id: str, user: User) -> Memory:
    mid = _uuid(memory_id, "記録ID")
    m = db.query(Memory).filter(Memory.id == mid, Memory.plan_id == plan.id).first()
    # 他人の「自分だけ」の記録は存在も知らせない
    if not m or not _visible(m, user):
        raise HTTPException(status_code=404, detail="記録が見つかりません")
    return m


def _audit(action: str, user: User, m: Memory, extra: Optional[Dict[str, Any]] = None) -> None:
    details = {"plan_id": str(m.plan_id), "kind": m.kind, "visibility": m.visibility}
    details.update(extra or {})
    record_audit_event(action=action, resource_type="memory", user_id=user.id, resource_id=m.id, details=details)


# ===== スキーマ =====

class MemoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str = "note"
    body: Optional[str] = None
    event_id: Optional[str] = None
    day_id: Optional[str] = None
    occurred_at: Optional[datetime] = None
    place_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    video_url: Optional[str] = None
    visibility: str = "private"
    include_in_journal: bool = True


class MemoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: Optional[str] = None
    event_id: Optional[str] = None
    day_id: Optional[str] = None
    occurred_at: Optional[datetime] = None
    place_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    video_url: Optional[str] = None
    visibility: Optional[str] = None
    include_in_journal: Optional[bool] = None


class JournalOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    include_locations: bool = False
    include_media: bool = True
    include_others: bool = False


def _common_fields(db: Session, plan: TravelPlan, kind: str, body, event_id, day_id, occurred_at, place_name,
                   latitude, longitude, visibility) -> Dict[str, Any]:
    if kind not in mem.KINDS:
        raise _bad("invalid_kind", "記録の種類が不正です")
    if visibility not in mem.VISIBILITIES:
        raise _bad("invalid_field", "公開範囲は「自分だけ」か「メンバー」です")
    try:
        body_v = mem.clean_text(body, mem.MAX_BODY, "メモ")
        place_v = mem.clean_text(place_name, mem.MAX_PLACE_NAME, "場所の名前")
        lat, lng = mem.check_location(latitude, longitude)
    except mem.MemoryInputError as e:
        raise _bad(e.code, str(e))
    ev, day = _check_target(db, plan, _uuid(event_id, "予定ID"), _uuid(day_id, "日ID"))
    if occurred_at is not None and occurred_at.tzinfo is None:
        raise _bad("invalid_field", "日時にはタイムゾーンを含めてください")
    return {"body": body_v, "event_id": ev, "day_id": day, "occurred_at": occurred_at, "place_name": place_v,
            "latitude": lat, "longitude": lng, "visibility": visibility}


# ===== エンドポイント =====

@router.get("/{plan_id}/memories")
def list_memories(plan_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (db.query(Memory).filter(Memory.plan_id == plan.id)
            .filter((Memory.author_user_id == current_user.id) | (Memory.visibility == "members"))
            .order_by(Memory.occurred_at.asc().nullslast(), Memory.created_at.asc(), Memory.id.asc()).all())
    names = _names(db, plan, [r.author_user_id for r in rows])
    return {"memories": [_to_dict(r, current_user, plan, names) for r in rows],
            "can_create": role in ("owner", "editor"),
            "max_upload_bytes": settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES}


@router.post("/{plan_id}/memories", status_code=201)
def create_memory(plan_id: str, body: MemoryCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    if body.kind not in ("note", "video"):
        raise _bad("invalid_kind", "写真・音声メモはファイルを付けて登録してください(/memories/upload)")
    _count_check(db, plan)
    f = _common_fields(db, plan, body.kind, body.body, body.event_id, body.day_id, body.occurred_at,
                       body.place_name, body.latitude, body.longitude, body.visibility)
    video = None
    if body.kind == "video":
        try:
            video = mem.validate_video_url(body.video_url)
        except mem.MemoryInputError as e:
            raise _bad(e.code, str(e))
    elif body.video_url:
        raise _bad("invalid_field", "動画のURLは動画の記録にだけ付けられます")
    if body.kind == "note" and not f["body"]:
        raise _bad("invalid_field", "メモを入力してください")
    m = Memory(plan_id=plan.id, author_user_id=current_user.id, kind=body.kind, video_url=video,
               include_in_journal=body.include_in_journal, **f)
    db.add(m)
    db.commit()
    db.refresh(m)
    _audit("memory.create", current_user, m)
    return _to_dict(m, current_user, plan, _names(db, plan))


@router.post("/{plan_id}/memories/upload", status_code=201)
async def upload_memory(
    plan_id: str,
    request: Request,
    file: UploadFile = File(...),
    kind: str = Form(...),
    body: Optional[str] = Form(None),
    event_id: Optional[str] = Form(None),
    day_id: Optional[str] = Form(None),
    occurred_at: Optional[datetime] = Form(None),
    place_name: Optional[str] = Form(None),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    visibility: str = Form("private"),
    include_in_journal: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    if kind not in ("photo", "audio"):
        raise _bad("invalid_kind", "ファイルを付けられるのは写真と音声メモだけです")
    _count_check(db, plan)
    f = _common_fields(db, plan, kind, body, event_id, day_id, occurred_at, place_name, latitude, longitude,
                       visibility)
    # [Gate S4] F09 上限を超えた時点で読むのを止める。保存の前にウイルス検査をする。
    try:
        content = await read_upload_limited(file, settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES)
    except FileTooLargeError:
        ops_metrics.registry.count_security_event("upload_too_large")
        limit_mb = settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)
        raise _bad("file_too_large", f"ファイルが大きすぎます(上限 {limit_mb}MB)", 413)
    m = _store_media(request, db, plan, current_user, kind, file.filename or "", content, f, include_in_journal)
    _audit("memory.create", current_user, m, {"size": m.size})
    return _to_dict(m, current_user, plan, _names(db, plan))


async def save_photo(request: Optional[Request], db: Session, plan: TravelPlan, user: User, content: bytes,
                     filename: str, *, body: Optional[str] = None, event_id: Optional[str] = None,
                     source: Optional[Dict[str, Any]] = None, include_in_journal: bool = False) -> Memory:
    """[Gate G11] 外部から取り込んだ写真を、上げた写真と同じ検査(形式・先頭の中身・ウイルス・撮影情報の除去)と暗号化で、
    非公開(自分だけ)の記録として保存する。出典(source)を記録に残す。"""
    _count_check(db, plan)
    f = _common_fields(db, plan, "photo", (body or "")[:mem.MAX_BODY] or None, event_id, None, None, None, None, None,
                       "private")
    return _store_media(request, db, plan, user, "photo", filename, content, f, include_in_journal, source=source)


def _store_media(request: Optional[Request], db: Session, plan: TravelPlan, current_user: User, kind: str,
                 filename: str, content: bytes, f: Dict[str, Any], include_in_journal: bool,
                 source: Optional[Dict[str, Any]] = None) -> Memory:
    """記録のファイルの検査・保存の共通の処理(上げた写真・音声と、外部から取り込んだ写真)"""
    try:
        ext, mime_type = mem.validate_media(kind, filename, content,
                                            settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES)
    except mem.MemoryInputError as e:
        raise _bad(e.code, str(e), 413 if e.code == "file_too_large" else 422)
    try:
        scan = malware_scan.scan_upload(content)
    except malware_scan.MalwareScanUnavailable:
        raise _bad("scan_unavailable", "ファイルの安全確認ができないため、今は受け付けられません", 503)
    if scan.infected:
        ops_metrics.registry.count_security_event("malware_rejected")
        if request is not None:
            threat_guard.signal(request, "malware_rejected")  # [Gate S6]
        record_audit_event(action="upload_rejected_malware", resource_type="memory", user_id=current_user.id,
                           details={"plan_id": str(plan.id), "engine": scan.engine})
        raise _bad("malware_found", "ファイルから有害なプログラムが見つかったため、受け付けませんでした", 422)
    if settings.DOCUMENT_REQUIRE_CLEAN_SCAN and scan.status != malware_scan.CLEAN:
        raise _bad("scan_unavailable", "ファイルの安全確認ができないため、今は受け付けられません", 503)
    if kind == "photo":
        # [Gate Q1] 撮影情報(撮影位置・機種・撮影日時)を取り除いてから保存する(向きは画素に反映する)
        try:
            content, _stripped = image_metadata.strip(ext, content)
        except image_metadata.MetadataUnremovable:
            raise _bad("metadata_unremovable", "写真の撮影情報(撮影位置など)を取り除けないため、受け付けられません", 422)
    usage.charge(db, "user", plan.user_id, "upload_bytes", len(content))  # [Gate G5] BILL-02(旅行の所有者に数える)
    storage_key = generate_storage_key(plan.id, ext)
    backend = get_storage_backend()
    try:
        save_encrypted_file(backend, storage_key, content)
    except EncryptionNotConfigured:
        raise _bad("encryption_not_configured", "ファイルの暗号化が設定されていません(サーバー側の設定)", 503)
    except OSError:
        logger.exception("memory upload storage write failed (plan_id=%s)", plan.id)
        raise _bad("storage_failed", "ファイルの保存に失敗しました。しばらくしてから再試行してください", 503)
    m = Memory(plan_id=plan.id, author_user_id=current_user.id, kind=kind, storage_key=storage_key,
               mime_type=mime_type, size=len(content), sha256=compute_sha256(content),
               include_in_journal=include_in_journal, source=source, **f)
    db.add(m)
    try:
        db.commit()
    except Exception:
        db.rollback()
        backend.delete(storage_key)
        raise
    db.refresh(m)
    return m


@router.patch("/{plan_id}/memories/{memory_id}")
def update_memory(plan_id: str, memory_id: str, body: MemoryUpdate, db: Session = Depends(get_db),
                  if_match: Optional[str] = Header(None, alias="If-Match"),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    m = _get_visible(db, plan, memory_id, current_user)
    if m.author_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="記録を変えられるのは書いた本人だけです")
    _require_rev(m, if_match)
    sent = body.model_fields_set
    if not sent:
        raise _bad("no_changes", "変更する項目がありません")
    keys = ("body", "event_id", "day_id", "occurred_at", "place_name", "latitude", "longitude", "visibility")
    cur = {k: getattr(m, k) for k in keys}
    merged = {k: (getattr(body, k) if k in sent else v) for k, v in cur.items()}
    if "event_id" in sent and "day_id" not in sent and body.event_id is None:
        merged["day_id"] = m.day_id
    if "event_id" in sent and body.event_id and "day_id" not in sent:
        merged["day_id"] = None
    f = _common_fields(db, plan, m.kind,
                       merged["body"], str(merged["event_id"]) if merged["event_id"] else None,
                       str(merged["day_id"]) if merged["day_id"] else None, merged["occurred_at"],
                       merged["place_name"], merged["latitude"], merged["longitude"], merged["visibility"])
    if m.kind == "note" and not f["body"]:
        raise _bad("invalid_field", "メモを入力してください")
    if "video_url" in sent:
        if m.kind != "video":
            raise _bad("invalid_field", "動画のURLは動画の記録にだけ付けられます")
        try:
            m.video_url = mem.validate_video_url(body.video_url)
        except mem.MemoryInputError as e:
            raise _bad(e.code, str(e))
    for k, v in f.items():
        setattr(m, k, v)
    if "include_in_journal" in sent and body.include_in_journal is not None:
        m.include_in_journal = body.include_in_journal
    m.revision += 1
    db.commit()
    db.refresh(m)
    _audit("memory.update", current_user, m, {"fields": sorted(sent)})
    return _to_dict(m, current_user, plan, _names(db, plan))


@router.delete("/{plan_id}/memories/{memory_id}", status_code=204)
def delete_memory(plan_id: str, memory_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    m = _get_visible(db, plan, memory_id, current_user)
    if m.author_user_id != current_user.id and plan.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="記録を消せるのは書いた本人と旅行の所有者だけです")
    _audit("memory.delete", current_user, m, {"by_author": m.author_user_id == current_user.id})
    # [Gate G6] MEM-01 記録の削除を元に戻せるよう、7日の間は一時の保管へ移す(ファイルはその後に定期の処理が消す)
    from app.api.v1 import memory_publish

    try:
        until = memory_publish.to_trash(db, plan, m, current_user)
    except EncryptionNotConfigured:
        raise _bad("encryption_not_configured", "記録の暗号化が設定されていません(サーバー側の設定)", 503)
    db.commit()
    return Response(status_code=204, headers={"X-Restore-Until": until.isoformat()})


@router.get("/{plan_id}/memories/{memory_id}/media")
def get_memory_media(plan_id: str, memory_id: str, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    m = _get_visible(db, plan, memory_id, current_user)
    return media_response(m)


def media_response(m: Memory) -> Response:
    """[Gate G11] 記録のファイルの配信(表紙・予定の写真も同じ守りで返す)。呼ぶ側で見える人か確かめてから使う"""
    if not m.storage_key:
        raise HTTPException(status_code=404, detail="この記録にはファイルがありません")
    try:
        content = load_decrypted_file(get_storage_backend(), m.storage_key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ファイルが見つかりません")
    except EncryptionNotConfigured:
        raise _bad("encryption_not_configured", "ファイルの暗号化が設定されていません(サーバー側の設定)", 503)
    if m.kind == "photo":
        # [Gate Q1] Q1 より前に保存した写真には撮影情報が残っているため、配信の時にも取り除く
        ext = MIME_EXT.get(m.mime_type or "", "")
        try:
            content, _stripped = image_metadata.strip(ext, content)
        except image_metadata.MetadataUnremovable:
            raise _bad("metadata_unremovable", "この写真は撮影情報(撮影位置など)を取り除けないため表示できません", 422)
    return Response(content=content, media_type=m.mime_type or "application/octet-stream", headers={
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",  # [Gate S4] 直接開かれても画面として動かさない
    })


@router.post("/{plan_id}/memories/journal-draft")
def journal_draft(plan_id: str, body: JournalOptions, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    rows = (db.query(Memory).filter(Memory.plan_id == plan.id)
            .filter((Memory.author_user_id == current_user.id) | (Memory.visibility == "members")).all())
    names = _names(db, plan)
    others = [n for uid, n in names.items() if uid != current_user.id]
    draft = mem.build_journal_draft(
        plan.title or "旅行記",
        [{"id": d.id, "local_date": d.local_date, "title": d.title} for d in days],
        [{"id": e.id, "day_id": e.day_id, "title": e.title, "local_start_time": e.local_start_time,
          "sort_order": e.sort_order} for e in events],
        [{"id": r.id, "kind": r.kind, "body": r.body, "event_id": r.event_id, "day_id": r.day_id,
          "occurred_at": r.occurred_at, "place_name": r.place_name, "latitude": r.latitude,
          "longitude": r.longitude, "video_url": r.video_url, "by_me": r.author_user_id == current_user.id,
          "include_in_journal": r.include_in_journal} for r in rows],
        others,
        include_locations=body.include_locations, include_media=body.include_media,
        include_others=body.include_others, generated_at=_now(),
    )
    return draft
