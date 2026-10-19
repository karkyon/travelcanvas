"""
[Gate P13] FR-038 任意の位置軌跡(DOC-15 CA-013/014、DOC-14 §4.4 TRACK、DOC-04 SC-43)。

エンドポイント(すべて /plans/{plan_id} 配下。軌跡は記録した本人だけのもので、旅行の所有者を含む他の人には見せない):
- GET    /location-tracks                 : 自分の軌跡の一覧と、同意・旅行の期間・開始できるか
- POST   /location-tracks                 : 記録を始める(位置情報の利用への同意と、旅行の期間内であることが必要)
- GET    /location-tracks/{id}            : 軌跡の詳細(点・距離)
- PATCH  /location-tracks/{id}            : 一時停止・再開・停止(If-Match: 軌跡のrevision)
- POST   /location-tracks/{id}/points     : 点をまとめて送る(synced のときだけ。batch_id で再送を二重に保存しない)
- DELETE /location-tracks/{id}/points     : 指定した時間帯の点を消す(任意の区間の削除)
- DELETE /location-tracks/{id}            : 軌跡を消す(点も消える)
- [Gate L5] GET/PUT /location-settings     : この旅行の位置の扱い(記録しない/この端末だけ/訪問地域だけ同期/暗号化して同期)
- [Gate L5] POST /location-tracks/{id}/area-cells : 「訪問地域だけ同期」の軌跡の区画(端末で集計した結果。生の座標は受けない)
- [Gate L5] PUT  /location-tracks/{id}/sampling   : 端末の記録の観測値(電池・欠測率・取得の間隔。座標を含まない)

旅行の期間を過ぎた軌跡・同意を撤回した利用者の軌跡は止める(読み出し・送信の時点で判定する)。
監査・エラーには座標を載せない(件数・理由だけ)。
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    LocationAreaCell, LocationPointBatch, LocationTrack, TravelDay, TravelPlan, TripLocationSetting, User,
)
from app.services import consents as cs
from app.services import location_tracks as lt
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["location-tracks"])

EARLY_START = timedelta(days=1)


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _db_user(db: Session, user: User) -> User:
    return db.query(User).filter(User.id == user.id).first() or user


def _window(db: Session, plan: TravelPlan):
    days = db.query(TravelDay.local_date, TravelDay.timezone_id).filter(TravelDay.plan_id == plan.id).all()
    return lt.trip_window([(d[0], d[1]) for d in days], plan.start_date, plan.end_date)


def _stop(t: LocationTrack, reason: str, at: datetime) -> None:
    t.status = "stopped"
    t.stopped_reason = reason
    t.stopped_at = at
    t.revision += 1


def _refresh(t: LocationTrack, now: datetime) -> bool:
    """旅行の期間を過ぎた記録を止める。止めたらTrue(呼出側でcommit)。"""
    if t.status != "stopped" and now >= _aware(t.auto_stop_at):
        _stop(t, "trip_ended", _aware(t.auto_stop_at))
        return True
    return False


def stop_active_tracks(db: Session, user_id, reason: str, now: Optional[datetime] = None) -> int:
    """利用者の記録中・一時停止中の軌跡をすべて止める(同意の撤回・アカウント削除で使う)。呼出側でcommitする。"""
    now = now or _now()
    rows = db.query(LocationTrack).filter(LocationTrack.user_id == user_id, LocationTrack.status != "stopped").all()
    for t in rows:
        _stop(t, reason, now)
    return len(rows)


def _load_points(db: Session, t: LocationTrack) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for b in db.query(LocationPointBatch).filter(LocationPointBatch.track_id == t.id).all():
        out.extend(lt.decode(decrypt_payload(b.points_ciphertext)))
    out.sort(key=lambda p: p["t"])
    return out


def _to_dict(t: LocationTrack) -> Dict[str, Any]:
    return {
        "id": str(t.id), "plan_id": str(t.plan_id), "mode": t.mode, "precision": t.precision, "status": t.status,
        "stopped_reason": t.stopped_reason, "started_at": _iso(t.started_at), "auto_stop_at": _iso(t.auto_stop_at),
        "stopped_at": _iso(t.stopped_at), "point_count": t.point_count, "revision": t.revision,
        "sampling": t.sampling, "created_at": _iso(t.created_at), "updated_at": _iso(t.updated_at),
    }


def _setting(db: Session, plan: TravelPlan, user: User) -> Optional[TripLocationSetting]:
    return db.query(TripLocationSetting).filter(TripLocationSetting.plan_id == plan.id,
                                                TripLocationSetting.user_id == user.id).first()


def _cells(db: Session, t: LocationTrack) -> List[Dict[str, Any]]:
    rows = (db.query(LocationAreaCell).filter(LocationAreaCell.track_id == t.id)
            .order_by(LocationAreaCell.first_at, LocationAreaCell.cell_key).all())
    return [{"key": c.cell_key, "first_at": _iso(c.first_at), "last_at": _iso(c.last_at),
             "dwell_seconds": c.dwell_seconds, "samples": c.samples, "state": lt.area_state(c.dwell_seconds)}
            for c in rows]


def _get_own(db: Session, plan: TravelPlan, track_id: str, user: User) -> LocationTrack:
    try:
        tid = uuid.UUID(str(track_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="軌跡が見つかりません")
    t = db.query(LocationTrack).filter(LocationTrack.id == tid, LocationTrack.plan_id == plan.id).first()
    # 他の人の軌跡は存在も知らせない(旅行の所有者にも見せない)
    if not t or t.user_id != user.id:
        raise HTTPException(status_code=404, detail="軌跡が見つかりません")
    if _refresh(t, _now()):
        db.commit()
    return t


def _require_rev(t: LocationTrack, if_match: Optional[str]) -> None:
    if if_match is None or not if_match.strip():
        raise HTTPException(status_code=400, detail="If-Matchヘッダーが必要です(軌跡のrevision)")
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
    if expected != t.revision:
        raise _bad("revision_conflict", f"軌跡が他の操作で更新されています(現在のrevision: {t.revision})", 409)


def _audit(action: str, user: User, t: LocationTrack, extra: Optional[Dict[str, Any]] = None) -> None:
    details = {"plan_id": str(t.plan_id), "mode": t.mode, "precision": t.precision}
    details.update(extra or {})
    record_audit_event(action=action, resource_type="location_track", user_id=user.id, resource_id=t.id,
                       details=details)


def _require_consent(db: Session, user: User) -> None:
    if not cs.has_consent(_db_user(db, user), "location"):
        raise _bad("consent_required",
                   "位置情報の利用に同意していないため記録できません。「データとプライバシー」で同意を変更できます", 403)


# ===== スキーマ =====

class TrackCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # [Gate L5] 省略時はこの旅行の設定(location-settings)。設定も無ければ「この端末だけ」
    mode: Optional[str] = None
    precision: str = "standard"


class LocationSettingBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: str


class AreaCellsUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cells: List[Dict[str, Any]] = Field(..., max_length=lt.MAX_CELLS_PER_REQUEST)


class SamplingBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sampling: Dict[str, Any]


class TrackAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str


class PointsUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    batch_id: uuid.UUID
    points: List[Dict[str, Any]] = Field(..., max_length=lt.MAX_POINTS_PER_REQUEST)


# ===== エンドポイント =====

@router.get("/{plan_id}/location-tracks")
def list_tracks(plan_id: str, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    now = _now()
    rows = (db.query(LocationTrack)
            .filter(LocationTrack.plan_id == plan.id, LocationTrack.user_id == current_user.id)
            .order_by(LocationTrack.started_at.desc(), LocationTrack.id).all())
    if any([_refresh(t, now) for t in rows]):
        db.commit()
    window = _window(db, plan)
    consent = cs.has_consent(_db_user(db, current_user), "location")
    active = next((t for t in rows if t.status != "stopped"), None)
    in_period = bool(window and window[0] - EARLY_START <= now < window[1])
    setting = _setting(db, plan, current_user)
    trip_mode = setting.mode if setting else None
    return {
        "tracks": [_to_dict(t) for t in rows],
        "location_consent": consent,
        "trip_period": {"start": window[0].isoformat(), "end": window[1].isoformat()} if window else None,
        "in_trip_period": in_period,
        "active_track_id": str(active.id) if active else None,
        "can_start": consent and in_period and active is None and trip_mode != "off",
        "max_points_per_request": lt.MAX_POINTS_PER_REQUEST,
        # [Gate L5] この旅行の位置の扱い(None = まだ選んでいない。記録は始まっていない)
        "trip_mode": trip_mode,
    }


@router.post("/{plan_id}/location-tracks", status_code=201)
def start_track(plan_id: str, body: TrackCreate, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    setting = _setting(db, plan, current_user)
    if setting is not None and setting.mode == "off":
        raise _bad("location_off", "この旅行は「位置を記録しない」設定です。記録するには設定を変えてください", 409)
    mode = body.mode or (setting.mode if setting else "device_only")
    if mode not in lt.MODES:
        raise _bad("invalid_field", "記録の保存先は「この端末だけ」「訪問地域だけ同期」「暗号化してサーバーへ」のいずれかです")
    if body.precision not in lt.PRECISION_DECIMALS:
        raise _bad("invalid_field", "精度は high / standard / low のいずれかです")
    _require_consent(db, current_user)
    window = _window(db, plan)
    if not window:
        raise _bad("no_trip_period", "旅行の日程が無いため記録できません。先に日程を登録してください", 409)
    now = _now()
    if not (window[0] - EARLY_START <= now < window[1]):
        raise _bad("outside_trip_period", "位置の記録は旅行の期間中(前日から最終日まで)だけ始められます", 409)
    for t in db.query(LocationTrack).filter(LocationTrack.plan_id == plan.id, LocationTrack.user_id == current_user.id,
                                            LocationTrack.status != "stopped").all():
        if not _refresh(t, now):
            raise _bad("track_active", "この旅行では記録中(または一時停止中)の軌跡があります。止めてから始めてください", 409)
    if setting is not None and mode != setting.mode:
        raise _bad("mode_mismatch", "この旅行の位置の設定と違う保存先です。先に設定を変えてください", 409)
    t = LocationTrack(plan_id=plan.id, user_id=current_user.id, mode=mode, precision=body.precision,
                      status="recording", started_at=now, auto_stop_at=window[1])
    db.add(t)
    if setting is None:
        # 記録を始めたこと自体が、この旅行の位置の扱いの選択になる(次から同じ扱い)
        db.add(TripLocationSetting(plan_id=plan.id, user_id=current_user.id, mode=mode))
    db.commit()
    db.refresh(t)
    _audit("location_track.start", current_user, t)
    return _to_dict(t)


@router.get("/{plan_id}/location-tracks/{track_id}")
def get_track(plan_id: str, track_id: str, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = _get_own(db, plan, track_id, current_user)
    try:
        points = _load_points(db, t) if t.mode == "synced" else []
    except EncryptionNotConfigured:
        raise _bad("encryption_not_configured", "暗号化が設定されていません(サーバー側の設定)", 503)
    cells = _cells(db, t) if t.mode == "areas_only" else []
    return {**_to_dict(t), "distance_m": lt.distance_m(points), "cells": cells,
            "points": [{"recorded_at": p["t"], "latitude": p["lat"], "longitude": p["lng"], "accuracy_m": p["acc"]}
                       for p in points]}


@router.patch("/{plan_id}/location-tracks/{track_id}")
def change_track(plan_id: str, track_id: str, body: TrackAction, db: Session = Depends(get_db),
                 if_match: Optional[str] = Header(None, alias="If-Match"),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = _get_own(db, plan, track_id, current_user)
    _require_rev(t, if_match)
    now = _now()
    if body.action == "pause":
        if t.status != "recording":
            raise _bad("invalid_state", "記録中の軌跡だけ一時停止できます", 409)
        t.status = "paused"
        t.revision += 1
    elif body.action == "resume":
        if t.status != "paused":
            raise _bad("invalid_state", "一時停止中の軌跡だけ再開できます", 409)
        _require_consent(db, current_user)
        t.status = "recording"
        t.revision += 1
    elif body.action == "stop":
        if t.status == "stopped":
            raise _bad("invalid_state", "この軌跡はすでに止まっています", 409)
        _stop(t, "user", now)
    else:
        raise _bad("invalid_field", "操作は pause / resume / stop のいずれかです")
    db.commit()
    db.refresh(t)
    _audit(f"location_track.{body.action}", current_user, t)
    return _to_dict(t)


@router.post("/{plan_id}/location-tracks/{track_id}/points")
def upload_points(plan_id: str, track_id: str, body: PointsUpload, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = _get_own(db, plan, track_id, current_user)
    if t.mode == "device_only":
        raise _bad("device_only", "この軌跡は「この端末だけ」に保存する設定のため、サーバーへは送れません", 409)
    if t.mode == "areas_only":
        raise _bad("areas_only", "この軌跡は「訪問地域だけ同期」の設定のため、座標はサーバーへ送れません", 409)
    existing = db.query(LocationPointBatch).filter(
        LocationPointBatch.track_id == t.id, LocationPointBatch.batch_id == body.batch_id).first()
    if existing:
        return {"accepted": existing.point_count, "rejected": {}, "point_count": t.point_count, "replayed": True,
                "status": t.status}
    if not cs.has_consent(_db_user(db, current_user), "location"):
        if t.status != "stopped":
            _stop(t, "consent_withdrawn", _now())
            db.commit()
        _require_consent(db, current_user)
    if t.status != "recording":
        code = "paused" if t.status == "paused" else "stopped"
        raise _bad(code, "一時停止中のため受け付けません" if code == "paused" else "記録は止まっています", 409)
    end = _aware(t.auto_stop_at)
    accepted, rejected = lt.clean_points(body.points, t.precision, _aware(t.started_at), end)
    if t.point_count + len(accepted) > lt.MAX_POINTS_PER_TRACK:
        raise _bad("track_full", f"1つの軌跡の点は{lt.MAX_POINTS_PER_TRACK}件までです。新しく記録を始めてください", 409)
    if accepted:
        try:
            cipher = encrypt_payload(lt.encode(accepted))
        except EncryptionNotConfigured:
            raise _bad("encryption_not_configured", "暗号化が設定されていません(サーバー側の設定)", 503)
        db.add(LocationPointBatch(track_id=t.id, batch_id=body.batch_id, points_ciphertext=cipher,
                                  point_count=len(accepted), first_at=datetime.fromisoformat(accepted[0]["t"]),
                                  last_at=datetime.fromisoformat(accepted[-1]["t"])))
        t.point_count += len(accepted)
    db.commit()
    return {"accepted": len(accepted), "rejected": rejected, "point_count": t.point_count, "replayed": False,
            "status": t.status}


@router.delete("/{plan_id}/location-tracks/{track_id}/points")
def delete_points(plan_id: str, track_id: str, start: datetime = Query(...), end: datetime = Query(...),
                  db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = _get_own(db, plan, track_id, current_user)
    if start.tzinfo is None or end.tzinfo is None or end < start:
        raise _bad("invalid_field", "消す時間帯(start・end)はタイムゾーン付きで、start ≦ end にしてください")
    start, end = start.astimezone(dt_timezone.utc), end.astimezone(dt_timezone.utc)
    removed = 0
    if t.mode == "areas_only":
        # [Gate L5] 区画は時間帯にまとめた値なので、指定した時間帯に少しでも重なる区画を消す
        removed = db.query(LocationAreaCell).filter(
            LocationAreaCell.track_id == t.id, LocationAreaCell.first_at <= end,
            LocationAreaCell.last_at >= start).delete(synchronize_session=False)
        if removed:
            t.revision += 1
        db.commit()
        _audit("location_track.cells_delete", current_user, t, {"removed": removed})
        return {"removed": removed, "point_count": t.point_count, "revision": t.revision}
    batches = db.query(LocationPointBatch).filter(
        LocationPointBatch.track_id == t.id, LocationPointBatch.first_at <= end,
        LocationPointBatch.last_at >= start).all()
    for b in batches:
        keep, n = lt.split_range(lt.decode(decrypt_payload(b.points_ciphertext)), start, end)
        if not n:
            continue
        removed += n
        if keep:
            b.points_ciphertext = encrypt_payload(lt.encode(keep))
            b.point_count = len(keep)
            b.first_at = datetime.fromisoformat(keep[0]["t"])
            b.last_at = datetime.fromisoformat(keep[-1]["t"])
        else:
            # 再送(同じbatch_id)で消した点が戻らないよう、まとまりの行は空にして残す
            b.points_ciphertext = encrypt_payload(lt.encode([]))
            b.point_count = 0
    if removed:
        t.point_count -= removed
        t.revision += 1
    db.commit()
    _audit("location_track.points_delete", current_user, t, {"removed": removed})
    return {"removed": removed, "point_count": t.point_count, "revision": t.revision}


@router.delete("/{plan_id}/location-tracks/{track_id}", status_code=204)
def delete_track(plan_id: str, track_id: str, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = _get_own(db, plan, track_id, current_user)
    _audit("location_track.delete", current_user, t, {"points": t.point_count})
    db.delete(t)
    db.commit()
    return Response(status_code=204)


# ===== [Gate L5] 旅行ごとの位置の扱い・訪問地域・記録の観測値 =====

def _setting_dict(setting: Optional[TripLocationSetting]) -> Dict[str, Any]:
    return {"mode": setting.mode if setting else None, "revision": setting.revision if setting else 0,
            "updated_at": _iso(setting.updated_at or setting.created_at) if setting else None}


@router.get("/{plan_id}/location-settings")
def get_location_settings(plan_id: str, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return _setting_dict(_setting(db, plan, current_user))


@router.put("/{plan_id}/location-settings")
def put_location_settings(plan_id: str, body: LocationSettingBody, db: Session = Depends(get_db),
                          if_match: Optional[str] = Header(None, alias="If-Match"),
                          current_user: User = Depends(get_current_user_or_guest)):
    """この旅行の位置の扱いを選ぶ(本人の分だけ)。「記録しない」にすると記録中の軌跡は止める。
    記録中(一時停止中を含む)に保存先を変えることはできない(止めてから変える)。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if body.mode not in lt.TRIP_MODES:
        raise _bad("invalid_field", "位置の扱いは off / device_only / areas_only / synced のいずれかです")
    setting = _setting(db, plan, current_user)
    current_rev = setting.revision if setting else 0
    if if_match is None or not if_match.strip():
        raise HTTPException(status_code=400, detail="If-Matchヘッダーが必要です(設定のrevision。未設定は0)")
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
    if expected != current_rev:
        raise _bad("revision_conflict", f"設定が他の操作で更新されています(現在のrevision: {current_rev})", 409)
    now = _now()
    active = [t for t in db.query(LocationTrack).filter(LocationTrack.plan_id == plan.id,
                                                        LocationTrack.user_id == current_user.id,
                                                        LocationTrack.status != "stopped").all()
              if not _refresh(t, now)]
    stopped = 0
    if body.mode == "off":
        for t in active:
            _stop(t, "mode_off", now)
            stopped += 1
    elif active and active[0].mode != body.mode:
        raise _bad("track_active", "記録中の軌跡があるため保存先を変えられません。記録を止めてから変えてください", 409)
    if setting is None:
        setting = TripLocationSetting(plan_id=plan.id, user_id=current_user.id, mode=body.mode, revision=1)
        db.add(setting)
    elif setting.mode != body.mode:
        setting.mode = body.mode
        setting.revision += 1
        setting.updated_at = now
    db.commit()
    db.refresh(setting)
    record_audit_event(action="location_settings.update", resource_type="location_settings", user_id=current_user.id,
                       resource_id=plan.id, details={"mode": setting.mode, "stopped_tracks": stopped})
    return {**_setting_dict(setting), "stopped_tracks": stopped}


@router.post("/{plan_id}/location-tracks/{track_id}/area-cells")
def upload_area_cells(plan_id: str, track_id: str, body: AreaCellsUpload, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    """「訪問地域だけ同期」の軌跡: 端末が生の座標から集計した区画(0.1度)を受け取る。
    同じ区画は合わせる(最初・最後の時刻を広げ、滞在時間・件数は大きい方)。送り直しても増えない。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = _get_own(db, plan, track_id, current_user)
    if t.mode != "areas_only":
        raise _bad("not_areas_only", "訪問地域を送れるのは「訪問地域だけ同期」の軌跡だけです", 409)
    if not cs.has_consent(_db_user(db, current_user), "location"):
        if t.status != "stopped":
            _stop(t, "consent_withdrawn", _now())
            db.commit()
        _require_consent(db, current_user)
    end = _aware(t.stopped_at) if t.stopped_at else _aware(t.auto_stop_at)
    cells, rejected = lt.clean_cells(body.cells, _aware(t.started_at), end)
    existing = {c.cell_key: c for c in db.query(LocationAreaCell).filter(LocationAreaCell.track_id == t.id).all()}
    new_keys = [c for c in cells if c["key"] not in existing]
    if len(existing) + len(new_keys) > lt.MAX_CELLS_PER_TRACK:
        raise _bad("track_full", f"1つの軌跡の区画は{lt.MAX_CELLS_PER_TRACK}件までです", 409)
    added = updated = 0
    for c in cells:
        row = existing.get(c["key"])
        if row is None:
            db.add(LocationAreaCell(track_id=t.id, plan_id=plan.id, user_id=current_user.id, cell_key=c["key"],
                                    first_at=c["first_at"], last_at=c["last_at"], dwell_seconds=c["dwell_seconds"],
                                    samples=c["samples"]))
            added += 1
            continue
        changed = False
        if c["first_at"] < _aware(row.first_at):
            row.first_at, changed = c["first_at"], True
        if c["last_at"] > _aware(row.last_at):
            row.last_at, changed = c["last_at"], True
        if c["dwell_seconds"] > row.dwell_seconds:
            row.dwell_seconds, changed = c["dwell_seconds"], True
        if c["samples"] > row.samples:
            row.samples, changed = c["samples"], True
        updated += int(changed)
    db.commit()
    total = db.query(LocationAreaCell).filter(LocationAreaCell.track_id == t.id).count()
    return {"added": added, "updated": updated, "rejected": rejected, "cell_count": total, "status": t.status}


@router.put("/{plan_id}/location-tracks/{track_id}/sampling")
def put_sampling(plan_id: str, track_id: str, body: SamplingBody, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    """端末の記録の観測値(FR-056 CA-014)。電池の消費・欠測率・取得の間隔の内訳。座標は受け付けない。
    どの保存先の軌跡でも送れる(端末だけに座標を置く軌跡も、観測値だけはサーバーで見られる)。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = _get_own(db, plan, track_id, current_user)
    try:
        t.sampling = lt.clean_sampling(body.sampling)
    except lt.TrackInputError as error:
        raise _bad(error.code, str(error))
    t.sampling = {**t.sampling, "reported_at": _now().isoformat()}
    db.commit()
    db.refresh(t)
    return _to_dict(t)
