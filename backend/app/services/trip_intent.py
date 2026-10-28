"""[Gate G11] 行き先が未定の旅行相談(G11 の段階5 Intake。docs/ux/G11_UIUX全範囲_実装仕様.md §3.5)。

希望を伝える → 条件の確認 → 方面の比較 → 旅程の下書き。設計の規則:
- 文章からの読み取りは決まった規則(正規表現)だけで行う。AI の provider は未接続(読み取りの結果は「文章から読み取った
  候補 · 未確認」と示し、AI の判断とは言わない)。利用者が確かめるまで条件として使わない
- 方面の候補は利用者が書いた方面(と画面で足した方面)だけ。自動の方面の提案の provider は未接続(作らない)
- 位置は地名の照会(Nominatim)の結果だけ。取れなければ「未照会」。直線距離は計算値(道路の距離ではない)
- 運転時間・宿の料金と空室・混み具合・営業時間は provider が未接続か日付待ち。値を作らない
- 旅の個人的な理由(記念など)は確認の画面に出すだけで、旅行・共有の予定には書かない
"""
from __future__ import annotations

import asyncio
import math
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import httpx

GEOCODE_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "TravelCanvas/1.0 (+https://github.com/karkyon/travelcanvas)"
REQUEST_TIMEOUT = httpx.Timeout(8.0)
# Nominatim の利用の条件(1秒に1回まで)を守る。同じ地名は1日覚えておき、何度も問い合わせない
GEOCODE_INTERVAL_S = 1.0
GEOCODE_CACHE_TTL_S = 24 * 3600
# 高速道路で出せる速さの上限の目安(km/h)。直線距離をこれで割った時間は、実際の運転時間の下限になる
LOWER_BOUND_SPEED_KMH = 100.0
MAX_AREAS = 10

SOURCES = ("user_input", "text", "unspecified")
STRENGTHS = ("required", "preferred", "undecided")
TRANSPORTS = ("car", "public", "undecided")
ROOMS = ("same_room", "multiple_rooms", "undecided")
BUDGET_SCOPES = ("total", "per_person", "undecided")
DATE_STATUSES = ("undecided", "window", "fixed")
PREFERENCES = {
    "quiet": "人混みを避けて静かに",
    "calm": "落ち着いた観光",
    "food": "食を楽しむ",
    "scenery": "絶景・自然",
    "culture": "歴史・文化",
    "onsen": "温泉",
    "flexible_meals": "食事は宿でも外食でも",
}
_PREF_WORDS: List[Tuple[str, str]] = [
    ("quiet", r"人(が|の)?多(すぎ|く)?ない|混雑|混ま|静か|人混み"),
    ("calm", r"落ち着い|のんびり|ゆっくり"),
    ("food", r"焼き?肉|グルメ|食べ歩き|海鮮|美味しい|おいしい"),
    ("scenery", r"絶景|景色|自然|海辺|湖|山"),
    ("culture", r"歴史|寺|神社|文化|城"),
    ("onsen", r"温泉"),
    ("flexible_meals", r"食事は.{0,10}(宿|外食).{0,10}(でも|も)"),
]
_PURPOSE = re.compile(r"(記念|誕生日|結婚|卒業|就職|入学|退職|還暦|お祝い|社会人)")
_PERSONAL_NOTE = "個人的な理由(共有の予定・旅行の説明には書きません)"


def now() -> datetime:
    return datetime.now(timezone.utc)


def normalize(text: Optional[str]) -> str:
    t = unicodedata.normalize("NFKC", text or "")
    return t.replace("〜", "~").replace("～", "~").replace("―", "-")


def _snippet(text: str, m: Optional[re.Match]) -> Optional[str]:
    if not m:
        return None
    start = max(0, m.start() - 6)
    return text[start:m.end() + 4].strip()[:40]


def _item(key: str, label: str, value: Any, display: str, source: str, strength: str = "undecided",
          evidence: Optional[str] = None, question: Optional[Dict[str, Any]] = None, note: Optional[str] = None,
          sensitive: bool = False) -> Dict[str, Any]:
    return {"key": key, "label": label, "value": value, "display": display, "source": source, "strength": strength,
            "evidence": evidence, "question": question, "needs_answer": question is not None, "note": note,
            "sensitive": sensitive}


# ======================================================================== 文章からの読み取り

def _origin(text: str) -> Tuple[Optional[str], Optional[re.Match]]:
    m = re.search(r"([一-龯ぁ-んァ-ヶー々]{1,12}?)(?:市|町|村|区)?から(?:は)?(?:車|自家用車|マイカー|電車|新幹線|バス|出発|行)",
                  text)
    if m and m.group(1) not in ("家", "自宅", "うち", "ここ"):
        return m.group(1), m
    return None, None


def _party(text: str) -> Tuple[Optional[int], Optional[re.Match]]:
    m = re.search(r"(?:家族|大人|友人|友達|夫婦|親子)?\s*(\d{1,2})\s*人(?:で|家族|旅|の|、|。|\s)", text)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 30:
            return n, m
    return None, None


def _nights(text: str) -> Tuple[Optional[int], Optional[re.Match]]:
    m = re.search(r"(\d)\s*泊\s*(\d)\s*日", text)
    if m and int(m.group(2)) == int(m.group(1)) + 1:
        return int(m.group(1)), m
    m = re.search(r"日帰り", text)
    if m:
        return 0, m
    return None, None


def _transport(text: str) -> Tuple[Optional[str], bool, Optional[re.Match]]:
    m = re.search(r"自家用車|マイカー|レンタカー|車で|車移動|ドライブ", text)
    highway = bool(re.search(r"高速", text))
    if m:
        return "car", highway, m
    m = re.search(r"電車|新幹線|公共交通|特急|バスで", text)
    if m:
        return "public", False, m
    return None, highway, None


def _one_way(text: str) -> Tuple[Optional[float], Optional[str], Optional[re.Match]]:
    m = re.search(r"片道\s*(\d+(?:\.\d+)?)\s*時間(半)?\s*(くらい|程度|ほど|目安|以内|まで|未満)?\s*(まで|以内)?", text)
    if not m:
        return None, None, None
    hours = float(m.group(1)) + (0.5 if m.group(2) else 0.0)
    soft = m.group(3) in ("くらい", "程度", "ほど", "目安")
    return hours, ("preferred" if soft else None), m


def _room(text: str) -> Tuple[Optional[str], Optional[re.Match]]:
    m = re.search(r"\d\s*人\s*(?:で)?\s*(?:1|一)\s*(?:部屋|室)|同じ部屋|一部屋|1部屋|同室", text)
    if m:
        return "same_room", m
    m = re.search(r"別々の部屋|(?:2|二|複数)\s*部屋", text)
    if m:
        return "multiple_rooms", m
    return None, None


def _budget(text: str) -> Tuple[Optional[int], Optional[int], Optional[str], Optional[re.Match]]:
    m = re.search(r"(\d+(?:\.\d+)?)\s*[~\-ー]\s*(\d+(?:\.\d+)?)\s*万円", text)
    if m:
        lo, hi = int(float(m.group(1)) * 10000), int(float(m.group(2)) * 10000)
    else:
        m = re.search(r"(\d+(?:\.\d+)?)\s*万円", text)
        if not m:
            return None, None, None, None
        lo = hi = int(float(m.group(1)) * 10000)
    before = text[max(0, m.start() - 12):m.start()]
    scope = None
    if re.search(r"(\d+)\s*人で|合計|全員で|総額", before):
        scope = "total"
    elif re.search(r"(1|一)\s*人(あたり|当たり|につき)?", before):
        scope = "per_person"
    return min(lo, hi), max(lo, hi), scope, m


def _dates(text: str) -> Tuple[str, Optional[str], Optional[re.Match]]:
    m = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日", text)
    if m:
        return "fixed", f"{m.group(1)}月{m.group(2)}日(文章の表記)", m
    m = re.search(r"(?:約|およそ)?\s*(\d+|一|ひと)\s*(?:か|ヶ|カ|ケ)月後|来月|再来月|週末|連休|夏休み|年末|GW|ゴールデンウィーク", text)
    if m:
        return "window", m.group(0).strip(), m
    return "undecided", None, None


def _areas(text: str) -> List[str]:
    """利用者が書いた候補の方面(「AやB、Cなどが候補」「候補は A・B」)。地名の辞書は持たない(書かれた語だけ)"""
    found: List[str] = []
    spans: List[str] = []
    for m in re.finditer(r"([^。\n]{1,120}?)(?:など|とか|あたり)?\s*(?:が|を|も)?\s*候補", text):
        spans.append(m.group(1))
    for m in re.finditer(r"候補(?:地)?(?:は|として)[:：]?\s*([^。\n]{1,120})", text):
        spans.append(m.group(1))
    for span in spans:
        # 括弧の中の分け方(滋賀(湖東/湖西))を「滋賀・湖東」「滋賀・湖西」へ
        span = re.sub(r"([^\s、,(]+)\(([^)]+)\)",
                      lambda mm: "、".join(f"{mm.group(1)}・{p.strip()}" for p in re.split(r"[/、,]", mm.group(2))
                                          if p.strip()), span)
        span = re.split(r"[はで](?=[^、,]*[、,])", span)[-1] if re.search(r"[、,]", span) else span
        for part in re.split(r"[、,/]|や|とか|または|もしくは|か(?=[一-龯ァ-ヶ])", span):
            word = re.sub(r"^(?:候補|方面)(?:は|として)?", "", part.strip())
            word = re.sub(r"(?:など|とか|あたり|方面|周辺|エリア|の辺り|の方)$", "", word).strip(" ・")
            if 1 <= len(word) <= 15 and re.search(r"[一-龯ァ-ヶA-Za-z]", word) and not re.search(r"[ぁ-ん]{3,}", word):
                if word not in found:
                    found.append(word)
    return found[:MAX_AREAS]


def extract(text: str, fields: Dict[str, Any]) -> Dict[str, Any]:
    """文章と画面の項目から、確かめる条件の一覧を作る。画面の項目(あなたの入力)を文章より優先する"""
    t = normalize(text)
    items: List[Dict[str, Any]] = []

    origin_field = (fields.get("origin") or "").strip()
    origin_text, om = _origin(t)
    if origin_field:
        items.append(_item("origin", "出発地", origin_field, origin_field, "user_input", "required"))
    elif origin_text:
        items.append(_item("origin", "出発地", origin_text, origin_text, "text", "required", _snippet(t, om)))
    else:
        items.append(_item("origin", "出発地", None, "未指定", "unspecified", "undecided",
                           note="方面の比較(位置と直線距離)に使います。市区町村まで入力してください"))

    party_field = fields.get("party_size")
    party_text, pm = _party(t)
    if party_field:
        items.append(_item("party_size", "人数", int(party_field), f"大人{int(party_field)}人", "user_input", "required"))
    elif party_text:
        items.append(_item("party_size", "人数", party_text, f"{party_text}人", "text", "required", _snippet(t, pm)))
    else:
        items.append(_item("party_size", "人数", None, "未指定", "unspecified"))

    nights_field = fields.get("nights")
    nights_text, nm = _nights(t)
    nights = nights_field if nights_field is not None else nights_text
    label = (lambda n: "日帰り" if n == 0 else f"{n}泊{n + 1}日")
    if nights_field is not None:
        items.append(_item("nights", "旅行の日数", int(nights_field), label(int(nights_field)), "user_input", "required"))
    elif nights_text is not None:
        items.append(_item("nights", "旅行の日数", nights_text, label(nights_text), "text", "required", _snippet(t, nm)))
    else:
        items.append(_item("nights", "旅行の日数", None, "未指定", "unspecified"))

    transport_field = fields.get("transport")
    tr_text, highway, tm = _transport(t)
    if transport_field in ("car", "public"):
        hw = bool(fields.get("highway", highway))
        disp = "自家用車" + (" · 高速道路を使う" if hw and transport_field == "car" else "") if transport_field == "car" \
            else "公共交通"
        items.append(_item("transport", "移動手段", {"mode": transport_field, "highway": hw}, disp, "user_input",
                           "required"))
    elif tr_text:
        disp = "自家用車" + (" · 高速道路を使う" if highway else "") if tr_text == "car" else "公共交通"
        items.append(_item("transport", "移動手段", {"mode": tr_text, "highway": highway}, disp, "text", "required",
                           _snippet(t, tm)))
    else:
        items.append(_item("transport", "移動手段", None, "未指定", "unspecified"))

    hours, soft, hm = _one_way(t)
    strength_field = fields.get("one_way_strength")
    hours_field = fields.get("one_way_hours")
    if hours_field:
        hours = float(hours_field)
    if hours:
        q = None if strength_field in ("preferred", "required") else {
            "id": "one_way_strength", "text": f"片道{_hours_label(hours)}は、希望ですか、絶対条件ですか",
            "options": [{"value": "preferred", "label": "希望"}, {"value": "required", "label": "絶対条件"}],
            "suggested": soft,
            "hint": "希望なら少し超える方面も比べます。絶対条件なら、明らかに超える方面に印を付けます"}
        items.append(_item("one_way", "片道の移動時間", hours, f"{_hours_label(hours)}くらいまで",
                           "user_input" if hours_field else "text",
                           strength_field if strength_field in ("preferred", "required") else "undecided",
                           _snippet(t, hm), q))
    else:
        items.append(_item("one_way", "片道の移動時間", None, "指定なし", "unspecified"))

    room_field = fields.get("room")
    room_text, rm = _room(t)
    room = room_field if room_field in ("same_room", "multiple_rooms") else room_text
    if room:
        disp = "全員で同じ部屋" if room == "same_room" else "複数の部屋でもよい"
        items.append(_item("room", "部屋", room, disp, "user_input" if room_field in ROOMS[:2] else "text", "required",
                           None if room_field else _snippet(t, rm)))
    else:
        items.append(_item("room", "部屋", None, "未指定", "unspecified"))

    lo, hi, scope_text, bm = _budget(t)
    scope_field = fields.get("budget_scope")
    if lo is not None and hi is not None:
        scope = scope_field if scope_field in ("total", "per_person") else None
        disp = f"{lo // 10000}〜{hi // 10000}万円" if lo != hi else f"{lo // 10000}万円"
        q = None if scope else {
            "id": "budget_scope", "text": f"{disp}は、全員の合計(1部屋・1泊)ですか、1人あたりですか",
            "options": [{"value": "total", "label": "全員の合計"}, {"value": "per_person", "label": "1人あたり"}],
            "suggested": scope_text,
            "hint": "宿を探す時の条件になります。税・食事の有無は宿を照会する時に確かめます"}
        items.append(_item("budget", "宿泊費の目安", {"min": lo, "max": hi, "scope": scope}, disp, "text", "preferred",
                           _snippet(t, bm), q))
    else:
        items.append(_item("budget", "宿泊費の目安", None, "未指定", "unspecified"))

    status, window, dm = _dates(t)
    window_field = (fields.get("travel_window") or "").strip()
    start_field = fields.get("start_date")
    if start_field:
        items.append(_item("dates", "日程", {"status": "fixed", "start_date": str(start_field)}, f"{start_field} から",
                           "user_input", "required"))
    elif window_field or window:
        disp = window_field or window or ""
        items.append(_item("dates", "日程", {"status": "window" if status != "fixed" else "fixed", "text": disp},
                           f"{disp} · 日付は未確定", "user_input" if window_field else "text", "undecided",
                           None if window_field else _snippet(t, dm),
                           note="宿の空室・料金と営業日は、日付が決まってから照会します"))
    else:
        items.append(_item("dates", "日程", {"status": "undecided"}, "未定", "unspecified",
                           note="宿の空室・料金と営業日は、日付が決まってから照会します"))

    prefs_field = [p for p in (fields.get("preferences") or []) if p in PREFERENCES]
    prefs_text = [k for k, pat in _PREF_WORDS if re.search(pat, t)]
    prefs = list(dict.fromkeys(prefs_field + prefs_text))
    if prefs:
        items.append(_item("preferences", "過ごし方", prefs, "、".join(PREFERENCES[p] for p in prefs),
                           "user_input" if prefs_field and not set(prefs_text) - set(prefs_field) else "text",
                           "preferred"))
    else:
        items.append(_item("preferences", "過ごし方", [], "未指定", "unspecified"))

    pm2 = _PURPOSE.search(t)
    if pm2:
        items.append(_item("purpose", "旅の理由", None, _PERSONAL_NOTE, "text", "undecided", None,
                           note="確認のためだけに示します。保存も共有もしません", sensitive=True))

    areas_text = _areas(t)
    areas_field = [a.strip() for a in (fields.get("areas") or []) if isinstance(a, str) and a.strip()]
    areas = list(dict.fromkeys(areas_field + areas_text))[:MAX_AREAS]
    return {"items": items, "areas": [{"name": a, "source": "user_input"} for a in areas],
            "nights": nights, "extractor": "text_rules", "ai_connected": False}


def _hours_label(hours: float) -> str:
    whole = int(hours)
    return f"{whole}時間半" if hours - whole >= 0.5 else f"{whole}時間"


# ======================================================================== 地名の照会(方面の比較)

@dataclass
class GeocodeResult:
    status: str  # ok / not_found / unavailable / disabled
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    label: Optional[str] = None
    provider: Optional[str] = None
    source_url: Optional[str] = None
    retrieved_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        d = dict(self.__dict__)
        d["retrieved_at"] = self.retrieved_at.isoformat() if self.retrieved_at else None
        return d


Geocoder = Callable[[str], Awaitable[GeocodeResult]]
_cache: Dict[str, Tuple[float, GeocodeResult]] = {}
_lock = asyncio.Lock()
_last_call = 0.0
_override: Optional[Geocoder] = None


def area_query(name: str) -> str:
    return re.sub(r"[・()/]", " ", normalize(name)).strip()


async def nominatim_geocode(name: str, transport: Optional[httpx.AsyncBaseTransport] = None) -> GeocodeResult:
    global _last_call
    q = area_query(name)
    hit = _cache.get(q)
    if hit and time.monotonic() - hit[0] < GEOCODE_CACHE_TTL_S:
        return hit[1]
    async with _lock:
        wait = GEOCODE_INTERVAL_S - (time.monotonic() - _last_call)
        if wait > 0 and transport is None:
            await asyncio.sleep(wait)
        _last_call = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, transport=transport, follow_redirects=False,
                                         headers={"User-Agent": USER_AGENT}) as client:
                resp = await client.get(GEOCODE_URL, params={"q": q, "format": "json", "limit": "1",
                                                             "accept-language": "ja"})
            if resp.status_code != 200:
                return GeocodeResult(status="unavailable", provider="nominatim")
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            return GeocodeResult(status="unavailable", provider="nominatim")
    if not isinstance(data, list) or not data:
        result = GeocodeResult(status="not_found", provider="nominatim", retrieved_at=now())
    else:
        item = data[0]
        try:
            lat, lng = float(item["lat"]), float(item["lon"])
        except (KeyError, TypeError, ValueError):
            return GeocodeResult(status="unavailable", provider="nominatim")
        result = GeocodeResult(
            status="ok", latitude=lat, longitude=lng,
            label=str(item.get("display_name") or q).split(",")[0][:80], provider="nominatim",
            source_url=f"https://www.openstreetmap.org/{item.get('osm_type')}/{item.get('osm_id')}"
            if item.get("osm_type") and item.get("osm_id") else None,
            retrieved_at=now())
    _cache[q] = (time.monotonic(), result)
    return result


def set_geocoder_for_testing(geocoder: Optional[Geocoder]) -> None:
    global _override
    _override = geocoder
    _cache.clear()


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def limit_check(straight_km: Optional[float], one_way_hours: Optional[float],
                strength: Optional[str]) -> Dict[str, Any]:
    """片道の時間の条件と方面。運転時間は未照会なので、直線距離から分かる「明らかに超える」だけを示す"""
    if not one_way_hours:
        return {"status": "no_limit", "note": "片道の時間の条件はありません"}
    if straight_km is None:
        return {"status": "unknown", "note": "位置を照会できないため、条件に合うかは分かりません"}
    lower = straight_km / LOWER_BOUND_SPEED_KMH
    if lower > one_way_hours:
        level = "exceeds" if strength == "required" else "likely_exceeds"
        return {"status": level, "lower_bound_hours": round(lower, 1),
                "note": f"直線距離だけでも片道{_hours_label(one_way_hours)}を超えます(時速{int(LOWER_BOUND_SPEED_KMH)}kmでの下限)"}
    return {"status": "unknown",
            "note": "運転時間は未照会のため、条件に合うかはまだ分かりません(直線距離では超えません)"}


async def compare_areas(origin: str, areas: List[str], one_way_hours: Optional[float],
                        one_way_strength: Optional[str], enabled: bool = True) -> Dict[str, Any]:
    geocode: Geocoder = _override or nominatim_geocode
    if not enabled:
        geocode = _disabled
    o = await geocode(origin) if origin else GeocodeResult(status="unavailable")
    out: List[Dict[str, Any]] = []
    for name in areas[:MAX_AREAS]:
        g = await geocode(name)
        straight = None
        if o.status == "ok" and g.status == "ok" and None not in (o.latitude, o.longitude, g.latitude, g.longitude):
            straight = round(haversine_km(o.latitude, o.longitude, g.latitude, g.longitude),  # type: ignore[arg-type]
                             1)
        out.append({
            "name": name, "source": "user_input", "geocode": g.to_dict(), "straight_km": straight,
            "drive": {"status": "not_connected", "note": "実走行時間・高速料金は道路の提供元が未接続のため未照会"},
            "limit_check": limit_check(straight, one_way_hours, one_way_strength),
            "lodging": {"status": "not_connected", "note": "4人1室の料金・空室は宿の提供元が未接続(日付が決まっても照会できません)"},
            "quietness": {"status": "unverified", "note": "混み具合のデータは未接続。静かかどうかは確かめていません"},
            "hours": {"status": "date_pending", "note": "営業時間は日付と行き先の場所が決まってから照会します"},
        })
    return {"origin": {"query": origin, **o.to_dict()}, "areas": out, "retrieved_at": now().isoformat(),
            "providers": {"geocode": "nominatim" if enabled else None, "route": None, "lodging": None, "crowd": None,
                          "destination_suggestions": None}}


async def _disabled(name: str) -> GeocodeResult:
    return GeocodeResult(status="disabled")


# ======================================================================== 旅程の下書き

PARTS = ("morning", "lunch", "afternoon", "evening", "stay")
PART_LABEL = {"morning": "午前", "lunch": "昼食", "afternoon": "午後", "evening": "夕方・夕食", "stay": "宿"}
FOOD_CATEGORIES = frozenset({"restaurant", "cafe", "fast_food", "food_court", "ice_cream", "marketplace", "bakery",
                             "deli", "seafood", "butcher", "greengrocer"})
EVENT_TYPE_OF_PART = {"lunch": "dining", "evening": "dining", "stay": "accommodation"}


def day_parts(day: int, total_days: int) -> List[str]:
    parts = ["morning", "lunch", "afternoon", "evening"]
    if day < total_days:
        parts.append("stay")
    return parts


def initial_slots(candidates: List[Dict[str, Any]], nights: int) -> List[Dict[str, Any]]:
    """選んだ候補を下書きの日・時間帯へ順に並べる(食べ物は昼食・夕方へ。宿の欄は空のまま。全て後から動かせる)"""
    total_days = nights + 1
    food = [c for c in candidates if (c.get("category") or "") in FOOD_CATEGORIES]
    other = [c for c in candidates if c not in food]
    slots: List[Dict[str, Any]] = []
    order = [(d, p) for d in range(1, total_days + 1) for p in ("morning", "afternoon")]
    meal = [(d, p) for d in range(1, total_days + 1) for p in ("lunch", "evening")
            if not (p == "evening" and d == total_days)]
    for i, c in enumerate(other):
        d, p = order[i % len(order)]
        slots.append({"day": d, "part": p, "candidate_id": c["id"]})
    for i, c in enumerate(food):
        d, p = meal[i % len(meal)] if meal else (1, "lunch")
        slots.append({"day": d, "part": p, "candidate_id": c["id"]})
    return sort_slots(slots)


def sort_slots(slots: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    indexed = list(enumerate(slots))
    indexed.sort(key=lambda x: (x[1]["day"], PARTS.index(x[1]["part"]), x[0]))
    return [s for _i, s in indexed]


def check_slots(slots: List[Dict[str, Any]], nights: int, candidate_ids: set) -> Optional[str]:
    total_days = nights + 1
    seen = set()
    for s in slots:
        if not isinstance(s.get("day"), int) or not 1 <= s["day"] <= total_days:
            return "日が旅行の日数の外です"
        if s.get("part") not in day_parts(s["day"], total_days):
            return "時間帯が正しくありません(最後の日に宿は置けません)"
        if s.get("candidate_id") not in candidate_ids:
            return "この旅行の候補ではないものが含まれています"
        if s["candidate_id"] in seen:
            return "同じ候補を2回置いています"
        seen.add(s["candidate_id"])
    return None
