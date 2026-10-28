"""
[Gate P4] FR-034 しおり生成 / FR-035 安全な印刷・公開 / FR-046 画像・PDF出力
(DOC-04 SC-25 しおりデザイン・SC-26 PDF・印刷・公開設定・SC-36 Export Preview、DOC-06 exports)。

エンドポイント(すべて /plans/{plan_id} 配下):
- POST /booklet/preview          : 設定(テーマ・章・含める機密項目)からしおり投影を返す(保存しない)
- GET  /booklet-exports           : 作成した版の一覧(メタデータのみ)
- POST /booklet-exports           : 版を作成する(版番号を採番し、作成時点の投影を暗号化して保存)
- GET  /booklet-exports/{id}      : 版の内容(作成時点の投影)。最新の旅程と違えば is_stale
- DELETE /booklet-exports/{id}    : 版を失効させる(内容を消去し、以後は表示できない)

権限(DOC-04 §9 SC-26: Owner=全操作、Editor=許可時、Viewer=不可):
- プレビュー・版の作成・一覧: editor以上
- 機密項目(予約番号・住所・電話・参加者名)を含める: 所有者だけ(403 sensitive_requires_owner)
- 機密項目を含む版の内容を見る: 作成者だけ(透かしは作成者名)。失効・有効期限切れは410
- 失効: 作成者か所有者

機密項目を含む版は、作成者名の透かしと有効期限が必須(FC-088)。QR・チケットの中身・PIN・名義・個人の持ち物・
個人予算はどの設定でも含めない。監査には設定(章・含めた項目の種類)だけを記録し、内容は記録しない。
"""
import json
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import decrypt_payload, encrypt_payload, plan_subject
from app.core.database import get_db
from app.services import member_policy
from app.models.models import BookletExport, TravelPlan, User
from app.services import booklet
from app.services.audit_service import record_audit_event
from app.services.readiness import member_names

router = APIRouter(prefix="/plans", tags=["booklet"])

MAX_VALID_DAYS = 90


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    dt = _aware(dt)
    return dt.isoformat() if dt else None


# ===== スキーマ =====

class IncludesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation_numbers: bool = False
    addresses: bool = False
    phones: bool = False
    participants: bool = False


class OptionsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme: str = "simple"
    density: str = "normal"
    format: str = "print"
    sections: List[str] = Field(..., min_length=1, max_length=len(booklet.SECTIONS))
    includes: IncludesIn = IncludesIn()

    @field_validator("theme")
    @classmethod
    def _v_theme(cls, v):
        if v not in booklet.THEMES:
            raise ValueError(f"theme must be one of {list(booklet.THEMES)}")
        return v

    @field_validator("density")
    @classmethod
    def _v_density(cls, v):
        if v not in booklet.DENSITIES:
            raise ValueError(f"density must be one of {list(booklet.DENSITIES)}")
        return v

    @field_validator("format")
    @classmethod
    def _v_format(cls, v):
        if v not in booklet.FORMATS:
            raise ValueError(f"format must be one of {list(booklet.FORMATS)}")
        return v

    @field_validator("sections")
    @classmethod
    def _v_sections(cls, v):
        bad = [s for s in v if s not in booklet.SECTIONS]
        if bad:
            raise ValueError(f"sections must be in {list(booklet.SECTIONS)}")
        if len(set(v)) != len(v):
            raise ValueError("sectionsに同じ章が重複しています")
        return v

    def to_options(self) -> booklet.Options:
        return booklet.Options(theme=self.theme, density=self.density, format=self.format,
                               sections=self.sections, includes=self.includes.model_dump())


class ExportCreate(OptionsIn):
    valid_until: Optional[datetime] = None

    @field_validator("valid_until")
    @classmethod
    def _v_valid_until(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("valid_untilにはタイムゾーンを含めてください")
        return v


# ===== 共通 =====

def _audit(action: str, request: Request, user: User, resource_id, plan_id, details: Dict[str, Any]) -> None:
    record_audit_event(
        action=action, resource_type="booklet_export", user_id=user.id, resource_id=resource_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        # しおりの内容(予定名・予約番号・住所等)は記録しない
        details={"plan_id": str(plan_id), **details},
    )


def _guard_hidden(opts: booklet.Options, hidden) -> None:
    """[Gate G2] FR-045 所有者が隠した項目の章は作れない(予約・連絡先・注意事項・費用・地図)。"""
    blocked = member_policy.booklet_blocked_sections(hidden, opts.sections)
    if blocked:
        raise member_policy.hidden_error(member_policy.BOOKLET_SECTION_CATEGORY[blocked[0]])


def _guard_sensitive(opts: booklet.Options, role: str) -> None:
    if opts.contains_sensitive and role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={
            "code": "sensitive_requires_owner",
            "message": "予約番号・住所・電話・参加者名を含めた出力は旅行の所有者だけが作成できます",
        })


def _state(e: BookletExport, now: datetime) -> str:
    if e.status == "revoked":
        return "revoked"
    vu = _aware(e.valid_until)
    if vu is not None and vu <= now:
        return "expired"
    return "active"


def _export_response(e: BookletExport, plan: TravelPlan, user: User, role: str, names: Dict[Any, str],
                     now: datetime) -> Dict[str, Any]:
    state = _state(e, now)
    mine = e.created_by_user_id == user.id
    return {
        "id": str(e.id),
        "plan_id": str(e.plan_id),
        "version_no": e.version_no,
        "format": e.format,
        "theme": e.theme,
        "density": e.density,
        "sections": list(e.sections or []),
        "includes": {k: bool((e.includes or {}).get(k)) for k in booklet.INCLUDE_KEYS},
        "contains_sensitive": e.contains_sensitive,
        "watermark_text": e.watermark_text,
        "valid_until": _iso(e.valid_until),
        "input_revision": e.input_revision,
        "is_stale": e.input_revision != plan.revision,
        "policy_version": e.policy_version,
        "state": state,
        "created_at": _iso(e.created_at),
        "created_by_name": names.get(e.created_by_user_id, "メンバー外"),
        "is_mine": mine,
        "can_view": state == "active" and (mine or not e.contains_sensitive),
        "can_revoke": state != "revoked" and (mine or role == "owner"),
    }


def _get_export(db: Session, plan: TravelPlan, export_id: str) -> BookletExport:
    try:
        eid = uuid.UUID(str(export_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="しおりの版が見つかりません")
    e = db.query(BookletExport).filter(BookletExport.id == eid, BookletExport.plan_id == plan.id).first()
    if e is None:
        raise HTTPException(status_code=404, detail="しおりの版が見つかりません")
    return e


def _audit_flags(opts: booklet.Options) -> Dict[str, Any]:
    return {"format": opts.format, "theme": opts.theme, "sections": booklet.normalize_sections(opts.sections),
            "included": sorted(k for k, v in opts.includes.items() if v)}


# ===== エンドポイント =====

@router.post("/{plan_id}/booklet/preview", response_model=dict)
def preview(plan_id: str, payload: OptionsIn, request: Request, response: Response, db: Session = Depends(get_db),
            current_user: User = Depends(get_current_user_or_guest)):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    opts = payload.to_options()
    _guard_hidden(opts, hidden)
    _guard_sensitive(opts, role)
    response.headers["Cache-Control"] = "no-store"
    result = member_policy.redact_booklet(booklet.build(db, plan, current_user, opts), hidden)
    if opts.contains_sensitive:
        _audit("booklet_preview_sensitive", request, current_user, None, plan.id, _audit_flags(opts))
    return result


@router.get("/{plan_id}/booklet-exports", response_model=List[dict])
def list_exports(plan_id: str, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    rows = (db.query(BookletExport).filter(BookletExport.plan_id == plan.id)
            .order_by(BookletExport.version_no.desc()).all())
    names = member_names(db, {r.created_by_user_id for r in rows})
    now = _now()
    return [_export_response(r, plan, current_user, role, names, now) for r in rows]


@router.post("/{plan_id}/booklet-exports", status_code=201, response_model=dict)
def create_export(plan_id: str, payload: ExportCreate, request: Request, response: Response,
                  db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    opts = payload.to_options()
    _guard_hidden(opts, hidden)
    _guard_sensitive(opts, role)
    now = _now()
    valid_until = _aware(payload.valid_until)
    if valid_until is not None:
        if valid_until <= now:
            raise HTTPException(status_code=422, detail="有効期限には未来の日時を指定してください")
        if valid_until > now + timedelta(days=MAX_VALID_DAYS):
            raise HTTPException(status_code=422, detail=f"有効期限は{MAX_VALID_DAYS}日以内で指定してください")
    elif opts.contains_sensitive:
        raise HTTPException(status_code=422, detail={
            "code": "valid_until_required",
            "message": "機密情報を含む版には有効期限が必要です",
        })

    # 版番号の採番はプランの行をロックして直列化する(同時作成で同じ番号にならない)
    db.query(TravelPlan).filter(TravelPlan.id == plan.id).with_for_update().first()
    last = db.query(func.max(BookletExport.version_no)).filter(BookletExport.plan_id == plan.id).scalar() or 0
    creator_name = member_names(db, {current_user.id}).get(current_user.id, "ゲスト")
    watermark = f"{creator_name} 専用・持出注意" if opts.contains_sensitive else None
    snapshot = member_policy.redact_booklet(booklet.build(db, plan, current_user, opts, now=now), hidden)
    e = BookletExport(
        id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id, version_no=last + 1,
        format=opts.format, theme=opts.theme, density=opts.density,
        sections=booklet.normalize_sections(opts.sections), includes=dict(opts.includes),
        contains_sensitive=opts.contains_sensitive, watermark_text=watermark, valid_until=valid_until,
        input_revision=plan.revision, policy_version=booklet.POLICY_VERSION,
        snapshot_ciphertext=encrypt_payload(json.dumps(snapshot, ensure_ascii=False).encode("utf-8"),
                                            plan_subject(plan.id)),
        status="active",
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    _audit("booklet_export_created", request, current_user, e.id, plan.id,
           {"version_no": e.version_no, **_audit_flags(opts)})
    response.headers["Cache-Control"] = "no-store"
    names = {current_user.id: creator_name}
    return {"export": _export_response(e, plan, current_user, role, names, now),
            "booklet": {**snapshot, "current_revision": plan.revision, "is_stale": False}}


@router.get("/{plan_id}/booklet-exports/{export_id}", response_model=dict)
def get_export(plan_id: str, export_id: str, request: Request, response: Response, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    e = _get_export(db, plan, export_id)
    now = _now()
    state = _state(e, now)
    if state == "revoked":
        raise HTTPException(status_code=410, detail={"code": "revoked", "message": "この版は失効しています"})
    if state == "expired":
        raise HTTPException(status_code=410, detail={"code": "expired", "message": "この版は有効期限が切れています"})
    if e.contains_sensitive and e.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail={
            "code": "sensitive_creator_only", "message": "機密情報を含む版は作成者だけが表示できます",
        })
    if e.snapshot_ciphertext is None:
        raise HTTPException(status_code=404, detail="しおりの版が見つかりません")
    snapshot = member_policy.redact_booklet(json.loads(decrypt_payload(e.snapshot_ciphertext).decode("utf-8")),
                                            hidden)
    snapshot["current_revision"] = plan.revision
    snapshot["is_stale"] = e.input_revision != plan.revision
    if snapshot["is_stale"] and "stale_revision" not in snapshot.get("warnings", []):
        snapshot["warnings"] = [*snapshot.get("warnings", []), "stale_revision"]
    if e.contains_sensitive:
        _audit("booklet_export_viewed", request, current_user, e.id, plan.id, {"version_no": e.version_no})
    response.headers["Cache-Control"] = "no-store"
    names = member_names(db, {e.created_by_user_id})
    return {"export": _export_response(e, plan, current_user, role, names, now), "booklet": snapshot}


@router.delete("/{plan_id}/booklet-exports/{export_id}", response_model=dict)
def revoke_export(plan_id: str, export_id: str, request: Request, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    e = _get_export(db, plan, export_id)
    if e.created_by_user_id != current_user.id and role != "owner":
        raise HTTPException(status_code=403, detail="この版を失効できるのは作成者か所有者だけです")
    if e.status != "revoked":
        e.status = "revoked"
        e.revoked_at = _now()
        e.snapshot_ciphertext = None
        db.commit()
        db.refresh(e)
        _audit("booklet_export_revoked", request, current_user, e.id, plan.id, {"version_no": e.version_no})
    names = member_names(db, {e.created_by_user_id})
    return {"export": _export_response(e, plan, current_user, role, names, _now())}
