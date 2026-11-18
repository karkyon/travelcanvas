"""[Gate SpotMode] FR-060 スポットモードの計算(DB を書かない)。

- guess_genre: 候補の名前・種類・メモからジャンル(食べ歩き・カフェ・お土産・見どころ・休憩)を推す。人が直せる
- seats / fit: 座れそうか・屋内か(天気の判定 weather_fit と同じ言葉)。案内の札に使うだけで、確かではない
- suggest_clusters: 位置のある候補が近くにまとまっている所(既定 400m)を、エリアの案として返す
- distance_m: 2 点の直線の距離(m)。道順ではない(画面では「直線の目安」と書く)
- walks_for: 旅帖(旅行記の下書き)に入れる「自由に歩いた順」(着いた時刻の順。その日の時間帯の時刻)
"""
import math
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

GENRES: Dict[str, str] = {"food": "食べ歩き", "cafe": "カフェ", "gift": "お土産", "sight": "見どころ",
                          "rest": "休憩・トイレ", "other": "そのほか"}
PRIORITIES = ("want", "maybe")
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
MAX_ITEMS = 40
CLUSTER_M = 400
CLUSTER_MIN = 3

_WORDS: List[Tuple[str, Tuple[str, ...]]] = [
    ("rest", ("トイレ", "休憩", "ベンチ", "公園", "ロッカー", "案内所")),
    ("cafe", ("カフェ", "珈琲", "コーヒー", "喫茶", "茶房", "cafe", "coffee", "ティー")),
    ("gift", ("土産", "みやげ", "おみやげ", "雑貨", "物産", "ショップ", "売店", "市場", "の店", "商店", "shop")),
    ("food", ("うどん", "そば", "蕎麦", "寿司", "鮨", "ラーメン", "食堂", "レストラン", "焼", "コロッケ", "団子", "餅",
              "甘味", "スイーツ", "パン", "カツ", "揚げ", "丼", "グルメ", "食べ", "ランチ", "定食", "赤福", "豚", "牛",
              "海鮮", "肉", "菓子", "饅頭", "まんじゅう", "アイス")),
    ("sight", ("神社", "神宮", "寺", "城", "館", "座", "展望", "庭園", "橋", "通り", "横丁", "美術", "博物", "記念",
               "鳥居", "宮", "滝", "海岸", "岩", "体験")),
]
_SEAT_WORDS = ("食堂", "レストラン", "カフェ", "喫茶", "珈琲", "うどん", "そば", "蕎麦", "寿司", "ラーメン", "茶屋",
               "定食", "休憩", "ベンチ", "茶房", "座", "甘味処")


def _text(*parts: Optional[str]) -> str:
    return " ".join(p for p in parts if p).lower()


def guess_genre(title: Optional[str], category: Optional[str] = None, note: Optional[str] = None) -> str:
    t = _text(title, category, note)
    for genre, words in _WORDS:
        if any(w.lower() in t for w in words):
            return genre
    return "other"


def seats(title: Optional[str], category: Optional[str], genre: str) -> bool:
    if genre in ("cafe", "rest"):
        return True
    t = _text(title, category)
    return any(w in t for w in _SEAT_WORDS)


def distance_m(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    r = 6371000.0
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dla, dlo = la2 - la1, math.radians(b[1] - a[1])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def center_of(points: Sequence[Tuple[float, float]]) -> Optional[Tuple[float, float]]:
    if not points:
        return None
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def radius_for(center: Tuple[float, float], points: Iterable[Tuple[float, float]]) -> int:
    far = max((distance_m(center, p) for p in points), default=0.0)
    return int(min(3000, max(200, math.ceil((far + 80) / 50.0) * 50)))


def suggest_clusters(cands: Sequence[Any], used_ids: Iterable[Any] = (), within_m: int = CLUSTER_M,
                     min_size: int = CLUSTER_MIN, limit: int = 5) -> List[Dict[str, Any]]:
    """位置のある候補(見送り・まとめた物を除く。既にエリアにある物も除く)を、近い物どうしでまとめた案。
    優先の高い候補から順に、その候補から within_m 以内の物を集める(貪欲)。min_size 件以上の所だけ返す。"""
    used = set(used_ids)
    pool = [c for c in cands if c.latitude is not None and c.longitude is not None and c.id not in used
            and c.status != "dismissed" and not c.merged_into_id]
    pool.sort(key=lambda c: (-(c.priority or 0), str(c.created_at or ""), str(c.id)))
    taken: set = set()
    out: List[Dict[str, Any]] = []
    for seed in pool:
        if seed.id in taken:
            continue
        sp = (float(seed.latitude), float(seed.longitude))
        group = [c for c in pool if c.id not in taken
                 and distance_m(sp, (float(c.latitude), float(c.longitude))) <= within_m]
        if len(group) < min_size:
            continue
        pts = [(float(c.latitude), float(c.longitude)) for c in group]
        center = center_of(pts)
        assert center is not None
        taken.update(c.id for c in group)
        out.append({"title": "%sの周り" % seed.title[:40], "center_latitude": round(center[0], 6),
                    "center_longitude": round(center[1], 6), "radius_m": radius_for(center, pts),
                    "candidates": [{"candidate_id": str(c.id), "title": c.title,
                                    "genre": guess_genre(c.title, c.category, c.note)} for c in group]})
        if len(out) >= limit:
            break
    return out


def walks_for(db: Any, plan_id: Any) -> List[Dict[str, Any]]:
    """[Gate SpotMode-2] 着いた候補を、エリアごとに着いた時刻の順で返す(旅帖の下書きに使う)。
    返す物: [{day_id, area_title, stops: [{title, time}]}]。日の無いエリアは day_id=None。位置は入れない。"""
    from zoneinfo import ZoneInfo

    from app.models.models import SpotArea, SpotAreaItem, TravelDay
    areas = db.query(SpotArea).filter(SpotArea.plan_id == plan_id).all()
    if not areas:
        return []
    days = {d.id: d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan_id).all()}
    out: List[Dict[str, Any]] = []
    for a in sorted(areas, key=lambda x: (x.start_time or "99:99", str(x.id))):
        visited = db.query(SpotAreaItem).filter(SpotAreaItem.area_id == a.id,
                                                SpotAreaItem.visited_at.isnot(None)).all()
        if not visited:
            continue
        visited.sort(key=lambda i: (i.visited_at, str(i.id)))
        day = days.get(a.day_id) if a.day_id else None
        try:
            tz = ZoneInfo(day.timezone_id) if day and day.timezone_id else None
        except Exception:  # noqa: BLE001 - 時間帯が読めなければ UTC のまま
            tz = None
        stops = [{"title": i.candidate.title,
                  "time": (i.visited_at.astimezone(tz) if tz else i.visited_at).strftime("%H:%M")} for i in visited]
        out.append({"day_id": str(a.day_id) if a.day_id else None, "area_title": a.title, "stops": stops})
    return out
