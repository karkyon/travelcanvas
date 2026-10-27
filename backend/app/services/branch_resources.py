"""[Gate G8] FR-019 案の中で予約・移動区間そのものを変える分岐(branch-v2)。

G7 までの分岐案は予定だけを変えた。ここでは分岐案の中で、移動区間(変える・外す・足す)と予約(別の予定へ付け替える・
取り消す予定にする)も変え、採用の前に影響を確かめ、選んだ変更だけを本案へ当てる。

保存の形(itinerary_branches.resources):
    {"base": {"segments": [区間の写し], "reservations": [予約の写し]},
     "segments": [{"op": "update", "segment_id", "fields": {...}} | {"op": "remove", "segment_id"} |
                  {"op": "add", "key", "fields": {"from": 予定の参照, "to": 予定の参照, ...}}],
     "reservations": [{"op": "relink", "reservation_id", "to": 予定の参照 | null} |
                      {"op": "cancel", "reservation_id", "note"}]}
    予定の参照 = {"event": 本案の予定のID} または {"key": 分岐案で足した予定の key}

安全の決まり:
- 予約は外部へ取消・変更を送らない(TravelCanvas は予約の事業者と繋がっていない)。「取り消す予定」にした予約は、採用すると
  予定との紐付けを外し、準備の一覧へ「予約の取消の手続き」を作るだけ(状態は手続きの後に利用者が「取消」にする)
- base は変更を初めて保存した時の本案の区間・予約。採用の時に今の本案と比べ、分岐の後に本案でも同じ区間・予約が変わって
  いれば競合として止める(黙って上書きしない。予定の三方向の取り込みと同じ)
- 確定(ロック)した紐付けのある予約は付け替え・取消にできない
- 選んで採用する時は、選んだ変更が頼る変更(足した予定を使う区間・付け替え)も選ばれていなければ断る
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

ALGORITHM_VERSION = "branch-v2"
MODES = ("walking", "driving", "train", "bus", "ferry", "flight", "bicycle", "taxi", "mixed")
SEGMENT_STATUSES = ("planned", "confirmed", "cancelled")
SEGMENT_FIELDS = (
    "mode", "status", "planned_departure_at", "planned_arrival_at", "last_departure_at", "duration_minutes",
    "distance_km", "cost", "currency", "transport_number", "platform", "preparation_minutes", "buffer_before_minutes",
)
_DT_FIELDS = ("planned_departure_at", "planned_arrival_at", "last_departure_at")
_NUM_FIELDS = ("duration_minutes", "distance_km")
_INT_FIELDS = ("preparation_minutes", "buffer_before_minutes")
_TEXT_FIELDS = ("transport_number", "platform")
MAX_SEGMENT_OPS = 200
MAX_RESERVATION_OPS = 200
_CURRENCY = re.compile(r"^[A-Z]{3}$")


class ResourceError(ValueError):
    pass


# ===================================================================== 写し

def _iso(v: Any) -> Optional[str]:
    if v is None:
        return None
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def segment_item(seg: Any) -> Dict[str, Any]:
    return {
        "id": str(seg.id),
        "from_event_id": str(seg.from_event_id) if seg.from_event_id else None,
        "to_event_id": str(seg.to_event_id) if seg.to_event_id else None,
        "from_place_id": str(seg.from_place_id) if seg.from_place_id else None,
        "to_place_id": str(seg.to_place_id) if seg.to_place_id else None,
        "mode": seg.mode,
        "status": seg.status,
        "planned_departure_at": _iso(seg.planned_departure_at),
        "planned_arrival_at": _iso(seg.planned_arrival_at),
        "last_departure_at": _iso(seg.last_departure_at),
        "duration_minutes": float(seg.duration_minutes) if seg.duration_minutes is not None else None,
        "distance_km": float(seg.distance_km) if seg.distance_km is not None else None,
        "cost": f"{Decimal(str(seg.cost)):.2f}" if seg.cost is not None else None,
        "currency": seg.currency,
        "transport_number": seg.transport_number,
        "platform": seg.platform,
        "preparation_minutes": int(seg.preparation_minutes or 0),
        "buffer_before_minutes": int(seg.buffer_before_minutes or 0),
        "reservation_id": str(seg.reservation_id) if seg.reservation_id else None,
    }


def reservation_item(r: Any, links: Sequence[Any]) -> Dict[str, Any]:
    event_ids = sorted({str(x.event_id) for x in links} | ({str(r.event_id)} if r.event_id else set()))
    return {
        "id": str(r.id),
        "label": r.provider_name or r.type or "予約",
        "type": r.type,
        "status": r.status,
        "event_id": str(r.event_id) if r.event_id else None,
        "event_ids": event_ids,
        "locked": any(bool(x.is_locked) for x in links),
        "total_amount": float(r.total_amount) if r.total_amount is not None else None,
        "currency": r.currency,
        "cancellation_deadline": _iso(r.cancellation_deadline),
    }


def empty() -> Dict[str, Any]:
    return {"base": None, "segments": [], "reservations": []}


def normalized(resources: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    r = dict(resources or {})
    return {"base": r.get("base"), "segments": list(r.get("segments") or []),
            "reservations": list(r.get("reservations") or [])}


# ===================================================================== 検証

def _parse_dt(v: Any, label: str) -> Optional[str]:
    if v is None or v == "":
        return None
    if not isinstance(v, str):
        raise ResourceError(f"{label}は日時(ISO 8601)で指定してください")
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise ResourceError(f"{label}の日時の形式が正しくありません")
    if dt.tzinfo is None:
        raise ResourceError(f"{label}には時差(+09:00 など)を付けてください")
    return dt.isoformat()


def _event_ref(raw: Any, live_sources: Set[str], live_keys: Set[str], label: str) -> Dict[str, str]:
    if not isinstance(raw, dict) or len(raw) != 1 or not ({"event", "key"} & set(raw)):
        raise ResourceError(f"{label}は予定を1つ指定してください")
    if "event" in raw:
        v = str(raw["event"])
        if v not in live_sources:
            raise ResourceError(f"{label}: この案に無い予定(または外す予定)です")
        return {"event": v}
    v = str(raw["key"])
    if v not in live_keys:
        raise ResourceError(f"{label}: この案で足した予定が見つかりません")
    return {"key": v}


def _segment_fields(raw: Any, label: str, allow_endpoints: bool) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ResourceError(f"{label}: 変える項目を指定してください")
    allowed = set(SEGMENT_FIELDS) | ({"from", "to"} if allow_endpoints else set())
    extra = set(raw) - allowed
    if extra:
        raise ResourceError(f"{label}: 変えられない項目です: {sorted(extra)}")
    out: Dict[str, Any] = {}
    for k, v in raw.items():
        if k in ("from", "to"):
            out[k] = v
        elif k == "mode":
            if v not in MODES:
                raise ResourceError(f"{label}: 移動手段が正しくありません")
            out[k] = v
        elif k == "status":
            if v not in SEGMENT_STATUSES:
                raise ResourceError(f"{label}: 状態が正しくありません")
            out[k] = v
        elif k in _DT_FIELDS:
            out[k] = _parse_dt(v, label)
        elif k in _NUM_FIELDS:
            if v is None:
                out[k] = None
                continue
            if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0 or v > 100_000:
                raise ResourceError(f"{label}: 所要時間・距離は0以上の数で指定してください")
            out[k] = float(v)
        elif k in _INT_FIELDS:
            if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 1440:
                raise ResourceError(f"{label}: 準備・余裕は0〜1440分で指定してください")
            out[k] = v
        elif k == "cost":
            if v is None:
                out[k] = None
                continue
            try:
                d = Decimal(str(v))
            except (InvalidOperation, ValueError):
                raise ResourceError(f"{label}: 費用は数で指定してください")
            if not d.is_finite() or d < 0 or d >= Decimal("1e12"):
                raise ResourceError(f"{label}: 費用は0以上で指定してください")
            out[k] = f"{d.quantize(Decimal('0.01')):.2f}"
        elif k == "currency":
            if v is not None and (not isinstance(v, str) or not _CURRENCY.match(v)):
                raise ResourceError(f"{label}: 通貨は英大文字3文字(JPY など)で指定してください")
            out[k] = v
        elif k in _TEXT_FIELDS:
            if v is not None and (not isinstance(v, str) or len(v) > 100):
                raise ResourceError(f"{label}: 便名・番線は100文字までです")
            out[k] = v or None
    return out


def _merged(base: Dict[str, Any], fields: Dict[str, Any]) -> Dict[str, Any]:
    return {**base, **{k: v for k, v in fields.items() if k not in ("from", "to")}}


def _check_merged(seg: Dict[str, Any], label: str) -> None:
    if (seg.get("cost") is None) != (seg.get("currency") is None):
        raise ResourceError(f"{label}: 費用と通貨は一緒に指定してください")
    dep, arr = seg.get("planned_departure_at"), seg.get("planned_arrival_at")
    if dep and arr and datetime.fromisoformat(arr) < datetime.fromisoformat(dep):
        raise ResourceError(f"{label}: 到着は出発より後にしてください")


def validate(raw: Dict[str, Any], base: Dict[str, Any], content: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """保存する変更を検証して正規化する。base は resources.base(区間・予約の写し)、content は分岐案の予定。"""
    if not isinstance(raw, dict):
        raise ResourceError("変更の形が正しくありません")
    extra = set(raw) - {"segments", "reservations"}
    if extra:
        raise ResourceError(f"不明な項目です: {sorted(extra)}")
    segs_in = raw.get("segments") or []
    res_in = raw.get("reservations") or []
    if not isinstance(segs_in, list) or not isinstance(res_in, list):
        raise ResourceError("変更は一覧で指定してください")
    if len(segs_in) > MAX_SEGMENT_OPS or len(res_in) > MAX_RESERVATION_OPS:
        raise ResourceError("変更が多すぎます")
    live_sources = {e["source_event_id"] for e in content if e.get("source_event_id") and not e.get("removed")}
    removed_sources = {e["source_event_id"] for e in content if e.get("source_event_id") and e.get("removed")}
    live_keys = {e["key"] for e in content if not e.get("source_event_id")}
    base_segs = {s["id"]: s for s in base.get("segments") or []}
    base_res = {r["id"]: r for r in base.get("reservations") or []}

    seen_segs: Set[str] = set()
    seg_ops: List[Dict[str, Any]] = []
    add_keys: Set[str] = set()
    for i, op in enumerate(segs_in):
        label = f"移動区間の{i + 1}件目"
        if not isinstance(op, dict) or op.get("op") not in ("update", "remove", "add"):
            raise ResourceError(f"{label}: 変更の種類が正しくありません")
        if op["op"] in ("update", "remove"):
            sid = str(op.get("segment_id") or "")
            if sid not in base_segs:
                raise ResourceError(f"{label}: 案を作った時の本案に無い区間です")
            if sid in seen_segs:
                raise ResourceError(f"{label}: 同じ区間の変更が重複しています")
            seen_segs.add(sid)
            if op["op"] == "remove":
                if set(op) - {"op", "segment_id"}:
                    raise ResourceError(f"{label}: 外す区間に項目は指定できません")
                seg_ops.append({"op": "remove", "segment_id": sid})
                continue
            fields = _segment_fields(op.get("fields"), label, allow_endpoints=False)
            if not fields:
                raise ResourceError(f"{label}: 変える項目がありません")
            ends = {base_segs[sid]["from_event_id"], base_segs[sid]["to_event_id"]}
            if ends & removed_sources:
                raise ResourceError(f"{label}: この案で外す予定につながる区間です(変えずに外してください)")
            _check_merged(_merged(base_segs[sid], fields), label)
            seg_ops.append({"op": "update", "segment_id": sid, "fields": fields})
        else:
            key = str(op.get("key") or f"seg-{uuid.uuid4().hex[:12]}")
            if not re.match(r"^[A-Za-z0-9_-]{1,64}$", key) or key in add_keys:
                raise ResourceError(f"{label}: 区間の key が正しくありません")
            add_keys.add(key)
            fields = _segment_fields(op.get("fields"), label, allow_endpoints=True)
            src = _event_ref(fields.get("from"), live_sources, live_keys, f"{label}の出発")
            dst = _event_ref(fields.get("to"), live_sources, live_keys, f"{label}の到着")
            if src == dst:
                raise ResourceError(f"{label}: 出発と到着が同じ予定です")
            if "mode" not in fields:
                raise ResourceError(f"{label}: 移動手段を選んでください")
            fields["from"], fields["to"] = src, dst
            fields.setdefault("status", "planned")
            _check_merged(_merged({}, fields), label)
            seg_ops.append({"op": "add", "key": key, "fields": fields})

    seen_res: Set[str] = set()
    res_ops: List[Dict[str, Any]] = []
    for i, op in enumerate(res_in):
        label = f"予約の{i + 1}件目"
        if not isinstance(op, dict) or op.get("op") not in ("relink", "cancel"):
            raise ResourceError(f"{label}: 変更の種類が正しくありません")
        rid = str(op.get("reservation_id") or "")
        if rid not in base_res:
            raise ResourceError(f"{label}: 案を作った時の本案に無い予約です")
        if rid in seen_res:
            raise ResourceError(f"{label}: 同じ予約の変更が重複しています")
        seen_res.add(rid)
        b = base_res[rid]
        if b["locked"]:
            raise ResourceError(f"{label}: 確定した紐付けのある予約は付け替え・取消にできません")
        if op["op"] == "relink":
            if set(op) - {"op", "reservation_id", "to"}:
                raise ResourceError(f"{label}: 不明な項目があります")
            to = op.get("to")
            ref = None if to is None else _event_ref(to, live_sources, live_keys, f"{label}の付け替え先")
            if ref is not None and ref.get("event") and b["event_ids"] == [ref["event"]]:
                raise ResourceError(f"{label}: 今と同じ予定です")
            if ref is None and not b["event_ids"]:
                raise ResourceError(f"{label}: 紐付いている予定がありません")
            res_ops.append({"op": "relink", "reservation_id": rid, "to": ref})
        else:
            if set(op) - {"op", "reservation_id", "note"}:
                raise ResourceError(f"{label}: 不明な項目があります")
            note = op.get("note")
            if note is not None and (not isinstance(note, str) or len(note) > 200):
                raise ResourceError(f"{label}: メモは200文字までです")
            if b["status"] == "cancelled":
                raise ResourceError(f"{label}: 既に取消になっている予約です")
            res_ops.append({"op": "cancel", "reservation_id": rid, "note": (note or "").strip() or None})
    return {"base": base, "segments": seg_ops, "reservations": res_ops}


# ===================================================================== 差分・競合

def op_id_for_event(o: Dict[str, Any]) -> str:
    return f"event:add:{o['key']}" if o["op"] == "add" else f"event:{o['event_id']}"


def op_id_for_segment(o: Dict[str, Any]) -> str:
    return f"segment:add:{o['key']}" if o["op"] == "add" else f"segment:{o['segment_id']}"


def op_id_for_reservation(o: Dict[str, Any]) -> str:
    return f"reservation:{o['reservation_id']}"


def _ref_deps(ref: Optional[Dict[str, str]]) -> List[str]:
    return [f"event:add:{ref['key']}"] if ref and ref.get("key") else []


def dependencies(event_ops: Sequence[Dict[str, Any]], resources: Dict[str, Any]) -> Dict[str, List[str]]:
    """変更の ID → 一緒に選ぶ必要のある変更の ID(足した予定を使う区間・付け替え)。"""
    deps: Dict[str, List[str]] = {op_id_for_event(o): [] for o in event_ops}
    for s in resources.get("segments") or []:
        d: List[str] = []
        if s["op"] == "add":
            d = _ref_deps(s["fields"].get("from")) + _ref_deps(s["fields"].get("to"))
        deps[op_id_for_segment(s)] = d
    for r in resources.get("reservations") or []:
        deps[op_id_for_reservation(r)] = _ref_deps(r.get("to")) if r["op"] == "relink" else []
    return deps


def resolving_ops(event_id: str, resources: Dict[str, Any]) -> Tuple[Set[str], Set[str]]:
    """予定を外す時、その予定の紐付けを解く区間(外す)・予約(付け替え・取消)の ID。"""
    base = resources.get("base") or {}
    segs = {s["id"]: s for s in base.get("segments") or []}
    res = {r["id"]: r for r in base.get("reservations") or []}
    seg_ids = {s["segment_id"] for s in resources.get("segments") or [] if s["op"] == "remove"
               and event_id in (segs.get(s["segment_id"], {}).get("from_event_id"),
                                segs.get(s["segment_id"], {}).get("to_event_id"))}
    res_ids = set()
    for r in resources.get("reservations") or []:
        b = res.get(r["reservation_id"])
        if b and event_id in b["event_ids"]:
            if r["op"] == "cancel" or (r["op"] == "relink" and (r.get("to") or {}).get("event") != event_id):
                res_ids.add(r["reservation_id"])
    return seg_ids, res_ids


def find_conflicts(resources: Dict[str, Any], current_segments: Dict[str, Dict[str, Any]],
                   current_reservations: Dict[str, Dict[str, Any]],
                   current_event_ids: Set[str]) -> List[Dict[str, Any]]:
    base = resources.get("base") or {}
    base_segs = {s["id"]: s for s in base.get("segments") or []}
    base_res = {r["id"]: r for r in base.get("reservations") or []}
    out: List[Dict[str, Any]] = []
    for s in resources.get("segments") or []:
        oid = op_id_for_segment(s)
        if s["op"] == "add":
            for side in ("from", "to"):
                ref = s["fields"].get(side) or {}
                if ref.get("event") and ref["event"] not in current_event_ids:
                    out.append({"kind": "segment", "op_id": oid, "op": "add", "reason": "event_missing"})
                    break
            continue
        cur = current_segments.get(s["segment_id"])
        b = base_segs[s["segment_id"]]
        if cur is None:
            if s["op"] == "update":
                out.append({"kind": "segment", "op_id": oid, "op": "update", "reason": "deleted_in_plan"})
            continue
        keys = list(s["fields"]) if s["op"] == "update" else list(SEGMENT_FIELDS) + ["from_event_id", "to_event_id"]
        changed = [k for k in keys if cur.get(k) != b.get(k)
                   and (s["op"] == "remove" or cur.get(k) != s["fields"].get(k))]
        if changed:
            out.append({"kind": "segment", "op_id": oid, "op": s["op"], "reason": "changed_in_plan",
                        "fields": changed})
    for r in resources.get("reservations") or []:
        oid = op_id_for_reservation(r)
        cur = current_reservations.get(r["reservation_id"])
        b = base_res[r["reservation_id"]]
        if cur is None:
            out.append({"kind": "reservation", "op_id": oid, "op": r["op"], "reason": "deleted_in_plan",
                        "label": b["label"]})
            continue
        if cur["locked"]:
            out.append({"kind": "reservation", "op_id": oid, "op": r["op"], "reason": "locked", "label": b["label"]})
            continue
        if cur["event_ids"] != b["event_ids"]:
            out.append({"kind": "reservation", "op_id": oid, "op": r["op"], "reason": "changed_in_plan",
                        "label": b["label"], "fields": ["event_ids"]})
            continue
        if r["op"] == "cancel" and cur["status"] == "cancelled":
            out.append({"kind": "reservation", "op_id": oid, "op": "cancel", "reason": "already_cancelled",
                        "label": b["label"]})
        to = r.get("to") if r["op"] == "relink" else None
        if to and to.get("event") and to["event"] not in current_event_ids:
            out.append({"kind": "reservation", "op_id": oid, "op": "relink", "reason": "event_missing",
                        "label": b["label"]})
    return out


def summarize(resources: Dict[str, Any]) -> Dict[str, int]:
    segs = resources.get("segments") or []
    res = resources.get("reservations") or []
    return {
        "segments_added": sum(1 for s in segs if s["op"] == "add"),
        "segments_removed": sum(1 for s in segs if s["op"] == "remove"),
        "segments_updated": sum(1 for s in segs if s["op"] == "update"),
        "reservations_relinked": sum(1 for r in res if r["op"] == "relink"),
        "reservations_cancel_planned": sum(1 for r in res if r["op"] == "cancel"),
    }


def select(resources: Dict[str, Any], only: Optional[Set[str]]) -> Dict[str, Any]:
    if only is None:
        return resources
    return {**resources,
            "segments": [s for s in resources.get("segments") or [] if op_id_for_segment(s) in only],
            "reservations": [r for r in resources.get("reservations") or [] if op_id_for_reservation(r) in only]}


def missing_dependencies(only: Set[str], deps: Dict[str, List[str]]) -> List[Dict[str, Any]]:
    out = []
    for oid in sorted(only):
        need = [d for d in deps.get(oid, []) if d not in only]
        if need:
            out.append({"op_id": oid, "requires": need})
    return out


def visible(resources: Dict[str, Any], hidden: Iterable[str]) -> Dict[str, Any]:
    """参加者に隠す項目(FR-045)を除いた応答の形。予約を隠す人には予約の写し・変更を出さない(件数も出さない)。
    費用を隠す人には区間の費用を出さない。"""
    hidden = set(hidden)
    base = resources.get("base") or {"segments": [], "reservations": []}
    segs = [dict(s) for s in base.get("segments") or []]
    seg_ops = [{**s, "fields": dict(s.get("fields") or {})} if "fields" in s else dict(s)
               for s in resources.get("segments") or []]
    if "costs" in hidden:
        for s in segs:
            s["cost"] = None
            s["currency"] = None
        for s in seg_ops:
            if "fields" in s:
                s["fields"].pop("cost", None)
                s["fields"].pop("currency", None)
    if "reservations" in hidden:
        for s in segs:
            s["reservation_id"] = None
    out = {
        "algorithm_version": ALGORITHM_VERSION,
        "base_segments": segs,
        "segments": seg_ops,
        "reservations_hidden": "reservations" in hidden,
        "costs_hidden": "costs" in hidden,
    }
    if "reservations" in hidden:
        out["base_reservations"] = []
        out["reservations"] = []
    else:
        res = [dict(r) for r in base.get("reservations") or []]
        if "costs" in hidden:
            for r in res:
                r["total_amount"] = None
                r["currency"] = None
        out["base_reservations"] = res
        out["reservations"] = [dict(r) for r in resources.get("reservations") or []]
    return out
