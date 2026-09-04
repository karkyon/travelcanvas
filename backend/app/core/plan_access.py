"""
[Gate #30] プランアクセス権限の統一解決ロジック。

これまで travel.py / plans.py / ai.py / share.py がそれぞれ個別に
`plan.user_id != current_user.id` という所有者限定チェックを重複実装して
おり、PlanCollaborator(招待・承認済みコラボレーター)は一切考慮されて
いなかった。そのため Gate #25/#26 で実装された招待機能は、実際に招待を
承諾しても対象プランへ永久にアクセスできない状態だった(Gate #30監査で
発見。監査レポート自体にもこの実行時不整合は記載されていなかった)。

本モジュールはロールを owner > editor > viewer > (アクセス不可) の順で
一元的に解決し、全API(travel.py / plans.py / ai.py / share.py)から
共通で利用する唯一の判定ロジックとする。

なお app/utils/permissions.py という896行の権限管理フレームワークが
既に存在するが、grep調査の結果アプリケーションのどこからもimportされて
いない(ghost code)ことを確認した。本モジュールはそれを置き換えるもの
ではなく、実際に配線されている新しい最小実装として追加する。
"""
import uuid
from typing import Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import TravelPlan, PlanCollaborator, User

# ロールの強さの順序。数値が大きいほど強い権限を持つ。
_ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}


def resolve_plan_role(db: Session, plan: TravelPlan, user: User) -> Optional[str]:
    """指定ユーザーが指定プランに対して持つロールを返す。
    アクセス権が無い場合は None を返す(存在確認はこの関数の責務ではない)。
    """
    if plan.user_id == user.id:
        return "owner"

    collab = (
        db.query(PlanCollaborator)
        .filter(
            PlanCollaborator.plan_id == plan.id,
            PlanCollaborator.status == "accepted",
            PlanCollaborator.user_id == user.id,
        )
        .first()
    )
    if collab is not None and collab.role in ("viewer", "editor"):
        return collab.role

    return None


def _to_uuid(plan_id) -> uuid.UUID:
    if isinstance(plan_id, uuid.UUID):
        return plan_id
    try:
        return uuid.UUID(str(plan_id))
    except (ValueError, TypeError):
        # IDOR対策: 不正な形式のIDは「存在しない」と同じ404で応答し、
        # UUID形式かどうかで挙動を変えて情報を漏らさない。
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="旅行プランが見つかりません")


def require_plan_access(
    db: Session,
    plan_id,
    user: User,
    min_role: str = "viewer",
) -> Tuple[TravelPlan, str]:
    """指定ロール以上でプランへアクセスできることを検証し、(plan, role)を返す。

    - プランが存在しない場合: 404
    - プランは存在するが権限が無い/不足している場合: 403
      (他ユーザーのプランIDを推測して存在有無を判別できてしまうIDOR懸念は
      あるが、既存実装(Gate #27以前)から一貫してこの404→403の順序を
      踏襲している。プランの存在自体は本アプリではそれほど機微な情報では
      ないと判断し、本Gateではこの挙動を変更しない)
    """
    if min_role not in _ROLE_RANK:
        raise ValueError(f"unknown min_role: {min_role}")

    plan = db.query(TravelPlan).filter(TravelPlan.id == _to_uuid(plan_id)).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="旅行プランが見つかりません")

    role = resolve_plan_role(db, plan, user)
    if role is None or _ROLE_RANK[role] < _ROLE_RANK[min_role]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="アクセス権限がありません")

    return plan, role


def accessible_plan_ids_subquery(db: Session, user: User):
    """一覧系エンドポイントで「自分が owner、または accepted な collaborator」
    であるプランのIDを絞り込むためのサブクエリ。"""
    return db.query(PlanCollaborator.plan_id).filter(
        PlanCollaborator.status == "accepted",
        PlanCollaborator.user_id == user.id,
    )
