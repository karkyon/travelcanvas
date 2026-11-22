"""[FR-061] 好みの傾向(詳細設計 DD-2026-11-22-01 §4.5)。保存しない(毎回数える)。結果はその人の応答にだけ入れる。

| 元 | 重み | 数え方 |
| 行きたい場所(今度) | 2 | 1 件ずつ |
| また行きたい | 4 | again_count を掛ける |
| 行った(スポットモードの着いた・訪問の確定) | 3 | |
| 予定に入れた場所(自分の旅行の予定) | 1 | |
| スポットモードの「行きたい」 | 1 | |

古さ: weight × 0.5^(経過日数 / 180)。正規化: 最大を 1 に揃える。
設定の「好みを並べに使う」(users.preferences.personalize_routes、既定は入)を切ると使わない。
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    PlanCandidate, Spot, SpotAreaItem, TravelEvent, TravelPlan, User, VisitAssessment,
)
from app.services import genre_map

HALF_LIFE_DAYS = 180.0
W_NEXT, W_AGAIN, W_WENT, W_PLANNED, W_WANTED = 2.0, 4.0, 3.0, 1.0, 1.0
VISIT_STATES = ("VERIFIED_VISIT", "LIKELY_VISIT", "MANUAL")


@dataclass
class Profile:
    weights: Dict[str, float] = field(default_factory=dict)  # 0..1
    went: Dict[str, int] = field(default_factory=dict)  # 行った・予定に入れた数(理由の札)
    again: Dict[str, int] = field(default_factory=dict)  # また行きたいの数
    enabled: bool = True

    def line(self) -> Optional[str]:
        """「よく行く: カフェ 5・神社 3 · また行きたい: 温泉」"""
        if not self.enabled:
            return None
        parts = []
        top = sorted(((n, g) for g, n in self.went.items() if n >= 2), reverse=True)[:3]
        if top:
            parts.append("よく行く: " + "・".join(f"{genre_map.label(g)} {n}" for n, g in top))
        ag = sorted(((n, g) for g, n in self.again.items() if n > 0), reverse=True)[:2]
        if ag:
            parts.append("また行きたい: " + "・".join(str(genre_map.label(g)) for _, g in ag))
        return " · ".join(parts) or None


def enabled_for(user: User) -> bool:
    prefs = user.preferences if isinstance(user.preferences, dict) else {}
    return prefs.get("personalize_routes", True) is not False


def _decay(at: Optional[datetime], now: datetime) -> float:
    if at is None:
        return 1.0
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    days = max(0.0, (now - at).total_seconds() / 86400.0)
    return 0.5 ** (days / HALF_LIFE_DAYS)


def profile(db: Session, user: User, now: Optional[datetime] = None) -> Profile:
    now = now or datetime.now(timezone.utc)
    if not enabled_for(user):
        return Profile(enabled=False)
    raw: Dict[str, float] = defaultdict(float)
    went: Dict[str, int] = defaultdict(int)
    again: Dict[str, int] = defaultdict(int)

    for s in db.query(Spot).filter(Spot.created_by == user.id).all():
        g = genre_map.to_genre(s.category, s.name)
        if not g:
            continue
        if s.wish_kind == "again":
            n = max(1, int(s.again_count or 0))
            raw[g] += W_AGAIN * n * _decay(s.last_visited_at or s.created_at, now)
            again[g] += n
        else:
            raw[g] += W_NEXT * _decay(s.created_at, now)

    for item, cand in (db.query(SpotAreaItem, PlanCandidate)
                       .join(PlanCandidate, PlanCandidate.id == SpotAreaItem.candidate_id)
                       .filter(SpotAreaItem.visited_by_user_id == user.id, SpotAreaItem.visited_at.isnot(None)).all()):
        g = genre_map.to_genre(item.genre if item.genre != "other" else cand.category, cand.title)
        if g:
            raw[g] += W_WENT * _decay(item.visited_at, now)
            went[g] += 1

    for v, e in (db.query(VisitAssessment, TravelEvent).join(TravelEvent, TravelEvent.id == VisitAssessment.event_id)
                 .filter(VisitAssessment.user_id == user.id, VisitAssessment.state.in_(VISIT_STATES),
                         VisitAssessment.hidden.is_(False)).all()):
        g = genre_map.to_genre(e.event_type, e.title)
        if g:
            raw[g] += W_WENT * _decay(v.assessed_at, now)
            went[g] += 1

    for e in (db.query(TravelEvent).join(TravelPlan, TravelPlan.id == TravelEvent.plan_id)
              .filter(TravelPlan.user_id == user.id).limit(2000).all()):
        if e.event_type in ("transport", "transportation", "accommodation", "lodging", "area"):
            continue
        g = genre_map.to_genre(e.event_type, e.title)
        if g:
            raw[g] += W_PLANNED * _decay(getattr(e, "created_at", None), now)
            went[g] += 1

    uid = str(user.id)
    for item, cand in (db.query(SpotAreaItem, PlanCandidate)
                       .join(PlanCandidate, PlanCandidate.id == SpotAreaItem.candidate_id)
                       .filter(SpotAreaItem.wanted_by.contains([uid])).limit(500).all()):
        g = genre_map.to_genre(item.genre if item.genre != "other" else cand.category, cand.title)
        if g:
            raw[g] += W_WANTED

    top = max(raw.values(), default=0.0)
    weights = {g: round(w / top, 4) for g, w in raw.items()} if top > 0 else {}
    return Profile(weights=weights, went=dict(went), again=dict(again))
