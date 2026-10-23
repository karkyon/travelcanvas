"""[Gate G5] FIN-01 為替の記録・予算の版 / FIN-02 支出の取消・精算の締め(すべて /plans/{plan_id} 配下)。

- GET/POST /fx-rates                 : 為替の記録(1 currency = rate base_currency。出典・基準日・取得時刻)。閲覧 viewer、記録 editor
- GET/POST /budget-versions          : 予算の版(initial 当初・revised 更新・committed 確定(予約)・actual 実績)。
                                       作った時点の写しで、後から変わらない。当初は1つだけ。閲覧 viewer、作成 editor
- POST /expenses/{id}/void           : 支出の取消(理由は必須。消さずに集計・精算から外す)。editor・If-Match
- POST /finance-lock                 : 精算を締める(editor)。DELETE /finance-lock は解除(owner だけ。理由は必須)

権限・監査の決まりは app/api/v1/finance.py と同じ(題名・メモ・金額を監査に残さない)。
"""
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.api.v1 import finance as fin
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import Budget, BudgetVersion, Expense, FxRate, PlanFinanceSettings, TravelPlan, User
from app.services import finance

require_plan_access = fin.require_plan_access
router = APIRouter(prefix="/plans", tags=["finance"])

VERSION_KINDS = ("initial", "revised", "committed", "actual")
COMMITTED_RESERVATION = {"confirmed", "modified", "used"}
MAX_RATES = 500
MAX_VERSIONS = 100


class FxRateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    currency: str
    rate: Decimal = Field(..., gt=0)
    rate_date: date
    source: str = Field("手入力", min_length=1, max_length=100)
    retrieved_at: Optional[datetime] = None

    @field_validator("currency")
    @classmethod
    def _v_cur(cls, v):
        return fin._currency(v)

    @field_validator("source")
    @classmethod
    def _v_src(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("出典を入力してください")
        return v


class VersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    label: Optional[str] = Field(None, max_length=100)
    note: Optional[str] = Field(None, max_length=200)

    @field_validator("kind")
    @classmethod
    def _v_kind(cls, v):
        if v not in VERSION_KINDS:
            raise ValueError(f"kind must be one of {list(VERSION_KINDS)}")
        return v


def _rate_response(r: Any) -> Dict[str, Any]:
    return {"id": str(r.id), "plan_id": str(r.plan_id), "currency": r.currency, "base_currency": r.base_currency,
            "rate": fin._plain(r.rate), "rate_date": r.rate_date.isoformat(), "source": r.source,
            "retrieved_at": fin._iso(r.retrieved_at), "created_at": fin._iso(r.created_at)}


@router.get("/{plan_id}/fx-rates", response_model=List[dict])
def list_rates(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (db.query(FxRate).filter(FxRate.plan_id == plan.id)
            .order_by(FxRate.currency.asc(), FxRate.rate_date.desc(), FxRate.retrieved_at.desc()).all())
    return [_rate_response(r) for r in rows]


@router.post("/{plan_id}/fx-rates", status_code=201, response_model=dict)
def create_rate(plan_id: str, payload: FxRateCreate, request: Request, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    base = fin._base_currency(db, plan)
    if payload.currency == base:
        raise HTTPException(status_code=422, detail="基準通貨の為替は記録できません")
    if not payload.rate.is_finite() or payload.rate >= Decimal("10000000000"):
        raise HTTPException(status_code=422, detail="為替の値が大きすぎます")
    if payload.rate != payload.rate.quantize(Decimal("0.00000001")):
        raise HTTPException(status_code=422, detail="為替は小数8桁までで入力してください")
    if db.query(FxRate).filter(FxRate.plan_id == plan.id).count() >= MAX_RATES:
        raise HTTPException(status_code=409, detail={"code": "too_many_fx_rates",
                                                     "message": f"為替の記録は{MAX_RATES}件までです"})
    retrieved = payload.retrieved_at or fin._now()
    if retrieved.tzinfo is None:
        raise HTTPException(status_code=422, detail="retrieved_atには時差(+09:00 等)を付けてください")
    r: Any = None
    r = FxRate(id=uuid.uuid4(), plan_id=plan.id, currency=payload.currency, base_currency=base, rate=payload.rate,
               rate_date=payload.rate_date, source=payload.source, retrieved_at=retrieved,
               created_by_user_id=current_user.id, created_at=fin._now())
    db.add(r)
    db.commit()
    db.refresh(r)
    fin._audit("fx_rate_created", "plan", request, current_user, r.id, plan.id, {"currency": r.currency})
    return _rate_response(r)


# ===== 予算の版

def _money(minor: int, base: str) -> str:
    return str(finance.from_minor(minor, base))


def _budget_lines(db: Session, plan: TravelPlan, base: str):
    budgets: List[Any] = db.query(Budget).filter(Budget.plan_id == plan.id, Budget.deleted_at.is_(None),
                                                 Budget.kind != "member").all()
    lines: List[Dict[str, Any]] = []
    total = next((b.amount for b in budgets if b.kind == "total"), None)
    cats = sorted((b for b in budgets if b.kind == "category"), key=lambda b: fin.EXPENSE_CATEGORIES.index(b.category))
    for b in cats:
        lines.append({"key": f"category:{b.category}", "label": b.category, "amount": finance.fmt(b.amount, base)})
    for b in sorted((b for b in budgets if b.kind == "day"), key=lambda b: b.local_date):
        lines.append({"key": f"day:{b.local_date.isoformat()}", "label": b.local_date.isoformat(),
                      "amount": finance.fmt(b.amount, base)})
    if total is None:
        total = sum((b.amount for b in cats), Decimal(0))
    return lines, Decimal(total), None


def _committed_lines(db: Session, plan: TravelPlan, base: str, rounding: str):
    res = fin.reserved_amounts(db, plan, base, rounding, statuses=COMMITTED_RESERVATION)
    lines = [{"key": f"reservation:{t}", "label": t, "amount": _money(v, base)}
             for t, v in sorted(res["by_type"].items())]
    unconverted = res["unconverted_by_currency"] or None
    return lines, finance.from_minor(res["minor"], base), unconverted


def _actual_lines(db: Session, plan: TravelPlan, base: str):
    expenses: List[Any] = fin._active_expenses_query(db, plan).all()
    by_cat: Dict[str, int] = {}
    unconverted: Dict[str, Decimal] = {}
    total = 0
    for e in expenses:
        sign = -1 if e.kind == "refund" else 1
        if e.base_amount is None:
            unconverted[e.currency] = unconverted.get(e.currency, Decimal(0)) + sign * e.amount
            continue
        v = sign * finance.to_minor(e.base_amount, base)
        by_cat[e.category] = by_cat.get(e.category, 0) + v
        total += v
    lines = [{"key": f"category:{c}", "label": c, "amount": _money(by_cat[c], base)}
             for c in fin.EXPENSE_CATEGORIES if c in by_cat]
    unc = {k: fin._plain(v) for k, v in sorted(unconverted.items())} or None
    return lines, finance.from_minor(total, base), unc


def _version_response(v: Any) -> Dict[str, Any]:
    return {"id": str(v.id), "plan_id": str(v.plan_id), "kind": v.kind, "label": v.label,
            "base_currency": v.base_currency, "total_amount": finance.fmt(v.total_amount, v.base_currency),
            "lines": v.lines or [], "unconverted": v.unconverted or {}, "note": v.note,
            "created_by_user_id": str(v.created_by_user_id) if v.created_by_user_id else None,
            "created_at": fin._iso(v.created_at)}


DEFAULT_LABELS = {"initial": "当初の予算", "revised": "更新した予算", "committed": "確定した予約", "actual": "実績"}


@router.get("/{plan_id}/budget-versions", response_model=List[dict])
def list_versions(plan_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (db.query(BudgetVersion).filter(BudgetVersion.plan_id == plan.id)
            .order_by(BudgetVersion.created_at.asc(), BudgetVersion.id.asc()).all())
    return [_version_response(v) for v in rows]


@router.post("/{plan_id}/budget-versions", status_code=201, response_model=dict)
def create_version(plan_id: str, payload: VersionCreate, request: Request, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    base = fin._base_currency(db, plan)
    rounding, _rem = fin._policy(db, plan)
    q = db.query(BudgetVersion).filter(BudgetVersion.plan_id == plan.id)
    if q.count() >= MAX_VERSIONS:
        raise HTTPException(status_code=409, detail={"code": "too_many_budget_versions",
                                                     "message": f"予算の版は{MAX_VERSIONS}件までです"})
    if payload.kind == "initial" and q.filter(BudgetVersion.kind == "initial").first() is not None:
        raise HTTPException(status_code=409, detail={"code": "budget_initial_exists",
                                                     "message": "当初の予算の版は1つだけです(変えた後は「更新」で残してください)"})
    if payload.kind in ("initial", "revised"):
        lines, total, unconverted = _budget_lines(db, plan, base)
        if not lines and total == 0:
            raise HTTPException(status_code=422, detail={"code": "budget_empty",
                                                         "message": "予算(旅行全体かカテゴリ別)を入れてから版を残してください"})
    elif payload.kind == "committed":
        lines, total, unconverted = _committed_lines(db, plan, base, rounding)
    else:
        lines, total, unconverted = _actual_lines(db, plan, base)
    v: Any = None
    v = BudgetVersion(id=uuid.uuid4(), plan_id=plan.id, kind=payload.kind,
                      label=fin._strip_or_none(payload.label) or DEFAULT_LABELS[payload.kind], base_currency=base,
                      total_amount=total, lines=lines, unconverted=unconverted, note=fin._strip_or_none(payload.note),
                      created_by_user_id=current_user.id, created_at=fin._now())
    db.add(v)
    db.commit()
    db.refresh(v)
    fin._audit("budget_version_created", "plan", request, current_user, v.id, plan.id, {"kind": v.kind})
    return _version_response(v)


# ===== 取消・締め

@router.post("/{plan_id}/expenses/{expense_id}/void", response_model=dict)
def void_expense(plan_id: str, expense_id: str, request: Request, payload: Optional[dict] = Body(None),
                 if_match: Optional[str] = Header(None, alias="If-Match"),
                 db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    e: Any = fin._get_expense(db, plan, expense_id)
    fin._require_if_match(e.revision, if_match, "支出")
    fin.assert_unlocked(db, plan)
    reason = (payload or {}).get("reason") if isinstance(payload, dict) else None
    if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 200:
        raise HTTPException(status_code=422, detail={"code": "void_reason_required",
                                                     "message": "取り消す理由を200文字までで入力してください"})
    if e.voided_at is not None:
        raise HTTPException(status_code=409, detail={"code": "expense_voided", "message": "この支出は取り消し済みです"})
    if e.kind == "expense" and fin._active_expenses_query(db, plan).filter(
            Expense.refund_of_expense_id == e.id).first() is not None:
        raise HTTPException(status_code=409, detail={"code": "expense_has_refunds",
                                                     "message": "返金が登録されている支出は取り消せません(先に返金を取り消してください)"})
    e.voided_at, e.void_reason, e.voided_by_user_id = fin._now(), " ".join(reason.split()), current_user.id
    e.revision += 1
    db.commit()
    db.refresh(e)
    fin._audit("expense_voided", "expense", request, current_user, e.id, plan.id, {"kind": e.kind})
    members = fin.member_user_ids(db, plan)
    names = fin._all_names(db, plan, [e], members)
    return fin._expense_response(db, plan, e, fin._base_currency(db, plan), members, names,
                                 fin._refunded_totals(db, plan))


def _settings_row(db: Session, plan: TravelPlan) -> Any:
    s: Any = (db.query(PlanFinanceSettings).filter(PlanFinanceSettings.plan_id == plan.id).with_for_update().first())
    if s is None:
        s = PlanFinanceSettings(plan_id=plan.id, base_currency=fin.DEFAULT_CURRENCY, revision=0,
                                rounding_mode="half_up", remainder_to="largest")
        db.add(s)
        db.flush()
    return s


@router.post("/{plan_id}/finance-lock", response_model=dict)
def lock_finance(plan_id: str, request: Request, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    s = _settings_row(db, plan)
    if s.locked_at is not None:
        raise HTTPException(status_code=409, detail={"code": "finance_locked", "message": "精算はすでに締めています"})
    s.locked_at, s.locked_by_user_id = fin._now(), current_user.id
    s.revision += 1
    db.commit()
    fin._audit("finance_locked", "plan", request, current_user, plan.id, plan.id)
    return fin._settings_response(db, plan)


@router.delete("/{plan_id}/finance-lock", response_model=dict)
def unlock_finance(plan_id: str, request: Request, payload: Optional[dict] = Body(None),
                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    if role != "owner":
        raise HTTPException(status_code=403, detail={"code": "finance_unlock_owner_only",
                                                     "message": "締めを解除できるのは旅行の所有者だけです"})
    reason = (payload or {}).get("reason") if isinstance(payload, dict) else None
    if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 200:
        raise HTTPException(status_code=422, detail={"code": "unlock_reason_required",
                                                     "message": "締めを解除する理由を200文字までで入力してください"})
    s = _settings_row(db, plan)
    if s.locked_at is None:
        raise HTTPException(status_code=409, detail={"code": "finance_not_locked", "message": "精算は締めていません"})
    s.locked_at, s.locked_by_user_id = None, None
    s.revision += 1
    db.commit()
    fin._audit("finance_unlocked", "plan", request, current_user, plan.id, plan.id)
    return fin._settings_response(db, plan)
