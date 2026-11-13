"""[Gate Remaining-2] FR-030 気象警報・注意報の自動取得(気象庁の公開の JSON。鍵は要らない・無料)。

- 送り先: https://www.jma.go.jp/bosai/warning/data/warning/{府県予報区}.json だけ。送るのは予報区の番号だけ
- 市区町村(気象庁の class20)ごとに、発表中・継続中の警報・注意報を返す(解除・発表なしは返さない)
- 結果は JMA_CACHE_SECONDS(既定 10 分)使い回す。取れない・無効(JMA_ENABLED=false)の時は Unavailable → 手入力
- 気象庁の発表時刻(reportDatetime)を出典の時刻として返す(古い情報を今の値のように見せない)
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.core.config import settings
from app.services import ext_http, jp_areas
from app.services.ext_http import Unavailable

NAME = "jma_warning"
URL = "https://www.jma.go.jp/bosai/warning/data/warning/{office}.json"
SOURCE_LABEL = "気象庁"

# 警報・注意報の種類の番号 → 名前
CODES = {
    "02": "暴風雪警報", "03": "大雨警報", "04": "洪水警報", "05": "暴風警報", "06": "大雪警報", "07": "波浪警報",
    "08": "高潮警報", "10": "大雨注意報", "12": "大雪注意報", "13": "風雪注意報", "14": "雷注意報", "15": "強風注意報",
    "16": "波浪注意報", "17": "融雪注意報", "18": "洪水注意報", "19": "高潮注意報", "20": "濃霧注意報", "21": "乾燥注意報",
    "22": "なだれ注意報", "23": "低温注意報", "24": "霜注意報", "25": "着氷注意報", "26": "着雪注意報",
    "32": "暴風雪特別警報", "33": "大雨特別警報", "35": "暴風特別警報", "36": "大雪特別警報", "37": "波浪特別警報",
    "38": "高潮特別警報",
}
ACTIVE = {"発表", "継続", "特別警報から警報", "特別警報から注意報", "警報から注意報", "注意報から警報", "警報から特別警報"}
# 旅程に響く(予定の見直しを勧める)もの: 特別警報・警報の全部と、雷・強風・大雪・大雨の注意報
DISRUPTIVE_ADVISORIES = {"10", "12", "14", "15"}


def enabled() -> bool:
    return ext_http.allowed(NAME, "JMA_ENABLED")


def level(code: str) -> str:
    name = CODES.get(code, "")
    if "特別警報" in name:
        return "special"
    if name.endswith("警報"):
        return "warning"
    return "advisory"


def _fetch(office: str) -> Dict[str, Any]:
    if not (office.isdigit() and len(office) == 6):
        raise Unavailable("bad_area")

    def call() -> Dict[str, Any]:
        body = ext_http.get_json(NAME, URL.format(office=office))
        if not isinstance(body, dict):
            raise Unavailable("bad_response")
        areas: Dict[str, List[Dict[str, Any]]] = {}
        for at in body.get("areaTypes") or []:
            for a in (at or {}).get("areas") or []:
                code = str((a or {}).get("code") or "")
                items = []
                for w in (a or {}).get("warnings") or []:
                    wc = str((w or {}).get("code") or "")
                    status = str((w or {}).get("status") or "")
                    if wc in CODES and status in ACTIVE:
                        items.append({"code": wc, "name": CODES[wc], "level": level(wc), "status": status,
                                      "disruptive": level(wc) != "advisory" or wc in DISRUPTIVE_ADVISORIES})
                if code:
                    areas[code] = items
        return {"office": office, "report_at": body.get("reportDatetime"), "headline": body.get("headlineText"),
                "areas": areas}

    ttl = int(getattr(settings, "JMA_CACHE_SECONDS", 600) or 600)
    return ext_http.cached(NAME, office, ttl, call)


def for_municipality(muni_code: str) -> Dict[str, Any]:
    """市区町村コード(5 桁)の発表中の警報・注意報。{office, office_name, report_at, area_name, warnings}"""
    if not enabled():
        raise Unavailable("disabled")
    office = jp_areas.office_of(muni_code)
    if not office:
        raise Unavailable("unknown_area")
    data = _fetch(office)
    seen: Dict[str, Dict[str, Any]] = {}
    for code in jp_areas.class20_codes(muni_code):
        for w in data["areas"].get(code, []):
            seen.setdefault(w["code"], w)
    order = {"special": 0, "warning": 1, "advisory": 2}
    warnings = sorted(seen.values(), key=lambda w: (order[w["level"]], w["code"]))
    return {"office": office, "office_name": jp_areas.office_name(office), "report_at": data.get("report_at"),
            "area_name": jp_areas.municipality_name(muni_code) or jp_areas.prefecture_name(muni_code),
            "warnings": warnings, "source": SOURCE_LABEL}
