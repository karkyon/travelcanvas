"""
[Gate #31] 検索candidate/place API。

frontendが直接外部APIを叩いていた検索処理をbackendへ集約する。
候補(SearchCandidate)は検索の都度、重複削除せず新規行として保存する
(比較提示のため)。ユーザーが選んだ候補は「採用(adopt)」することで
正規のPlaceへ変換され、フィールドごとの出典(FieldSource)を記録する。
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.models.models import FieldSource, Place, SearchCandidate, SourceRecord, User
from app.services.search_provider import search_all_providers

router = APIRouter(prefix="/search", tags=["search"])


class SearchSpotsBody(BaseModel):
    query: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_km: float = 5.0
    max_results: int = 20


def _candidate_to_dict(c: SearchCandidate) -> dict:
    return {
        "id": str(c.id),
        "provider": c.provider,
        "name": c.name,
        "category": c.category,
        "location": {
            "latitude": c.latitude,
            "longitude": c.longitude,
            "address": c.address,
        },
        "retrieved_at": c.retrieved_at.isoformat() if c.retrieved_at else None,
    }


@router.post("/spots")
async def search_spots(
    body: SearchSpotsBody,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """キーワードでスポット候補を検索する。結果は毎回SearchCandidate/
    SourceRecordとして永続化し、重複候補も削除せずそのまま返す
    (ユーザーが比較して選べるようにするため)。

    [Gate #31] 検索に失敗した/該当0件だった場合、この関数は空配列を
    返す。かつてfrontendに存在した「0件やエラー時にMath.random()で
    架空のスポットを生成して返す」という挙動はここには一切存在しない。
    """
    if not body.query or not body.query.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="queryは必須です")

    raw_results = await search_all_providers(
        body.query.strip(), body.latitude, body.longitude, body.radius_km
    )
    raw_results = raw_results[: max(1, min(body.max_results, 50))]

    candidates = []
    for r in raw_results:
        candidate = SearchCandidate(
            id=uuid.uuid4(),
            query=body.query.strip(),
            provider=r["provider"],
            external_id=r.get("external_id"),
            name=r["name"],
            category=r.get("category"),
            latitude=r.get("latitude"),
            longitude=r.get("longitude"),
            address=r.get("address"),
            raw_payload=r.get("raw_payload"),
            searched_by_user_id=current_user.id,
            retrieved_at=r["retrieved_at"],
        )
        db.add(candidate)
        db.flush()

        db.add(SourceRecord(
            candidate_id=candidate.id,
            provider=r["provider"],
            source_url=r.get("source_url"),
            retrieved_at=r["retrieved_at"],
            freshness_state="fresh",
            raw_response=r.get("raw_payload"),
        ))
        candidates.append(candidate)

    db.commit()
    for c in candidates:
        db.refresh(c)

    return {
        "query": body.query,
        "total": len(candidates),
        "candidates": [_candidate_to_dict(c) for c in candidates],
    }


@router.post("/candidates/{candidate_id}/adopt")
async def adopt_candidate(
    candidate_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """候補を正規のPlaceへ採用する。フィールドごとの出典を
    FieldSourceとして記録し、候補が持つSourceRecordをPlaceにも
    紐づける(source継承)。"""
    candidate = db.query(SearchCandidate).filter(SearchCandidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="候補が見つかりません")

    source_record = (
        db.query(SourceRecord)
        .filter(SourceRecord.candidate_id == candidate.id)
        .order_by(SourceRecord.created_at.desc())
        .first()
    )

    place = Place(
        id=uuid.uuid4(),
        name=candidate.name,
        category=candidate.category,
        latitude=candidate.latitude,
        longitude=candidate.longitude,
        address=candidate.address,
        adopted_from_candidate_id=candidate.id,
        created_by=current_user.id,
    )
    db.add(place)
    db.flush()

    # 候補由来のSourceRecordをPlaceにも継承させる(同じ取得記録を指すが
    # candidate/place両方から参照できるよう、place_idを追記した複製を作る)
    place_source = SourceRecord(
        place_id=place.id,
        candidate_id=candidate.id,
        provider=source_record.provider if source_record else candidate.provider,
        source_url=source_record.source_url if source_record else None,
        retrieved_at=source_record.retrieved_at if source_record else candidate.retrieved_at,
        freshness_state="fresh",
        raw_response=source_record.raw_response if source_record else candidate.raw_payload,
    )
    db.add(place_source)
    db.flush()

    for field_name, value in (
        ("name", candidate.name),
        ("category", candidate.category),
        ("latitude", candidate.latitude),
        ("longitude", candidate.longitude),
        ("address", candidate.address),
    ):
        if value is None:
            continue
        db.add(FieldSource(
            place_id=place.id,
            field_name=field_name,
            value=str(value),
            source_record_id=place_source.id,
        ))

    db.commit()
    db.refresh(place)

    return {
        "id": str(place.id),
        "name": place.name,
        "category": place.category,
        "location": {
            "latitude": place.latitude,
            "longitude": place.longitude,
            "address": place.address,
        },
        "adopted_from_candidate_id": str(candidate.id),
    }


@router.get("/places/{place_id}")
async def get_place(
    place_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    place = db.query(Place).filter(Place.id == place_id).first()
    if not place:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Placeが見つかりません")

    field_sources = db.query(FieldSource).filter(FieldSource.place_id == place.id).all()
    return {
        "id": str(place.id),
        "name": place.name,
        "category": place.category,
        "location": {
            "latitude": place.latitude,
            "longitude": place.longitude,
            "address": place.address,
        },
        "field_sources": [
            {
                "field_name": fs.field_name,
                "value": fs.value,
                "source_record_id": str(fs.source_record_id),
            }
            for fs in field_sources
        ],
    }
