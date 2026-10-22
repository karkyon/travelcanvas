"""[Gate B1] FR-041 組織・B2B(最小形)と FR-042 の管理(API クライアント・Webhook)の画面向け API。

- 会員だけ(ゲストは 401)。組織のメンバーでなければ 404。管理の操作は admin 以上(403)、役割の変更は owner だけ。
- 組織の管理者でも、メンバー個人の旅行は見られない(配布版の写しと、確認したかどうかだけ)。
- 監査には ID・役割・件数だけを残す(メールアドレス・秘密・旅程の内容は残さない)。
規則の正本は app/services/organizations.py・app/services/org_api.py。
"""
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, Request
from sqlalchemy.orm import Session

from app.core.auth import get_current_active_user
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    Organization, OrganizationMember, OrgApiClient, OrgDistribution, OrgDistributionAck, OrgWebhook,
    OrgWebhookDelivery, User,
)
from app.services import org_api, organizations as orgs
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/organizations", tags=["organizations"])
bad = orgs.bad


def _audit(action: str, request: Request, user: User, org_id, details: Optional[dict] = None) -> None:
    record_audit_event(
        action=action, resource_type="organization", user_id=user.id, resource_id=org_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255], details=details or {},
    )


def _iso(v):
    return v.isoformat() if v else None


def _org_dict(db: Session, org: Organization, m: OrganizationMember) -> Dict[str, Any]:
    return {
        "id": str(org.id), "name": org.name, "brand_color": org.brand_color, "role": m.role,
        "member_count": db.query(OrganizationMember).filter(OrganizationMember.organization_id == org.id).count(),
        "created_at": _iso(org.created_at),
    }


def _member_dict(m: OrganizationMember, u: Optional[User]) -> Dict[str, Any]:
    return {"id": str(m.id), "user_id": str(m.user_id), "username": u.username if u else None,
            "email": u.email if u else None, "role": m.role, "created_at": _iso(m.created_at)}


def _dist_dict(db: Session, d: OrgDistribution, user: User, role: str, with_snapshot: bool = False) -> Dict[str, Any]:
    mine = orgs.my_ack_version(db, d, user)
    out: Dict[str, Any] = {
        "id": str(d.id), "organization_id": str(d.organization_id), "title": d.title, "version": d.version,
        "change_note": d.change_note, "published_at": _iso(d.published_at), "revoked_at": _iso(d.revoked_at),
        "my_ack_version": mine, "acknowledged": mine == d.version,
        "ack_status": orgs.ack_status(db, d) if orgs.ROLE_RANK[role] >= orgs.ROLE_RANK["admin"] else None,
    }
    if with_snapshot:
        out["snapshot"] = d.snapshot
    return out


def _get_dist(db: Session, org: Organization, dist_id, include_revoked: bool = False) -> OrgDistribution:
    q = db.query(OrgDistribution).filter(OrgDistribution.id == dist_id, OrgDistribution.organization_id == org.id)
    if not include_revoked:
        q = q.filter(OrgDistribution.revoked_at.is_(None))
    d = q.first()
    if not d:
        raise bad("distribution_not_found", "配布が見つかりません", 404)
    return d


def _payload(payload: Optional[dict]) -> dict:
    if payload is None:
        return {}
    if not isinstance(payload, dict):
        raise bad("invalid_request", "本文の形が正しくありません")
    return payload


# ===== 組織 =====

@router.get("")
async def list_organizations(user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    rows = (db.query(Organization, OrganizationMember)
            .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
            .filter(OrganizationMember.user_id == user.id, Organization.deleted_at.is_(None))
            .order_by(Organization.created_at.asc()).all())
    return [_org_dict(db, o, m) for o, m in rows]


@router.post("", status_code=201)
async def create_organization(request: Request, payload: Optional[dict] = Body(None),
                              user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    p = _payload(payload)
    name, color = orgs.clean_name(p.get("name")), orgs.clean_color(p.get("brand_color"))
    owned = db.query(OrganizationMember).filter(OrganizationMember.user_id == user.id,
                                                OrganizationMember.role == "owner").count()
    if owned >= orgs.MAX_ORGS_PER_USER:
        raise bad("too_many_organizations", f"作れる組織は{orgs.MAX_ORGS_PER_USER}までです", 409)
    org = Organization(id=uuid.uuid4(), name=name, brand_color=color, created_by=user.id)
    db.add(org)
    db.flush()
    m = OrganizationMember(id=uuid.uuid4(), organization_id=org.id, user_id=user.id, role="owner")
    db.add(m)
    db.commit()
    _audit("organization_created", request, user, org.id)
    return _org_dict(db, org, m)


@router.get("/{org_id}")
async def get_organization(org_id: uuid.UUID, user: User = Depends(get_current_active_user),
                           db: Session = Depends(get_db)):
    org, m = orgs.require_org(db, org_id, user)
    return _org_dict(db, org, m)


@router.patch("/{org_id}")
async def update_organization(org_id: uuid.UUID, request: Request, payload: Optional[dict] = Body(None),
                              user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, m = orgs.require_org(db, org_id, user, "admin")
    p = _payload(payload)
    if "name" in p:
        org.name = orgs.clean_name(p["name"])
    if "brand_color" in p:
        org.brand_color = orgs.clean_color(p["brand_color"])
    db.commit()
    changed = sorted(k for k in p if k in ("name", "brand_color"))
    _audit("organization_updated", request, user, org.id, {"changed": changed})
    return _org_dict(db, org, m)


# ===== メンバー =====

@router.get("/{org_id}/members")
async def list_members(org_id: uuid.UUID, user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    rows = (db.query(OrganizationMember, User).outerjoin(User, User.id == OrganizationMember.user_id)
            .filter(OrganizationMember.organization_id == org.id).order_by(OrganizationMember.created_at.asc()).all())
    return [_member_dict(mm, u) for mm, u in rows]


@router.post("/{org_id}/members", status_code=201)
async def add_member(org_id: uuid.UUID, request: Request, payload: Optional[dict] = Body(None),
                     user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, me = orgs.require_org(db, org_id, user, "admin")
    p = _payload(payload)
    role = p.get("role", "member")
    if role not in ("member", "admin"):
        raise bad("invalid_role", "役割は member か admin です(owner へは役割の変更で)")
    email = p.get("email")
    if not isinstance(email, str) or "@" not in email or len(email) > 320:
        raise bad("invalid_email", "メールアドレスを入力してください")
    target = db.query(User).filter(User.email == email.strip(), User.is_active.is_(True)).first()
    if not target or target.user_type == "guest":
        raise bad("user_not_found", "このメールアドレスの会員が見つかりません。先に会員登録してもらってください", 404)
    if orgs.membership(db, org.id, target):
        raise bad("already_member", "すでにメンバーです", 409)
    mm = OrganizationMember(id=uuid.uuid4(), organization_id=org.id, user_id=target.id, role=role)
    db.add(mm)
    db.commit()
    _audit("organization_member_added", request, user, org.id, {"member_id": str(mm.id), "role": role})
    return _member_dict(mm, target)


@router.patch("/{org_id}/members/{member_id}")
async def change_member_role(org_id: uuid.UUID, member_id: uuid.UUID, request: Request,
                             payload: Optional[dict] = Body(None),
                             user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, _me = orgs.require_org(db, org_id, user, "owner")
    role = _payload(payload).get("role")
    if role not in orgs.ROLES:
        raise bad("invalid_role", "役割は owner・admin・member のいずれかです")
    mm = db.query(OrganizationMember).filter(OrganizationMember.id == member_id,
                                             OrganizationMember.organization_id == org.id).first()
    if not mm:
        raise bad("member_not_found", "メンバーが見つかりません", 404)
    if mm.role == "owner" and role != "owner" and orgs.owner_count(db, org.id) <= 1:
        raise bad("last_owner", "組織には owner が1人以上必要です", 409)
    mm.role = role
    db.commit()
    _audit("organization_member_role_changed", request, user, org.id, {"member_id": str(mm.id), "role": role})
    return _member_dict(mm, db.query(User).filter(User.id == mm.user_id).first())


@router.delete("/{org_id}/members/{member_id}")
async def remove_member(org_id: uuid.UUID, member_id: uuid.UUID, request: Request,
                        user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, me = orgs.require_org(db, org_id, user)
    mm = db.query(OrganizationMember).filter(OrganizationMember.id == member_id,
                                             OrganizationMember.organization_id == org.id).first()
    if not mm:
        raise bad("member_not_found", "メンバーが見つかりません", 404)
    leaving = mm.user_id == user.id
    if not leaving:
        if orgs.ROLE_RANK[me.role] < orgs.ROLE_RANK["admin"]:
            raise bad("forbidden_role", "この操作は組織の管理者だけができます", 403)
        if orgs.ROLE_RANK[mm.role] > orgs.ROLE_RANK[me.role]:
            raise bad("forbidden_role", "owner を外せるのは owner だけです", 403)
    if mm.role == "owner" and orgs.owner_count(db, org.id) <= 1:
        raise bad("last_owner", "組織には owner が1人以上必要です。先に他の人を owner にしてください", 409)
    db.query(OrgDistributionAck).filter(
        OrgDistributionAck.user_id == mm.user_id,
        OrgDistributionAck.distribution_id.in_(db.query(OrgDistribution.id).filter(
            OrgDistribution.organization_id == org.id))).delete(synchronize_session=False)
    db.delete(mm)
    db.commit()
    _audit("organization_member_removed", request, user, org.id, {"member_id": str(member_id), "self": leaving})
    return {"success": True}


# ===== 配布 =====

@router.get("/{org_id}/distributions")
async def list_distributions(org_id: uuid.UUID, include_revoked: bool = False,
                             user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, m = orgs.require_org(db, org_id, user)
    q = db.query(OrgDistribution).filter(OrgDistribution.organization_id == org.id)
    if not (include_revoked and orgs.ROLE_RANK[m.role] >= orgs.ROLE_RANK["admin"]):
        q = q.filter(OrgDistribution.revoked_at.is_(None))
    return [_dist_dict(db, d, user, m.role) for d in q.order_by(OrgDistribution.published_at.desc()).all()]


@router.post("/{org_id}/distributions", status_code=201)
async def publish_distribution(org_id: uuid.UUID, request: Request, background: BackgroundTasks,
                               payload: Optional[dict] = Body(None),
                               user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, m = orgs.require_org(db, org_id, user, "admin")
    p = _payload(payload)
    try:
        plan_uuid = uuid.UUID(str(p.get("plan_id")))
    except ValueError:
        raise bad("invalid_plan", "配布する旅行を選んでください")
    plan, _role = require_plan_access(db, plan_uuid, user, min_role="owner")
    title = p.get("title") or plan.title
    if not isinstance(title, str) or not title.strip() or len(title) > 200:
        raise bad("invalid_title", "配布の題名は200文字までです")
    d = OrgDistribution(id=uuid.uuid4(), organization_id=org.id, source_plan_id=plan.id, title=title.strip(),
                        version=1, snapshot=orgs.build_snapshot(db, plan),
                        change_note=orgs.clean_note(p.get("change_note")), published_by=user.id,
                        published_at=orgs.now())
    db.add(d)
    db.flush()
    ids = org_api.enqueue(db, org.id, "distribution.published", {"distribution_id": str(d.id), "version": 1})
    db.commit()
    background.add_task(org_api.deliver_pending, ids)
    _audit("org_distribution_published", request, user, org.id, {"distribution_id": str(d.id), "version": 1})
    return _dist_dict(db, d, user, m.role, with_snapshot=True)


@router.get("/{org_id}/distributions/{dist_id}")
async def get_distribution(org_id: uuid.UUID, dist_id: uuid.UUID, user: User = Depends(get_current_active_user),
                           db: Session = Depends(get_db)):
    org, m = orgs.require_org(db, org_id, user)
    admin = orgs.ROLE_RANK[m.role] >= orgs.ROLE_RANK["admin"]
    return _dist_dict(db, _get_dist(db, org, dist_id, include_revoked=admin), user, m.role, with_snapshot=True)


@router.post("/{org_id}/distributions/{dist_id}/revise")
async def revise_distribution(org_id: uuid.UUID, dist_id: uuid.UUID, request: Request, background: BackgroundTasks,
                              payload: Optional[dict] = Body(None),
                              user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, m = orgs.require_org(db, org_id, user, "admin")
    d = _get_dist(db, org, dist_id)
    p = _payload(payload)
    if p.get("base_version") is not None and p.get("base_version") != d.version:
        raise bad("stale_version", "配布が別の操作で改訂されています。読み直してください", 409)
    if d.source_plan_id is None:
        raise bad("source_plan_gone", "元の旅行が削除されているため改訂できません", 409)
    plan, _role = require_plan_access(db, d.source_plan_id, user, min_role="editor")
    new = orgs.build_snapshot(db, plan)
    changes = orgs.snapshot_changes(d.snapshot or {}, new)
    d.snapshot, d.version = new, d.version + 1
    d.change_note, d.published_at, d.published_by = orgs.clean_note(p.get("change_note")), orgs.now(), user.id
    ids = org_api.enqueue(db, org.id, "distribution.revised", {"distribution_id": str(d.id), "version": d.version})
    db.commit()
    background.add_task(org_api.deliver_pending, ids)
    _audit("org_distribution_revised", request, user, org.id, {"distribution_id": str(d.id), "version": d.version})
    out = _dist_dict(db, d, user, m.role, with_snapshot=True)
    out["changes"] = changes
    return out


@router.post("/{org_id}/distributions/{dist_id}/revoke")
async def revoke_distribution(org_id: uuid.UUID, dist_id: uuid.UUID, request: Request, background: BackgroundTasks,
                              user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, m = orgs.require_org(db, org_id, user, "admin")
    d = _get_dist(db, org, dist_id)
    d.revoked_at = orgs.now()
    ids = org_api.enqueue(db, org.id, "distribution.revoked", {"distribution_id": str(d.id), "version": d.version})
    db.commit()
    background.add_task(org_api.deliver_pending, ids)
    _audit("org_distribution_revoked", request, user, org.id, {"distribution_id": str(d.id)})
    return _dist_dict(db, d, user, m.role)


@router.post("/{org_id}/distributions/{dist_id}/acknowledge")
async def acknowledge_distribution(org_id: uuid.UUID, dist_id: uuid.UUID, background: BackgroundTasks,
                                   payload: Optional[dict] = Body(None),
                                   user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, m = orgs.require_org(db, org_id, user)
    d = _get_dist(db, org, dist_id)
    version = _payload(payload).get("version")
    if version != d.version:
        raise bad("stale_version", "配布が改訂されています。最新版を確認してください", 409)
    exists = db.query(OrgDistributionAck).filter(OrgDistributionAck.distribution_id == d.id,
                                                 OrgDistributionAck.user_id == user.id,
                                                 OrgDistributionAck.version == d.version).first()
    if not exists:
        db.add(OrgDistributionAck(id=uuid.uuid4(), distribution_id=d.id, user_id=user.id, version=d.version))
        db.flush()
        st = orgs.ack_status(db, d)
        ids = org_api.enqueue(db, org.id, "distribution.acknowledged", {
            "distribution_id": str(d.id), "version": d.version, "members": st["members"],
            "acknowledged_latest": st["acknowledged_latest"]})
        db.commit()
        background.add_task(org_api.deliver_pending, ids)
    return _dist_dict(db, d, user, m.role)


@router.get("/{org_id}/distributions/{dist_id}/acknowledgements")
async def list_acknowledgements(org_id: uuid.UUID, dist_id: uuid.UUID, user: User = Depends(get_current_active_user),
                                db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    d = _get_dist(db, org, dist_id, include_revoked=True)
    acks = db.query(OrgDistributionAck).filter(OrgDistributionAck.distribution_id == d.id).all()
    latest: Dict[Any, OrgDistributionAck] = {}
    for a in acks:
        if a.user_id not in latest or a.version > latest[a.user_id].version:
            latest[a.user_id] = a
    rows = (db.query(OrganizationMember, User).outerjoin(User, User.id == OrganizationMember.user_id)
            .filter(OrganizationMember.organization_id == org.id).order_by(OrganizationMember.created_at.asc()).all())
    return {
        "version": d.version, **orgs.ack_status(db, d),
        "members": [{"member_id": str(mm.id), "username": u.username if u else None, "role": mm.role,
                     "acked_version": latest[mm.user_id].version if mm.user_id in latest else None,
                     "acked_at": _iso(latest[mm.user_id].acked_at) if mm.user_id in latest else None}
                    for mm, u in rows],
    }


@router.post("/{org_id}/distributions/{dist_id}/fork", status_code=201)
async def fork_distribution(org_id: uuid.UUID, dist_id: uuid.UUID, request: Request,
                            user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user)
    d = _get_dist(db, org, dist_id)
    plan = orgs.fork(db, d, user)
    db.commit()
    _audit("org_distribution_forked", request, user, org.id, {"distribution_id": str(d.id), "version": d.version})
    return {"plan_id": str(plan.id), "title": plan.title, "version": d.version}


# ===== 外部連携: API クライアント =====

def _previous_until(expires_at) -> Optional[str]:
    return _iso(expires_at) if expires_at is not None and expires_at > orgs.now() else None


def _client_dict(c: OrgApiClient, secret: Optional[str] = None) -> Dict[str, Any]:
    return {"id": str(c.id), "name": c.name, "client_id": c.client_id, "client_secret": secret,
            "scopes": list(c.scopes or []), "created_at": _iso(c.created_at), "last_used_at": _iso(c.last_used_at),
            "revoked_at": _iso(c.revoked_at),
            # [Gate G2] 秘密の切り替え: 版・前の秘密が通る期限(過ぎていれば null)
            "secret_version": int(c.secret_version or 1), "secret_rotated_at": _iso(c.secret_rotated_at),
            "previous_secret_valid_until": (_previous_until(c.previous_secret_expires_at)
                                            if c.previous_secret_hash else None)}


@router.get("/{org_id}/api-clients")
async def list_api_clients(org_id: uuid.UUID, user: User = Depends(get_current_active_user),
                           db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    rows = db.query(OrgApiClient).filter(OrgApiClient.organization_id == org.id).order_by(OrgApiClient.created_at).all()
    return {"clients": [_client_dict(c) for c in rows], "scopes": org_api.SCOPES}


@router.post("/{org_id}/api-clients", status_code=201)
async def create_api_client(org_id: uuid.UUID, request: Request, payload: Optional[dict] = Body(None),
                            user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    p = _payload(payload)
    name = p.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise bad("invalid_name", "連携の名前を100文字までで入力してください")
    try:
        scopes = org_api.clean_scopes(p.get("scopes"))
    except ValueError:
        raise bad("invalid_scope", "スコープは " + "・".join(org_api.SCOPES) + " から選んでください")
    active = db.query(OrgApiClient).filter(OrgApiClient.organization_id == org.id,
                                           OrgApiClient.revoked_at.is_(None)).count()
    if active >= org_api.MAX_CLIENTS:
        raise bad("too_many_clients", f"使える連携は{org_api.MAX_CLIENTS}件までです", 409)
    client_id, secret = org_api.new_client_credentials()
    c = OrgApiClient(id=uuid.uuid4(), organization_id=org.id, name=name.strip(), client_id=client_id,
                     secret_hash=org_api.sha256(secret), scopes=scopes, created_by=user.id)
    db.add(c)
    db.commit()
    _audit("org_api_client_created", request, user, org.id, {"api_client": c.client_id, "scopes": scopes})
    return _client_dict(c, secret)


def _get_client(db: Session, org: Organization, client_uuid) -> OrgApiClient:
    c = db.query(OrgApiClient).filter(OrgApiClient.id == client_uuid, OrgApiClient.organization_id == org.id).first()
    if not c:
        raise bad("api_client_not_found", "連携が見つかりません", 404)
    return c


def _grace(p: Dict[str, Any]) -> int:
    try:
        return org_api.clean_grace_hours(p.get("grace_hours"))
    except ValueError:
        raise bad("invalid_grace", f"前の秘密を使える時間は0〜{org_api.MAX_GRACE_HOURS}時間の整数で指定してください")


@router.post("/{org_id}/api-clients/{client_uuid}/rotate-secret")
async def rotate_api_client_secret(org_id: uuid.UUID, client_uuid: uuid.UUID, request: Request,
                                   payload: Optional[dict] = Body(None),
                                   user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """[Gate G2] 秘密を作り直す(新しい秘密は1回だけ返す)。前の秘密は grace_hours(既定24時間)の間だけ通る。"""
    org, _m = orgs.require_org(db, org_id, user, "admin")
    c = _get_client(db, org, client_uuid)
    if c.revoked_at is not None:
        raise bad("api_client_revoked", "止めた連携の秘密は作り直せません", 409)
    grace = _grace(_payload(payload))
    secret = org_api.rotate_client_secret(c, grace)
    db.commit()
    _audit("org_api_client_secret_rotated", request, user, org.id,
           {"api_client": c.client_id, "secret_version": c.secret_version, "grace_hours": grace})
    return _client_dict(c, secret)


@router.post("/{org_id}/api-clients/{client_uuid}/retire-previous")
async def retire_api_client_previous(org_id: uuid.UUID, client_uuid: uuid.UUID, request: Request,
                                     payload: Optional[dict] = Body(None),
                                     user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """[Gate G2] 猶予を待たずに前の秘密を失効する。revoke_tokens=true なら発行済みのトークンも失効する。"""
    org, _m = orgs.require_org(db, org_id, user, "admin")
    c = _get_client(db, org, client_uuid)
    p = _payload(payload)
    revoke_tokens = p.get("revoke_tokens") is True
    removed = org_api.retire_previous_client_secret(db, c, revoke_tokens)
    db.commit()
    _audit("org_api_client_previous_retired", request, user, org.id,
           {"api_client": c.client_id, "tokens_revoked": int(removed)})
    return {**_client_dict(c), "tokens_revoked": int(removed)}


@router.post("/{org_id}/api-clients/{client_uuid}/revoke")
async def revoke_api_client(org_id: uuid.UUID, client_uuid: uuid.UUID, request: Request,
                            user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    c = db.query(OrgApiClient).filter(OrgApiClient.id == client_uuid, OrgApiClient.organization_id == org.id).first()
    if not c:
        raise bad("api_client_not_found", "連携が見つかりません", 404)
    org_api.revoke_client(db, c)
    db.commit()
    _audit("org_api_client_revoked", request, user, org.id, {"api_client": c.client_id})
    return _client_dict(c)


# ===== 外部連携: Webhook =====

def _hook_dict(h: OrgWebhook, secret: Optional[str] = None) -> Dict[str, Any]:
    return {"id": str(h.id), "url": h.url, "events": list(h.events or []), "secret": secret,
            "created_at": _iso(h.created_at), "revoked_at": _iso(h.revoked_at),
            # [Gate G2] 署名の鍵の版・前の鍵でも署名する期限・自動で止めた理由(受け手が 410 を返した等)
            "secret_version": int(h.secret_version or 1),
            "previous_secret_valid_until": (_previous_until(h.previous_secret_expires_at)
                                            if h.previous_secret_ciphertext else None),
            "disabled_reason": h.disabled_reason}


def _delivery_dict(d: OrgWebhookDelivery) -> Dict[str, Any]:
    return {"id": str(d.id), "event_id": str(d.event_id), "event_type": d.event_type, "status": d.status,
            "attempts": d.attempts, "last_status_code": d.last_status_code, "last_error": d.last_error,
            "created_at": _iso(d.created_at), "delivered_at": _iso(d.delivered_at),
            "next_attempt_at": _iso(d.next_attempt_at) if d.status in ("pending", "failed") else None,
            "max_attempts": org_api.MAX_ATTEMPTS}


def _get_hook(db: Session, org: Organization, hook_id) -> OrgWebhook:
    h = db.query(OrgWebhook).filter(OrgWebhook.id == hook_id, OrgWebhook.organization_id == org.id).first()
    if not h:
        raise bad("webhook_not_found", "Webhook が見つかりません", 404)
    return h


@router.get("/{org_id}/webhooks")
async def list_webhooks(org_id: uuid.UUID, user: User = Depends(get_current_active_user),
                        db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    rows = db.query(OrgWebhook).filter(OrgWebhook.organization_id == org.id).order_by(OrgWebhook.created_at).all()
    return {"webhooks": [_hook_dict(h) for h in rows], "events": org_api.EVENTS}


@router.post("/{org_id}/webhooks", status_code=201)
async def create_webhook(org_id: uuid.UUID, request: Request, payload: Optional[dict] = Body(None),
                         user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    p = _payload(payload)
    try:
        url = org_api.check_url(p.get("url"))
    except ValueError as e:
        if str(e) == "blocked_host":
            raise bad("blocked_host", "内部のアドレス・localhost へは送れません")
        raise bad("invalid_url", "https:// で始まる URL を入力してください(ユーザー名・パスワードは含めない)")
    try:
        events = org_api.clean_events(p.get("events"))
    except ValueError:
        raise bad("invalid_events", "送るできごとを選んでください")
    active = db.query(OrgWebhook).filter(OrgWebhook.organization_id == org.id, OrgWebhook.revoked_at.is_(None)).count()
    if active >= org_api.MAX_WEBHOOKS:
        raise bad("too_many_webhooks", f"Webhook は{org_api.MAX_WEBHOOKS}件までです", 409)
    secret = org_api.new_webhook_secret()
    h = OrgWebhook(id=uuid.uuid4(), organization_id=org.id, url=url, secret_ciphertext=org_api.seal_secret(secret),
                   events=events, created_by=user.id)
    db.add(h)
    db.commit()
    _audit("org_webhook_created", request, user, org.id, {"webhook_id": str(h.id), "events": events})
    return _hook_dict(h, secret)


@router.post("/{org_id}/webhooks/{hook_id}/revoke")
async def revoke_webhook(org_id: uuid.UUID, hook_id: uuid.UUID, request: Request,
                         user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    h = _get_hook(db, org, hook_id)
    h.revoked_at = h.revoked_at or orgs.now()
    db.commit()
    _audit("org_webhook_revoked", request, user, org.id, {"webhook_id": str(h.id)})
    return _hook_dict(h)


@router.post("/{org_id}/webhooks/{hook_id}/rotate-secret")
async def rotate_webhook_secret(org_id: uuid.UUID, hook_id: uuid.UUID, request: Request,
                                payload: Optional[dict] = Body(None),
                                user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """[Gate G2] 署名の鍵を作り直す(新しい鍵は1回だけ返す)。grace_hours の間は新旧の両方で署名する。"""
    org, _m = orgs.require_org(db, org_id, user, "admin")
    h = _get_hook(db, org, hook_id)
    if h.revoked_at is not None:
        raise bad("webhook_revoked", "止めた Webhook の鍵は作り直せません", 409)
    grace = _grace(_payload(payload))
    secret = org_api.rotate_webhook_secret(h, grace)
    db.commit()
    _audit("org_webhook_secret_rotated", request, user, org.id,
           {"webhook_id": str(h.id), "secret_version": h.secret_version, "grace_hours": grace})
    return _hook_dict(h, secret)


@router.post("/{org_id}/webhooks/{hook_id}/retire-previous")
async def retire_webhook_previous(org_id: uuid.UUID, hook_id: uuid.UUID, request: Request,
                                  user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """[Gate G2] 猶予を待たずに前の鍵での署名をやめる。"""
    org, _m = orgs.require_org(db, org_id, user, "admin")
    h = _get_hook(db, org, hook_id)
    org_api.retire_previous_webhook_secret(h)
    db.commit()
    _audit("org_webhook_previous_retired", request, user, org.id, {"webhook_id": str(h.id)})
    return _hook_dict(h)


@router.post("/{org_id}/webhooks/{hook_id}/ping")
async def ping_webhook(org_id: uuid.UUID, hook_id: uuid.UUID, user: User = Depends(get_current_active_user),
                       db: Session = Depends(get_db)):
    """接続の確かめ。その場で送り、結果を返す。"""
    org, _m = orgs.require_org(db, org_id, user, "admin")
    h = _get_hook(db, org, hook_id)
    if h.revoked_at is not None:
        raise bad("webhook_revoked", "止めた Webhook には送れません", 409)
    event_id = uuid.uuid4()
    d = OrgWebhookDelivery(id=uuid.uuid4(), webhook_id=h.id, event_id=event_id, event_type="ping",
                           payload={"id": str(event_id), "type": "ping", "created_at": orgs.now().isoformat(),
                                    "organization_id": str(org.id), "data": {}}, status="pending")
    db.add(d)
    db.flush()
    org_api.deliver(db, d)
    db.commit()
    return _delivery_dict(d)


@router.get("/{org_id}/webhooks/{hook_id}/deliveries")
async def list_deliveries(org_id: uuid.UUID, hook_id: uuid.UUID, user: User = Depends(get_current_active_user),
                          db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    h = _get_hook(db, org, hook_id)
    rows = (db.query(OrgWebhookDelivery).filter(OrgWebhookDelivery.webhook_id == h.id)
            .order_by(OrgWebhookDelivery.created_at.desc()).limit(20).all())
    return [_delivery_dict(d) for d in rows]


@router.post("/{org_id}/webhooks/{hook_id}/deliveries/{delivery_id}/redeliver")
async def redeliver(org_id: uuid.UUID, hook_id: uuid.UUID, delivery_id: uuid.UUID,
                    user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    org, _m = orgs.require_org(db, org_id, user, "admin")
    h = _get_hook(db, org, hook_id)
    d = db.query(OrgWebhookDelivery).filter(OrgWebhookDelivery.id == delivery_id,
                                            OrgWebhookDelivery.webhook_id == h.id).first()
    if not d:
        raise bad("delivery_not_found", "送信の記録が見つかりません", 404)
    if d.status == "delivered":
        raise bad("already_delivered", "届いた送信は送り直せません", 409)
    if h.revoked_at is not None:
        raise bad("webhook_revoked", "止めた Webhook には送れません", 409)
    # [Gate G2] dead(自動の再送の上限に達した)も手で送り直せる。手の送り直しは組織ごと1分10回まで
    if not check_rate_limit(f"org_redeliver:{org.id}", 10, 60):
        raise bad("rate_limited", "送り直しが多すぎます。しばらく待ってください", 429)
    org_api.deliver(db, d)
    db.commit()
    return _delivery_dict(d)
