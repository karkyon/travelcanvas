"""
[Gate P9] FR-039 アカウント単位の削除(DOC-11 §15 Deletion「workflow、共有即失効、backup期限説明」)。

方針(共同旅行には他者のデータがあるため、境界を明示する。詳細は docs/adr/ADR-account-deletion.md):
- 所有する旅行: 論理削除(B-012 soft_delete_plan)。共有リンクは即時失効し、参加者もすぐに見られなくなる。
  猶予期間(PLAN_DELETE_GRACE_DAYS)後に既存の完全削除バッチで子データ・文書ファイルごと消える。
- 参加している旅行: 参加(共同編集者の行)を外し、本人だけの情報を消す
  (個人の持ち物・秘匿の条件・個人予算・本人がアップロードした文書・本人の旅の記録(P12、写真・音声のファイルを含む)・
  本人の同期の受領記録(P11))。担当の割当は外す。
- 位置の軌跡(P13): 本人だけの記録のため、所有する旅行の分も含めてすぐ消す。
  コメント・支出・投票・変更履歴は同行者の記録として残し、名前は「退会済み-xxxxxxxx」と表示される。
- 本人だけのデータ: セッション(IP・端末情報を含む)、通知、お気に入り・訪問記録、冪等性記録、
  本人宛ての招待(メールアドレスを含む)を削除する。
- アカウント行: 外部キーで参照されるため行は残し、メール・パスワード・設定を消して無効化し、
  名前を復元できない仮名にする(同じメールで新しく登録できる)。
- 監査ログは削除の事実と件数だけを記録し、題名・メールは記録しない(監査の保持期間は retention で説明)。

[Gate G7] 猶予つきの削除(登録した会員だけ。ゲストは「今すぐ」だけ):
- 申し込むと deletion_due_at(既定14日後、ACCOUNT_DELETE_GRACE_DAYS)を記録する。その間はいつも通り使え、取り消せる
- 時刻を過ぎたら定期の処理(tcops.py jobs account-deletions、毎日)が delete_account で削除する。管理者になっていたら
  削除せずに申し込みを残し、件数で知らせる(管理者の権限を外すまで削除しない)
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, cast

from sqlalchemy.orm import Session

from app.models.models import (
    Budget, Comment, Document, DocumentPurgeStatus, Expense, IdempotencyRecord, LocationTrack, Memory, Notification,
    PackingItem,
    PlanCollaborator, PlanConstraint, Poll, PreparationTask, SyncOperation, TravelPlan, User, UserSession,
    UserSpotFavorite, UserSpotVisit, Vote,
)
from app.services import plan_deletion
from app.services.plan_item_deletion import detach_collaborator_references
from app.services.storage_backend import get_storage_backend

CONFIRMATION_TEXT = "退会する"
DELETED_NAME_PREFIX = "退会済み-"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def deleted_name(user_id: uuid.UUID) -> str:
    return f"{DELETED_NAME_PREFIX}{user_id.hex[:8]}"


def requires_password(user: User) -> bool:
    return bool(user.hashed_password) and user.user_type != "guest"


def _owned_plans(db: Session, user: User) -> List[TravelPlan]:
    return (db.query(TravelPlan)
            .filter(TravelPlan.user_id == user.id, TravelPlan.deleted_at.is_(None))
            .order_by(TravelPlan.created_at).all())


def _memberships(db: Session, user: User) -> List[PlanCollaborator]:
    q = db.query(PlanCollaborator).filter(PlanCollaborator.user_id == user.id)
    rows = {c.id: c for c in q.all()}
    if user.email:
        for c in db.query(PlanCollaborator).filter(PlanCollaborator.email == user.email).all():
            rows[c.id] = c
    return list(rows.values())


def _member_plan_ids(memberships: List[PlanCollaborator], owned_ids: set) -> set:
    return {c.plan_id for c in memberships if c.status == "accepted" and c.plan_id not in owned_ids}


def _others_plan_filter(column, owned_ids: set):
    return ~column.in_(owned_ids) if owned_ids else True


def preview(db: Session, user: User) -> Dict[str, Any]:
    """削除で何が起きるかの説明(DBは変えない)。"""
    owned = _owned_plans(db, user)
    owned_ids = {p.id for p in owned}
    memberships = _memberships(db, user)
    member_plans = _member_plan_ids(memberships, owned_ids)
    members_by_plan: Dict[uuid.UUID, int] = {}
    for c in db.query(PlanCollaborator).filter(PlanCollaborator.plan_id.in_(owned_ids),
                                               PlanCollaborator.status == "accepted").all() if owned_ids else []:
        members_by_plan[c.plan_id] = members_by_plan.get(c.plan_id, 0) + 1
    me = user.id

    def count(q) -> int:
        return int(q.count())

    others = {
        "personal_packing_items": count(db.query(PackingItem).filter(
            PackingItem.owner_user_id == me, PackingItem.scope == "personal",
            _others_plan_filter(PackingItem.plan_id, owned_ids))),
        "private_constraints": count(db.query(PlanConstraint).filter(
            PlanConstraint.owner_user_id == me, PlanConstraint.privacy_level == "private",
            _others_plan_filter(PlanConstraint.plan_id, owned_ids))),
        "member_budgets": count(db.query(Budget).filter(
            Budget.kind == "member", Budget.member_user_id == me, _others_plan_filter(Budget.plan_id, owned_ids))),
        "documents": count(db.query(Document).filter(
            Document.owner_user_id == me, Document.deleted_at.is_(None),
            _others_plan_filter(Document.plan_id, owned_ids))),
        "memories": count(db.query(Memory).filter(
            Memory.author_user_id == me, _others_plan_filter(Memory.plan_id, owned_ids))),
        "location_tracks": count(db.query(LocationTrack).filter(
            LocationTrack.user_id == me, _others_plan_filter(LocationTrack.plan_id, owned_ids))),
    }
    kept = {
        "comments": count(db.query(Comment).filter(Comment.author_user_id == me, Comment.deleted_at.is_(None),
                                                   _others_plan_filter(Comment.plan_id, owned_ids))),
        "expenses": count(db.query(Expense).filter(Expense.created_by_user_id == me,
                                                   _others_plan_filter(Expense.plan_id, owned_ids))),
        "votes": count(db.query(Vote).filter(Vote.user_id == me, Vote.poll_id.in_(
            db.query(Poll.id).filter(_others_plan_filter(Poll.plan_id, owned_ids))))),
    }
    return {
        "account_type": "guest" if user.user_type == "guest" else "registered",
        "requires_password": requires_password(user),
        "confirmation_text": CONFIRMATION_TEXT,
        "owned_plans": [{"id": str(p.id), "title": p.title, "member_count": members_by_plan.get(p.id, 0)}
                        for p in owned],
        "member_plan_count": len(member_plans),
        "deleted_in_member_plans": others,
        "kept_in_member_plans": kept,
        "plan_delete_grace_days": preview_grace_days(),
        # [Gate G7] 猶予つきの削除
        "account_delete_grace_days": account_grace_days(),
        "can_schedule": can_schedule(user),
        "scheduled": schedule_view(user),
    }


def _delete_document_file(doc: Document, now: datetime) -> bool:
    doc.deleted_at = doc.deleted_at or now
    try:
        get_storage_backend().delete(doc.storage_key)
        doc.purge_status = DocumentPurgeStatus.PURGED.value
        return True
    except Exception:  # noqa: BLE001 - 失敗は保留にして既存の文書purgeバッチで再試行する
        doc.purge_status = DocumentPurgeStatus.PENDING.value
        return False


def delete_account(db: Session, user: User, now: Optional[datetime] = None) -> Dict[str, int]:
    """アカウントを削除する。呼出側で本人確認を済ませ、commitする。戻り値は件数の要約(監査用)。"""
    now = now or _now()
    me = user.id
    summary: Dict[str, int] = {}

    owned = _owned_plans(db, user)
    owned_ids = {p.id for p in owned}
    revoked = 0
    for p in owned:
        revoked += plan_deletion.soft_delete_plan(db, p, me, now=now)
    summary["owned_plans"] = len(owned)
    summary["share_links_revoked"] = revoked

    memberships = _memberships(db, user)
    summary["member_plans"] = len(_member_plan_ids(memberships, owned_ids))
    for c in memberships:
        detach_collaborator_references(db, c.id)
        db.delete(c)
    summary["memberships_removed"] = len(memberships)
    db.flush()

    others_pk = _others_plan_filter(PackingItem.plan_id, owned_ids)
    summary["personal_packing_items"] = db.query(PackingItem).filter(
        PackingItem.owner_user_id == me, PackingItem.scope == "personal", others_pk,
    ).delete(synchronize_session=False)
    db.query(PackingItem).filter(PackingItem.assignee_user_id == me).update(
        {PackingItem.assignee_user_id: None}, synchronize_session=False)
    db.query(PreparationTask).filter(PreparationTask.assignee_user_id == me).update(
        {PreparationTask.assignee_user_id: None}, synchronize_session=False)
    private = db.query(PlanConstraint).filter(
        PlanConstraint.owner_user_id == me, PlanConstraint.privacy_level == "private",
        _others_plan_filter(PlanConstraint.plan_id, owned_ids)).all()
    for c in private:
        db.delete(c)
    summary["private_constraints"] = len(private)
    summary["member_budgets"] = db.query(Budget).filter(
        Budget.kind == "member", Budget.member_user_id == me, _others_plan_filter(Budget.plan_id, owned_ids),
    ).delete(synchronize_session=False)
    docs = db.query(Document).filter(
        Document.owner_user_id == me, Document.deleted_at.is_(None),
        _others_plan_filter(Document.plan_id, owned_ids)).all()
    pending = sum(0 if _delete_document_file(d, now) else 1 for d in docs)
    summary["documents"] = len(docs)
    summary["documents_pending_purge"] = pending
    # [Gate P12] 参加している旅行に本人が残した旅の記録(写真・音声のファイルを含む)。
    # 所有する旅行の記録は、旅行の完全削除でまとめて消える(plan_deletion)。
    mems = db.query(Memory).filter(Memory.author_user_id == me, _others_plan_filter(Memory.plan_id, owned_ids)).all()
    for mm in mems:
        if mm.storage_key:
            try:
                get_storage_backend().delete(mm.storage_key)
            except Exception:  # noqa: BLE001 - 行は消す。ファイルは保存先の掃除で消える(ADR-memories.md)
                pass
        db.delete(mm)
    summary["memories"] = len(mems)
    # [Gate P13] 位置の軌跡は本人だけのもの。所有する旅行の分も含めてすぐ消す(点は外部キーの連鎖で消える)
    summary["location_tracks"] = db.query(LocationTrack).filter(LocationTrack.user_id == me).delete(
        synchronize_session=False)
    # [Gate L5] 旅行ごとの位置の扱い(区画は軌跡の削除で連鎖して消える)
    from app.models.models import TripLocationSetting

    db.query(TripLocationSetting).filter(TripLocationSetting.user_id == me).delete(synchronize_session=False)
    # [Gate V2] 訪問の判定(本人だけのもの。所有する旅行の分も含めてすぐ消す)
    from app.models.models import VisitAssessment

    db.query(VisitAssessment).filter(VisitAssessment.user_id == me).delete(synchronize_session=False)
    # [Gate P11] 同期の受領記録は端末から送った予定の内容を含むため、本人の分を消す
    summary["sync_operations"] = db.query(SyncOperation).filter(SyncOperation.user_id == me).delete(
        synchronize_session=False)

    summary["notifications"] = db.query(Notification).filter(Notification.user_id == me).delete(
        synchronize_session=False)
    summary["spot_favorites"] = db.query(UserSpotFavorite).filter(UserSpotFavorite.user_id == me).delete(
        synchronize_session=False)
    summary["spot_visits"] = db.query(UserSpotVisit).filter(UserSpotVisit.user_id == me).delete(
        synchronize_session=False)
    db.query(IdempotencyRecord).filter(IdempotencyRecord.user_id == me).delete(synchronize_session=False)
    # [Gate C1] 秘匿プロフィール・適用の記録・プロフィールから作った秘匿制約
    from app.services import private_profile as _pp

    _pp.delete_for_user(db, me)
    # [Gate B1] 組織の所属・閲覧確認(最後の owner なら admin を owner にし、誰もいなければ組織と外部連携を止める)
    from app.services import organizations as _orgs

    summary["organization_memberships"] = _orgs.on_user_deleted(db, me)
    # [Gate S11] 多要素認証の秘密・回復コード(件数は応答に含めない。設定の有無も残さない)
    from app.models.models import UserMfa

    db.query(UserMfa).filter(UserMfa.user_id == me).delete(synchronize_session=False)
    # [Gate G3] SEC-F5 利用者のデータ鍵(秘匿プロフィール・位置の軌跡)を破棄する。所有する旅行の鍵は、旅行の完全削除で破棄する
    from app.services import data_keys

    summary["data_keys_destroyed"] = data_keys.destroy(db, "user", me, "account_deletion")
    summary["sessions"] = db.query(UserSession).filter(UserSession.user_id == me).delete(
        synchronize_session=False)
    # [Gate G4] 検索のコマンドの記録(入力した予定の名前を含む)・通知の設定・送信待ちのメール(宛先は本人)
    from app.models.models import CommandRun, EmailOutbox, NotificationPreference

    db.query(CommandRun).filter(CommandRun.user_id == me).delete(synchronize_session=False)
    db.query(NotificationPreference).filter(NotificationPreference.user_id == me).delete(synchronize_session=False)
    summary["email_outbox"] = db.query(EmailOutbox).filter(EmailOutbox.user_id == me).delete(
        synchronize_session=False)
    # [Gate G6] オフライン保存の端末・守る範囲・公開した旅行記(失効させて写しを消す)・消して元に戻せる間の記録
    from app.models.models import MemoryPublication, MemoryTrash, OfflineDevice, PrivacyZone

    db.query(OfflineDevice).filter(OfflineDevice.user_id == me).delete(synchronize_session=False)
    db.query(PrivacyZone).filter(PrivacyZone.user_id == me).delete(synchronize_session=False)
    summary["journal_publications"] = db.query(MemoryPublication).filter(MemoryPublication.user_id == me).delete(
        synchronize_session=False)
    trash_files: List[Any] = [t.storage_key for t in db.query(MemoryTrash).filter(
        (MemoryTrash.deleted_by_user_id == me) | (MemoryTrash.author_user_id == me)).all() if t.storage_key]
    db.query(MemoryTrash).filter((MemoryTrash.deleted_by_user_id == me) | (MemoryTrash.author_user_id == me)).delete(
        synchronize_session=False)
    for key in trash_files:
        try:
            get_storage_backend().delete(key)
        except (OSError, ValueError):
            pass
    # [Gate G5] BILL-02 本人の使用量の記録
    from app.models.models import UsageCounter

    db.query(UsageCounter).filter(UsageCounter.subject_type == "user", UsageCounter.subject_id == me).delete(
        synchronize_session=False)

    user.username = deleted_name(me)
    user.email = None
    user.hashed_password = None
    user.preferences = None
    user.is_active = False
    user.is_verified = False
    user.is_superuser = False
    user.role = "user"
    _clear_schedule(user)  # [Gate G7] 申し込みの印も消す(削除は済んだ)
    db.flush()
    return summary


def preview_grace_days() -> int:
    return int(plan_deletion.grace_period().days)


# ===================================================================== [Gate G7] 猶予つきの削除

def account_grace_days() -> int:
    from app.core.config import settings

    return max(1, int(settings.ACCOUNT_DELETE_GRACE_DAYS))


def _clear_schedule(user: User) -> None:
    row: Any = user  # ORM の行の列へ値を入れる
    row.deletion_requested_at = None
    row.deletion_due_at = None


def can_schedule(user: User) -> bool:
    return bool(user.user_type != "guest") and bool(user.hashed_password)


def schedule_view(user: User) -> Optional[Dict[str, Any]]:
    if user.deletion_due_at is None:
        return None
    return {"requested_at": user.deletion_requested_at.isoformat() if user.deletion_requested_at else None,
            "due_at": user.deletion_due_at.isoformat()}


def schedule(db: Session, user: User, now: Optional[datetime] = None) -> datetime:
    """削除を申し込む(呼出側で本人確認・commit)。既に申し込んでいれば、その時刻のまま。"""
    now = now or _now()
    row: Any = user
    if row.deletion_due_at is None:
        row.deletion_requested_at = now
        row.deletion_due_at = now + timedelta(days=account_grace_days())
        db.flush()
    return cast(datetime, row.deletion_due_at)


def cancel(db: Session, user: User) -> bool:
    if user.deletion_due_at is None:
        return False
    _clear_schedule(user)
    db.flush()
    return True


def is_admin(user: User) -> bool:
    return bool(user.is_superuser or user.role == "admin" or str(user.user_type or "") in ("admin", "super_admin"))


def run_due(db: Session, now: Optional[datetime] = None, limit: int = 50) -> Dict[str, int]:
    """猶予を過ぎた申し込みを削除する(1件ずつ commit。失敗は件数に数えて次へ)。監査には件数だけを残す。"""
    from app.services.audit_service import record_audit_event

    now = now or _now()
    counts = {"deleted": 0, "skipped_admin": 0, "failed": 0}
    ids = [r[0] for r in db.query(User.id).filter(User.deletion_due_at.isnot(None), User.deletion_due_at <= now,
                                                  User.is_active.is_(True)).order_by(User.deletion_due_at)
           .limit(limit).all()]
    for uid in ids:
        user = db.query(User).filter(User.id == uid).first()
        if user is None:
            continue
        if is_admin(user):
            counts["skipped_admin"] += 1
            continue
        try:
            summary = delete_account(db, user, now=now)
            db.commit()
        except Exception:  # noqa: BLE001 - 1人の失敗で他の人の削除を止めない(次の実行で再試行)
            db.rollback()
            counts["failed"] += 1
            continue
        counts["deleted"] += 1
        record_audit_event(action="account_deleted", resource_type="user", user_id=uid, resource_id=uid,
                           details={"summary": summary, "reason": "scheduled"})
    return counts
