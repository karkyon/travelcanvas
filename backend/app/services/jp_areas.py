"""[Gate Remaining-2] 日本の地域の番号(全国地方公共団体コード・気象庁の予報区)。

- 都道府県の番号(01〜47)と名前は固定の表(通信しない)
- 市区町村の名前・気象庁の府県予報区(警報の単位)は気象庁の area.json(公開・無料)から取る(1 日使い回す)
- 気象庁の市町村の区分(class20)の番号は「市区町村コード 5 桁 + 2 桁」。1 つの市が複数に分かれる所もある
- 取れない時: 名前は都道府県まで、予報区は都道府県の番号 + 0000(北海道・沖縄など分かれている所は None)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.services import ext_http
from app.services.ext_http import Unavailable

NAME = "jma_area"
AREA_URL = "https://www.jma.go.jp/bosai/common/const/area.json"

PREFECTURES = (
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
    "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
    "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
    "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
)
# 1 つの都道府県が複数の府県予報区に分かれている所(area.json が無い時は予報区を決めない)
SPLIT_PREFS = {"01", "46", "47"}


def prefecture_name(code: Optional[str]) -> Optional[str]:
    if not code or len(code) < 2 or not code[:2].isdigit():
        return None
    n = int(code[:2])
    return PREFECTURES[n - 1] if 1 <= n <= 47 else None


def _load() -> Optional[Dict[str, Any]]:
    if not ext_http.allowed(NAME, "JMA_ENABLED"):
        return None

    def call() -> Dict[str, Any]:
        body = ext_http.get_json(NAME, AREA_URL, timeout=10.0)
        if not isinstance(body, dict) or "class20s" not in body or "offices" not in body:
            raise Unavailable("bad_response")
        return body

    try:
        return ext_http.cached(NAME, "area", 86400, call)
    except Unavailable:
        return None


def class20_codes(muni_code: str) -> List[str]:
    """市区町村コード(5 桁)→ 気象庁の市町村の区分の番号(7 桁)。area.json が無い時は推定の 1 つ"""
    muni_code = (muni_code or "")[:5]
    if len(muni_code) != 5 or not muni_code.isdigit():
        return []
    data = _load()
    if not data:
        return [muni_code + "00"]
    c20 = data.get("class20s") or {}
    exact = muni_code + "00"
    if exact in c20:
        return [exact]
    return sorted(k for k in c20 if k.startswith(muni_code))


def municipality_name(muni_code: str) -> Optional[str]:
    data = _load()
    if not data:
        return None
    c20 = data.get("class20s") or {}
    codes = class20_codes(muni_code)
    for code in codes:
        name = str((c20.get(code) or {}).get("name") or "")
        if not name:
            continue
        if len(codes) > 1:
            # 分かれている市(「浜松市北部」等)は市の名前までにする
            for part in ("北西部", "南東部", "南西部", "北東部", "北部", "南部", "東部", "西部", "中部"):
                if name.endswith(part) and len(name) > len(part):
                    return name[:-len(part)]
        return name
    return None


def office_of(muni_code: str) -> Optional[str]:
    """市区町村コード → 府県予報区の番号(警報の JSON の単位。例 130000)"""
    data = _load()
    pref = (muni_code or "")[:2]
    if not data:
        return None if (not pref.isdigit() or pref in SPLIT_PREFS) else pref + "0000"
    c20 = data.get("class20s") or {}
    c15 = data.get("class15s") or {}
    c10 = data.get("class10s") or {}
    offices = data.get("offices") or {}
    for code in class20_codes(muni_code):
        p15 = (c20.get(code) or {}).get("parent")
        p10 = (c15.get(p15) or {}).get("parent") if p15 else None
        off = (c10.get(p10) or {}).get("parent") if p10 else None
        if off and off in offices:
            return off
    return None if (not pref.isdigit() or pref in SPLIT_PREFS) else pref + "0000"


def office_name(office: str) -> Optional[str]:
    data = _load()
    if data:
        name = ((data.get("offices") or {}).get(office) or {}).get("name")
        if name:
            return name
    return prefecture_name(office)
