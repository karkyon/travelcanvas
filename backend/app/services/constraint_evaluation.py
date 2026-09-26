"""
[Gate L2] 制約の判定用読み出し(FR-016「秘匿制約は詳細非表示のまま判定へ使う」)。

実行可能性検証(FR-017、Gate L3)・最適化(FR-018)が、秘匿制約を含む全ての
有効な制約を判定に使えるよう、復号済みの値を返す内部専用の関数を提供する。

- 返す値はAPIレスポンスへ直接出してはならない(秘匿制約の題名・値を含むため)。
  判定結果を利用者へ返す際は、他人の秘匿制約について「満たす/満たさない」だけを
  出すこと(FR-023)。
- 理由(reason)は判定に不要なため復号しない(DOC-05 §19: reasonはAI利用禁止)。
- 復号できない秘匿制約は黙って捨てず `unavailable` に入れて返す
  (「検証不能を問題なしにしない」FR-017)。
"""
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from sqlalchemy.orm import Session

from app.core.crypto import EncryptionNotConfigured, decrypt_payload
from app.models.models import PlanCollaborator, PlanConstraint, TravelPlan


def member_user_ids(db: Session, plan: TravelPlan) -> Set[uuid.UUID]:
    """プランに現在アクセスできるユーザー(所有者+承諾済みの共同編集者)。"""
    ids = {plan.user_id}
    rows = (
        db.query(PlanCollaborator.user_id)
        .filter(
            PlanCollaborator.plan_id == plan.id,
            PlanCollaborator.status == "accepted",
            PlanCollaborator.user_id.isnot(None),
        )
        .all()
    )
    ids.update(r[0] for r in rows)
    return ids


def is_listed(c: PlanConstraint, member_ids: Set[uuid.UUID]) -> bool:
    """プランから外れたメンバーの秘匿制約は一覧・判定の対象外にする
    (本人以外は変更も削除もできず、判定に残すと理由の分からない制約になるため)。"""
    return c.privacy_level != "private" or c.owner_user_id in member_ids


def decrypt_private_payload(c: PlanConstraint) -> Optional[Dict[str, Any]]:
    """秘匿制約の {"title", "value"} を復号する。復号できなければNone。"""
    if not c.value_ciphertext:
        return None
    try:
        data = json.loads(decrypt_payload(c.value_ciphertext).decode("utf-8"))
    except (EncryptionNotConfigured, ValueError):
        return None
    return data if isinstance(data, dict) else None


@dataclass(frozen=True)
class EffectiveConstraint:
    id: uuid.UUID
    owner_user_id: uuid.UUID
    is_private: bool
    scope_type: str
    scope_id: Optional[uuid.UUID]
    constraint_type: str
    hardness: str
    operator: str
    value: Dict[str, Any]
    weight: Optional[int]


@dataclass
class ConstraintSet:
    constraints: List[EffectiveConstraint] = field(default_factory=list)
    # 復号できなかった秘匿制約のID(判定不能として扱う)
    unavailable: List[uuid.UUID] = field(default_factory=list)

    @property
    def hard(self) -> List[EffectiveConstraint]:
        return [c for c in self.constraints if c.hardness == "hard"]

    @property
    def soft(self) -> List[EffectiveConstraint]:
        return [c for c in self.constraints if c.hardness == "soft"]


def _in_window(c: PlanConstraint, at: Optional[datetime]) -> bool:
    if at is None:
        return True
    if c.active_from and at < c.active_from:
        return False
    if c.active_to and at >= c.active_to:
        return False
    return True


def load_constraints_for_evaluation(db: Session, plan: TravelPlan, at: Optional[datetime] = None) -> ConstraintSet:
    """有効な(削除されておらず、is_activeで、atが有効期間内の)制約を返す。

    プランから外れたメンバーの秘匿制約は含めない(一覧と同じ規則)。
    """
    member_ids = member_user_ids(db, plan)
    rows = (
        db.query(PlanConstraint)
        .filter(
            PlanConstraint.plan_id == plan.id,
            PlanConstraint.deleted_at.is_(None),
            PlanConstraint.is_active.is_(True),
        )
        .order_by(PlanConstraint.created_at.asc(), PlanConstraint.id.asc())
        .all()
    )
    result = ConstraintSet()
    for c in rows:
        if not is_listed(c, member_ids) or not _in_window(c, at):
            continue
        if c.privacy_level == "private":
            data = decrypt_private_payload(c)
            if data is None or not isinstance(data.get("value"), dict):
                result.unavailable.append(c.id)
                continue
            value = data["value"]
        else:
            value = c.value_json or {}
        result.constraints.append(EffectiveConstraint(
            id=c.id,
            owner_user_id=c.owner_user_id,
            is_private=c.privacy_level == "private",
            scope_type=c.scope_type,
            scope_id=c.scope_id,
            constraint_type=c.constraint_type,
            hardness=c.hardness,
            operator=c.operator,
            value=value,
            weight=c.weight,
        ))
    return result
