"""
[Gate P8] FR-036 カレンダー(ICS)の取込。「外部更新の取込は差分確認後に適用する」。DOC-04 SC-27。

エンドポイント(すべて /plans/{plan_id}/calendar-import 配下、editor以上):
- POST /preview : ICSファイル(multipart、1MB・500件まで)を解析し、本案と照らした取り込み案を返す(DBは変えない)。
                  追加・変更(変更前後の値)・取り込まない予定と理由(繰り返し・取消済み・変更なし・確定済み・
                  重複・日程なし)。TravelCanvasが書き出したICSの予定は、同じ予定の変更として扱う。
- POST /apply   : 利用者が確認・選択した取り込み案を本案へ適用する(If-Match: 本案のrevision)。
                  1つの変更セット(source=import)で記録し、本案の「元に戻す」で全て戻る。

取り込むのは予定名・日付・開始時刻・終日・場所(住所欄)だけ。ファイルの内容・予定名は監査に記録しない(件数のみ)。
"""
import uuid
from datetime import date as date_cls
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.api.v1 import plans as plans_api
from app.api.v1.branches import _apply_time
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.services import member_policy
from app.models.models import TravelDay, TravelEvent, TravelPlan, User
from app.services import calendar_import as ci
from app.services.audit_service import record_audit_event

# [Gate G2] FR-045 所有者が「event_address・event_notes」のどれかを隠した参加者には、この機能の API は 403
require_plan_access = member_policy.guarded("event_address", "event_notes")

router = APIRouter(prefix="/plans", tags=["calendar-import"])
MAX_APPLY = 500


def _audit(action: str, request: Request, user: User, plan: TravelPlan, details: dict) -> None:
    record_audit_event(
        action=action, resource_type="travel_plan", user_id=user.id, resource_id=plan.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        details={"plan_id": str(plan.id), **details},
    )


def _plan_tz(days: List[TravelDay]) -> str:
    return days[0].timezone_id if days else "UTC"


def _current(db: Session, plan: TravelPlan, days: List[TravelDay]) -> Dict[str, dict]:
    by_day = {d.id: d for d in days}
    out = {}
    for e in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all():
        d = by_day.get(e.day_id)
        if d is None:
            continue
        out[str(e.id)] = {"title": e.title, "local_date": d.local_date.isoformat(),
                          "local_start_time": e.local_start_time, "is_all_day": bool(e.is_all_day),
                          "address": e.address, "locked": bool(e.locked)}
    return out


def _days(db: Session, plan: TravelPlan) -> List[TravelDay]:
    return db.query(TravelDay).filter(TravelDay.plan_id == plan.id).order_by(TravelDay.local_date).all()


@router.post("/{plan_id}/calendar-import/preview", response_model=dict)
async def preview(plan_id: str, request: Request, file: UploadFile = File(...),
                  create_missing_days: bool = Form(False), db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    data = await file.read(ci.MAX_BYTES + 1)
    try:
        events = ci.parse_ics(data)
    except ci.IcsError as e:
        raise HTTPException(status_code=422, detail=str(e))
    days = _days(db, plan)
    tz = _plan_tz(days)
    candidates = ci.plan_candidates(events, tz, {d.local_date.isoformat(): str(d.id) for d in days},
                                    _current(db, plan, days), create_missing_days)
    summary = ci.summarize(candidates)
    _audit("calendar_import_previewed", request, current_user, plan, {"summary": summary})
    return {"plan_id": str(plan.id), "plan_revision": plan.revision, "timezone_id": tz,
            "create_missing_days": create_missing_days, "summary": summary, "candidates": candidates}


class ApplyItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    action: str
    event_id: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=200)
    local_date: date_cls
    local_start_time: Optional[str] = None
    is_all_day: bool = False
    address: Optional[str] = Field(None, max_length=500)

    @field_validator("action")
    @classmethod
    def _v_action(cls, v):
        if v not in ("create", "update"):
            raise ValueError("actionはcreateかupdateです")
        return v

    @field_validator("local_start_time")
    @classmethod
    def _v_time(cls, v):
        if v is not None and not plans_api.today_mode.parse_local_time(v):
            raise ValueError("時刻はHH:MMで指定してください")
        return v

    @field_validator("title")
    @classmethod
    def _v_title(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("予定名を入力してください")
        return v


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: List[ApplyItem] = Field(..., min_length=1, max_length=MAX_APPLY)
    create_missing_days: bool = False


@router.post("/{plan_id}/calendar-import/apply", response_model=dict)
def apply(plan_id: str, payload: ApplyRequest, request: Request, db: Session = Depends(get_db),
          if_match: Optional[str] = Header(None, alias="If-Match"),
          current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    plans_api._require_if_match(plan, if_match)
    days = _days(db, plan)
    tz = _plan_tz(days)
    day_by_date = {d.local_date: d for d in days}
    changes = []
    created_days = created = updated = 0

    # 先に全件を検査する(一部だけ適用された状態を残さない)
    events: Dict[str, TravelEvent] = {}
    for i, it in enumerate(payload.items):
        if it.local_date not in day_by_date and not payload.create_missing_days:
            raise HTTPException(status_code=422, detail=f"{i + 1}件目: {it.local_date} の日程がありません")
        if it.action == "update":
            try:
                eid = uuid.UUID(it.event_id or "")
            except ValueError:
                raise HTTPException(status_code=422, detail=f"{i + 1}件目: 変更する予定が指定されていません")
            ev = db.query(TravelEvent).filter(TravelEvent.id == eid, TravelEvent.plan_id == plan.id).first()
            if ev is None:
                raise HTTPException(status_code=409, detail=f"{i + 1}件目: 変更する予定が本案にありません")
            if ev.locked:
                raise HTTPException(status_code=409, detail=f"{i + 1}件目: 確定済みの予定は取り込みで変更できません")
            events[it.event_id] = ev

    def day_for(d: date_cls) -> TravelDay:
        nonlocal created_days
        if d not in day_by_date:
            day = TravelDay(id=uuid.uuid4(), plan_id=plan.id, local_date=d, timezone_id=tz,
                            sort_order=len(day_by_date))
            db.add(day)
            db.flush()
            day_by_date[d] = day
            changes.append(("travel_day", day.id, "create", None, plans_api._day_to_dict(day)))
            created_days += 1
        return day_by_date[d]

    for it in payload.items:
        day = day_for(it.local_date)
        time = None if it.is_all_day else it.local_start_time
        if it.action == "create":
            ev = TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=day.id, title=it.title, event_type="activity",
                             local_start_time=time, is_all_day=it.is_all_day, address=it.address,
                             sort_order=1000 + created)
            db.add(ev)
            db.flush()
            changes.append(("travel_event", ev.id, "create", None, plans_api._event_to_dict(ev)))
            created += 1
        else:
            ev = events[it.event_id]
            before = plans_api._event_to_dict(ev)
            ev.title = it.title
            ev.day_id = day.id
            ev.is_all_day = it.is_all_day
            if it.address is not None:
                ev.address = it.address
            ev.local_start_time = time
            _apply_time(ev, day, time)
            db.flush()
            changes.append(("travel_event", ev.id, "update", before, plans_api._event_to_dict(ev)))
            updated += 1
    new_revision = plans_api._record_batch_change_and_bump_revision(db, plan, current_user, "import", changes)
    summary = {"created": created, "updated": updated, "created_days": created_days}
    _audit("calendar_import_applied", request, current_user, plan, {"plan_revision": new_revision, **summary})
    return {"plan_revision": new_revision, **summary}
