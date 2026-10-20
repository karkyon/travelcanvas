"""[Gate B1] FR-041 組織・B2B(最小形): 役割・配布版の写し・閲覧確認・自分の旅行として複製。

DOC-02 FR-041「組織、ブランド、テンプレート、旅行配布、版改訂、閲覧確認、組織役割」、DOC-03 §24
「組織管理者であっても個人旅行を見られない。組織配布旅行と個人フォークの所有権・更新関係を別エンティティで表現」、
DOC-01 §15.4/15.6(配布版に予約番号・健康情報を含めない。事業者の更新は利用者の旅程を勝手に上書きしない)。

- 役割: owner(作った人。最低1人)・admin(メンバー・配布・外部連携を管理)・member(配布を見て確認・複製)。
- 配布版: 元の旅行から写した snapshot。写すのは標準の共有項目(旅行名・目的地・期間・説明・日程の見出し・
  予定名・種類・時刻)だけ。予約・番号・住所・メモ・位置・文書・費用・参加者は写さない。
- 版の改訂: 元の旅行から写し直して版を上げる。過去の版の確認は残り、最新版の確認が無い人を「未確認」と数える。
- 複製(フォーク): 配布版の写しからメンバー自身の旅行を作る。以後の改訂はその旅行を変えない(差分で知らせるだけ)。
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import (
    Organization, OrganizationMember, OrgApiClient, OrgDistribution, OrgDistributionAck, OrgWebhook, TravelDay,
    TravelEvent, TravelPlan, User,
)

ROLES = ("owner", "admin", "member")
ROLE_RANK = {"member": 1, "admin": 2, "owner": 3}
MAX_ORGS_PER_USER = 20
MAX_NAME = 100
MAX_NOTE = 500
_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def now() -> datetime:
    return datetime.now(timezone.utc)


def bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def clean_name(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise bad("invalid_name", "組織の名前を入力してください")
    name = " ".join(value.split())
    if len(name) > MAX_NAME or any(ord(c) < 32 for c in name):
        raise bad("invalid_name", f"組織の名前は{MAX_NAME}文字までです")
    return name


def clean_color(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not _COLOR.match(value):
        raise bad("invalid_color", "ブランドの色は #RRGGBB の形で指定してください")
    return value.lower()


def clean_note(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or len(value) > MAX_NOTE:
        raise bad("invalid_note", f"改訂の説明は{MAX_NOTE}文字までです")
    return value.strip() or None


def membership(db: Session, org_id, user: User) -> Optional[OrganizationMember]:
    return (db.query(OrganizationMember)
            .filter(OrganizationMember.organization_id == org_id, OrganizationMember.user_id == user.id).first())


def require_org(db: Session, org_id, user: User, min_role: str = "member") -> Tuple[Organization, OrganizationMember]:
    """メンバーでなければ 404(組織の存在を推測させない)。役割が足りなければ 403。"""
    org = db.query(Organization).filter(Organization.id == org_id, Organization.deleted_at.is_(None)).first()
    m = membership(db, org_id, user) if org else None
    if not org or not m:
        raise bad("organization_not_found", "組織が見つかりません", 404)
    if ROLE_RANK[m.role] < ROLE_RANK[min_role]:
        raise bad("forbidden_role", "この操作は組織の管理者だけができます", 403)
    return org, m


def owner_count(db: Session, org_id) -> int:
    return db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org_id, OrganizationMember.role == "owner").count()


def _iso(d) -> Optional[str]:
    return d.isoformat() if d else None


def build_snapshot(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    """配布版の写し。標準の共有項目だけ(予約・番号・住所・メモ・位置・内部IDを写さない)。"""
    days = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
            .order_by(TravelDay.local_date.asc(), TravelDay.sort_order.asc()).all())
    events_by_day: Dict[Any, List[TravelEvent]] = {}
    if days:
        for e in (db.query(TravelEvent).filter(TravelEvent.day_id.in_([d.id for d in days]))
                  .order_by(TravelEvent.sort_order.asc()).all()):
            events_by_day.setdefault(e.day_id, []).append(e)
    return {
        "title": plan.title,
        "description": plan.description,
        "destination": plan.destination,
        "start_date": _iso(plan.start_date),
        "end_date": _iso(plan.end_date),
        "days": [
            {
                "date": d.local_date.isoformat(),
                "timezone_id": d.timezone_id,
                "title": d.title,
                "events": [
                    {"title": e.title, "event_type": e.event_type, "local_start_time": e.local_start_time,
                     "is_all_day": bool(e.is_all_day)}
                    for e in events_by_day.get(d.id, [])
                ],
            }
            for d in days
        ],
    }


def snapshot_changes(old: Dict[str, Any], new: Dict[str, Any]) -> Dict[str, int]:
    """改訂で変わった件数(日程・予定の追加・削除・変更)。利用者の複製した旅行は変えない(差分で知らせる)。"""
    def events(s):
        out = {}
        for d in s.get("days", []):
            for i, e in enumerate(d.get("events", [])):
                out[(d["date"], i)] = (e.get("title"), e.get("local_start_time"), e.get("event_type"))
        return out
    a, b = events(old), events(new)
    return {
        "events_added": len(set(b) - set(a)),
        "events_removed": len(set(a) - set(b)),
        "events_changed": sum(1 for k in set(a) & set(b) if a[k] != b[k]),
        "days_before": len(old.get("days", [])),
        "days_after": len(new.get("days", [])),
    }


def ack_status(db: Session, dist: OrgDistribution) -> Dict[str, Any]:
    members = db.query(OrganizationMember).filter(OrganizationMember.organization_id == dist.organization_id).all()
    acks = db.query(OrgDistributionAck).filter(OrgDistributionAck.distribution_id == dist.id).all()
    latest = {}
    for a in acks:
        latest[a.user_id] = max(latest.get(a.user_id, 0), a.version)
    acked = sum(1 for m in members if latest.get(m.user_id) == dist.version)
    return {"members": len(members), "acknowledged_latest": acked, "pending": len(members) - acked}


def my_ack_version(db: Session, dist: OrgDistribution, user: User) -> Optional[int]:
    rows = db.query(OrgDistributionAck.version).filter(
        OrgDistributionAck.distribution_id == dist.id, OrgDistributionAck.user_id == user.id).all()
    return max((r[0] for r in rows), default=None)


def fork(db: Session, dist: OrgDistribution, user: User) -> TravelPlan:
    """配布版の写しからメンバー自身の旅行を作る(元の旅行・組織とは結び付けない)。"""
    snap = dist.snapshot or {}

    def parse(v):
        try:
            return datetime.fromisoformat(v) if v else None
        except (TypeError, ValueError):
            return None

    plan = TravelPlan(
        user_id=user.id, title=str(snap.get("title") or dist.title)[:200],
        description=snap.get("description"), destination=snap.get("destination"),
        start_date=parse(snap.get("start_date")), end_date=parse(snap.get("end_date")), status="draft",
    )
    db.add(plan)
    db.flush()
    from datetime import date as _date
    for i, d in enumerate(snap.get("days", [])):
        try:
            local = _date.fromisoformat(d["date"])
        except (KeyError, TypeError, ValueError):
            continue
        day = TravelDay(plan_id=plan.id, local_date=local, timezone_id=d.get("timezone_id") or "UTC",
                        title=d.get("title"), sort_order=i)
        db.add(day)
        db.flush()
        for j, e in enumerate(d.get("events", [])):
            db.add(TravelEvent(plan_id=plan.id, day_id=day.id, title=str(e.get("title") or "予定")[:200],
                               event_type=e.get("event_type") or "activity",
                               local_start_time=e.get("local_start_time"), is_all_day=bool(e.get("is_all_day")),
                               sort_order=j))
    return plan


def on_user_deleted(db: Session, user_id) -> int:
    """[FR-039] 退会: 組織の所属と確認を外す。最後の owner が抜けた組織は、最も古い admin を owner にする。
    admin もいなければ組織を閉じ、外部連携(API クライアント・Webhook)を止める。戻り値は外した所属の数。"""
    rows = db.query(OrganizationMember).filter(OrganizationMember.user_id == user_id).all()
    org_ids = {m.organization_id for m in rows}
    for m in rows:
        db.delete(m)
    db.query(OrgDistributionAck).filter(OrgDistributionAck.user_id == user_id).delete(synchronize_session=False)
    db.flush()
    t = now()
    for org_id in org_ids:
        if owner_count(db, org_id):
            continue
        admin = (db.query(OrganizationMember)
                 .filter(OrganizationMember.organization_id == org_id, OrganizationMember.role == "admin")
                 .order_by(OrganizationMember.created_at.asc()).first())
        if admin:
            admin.role = "owner"
            continue
        org = db.query(Organization).filter(Organization.id == org_id).first()
        if org and org.deleted_at is None:
            org.deleted_at = t
        db.query(OrgApiClient).filter(OrgApiClient.organization_id == org_id, OrgApiClient.revoked_at.is_(None)) \
            .update({OrgApiClient.revoked_at: t}, synchronize_session=False)
        db.query(OrgWebhook).filter(OrgWebhook.organization_id == org_id, OrgWebhook.revoked_at.is_(None)) \
            .update({OrgWebhook.revoked_at: t}, synchronize_session=False)
    return len(rows)


def new_id() -> uuid.UUID:
    return uuid.uuid4()
