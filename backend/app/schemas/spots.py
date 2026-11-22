"""
TravelCanvas MVP スポットスキーマ
"""
import uuid
import re
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator, validator
from typing import Any, Dict, List, Optional
from datetime import datetime

from app.services import event_urls
from app.services.dining import DiningInfo
from app.services.media_providers.wikimedia import valid_id


class SpotUrl(BaseModel):
    """[Gate SpotInfo] 行きたい場所の URL 1 件(予定の URL と同じ規則。http/https だけ)"""
    model_config = ConfigDict(extra="forbid")
    url: str = Field(..., max_length=event_urls.MAX_URL_LENGTH)
    label: Optional[str] = Field(None, max_length=event_urls.MAX_LABEL_LENGTH)

    @field_validator("url")
    @classmethod
    def _v_url(cls, v: str) -> str:
        return event_urls.clean_url(v)


OWN_PHOTO_ID = re.compile(r"^[0-9a-f]{32}$")
# [Gate SpotOwnPhoto] 応答に出す写真の項目(保存の場所などサーバーの中の値は出さない)
PHOTO_PUBLIC_KEYS = ("provider", "provider_id", "title", "author", "license", "license_url", "source_page_url")


class SpotPhoto(BaseModel):
    """[Gate SpotInfo] 写真の出典(Wikimedia Commons のファイル。画像の本文は保存せず、サーバーが中継して出す)。
    [Gate SpotOwnPhoto] provider=own は自分で入れた写真(POST /spots/{id}/photo で保存したもの。ここでは今の写真を
    そのまま残す時だけ使える。新しく指すことはできない)"""
    model_config = ConfigDict(extra="forbid")
    provider: str = Field("wikimedia_commons", pattern=r"^(wikimedia_commons|own)$")
    provider_id: str = Field(..., max_length=260)
    title: Optional[str] = Field(None, max_length=300)
    author: Optional[str] = Field(None, max_length=300)
    license: Optional[str] = Field(None, max_length=100)
    license_url: Optional[str] = Field(None, max_length=500)
    source_page_url: Optional[str] = Field(None, max_length=1000)

    @model_validator(mode="after")
    def _v_id(self) -> "SpotPhoto":
        ok = OWN_PHOTO_ID.match(self.provider_id) if self.provider == "own" else valid_id(self.provider_id)
        if not ok:
            raise ValueError("写真のファイル名の形が違います")
        return self

    @field_validator("license_url", "source_page_url")
    @classmethod
    def _v_link(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        try:
            return event_urls.clean_url(v if not v.startswith("//") else "https:" + v)
        except ValueError:
            return None


class SpotExtras(BaseModel):
    """[Gate SpotInfo] 電話・URL(最大 5)・写真・食事の情報"""
    phone: Optional[str] = Field(None, max_length=40)
    urls: Optional[List[SpotUrl]] = Field(None, max_length=event_urls.MAX_URLS)
    photo: Optional[SpotPhoto] = None
    dining: Optional[DiningInfo] = None


class SpotBase(BaseModel):
    """スポット基本スキーマ"""
    name: str
    description: Optional[str] = None
    category: str = "other"
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    price_range: Optional[str] = None
    image_url: Optional[str] = None

    @validator('name')
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('スポット名は必須です')
        return v.strip()


class SpotCreate(SpotBase, SpotExtras):
    """スポット作成スキーマ"""


WISH_KIND_RE = r"^(next|again)$"
WISH_WHEN_RE = r"^(next_trip|someday)$"
SOURCE_KIND_RE = r"^(manual|quick|today|memory|visit|route|sns|import)$"


class SpotQuickCreate(BaseModel):
    """[FR-062] ♡ 今度行きたいに残す(どこからでも)。位置は任意。client_id で二重保存を防ぐ"""
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=200)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    address: Optional[str] = Field(None, max_length=300)
    genre: Optional[str] = Field(None, max_length=40)
    wish_kind: str = Field("next", pattern=WISH_KIND_RE)
    wish_note: Optional[str] = Field(None, max_length=200)
    wish_when: Optional[str] = Field(None, pattern=WISH_WHEN_RE)
    source_kind: str = Field("quick", pattern=SOURCE_KIND_RE)
    source_plan_id: Optional[uuid.UUID] = None
    client_id: Optional[str] = Field(None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("場所の名前を入れてください")
        return v.strip()

    @model_validator(mode="after")
    def _v_pos(self) -> "SpotQuickCreate":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("位置は緯度と経度の両方を入れてください")
        return self


class SpotUpdate(BaseModel):
    """スポット更新スキーマ"""
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    price_range: Optional[str] = None
    image_url: Optional[str] = None
    is_public: Optional[bool] = None
    phone: Optional[str] = Field(None, max_length=40)
    urls: Optional[List[SpotUrl]] = Field(None, max_length=event_urls.MAX_URLS)
    photo: Optional[SpotPhoto] = None
    dining: Optional[DiningInfo] = None
    # [FR-062] 種類・ひとこと・いつ・近くに来たら知らせる(本人だけが直せる)
    wish_kind: Optional[str] = Field(None, pattern=WISH_KIND_RE)
    wish_note: Optional[str] = Field(None, max_length=200)
    wish_when: Optional[str] = Field(None, pattern=WISH_WHEN_RE)
    remind_nearby: Optional[bool] = None
    radius_m: Optional[int] = Field(None, ge=100, le=5000)
    again_count: Optional[int] = Field(None, ge=0, le=10000)  # 取り消しで元の回数へ戻す時


class SpotResponse(SpotBase):
    """スポットレスポンススキーマ"""
    id: uuid.UUID
    created_by: uuid.UUID
    is_public: bool
    visit_count: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    phone: Optional[str] = None
    urls: Optional[List[Dict[str, Any]]] = None
    photo: Optional[Dict[str, Any]] = None
    dining: Optional[Dict[str, Any]] = None
    # [FR-062]
    wish_kind: Optional[str] = None
    wish_scope: Optional[str] = "place"
    radius_m: Optional[int] = None
    source_kind: Optional[str] = None
    source_plan_id: Optional[uuid.UUID] = None
    source_label: Optional[str] = None
    wish_note: Optional[str] = None
    wish_when: Optional[str] = None
    remind_nearby: Optional[bool] = False
    again_count: Optional[int] = 0
    last_visited_at: Optional[datetime] = None

    @field_validator("photo", mode="before")
    @classmethod
    def _v_photo_out(cls, v: Any) -> Any:
        if isinstance(v, dict):
            return {k: v.get(k) for k in PHOTO_PUBLIC_KEYS if k in v}
        return v

    class Config:
        from_attributes = True


class FavoriteCreate(BaseModel):
    """お気に入り登録スキーマ"""
    personal_note: Optional[str] = None
    personal_rating: Optional[float] = None


class FavoriteResponse(BaseModel):
    """お気に入りレスポンススキーマ(スポット詳細を内包)"""
    id: uuid.UUID
    spot_id: uuid.UUID
    personal_note: Optional[str] = None
    personal_rating: Optional[float] = None
    created_at: datetime
    spot: SpotResponse

    class Config:
        from_attributes = True


class VisitCreate(BaseModel):
    """訪問記録スキーマ

    [Gate #37] source/confidence/detected_accuracy_metersはGPS自動判定
    (Visited Area Layer)用のオプション項目。未指定時はsource='manual'として
    従来通り扱う(後方互換)。
    """
    visit_note: Optional[str] = None
    source: str = "manual"
    confidence: Optional[float] = None
    detected_accuracy_meters: Optional[float] = None

    @validator("source")
    def validate_source(cls, v):
        if v not in ("manual", "auto_gps"):
            raise ValueError("sourceは'manual'または'auto_gps'である必要があります")
        return v

    @validator("confidence")
    def validate_confidence(cls, v):
        if v is not None and not (0.0 <= v <= 1.0):
            raise ValueError("confidenceは0.0から1.0の範囲である必要があります")
        return v


class VisitResponse(BaseModel):
    """訪問記録レスポンススキーマ(スポット詳細を内包)"""
    id: uuid.UUID
    spot_id: uuid.UUID
    visit_note: Optional[str] = None
    visited_at: datetime
    source: str = "manual"
    confidence: Optional[float] = None
    detected_accuracy_meters: Optional[float] = None
    spot: SpotResponse

    class Config:
        from_attributes = True


class SpotQuickResponse(BaseModel):
    """[FR-062] 残した結果。created=false は既にあった場所(同じ client_id・同じ場所)。previous は取り消しで戻す値"""
    spot: SpotResponse
    created: bool
    merged_into: Optional[uuid.UUID] = None
    previous: Optional[Dict[str, Any]] = None


class NearbyCandidate(BaseModel):
    name: str
    genre: Optional[str] = None
    distance_m: int
    lat: float
    lng: float
    address: Optional[str] = None


class NearbyCandidatesResponse(BaseModel):
    results: List[NearbyCandidate]
    source: List[str]
    unavailable: List[str] = []
