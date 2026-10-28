"""[Gate V2] FR-050 訪問判定・信頼度(DOC-15 CA-008、DOC-14「v5.1 訪問判定・GPS・MAP性能」)の純粋関数(DB非依存)。

判定の規則 visit-v1(DOC-14 の初期値をそのまま使う。値を変える時は algorithm_version を上げ、再計算の影響を示す):
- 精度(accuracy)が 100m より悪い点は判定の材料にしない。
- 予定の場所の半径は種類(event_type)ごとに 50〜300m(CATEGORY_RADIUS_M)。
- 訪問(VISITED): 半径の中の有効な点が2つ以上、かつ2分以上いた。滞在(STAYED): 10分以上いた。
- 通過(PASS_THROUGH): 半径の中に入ったが、速さが 15km/h より速い、または2分未満だった。
- 信頼度 confidence = 距離 0.35 + 滞在 0.25 + 精度 0.15 + 証拠(写真・予約・手動の記録) 0.25。
  0.80 以上=高、0.50〜0.79=要確認、0.50 未満=候補。
- 証拠付きの訪問(VERIFIED_VISIT)は、利用者が確かめた時か、強い証拠が2種類以上ある時だけ(STRONG_EVIDENCE)。
  自動の判定は確定しない(LIKELY_VISIT)。予定(travel_events)・実績(event_actuals)は変えない(不変条件4)。

判定の状態(CA-008): VERIFIED_VISIT / LIKELY_VISIT / PASS_THROUGH / PLANNED_ONLY / MANUAL / REJECTED。
地図の層の状態(CA-007): VERIFIED / STAYED / VISITED / PASS_THROUGH / PLANNED / HIDDEN。
根拠(reasons)には座標を入れない(距離・時間・件数・証拠の種類だけ)。
"""
import math
from datetime import datetime, timezone
from statistics import median
from typing import Any, Dict, Iterable, List, Optional

ALGORITHM_VERSION = "visit-v1"

MAX_ACCURACY_M = 100.0
VISIT_MIN_POINTS = 2
VISIT_MIN_SECONDS = 120
STAY_MIN_SECONDS = 600
PASS_SPEED_KMH = 15.0
# 同じ場所にいた続きとみなす点の間隔の上限(これより空いたら、別の時に来たものとして分ける)
MAX_GAP_SECONDS = 30 * 60
WEIGHTS = {"distance": 0.35, "dwell": 0.25, "accuracy": 0.15, "evidence": 0.25}
HIGH = 0.80
REVIEW = 0.50

DEFAULT_RADIUS_M = 100
CATEGORY_RADIUS_M = {
    "restaurant": 50, "meeting": 75, "shopping": 100, "other": 100, "activity": 150, "entertainment": 150,
    "accommodation": 150, "sightseeing": 200, "free_time": 300, "transportation": 300,
}

STATES = ("VERIFIED_VISIT", "LIKELY_VISIT", "PASS_THROUGH", "PLANNED_ONLY", "MANUAL", "REJECTED")
LAYER_STATES = ("VERIFIED", "STAYED", "VISITED", "PASS_THROUGH", "PLANNED", "HIDDEN")
EVIDENCE_KINDS = ("photo", "reservation", "manual")
# 強い証拠: 10分以上の滞在の軌跡・写真・予約(チケット)・手動の記録(行った)
STRONG_EVIDENCE = ("gps_stay", "photo", "reservation", "manual")

# 利用者の訂正(PATCH)。hide/unhide は状態を変えず、地図・Atlas に出すかだけを変える
USER_ACTIONS = ("confirm", "pass_through", "reject", "hide", "unhide", "reset")
ACTION_STATE = {"confirm": "VERIFIED_VISIT", "pass_through": "PASS_THROUGH", "reject": "REJECTED"}


def radius_for(event_type: Optional[str]) -> int:
    return CATEGORY_RADIUS_M.get(event_type or "", DEFAULT_RADIUS_M)


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lng1, lat2, lng2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1.0, math.sqrt(h)))


def _t(v: Any) -> datetime:
    dt = v if isinstance(v, datetime) else datetime.fromisoformat(str(v))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _round2(x: float) -> float:
    """小数第2位へ四捨五入する(round() の偶数への丸めでは 0.825 が 0.82 になるため)。"""
    return math.floor(x * 100 + 0.5 + 1e-9) / 100


def level_of(confidence: Optional[float]) -> Optional[str]:
    if confidence is None:
        return None
    return "high" if confidence >= HIGH else "review" if confidence >= REVIEW else "candidate"


def visit_metrics(lat: float, lng: float, radius_m: float, points: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """軌跡の点から、予定の場所についての数値だけを取り出す(座標は返さない)。
    points: [{t, lat, lng, acc}]。端末だけに座標を置くモードでは、端末が同じ計算をして数値だけを送る。"""
    pts: List[Dict[str, Any]] = sorted(
        ({"t": _t(p["t"]), "lat": float(p["lat"]), "lng": float(p["lng"]), "acc": p.get("acc")} for p in points),
        key=lambda p: p["t"])
    valid = [p for p in pts if p["acc"] is None or float(p["acc"]) <= MAX_ACCURACY_M]
    low_accuracy = len(pts) - len(valid)
    # 有効な点を時刻順に見て、半径の中に続けている間を1回の訪問としてまとめる
    runs: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    for p in valid:
        d = _haversine_m(lat, lng, p["lat"], p["lng"])
        inside = d <= radius_m
        gap = (p["t"] - current[-1]["t"]).total_seconds() if current else 0
        if inside and current and gap <= MAX_GAP_SECONDS:
            current.append({**p, "d": d})
        elif inside:
            if current:
                runs.append(current)
            current = [{**p, "d": d}]
        else:
            if current:
                runs.append(current)
            current = []
    if current:
        runs.append(current)
    inside_points = sum(len(r) for r in runs)
    if not runs:
        return {"points_total": len(pts), "points_valid": len(valid), "points_low_accuracy": low_accuracy,
                "points_inside": 0, "runs": 0, "dwell_seconds": 0, "median_distance_m": None,
                "median_accuracy_m": None, "speed_kmh": None}
    best = max(runs, key=lambda r: ((r[-1]["t"] - r[0]["t"]).total_seconds(), len(r)))
    dwell = (best[-1]["t"] - best[0]["t"]).total_seconds()
    path = sum(_haversine_m(best[i - 1]["lat"], best[i - 1]["lng"], best[i]["lat"], best[i]["lng"])
               for i in range(1, len(best)))
    speed = round(path / dwell * 3.6, 1) if dwell > 0 else None
    accs = [float(p["acc"]) for p in best if p["acc"] is not None]
    return {
        "points_total": len(pts), "points_valid": len(valid), "points_low_accuracy": low_accuracy,
        "points_inside": inside_points, "runs": len(runs), "best_run_points": len(best),
        "dwell_seconds": int(dwell), "median_distance_m": round(median(p["d"] for p in best), 1),
        "median_accuracy_m": round(median(accs), 1) if accs else None, "speed_kmh": speed,
    }


def clean_metrics(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """端末から送られた数値を検証する(範囲外・型違いは None)。座標の項目は受け付けない。"""
    if not isinstance(raw, dict) or set(raw) - set(METRIC_LIMITS):
        return None
    out: Dict[str, Any] = {}
    for key, (lo, hi, integer, required) in METRIC_LIMITS.items():
        v = raw.get(key)
        if v is None:
            if required:
                return None
            out[key] = None
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
            return None
        if integer and int(v) != v:
            return None
        out[key] = int(v) if integer else round(float(v), 1)
    if out["points_inside"] > out["points_valid"] or out["points_valid"] > out["points_total"]:
        return None
    out["points_low_accuracy"] = out["points_total"] - out["points_valid"]
    out["runs"] = 1 if out["points_inside"] else 0
    out["best_run_points"] = out["points_inside"]
    return out


# (最小, 最大, 整数, 必須)
METRIC_LIMITS = {
    "points_total": (0, 100_000, True, True),
    "points_valid": (0, 100_000, True, True),
    "points_inside": (0, 100_000, True, True),
    "dwell_seconds": (0, 7 * 86400, True, True),
    "median_distance_m": (0, 300, False, False),
    "median_accuracy_m": (0, MAX_ACCURACY_M, False, False),
    "speed_kmh": (0, 1000, False, False),
}


def assess(metrics: Dict[str, Any], radius_m: float, evidence: Dict[str, bool]) -> Dict[str, Any]:
    """数値と証拠から、状態・信頼度・根拠を決める。evidence: {photo, reservation, manual}(真偽値)"""
    kinds = [k for k in EVIDENCE_KINDS if evidence.get(k)]
    inside = metrics.get("points_inside") or 0
    dwell = metrics.get("dwell_seconds") or 0
    speed = metrics.get("speed_kmh")
    dist = metrics.get("median_distance_m")
    acc = metrics.get("median_accuracy_m")

    evidence_score = min(len(kinds) / 2, 1.0)
    if inside == 0:
        scores = {"distance": 0.0, "dwell": 0.0, "accuracy": 0.0, "evidence": evidence_score}
    else:
        scores = {
            "distance": max(0.0, 1 - (dist or 0) / radius_m) if radius_m else 0.0,
            "dwell": min(dwell / STAY_MIN_SECONDS, 1.0),
            # 精度が分からない点だけの時は中間の 0.5(良いとも悪いとも言えない)
            "accuracy": 0.5 if acc is None else max(0.0, 1 - acc / MAX_ACCURACY_M),
            "evidence": evidence_score,
        }
    confidence = _round2(sum(WEIGHTS[k] * scores[k] for k in WEIGHTS))

    visited_rule = inside >= VISIT_MIN_POINTS and dwell >= VISIT_MIN_SECONDS and \
        (speed is None or speed <= PASS_SPEED_KMH)
    stayed = visited_rule and dwell >= STAY_MIN_SECONDS
    strong = [k for k in kinds] + (["gps_stay"] if stayed else [])
    if visited_rule:
        state = "VERIFIED_VISIT" if len(strong) >= 2 else "LIKELY_VISIT"
        basis = "gps"
    elif inside > 0:
        # 半径に入ったが短い・速い。手動の記録があっても通過として示し、利用者の確認に任せる
        state = "PASS_THROUGH"
        basis = "gps"
    elif "manual" in kinds:
        state = "VERIFIED_VISIT" if len(strong) >= 2 else "MANUAL"
        basis = "manual"
    else:
        state = "PLANNED_ONLY"
        basis = "none"
    if state in ("PLANNED_ONLY",):
        confidence = _round2(WEIGHTS["evidence"] * evidence_score)
    reasons = {
        "basis": basis, "radius_m": int(radius_m), "points_inside": inside,
        "points_valid": metrics.get("points_valid", 0), "points_low_accuracy": metrics.get("points_low_accuracy", 0),
        "dwell_seconds": int(dwell), "median_distance_m": dist, "median_accuracy_m": acc, "speed_kmh": speed,
        "evidence": kinds, "strong_evidence": strong, "stayed": stayed,
        "scores": {k: round(v, 2) for k, v in scores.items()},
    }
    if state == "PASS_THROUGH":
        reasons["pass_reason"] = "fast" if speed is not None and speed > PASS_SPEED_KMH else "short"
    return {"state": state, "confidence": confidence, "level": level_of(confidence), "reasons": reasons,
            "algorithm_version": ALGORITHM_VERSION}


def needs_confirmation(state: str, source: str, confidence: Optional[float]) -> bool:
    """利用者の確認を求めるか。本人が決めたものは求めない。自動の訪問・通過は「高」でも確定はしないが、
    高ければ一覧の上で強調しない(低信頼度だけ確認を依頼する。DOC-14 §7.4)。"""
    if source == "user":
        return False
    if state in ("LIKELY_VISIT", "PASS_THROUGH", "MANUAL"):
        return level_of(confidence) != "high"
    return False


def layer_state(state: Optional[str], hidden: bool, stayed: bool) -> str:
    if hidden:
        return "HIDDEN"
    if state == "VERIFIED_VISIT":
        return "VERIFIED"
    if state in ("LIKELY_VISIT", "MANUAL"):
        return "STAYED" if stayed else "VISITED"
    if state == "PASS_THROUGH":
        return "PASS_THROUGH"
    return "PLANNED"


def counts(items: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    out = {s: 0 for s in LAYER_STATES}
    for it in items:
        out[it["layer_state"]] = out.get(it["layer_state"], 0) + 1
    return out


def rules() -> Dict[str, Any]:
    """画面に出す判定の規則(説明のため)。"""
    return {
        "algorithm_version": ALGORITHM_VERSION, "max_accuracy_m": MAX_ACCURACY_M,
        "visit_min_points": VISIT_MIN_POINTS, "visit_min_seconds": VISIT_MIN_SECONDS,
        "stay_min_seconds": STAY_MIN_SECONDS, "pass_speed_kmh": PASS_SPEED_KMH, "weights": WEIGHTS,
        "high": HIGH, "review": REVIEW, "radius_m": CATEGORY_RADIUS_M, "default_radius_m": DEFAULT_RADIUS_M,
    }
