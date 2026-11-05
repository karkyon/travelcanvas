"""[Gate PhotoPlace] 写真の位置を決める(撮影位置 → 位置の記録 → 予定の時刻 → 手で置く)。

スマホのブラウザは写真の撮影位置を渡さないことがあるため、位置が無い写真は撮影時刻から候補を作る。
- 推定は proposed(確認待ち)で保存し、本人が確定するまで「撮影位置」として扱わない(DOC-14 §4.5、MAP-AC08)。
- 位置の記録は、本人がサーバーへの同期(synced)を選んだ軌跡だけを、本人の写真にだけ使う。
  軌跡は暗号化して保存しているが memories の緯度経度は平文なので、約 100m 単位に丸めて写す。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_payload
from app.models.models import LocationPointBatch, LocationTrack, Place, Spot, TravelDay, TravelEvent, TravelPlan
from app.services import location_tracks as lt
from app.services.today_mode import effective_start

TRACK_NEAR = timedelta(minutes=2)
TRACK_FAR = timedelta(minutes=10)
EVENT_MARGIN = timedelta(minutes=15)
EVENT_DEFAULT = timedelta(hours=2)
TRACK_DECIMALS = 3
CONF_TRACK_NEAR = 0.85
CONF_TRACK_FAR = 0.6
CONF_EVENT = 0.55


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def from_track(db: Session, plan_id: uuid.UUID, user_id: uuid.UUID, taken_at: datetime
               ) -> Optional[Tuple[float, float, float]]:
    """(緯度, 経度, 信頼度)。同期を選んだ本人の軌跡で、撮影時刻の前後 10 分の点が無ければ None。"""
    tracks = db.query(LocationTrack).filter(LocationTrack.plan_id == plan_id, LocationTrack.user_id == user_id,
                                            LocationTrack.mode == "synced").all()
    if not tracks:
        return None
    best: Optional[Tuple[timedelta, dict]] = None
    batches = db.query(LocationPointBatch).filter(
        LocationPointBatch.track_id.in_([t.id for t in tracks]),
        LocationPointBatch.first_at <= taken_at + TRACK_FAR, LocationPointBatch.last_at >= taken_at - TRACK_FAR).all()
    for batch in batches:
        try:
            points = lt.decode(decrypt_payload(batch.points_ciphertext))
        except Exception:  # noqa: BLE001 - 読めない軌跡は「無い」として次の根拠へ進む
            continue
        for point in points:
            gap = abs(_aware(datetime.fromisoformat(point["t"])) - taken_at)
            if gap <= TRACK_FAR and (best is None or gap < best[0]):
                best = (gap, point)
    if best is None:
        return None
    gap, point = best
    return (round(point["lat"], TRACK_DECIMALS), round(point["lng"], TRACK_DECIMALS),
            CONF_TRACK_NEAR if gap <= TRACK_NEAR else CONF_TRACK_FAR)


def _event_position(db: Session, event: TravelEvent) -> Optional[Tuple[float, float, Optional[str]]]:
    src = db.get(Place, event.place_id) if event.place_id else None
    if src is None and event.spot_id:
        src = db.get(Spot, event.spot_id)
    lat = event.latitude if event.latitude is not None else getattr(src, "latitude", None)
    lng = event.longitude if event.longitude is not None else getattr(src, "longitude", None)
    if lat is None or lng is None:
        return None
    return float(lat), float(lng), getattr(src, "name", None) or event.title


def from_events(db: Session, plan: TravelPlan, taken_at: datetime
                ) -> Optional[Tuple[float, float, str, uuid.UUID]]:
    """撮影時刻が予定の時間帯(前後 15 分)に入る、位置のある予定。(緯度, 経度, 場所の名前, 予定の ID)"""
    days: Dict[uuid.UUID, TravelDay] = {d.id: d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id)}
    best: Optional[Tuple[timedelta, TravelEvent]] = None
    for event in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all():
        day = days.get(event.day_id)
        if day is None or event.is_all_day:
            continue
        start, _known = effective_start(event, day)
        if start is None:
            continue
        start = _aware(start)
        end = _aware(event.end_at) if event.end_at is not None else start + EVENT_DEFAULT
        if start - EVENT_MARGIN <= taken_at <= end + EVENT_MARGIN and _event_position(db, event) is not None:
            gap = abs(taken_at - start)
            if best is None or gap < best[0]:
                best = (gap, event)
    if best is None:
        return None
    lat, lng, name = _event_position(db, best[1]) or (0.0, 0.0, None)
    return lat, lng, name or best[1].title, best[1].id


def resolve(db: Session, plan: TravelPlan, user_id: uuid.UUID, fields: dict, source: Optional[str]) -> dict:
    """保存する位置の項目を返す。端末が読んだ位置があればそれを確定で使い、無ければ撮影時刻から推定する。"""
    if fields.get("latitude") is not None:
        return {"location_source": source if source in ("exif", "manual") else "manual",
                "location_status": "confirmed", "location_confidence": None}
    taken_at = fields.get("occurred_at")
    if taken_at is None:
        return {"location_source": None, "location_status": None, "location_confidence": None}
    taken_at = _aware(taken_at)
    hit = from_track(db, plan.id, user_id, taken_at)
    if hit is not None:
        fields["latitude"], fields["longitude"] = hit[0], hit[1]
        return {"location_source": "track", "location_status": "proposed", "location_confidence": hit[2]}
    event = from_events(db, plan, taken_at)
    if event is not None:
        fields["latitude"], fields["longitude"] = event[0], event[1]
        if not fields.get("place_name"):
            fields["place_name"] = event[2][:200]
        return {"location_source": "event", "location_status": "proposed", "location_confidence": CONF_EVENT}
    return {"location_source": None, "location_status": None, "location_confidence": None}
