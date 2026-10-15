"""
[Gate P10] FR-030 外部状況(アラート)・FR-031 安全な再計画(DOC-04 SC-24、DOC-06 §13)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET   /alerts                       : アラートの一覧と、登録済み経路の遅延・運休の検出(viewer以上)
- POST  /alerts                       : アラートを登録する(editor以上)。情報源・取得時刻・確度を必ず持つ
- PATCH /alerts/{id}                  : 確度・メモの変更、解決・取り下げ(If-Match: アラートのrevision)
- POST  /alerts/{id}/replans          : アラートを起点に再計画案A/Bを作る(editor以上)。本案は変えない
- GET   /replans/{id}                 : 再計画案の詳細(案ごとの変わる予定・失う予定・守る予定・遅れ・費用・通知対象)
- POST  /replans/{id}/apply           : 選んだ案を本案へ1つの変更セット(source=replan)として適用する
                                        (If-Match: 本案のrevision)。案を作った後に本案が変わっていれば
                                        409 replan_stale(黙って上書きしない)。本案の「元に戻す」で取り消せる
- POST  /replans/{id}/reject          : 再計画案を採用しない(本案は変わらない)

承認前に共有旅程を変えない(FR-031)。適用時は操作した人以外のメンバーへ通知する(本文に予定名を含めない)。
監査には件数だけを記録する(予定名・メモは残さない)。
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.api.v1 import branches as branches_api
from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    ChangeSet, EventReservation, Expense, Notification, PlanAlert, PlanFinanceSettings, Replan, Reservation,
    RouteLeg, RouteOption, TravelDay, TravelEvent, TravelPlan, TravelSegment, User,
)
from app.services import branches as br
from app.services import replan as rp
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import member_user_ids
from app.services.readiness import member_names
from app.services.today_mode import aggregate_realtime_status

router = APIRouter(prefix="/plans", tags=["replans"])

MAX_ACTIVE_ALERTS = 50
FUTURE_TOLERANCE = timedelta(minutes=10)


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _uuid_or_none(value: Optional[str], label: str) -> Optional[uuid.UUID]:
    if value is None:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{label}の形式が不正です")


# ===== スキーマ =====

class AlertCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    event_id: Optional[str] = None
    day_id: Optional[str] = None
    delay_minutes: Optional[int] = None
    source: str = "user_report"
    source_label: Optional[str] = Field(None, max_length=100)
    confidence: str = "reported"
    observed_at: Optional[datetime] = None
    note: Optional[str] = Field(None, max_length=500)

    @field_validator("kind")
    @classmethod
    def _v_kind(cls, v):
        if v not in rp.ALERT_KINDS:
            raise ValueError(f"kind must be one of {list(rp.ALERT_KINDS)}")
        return v

    @field_validator("source")
    @classmethod
    def _v_source(cls, v):
        if v not in rp.ALERT_SOURCES:
            raise ValueError(f"source must be one of {list(rp.ALERT_SOURCES)}")
        return v

    @field_validator("confidence")
    @classmethod
    def _v_confidence(cls, v):
        if v not in rp.CONFIDENCE_LEVELS:
            raise ValueError(f"confidence must be one of {list(rp.CONFIDENCE_LEVELS)}")
        return v

    @field_validator("source_label", "note")
    @classmethod
    def _v_strip(cls, v):
        if v is None:
            return None
        v = v.strip()
        return v or None


class AlertUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confidence: Optional[str] = None
    note: Optional[str] = Field(None, max_length=500)
    status: Optional[str] = None

    @field_validator("confidence")
    @classmethod
    def _v_confidence(cls, v):
        if v is not None and v not in rp.CONFIDENCE_LEVELS:
            raise ValueError(f"confidence must be one of {list(rp.CONFIDENCE_LEVELS)}")
        return v

    @field_validator("status")
    @classmethod
    def _v_status(cls, v):
        if v is not None and v not in rp.ALERT_STATUSES:
            raise ValueError(f"status must be one of {list(rp.ALERT_STATUSES)}")
        return v


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate: str

    @field_validator("candidate")
    @classmethod
    def _v_candidate(cls, v):
        if v not in ("A", "B"):
            raise ValueError("candidateはAかBです")
        return v


# ===== 共通 =====

def _audit(action: str, request: Request, user: User, resource_type: str, resource_id, plan_id,
           details: Dict[str, Any]) -> None:
    record_audit_event(
        action=action, resource_type=resource_type, user_id=user.id, resource_id=resource_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        # 予定名・メモ・情報源の文言は記録しない
        details={"plan_id": str(plan_id), **details},
    )


def _require_rev_if_match(revision: int, if_match: Optional[str], label: str) -> None:
    if if_match is None or not if_match.strip():
        raise HTTPException(status_code=400, detail=f"If-Matchヘッダーが必要です({label}のrevision)")
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
    if expected != revision:
        raise HTTPException(status_code=409, detail=f"{label}が他の変更で更新されています(現在のrevision: {revision})")


def _reservation_event_ids(db: Session, event_ids: List[uuid.UUID]) -> set:
    if not event_ids:
        return set()
    ids = {r[0] for r in db.query(Reservation.event_id).filter(Reservation.event_id.in_(event_ids)).all()}
    ids |= {r[0] for r in db.query(EventReservation.event_id).filter(EventReservation.event_id.in_(event_ids)).all()}
    return {str(i) for i in ids if i is not None}


def _snapshot(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    """本案の予定に、守る予定(確定・予約付き)と外せない予定(紐付きあり)の印を付けたもの。"""
    base = branches_api._snapshot(db, plan)
    ids = [uuid.UUID(e["source_event_id"]) for e in base["events"]]
    related = branches_api._related_event_ids(db, ids)
    reserved = _reservation_event_ids(db, ids)
    for e in base["events"]:
        has_reservation = e["source_event_id"] in reserved
        e["has_reservation"] = has_reservation
        e["fixed"] = bool(e["locked"] or has_reservation)
        e["related"] = e["source_event_id"] in related
    return base


def _alert_or_404(db: Session, plan: TravelPlan, alert_id: str) -> PlanAlert:
    aid = _uuid_or_none(alert_id, "アラートID")
    a = db.query(PlanAlert).filter(PlanAlert.id == aid, PlanAlert.plan_id == plan.id).first()
    if a is None:
        raise HTTPException(status_code=404, detail="アラートが見つかりません")
    return a


def _replan_or_404(db: Session, plan: TravelPlan, replan_id: str) -> Replan:
    try:
        rid = uuid.UUID(str(replan_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="再計画案が見つかりません")
    r = db.query(Replan).filter(Replan.id == rid, Replan.plan_id == plan.id).first()
    if r is None:
        raise HTTPException(status_code=404, detail="再計画案が見つかりません")
    return r


def _alert_response(db: Session, plan: TravelPlan, a: PlanAlert, names: Dict, now: datetime,
                    events: Dict[str, TravelEvent], days: Dict[str, TravelDay]) -> Dict[str, Any]:
    ev = events.get(str(a.event_id)) if a.event_id else None
    day = days.get(str(ev.day_id)) if ev is not None else (days.get(str(a.day_id)) if a.day_id else None)
    latest = (db.query(Replan).filter(Replan.alert_id == a.id).order_by(Replan.created_at.desc()).first())
    return {
        "id": str(a.id), "plan_id": str(a.plan_id), "kind": a.kind, "kind_label": rp.KIND_LABELS[a.kind],
        "source": a.source, "source_label": a.source_label, "confidence": a.confidence,
        "observed_at": _iso(a.observed_at), "is_stale": rp.is_stale(a.observed_at, now),
        "event_id": str(a.event_id) if a.event_id else None,
        "event_title": ev.title if ev is not None else None,
        "event_local_start_time": ev.local_start_time if ev is not None else None,
        "event_missing": a.event_id is not None and ev is None,
        "day_id": str(day.id) if day is not None else (str(a.day_id) if a.day_id else None),
        "local_date": day.local_date.isoformat() if day is not None else None,
        "delay_minutes": a.delay_minutes, "note": a.note, "status": a.status,
        "resolved_at": _iso(a.resolved_at),
        "created_by_name": names.get(a.created_by_user_id, "メンバー外"),
        "latest_replan_id": str(latest.id) if latest is not None else None,
        "latest_replan_status": latest.status if latest is not None else None,
        "revision": a.revision, "created_at": _iso(a.created_at), "updated_at": _iso(a.updated_at),
    }


def _plan_maps(db: Session, plan: TravelPlan):
    events = {str(e.id): e for e in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()}
    days = {str(d.id): d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()}
    return events, days


def _detected(db: Session, plan: TravelPlan, events: Dict[str, TravelEvent], days: Dict[str, TravelDay],
              active_event_ids: set, now: datetime) -> List[Dict[str, Any]]:
    """登録済み経路(採用した経路候補の区間)の運行状態が遅延・運休の予定。まだアラートにしていないものだけ。"""
    segments = (db.query(TravelSegment)
                .filter(TravelSegment.plan_id == plan.id, TravelSegment.route_option_id.isnot(None),
                        TravelSegment.to_event_id.isnot(None), TravelSegment.status != "cancelled").all())
    out = []
    seen = set()
    for seg in segments:
        eid = str(seg.to_event_id)
        if eid in seen or eid in active_event_ids or eid not in events:
            continue
        legs = db.query(RouteLeg).filter(RouteLeg.route_option_id == seg.route_option_id).all()
        status = aggregate_realtime_status([leg.realtime_status for leg in legs])
        if status not in ("delayed", "cancelled"):
            continue
        option = db.query(RouteOption).filter(RouteOption.id == seg.route_option_id).first()
        ev = events[eid]
        day = days.get(str(ev.day_id))
        observed = option.updated_at or option.retrieved_at if option is not None else None
        seen.add(eid)
        out.append({
            "event_id": eid, "event_title": ev.title, "event_local_start_time": ev.local_start_time,
            "day_id": str(ev.day_id), "local_date": day.local_date.isoformat() if day else None,
            "transport_status": status, "suggested_kind": "cancellation" if status == "cancelled" else "delay",
            "observed_at": _iso(observed), "is_stale": rp.is_stale(observed, now),
        })
    return out


def _cost_impact(db: Session, plan: TravelPlan, lost_ids: List[str]) -> Dict[str, Any]:
    """外す予定に紐付く支払い済みの費用(返金されない可能性がある額)。基準通貨に換算できない分は件数だけ数える。"""
    settings = db.query(PlanFinanceSettings).filter(PlanFinanceSettings.plan_id == plan.id).first()
    currency = settings.base_currency if settings is not None else "JPY"
    if not lost_ids:
        return {"currency": currency, "lost_paid_amount": "0.00", "lost_paid_count": 0, "unconverted_count": 0}
    rows = (db.query(Expense)
            .filter(Expense.plan_id == plan.id, Expense.deleted_at.is_(None), Expense.kind == "expense",
                    Expense.related_type == "event", Expense.related_id.in_([uuid.UUID(i) for i in lost_ids]))
            .all())
    total = Decimal("0")
    unconverted = 0
    for x in rows:
        if x.currency == currency:
            total += x.amount
        elif x.base_amount is not None:
            total += x.base_amount
        else:
            unconverted += 1
    return {"currency": currency, "lost_paid_amount": f"{total:.2f}", "lost_paid_count": len(rows),
            "unconverted_count": unconverted}


def _replan_state(db: Session, r: Replan) -> str:
    if r.status == "applied" and r.applied_change_set_id:
        cs = db.query(ChangeSet).filter(ChangeSet.id == r.applied_change_set_id).first()
        if cs is not None and cs.undone_at is not None:
            return "applied_undone"
    return r.status


def _replan_response(db: Session, plan: TravelPlan, r: Replan, user: User, role: str) -> Dict[str, Any]:
    alert = db.query(PlanAlert).filter(PlanAlert.id == r.alert_id).first()
    members = member_user_ids(db, plan)
    extra = {r.created_by_user_id} | ({r.applied_by_user_id} if r.applied_by_user_id else set())
    names = member_names(db, members | extra)
    notify = sorted(names.get(uid, "ゲスト") for uid in members if uid != user.id)
    affected_days = sorted({e["day_id"] for e in r.base_snapshot["events"]
                            if alert is not None and (str(alert.event_id) == e["source_event_id"])}
                           | ({str(alert.day_id)} if alert is not None and alert.day_id else set()))
    candidates = []
    for c in r.candidates:
        if c.get("available"):
            ev = rp.evaluate(r.base_snapshot, c, affected_days or [d["id"] for d in r.base_snapshot["days"]])
            cost = _cost_impact(db, plan, [x["event_id"] for x in ev["lost"]])
        else:
            ev = {"changes": [], "lost": [], "protected": [], "metrics": {
                "changed_count": 0, "lost_count": 0, "protected_count": 0, "max_delay_minutes": 0,
                "day_end_shift_minutes": None}}
            cost = None
        candidates.append({
            "id": c["id"], "strategy": c["strategy"], "label": c["label"], "description": c["description"],
            "available": c["available"], "unavailable_reason": c.get("unavailable_reason"),
            "warnings": c.get("warnings", []), "changes": ev["changes"], "lost": ev["lost"],
            "protected": ev["protected"], "metrics": ev["metrics"], "cost_impact": cost,
            "notify_member_names": notify,
        })
    state = _replan_state(db, r)
    return {
        "id": str(r.id), "plan_id": str(r.plan_id), "alert_id": str(r.alert_id),
        "algorithm_version": rp.ALGORITHM_VERSION,
        "base_revision": r.base_revision, "plan_revision": plan.revision,
        "is_stale": r.status == "proposed" and plan.revision != r.base_revision,
        "status": r.status, "state": state, "applied_candidate": r.applied_candidate,
        "applied_at": _iso(r.applied_at),
        "applied_by_name": names.get(r.applied_by_user_id) if r.applied_by_user_id else None,
        "created_by_name": names.get(r.created_by_user_id, "メンバー外"),
        "can_apply": role in ("owner", "editor") and r.status == "proposed" and plan.revision == r.base_revision,
        "candidates": candidates,
        "revision": r.revision, "created_at": _iso(r.created_at),
    }


# ===== エンドポイント: アラート =====

@router.get("/{plan_id}/alerts", response_model=dict)
def list_alerts(plan_id: str, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    now = _now()
    rows = (db.query(PlanAlert).filter(PlanAlert.plan_id == plan.id)
            .order_by(PlanAlert.status.asc(), PlanAlert.observed_at.desc()).limit(200).all())
    names = member_names(db, {a.created_by_user_id for a in rows})
    events, days = _plan_maps(db, plan)
    active_event_ids = {str(a.event_id) for a in rows if a.status == "active" and a.event_id}
    alerts = [_alert_response(db, plan, a, names, now, events, days) for a in rows]
    # 対応中を新しい順に先へ、解決・取り下げ済みはその後(更新の新しい順)
    active = sorted((a for a in alerts if a["status"] == "active"), key=lambda x: x["observed_at"] or "",
                    reverse=True)
    others = sorted((a for a in alerts if a["status"] != "active"),
                    key=lambda x: x["resolved_at"] or x["updated_at"] or "", reverse=True)
    return {
        "plan_id": str(plan.id), "server_time": _iso(now), "can_edit": role in ("owner", "editor"),
        "alerts": active + others,
        "detected": _detected(db, plan, events, days, active_event_ids, now),
    }


@router.post("/{plan_id}/alerts", status_code=201, response_model=dict)
def create_alert(plan_id: str, payload: AlertCreate, request: Request, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    now = _now()
    observed = payload.observed_at or now
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=dt_timezone.utc)
    if observed > now + FUTURE_TOLERANCE:
        raise HTTPException(status_code=422, detail="取得時刻に未来の時刻は指定できません")
    active = db.query(PlanAlert).filter(PlanAlert.plan_id == plan.id, PlanAlert.status == "active").count()
    if active >= MAX_ACTIVE_ALERTS:
        raise HTTPException(status_code=409, detail=f"対応中のアラートは{MAX_ACTIVE_ALERTS}件までです")
    base = _snapshot(db, plan)
    try:
        event_id, day_id = rp.validate_alert(payload.kind, payload.event_id, payload.day_id, payload.delay_minutes,
                                             base)
    except rp.ReplanError as e:
        raise HTTPException(status_code=422, detail=str(e))
    a = PlanAlert(
        id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id, kind=payload.kind,
        source=payload.source, source_label=payload.source_label, confidence=payload.confidence,
        observed_at=observed, event_id=uuid.UUID(event_id) if event_id else None,
        day_id=uuid.UUID(day_id) if day_id else None, delay_minutes=payload.delay_minutes,
        note=payload.note, status="active",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    _audit("alert_created", request, current_user, "plan_alert", a.id, plan.id,
           {"kind": a.kind, "source": a.source, "confidence": a.confidence})
    events, days = _plan_maps(db, plan)
    return _alert_response(db, plan, a, member_names(db, {a.created_by_user_id}), now, events, days)


@router.patch("/{plan_id}/alerts/{alert_id}", response_model=dict)
def update_alert(plan_id: str, alert_id: str, payload: AlertUpdate, request: Request,
                 db: Session = Depends(get_db), if_match: Optional[str] = Header(None, alias="If-Match"),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    a = _alert_or_404(db, plan, alert_id)
    _require_rev_if_match(a.revision, if_match, "アラート")
    data = payload.model_dump(exclude_unset=True)
    if "confidence" in data and data["confidence"] is not None:
        a.confidence = data["confidence"]
    if "note" in data:
        a.note = (data["note"] or "").strip() or None
    if "status" in data and data["status"] is not None and data["status"] != a.status:
        a.status = data["status"]
        a.resolved_at = None if a.status == "active" else _now()
        _audit(f"alert_{a.status}", request, current_user, "plan_alert", a.id, plan.id, {})
    a.revision += 1
    db.commit()
    db.refresh(a)
    events, days = _plan_maps(db, plan)
    return _alert_response(db, plan, a, member_names(db, {a.created_by_user_id}), _now(), events, days)


# ===== エンドポイント: 再計画 =====

@router.post("/{plan_id}/alerts/{alert_id}/replans", status_code=201, response_model=dict)
def create_replan(plan_id: str, alert_id: str, request: Request, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    a = _alert_or_404(db, plan, alert_id)
    if a.status != "active":
        raise HTTPException(status_code=409, detail="解決・取り下げたアラートからは再計画できません")
    base = _snapshot(db, plan)
    event_id = str(a.event_id) if a.event_id else None
    try:
        event_id, day_id = rp.validate_alert(a.kind, event_id, str(a.day_id) if a.day_id else None,
                                             a.delay_minutes, base)
    except rp.ReplanError as e:
        # 影響を受ける予定が削除・時刻なしになった等。再計画できない理由を示す
        raise HTTPException(status_code=409, detail={"code": "alert_target_changed", "message": str(e)})
    alert = {"kind": a.kind, "event_id": event_id, "day_id": day_id, "delay_minutes": a.delay_minutes}
    candidates = rp.generate_candidates(alert, base)
    r = Replan(id=uuid.uuid4(), plan_id=plan.id, alert_id=a.id, created_by_user_id=current_user.id,
               base_revision=plan.revision, base_snapshot=base, candidates=candidates, status="proposed")
    db.add(r)
    db.commit()
    db.refresh(r)
    _audit("replan_created", request, current_user, "replan", r.id, plan.id,
           {"kind": a.kind, "available": sum(1 for c in candidates if c["available"])})
    return _replan_response(db, plan, r, current_user, role)


@router.get("/{plan_id}/replans/{replan_id}", response_model=dict)
def get_replan(plan_id: str, replan_id: str, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    r = _replan_or_404(db, plan, replan_id)
    return _replan_response(db, plan, r, current_user, role)


@router.post("/{plan_id}/replans/{replan_id}/apply", response_model=dict)
def apply_replan(plan_id: str, replan_id: str, payload: ApplyRequest, request: Request,
                 db: Session = Depends(get_db), if_match: Optional[str] = Header(None, alias="If-Match"),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _replan_or_404(db, plan, replan_id)
    plans_api._require_if_match(plan, if_match)
    if r.status != "proposed":
        raise HTTPException(status_code=409, detail={"code": "replan_closed",
                                                     "message": "適用・却下した再計画案は適用できません"})
    if plan.revision != r.base_revision:
        raise HTTPException(status_code=409, detail={
            "code": "replan_stale",
            "message": "再計画案を作った後に旅程が変わりました。もう一度再計画案を作ってください",
            "current_revision": plan.revision,
        })
    candidate = next((c for c in r.candidates if c["id"] == payload.candidate), None)
    if candidate is None or not candidate.get("available"):
        raise HTTPException(status_code=409, detail={"code": "candidate_unavailable",
                                                     "message": "この案は使えません"})
    ops = br.compute_ops(r.base_snapshot, candidate["content"])
    if not ops:
        raise HTTPException(status_code=409, detail={"code": "no_changes", "message": "この案では旅程は変わりません"})
    # 案を作った後に、予定へ予約などの紐付けが加わっていれば(revisionが変わらない変更)外さない
    current = {str(e.id): br.event_item(e) for e in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id)}
    day_ids = {str(d.id) for d in db.query(TravelDay.id).filter(TravelDay.plan_id == plan.id).all()}
    removal_ids = [uuid.UUID(o["event_id"]) for o in ops if o["op"] == "remove"]
    conflicts = br.find_conflicts(ops, r.base_snapshot, current, day_ids,
                                  branches_api._related_event_ids(db, removal_ids))
    reserved_now = _reservation_event_ids(db, [uuid.UUID(o["event_id"]) for o in ops if o.get("event_id")])
    conflicts += [{"op": o["op"], "event_id": o["event_id"], "title": o["title"], "reason": "has_reservation"}
                  for o in ops if o.get("event_id") in reserved_now]
    if conflicts:
        raise HTTPException(status_code=409, detail={
            "code": "replan_conflict",
            "message": "旅程と食い違う変更があるため適用できません。もう一度再計画案を作ってください",
            "conflicts": conflicts,
        })
    changes = branches_api.apply_ops(db, plan, ops)
    new_revision = plans_api._record_batch_change_and_bump_revision(db, plan, current_user, "replan", changes)
    cs = db.query(ChangeSet).filter(ChangeSet.plan_id == plan.id,
                                    ChangeSet.resulting_revision == new_revision).first()
    r.status = "applied"
    r.applied_candidate = payload.candidate
    r.applied_at = _now()
    r.applied_by_user_id = current_user.id
    r.applied_change_set_id = cs.id if cs else None
    r.revision += 1
    alert = db.query(PlanAlert).filter(PlanAlert.id == r.alert_id).first()
    if alert is not None and alert.status == "active":
        alert.status = "resolved"
        alert.resolved_at = _now()
        alert.revision += 1
    summary = br.summarize(ops)
    # 共同者へ差分を通知する(DOC-04 SC-24)。本文に予定名は含めない
    for uid in member_user_ids(db, plan):
        if uid == current_user.id:
            continue
        db.add(Notification(
            id=uuid.uuid4(), user_id=uid, type="replan_applied", title="旅程が再計画で変更されました",
            message=f"再計画により予定が変わりました(変更{summary['updated']}件・外した予定{summary['removed']}件)。"
                    "プランの変更内容を確認してください",
            related_plan_id=plan.id,
        ))
    db.commit()
    db.refresh(r)
    _audit("replan_applied", request, current_user, "replan", r.id, plan.id,
           {"candidate": payload.candidate, "plan_revision": new_revision, **summary})
    return {"replan": _replan_response(db, plan, r, current_user, role), "plan_revision": new_revision}


@router.post("/{plan_id}/replans/{replan_id}/reject", response_model=dict)
def reject_replan(plan_id: str, replan_id: str, request: Request, db: Session = Depends(get_db),
                  if_match: Optional[str] = Header(None, alias="If-Match"),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    r = _replan_or_404(db, plan, replan_id)
    _require_rev_if_match(r.revision, if_match, "再計画案")
    if r.status != "proposed":
        raise HTTPException(status_code=409, detail={"code": "replan_closed",
                                                     "message": "適用・却下した再計画案は変更できません"})
    r.status = "rejected"
    r.revision += 1
    db.commit()
    db.refresh(r)
    _audit("replan_rejected", request, current_user, "replan", r.id, plan.id, {})
    return _replan_response(db, plan, r, current_user, role)
