"""[Gate P6] データポータビリティ(FR-039 / FC-098)。旅行単位・アカウント単位の構造化JSONエクスポート。

形式 travelcanvas-export v1:
    {format, version, scope, exported_at, requested_by, policy, retention, plans: [ {plan, tables, counts,
     document_manifest} ], memberships, contributions, profile?}

方針(DOC-11・FR-039):
- 正本テーブルの列をそのまま出す(列名・IDを保ち、別システムへ移せる)。値はJSONへ変換する
  (UUID・日時は文字列、金額はDecimalの文字列)。
- 暗号文・照合用ハッシュ・トークン・保存キー・IPアドレス・メールアドレスは出さない(policy.omitted_fields に列挙)。
  予約番号・PIN・名義・電話・チケットの中身は、アプリの開示機能で個別に確認する(監査付き)。
- 本人だけの情報(個人の持ち物・秘匿制約・個人予算)は、要求者本人の分だけ復号して出す。他人の分は行ごと出さない。
- 匿名の投票では他人の回答を出さない。削除済みコメントの本文は出さない。
- 文書は原本ファイルではなく manifest(種類・分類・サイズ・SHA-256・作成日時)を出す。原本は文書画面から取得する。
"""
import json
import re
import uuid
from datetime import date, datetime, timezone as dt_timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_payload
from app.models import models as m

FORMAT = "travelcanvas-export"
VERSION = 1

# 列名で一律に出さない列(暗号文・照合用ハッシュ・トークン・保存キー・IP・メール・パスワード)
_OMIT_RE = re.compile(r"(_ciphertext$|_hash$|lookup|token|passcode|password|storage_key|^ip_address$|^email$)")


def _jsonable(v: Any) -> Any:
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=dt_timezone.utc)).isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, (bytes, bytearray, memoryview)):
        return None
    if isinstance(v, (list, dict)):
        return json.loads(json.dumps(v, default=str))
    if hasattr(v, "value"):  # Enum
        return v.value
    return str(v)


def columns(model) -> List[str]:
    return [c.key for c in sa_inspect(model).mapper.column_attrs]


def omitted_columns(model) -> List[str]:
    return [c for c in columns(model) if _OMIT_RE.search(c)]


def row(obj, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    out = {c: _jsonable(getattr(obj, c)) for c in columns(type(obj)) if not _OMIT_RE.search(c)}
    if extra:
        out.update(extra)
    return out


def _decrypt_json(ciphertext: Optional[bytes]) -> Optional[Any]:
    if not ciphertext:
        return None
    try:
        raw = decrypt_payload(ciphertext).decode("utf-8")
    except Exception:  # noqa: BLE001 - 復号できない値は「無い」として出し、出力全体を止めない
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def _budget_amount(b) -> Optional[str]:
    """個人予算(本人のみ)の金額。暗号文は {"amount": "..."} のJSON。"""
    data = _decrypt_json(b.amount_ciphertext)
    if isinstance(data, dict) and data.get("amount") is not None:
        return str(data["amount"])
    return None


# 旅行単位で出すテーブル(表示順)。各テーブルの行の絞り込みは plan_tables() が行う。
PLAN_TABLES = (
    m.TravelDay, m.TravelEvent, m.EventLink, m.TravelSegment, m.RouteOption, m.RouteLeg,
    m.Reservation, m.EventReservation, m.ReservationParticipant, m.Ticket,
    m.Document, m.DocumentLink, m.ImportJob, m.ExtractionCandidate,
    m.PlanConstraint, m.ValidationRun, m.ValidationIssue,
    m.PackingItem, m.PreparationTask,
    m.PlanFinanceSettings, m.Budget, m.Expense, m.ExpenseShare, m.Settlement,
    m.Poll, m.PollOption, m.Vote, m.Comment,
    m.PlanCollaborator, m.PlanShareLink, m.BookletExport, m.ChangeSet, m.ChangeItem, m.PlanVersion,
    m.ItineraryBranch, m.PlanAlert, m.Replan, m.SyncOperation, m.Memory,
)


def _ids(rows: Iterable) -> List:
    return [r.id for r in rows]


def plan_tables(db: Session, plan: m.TravelPlan, me: uuid.UUID) -> Dict[str, List[Dict[str, Any]]]:
    q = lambda model: db.query(model).filter(model.plan_id == plan.id)  # noqa: E731
    t: Dict[str, List[Dict[str, Any]]] = {}

    days = q(m.TravelDay).order_by(m.TravelDay.local_date).all()
    events = q(m.TravelEvent).order_by(m.TravelEvent.sort_order).all()
    event_ids = _ids(events)
    t["travel_days"] = [row(x) for x in days]
    t["travel_events"] = [row(x) for x in events]
    t["event_links"] = [row(x) for x in db.query(m.EventLink).filter(
        m.EventLink.event_id.in_(event_ids)).all()] if event_ids else []
    t["travel_segments"] = [row(x) for x in q(m.TravelSegment).all()]
    options = q(m.RouteOption).all()
    t["route_options"] = [row(x) for x in options]
    t["route_legs"] = [row(x) for x in db.query(m.RouteLeg).filter(
        m.RouteLeg.route_option_id.in_(_ids(options))).all()] if options else []

    reservations = q(m.Reservation).all()
    res_ids = _ids(reservations)
    t["reservations"] = [row(x) for x in reservations]
    t["event_reservations"] = [row(x) for x in db.query(m.EventReservation).filter(
        m.EventReservation.reservation_id.in_(res_ids)).all()] if res_ids else []
    t["reservation_participants"] = [row(x) for x in db.query(m.ReservationParticipant).filter(
        m.ReservationParticipant.reservation_id.in_(res_ids)).all()] if res_ids else []
    t["tickets"] = [row(x) for x in db.query(m.Ticket).filter(m.Ticket.reservation_id.in_(res_ids)).all()] \
        if res_ids else []

    documents = q(m.Document).all()
    t["documents"] = [row(x) for x in documents]
    t["document_links"] = [row(x) for x in db.query(m.DocumentLink).filter(
        m.DocumentLink.document_id.in_(_ids(documents))).all()] if documents else []
    jobs = q(m.ImportJob).all()
    t["import_jobs"] = [row(x) for x in jobs]
    t["extraction_candidates"] = [row(x) for x in db.query(m.ExtractionCandidate).filter(
        m.ExtractionCandidate.import_job_id.in_(_ids(jobs))).all()] if jobs else []

    # 秘匿制約は本人の分だけ(復号した値・理由を付ける)。他人の秘匿制約は行ごと出さない
    cons = []
    hidden_constraints = set()
    for c in q(m.PlanConstraint).all():
        if c.privacy_level == "private" and c.owner_user_id != me:
            hidden_constraints.add(c.id)
            continue
        extra = {}
        if c.owner_user_id == me:
            if c.value_ciphertext:
                extra["private_value"] = _decrypt_json(c.value_ciphertext)
            if c.reason_ciphertext:
                extra["reason"] = _decrypt_json(c.reason_ciphertext)
        cons.append(row(c, extra))
    t["constraints"] = cons
    runs = q(m.ValidationRun).all()
    t["validation_runs"] = [row(x) for x in runs]
    # 他人の秘匿制約に関する検証結果は出さない(その制約の存在・内容を推測させない)
    t["validation_issues"] = [row(x) for x in (db.query(m.ValidationIssue).filter(
        m.ValidationIssue.run_id.in_(_ids(runs))).all() if runs else []) if x.constraint_id not in hidden_constraints]

    packing = []
    for p in q(m.PackingItem).all():
        if p.scope == "personal":
            if p.owner_user_id != me:
                continue
            packing.append(row(p, {"personal": _decrypt_json(p.payload_ciphertext)}))
        else:
            packing.append(row(p))
    t["packing_items"] = packing
    t["preparation_tasks"] = [row(x) for x in q(m.PreparationTask).all()]

    t["plan_finance_settings"] = [row(x) for x in q(m.PlanFinanceSettings).all()]
    budgets = []
    for b in q(m.Budget).all():
        if b.kind == "member":
            if b.member_user_id != me:
                continue
            budgets.append(row(b, {"amount": _budget_amount(b)}))
        else:
            budgets.append(row(b))
    t["budgets"] = budgets
    expenses = q(m.Expense).all()
    t["expenses"] = [row(x) for x in expenses]
    t["expense_shares"] = [row(x) for x in db.query(m.ExpenseShare).filter(
        m.ExpenseShare.expense_id.in_(_ids(expenses))).all()] if expenses else []
    t["settlements"] = [row(x) for x in q(m.Settlement).all()]

    polls = q(m.Poll).all()
    anonymous = {p.id for p in polls if p.is_anonymous}
    t["polls"] = [row(x) for x in polls]
    t["poll_options"] = [row(x) for x in db.query(m.PollOption).filter(
        m.PollOption.poll_id.in_(_ids(polls))).all()] if polls else []
    t["votes"] = [row(v) for v in (db.query(m.Vote).filter(m.Vote.poll_id.in_(_ids(polls))).all() if polls else [])
                  if v.poll_id not in anonymous or v.user_id == me]
    t["comments"] = [row(c, {"body": None, "mentions": None} if c.deleted_at else None) for c in q(m.Comment).all()]

    t["plan_collaborators"] = [row(x) for x in q(m.PlanCollaborator).all()]
    t["plan_share_links"] = [row(x) for x in q(m.PlanShareLink).all()]
    t["booklet_exports"] = [row(x) for x in q(m.BookletExport).all()]
    change_sets = q(m.ChangeSet).all()
    t["change_sets"] = [row(x) for x in change_sets]
    t["change_items"] = [row(x) for x in db.query(m.ChangeItem).filter(
        m.ChangeItem.change_set_id.in_(_ids(change_sets))).all()] if change_sets else []
    t["plan_versions"] = [row(x) for x in q(m.PlanVersion).all()]
    # [Gate P12] P7〜P12で追加した旅行の表(以前の書き出しに漏れていたP7・P10・P11の表を含む)
    t["itinerary_branches"] = [row(x) for x in q(m.ItineraryBranch).all()]
    t["plan_alerts"] = [row(x) for x in q(m.PlanAlert).all()]
    t["replans"] = [row(x) for x in q(m.Replan).all()]
    # 同期の受領記録は送った本人の分だけ(他の人が端末から送った内容は含めない)
    t["sync_operations"] = [row(x) for x in q(m.SyncOperation).filter(m.SyncOperation.user_id == me).all()]
    # 旅の記録は本人の分と、メンバーに公開された分だけ(他の人の「自分だけ」の記録は含めない)。ファイルは含めない
    t["memories"] = [row(x) for x in q(m.Memory).all() if x.author_user_id == me or x.visibility == "members"]
    return t


def document_manifest(db: Session, plan: m.TravelPlan) -> List[Dict[str, Any]]:
    docs = db.query(m.Document).filter(m.Document.plan_id == plan.id, m.Document.deleted_at.is_(None)).all()
    return [{
        "id": str(d.id), "document_type": d.document_type, "classification": _jsonable(d.classification),
        "mime_type": d.mime_type, "size": d.size, "sha256": d.sha256,
        "original_filename": _decrypt_json(d.original_filename_ciphertext),
        "created_at": _jsonable(d.created_at),
    } for d in docs]


def plan_export(db: Session, plan: m.TravelPlan, me: uuid.UUID) -> Dict[str, Any]:
    tables = plan_tables(db, plan, me)
    return {
        "plan": row(plan),
        "tables": tables,
        "counts": {k: len(v) for k, v in tables.items()},
        "document_manifest": document_manifest(db, plan),
    }


def contributions(db: Session, plan: m.TravelPlan, me: uuid.UUID) -> Dict[str, Any]:
    """共同編集者として参加している旅行のうち、本人が作成・回答したもの(他人のデータは含めない)。"""
    personal = [row(p, {"personal": _decrypt_json(p.payload_ciphertext)}) for p in db.query(m.PackingItem).filter(
        m.PackingItem.plan_id == plan.id, m.PackingItem.scope == "personal", m.PackingItem.owner_user_id == me).all()]
    cons = [row(c, {"private_value": _decrypt_json(c.value_ciphertext), "reason": _decrypt_json(c.reason_ciphertext)})
            for c in db.query(m.PlanConstraint).filter(m.PlanConstraint.plan_id == plan.id,
                                                       m.PlanConstraint.owner_user_id == me).all()]
    budgets = []
    for b in db.query(m.Budget).filter(m.Budget.plan_id == plan.id, m.Budget.kind == "member",
                                       m.Budget.member_user_id == me).all():
        budgets.append(row(b, {"amount": _budget_amount(b)}))
    comments = [row(c) for c in db.query(m.Comment).filter(
        m.Comment.plan_id == plan.id, m.Comment.author_user_id == me, m.Comment.deleted_at.is_(None)).all()]
    memories = [row(x) for x in db.query(m.Memory).filter(
        m.Memory.plan_id == plan.id, m.Memory.author_user_id == me).all()]
    poll_ids = [p.id for p in db.query(m.Poll.id).filter(m.Poll.plan_id == plan.id).all()]
    votes = [row(v) for v in db.query(m.Vote).filter(m.Vote.poll_id.in_(poll_ids), m.Vote.user_id == me).all()] \
        if poll_ids else []
    return {"plan_id": str(plan.id), "title": plan.title, "personal_packing_items": personal, "constraints": cons,
            "member_budgets": budgets, "comments": comments, "votes": votes, "memories": memories}


def omitted_fields(models: Sequence = PLAN_TABLES + (m.TravelPlan, m.User)) -> Dict[str, List[str]]:
    out = {}
    for model in models:
        cols = omitted_columns(model)
        if cols:
            out[model.__tablename__] = cols
    return out


POLICY_NOTE = (
    "暗号化して保存している値(予約番号・PIN・名義・電話・チケットの中身・文書のファイル名以外の機密値)、照合用ハッシュ、"
    "トークン、保存キー、IPアドレス、他の参加者のメールアドレスは含めていません。予約番号等はアプリの予約画面の"
    "「表示」で個別に確認できます。個人の持ち物・秘匿制約・個人予算は、あなた本人の分だけを復号して含めています。"
    "文書の原本ファイルは含めず、種類・サイズ・SHA-256などの一覧(document_manifest)を含めています。"
    "旅の記録(memories)は、あなたの記録とメンバーに公開された記録を含め、写真・音声のファイルは含めていません"
    "(アプリの「旅の記録」から個別に保存できます)。"
)


def envelope(scope: str, user: m.User, retention: Dict[str, Any], now: datetime, **body) -> Dict[str, Any]:
    return {
        "format": FORMAT,
        "version": VERSION,
        "scope": scope,
        "exported_at": now.isoformat(),
        "requested_by": {"user_id": str(user.id), "username": user.username},
        "policy": {"note": POLICY_NOTE, "omitted_fields": omitted_fields()},
        "retention": retention,
        **body,
    }


def accessible_member_plans(db: Session, user: m.User) -> List[m.TravelPlan]:
    ids: Set = {r[0] for r in db.query(m.PlanCollaborator.plan_id).filter(
        m.PlanCollaborator.user_id == user.id, m.PlanCollaborator.status == "accepted").all()}
    if not ids:
        return []
    return db.query(m.TravelPlan).filter(m.TravelPlan.id.in_(ids), m.TravelPlan.deleted_at.is_(None),
                                         m.TravelPlan.user_id != user.id).all()
