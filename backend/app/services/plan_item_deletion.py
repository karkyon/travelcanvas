"""[Gate B-013] 予定・日程・経路候補・共同編集者の個別削除(紐付け解除して削除)。

B-013: 予約に紐付いた予定、その予定を含む日程、経路候補の端点になっている予定、
採用済みの経路候補、参加者・チケット担当者になっている共同編集者を個別に削除すると、
外部キー違反で500になっていた(B-012でプラン全体の削除だけを直したため)。

方針(ユーザー承認済み、docs/adr/ADR-plan-item-deletion.md):
- 予約・チケット・参加者・文書は独立した業務記録なので削除しない。削除対象との
  関連(外部キー・文書リンク)だけを解除する。
- 経路候補・移動区間など、削除対象の予定を端点に持つ従属データは同じtransactionで削除する。
- 予定・日程・経路候補の削除は、解除した関連と削除した従属データを同じChangeSetへ記録し、
  1回のUndoで原子的に戻せるようにする。ChangeItemには予約・チケット本体を複製せず、
  解除した関連IDだけを残す。
- 確定ロック(event_reservations.is_locked)された紐付けがある場合だけ、何も変更せずに
  409で断る(LockedRelationError)。
- 共同編集者の削除はアクセス取消しとして常に許可し、参加者・チケット担当者の割当だけを
  解除する(Undoは無い。再招待で戻す)。
- Undo時に対象本体が削除済み・別の予定へ再紐付け済み等で安全に戻せない場合は、
  上書きせずに409で断る(check_undo_conflicts)。

外部キーの扱いは下の *_REFERENCE_POLICY に明示し、試験
(tests/test_gate_b013_item_deletion.py)が実DBの外部キー一覧と突き合わせて漏れを検出する。
"""
import uuid
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.models import (
    Document,
    DocumentLink,
    EventLink,
    EventReservation,
    Reservation,
    ReservationParticipant,
    RouteLeg,
    RouteOption,
    Ticket,
    TravelDay,
    TravelSegment,
)

# (参照元テーブル, 列) -> 扱い。delete=従属データとして一緒に削除、unlink=関連だけ解除。
EVENT_REFERENCE_POLICY: Dict[tuple, str] = {
    ("reservations", "event_id"): "unlink",
    ("event_reservations", "event_id"): "unlink",
    ("travel_segments", "from_event_id"): "delete",
    ("travel_segments", "to_event_id"): "delete",
    ("route_options", "from_event_id"): "delete",
    ("route_options", "to_event_id"): "delete",
    ("event_links", "event_id"): "delete",
}
DAY_REFERENCE_POLICY: Dict[tuple, str] = {
    ("travel_events", "day_id"): "delete",  # 予定ごとに EVENT_REFERENCE_POLICY を適用する
}
ROUTE_OPTION_REFERENCE_POLICY: Dict[tuple, str] = {
    ("travel_segments", "route_option_id"): "unlink",
    ("route_legs", "route_option_id"): "delete",
}
COLLABORATOR_REFERENCE_POLICY: Dict[tuple, str] = {
    ("reservation_participants", "plan_member_id"): "unlink",
    ("tickets", "holder_member_id"): "unlink",
}
# 外部キーの無い参照(entity_type + entity_id)。これも関連として解除する。
POLYMORPHIC_EVENT_REFERENCES = (("document_links", "entity_type='event'"),)

# 本モジュールが記録・復元するChangeItem.entity_type
RELATION_ENTITY_TYPES = (
    "event_link",
    "event_reservation_link",
    "reservation_event_ref",
    "document_link",
    "segment_route_option_ref",
)


class LockedRelationError(Exception):
    """解除してはいけない関連(確定ロック)があるため削除できない。"""

    def __init__(self, blocking: List[dict]):
        super().__init__("locked relation")
        self.blocking = blocking


class UndoConflictError(Exception):
    """Undoで戻す先の状態が変わっていて安全に復元できない。"""

    def __init__(self, conflicts: List[dict]):
        super().__init__("undo conflict")
        self.conflicts = conflicts


@dataclass
class Detachment:
    """削除に伴って記録するChangeItem(タプル)と、利用者へ示す影響の件数。"""

    changes: List[tuple] = field(default_factory=list)
    reservation_ids: Set[uuid.UUID] = field(default_factory=set)
    document_links_removed: int = 0
    segments_removed: int = 0
    route_options_removed: int = 0
    segments_unlinked: int = 0

    def impact(self) -> dict:
        return {
            "reservations_unlinked": len(self.reservation_ids),
            "document_links_removed": self.document_links_removed,
            "segments_removed": self.segments_removed,
            "route_options_removed": self.route_options_removed,
            "segments_unlinked": self.segments_unlinked,
        }


def _s(value) -> Optional[str]:
    return str(value) if value is not None else None


def _u(value) -> Optional[uuid.UUID]:
    if value is None:
        return None
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def locked_detail(blocking: List[dict]) -> dict:
    return {
        "code": "locked_relation",
        "message": "確定ロックされた予約との紐付けがあるため削除できません。予約の紐付けのロックを解除してから削除してください。",
        "blocking": blocking,
    }


def undo_conflict_detail(conflicts: List[dict]) -> dict:
    return {
        "code": "undo_conflict",
        "message": "削除後に関連する予約・文書・移動区間などが変更または削除されたため、取り消せません(何も変更していません)。",
        "conflicts": conflicts,
    }


# ------------------------------------------------------------------ 削除時の解除

def find_locked_event_links(db: Session, event_ids: Iterable[uuid.UUID]) -> List[dict]:
    ids = list(event_ids)
    if not ids:
        return []
    rows = (
        db.query(EventReservation)
        .filter(EventReservation.event_id.in_(ids), EventReservation.is_locked.is_(True))
        .order_by(EventReservation.created_at, EventReservation.id)
        .all()
    )
    return [
        {"type": "event_reservation", "id": str(r.id), "event_id": str(r.event_id),
         "reservation_id": str(r.reservation_id), "reason": "locked"}
        for r in rows
    ]


def unlink_segments_from_route_options(
    db: Session, option_ids: Set[uuid.UUID], exclude_segment_ids: Optional[Set[uuid.UUID]] = None,
) -> List[tuple]:
    """経路候補を消す前に、それを採用元として参照する移動区間の参照だけを外す
    (移動区間は利用者が採用した予定の一部なので残す)。"""
    if not option_ids:
        return []
    query = db.query(TravelSegment).filter(TravelSegment.route_option_id.in_(list(option_ids)))
    if exclude_segment_ids:
        query = query.filter(~TravelSegment.id.in_(list(exclude_segment_ids)))
    changes = []
    for seg in query.order_by(TravelSegment.created_at, TravelSegment.id).all():
        changes.append((
            "segment_route_option_ref", seg.id, "unlink",
            {"route_option_id": str(seg.route_option_id)}, {"route_option_id": None},
        ))
        seg.route_option_id = None
        seg.revision = (seg.revision or 1) + 1
    db.flush()
    return changes


def detach_event_references(db: Session, event_ids: Iterable[uuid.UUID]) -> Detachment:
    """予定を削除する前に呼ぶ。確定ロックがあれば何も変更せずLockedRelationError。

    呼び出し側は戻り値のchangesを、予定(または日程)自身のChangeItemと同じ
    ChangeSetへ記録する。"""
    # 循環importを避けるため遅延import(スナップショット形式の正本はAPI側にある)
    from app.api.v1.plans import _segment_to_dict
    from app.api.v1.route_options import _option_snapshot_with_legs

    ids = [_u(i) for i in event_ids]
    det = Detachment()
    if not ids:
        return det

    blocking = find_locked_event_links(db, ids)
    if blocking:
        raise LockedRelationError(blocking)

    options = (
        db.query(RouteOption)
        .filter(or_(RouteOption.from_event_id.in_(ids), RouteOption.to_event_id.in_(ids)))
        .order_by(RouteOption.created_at, RouteOption.id)
        .all()
    )
    option_ids = {o.id for o in options}
    segments = (
        db.query(TravelSegment)
        .filter(or_(TravelSegment.from_event_id.in_(ids), TravelSegment.to_event_id.in_(ids)))
        .order_by(TravelSegment.created_at, TravelSegment.id)
        .all()
    )
    segment_ids = {s.id for s in segments}

    # 1. 予定を端点に持つ移動区間(従属データ)を削除
    for seg in segments:
        det.changes.append(("travel_segment", seg.id, "delete", _segment_to_dict(seg), None))
        db.delete(seg)
    db.flush()
    det.segments_removed = len(segments)

    # 2. 削除する経路候補を採用元として参照する、残る移動区間の参照を外す
    unlinked = unlink_segments_from_route_options(db, option_ids, segment_ids)
    det.changes.extend(unlinked)
    det.segments_unlinked = len(unlinked)

    # 3. 予定を端点に持つ経路候補(従属データ、区間の内訳legsを含む)を削除
    for option in options:
        det.changes.append(("route_option", option.id, "delete", _option_snapshot_with_legs(db, option), None))
        for leg in db.query(RouteLeg).filter(RouteLeg.route_option_id == option.id).all():
            db.delete(leg)
    db.flush()
    for option in options:
        db.delete(option)
    db.flush()
    det.route_options_removed = len(options)

    # 4. 予約⇔予定の紐付け(中間表)を解除
    links = (
        db.query(EventReservation, Reservation.deleted_at)
        .join(Reservation, Reservation.id == EventReservation.reservation_id)
        .filter(EventReservation.event_id.in_(ids))
        .order_by(EventReservation.created_at, EventReservation.id)
        .all()
    )
    for link, reservation_deleted_at in links:
        det.changes.append(("event_reservation_link", link.id, "delete", {
            "id": str(link.id), "event_id": str(link.event_id), "reservation_id": str(link.reservation_id),
            "relation_type": link.relation_type, "is_locked": bool(link.is_locked),
            "reservation_deleted": reservation_deleted_at is not None,
        }, None))
        det.reservation_ids.add(link.reservation_id)
        db.delete(link)

    # 5. 予約の主紐付け(reservations.event_id)を解除。論理削除済みの予約も外部キーは残るため対象
    reservations = (
        db.query(Reservation)
        .filter(Reservation.event_id.in_(ids))
        .order_by(Reservation.created_at, Reservation.id)
        .all()
    )
    for r in reservations:
        det.changes.append(("reservation_event_ref", r.id, "unlink", {
            "event_id": str(r.event_id), "reservation_deleted": r.deleted_at is not None,
        }, {"event_id": None}))
        det.reservation_ids.add(r.id)
        r.event_id = None
        r.revision = (r.revision or 1) + 1

    # 6. 文書リンク(外部キーの無い entity_type='event' の参照)を解除
    doc_links = (
        db.query(DocumentLink)
        .filter(DocumentLink.entity_type == "event", DocumentLink.entity_id.in_(ids))
        .order_by(DocumentLink.created_at, DocumentLink.id)
        .all()
    )
    for dl in doc_links:
        det.changes.append(("document_link", dl.id, "delete", {
            "id": str(dl.id), "document_id": str(dl.document_id), "entity_type": dl.entity_type,
            "entity_id": str(dl.entity_id), "relation_type": dl.relation_type, "display_order": dl.display_order,
        }, None))
        db.delete(dl)
    det.document_links_removed = len(doc_links)

    # 7. 予定の補助メモ(event_links。DB上はCASCADE)もUndoで戻せるよう記録して削除
    for note in db.query(EventLink).filter(EventLink.event_id.in_(ids)).order_by(EventLink.created_at, EventLink.id):
        det.changes.append(("event_link", note.id, "delete", {
            "id": str(note.id), "event_id": str(note.event_id), "link_type": note.link_type,
            "label": note.label, "url": note.url, "body": note.body,
        }, None))
        db.delete(note)

    db.flush()
    return det


def detach_collaborator_references(db: Session, collaborator_id: uuid.UUID) -> dict:
    """共同編集者のアクセス取消し時に、チケット担当者・参加者の割当だけを外す
    (チケット・参加者・予約の本体は残す。論理削除済みの行も外部キーは残るため対象)。"""
    tickets = db.query(Ticket).filter(Ticket.holder_member_id == collaborator_id).all()
    for t in tickets:
        t.holder_member_id = None
        t.revision = (t.revision or 1) + 1
    participants = (
        db.query(ReservationParticipant).filter(ReservationParticipant.plan_member_id == collaborator_id).all()
    )
    for p in participants:
        p.plan_member_id = None
        p.revision = (p.revision or 1) + 1
    db.flush()
    return {"ticket_holders": len(tickets), "participants": len(participants)}


# ------------------------------------------------------------------ Undo

def _missing(entity_type: str, entity_id, reason: str) -> dict:
    return {"type": entity_type, "id": _s(entity_id), "reason": reason}


def _reservation_state(db: Session, plan, rid, was_deleted: bool) -> Optional[str]:
    r = db.query(Reservation).filter(Reservation.id == _u(rid)).first()
    if r is None or r.plan_id != plan.id:
        return "not_found"
    if r.deleted_at is not None and not was_deleted:
        return "deleted"
    return None


def check_undo_conflicts(db: Session, plan, items) -> List[dict]:
    """Undoで何かを変更する前に、安全に戻せるかを全件検査する(副作用なし)。"""
    conflicts: List[dict] = []
    for item in items:
        before = item.before_json or {}
        t, action = item.entity_type, item.action

        if t == "travel_day" and action == "delete" and before.get("local_date"):
            taken = (
                db.query(TravelDay.id)
                .filter(TravelDay.plan_id == plan.id, TravelDay.local_date == before["local_date"],
                        TravelDay.id != item.entity_id)
                .first()
            )
            if taken:
                conflicts.append(_missing("travel_day", item.entity_id, "date_taken"))

        elif t == "reservation_event_ref" and action == "unlink":
            reason = _reservation_state(db, plan, item.entity_id, bool(before.get("reservation_deleted")))
            if reason is None:
                r = db.query(Reservation).filter(Reservation.id == item.entity_id).first()
                if r.event_id is not None and str(r.event_id) != before.get("event_id"):
                    reason = "relinked"
            if reason:
                conflicts.append(_missing("reservation", item.entity_id, reason))

        elif t == "event_reservation_link" and action == "delete":
            rid = before.get("reservation_id")
            reason = _reservation_state(db, plan, rid, bool(before.get("reservation_deleted")))
            if reason is None and db.query(EventReservation.id).filter(
                or_(EventReservation.id == item.entity_id,
                    (EventReservation.event_id == _u(before.get("event_id")))
                    & (EventReservation.reservation_id == _u(rid)))
            ).first():
                reason = "relinked"
            if reason:
                conflicts.append(_missing("reservation", rid, reason))

        elif t == "document_link" and action == "delete":
            d = db.query(Document).filter(Document.id == _u(before.get("document_id"))).first()
            if d is None or d.plan_id != plan.id:
                conflicts.append(_missing("document", before.get("document_id"), "not_found"))
            elif d.deleted_at is not None:
                conflicts.append(_missing("document", d.id, "deleted"))
            elif db.query(DocumentLink.id).filter(DocumentLink.id == item.entity_id).first():
                conflicts.append(_missing("document_link", item.entity_id, "relinked"))

        elif t == "segment_route_option_ref" and action == "unlink":
            seg = db.query(TravelSegment).filter(TravelSegment.id == item.entity_id).first()
            if seg is None or seg.plan_id != plan.id:
                conflicts.append(_missing("segment", item.entity_id, "not_found"))
            elif seg.route_option_id is not None and str(seg.route_option_id) != before.get("route_option_id"):
                conflicts.append(_missing("segment", item.entity_id, "relinked"))
    # 同じ予約の主紐付けと中間表の紐付けは同じ理由で重なるため、1件にまとめる
    unique: List[dict] = []
    for c in conflicts:
        if c not in unique:
            unique.append(c)
    return unique


def restore_relation_item(db: Session, plan, item) -> None:
    """RELATION_ENTITY_TYPESのChangeItemを戻す。予定・経路候補の復元後に呼ぶこと。
    check_undo_conflictsで安全を確認済みである前提。"""
    before = item.before_json or {}
    t = item.entity_type
    if t == "event_link" and item.action == "delete":
        db.add(EventLink(
            id=item.entity_id, event_id=_u(before["event_id"]), link_type=before["link_type"],
            label=before.get("label"), url=before.get("url"), body=before.get("body"),
        ))
    elif t == "event_reservation_link" and item.action == "delete":
        db.add(EventReservation(
            id=item.entity_id, event_id=_u(before["event_id"]), reservation_id=_u(before["reservation_id"]),
            relation_type=before.get("relation_type") or "primary", is_locked=bool(before.get("is_locked")),
        ))
    elif t == "reservation_event_ref" and item.action == "unlink":
        r = db.query(Reservation).filter(Reservation.id == item.entity_id).first()
        if r is not None and r.event_id is None:
            r.event_id = _u(before["event_id"])
            r.revision = (r.revision or 1) + 1
    elif t == "document_link" and item.action == "delete":
        db.add(DocumentLink(
            id=item.entity_id, document_id=_u(before["document_id"]), entity_type=before["entity_type"],
            entity_id=_u(before["entity_id"]), relation_type=before.get("relation_type") or "attachment",
            display_order=before.get("display_order") or 0,
        ))
    elif t == "segment_route_option_ref" and item.action == "unlink":
        seg = db.query(TravelSegment).filter(TravelSegment.id == item.entity_id).first()
        if seg is not None and seg.route_option_id is None:
            seg.route_option_id = _u(before["route_option_id"])
            seg.revision = (seg.revision or 1) + 1
