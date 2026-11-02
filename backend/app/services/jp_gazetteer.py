"""[Gate AreaGeo] 方面の比較の地名の内蔵の表(都道府県・主な市・観光地の代表点)。

UAT(2026-11-02)で、枚方から車で片道約3時間の相談の「滋賀」が北海道に、「伊勢」が岐阜の山中に置かれた。原因は Nominatim の
自由文の検索で 1 件目(limit=1)だけを使っていたこと(「滋賀」「伊勢」は全国に同じ文字の小さな地名がある)と、出発地「枚方」が
照会できず距離・条件の判定が働かなかったこと。よく使う方面と出発地はこの表で決め、表に無い地名だけを Nominatim で照会する。

代表点は都道府県は県庁(府庁・都庁・道庁)の付近、市は市役所の付近、観光地は中心の付近(小数 4 桁 ≒ 10m の精度は要らない。
方面の位置関係と直線距離の目安に使う)。出典は「内蔵の地名表」と表示する(OpenStreetMap の照会の結果と分ける)。
"""
from __future__ import annotations

import unicodedata
from typing import Dict, Optional, Tuple

# 正式な名前 → (緯度, 経度, 種類)
_PREFS: Dict[str, Tuple[float, float]] = {
    "北海道": (43.0642, 141.3469), "青森県": (40.8244, 140.7400), "岩手県": (39.7036, 141.1527),
    "宮城県": (38.2688, 140.8721), "秋田県": (39.7186, 140.1024), "山形県": (38.2404, 140.3633),
    "福島県": (37.7503, 140.4676), "茨城県": (36.3418, 140.4468), "栃木県": (36.5657, 139.8836),
    "群馬県": (36.3912, 139.0608), "埼玉県": (35.8570, 139.6489), "千葉県": (35.6047, 140.1233),
    "東京都": (35.6895, 139.6917), "神奈川県": (35.4478, 139.6425), "新潟県": (37.9026, 139.0236),
    "富山県": (36.6953, 137.2113), "石川県": (36.5947, 136.6256), "福井県": (36.0652, 136.2216),
    "山梨県": (35.6642, 138.5684), "長野県": (36.6513, 138.1810), "岐阜県": (35.3912, 136.7223),
    "静岡県": (34.9769, 138.3831), "愛知県": (35.1802, 136.9066), "三重県": (34.7303, 136.5086),
    "滋賀県": (35.0045, 135.8686), "京都府": (35.0214, 135.7556), "大阪府": (34.6863, 135.5200),
    "兵庫県": (34.6913, 135.1830), "奈良県": (34.6851, 135.8329), "和歌山県": (34.2260, 135.1675),
    "鳥取県": (35.5036, 134.2383), "島根県": (35.4723, 133.0505), "岡山県": (34.6618, 133.9344),
    "広島県": (34.3966, 132.4596), "山口県": (34.1859, 131.4714), "徳島県": (34.0658, 134.5593),
    "香川県": (34.3401, 134.0434), "愛媛県": (33.8416, 132.7657), "高知県": (33.5597, 133.5311),
    "福岡県": (33.6064, 130.4183), "佐賀県": (33.2494, 130.2988), "長崎県": (32.7448, 129.8737),
    "熊本県": (32.7898, 130.7417), "大分県": (33.2382, 131.6126), "宮崎県": (31.9111, 131.4239),
    "鹿児島県": (31.5602, 130.5581), "沖縄県": (26.2124, 127.6809),
}
# 市・観光地(よく相談に出る方面・出発地)。名前 → (緯度, 経度, 表示の名前)
_PLACES: Dict[str, Tuple[float, float, str]] = {
    "伊勢": (34.4875, 136.7091, "伊勢市(三重県)"), "伊勢市": (34.4875, 136.7091, "伊勢市(三重県)"),
    "伊勢神宮": (34.4550, 136.7258, "伊勢神宮(三重県伊勢市)"), "伊勢志摩": (34.4300, 136.8000, "伊勢志摩(三重県)"),
    "鳥羽": (34.4813, 136.8432, "鳥羽市(三重県)"), "志摩": (34.3283, 136.8306, "志摩市(三重県)"),
    "伊賀": (34.7686, 136.1300, "伊賀市(三重県)"), "熊野": (33.8886, 136.1003, "熊野市(三重県)"),
    "枚方": (34.8146, 135.6507, "枚方市(大阪府)"), "枚方市": (34.8146, 135.6507, "枚方市(大阪府)"),
    "大阪市": (34.6937, 135.5023, "大阪市(大阪府)"), "京都市": (35.0116, 135.7681, "京都市(京都府)"),
    "奈良市": (34.6851, 135.8049, "奈良市(奈良県)"), "吉野": (34.3963, 135.8570, "吉野町(奈良県)"),
    "神戸": (34.6901, 135.1955, "神戸市(兵庫県)"), "神戸市": (34.6901, 135.1955, "神戸市(兵庫県)"),
    "姫路": (34.8151, 134.6853, "姫路市(兵庫県)"), "有馬温泉": (34.7975, 135.2478, "有馬温泉(兵庫県神戸市)"),
    "城崎温泉": (35.6253, 134.8095, "城崎温泉(兵庫県豊岡市)"), "淡路島": (34.3500, 134.8500, "淡路島(兵庫県)"),
    "白浜": (33.6781, 135.3481, "白浜町(和歌山県)"), "南紀白浜": (33.6781, 135.3481, "白浜町(和歌山県)"),
    "那智勝浦": (33.6265, 135.9429, "那智勝浦町(和歌山県)"), "高野山": (34.2130, 135.5860, "高野山(和歌山県)"),
    "天橋立": (35.5697, 135.1907, "天橋立(京都府宮津市)"), "舞鶴": (35.4747, 135.3858, "舞鶴市(京都府)"),
    "嵐山": (35.0094, 135.6668, "嵐山(京都府京都市)"),
    "彦根": (35.2745, 136.2597, "彦根市(滋賀県)"), "長浜": (35.3816, 136.2694, "長浜市(滋賀県)"),
    "大津": (35.0045, 135.8686, "大津市(滋賀県)"), "琵琶湖": (35.2500, 136.0800, "琵琶湖(滋賀県)"),
    "福井市": (36.0641, 136.2196, "福井市(福井県)"), "敦賀": (35.6452, 136.0555, "敦賀市(福井県)"),
    "小浜": (35.4956, 135.7466, "小浜市(福井県)"), "東尋坊": (36.2380, 136.1250, "東尋坊(福井県坂井市)"),
    "あわら温泉": (36.2260, 136.1950, "あわら温泉(福井県)"), "金沢": (36.5613, 136.6562, "金沢市(石川県)"),
    "高山": (36.1461, 137.2522, "高山市(岐阜県)"), "飛騨高山": (36.1461, 137.2522, "高山市(岐阜県)"),
    "白川郷": (36.2578, 136.9061, "白川郷(岐阜県白川村)"), "下呂温泉": (35.8058, 137.2440, "下呂温泉(岐阜県)"),
    "名古屋": (35.1815, 136.9066, "名古屋市(愛知県)"), "名古屋市": (35.1815, 136.9066, "名古屋市(愛知県)"),
    "岡山市": (34.6551, 133.9195, "岡山市(岡山県)"), "倉敷": (34.5850, 133.7720, "倉敷市(岡山県)"),
    "広島市": (34.3853, 132.4553, "広島市(広島県)"), "宮島": (34.2960, 132.3198, "宮島(広島県廿日市市)"),
    "札幌": (43.0618, 141.3545, "札幌市(北海道)"), "東京": (35.6895, 139.6917, "東京都"),
}
# 短い名前(県・府・都を付けない)→ 正式な名前。「京都」「大阪」「奈良」などは都道府県として扱う
_SHORT = {name[:-1]: name for name in _PREFS if name.endswith(("県", "府", "都")) and name != "東京都"}
_SHORT["東京"] = "東京都"


def _norm(name: str) -> str:
    return unicodedata.normalize("NFKC", name or "").strip().replace(" ", "").replace("　", "")


def lookup(name: str) -> Optional[Dict[str, object]]:
    """内蔵の表で引く。無ければ None(Nominatim で照会する)。{"latitude","longitude","label","kind"}"""
    n = _norm(name)
    if not n:
        return None
    if n in _PLACES:
        lat, lng, label = _PLACES[n]
        return {"latitude": lat, "longitude": lng, "label": label, "kind": "place"}
    pref = n if n in _PREFS else _SHORT.get(n)
    if pref:
        lat, lng = _PREFS[pref]
        return {"latitude": lat, "longitude": lng, "label": pref, "kind": "prefecture"}
    # 「〇〇県〇〇市」のように県の名前を含む時は、表の市があればそれ、無ければ照会へ
    for key in sorted(_PLACES, key=len, reverse=True):
        if len(key) >= 2 and n.endswith(key):
            lat, lng, label = _PLACES[key]
            return {"latitude": lat, "longitude": lng, "label": label, "kind": "place"}
    return None


def prefecture_of(name: str) -> Optional[str]:
    """名前に含まれる都道府県(「大阪府枚方市」→ 大阪府)。無ければ None"""
    n = _norm(name)
    for pref in _PREFS:
        if n.startswith(pref):
            return pref
    return None


# ============================================================ [Gate AreaLogic] 方面の候補の表・地域の語・出発地の整理
#
# UAT(2026-11-02 18:16)で、「枚方から車で高速を使って片道3時間くらいまでの関西近畿圏や比較的近めの東海、北陸圏…
# 候補地は4件ほど出してほしい」に対し、比較の方面が「関西近畿圏・東海・北陸圏・枚方・高速」になった。
# (1) 地域の語(関西近畿圏・東海・北陸圏)を行き先として地名の照会にかけ、東京の「東海」・西東京の緑地を拾った
# (2) 出発地(枚方)と移動の語(高速)まで方面にした (3) 出発地が文章の一節のままで照会できず、距離が全て未計算
# (4) 「候補地を4件」の依頼に対し、条件に合う具体的な行き先を一つも出していなかった。
# 地域の語は「範囲の条件」に、出発地・移動の語は捨て、行き先が無い時はこの表から条件に合う方面を選んで出す。
#
# 表の値: 名前 → (緯度, 経度, 都道府県, 特徴, 道路の係数)。特徴は PREFERENCES のキー+ sea。道路の係数は直線距離に掛ける
# 道のりの倍率の目安(平野・高速道路沿い 1.3、山・半島の奥 1.7〜2.3)。所要時間は「目安」で、道路の提供元の照会ではない。
DESTINATIONS: Dict[str, Tuple[float, float, str, Tuple[str, ...], float]] = {
    # 北陸
    "福井市": (36.0641, 136.2196, "福井県", ("culture", "food", "calm"), 1.3),
    "あわら温泉": (36.2260, 136.1950, "福井県", ("onsen", "quiet", "calm", "food"), 1.3),
    "東尋坊": (36.2380, 136.1250, "福井県", ("scenery", "sea", "food"), 1.3),
    "敦賀": (35.6452, 136.0555, "福井県", ("sea", "food", "culture"), 1.3),
    "小浜": (35.4956, 135.7466, "福井県", ("sea", "food", "culture", "quiet"), 1.35),
    "金沢": (36.5613, 136.6562, "石川県", ("culture", "food"), 1.3),
    "山代温泉": (36.2900, 136.3600, "石川県", ("onsen", "calm", "food"), 1.3),
    "和倉温泉": (37.0900, 136.9200, "石川県", ("onsen", "sea", "quiet"), 1.4),
    "富山市": (36.6953, 137.2113, "富山県", ("food", "scenery"), 1.3),
    # 東海
    "名古屋": (35.1815, 136.9066, "愛知県", ("food", "culture"), 1.3),
    "伊勢": (34.4875, 136.7091, "三重県", ("culture", "food", "calm"), 1.3),
    "鳥羽": (34.4813, 136.8432, "三重県", ("sea", "food", "onsen", "scenery"), 1.3),
    "志摩": (34.3283, 136.8306, "三重県", ("sea", "scenery", "quiet", "food"), 1.35),
    "伊賀": (34.7686, 136.1300, "三重県", ("culture", "quiet", "food"), 1.3),
    "長島温泉": (35.0870, 136.7030, "三重県", ("onsen",), 1.3),
    "熊野": (33.8886, 136.1003, "三重県", ("culture", "scenery", "quiet", "sea"), 2.3),
    "下呂温泉": (35.8058, 137.2440, "岐阜県", ("onsen", "calm", "scenery"), 1.35),
    "高山": (36.1461, 137.2522, "岐阜県", ("culture", "food", "calm"), 1.5),
    "白川郷": (36.2578, 136.9061, "岐阜県", ("culture", "scenery"), 1.4),
    "郡上八幡": (35.7480, 136.9640, "岐阜県", ("culture", "quiet", "scenery"), 1.35),
    "浜名湖": (34.7300, 137.5800, "静岡県", ("scenery", "food", "onsen"), 1.3),
    # 関西
    "京都市": (35.0116, 135.7681, "京都府", ("culture", "food"), 1.3),
    "天橋立": (35.5697, 135.1907, "京都府", ("scenery", "sea", "culture", "quiet"), 1.4),
    "舞鶴": (35.4747, 135.3858, "京都府", ("sea", "food", "culture"), 1.35),
    "伊根": (35.6750, 135.2850, "京都府", ("sea", "quiet", "scenery", "food"), 1.5),
    "奈良市": (34.6851, 135.8049, "奈良県", ("culture", "calm"), 1.3),
    "吉野": (34.3963, 135.8570, "奈良県", ("culture", "scenery", "quiet"), 1.6),
    "十津川温泉": (33.9900, 135.7900, "奈良県", ("onsen", "quiet", "scenery"), 2.3),
    "城崎温泉": (35.6253, 134.8095, "兵庫県", ("onsen", "food", "calm"), 1.4),
    "有馬温泉": (34.7975, 135.2478, "兵庫県", ("onsen", "calm"), 1.3),
    "姫路": (34.8151, 134.6853, "兵庫県", ("culture",), 1.3),
    "淡路島": (34.3500, 134.8500, "兵庫県", ("sea", "food", "scenery", "quiet"), 1.4),
    "和歌山市": (34.2260, 135.1675, "和歌山県", ("culture", "sea", "food"), 1.3),
    "白浜": (33.6781, 135.3481, "和歌山県", ("onsen", "sea", "scenery", "food"), 1.45),
    "那智勝浦": (33.6265, 135.9429, "和歌山県", ("onsen", "sea", "culture", "food"), 1.9),
    "高野山": (34.2130, 135.5860, "和歌山県", ("culture", "quiet", "calm"), 1.9),
    "彦根": (35.2745, 136.2597, "滋賀県", ("culture", "calm"), 1.3),
    "長浜": (35.3816, 136.2694, "滋賀県", ("culture", "scenery", "calm"), 1.3),
    "近江八幡": (35.1280, 136.0980, "滋賀県", ("culture", "food", "quiet"), 1.3),
    "高島": (35.3530, 136.0360, "滋賀県", ("scenery", "quiet"), 1.35),
    # 中国・四国
    "倉敷": (34.5850, 133.7720, "岡山県", ("culture", "calm"), 1.3),
    "宮島": (34.2960, 132.3198, "広島県", ("culture", "scenery", "sea"), 1.3),
    "鳥取砂丘": (35.5400, 134.2300, "鳥取県", ("scenery",), 1.4),
    "松江": (35.4723, 133.0505, "島根県", ("culture", "onsen", "calm"), 1.4),
    "小豆島": (34.4800, 134.2300, "香川県", ("sea", "scenery", "quiet"), 1.6),
    "道後温泉": (33.8520, 132.7860, "愛媛県", ("onsen", "culture"), 1.4),
    # 関東・甲信
    "箱根": (35.2324, 139.1069, "神奈川県", ("onsen", "scenery"), 1.3),
    "鎌倉": (35.3192, 139.5467, "神奈川県", ("culture", "sea"), 1.3),
    "日光": (36.7199, 139.6982, "栃木県", ("culture", "scenery"), 1.3),
    "草津温泉": (36.6206, 138.5960, "群馬県", ("onsen", "scenery"), 1.5),
    "軽井沢": (36.3480, 138.5970, "長野県", ("scenery", "calm", "quiet"), 1.3),
    "松本": (36.2380, 137.9720, "長野県", ("culture", "scenery"), 1.4),
}
# 同じ場所の別の名前(候補に重ねて出さない)
_DEST_ALIASES = {"伊勢市": "伊勢", "伊勢神宮": "伊勢", "伊勢志摩": "志摩", "飛騨高山": "高山", "南紀白浜": "白浜",
                 "名古屋市": "名古屋", "福井": "福井市", "和歌山": "和歌山市", "奈良": "奈良市", "京都": "京都市"}

_KANSAI = ("大阪府", "京都府", "兵庫県", "奈良県", "和歌山県", "滋賀県", "三重県")
_TOKAI = ("愛知県", "岐阜県", "静岡県", "三重県")
_HOKURIKU = ("福井県", "石川県", "富山県", "新潟県")
_KOSHIN = ("山梨県", "長野県")
_SANIN = ("鳥取県", "島根県")
_SANYO = ("岡山県", "広島県", "山口県")
_SHIKOKU = ("徳島県", "香川県", "愛媛県", "高知県")
_KYUSHU = ("福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県")
_KANTO = ("茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県")
_TOHOKU = ("青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県")
# 地域の語(長い語から照合する)→ 都道府県
REGION_WORDS: Dict[str, Tuple[str, ...]] = {
    "関西": _KANSAI, "近畿": _KANSAI, "京阪神": ("大阪府", "京都府", "兵庫県"),
    "東海": _TOKAI, "北陸": _HOKURIKU, "中部": _HOKURIKU + _TOKAI + _KOSHIN, "甲信越": _KOSHIN + ("新潟県",),
    "甲信": _KOSHIN, "信州": ("長野県",), "山陰": _SANIN, "山陽": _SANYO, "中国地方": _SANIN + _SANYO,
    "瀬戸内": ("岡山県", "広島県", "香川県", "愛媛県", "兵庫県"), "四国": _SHIKOKU, "九州": _KYUSHU,
    "関東": _KANTO, "首都圏": _KANTO, "東北": _TOHOKU, "北海道": ("北海道",), "沖縄": ("沖縄県",),
    "南紀": ("和歌山県", "三重県"), "紀伊半島": ("和歌山県", "三重県", "奈良県"), "丹後": ("京都府",),
    "湖北": ("滋賀県",), "湖西": ("滋賀県",), "湖東": ("滋賀県",), "伊勢志摩": ("三重県",),
}
_REGION_SUFFIX = r"(?:圏|地方|地域|エリア|方面|周辺|あたり|辺り|の方|全域|一円)"
# 行き先ではない語(移動・宿・漠然とした範囲)。方面の比較に入れない
NOT_PLACES = frozenset({
    "高速", "高速道路", "車", "自家用車", "マイカー", "レンタカー", "電車", "新幹線", "特急", "バス", "飛行機", "フェリー",
    "宿", "旅館", "ホテル", "温泉", "観光地", "観光", "海", "山", "湖", "国内", "近場", "近く", "県内", "府内", "市内",
    "日本", "全国", "地元", "どこか", "候補", "候補地", "焼肉", "焼き肉",
})


def region_prefectures(word: str) -> Optional[Tuple[str, ...]]:
    """地域の語(「関西近畿圏」「北陸圏」「東海」)なら、含む都道府県。行き先の地名なら None"""
    import re

    n = _norm(word)
    if not n or n in _PLACES or n in DESTINATIONS or n in _PREFS or n in _SHORT:
        return None
    rest = n
    prefs: list = []
    for key in sorted(REGION_WORDS, key=len, reverse=True):
        if key in rest:
            rest = rest.replace(key, "")
            prefs.extend(p for p in REGION_WORDS[key] if p not in prefs)
    if not prefs:
        return None
    rest = re.sub(_REGION_SUFFIX, "", rest).strip("・や、の")
    return tuple(prefs) if rest == "" else None


def clean_origin(value: Optional[str]) -> Optional[str]:
    """出発地の値を地名だけにする(「枚方から車で、高速を使って…」→「枚方」)。地名と分からない長い文は None"""
    import re

    n = _norm(value or "")
    if not n:
        return None
    n = re.split(r"から|より|発(?:で|の|、)|を出発", n)[0]
    n = re.sub(r"(?:の自宅|の家|在住|住まい|に住んでいます|に住む)$", "", n).strip("、,。 ")
    if not n:
        return None
    if lookup(n) is not None and len(n) <= 15:
        return n
    # 文の中に表の地名があれば、いちばん長いものを使う
    keys = [k for k in list(_PLACES) + list(_PREFS) + list(_SHORT) if len(k) >= 2 and k in n]
    if keys:
        return max(keys, key=len)
    return n if len(n) <= 12 and not re.search(r"[ぁ-ん]{3,}|[、。,]", n) else None


def is_not_place(word: str, origin: Optional[str] = None) -> bool:
    n = _norm(word)
    if not n or n in NOT_PLACES:
        return True
    if origin:
        o = _norm(origin)
        if n == o or n + "市" == o or o + "市" == n or (len(n) >= 2 and o.endswith(n)):
            return True
    return False


def destination_pref(name: str) -> Optional[str]:
    """候補の表・地名の表から都道府県(地域の範囲の判定に使う)"""
    n = _DEST_ALIASES.get(_norm(name), _norm(name))
    if n in DESTINATIONS:
        return DESTINATIONS[n][2]
    hit = lookup(n)
    if hit is None:
        return None
    if hit["kind"] == "prefecture":
        return str(hit["label"])
    label = str(hit["label"])
    for pref in _PREFS:
        if pref in label or (pref[:-1] in label and pref != "北海道"):
            return pref
    return "北海道" if "北海道" in label else None


def estimate_hours(straight_km: float, road_factor: float, mode: Optional[str], highway: bool) -> float:
    """直線距離からの所要時間の目安(道路の提供元の照会ではない)。車+高速 75km/h・一般道 45km/h・公共交通 70km/h"""
    speed = 70.0 if mode == "public" else (75.0 if highway or mode is None else 45.0)
    return straight_km * road_factor / speed


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math

    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(a))


def propose(origin: str, one_way_hours: Optional[float], strength: Optional[str], mode: Optional[str], highway: bool,
            regions: Tuple[str, ...], prefs: Tuple[str, ...], nights: Optional[int], count: int,
            exclude: Tuple[str, ...] = ()) -> Dict[str, object]:
    """条件(出発地・片道の時間・地域・過ごし方)に合う方面を候補の表から選ぶ。
    {"status": ok/no_origin/none, "areas": [{name, label, pref, hours, km, reason}], "limit_hours", "note"}"""
    o = lookup(origin) if origin else None
    if o is None:
        return {"status": "no_origin", "areas": [], "limit_hours": None,
                "note": "出発地を内蔵の地名表で特定できないため、条件から方面を選べませんでした。市区町村の名前を入れてください"}
    olat, olng = float(o["latitude"]), float(o["longitude"])  # type: ignore[arg-type]
    if one_way_hours:
        limit = one_way_hours * (1.0 if strength == "required" else 1.1)
    else:
        limit = 2.0 if nights == 0 else 3.5
    skip = {_DEST_ALIASES.get(_norm(x), _norm(x)) for x in exclude}
    rows = []
    for name, (lat, lng, pref, tags, factor) in DESTINATIONS.items():
        if name in skip or (regions and pref not in regions):
            continue
        km = _haversine(olat, olng, lat, lng)
        if km < 25:  # 出発地と同じ街
            continue
        hours = estimate_hours(km, factor, mode, highway)
        if hours > limit:
            continue
        match = [t for t in tags if t in prefs]
        score = len(match) * 2.0 + (1.0 if "sea" in tags and "scenery" in prefs else 0.0)
        if (nights or 0) >= 1 and hours < 1.0:
            score -= 1.5  # 泊まりの旅行で近すぎる
        rows.append({"name": name, "pref": pref, "km": round(km), "hours": round(hours * 2) / 2, "score": score,
                     "match": match})
    rows.sort(key=lambda r: (-float(r["score"]), float(r["hours"])))  # type: ignore[arg-type]
    picked: list = []
    used_prefs: set = set()
    # 地域の条件が複数なら、各地域から1件ずつ先に選ぶ(関西・東海・北陸なら、それぞれ1件は出す)
    groups = [REGION_WORDS[k] for k in REGION_WORDS if regions and set(REGION_WORDS[k]) <= set(regions)
              and k in ("関西", "東海", "北陸", "山陰", "山陽", "四国", "九州", "関東", "東北", "甲信")]
    for g in groups:
        best = next((r for r in rows if r["pref"] in g and r not in picked), None)
        if best is not None and len(picked) < count:
            picked.append(best)
            used_prefs.add(best["pref"])
    for r in rows:  # 同じ県は後回し(方面を散らす)
        if len(picked) >= count:
            break
        if r not in picked and r["pref"] not in used_prefs:
            picked.append(r)
            used_prefs.add(r["pref"])
    for r in rows:
        if len(picked) >= count:
            break
        if r not in picked:
            picked.append(r)
    label_of = {"quiet": "静か", "calm": "落ち着いた観光", "food": "食", "scenery": "景色・自然", "culture": "歴史・文化",
                "onsen": "温泉", "sea": "海"}
    areas = []
    for r in picked:
        tags = DESTINATIONS[str(r["name"])][3]
        feats = "・".join(label_of[t] for t in tags if t in label_of)
        reason = (f"{r['pref']} · 直線 約{r['km']}km · 片道の目安 約{_h(float(r['hours']))}"
                  "(直線距離からの目安・道路は未照会。比較の画面の「道路で片道の時間を調べる」で確かめられます)"
                  f" · 特徴: {feats}")
        areas.append({"name": r["name"], "label": f"{r['name']}({r['pref']})", "pref": r["pref"], "km": r["km"],
                      "hours": r["hours"], "reason": reason})
    return {"status": "ok" if areas else "none", "areas": areas, "limit_hours": round(limit, 1),
            "note": None if areas else "条件(片道の時間・地域)に合う方面が候補の表にありませんでした。条件を緩めるか、行き先を足してください"}


def _h(hours: float) -> str:
    whole = int(hours)
    return f"{whole}時間半" if hours - whole >= 0.5 else (f"{whole}時間" if whole else "30分")


def regions_in_text(text: str) -> list:
    """[Gate AreaLogic] 文章の中の地域の語(「関西近畿圏」「比較的近めの東海」「北陸圏」)。候補の書き方に無くても範囲の条件にする"""
    import re

    keys = "|".join(sorted((re.escape(k) for k in REGION_WORDS), key=len, reverse=True))
    out: list = []
    for m in re.finditer(rf"(?:{keys})(?:[・や]?(?:{keys}))*{_REGION_SUFFIX}?", _norm(text)):
        word = m.group(0)
        if region_prefectures(word) and word not in out:
            out.append(word)
    return out
