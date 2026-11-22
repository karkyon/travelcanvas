"""[FR-061] 日帰りモード(詳細設計 DD-2026-11-22-01 §4.7)。

| POST /plans/{plan_id}/day-trip/route   | editor | 行き・帰りを計算して保存 |
| GET  /plans/{plan_id}/day-trip         | viewer | 保存した行き・帰り・設定 |
| POST /plans/{plan_id}/day-trip/compare | viewer | 道の使い方 2 つの比べ(保存しない) |
| GET  /plans/{plan_id}/day-trip/along   | viewer | ルートの近くの寄り道の候補(保存しない。10 分だけサーバーに置く) |

出発地は小数 2 桁に丸めて受ける(今いる場所そのものは保存しない)。幅は 300/1000/3000/5000 だけ。
"""
import re
import uuid
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import User
from app.services import day_trip as dt
from app.services import free_usage
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/plans", tags=["day-trip"])
HHMM = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class PlaceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(..., min_length=1, max_length=200)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    spot_id: Optional[uuid.UUID] = None


class DestIn(PlaceIn):
    lat: Optional[float] = Field(None, ge=-90, le=90)  # type: ignore[assignment]
    lng: Optional[float] = Field(None, ge=-180, le=180)  # type: ignore[assignment]


class RouteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: PlaceIn
    destination: DestIn
    road: Literal["highway", "local", "avoid_tolls", "auto"] = "auto"
    depart_at: str = "09:00"
    home_by: Optional[str] = None

    @field_validator("depart_at", "home_by")
    @classmethod
    def _hhmm(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if not HHMM.match(v):
            raise ValueError("時刻は HH:MM で入れてください")
        return v


class CompareIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    roads: List[Literal["highway", "local", "avoid_tolls", "auto"]] = Field(..., min_length=2, max_length=2)


def _error(e: dt.DayTripError) -> JSONResponse:
    return JSONResponse(status_code=e.status, content={"detail": {"code": e.code, "message": e.message}})


def _limit(user: User, name: str, n: int) -> None:
    if not check_rate_limit(f"day_trip_{name}:{user.id}", n, 60):
        raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "続けて探しすぎました。1 分ほど待ってください"})


def _cost_error(exc: Exception) -> Optional[JSONResponse]:
    from app.services import cost_guard as cg

    if isinstance(exc, cg.CostGuardError):
        return JSONResponse(status_code=exc.status, content={"detail": {"code": exc.code, "message": exc.message}})
    return None


@router.post("/{plan_id}/day-trip/route")
async def compute_route(plan_id: str, body: RouteIn, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user_or_guest),
                        idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")) -> Any:
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _limit(current_user, "route", 10)
    try:
        return await dt.compute_route(db, plan, current_user, body.model_dump(mode="python"),
                                      (idempotency_key or uuid.uuid4().hex)[:64])
    except dt.DayTripError as e:
        return _error(e)
    except Exception as exc:  # noqa: BLE001 - 利用枠の断りは今の分類で返す
        res = _cost_error(exc)
        if res is None:
            raise
        return res


@router.get("/{plan_id}/day-trip")
def get_day_trip(plan_id: str, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return dt.get_view(db, plan)


@router.post("/{plan_id}/day-trip/compare")
async def compare(plan_id: str, body: CompareIn, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest),
                  idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")) -> Any:
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    _limit(current_user, "compare", 10)
    try:
        return await dt.compare(db, plan, current_user, list(body.roads), (idempotency_key or uuid.uuid4().hex)[:64])
    except dt.DayTripError as e:
        return _error(e)
    except Exception as exc:  # noqa: BLE001
        res = _cost_error(exc)
        if res is None:
            raise
        return res


@router.get("/{plan_id}/day-trip/along")
async def along(plan_id: str, leg: Literal["out", "back"] = "out", genres: str = Query("", max_length=200),
                width_m: int = 1000, order: Literal["personal", "route", "detour"] = "personal",
                db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)) -> Any:
    if width_m not in dt.WIDTHS_M:
        raise HTTPException(status_code=422, detail={"code": "invalid_field",
                                                     "message": "幅は 300・1000・3000・5000 のどれかです"})
    picked = [g.strip() for g in genres.split(",") if g.strip()][:8]
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    _limit(current_user, "along", 20)
    from app.services import place_lookup as pl

    def record(provider: str, code: str) -> None:
        free_usage.record(db, current_user, pl.USAGE.get(provider, provider), "day_trip.along", result_code=code)

    try:
        return await dt.along(db, plan, current_user, leg, picked, width_m, order, record)
    except dt.DayTripError as e:
        return _error(e)
