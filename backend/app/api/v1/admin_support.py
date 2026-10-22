"""[Gate G2] FR-040 管理者のサポート閲覧と運用の要約(docs/adr/ADR-support-access.md)。

- GET  /admin/support-grants              : 有効な許可の一覧(本人が作ったもの。目的・期限・閲覧の回数)
- GET  /admin/support-grants/{id}/view    : 許可の対象を読み取り専用の投影で見る。見るたびに監査と本人への知らせ。
                                            自分が作った許可は 403、取り消し・期限切れは 404
- GET  /admin/operations                  : 運用の要約(有効な共有リンク・Webhook の失敗/dead・保存の容量・
                                            削除待ちの件数・有効なサポートの許可)。利用者の個人の値は含めない
- GET  /admin/operations/share-links      : 有効な共有リンクの一覧(先頭の数文字・権限・期限・使用回数)
- POST /admin/operations/share-links/{id}/revoke : 不正な利用が疑われる共有リンクを止める(監査と所有者への知らせ)

いずれも require_admin(管理者+多要素認証)。応答は Cache-Control: no-store。
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.api.v1.admin import _audit_admin, require_admin
from app.core.database import get_db
from app.models.models import (
    Document, Notification, OrgWebhookDelivery, PlanShareLink, SupportGrant, TravelPlan, User,
)
from app.services import support_access as sa_
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/admin", tags=["admin"])
VIEWS_PER_MINUTE = 30


def _uuid(v: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(v)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what}が見つかりません")


@router.get("/support-grants")
def admin_list_support_grants(request: Request, response: Response, admin: User = Depends(require_admin),
                              db: Session = Depends(get_db),
                              include_inactive: bool = Query(False)):
    q = db.query(SupportGrant)
    if not include_inactive:
        q = q.filter(SupportGrant.revoked_at.is_(None), SupportGrant.expires_at > sa_.now())
    rows = q.order_by(SupportGrant.created_at.desc()).limit(100).all()
    _audit_admin(request, admin, "admin_support_grants_listed", details={"count": len(rows)})
    response.headers["Cache-Control"] = "no-store"
    return {"grants": [{**sa_.admin_list_item(db, g), "own": str(g.user_id) == str(admin.id)} for g in rows]}


@router.get("/support-grants/{grant_id}/view")
def admin_view_support_grant(grant_id: str, request: Request, response: Response,
                             admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if not check_rate_limit(f"support_view:{admin.id}", VIEWS_PER_MINUTE, 60):
        raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "閲覧が多すぎます。しばらく待ってください"})
    grant = (db.query(SupportGrant).filter(SupportGrant.id == _uuid(grant_id, "許可"))
             .with_for_update().first())
    if grant is None:
        raise HTTPException(status_code=404, detail={"code": "grant_inactive", "message": "許可が見つかりません"})
    try:
        out = sa_.admin_view(db, grant, admin)
    except sa_.SupportError as e:
        # 判定は書き込みの前に行うため、取り消す変更は無い
        _audit_admin(request, admin, "support_grant_access_denied", resource_id=grant.id,
                     details={"reason": e.code})
        raise HTTPException(status_code=e.status, detail={"code": e.code, "message": e.message})
    sa_.record_access(db, grant, admin)
    db.commit()
    _audit_admin(request, admin, "support_grant_accessed", resource_id=grant.id,
                 details={"grant_id": str(grant.id), "subject_user_id": str(grant.user_id),
                          "scope": "plan" if grant.plan_id else "account"})
    out["grant"]["access_count"] = int(grant.access_count or 0)
    response.headers["Cache-Control"] = "no-store"
    return out


def _db_size(db: Session):
    try:
        with db.begin_nested():  # 失敗してもこの問い合わせだけを取り消す(SAVEPOINT)
            return int(db.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0)
    except Exception:  # noqa: BLE001 — 権限が無い環境でも要約は返す
        return None


@router.get("/operations")
def admin_operations(request: Request, response: Response, admin: User = Depends(require_admin),
                     db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    active_links = ((PlanShareLink.revoked_at.is_(None))
                    & ((PlanShareLink.expires_at.is_(None)) | (PlanShareLink.expires_at > now)))
    hooks = dict(db.query(OrgWebhookDelivery.status, func.count(OrgWebhookDelivery.id))
                 .group_by(OrgWebhookDelivery.status).all())
    docs_live = Document.deleted_at.is_(None)
    out = {
        "share_links": {
            "active": db.query(func.count(PlanShareLink.id)).filter(active_links).scalar() or 0,
            "active_edit": db.query(func.count(PlanShareLink.id))
            .filter(active_links, PlanShareLink.permission == "edit").scalar() or 0,
            "without_expiry": db.query(func.count(PlanShareLink.id))
            .filter(active_links, PlanShareLink.expires_at.is_(None)).scalar() or 0,
        },
        "webhooks": {"pending": int(hooks.get("pending", 0)), "failed": int(hooks.get("failed", 0)),
                     "dead": int(hooks.get("dead", 0)), "delivered": int(hooks.get("delivered", 0))},
        "storage": {
            "database_bytes": _db_size(db),
            "documents": db.query(func.count(Document.id)).filter(docs_live).scalar() or 0,
            "document_bytes": int(db.query(func.coalesce(func.sum(Document.size), 0))
                                  .filter(docs_live).scalar() or 0),
        },
        "purge": {
            "plans_pending": db.query(func.count(TravelPlan.id))
            .filter(TravelPlan.deleted_at.isnot(None)).scalar() or 0,
            "plans_due": db.query(func.count(TravelPlan.id))
            .filter(TravelPlan.deleted_at.isnot(None), TravelPlan.purge_after <= now).scalar() or 0,
            "documents_pending": db.query(func.count(Document.id))
            .filter(Document.deleted_at.isnot(None), Document.purge_status != "purged").scalar() or 0,
        },
        "support_grants": {"active": db.query(func.count(SupportGrant.id))
                           .filter(SupportGrant.revoked_at.is_(None), SupportGrant.expires_at > now).scalar() or 0},
        "timestamp": now.isoformat(),
    }
    _audit_admin(request, admin, "admin_operations_viewed")
    response.headers["Cache-Control"] = "no-store"
    return out


@router.get("/operations/share-links")
def admin_share_links(request: Request, response: Response, admin: User = Depends(require_admin),
                      db: Session = Depends(get_db), limit: int = Query(50, ge=1, le=200)):
    now = datetime.now(timezone.utc)
    rows = (db.query(PlanShareLink).filter(PlanShareLink.revoked_at.is_(None),
                                           (PlanShareLink.expires_at.is_(None)) | (PlanShareLink.expires_at > now))
            .order_by(PlanShareLink.use_count.desc(), PlanShareLink.created_at.desc()).limit(limit).all())
    _audit_admin(request, admin, "admin_share_links_listed", details={"count": len(rows)})
    response.headers["Cache-Control"] = "no-store"
    # 旅行の題名・所有者・トークンの値は出さない(リンクの識別は先頭の数文字と ID)
    return {"share_links": [{
        "id": str(s.id), "plan_id": str(s.plan_id), "token_prefix": s.token_prefix, "permission": s.permission,
        "has_passcode": bool(s.passcode_hash), "use_count": int(s.use_count or 0), "max_uses": s.max_uses,
        "expires_at": s.expires_at.isoformat() if s.expires_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    } for s in rows]}


@router.post("/operations/share-links/{link_id}/revoke")
def admin_revoke_share_link(link_id: str, request: Request, admin: User = Depends(require_admin),
                            db: Session = Depends(get_db), payload: dict = Body(default_factory=dict)):
    reason = payload.get("reason") if isinstance(payload, dict) else None
    if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 200:
        raise HTTPException(status_code=422, detail={"code": "invalid_reason", "message": "止める理由を200文字までで入力してください"})
    link = db.query(PlanShareLink).filter(PlanShareLink.id == _uuid(link_id, "共有リンク")).first()
    if link is None:
        raise HTTPException(status_code=404, detail="共有リンクが見つかりません")
    if link.revoked_at is None:
        link.revoked_at = datetime.now(timezone.utc)
        owner_id = db.query(TravelPlan.user_id).filter(TravelPlan.id == link.plan_id).scalar()
        if owner_id:
            db.add(Notification(user_id=owner_id, type="share_link_revoked_by_admin",
                                title="運営が共有リンクを停止しました",
                                message="不正な利用を防ぐため、運営が共有リンク(%s…)を停止しました。理由: %s"
                                        % (link.token_prefix, reason.strip()[:200]),
                                related_plan_id=link.plan_id))
        db.commit()
        _audit_admin(request, admin, "admin_share_link_revoked", resource_id=link.id,
                     details={"plan_id": str(link.plan_id), "reason_length": len(reason.strip())})
    return {"id": str(link.id), "revoked_at": link.revoked_at.isoformat()}
