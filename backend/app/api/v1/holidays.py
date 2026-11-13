"""[Gate Remaining-2] FR-008 祝日の暦(自動の取得)。

- GET /holidays?country=JP&year=2026        : その国・年の祝日(日本は計算・通信しない。外は Nager.Date)
- GET /plans/{plan_id}/holidays              : 旅行の日ごとの祝日(その日の予定の場所の国。場所が無い日は日本とみなさない)

営業時間の例外(臨時休業・祝日)は今までどおり場所ごとに手で入れる。この API は「その日は祝日」と知らせるだけ。
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import TravelDay, TravelEvent, User
from app.services import holidays as hol
from app.services import reverse_geocode

router = APIRouter(tags=["holidays"])


@router.get("/holidays")
def list_holidays(country: str = Query(..., min_length=2, max_length=2),
                  year: Optional[int] = Query(None, ge=1900, le=2200),
                  current_user: User = Depends(get_current_user_or_guest)):
    year = year or datetime.now(timezone.utc).year
    cc = country.upper()
    if not cc.isalpha():
        raise HTTPException(status_code=422, detail={"code": "invalid_field", "message": "国は 2 文字の記号です"})
    items = [{"date": d.isoformat(), "name": n} for d, n in hol.holidays(cc, year).items()]
    return {"country": cc, "year": year, "holidays": items,
            "source": "国民の祝日に関する法律(計算)" if cc == "JP" else "Nager.Date"}


def _country_of(events: List[Any]) -> Optional[str]:
    for e in events:
        if e.latitude is None or e.longitude is None:
            continue
        lat, lng = float(e.latitude), float(e.longitude)
        place = reverse_geocode.reverse(lat, lng)
        if place:
            return place["country_code"]
        if reverse_geocode.in_japan_box(lat, lng):
            return "JP"
    return None


@router.get("/plans/{plan_id}/holidays")
def plan_holidays(plan_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).order_by(TravelDay.local_date).all()
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    by_day: Dict[str, List[Any]] = {}
    for e in events:
        by_day.setdefault(str(e.day_id), []).append(e)
    out = []
    seen = set()
    last_cc: Optional[str] = None
    for d in days:
        if d.local_date in seen:
            continue
        seen.add(d.local_date)
        cc = _country_of(by_day.get(str(d.id), [])) or last_cc
        last_cc = cc or last_cc
        name = hol.holidays(cc, d.local_date.year).get(d.local_date) if cc else None
        out.append({"day_id": str(d.id), "local_date": d.local_date.isoformat(), "country_code": cc,
                    "holiday": name})
    return {"plan_id": str(plan.id), "days": out}
