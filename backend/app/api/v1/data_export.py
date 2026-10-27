"""
[Gate P6] FR-039 データポータビリティ(FC-098 構造化JSON+文書manifest)と、保持期間の説明。DOC-04 SC-29。

エンドポイント:
- GET /plans/{plan_id}/data-export : 旅行単位のエクスポート(所有者だけ。403 owner_only)
- GET /privacy/data-export         : アカウント単位のエクスポート(本人のプロフィール・所有する旅行すべて・
                                     参加している旅行での本人の作成物・本人宛ての通知)
- GET /privacy/retention           : 削除後・バックアップ・監査の保持期間の説明(FR-039)

応答はJSONファイル(attachment、Cache-Control: no-store)。X-Content-SHA256 で内容のハッシュを返す(改ざん・欠落の確認用)。
含める・含めない情報は app/services/data_export.py の方針に従う。監査には範囲と件数だけを記録する。
"""
import hashlib
import json
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, cast
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import Notification, PlanCollaborator, TravelPlan, User
from app.services import data_export as dx
from app.services.audit_service import record_audit_event
from app.services.quickdraft_purge import QUICK_DRAFT_EXPIRED_RETENTION_DAYS, QUICK_DRAFT_PROMOTED_RETENTION_DAYS

plans_router = APIRouter(prefix="/plans", tags=["data-export"])
privacy_router = APIRouter(prefix="/privacy", tags=["data-export"])


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def retention_info() -> Dict[str, Any]:
    grace = settings.PLAN_DELETE_GRACE_DAYS
    return {
        "plan_delete_grace_days": grace,
        "quick_draft_expired_retention_days": QUICK_DRAFT_EXPIRED_RETENTION_DAYS,
        "quick_draft_promoted_retention_days": QUICK_DRAFT_PROMOTED_RETENTION_DAYS,
        "items": [
            {"key": "deleted_plan", "label": "削除した旅行",
             "period": f"削除後{grace}日間",
             "note": f"削除後{grace}日間は復元できます。その後、予定・予約・文書の原本を含めて完全に削除します。"},
            {"key": "quick_draft", "label": "登録前の下書き(クイック作成)",
             "period": f"期限切れ後{QUICK_DRAFT_EXPIRED_RETENTION_DAYS}日 / 旅行へ変換後{QUICK_DRAFT_PROMOTED_RETENTION_DAYS}日",
             "note": "期限を過ぎた下書きは自動で削除します。"},
            {"key": "documents", "label": "文書の原本",
             "period": "設定した保持期限まで",
             "note": "文書に保持期限を設定すると、期限後に原本を削除します。旅行を完全に削除した時も削除します。"},
            {"key": "audit", "label": "操作の記録(監査ログ)",
             "period": "セキュリティ上の保持期間",
             "note": "不正利用の調査のため、誰がいつ何をしたかだけを、予定名・予約番号・本文などの内容を含めずに記録し、"
                     "旅行の削除後も保持します。"},
            {"key": "backup", "label": "バックアップ",
             "period": "運用環境の設定による",
             "note": "障害からの復旧のため、削除したデータも一定期間バックアップに残り、保持期間を過ぎると消去されます"
                     "(設計上の目安は35日分と月次。運用環境の設定に従います)。"},
            {"key": "exported", "label": "書き出したファイル・印刷物",
             "period": "回収できません",
             "note": "エクスポートしたファイル・PDF・印刷物・共有したリンク先で保存されたものは、アプリから削除できません。"},
        ],
    }


def _file(payload: Dict[str, Any], filename: str) -> Response:
    body = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
    return Response(content=body, media_type="application/json; charset=utf-8", headers={
        "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "no-store",
        "X-Content-SHA256": hashlib.sha256(body).hexdigest(),
    })


def _audit(request: Request, user: User, action: str, resource_type: str, resource_id, details: dict) -> None:
    record_audit_event(
        action=action, resource_type=resource_type, user_id=user.id, resource_id=resource_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        details=details,
    )


@plans_router.get("/{plan_id}/data-export")
def export_plan(plan_id: str, request: Request, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if role != "owner":
        raise HTTPException(status_code=403, detail={
            "code": "owner_only",
            "message": "旅行全体のエクスポートは所有者だけが行えます。自分のデータはアカウントのエクスポートで取得できます。",
        })
    now = _now()
    body = dx.plan_export(db, plan, current_user.id)
    payload = dx.envelope("plan", current_user, retention_info(), now, plans=[body])
    _audit(request, current_user, "plan_data_exported", "travel_plan", plan.id,
           {"plan_id": str(plan.id), "counts": body["counts"]})
    return _file(payload, f"travelcanvas-plan-{now.strftime('%Y%m%d')}.json")


def _private_profile(db: Session, user: User):
    from app.services import private_profile as pp

    row = pp.get_profile(db, user.id)
    if row is None:
        return None
    return {"revision": row.revision, "items": pp.decrypt_items(row),
            "applied_plan_ids": [str(x) for x in pp.linked_plan_ids(db, user.id)]}


@privacy_router.get("/data-export")
def export_account(request: Request, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    now = _now()
    owned = db.query(TravelPlan).filter(TravelPlan.user_id == current_user.id).order_by(TravelPlan.created_at).all()
    member_plans = dx.accessible_member_plans(db, current_user)
    roles = {c.plan_id: c.role for c in db.query(PlanCollaborator).filter(
        PlanCollaborator.user_id == current_user.id, PlanCollaborator.status == "accepted").all()}
    notifications = db.query(Notification).filter(Notification.user_id == current_user.id).all()
    payload = dx.envelope(
        "account", current_user, retention_info(), now,
        profile={**dx.row(current_user), "email": current_user.email},
        plans=[dx.plan_export(db, p, current_user.id) for p in owned],
        memberships=[{"plan_id": str(p.id), "title": p.title, "role": roles.get(p.id)} for p in member_plans],
        contributions=[dx.contributions(db, p, current_user.id) for p in member_plans],
        notifications=[dx.row(n) for n in notifications],
        # [Gate C1] 秘匿プロフィール(本人だけ。復号した項目)
        private_profile=_private_profile(db, current_user),
        # [Gate G6] 守る範囲(自宅・職場など)・オフライン保存の端末
        privacy_zones=dx.own_privacy_zones(db, cast(uuid.UUID, current_user.id)),
        offline_devices=dx.own_offline_devices(db, cast(uuid.UUID, current_user.id)),
        # [Gate G8] FR-039 訂正の履歴・所有者への訂正の申し出(本人の分。復号した値)
        corrections=_corrections(db, current_user),
    )
    _audit(request, current_user, "account_data_exported", "user", current_user.id,
           {"owned_plans": len(owned), "member_plans": len(member_plans)})
    return _file(payload, f"travelcanvas-account-{now.strftime('%Y%m%d')}.json")


def _corrections(db: Session, user: User) -> dict:
    from app.api.v1 import corrections

    return corrections.export_rows(db, user.id)


@privacy_router.get("/retention", response_model=dict)
def get_retention(current_user: User = Depends(get_current_user_or_guest)):
    return retention_info()
