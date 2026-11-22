"""[FR-063] SNS の投稿の文の下書き(AI を使わない。詳細設計 DD-2026-11-22-01 §8.3・§8.6)。

保存しない(作るたびに作る)。文の並び:
1. つかみ: 「{行き先}へ{泊数}。」(例「伊勢へ1泊2日。」「桂坂へ日帰り。」)
2. 流れ: 行った場所を着いた順に最大 5 つ「→」でつなぐ。エリアは「{エリア}を自由に歩いて、{3 つ}。」
3. 数: 歩いた距離(軌跡があれば)・行った場所の数・また行きたいの数
4. ひとこと: 本人の最後のメモ(最大 60 字)
5. ハッシュタグ: 行き先・エリア・行った場所(短い順)・#旅の記録。TikTok・リール・Instagram は最大 8、X は 3

外すもの: 自宅の近く(プロフィールの自宅・日帰りの出発地から 1km 以内)・正確な時刻(既定)・人の名前(同行者の表示名・@ 名)。
写真は本人のものと、ほかの人が「メンバーに見せる」にした旅行記に入れる写真だけ。route_shape は 0〜1 の形だけ(本当の位置は出さない)。
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app.models.models import (
    DayTripRoute, EventActual, Memory, PlanCollaborator, Spot, SpotArea, SpotAreaItem, TravelDay, TravelEvent,
    TravelPlan, User, UserHomePlace,
)
from app.services import wishes

STYLES = ("tiktok", "ig_reels", "shorts", "instagram", "x", "line")
REEL_STYLES = ("tiktok", "ig_reels", "shorts")
SCOPES = ("trip", "day", "area")
HOME_NEAR_M = 1000.0
MAX_FLOW = 5
MAX_NOTE = 60
X_LIMIT = 140
TAGS_MAX = {"x": 3}
TAG_DEFAULT_MAX = 8
CHAR_LIMIT = {"tiktok": 4000, "ig_reels": 2200, "shorts": 5000, "instagram": 2200, "x": 140, "line": 1000}
REEL_PHOTOS = (3, 20)
POST_PHOTOS = (1, 10)


def _home_points(db: Session, plan: TravelPlan, user: User) -> List[Tuple[float, float]]:
    pts: List[Tuple[float, float]] = []
    row = db.query(UserHomePlace).filter(UserHomePlace.user_id == user.id).first()
    if row is not None:
        try:
            from app.core.crypto import decrypt_payload

            data = json.loads(decrypt_payload(row.place_ciphertext).decode("utf-8"))
            if isinstance(data, dict) and data.get("latitude") is not None:
                pts.append((float(data["latitude"]), float(data["longitude"])))
        except Exception:  # noqa: BLE001 - 読めない自宅は使わない(外す側に倒せないため、出発地だけで判定)
            pass
    out = db.query(DayTripRoute).filter(DayTripRoute.plan_id == plan.id, DayTripRoute.leg == "out").first()
    if out is not None:
        pts.append((out.origin_lat, out.origin_lng))
    return pts


def _near_home(lat: Optional[float], lng: Optional[float], home: Sequence[Tuple[float, float]]) -> bool:
    if lat is None or lng is None:
        return False
    return any(wishes.distance_m(lat, lng, h[0], h[1]) <= HOME_NEAR_M for h in home)


def _member_names(db: Session, plan: TravelPlan, me: User) -> List[str]:
    names: List[str] = []
    ids = {plan.user_id} | {c.user_id for c in db.query(PlanCollaborator).filter(PlanCollaborator.plan_id == plan.id)
                            if c.user_id}
    for u in db.query(User).filter(User.id.in_(list(ids))).all():
        for n in (u.username, getattr(u, "display_name", None), getattr(u, "full_name", None)):
            if n and len(str(n).strip()) >= 2:
                names.append(str(n).strip())
    return sorted(set(names), key=len, reverse=True)


def strip_names(text: str, names: Sequence[str]) -> Tuple[str, int]:
    """人の名前(同行者の表示名・@ 名)を外す"""
    n = 0
    out = text
    for name in names:
        if name in out:
            n += out.count(name)
            out = out.replace(name, "")
    out, k = re.subn(r"@[\w.\-]+", "", out)
    return re.sub(r"\s{2,}", " ", out).strip(), n + k


def hashtag(word: str) -> Optional[str]:
    """空白・記号を外したハッシュタグ(2 字以上)"""
    w = unicodedata.normalize("NFKC", word or "")
    w = re.sub(r"[\s\W_]+", "", w, flags=re.UNICODE)
    return f"#{w}" if len(w) >= 2 else None


def _nights(days: Sequence[date]) -> str:
    if len(days) <= 1:
        return "日帰り"
    return f"{len(days) - 1}泊{len(days)}日"


def _route_shape(points: Sequence[Tuple[float, float]], home: Sequence[Tuple[float, float]]) -> List[List[float]]:
    """0〜1 の形だけ(緯度・経度は出さない)。自宅の近く(最初と最後の 1km)は切る"""
    pts = [p for p in points if not _near_home(p[0], p[1], home)]
    if len(pts) < 2:
        return []
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    span = max(max(lats) - min(lats), max(lngs) - min(lngs)) or 1.0
    return [[round((p[1] - min(lngs)) / span, 3), round(1 - (p[0] - min(lats)) / span, 3)] for p in pts]


def draft(db: Session, plan: TravelPlan, user: User, scope: str, style: str, scope_ref: Optional[str] = None,
          include_time: bool = False) -> Dict[str, Any]:
    home = _home_points(db, plan, user)
    names = _member_names(db, plan, user)
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).order_by(TravelDay.local_date.asc()).all()
    day_ids = {d.id for d in days}
    if scope == "day" and scope_ref:
        days = [d for d in days if str(d.id) == scope_ref] or days
        day_ids = {d.id for d in days}
    events = {e.id: e for e in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()}
    excluded = {"home_near": 0, "names": 0}

    # 行った場所(本人の記録): 当日の着いた・スポットモードの着いた。着いた順
    visited: List[Tuple[Optional[datetime], str, Optional[float], Optional[float]]] = []
    for a in db.query(EventActual).filter(EventActual.plan_id == plan.id, EventActual.status == "visited",
                                          EventActual.recorded_by_user_id == user.id).all():
        e = events.get(a.event_id)
        if e is not None and (scope != "day" or e.day_id in day_ids):
            visited.append((a.actual_start_at or a.created_at, e.title, e.latitude, e.longitude))
    area_rows = db.query(SpotArea).filter(SpotArea.plan_id == plan.id).all()
    if scope == "area" and scope_ref:
        area_rows = [a for a in area_rows if str(a.id) == scope_ref] or area_rows
    area_names: List[str] = []
    area_places: List[str] = []
    for area in area_rows:
        items = (db.query(SpotAreaItem).filter(SpotAreaItem.area_id == area.id, SpotAreaItem.visited_at.isnot(None),
                                               SpotAreaItem.visited_by_user_id == user.id).all())
        if not items:
            continue
        area_names.append(area.title)
        from app.models.models import PlanCandidate

        for it in sorted(items, key=lambda i: i.visited_at or datetime.min.replace(tzinfo=timezone.utc)):
            c = db.get(PlanCandidate, it.candidate_id)
            if c is not None:
                if _near_home(c.latitude, c.longitude, home):
                    excluded["home_near"] += 1
                    continue
                area_places.append(c.title)
    places: List[str] = []
    for _at, title, lat, lng in sorted(visited, key=lambda v: (v[0] is None, v[0] or datetime.min)):
        if _near_home(lat, lng, home):
            excluded["home_near"] += 1
            continue
        if title not in places:
            places.append(title)

    dest = (plan.destination or plan.title or "旅").strip()
    dest = re.sub(r"(へ日帰り|の旅)$", "", dest)
    period_days = [d.local_date for d in days]
    hook = f"{dest}へ{_nights(period_days) if getattr(plan, 'trip_style', None) != 'day_trip' else '日帰り'}。"

    flow_places = places[:MAX_FLOW]
    flow_lines: List[str] = []
    if area_names and area_places:
        flow_lines.append(f"{area_names[0]}を自由に歩いて、{'・'.join(area_places[:3])}。")
    if flow_places:
        flow_lines.append(" → ".join(flow_places))

    again = db.query(Spot).filter(Spot.created_by == user.id, Spot.source_plan_id == plan.id,
                                  Spot.wish_kind == "again").count()
    nums = [f"行った場所 {len(places) + len(area_places)} か所"]
    if again:
        nums.append(f"また行きたい {again}")
    num_line = " · ".join(nums)

    note = None
    last = (db.query(Memory).filter(Memory.plan_id == plan.id, Memory.author_user_id == user.id, Memory.kind == "note")
            .order_by(Memory.occurred_at.desc().nullslast(), Memory.created_at.desc()).first())
    if last is not None and last.body:
        cleaned, k = strip_names(last.body, names)
        excluded["names"] += k
        note = cleaned[:MAX_NOTE] or None

    words = [dest] + area_names + sorted(set(places + area_places), key=len)
    tags: List[str] = []
    for w in words:
        t = hashtag(w)
        if t and t not in tags:
            tags.append(t)
    tags = [t for t in tags if t != "#旅の記録"][: (TAGS_MAX.get(style, TAG_DEFAULT_MAX) - 1)] + ["#旅の記録"]

    if style == "line":
        lines = [hook] + flow_lines
    elif style == "x":
        lines = [hook] + flow_lines + [num_line]
    else:
        lines = [hook] + flow_lines + [num_line] + ([note] if note else [])
    text = "\n".join(lines)
    if style == "x":
        # 140 字に収まるよう、流れの場所を減らす
        k = len(flow_places)
        while len(text + "\n" + " ".join(tags)) > X_LIMIT and k > 1:
            k -= 1
            fl = [" → ".join(flow_places[:k])]
            text = "\n".join([hook] + fl + [num_line])
        if len(text + "\n" + " ".join(tags)) > X_LIMIT:
            text = text[: X_LIMIT - len(" ".join(tags)) - 2] + "…"
    text, k = strip_names(text, names)
    excluded["names"] += k

    # 写真(撮った順)。本人の写真と、ほかの人が旅行記に入れてメンバーに見せる写真だけ
    rows = (db.query(Memory).filter(Memory.plan_id == plan.id, Memory.kind == "photo", Memory.storage_key.isnot(None))
            .filter((Memory.author_user_id == user.id)
                    | ((Memory.visibility == "members") & (Memory.include_in_journal.is_(True))))
            .order_by(Memory.occurred_at.asc().nullslast(), Memory.created_at.asc()).all())
    photos = []
    for r in rows:
        if scope == "day" and scope_ref and r.day_id not in day_ids and (
                not r.event_id or events.get(r.event_id) is None or events[r.event_id].day_id not in day_ids):
            continue
        at = r.occurred_at
        photos.append({"memory_id": str(r.id), "owner_is_me": r.author_user_id == user.id, "allowed": True,
                       "taken_at": (at.isoformat() if include_time else at.date().isoformat()) if at else None,
                       "place_name": None if _near_home(r.latitude, r.longitude, home) else r.place_name})

    # 音は自分の声の記録だけ(音楽は付けない)
    audios = [{"memory_id": str(a.id), "taken_at": a.occurred_at.date().isoformat() if a.occurred_at else None}
              for a in db.query(Memory).filter(Memory.plan_id == plan.id, Memory.kind == "audio",
                                               Memory.author_user_id == user.id, Memory.storage_key.isnot(None))
              .order_by(Memory.occurred_at.asc().nullslast()).limit(20).all()]
    route = db.query(DayTripRoute).filter(DayTripRoute.plan_id == plan.id, DayTripRoute.leg == "out").first()
    if route is not None:
        from app.services.day_trip import decode_polyline

        pts = decode_polyline(route.polyline)
    else:
        ordered = sorted(events.values(), key=lambda e: (str(e.day_id), e.sort_order or 0))
        pts = [(e.latitude, e.longitude) for e in ordered
               if e.latitude is not None and e.longitude is not None and (scope != "day" or e.day_id in day_ids)]
    period = None
    if period_days:
        period = {"start": period_days[0].isoformat(), "end": period_days[-1].isoformat()}
    return {"text": text, "hashtags": tags, "excluded": excluded, "photos": photos, "audios": audios,
            "route_shape": _route_shape(pts, home), "title": plan.title, "period": period,
            "char_limit": CHAR_LIMIT[style], "photo_range": list(REEL_PHOTOS if style in REEL_STYLES else POST_PHOTOS)}
