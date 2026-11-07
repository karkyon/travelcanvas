"""[Gate SpotInfo] 食事の場所の情報(ジャンル・予算・営業時間・予約・駐車場・支払い・席・雰囲気など)。

グルメサイト(ホットペッパーグルメのお店の情報・食べログの店舗基本情報)が載せている項目を参考に、旅の計画で
「行くかどうか・いつ行くか・どう行くか」を決めるのに効く項目へ絞った。値は利用者が入れるか、OpenStreetMap の
タグ(cuisine・opening_hours・payment:*・smoking・reservation・takeaway・capacity など)から候補として読む。
外のサイトの文章・写真・評価は写さない(それぞれの規約のため)。

保存の形は JSON(行きたい場所 spots.dining・予定 travel_events.dining)。知らない値は捨てずに 422 で断る。
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ジャンル(画面の並び順)。キー → 表示名
GENRES: Dict[str, str] = {
    "washoku": "和食", "sushi": "寿司", "kaisen": "海鮮", "ramen": "ラーメン", "soba_udon": "そば・うどん",
    "yakiniku": "焼肉", "yakitori": "焼き鳥", "tempura": "天ぷら", "tonkatsu": "とんかつ・揚げ物",
    "okonomiyaki": "お好み焼き・粉もの", "kyodo": "郷土料理", "izakaya": "居酒屋", "nabe": "鍋",
    "unagi": "うなぎ", "teishoku": "定食・食堂", "curry": "カレー", "chinese": "中華", "korean": "韓国料理",
    "asian": "アジア・エスニック", "italian": "イタリアン", "french": "フレンチ", "western": "洋食",
    "steak": "ステーキ・ハンバーグ", "burger": "ハンバーガー", "cafe": "カフェ", "sweets": "スイーツ・甘味",
    "bakery": "パン", "bar": "バー・お酒", "buffet": "ビュッフェ", "other": "その他",
}
# 予算(1 人あたり)。キー → 表示名
BUDGETS: Dict[str, str] = {
    "u1000": "〜1,000円", "1000_2000": "1,000〜2,000円", "2000_3000": "2,000〜3,000円",
    "3000_5000": "3,000〜5,000円", "5000_10000": "5,000〜10,000円", "10000_20000": "10,000〜20,000円",
    "o20000": "20,000円〜",
}
PAYMENTS = ("cash", "card", "emoney", "qr")
FEATURES = ("kids", "takeout", "vegetarian", "english_menu", "outdoor", "view", "counter", "tatami", "wheelchair",
            "lunch", "late_night", "all_you_can_drink", "pet", "wifi")
MOODS = ("date", "family", "solo", "friends", "business", "local")

MAX_GENRES = 3


class DiningInfo(BaseModel):
    """食事の場所の情報(全て任意)"""
    model_config = ConfigDict(extra="forbid")

    genres: List[str] = Field(default_factory=list, max_length=MAX_GENRES)
    signature: Optional[str] = Field(None, max_length=200, description="名物・おすすめの料理")
    budget_lunch: Optional[str] = None
    budget_dinner: Optional[str] = None
    hours: Optional[str] = Field(None, max_length=300, description="営業時間(自由に書く)")
    closed: Optional[str] = Field(None, max_length=100, description="定休日")
    reservation: Optional[Literal["required", "recommended", "possible", "not_accepted"]] = None
    parking: Optional[Literal["yes", "nearby", "none"]] = None
    parking_note: Optional[str] = Field(None, max_length=100)
    seats: Optional[int] = Field(None, ge=1, le=5000)
    private_room: Optional[bool] = None
    smoking: Optional[Literal["no", "separated", "yes"]] = None
    payment: List[Literal["cash", "card", "emoney", "qr"]] = Field(default_factory=list, max_length=4)
    features: List[str] = Field(default_factory=list, max_length=len(FEATURES))
    moods: List[str] = Field(default_factory=list, max_length=len(MOODS))
    access: Optional[str] = Field(None, max_length=200, description="最寄り駅・行き方")
    wait_note: Optional[str] = Field(None, max_length=100, description="混み具合・待ち時間の目安")

    @field_validator("genres")
    @classmethod
    def _genres(cls, v: List[str]) -> List[str]:
        bad = [g for g in v if g not in GENRES]
        if bad:
            raise ValueError("知らないジャンルです")
        return list(dict.fromkeys(v))

    @field_validator("budget_lunch", "budget_dinner")
    @classmethod
    def _budget(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in BUDGETS:
            raise ValueError("知らない予算の区分です")
        return v

    @field_validator("features")
    @classmethod
    def _features(cls, v: List[str]) -> List[str]:
        if any(x not in FEATURES for x in v):
            raise ValueError("知らない特徴です")
        return list(dict.fromkeys(v))

    @field_validator("moods")
    @classmethod
    def _moods(cls, v: List[str]) -> List[str]:
        if any(x not in MOODS for x in v):
            raise ValueError("知らない場面です")
        return list(dict.fromkeys(v))

    @field_validator("payment")
    @classmethod
    def _payment(cls, v: List[str]) -> List[str]:
        return list(dict.fromkeys(v))

    @field_validator("signature", "hours", "closed", "parking_note", "access", "wait_note")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        return (v or "").strip() or None


def to_json(info: Optional[DiningInfo]) -> Optional[Dict[str, Any]]:
    """保存の形(空の項目は持たない。全て空なら None)"""
    if info is None:
        return None
    d = {k: v for k, v in info.model_dump().items() if v not in (None, [], "")}
    return d or None


# ------------------------------------------------------------------ OpenStreetMap のタグから

# cuisine の値 → ジャンル(先に当たったものから最大 3 つ)
_CUISINE = {
    "sushi": "sushi", "kaitenzushi": "sushi", "seafood": "kaisen", "fish": "kaisen", "ramen": "ramen",
    "noodle": "ramen", "soba": "soba_udon", "udon": "soba_udon", "yakiniku": "yakiniku", "barbecue": "yakiniku",
    "yakitori": "yakitori", "tempura": "tempura", "tonkatsu": "tonkatsu", "katsu": "tonkatsu",
    "okonomiyaki": "okonomiyaki", "takoyaki": "okonomiyaki", "japanese": "washoku", "kaiseki": "washoku",
    "regional": "kyodo", "izakaya": "izakaya", "nabe": "nabe", "shabu-shabu": "nabe", "sukiyaki": "nabe",
    "unagi": "unagi", "eel": "unagi", "teishoku": "teishoku", "curry": "curry", "indian": "curry",
    "chinese": "chinese", "dim_sum": "chinese", "korean": "korean", "thai": "asian", "vietnamese": "asian",
    "asian": "asian", "indonesian": "asian", "italian": "italian", "pizza": "italian", "pasta": "italian",
    "french": "french", "western": "western", "yoshoku": "western", "steak_house": "steak", "steak": "steak",
    "hamburger": "steak", "burger": "burger", "coffee_shop": "cafe", "cafe": "cafe", "dessert": "sweets",
    "cake": "sweets", "ice_cream": "sweets", "crepe": "sweets", "wagashi": "sweets", "bakery": "bakery",
    "bread": "bakery", "buffet": "buffet",
}
_AMENITY_GENRE = {"cafe": "cafe", "bar": "bar", "pub": "bar", "ice_cream": "sweets", "izakaya": "izakaya"}


def _yes(v: Any) -> Optional[bool]:
    s = str(v or "").strip().lower()
    if s in ("yes", "only", "designated", "limited"):
        return True
    if s == "no":
        return False
    return None


def from_osm_tags(tags: Dict[str, Any], osm_type: Optional[str] = None) -> Dict[str, Any]:
    """OpenStreetMap のタグから読める項目だけを返す(無ければ空)。値を作らない"""
    out: Dict[str, Any] = {}
    genres: List[str] = []
    for raw in str(tags.get("cuisine") or "").split(";"):
        g = _CUISINE.get(raw.strip().lower())
        if g and g not in genres:
            genres.append(g)
    t = (osm_type or "").lower()
    if not genres and t in _AMENITY_GENRE:
        genres.append(_AMENITY_GENRE[t])
    if genres:
        out["genres"] = genres[:MAX_GENRES]
    hours = str(tags.get("opening_hours") or "").strip()
    if hours:
        out["hours"] = hours[:300]
    reservation = str(tags.get("reservation") or "").strip().lower()
    res_map = {"required": "required", "recommended": "recommended", "yes": "possible", "no": "not_accepted"}
    out_res = res_map.get(reservation)
    if out_res:
        out["reservation"] = out_res
    smoking = str(tags.get("smoking") or "").strip().lower()
    out_smoke = {"no": "no", "separated": "separated", "isolated": "separated", "outside": "no", "yes": "yes",
                 "dedicated": "yes"}.get(smoking)
    if out_smoke:
        out["smoking"] = out_smoke
    pay: List[str] = []
    if _yes(tags.get("payment:cash")) or _yes(tags.get("payment:coins")):
        pay.append("cash")
    card_keys = ("payment:credit_cards", "payment:visa", "payment:mastercard", "payment:jcb", "payment:debit_cards")
    if any(_yes(tags.get(k)) for k in card_keys):
        pay.append("card")
    emoney_keys = ("payment:suica", "payment:pasmo", "payment:icoca", "payment:id", "payment:quicpay",
                   "payment:edy", "payment:waon", "payment:nanaco", "payment:contactless")
    if any(_yes(tags.get(k)) for k in emoney_keys):
        pay.append("emoney")
    qr_keys = ("payment:paypay", "payment:line_pay", "payment:rakuten_pay", "payment:alipay", "payment:wechat",
               "payment:d_payment", "payment:au_pay")
    if any(_yes(tags.get(k)) for k in qr_keys):
        pay.append("qr")
    if pay:
        out["payment"] = pay
    feats: List[str] = []
    if _yes(tags.get("takeaway")):
        feats.append("takeout")
    if _yes(tags.get("diet:vegetarian")) or _yes(tags.get("diet:vegan")):
        feats.append("vegetarian")
    if _yes(tags.get("outdoor_seating")):
        feats.append("outdoor")
    if str(tags.get("wheelchair") or "").lower() == "yes":
        feats.append("wheelchair")
    if _yes(tags.get("internet_access")) or str(tags.get("internet_access") or "").lower() == "wlan":
        feats.append("wifi")
    if _yes(tags.get("kids_area")) or _yes(tags.get("highchair")) or _yes(tags.get("changing_table")):
        feats.append("kids")
    if feats:
        out["features"] = feats
    try:
        cap = int(str(tags.get("capacity") or "").strip())
        if 1 <= cap <= 5000:
            out["seats"] = cap
    except ValueError:
        pass
    if _yes(tags.get("parking")) or str(tags.get("parking") or "").lower() in ("surface", "customers"):
        out["parking"] = "yes"
    return out


def merge_empty(current: Optional[Dict[str, Any]], found: Dict[str, Any]) -> Dict[str, Any]:
    """今の値が空の項目だけを、見つけた値で埋める(利用者が入れた値は変えない)"""
    base = dict(current or {})
    for k, v in found.items():
        if base.get(k) in (None, [], ""):
            base[k] = v
    return base
