"""
[FR059-B] 旅程相談の外部 API の利用枠(docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §8)。

- GET  /entitlements                                  : 自分のクラス・policy の版・feature・quota・今月の使用(ゲストは Guest)
- GET  /plans/{plan_id}/planning-usage                : 旅行の上限・確定・予約中・残り・月の残り・回数の残り・状態(閲覧以上)
- POST /plans/{plan_id}/planning-actions/estimate     : 操作の最大の見込み額と、今の残りで許されるか(provider を呼ばない。編集以上)
- GET  /admin/entitlements?subject_type=&subject_id=  : 付与の一覧(管理者)
- POST /admin/entitlements                            : クラスの付与・契約の例外を申請(pending。理由が要る)
- POST /admin/entitlements/{id}/approve               : 別の管理者が承認して active(二者の承認)
- POST /admin/entitlements/{id}/revoke                : 取り消す(理由が要る)
- GET  /admin/planning-usage?plan_id=                 : 旅行の口座・予約・provider 別の使用(管理者)

上限・クラス・provider は要求の本文から受け取らない(サーバーの policy と承認済みの付与だけ)。監査に金額・クラス・feature を残し、
旅程の内容・入力の文章は残さない。
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.v1.admin import require_admin
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import Entitlement, TravelPlan, User
from app.services import cost_guard as cg
from app.services.audit_service import record_audit_event

router = APIRouter(tags=["planning-usage"])
plan_router = APIRouter(prefix="/plans", tags=["planning-usage"])
admin_router = APIRouter(prefix="/admin", tags=["planning-usage"])

MAX_QUOTA = 10_000_000


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def guard_http(error: cg.CostGuardError) -> HTTPException:
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
    return HTTPException(status_code=error.status, detail=error.detail(), headers=headers)


@router.get("/entitlements")
def my_entitlements(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    try:
        return cg.user_summary(db, current_user)
    except cg.CostGuardError as error:
        raise guard_http(error)


@plan_router.get("/{plan_id}/planning-usage")
def planning_usage(plan_id: str, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    try:
        return cg.plan_summary(db, plan, current_user)
    except cg.CostGuardError as error:
        raise guard_http(error)


@plan_router.post("/{plan_id}/planning-actions/estimate")
def estimate_action(plan_id: str, payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    operation = payload.get("operation") if isinstance(payload, dict) else None
    units = payload.get("units") if isinstance(payload, dict) else None
    if not isinstance(operation, str) or operation not in cg.OPERATIONS:
        raise _bad("unknown_planning_operation", "知らない操作です")
    if units is not None and not isinstance(units, dict):
        raise _bad("invalid_planning_units", "操作の量はオブジェクトで指定してください")
    for key in ("plan_cap", "class", "provider", "monthly_cap", "profile_key"):
        if key in payload:
            raise _bad("client_policy_ignored", "上限・クラス・提供元は指定できません(サーバーが決めます)")
    try:
        return cg.estimate(db, plan, current_user, operation, units or {})
    except cg.CostGuardError as error:
        raise guard_http(error)


# ===================================================================== 管理(二者の承認)

def _grant_out(g: Entitlement) -> Dict[str, Any]:
    return {
        "id": str(g.id), "subject_type": g.subject_type, "subject_id": str(g.subject_id), "feature_key": g.feature_key,
        "status": g.status, "quota": g.quota, "source": g.source, "reason": g.reason,
        "starts_at": g.starts_at.isoformat() if g.starts_at else None,
        "ends_at": g.ends_at.isoformat() if g.ends_at else None,
        "requested_by": str(g.requested_by) if g.requested_by else None,
        "approved_by": str(g.approved_by) if g.approved_by else None,
        "approved_at": g.approved_at.isoformat() if g.approved_at else None,
    }


def _audit(request: Request, admin: User, action: str, grant: Entitlement) -> None:
    record_audit_event(action=action, resource_type="entitlement", user_id=admin.id, resource_id=grant.id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255],
                       details={"subject_type": grant.subject_type, "feature_key": grant.feature_key,
                                "quota": grant.quota, "source": grant.source, "status": grant.status})


@admin_router.get("/entitlements")
def admin_list_entitlements(subject_type: str = Query(..., pattern="^(user|plan)$"),
                            subject_id: uuid.UUID = Query(...), admin: User = Depends(require_admin),
                            db: Session = Depends(get_db)):
    rows = (db.query(Entitlement)
            .filter(Entitlement.subject_type == subject_type, Entitlement.subject_id == subject_id)
            .order_by(Entitlement.created_at.desc()).limit(200).all())
    body: Dict[str, Any] = {"grants": [_grant_out(r) for r in rows]}
    if subject_type == "user":
        user = db.get(User, subject_id)
        if user is not None:
            body["effective"] = cg.user_summary(db, user)
    else:
        body["usage"] = cg.admin_plan_usage(db, subject_id)
    return body


@admin_router.post("/entitlements", status_code=201)
def admin_request_entitlement(request: Request, payload: Dict[str, Any] = Body(...),
                              admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """申請(pending)。承認は別の管理者(二者の承認)。クラスの付与と、Pro の契約の例外(quota)だけ。"""
    subject_type = payload.get("subject_type")
    feature_key = payload.get("feature_key")
    reason = payload.get("reason")
    if subject_type not in ("user", "plan"):
        raise _bad("invalid_entitlement", "subject_type は user か plan です")
    try:
        subject_id = uuid.UUID(str(payload.get("subject_id")))
    except ValueError:
        raise _bad("invalid_entitlement", "subject_id が正しくありません")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 200:
        raise _bad("entitlement_reason_required", "理由を200文字までで入力してください")
    if not isinstance(feature_key, str) or not feature_key.startswith(cg.FEATURE_PREFIX):
        raise _bad("invalid_entitlement", "feature_key が正しくありません")
    name = feature_key[len(cg.FEATURE_PREFIX):]
    quota: Optional[int] = None
    source = "admin"
    if name.startswith("class."):
        klass = name[len("class."):]
        allowed = cg.PLAN_CLASSES if subject_type == "plan" else cg.USER_CLASSES
        if klass not in allowed:
            raise _bad("invalid_entitlement", "この対象に付けられるクラスではありません")
        if klass == "trip_pass":
            source = "trip_pass"
            if db.query(Entitlement).filter(
                    Entitlement.subject_type == "plan", Entitlement.subject_id == subject_id,
                    Entitlement.feature_key == feature_key, Entitlement.status.in_(("pending", "active"))).first():
                raise _bad("trip_pass_already_assigned", "この旅行には既に Trip Pass が割り当てられています", 409)
    elif name in cg.QUOTA_FEATURES:
        if subject_type != "user":
            raise _bad("invalid_entitlement", "quota の例外は利用者だけに付けます")
        value = payload.get("quota")
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_QUOTA:
            raise _bad("invalid_entitlement", "quota は 0 以上の整数です")
        has_pro = db.query(Entitlement).filter(
            Entitlement.subject_type == "user", Entitlement.subject_id == subject_id,
            Entitlement.feature_key == cg.FEATURE_PREFIX + "class.pro",
            Entitlement.status.in_(("pending", "active"))).first()
        if has_pro is None:
            raise _bad("quota_override_requires_pro",
                       "上限の例外は Pro/B2B の契約(クラス pro の付与)がある利用者だけに付けられます")
        quota = value
        source = "contract"
    else:
        raise _bad("invalid_entitlement", "feature_key が正しくありません")
    if subject_type == "user" and db.get(User, subject_id) is None:
        raise _bad("entitlement_subject_not_found", "対象の利用者が見つかりません", 404)
    if subject_type == "plan" and db.get(TravelPlan, subject_id) is None:
        raise _bad("entitlement_subject_not_found", "対象の旅行が見つかりません", 404)
    ends_at = None
    if payload.get("ends_at"):
        try:
            ends_at = datetime.fromisoformat(str(payload["ends_at"]).replace("Z", "+00:00"))
        except ValueError:
            raise _bad("invalid_entitlement", "ends_at は ISO 8601 の日時です")
        if ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=timezone.utc)
    grant = Entitlement(id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id, feature_key=feature_key,
                        status="pending", quota=quota, source=source, reason=reason.strip(), ends_at=ends_at,
                        requested_by=admin.id)
    db.add(grant)
    db.commit()
    db.refresh(grant)
    _audit(request, admin, "entitlement_requested", grant)
    return _grant_out(grant)


@admin_router.post("/entitlements/{grant_id}/approve")
def admin_approve_entitlement(grant_id: uuid.UUID, request: Request, admin: User = Depends(require_admin),
                              db: Session = Depends(get_db)):
    grant = db.query(Entitlement).filter(Entitlement.id == grant_id).with_for_update().first()
    if grant is None:
        raise _bad("entitlement_not_found", "付与が見つかりません", 404)
    if grant.status != "pending":
        raise _bad("entitlement_not_pending", "承認を待っている付与ではありません", 409)
    if grant.requested_by == admin.id:
        raise _bad("two_person_required", "申請した管理者とは別の管理者が承認してください", 409)
    grant.status = "active"
    grant.approved_by = admin.id
    grant.approved_at = datetime.now(timezone.utc)
    grant.updated_at = grant.approved_at
    db.commit()
    db.refresh(grant)
    _audit(request, admin, "entitlement_approved", grant)
    return _grant_out(grant)


@admin_router.post("/entitlements/{grant_id}/revoke")
def admin_revoke_entitlement(grant_id: uuid.UUID, request: Request, payload: Dict[str, Any] = Body(...),
                             admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    reason = payload.get("reason") if isinstance(payload, dict) else None
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 200:
        raise _bad("entitlement_reason_required", "取り消しの理由を200文字までで入力してください")
    grant = db.query(Entitlement).filter(Entitlement.id == grant_id).with_for_update().first()
    if grant is None:
        raise _bad("entitlement_not_found", "付与が見つかりません", 404)
    if grant.status == "revoked":
        return _grant_out(grant)
    grant.status = "revoked"
    grant.reason = reason.strip()
    grant.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(grant)
    _audit(request, admin, "entitlement_revoked", grant)
    return _grant_out(grant)


@admin_router.get("/planning-usage")
def admin_planning_usage(plan_id: uuid.UUID = Query(...), admin: User = Depends(require_admin),
                         db: Session = Depends(get_db)):
    return cg.admin_plan_usage(db, plan_id)
