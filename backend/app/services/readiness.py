"""[Gate P1] レディネス(準備状況、FR-026)の読み取りモデル。

予約・予定・持ち物・準備タスクから「出発前に片付けるべきこと」を都度算出する(保存しない)。

対象(DOC-02 FR-026):
- 未予約: 宿泊・移動の予定に予約が紐付いていない
- 未確認: 予約が候補(candidate)のまま
- 未支払: 金額のある予約の支払が済んでいない/支払状況が未入力
- 期限: 取消期限が72時間以内に迫っている予約、期限切れの準備タスク
- 未割当: 担当者のいない準備タスク・必須の共有持ち物(担当者がメンバーから外れた場合も含む)
- 持ち物不足: 必須の持ち物が未準備・要購入
- [Gate Remaining-7] 予算: 使った額と未払いの予約の額の見込みが、全体・費目の予算を超える(未設定は状況だけ出す)

レディネスの項目は「タスクにする」ことで担当者・期限・完了条件を持たせられる
(PreparationTask.readiness_key)。そのタスクが完了していれば項目は対応済みとして外す
(例: 「この移動は予約不要」と確認した)。

秘匿: 他のメンバーの個人の持ち物は数えない・表示しない。予約は種類と事業者名だけを出し、
予約番号などの秘密値は使わない。
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import AbstractSet, Any, Dict, List, Optional, Set

from sqlalchemy.orm import Session

from app.models.models import (
    EventReservation,
    PackingItem,
    PreparationTask,
    Reservation,
    TravelDay,
    TravelEvent,
    TravelPlan,
    User,
)
from app.services.constraint_evaluation import member_user_ids

ALGORITHM_VERSION = "readiness-v1"
DEADLINE_SOON = timedelta(hours=72)
RESERVATION_REQUIRED_EVENT_TYPES = {"accommodation": "宿泊", "transportation": "移動"}
SETTLED_PAYMENT = {"paid", "not_required", "free", "refunded"}
ACTIVE_RESERVATION = {"confirmed", "modified"}
RESERVATION_TYPE_LABEL = {
    "accommodation": "宿泊", "flight": "航空", "train": "鉄道", "bus": "バス", "ferry": "船",
    "rental_car": "レンタカー", "restaurant": "飲食", "activity": "体験", "admission": "入場", "other": "その他",
}
# タスクにできる(=利用者が確認して「対応済み」にできる)項目
CONVERTIBLE_CODES = {
    "unreserved", "reservation_unconfirmed", "reservation_unpaid", "payment_unknown", "cancellation_deadline_soon",
}
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
CATEGORY_OF = {
    "unreserved": "unreserved",
    "reservation_unconfirmed": "unconfirmed",
    "reservation_unpaid": "unpaid",
    "payment_unknown": "unpaid",
    "cancellation_deadline_soon": "deadline",
    "task_overdue": "deadline",
    "task_unassigned": "unassigned",
    "packing_unassigned": "unassigned",
    "packing_shortage": "packing",
    "budget_over": "budget",
    "budget_projected_over": "budget",
    "budget_category_over": "budget",
}
CATEGORIES = ("unreserved", "unconfirmed", "unpaid", "deadline", "unassigned", "packing", "budget")
CATEGORY_LABEL_JA = {"lodging": "宿泊", "transport": "交通", "food": "食事", "activity": "体験", "shopping": "買い物",
                     "fee": "手数料", "cancellation": "取消料", "other": "その他"}


def readiness_key(code: str, entity_type: str, entity_id) -> str:
    return f"{code}:{entity_type}:{entity_id}"


def _reservation_label(r: Reservation) -> str:
    label = RESERVATION_TYPE_LABEL.get(r.type, r.type)
    return f"{label}の予約" + (f"({r.provider_name})" if r.provider_name else "")


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def member_names(db: Session, member_ids: AbstractSet[Any]) -> Dict[Any, str]:
    rows = db.query(User.id, User.username).filter(User.id.in_(member_ids)).all() if member_ids else []
    return {uid: (name or "ゲスト") for uid, name in rows}


def compute(db: Session, plan: TravelPlan, viewer: User, now: Optional[datetime] = None,
            decrypt_personal=None) -> dict:
    """decrypt_personal(item) -> {"name", "note"} | None: 閲覧者本人の個人の持ち物の名前を得る。"""
    now = now or datetime.now(timezone.utc)
    members = member_user_ids(db, plan)
    names = member_names(db, members)
    items: List[dict] = []

    tasks = (
        db.query(PreparationTask)
        .filter(PreparationTask.plan_id == plan.id, PreparationTask.deleted_at.is_(None))
        .all()
    )
    task_by_key = {t.readiness_key: t for t in tasks if t.readiness_key}

    def task_info(t: PreparationTask) -> dict:
        valid = t.assignee_user_id in members if t.assignee_user_id else False
        return {
            "id": str(t.id),
            "status": t.status,
            "assignee_user_id": str(t.assignee_user_id) if valid else None,
            "assignee_name": names.get(t.assignee_user_id) if valid and t.assignee_user_id is not None else None,
            "due_at": _iso(t.due_at),
            "revision": t.revision,
        }

    suppressed = 0

    def add(code: str, severity: str, title: str, detail: str, entity_type: str, entity_id, link: Optional[str],
            due_at: Optional[datetime] = None) -> None:
        nonlocal suppressed
        key = readiness_key(code, entity_type, entity_id)
        task = task_by_key.get(key) if code in CONVERTIBLE_CODES else None
        if task is not None and task.status == "done":
            suppressed += 1
            return
        items.append({
            "key": key,
            "code": code,
            "category": CATEGORY_OF[code],
            "severity": severity,
            "title": title,
            "detail": detail,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "link": link,
            "due_at": _iso(due_at),
            "convertible": code in CONVERTIBLE_CODES,
            "task": task_info(task) if task is not None else None,
        })

    base = f"/planner/{plan.id}"

    # ---- 予約・予定
    reservations = (
        db.query(Reservation)
        .filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None))
        .all()
    )
    linked_events: Set[uuid.UUID] = {r.event_id for r in reservations if r.event_id and r.status != "cancelled"}
    live_ids = {r.id for r in reservations if r.status != "cancelled"}
    if live_ids:
        for (eid,) in db.query(EventReservation.event_id).filter(EventReservation.reservation_id.in_(live_ids)).all():
            linked_events.add(eid)

    events = (
        db.query(TravelEvent, TravelDay.local_date)
        .join(TravelDay, TravelDay.id == TravelEvent.day_id)
        .filter(TravelEvent.plan_id == plan.id, TravelEvent.event_type.in_(list(RESERVATION_REQUIRED_EVENT_TYPES)))
        .order_by(TravelDay.local_date, TravelEvent.sort_order)
        .all()
    )
    for ev, local_date in events:
        if ev.id in linked_events:
            continue
        kind = RESERVATION_REQUIRED_EVENT_TYPES[ev.event_type]
        add("unreserved", "high", f"「{ev.title}」に予約がありません",
            f"{local_date.isoformat()}の{kind}の予定に予約が紐付いていません。予約するか、"
            "予約不要であればタスクにして完了にしてください。",
            "event", ev.id, f"{base}/reservations")

    for r in reservations:
        if r.status == "candidate":
            add("reservation_unconfirmed", "high", f"{_reservation_label(r)}が未確定です",
                "予約がまだ候補のままです。確定したら状態を「確定」にしてください。",
                "reservation", r.id, f"{base}/reservations")
            continue
        if r.status not in ACTIVE_RESERVATION:
            continue
        has_amount = r.total_amount is not None and r.total_amount > 0
        status = (r.payment_status or "").strip().lower()
        if has_amount and status not in SETTLED_PAYMENT:
            if status:
                add("reservation_unpaid", "medium", f"{_reservation_label(r)}が未払いです",
                    "支払が済んでいない予約です。支払ったら支払状況を「paid」にしてください。",
                    "reservation", r.id, f"{base}/reservations")
            else:
                add("payment_unknown", "low", f"{_reservation_label(r)}の支払状況が未入力です",
                    "金額がある予約ですが、支払状況が入力されていません(支払済みかどうか確認できません)。",
                    "reservation", r.id, f"{base}/reservations")
        deadline = _aware(r.cancellation_deadline)
        if deadline is not None and now <= deadline <= now + DEADLINE_SOON:
            add("cancellation_deadline_soon", "medium", f"{_reservation_label(r)}の取消期限が迫っています",
                "取消・変更の無料期限が72時間以内です。予定に変更が無いか確認してください。",
                "reservation", r.id, f"{base}/reservations", due_at=deadline)

    # ---- 準備タスク
    for t in tasks:
        if t.status != "open":
            continue
        due = _aware(t.due_at)
        if due is not None and due < now:
            add("task_overdue", "high", f"タスク「{t.title}」の期限が過ぎています",
                "期限を過ぎた未完了のタスクです。", "task", t.id, f"{base}/preparation", due_at=due)
        if not (t.assignee_user_id and t.assignee_user_id in members):
            add("task_unassigned", "low", f"タスク「{t.title}」に担当者がいません",
                "担当者を決めてください。", "task", t.id, f"{base}/preparation")

    # ---- 持ち物(他人の個人の持ち物は除く)
    packing = (
        db.query(PackingItem)
        .filter(PackingItem.plan_id == plan.id, PackingItem.deleted_at.is_(None))
        .all()
    )
    visible = [p for p in packing if p.scope == "shared" or p.owner_user_id == viewer.id]
    required_total = required_ready = packed = 0
    for p in visible:
        ready = p.status in ("packed", "after_use")
        if ready:
            packed += 1
        if not p.is_required:
            continue
        required_total += 1
        if ready:
            required_ready += 1
            continue
        if p.scope == "personal":
            data = decrypt_personal(p) if decrypt_personal else None
            name = (data or {}).get("name") or "(内容を表示できない個人の持ち物)"
        else:
            name = p.name
        state = "要購入" if p.status == "to_buy" else "未準備"
        add("packing_shortage", "medium", f"必須の持ち物「{name}」が{state}です",
            "必須の持ち物がまだ梱包されていません。", "packing_item", p.id, f"{base}/preparation")
        if p.scope == "shared" and not (p.assignee_user_id and p.assignee_user_id in members):
            add("packing_unassigned", "low", f"必須の持ち物「{name}」に担当者がいません",
                "誰が用意するかを決めてください。", "packing_item", p.id, f"{base}/preparation")

    # ---- [Gate Remaining-7] FR-026 予算との連動(使った額 + 未払いの予約の見込み)
    budget = budget_view(db, plan)
    if budget is not None:
        fin = f"{base}/finance"
        cur = budget["base_currency"]
        # 予算が未設定の時は項目にしない(準備の完了を妨げない)。予算の状況(budget)に未設定として出す
        if budget["total"] is None:
            pass
        elif budget["over"]:
            add("budget_over", "high", "使った額が予算を超えています",
                f"予算 {budget['total']} {cur} に対し、使った額は {budget['spent']} {cur} です。", "plan", plan.id, fin)
        elif budget["projected_over"]:
            add("budget_projected_over", "medium", "未払いの予約を足すと予算を超えます",
                f"使った額 {budget['spent']} {cur} と未払いの予約 {budget['unpaid_reserved']} {cur} で "
                f"{budget['projected']} {cur} になり、予算 {budget['total']} {cur} を超える見込みです。", "plan", plan.id, fin)
        for row in budget["categories_over"]:
            label = CATEGORY_LABEL_JA.get(row["category"], row["category"])
            add("budget_category_over", "medium", f"{label}の予算を超えています",
                f"{label}の予算 {row['budget']} {cur} に対し、使った額は {row['actual']} {cur} です。",
                "budget_category", row["category"], fin)

    items.sort(key=lambda i: (SEVERITY_ORDER[i["severity"]], CATEGORIES.index(i["category"]), i["title"]))
    by_category = {c: 0 for c in CATEGORIES}
    by_severity = {"high": 0, "medium": 0, "low": 0}
    for i in items:
        by_category[i["category"]] += 1
        by_severity[i["severity"]] += 1
    open_tasks = [t for t in tasks if t.status == "open"]
    return {
        "plan_id": str(plan.id),
        "algorithm_version": ALGORITHM_VERSION,
        "checked_at": now.isoformat(),
        "is_ready": len(items) == 0,
        "counts": {"total": len(items), "by_severity": by_severity, "by_category": by_category},
        "resolved_by_tasks": suppressed,
        "tasks": {"open": len(open_tasks), "done": len(tasks) - len(open_tasks)},
        "packing": {
            "total": len(visible), "packed": packed,
            "required_total": required_total, "required_ready": required_ready,
        },
        "items": items,
        "budget": None if budget is None else {k: v for k, v in budget.items() if k != "has_costs"},
    }


def budget_view(db: Session, plan: TravelPlan) -> Optional[dict]:
    """[Gate Remaining-7] FR-026 レディネスで見る予算の状況(基準通貨)。予算も支出も予約の額も無い旅行は None。

    - spent: 取り消していない支出の合計(返金は引く。為替の無い支出は数えない)
    - unpaid_reserved: 確定した予約のうち支払いが済んでいない額(基準通貨の予約だけ。外貨は数えず件数を返す)
    - projected = spent + unpaid_reserved。予算(全体)を超えるか・費目ごとに使った額が予算を超えるか"""
    from decimal import Decimal

    from app.models.models import Budget, Expense, PlanFinanceSettings
    from app.services import finance

    settings_row = db.query(PlanFinanceSettings).filter(PlanFinanceSettings.plan_id == plan.id).first()
    cur = settings_row.base_currency if settings_row else "JPY"
    budgets = db.query(Budget).filter(Budget.plan_id == plan.id, Budget.deleted_at.is_(None)).all()
    expenses = (db.query(Expense).filter(Expense.plan_id == plan.id, Expense.voided_at.is_(None)).all())
    reservations = (db.query(Reservation).filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None))
                    .all())
    spent = 0
    by_cat: Dict[str, int] = {}
    for e in expenses:
        if getattr(e, "deleted_at", None) is not None or e.base_amount is None:
            continue
        try:
            minor = finance.to_minor(Decimal(str(e.base_amount)), cur)
        except finance.FinanceError:
            continue
        value = -minor if e.kind == "refund" else minor
        spent += value
        by_cat[e.category] = by_cat.get(e.category, 0) + value
    unpaid = foreign = 0
    for r in reservations:
        if r.status not in ACTIVE_RESERVATION or r.total_amount is None or r.total_amount <= 0:
            continue
        if (r.payment_status or "").strip().lower() in SETTLED_PAYMENT:
            continue
        if (r.currency or cur) != cur:
            foreign += 1
            continue
        try:
            unpaid += finance.to_minor(Decimal(str(r.total_amount)), cur)
        except finance.FinanceError:
            continue
    total_row = next((b for b in budgets if b.kind == "total" and b.amount is not None), None)
    has_costs = bool(expenses) or any(r.total_amount for r in reservations)
    if total_row is None and not has_costs and not budgets:
        return None

    def money(minor: int) -> str:
        return str(finance.from_minor(minor, cur))

    total = finance.to_minor(Decimal(str(total_row.amount)), cur) if total_row is not None else None
    projected = spent + unpaid
    cats = []
    for b in budgets:
        if b.kind != "category" or b.amount is None or not b.category:
            continue
        bm = finance.to_minor(Decimal(str(b.amount)), cur)
        if by_cat.get(b.category, 0) > bm:
            cats.append({"category": b.category, "budget": money(bm), "actual": money(by_cat[b.category])})
    return {
        "base_currency": cur,
        "total": money(total) if total is not None else None,
        "spent": money(spent),
        "unpaid_reserved": money(unpaid),
        "unpaid_reserved_foreign": foreign,
        "projected": money(projected),
        "remaining": money(total - projected) if total is not None else None,
        "over": total is not None and spent > total,
        "projected_over": total is not None and projected > total,
        "categories_over": cats,
        "has_costs": has_costs,
    }
