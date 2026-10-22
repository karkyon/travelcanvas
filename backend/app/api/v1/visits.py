"""
[Gate V2] FR-049 Visited Area Layer・FR-050 訪問判定・信頼度・FR-051 訪問訂正・Privacy除外
(DOC-15 CA-007〜009、DOC-14「v5.1 訪問判定」・§7.4・§8、DOC-04 SC-39/40)。

エンドポイント(すべて /plans/{plan_id} 配下。閲覧者本人の判定だけを扱う。viewer以上):
- GET   /visits                    : 位置のある予定ごとの地図の層の状態(予定・通過・訪問・滞在・確認済み・非表示)と判定・根拠
- POST  /visits/assess             : 本人の位置の軌跡(暗号化してサーバーへ保存したもの)と証拠(写真・予約・手動の記録)から判定する
- POST  /visits/device-results     : 端末だけに座標を置くモードの判定。端末が計算した数値(座標を含まない)を受け取り、
                                     同じ規則で判定する
- PATCH /visits/{event_id}         : 訂正(confirm=行った / pass_through=通過だった / reject=行っていない / hide / unhide /
                                     reset=自動の判定に戻す)。既存の判定を変える時は If-Match: 判定の revision

自動の判定は確定しない(LIKELY_VISIT)。予定・実績(event_actuals)は変えない(不変条件4)。本人が直した状態は、判定を
やり直しても上書きしない(auto_state に最新の自動の判定を残し、画面で差を示す)。
他の人の軌跡・判定は使わない・見せない。監査に予定名・座標を残さない。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload
from app.core.database import get_db
from app.services import member_policy
from app.models.models import (
    EventActual, EventReservation, LocationPointBatch, LocationTrack, Memory, TravelDay, TravelEvent, TravelPlan, User,
    VisitAssessment,
)
from app.services import location_tracks as lt
from app.services import visit_assessment as va
from app.services.audit_service import record_audit_event

# [Gate G2] FR-045 所有者が「event_address」のどれかを隠した参加者には、この機能の API は 403
require_plan_access = member_policy.guarded("event_address")

router = APIRouter(prefix="/plans", tags=["visits"])

MAX_DEVICE_RESULTS = 500


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _audit(action: str, user: User, plan: TravelPlan, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="visit_assessment", user_id=user.id, resource_id=plan.id,
                       details={"plan_id": str(plan.id), **details})


def _own_points(db: Session, plan: TravelPlan, user: User) -> List[Dict[str, Any]]:
    """本人の、サーバーへ保存した軌跡の点 {t, lat, lng, acc}。復号できなければ空(判定が出ないだけ)。"""
    track_ids = [t[0] for t in db.query(LocationTrack.id).filter(
        LocationTrack.plan_id == plan.id, LocationTrack.user_id == user.id, LocationTrack.mode == "synced").all()]
    out: List[Dict[str, Any]] = []
    if not track_ids:
        return out
    try:
        for b in db.query(LocationPointBatch).filter(LocationPointBatch.track_id.in_(track_ids)).all():
            out.extend(lt.decode(decrypt_payload(b.points_ciphertext)))
    except EncryptionNotConfigured:
        return []
    return out


def _located_events(db: Session, plan: TravelPlan):
    days = {d.id: d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()}
    events = [e for e in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all() if e.day_id in days]

    def key(e: TravelEvent):
        d = days[e.day_id]
        return (d.local_date, d.sort_order or 0, e.local_start_time or "99:99", e.sort_order or 0, str(e.id))

    events.sort(key=key)
    located = [e for e in events if e.latitude is not None and e.longitude is not None]
    return days, located, len(events) - len(located)


def _evidence(db: Session, plan: TravelPlan, user: User, events: List[TravelEvent]) -> Dict[uuid.UUID, Dict[str, bool]]:
    ids = [e.id for e in events]
    out: Dict[uuid.UUID, Dict[str, bool]] = {e.id: {"photo": False, "reservation": False, "manual": False}
                                             for e in events}
    if not ids:
        return out
    by_id = {e.id: e for e in events}
    # 写真: 本人が撮った写真の記録のうち、予定に紐付けたもの・予定の場所の半径の中で撮ったもの
    for mm in db.query(Memory).filter(Memory.plan_id == plan.id, Memory.author_user_id == user.id,
                                      Memory.kind == "photo").all():
        if mm.event_id in out:
            out[mm.event_id]["photo"] = True
        elif mm.latitude is not None and mm.longitude is not None:
            for e in events:
                if va._haversine_m(e.latitude, e.longitude, mm.latitude, mm.longitude) <= va.radius_for(e.event_type):
                    out[e.id]["photo"] = True
    # 予約(チケット・予約確認): 予定に紐付けた予約
    for (eid,) in db.query(EventReservation.event_id).filter(EventReservation.event_id.in_(ids)).all():
        if eid in by_id:
            out[eid]["reservation"] = True
    # 手動の記録: 振り返り(P14)で「行った」と記録した実績(旅行の共有データ)
    for a in db.query(EventActual).filter(EventActual.plan_id == plan.id, EventActual.event_id.in_(ids)).all():
        if a.status == "visited":
            out[a.event_id]["manual"] = True
    return out


def _assessment_dict(r: Optional[VisitAssessment]) -> Optional[Dict[str, Any]]:
    if r is None:
        return None
    reasons = r.reasons or {}
    return {
        "state": r.state, "auto_state": r.auto_state, "confidence": r.confidence,
        "level": va.level_of(r.confidence), "reasons": reasons, "algorithm_version": r.algorithm_version,
        "source": r.source, "hidden": bool(r.hidden), "assessed_at": _iso(r.assessed_at),
        "corrected_at": _iso(r.corrected_at), "revision": r.revision,
        "needs_confirmation": va.needs_confirmation(r.state, r.source, r.confidence),
        # 本人が直した状態と、最新の自動の判定が違う時に画面で示す
        "differs_from_auto": r.source == "user" and r.auto_state is not None and r.auto_state != r.state,
    }


def _rows(db: Session, plan: TravelPlan, user: User) -> Dict[uuid.UUID, VisitAssessment]:
    return {r.event_id: r for r in db.query(VisitAssessment).filter(
        VisitAssessment.plan_id == plan.id, VisitAssessment.user_id == user.id).all()}


def _overview(db: Session, plan: TravelPlan, user: User) -> Dict[str, Any]:
    days, events, unlocated = _located_events(db, plan)
    rows = _rows(db, plan, user)
    items = []
    for e in events:
        r = rows.get(e.id)
        d = days[e.day_id]
        stayed = bool(r and (r.reasons or {}).get("stayed"))
        items.append({
            "event_id": str(e.id), "title": e.title, "event_type": e.event_type, "day_id": str(d.id),
            "date": d.local_date.isoformat(), "planned_time": e.local_start_time,
            # 予定の場所(旅行の共有データ)。本人の軌跡の座標は返さない
            "latitude": e.latitude, "longitude": e.longitude, "radius_m": va.radius_for(e.event_type),
            "layer_state": va.layer_state(r.state if r else None, bool(r and r.hidden), stayed),
            "assessment": _assessment_dict(r),
        })
    synced = db.query(LocationTrack.id).filter(LocationTrack.plan_id == plan.id, LocationTrack.user_id == user.id,
                                               LocationTrack.mode == "synced").count()
    local = db.query(LocationTrack.id).filter(LocationTrack.plan_id == plan.id, LocationTrack.user_id == user.id,
                                              LocationTrack.mode != "synced").count()
    return {
        "plan_id": str(plan.id), "title": plan.title, "items": items, "counts": va.counts(items),
        "events_without_location": unlocated,
        "needs_confirmation": sum(1 for i in items if i["assessment"] and i["assessment"]["needs_confirmation"]
                                  and not i["assessment"]["hidden"]),
        "tracks": {"synced": synced, "device": local}, "rules": va.rules(),
    }


def _apply_auto(db: Session, plan: TravelPlan, user: User, e: TravelEvent, row: Optional[VisitAssessment],
                result: Dict[str, Any], source: str, now: datetime) -> str:
    """自動の判定を書く。戻り値: created / changed / unchanged / skipped(行を作るほどの結果でない)"""
    result["reasons"]["auto_source"] = source
    if row is None:
        if result["state"] == "PLANNED_ONLY":
            return "skipped"
        db.add(VisitAssessment(plan_id=plan.id, event_id=e.id, user_id=user.id, state=result["state"],
                               auto_state=result["state"], confidence=result["confidence"],
                               reasons=result["reasons"], algorithm_version=result["algorithm_version"],
                               source=source, hidden=False, assessed_at=now, revision=1))
        return "created"
    before = (row.state, row.auto_state, row.confidence, row.reasons, row.algorithm_version)
    row.auto_state, row.confidence, row.reasons = result["state"], result["confidence"], result["reasons"]
    row.algorithm_version, row.assessed_at = result["algorithm_version"], now
    if row.source != "user":
        row.state, row.source = result["state"], source
    after = (row.state, row.auto_state, row.confidence, row.reasons, row.algorithm_version)
    if before == after:
        return "unchanged"
    row.revision += 1
    return "changed"


@router.get("/{plan_id}/visits")
def get_visits(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return _overview(db, plan, current_user)


@router.post("/{plan_id}/visits/assess")
def assess_visits(plan_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    _days, events, _unlocated = _located_events(db, plan)
    points = _own_points(db, plan, current_user)
    evidence = _evidence(db, plan, current_user, events)
    rows = _rows(db, plan, current_user)
    now = _now()
    tally = {"created": 0, "changed": 0, "unchanged": 0, "skipped": 0}
    for e in events:
        row = rows.get(e.id)
        # 端末の数値で判定した行は、サーバーに軌跡が無ければそのまま(端末の結果を消さない)
        if row is not None and row.source == "device" and not points:
            tally["unchanged"] += 1
            continue
        radius = va.radius_for(e.event_type)
        metrics = va.visit_metrics(e.latitude, e.longitude, radius, points)
        result = va.assess(metrics, radius, evidence[e.id])
        tally[_apply_auto(db, plan, current_user, e, row, result, "auto", now)] += 1
    db.commit()
    _audit("visit.assess", current_user, plan, {"events": len(events), "points": len(points),
                                                "created": tally["created"], "changed": tally["changed"]})
    return {**_overview(db, plan, current_user), "result": tally}


class DeviceResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: uuid.UUID
    metrics: Dict[str, Any]


class DeviceResults(BaseModel):
    model_config = ConfigDict(extra="forbid")
    results: List[DeviceResult] = Field(default_factory=list, max_length=MAX_DEVICE_RESULTS)


@router.post("/{plan_id}/visits/device-results")
def device_results(plan_id: str, body: DeviceResults, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    _days, events, _unlocated = _located_events(db, plan)
    by_id = {e.id: e for e in events}
    seen = set()
    cleaned = []
    for r in body.results:
        if r.event_id in seen:
            raise _bad("duplicate_event", "同じ予定が2回含まれています")
        seen.add(r.event_id)
        if r.event_id not in by_id:
            raise _bad("unknown_event", "この旅行の位置のある予定ではありません")
        m = va.clean_metrics(r.metrics)
        if m is None:
            raise _bad("invalid_metrics", "端末の判定の数値が不正です(座標は送れません)")
        cleaned.append((by_id[r.event_id], m))
    evidence = _evidence(db, plan, current_user, [e for e, _ in cleaned])
    rows = _rows(db, plan, current_user)
    now = _now()
    tally = {"created": 0, "changed": 0, "unchanged": 0, "skipped": 0}
    for e, m in cleaned:
        radius = va.radius_for(e.event_type)
        result = va.assess(m, radius, evidence[e.id])
        tally[_apply_auto(db, plan, current_user, e, rows.get(e.id), result, "device", now)] += 1
    db.commit()
    _audit("visit.device_results", current_user, plan, {"results": len(cleaned), "created": tally["created"],
                                                        "changed": tally["changed"]})
    return {**_overview(db, plan, current_user), "result": tally}


class Correction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str


@router.patch("/{plan_id}/visits/{event_id}")
def correct_visit(plan_id: str, event_id: str, body: Correction, db: Session = Depends(get_db),
                  if_match: Optional[str] = Header(None, alias="If-Match"),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if body.action not in va.USER_ACTIONS:
        raise _bad("invalid_field", "訂正の操作が不正です")
    try:
        eid = uuid.UUID(str(event_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="予定が見つかりません")
    ev = db.query(TravelEvent).filter(TravelEvent.id == eid, TravelEvent.plan_id == plan.id).first()
    if not ev or ev.latitude is None or ev.longitude is None:
        raise HTTPException(status_code=404, detail="位置のある予定が見つかりません")
    row = db.query(VisitAssessment).filter(VisitAssessment.plan_id == plan.id, VisitAssessment.event_id == ev.id,
                                           VisitAssessment.user_id == current_user.id).first()
    now = _now()
    before = (row.state, bool(row.hidden)) if row else (None, False)
    if row is None:
        if body.action in ("unhide", "reset"):
            raise _bad("no_assessment", "この予定にはまだ判定がありません", 404)
        state = va.ACTION_STATE.get(body.action, "PLANNED_ONLY")
        row = VisitAssessment(plan_id=plan.id, event_id=ev.id, user_id=current_user.id, state=state,
                              auto_state=None, confidence=None, reasons=None,
                              algorithm_version=va.ALGORITHM_VERSION,
                              source="user" if body.action in va.ACTION_STATE else "auto",
                              hidden=body.action == "hide", assessed_at=now,
                              corrected_at=now, revision=1)
        db.add(row)
    else:
        if if_match is None or not if_match.strip():
            raise HTTPException(status_code=400, detail="If-Matchヘッダーが必要です(判定のrevision)")
        try:
            expected = int(if_match.strip('"'))
        except ValueError:
            raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
        if expected != row.revision:
            raise _bad("revision_conflict", f"判定が別の画面で更新されています(現在のrevision: {row.revision})", 409)
        if body.action in va.ACTION_STATE:
            row.state, row.source = va.ACTION_STATE[body.action], "user"
        elif body.action == "hide":
            row.hidden = True
        elif body.action == "unhide":
            row.hidden = False
        elif body.action == "reset":
            if row.auto_state is None:
                # 自動の判定が無い(本人の訂正だけの)行は消す。隠していた時は「隠す」だけを残す
                if row.hidden:
                    row.state, row.source = "PLANNED_ONLY", "auto"
                else:
                    db.delete(row)
                    db.commit()
                    _audit("visit.correct", current_user, plan,
                           {"action": "reset", "from": before[0], "to": None, "hidden": before[1]})
                    return {"event_id": str(ev.id), "assessment": None,
                            "layer_state": va.layer_state(None, False, False)}
            else:
                row.state = row.auto_state
                row.source = (row.reasons or {}).get("auto_source", "auto")
        row.corrected_at = now
        row.revision += 1
    db.commit()
    db.refresh(row)
    _audit("visit.correct", current_user, plan,
           {"action": body.action, "from": before[0], "to": row.state, "hidden": bool(row.hidden)})
    return {"event_id": str(ev.id), "assessment": _assessment_dict(row),
            "layer_state": va.layer_state(row.state, bool(row.hidden), bool((row.reasons or {}).get("stayed")))}


def hidden_event_ids(db: Session, plan_id, user_id) -> set:
    """Atlas などで本人が除外する予定(隠した・行っていない)。"""
    return {r[0] for r in db.query(VisitAssessment.event_id).filter(
        VisitAssessment.plan_id == plan_id, VisitAssessment.user_id == user_id,
        (VisitAssessment.hidden.is_(True)) | (VisitAssessment.state == "REJECTED")).all()}


def hidden_only_event_ids(db: Session, plan_id, user_id) -> set:
    return {r[0] for r in db.query(VisitAssessment.event_id).filter(
        VisitAssessment.plan_id == plan_id, VisitAssessment.user_id == user_id,
        VisitAssessment.hidden.is_(True)).all()}


def invalidate_auto(db: Session, plan_id, user_id) -> int:
    """軌跡・点を消した時に、サーバーの軌跡から作った自動の判定を消す(削除の伝播)。本人の訂正は状態を残し、
    自動の判定の結果だけを消す。端末の数値で作った判定は端末の点が消えるまで残す。commit は呼び出し側。"""
    n = 0
    for r in db.query(VisitAssessment).filter(VisitAssessment.plan_id == plan_id,
                                              VisitAssessment.user_id == user_id).all():
        if r.source == "auto":
            if r.hidden:
                r.state, r.auto_state, r.confidence, r.reasons = "PLANNED_ONLY", None, None, None
                r.revision += 1
            else:
                db.delete(r)
            n += 1
        elif r.source == "user" and (r.reasons or {}).get("auto_source") == "auto":
            r.auto_state, r.confidence, r.reasons = None, None, None
            r.revision += 1
            n += 1
    return n
