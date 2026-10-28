"""
[Gate #31] 検索candidate/place API。

frontendが直接外部APIを叩いていた検索処理をbackendへ集約する。
候補(SearchCandidate)は検索の都度、重複削除せず新規行として保存する
(比較提示のため)。ユーザーが選んだ候補は「採用(adopt)」することで
正規のPlaceへ変換され、フィールドごとの出典(FieldSource)を記録する。
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.models.models import FieldSource, Place, SearchCandidate, SourceRecord, User
from app.services import place_access
from app.services.search_provider import search_all_providers

router = APIRouter(prefix="/search", tags=["search"])


class SearchSpotsBody(BaseModel):
    query: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_km: float = 5.0
    max_results: int = 20
    # [Gate G11] 近くの検索のカテゴリ(all・food・market・shopping・viewpoint・sightseeing・quiet)
    category: str = "all"


# [Gate G11] 半径を保証できる provider(座標の周りを探す)。他は「周辺優先」で、半径の内と言い切らない
RADIUS_GUARANTEED = frozenset({"overpass"})


def _distance(c: SearchCandidate, body: "SearchSpotsBody") -> dict:
    from app.services.route_estimator import haversine_km

    if body.latitude is None or body.longitude is None or c.latitude is None or c.longitude is None:
        return {"distance_m": None, "within_radius": None, "radius_guaranteed": c.provider in RADIUS_GUARANTEED}
    d = haversine_km(body.latitude, body.longitude, c.latitude, c.longitude) * 1000
    return {"distance_m": round(d), "within_radius": d <= body.radius_km * 1000,
            "radius_guaranteed": c.provider in RADIUS_GUARANTEED}


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
    from app.services.search_provider import CATEGORIES

    if body.category not in CATEGORIES:
        raise HTTPException(status_code=422, detail={"code": "invalid_field", "message": "カテゴリが不正です"})
    if not (body.query or "").strip() and body.category == "all":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="queryは必須です")
    if body.category != "all" and (body.latitude is None or body.longitude is None):
        raise HTTPException(status_code=422, detail={"code": "invalid_field",
                                                     "message": "カテゴリで探す時は、探す基点(緯度・経度)を指定してください"})
    if not 0.1 <= body.radius_km <= 20:
        raise HTTPException(status_code=422, detail={"code": "invalid_field", "message": "半径は0.1〜20kmで指定してください"})

    extra = {"category": body.category} if body.category != "all" else {}  # 「すべて」は以前と同じ呼び方
    raw_results = await search_all_providers(
        (body.query or "").strip(), body.latitude, body.longitude, body.radius_km, **extra
    )
    raw_results = raw_results[: max(1, min(body.max_results, 50))]

    candidates = []
    for r in raw_results:
        candidate = SearchCandidate(
            id=uuid.uuid4(),
            query=(body.query or "").strip() or f"category:{body.category}",
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
        "category": body.category,
        "radius_km": body.radius_km,
        "base": ({"latitude": body.latitude, "longitude": body.longitude}
                 if body.latitude is not None and body.longitude is not None else None),
        "total": len(candidates),
        "candidates": [{**_candidate_to_dict(c), **_distance(c, body)} for c in candidates],
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
    # [Gate C2] 以前は他の人の検索結果も ID だけで採用できた(IDOR)。本人の検索結果だけを採用できる
    candidate = db.query(SearchCandidate).filter(SearchCandidate.id == candidate_id,
                                                 SearchCandidate.searched_by_user_id == current_user.id).first()
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
    # [Gate C2] 以前は ID を知っていれば誰の場所でも見られた(IDOR)。作った人と、使っている旅行のメンバーだけ(見られなければ 404)
    place = place_access.get_viewable(db, place_id, current_user)

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
