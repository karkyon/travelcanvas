"""[FR-062] 旅の記録の「また行きたい」の候補(詳細設計 DD-2026-11-22-01 §6)。

一覧は本人の記録だけから作る(同じ旅行のほかの人の訪問・写真は使わない):
- 行った場所: スポットモードの着いた印(本人)・訪問の判定の確定(本人)・写真の場所(本人の写真)・当日に「着いた」にした予定(本人の記録)
  - 重なり(名前が同じ、または 60m 以内)は 1 つにまとめる
- このエリアごと: スポットモードのエリア(本人が着いた印のあるもの)。無ければ行った場所の集まり(500m 以内に 3 か所以上)
- 行けなかった場所: この旅行の候補箱の、当日に「次の旅の候補に」した行(note が「旅の当日に行けなかった場所」)

key はサーバーが作る印(元の行の ID の署名)。利用者が任意の場所を入れる入口にはしない(POST の時に作り直して照らす)。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import (
    EventActual,
    Memory,
    PlanCandidate,
    Spot,
    SpotArea,
    SpotAreaItem,
    TravelEvent,
    TravelPlan,
    User,
    VisitAssessment,
)
from app.services import wishes

MISSED_NOTE = "旅の当日に行けなかった場所"
MERGE_M = 60.0
CLUSTER_M = 500.0
CLUSTER_MIN = 3
PHOTO_NEAR_M = 100.0
VISIT_STATES = ("VERIFIED_VISIT", "LIKELY_VISIT", "MANUAL")
MAX_ITEMS = 50


def _key() -> bytes:
    return hashlib.sha256(("tc-again|" + str(settings.JWT_SECRET_KEY)).encode("utf-8")).digest()


def sign(plan_id: Any, user_id: Any, raw: str) -> str:
    body = f"{plan_id}|{user_id}|{raw}"
    sig = (
        base64.urlsafe_b64encode(hmac.new(_key(), body.encode("utf-8"), hashlib.sha256).digest()[:12])
        .decode()
        .rstrip("=")
    )
    return f"{raw}.{sig}"


@dataclass
class Place:
    key_raw: str
    name: str
    genre: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    visited_at: Optional[datetime]
    sources: List[str] = field(default_factory=list)
    photo_ids: List[str] = field(default_factory=list)


def _near(a: Place, lat: Optional[float], lng: Optional[float], m: float) -> bool:
    return (
        a.lat is not None
        and a.lng is not None
        and lat is not None
        and lng is not None
        and wishes.distance_m(a.lat, a.lng, lat, lng) <= m
    )


def _add(places: List[Place], p: Place) -> None:
    key = wishes.normalize_name(p.name)
    for q in places:
        if (key and wishes.normalize_name(q.name) == key) or _near(q, p.lat, p.lng, MERGE_M):
            for s in p.sources:
                if s not in q.sources:
                    q.sources.append(s)
            if p.visited_at and (q.visited_at is None or p.visited_at < q.visited_at):
                q.visited_at = p.visited_at
            if q.lat is None and p.lat is not None:
                q.lat, q.lng = p.lat, p.lng
            q.genre = q.genre or p.genre
            return
    places.append(p)


def _visited_places(
    db: Session, plan: TravelPlan, user: User
) -> Tuple[List[Place], List[Tuple[SpotArea, List[Place]]]]:
    places: List[Place] = []
    area_rows: Dict[uuid.UUID, Tuple[SpotArea, List[Place]]] = {}
    # 1) スポットモードの着いた印(本人)
    rows = (
        db.query(SpotAreaItem, PlanCandidate, SpotArea)
        .join(SpotArea, SpotArea.id == SpotAreaItem.area_id)
        .join(PlanCandidate, PlanCandidate.id == SpotAreaItem.candidate_id)
        .filter(
            SpotArea.plan_id == plan.id,
            SpotAreaItem.visited_at.isnot(None),
            SpotAreaItem.visited_by_user_id == user.id,
        )
        .all()
    )
    for item, cand, area in rows:
        p = Place(
            f"item:{item.id}",
            cand.title,
            item.genre or cand.category,
            cand.latitude,
            cand.longitude,
            item.visited_at,
            ["spot_mode"],
        )
        _add(places, p)
        area_rows.setdefault(area.id, (area, []))[1].append(p)
    events = {e.id: e for e in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()}
    # 2) 訪問の判定の確定(本人)
    for v in (
        db.query(VisitAssessment)
        .filter(
            VisitAssessment.plan_id == plan.id,
            VisitAssessment.user_id == user.id,
            VisitAssessment.state.in_(VISIT_STATES),
            VisitAssessment.hidden.is_(False),
        )
        .all()
    ):
        e = events.get(v.event_id)
        if e is not None:
            _add(
                places,
                Place(f"visit:{v.id}", e.title, e.event_type, e.latitude, e.longitude, v.assessed_at, ["visit"]),
            )
    # 3) 当日に「着いた」にした予定(本人の記録)
    for a in (
        db.query(EventActual)
        .filter(
            EventActual.plan_id == plan.id,
            EventActual.status == "visited",
            EventActual.recorded_by_user_id == user.id,
        )
        .all()
    ):
        e = events.get(a.event_id)
        if e is not None:
            _add(
                places,
                Place(
                    f"actual:{a.id}",
                    e.title,
                    e.event_type,
                    e.latitude,
                    e.longitude,
                    a.actual_start_at or a.created_at,
                    ["today"],
                ),
            )
    # 4) 写真の場所(本人の写真だけ)。予定・近くの場所に数え、名前のある写真の場所は行に足す
    photos = (
        db.query(Memory)
        .filter(Memory.plan_id == plan.id, Memory.author_user_id == user.id, Memory.kind == "photo")
        .order_by(Memory.occurred_at.asc().nullslast())
        .all()
    )
    for ph in photos:
        target: Optional[Place] = None
        ev = events.get(ph.event_id) if ph.event_id else None
        if ev is not None:
            target = next(
                (q for q in places if wishes.normalize_name(q.name) == wishes.normalize_name(ev.title)), None
            )
        if target is None:
            target = next((q for q in places if _near(q, ph.latitude, ph.longitude, PHOTO_NEAR_M)), None)
        if target is None and ph.place_name and ph.latitude is not None:
            target = Place(
                f"memory:{ph.id}", ph.place_name, None, ph.latitude, ph.longitude, ph.occurred_at, ["memory"]
            )
            _add(places, target)
            new = target
            target = next(
                (
                    q
                    for q in places
                    if q is new
                    or wishes.normalize_name(q.name) == wishes.normalize_name(new.name)
                    or _near(q, new.lat, new.lng, MERGE_M)
                ),
                new,
            )
        if target is not None:
            target.photo_ids.append(str(ph.id))
            if "memory" not in target.sources:
                target.sources.append("memory")
    places.sort(key=lambda p: (p.visited_at is None, p.visited_at.timestamp() if p.visited_at else 0.0))  # 着いた順
    return places, list(area_rows.values())


def _minutes(a: Optional[str], b: Optional[str]) -> Optional[int]:
    try:
        ha, ma = (int(x) for x in (a or "").split(":"))
        hb, mb = (int(x) for x in (b or "").split(":"))
    except ValueError:
        return None
    d = (hb * 60 + mb) - (ha * 60 + ma)
    return d if d > 0 else None


def _centroid(ps: List[Place]) -> Optional[Tuple[float, float]]:
    pts = [(p.lat, p.lng) for p in ps if p.lat is not None and p.lng is not None]
    if not pts:
        return None
    return sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts)


def _clusters(places: List[Place]) -> List[List[Place]]:
    """500m 以内に 3 か所以上の集まり(重ならないように、多い順に取る)"""
    left = [p for p in places if p.lat is not None and p.lng is not None]
    out: List[List[Place]] = []
    while left:
        best = max(left, key=lambda c: sum(1 for q in left if _near(c, q.lat, q.lng, CLUSTER_M)))
        group = [q for q in left if _near(best, q.lat, q.lng, CLUSTER_M)]
        if len(group) < CLUSTER_MIN:
            break
        out.append(group)
        left = [q for q in left if q not in group]
    return out


def build(db: Session, plan: TravelPlan, user: User) -> Dict[str, Any]:
    """{areas, places, missed}。どれにも key(署名)を付ける"""
    places, area_rows = _visited_places(db, plan, user)
    mine = db.query(Spot).filter(Spot.created_by == user.id).all()

    def saved(name: str, lat: Optional[float], lng: Optional[float], scope: str = "place") -> Optional[Spot]:
        key = wishes.normalize_name(name)
        for s in mine:
            if (s.wish_scope or "place") != scope or wishes.normalize_name(s.name) != key:
                continue
            if (
                lat is None
                or s.latitude is None
                or wishes.distance_m(lat, lng or 0, s.latitude, s.longitude or 0) <= 100
            ):
                return s
        return None

    areas: List[Dict[str, Any]] = []
    for area, ps in area_rows:
        c = (area.meet_latitude, area.meet_longitude) if area.meet_latitude is not None else _centroid(ps)
        if c is None:
            continue
        s = saved(area.title, c[0], c[1], "area")
        areas.append(
            {
                "key": sign(plan.id, user.id, f"area:{area.id}"),
                "title": area.title,
                "lat": c[0],
                "lng": c[1],
                "radius_m": int(area.radius_m or 400),
                "walked_min": _minutes(area.start_time, area.end_time),
                "visited_count": len(ps),
                "saved_spot_id": s.id if s else None,
            }
        )
    if not areas:
        for group in _clusters(places):
            c = _centroid(group)
            assert c is not None
            radius = int(
                min(5000, max(100, max(wishes.distance_m(c[0], c[1], p.lat or 0, p.lng or 0) for p in group) + 100))
            )
            first = group[0]
            title = f"{first.name}のあたり"
            s = saved(title, c[0], c[1], "area")
            ids = ",".join(sorted(p.key_raw for p in group))
            areas.append(
                {
                    "key": sign(plan.id, user.id, "cluster:" + hashlib.sha256(ids.encode()).hexdigest()[:16]),
                    "title": title,
                    "lat": c[0],
                    "lng": c[1],
                    "radius_m": radius,
                    "walked_min": None,
                    "visited_count": len(group),
                    "saved_spot_id": s.id if s else None,
                }
            )

    out_places: List[Dict[str, Any]] = []
    for p in places:
        s = saved(p.name, p.lat, p.lng)
        out_places.append(
            {
                "key": sign(plan.id, user.id, p.key_raw),
                "name": p.name,
                "genre": p.genre,
                "lat": p.lat,
                "lng": p.lng,
                "visited_at": p.visited_at,
                "photo_count": len(p.photo_ids),
                "thumb_memory_id": p.photo_ids[0] if p.photo_ids else None,
                "saved_spot_id": s.id if s else None,
                "saved_kind": (s.wish_kind or "next") if s else None,
                "sources": p.sources,
            }
        )

    missed = [
        {
            "key": sign(plan.id, user.id, f"missed:{c.id}"),
            "candidate_id": c.id,
            "title": c.title,
            "lat": c.latitude,
            "lng": c.longitude,
        }
        for c in db.query(PlanCandidate)
        .filter(PlanCandidate.plan_id == plan.id, PlanCandidate.note == MISSED_NOTE, PlanCandidate.status != "merged")
        .order_by(PlanCandidate.created_at.asc())
        .all()
    ]
    return {"areas": areas, "places": out_places, "missed": missed}


def save(db: Session, plan: TravelPlan, user: User, items: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """選んだ候補を行きたい場所へ残す。key は作り直した一覧に有るものだけを受ける(無い・改ざんは 422)"""
    data = build(db, plan, user)
    lookup: Dict[str, Tuple[str, Dict[str, Any]]] = {}
    for kind in ("areas", "places", "missed"):
        for row in data[kind]:
            lookup[row["key"]] = (kind, row)
    label = (plan.title or "")[:120] or None
    saved: List[Dict[str, Any]] = []
    merged: List[Dict[str, Any]] = []
    if any(it["key"] not in lookup for it in items):  # 書く前に全部を確かめる(途中まで残さない)
        raise ValueError("unknown_key")
    for it in items:
        found = lookup.get(it["key"])
        if found is None:
            raise ValueError("unknown_key")
        kind, row = found
        wish_kind = it.get("wish_kind") or ("next" if kind == "missed" else "again")
        if kind == "areas":
            name, lat, lng, scope, radius, src, when = (
                row["title"],
                row["lat"],
                row["lng"],
                "area",
                row["radius_m"],
                "visit",
                None,
            )
        elif kind == "places":
            src = "memory" if row["sources"] == ["memory"] else "visit"
            name, lat, lng, scope, radius, when = (
                row["name"],
                row["lat"],
                row["lng"],
                "place",
                None,
                row["visited_at"],
            )
        else:
            name, lat, lng, scope, radius, src, when = (
                row["title"],
                row["lat"],
                row["lng"],
                "place",
                None,
                "today",
                None,
            )
        same = wishes.find_same(db, user.id, name, lat, lng, scope)
        if same is not None:
            wishes.apply_wish(same, wish_kind=wish_kind, note=None, when=None, visited_at=when)
            if radius and scope == "area":
                same.radius_m = radius
            db.flush()
            merged.append({"key": it["key"], "spot_id": same.id, "again_count": same.again_count})
            continue
        genre = row.get("genre") if kind == "places" else None
        spot = wishes.new_wish(
            user.id,
            name=name,
            lat=lat,
            lng=lng,
            address=None,
            genre=genre,
            wish_kind=wish_kind,
            scope=scope,
            radius_m=radius,
            note=MISSED_NOTE if kind == "missed" else None,
            source_kind=src,
            source_plan_id=plan.id,
            source_label=label,
            visited_at=when,
        )
        db.add(spot)
        db.flush()
        saved.append({"key": it["key"], "spot_id": spot.id})
    db.commit()
    return {"saved": saved, "merged": merged}
