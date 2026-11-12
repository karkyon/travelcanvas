"""[Gate TDay] 旅の当日「旅帖ライブ」の手がかり(docs/ux/TDay_旅の当日_旅帖ライブ.md)。

GET /plans/{plan_id}/today/guide (app/api/v1/today_live.py) から呼ぶ。保存しない・予定を変えない。

- 出発の合図: 予定へ向かう移動区間の出発時刻があればそれを、無ければ一つ前の(位置のある)予定からの
  移動の概算(直線距離 × 迂回の係数。route_estimator)を開始時刻から引いた「出る時刻」。出所を必ず返す
  ("segment" / "estimate")。画面は概算の時に「概算」と明記する。
- すきま時間: 予定の終わり(end_at、無ければ既定の滞在の見積もり)から、次の予定へ出る時刻までが
  MIN_GAP_MINUTES 以上の所。寄り道の候補を出す手がかりにだけ使う。
- 旅帖の印: 予定の実績(event_actuals の「行った」)と、その予定に結び付いた記録(写真・メモ)の数。

時刻の計算は純粋関数(leave_by・gaps)に分け、固定の時刻で試験する。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence

from app.services import route_estimator

MIN_GAP_MINUTES = 30
# 位置が無い・概算できない時に「出る時刻」を作らない(架空の値を出さない)
WALK_MODES = {"walking", "walk", "on_foot"}


@dataclass(frozen=True)
class Slot:
    """すきま時間を探すための予定の枠(UTC)。"""
    event_id: str
    start: datetime
    end: Optional[datetime]  # 明示された終わり、または既定の滞在の見積もり
    travel_minutes: Optional[int]  # この予定へ向かう移動の分(分からなければ None)
    leave_by: Optional[datetime]  # この予定へ向かって出る時刻


def estimate_travel(prev: Optional[Any], ev: Any, mode: Optional[str]) -> Optional[Dict[str, Any]]:
    """一つ前の予定からこの予定までの移動の概算。座標が欠けていれば None。"""
    if prev is None:
        return None
    m = (mode or "walking").lower()
    if m in WALK_MODES:
        m = "walking"
    est = route_estimator.estimate_leg(prev.latitude, prev.longitude, ev.latitude, ev.longitude, m)
    if not est or est.get("duration_minutes") is None:
        return None
    return {"minutes": max(1, int(round(float(est["duration_minutes"])))), "mode": est["mode"],
            "distance_km": est["distance_km"]}


def leave_by(start: Optional[datetime], departure_at: Optional[datetime],
             travel_minutes: Optional[int]) -> Optional[datetime]:
    """出る時刻。移動区間の出発時刻を優先し、無ければ開始時刻 − 移動の分。どちらも無ければ None。"""
    if departure_at is not None:
        return departure_at
    if start is None or travel_minutes is None:
        return None
    return start - timedelta(minutes=travel_minutes)


def gaps(slots: Sequence[Slot], now: datetime, min_minutes: int = MIN_GAP_MINUTES) -> List[Dict[str, Any]]:
    """終わりの分かる予定と次の予定の間の、まだ過ぎていないすきま時間(min_minutes 以上)。"""
    out: List[Dict[str, Any]] = []
    ordered = sorted(slots, key=lambda s: s.start)
    for a, b in zip(ordered, ordered[1:]):
        if a.end is None:
            continue
        gap_end = b.leave_by or b.start
        gap_start = max(a.end, now)
        minutes = int((gap_end - gap_start).total_seconds() // 60)
        if gap_end <= now or minutes < min_minutes:
            continue
        out.append({"after_event_id": a.event_id, "before_event_id": b.event_id,
                    "start_at": gap_start, "end_at": gap_end, "minutes": minutes})
    return out


def stage(minutes_to_leave: Optional[int]) -> Optional[str]:
    """出発の合図の段階(画面と同じ基準。frontend の todayLive.goStage と一致させる)。

    relaxed: 21 分以上 / soon: 1〜20 分 / now: 0〜−4 分 / late: 5 分以上過ぎた
    """
    if minutes_to_leave is None:
        return None
    if minutes_to_leave > 20:
        return "relaxed"
    if minutes_to_leave > 0:
        return "soon"
    if minutes_to_leave > -5:
        return "now"
    return "late"
