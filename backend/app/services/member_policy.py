"""[Gate G2] FR-045 同行者(旅行の参加者)向けの項目の規則(docs/adr/ADR-member-field-policy.md)。

共有リンク向けの規則(app/services/share_policy.py、Gate F45)と同じ考え方を、招待して参加した人(編集者・閲覧者)にも
適用する。DOC-02 FR-021「所有者、編集者、投票者、閲覧者、チケット閲覧、費用閲覧等の権限を組み合わせる」、
FR-045「項目単位の共有の規則」、DOC-11「RESTRICTED は本人限定を既定」。

- 所有者は役割ごと(編集者・閲覧者)の既定と、参加者1人ずつの上書きを決められる。所有者自身には適用しない。
- 隠せる項目(カテゴリ): 予定のメモ・予定の住所と位置・予約・予約番号と PIN の表示・チケット・文書・費用。
  予約を隠すと、チケットと予約番号の表示も隠れる(予約が見えないのにチケットだけ見えることはない)。
- 規則が無い旅行(本Gate以前)は、これまでと同じく何も隠さない。
- 隠した項目は、画面の API・検索・出力(ICS/CSV/GPX/KML)・しおり・当日モード・同期の競合・場所の詳細の
  どこからも返さない(項目が無い = None / 空、または 403 member_field_hidden)。
- 隠した項目を含む書き込み(編集者が予定のメモを書き換える等)は 403。見えない値を上書きさせない。
"""
from __future__ import annotations

from typing import Any, Dict, FrozenSet, Iterable, List, Optional, Set

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import PlanCollaborator, TravelPlan, User

POLICY_VERSION = 1
ROLES = ("editor", "viewer")

CATEGORIES: Dict[str, Dict[str, str]] = {
    "event_notes": {"label": "予定のメモ", "description": "予定の説明・メモ欄"},
    "event_address": {"label": "予定の住所・位置",
                      "description": "予定の住所・緯度経度(地図の位置・経路・GPX/KML の出力も含む)"},
    "reservations": {"label": "予約", "description": "予約の一覧・詳細(隠すとチケットと予約番号も隠れます)"},
    "reservation_secrets": {"label": "予約番号・PIN の表示", "description": "伏せた予約番号・PIN を表示する操作"},
    "tickets": {"label": "チケット・QR", "description": "チケット・QR・バーコード"},
    "documents": {"label": "文書", "description": "旅券・保険・領収書などの文書"},
    "costs": {"label": "費用・予算・精算", "description": "予算・支出・精算・費用の集計"},
}
CATEGORY_ORDER: List[str] = list(CATEGORIES)
# 予約を隠すと、予約に属するものも隠れる
IMPLIES: Dict[str, List[str]] = {"reservations": ["tickets", "reservation_secrets"]}
PRESETS: Dict[str, List[str]] = {
    "none": [],
    # 閲覧者の推奨: 予約番号・チケット・文書・費用は本人(所有者)と編集者だけ
    "recommended_viewer": ["reservation_secrets", "tickets", "documents", "costs"],
    "itinerary_only": ["event_notes", "reservations", "reservation_secrets", "tickets", "documents", "costs"],
}

EVENT_NOTE_FIELDS = ("description",)
EVENT_ADDRESS_FIELDS = ("address", "latitude", "longitude", "place_id")
EMPTY: FrozenSet[str] = frozenset()


class MemberPolicyError(ValueError):
    def __init__(self, code: str, message: str, fields: Optional[List[str]] = None):
        super().__init__(message)
        self.code, self.message, self.fields = code, message, fields or []

    def detail(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields:
            out["fields"] = self.fields
        return out


def expand(keys: Iterable[str]) -> FrozenSet[str]:
    out = set(keys)
    for k in list(out):
        out.update(IMPLIES.get(k, []))
    return frozenset(k for k in out if k in CATEGORIES)


def ordered(keys: Iterable[str]) -> List[str]:
    s = set(keys)
    return [k for k in CATEGORY_ORDER if k in s]


def clean_hidden(value: Any) -> List[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 20 or not all(isinstance(v, str) for v in value):
        raise MemberPolicyError("invalid_policy", "隠す項目の指定が正しくありません")
    unknown = sorted(set(value) - set(CATEGORIES))
    if unknown:
        raise MemberPolicyError("unknown_field", "不明な項目です", unknown)
    return ordered(expand(value))


def clean_plan_policy(payload: Dict[str, Any]) -> Dict[str, Any]:
    """PUT /plans/{id}/member-policy の入力 {"roles": {"editor": [...], "viewer": [...]}, "preset_viewer": ...}"""
    if not isinstance(payload, dict):
        raise MemberPolicyError("invalid_policy", "規則の指定が正しくありません")
    roles = payload.get("roles") or {}
    if not isinstance(roles, dict) or set(roles) - set(ROLES):
        raise MemberPolicyError("invalid_role", "役割は editor と viewer だけを指定できます")
    out = {r: clean_hidden(roles.get(r)) for r in ROLES}
    for r in ROLES:
        preset = payload.get(f"preset_{r}")
        if preset is not None:
            if preset not in PRESETS:
                raise MemberPolicyError("unknown_preset", "不明なひな形です")
            out[r] = ordered(expand(PRESETS[preset]))
    return {"version": POLICY_VERSION, "roles": out}


def role_defaults(plan: TravelPlan) -> Dict[str, List[str]]:
    pol = plan.member_field_policy if isinstance(plan.member_field_policy, dict) else None
    roles = (pol or {}).get("roles") or {}
    return {r: ordered(expand(roles.get(r) or [])) for r in ROLES}


def member_override(collab: Optional[PlanCollaborator]) -> Optional[List[str]]:
    pol = collab.field_policy if collab is not None and isinstance(collab.field_policy, dict) else None
    if pol is None:
        return None
    return ordered(expand(pol.get("hidden") or []))


def hidden_for(db: Session, plan: TravelPlan, role: Optional[str], user: Optional[User]) -> FrozenSet[str]:
    """この人に隠す項目。所有者・(旅行を見られない人)は空。"""
    if role in (None, "owner") or user is None:
        return EMPTY
    # 個別の上書きは、旅行の規則が無くても効く
    collab = (db.query(PlanCollaborator)
              .filter(PlanCollaborator.plan_id == plan.id, PlanCollaborator.user_id == user.id,
                      PlanCollaborator.status == "accepted").first())
    override = member_override(collab)
    if override is not None:
        return frozenset(override)
    return frozenset(role_defaults(plan).get(role or "", []))


def hidden_error(category: str) -> HTTPException:
    return HTTPException(status_code=403, detail={
        "code": "member_field_hidden", "category": category,
        "message": f"旅行の所有者が「{CATEGORIES[category]['label']}」をあなたに見せない設定にしています"})


def require_visible(hidden: FrozenSet[str], *categories: str) -> None:
    for c in categories:
        if c in hidden:
            raise hidden_error(c)


def require_access(db: Session, plan_id, user: User, min_role: str, *categories: str):
    """require_plan_access に項目の規則を足したもの。(plan, role, hidden) を返す。"""
    from app.core.plan_access import require_plan_access  # 循環 import を避ける

    plan, role = require_plan_access(db, plan_id, user, min_role=min_role)
    hidden = hidden_for(db, plan, role, user)
    require_visible(hidden, *categories)
    return plan, role, hidden


def mask_event_dict(d: Dict[str, Any], hidden: FrozenSet[str]) -> Dict[str, Any]:
    if not hidden:
        return d
    out = dict(d)
    if "event_notes" in hidden:
        for f in EVENT_NOTE_FIELDS:
            if f in out:
                out[f] = None
    if "event_address" in hidden:
        for f in EVENT_ADDRESS_FIELDS:
            if f in out:
                out[f] = None
    return out


def forbidden_write_fields(hidden: FrozenSet[str], fields: Iterable[str]) -> List[str]:
    blocked: Set[str] = set()
    if "event_notes" in hidden:
        blocked.update(EVENT_NOTE_FIELDS)
    if "event_address" in hidden:
        blocked.update(EVENT_ADDRESS_FIELDS)
        blocked.add("place_id")  # 場所を付けると住所・位置が入る
    return sorted(set(fields) & blocked)


def drop_unseen(hidden: FrozenSet[str], data: Dict[str, Any]) -> Dict[str, Any]:
    """隠した項目が「見えている値(空)」のまま送られてきた時は、変更しない項目として取り除く。
    画面は見えない項目を空のまま送り返すことがあるため(空で上書きして所有者の値を消さない)。空でない値は残し、
    require_writable が 403 にする。"""
    blocked = set(forbidden_write_fields(hidden, data.keys()))
    return {k: v for k, v in data.items() if not (k in blocked and v in (None, ""))}


def require_writable(hidden: FrozenSet[str], fields: Iterable[str]) -> None:
    bad = forbidden_write_fields(hidden, fields)
    if bad:
        cat = "event_notes" if "description" in bad else "event_address"
        raise HTTPException(status_code=403, detail={
            "code": "member_field_hidden", "category": cat, "fields": bad,
            "message": "見せない設定の項目は変更できません(旅行の所有者に依頼してください)"})


def catalog() -> Dict[str, Any]:
    return {"version": POLICY_VERSION,
            "categories": [{"key": k, **CATEGORIES[k], "implies": IMPLIES.get(k, [])} for k in CATEGORY_ORDER],
            "presets": {k: v for k, v in PRESETS.items()}}


def guarded(*categories: str):
    """require_plan_access と同じ形(戻り値 (plan, role))で、categories が隠されていれば 403 にする関数を作る。
    文書(documents.py)・費用(finance.py)の全ての API の入口で使う。"""
    def _require(db: Session, plan_id, user: User, min_role: str = "viewer"):
        plan, role, _hidden = require_access(db, plan_id, user, min_role, *categories)
        return plan, role
    return _require


# しおり(app/services/booklet.py)の章と、その章が見せる項目
BOOKLET_SECTION_CATEGORY = {"reservations": "reservations", "contacts": "reservations", "notes": "reservations",
                            "costs": "costs", "map": "event_address"}


def booklet_blocked_sections(hidden: FrozenSet[str], sections: Iterable[str]) -> List[str]:
    return [s for s in sections if BOOKLET_SECTION_CATEGORY.get(s) in hidden]


def redact_booklet(snapshot: Dict[str, Any], hidden: FrozenSet[str]) -> Dict[str, Any]:
    """他の人が作ったしおりの版を見る時に、隠す項目を取り除く(章ごと null・予定の予約と住所は空)。"""
    if not hidden:
        return snapshot
    out = dict(snapshot)
    for sec, cat in BOOKLET_SECTION_CATEGORY.items():
        if cat in hidden and out.get(sec) is not None:
            out[sec] = None
    sched = out.get("schedule")
    if isinstance(sched, dict):
        days = []
        for d in sched.get("days") or []:
            evs = []
            for e in d.get("events") or []:
                e = dict(e)
                if "reservations" in hidden:
                    e["reservations"] = []
                if "event_address" in hidden:
                    e["address"] = None
                evs.append(e)
            days.append({**d, "events": evs})
        out["schedule"] = {**sched, "days": days}
    out["hidden_fields"] = ordered(hidden)
    return out


# 準備状況(app/services/readiness.py)のうち、予約から作る項目
READINESS_RESERVATION_CODES = {"unreserved", "reservation_unconfirmed", "reservation_unpaid", "payment_unknown",
                               "cancellation_deadline_soon"}


def filter_readiness(result: Dict[str, Any], hidden: FrozenSet[str]) -> Dict[str, Any]:
    """予約を隠した参加者には、予約から作る準備状況の項目を出さない(件数も数え直す)。"""
    if "reservations" not in hidden:
        return result
    items = [i for i in result.get("items") or []
             if i.get("code") not in READINESS_RESERVATION_CODES and i.get("entity_type") != "reservation"]
    out = dict(result)
    out["items"] = items
    counts = dict(out.get("counts") or {})
    by_cat = {k: 0 for k in (counts.get("by_category") or {})}
    by_sev = {k: 0 for k in (counts.get("by_severity") or {})}
    for i in items:
        if i.get("category") in by_cat:
            by_cat[i["category"]] += 1
        if i.get("severity") in by_sev:
            by_sev[i["severity"]] += 1
    counts.update(total=len(items), by_category=by_cat, by_severity=by_sev)
    out["counts"] = counts
    out["is_ready"] = len(items) == 0
    return out


def related_hidden(hidden: FrozenSet[str], related_type: Optional[str]) -> bool:
    """タスク等が指す関連先(予約・文書・予定の場所)が隠されているか。"""
    return (related_type == "reservation" and "reservations" in hidden) or \
        (related_type == "document" and "documents" in hidden)


# コメント(app/api/v1/discussion.py)の対象の種類と、その対象を見せる項目
COMMENT_TARGET_CATEGORY = {"reservation": "reservations", "expense": "costs"}


def comment_target_hidden(hidden: FrozenSet[str], target_type: Optional[str]) -> bool:
    return COMMENT_TARGET_CATEGORY.get(target_type or "") in hidden


def validation_issue_hidden(hidden: FrozenSet[str], code: Optional[str], entity_type: Optional[str]) -> bool:
    """実行可能性の検証(FR-017)の問題のうち、隠された予約・費用から作られたもの。"""
    code = code or ""
    if "reservations" in hidden and (entity_type == "reservation" or code.startswith("RESERVATION_")):
        return True
    return "costs" in hidden and code.startswith("BUDGET_")
