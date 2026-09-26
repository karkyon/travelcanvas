"""
TravelCanvas 旅行プラン(TravelPlan) CRUD API
既存 spots.py の実装パターンに準拠。

[Gate #34] このrouterはプランmetadata(title/description/destination/
start_date/end_date/budget/status/preferences)のCRUDに限定する。
`itinerary`(旧JSON blob正本)はGate #29以降、正規化された
travel_days/travel_events(app/api/v1/plans.py)が唯一の書込み正本であり、
このrouter経由でのitinerary書換えはrevision/If-Match/Idempotency/
ChangeSet/Undoの全保証を迂回する(2026-09-05監査 P0-01/P0-02)。
そのため本Gateでitineraryフィールドの書込みを明示的に拒否する。

[Gate #35] このrouterの5エンドポイント(POST/GET一覧/GET単体/PUT/DELETE)は
get_current_active_userからget_current_user_or_guestへ変更した。ゲストは
自分が作成したプランのみ操作でき(TravelPlan.user_id == current_user.id、
挙動は既存のまま変更なし)、共有・協業・通知等の会員限定機能には一切
影響しない。
"""
import logging
import uuid
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from sqlalchemy import or_

from app.core.config import settings
from app.core.database import get_db
from app.core.auth import get_current_user_or_guest
from app.core.plan_access import require_plan_access, accessible_plan_ids_subquery
from app.models.models import TravelPlan, TravelDay, TravelEvent, User
from app.services import plan_deletion
from app.services.audit_service import record_audit_event
from app.schemas.travel_plan import (
    TravelPlanCreate,
    TravelPlanUpdate,
    TravelPlanResponse,
    TravelPlanListResponse,
)

logger = logging.getLogger("travelcanvas")

router = APIRouter(prefix="/travel-plans", tags=["travel-plans"])

# [Gate #34] metadata CRUDでは書き込みを受け付けないフィールド。
# `itinerary`をrequestに含めてもサイレントに無視せず、422で明示的に
# 拒否する(壊れた/混乱した呼び出し元を早期に気づかせるため)。
_LEGACY_ITINERARY_FIELD = "itinerary"


def _reject_itinerary_write(update_data: dict) -> None:
    if _LEGACY_ITINERARY_FIELD in update_data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": (
                    "itineraryはこのAPIでは更新できません。日/イベントの"
                    "変更は /plans/{plan_id}/days および "
                    "/plans/{plan_id}/days/{day_id}/events を使用してください。"
                ),
                "error_code": "LEGACY_ITINERARY_WRITE_REJECTED",
            },
        )


@router.post("/", response_model=TravelPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_travel_plan(
    plan_data: TravelPlanCreate,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """新しい旅行プランを作成(metadataのみ。itineraryはこのAPIでは受け付けない)"""
    try:
        new_plan = TravelPlan(
            user_id=current_user.id,
            title=plan_data.title,
            description=plan_data.description,
            destination=plan_data.destination,
            start_date=plan_data.start_date,
            end_date=plan_data.end_date,
            budget=plan_data.budget,
            preferences=plan_data.preferences,
            status="draft",
        )

        db.add(new_plan)
        db.commit()
        db.refresh(new_plan)

        return new_plan

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("旅行プラン作成中に予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="旅行プランの作成に失敗しました。しばらくしてから再試行してください。",
        )


@router.get("/", response_model=TravelPlanListResponse)
async def get_travel_plans(
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
):
    """自分が所有、または承諾済みコラボレーターとして参加している旅行プラン一覧取得

    [Gate #30] 以前はowner分のみを返しており、招待を承諾したプランは
    一覧に一切現れなかった(そもそもアクセス自体できなかったため気づかれ
    なかった不整合)。
    """
    collab_plan_ids = accessible_plan_ids_subquery(db, current_user)
    query = db.query(TravelPlan).filter(
        or_(TravelPlan.user_id == current_user.id, TravelPlan.id.in_(collab_plan_ids)),
        TravelPlan.deleted_at.is_(None),  # [Gate B-012] 論理削除済みは一覧に出さない
    )

    if status_filter:
        query = query.filter(TravelPlan.status == status_filter)

    total = query.count()
    plans = (
        query.order_by(TravelPlan.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    return {"plans": plans, "total": total}


# [Gate #27 / A-011] /test/ping は /{plan_id}(UUID型パスパラメータ)より前に
# 定義する必要がある。spots.py の固定ルートと同じ理由・同じ対応。
# [Gate R0] 認証不要な診断用エンドポイント。settings.DEBUG限定にする
# (DEBUG=Falseでは404)。ルート順序自体は本Gateで変更しない。
@router.get("/test/ping")
async def test_travel_plans_api():
    """旅行プランAPI動作テスト(DEBUG限定)"""
    if not settings.DEBUG:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return {
        "message": "旅行プランAPI正常動作中",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat(),
    }


# ===== [Gate B-012] 論理削除済みプラン(復元・完全削除) =====
# /{plan_id}(UUID型パスパラメータ)より前に定義する(/test/pingと同じ理由)。

def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _deleted_plan_summary(plan: TravelPlan) -> dict:
    return {
        "id": str(plan.id),
        "title": plan.title,
        "destination": plan.destination,
        "start_date": _iso(plan.start_date),
        "end_date": _iso(plan.end_date),
        "deleted_at": _iso(plan.deleted_at),
        "purge_after": _iso(plan.purge_after),
    }


def _get_deleted_own_plan(db: Session, plan_id: uuid.UUID, user: User) -> TravelPlan:
    """自分が所有する論理削除済みプラン。所有者以外・未削除・存在しない場合は同じ404。"""
    plan = (
        db.query(TravelPlan)
        .filter(TravelPlan.id == plan_id, TravelPlan.user_id == user.id, TravelPlan.deleted_at.isnot(None))
        .first()
    )
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="削除済みの旅行プランが見つかりません")
    return plan


@router.get("/deleted")
async def list_deleted_travel_plans(
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """自分が所有する論理削除済みプラン(猶予期間内で、まだ完全削除されていないもの)。新しく削除した順。"""
    plans = (
        db.query(TravelPlan)
        .filter(TravelPlan.user_id == current_user.id, TravelPlan.deleted_at.isnot(None))
        .order_by(TravelPlan.deleted_at.desc(), TravelPlan.id.asc())
        .all()
    )
    return [_deleted_plan_summary(p) for p in plans]


@router.post("/{plan_id}/restore", response_model=TravelPlanResponse)
async def restore_travel_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """論理削除を取り消す(所有者のみ、猶予期間内のみ)。共有リンクは失効したまま(再発行が必要)。"""
    plan = _get_deleted_own_plan(db, plan_id, current_user)
    if plan.purge_after is not None and plan.purge_after <= plan_deletion._now():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="復元できる期間を過ぎています")
    plan_deletion.restore_plan(plan)
    db.commit()
    db.refresh(plan)
    record_audit_event(action="plan.restore", resource_type="travel_plan", user_id=current_user.id, resource_id=plan.id)
    return plan


@router.delete("/{plan_id}/permanent")
async def purge_travel_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """論理削除済みプランを今すぐ完全削除する(所有者のみ)。元に戻せない。"""
    plan = _get_deleted_own_plan(db, plan_id, current_user)
    if not plan_deletion.purge_plan(db, plan, actor_user_id=current_user.id, reason="owner_request"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="添付文書のファイルを削除できなかったため、完全削除を保留しました。時間をおいて再試行してください。",
        )
    return {"message": "旅行プランを完全に削除しました"}


@router.get("/{plan_id}", response_model=TravelPlanResponse)
async def get_travel_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """旅行プラン詳細取得(owner/editor/viewerいずれでも閲覧可能)"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return plan


@router.put("/{plan_id}", response_model=TravelPlanResponse)
async def update_travel_plan(
    plan_id: uuid.UUID,
    plan_data: TravelPlanUpdate,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """旅行プラン更新(owner/editorが編集可能。viewerは403)

    [Gate #34] itineraryフィールドが含まれる場合は422で拒否する
    (day/eventの正本は/plans/*のみ)。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")

    update_data = plan_data.dict(exclude_unset=True)
    _reject_itinerary_write(update_data)

    for field, value in update_data.items():
        setattr(plan, field, value)

    try:
        db.commit()
        db.refresh(plan)
        return plan
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("旅行プラン更新中に予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="旅行プランの更新に失敗しました。しばらくしてから再試行してください。",
        )


class PlanCloneRequest(BaseModel):
    """[Gate #39] 旅程複製リクエスト。全項目任意。"""
    title: Optional[str] = None
    start_date: Optional[date] = None


@router.post("/{plan_id}/clone", response_model=TravelPlanResponse, status_code=status.HTTP_201_CREATED)
async def clone_travel_plan(
    plan_id: uuid.UUID,
    clone_data: PlanCloneRequest,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """旅行プランを複製する(CA-005)。

    [Gate #39 設計]
    - 所有者本人のプランのみ複製可能(editor/viewerによる複製は将来のGateで
      collaborator権限と合わせて設計する。現時点ではrequire_plan_accessに
      min_role="owner"を要求する)。
    - `start_date`を指定した場合、元プランの最初の日(TravelDayが1件も
      無ければplan.start_date)を基準日として、全日程・全イベントの日時を
      その差分だけ平行移動する。未指定の場合は元の日付をそのまま複製する。
    - 複製されないもの: 旧`itinerary` JSON blob(常にNoneで作成)、旧`revision`
      (新規プランは1から)。
    - 複製されるもの: TravelDay/TravelEventの全カラム。現時点のモデルには
      予約番号・支払情報等の機微フィールドが存在しないため除外処理は不要。
      将来FR-010〜013(予約管理)が実装された場合はこのエンドポイントの
      見直しが必要。
    - `TravelEvent.locked`は複製先で常にFalseにリセットする(最適化対象から
      除外する理由は元プラン固有の判断のため、複製先では引き継がない)。
    """
    original_plan, _role = require_plan_access(db, plan_id, current_user, min_role="owner")

    original_days = (
        db.query(TravelDay)
        .options(joinedload(TravelDay.events))
        .filter(TravelDay.plan_id == original_plan.id)
        .order_by(TravelDay.sort_order)
        .all()
    )

    date_delta: Optional[timedelta] = None
    if clone_data.start_date is not None:
        if original_days:
            base_date = original_days[0].local_date
        elif original_plan.start_date is not None:
            base_date = original_plan.start_date.date()
        else:
            base_date = None
        if base_date is not None:
            date_delta = clone_data.start_date - base_date

    def _shift_datetime(value: Optional[datetime]) -> Optional[datetime]:
        if value is None or date_delta is None:
            return value
        return value + date_delta

    new_title = clone_data.title if clone_data.title and clone_data.title.strip() else f"{original_plan.title}のコピー"

    new_plan = TravelPlan(
        user_id=current_user.id,
        title=new_title,
        description=original_plan.description,
        destination=original_plan.destination,
        start_date=_shift_datetime(original_plan.start_date),
        end_date=_shift_datetime(original_plan.end_date),
        budget=original_plan.budget,
        preferences=original_plan.preferences,
        status="draft",
    )

    try:
        db.add(new_plan)
        db.flush()  # new_plan.idを確定させる(まだcommitしない)

        for day in original_days:
            new_local_date = day.local_date + date_delta if date_delta is not None else day.local_date
            new_day = TravelDay(
                plan_id=new_plan.id,
                local_date=new_local_date,
                timezone_id=day.timezone_id,
                title=day.title,
                notes=day.notes,
                sort_order=day.sort_order,
            )
            db.add(new_day)
            db.flush()  # new_day.idを確定させる

            for event in day.events:
                new_event = TravelEvent(
                    plan_id=new_plan.id,
                    day_id=new_day.id,
                    spot_id=event.spot_id,
                    place_id=event.place_id,
                    title=event.title,
                    description=event.description,
                    event_type=event.event_type,
                    start_at=_shift_datetime(event.start_at),
                    end_at=_shift_datetime(event.end_at),
                    local_start_time=event.local_start_time,
                    is_all_day=event.is_all_day,
                    address=event.address,
                    latitude=event.latitude,
                    longitude=event.longitude,
                    locked=False,
                    sort_order=event.sort_order,
                )
                db.add(new_event)

        db.commit()
        db.refresh(new_plan)
        return new_plan

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("旅行プラン複製中に予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="旅行プランの複製に失敗しました。しばらくしてから再試行してください。",
        )


@router.delete("/{plan_id}")
async def delete_travel_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """旅行プラン削除

    [Gate #30 設計判断] プラン全体の削除は、editorではなくownerのみに限定
    する。日/イベント単位の編集はeditorに許可するが、プラン自体の破壊的
    操作(削除)はownerの専権とする(共有機能の一般的な権限モデルに合わせた
    意図的な判断)。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="owner")

    # [Gate B-012] 物理削除(db.delete)は子データの外部キーで500になっていた。論理削除して
    # 共有リンクを即時失効し、猶予期間(PLAN_DELETE_GRACE_DAYS)後に完全削除する。
    try:
        revoked = plan_deletion.soft_delete_plan(db, plan, current_user.id)
        db.commit()
        record_audit_event(
            action="plan.delete", resource_type="travel_plan", user_id=current_user.id, resource_id=plan.id,
            details={"revoked_share_links": revoked, "grace_days": settings.PLAN_DELETE_GRACE_DAYS},
        )
        return {
            "message": "旅行プランを削除しました",
            "deleted_at": _iso(plan.deleted_at),
            "purge_after": _iso(plan.purge_after),
        }
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("旅行プラン削除中に予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="旅行プランの削除に失敗しました。しばらくしてから再試行してください。",
        )
