"""[FR-062] 今度行きたい・また行きたい(行きたい場所の種類・元・同じ場所のまとめ)。

- 行きたい場所は本人だけのもの(spots.created_by が本人の行)
- 同じ場所: 同じ本人・名前を正規化して同じ・位置が SAME_PLACE_M 以内(どちらかに位置が無ければ名前だけ)
  - 新しく作らず、種類と again_count を変える
- client_id: 端末が作る一意の ID。同じ client_id は 1 件にまとめる(二重送信・圏外の送り直し)
"""
from __future__ import annotations

import math
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import Spot, TravelPlan

SAME_PLACE_M = 100.0
NEARBY_RADIUS_M = 300.0
NEARBY_MAX = 8
WISH_KINDS = ("next", "again")
WISH_SCOPES = ("place", "area")
WISH_WHENS = ("next_trip", "someday")
SOURCE_KINDS = ("manual", "quick", "today", "memory", "visit", "route", "sns", "import")
KIND_FILTERS = ("next", "again", "area")

# 近くの候補の提供元の種類 → 行きたい場所の種類(spots.category)
_CATEGORY = {
    "restaurant": "restaurant", "cafe": "restaurant", "food": "restaurant", "fast_food": "restaurant",
    "bar": "restaurant", "pub": "restaurant", "shop": "shopping", "shopping": "shopping", "market": "shopping",
    "hotel": "accommodation", "accommodation": "accommodation",
}


def normalize_name(name: str) -> str:
    """全角半角・大小・空白・記号の違いを無くした名前(同じ場所の判定用)"""
    s = unicodedata.normalize("NFKC", name or "").lower()
    return re.sub(r"[\s・･·\-‐―ー_.,、。()（）「」『』\[\]【】]+", "", s)


def distance_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a_lat), math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(min(1.0, h)))


def round_position(lat: float, lng: float) -> Tuple[float, float]:
    """今いる場所は小数 4 桁(約 11m)に丸めてだけ使う"""
    return round(float(lat), 4), round(float(lng), 4)


def category_of(genre: Optional[str]) -> str:
    g = (genre or "").strip().lower()
    if g in ("restaurant", "sightseeing", "accommodation", "shopping", "other"):
        return g
    return _CATEGORY.get(g, "sightseeing" if g else "other")


def find_same(db: Session, user_id: Any, name: str, lat: Optional[float], lng: Optional[float],
              scope: str = "place") -> Optional[Spot]:
    """本人の行きたい場所から、同じ場所を 1 件探す(近い順)"""
    key = normalize_name(name)
    if not key:
        return None
    rows = db.query(Spot).filter(Spot.created_by == user_id).all()
    best: Optional[Tuple[float, Spot]] = None
    for s in rows:
        if (s.wish_scope or "place") != scope or normalize_name(s.name) != key:
            continue
        if lat is not None and lng is not None and s.latitude is not None and s.longitude is not None:
            d = distance_m(lat, lng, s.latitude, s.longitude)
            if d > SAME_PLACE_M:
                continue
        else:
            d = SAME_PLACE_M  # 位置が無い時は名前だけで同じとみなす(位置のある一致を優先)
        if best is None or d < best[0]:
            best = (d, s)
    return best[1] if best else None


def snapshot(spot: Spot) -> Dict[str, Any]:
    """取り消しで元へ戻すための、変えた列の値"""
    return {"wish_kind": spot.wish_kind, "again_count": spot.again_count or 0, "wish_note": spot.wish_note,
            "wish_when": spot.wish_when, "last_visited_at": spot.last_visited_at.isoformat()
            if spot.last_visited_at else None}


def source_label_for(db: Session, plan_id: Optional[uuid.UUID], user: Any) -> Tuple[Optional[uuid.UUID], Optional[str]]:
    """元の旅行の名前の写し。本人が見られない旅行は結び付けない(他人の旅行の名前を写さない)"""
    if plan_id is None:
        return None, None
    from app.core.plan_access import resolve_plan_role  # 遅延(循環を避ける)
    plan = db.query(TravelPlan).filter(TravelPlan.id == plan_id).first()
    if plan is None or resolve_plan_role(db, plan, user) is None:
        return None, None
    return plan.id, (plan.title or "")[:120] or None


def apply_wish(spot: Spot, *, wish_kind: Optional[str], note: Optional[str], when: Optional[str],
               visited_at: Optional[datetime] = None) -> None:
    """既にある場所を、今回の残し方で更新する(また行きたいは again_count +1)"""
    if wish_kind == "again":
        spot.again_count = (spot.again_count or 0) + 1
        spot.wish_kind = "again"
    elif wish_kind == "next" and spot.wish_kind is None:
        spot.wish_kind = "next"
    if note:
        spot.wish_note = note[:200]
    if when:
        spot.wish_when = when
    if visited_at is not None and (spot.last_visited_at is None or visited_at > spot.last_visited_at):
        spot.last_visited_at = visited_at


def new_wish(user_id: Any, *, name: str, lat: Optional[float], lng: Optional[float], address: Optional[str],
             genre: Optional[str], wish_kind: str, scope: str = "place", radius_m: Optional[int] = None,
             note: Optional[str] = None, when: Optional[str] = None, source_kind: str = "quick",
             source_plan_id: Optional[uuid.UUID] = None, source_label: Optional[str] = None,
             client_id: Optional[str] = None, visited_at: Optional[datetime] = None) -> Spot:
    return Spot(
        name=name.strip()[:200], latitude=lat, longitude=lng, address=(address or None),
        category=category_of(genre), created_by=user_id, is_public=False,
        wish_kind=wish_kind, wish_scope=scope, radius_m=radius_m if scope == "area" else None,
        source_kind=source_kind, source_plan_id=source_plan_id, source_label=source_label,
        wish_note=(note or None) and note[:200], wish_when=when, client_id=client_id,
        again_count=1 if wish_kind == "again" else 0, last_visited_at=visited_at,
    )


def now() -> datetime:
    return datetime.now(timezone.utc)
