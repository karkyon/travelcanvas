"""
[Gate P11] FR-033 オフライン編集・同期(DOC-06 §13・§30、DOC-07 RB-008)。

エンドポイント(すべて /plans/{plan_id} 配下、editor以上):
- POST /sync                                  : 端末に溜めた操作(予定の作成・変更・削除)を送られた順に処理する。
    操作ごとに applied / already_applied / conflicted / rejected を返す(一部成功をまとめて200で隠さない)。
    同じ operation_id の再送は記録した結果を返す。端末で作った予定の仮のID(temp_id)は、作成の適用後に本当のIDへ対応付ける。
- GET  /sync/conflicts                        : 自分の未解決の競合(端末の値・サーバーの今の値)
- POST /sync/conflicts/{operation_id}/resolve : keep_server(サーバーの内容を残す) / use_mine(自分の変更を使う。If-Match: 本案のrevision)

適用した操作は1件ずつ変更セット(source=sync)として記録し、本案の「元に戻す」で取り消せる。
監査には件数だけを記録する(予定名などの内容は残さない)。

[Gate G6] OFF-02 対象: event(予定)・day(日程の作成・名前とメモ・空の日程の削除)・order(日程の中の予定の並び)・
reservation(常に online_required で断る。予約番号・チケット等の機密はオンラインで本人確認の後に変える)。
同じ送信の中では仮のIDの依存の順に処理し(app/services/sync.dependency_order)、結果は送られた順で返す。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.api.v1 import branches as branches_api
from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.services import member_policy
from app.models.models import ChangeItem, ChangeSet, SyncOperation, TravelDay, TravelEvent, TravelPlan, User
from datetime import date as date_cls
from app.services import sync as sy
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["sync"])


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


class OperationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str
    entity_type: str = "event"
    action: str
    entity_id: Optional[str] = Field(None, max_length=64)
    temp_id: Optional[str] = Field(None, max_length=64)
    base_revision: Optional[int] = Field(None, ge=0)
    fields: Optional[Dict[str, Any]] = None
    client_at: Optional[datetime] = None

    @field_validator("operation_id")
    @classmethod
    def _v_op(cls, v):
        if not sy.is_uuid(v):
            raise ValueError("operation_idはUUIDです")
        return str(uuid.UUID(v))

    @field_validator("entity_type")
    @classmethod
    def _v_type(cls, v):
        if v not in sy.ENTITY_ACTIONS:
            raise ValueError("entity_typeはevent/day/order/reservationです")
        return v

    @field_validator("action")
    @classmethod
    def _v_action(cls, v):
        if v not in ("create", "update", "delete", "reorder"):
            raise ValueError("actionはcreate/update/delete/reorderです")
        return v

    @model_validator(mode="after")
    def _v_pair(self):
        if self.action not in sy.ENTITY_ACTIONS[self.entity_type]:
            raise ValueError(f"{self.entity_type}の操作は{'/'.join(sy.ENTITY_ACTIONS[self.entity_type])}です")
        return self


class SyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: Optional[str] = Field(None, max_length=64)
    operations: List[OperationIn] = Field(..., max_length=sy.MAX_OPERATIONS)


class ResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resolution: str

    @field_validator("resolution")
    @classmethod
    def _v_res(cls, v):
        if v not in ("keep_server", "use_mine"):
            raise ValueError("resolutionはkeep_serverかuse_mineです")
        return v


# ===== 共通 =====

def _event(db: Session, plan: TravelPlan, event_id) -> Optional[TravelEvent]:
    return db.query(TravelEvent).filter(TravelEvent.id == event_id, TravelEvent.plan_id == plan.id).first()


def _resolve_entity(db: Session, plan: TravelPlan, user: User, ref: Optional[str],
                    entity_type: str = "event") -> Optional[uuid.UUID]:
    """予定(日程)のID、または同じ利用者が端末で作った予定(日程)の仮のID(作成の適用済み)→ 本当のID。"""
    if not ref:
        return None
    if sy.is_uuid(ref):
        return uuid.UUID(ref)
    row = (db.query(SyncOperation)
           .filter(SyncOperation.plan_id == plan.id, SyncOperation.user_id == user.id, SyncOperation.temp_id == ref,
                   SyncOperation.entity_type == entity_type, SyncOperation.action == "create",
                   SyncOperation.status == "applied")
           .order_by(SyncOperation.created_at.desc()).first())
    return row.entity_id if row is not None else None


def _value_at_base(db: Session, plan: TravelPlan, ev: TravelEvent, base_revision: int) -> Dict[str, Any]:
    """端末が編集を始めた版での予定の値(それ以降の最初の変更の「変更前」)。変更が無ければ今の値。"""
    item = (db.query(ChangeItem).join(ChangeSet, ChangeItem.change_set_id == ChangeSet.id)
            .filter(ChangeSet.plan_id == plan.id, ChangeSet.resulting_revision > base_revision,
                    ChangeItem.entity_type == "travel_event", ChangeItem.entity_id == ev.id)
            .order_by(ChangeSet.resulting_revision.asc(), ChangeItem.id.asc()).first())
    current = plans_api._event_to_dict(ev)
    if item is None or item.before_json is None:
        return current
    return item.before_json


def _apply_fields(db: Session, plan: TravelPlan, ev: TravelEvent, fields: Dict[str, Any]) -> None:
    old_time = ev.local_start_time
    old_day = db.query(TravelDay).filter(TravelDay.id == ev.day_id).first() if ev.day_id else None
    old_date = old_day.local_date if old_day is not None else None
    if "day_id" in fields:
        day = db.query(TravelDay).filter(TravelDay.id == uuid.UUID(fields["day_id"]),
                                         TravelDay.plan_id == plan.id).first()
        if day is None:
            raise sy.SyncError("day_missing", "移す先の日程がありません")
        ev.day_id = day.id
    for k in ("title", "description", "event_type", "is_all_day", "address", "latitude", "longitude"):
        if k in fields:
            setattr(ev, k, fields[k])
    if "local_start_time" in fields or "day_id" in fields:
        new_time = fields.get("local_start_time", ev.local_start_time)
        ev.local_start_time = new_time
        day = db.query(TravelDay).filter(TravelDay.id == ev.day_id).first()
        branches_api._apply_time(ev, day, new_time, old_time, old_date)


def _store(db: Session, plan: TravelPlan, user: User, device_id: Optional[str], op: OperationIn, status: str,
           code: Optional[str] = None, entity_id=None, conflict=None, resulting_revision=None,
           fields: Optional[Dict[str, Any]] = None) -> SyncOperation:
    row = SyncOperation(
        id=uuid.uuid4(), operation_id=uuid.UUID(op.operation_id), plan_id=plan.id, user_id=user.id,
        device_id=device_id, entity_type=op.entity_type, action=op.action, entity_id=entity_id, temp_id=op.temp_id,
        base_revision=op.base_revision, fields=fields, client_at=op.client_at, status=status, code=code,
        conflict=conflict, resulting_revision=resulting_revision,
    )
    db.add(row)
    db.commit()
    return row


def _row_result(row: SyncOperation, replay: bool) -> Dict[str, Any]:
    status = row.status
    if replay and status in ("applied", "resolved_mine", "resolved_server"):
        status = "already_applied"
    return sy.result_row(str(row.operation_id), status, row.code, str(row.entity_id) if row.entity_id else None,
                         row.temp_id, row.resulting_revision, row.conflict)


CODE_MESSAGES = {
    "deleted_on_server": "サーバーでは既に削除されています",
    "changed_on_server": "端末で編集を始めた後に、サーバーでも変更されています",
    "locked": "確定(ロック)された予定はオフラインでは変更できません",
    "has_relations": "予約・移動・文書と紐付いた予定はオフラインでは削除できません(オンラインで削除してください)",
    "unknown_entity": "対象の予定が見つかりません",
    "day_missing": "日程が見つかりません",
    "base_revision_required": "編集を始めた版(base_revision)が必要です",
    "no_change": "変更はありませんでした",
    "already_deleted": "既に削除されています",
    "member_field_hidden": "見せない設定の項目は変更できません(旅行の所有者に依頼してください)",
    # [Gate G6] OFF-02
    "online_required": "予約(予約番号・チケット等の機密)の変更はオフラインではできません。オンラインで本人確認の後に変えてください",
    "day_not_empty": "予定のある日程はオフラインでは削除できません(オンラインで中の予定を確かめてから削除してください)",
    "merged_existing": "同じ日付の日程が既にあるため、その日程を使いました",
    "unknown_day": "対象の日程が見つかりません",
}


def _process(db: Session, plan: TravelPlan, user: User, device_id: Optional[str], op: OperationIn,
             hidden=member_policy.EMPTY) -> Dict[str, Any]:
    existing = (db.query(SyncOperation)
                .filter(SyncOperation.user_id == user.id, SyncOperation.operation_id == uuid.UUID(op.operation_id))
                .first())
    if existing is not None:
        if existing.plan_id != plan.id:
            return sy.result_row(op.operation_id, "rejected", "operation_id_reused", message="別のプランの操作IDです")
        return _row_result(existing, replay=True)

    def reject(code: str, message: Optional[str] = None, fields=None, entity_id=None):
        row = _store(db, plan, user, device_id, op, "rejected", code, entity_id=entity_id, fields=fields)
        res = _row_result(row, replay=False)
        res["message"] = message or CODE_MESSAGES.get(code)
        return res

    if op.entity_type == "reservation":
        return reject("online_required")
    if op.entity_type == "day":
        return _process_day(db, plan, user, device_id, op, reject)
    if op.entity_type == "order":
        return _process_order(db, plan, user, device_id, op, reject)
    raw_fields = dict(op.fields or {})
    if isinstance(raw_fields.get("day_id"), str) and raw_fields["day_id"] and not sy.is_uuid(raw_fields["day_id"]):
        # [Gate G6] 同じ端末がオフラインで作った日程(仮のID)
        real_day = _resolve_entity(db, plan, user, raw_fields["day_id"], "day")
        if real_day is None:
            return reject("day_missing")
        raw_fields["day_id"] = str(real_day)
    try:
        fields = sy.clean_fields(raw_fields, op.action) if op.action != "delete" else {}
    except sy.SyncError as e:
        return reject(e.code, str(e))
    # [Gate G2] FR-045 所有者が隠した項目(予定のメモ・住所と位置)は、端末からの変更も受け付けない
    fields = member_policy.drop_unseen(hidden, fields)
    blocked = member_policy.forbidden_write_fields(hidden, fields)
    if blocked:
        return reject("member_field_hidden", "見せない設定の項目は変更できません(旅行の所有者に依頼してください)",
                      fields={k: v for k, v in fields.items() if k not in blocked})

    if op.action == "create":
        day = db.query(TravelDay).filter(TravelDay.id == uuid.UUID(fields["day_id"]),
                                         TravelDay.plan_id == plan.id).first()
        if day is None:
            return reject("day_missing", fields=fields)
        max_order = db.query(sa_func.max(TravelEvent.sort_order)).filter(TravelEvent.day_id == day.id).scalar()
        created = TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=day.id, title=fields["title"],
                              event_type=fields.get("event_type", "activity"), sort_order=(max_order or 0) + 1)
        db.add(created)
        db.flush()
        _apply_fields(db, plan, created, {k: v for k, v in fields.items() if k != "day_id"})
        db.flush()
        rev = plans_api._record_change_and_bump_revision(db, plan, user, "sync", "travel_event", created.id, "create",
                                                         None, plans_api._event_to_dict(created))
        row = _store(db, plan, user, device_id, op, "applied", entity_id=created.id, resulting_revision=rev,
                     fields=fields)
        return _row_result(row, replay=False)

    target_id = _resolve_entity(db, plan, user, op.entity_id)
    if target_id is None:
        return reject("unknown_entity", fields=fields)
    if op.base_revision is None:
        return reject("base_revision_required", fields=fields, entity_id=target_id)
    ev = _event(db, plan, target_id)

    if op.action == "update":
        if ev is None:
            conflict: Dict[str, Any] = {"fields": sorted(fields), "mine": fields, "server": None,
                                        "server_deleted": True}
            row = _store(db, plan, user, device_id, op, "conflicted", "deleted_on_server", entity_id=target_id,
                         conflict=conflict, fields=fields)
            return {**_row_result(row, replay=False), "message": CODE_MESSAGES["deleted_on_server"]}
        if ev.locked:
            return reject("locked", fields=fields, entity_id=target_id)
        at_base = sy.comparable(_value_at_base(db, plan, ev, op.base_revision))
        current = sy.comparable(plans_api._event_to_dict(ev))
        conflicts = sy.field_conflicts(at_base, current, fields)
        if conflicts:
            conflict = {"fields": conflicts, "mine": {f: fields[f] for f in conflicts},
                        "server": member_policy.mask_event_dict({f: current[f] for f in conflicts}, hidden),
                        "server_deleted": False,
                        "title": ev.title}
            row = _store(db, plan, user, device_id, op, "conflicted", "changed_on_server", entity_id=target_id,
                         conflict=conflict, fields=fields)
            return {**_row_result(row, replay=False), "message": CODE_MESSAGES["changed_on_server"]}
        changes = {f: v for f, v in fields.items() if current.get(f) != v}
        if not changes:
            row = _store(db, plan, user, device_id, op, "applied", "no_change", entity_id=target_id, fields=fields)
            return _row_result(row, replay=False)
        before = plans_api._event_to_dict(ev)
        try:
            _apply_fields(db, plan, ev, changes)
        except sy.SyncError as e:  # 日程の確認は値を変える前に行うため、ここでは何も変わっていない
            return reject(e.code, str(e), fields=fields, entity_id=target_id)
        db.flush()
        rev = plans_api._record_change_and_bump_revision(db, plan, user, "sync", "travel_event", ev.id, "update",
                                                         before, plans_api._event_to_dict(ev))
        row = _store(db, plan, user, device_id, op, "applied", entity_id=target_id, resulting_revision=rev,
                     fields=fields)
        return _row_result(row, replay=False)

    # delete
    if ev is None:
        row = _store(db, plan, user, device_id, op, "applied", "already_deleted", entity_id=target_id)
        return _row_result(row, replay=False)
    if ev.locked:
        return reject("locked", entity_id=target_id)
    if str(ev.id) in branches_api._related_event_ids(db, [ev.id]):
        return reject("has_relations", entity_id=target_id)
    at_base = sy.comparable(_value_at_base(db, plan, ev, op.base_revision))
    current = sy.comparable(plans_api._event_to_dict(ev))
    changed = sy.changed_since_base(at_base, current)
    if changed:
        conflict = {"fields": changed, "mine": None,
                    "server": member_policy.mask_event_dict({f: current[f] for f in changed}, hidden),
                    "server_deleted": False, "deleted_by_me": True, "title": ev.title}
        row = _store(db, plan, user, device_id, op, "conflicted", "changed_on_server", entity_id=target_id,
                     conflict=conflict)
        return {**_row_result(row, replay=False), "message": CODE_MESSAGES["changed_on_server"]}
    rev = _delete_event(db, plan, user, ev)
    row = _store(db, plan, user, device_id, op, "applied", entity_id=target_id, resulting_revision=rev)
    return _row_result(row, replay=False)


def _day(db: Session, plan: TravelPlan, day_id) -> Optional[TravelDay]:
    return db.query(TravelDay).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first()


def _day_at_base(db: Session, plan: TravelPlan, day: TravelDay, base_revision: int) -> Dict[str, Any]:
    item = (db.query(ChangeItem).join(ChangeSet, ChangeItem.change_set_id == ChangeSet.id)
            .filter(ChangeSet.plan_id == plan.id, ChangeSet.resulting_revision > base_revision,
                    ChangeItem.entity_type == "travel_day", ChangeItem.entity_id == day.id)
            .order_by(ChangeSet.resulting_revision.asc(), ChangeItem.id.asc()).first())
    current = plans_api._day_to_dict(day)
    if item is None or item.before_json is None:
        return current
    return cast(Dict[str, Any], item.before_json)


def _process_day(db: Session, plan: TravelPlan, user: User, device_id: Optional[str], op: OperationIn, reject):
    """[Gate G6] OFF-02 日程の作成・名前とメモの変更・空の日程の削除。"""
    try:
        fields = sy.clean_day_fields(op.fields, op.action) if op.action != "delete" else {}
    except sy.SyncError as e:
        return reject(e.code, str(e))
    if op.action == "create":
        local = date_cls.fromisoformat(fields["local_date"])
        existing = db.query(TravelDay).filter(TravelDay.plan_id == plan.id, TravelDay.local_date == local).first()
        if existing is not None:
            row = _store(db, plan, user, device_id, op, "applied", "merged_existing", entity_id=existing.id,
                         fields=fields)
            return {**_row_result(row, replay=False), "message": CODE_MESSAGES["merged_existing"]}
        count = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).count()
        day = TravelDay(id=uuid.uuid4(), plan_id=plan.id, local_date=local,
                        timezone_id=fields.get("timezone_id") or "UTC", title=fields.get("title"),
                        notes=fields.get("notes"), sort_order=count)
        db.add(day)
        db.flush()
        rev = plans_api._record_change_and_bump_revision(db, plan, user, "sync", "travel_day", day.id, "create",
                                                         None, plans_api._day_to_dict(day))
        row = _store(db, plan, user, device_id, op, "applied", entity_id=day.id, resulting_revision=rev,
                     fields=fields)
        return _row_result(row, replay=False)
    target = _resolve_entity(db, plan, user, op.entity_id, "day")
    if target is None:
        return reject("unknown_day", fields=fields)
    if op.base_revision is None:
        return reject("base_revision_required", fields=fields, entity_id=target)
    day = cast(Any, _day(db, plan, target))
    if op.action == "update":
        if day is None:
            conflict: Dict[str, Any] = {"fields": sorted(fields), "mine": fields, "server": None,
                                        "server_deleted": True}
            row = _store(db, plan, user, device_id, op, "conflicted", "deleted_on_server", entity_id=target,
                         conflict=conflict, fields=fields)
            return {**_row_result(row, replay=False), "message": CODE_MESSAGES["deleted_on_server"]}
        at_base = _day_at_base(db, plan, day, op.base_revision)
        current = plans_api._day_to_dict(day)
        conflicts = [f for f, v in fields.items() if at_base.get(f) != current.get(f) and current.get(f) != v]
        if conflicts:
            conflict = {"fields": conflicts, "mine": {f: fields[f] for f in conflicts},
                        "server": {f: current[f] for f in conflicts}, "server_deleted": False,
                        "title": day.title or current.get("local_date")}
            row = _store(db, plan, user, device_id, op, "conflicted", "changed_on_server", entity_id=target,
                         conflict=conflict, fields=fields)
            return {**_row_result(row, replay=False), "message": CODE_MESSAGES["changed_on_server"]}
        changes = {f: v for f, v in fields.items() if current.get(f) != v}
        if not changes:
            row = _store(db, plan, user, device_id, op, "applied", "no_change", entity_id=target, fields=fields)
            return _row_result(row, replay=False)
        before = plans_api._day_to_dict(day)
        for f, v in changes.items():
            setattr(day, f, v)
        db.flush()
        rev = plans_api._record_change_and_bump_revision(db, plan, user, "sync", "travel_day", day.id, "update",
                                                         before, plans_api._day_to_dict(day))
        row = _store(db, plan, user, device_id, op, "applied", entity_id=target, resulting_revision=rev,
                     fields=fields)
        return _row_result(row, replay=False)
    # delete
    if day is None:
        row = _store(db, plan, user, device_id, op, "applied", "already_deleted", entity_id=target)
        return _row_result(row, replay=False)
    if db.query(TravelEvent.id).filter(TravelEvent.day_id == day.id).first() is not None:
        return reject("day_not_empty", entity_id=target)
    at_base = _day_at_base(db, plan, day, op.base_revision)
    current = plans_api._day_to_dict(day)
    changed = [f for f in ("title", "notes") if at_base.get(f) != current.get(f)]
    if changed:
        conflict = {"fields": changed, "mine": None, "server": {f: current[f] for f in changed},
                    "server_deleted": False, "deleted_by_me": True, "title": day.title or current.get("local_date")}
        row = _store(db, plan, user, device_id, op, "conflicted", "changed_on_server", entity_id=target,
                     conflict=conflict)
        return {**_row_result(row, replay=False), "message": CODE_MESSAGES["changed_on_server"]}
    rev = _delete_day(db, plan, user, day)
    row = _store(db, plan, user, device_id, op, "applied", entity_id=target, resulting_revision=rev)
    return _row_result(row, replay=False)


def _delete_day(db: Session, plan: TravelPlan, user: User, day: TravelDay) -> int:
    before = plans_api._day_to_dict(day)
    before["_events"] = []
    did = day.id
    db.delete(day)
    db.flush()
    return plans_api._record_change_and_bump_revision(db, plan, user, "sync", "travel_day", did, "delete", before,
                                                      None)


def _day_events(db: Session, day: TravelDay) -> List[TravelEvent]:
    return (db.query(TravelEvent).filter(TravelEvent.day_id == day.id)
            .order_by(TravelEvent.sort_order.asc(), TravelEvent.id.asc()).all())


def _apply_order(db: Session, plan: TravelPlan, user: User, day: TravelDay, order: List[uuid.UUID]):
    """並びを適用する。(新しい版, None) か、断る時は (None, 理由の code)。"""
    current: List[Any] = _day_events(db, day)
    by_id: Dict[Any, Any] = {e.id: e for e in current}
    if set(order) != set(by_id):
        return None, "changed_on_server"
    if [e.id for e in current] == order:
        return plan.revision, "no_change"
    for idx, e in enumerate(current):
        if e.locked and order.index(e.id) != idx:
            return None, "locked"
    changes = []
    for idx, eid in enumerate(order):
        ev = by_id[eid]
        if ev.sort_order != idx:
            before = plans_api._event_to_dict(ev)
            ev.sort_order = idx
            changes.append(("travel_event", ev.id, "reorder", before, plans_api._event_to_dict(ev)))
    db.flush()
    if not changes:
        return plan.revision, "no_change"
    return plans_api._record_batch_change_and_bump_revision(db, plan, user, "sync", changes), None


def _process_order(db: Session, plan: TravelPlan, user: User, device_id: Optional[str], op: OperationIn, reject):
    """[Gate G6] OFF-02 日程の中の予定の並び。端末の並びとサーバーの予定の集まりが違えば競合(どちらかで足し引きがあった)。"""
    try:
        day_ref, refs = sy.clean_order(op.fields)
    except sy.SyncError as e:
        return reject(e.code, str(e))
    fields = {"day_id": day_ref, "order": refs}
    if op.base_revision is None:
        return reject("base_revision_required", fields=fields)
    day_id = _resolve_entity(db, plan, user, day_ref, "day")
    day = _day(db, plan, day_id) if day_id else None
    if day is None:
        return reject("unknown_day", fields=fields)
    order: List[uuid.UUID] = []
    for ref in refs:
        rid = _resolve_entity(db, plan, user, ref, "event")
        if rid is None:
            return reject("unknown_entity", fields=fields, entity_id=day.id)
        order.append(rid)
    fields = {"day_id": str(day.id), "order": [str(x) for x in order]}
    rev, code = _apply_order(db, plan, user, day, order)
    if code in ("changed_on_server",):
        server = [{"id": str(e.id), "title": e.title} for e in _day_events(db, day)]
        conflict = {"fields": ["order"], "mine": {"order": fields["order"]}, "server": {"order": server},
                    "server_deleted": False, "title": day.title or day.local_date.isoformat()}
        row = _store(db, plan, user, device_id, op, "conflicted", code, entity_id=day.id, conflict=conflict,
                     fields=fields)
        return {**_row_result(row, replay=False), "message": CODE_MESSAGES[code]}
    if code == "locked":
        return reject("locked", fields=fields, entity_id=day.id)
    row = _store(db, plan, user, device_id, op, "applied", code, entity_id=day.id, resulting_revision=rev,
                 fields=fields)
    return _row_result(row, replay=False)


def _delete_event(db: Session, plan: TravelPlan, user: User, ev: TravelEvent) -> int:
    before = plans_api._event_to_dict(ev)
    eid = ev.id
    db.delete(ev)
    db.flush()
    return plans_api._record_change_and_bump_revision(db, plan, user, "sync", "travel_event", eid, "delete", before,
                                                      None)


def _audit(action: str, request: Request, user: User, plan: TravelPlan, details: Dict[str, Any]) -> None:
    record_audit_event(
        action=action, resource_type="travel_plan", user_id=user.id, resource_id=plan.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255], details=details,
    )


# ===== エンドポイント =====

@router.post("/{plan_id}/sync", response_model=dict)
def sync_operations(plan_id: str, payload: SyncRequest, request: Request, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)):
    plan, _role, hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    ids = [op.operation_id for op in payload.operations]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="同じoperation_idが重複しています")
    # [Gate G6] 仮のIDの依存の順に処理し、結果は送られた順で返す
    order = sy.dependency_order([op.model_dump() for op in payload.operations])
    by_index: Dict[int, Dict[str, Any]] = {}
    for i in order:
        by_index[i] = _process(db, plan, current_user, payload.device_id, payload.operations[i], hidden)
    results = [by_index[i] for i in range(len(payload.operations))]
    db.refresh(plan)
    applied, replayed, conflicted, rejected = sy.summarize(results)
    _audit("sync_received", request, current_user, plan,
           {"operations": len(results), "applied": applied, "already_applied": replayed, "conflicted": conflicted,
            "rejected": rejected})
    return {
        "plan_id": str(plan.id), "plan_revision": plan.revision, "results": results,
        "summary": {"applied": applied, "already_applied": replayed, "conflicted": conflicted, "rejected": rejected},
        "pack_refresh_required": applied > 0 or conflicted > 0,
    }


@router.get("/{plan_id}/sync/conflicts", response_model=dict)
def list_conflicts(plan_id: str, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    rows = (db.query(SyncOperation)
            .filter(SyncOperation.plan_id == plan.id, SyncOperation.user_id == current_user.id,
                    SyncOperation.status == "conflicted")
            .order_by(SyncOperation.created_at.asc()).all())
    out = []
    r: Any
    for r in rows:
        if r.entity_type in ("day", "order"):
            day = _day(db, plan, r.entity_id) if r.entity_id else None
            out.append({
                "operation_id": str(r.operation_id), "action": r.action, "entity_type": r.entity_type,
                "code": r.code, "message": CODE_MESSAGES.get(r.code),
                "entity_id": str(r.entity_id) if r.entity_id else None,
                "title": (r.conflict or {}).get("title") or (day.title if day else None),
                "conflict": r.conflict,
                "current": plans_api._day_to_dict(day) if day is not None else None,
                "server_deleted": day is None, "created_at": _iso(r.created_at),
            })
            continue
        ev = _event(db, plan, r.entity_id) if r.entity_id else None
        current = member_policy.mask_event_dict(sy.comparable(plans_api._event_to_dict(ev)), hidden) \
            if ev is not None else None
        out.append({
            "operation_id": str(r.operation_id), "action": r.action, "entity_type": r.entity_type, "code": r.code,
            "message": CODE_MESSAGES.get(r.code), "entity_id": str(r.entity_id) if r.entity_id else None,
            "title": ev.title if ev is not None else (r.conflict or {}).get("title") or (r.fields or {}).get("title"),
            "conflict": r.conflict, "current": current, "server_deleted": ev is None,
            "created_at": _iso(r.created_at),
        })
    return {"plan_id": str(plan.id), "plan_revision": plan.revision, "conflicts": out}


@router.post("/{plan_id}/sync/conflicts/{operation_id}/resolve", response_model=dict)
def resolve_conflict(plan_id: str, operation_id: str, payload: ResolveRequest, request: Request,
                     db: Session = Depends(get_db), if_match: Optional[str] = Header(None, alias="If-Match"),
                     current_user: User = Depends(get_current_user_or_guest)):
    plan, _role, _hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    if not sy.is_uuid(operation_id):
        raise HTTPException(status_code=404, detail="競合が見つかりません")
    r = (db.query(SyncOperation)
         .filter(SyncOperation.plan_id == plan.id, SyncOperation.user_id == current_user.id,
                 SyncOperation.operation_id == uuid.UUID(operation_id)).first())
    if r is None:
        raise HTTPException(status_code=404, detail="競合が見つかりません")
    if r.status != "conflicted":
        raise HTTPException(status_code=409, detail={"code": "not_conflicted", "message": "この操作は競合していません"})
    if payload.resolution == "keep_server":
        r.status = "resolved_server"
        r.resolved_at = _now()
        db.commit()
        _audit("sync_conflict_resolved", request, current_user, plan, {"resolution": "keep_server"})
        return {"operation_id": operation_id, "status": r.status, "plan_revision": plan.revision}

    plans_api._require_if_match(plan, if_match)
    if r.entity_type in ("day", "order"):
        rev = _resolve_day_or_order(db, plan, current_user, r)
        r = cast(Any, db.query(SyncOperation).filter(SyncOperation.id == r.id).first())
        r.status = "resolved_mine"
        r.resolved_at = _now()
        r.resulting_revision = rev
        db.commit()
        _audit("sync_conflict_resolved", request, current_user, plan, {"resolution": "use_mine"})
        return {"operation_id": operation_id, "status": "resolved_mine", "plan_revision": rev}
    ev = _event(db, plan, r.entity_id) if r.entity_id else None
    if r.action == "update":
        if ev is None:
            raise HTTPException(status_code=409, detail={
                "code": "deleted_on_server", "message": "サーバーで削除された予定のため、自分の変更は使えません"})
        if ev.locked:
            raise HTTPException(status_code=409, detail={"code": "locked", "message": CODE_MESSAGES["locked"]})
        before = plans_api._event_to_dict(ev)
        try:
            _apply_fields(db, plan, ev, r.fields or {})
        except sy.SyncError as e:  # 日程の確認は値を変える前に行うため、ここでは何も変わっていない
            raise HTTPException(status_code=409, detail={"code": e.code, "message": str(e)})
        db.flush()
        rev = plans_api._record_change_and_bump_revision(db, plan, current_user, "sync", "travel_event", ev.id,
                                                         "update", before, plans_api._event_to_dict(ev))
    else:  # delete
        rev = plan.revision
        if ev is not None:
            if ev.locked:
                raise HTTPException(status_code=409, detail={"code": "locked", "message": CODE_MESSAGES["locked"]})
            if str(ev.id) in branches_api._related_event_ids(db, [ev.id]):
                raise HTTPException(status_code=409, detail={"code": "has_relations",
                                                             "message": CODE_MESSAGES["has_relations"]})
            rev = _delete_event(db, plan, current_user, ev)
    reloaded = db.query(SyncOperation).filter(SyncOperation.id == r.id).first()
    if reloaded is None:
        raise HTTPException(status_code=404, detail={"code": "sync_operation_missing",
                                                     "message": "同期の記録が見つかりません"})
    r = reloaded
    r.status = "resolved_mine"
    r.resolved_at = _now()
    r.resulting_revision = rev
    db.commit()
    _audit("sync_conflict_resolved", request, current_user, plan, {"resolution": "use_mine"})
    return {"operation_id": operation_id, "status": "resolved_mine", "plan_revision": rev}


def _resolve_day_or_order(db: Session, plan: TravelPlan, user: User, r: Any) -> int:
    """[Gate G6] 日程・並びの競合を「自分の変更を使う」で解く(今のサーバーの状態に対して、もう一度確かめてから変える)。"""
    day = _day(db, plan, r.entity_id) if r.entity_id else None
    if day is None:
        raise HTTPException(status_code=409, detail={"code": "deleted_on_server",
                                                     "message": "サーバーで削除された日程のため、自分の変更は使えません"})
    if r.entity_type == "order":
        order = [uuid.UUID(x) for x in (r.fields or {}).get("order", [])]
        rev, code = _apply_order(db, plan, user, day, order)
        if code == "changed_on_server":
            raise HTTPException(status_code=409, detail={
                "code": "changed_on_server",
                "message": "日程の予定が変わっているため、この並びは使えません(画面で並べ直してください)"})
        if code == "locked":
            raise HTTPException(status_code=409, detail={"code": "locked", "message": CODE_MESSAGES["locked"]})
        return int(rev)
    if r.action == "update":
        before = plans_api._day_to_dict(day)
        for f, v in (r.fields or {}).items():
            if f in ("title", "notes"):
                setattr(day, f, v)
        db.flush()
        return plans_api._record_change_and_bump_revision(db, plan, user, "sync", "travel_day", day.id, "update",
                                                          before, plans_api._day_to_dict(day))
    if db.query(TravelEvent.id).filter(TravelEvent.day_id == day.id).first() is not None:
        raise HTTPException(status_code=409, detail={"code": "day_not_empty",
                                                     "message": CODE_MESSAGES["day_not_empty"]})
    return _delete_day(db, plan, user, day)
