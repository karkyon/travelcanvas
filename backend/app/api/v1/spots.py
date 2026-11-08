"""
TravelCanvas MVP スポットAPI
"""
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional
from datetime import datetime

from app.core.config import settings
from app.core.database import get_db
from app.models.models import Spot, User, UserSpotFavorite, UserSpotVisit
from app.schemas.spots import (
    SpotCreate, SpotUpdate, SpotResponse,
    FavoriteCreate, FavoriteResponse,
    VisitCreate, VisitResponse,
)
from app.core.auth import get_current_user_or_guest
from app.services import dining, event_urls

logger = logging.getLogger("travelcanvas")

router = APIRouter(prefix="/spots", tags=["spots"])


@router.post("/", response_model=SpotResponse, status_code=status.HTTP_201_CREATED)
async def create_spot(
    spot_data: SpotCreate,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """新しいスポットを作成"""
    try:
        new_spot = Spot(
            name=spot_data.name,
            description=spot_data.description,
            category=spot_data.category,
            address=spot_data.address,
            latitude=spot_data.latitude,
            longitude=spot_data.longitude,
            price_range=spot_data.price_range,
            image_url=spot_data.image_url,
            created_by=current_user.id,
            # [Gate SpotInfo] 電話・URL・写真の出典・食事の情報
            phone=(spot_data.phone or "").strip() or None,
            urls=event_urls.to_json(spot_data.urls),
            photo=spot_data.photo.model_dump() if spot_data.photo else None,
            dining=dining.to_json(spot_data.dining),
        )

        db.add(new_spot)
        db.commit()
        db.refresh(new_spot)

        return new_spot

    except Exception:
        db.rollback()
        logger.exception("予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="スポットの作成に失敗しました。しばらくしてから再試行してください。"
        )


@router.get("/", response_model=List[SpotResponse])
async def get_spots(
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
    category: Optional[str] = None,
    limit: int = Query(20, ge=1, le=500),
    mine: bool = False,
):
    """スポット一覧取得。mine=true は本人が保存した場所だけ([Gate WishPlaces] 行きたい場所の一覧)"""
    try:
        query = db.query(Spot).filter(
            (Spot.created_by == current_user.id) if mine
            else ((Spot.created_by == current_user.id) | (Spot.is_public.is_(True)))
        )

        if category and category != "all":
            query = query.filter(Spot.category == category)

        spots = query.order_by(Spot.created_at.desc()).limit(limit).all()
        return spots

    except Exception:
        logger.exception("予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="スポットの取得に失敗しました。しばらくしてから再試行してください。"
        )

# ===== 固定パスの静的ルート =====
# [Gate #27 / A-011] /categories/list, /test/ping は /{spot_id}(UUID型パスパラメータ)
# より前に定義する必要がある。FastAPI/Starletteはパスセグメント数が一致しない限り
# 実際には衝突しないが(このルートはいずれも2セグメント、{spot_id}は1セグメントの
# ため現状422は再現しなかった)、定義順に依存する脆い書き方であることに変わりは
# ないため、お気に入り・訪問記録の固定ルートと同じ位置(パラメータ化ルートより前)
# へ移動し、route順序に対する回帰テストで担保する。


@router.get("/categories/list")
async def get_categories():
    """利用可能なカテゴリ一覧"""
    return {
        "categories": [
            {"value": "restaurant", "label": "レストラン"},
            {"value": "sightseeing", "label": "観光地"},
            {"value": "accommodation", "label": "宿泊"},
            {"value": "shopping", "label": "ショッピング"},
            {"value": "other", "label": "その他"}
        ]
    }

# [Gate R0] 認証不要な診断用エンドポイント。settings.DEBUG限定にする
# (DEBUG=Falseでは404)。ルート順序自体は本Gateで変更しない。


@router.get("/test/ping")
async def test_spots_api():
    """スポットAPI動作テスト(DEBUG限定)"""
    if not settings.DEBUG:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return {
        "message": "スポットAPI正常動作中",
        "version": "MVP-1.0.0",
        "timestamp": datetime.now().isoformat()
    }

# ===== お気に入り関連API =====
# [Gate #15] UserSpotFavoriteテーブルはDBに存在していたが、これを操作するAPIが
# 一切実装されていなかった(Gate #14で発見・記録済みのギャップ)。今回実装する。
# 注意: /favorites は /{spot_id}(UUID型パスパラメータ)より前に定義する必要がある。
# FastAPI/Starletteは構造的に一致するパスをUUID変換に失敗しても次のルートへ
# フォールバックしないため、順序を誤ると /spots/favorites への全リクエストが
# 422(UUID解析エラー)になる。


@router.get("/favorites", response_model=List[FavoriteResponse])
async def get_favorites(
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """自分のお気に入りスポット一覧を取得"""
    favorites = (
        db.query(UserSpotFavorite)
        .filter(UserSpotFavorite.user_id == current_user.id)
        .order_by(UserSpotFavorite.created_at.desc())
        .all()
    )

    results = []
    for fav in favorites:
        spot = db.query(Spot).filter(Spot.id == fav.spot_id).first()
        if spot is None:
            # スポット自体が削除済みの場合はスキップ(整合性維持)
            continue
        results.append({
            "id": fav.id,
            "spot_id": fav.spot_id,
            "personal_note": fav.personal_note,
            "personal_rating": fav.personal_rating,
            "created_at": fav.created_at,
            "spot": spot,
        })
    return results


@router.post("/{spot_id}/favorite", response_model=FavoriteResponse, status_code=status.HTTP_201_CREATED)
async def add_favorite(
    spot_id: uuid.UUID,
    favorite_data: FavoriteCreate,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """スポットをお気に入りに追加"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()
    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )
    if not spot.is_public and spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アクセス権限がありません"
        )

    existing = (
        db.query(UserSpotFavorite)
        .filter(
            UserSpotFavorite.user_id == current_user.id,
            UserSpotFavorite.spot_id == spot_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="既にお気に入りに登録されています"
        )

    try:
        new_favorite = UserSpotFavorite(
            user_id=current_user.id,
            spot_id=spot_id,
            personal_note=favorite_data.personal_note,
            personal_rating=favorite_data.personal_rating,
        )
        db.add(new_favorite)
        db.commit()
        db.refresh(new_favorite)
        return {
            "id": new_favorite.id,
            "spot_id": new_favorite.spot_id,
            "personal_note": new_favorite.personal_note,
            "personal_rating": new_favorite.personal_rating,
            "created_at": new_favorite.created_at,
            "spot": spot,
        }
    except Exception:
        db.rollback()
        logger.exception("予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="お気に入りの登録に失敗しました。しばらくしてから再試行してください。"
        )


@router.delete("/{spot_id}/favorite")
async def remove_favorite(
    spot_id: uuid.UUID,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """スポットをお気に入りから削除"""
    favorite = (
        db.query(UserSpotFavorite)
        .filter(
            UserSpotFavorite.user_id == current_user.id,
            UserSpotFavorite.spot_id == spot_id,
        )
        .first()
    )
    if not favorite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="お気に入りが見つかりません"
        )

    try:
        db.delete(favorite)
        db.commit()
        return {"message": "お気に入りを解除しました"}
    except Exception:
        db.rollback()
        logger.exception("予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="お気に入りの解除に失敗しました。しばらくしてから再試行してください。"
        )


# ===== 訪問記録関連API =====
# [Gate #19] ダッシュボードの「訪問済み」統計は常にハードコードの0だった。
# Spot.visit_countは全ユーザー合算の表示回数カウンタで「自分が訪れたか」を
# 表さないため、UserSpotVisit(新規テーブル、追加のみのマイグレーション)を
# 使って実装する。/visits は /{spot_id} より前に定義する必要がある(favoritesと同じ理由)。

@router.get("/visits", response_model=List[VisitResponse])
async def get_visits(
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """自分の訪問済みスポット一覧を取得"""
    visits = (
        db.query(UserSpotVisit)
        .filter(UserSpotVisit.user_id == current_user.id)
        .order_by(UserSpotVisit.visited_at.desc())
        .all()
    )

    results = []
    for visit in visits:
        spot = db.query(Spot).filter(Spot.id == visit.spot_id).first()
        if spot is None:
            continue
        results.append({
            "id": visit.id,
            "spot_id": visit.spot_id,
            "visit_note": visit.visit_note,
            "visited_at": visit.visited_at,
            "source": visit.source,
            "confidence": visit.confidence,
            "detected_accuracy_meters": visit.detected_accuracy_meters,
            "spot": spot,
        })
    return results


@router.post("/{spot_id}/visit", response_model=VisitResponse, status_code=status.HTTP_201_CREATED)
async def add_visit(
    spot_id: uuid.UUID,
    visit_data: VisitCreate,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """スポットを訪問済みとして記録"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()
    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )
    if not spot.is_public and spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アクセス権限がありません"
        )

    existing = (
        db.query(UserSpotVisit)
        .filter(
            UserSpotVisit.user_id == current_user.id,
            UserSpotVisit.spot_id == spot_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="既に訪問済みとして記録されています"
        )

    try:
        new_visit = UserSpotVisit(
            user_id=current_user.id,
            spot_id=spot_id,
            visit_note=visit_data.visit_note,
            source=visit_data.source,
            confidence=visit_data.confidence,
            detected_accuracy_meters=visit_data.detected_accuracy_meters,
        )
        db.add(new_visit)
        # 表示回数カウンタもあわせて加算(既存のSpot.visit_countの意味と整合させる)
        spot.visit_count = (spot.visit_count or 0) + 1
        db.commit()
        db.refresh(new_visit)
        return {
            "id": new_visit.id,
            "spot_id": new_visit.spot_id,
            "visit_note": new_visit.visit_note,
            "visited_at": new_visit.visited_at,
            "source": new_visit.source,
            "confidence": new_visit.confidence,
            "detected_accuracy_meters": new_visit.detected_accuracy_meters,
            "spot": spot,
        }
    except Exception:
        db.rollback()
        logger.exception("予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="訪問記録の登録に失敗しました。しばらくしてから再試行してください。"
        )


@router.delete("/{spot_id}/visit")
async def remove_visit(
    spot_id: uuid.UUID,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """訪問済み記録を取り消す"""
    visit = (
        db.query(UserSpotVisit)
        .filter(
            UserSpotVisit.user_id == current_user.id,
            UserSpotVisit.spot_id == spot_id,
        )
        .first()
    )
    if not visit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="訪問記録が見つかりません"
        )

    try:
        db.delete(visit)
        db.commit()
        return {"message": "訪問記録を取り消しました"}
    except Exception:
        db.rollback()
        logger.exception("予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="訪問記録の削除に失敗しました。しばらくしてから再試行してください。"
        )


@router.get("/{spot_id}", response_model=SpotResponse)
async def get_spot(
    spot_id: uuid.UUID,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """スポット詳細取得"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()

    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )

    # アクセス権限チェック
    if not spot.is_public and spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アクセス権限がありません"
        )

    return spot


@router.put("/{spot_id}", response_model=SpotResponse)
async def update_spot(
    spot_id: uuid.UUID,
    spot_data: SpotUpdate,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """スポット更新"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()

    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )

    if spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="編集権限がありません"
        )

    # 更新処理
    update_data = spot_data.model_dump(exclude_unset=True)
    # [Gate SpotInfo] 電話・URL・写真・食事の情報は保存の形へ(null・空で消す)
    if "phone" in update_data:
        update_data["phone"] = (update_data["phone"] or "").strip() or None
    if "urls" in update_data:
        update_data["urls"] = event_urls.to_json(spot_data.urls)
    if "photo" in update_data:
        update_data["photo"] = spot_data.photo.model_dump() if spot_data.photo else None
    if "dining" in update_data:
        update_data["dining"] = dining.to_json(spot_data.dining)
    for field, value in update_data.items():
        setattr(spot, field, value)

    try:
        db.commit()
        db.refresh(spot)
        return spot
    except Exception:
        db.rollback()
        logger.exception("予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="スポットの更新に失敗しました。しばらくしてから再試行してください。"
        )


@router.delete("/{spot_id}")
async def delete_spot(
    spot_id: uuid.UUID,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db)
):
    """スポット削除"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()

    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )

    if spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="削除権限がありません"
        )

    try:
        db.delete(spot)
        db.commit()
        return {"message": "スポットを削除しました"}
    except Exception:
        db.rollback()
        logger.exception("予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="スポットの削除に失敗しました。しばらくしてから再試行してください。"
        )


# [Gate SpotInfo] 自動取得の種類の対応(予定の種類 → 行きたい場所の種類)
_WISH_CATEGORY = {"dining": "restaurant", "accommodation": "accommodation", "shopping": "shopping",
                  "sightseeing": "sightseeing", "activity": "sightseeing"}


def _pick(rows: List[Dict[str, Any]], name: str, lat: Optional[float],
          lng: Optional[float]) -> Optional[Dict[str, Any]]:
    """候補から同じ場所らしいものを 1 つ選ぶ。位置があれば 500m 以内の一番近いもの。無ければ名前が近いもの。迷えば選ばない"""
    import math

    def dist(r: Dict[str, Any]) -> float:
        if lat is None or lng is None or r.get("latitude") is None or r.get("longitude") is None:
            return math.inf
        dy = (r["latitude"] - lat) * 111_000
        dx = (r["longitude"] - lng) * 111_000 * math.cos(math.radians(lat))
        return math.hypot(dx, dy)

    if lat is not None and lng is not None:
        near = sorted((r for r in rows if dist(r) <= 500), key=dist)
        return near[0] if near else None
    key = name.replace(" ", "").replace("\u3000", "")
    for r in rows:
        n = str(r.get("name") or "").replace(" ", "").replace("\u3000", "")
        if n and (n in key or key in n):
            return r
    return None


@router.post("/{spot_id}/enrich", response_model=Dict[str, Any])
async def enrich_spot(spot_id: uuid.UUID, current_user: User = Depends(get_current_user_or_guest),
                      db: Session = Depends(get_db)):
    """[Gate SpotInfo] 行きたい場所の情報を OpenStreetMap から自動で埋める(空の項目だけ。利用者が入れた値は変えない)。

    名前(位置があれば近くを優先)で 1 回だけ引き、同じ場所らしい候補(位置があれば 500m 以内、無ければ名前が近いもの)の
    住所・位置・電話・公式サイト・種類・食事の情報、場所に結び付いた写真(Commons・Wikidata、ライセンスが許すもの)を入れる。
    当てはまる候補が無ければ何も変えない。"""
    from app.services import place_info, place_photo

    spot = db.query(Spot).filter(Spot.id == spot_id).first()
    if not spot:
        raise HTTPException(status_code=404, detail="スポットが見つかりません")
    if spot.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="編集権限がありません")
    from app.services import free_usage, place_lookup

    def record(provider: str, code: str) -> None:
        free_usage.record(db, current_user, place_lookup.USAGE.get(provider, provider), "spot.enrich", result_code=code)

    try:
        result = await place_lookup.lookup(db, spot.name, spot.latitude, spot.longitude, record, address=spot.address)
    except Exception:  # noqa: BLE001 - 提供元が答えない時は変えずに伝える(値を作らない)
        result = {"unavailable": True, "candidates": [], "sources": []}
    if result["unavailable"]:
        raise HTTPException(status_code=503, detail={
            "code": "provider_unavailable",
            "message": "場所の情報の提供元が応答しませんでした。時間をおいて試してください"})
    rows = result["candidates"]
    hit = _pick(rows, spot.name, spot.latitude, spot.longitude)
    filled: List[str] = []
    if hit:
        # 住所は、空か「金沢市」までのように細かさが足りない時だけ、より細かい住所に替える
        mine = spot.address or ""
        finer = (place_lookup.address_detail(hit.get("address")) > place_lookup.address_detail(mine)
                 and place_lookup.address_detail(mine) <= 1
                 and place_lookup.strip_postal(mine) in place_lookup.strip_postal(hit.get("address")))
        if hit.get("address") and (not mine or finer):
            spot.address = hit["address"]
            filled.append("address")
        if (spot.latitude is None or spot.longitude is None) and hit.get("latitude") is not None:
            spot.latitude, spot.longitude = hit["latitude"], hit["longitude"]
            filled.append("location")
        if not spot.phone and hit.get("phone"):
            spot.phone = hit["phone"]
            filled.append("phone")
        if not spot.urls and (hit.get("website") or hit.get("links")):
            urls = (event_urls.from_website(hit["website"]) or []) if hit.get("website") else []
            for link in hit.get("links") or []:
                if len(urls) < event_urls.MAX_URLS and link["url"] not in {u["url"] for u in urls}:
                    urls.append({"url": link["url"], "label": link.get("label")})
            if urls:
                spot.urls = urls
                filled.append("urls")
        wish = _WISH_CATEGORY.get(str(hit.get("category") or ""))
        if spot.category in (None, "", "other") and wish:
            spot.category = wish
            filled.append("category")
        if hit.get("dining"):
            merged = dining.merge_empty(spot.dining, hit["dining"])
            if merged != (spot.dining or {}):
                spot.dining = dining.to_json(dining.DiningInfo(**merged))
                filled.append("dining")
        if not spot.photo and (hit.get("photo_file") or hit.get("wikidata")):
            meta = await place_photo.resolve(hit.get("photo_file"), hit.get("wikidata"))
            if meta:
                spot.photo = {k: getattr(meta, k) for k in (
                    "provider", "provider_id", "title", "author", "license", "license_url", "source_page_url")}
                filled.append("photo")
    db.commit()
    db.refresh(spot)
    return {
        "spot": SpotResponse.model_validate(spot).model_dump(mode="json"),
        "filled": filled,
        "matched": bool(hit),
        "source": {"provider": "openstreetmap", "attribution": place_info.ATTRIBUTION, "license": place_info.LICENSE,
                   "license_url": place_info.LICENSE_URL, "source_url": hit.get("source_url") if hit else None},
        # [Gate PlaceLookupJP] 使った提供元のクレジット
        "sources": [s for s in result["sources"] if hit and s["provider"] in hit.get("providers", [])],
    }
