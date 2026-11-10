"""[Gate TravelEstimate] 移動の見積もり v2(移動手段ごとの距離・所要時間の参考値)。

外部の経路 API(Google Routes 等)は有料・鍵が要るため使わない。2 点の直線距離(haversine)に、手段ごとの
「迂回の係数」「平均の速さ」「待ち・乗り換え・駅や IC までの時間」を掛け合わせた参考値を返す。値は必ず推定
(is_estimate=True)で、どう計算したか(basis)を一緒に返す。条件の数値は管理者の画面で調整できる
(travel_estimate_settings。既定は DEFAULTS)。

- 車(自家用車・タクシー): 下道と、距離が一定以上なら高速を使う場合の 2 つ。短い方を代表の値にする
- バス・高速バス: 平均の速さ + 待ち時間
- 電車: 駅までと駅からの歩き + 待ち + 距離に応じた速さ(各駅・快速・特急の目安)+ 距離に応じた乗り換え。
  長い距離では新幹線を使う場合も出す
- 新幹線: 駅の乗り換え + 速さ
- 飛行機: 飛んでいる時間だけ(搭乗手続き・保安検査・空港までの移動は含めない。離着陸の加減速の分は足す)
- 徒歩: 健康な大人の平均の速さ(既定 4.8km/h = 80m/分)
- 自転車・船: 平均の速さ
"""
from __future__ import annotations

import copy
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.services.route_estimator import haversine_km

PROVIDER = "tc_estimate"
ALGORITHM = "tc-estimate-v2"

# 設定の項目: (手段, キー, 見出し, 単位, 下限, 上限, 既定)
FIELDS: List[Tuple[str, str, str, str, float, float, float]] = [
    ("walking", "speed_kmh", "歩く速さ", "km/h", 2, 8, 4.8),
    ("walking", "detour", "迂回の係数(直線距離に掛ける)", "倍", 1, 2, 1.25),
    ("bicycle", "speed_kmh", "自転車の速さ", "km/h", 5, 30, 15),
    ("bicycle", "detour", "迂回の係数", "倍", 1, 2, 1.25),
    ("car", "local_speed_kmh", "下道の平均の速さ(信号・渋滞を含む)", "km/h", 10, 80, 32),
    ("car", "local_detour", "下道の迂回の係数", "倍", 1, 2, 1.3),
    ("car", "highway_speed_kmh", "高速道路の平均の速さ", "km/h", 40, 120, 85),
    ("car", "highway_detour", "高速を使う時の迂回の係数", "倍", 1, 2, 1.2),
    ("car", "highway_min_km", "高速を使う案を出す直線距離", "km", 3, 200, 20),
    ("car", "highway_access_min", "IC までと IC からの時間(合計)", "分", 0, 60, 12),
    ("car", "highway_local_share", "高速を使う時に下道を走る割合", "割合", 0, 0.8, 0.15),
    ("car", "parking_min", "駐車・乗り降りの時間", "分", 0, 30, 3),
    ("taxi", "wait_min", "タクシーを待つ時間", "分", 0, 30, 5),
    ("taxi", "speed_factor", "タクシーの速さ(自家用車に対する倍率)", "倍", 0.5, 1.5, 1.0),
    ("bus", "speed_kmh", "路線バスの平均の速さ(停留所を含む)", "km/h", 5, 50, 18),
    ("bus", "detour", "路線バスの迂回の係数", "倍", 1, 2, 1.35),
    ("bus", "wait_min", "バスを待つ時間", "分", 0, 60, 8),
    ("express_bus", "speed_kmh", "高速バスの平均の速さ(休憩を含む)", "km/h", 30, 100, 65),
    ("express_bus", "detour", "高速バスの迂回の係数", "倍", 1, 2, 1.25),
    ("express_bus", "wait_min", "乗り場での待ち", "分", 0, 60, 10),
    ("train", "access_min", "駅まで歩く時間", "分", 0, 30, 8),
    ("train", "egress_min", "駅から歩く時間", "分", 0, 30, 6),
    ("train", "wait_min", "最初の待ち時間", "分", 0, 30, 6),
    ("train", "detour", "線路の迂回の係数", "倍", 1, 2, 1.2),
    ("train", "local_speed_kmh", "各駅停車の平均の速さ", "km/h", 15, 80, 35),
    ("train", "rapid_speed_kmh", "快速・急行の平均の速さ", "km/h", 30, 120, 55),
    ("train", "rapid_from_km", "快速・急行を使う距離", "km", 5, 200, 25),
    ("train", "limited_speed_kmh", "特急の平均の速さ", "km/h", 50, 160, 85),
    ("train", "limited_from_km", "特急を使う距離", "km", 20, 500, 80),
    ("train", "transfer_every_km", "乗り換え 1 回あたりの距離", "km", 5, 300, 35),
    ("train", "transfer_min", "乗り換え 1 回の時間(歩き・待ち)", "分", 0, 40, 8),
    ("train", "max_transfers", "乗り換えの回数の上限", "回", 0, 6, 3),
    ("shinkansen", "speed_kmh", "新幹線の平均の速さ(停車を含む)", "km/h", 100, 320, 210),
    ("shinkansen", "detour", "新幹線の迂回の係数", "倍", 1, 2, 1.1),
    ("shinkansen", "from_km", "新幹線を使う案を出す直線距離", "km", 50, 1000, 150),
    ("shinkansen", "station_min", "駅までの移動・乗り換え(合計)", "分", 0, 90, 30),
    ("flight", "cruise_kmh", "飛行機の巡航の速さ", "km/h", 400, 950, 800),
    ("flight", "detour", "航路の迂回の係数", "倍", 1, 1.5, 1.08),
    ("flight", "takeoff_landing_min", "離陸・着陸の加減速の分(飛行時間に足す)", "分", 0, 60, 20),
    ("ferry", "speed_kmh", "船の平均の速さ", "km/h", 5, 80, 30),
    ("ferry", "detour", "航路の迂回の係数", "倍", 1, 2, 1.1),
    ("ferry", "boarding_min", "乗船の手続き・待ち", "分", 0, 90, 15),
]

MODE_LABEL = {
    "walking": "徒歩", "bicycle": "自転車", "car": "車", "taxi": "タクシー", "bus": "路線バス",
    "express_bus": "高速バス", "train": "電車", "shinkansen": "新幹線", "flight": "飛行機", "ferry": "船",
}

DEFAULTS: Dict[str, Dict[str, float]] = {}
for _m, _k, _label, _unit, _lo, _hi, _v in FIELDS:
    DEFAULTS.setdefault(_m, {})[_k] = _v

# 区間の mode → 計算の手段
PROFILE = {
    "walking": "walking", "bicycle": "bicycle", "driving": "car", "taxi": "taxi", "bus": "bus",
    "express_bus": "express_bus", "train": "train", "transit": "train", "mixed": "train",
    "shinkansen": "shinkansen", "flight": "flight", "ferry": "ferry",
}
NO_ESTIMATE = frozenset({"helicopter"})


def merged(overrides: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    """既定に、保存された値(範囲の中の数だけ)を重ねる"""
    out = copy.deepcopy(DEFAULTS)
    if not isinstance(overrides, dict):
        return out
    for m, k, _label, _unit, lo, hi, _v in FIELDS:
        raw = (overrides.get(m) or {}).get(k) if isinstance(overrides.get(m), dict) else None
        if isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(raw) and lo <= raw <= hi:
            out[m][k] = float(raw)
    return out


def validate(params: Any) -> Tuple[Dict[str, Dict[str, float]], List[str]]:
    """管理者の入力を確かめる。範囲の外・数でない値は誤りとして返す(黙って既定にしない)"""
    errors: List[str] = []
    out = copy.deepcopy(DEFAULTS)
    if not isinstance(params, dict):
        return out, ["params は手段ごとの値の表にしてください"]
    for m, k, label, unit, lo, hi, _v in FIELDS:
        group = params.get(m)
        if not isinstance(group, dict) or k not in group:
            continue
        raw = group[k]
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
            errors.append(f"{MODE_LABEL[m]}・{label}: 数を入れてください")
        elif not lo <= raw <= hi:
            errors.append(f"{MODE_LABEL[m]}・{label}: {lo:g}〜{hi:g}{unit}の範囲にしてください")
        else:
            out[m][k] = float(raw)
    return out, errors


def _r(v: float, n: int = 1) -> float:
    return round(v + 0.0, n)


def _variant(key: str, label: str, km: float, minutes: float, note: str = "") -> Dict[str, Any]:
    return {"key": key, "label": label, "distance_km": _r(km, 1), "duration_minutes": _r(minutes, 0), "note": note}


def _car(p: Dict[str, Dict[str, float]], straight: float, extra_min: float,
         speed_factor: float = 1.0) -> List[Dict[str, Any]]:
    c = p["car"]
    local_km = straight * c["local_detour"]
    local = local_km / (c["local_speed_kmh"] * speed_factor) * 60 + c["parking_min"] + extra_min
    out = [_variant("local", "下道", local_km, local, f"平均 {c['local_speed_kmh'] * speed_factor:g}km/h")]
    if straight >= c["highway_min_km"]:
        hw_km = straight * c["highway_detour"]
        share = c["highway_local_share"]
        hw = (hw_km * share / (c["local_speed_kmh"] * speed_factor) * 60
              + hw_km * (1 - share) / (c["highway_speed_kmh"] * speed_factor) * 60
              + c["highway_access_min"] + c["parking_min"] + extra_min)
        out.append(_variant("highway", "高速利用", hw_km, hw,
                            f"高速 {c['highway_speed_kmh'] * speed_factor:g}km/h・IC まで {c['highway_access_min']:g}分"))
    return out


def _train(p: Dict[str, Dict[str, float]], straight: float) -> List[Dict[str, Any]]:
    t = p["train"]
    km = straight * t["detour"]
    if km >= t["limited_from_km"]:
        speed, kind = t["limited_speed_kmh"], "特急"
    elif km >= t["rapid_from_km"]:
        speed, kind = t["rapid_speed_kmh"], "快速・急行"
    else:
        speed, kind = t["local_speed_kmh"], "各駅停車"
    transfers = min(int(t["max_transfers"]), int(km // t["transfer_every_km"]))
    minutes = (t["access_min"] + t["wait_min"] + km / speed * 60 + transfers * t["transfer_min"] + t["egress_min"])
    out = [_variant("recommended", f"{kind}・乗り換え {transfers} 回", km, minutes,
                    f"駅まで {t['access_min']:g}分・待ち {t['wait_min']:g}分・駅から {t['egress_min']:g}分を含む")]
    s = p["shinkansen"]
    if straight >= s["from_km"]:
        skm = straight * s["detour"]
        smin = skm / s["speed_kmh"] * 60 + s["station_min"] + t["access_min"] + t["egress_min"]
        out.append(_variant("shinkansen", "新幹線を使う場合", skm, smin, f"平均 {s['speed_kmh']:g}km/h・駅の乗り換えを含む"))
    return out


def variants_for(mode: str, straight: float, p: Dict[str, Dict[str, float]]) -> List[Dict[str, Any]]:
    prof = PROFILE.get(mode, "walking")
    if prof == "walking":
        w = p["walking"]
        km = straight * w["detour"]
        return [_variant("walk", "徒歩", km, km / w["speed_kmh"] * 60, f"平均 {w['speed_kmh']:g}km/h")]
    if prof == "bicycle":
        b = p["bicycle"]
        km = straight * b["detour"]
        return [_variant("bike", "自転車", km, km / b["speed_kmh"] * 60, f"平均 {b['speed_kmh']:g}km/h")]
    if prof == "car":
        return _car(p, straight, 0)
    if prof == "taxi":
        return _car(p, straight, p["taxi"]["wait_min"], p["taxi"]["speed_factor"])
    if prof in ("bus", "express_bus"):
        b = p[prof]
        km = straight * b["detour"]
        return [_variant(prof, MODE_LABEL[prof], km, km / b["speed_kmh"] * 60 + b["wait_min"],
                         f"平均 {b['speed_kmh']:g}km/h・待ち {b['wait_min']:g}分")]
    if prof == "train":
        return _train(p, straight)
    if prof == "shinkansen":
        s, t = p["shinkansen"], p["train"]
        km = straight * s["detour"]
        minutes = km / s["speed_kmh"] * 60 + s["station_min"] + t["access_min"] + t["egress_min"]
        return [_variant("shinkansen", "新幹線", km, minutes, f"平均 {s['speed_kmh']:g}km/h・駅の乗り換えを含む")]
    if prof == "flight":
        f = p["flight"]
        km = straight * f["detour"]
        return [_variant("air", "飛行時間", km, km / f["cruise_kmh"] * 60 + f["takeoff_landing_min"],
                         "搭乗手続き・保安検査・空港までの移動は含みません")]
    f = p["ferry"]
    km = straight * f["detour"]
    return [_variant("ferry", "船", km, km / f["speed_kmh"] * 60 + f["boarding_min"],
                     f"平均 {f['speed_kmh']:g}km/h・乗船の手続き {f['boarding_min']:g}分")]


def estimate(from_lat: Optional[float], from_lon: Optional[float], to_lat: Optional[float], to_lon: Optional[float],
             mode: str, params: Optional[Dict[str, Dict[str, float]]] = None,
             revision: int = 0) -> Optional[Dict[str, Any]]:
    """区間の参考値。座標が欠けた時・推定しない手段では None(架空の値を作らない)"""
    if None in (from_lat, from_lon, to_lat, to_lon) or mode in NO_ESTIMATE:
        return None
    p = params or DEFAULTS
    straight = haversine_km(float(from_lat), float(from_lon), float(to_lat), float(to_lon))  # type: ignore[arg-type]
    vs = variants_for(mode, straight, p)
    best = min(vs[:2] if PROFILE.get(mode) in ("car", "taxi") else vs[:1], key=lambda v: v["duration_minutes"])
    return {
        "distance_km": best["distance_km"],
        "duration_minutes": best["duration_minutes"],
        "straight_km": _r(straight, 2),
        "variants": vs,
        "basis": f"直線 {straight:.1f}km をもとにした目安(実際の道・時刻表ではありません)",
        "is_estimate": True,
        "provider": PROVIDER,
        "algorithm_version": f"{ALGORITHM}+r{revision}",
        "computed_at": datetime.now(timezone.utc),
    }


def preview(params: Dict[str, Dict[str, float]], km_list: List[float]) -> List[Dict[str, Any]]:
    """管理者の画面の試算(直線距離ごと・手段ごと)"""
    rows = []
    for km in km_list:
        for mode in ("walking", "bicycle", "driving", "taxi", "bus", "express_bus", "train", "shinkansen", "flight",
                     "ferry"):
            rows.append({"straight_km": km, "mode": mode, "variants": variants_for(mode, km, params)})
    return rows


# ===================================================================== 保存された条件(DB)

def load(db: Any) -> Tuple[Dict[str, Dict[str, float]], int]:
    """今の条件と版。行が無い・読めない時は既定と版 0"""
    from app.models.models import TravelEstimateSettings
    row = db.get(TravelEstimateSettings, 1)
    if row is None:
        return copy.deepcopy(DEFAULTS), 0
    return merged(row.params), int(row.revision or 0)


def diff_from_defaults(params: Dict[str, Dict[str, float]]) -> Dict[str, Dict[str, float]]:
    """保存するのは既定から変えた値だけ(既定を後で直した時に、触っていない項目は新しい既定に従う)"""
    out: Dict[str, Dict[str, float]] = {}
    for m, k, *_ in FIELDS:
        if params[m][k] != DEFAULTS[m][k]:
            out.setdefault(m, {})[k] = params[m][k]
    return out


def schema() -> List[Dict[str, Any]]:
    return [{"mode": m, "mode_label": MODE_LABEL[m], "key": k, "label": label, "unit": unit, "min": lo, "max": hi,
             "default": v} for m, k, label, unit, lo, hi, v in FIELDS]
