"""[Gate P11] FR-033 オフライン編集・同期の純粋関数(DB非依存)。

方針(DOC-06 §30、DOC-13 §5):
- 端末は操作ごとに operation_id(UUID)を付けて送る。同じ operation_id の再送は、記録した結果を返す(二重に適用しない)。
- 競合 = 端末が編集を始めた版(base_revision)の値から、サーバーでも同じ項目が別の値に変わっている状態。
  サーバーで同じ値に変わっていれば競合にしない。サーバーで変わった項目を端末が変えていなければ競合にしない(項目単位)。
- 予定の削除: 編集を始めた後にサーバーで変更されていれば競合。予約・移動・文書と紐付く予定はオフラインでは削除しない
  (オンラインで紐付けの扱いを確認して削除する)。確定(ロック)した予定は変更・削除しない。
- client_at(端末の時刻)は並び順の根拠にしない(送られてきた順に処理する)。
"""
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

SYNC_FIELDS = ("day_id", "title", "description", "event_type", "local_start_time", "is_all_day", "address",
               "latitude", "longitude")
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
