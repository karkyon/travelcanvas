"""
[Gate G11] 予定ごとの営業時間の照合(docs/ux/G11_UIUX全範囲_実装仕様.md §2.3)。

- GET /plans/{plan_id}/hours-check?day_id= : その日の予定ごとの照合の結果(viewer 以上)。保存しない・予定を変えない

出典(営業時間を取った provider・取得日時)は場所の項目ごとの最新の出典(places._sources の opening_hours)。
"""
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import Place, TravelDay, User
from app.services import feasibility, hours_check
from app.services import movement as mv

router = APIRouter(prefix="/plans", tags=["hours-check"])


@router.get("/{plan_id}/hours-check")
def get_hours_check(plan_id: str, day_id: str = Query(...), db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    try:
        did = uuid.UUID(day_id)
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "invalid_field", "message": "日の ID の形式が不正です"})
    day = db.query(TravelDay).filter(TravelDay.id == did, TravelDay.plan_id == plan.id).first()
    if day is None:
        raise HTTPException(status_code=404, detail="日程が見つかりません")
    snap = feasibility.load_snapshot(db, plan)
    rules = mv.load_rules(db, plan)
    from app.api.v1.places import _sources

    place_ids = {e.place_id for e in snap.events if e.day.id == did and e.place_id}
    sources: Dict[Any, Optional[Dict[str, Any]]] = {}
    for place in db.query(Place).filter(Place.id.in_(place_ids)).all() if place_ids else []:
        sources[place.id] = _sources(db, place).get("opening_hours")
    return {
        "day_id": str(did), "local_date": day.local_date.isoformat(), "timezone_id": day.timezone_id or "UTC",
        "near_minutes": hours_check.NEAR_MINUTES, "stale_days": hours_check.STALE_DAYS,
        "events": hours_check.check_day(snap, did, rules, sources),
    }
