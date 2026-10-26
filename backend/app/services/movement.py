"""[Gate G7] MOVE-03 移動・滞在の既定(movement-v1)。

実行可能性の判定(app/services/feasibility.py)が、利用者の入れていない値を「既定」で見積もるための規則。
外部の提供元(時刻表・経路・混雑)は使わない。見積もりで出した問題は、根拠(evidence)に estimated=true と使った既定を残し、
確かめた事実と区別する(検証不能を「問題なし」にしない、の原則は変えない)。

- 既定の滞在: 予定の種類ごとの滞在時間(分)。終了時刻の無い予定の「終わり」を見積もる。宿泊・移動の予定は見積もらない
- 歩く速さの見込み(pace): ゆっくり(滞在 ×1.25・連続 150分・1日 10時間)/ふつう(×1.0・180分・12時間)/
  しっかり(×0.85・240分・14時間)
- 休憩の規則: break_minutes 以上の空き(移動の時間を除く)か食事を休憩として数え、休憩の無い連続が上限を超えたら警告
- 同行者の属性(party): 子ども連れ・高齢の同行者がいる時は、連続の上限を 120分・1日の上限を 10時間までに下げ、
  休憩とみなす空きを 20分以上にする(MEM-03 の思い出からの提案も、同じ属性の旅行を優先して使う)
- 最終の便: 区間の last_departure_at(終電・最終便)に対して、出発が margin 分を切ったら注意、過ぎたら誤り

行が無い旅行は DEFAULTS で判定する(既定で有効)。enabled=false にすると従来の判定(見積もりなし)へ戻る。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

ALGORITHM_VERSION = "movement-v1"

EVENT_TYPES: Tuple[str, ...] = (
    "sightseeing", "activity", "dining", "shopping", "accommodation", "transportation", "other",
)
TYPE_LABEL = {
    "sightseeing": "観光", "activity": "アクティビティ", "dining": "食事", "shopping": "買い物",
    "accommodation": "宿泊", "transportation": "移動", "other": "その他",
}
# 見積もらない種類(宿泊は夜通し、移動は区間で表す)
NOT_ESTIMATED = ("accommodation", "transportation")
DEFAULT_STAY: Dict[str, Optional[int]] = {
    "sightseeing": 60, "activity": 90, "dining": 60, "shopping": 45, "other": 30,
    "accommodation": None, "transportation": None,
}
PACES: Dict[str, Dict[str, float]] = {
    "relaxed": {"stay_factor": 1.25, "max_continuous": 150, "max_day": 600},
    "normal": {"stay_factor": 1.0, "max_continuous": 180, "max_day": 720},
    "active": {"stay_factor": 0.85, "max_continuous": 240, "max_day": 840},
}
PACE_LABEL = {"relaxed": "ゆっくり", "normal": "ふつう", "active": "しっかり"}
PARTY_CONTINUOUS_LIMIT = 120
PARTY_DAY_LIMIT = 600
PARTY_BREAK_MINUTES = 20

DEFAULTS: Dict[str, Any] = {
    "enabled": True,
    "pace": "normal",
    # 種類ごとの既定の滞在(分)。null は見積もらない
    "stay_minutes": dict(DEFAULT_STAY),
    # 休憩とみなす空き(分)
    "break_minutes": 15,
    # 休憩の無い連続の上限・1日の活動の上限(分)。null は pace の既定
    "max_continuous_minutes": None,
    "max_day_minutes": None,
    # 終了時刻のある予定の滞在が、既定のこの割合を下回ったら「滞在が短い」
    "short_stay_ratio": 0.5,
    # 最終の便の何分前までに出発したいか
    "last_transport_margin_minutes": 15,
    "party": {"with_children": False, "with_seniors": False, "size": None},
}

LIMITS = {
    "stay": (5, 600), "break": (5, 120), "continuous": (30, 720), "day": (120, 1080), "margin": (0, 120),
    "size": (1, 50),
}


class MovementError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Rules:
    """判定に使う実効値(既定と旅行の設定と同行者の属性から作る)。"""
    stay_minutes: Dict[str, Optional[int]]
    break_minutes: int
    max_continuous_minutes: int
    max_day_minutes: int
    short_stay_ratio: float
    last_transport_margin_minutes: int
    pace: str = "normal"
    with_children: bool = False
    with_seniors: bool = False
    notes: Tuple[str, ...] = field(default_factory=tuple)

    def stay_for(self, event_type: Optional[str]) -> Optional[int]:
        key = event_type if event_type in self.stay_minutes else "other"
        if event_type in NOT_ESTIMATED:
            return None
        return self.stay_minutes.get(key)


def _int(value: Any, name: str, lo: int, hi: int, allow_none: bool = False) -> Optional[int]:
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
        raise MovementError("invalid_movement_settings", f"{name}は{lo}〜{hi}の整数で入力してください")
    v = int(value)
    if not lo <= v <= hi:
        raise MovementError("invalid_movement_settings", f"{name}は{lo}〜{hi}の整数で入力してください")
    return v


def clean(raw: Any) -> Dict[str, Any]:
    """入力の検査。足りない項目は既定で埋める。知らない項目は拒む(後で黙って捨てない)。"""
    if not isinstance(raw, dict):
        raise MovementError("invalid_movement_settings", "設定の形式が正しくありません")
    allowed = set(DEFAULTS)
    extra = sorted(set(raw) - allowed)
    if extra:
        raise MovementError("invalid_movement_settings", f"不明な項目があります: {', '.join(extra)}")
    out = copy.deepcopy(DEFAULTS)
    if "enabled" in raw:
        if not isinstance(raw["enabled"], bool):
            raise MovementError("invalid_movement_settings", "有効・無効は真偽値で指定してください")
        out["enabled"] = raw["enabled"]
    if "pace" in raw:
        if raw["pace"] not in PACES:
            raise MovementError("invalid_movement_settings", "歩く速さの見込みは relaxed・normal・active のどれかです")
        out["pace"] = raw["pace"]
    if "stay_minutes" in raw:
        stays = raw["stay_minutes"]
        if not isinstance(stays, dict) or set(stays) - set(EVENT_TYPES):
            raise MovementError("invalid_movement_settings", "既定の滞在は予定の種類ごとに指定してください")
        for k, v in stays.items():
            if k in NOT_ESTIMATED:
                if v is not None:
                    raise MovementError("invalid_movement_settings",
                                        f"{TYPE_LABEL[k]}の予定には既定の滞在を付けられません(終了時刻を入れてください)")
                continue
            lo, hi = LIMITS["stay"]
            out["stay_minutes"][k] = _int(v, f"{TYPE_LABEL[k]}の既定の滞在", lo, hi, allow_none=True)
    for key, name, limit, nullable in (
        ("break_minutes", "休憩とみなす空き", "break", False),
        ("max_continuous_minutes", "休憩なしで続けてよい時間", "continuous", True),
        ("max_day_minutes", "1日の活動の上限", "day", True),
        ("last_transport_margin_minutes", "最終の便の前の余裕", "margin", False),
    ):
        if key in raw:
            lo, hi = LIMITS[limit]
            out[key] = _int(raw[key], name, lo, hi, allow_none=nullable)
    if "short_stay_ratio" in raw:
        v = raw["short_stay_ratio"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0.1 <= float(v) <= 1.0:
            raise MovementError("invalid_movement_settings", "短い滞在の割合は0.1〜1.0で指定してください")
        out["short_stay_ratio"] = round(float(v), 2)
    if "party" in raw:
        party = raw["party"]
        if not isinstance(party, dict) or set(party) - {"with_children", "with_seniors", "size"}:
            raise MovementError("invalid_movement_settings", "同行者の属性の形式が正しくありません")
        for k in ("with_children", "with_seniors"):
            if k in party:
                if not isinstance(party[k], bool):
                    raise MovementError("invalid_movement_settings", "同行者の属性は真偽値で指定してください")
                out["party"][k] = party[k]
        if "size" in party:
            lo, hi = LIMITS["size"]
            out["party"]["size"] = _int(party["size"], "人数", lo, hi, allow_none=True)
    return out


def _round5(v: float) -> int:
    return max(5, int(5 * round(v / 5)))


def rules_from(settings: Optional[Dict[str, Any]]) -> Optional[Rules]:
    """設定 → 実効の規則。無効(enabled=false)なら None(従来の判定)。"""
    s = clean(settings) if settings is not None else copy.deepcopy(DEFAULTS)
    if not s["enabled"]:
        return None
    pace = PACES[s["pace"]]
    notes: List[str] = []
    stays: Dict[str, Optional[int]] = {}
    for k in EVENT_TYPES:
        base = s["stay_minutes"].get(k)
        stays[k] = None if base is None else _round5(base * pace["stay_factor"])
    if pace["stay_factor"] != 1.0:
        notes.append(f"歩く速さの見込みが「{PACE_LABEL[s['pace']]}」のため、既定の滞在を{pace['stay_factor']}倍にしました")
    continuous = s["max_continuous_minutes"] if s["max_continuous_minutes"] is not None else int(pace["max_continuous"])
    day = s["max_day_minutes"] if s["max_day_minutes"] is not None else int(pace["max_day"])
    brk = s["break_minutes"]
    party = s["party"]
    if party["with_children"] or party["with_seniors"]:
        who = "・".join(w for w, on in (("子ども", party["with_children"]), ("高齢の方", party["with_seniors"])) if on)
        if continuous > PARTY_CONTINUOUS_LIMIT:
            continuous = PARTY_CONTINUOUS_LIMIT
        if day > PARTY_DAY_LIMIT:
            day = PARTY_DAY_LIMIT
        brk = max(brk, PARTY_BREAK_MINUTES)
        notes.append(f"{who}と一緒のため、休憩なしの連続を{continuous}分・1日を{day // 60}時間までにしました")
    return Rules(
        stay_minutes=stays, break_minutes=brk, max_continuous_minutes=continuous, max_day_minutes=day,
        short_stay_ratio=float(s["short_stay_ratio"]), last_transport_margin_minutes=s["last_transport_margin_minutes"],
        pace=s["pace"], with_children=bool(party["with_children"]), with_seniors=bool(party["with_seniors"]),
        notes=tuple(notes),
    )


def rules_view(rules: Optional[Rules]) -> Optional[Dict[str, Any]]:
    if rules is None:
        return None
    return {
        "stay_minutes": dict(rules.stay_minutes), "break_minutes": rules.break_minutes,
        "max_continuous_minutes": rules.max_continuous_minutes, "max_day_minutes": rules.max_day_minutes,
        "short_stay_ratio": rules.short_stay_ratio,
        "last_transport_margin_minutes": rules.last_transport_margin_minutes,
        "pace": rules.pace, "with_children": rules.with_children, "with_seniors": rules.with_seniors,
        "notes": list(rules.notes),
    }


# ============================================================ DB

def get_row(db: Session, plan_id: Any):
    from app.models.models import PlanMovementSettings

    return db.query(PlanMovementSettings).filter(PlanMovementSettings.plan_id == plan_id).first()


def load_settings(db: Session, plan) -> Tuple[Dict[str, Any], int]:
    """(設定, revision)。行が無ければ (既定, 0)。保存した値が今の規則で読めない時も既定で判定する。"""
    row = get_row(db, plan.id)
    if row is None:
        return copy.deepcopy(DEFAULTS), 0
    try:
        return clean(row.settings), int(row.revision)
    except MovementError:
        return copy.deepcopy(DEFAULTS), int(row.revision)


def load_rules(db: Session, plan) -> Optional[Rules]:
    settings, _rev = load_settings(db, plan)
    return rules_from(settings)


def save(db: Session, plan, user_id, raw: Dict[str, Any], expected_revision: int):
    """設定を保存する(呼出側で commit)。expected_revision は今の revision(行が無ければ 0)。"""
    from app.models.models import PlanMovementSettings

    settings = clean(raw)
    row = get_row(db, plan.id)
    current = int(row.revision) if row is not None else 0
    if expected_revision != current:
        raise MovementError("movement_settings_conflict",
                            f"移動の既定が他の変更で更新されています(現在のrevision: {current})")
    now = datetime.now(timezone.utc)
    if row is None:
        row = PlanMovementSettings(plan_id=plan.id, settings=settings, revision=1, updated_by_user_id=user_id)
        db.add(row)
    else:
        row.settings = settings
        row.revision = current + 1
        row.updated_by_user_id = user_id
        row.updated_at = now
    db.flush()
    return row


def party_of(db: Session, plan) -> Dict[str, Any]:
    """[Gate G7] MEM-03 旅行の同行者の属性(移動の既定の party と、承諾した参加者の数)。"""
    from app.models.models import PlanCollaborator

    settings, _rev = load_settings(db, plan)
    party = dict(settings["party"])
    members = db.query(PlanCollaborator).filter(PlanCollaborator.plan_id == plan.id,
                                                PlanCollaborator.status == "accepted").count()
    size = party.get("size") or (members + 1)
    return {"with_children": bool(party.get("with_children")), "with_seniors": bool(party.get("with_seniors")),
            "size": int(size), "group": "solo" if size <= 1 else "group"}
