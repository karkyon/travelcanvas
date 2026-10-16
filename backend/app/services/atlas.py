"""[Gate P15] FR-052 Personal Travel Atlas の純粋関数(DB非依存)。

複数の旅行を横断して、訪れた地域を格子(緯度・経度の区画)で集計する(atlas-v1)。
- 区画の細かさ: region=0.1度(約11km)、area=1度(約110km)。区画は南西の角の座標で表す(例 "0.1:34.9:135.7")。
- 状態(DOC-15 CA-007 の考え方を格子に当てはめる。強い順): STAYED(30分以上滞在した実績)> VISITED(行った実績・
  位置付きの記録)> PASS_THROUGH(位置の軌跡だけ)> PLANNED(これからの旅行の予定だけ)。
  単純な塗りつぶしにせず、予定・通過・訪問・滞在を区別する。
- 国・都道府県・市区町村の名前は、逆ジオコーディング(座標→地名)の提供元が未接続のため出さない(捏造しない)。
"""
import math
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

ALGORITHM_VERSION = "atlas-v1"
PRECISIONS = {"region": 0.1, "area": 1.0}
STATE_RANK = {"PLANNED": 1, "PASS_THROUGH": 2, "VISITED": 3, "STAYED": 4}
STAY_MINUTES = 30


def cell_key(lat: float, lng: float, precision: str) -> Dict[str, Any]:
    step = PRECISIONS[precision]
    # 浮動小数の誤差で境界の点が隣の区画へずれないよう、小さな値を足してから切り捨てる
    lat0 = math.floor(lat / step + 1e-9) * step
    lng0 = math.floor(lng / step + 1e-9) * step
    digits = 1 if precision == "region" else 0
    lat0, lng0 = round(lat0, digits), round(lng0, digits)
    return {"key": f"{step:g}:{lat0:.{digits}f}:{lng0:.{digits}f}", "lat_min": lat0, "lng_min": lng0,
            "lat_max": round(lat0 + step, digits), "lng_max": round(lng0 + step, digits)}


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def aggregate(observations: Iterable[Dict[str, Any]], precision: str) -> List[Dict[str, Any]]:
    """observations: {lat, lng, state, at(datetime|None), plan_id, plan_title, kind}
    kind: actual / memory / track / planned(根拠の種類。区画ごとに件数を数える)"""
    cells: Dict[str, Dict[str, Any]] = {}
    for o in observations:
        lat, lng = o.get("lat"), o.get("lng")
        if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        c = cell_key(lat, lng, precision)
        cell = cells.setdefault(c["key"], {**c, "state": o["state"], "first_at": None, "last_at": None,
                                           "trips": {}, "evidence": {}})
        if STATE_RANK[o["state"]] > STATE_RANK[cell["state"]]:
            cell["state"] = o["state"]
        cell["evidence"][o["kind"]] = cell["evidence"].get(o["kind"], 0) + 1
        cell["trips"][o["plan_id"]] = o["plan_title"]
        at = _aware(o.get("at"))
        if at is not None and o["state"] != "PLANNED":
            if cell["first_at"] is None or at < cell["first_at"]:
                cell["first_at"] = at
            if cell["last_at"] is None or at > cell["last_at"]:
                cell["last_at"] = at
    out = []
    for c in sorted(cells.values(), key=lambda x: (-STATE_RANK[x["state"]], x["key"])):
        out.append({
            **{k: c[k] for k in ("key", "lat_min", "lat_max", "lng_min", "lng_max", "state")},
            "first_at": c["first_at"].isoformat() if c["first_at"] else None,
            "last_at": c["last_at"].isoformat() if c["last_at"] else None,
            "trips": [{"plan_id": pid, "title": t} for pid, t in sorted(c["trips"].items(), key=lambda x: x[1] or "")],
            "evidence": dict(sorted(c["evidence"].items())),
        })
    return out


def summarize(cells: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_state = {s: sum(1 for c in cells if c["state"] == s) for s in ("STAYED", "VISITED", "PASS_THROUGH", "PLANNED")}
    visited = [c for c in cells if c["state"] in ("STAYED", "VISITED")]
    revisited = sum(1 for c in visited if len(c["trips"]) >= 2)
    return {
        "cells": len(cells), "by_state": by_state,
        "visited_cells": len(visited),
        # 再訪率(CA-011): 訪れた区画のうち、2つ以上の旅行で訪れた区画の割合。訪れた区画が無ければ None
        "revisit_rate": round(revisited / len(visited), 4) if visited else None,
        "algorithm_version": ALGORITHM_VERSION,
    }
