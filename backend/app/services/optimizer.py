"""[Gate L4] FR-018 説明可能な最適化(algorithm_version = explainable-opt-v1)の純粋関数(DB非依存)。

従来(Gate #33、nn-haversine-v1)は1日の予定の「並び順」だけを近傍法で入れ替え、時刻は変えなかった(画面上の時刻と順番が
食い違う)。また制約(L2)・実行可能性検証(L3)を見ていなかった(B-007)。本モジュールは次を行う:

- 動かさない予定: 確定(ロック)済み、予約と紐付く予定、位置(緯度経度)の無い予定、終日の予定。元の位置・時刻のまま。
- 動かす予定(movable)の「並び順」を入れ替える。時刻は「枠」として扱う: 動かす予定が元々持っていた開始時刻の集合を
  早い順に、新しい並び順の予定へ割り当て直す(時刻の無い予定は時刻の無いまま)。時刻のある予定とない予定が混在する日は、
  時刻のない予定は動かさない(時刻を失わせない)。終了時刻(end_at)がある予定は所要時間を保ったまま一緒に動かす。
- 候補の並び順: 現在の順、各地点からの最近傍法、最も短い順への2-opt改善(動かす予定が6件以下なら全ての並び順)。
  重複を除く(決定的で、同じ入力なら同じ結果)。
- 各候補の移動距離・移動時間(内部推定、直線距離ベース)と、実行可能性検証(feasibility-v1)の結果を計算し、
  「移動が最短の案」と「制約・検証を優先した案」を選ぶ。元の順との差分(順番・時刻の変化)と理由の文を付ける。
"""
from __future__ import annotations

import hashlib
import itertools
from dataclasses import dataclass, replace
from datetime import datetime, time as time_cls, timezone
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.services import feasibility
from app.services.route_estimator import estimate_leg, haversine_km
from app.services.today_mode import parse_local_time, zone_for

ALGORITHM_VERSION = "explainable-opt-v1"
MAX_MOVABLE_FOR_SEARCH = 12
# 動かす予定がこの件数以下なら全ての並び順を候補にする(6件で720通り。制約・検証を優先した案を確実に探すため)
MAX_MOVABLE_FOR_EXHAUSTIVE = 6


@dataclass(frozen=True)
class Item:
    id: str
    title: str
    latitude: Optional[float]
    longitude: Optional[float]
    local_start_time: Optional[str]
    is_all_day: bool
    sort_order: int
    locked: bool
    has_reservation: bool


def _has_coords(i: Item) -> bool:
    return i.latitude is not None and i.longitude is not None


def classify(items: Sequence[Item]) -> Tuple[List[str], Dict[str, str], List[str]]:
    """(動かす予定のID, 動かさない予定のID→理由, 注意)。itemsは並び順。"""
    reasons: Dict[str, str] = {}
    candidates = []
    for i in items:
        if i.locked:
            reasons[i.id] = "確定(ロック)済み"
        elif i.has_reservation:
            reasons[i.id] = "予約と紐付いている"
        elif i.is_all_day:
            reasons[i.id] = "終日の予定"
        elif not _has_coords(i):
            reasons[i.id] = "位置(緯度経度)がない"
        else:
            candidates.append(i)
    warnings: List[str] = []
    timed = [i for i in candidates if parse_local_time(i.local_start_time)]
    untimed = [i for i in candidates if not parse_local_time(i.local_start_time)]
    if timed and untimed:
        for i in untimed:
            reasons[i.id] = "時刻のない予定(時刻のある予定と入れ替えると時刻が失われるため)"
        candidates = timed
        warnings.append(f"時刻のない予定{len(untimed)}件は並べ替えの対象外です")
    no_coords = sum(1 for i in items if not i.locked and not i.has_reservation and not i.is_all_day
                    and not _has_coords(i))
    if no_coords:
        warnings.append(f"位置(緯度経度)のない予定{no_coords}件は並べ替えの対象外です")
    return [i.id for i in candidates], reasons, warnings


def _dist(a: Item, b: Item) -> float:
    if a.latitude is None or a.longitude is None or b.latitude is None or b.longitude is None:
        return math.inf  # 位置の無い予定は並べ替えの対象外(呼び出し元で除いている)
    return haversine_km(a.latitude, a.longitude, b.latitude, b.longitude)


def _full_order(items: Sequence[Item], movable: Sequence[str], movable_order: Sequence[str]) -> List[str]:
    """動かす予定が占めていた位置へ、新しい順で入れる(他の予定の位置は変えない)。"""
    it = iter(movable_order)
    mset = set(movable)
    return [next(it) if i.id in mset else i.id for i in items]


def _path_km(order: Sequence[str], by_id: Dict[str, Item]) -> float:
    pts = [by_id[i] for i in order if _has_coords(by_id[i])]
    return sum(_dist(a, b) for a, b in zip(pts, pts[1:]))


def _nearest(start: str, ids: Sequence[str], by_id: Dict[str, Item]) -> List[str]:
    rest = [i for i in ids if i != start]
    out = [start]
    while rest:
        cur = by_id[out[-1]]
        nxt = min(rest, key=lambda r: (_dist(cur, by_id[r]), r))
        out.append(nxt)
        rest.remove(nxt)
    return out


def _two_opt(items, movable, order, by_id) -> List[str]:
    best = list(order)
    best_km = _path_km(_full_order(items, movable, best), by_id)
    improved = True
    while improved:
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                cand = best[:i] + list(reversed(best[i:j + 1])) + best[j + 1:]
                km = _path_km(_full_order(items, movable, cand), by_id)
                if km < best_km - 1e-9:
                    best, best_km, improved = cand, km, True
    return best


def candidate_orders(items: Sequence[Item], movable: Sequence[str]) -> List[List[str]]:
    """候補となる並び順(1日全体の予定IDの並び)。先頭は現在の順。"""
    by_id = {i.id: i for i in items}
    current = [i.id for i in items]
    orders = [current]
    if len(movable) < 2 or len(movable) > MAX_MOVABLE_FOR_SEARCH:
        return orders
    variants = [list(movable)] + [_nearest(s, movable, by_id) for s in movable]
    if len(movable) <= MAX_MOVABLE_FOR_EXHAUSTIVE:
        variants += [list(p) for p in itertools.permutations(movable)]
    best = min(variants, key=lambda o: (_path_km(_full_order(items, movable, o), by_id), o))
    variants.append(_two_opt(items, movable, best, by_id))
    seen = {tuple(current)}
    for v in variants:
        full = _full_order(items, movable, v)
        if tuple(full) not in seen:
            seen.add(tuple(full))
            orders.append(full)
    return orders


def assign_times(items: Sequence[Item], movable: Sequence[str], order: Sequence[str]) -> Dict[str, Optional[str]]:
    """新しい並び順での各予定の開始時刻(HH:MM)。動かす予定は元の時刻の枠を早い順に割り当て直す。"""
    by_id = {i.id: i for i in items}
    out = {i.id: i.local_start_time for i in items}
    mset = set(movable)
    slot_times = [(t, parse_local_time(t)) for t in (by_id[m].local_start_time for m in movable)]
    slots = [t for t, parsed in sorted(((t, p) for t, p in slot_times if p is not None), key=lambda x: x[1])]
    if not slots:
        return out
    new_seq = [i for i in order if i in mset]
    for event_id, slot in zip(new_seq, slots):
        out[event_id] = slot
    return out


def route_totals(order: Sequence[str], by_id: Dict[str, Item], mode: str = "walking") -> Tuple[float, float, int]:
    """(距離km、所要分、位置が無く計算できない区間数)。内部推定(直線距離ベース)。"""
    km, minutes, unknown = 0.0, 0.0, 0
    seq = [by_id[i] for i in order]
    for a, b in zip(seq, seq[1:]):
        leg = estimate_leg(a.latitude, a.longitude, b.latitude, b.longitude, mode)
        if leg is None:
            unknown += 1
            continue
        km += leg["distance_km"]
        minutes += leg["duration_minutes"]
    return round(km, 2), round(minutes, 1), unknown


def order_hash(order: Sequence[str], times: Dict[str, Optional[str]]) -> str:
    raw = "|".join(f"{i}@{times.get(i) or ''}" for i in order)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ===================================================================== 実行可能性検証との接続

def simulated_snapshot(snap: feasibility.Snapshot, day_local_date, timezone_id: str,
                       new_times: Dict[str, Optional[str]], new_orders: Dict[str, int]) -> feasibility.Snapshot:
    """時刻・並び順を変えた場合のスナップショット(DBは変えない)。終了時刻は所要時間を保って動かす。"""
    tz = zone_for(timezone_id)
    events = []
    for e in snap.events:
        key = str(e.id)
        if key not in new_times:
            events.append(e)
            continue
        t = parse_local_time(new_times[key])
        start = e.start
        end = e.end
        if t is not None and not e.is_all_day:
            new_start = datetime.combine(day_local_date, time_cls(t.hour, t.minute), tzinfo=tz).astimezone(timezone.utc)
            if end is not None and start is not None:
                end = new_start + (end - start)
            start = new_start
        events.append(replace(e, start=start, end=end, sort_order=new_orders.get(key, e.sort_order)))
    return replace(snap, events=events)


def finding_key(f: feasibility.Finding) -> Tuple[str, str, str]:
    return (f.code, str(f.entity_id or ""), str(f.constraint.id if f.constraint else ""))


def summarize_findings(result: feasibility.EvaluationResult) -> Dict[str, int]:
    c = feasibility.counts(result.findings)
    statuses = [r["status"] for r in result.constraint_results]
    return {**c, "constraints_satisfied": statuses.count("satisfied"),
            "constraints_violated": statuses.count("violated")}


def diff_findings(before: feasibility.EvaluationResult, after: feasibility.EvaluationResult):
    """(新たに出る問題, 解消する問題)。値は (Finding)。検証不能は数えるが差分には出さない。"""
    b = {finding_key(f): f for f in before.findings if f.kind == "violation"}
    a = {finding_key(f): f for f in after.findings if f.kind == "violation"}
    new = [a[k] for k in a if k not in b]
    resolved = [b[k] for k in b if k not in a]
    return new, resolved


def score(summary: Dict[str, int], km: float) -> Tuple:
    """制約・検証を優先する並べ方の評価(小さいほど良い): ERROR→制約違反→WARNING→距離。"""
    return (summary["error"], summary["constraints_violated"], summary["warning"], km)


def explain(changes: List[Dict], saved_km: Optional[float], summary_before: Dict[str, int],
            summary_after: Dict[str, int]) -> List[str]:
    out = []
    if saved_km is not None and saved_km > 0.01:
        out.append(f"移動距離が約{saved_km}km短くなります(直線距離による概算)")
    elif saved_km is not None and saved_km < -0.01:
        out.append(f"移動距離は約{-saved_km}km長くなります")
    d_err = summary_after["error"] - summary_before["error"]
    d_warn = summary_after["warning"] - summary_before["warning"]
    d_vio = summary_after["constraints_violated"] - summary_before["constraints_violated"]
    if d_err < 0:
        out.append(f"検証のエラーが{-d_err}件減ります")
    if d_err > 0:
        out.append(f"検証のエラーが{d_err}件増えます")
    if d_vio < 0:
        out.append(f"守れていない制約が{-d_vio}件減ります")
    if d_vio > 0:
        out.append(f"守れていない制約が{d_vio}件増えます")
    if d_warn < 0:
        out.append(f"検証の注意が{-d_warn}件減ります")
    if d_warn > 0:
        out.append(f"検証の注意が{d_warn}件増えます")
    moved = [c for c in changes if c["before_index"] != c["after_index"]]
    if moved:
        out.append(f"{len(moved)}件の予定の順番が変わります")
    return out


# ===================================================================== [Gate G7] MOVE-04 目的の内訳・条件変更・部分の採用

WEIGHT_KEYS = ("distance", "constraints", "fatigue", "fairness")
WEIGHT_LABEL = {"distance": "移動距離", "constraints": "検証・制約", "fatigue": "疲れ", "fairness": "公平さ"}
DEFAULT_WEIGHTS = {"distance": 1, "constraints": 3, "fatigue": 1, "fairness": 1}
MAX_WEIGHT = 5


def clean_weights(raw: Optional[Dict[str, int]]) -> Optional[Dict[str, int]]:
    """条件(重み 0〜5)。None は「条件を指定しない」(従来どおり最短の案・制約を優先した案だけ)。"""
    if raw is None:
        return None
    out = dict(DEFAULT_WEIGHTS)
    for k, v in raw.items():
        if k not in WEIGHT_KEYS:
            raise ValueError(f"不明な条件です: {k}")
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= MAX_WEIGHT:
            raise ValueError(f"{WEIGHT_LABEL[k]}の重みは0〜{MAX_WEIGHT}の整数です")
        out[k] = v
    if not any(out.values()):
        raise ValueError("少なくとも1つの条件の重みを1以上にしてください")
    return out


def day_movement(result: "feasibility.EvaluationResult", day_id: str) -> Dict[str, Optional[int]]:
    """その日の疲れの目安(%)と休憩なしの最長(分)。移動の既定を使っていなければ None。"""
    m = next((d for d in result.day_metrics if d.get("day_id") == day_id), None)
    if m is None:
        return {"fatigue_percent": None, "longest_continuous_minutes": None}
    return {"fatigue_percent": m.get("fatigue_percent"),
            "longest_continuous_minutes": m.get("longest_continuous_minutes")}


def fairness(result: "feasibility.EvaluationResult", constraints) -> Dict[str, Optional[int]]:
    """制約を持つメンバーごとの「守れていない割合」の開き(%、0 が最も公平)。2人未満なら None。
    秘匿制約は件数だけを使う(値・名前は使わない)。メンバーごとの内訳は返さない(誰の条件かを推測させない)。"""
    status = {r["constraint_id"]: r["status"] for r in result.constraint_results}
    per: Dict[str, List[int]] = {}
    for c in constraints.constraints:
        st = status.get(str(c.id))
        if st not in ("satisfied", "violated"):
            continue
        per.setdefault(str(c.owner_user_id), []).append(1 if st == "violated" else 0)
    rates = [sum(v) / len(v) for v in per.values() if v]
    if len(rates) < 2:
        return {"members": len(rates), "spread_percent": None}
    return {"members": len(rates), "spread_percent": int(round(100 * (max(rates) - min(rates)) / 10) * 10)}


def objective(summary: Dict[str, int], km: float, move: Dict[str, Optional[int]], fair: Dict[str, Optional[int]],
              weights: Dict[str, int]) -> Dict[str, object]:
    """目的の内訳(小さいほど良い)。各項目の値・重み・点と合計。点の作り方は画面に示す(説明できる最適化)。"""
    fatigue = move.get("fatigue_percent")
    spread = fair.get("spread_percent")
    terms: List[Dict[str, Any]] = [
        {"key": "distance", "label": WEIGHT_LABEL["distance"], "value": round(km, 2), "unit": "km",
         "score": round(km, 2), "rule": "1kmごとに1点"},
        {"key": "constraints", "label": WEIGHT_LABEL["constraints"],
         "value": summary["error"] * 10 + summary["constraints_violated"] * 5 + summary["warning"] * 2, "unit": "点",
         "score": summary["error"] * 10 + summary["constraints_violated"] * 5 + summary["warning"] * 2,
         "rule": "エラー10点・守れていない制約5点・注意2点"},
        {"key": "fatigue", "label": WEIGHT_LABEL["fatigue"], "value": fatigue, "unit": "%",
         "score": round((fatigue or 0) / 10, 1), "rule": "疲れの目安10%ごとに1点(移動の既定を使う時だけ)"},
        {"key": "fairness", "label": WEIGHT_LABEL["fairness"], "value": spread, "unit": "%",
         "score": round((spread or 0) / 10, 1), "rule": "メンバーごとの守れていない割合の開き10%ごとに1点"},
    ]
    total = 0.0
    for t in terms:
        weight = weights.get(str(t["key"]), 0)
        weighted = round(float(t["score"] or 0) * weight, 2)
        t["weight"] = weight
        t["weighted"] = weighted
        total += weighted
    return {"terms": terms, "total": round(total, 2), "weights": dict(weights)}


def partial_order(items: Sequence[Item], movable: Sequence[str], cand_order: Sequence[str],
                  cand_times: Dict[str, Optional[str]],
                  selected: Sequence[str]) -> Tuple[List[str], Dict[str, Optional[str]]]:
    """選んだ予定だけを案の時刻・順番へ動かした並び(他の予定は今の時刻のまま。動かさない予定の位置は変えない)。"""
    sel = set(selected)
    base_index = {i.id: n for n, i in enumerate(items)}
    cand_index = {eid: n for n, eid in enumerate(cand_order)}
    times = {i.id: (cand_times.get(i.id) if i.id in sel else i.local_start_time) for i in items}

    def key(eid: str):
        t = parse_local_time(times[eid])
        pos = cand_index[eid] if eid in sel else base_index[eid]
        minutes = (t.hour * 60 + t.minute) if t is not None else 0
        return (0 if t is not None else 1, minutes, pos, 0 if eid in sel else 1)

    sequence = sorted(movable, key=key)
    return _full_order(items, movable, sequence), times
