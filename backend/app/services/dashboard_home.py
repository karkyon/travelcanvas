"""
[Gate HomeV2] ホーム(ダッシュボード)v2 の集約。docs/ux/TravelCanvas_ホーム改善案_v2_モックアップ.html の 4 段:

1. いま計画中: 計画中の旅行ごとの「旅の準備」(段階の進み具合)と、計画中の旅行ぜんぶから「次にやること」
2. 旅行の一覧: 旅行の状態(計画中 / 検討中 / 行った旅 / 見送り・中止)
3. 旅の記録と思い出: 行った旅の写真・メモの数、最近の旅の写真(見られる写真だけ)、旅の足あと(都道府県・日数・写真)
4. 行ってみたい場所: お気に入りに保存したスポットを種類別に

値は既存のデータから数えるだけ(推測で作らない)。写真は見られるもの(自分のもの・メンバーに見せるもの)だけ。
"""
import re
import uuid
from collections import defaultdict
from datetime import date
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Memory, PackingItem, Spot, TravelDay, TravelEvent, TravelSegment, User, UserSpotFavorite

# 旅行の状態(旅行の一覧のタブ)
SHELVES = ("planning", "considering", "visited", "cancelled")
CANCELLED_STATUS = "cancelled"
MAX_PLANNING = 5
MAX_TASKS = 4
MAX_VISITED = 6
MAX_PHOTOS = 5
MAX_WISH = 24
MAX_POINTS = 400  # [Gate Footprints2] 地図の点の上限(近い点はまとめる)

PREFECTURES = (
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
    "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
    "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
    "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
)
_PREF_RE = re.compile("|".join(PREFECTURES))


def shelf_of(phase: str, status: Optional[str]) -> str:
    """旅行の一覧のタブ(純粋関数)。見送り・中止は利用者が決めた時だけ。日付の無い旅行は検討中"""
    if status == CANCELLED_STATUS:
        return "cancelled"
    if phase in ("ongoing", "upcoming"):
        return "planning"
    if phase == "past":
        return "visited"
    return "considering"


def prefectures_in(texts: Iterable[Optional[str]]) -> List[str]:
    """住所・行き先の文から都道府県の名前を拾う(書かれた名前だけ。推測しない)"""
    found: List[str] = []
    for t in texts:
        for m in _PREF_RE.findall(t or ""):
            if m not in found:
                found.append(m)
    return found


def in_japan(lat: float, lng: float) -> bool:
    """[Gate Footprints2] 日本の範囲のおおよその判定(本州・北海道・九州・四国・沖縄。朝鮮半島を除く)。国内か海外かの数え分けだけに使う"""
    if 24.0 <= lat <= 28.5 and 122.9 <= lng <= 131.5:
        return True  # 沖縄・南西諸島
    if not (30.0 <= lat <= 45.8 and 128.5 <= lng <= 146.0):
        return False
    return not (lng < 130.5 and lat > 34.0)  # 朝鮮半島・対馬の北を除く


def footprint_points(db: Session, user: User, trips: List[Dict[str, Any]], plans_by_id: Dict[str, Any],
                     events: Dict[Any, List[TravelEvent]]) -> Dict[str, Any]:
    """[Gate Footprints2] 行った旅・計画中の旅の予定の位置(世界地図の点)と、海外の旅の数。

    位置を見せない設定(event_address)の旅行は点にしない。近い点(小数 2 桁)はまとめ、最大 MAX_POINTS。"""
    from app.services import member_policy  # 循環 import を避ける

    seen: Dict[tuple, Dict[str, Any]] = {}
    overseas = 0
    for t in trips:
        state = {"visited": "visited", "planning": "planned"}.get(t.get("shelf") or "")
        plan = plans_by_id.get(t["id"])
        if state is None or plan is None:
            continue
        if "event_address" in member_policy.hidden_for(db, plan, t.get("role"), user):
            continue
        abroad = False
        for ev in events.get(plan.id, []):
            if ev.latitude is None or ev.longitude is None:
                continue
            lat, lng = float(ev.latitude), float(ev.longitude)
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                continue
            abroad = abroad or not in_japan(lat, lng)
            key = (round(lat, 2), round(lng, 2))
            prev = seen.get(key)
            if prev is None:
                if len(seen) < MAX_POINTS:
                    seen[key] = {"lat": key[0], "lng": key[1], "state": state, "label": f"{t['title']}・{ev.title}"[:80]}
            elif state == "visited":
                prev["state"] = "visited"
        if abroad and state == "visited":
            overseas += 1
    return {"points": list(seen.values()), "overseas_trips": overseas}


def _events_by_plan(db: Session, plan_ids: List[uuid.UUID]) -> Dict[Any, List[TravelEvent]]:
    out: Dict[Any, List[TravelEvent]] = defaultdict(list)
    if not plan_ids:
        return out
    rows = (db.query(TravelEvent, TravelDay.local_date)
            .join(TravelDay, TravelDay.id == TravelEvent.day_id)
            .filter(TravelEvent.plan_id.in_(plan_ids))
            .order_by(TravelEvent.plan_id, TravelDay.local_date, TravelEvent.sort_order).all())
    for ev, _d in rows:
        out[ev.plan_id].append(ev)
    return out


def segment_progress(events: List[TravelEvent], segment_to: Dict[Any, Any]) -> Dict[str, int]:
    """移動手段: 同じ日の続く 2 つの予定の間(区間)のうち、着く予定の区間が決まっている数"""
    by_day: Dict[Any, List[TravelEvent]] = defaultdict(list)
    for ev in events:
        by_day[ev.day_id].append(ev)
    need = 0
    done = 0
    for evs in by_day.values():
        for prev, cur in zip(evs, evs[1:]):
            need += 1
            if segment_to.get(cur.id) == prev.id:
                done += 1
    return {"need": need, "done": done}


def planning_detail(db: Session, trip: Dict[str, Any], events: List[TravelEvent],
                    readiness: Optional[Dict[str, Any]], packing_count: int,
                    segment_to: Dict[Any, Any]) -> Dict[str, Any]:
    """旅の準備の段階と、この旅行の次にやること"""
    seg = segment_progress(events, segment_to)
    steps = [
        {"key": "dates", "label": "行き先と日付",
         "done": bool(trip.get("start_date")) and bool(trip.get("destination") or trip.get("day_count"))},
        {"key": "places", "label": f"立ち寄る場所({len(events)} 件)" if events else "立ち寄る場所",
         "done": len(events) > 0},
        {"key": "moves", "label": "移動手段" if seg["need"] == seg["done"] else f"移動手段(あと {seg['need'] - seg['done']} 区間)",
         "done": seg["need"] > 0 and seg["need"] == seg["done"]},
        {"key": "ready", "label": "予約・確認" if not readiness or readiness["total"] == 0
         else f"予約・確認(あと {readiness['total']} 件)",
         "done": bool(readiness and readiness["is_ready"])},
        {"key": "packing", "label": "持ち物", "done": packing_count > 0},
    ]
    pid = trip["id"]
    tasks: List[Dict[str, Any]] = []
    for item in (readiness or {}).get("top") or []:
        tasks.append({"plan_id": pid, "trip_title": trip["title"], "kind": "ready",
                      "severity": item.get("severity") or "normal", "title": item.get("title") or "確認が要る項目",
                      "to": _safe_link(item.get("link"), f"/planner/{pid}/preparation"), "action": "開く"})
    if seg["need"] > seg["done"]:
        tasks.append({"plan_id": pid, "trip_title": trip["title"], "kind": "moves", "severity": "normal",
                      "title": f"移動手段を決める({seg['need'] - seg['done']} 区間)", "to": f"/planner/{pid}",
                      "action": "旅程へ"})
    if not events:
        tasks.append({"plan_id": pid, "trip_title": trip["title"], "kind": "places", "severity": "normal",
                      "title": "立ち寄る場所を足す", "to": f"/planner/{pid}", "action": "旅程へ"})
    if packing_count == 0:
        tasks.append({"plan_id": pid, "trip_title": trip["title"], "kind": "packing", "severity": "low",
                      "title": "持ち物リストを作る", "to": f"/planner/{pid}/preparation", "action": "準備へ"})
    return {
        "plan_id": pid,
        "event_count": len(events),
        "segments": seg,
        "steps": steps,
        "done": sum(1 for s in steps if s["done"]),
        "total": len(steps),
        "tasks": tasks,
    }


def _safe_link(link: Optional[str], default: str) -> str:
    """画面の中の道(/ で始まり、// で始まらない)だけ使う"""
    if isinstance(link, str) and link.startswith("/") and not link.startswith("//"):
        return link
    return default


_SEVERITY_ORDER = {"high": 0, "medium": 1, "normal": 2, "low": 3}


def merge_tasks(details: List[Dict[str, Any]], limit: int = MAX_TASKS) -> List[Dict[str, Any]]:
    """計画中の旅行ぜんぶの「次にやること」を重要な順に(同じ重さなら出発が近い旅行の順 = details の順)"""
    flat = [(i, j, t) for i, d in enumerate(details) for j, t in enumerate(d["tasks"])]
    flat.sort(key=lambda x: (_SEVERITY_ORDER.get(x[2]["severity"], 2), x[0], x[1]))
    return [t for _i, _j, t in flat[:limit]]


def collect(db: Session, user: User, trips: List[Dict[str, Any]], plans_by_id: Dict[str, Any],
            readiness_of) -> Dict[str, Any]:
    """ホーム v2 の追加の項目。trips は dashboard の _trip の形(phase 付き)。readiness_of(plan_id) → 準備の要約"""
    for t in trips:
        plan = plans_by_id.get(t["id"])
        t["shelf"] = shelf_of(t["phase"], getattr(plan, "status", None))
    plan_uuids = [plans_by_id[t["id"]].id for t in trips if t["id"] in plans_by_id]
    events = _events_by_plan(db, plan_uuids)

    # 写真・メモの数(見られるものだけ)
    visible = (Memory.author_user_id == user.id) | (Memory.visibility == "members")
    photo_counts: Dict[Any, int] = defaultdict(int)
    note_counts: Dict[Any, int] = defaultdict(int)
    if plan_uuids:
        for pid, kind, n in (db.query(Memory.plan_id, Memory.kind, func.count(Memory.id))
                             .filter(Memory.plan_id.in_(plan_uuids), visible)
                             .group_by(Memory.plan_id, Memory.kind).all()):
            if kind == "photo":
                photo_counts[pid] += int(n)
            elif kind == "note":
                note_counts[pid] += int(n)
    for t in trips:
        plan = plans_by_id.get(t["id"])
        pid = plan.id if plan is not None else None
        t["event_count"] = len(events.get(pid, [])) if pid else 0
        t["photo_count"] = photo_counts.get(pid, 0) if pid else 0
        t["note_count"] = note_counts.get(pid, 0) if pid else 0

    # 1. 計画中の旅行(出発が近い順・最大 5)の準備と次にやること
    planning = [t for t in trips if t["shelf"] == "planning"][:MAX_PLANNING]
    p_ids = [plans_by_id[t["id"]].id for t in planning]
    packing: Dict[Any, int] = defaultdict(int)
    segment_to: Dict[Any, Any] = {}
    if p_ids:
        for pid, n in (db.query(PackingItem.plan_id, func.count(PackingItem.id))
                       .filter(PackingItem.plan_id.in_(p_ids)).group_by(PackingItem.plan_id).all()):
            packing[pid] = int(n)
        for to_id, from_id in (db.query(TravelSegment.to_event_id, TravelSegment.from_event_id)
                               .filter(TravelSegment.plan_id.in_(p_ids), TravelSegment.to_event_id.isnot(None)).all()):
            segment_to[to_id] = from_id
    details = []
    for t in planning:
        plan = plans_by_id[t["id"]]
        details.append(planning_detail(db, t, events.get(plan.id, []), readiness_of(t["id"]), packing.get(plan.id, 0),
                                       segment_to))

    # 3. 旅の記録と思い出(行った旅。終わりが新しい順)
    visited = [t for t in trips if t["shelf"] == "visited"]
    recent: Optional[Dict[str, Any]] = None
    if visited:
        top = visited[0]
        plan = plans_by_id[top["id"]]
        photos = (db.query(Memory.id).filter(Memory.plan_id == plan.id, Memory.kind == "photo", visible,
                                             Memory.storage_key.isnot(None))
                  .order_by(Memory.occurred_at.desc().nullslast(), Memory.created_at.desc()).limit(MAX_PHOTOS).all())
        recent = {"plan_id": top["id"], "photo_ids": [str(r[0]) for r in photos]}
    timeline = [{"plan_id": t["id"], "title": t["title"], "start_date": t["start_date"], "end_date": t["end_date"],
                 "photo_count": t["photo_count"], "note_count": t["note_count"], "cover": t.get("cover")}
                for t in visited[:MAX_VISITED]]

    # 旅の足あと: 行った旅の行き先・予定の住所に書かれた都道府県、今年の旅の日数、写真の数
    # [Gate Footprints2] 住所・位置を見せない設定(event_address)の旅行は、予定の住所を数えない(行き先の名前だけ)
    from app.services import member_policy  # 循環 import を避ける
    addr_hidden = {t["id"] for t in trips if t["id"] in plans_by_id
                   and "event_address" in member_policy.hidden_for(db, plans_by_id[t["id"]], t.get("role"), user)}

    def addresses(t: Dict[str, Any]) -> List[Optional[str]]:
        if t["id"] in addr_hidden:
            return []
        return [ev.address for ev in events.get(plans_by_id[t["id"]].id, [])]

    this_year = None
    texts: List[Optional[str]] = []
    days_this_year = 0
    for t in visited:
        plan = plans_by_id[t["id"]]
        texts.append(plan.destination)
        texts.extend(addresses(t))
        today = date.fromisoformat(t["local_today"]) if t.get("local_today") else None
        this_year = this_year or (today.year if today else None)
        if t.get("end_date") and this_year and t["end_date"][:4] == str(this_year):
            days_this_year += int(t.get("total_days") or 0)
    planned_prefs = prefectures_in([plans_by_id[t["id"]].destination for t in planning]
                                   + [a for t in planning for a in addresses(t)])
    footprints = {
        "prefectures": prefectures_in(texts),
        "planned_prefectures": planned_prefs,
        "all_prefectures": list(PREFECTURES),
        "trips_visited": len(visited),
        "days_this_year": days_this_year,
        "photos": sum(t["photo_count"] for t in visited),
        **footprint_points(db, user, [t for t in trips if t["shelf"] in ("visited", "planning")], plans_by_id, events),
    }

    # 4. 行ってみたい場所(お気に入りのスポット)
    wish_rows = (db.query(Spot.id, Spot.name, Spot.category, Spot.address)
                 .join(UserSpotFavorite, UserSpotFavorite.spot_id == Spot.id)
                 .filter(UserSpotFavorite.user_id == user.id)
                 .order_by(UserSpotFavorite.created_at.desc()).limit(MAX_WISH).all())
    wish_count = db.query(func.count(UserSpotFavorite.id)).filter(UserSpotFavorite.user_id == user.id).scalar() or 0
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for sid, name, cat, addr in wish_rows:
        pref = prefectures_in([addr])
        groups[cat or "other"].append({"spot_id": str(sid), "name": name, "prefecture": pref[0] if pref else None})
    wishlist = {"count": int(wish_count), "groups": [{"category": k, "spots": v[:5], "count": len(v)}
                                                     for k, v in groups.items()]}

    return {
        "shelves": {s: sum(1 for t in trips if t["shelf"] == s) for s in SHELVES},
        "planning": details,
        "tasks": merge_tasks(details),
        "memories": {"recent": recent, "timeline": timeline},
        "footprints": footprints,
        "wishlist": wishlist,
    }
