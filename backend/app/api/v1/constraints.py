"""
[Gate L2] FR-016 制約管理(DOC-02 FR-016 / DOC-05 §7.3 constraints / DOC-06 §10・§21)。

`/plans/{plan_id}/constraints` のCRUD。

- ハード制約(違反できない条件)とソフト制約(違反に重み付きのペナルティ)を扱う。
- 適用範囲: plan(グループ全体)/ day(日)/ event(イベント)/ member(個人)。
- 秘匿(private)制約: 題名・種類・演算子・値・有効期間は作成者本人にだけ返す。
  他のメンバー(プラン所有者を含む)には「秘匿制約が存在する・hard/softの別・
  適用範囲の種類・有効か」だけを返す(visibility='masked')。判定(L3以降)には
  app/services/constraint_evaluation.py が復号した値を内部でのみ使う。
- 理由(reason)は共有/秘匿に関係なく常に暗号化し、作成者本人にだけ返す。

権限(DOC-06 §21「Constraint private: 本人」):
- 一覧・取得: viewer以上
- 共有制約の作成・変更・削除: editor以上
- 秘匿制約の作成: viewer以上(自分の制約として)。変更・削除は作成者本人のみ
- 共有/秘匿の切替は作成者本人のみ

楽観ロックは制約ごとのrevision(If-Match)。削除は論理削除(deleted_at)。
作成・変更・削除はaudit_logsへ記録する(題名・値・理由は記録しない)。
"""
import json
import re
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import PlanConstraint, TravelDay, TravelEvent, TravelPlan, User
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import (
    decrypt_private_payload,
    is_listed as _is_listed,
    member_user_ids as _member_user_ids,
)

router = APIRouter(prefix="/plans", tags=["constraints"])

# DOC-02 FR-016 の列挙。ハード: 予約・営業時間・終電・集合・予算上限・不可条件、
# ソフト: 希望・疲労・景観・食事間隔・移動回避・優先度。種類とhardnessは独立に
# 指定できる(例: 「予算上限」を目安=softとして扱う旅行もあるため)。
CONSTRAINT_TYPES = {
    "reservation", "opening_hours", "last_transport", "meeting", "budget_limit", "forbidden",
    "preference", "fatigue", "scenery", "meal_interval", "avoid_transport", "priority",
}
OPERATORS = {"before", "after", "between", "max", "min", "equals", "not_equals", "avoid", "prefer"}
SCOPE_TYPES = {"plan", "day", "event", "member"}
HARDNESS = {"hard", "soft"}
PRIVACY_LEVELS = {"shared", "private"}

TIME_OPERATORS = {"before", "after", "between"}
NUMERIC_OPERATORS = {"max", "min"}
TEXT_OPERATORS = {"equals", "not_equals", "avoid", "prefer"}

DEFAULT_SOFT_WEIGHT = 50
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


# ===== スキーマ =====

class ConstraintValue(BaseModel):
    """制約の値。operatorごとの形式はAPI側(_validate_value)で検証する。"""
    model_config = ConfigDict(extra="forbid")

    value: Any = None
    value_to: Any = None
    unit: Optional[str] = Field(None, max_length=20)


class ConstraintCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1, max_length=200)
    constraint_type: str
    hardness: str
    operator: str
    value: ConstraintValue
    weight: Optional[int] = Field(None, ge=1, le=100)
    scope_type: str = "plan"
    scope_id: Optional[str] = None
    privacy_level: str = "shared"
    is_active: bool = True
    active_from: Optional[datetime] = None
    active_to: Optional[datetime] = None
    reason: Optional[str] = Field(None, max_length=1000)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("titleを入力してください")
        return v

    @field_validator("constraint_type")
    @classmethod
    def _v_type(cls, v):
        if v not in CONSTRAINT_TYPES:
            raise ValueError(f"constraint_type must be one of {sorted(CONSTRAINT_TYPES)}")
        return v

    @field_validator("hardness")
    @classmethod
    def _v_hardness(cls, v):
        if v not in HARDNESS:
            raise ValueError(f"hardness must be one of {sorted(HARDNESS)}")
        return v

    @field_validator("operator")
    @classmethod
    def _v_operator(cls, v):
        if v not in OPERATORS:
            raise ValueError(f"operator must be one of {sorted(OPERATORS)}")
        return v

    @field_validator("scope_type")
    @classmethod
    def _v_scope(cls, v):
        if v not in SCOPE_TYPES:
            raise ValueError(f"scope_type must be one of {sorted(SCOPE_TYPES)}")
        return v

    @field_validator("privacy_level")
    @classmethod
    def _v_privacy(cls, v):
        if v not in PRIVACY_LEVELS:
            raise ValueError(f"privacy_level must be one of {sorted(PRIVACY_LEVELS)}")
        return v

    @field_validator("active_from", "active_to")
    @classmethod
    def _v_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v


class ConstraintUpdateRequest(BaseModel):
    """PATCH用。指定した項目だけを更新し、既存値とマージした状態で全体を検証する。"""
    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    constraint_type: Optional[str] = None
    hardness: Optional[str] = None
    operator: Optional[str] = None
    value: Optional[ConstraintValue] = None
    weight: Optional[int] = Field(None, ge=1, le=100)
    scope_type: Optional[str] = None
    scope_id: Optional[str] = None
    privacy_level: Optional[str] = None
    is_active: Optional[bool] = None
    active_from: Optional[datetime] = None
    active_to: Optional[datetime] = None
    reason: Optional[str] = Field(None, max_length=1000)

    @field_validator("constraint_type")
    @classmethod
    def _v_type(cls, v):
        if v is not None and v not in CONSTRAINT_TYPES:
            raise ValueError(f"constraint_type must be one of {sorted(CONSTRAINT_TYPES)}")
        return v

    @field_validator("hardness")
    @classmethod
    def _v_hardness(cls, v):
        if v is not None and v not in HARDNESS:
            raise ValueError(f"hardness must be one of {sorted(HARDNESS)}")
        return v

    @field_validator("operator")
    @classmethod
    def _v_operator(cls, v):
        if v is not None and v not in OPERATORS:
            raise ValueError(f"operator must be one of {sorted(OPERATORS)}")
        return v

    @field_validator("scope_type")
    @classmethod
    def _v_scope(cls, v):
        if v is not None and v not in SCOPE_TYPES:
            raise ValueError(f"scope_type must be one of {sorted(SCOPE_TYPES)}")
        return v

    @field_validator("privacy_level")
    @classmethod
    def _v_privacy(cls, v):
        if v is not None and v not in PRIVACY_LEVELS:
            raise ValueError(f"privacy_level must be one of {sorted(PRIVACY_LEVELS)}")
        return v

    @field_validator("active_from", "active_to")
    @classmethod
    def _v_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v


# ===== 値の検証 =====

def _is_time_value(v: Any) -> bool:
    if not isinstance(v, str):
        return False
    if _HHMM.match(v):
        return True
    try:
        parsed = datetime.fromisoformat(v)
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _validate_value(operator: str, value: Dict[str, Any]) -> Dict[str, Any]:
    """operatorごとに値の形式を検証し、正規化した値を返す(422で失敗)。

    - before/after: value は "HH:MM" またはタイムゾーン付きISO日時
    - between: value と value_to の両方が同じ形式(日時なら value < value_to)
    - max/min: value は0以上の数値、unit(例: JPY/minutes/km)必須
    - equals/not_equals/avoid/prefer: value は1〜200文字の文字列
    """
    raw_value = value.get("value")
    raw_to = value.get("value_to")
    unit = value.get("unit")
    if isinstance(unit, str):
        unit = unit.strip() or None

    if operator in TIME_OPERATORS:
        if not _is_time_value(raw_value):
            raise HTTPException(status_code=422, detail="時刻は\"HH:MM\"またはタイムゾーン付き日時で指定してください")
        if operator == "between":
            if not _is_time_value(raw_to):
                raise HTTPException(status_code=422, detail="betweenには終了(value_to)の時刻も指定してください")
            from_is_clock = bool(_HHMM.match(raw_value))
            if from_is_clock != bool(_HHMM.match(raw_to)):
                raise HTTPException(status_code=422, detail="開始と終了は同じ形式(HH:MMどうし/日時どうし)で指定してください")
            if raw_value == raw_to:
                raise HTTPException(status_code=422, detail="開始と終了に同じ時刻は指定できません")
            # HH:MMどうしは日を跨ぐ範囲(例: 22:00〜02:00)を許す。日時どうしは前後を強制する。
            if not from_is_clock and datetime.fromisoformat(raw_value) >= datetime.fromisoformat(raw_to):
                raise HTTPException(status_code=422, detail="終了は開始より後にしてください")
        elif raw_to is not None:
            raise HTTPException(status_code=422, detail="value_toはbetweenの場合のみ指定できます")
        return {"value": raw_value, "value_to": raw_to if operator == "between" else None, "unit": None}

    if operator in NUMERIC_OPERATORS:
        if not _is_number(raw_value) or raw_value < 0:
            raise HTTPException(status_code=422, detail="上限/下限は0以上の数値で指定してください")
        if not unit:
            raise HTTPException(status_code=422, detail="上限/下限には単位(unit、例: JPY・minutes・km)を指定してください")
        if raw_to is not None:
            raise HTTPException(status_code=422, detail="value_toはbetweenの場合のみ指定できます")
        return {"value": raw_value, "value_to": None, "unit": unit}

    # TEXT_OPERATORS
    if not isinstance(raw_value, str) or not raw_value.strip() or len(raw_value.strip()) > 200:
        raise HTTPException(status_code=422, detail="値は1〜200文字の文字列で指定してください")
    if raw_to is not None:
        raise HTTPException(status_code=422, detail="value_toはbetweenの場合のみ指定できます")
    return {"value": raw_value.strip(), "value_to": None, "unit": unit}


def _resolve_weight(hardness: str, weight: Optional[int], weight_given: bool) -> Optional[int]:
    """DOC-05 §17: hardはweight不要。softは1〜100(未指定なら既定値)。"""
    if hardness == "hard":
        if weight_given and weight is not None:
            raise HTTPException(status_code=422, detail="ハード制約には重み(weight)を指定できません")
        return None
    return weight if weight is not None else DEFAULT_SOFT_WEIGHT


def _validate_window(active_from: Optional[datetime], active_to: Optional[datetime]) -> None:
    if active_from and active_to and active_from >= active_to:
        raise HTTPException(status_code=422, detail="有効期間の終了は開始より後にしてください")


# ===== メンバー・適用範囲 =====

def _parse_uuid(raw: Optional[str], label: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{label}の形式が不正です")


def _resolve_scope(db: Session, plan: TravelPlan, current_user: User, scope_type: str,
                   scope_id: Optional[str]) -> Optional[uuid.UUID]:
    """scope_idがプラン内の対象を指すことを検証する。他プランの対象は
    「見つからない」と同じ422にして、存在有無を漏らさない。"""
    if scope_type == "plan":
        if scope_id is not None:
            raise HTTPException(status_code=422, detail="適用範囲がプラン全体の場合はscope_idを指定できません")
        return None
    if scope_type == "member" and scope_id is None:
        return current_user.id  # 個人の制約: 省略時は本人
    if scope_id is None:
        raise HTTPException(status_code=422, detail="適用範囲の対象(scope_id)を指定してください")
    sid = _parse_uuid(scope_id, "scope_id")
    if scope_type == "day":
        found = db.query(TravelDay.id).filter(TravelDay.id == sid, TravelDay.plan_id == plan.id).first()
        if not found:
            raise HTTPException(status_code=422, detail="指定された日がこのプラン内に見つかりません")
    elif scope_type == "event":
        found = db.query(TravelEvent.id).filter(TravelEvent.id == sid, TravelEvent.plan_id == plan.id).first()
        if not found:
            raise HTTPException(status_code=422, detail="指定されたイベントがこのプラン内に見つかりません")
    else:  # member
        if sid not in _member_user_ids(db, plan):
            raise HTTPException(status_code=422, detail="指定されたメンバーがこのプランに見つかりません")
    return sid


def _scope_label(db: Session, c: PlanConstraint):
    """(label, missing)。対象が削除済みならmissing=True。"""
    if c.scope_type == "plan":
        return None, False
    if c.scope_type == "day":
        day = db.query(TravelDay).filter(TravelDay.id == c.scope_id, TravelDay.plan_id == c.plan_id).first()
        return (day.local_date.isoformat(), False) if day else (None, True)
    if c.scope_type == "event":
        ev = db.query(TravelEvent).filter(TravelEvent.id == c.scope_id, TravelEvent.plan_id == c.plan_id).first()
        return (ev.title, False) if ev else (None, True)
    user = db.query(User).filter(User.id == c.scope_id).first()
    if not user:
        return None, True
    return (user.username or "ゲスト"), False


# ===== 暗号化 =====

def _encrypt_json(data: Dict[str, Any], label: str) -> bytes:
    try:
        return encrypt_payload(json.dumps(data, ensure_ascii=False).encode("utf-8"))
    except EncryptionNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{label}の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )


def _encrypt_reason(reason: Optional[str]) -> Optional[bytes]:
    if reason is None or not reason.strip():
        return None
    try:
        return encrypt_payload(reason.strip().encode("utf-8"))
    except EncryptionNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="理由の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )


def _decrypt_reason(c: PlanConstraint) -> Optional[str]:
    if not c.reason_ciphertext:
        return None
    try:
        return decrypt_payload(c.reason_ciphertext).decode("utf-8")
    except (EncryptionNotConfigured, ValueError):
        return None


def _store_payload(c: PlanConstraint, privacy_level: str, title: str, value: Dict[str, Any]) -> None:
    c.privacy_level = privacy_level
    if privacy_level == "private":
        c.value_ciphertext = _encrypt_json({"title": title, "value": value}, "秘匿制約")
        c.title = None
        c.value_json = None
    else:
        c.title = title
        c.value_json = value
        c.value_ciphertext = None


def _current_title_and_value(c: PlanConstraint):
    if c.privacy_level == "private":
        data = decrypt_private_payload(c)
        if data is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="秘匿制約の内容を復号できないため変更できません(暗号鍵を確認してください)",
            )
        return data.get("title"), data.get("value")
    return c.title, c.value_json


# ===== レスポンス =====

_MASKED_KEYS = (
    "title", "constraint_type", "operator", "value", "weight", "scope_id", "scope_label",
    "active_from", "active_to", "reason", "revision", "updated_at",
)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _to_response(db: Session, c: PlanConstraint, viewer: User) -> Dict[str, Any]:
    is_mine = c.owner_user_id == viewer.id
    base = {
        "id": str(c.id),
        "plan_id": str(c.plan_id),
        "is_mine": is_mine,
        "hardness": c.hardness,
        "privacy_level": c.privacy_level,
        "scope_type": c.scope_type,
        "is_active": c.is_active,
        "created_at": _iso(c.created_at),
    }

    if c.privacy_level == "private" and not is_mine:
        # FR-016/FR-023: 他人の秘匿制約は存在とhard/softの別だけを示す。
        base.update({k: None for k in _MASKED_KEYS})
        base.update({"visibility": "masked", "scope_missing": False, "has_reason": False})
        return base

    if c.privacy_level == "private":
        data = decrypt_private_payload(c)
        if data is None:
            base.update({k: None for k in _MASKED_KEYS})
            base.update({
                "visibility": "unavailable", "scope_missing": False, "has_reason": c.reason_ciphertext is not None,
                "revision": c.revision, "updated_at": _iso(c.updated_at),
            })
            return base
        title, value = data.get("title"), data.get("value")
    else:
        title, value = c.title, c.value_json

    label, missing = _scope_label(db, c)
    base.update({
        "visibility": "full",
        "title": title,
        "constraint_type": c.constraint_type,
        "operator": c.operator,
        "value": value,
        "weight": c.weight,
        "scope_id": str(c.scope_id) if c.scope_id else None,
        "scope_label": label,
        "scope_missing": missing,
        "active_from": _iso(c.active_from),
        "active_to": _iso(c.active_to),
        # DOC-05 §19: 理由は本人のみ(共有制約でも他人には返さない)
        "reason": _decrypt_reason(c) if is_mine else None,
        "has_reason": c.reason_ciphertext is not None,
        "revision": c.revision,
        "updated_at": _iso(c.updated_at),
    })
    return base


# ===== 共通 =====

def _visible_constraints_query(db: Session, plan: TravelPlan):
    return db.query(PlanConstraint).filter(PlanConstraint.plan_id == plan.id, PlanConstraint.deleted_at.is_(None))


def _get_constraint_or_404(db: Session, plan: TravelPlan, constraint_id: str) -> PlanConstraint:
    try:
        cid = uuid.UUID(str(constraint_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="制約が見つかりません")
    c = _visible_constraints_query(db, plan).filter(PlanConstraint.id == cid).first()
    if not c or not _is_listed(c, _member_user_ids(db, plan)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="制約が見つかりません")
    return c


def _require_if_match(c: PlanConstraint, if_match: Optional[str]) -> None:
    if if_match is None or if_match.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail="If-Matchヘッダーが必要です(現在のリビジョンをGETで取得してから指定してください)",
        )
    try:
        expected = int(if_match.strip().strip('"'))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="If-Matchの形式が不正です")
    if expected != c.revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"制約が他の変更で更新されています(現在のリビジョン: {c.revision})",
        )


def _require_write(c: PlanConstraint, role: str, user: User) -> None:
    if c.privacy_level == "private":
        if c.owner_user_id != user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="秘匿制約は作成者本人のみ変更できます")
        return
    if role not in ("owner", "editor"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="共有の制約を変更する権限がありません")


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _audit(action: str, request: Request, user: User, c: PlanConstraint) -> None:
    record_audit_event(
        action=action,
        resource_type="constraint",
        user_id=user.id,
        resource_id=c.id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:255],
        # 題名・値・理由(秘密になり得る本文)は記録しない
        details={"plan_id": str(c.plan_id), "hardness": c.hardness, "privacy_level": c.privacy_level},
    )


# ===== エンドポイント =====

@router.get("/{plan_id}/constraints", response_model=List[dict])
def list_constraints(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    member_ids = _member_user_ids(db, plan)
    rows = _visible_constraints_query(db, plan).order_by(PlanConstraint.created_at.asc(), PlanConstraint.id.asc()).all()
    rows = [c for c in rows if _is_listed(c, member_ids)]
    # ハード制約を先に並べる(同じ区分の中は作成順)
    rows.sort(key=lambda c: 0 if c.hardness == "hard" else 1)
    return [_to_response(db, c, current_user) for c in rows]


@router.get("/{plan_id}/constraints/{constraint_id}", response_model=dict)
def get_constraint(
    plan_id: str,
    constraint_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return _to_response(db, _get_constraint_or_404(db, plan, constraint_id), current_user)


@router.post("/{plan_id}/constraints", status_code=201, response_model=dict)
def create_constraint(
    plan_id: str,
    payload: ConstraintCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    min_role = "viewer" if payload.privacy_level == "private" else "editor"
    plan, _role = require_plan_access(db, plan_id, current_user, min_role=min_role)

    value = _validate_value(payload.operator, payload.value.model_dump())
    weight = _resolve_weight(payload.hardness, payload.weight, "weight" in payload.model_fields_set)
    _validate_window(payload.active_from, payload.active_to)
    scope_id = _resolve_scope(db, plan, current_user, payload.scope_type, payload.scope_id)

    c = PlanConstraint(
        id=uuid.uuid4(),
        plan_id=plan.id,
        owner_user_id=current_user.id,
        scope_type=payload.scope_type,
        scope_id=scope_id,
        constraint_type=payload.constraint_type,
        hardness=payload.hardness,
        operator=payload.operator,
        weight=weight,
        is_active=payload.is_active,
        active_from=payload.active_from,
        active_to=payload.active_to,
        reason_ciphertext=_encrypt_reason(payload.reason),
    )
    _store_payload(c, payload.privacy_level, payload.title, value)
    db.add(c)
    db.commit()
    db.refresh(c)
    _audit("constraint_created", request, current_user, c)
    return _to_response(db, c, current_user)


@router.patch("/{plan_id}/constraints/{constraint_id}", response_model=dict)
def update_constraint(
    plan_id: str,
    constraint_id: str,
    payload: ConstraintUpdateRequest,
    request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    c = _get_constraint_or_404(db, plan, constraint_id)
    _require_write(c, role, current_user)
    _require_if_match(c, if_match)

    data = payload.model_dump(exclude_unset=True)
    for nullable_forbidden in ("title", "constraint_type", "hardness", "operator", "value",
                               "scope_type", "privacy_level", "is_active"):
        if nullable_forbidden in data and data[nullable_forbidden] is None:
            raise HTTPException(status_code=422, detail=f"{nullable_forbidden}にnullは指定できません")

    new_privacy = data.get("privacy_level", c.privacy_level)
    if new_privacy != c.privacy_level and c.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="共有/秘匿の切替は作成者本人のみ行えます")
    if new_privacy == "shared" and role not in ("owner", "editor"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="共有の制約を作成・変更する権限がありません")

    current_title, current_value = _current_title_and_value(c)
    title = data["title"].strip() if "title" in data else current_title
    if not title:
        raise HTTPException(status_code=422, detail="titleを入力してください")
    operator = data.get("operator", c.operator)
    raw_value = payload.value.model_dump() if "value" in data else (current_value or {})
    value = _validate_value(operator, raw_value)
    hardness = data.get("hardness", c.hardness)
    if "weight" in data:
        weight = _resolve_weight(hardness, data["weight"], True)
    elif hardness != c.hardness:
        weight = _resolve_weight(hardness, None, False)
    else:
        weight = c.weight
    active_from = data.get("active_from", c.active_from)
    active_to = data.get("active_to", c.active_to)
    _validate_window(active_from, active_to)
    scope_type = data.get("scope_type", c.scope_type)
    if "scope_type" in data or "scope_id" in data:
        raw_scope_id = data.get("scope_id") if "scope_id" in data else (
            str(c.scope_id) if c.scope_id and scope_type == c.scope_type else None
        )
        scope_id = _resolve_scope(db, plan, current_user, scope_type, raw_scope_id)
    else:
        scope_id = c.scope_id

    c.constraint_type = data.get("constraint_type", c.constraint_type)
    c.hardness = hardness
    c.operator = operator
    c.weight = weight
    c.scope_type = scope_type
    c.scope_id = scope_id
    c.is_active = data.get("is_active", c.is_active)
    c.active_from = active_from
    c.active_to = active_to
    if "reason" in data:
        c.reason_ciphertext = _encrypt_reason(data["reason"])
    _store_payload(c, new_privacy, title, value)
    c.revision += 1
    db.commit()
    db.refresh(c)
    _audit("constraint_updated", request, current_user, c)
    return _to_response(db, c, current_user)


@router.delete("/{plan_id}/constraints/{constraint_id}", response_model=dict)
def delete_constraint(
    plan_id: str,
    constraint_id: str,
    request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    c = _get_constraint_or_404(db, plan, constraint_id)
    _require_write(c, role, current_user)
    _require_if_match(c, if_match)
    c.deleted_at = datetime.now(dt_timezone.utc)
    c.revision += 1
    db.commit()
    _audit("constraint_deleted", request, current_user, c)
    return {"message": "制約を削除しました", "revision": c.revision}
