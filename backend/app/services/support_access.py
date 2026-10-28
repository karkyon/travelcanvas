"""[Gate G2] FR-040 サポート閲覧(docs/adr/ADR-support-access.md)。

DOC-02 FR-040「サポート閲覧は本人の同意・目的・時間制限つき」、DOC-11「管理者の閲覧も監査」、監査の実行台帳 ADM-01。

- 許可は利用者本人だけが作る(管理者は作れない)。パスワードで本人確認する。目的(200文字まで)・期限(1〜72時間、既定24)・
  対象(1つの旅行。指定しなければアカウントの概要と旅行の一覧)。本人はいつでも取り消せる。期限が来たら自動で失効する。
- 管理者は多要素認証を通した上で、有効な許可だけを見られる。自分が作った許可は見られない(自分のデータを管理者の画面で
  見る抜け道にしない)。見られるのは読み取り専用の投影だけ:
  - 旅行: 題名・目的地・期間・状態・日程(日付・見出し)・予定(題名・時刻・種類・住所の有無・メモの有無)・
    予約(種類・施設名・状態・日時。予約番号は全て伏せる)・文書の件数(分類ごと)・参加者の数
  - 出さない: 住所・メモの本文・座標・予約番号・PIN・予約者名・連絡先・文書の中身とファイル名・位置の軌跡・費用・
    秘匿制約・記録(写真・メモ)
- 閲覧のたびに監査(support_grant_accessed: 許可・管理者・本人の ID だけ)と本人への知らせ。回数と最後の閲覧を許可に残す。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import (
    Document, Notification, PlanCollaborator, Reservation, SupportGrant, TravelDay, TravelEvent, TravelPlan, User,
)

MIN_HOURS = 1
MAX_HOURS = 72
DEFAULT_HOURS = 24
MAX_ACTIVE_PER_USER = 5
PURPOSE_MAX = 200
TICKET_MAX = 40


class SupportError(ValueError):
    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(v) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat()
    return v.isoformat()


def is_active(g: SupportGrant, at: Optional[datetime] = None) -> bool:
    return g.revoked_at is None and g.expires_at > (at or now())


def state(g: SupportGrant, at: Optional[datetime] = None) -> str:
    if g.revoked_at is not None:
        return "revoked"
    return "active" if g.expires_at > (at or now()) else "expired"


def clean_input(payload: Dict[str, Any]) -> Dict[str, Any]:
    purpose = payload.get("purpose")
    if not isinstance(purpose, str) or not purpose.strip() or len(purpose.strip()) > PURPOSE_MAX:
        raise SupportError("invalid_purpose", f"サポートに見てもらう目的を{PURPOSE_MAX}文字までで入力してください")
    hours = payload.get("hours", DEFAULT_HOURS)
    if isinstance(hours, bool) or not isinstance(hours, int) or not (MIN_HOURS <= hours <= MAX_HOURS):
        raise SupportError("invalid_hours", f"期間は{MIN_HOURS}〜{MAX_HOURS}時間の整数で指定してください")
    ticket = payload.get("ticket_ref")
    if ticket is not None and (not isinstance(ticket, str) or len(ticket) > TICKET_MAX
                               or any(ord(c) < 32 for c in ticket)):
        raise SupportError("invalid_ticket_ref", f"問い合わせ番号は{TICKET_MAX}文字までです")
    plan_id = payload.get("plan_id")
    if plan_id is not None:
        try:
            plan_id = uuid.UUID(str(plan_id))
        except ValueError:
            raise SupportError("invalid_plan", "旅行を選び直してください")
    return {"purpose": purpose.strip(), "hours": hours, "ticket_ref": (ticket or "").strip() or None,
            "plan_id": plan_id}


def create(db: Session, user: User, data: Dict[str, Any]) -> SupportGrant:
    if data["plan_id"] is not None:
        plan = db.query(TravelPlan).filter(TravelPlan.id == data["plan_id"], TravelPlan.user_id == user.id,
                                           TravelPlan.deleted_at.is_(None)).first()
        if plan is None:
            # 自分が所有する旅行だけ(共同編集者として参加している他人の旅行は、所有者の同意が無いため不可)
            raise SupportError("plan_not_found", "自分が所有する旅行を選んでください", 404)
    active = db.query(SupportGrant).filter(SupportGrant.user_id == user.id, SupportGrant.revoked_at.is_(None),
                                           SupportGrant.expires_at > now()).count()
    if active >= MAX_ACTIVE_PER_USER:
        raise SupportError("too_many_grants", f"有効な許可は{MAX_ACTIVE_PER_USER}件までです。古い許可を取り消してください", 409)
    g = SupportGrant(id=uuid.uuid4(), user_id=user.id, plan_id=data["plan_id"], purpose=data["purpose"],
                     ticket_ref=data["ticket_ref"], expires_at=now() + timedelta(hours=data["hours"]))
    db.add(g)
    db.flush()
    return g


def owner_view(db: Session, g: SupportGrant) -> Dict[str, Any]:
    title = None
    if g.plan_id:
        title = db.query(TravelPlan.title).filter(TravelPlan.id == g.plan_id).scalar()
    return {"id": str(g.id), "plan_id": str(g.plan_id) if g.plan_id else None, "plan_title": title,
            "scope": "plan" if g.plan_id else "account", "purpose": g.purpose, "ticket_ref": g.ticket_ref,
            "created_at": _iso(g.created_at), "expires_at": _iso(g.expires_at), "revoked_at": _iso(g.revoked_at),
            "state": state(g), "access_count": int(g.access_count or 0), "last_accessed_at": _iso(g.last_accessed_at)}


def admin_list_item(db: Session, g: SupportGrant) -> Dict[str, Any]:
    u = db.query(User.username, User.user_type).filter(User.id == g.user_id).first()
    label = (u.username if u and u.username else "利用者")
    out = owner_view(db, g)
    out.pop("plan_id", None)
    out["user_label"] = label
    out["user_id"] = str(g.user_id)
    return out


def _plan_projection(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    days = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
            .order_by(TravelDay.sort_order, TravelDay.local_date).all())
    events = (db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id)
              .order_by(TravelEvent.sort_order, TravelEvent.local_start_time).all())
    by_day: Dict[str, List[Dict[str, Any]]] = {}
    for e in events:
        by_day.setdefault(str(e.day_id), []).append({
            "id": str(e.id), "title": e.title, "event_type": e.event_type, "local_start_time": e.local_start_time,
            "is_all_day": bool(e.is_all_day), "locked": bool(e.locked),
            # 住所・メモ・座標の値は出さない(有無だけ)
            "has_address": bool(e.address), "has_notes": bool(e.description),
            "has_location": e.latitude is not None and e.longitude is not None,
        })
    reservations = [{
        "id": str(r.id), "type": r.type, "status": r.status, "provider_name": r.provider_name,
        "start_at": _iso(r.start_at), "end_at": _iso(r.end_at),
        "confirmation_number": "伏せています" if (r.confirmation_number_ciphertext or r.confirmation_number_masked)
        else None,
    } for r in db.query(Reservation).filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None))
       .order_by(Reservation.start_at).all()]
    docs: Dict[str, int] = {str(k): int(n) for k, n in db.query(Document.classification, func.count(Document.id))
                            .filter(Document.plan_id == plan.id, Document.deleted_at.is_(None))
                            .group_by(Document.classification).all()}
    members = db.query(func.count(PlanCollaborator.id)).filter(PlanCollaborator.plan_id == plan.id,
                                                               PlanCollaborator.status == "accepted").scalar()
    return {
        "id": str(plan.id), "title": plan.title, "destination": plan.destination, "status": plan.status,
        "start_date": _iso(plan.start_date), "end_date": _iso(plan.end_date), "revision": plan.revision,
        "deleted": plan.deleted_at is not None,
        "days": [{"id": str(d.id), "local_date": _iso(d.local_date), "title": d.title, "timezone_id": d.timezone_id,
                  "events": by_day.get(str(d.id), [])} for d in days],
        "reservations": reservations,
        "documents_by_classification": {str(k): int(v) for k, v in docs.items()},
        "collaborators": int(members or 0),
    }


def admin_view(db: Session, g: SupportGrant, admin: User) -> Dict[str, Any]:
    """有効な許可の対象を、読み取り専用の投影で返す(記録と本人への知らせは呼び出し側の record_access)。"""
    if str(g.user_id) == str(admin.id):
        raise SupportError("own_grant", "自分が作った許可は管理者の画面では見られません", 403)
    if not is_active(g):
        raise SupportError("grant_inactive", "この許可は取り消されたか、期限が切れています", 404)
    user = db.query(User).filter(User.id == g.user_id).first()
    if user is None:
        raise SupportError("grant_inactive", "この許可は取り消されたか、期限が切れています", 404)
    out: Dict[str, Any] = {"grant": admin_list_item(db, g), "read_only": True}
    if g.plan_id:
        plan = db.query(TravelPlan).filter(TravelPlan.id == g.plan_id).first()
        if plan is None:
            raise SupportError("grant_inactive", "対象の旅行がありません", 404)
        out["plan"] = _plan_projection(db, plan)
    else:
        plans = (db.query(TravelPlan).filter(TravelPlan.user_id == user.id).order_by(TravelPlan.created_at.desc())
                 .limit(50).all())
        out["account"] = {
            "username": user.username, "user_type": str(getattr(user.user_type, "value", user.user_type) or ""),
            "is_active": bool(user.is_active), "created_at": _iso(user.created_at),
            "plans": [{"id": str(p.id), "title": p.title, "status": p.status, "start_date": _iso(p.start_date),
                       "end_date": _iso(p.end_date), "deleted": p.deleted_at is not None,
                       "days": db.query(func.count(TravelDay.id)).filter(TravelDay.plan_id == p.id).scalar() or 0,
                       "events": db.query(func.count(TravelEvent.id)).filter(TravelEvent.plan_id == p.id).scalar()
                       or 0} for p in plans],
        }
    return out


def record_access(db: Session, g: SupportGrant, admin: User) -> None:
    g.access_count = int(g.access_count or 0) + 1
    g.last_accessed_at = now()
    g.last_accessed_by = admin.id
    db.add(Notification(user_id=g.user_id, type="support_access", title="サポートがあなたの情報を閲覧しました",
                        message="許可した目的「%s」のため、サポートの担当者が読み取り専用で閲覧しました。"
                                "心当たりが無い場合は設定 → サポートへの閲覧の許可 から取り消してください。"
                                % g.purpose[:80],
                        related_plan_id=g.plan_id))
