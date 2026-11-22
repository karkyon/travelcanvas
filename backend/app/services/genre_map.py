"""[FR-061] 行きたい場所の種類(spots.category)・予定の種類・提供元のジャンルの文字を、place_finder.GENRES の 15 種へ写す。

好みの傾向(preference_profile)と、ルートの近くの候補のジャンルの札で使う。分からない物は None(数えない)。
"""
from __future__ import annotations

from typing import Optional

from app.services.place_finder import GENRES

# 文字の手がかり(先に書いた物ほど強い。「ラーメン」は「食事」より先に当てる)
_WORDS = (
    ("michinoeki", ("道の駅",)),
    ("onsen", ("温泉", "日帰り湯", "銭湯", "スパ")),
    ("shrine", ("神社", "神宮", "大社", "寺", "院", "稲荷", "八幡")),
    ("view", ("展望", "景色", "絶景", "見晴", "夜景", "峠")),
    ("cafe", ("カフェ", "喫茶", "コーヒー", "珈琲", "cafe")),
    ("ramen", ("ラーメン", "らーめん", "そば", "蕎麦", "うどん", "麺")),
    ("sweets", ("スイーツ", "甘味", "和菓子", "ケーキ", "パン", "ジェラート", "アイス")),
    ("izakaya", ("居酒屋", "酒場", "バー")),
    ("japanese", ("和食", "郷土", "寿司", "鮨", "割烹", "定食")),
    ("souvenir", ("土産", "みやげ", "物産", "直売")),
    ("hotel", ("ホテル", "旅館", "宿")),
    ("activity", ("体験", "公園", "牧場", "動物園", "水族館", "遊園")),
    ("sightseeing", ("観光", "城", "博物館", "美術館", "史跡", "名所", "庭園")),
    ("meal", ("レストラン", "食堂", "料理", "グルメ", "ランチ")),
)

# spots.category・予定の種類 → 既定のジャンル(文字の手がかりが無い時)
_KINDS = {
    "restaurant": "meal", "dining": "meal", "food": "meal",
    "sightseeing": "sightseeing", "landmark": "sightseeing",
    "shopping": "souvenir", "market": "souvenir",
    "accommodation": "hotel", "lodging": "hotel",
    "activity": "activity",
    "cafe": "cafe", "temple": "shrine", "shrine": "shrine", "onsen": "onsen", "viewpoint": "view",
    # スポットモードのエリアの候補の種類(spot_area_items.genre)
    "gift": "souvenir", "sight": "sightseeing", "sweets": "sweets",
}


def to_genre(kind: Optional[str] = None, text: Optional[str] = None) -> Optional[str]:
    """種類(category / event_type / 提供元の種類)と、名前・ジャンルの文字から GENRES の code を 1 つ"""
    t = (text or "").lower()
    if t:
        for code, words in _WORDS:
            if any(w.lower() in t for w in words):
                return code
    k = (kind or "").strip().lower()
    if k in GENRES and k != "all":
        return k
    return _KINDS.get(k)


def label(code: Optional[str]) -> Optional[str]:
    return GENRES[code][0] if code in GENRES else None
