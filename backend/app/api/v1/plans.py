"""
[Gate #29] Plan/Day/Event 正規化 API(正本)

既存の /travel-plans (app/api/v1/travel.py) は TravelPlan.itinerary という
JSON blobに日程・イベントを丸ごと保持しており、フロントエンドや最適化
エンドポイントは今もこれを読み書きしている。本Gateはこの正規化を一気に
置き換えるのではなく、travel_days/travel_events等の正規テーブルを
「読み書きの正本」とする新しいAPI(/plans以下)を並行導入する。

- /travel-plans はこのGateでは一切変更しない(後方互換・無停止)。
- /plans は新規に作成したプラン、または /travel-plans 側から移行した
  プラン(Gate #29マイグレーションでitinerary JSONをbackfill済み)に対して
  日/イベント単位のCRUD・並べ替え・Undoを提供する。
- 楽観的並行制御: 全ての更新・削除・移動はIf-Matchヘッダーで現在の
  plan.revisionを要求し、一致しない場合は409を返す。
- Idempotency-Key: POST(作成・移動)はIdempotency-Keyヘッダーを受け付け、
  同一user×endpoint×keyの再送に対しては実処理を再実行せず前回の
  レスポンスをそのまま返す。
- 変更は全てChangeSet/ChangeItemとして記録し、直近の変更を1件だけUndo
  できる。

未実装(次Gate以降): フロントエンドのこのAPIへの切り替え、最適化
エンドポイントとの統合、event_linksを使った予約・文書との関連付け。
"""
import uuid
from datetime import datetime, date as date_cls, timezone as dt_timezone
from typing import Optional, List, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status, Header, Response
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.core.plan_access import require_plan_access
from app.models.models import (
    TravelPlan, TravelDay, TravelEvent, PlanVersion, ChangeSet, ChangeItem,
    IdempotencyRecord, User,
)

router = APIRouter(prefix="/plans", tags=["plans"])


# ===== スキーマ =====

class DayCreate(BaseModel):
    local_date: date_cls
    timezone_id: str = "UTC"
    title: Optional[str] = None
    notes: Optional[str] = None


class DayUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None


class DayResponse(BaseModel):
    id: str
    local_date: date_cls
    timezone_id: str
    title: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int

    @field_validator("id", mode="before")
    @classmethod
    def _stringify_id(cls, v):
        return str(v)

    class Config:
        from_attributes = True


class EventCreate(BaseModel):
    day_id: str
    title: str
    description: Optional[str] = None
    event_type: str = "activity"
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    local_start_time: Optional[str] = None
    is_all_day: bool = False
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    local_start_time: Optional[str] = None
    is_all_day: Optional[bool] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    locked: Optional[bool] = None


class EventMove(BaseModel):
    day_id: Optional[str] = None  # 別の日へ移す場合。Noneなら同日内での並べ替え
    sort_order: int


class EventResponse(BaseModel):
    id: str
    day_id: str
    title: str
    description: Optional[str] = None
    event_type: str
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    local_start_time: Optional[str] = None
    is_all_day: bool
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    locked: bool
    sort_order: int

    @field_validator("id", "day_id", mode="before")
    @classmethod
    def _stringify_ids(cls, v):
        return str(v)

    class Config:
        from_attributes = True


class DayWithEvents(DayResponse):
    events: List[EventResponse] = []


class PlanDetailResponse(BaseModel):
    id: str
    title: str
    revision: int
    days: List[DayWithEvents]

    @field_validator("id", mode="before")
    @classmethod
    def _stringify_id(cls, v):
        return str(v)

    class Config:
        from_attributes = True


# ===== 共通ヘルパー =====

def _get_owned_plan(db: Session, plan_id: str, user: User, min_role: str = "editor") -> TravelPlan:
    """[Gate #30] 名称は既存のまま維持しているが、実体は
    owner/editor/viewerを判定するrequire_plan_accessへ委譲する。
    Day/EventのCRUD・移動・Undoはeditor以上、閲覧(GET)はviewer以上を要求
    するため呼び出し側でmin_roleを指定する(デフォルトはeditor=書き込み系)。
    """
    plan, _role = require_plan_access(db, plan_id, user, min_role=min_role)
    return plan


def _require_if_match(plan: TravelPlan, if_match: Optional[str]) -> None:
    """[Gate #29] 更新・削除・移動系エンドポイントは全てIf-Matchを必須にする
    (未指定は400、値不一致は409)。作成のみ、対象がまだ存在しないため
    If-Matchを要求しない。"""
    if if_match is None or if_match.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="If-Matchヘッダーが必要です(現在のリビジョンをGETで取得してから指定してください)",
        )
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="If-Matchの形式が不正です")
    if expected != plan.revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"プランが他の変更で更新されています(現在のリビジョン: {plan.revision})",
        )


def _check_idempotency(db: Session, user: User, endpoint: str, key: Optional[str]):
    if not key:
        return None
    existing = (
        db.query(IdempotencyRecord)
        .filter(
            IdempotencyRecord.key == key,
            IdempotencyRecord.user_id == user.id,
            IdempotencyRecord.endpoint == endpoint,
        )
        .first()
    )
    if existing:
        return existing
    return None


def _store_idempotency(db: Session, user: User, endpoint: str, key: Optional[str], status_code: int, response_json: dict):
    if not key:
        return
    record = IdempotencyRecord(
        key=key, user_id=user.id, endpoint=endpoint,
        response_status=status_code, response_json=response_json,
    )
    db.add(record)
    db.commit()


def _record_change_and_bump_revision(
    db: Session, plan: TravelPlan, user: User, source: str,
    entity_type: str, entity_id, action: str,
    before_json: Optional[dict], after_json: Optional[dict],
) -> int:
    """1件の変更を記録し、plan.revisionを1つ進める。ChangeSet 1件につき
    ChangeItem 1件という単純な粒度にしている(Undoは直近1件を対象とする)。"""
    base_revision = plan.revision
    new_revision = base_revision + 1

    change_set = ChangeSet(
        plan_id=plan.id, actor_user_id=user.id, source=source,
        base_revision=base_revision, resulting_revision=new_revision,
    )
    db.add(change_set)
    db.flush()

    db.add(ChangeItem(
        change_set_id=change_set.id, entity_type=entity_type, entity_id=entity_id,
        action=action, before_json=before_json, after_json=after_json,
    ))

    plan.revision = new_revision
    db.add(PlanVersion(plan_id=plan.id, revision=new_revision, summary=f"{action} {entity_type}"))

    db.commit()
    return new_revision


def _day_to_dict(day: TravelDay) -> dict:
    return {
        "local_date": day.local_date.isoformat() if day.local_date else None,
        "timezone_id": day.timezone_id,
        "title": day.title,
        "notes": day.notes,
        "sort_order": day.sort_order,
    }


def _event_to_dict(event: TravelEvent) -> dict:
    return {
        "day_id": str(event.day_id),
        "title": event.title,
        "description": event.description,
        "event_type": event.event_type,
        "start_at": event.start_at.isoformat() if event.start_at else None,
        "end_at": event.end_at.isoformat() if event.end_at else None,
        "local_start_time": event.local_start_time,
        "is_all_day": event.is_all_day,
        "address": event.address,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "locked": event.locked,
        "sort_order": event.sort_order,
    }


# ===== プラン全体取得 =====

@router.get("/{plan_id}", response_model=PlanDetailResponse)
async def get_plan_detail(
    plan_id: str,
    response: Response,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """プラン詳細を日/イベント込みで返す。revisionはレスポンスボディの
    `revision`フィールドとETagヘッダーの両方で返す(以降の更新系呼び出し
    でIf-Matchに使う)。

    [Gate #31.5C] 以前はこのdocstringが「レスポンスヘッダーETagに
    revisionを載せる」と説明していたが、実装はボディにrevisionを返す
    のみでETagヘッダーは設定されていなかった(説明とコードが矛盾していた)。
    ボディでのrevision取得は今のフロントエンド実装で十分機能するため
    そのまま維持しつつ、ETagヘッダーも合わせて設定し実態と説明を一致させる。"""
    plan = _get_owned_plan(db, plan_id, current_user, min_role="viewer")
    response.headers["ETag"] = f'"{plan.revision}"'
    days = (
        db.query(TravelDay)
        .filter(TravelDay.plan_id == plan.id)
        .order_by(TravelDay.sort_order, TravelDay.local_date)
        .all()
    )
    return PlanDetailResponse(
        id=str(plan.id),
        title=plan.title,
        revision=plan.revision,
        days=[
            DayWithEvents(
                id=str(day.id), local_date=day.local_date, timezone_id=day.timezone_id,
                title=day.title, notes=day.notes, sort_order=day.sort_order,
                events=[EventResponse.model_validate(e) for e in sorted(day.events, key=lambda e: e.sort_order)],
            )
            for day in days
        ],
    )


# ===== Day CRUD =====

@router.post("/{plan_id}/days", response_model=DayResponse, status_code=status.HTTP_201_CREATED)
async def create_day(
    plan_id: str,
    day_data: DayCreate,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)

    cached = _check_idempotency(db, current_user, "POST /plans/days", idempotency_key)
    if cached:
        return cached.response_json

    existing = db.query(TravelDay).filter(
        TravelDay.plan_id == plan.id, TravelDay.local_date == day_data.local_date
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同じ日付の日程が既に存在します")

    max_sort = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).count()
    new_day = TravelDay(
        plan_id=plan.id, local_date=day_data.local_date, timezone_id=day_data.timezone_id,
        title=day_data.title, notes=day_data.notes, sort_order=max_sort,
    )
    db.add(new_day)
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_day", new_day.id, "create",
        before_json=None, after_json=_day_to_dict(new_day),
    )
    db.refresh(new_day)

    response = DayResponse.model_validate(new_day).model_dump(mode="json")
    _store_idempotency(db, current_user, "POST /plans/days", idempotency_key, 201, response)
    return response


@router.put("/{plan_id}/days/{day_id}", response_model=DayResponse)
async def update_day(
    plan_id: str,
    day_id: str,
    day_data: DayUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    _require_if_match(plan, if_match)

    day = db.query(TravelDay).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first()
    if not day:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="日程が見つかりません")

    before = _day_to_dict(day)
    update_data = day_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(day, field, value)
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_day", day.id, "update",
        before_json=before, after_json=_day_to_dict(day),
    )
    db.refresh(day)
    return day


@router.delete("/{plan_id}/days/{day_id}")
async def delete_day(
    plan_id: str,
    day_id: str,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    _require_if_match(plan, if_match)

    day = db.query(TravelDay).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first()
    if not day:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="日程が見つかりません")

    before = _day_to_dict(day)
    before["_events"] = [_event_to_dict(e) for e in day.events]  # cascade削除される子も記録
    db.delete(day)
    db.flush()

    new_revision = _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_day", day_id if isinstance(day_id, uuid.UUID) else uuid.UUID(day_id),
        "delete", before_json=before, after_json=None,
    )
    return {"message": "日程を削除しました", "revision": new_revision}


# ===== Event CRUD =====

@router.post("/{plan_id}/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    plan_id: str,
    event_data: EventCreate,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)

    cached = _check_idempotency(db, current_user, "POST /plans/events", idempotency_key)
    if cached:
        return cached.response_json

    day = db.query(TravelDay).filter(TravelDay.id == event_data.day_id, TravelDay.plan_id == plan.id).first()
    if not day:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定した日程が見つかりません")

    max_sort = db.query(TravelEvent).filter(TravelEvent.day_id == day.id).count()
    new_event = TravelEvent(
        plan_id=plan.id, day_id=day.id,
        title=event_data.title, description=event_data.description,
        event_type=event_data.event_type, start_at=event_data.start_at, end_at=event_data.end_at,
        local_start_time=event_data.local_start_time, is_all_day=event_data.is_all_day,
        address=event_data.address, latitude=event_data.latitude, longitude=event_data.longitude,
        sort_order=max_sort,
    )
    db.add(new_event)
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_event", new_event.id, "create",
        before_json=None, after_json=_event_to_dict(new_event),
    )
    db.refresh(new_event)

    response = EventResponse.model_validate(new_event).model_dump(mode="json")
    _store_idempotency(db, current_user, "POST /plans/events", idempotency_key, 201, response)
    return response


@router.put("/{plan_id}/events/{event_id}", response_model=EventResponse)
async def update_event(
    plan_id: str,
    event_id: str,
    event_data: EventUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    _require_if_match(plan, if_match)

    event = db.query(TravelEvent).filter(TravelEvent.id == event_id, TravelEvent.plan_id == plan.id).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="イベントが見つかりません")
    if event.locked and event_data.locked is not True and any(
        k != "locked" for k in event_data.model_dump(exclude_unset=True)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="このイベントはロックされているため編集できません(ロック解除してください)",
        )

    before = _event_to_dict(event)
    update_data = event_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(event, field, value)
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_event", event.id, "update",
        before_json=before, after_json=_event_to_dict(event),
    )
    db.refresh(event)
    return event


@router.delete("/{plan_id}/events/{event_id}")
async def delete_event(
    plan_id: str,
    event_id: str,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    _require_if_match(plan, if_match)

    event = db.query(TravelEvent).filter(TravelEvent.id == event_id, TravelEvent.plan_id == plan.id).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="イベントが見つかりません")

    before = _event_to_dict(event)
    event_uuid = event.id
    db.delete(event)
    db.flush()

    new_revision = _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_event", event_uuid, "delete",
        before_json=before, after_json=None,
    )
    return {"message": "イベントを削除しました", "revision": new_revision}


@router.post("/{plan_id}/events/{event_id}/move", response_model=EventResponse)
async def move_event(
    plan_id: str,
    event_id: str,
    move_data: EventMove,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """同日内の並べ替え、または別日への移動。ロックされたイベントは移動不可。"""
    plan = _get_owned_plan(db, plan_id, current_user)
    _require_if_match(plan, if_match)

    cached = _check_idempotency(db, current_user, "POST /plans/events/move", idempotency_key)
    if cached:
        return cached.response_json

    event = db.query(TravelEvent).filter(TravelEvent.id == event_id, TravelEvent.plan_id == plan.id).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="イベントが見つかりません")
    if event.locked:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ロックされたイベントは移動できません")

    if move_data.day_id:
        target_day = db.query(TravelDay).filter(
            TravelDay.id == move_data.day_id, TravelDay.plan_id == plan.id
        ).first()
        if not target_day:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="移動先の日程が見つかりません")
    else:
        target_day = None

    before = _event_to_dict(event)
    if target_day:
        event.day_id = target_day.id
    event.sort_order = move_data.sort_order
    db.flush()

    _record_change_and_bump_revision(
        db, plan, current_user, "manual", "travel_event", event.id, "reorder",
        before_json=before, after_json=_event_to_dict(event),
    )
    db.refresh(event)

    response = EventResponse.model_validate(event).model_dump(mode="json")
    _store_idempotency(db, current_user, "POST /plans/events/move", idempotency_key, 200, response)
    return response


# ===== Undo =====

@router.post("/{plan_id}/undo")
async def undo_last_change(
    plan_id: str,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """直近の(まだUndoされていない)ChangeSet 1件を取り消す。"""
    plan = _get_owned_plan(db, plan_id, current_user)
    _require_if_match(plan, if_match)

    change_set = (
        db.query(ChangeSet)
        .filter(ChangeSet.plan_id == plan.id, ChangeSet.undone_at.is_(None))
        .order_by(ChangeSet.resulting_revision.desc())
        .first()
    )
    if not change_set:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="取り消せる変更がありません")

    items = db.query(ChangeItem).filter(ChangeItem.change_set_id == change_set.id).all()

    for item in items:
        if item.entity_type == "travel_day":
            _undo_day_item(db, plan, item)
        elif item.entity_type == "travel_event":
            _undo_event_item(db, plan, item)

    change_set.undone_at = datetime.now(dt_timezone.utc)
    db.flush()

    # [Gate #29] Undoという操作自体を通常のChangeSetとして記録すると、
    # 「直近の未Undo変更」を検索する次回のUndoがこの記録自体を拾ってしまい、
    # 本来undoすべき次の変更に辿り着けなくなる(実際にこのテストで発覚)。
    # revisionは進めるが、undo操作はChangeSet/ChangeItemを作らず、
    # 監査用のPlanVersionだけを残す。
    new_revision = plan.revision + 1
    plan.revision = new_revision
    db.add(PlanVersion(
        plan_id=plan.id, revision=new_revision,
        summary=f"undo change_set {change_set.id}",
    ))
    db.commit()
    return {"message": "直前の変更を取り消しました", "revision": new_revision}


def _undo_day_item(db: Session, plan: TravelPlan, item: ChangeItem):
    if item.action == "create":
        day = db.query(TravelDay).filter(TravelDay.id == item.entity_id).first()
        if day:
            db.delete(day)
    elif item.action == "update" and item.before_json:
        day = db.query(TravelDay).filter(TravelDay.id == item.entity_id).first()
        if day:
            for k, v in item.before_json.items():
                if k == "local_date" and v:
                    v = date_cls.fromisoformat(v)
                setattr(day, k, v)
    elif item.action == "delete" and item.before_json:
        before = dict(item.before_json)
        events = before.pop("_events", [])
        restored = TravelDay(
            id=item.entity_id, plan_id=plan.id,
            local_date=date_cls.fromisoformat(before["local_date"]) if before.get("local_date") else None,
            timezone_id=before.get("timezone_id", "UTC"), title=before.get("title"),
            notes=before.get("notes"), sort_order=before.get("sort_order", 0),
        )
        db.add(restored)
        db.flush()
        for e in events:
            db.add(TravelEvent(
                plan_id=plan.id, day_id=restored.id, title=e["title"], description=e.get("description"),
                event_type=e.get("event_type", "activity"), local_start_time=e.get("local_start_time"),
                is_all_day=e.get("is_all_day", False), address=e.get("address"),
                latitude=e.get("latitude"), longitude=e.get("longitude"),
                locked=e.get("locked", False), sort_order=e.get("sort_order", 0),
            ))


def _undo_event_item(db: Session, plan: TravelPlan, item: ChangeItem):
    if item.action == "create":
        event = db.query(TravelEvent).filter(TravelEvent.id == item.entity_id).first()
        if event:
            db.delete(event)
    elif item.action in ("update", "reorder") and item.before_json:
        event = db.query(TravelEvent).filter(TravelEvent.id == item.entity_id).first()
        if event:
            for k, v in item.before_json.items():
                setattr(event, k, v)
    elif item.action == "delete" and item.before_json:
        before = item.before_json
        db.add(TravelEvent(
            id=item.entity_id, plan_id=plan.id, day_id=before["day_id"],
            title=before["title"], description=before.get("description"),
            event_type=before.get("event_type", "activity"), local_start_time=before.get("local_start_time"),
            is_all_day=before.get("is_all_day", False), address=before.get("address"),
            latitude=before.get("latitude"), longitude=before.get("longitude"),
            locked=before.get("locked", False), sort_order=before.get("sort_order", 0),
        ))
