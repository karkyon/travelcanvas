"""[Gate PlanB-P6] 天気に左右される予定の見分け(当たり前の感覚)と、雨の時の代わりの提案(DB 非依存の純粋関数)。

予定の種類(event_type)だけでは分からない「屋外のバーベキュー」「海水浴」「展望台」などを、名前・説明の言葉から
見分ける。食事(dining)でも BBQ・ビアガーデン・屋形船は屋外、観光(sightseeing)でも水族館・美術館は屋内。

- fit(): outdoor(雨では難しい)/ partly(屋外を歩く・一部屋外)/ indoor(雨でもそのまま)/ unknown
- alternatives(): 屋外の予定の代わりの考え方(例: BBQ → 屋根付きの BBQ 場・焼肉)
- indoor_like(): 候補箱・行きたい場所の名前から、雨の日に向く候補か
外の天気の情報は使わない(予報の取得は別の段)。AI も使わない(押した時だけの AI の検証は別)。
"""
import re
from typing import Any, Dict, List, Optional, Tuple

# (グループ, 言葉, 代わりの考え方)。上から順に当てる(具体的な物を先に)
OUTDOOR_GROUPS: List[Tuple[str, Tuple[str, ...], str]] = [
    ("bbq", ("バーベキュー", "bbq", "ｂｂｑ", "キャンプ", "グランピング", "デイキャンプ", "焚き火", "たき火", "飯ごう"),
     "屋根付きのBBQ場・焼肉店・ジンギスカン"),
    ("beach", ("海水浴", "ビーチ", "砂浜", "シュノーケ", "サーフィン", "ナイトプール", "屋外プール", "潮干狩り", "磯遊び"),
     "屋内プール・水族館・温浴施設"),
    ("water", ("カヤック", "カヌー", "sup", "ラフティング", "ダイビング", "釣り", "川下り", "ボート"),
     "屋内の体験(工房・陶芸・そば打ち)・水族館"),
    ("mountain", ("ハイキング", "登山", "トレッキング", "山頂", "滝", "渓谷", "峡", "高原", "ロープウェイ", "ゴンドラ", "林道"),
     "博物館・ビジターセンター・温泉"),
    ("view", ("展望台", "展望", "夜景", "星空", "天体観測", "岬", "灯台", "絶景", "日の出", "朝日", "夕日", "サンセット"),
     "屋内の展望室・プラネタリウム・カフェ"),
    ("park", ("公園", "庭園", "ピクニック", "花見", "桜", "紅葉", "散策", "散歩", "遊歩道", "棚田", "花畑", "ガーデン", "植物園"),
     "美術館・温室・屋内の庭園・カフェ"),
    ("farm", ("牧場", "動物園", "サファリ", "いちご狩り", "イチゴ狩り", "ぶどう狩り", "みかん狩り", "フルーツ狩り", "りんご狩り",
              "収穫体験", "農園"),
     "屋内型の遊び場・水族館・ハウスの果物狩り"),
    ("amusement", ("遊園地", "テーマパーク", "アスレチック", "ジップライン", "パラグライダー", "気球", "スキー", "スノーボード",
                   "ゴルフ", "サイクリング", "レンタサイクル", "乗馬", "フェス", "野外"),
     "屋内の遊び場・ボウリング・映画館"),
    ("festival", ("祭り", "花火", "ビアガーデン", "屋台", "朝市", "マルシェ", "野外ライブ", "盆踊り"),
     "屋内のイベント・劇場・屋内の市場"),
]

# 屋外を歩く・一部が屋外(雨具があれば行ける。強い雨では注意)
PARTLY_WORDS = ("神社", "神宮", "大社", "寺", "城", "城跡", "お寺", "参道", "鳥居", "古い町並み", "町並み", "街並み", "横丁",
                "商店街", "市場", "アウトレット", "露天風呂", "足湯", "橋", "港", "湖", "海岸", "ダム", "史跡", "遺跡")

INDOOR_WORDS = ("水族館", "美術館", "博物館", "資料館", "記念館", "科学館", "プラネタリウム", "映画", "シアター", "劇場",
                "ホール", "ドーム", "ショッピングモール", "モール", "百貨店", "デパート", "屋内", "インドア", "温泉", "スパ",
                "銭湯", "旅館", "ホテル", "カフェ", "喫茶", "レストラン", "食堂", "焼肉", "寿司", "ラーメン", "居酒屋",
                "ボウリング", "カラオケ", "工房", "体験館", "酒蔵", "醸造所", "ワイナリー", "工場見学", "ミュージアム",
                "ギャラリー", "図書館", "鍾乳洞", "地下街", "駅ビル", "アリーナ")

# 種類だけで分かる場合の既定
TYPE_DEFAULT = {"accommodation": "indoor", "dining": "indoor", "shopping": "indoor", "transportation": "unknown",
                "sightseeing": "partly", "activity": "partly", "other": "unknown"}

FIT_LABEL = {"outdoor": "屋外", "partly": "一部屋外", "indoor": "屋内", "unknown": "不明"}


def _text(*parts: Optional[str]) -> str:
    return " ".join(p for p in parts if p).lower()


def _hit(text: str, words) -> Optional[str]:
    for w in words:
        if w.lower() in text:
            return w
    return None


def fit(title: Optional[str], event_type: Optional[str] = None, description: Optional[str] = None,
        extra: Optional[str] = None) -> Dict[str, Any]:
    """予定の天気への強さ。{"fit", "label", "group", "word", "alternative"}。
    屋内の言葉(水族館など)は屋外の言葉より強い(「水族館のイルカショー」は屋内)。ただし BBQ・海水浴などの
    はっきり屋外の言葉は、食事・宿の種類よりも強い(「焼肉 BBQ テラス」は屋外)"""
    t = _text(title, description, extra)
    group = None
    for g, words, alt in OUTDOOR_GROUPS:
        w = _hit(t, words)
        if w:
            group = (g, w, alt)
            break
    indoor = _hit(t, INDOOR_WORDS)
    # はっきり屋外の行い(BBQ・海水浴・水の遊び・山・祭り)は屋内の言葉より強い
    strong = group is not None and group[0] in ("bbq", "beach", "water", "mountain", "festival")
    if group and (strong or not indoor):
        return {"fit": "outdoor", "label": FIT_LABEL["outdoor"], "group": group[0], "word": group[1],
                "alternative": group[2]}
    if indoor:
        return {"fit": "indoor", "label": FIT_LABEL["indoor"], "group": None, "word": indoor, "alternative": None}
    partly = _hit(t, PARTLY_WORDS)
    if partly:
        return {"fit": "partly", "label": FIT_LABEL["partly"], "group": None, "word": partly,
                "alternative": "雨具を持つ・屋根のある所を回る順に"}
    d = TYPE_DEFAULT.get(event_type or "other", "unknown")
    return {"fit": d, "label": FIT_LABEL[d], "group": None, "word": None,
            "alternative": "雨具を持つ・屋根のある所を回る順に" if d == "partly" else None}


def indoor_like(title: Optional[str], category: Optional[str] = None, tags: Optional[List[str]] = None) -> bool:
    """候補(候補箱・行きたい場所)が雨の日に向くか(屋内と見分けられる時だけ真)"""
    r = fit(title, category, None, " ".join(tags or []))
    return r["fit"] == "indoor" and category not in ("accommodation", "transportation")


def rain_note(title: str, f: Dict[str, Any]) -> str:
    """雨の案のたたき台・検証の文"""
    if f["fit"] == "outdoor":
        return f"屋外の「{f['word']}」は雨だと難しい予定です。代わり: {f['alternative']}"
    if f["fit"] == "partly":
        return f"一部が屋外です({f['word'] or '屋外を歩く'})。{f['alternative']}"
    return ""


_TIME = re.compile(r"^(\d{1,2}):(\d{2})")


def minutes_of(v: Optional[str]) -> Optional[int]:
    m = _TIME.match(v or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None
