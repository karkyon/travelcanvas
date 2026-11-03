"""[Gate PlaceKinds] 見つかった場所の種類(観光スポット・宿・飲食・神社仏閣・公園…)を決める。

UAT(2026-11-03)で、方面の詳細の「見つかった場所」に鳥羽市・鳥羽町・鳥羽商工会議所・鳥羽市立図書館などが観光の候補として
並び、何の場所か分からなかった。OpenStreetMap はタグ、Wikipedia は記事の名前と短い説明(Wikidata の description)で
種類を決め、観光の候補にならない場所(市町村の記事・役所・学校・研究所・会社など)は除く。種類は画面のバッジ・絞り込み・
希望(歴史・文化 など)との照合に使う。
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

# 種類 → 画面の名前(画面の側の KIND_LABEL と同じ)
KINDS: Dict[str, str] = {
    "shrine_temple": "神社・寺", "castle_history": "城・史跡", "museum": "博物館・美術館・水族館",
    "nature": "自然・景色", "park": "公園・庭園", "onsen": "温泉・湯", "leisure": "テーマパーク・体験",
    "town": "町並み・通り", "food": "食事", "cafe": "カフェ・甘味", "shop": "買い物・市場", "lodging": "宿泊",
    "other": "その他",
}

# 観光の候補にしない(Wikipedia の記事の名前・説明)
_EXCLUDE = re.compile(
    r"商工会議所|図書館|研究所|研究センター|信号場|役所|役場|市議会|町議会|警察|消防|裁判所|刑務所|自衛隊|駐屯地|基地$|"
    r"株式会社|有限会社|会社$|銀行|信用金庫|協同組合|組合$|協会$|連合会|学校|高校|中学|小学|大学|短期大学|保育|幼稚園|"
    r"病院|診療所|医院|霊園|墓地|斎場|発電所|変電所|浄水場|処理場|清掃|工場|事業所|郵便局|放送局|送信所|"
    r"選挙区|事件|事故|戦い$|合戦$|地震|台風|方言|一覧|線$|道路|国道|県道|インターチェンジ|ジャンクション|トンネル|"
    r"バス停|停留場|駅$|ターミナル|港$|フェリー|団地|ニュータウン|人物|一族|氏$|藩$|郡$")
_MUNICIPALITY_DESC = re.compile(r"(?:日本の|にある|に属する|の)(?:市|町|村|区|地域|地区|大字|町名)$|^日本の(?:市|町|村)")
_WIKI_RULES = [
    ("lodging", re.compile(r"ホテル|旅館|ホステル|民宿|ペンション|リゾートホテル|宿泊")),
    ("onsen", re.compile(r"温泉|湯$|スパ|銭湯")),
    ("shrine_temple", re.compile(r"神社|大社|神宮|寺$|寺院|院$|八幡|稲荷|天満宮|社$|宮$|教会|大聖堂|仏閣|霊場|札所")),
    ("castle_history", re.compile(r"城$|城跡|城址|跡$|遺跡|史跡|古墳|陣屋|関所|番所|灯台|旧.+邸|記念碑|碑$")),
    ("museum", re.compile(r"博物館|美術館|水族館|資料館|記念館|科学館|ミュージアム|ギャラリー|郷土館|文学館|館$")),
    ("leisure", re.compile(r"テーマパーク|遊園地|動物園|サファリ|パーク$|ランド$|ワールド$|体験|牧場|アスレチック")),
    ("park", re.compile(r"公園|庭園|緑地|植物園|花園|フラワー")),
    ("nature", re.compile(r"島$|山$|岳$|峠|岬|崎$|鼻$|海岸|浜$|海水浴場|湾$|滝$|湖$|渓谷|峡$|高原|洞窟|鍾乳洞|池$|川$|浦$|"
                          r"半島|砂丘|展望|景勝|棚田|干潟")),
    ("shop", re.compile(r"市場|マルシェ|商店街|ショッピング|モール|アウトレット|道の駅|物産|プラザ$")),
    ("town", re.compile(r"町並み|通り$|街道|宿場|横丁|番街|古い町|伝統的建造物")),
    ("food", re.compile(r"料理|食堂|レストラン|寿司|焼肉|焼き肉|ラーメン|うどん|そば")),
    ("cafe", re.compile(r"カフェ|喫茶|甘味|ベーカリー|パン屋|スイーツ")),
]
_OSM_RULES = {
    ("tourism", "museum"): "museum", ("tourism", "gallery"): "museum", ("tourism", "aquarium"): "museum",
    ("tourism", "viewpoint"): "nature", ("tourism", "theme_park"): "leisure", ("tourism", "zoo"): "leisure",
    ("tourism", "hotel"): "lodging", ("tourism", "guest_house"): "lodging", ("tourism", "hostel"): "lodging",
    ("tourism", "motel"): "lodging", ("tourism", "apartment"): "lodging", ("tourism", "camp_site"): "lodging",
    ("amenity", "place_of_worship"): "shrine_temple", ("amenity", "restaurant"): "food",
    ("amenity", "fast_food"): "food", ("amenity", "food_court"): "food", ("amenity", "cafe"): "cafe",
    ("amenity", "ice_cream"): "cafe", ("amenity", "marketplace"): "shop", ("amenity", "public_bath"): "onsen",
    ("leisure", "park"): "park", ("leisure", "garden"): "park", ("leisure", "nature_reserve"): "nature",
    ("leisure", "water_park"): "leisure", ("leisure", "resort"): "leisure", ("natural", "hot_spring"): "onsen",
    ("shop", "bakery"): "cafe", ("shop", "confectionery"): "cafe",
}


def classify_wikipedia(title: str, description: Optional[str]) -> Optional[str]:
    """Wikipedia の記事の種類。観光の候補にしない記事は None"""
    t = re.sub(r"\s*[(（][^)）]*[)）]$", "", (title or "").strip())  # 「常安寺 (鳥羽市)」→「常安寺」
    d = (description or "").strip()
    if not t or _EXCLUDE.search(t) or (d and _EXCLUDE.search(d) and not any(r.search(t) for _, r in _WIKI_RULES)):
        return None
    if d and _MUNICIPALITY_DESC.search(d):
        return None  # 市町村・地区の記事(「鳥羽市」「鳥羽町」)は場所の候補ではない
    if re.search(r"(?:市|町|村|区)$", t) and not d:
        return None
    for kind, rule in _WIKI_RULES:
        if rule.search(t):
            return kind
    for kind, rule in _WIKI_RULES:
        if d and rule.search(d):
            return kind
    return "other"


def classify_osm(tags: Any, name: str = "") -> str:
    """OpenStreetMap のタグ(無ければ名前)の種類"""
    if isinstance(tags, dict):
        for key in ("tourism", "amenity", "leisure", "natural", "shop"):
            value = tags.get(key)
            if value and (key, value) in _OSM_RULES:
                return _OSM_RULES[(key, value)]
        if tags.get("historic"):
            return "castle_history"
        if tags.get("shop"):
            return "shop"
        if tags.get("natural"):
            return "nature"
    for kind, rule in _WIKI_RULES:
        if name and rule.search(name):
            return kind
    return "other"


def kind_of(provider: str, category: Optional[str], name: str, raw: Any) -> str:
    """保存した候補(provider・category・raw_payload)から種類を決める(応答を作る時)"""
    tc = raw.get("_tc") if isinstance(raw, dict) else None
    if isinstance(tc, dict) and tc.get("kind") in KINDS:
        return str(tc["kind"])
    if provider == "overpass":
        return classify_osm(raw.get("tags") if isinstance(raw, dict) else None, name)
    if provider == "wikipedia":
        return classify_wikipedia(name, None) or "other"
    return "other"
