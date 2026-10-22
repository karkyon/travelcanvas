"""
[Gate P2] FR-027 予算・費用 / FR-028 立替・精算(DOC-02 FR-027・FR-028 / DOC-05 §8.6 / FC-071〜074)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET/PUT /finance-settings          : 基準通貨(行が無ければJPY)。変更は支出・予算・精算が無い時だけ
- GET/POST /budgets, PATCH/DELETE /budgets/{id}
                                     : 旅行全体・カテゴリ別・日別・個人の予算。個人の予算は本人だけが見え、金額は暗号化
- GET/POST /expenses, PATCH/DELETE /expenses/{id}
                                     : 支出と返金。分担(均等・比率・金額・負担なし)を保存時に計算し、合計を支出額に一致させる
- GET/POST /settlements, DELETE /settlements/{id}
                                     : メンバー間の精算記録(基準通貨)
- GET /finance-summary               : 予算と実績の差異(全体・カテゴリ別・日別・個人)、予約額、メンバーごとの差額と精算案

権限:
- 閲覧: viewer以上(個人の予算は本人だけ)
- 予算(個人以外)・支出・基準通貨: editor以上。個人の予算は本人(viewer可)
- 精算の記録: editor以上、または支払う人/受け取る人本人。取消は記録した人かeditor以上

金額はAPI上は文字列(Decimal)で返す。換算レートの無い外貨の支出は基準通貨へ換算せず、
集計・精算から除外したことを件数(unconverted_expenses)で示す(EX-013、検証不能を問題なしにしない)。
監査ログには題名・メモ・金額を記録しない。
"""
import json
import uuid
from datetime import date, datetime, timezone as dt_timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload
from app.core.database import get_db
from app.services import member_policy
from app.models.models import (
    Budget,
    Document,
    Expense,
    ExpenseShare,
    PlanFinanceSettings,
    Reservation,
    Settlement,
    TravelEvent,
    TravelPlan,
    TravelSegment,
    User,
)
from app.services import finance
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import member_user_ids
from app.services.readiness import member_names

# [Gate G2] FR-045 所有者が「costs」を隠した参加者には、この機能の全ての API が 403
require_plan_access = member_policy.guarded("costs")

router = APIRouter(prefix="/plans", tags=["finance"])

DEFAULT_CURRENCY = "JPY"
EXPENSE_CATEGORIES = ("lodging", "transport", "food", "activity", "shopping", "fee", "cancellation", "other")
SPLIT_METHODS = {"equal", "ratio", "amount", "none"}
RELATED_TYPES = {"event", "reservation", "segment"}
BUDGET_KINDS = {"total", "category", "day", "member"}
ACTIVE_RESERVATION = {"candidate", "confirmed", "modified", "used"}


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _plain(d: Optional[Decimal]) -> Optional[str]:
    """Decimalを指数表記なしの最短の文字列にする(150 → "150"、150.25000000 → "150.25")。"""
    if d is None:
        return None
    return format(d.normalize(), "f")


def _strip_or_none(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


def _currency(v: str) -> str:
    if not isinstance(v, str) or len(v) != 3 or not v.isascii() or not v.isalpha() or not v.isupper():
        raise ValueError("currency must be an uppercase 3-letter ISO 4217 code")
    if v in finance.THREE_DECIMAL:
        raise ValueError(f"{v}(小数3桁の通貨)には対応していません")
    return v


# ===== スキーマ =====

class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_currency: str

    @field_validator("base_currency")
    @classmethod
    def _v(cls, v):
        return _currency(v)


class BudgetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    amount: Decimal = Field(..., ge=0)
    category: Optional[str] = None
    local_date: Optional[date] = None
    note: Optional[str] = Field(None, max_length=200)

    @field_validator("kind")
    @classmethod
    def _v_kind(cls, v):
        if v not in BUDGET_KINDS:
            raise ValueError(f"kind must be one of {sorted(BUDGET_KINDS)}")
        return v

    @field_validator("category")
    @classmethod
    def _v_cat(cls, v):
        if v is not None and v not in EXPENSE_CATEGORIES:
            raise ValueError(f"category must be one of {list(EXPENSE_CATEGORIES)}")
        return v


class BudgetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Optional[Decimal] = Field(None, ge=0)
    note: Optional[str] = Field(None, max_length=200)


class ParticipantIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    weight: Optional[Decimal] = Field(None, gt=0)
    amount: Optional[Decimal] = Field(None, ge=0)


class ExpenseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., min_length=1, max_length=200)
    category: str = "other"
    local_date: Optional[date] = None
    amount: Decimal = Field(..., ge=0)
    currency: Optional[str] = None
    tax_amount: Optional[Decimal] = Field(None, ge=0)
    fee_amount: Optional[Decimal] = Field(None, ge=0)
    fx_rate: Optional[Decimal] = Field(None, gt=0)
    fx_source: Optional[str] = Field(None, max_length=100)
    fx_date: Optional[date] = None
    paid_by_user_id: Optional[str] = None
    split_method: str = "equal"
    participants: Optional[List[ParticipantIn]] = None
    related_type: Optional[str] = None
    related_id: Optional[str] = None
    receipt_document_id: Optional[str] = None
    note: Optional[str] = Field(None, max_length=500)
    kind: str = "expense"
    refund_of_expense_id: Optional[str] = None

    @field_validator("title")
    @classmethod
    def _v_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("titleを入力してください")
        return v

    @field_validator("category")
    @classmethod
    def _v_cat(cls, v):
        if v not in EXPENSE_CATEGORIES:
            raise ValueError(f"category must be one of {list(EXPENSE_CATEGORIES)}")
        return v

    @field_validator("currency")
    @classmethod
    def _v_cur(cls, v):
        return None if v is None else _currency(v)

    @field_validator("split_method")
    @classmethod
    def _v_split(cls, v):
        if v not in SPLIT_METHODS:
            raise ValueError(f"split_method must be one of {sorted(SPLIT_METHODS)}")
        return v

    @field_validator("related_type")
    @classmethod
    def _v_rel(cls, v):
        if v is not None and v not in RELATED_TYPES:
            raise ValueError(f"related_type must be one of {sorted(RELATED_TYPES)}")
        return v

    @field_validator("kind")
    @classmethod
    def _v_kind(cls, v):
        if v not in ("expense", "refund"):
            raise ValueError("kind must be expense or refund")
        return v


class SettlementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_user_id: str
    to_user_id: str
    amount: Decimal = Field(..., gt=0)
    settled_on: Optional[date] = None
    note: Optional[str] = Field(None, max_length=200)


# ===== 共通 =====

def _parse_uuid(raw, label: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{label}の形式が不正です")


def _require_if_match(revision: int, if_match: Optional[str], label: str) -> None:
    if if_match is None or if_match.strip() == "":
        raise HTTPException(status_code=status.HTTP_428_PRECONDITION_REQUIRED,
                            detail="If-Matchヘッダーが必要です(現在のリビジョンをGETで取得してから指定してください)")
    try:
        expected = int(if_match.strip().strip('"'))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="If-Matchの形式が不正です")
    if expected != revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"{label}が他の変更で更新されています(現在のリビジョン: {revision})")


def _audit(action: str, resource_type: str, request: Request, user: User, resource_id, plan_id,
           details: Optional[Dict[str, Any]] = None) -> None:
    record_audit_event(
        action=action, resource_type=resource_type, user_id=user.id, resource_id=resource_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        # 題名・メモ・金額は記録しない
        details={"plan_id": str(plan_id), **(details or {})},
    )


def _fail(e: finance.FinanceError):
    raise HTTPException(status_code=422, detail=str(e))


def _base_currency(db: Session, plan: TravelPlan) -> str:
    s = db.query(PlanFinanceSettings).filter(PlanFinanceSettings.plan_id == plan.id).first()
    return s.base_currency if s else DEFAULT_CURRENCY


MAX_AMOUNT = Decimal("9999999999999999")  # Numeric(18,2) に収まる上限


def _check_minor(amount: Optional[Decimal], currency: str, label: str) -> None:
    if amount is None:
        return
    if not amount.is_finite() or abs(amount) > MAX_AMOUNT:
        raise HTTPException(status_code=422, detail=f"{label}: 金額が大きすぎます")
    try:
        finance.to_minor(amount, currency)
    except finance.FinanceError as e:
        raise HTTPException(status_code=422, detail=f"{label}: {e}")


# ===== 基準通貨 =====

def _settings_response(db: Session, plan: TravelPlan) -> dict:
    s = db.query(PlanFinanceSettings).filter(PlanFinanceSettings.plan_id == plan.id).first()
    return {"plan_id": str(plan.id), "base_currency": s.base_currency if s else DEFAULT_CURRENCY,
            "revision": s.revision if s else 0, "is_default": s is None}


@router.get("/{plan_id}/finance-settings", response_model=dict)
def get_settings(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return _settings_response(db, plan)


@router.put("/{plan_id}/finance-settings", response_model=dict)
def put_settings(
    plan_id: str, payload: SettingsUpdate, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    s = db.query(PlanFinanceSettings).filter(PlanFinanceSettings.plan_id == plan.id).first()
    _require_if_match(s.revision if s else 0, if_match, "基準通貨")
    current = s.base_currency if s else DEFAULT_CURRENCY
    if payload.base_currency != current:
        in_use = (
            db.query(Expense.id).filter(Expense.plan_id == plan.id, Expense.deleted_at.is_(None)).first()
            or db.query(Budget.id).filter(Budget.plan_id == plan.id, Budget.deleted_at.is_(None)).first()
            or db.query(Settlement.id).filter(Settlement.plan_id == plan.id, Settlement.deleted_at.is_(None)).first()
        )
        if in_use:
            raise HTTPException(status_code=409, detail="支出・予算・精算があるため基準通貨は変更できません(換算レートが変わるため)")
    if s is None:
        s = PlanFinanceSettings(plan_id=plan.id, base_currency=payload.base_currency, revision=1)
        db.add(s)
    else:
        s.base_currency = payload.base_currency
        s.revision += 1
    db.commit()
    _audit("finance_settings_updated", "plan", request, current_user, plan.id, plan.id,
           {"base_currency": payload.base_currency})
    return _settings_response(db, plan)


# ===== 予算 =====

def _encrypt_amount(amount: Decimal) -> bytes:
    try:
        return encrypt_payload(json.dumps({"amount": str(amount)}).encode("utf-8"))
    except EncryptionNotConfigured:
        raise HTTPException(status_code=503, detail="個人の予算の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)")


def _decrypt_amount(b: Budget) -> Optional[Decimal]:
    if not b.amount_ciphertext:
        return None
    try:
        return Decimal(json.loads(decrypt_payload(b.amount_ciphertext).decode("utf-8"))["amount"])
    except (EncryptionNotConfigured, ValueError, KeyError, InvalidOperation):
        return None


def _budget_visible(b: Budget, user: User) -> bool:
    return b.kind != "member" or b.member_user_id == user.id


def _budget_amount(b: Budget) -> Optional[Decimal]:
    return _decrypt_amount(b) if b.kind == "member" else b.amount


def _budget_response(b: Budget, base: str) -> dict:
    amount = _budget_amount(b)
    return {
        "id": str(b.id), "plan_id": str(b.plan_id), "kind": b.kind, "category": b.category,
        "local_date": b.local_date.isoformat() if b.local_date else None,
        "is_private": b.kind == "member",
        "amount": finance.fmt(amount, base), "currency": base,
        "visibility": "full" if amount is not None else "unavailable",
        "note": b.note, "revision": b.revision, "updated_at": _iso(b.updated_at or b.created_at),
    }


def _budgets_query(db: Session, plan: TravelPlan):
    return db.query(Budget).filter(Budget.plan_id == plan.id, Budget.deleted_at.is_(None))


def _get_budget(db: Session, plan: TravelPlan, budget_id: str, user: User) -> Budget:
    try:
        bid = uuid.UUID(str(budget_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="予算が見つかりません")
    b = _budgets_query(db, plan).filter(Budget.id == bid).first()
    if not b or not _budget_visible(b, user):
        raise HTTPException(status_code=404, detail="予算が見つかりません")
    return b


@router.get("/{plan_id}/budgets", response_model=List[dict])
def list_budgets(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    base = _base_currency(db, plan)
    order = {"total": 0, "category": 1, "day": 2, "member": 3}
    rows = [b for b in _budgets_query(db, plan).all() if _budget_visible(b, current_user)]
    rows.sort(key=lambda b: (order[b.kind], b.category or "", b.local_date or date.min, str(b.id)))
    return [_budget_response(b, base) for b in rows]


@router.post("/{plan_id}/budgets", status_code=201, response_model=dict)
def create_budget(
    plan_id: str, payload: BudgetCreate, request: Request,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, _ = require_plan_access(
        db, plan_id, current_user, min_role="viewer" if payload.kind == "member" else "editor")
    base = _base_currency(db, plan)
    _check_minor(payload.amount, base, "予算")
    if payload.kind == "category" and payload.category is None:
        raise HTTPException(status_code=422, detail="カテゴリ別の予算にはcategoryを指定してください")
    if payload.kind == "day" and payload.local_date is None:
        raise HTTPException(status_code=422, detail="日別の予算にはlocal_dateを指定してください")
    if payload.kind != "category" and payload.category is not None:
        raise HTTPException(status_code=422, detail="categoryはカテゴリ別の予算にだけ指定できます")
    if payload.kind != "day" and payload.local_date is not None:
        raise HTTPException(status_code=422, detail="local_dateは日別の予算にだけ指定できます")
    dup = _budgets_query(db, plan).filter(Budget.kind == payload.kind)
    if payload.kind == "category":
        dup = dup.filter(Budget.category == payload.category)
    elif payload.kind == "day":
        dup = dup.filter(Budget.local_date == payload.local_date)
    elif payload.kind == "member":
        dup = dup.filter(Budget.member_user_id == current_user.id)
    if dup.first() is not None:
        raise HTTPException(status_code=409, detail="同じ対象の予算が既にあります(変更してください)")
    b = Budget(
        id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id, kind=payload.kind,
        category=payload.category, local_date=payload.local_date,
        member_user_id=current_user.id if payload.kind == "member" else None,
        note=_strip_or_none(payload.note),
    )
    if payload.kind == "member":
        b.amount_ciphertext = _encrypt_amount(payload.amount)
    else:
        b.amount = payload.amount
    db.add(b)
    db.commit()
    db.refresh(b)
    _audit("budget_created", "budget", request, current_user, b.id, plan.id, {"kind": b.kind})
    return _budget_response(b, base)


@router.patch("/{plan_id}/budgets/{budget_id}", response_model=dict)
def update_budget(
    plan_id: str, budget_id: str, payload: BudgetUpdate, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    b = _get_budget(db, plan, budget_id, current_user)
    if b.kind != "member" and role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="予算を変更する権限がありません")
    _require_if_match(b.revision, if_match, "予算")
    data = payload.model_dump(exclude_unset=True)
    base = _base_currency(db, plan)
    if "amount" in data:
        if data["amount"] is None:
            raise HTTPException(status_code=422, detail="amountにnullは指定できません")
        _check_minor(data["amount"], base, "予算")
        if b.kind == "member":
            b.amount_ciphertext = _encrypt_amount(data["amount"])
        else:
            b.amount = data["amount"]
    if "note" in data:
        b.note = _strip_or_none(data["note"])
    b.revision += 1
    db.commit()
    db.refresh(b)
    _audit("budget_updated", "budget", request, current_user, b.id, plan.id, {"kind": b.kind})
    return _budget_response(b, base)


@router.delete("/{plan_id}/budgets/{budget_id}", response_model=dict)
def delete_budget(
    plan_id: str, budget_id: str, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    b = _get_budget(db, plan, budget_id, current_user)
    if b.kind != "member" and role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="予算を削除する権限がありません")
    _require_if_match(b.revision, if_match, "予算")
    b.deleted_at = _now()
    b.revision += 1
    db.commit()
    _audit("budget_deleted", "budget", request, current_user, b.id, plan.id, {"kind": b.kind})
    return {"message": "予算を削除しました", "revision": b.revision}


# ===== 支出 =====

def _expenses_query(db: Session, plan: TravelPlan):
    return db.query(Expense).filter(Expense.plan_id == plan.id, Expense.deleted_at.is_(None))


def _get_expense(db: Session, plan: TravelPlan, expense_id: str) -> Expense:
    try:
        eid = uuid.UUID(str(expense_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="支出が見つかりません")
    e = _expenses_query(db, plan).filter(Expense.id == eid).first()
    if not e:
        raise HTTPException(status_code=404, detail="支出が見つかりません")
    return e


def _related_label(db: Session, plan: TravelPlan, related_type: Optional[str], related_id):
    if not related_type or not related_id:
        return None, False
    if related_type == "event":
        ev = db.query(TravelEvent).filter(TravelEvent.id == related_id, TravelEvent.plan_id == plan.id).first()
        return (ev.title, False) if ev else (None, True)
    if related_type == "reservation":
        r = db.query(Reservation).filter(Reservation.id == related_id, Reservation.plan_id == plan.id,
                                         Reservation.deleted_at.is_(None)).first()
        return ((r.provider_name or r.type), False) if r else (None, True)
    s = db.query(TravelSegment).filter(TravelSegment.id == related_id, TravelSegment.plan_id == plan.id).first()
    return ("移動区間", False) if s else (None, True)


def _receipt_exists(db: Session, plan: TravelPlan, doc_id) -> bool:
    return db.query(Document.id).filter(Document.id == doc_id, Document.plan_id == plan.id,
                                        Document.deleted_at.is_(None)).first() is not None


def _expense_response(db: Session, plan: TravelPlan, e: Expense, base: str, members: Set[uuid.UUID],
                      names: Dict[uuid.UUID, str], refunded: Dict[uuid.UUID, Decimal]) -> dict:
    label, missing = _related_label(db, plan, e.related_type, e.related_id)
    receipt_missing = bool(e.receipt_document_id) and not _receipt_exists(db, plan, e.receipt_document_id)
    return {
        "id": str(e.id), "plan_id": str(e.plan_id), "kind": e.kind,
        "refund_of_expense_id": str(e.refund_of_expense_id) if e.refund_of_expense_id else None,
        "title": e.title, "category": e.category,
        "local_date": e.local_date.isoformat() if e.local_date else None,
        "amount": finance.fmt(e.amount, e.currency), "currency": e.currency,
        "tax_amount": finance.fmt(e.tax_amount, e.currency), "fee_amount": finance.fmt(e.fee_amount, e.currency),
        "fx_rate": _plain(e.fx_rate),
        "fx_source": e.fx_source, "fx_date": e.fx_date.isoformat() if e.fx_date else None,
        "base_amount": finance.fmt(e.base_amount, base), "base_currency": base,
        "is_converted": e.base_amount is not None,
        "refunded_amount": finance.fmt(refunded.get(e.id, Decimal(0)), e.currency) if e.kind == "expense" else None,
        "paid_by_user_id": str(e.paid_by_user_id), "paid_by_name": names.get(e.paid_by_user_id, "メンバー外"),
        "paid_by_is_member": e.paid_by_user_id in members,
        "split_method": e.split_method,
        "shares": [
            {
                "user_id": str(s.user_id), "name": names.get(s.user_id, "メンバー外"), "is_member": s.user_id in members,
                "weight": _plain(s.weight),
                "share_amount": finance.fmt(s.share_amount, e.currency),
                "base_share_amount": finance.fmt(s.base_share_amount, base),
                "rounding_adjustment": finance.fmt(s.rounding_adjustment, e.currency),
            }
            for s in e.shares
        ],
        "related_type": e.related_type, "related_id": str(e.related_id) if e.related_id else None,
        "related_label": label, "related_missing": missing,
        "receipt_document_id": str(e.receipt_document_id) if e.receipt_document_id else None,
        "receipt_missing": receipt_missing,
        "note": e.note, "revision": e.revision,
        "created_at": _iso(e.created_at), "updated_at": _iso(e.updated_at),
    }


def _refunded_totals(db: Session, plan: TravelPlan) -> Dict[uuid.UUID, Decimal]:
    out: Dict[uuid.UUID, Decimal] = {}
    for r in _expenses_query(db, plan).filter(Expense.kind == "refund").all():
        out[r.refund_of_expense_id] = out.get(r.refund_of_expense_id, Decimal(0)) + r.amount
    return out


def _all_names(db: Session, plan: TravelPlan, expenses: List[Expense], members: Set[uuid.UUID]):
    ids = set(members)
    for e in expenses:
        ids.add(e.paid_by_user_id)
        ids.update(s.user_id for s in e.shares)
    return member_names(db, ids)


def _apply_expense(db: Session, plan: TravelPlan, e: Expense, data: Dict[str, Any], base: str,
                   members: Set[uuid.UUID], current_user: User, allowed_extra: Set[uuid.UUID]) -> None:
    """data(作成時は全項目、変更時は既存値とマージ済み)を検証し、e と分担行を更新する。"""
    currency = data["currency"]
    for key, label in (("amount", "金額"), ("tax_amount", "税"), ("fee_amount", "手数料")):
        _check_minor(data.get(key), currency, label)
    for key, label in (("tax_amount", "税"), ("fee_amount", "手数料")):
        if data.get(key) is not None and data[key] > data["amount"]:
            raise HTTPException(status_code=422, detail=f"{label}は金額以下にしてください")
    rate = data.get("fx_rate")
    if currency == base:
        if rate is not None and rate != Decimal(1):
            raise HTTPException(status_code=422, detail="基準通貨の支出に換算レートは指定できません")
        rate = Decimal(1)
    allowed = members | allowed_extra
    payer = _parse_uuid(data["paid_by_user_id"], "paid_by_user_id")
    if payer not in allowed:
        raise HTTPException(status_code=422, detail="支払者はこのプランのメンバーから選んでください")

    participants_in = data.get("participants")
    if participants_in is None:
        participants = [finance.Participant(uid) for uid in sorted(members, key=str)]
    else:
        participants = []
        for p in participants_in:
            uid = _parse_uuid(p["user_id"], "participants.user_id")
            if uid not in allowed:
                raise HTTPException(status_code=422, detail="負担者はこのプランのメンバーから選んでください")
            participants.append(finance.Participant(uid, p.get("weight"), p.get("amount")))
    try:
        shares = finance.split(data["amount"], currency, data["split_method"], participants, payer)
    except finance.FinanceError as err:
        _fail(err)

    base_amount = finance.convert(data["amount"], rate, base) if rate is not None else None
    base_shares = finance.split_base(base_amount, base, shares) if base_amount is not None else [None] * len(shares)

    related_type = data.get("related_type")
    related_id = data.get("related_id")
    if (related_type is None) != (related_id is None):
        raise HTTPException(status_code=422, detail="related_typeとrelated_idは両方指定してください")
    rid = None
    if related_type is not None:
        rid = _parse_uuid(related_id, "related_id")
        _label, missing = _related_label(db, plan, related_type, rid)
        if missing and (e.related_id != rid):
            raise HTTPException(status_code=422, detail="関連先がこのプラン内に見つかりません")
    receipt = data.get("receipt_document_id")
    receipt_id = None
    if receipt is not None:
        receipt_id = _parse_uuid(receipt, "receipt_document_id")
        if receipt_id != e.receipt_document_id and not _receipt_exists(db, plan, receipt_id):
            raise HTTPException(status_code=422, detail="領収書の文書がこのプラン内に見つかりません")

    e.title = data["title"]
    e.category = data["category"]
    e.local_date = data.get("local_date")
    e.amount = data["amount"]
    e.currency = currency
    e.tax_amount = data.get("tax_amount")
    e.fee_amount = data.get("fee_amount")
    e.fx_rate = rate
    e.fx_source = None if currency == base else _strip_or_none(data.get("fx_source"))
    e.fx_date = None if currency == base else data.get("fx_date")
    e.base_amount = base_amount
    e.paid_by_user_id = payer
    e.split_method = data["split_method"]
    e.related_type = related_type
    e.related_id = rid
    e.receipt_document_id = receipt_id
    e.note = _strip_or_none(data.get("note"))
    if e.shares:
        # 一意制約(expense_id, user_id)に当たらないよう、古い分担行を先に削除してから作り直す
        e.shares.clear()
        db.flush()
    e.shares = [
        ExpenseShare(
            id=uuid.uuid4(), user_id=s.user_id, sort_order=i, weight=s.weight,
            share_amount=finance.from_minor(s.share_minor, currency),
            base_share_amount=finance.from_minor(b, base) if b is not None else None,
            rounding_adjustment=finance.from_minor(s.adjustment_minor, currency),
        )
        for i, (s, b) in enumerate(zip(shares, base_shares))
    ]


@router.get("/{plan_id}/expenses", response_model=List[dict])
def list_expenses(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    base = _base_currency(db, plan)
    members = member_user_ids(db, plan)
    rows = _expenses_query(db, plan).all()
    rows.sort(key=lambda e: (e.local_date or date.max, e.created_at or _now(), str(e.id)))
    names = _all_names(db, plan, rows, members)
    refunded = _refunded_totals(db, plan)
    return [_expense_response(db, plan, e, base, members, names, refunded) for e in rows]


@router.post("/{plan_id}/expenses", status_code=201, response_model=dict)
def create_expense(
    plan_id: str, payload: ExpenseCreate, request: Request,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    base = _base_currency(db, plan)
    members = member_user_ids(db, plan)
    data = payload.model_dump()
    data["currency"] = data["currency"] or base
    data["paid_by_user_id"] = data["paid_by_user_id"] or str(current_user.id)
    if data["participants"] is not None:
        data["participants"] = [p for p in data["participants"]]

    refund_of = None
    if payload.kind == "refund":
        if not payload.refund_of_expense_id:
            raise HTTPException(status_code=422, detail="返金には元の支出(refund_of_expense_id)を指定してください")
        refund_of = _get_expense(db, plan, payload.refund_of_expense_id)
        if refund_of.kind != "expense":
            raise HTTPException(status_code=422, detail="返金の元には支出を指定してください")
        if data["currency"] != refund_of.currency:
            raise HTTPException(status_code=422, detail="返金は元の支出と同じ通貨で入力してください")
        already = _refunded_totals(db, plan).get(refund_of.id, Decimal(0))
        if already + payload.amount > refund_of.amount:
            raise HTTPException(status_code=422, detail="返金の合計が元の支出額を超えます")
        if payload.fx_rate is None and refund_of.fx_rate is not None:
            data["fx_rate"] = refund_of.fx_rate
        if payload.participants is None and payload.split_method == "equal" and refund_of.shares:
            # 既定では元の支出の負担割合で返金を分ける
            data["split_method"] = "ratio"
            data["participants"] = [
                {"user_id": str(s.user_id), "weight": s.share_amount if s.share_amount > 0 else None, "amount": None}
                for s in refund_of.shares if s.share_amount > 0
            ] or None
            if data["participants"] is None:
                data["split_method"] = "none"
    elif payload.refund_of_expense_id:
        raise HTTPException(status_code=422, detail="refund_of_expense_idは返金にだけ指定できます")

    e = Expense(id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id, kind=payload.kind,
                refund_of_expense_id=refund_of.id if refund_of else None)
    _apply_expense(db, plan, e, data, base, members, current_user, set())
    db.add(e)
    db.commit()
    db.refresh(e)
    _audit("expense_created", "expense", request, current_user, e.id, plan.id,
           {"kind": e.kind, "split_method": e.split_method})
    names = _all_names(db, plan, [e], members)
    return _expense_response(db, plan, e, base, members, names, _refunded_totals(db, plan))


@router.patch("/{plan_id}/expenses/{expense_id}", response_model=dict)
def update_expense(
    plan_id: str, expense_id: str, payload: Dict[str, Any], request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    e = _get_expense(db, plan, expense_id)
    _require_if_match(e.revision, if_match, "支出")
    forbidden = {"kind", "refund_of_expense_id"} & set(payload)
    if forbidden:
        raise HTTPException(status_code=422, detail="支出と返金の種別・返金元は変更できません")
    base = _base_currency(db, plan)
    members = member_user_ids(db, plan)
    current = {
        "title": e.title, "category": e.category, "local_date": e.local_date, "amount": e.amount,
        "currency": e.currency, "tax_amount": e.tax_amount, "fee_amount": e.fee_amount,
        "fx_rate": e.fx_rate if e.currency != base else None, "fx_source": e.fx_source, "fx_date": e.fx_date,
        "paid_by_user_id": str(e.paid_by_user_id), "split_method": e.split_method,
        "participants": [
            {"user_id": str(s.user_id), "weight": s.weight,
             "amount": s.share_amount if e.split_method == "amount" else None}
            for s in e.shares
        ] if e.split_method != "none" else None,
        "related_type": e.related_type, "related_id": str(e.related_id) if e.related_id else None,
        "receipt_document_id": str(e.receipt_document_id) if e.receipt_document_id else None,
        "note": e.note,
    }
    if "currency" in payload and "fx_rate" not in payload:
        current["fx_rate"] = None  # 通貨を変えたら以前のレートは引き継がない
    try:
        merged = ExpenseCreate.model_validate({**current, **payload}).model_dump()
    except ValidationError as err:
        first = err.errors()[0]
        loc = ".".join(str(x) for x in first.get("loc", ()))
        raise HTTPException(status_code=422, detail=f"{loc}: {first.get('msg')}")
    merged["currency"] = merged["currency"] or base
    if e.kind == "refund":
        original = db.query(Expense).filter(Expense.id == e.refund_of_expense_id).first()
        if original is not None:
            if merged["currency"] != original.currency:
                raise HTTPException(status_code=422, detail="返金は元の支出と同じ通貨で入力してください")
            others = _refunded_totals(db, plan).get(original.id, Decimal(0)) - e.amount
            if others + merged["amount"] > original.amount:
                raise HTTPException(status_code=422, detail="返金の合計が元の支出額を超えます")
    elif "amount" in payload:
        refunded = _refunded_totals(db, plan).get(e.id, Decimal(0))
        if merged["amount"] < refunded:
            raise HTTPException(status_code=422, detail="支出額は返金済みの額以上にしてください")
    previous_users = {s.user_id for s in e.shares} | {e.paid_by_user_id}
    _apply_expense(db, plan, e, merged, base, members, current_user, previous_users)
    e.revision += 1
    db.commit()
    db.refresh(e)
    _audit("expense_updated", "expense", request, current_user, e.id, plan.id,
           {"fields": sorted(payload), "split_method": e.split_method})
    names = _all_names(db, plan, [e], members)
    return _expense_response(db, plan, e, base, members, names, _refunded_totals(db, plan))


@router.delete("/{plan_id}/expenses/{expense_id}", response_model=dict)
def delete_expense(
    plan_id: str, expense_id: str, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    e = _get_expense(db, plan, expense_id)
    _require_if_match(e.revision, if_match, "支出")
    if e.kind == "expense" and _expenses_query(db, plan).filter(Expense.refund_of_expense_id == e.id).first():
        raise HTTPException(status_code=409, detail="返金が登録されている支出は削除できません(先に返金を削除してください)")
    e.deleted_at = _now()
    e.revision += 1
    db.commit()
    _audit("expense_deleted", "expense", request, current_user, e.id, plan.id, {"kind": e.kind})
    return {"message": "支出を削除しました", "revision": e.revision}


# ===== 精算 =====

def _settlements_query(db: Session, plan: TravelPlan):
    return db.query(Settlement).filter(Settlement.plan_id == plan.id, Settlement.deleted_at.is_(None))


def _settlement_response(s: Settlement, names: Dict[uuid.UUID, str]) -> dict:
    return {
        "id": str(s.id), "plan_id": str(s.plan_id),
        "from_user_id": str(s.from_user_id), "from_name": names.get(s.from_user_id, "メンバー外"),
        "to_user_id": str(s.to_user_id), "to_name": names.get(s.to_user_id, "メンバー外"),
        "amount": finance.fmt(s.amount, s.currency), "currency": s.currency,
        "settled_on": s.settled_on.isoformat() if s.settled_on else None, "note": s.note,
        "revision": s.revision, "created_at": _iso(s.created_at),
    }


@router.get("/{plan_id}/settlements", response_model=List[dict])
def list_settlements(plan_id: str, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = _settlements_query(db, plan).all()
    rows.sort(key=lambda s: (s.created_at or _now(), str(s.id)))
    names = member_names(db, {s.from_user_id for s in rows} | {s.to_user_id for s in rows})
    return [_settlement_response(s, names) for s in rows]


@router.post("/{plan_id}/settlements", status_code=201, response_model=dict)
def create_settlement(
    plan_id: str, payload: SettlementCreate, request: Request,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    base = _base_currency(db, plan)
    from_id = _parse_uuid(payload.from_user_id, "from_user_id")
    to_id = _parse_uuid(payload.to_user_id, "to_user_id")
    if from_id == to_id:
        raise HTTPException(status_code=422, detail="支払う人と受け取る人は別の人にしてください")
    if role not in ("owner", "editor") and current_user.id not in (from_id, to_id):
        raise HTTPException(status_code=403, detail="精算を記録できるのは編集者か、支払う人・受け取る人本人です")
    involved = {e.paid_by_user_id for e in _expenses_query(db, plan).all()}
    for e in _expenses_query(db, plan).all():
        involved.update(s.user_id for s in e.shares)
    allowed = member_user_ids(db, plan) | involved
    if from_id not in allowed or to_id not in allowed:
        raise HTTPException(status_code=422, detail="精算はこのプランのメンバー(または支出に関わった人)の間で記録してください")
    _check_minor(payload.amount, base, "精算額")
    s = Settlement(id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id, from_user_id=from_id,
                   to_user_id=to_id, amount=payload.amount, currency=base, settled_on=payload.settled_on,
                   note=_strip_or_none(payload.note))
    db.add(s)
    db.commit()
    db.refresh(s)
    _audit("settlement_created", "settlement", request, current_user, s.id, plan.id)
    return _settlement_response(s, member_names(db, {from_id, to_id}))


@router.delete("/{plan_id}/settlements/{settlement_id}", response_model=dict)
def delete_settlement(
    plan_id: str, settlement_id: str, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    try:
        sid = uuid.UUID(str(settlement_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="精算が見つかりません")
    s = _settlements_query(db, plan).filter(Settlement.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="精算が見つかりません")
    if role not in ("owner", "editor") and s.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="精算を取り消せるのは記録した人か編集者です")
    _require_if_match(s.revision, if_match, "精算")
    s.deleted_at = _now()
    s.revision += 1
    db.commit()
    _audit("settlement_deleted", "settlement", request, current_user, s.id, plan.id)
    return {"message": "精算を取り消しました", "revision": s.revision}


# ===== 集計 =====

@router.get("/{plan_id}/finance-summary", response_model=dict)
def finance_summary(plan_id: str, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    base = _base_currency(db, plan)
    members = member_user_ids(db, plan)
    expenses = _expenses_query(db, plan).all()
    settlements = [s for s in _settlements_query(db, plan).all() if s.currency == base]

    views = []
    tax = fee = 0
    unconverted = 0
    for e in expenses:
        if e.base_amount is None:
            unconverted += 1
            views.append(finance.ExpenseView(e.kind, e.category, None, e.paid_by_user_id, None, 0, 0, {}))
            continue
        sign = -1 if e.kind == "refund" else 1
        if e.tax_amount is not None:
            tax += sign * finance.to_minor(finance.convert(e.tax_amount, e.fx_rate, base), base)
        if e.fee_amount is not None:
            fee += sign * finance.to_minor(finance.convert(e.fee_amount, e.fx_rate, base), base)
        views.append(finance.ExpenseView(
            kind=e.kind, category=e.category, local_date=e.local_date.isoformat() if e.local_date else None,
            paid_by=e.paid_by_user_id, base_minor=finance.to_minor(e.base_amount, base), tax_minor=0, fee_minor=0,
            shares={s.user_id: finance.to_minor(s.base_share_amount, base) for s in e.shares
                    if s.base_share_amount is not None},
        ))
    sviews = [finance.SettlementView(s.from_user_id, s.to_user_id, finance.to_minor(s.amount, base))
              for s in settlements]
    bal = finance.balances(views, sviews)
    for uid in members:
        bal.setdefault(uid, {"paid": 0, "owed": 0, "settled_out": 0, "settled_in": 0, "net": 0})
    names = member_names(db, set(bal))

    def money(minor: Optional[int]) -> Optional[str]:
        return None if minor is None else str(finance.from_minor(minor, base))

    actual_total = sum(
        (-v.base_minor if v.kind == "refund" else v.base_minor) for v in views if v.base_minor is not None
    )
    refund_total = sum(v.base_minor for v in views if v.base_minor is not None and v.kind == "refund")
    by_cat = finance.actual_by(views, "category")
    by_day = finance.actual_by(views, "local_date")

    budgets = [b for b in db.query(Budget).filter(Budget.plan_id == plan.id, Budget.deleted_at.is_(None)).all()]
    total_budget = next((b.amount for b in budgets if b.kind == "total"), None)
    cat_budgets = {b.category: b.amount for b in budgets if b.kind == "category"}
    day_budgets = {b.local_date.isoformat(): b.amount for b in budgets if b.kind == "day"}
    my_budget_row = next((b for b in budgets if b.kind == "member" and b.member_user_id == current_user.id), None)

    def diff_row(budget: Optional[Decimal], actual_minor: int) -> dict:
        bm = finance.to_minor(budget, base) if budget is not None else None
        return {
            "budget": money(bm), "actual": money(actual_minor),
            "remaining": money(bm - actual_minor) if bm is not None else None,
            "over": bm is not None and actual_minor > bm,
        }

    by_category = []
    for cat in EXPENSE_CATEGORIES:
        if cat in cat_budgets or by_cat.get(cat):
            by_category.append({"category": cat, **diff_row(cat_budgets.get(cat), by_cat.get(cat, 0))})
    days = sorted({d for d in by_day if d is not None} | set(day_budgets))
    by_day_rows = [{"local_date": d, **diff_row(day_budgets.get(d), by_day.get(d, 0))} for d in days]
    undated = by_day.get(None, 0)

    my_budget = None
    if my_budget_row is not None:
        amount = _decrypt_amount(my_budget_row)
        my_owed = bal.get(current_user.id, {}).get("owed", 0)
        my_budget = {"id": str(my_budget_row.id), **diff_row(amount, my_owed),
                     "visibility": "full" if amount is not None else "unavailable"}

    reserved_minor = 0
    reserved_unconverted = 0
    for r in db.query(Reservation).filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None)).all():
        if r.total_amount is None or r.status not in ACTIVE_RESERVATION:
            continue
        if r.currency != base:
            reserved_unconverted += 1
            continue
        try:
            reserved_minor += finance.to_minor(Decimal(str(r.total_amount)).quantize(
                Decimal(1).scaleb(-finance.minor_digits(base))), base)
        except finance.FinanceError:
            reserved_unconverted += 1

    member_rows = []
    for uid, row in bal.items():
        member_rows.append({
            "user_id": str(uid), "name": names.get(uid, "メンバー外"), "is_member": uid in members,
            "is_me": uid == current_user.id,
            **{k: money(v) for k, v in row.items()},
        })
    member_rows.sort(key=lambda r: (not r["is_me"], r["name"]))
    transfers = [
        {"from_user_id": str(f), "from_name": names.get(f, "メンバー外"), "to_user_id": str(t),
         "to_name": names.get(t, "メンバー外"), "amount": money(a)}
        for f, t, a in finance.suggest_transfers({uid: r["net"] for uid, r in bal.items()})
    ]
    return {
        "plan_id": str(plan.id),
        "algorithm_version": finance.ALGORITHM_VERSION,
        "base_currency": base,
        "total": diff_row(total_budget, actual_total),
        "tax_total": money(tax), "fee_total": money(fee), "refund_total": money(refund_total),
        "reserved": {"total": money(reserved_minor), "unconverted": reserved_unconverted},
        "by_category": by_category,
        "by_day": by_day_rows,
        "undated_actual": money(undated),
        "my_budget": my_budget,
        "unconverted_expenses": unconverted,
        "members": member_rows,
        "transfers": transfers,
        "is_settled": all(r["net"] == 0 for r in bal.values()),
    }
