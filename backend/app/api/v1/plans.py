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
    IdempotencyRecord, User, Place,
)
from app.services.route_estimator import estimate_leg, haversine_km

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
    # [Gate #32] 検索候補(Gate #31 /search)から採用したPlaceのID。
    # 指定された場合、title/address/latitude/longitudeのうち未指定の
    # フィールドをPlaceの値で補完する(「候補に追加」と「旅程に追加」を
    # 分離しつつ、旅程に追加した際は出典を引き継ぐため)。
    place_id: Optional[str] = None


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
    place_id: Optional[str] = None

    @field_validator("id", "day_id", "place_id", mode="before")
    @classmethod
    def _stringify_ids(cls, v):
        return str(v) if v is not None else v

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
    return _record_batch_change_and_bump_revision(
        db, plan, user, source, [(entity_type, entity_id, action, before_json, after_json)]
    )


def _record_batch_change_and_bump_revision(
    db: Session, plan: TravelPlan, user: User, source: str,
    changes: List[tuple],
) -> int:
    """[Gate #33] 複数の変更を単一のChangeSet(単一のrevision進行)として
    記録する。最適化提案の適用のように「複数イベントの並べ替えをまとめて
    1操作として扱い、1回のUndoで全体を戻せるようにしたい」場合に使う。
    undo_last_changeは既にChangeSet内の全ChangeItemをループ処理する設計
    だったため、本関数の追加だけでバッチUndoに対応できる。changesは
    (entity_type, entity_id, action, before_json, after_json) のタプルの
    リスト。"""
    base_revision = plan.revision
    new_revision = base_revision + 1

    change_set = ChangeSet(
        plan_id=plan.id, actor_user_id=user.id, source=source,
        base_revision=base_revision, resulting_revision=new_revision,
    )
    db.add(change_set)
    db.flush()

    for entity_type, entity_id, action, before_json, after_json in changes:
        db.add(ChangeItem(
            change_set_id=change_set.id, entity_type=entity_type, entity_id=entity_id,
            action=action, before_json=before_json, after_json=after_json,
        ))

    plan.revision = new_revision
    db.add(PlanVersion(
        plan_id=plan.id, revision=new_revision,
        summary=f"{source}: {len(changes)}件の変更" if len(changes) > 1 else f"{changes[0][2]} {changes[0][0]}",
    ))

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
        "place_id": str(event.place_id) if event.place_id else None,
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

    # [Gate #32] place_idが指定された場合、未指定フィールドをPlaceの値で
    # 補完する(検索候補を「旅程に追加」する導線)。
    title = event_data.title
    address = event_data.address
    latitude = event_data.latitude
    longitude = event_data.longitude
    place_uuid: Optional[uuid.UUID] = None
    if event_data.place_id:
        try:
            place_uuid = uuid.UUID(event_data.place_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="place_idの形式が不正です")
        place = db.query(Place).filter(Place.id == place_uuid).first()
        if not place:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定したPlaceが見つかりません")
        title = title or place.name
        address = address if address is not None else place.address
        latitude = latitude if latitude is not None else place.latitude
        longitude = longitude if longitude is not None else place.longitude

    max_sort = db.query(TravelEvent).filter(TravelEvent.day_id == day.id).count()
    new_event = TravelEvent(
        plan_id=plan.id, day_id=day.id, place_id=place_uuid,
        title=title, description=event_data.description,
        event_type=event_data.event_type, start_at=event_data.start_at, end_at=event_data.end_at,
        local_start_time=event_data.local_start_time, is_all_day=event_data.is_all_day,
        address=address, latitude=latitude, longitude=longitude,
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
            place_id=before.get("place_id"),
            title=before["title"], description=before.get("description"),
            event_type=before.get("event_type", "activity"), local_start_time=before.get("local_start_time"),
            is_all_day=before.get("is_all_day", False), address=before.get("address"),
            latitude=before.get("latitude"), longitude=before.get("longitude"),
            locked=before.get("locked", False), sort_order=before.get("sort_order", 0),
        ))


# ===== [Gate #32] PLAN MAP: route preview / insertion preview =====
# v5.1仕様: 「候補を日付/時間スロットへドラッグすると挿入プレビューを
# 開始する」「採用前に移動時間/距離/営業時間/差分をpreviewし、承認後
# のみ正本更新」に対応する。ここでの計算はDBへ一切書き込まない
# (route_segmentsへの永続化は将来のGateで検討、本Gateではpreview応答
# のみを返す)。座標が無い地点(provider不在・曖昧位置)はunknownとして
# 明示し、架空の距離・時間を作らない。

class LegPreview(BaseModel):
    from_event_id: Optional[str] = None
    to_event_id: Optional[str] = None
    mode: str
    distance_km: Optional[float] = None
    duration_minutes: Optional[float] = None
    is_estimate: bool
    unknown: bool = False  # 座標欠落等でduration/distanceを算出できない場合True


class RoutePreviewResponse(BaseModel):
    day_id: str
    legs: List[LegPreview]
    total_distance_km: Optional[float] = None
    total_duration_minutes: Optional[float] = None
    provider: str
    algorithm_version: str


def _compute_day_legs(events: List[TravelEvent], mode: str) -> List[LegPreview]:
    legs: List[LegPreview] = []
    for i in range(len(events) - 1):
        a, b = events[i], events[i + 1]
        result = estimate_leg(a.latitude, a.longitude, b.latitude, b.longitude, mode)
        if result is None:
            legs.append(LegPreview(
                from_event_id=str(a.id), to_event_id=str(b.id), mode=mode,
                is_estimate=True, unknown=True,
            ))
        else:
            legs.append(LegPreview(
                from_event_id=str(a.id), to_event_id=str(b.id),
                mode=result["mode"], distance_km=result["distance_km"],
                duration_minutes=result["duration_minutes"], is_estimate=True, unknown=False,
            ))
    return legs


def _summarize_legs(legs: List["LegPreview"]):
    """区間リストの合計距離・時間を返す。座標不明の区間が1件でもあれば
    合計は算出不能(None)とする。区間が0件(イベントが0〜1件)の場合は
    「移動が無い」という確定事実なので0を返す(Noneにしない)。"""
    if any(leg.unknown for leg in legs):
        return None, None
    total_distance = round(sum(leg.distance_km or 0 for leg in legs), 2)
    total_duration = round(sum(leg.duration_minutes or 0 for leg in legs), 1)
    return total_distance, total_duration


@router.get("/{plan_id}/days/{day_id}/route-preview", response_model=RoutePreviewResponse)
async def get_route_preview(
    plan_id: str,
    day_id: str,
    mode: str = "walking",
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """指定日の現在のイベント順序に基づき、区間ごとの概算移動距離・時間を
    返す(閲覧のみ、viewer可)。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    day = db.query(TravelDay).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first()
    if not day:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定した日程が見つかりません")

    events = (
        db.query(TravelEvent)
        .filter(TravelEvent.day_id == day.id)
        .order_by(TravelEvent.sort_order)
        .all()
    )
    legs = _compute_day_legs(events, mode)
    total_distance, total_duration = _summarize_legs(legs)
    return RoutePreviewResponse(
        day_id=str(day.id),
        legs=legs,
        total_distance_km=total_distance,
        total_duration_minutes=total_duration,
        provider="haversine_estimate",
        algorithm_version="haversine-v1",
    )


class InsertionPreviewRequest(BaseModel):
    place_id: Optional[str] = None
    # place_idが無い場合、直接座標を指定して仮のスポットとして試算できる
    # (未採用のcandidateを試すため)。
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    after_event_id: Optional[str] = None  # Noneなら日の先頭へ挿入
    mode: str = "walking"


class InsertionPreviewResponse(BaseModel):
    day_id: str
    before: RoutePreviewResponse
    after: RoutePreviewResponse
    added_distance_km: Optional[float] = None
    added_duration_minutes: Optional[float] = None
    unknown: bool = False


@router.post("/{plan_id}/days/{day_id}/insertion-preview", response_model=InsertionPreviewResponse)
async def preview_insertion(
    plan_id: str,
    day_id: str,
    body: InsertionPreviewRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """候補(place_idまたは直接座標)を指定日の特定位置へ挿入した場合の
    移動時間・距離の変化を、何も確定させずに試算する(viewer可、DBへの
    書き込みは一切行わない)。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    day = db.query(TravelDay).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first()
    if not day:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定した日程が見つかりません")

    events = (
        db.query(TravelEvent)
        .filter(TravelEvent.day_id == day.id)
        .order_by(TravelEvent.sort_order)
        .all()
    )
    before_legs = _compute_day_legs(events, body.mode)
    before_distance, before_duration = _summarize_legs(before_legs)
    before_resp = RoutePreviewResponse(
        day_id=str(day.id), legs=before_legs,
        total_distance_km=before_distance,
        total_duration_minutes=before_duration,
        provider="haversine_estimate", algorithm_version="haversine-v1",
    )

    lat, lon = body.latitude, body.longitude
    if body.place_id:
        place = db.query(Place).filter(Place.id == body.place_id).first()
        if not place:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定したPlaceが見つかりません")
        lat, lon = place.latitude, place.longitude

    # 仮想イベント(DBには保存しない、計算専用の一時オブジェクト)を
    # 挿入位置へ差し込んだ順序を作る。
    virtual = TravelEvent(id=uuid.uuid4(), latitude=lat, longitude=lon)
    ordered = list(events)
    if body.after_event_id:
        idx = next((i for i, e in enumerate(ordered) if str(e.id) == body.after_event_id), None)
        if idx is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="after_event_idのイベントが見つかりません")
        ordered.insert(idx + 1, virtual)
    else:
        ordered.insert(0, virtual)

    after_legs = _compute_day_legs(ordered, body.mode)
    after_distance, after_duration = _summarize_legs(after_legs)
    after_resp = RoutePreviewResponse(
        day_id=str(day.id), legs=after_legs,
        total_distance_km=after_distance,
        total_duration_minutes=after_duration,
        provider="haversine_estimate", algorithm_version="haversine-v1",
    )

    unknown = lat is None or lon is None
    added_distance = None
    added_duration = None
    if not unknown and before_resp.total_distance_km is not None and after_resp.total_distance_km is not None:
        added_distance = round(after_resp.total_distance_km - before_resp.total_distance_km, 2)
    if not unknown and before_resp.total_duration_minutes is not None and after_resp.total_duration_minutes is not None:
        added_duration = round(after_resp.total_duration_minutes - before_resp.total_duration_minutes, 1)

    return InsertionPreviewResponse(
        day_id=str(day.id), before=before_resp, after=after_resp,
        added_distance_km=added_distance, added_duration_minutes=added_duration,
        unknown=unknown,
    )


# ===== [Gate #33] 説明可能な経路最適化(提案 -> 承認 -> 適用 -> Undo) =====
# 監査是正: 「AI最適化」と称していたが実体は近傍法(nearest neighbor)に
# よる並べ替えのみであり、天候・混雑・予算等の設定項目(旧OptimizationPanel)
# はバックエンドに一切効果を与えていなかった(UI上の見せかけの設定)。
# 本Gateでは名称を実体に合わせ("nearest_neighbor_haversine")、以下を満たす:
# - hard constraint: locked=Trueのイベントは並べ替えの対象から除外し、
#   元の位置に固定する。
# - 提案(proposal)はDBに一切書き込まず、現在の正規化データから都度計算する。
# - 適用(apply)はIf-Matchでrevision不一致なら409を返し、複数イベントの
#   並べ替えを単一のChangeSet(単一revision進行)として記録するため、
#   1回のUndoで全体を戻せる。
# - 座標が無いイベントは架空の位置を作らず、並べ替え対象から除外して
#   元の相対順序のまま保持する(warningsで明示)。

ALGORITHM_NAME = "nearest_neighbor_haversine"
ALGORITHM_VERSION = "nn-haversine-v1"


class OptimizationLegPreview(BaseModel):
    from_event_id: Optional[str] = None
    to_event_id: Optional[str] = None
    distance_km: Optional[float] = None
    duration_minutes: Optional[float] = None
    unknown: bool = False


class OptimizationProposalResponse(BaseModel):
    day_id: str
    base_revision: int
    algorithm: str
    algorithm_version: str
    proposed_order: List[str]  # event_idの新しい並び順(sort_order昇順)
    locked_event_ids: List[str]
    before_total_distance_km: Optional[float] = None
    after_total_distance_km: Optional[float] = None
    before_total_duration_minutes: Optional[float] = None
    after_total_duration_minutes: Optional[float] = None
    saved_distance_km: Optional[float] = None
    saved_duration_minutes: Optional[float] = None
    warnings: List[str] = []
    has_improvement: bool = False


def _nearest_neighbor_order(events: List[TravelEvent]) -> List[TravelEvent]:
    if not events:
        return []
    remaining = list(events)
    ordered = [remaining.pop(0)]
    while remaining:
        current = ordered[-1]
        nearest_idx = min(
            range(len(remaining)),
            key=lambda i: haversine_km(current.latitude, current.longitude, remaining[i].latitude, remaining[i].longitude),
        )
        ordered.append(remaining.pop(nearest_idx))
    return ordered


def _optimize_day_order(events: List[TravelEvent]) -> tuple:
    """sort_order順のイベントリストを受け取り、lockedなイベントの位置は
    固定したまま、unlockedかつ座標を持つイベントだけを最近傍法で並べ替えた
    新しい順序を返す。(新しい順序のTravelEventリスト, warnings)のタプル。"""
    warnings: List[str] = []
    unlocked_indices = [i for i, e in enumerate(events) if not e.locked]
    unlocked_events = [events[i] for i in unlocked_indices]

    with_coords = [e for e in unlocked_events if e.latitude is not None and e.longitude is not None]
    without_coords = [e for e in unlocked_events if e.latitude is None or e.longitude is None]
    if without_coords:
        warnings.append(
            f"{len(without_coords)}件のイベントは位置情報が無いため並べ替え対象外です(元の順序のまま保持)"
        )

    ordered_with_coords = _nearest_neighbor_order(with_coords) if len(with_coords) > 1 else with_coords
    new_unlocked_order = ordered_with_coords + without_coords

    result = list(events)
    for idx, event in zip(unlocked_indices, new_unlocked_order):
        result[idx] = event
    return result, warnings


def _day_route_totals(events: List[TravelEvent], mode: str = "walking"):
    legs = _compute_day_legs(events, mode)
    return _summarize_legs(legs)


@router.post("/{plan_id}/days/{day_id}/optimization-proposal", response_model=OptimizationProposalResponse)
async def create_optimization_proposal(
    plan_id: str,
    day_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """指定日のイベント順序を最近傍法で並べ替える提案を計算する
    (閲覧のみ、viewer可、DBへは一切書き込まない)。lockedなイベントは
    固定し、座標の無いイベントは並べ替え対象外として保持する。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    day = db.query(TravelDay).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first()
    if not day:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定した日程が見つかりません")

    events = (
        db.query(TravelEvent)
        .filter(TravelEvent.day_id == day.id)
        .order_by(TravelEvent.sort_order)
        .all()
    )

    if len(events) < 2:
        return OptimizationProposalResponse(
            day_id=str(day.id), base_revision=plan.revision,
            algorithm=ALGORITHM_NAME, algorithm_version=ALGORITHM_VERSION,
            proposed_order=[str(e.id) for e in events],
            locked_event_ids=[str(e.id) for e in events if e.locked],
            warnings=["イベントが2件未満のため並べ替えの余地がありません"],
            has_improvement=False,
        )

    before_distance, before_duration = _day_route_totals(events)
    new_order, warnings = _optimize_day_order(events)
    after_distance, after_duration = _day_route_totals(new_order)

    has_improvement = (
        before_distance is not None and after_distance is not None
        and after_distance < before_distance - 0.01
    )
    if not has_improvement and not warnings:
        warnings.append("この順序が既に最短(またはこれ以上の改善候補がありません)")

    return OptimizationProposalResponse(
        day_id=str(day.id),
        base_revision=plan.revision,
        algorithm=ALGORITHM_NAME,
        algorithm_version=ALGORITHM_VERSION,
        proposed_order=[str(e.id) for e in new_order],
        locked_event_ids=[str(e.id) for e in events if e.locked],
        before_total_distance_km=before_distance,
        after_total_distance_km=after_distance,
        before_total_duration_minutes=before_duration,
        after_total_duration_minutes=after_duration,
        saved_distance_km=(
            round(before_distance - after_distance, 2)
            if before_distance is not None and after_distance is not None else None
        ),
        saved_duration_minutes=(
            round(before_duration - after_duration, 1)
            if before_duration is not None and after_duration is not None else None
        ),
        warnings=warnings,
        has_improvement=has_improvement,
    )


class OptimizationApplyRequest(BaseModel):
    proposed_order: List[str]


@router.post("/{plan_id}/days/{day_id}/optimization-proposal/apply", response_model=DayWithEvents)
async def apply_optimization_proposal(
    plan_id: str,
    day_id: str,
    body: OptimizationApplyRequest,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """提案されたproposed_orderを実際に適用する。If-Matchのrevisionが
    現在のplan.revisionと一致しない場合は409(他の変更と競合)を返す
    (提案生成後、適用までの間に別の変更が入ったケースを検出するため)。
    複数イベントの並べ替えを単一のChangeSetとして記録し、1回のUndoで
    全体を戻せるようにする。lockedなイベントの並び順が含まれていても
    その位置がずれていなければ影響しない(locked自体は動かない設計)。"""
    plan = _get_owned_plan(db, plan_id, current_user)
    _require_if_match(plan, if_match)

    day = db.query(TravelDay).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first()
    if not day:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定した日程が見つかりません")

    events_by_id = {
        str(e.id): e
        for e in db.query(TravelEvent).filter(TravelEvent.day_id == day.id).all()
    }
    if set(body.proposed_order) != set(events_by_id.keys()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="proposed_orderが現在のイベント集合と一致しません(提案取得後に変更があった可能性があります)",
        )

    changes = []
    for new_sort_order, event_id in enumerate(body.proposed_order):
        event = events_by_id[event_id]
        if event.locked:
            continue  # ロック済みイベントの位置は変更しない
        if event.sort_order == new_sort_order:
            continue
        before = _event_to_dict(event)
        event.sort_order = new_sort_order
        changes.append(("travel_event", event.id, "reorder", before, _event_to_dict(event)))

    if changes:
        db.flush()
        _record_batch_change_and_bump_revision(db, plan, current_user, "optimization", changes)
    else:
        db.commit()

    updated_events = (
        db.query(TravelEvent)
        .filter(TravelEvent.day_id == day.id)
        .order_by(TravelEvent.sort_order)
        .all()
    )
    db.refresh(day)
    return DayWithEvents(
        **DayResponse.model_validate(day).model_dump(mode="json"),
        events=[EventResponse.model_validate(e).model_dump(mode="json") for e in updated_events],
    )
