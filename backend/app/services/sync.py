"""[Gate P11] FR-033 オフライン編集・同期の純粋関数(DB非依存)。

方針(DOC-06 §30、DOC-13 §5):
- 端末は操作ごとに operation_id(UUID)を付けて送る。同じ operation_id の再送は、記録した結果を返す(二重に適用しない)。
- 競合 = 端末が編集を始めた版(base_revision)の値から、サーバーでも同じ項目が別の値に変わっている状態。
  サーバーで同じ値に変わっていれば競合にしない。サーバーで変わった項目を端末が変えていなければ競合にしない(項目単位)。
- 予定の削除: 編集を始めた後にサーバーで変更されていれば競合。予約・移動・文書と紐付く予定はオフラインでは削除しない
  (オンラインで紐付けの扱いを確認して削除する)。確定(ロック)した予定は変更・削除しない。
- client_at(端末の時刻)は並び順の根拠にしない(送られてきた順に処理する)。
- [Gate G6] OFF-02 対象を広げる: 日程(day: 作成・名前とメモの変更・空の日程の削除)、日程の中の予定の並び(order: reorder)。
  予約(reservation)は予約番号・チケット等の機密を含むため、オフラインでは変えない(常に online_required。
  オンラインで本人確認の後に変える)。同じ送信の中の操作は、仮のIDの依存(日程の作成 → その日程への予定の作成 →
  その予定の変更・並び)の順に処理する(送られた順を保ったまま、依存先を先にする)。
"""
import re
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple

SYNC_FIELDS = ("day_id", "title", "description", "event_type", "local_start_time", "is_all_day", "address",
               "latitude", "longitude")
DAY_FIELDS = ("local_date", "timezone_id", "title", "notes")
ENTITY_ACTIONS = {"event": ("create", "update", "delete"), "day": ("create", "update", "delete"),
                  "order": ("reorder",), "reservation": ("create", "update", "delete")}
MAX_ORDER = 300
MAX_OPERATIONS = 100
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class SyncError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def is_uuid(value: Any) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


def clean_fields(raw: Optional[Dict[str, Any]], action: str) -> Dict[str, Any]:
    """送られてきた項目を検証し、同期できる項目だけを返す。"""
    raw = raw or {}
    unknown = set(raw) - set(SYNC_FIELDS)
    if unknown:
        raise SyncError("unknown_fields", f"同期できない項目があります: {sorted(unknown)}")
    out: Dict[str, Any] = {}
    for k, v in raw.items():
        if k == "title":
            v = (v or "").strip() if isinstance(v, str) else v
            if not isinstance(v, str) or not 1 <= len(v) <= 200:
                raise SyncError("invalid_field", "予定名は1〜200文字で入力してください")
        elif k == "local_start_time":
            if v is not None and (not isinstance(v, str) or not _TIME_RE.match(v)):
                raise SyncError("invalid_field", "時刻はHH:MMで入力してください")
        elif k in ("description", "address"):
            if v is not None and (not isinstance(v, str) or len(v) > 2000):
                raise SyncError("invalid_field", f"{k}は2000文字までです")
        elif k == "event_type":
            if not isinstance(v, str) or not 1 <= len(v.strip()) <= 50:
                raise SyncError("invalid_field", "種類は1〜50文字です")
            v = v.strip()
        elif k == "is_all_day":
            if not isinstance(v, bool):
                raise SyncError("invalid_field", "終日は真偽値です")
        elif k in ("latitude", "longitude"):
            limit = 90 if k == "latitude" else 180
            if v is not None and (not isinstance(v, (int, float)) or isinstance(v, bool) or not -limit <= v <= limit):
                raise SyncError("invalid_field", f"{k}の値が範囲外です")
        elif k == "day_id":
            if not is_uuid(v):
                raise SyncError("invalid_field", "日程の指定が正しくありません")
            v = str(v)
        out[k] = v
    if action == "create":
        if "title" not in out or "day_id" not in out:
            raise SyncError("invalid_field", "予定の作成には日程と予定名が必要です")
    elif action == "update" and not out:
        raise SyncError("invalid_field", "変更する項目がありません")
    return out


def comparable(event_dict: Dict[str, Any]) -> Dict[str, Any]:
    """_event_to_dict の形 → 同期の比較に使う項目だけ。"""
    return {k: event_dict.get(k) for k in SYNC_FIELDS}


def field_conflicts(at_base: Dict[str, Any], current: Dict[str, Any], mine: Dict[str, Any]) -> List[str]:
    """端末が変えた項目のうち、編集開始後にサーバーでも別の値へ変わった項目。"""
    return [f for f, v in mine.items() if at_base.get(f) != current.get(f) and current.get(f) != v]


def changed_since_base(at_base: Dict[str, Any], current: Dict[str, Any]) -> List[str]:
    return [f for f in SYNC_FIELDS if at_base.get(f) != current.get(f)]


def result_row(operation_id: str, status: str, code: Optional[str] = None, entity_id: Optional[str] = None,
               temp_id: Optional[str] = None, resulting_revision: Optional[int] = None,
               conflict: Optional[Dict[str, Any]] = None, message: Optional[str] = None) -> Dict[str, Any]:
    return {"operation_id": operation_id, "status": status, "code": code, "message": message,
            "entity_id": entity_id, "temp_id": temp_id, "resulting_revision": resulting_revision,
            "conflict": conflict}


def summarize(results: List[Dict[str, Any]]) -> Tuple[int, int, int, int]:
    """(適用、既に適用、競合、拒否)の件数"""
    statuses = ("applied", "already_applied", "conflicted", "rejected")
    by = {s: sum(1 for r in results if r["status"] == s) for s in statuses}
    return by["applied"], by["already_applied"], by["conflicted"], by["rejected"]


def clean_day_fields(raw: Optional[Dict[str, Any]], action: str) -> Dict[str, Any]:
    """[Gate G6] 日程の項目。作成は日付と時間帯(既定 UTC)、変更は名前とメモだけ(日付は変えない)。"""
    from datetime import date
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    raw = raw or {}
    allowed = DAY_FIELDS if action == "create" else ("title", "notes")
    unknown = set(raw) - set(allowed)
    if unknown:
        raise SyncError("unknown_fields", f"同期できない項目があります: {sorted(unknown)}")
    out: Dict[str, Any] = {}
    for k, v in raw.items():
        if k == "local_date":
            try:
                out[k] = date.fromisoformat(str(v)).isoformat()
            except ValueError:
                raise SyncError("invalid_field", "日付は YYYY-MM-DD で入力してください")
        elif k == "timezone_id":
            try:
                ZoneInfo(str(v))
            except (ZoneInfoNotFoundError, ValueError):
                raise SyncError("invalid_field", "時間帯の名前が正しくありません")
            out[k] = str(v)
        elif k in ("title", "notes"):
            limit = 200 if k == "title" else 2000
            if v is not None and (not isinstance(v, str) or len(v) > limit):
                raise SyncError("invalid_field", f"{k}は{limit}文字までです")
            out[k] = (v.strip() or None) if isinstance(v, str) else None
    if action == "create" and "local_date" not in out:
        raise SyncError("invalid_field", "日程の作成には日付が必要です")
    if action == "update" and not out:
        raise SyncError("invalid_field", "変更する項目がありません")
    return out


def clean_order(raw: Optional[Dict[str, Any]]) -> Tuple[str, List[str]]:
    """[Gate G6] 並びの操作: {"day_id": 日程(ID か仮のID), "order": [予定の ID か仮のID, ...]}。"""
    raw = raw or {}
    if set(raw) - {"day_id", "order"}:
        raise SyncError("unknown_fields", "並びの操作は day_id と order だけです")
    day = raw.get("day_id")
    order = raw.get("order")
    if not isinstance(day, str) or not day or len(day) > 64:
        raise SyncError("invalid_field", "日程の指定が必要です")
    if not isinstance(order, list) or not order or len(order) > MAX_ORDER or \
            not all(isinstance(x, str) and 0 < len(x) <= 64 for x in order):
        raise SyncError("invalid_field", "並べる予定の一覧が正しくありません")
    if len(set(order)) != len(order):
        raise SyncError("invalid_field", "同じ予定が並びに2回あります")
    return day, order


def references(op: Dict[str, Any]) -> List[str]:
    """操作が参照している仮のID(UUID でない参照)。"""
    refs: List[str] = []
    ent = op.get("entity_id")
    if ent and not is_uuid(ent):
        refs.append(ent)
    fields = op.get("fields") or {}
    day = fields.get("day_id")
    if isinstance(day, str) and day and not is_uuid(day):
        refs.append(day)
    for x in fields.get("order") or []:
        if isinstance(x, str) and x and not is_uuid(x):
            refs.append(x)
    return refs


def dependency_order(ops: List[Dict[str, Any]]) -> List[int]:
    """送られた操作を処理する順(元の位置の並び)。仮のIDを作る操作を、それを参照する操作より先にする。
    依存の無い操作は送られた順のまま。循環や送信の外の仮のIDは、送られた順で処理する(処理の中で判定する)。"""
    creator: Dict[str, int] = {}
    for i, op in enumerate(ops):
        if op.get("action") == "create" and op.get("temp_id"):
            creator.setdefault(op["temp_id"], i)
    deps = {i: {creator[r] for r in references(op) if r in creator and creator[r] != i} for i, op in enumerate(ops)}
    done: List[int] = []
    placed: Set[int] = set()
    remaining = list(range(len(ops)))
    while remaining:
        progressed = False
        for i in list(remaining):
            if deps[i] <= placed:
                done.append(i)
                placed.add(i)
                remaining.remove(i)
                progressed = True
                break
        if not progressed:  # 循環: 残りは送られた順
            done.extend(remaining)
            break
    return done
