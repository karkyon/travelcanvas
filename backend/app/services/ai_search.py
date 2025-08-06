"""
TravelCanvas AI検索サービス (統合版)
~/travelcanvas/backend/app/services/ai_search.py
"""

import asyncio
import time
from typing import List, Dict, Optional, Any
import logging
import openai
import googlemaps
from geopy.distance import geodesic
import requests

from app.core.config import settings
from app.core.exceptions import AISearchError, ExternalAPIError
from app.schemas.schemas import (
    SearchRequest, SpotSearchResult, CoordinatesSchema, SpotCategory
)

logger = logging.getLogger(__name__)

class AISearchService:
    """AI支援スポット検索サービス"""
    
    def __init__(self):
        self.openai_client = None
        self.gmaps_client = None
        self.search_cache = {}
        self.cache_ttl = settings.CACHE_TTL_SECONDS
        
        # 外部API初期化
        self._initialize_apis()
    
    def _initialize_apis(self):
        """外部API初期化"""
        try:
            if settings.AI_SEARCH_API_KEY:
                openai.api_key = settings.AI_SEARCH_API_KEY
                self.openai_client = openai
                
            if settings.GOOGLE_PLACES_API_KEY:
                self.gmaps_client = googlemaps.Client(key=settings.GOOGLE_PLACES_API_KEY)
                
        except Exception as e:
            logger.error(f"AI search API initialization failed: {e}")
            if not settings.MOCK_EXTERNAL_APIS:
                raise AISearchError("AI検索APIの初期化に失敗しました")
    
    async def search_spots(
        self,
        query: str,
        location: Optional[str] = None,
        category: Optional[SpotCategory] = None,
        radius_km: float = 10,
        max_results: int = 20,
        price_level: Optional[int] = None,
        min_rating: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        AIスポット検索のメイン関数
        """
        start_time = time.time()
        
        try:
            # キャッシュ確認
            cache_key = self._generate_cache_key(
                query, location, category, radius_km, max_results, price_level, min_rating
            )
            cached_result = self._get_cached_result(cache_key)
            if cached_result:
                cached_result['cached'] = True
                return cached_result
            
            # 位置情報解決
            coordinates = await self._resolve_location(location) if location else None
            
            # AI解析によるクエリ拡張
            enhanced_query = await self._enhance_query_with_ai(query, category, location)
            
            # 複数ソースから検索実行
            search_tasks = [
                self._search_google_places(enhanced_query, coordinates, category, radius_km, price_level, min_rating),
                self._search_ai_recommendations(enhanced_query, location, category),
            ]
            
            # 並列実行
            results = await asyncio.gather(*search_tasks, return_exceptions=True)
            
            # 結果統合・重複排除
            combined_results = self._combine_and_deduplicate_results(results)
            
            # AIによる関連度ランキング
            ranked_results = await self._rank_results_by_relevance(
                combined_results, query, category, coordinates
            )
            
            # 結果を制限
            final_results = ranked_results[:max_results]
            
            # 検索時間計算
            search_time_ms = (time.time() - start_time) * 1000
            
            result = {
                'query': query,
                'location': location,
                'results': final_results,
                'total': len(final_results),
                'search_time_ms': search_time_ms,
                'cached': False,
                'suggestions': await self._generate_search_suggestions(query, location)
            }
            
            # 結果をキャッシュ
            self._cache_result(cache_key, result)
            
            logger.info(f"AI search completed: {len(final_results)} results in {search_time_ms:.1f}ms")
            return result
            
        except Exception as e:
            logger.error(f"AI search error: {e}")
            if settings.MOCK_EXTERNAL_APIS:
                return await self._mock_search_results(query, location, max_results)
            raise AISearchError(f"検索中にエラーが発生しました: {str(e)}")
    
    async def _enhance_query_with_ai(
        self, 
        query: str, 
        category: Optional[SpotCategory], 
        location: Optional[str]
    ) -> str:
        """AIによるクエリ拡張"""
        if not self.openai_client or settings.MOCK_EXTERNAL_APIS:
            return query
        
        try:
            prompt = f"""
            旅行者が「{query}」について検索しています。
            場所: {location or '指定なし'}
            カテゴリ: {category.value if category else '指定なし'}
            
            この検索クエリを、観光スポット検索により適した形に拡張してください。
            以下の要素を含めてください：
            - 関連する観光スポット名
            - 地域の特徴
            - 人気の活動
            
            拡張クエリのみを返してください（説明不要）。
            """
            
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.openai_client.Completion.create(
                    engine=settings.AI_SEARCH_MODEL,
                    prompt=prompt,
                    max_tokens=100,
                    temperature=0.7
                )
            )
            
            enhanced_query = response.choices[0].text.strip()
            logger.info(f"Query enhanced: '{query}' -> '{enhanced_query}'")
            return enhanced_query
            
        except Exception as e:
            logger.warning(f"Query enhancement failed: {e}")
            return query
    
    async def _search_google_places(
        self,
        query: str,
        coordinates: Optional[CoordinatesSchema],
        category: Optional[SpotCategory],
        radius_km: float,
        price_level: Optional[int],
        min_rating: Optional[float]
    ) -> List[SpotSearchResult]:
        """Google Places APIによる検索"""
        if not self.gmaps_client or settings.MOCK_EXTERNAL_APIS:
            return []
        
        try:
            # Google Placesの検索パラメータ
            search_params = {
                'query': query,
                'language': 'ja',
                'region': 'jp'
            }
            
            if coordinates:
                search_params['location'] = (coordinates.lat, coordinates.lng)
                search_params['radius'] = int(radius_km * 1000)  # メートル変換
            
            # カテゴリマッピング
            if category:
                place_type = self._map_category_to_google_type(category)
                if place_type:
                    search_params['type'] = place_type
            
            # テキスト検索実行
            places_result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.gmaps_client.places(
                    query=search_params['query'],
                    location=search_params.get('location'),
                    radius=search_params.get('radius'),
                    language=search_params['language'],
                    region=search_params['region'],
                    type=search_params.get('type')
                )
            )
            
            results = []
            for place in places_result.get('results', []):
                # フィルタリング
                if min_rating and place.get('rating', 0) < min_rating:
                    continue
                if price_level and place.get('price_level', 0) != price_level:
                    continue
                
                # SpotSearchResultに変換
                spot_result = self._convert_google_place_to_spot(place, coordinates)
                if spot_result:
                    results.append(spot_result)
            
            return results
            
        except Exception as e:
            logger.error(f"Google Places search error: {e}")
            return []
    
    async def _search_ai_recommendations(
        self,
        query: str,
        location: Optional[str],
        category: Optional[SpotCategory]
    ) -> List[SpotSearchResult]:
        """AIによる推薦検索"""
        if not self.openai_client or settings.MOCK_EXTERNAL_APIS:
            return []
        
        try:
            prompt = f"""
            {location or '日本'}で「{query}」に関連する観光スポットを推薦してください。
            カテゴリ: {category.value if category else '観光'}
            
            以下のJSON形式で5つまで返してください：
            {{
                "recommendations": [
                    {{
                        "name": "スポット名",
                        "description": "簡潔な説明",
                        "category": "sightseeing|restaurant|shopping|accommodation|transport|activity|culture|nature",
                        "estimated_duration": 120,
                        "estimated_cost": 1000,
                        "why_recommended": "推薦理由",
                        "popularity_score": 0.8
                    }}
                ]
            }}
            """
            
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.openai_client.Completion.create(
                    engine=settings.AI_SEARCH_MODEL,
                    prompt=prompt,
                    max_tokens=800,
                    temperature=0.7
                )
            )
            
            import json
            ai_data = json.loads(response.choices[0].text.strip())
            
            results = []
            for rec in ai_data.get('recommendations', []):
                spot_result = SpotSearchResult(
                    name=rec['name'],
                    description=rec.get('description'),
                    category=SpotCategory(rec.get('category', 'sightseeing')),
                    coordinates=CoordinatesSchema(lat=35.6762, lng=139.6503),  # 東京デフォルト
                    estimated_duration=rec.get('estimated_duration'),
                    estimated_cost=rec.get('estimated_cost'),
                    ai_confidence=rec.get('popularity_score', 0.5),
                    why_recommended=rec.get('why_recommended')
                )
                results.append(spot_result)
            
            return results
            
        except Exception as e:
            logger.warning(f"AI recommendations failed: {e}")
            return []
    
    async def _resolve_location(self, location_str: str) -> Optional[CoordinatesSchema]:
        """位置情報文字列を座標に変換"""
        if not self.gmaps_client or settings.MOCK_EXTERNAL_APIS:
            # 主要都市のデフォルト座標
            default_locations = {
                '東京': CoordinatesSchema(lat=35.6762, lng=139.6503),
                '大阪': CoordinatesSchema(lat=34.6937, lng=135.5023),
                '京都': CoordinatesSchema(lat=35.0116, lng=135.7681),
                '福岡': CoordinatesSchema(lat=33.5904, lng=130.4017),
            }
            
            for city, coords in default_locations.items():
                if city in location_str:
                    return coords
            
            return CoordinatesSchema(lat=35.6762, lng=139.6503)  # 東京デフォルト
        
        try:
            geocode_result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.gmaps_client.geocode(location_str, language='ja', region='jp')
            )
            
            if geocode_result:
                location = geocode_result[0]['geometry']['location']
                return CoordinatesSchema(lat=location['lat'], lng=location['lng'])
            
        except Exception as e:
            logger.warning(f"Geocoding failed for {location_str}: {e}")
        
        return None
    
    def _combine_and_deduplicate_results(
        self, 
        results_list: List[List[SpotSearchResult]]
    ) -> List[SpotSearchResult]:
        """結果統合・重複排除"""
        combined = []
        seen_names = set()
        
        for results in results_list:
            if isinstance(results, Exception):
                continue
                
            for result in results:
                # 名前の正規化
                normalized_name = result.name.lower().replace(' ', '').replace('　', '')
                
                if normalized_name not in seen_names:
                    seen_names.add(normalized_name)
                    combined.append(result)
        
        return combined
    
    async def _rank_results_by_relevance(
        self,
        results: List[SpotSearchResult],
        query: str,
        category: Optional[SpotCategory],
        coordinates: Optional[CoordinatesSchema]
    ) -> List[SpotSearchResult]:
        """関連度によるランキング"""
        for result in results:
            relevance_score = 0.0
            
            # クエリとの一致度
            query_words = query.lower().split()
            result_text = f"{result.name} {result.description or ''}".lower()
            word_matches = sum(1 for word in query_words if word in result_text)
            relevance_score += (word_matches / len(query_words)) * 0.4
            
            # カテゴリ一致
            if category and result.category == category:
                relevance_score += 0.3
            
            # 距離スコア（近いほど高い）
            if coordinates and result.coordinates:
                distance_km = geodesic(
                    (coordinates.lat, coordinates.lng),
                    (result.coordinates.lat, result.coordinates.lng)
                ).kilometers
                distance_score = max(0, 1 - (distance_km / 50))  # 50km以内で正規化
                relevance_score += distance_score * 0.2
            
            # AI信頼度
            if result.ai_confidence:
                relevance_score += result.ai_confidence * 0.1
            
            # 結果に関連度を保存
            result.relevance_score = relevance_score
        
        # 関連度でソート
        return sorted(results, key=lambda r: getattr(r, 'relevance_score', 0), reverse=True)
    
    async def _generate_search_suggestions(
        self, 
        query: str, 
        location: Optional[str]
    ) -> List[str]:
        """検索候補生成"""
        base_suggestions = [
            f"{query} 周辺",
            f"{query} 人気",
            f"{query} おすすめ",
            f"{query} 口コミ",
            f"{query} アクセス",
        ]
        
        if location:
            base_suggestions.extend([
                f"{location} {query}",
                f"{location} 観光",
                f"{location} グルメ",
            ])
        
        return base_suggestions[:6]
    
    def _convert_google_place_to_spot(
        self, 
        place: Dict[str, Any], 
        reference_coords: Optional[CoordinatesSchema]
    ) -> Optional[SpotSearchResult]:
        """Google PlaceをSpotSearchResultに変換"""
        try:
            location = place['geometry']['location']
            coordinates = CoordinatesSchema(lat=location['lat'], lng=location['lng'])
            
            # 距離計算
            distance_km = None
            if reference_coords:
                distance_km = geodesic(
                    (reference_coords.lat, reference_coords.lng),
                    (coordinates.lat, coordinates.lng)
                ).kilometers
            
            # カテゴリ推定
            category = self._infer_category_from_types(place.get('types', []))
            
            return SpotSearchResult(
                external_id=place.get('place_id'),
                name=place['name'],
                description=None,  # Google Placesにはdescriptionがない
                category=category,
                coordinates=coordinates,
                address=place.get('formatted_address'),
                rating=place.get('rating'),
                review_count=place.get('user_ratings_total'),
                price_level=place.get('price_level'),
                photos=self._extract_photo_urls(place.get('photos', [])),
                distance_km=distance_km,
                ai_confidence=0.9  # Google Places APIの信頼度は高い
            )
            
        except Exception as e:
            logger.warning(f"Failed to convert Google Place: {e}")
            return None
    
    def _map_category_to_google_type(self, category: SpotCategory) -> Optional[str]:
        """カテゴリをGoogle Places APIのタイプにマッピング"""
        mapping = {
            SpotCategory.SIGHTSEEING: 'tourist_attraction',
            SpotCategory.RESTAURANT: 'restaurant',
            SpotCategory.SHOPPING: 'shopping_mall',
            SpotCategory.ACCOMMODATION: 'lodging',
            SpotCategory.TRANSPORT: 'transit_station',
            SpotCategory.ACTIVITY: 'amusement_park',
            SpotCategory.CULTURE: 'museum',
            SpotCategory.NATURE: 'park'
        }
        return mapping.get(category)
    
    def _infer_category_from_types(self, types: List[str]) -> SpotCategory:
        """Google PlacesのタイプからカテゴリをAI推定"""
        type_str = ' '.join(types)
        
        # 優先度順でマッチング
        if any(t in type_str for t in ['restaurant', 'food', 'meal_takeaway']):
            return SpotCategory.RESTAURANT
        elif any(t in type_str for t in ['tourist_attraction', 'museum', 'church']):
            return SpotCategory.SIGHTSEEING
        elif any(t in type_str for t in ['shopping', 'store', 'mall']):
            return SpotCategory.SHOPPING
        elif any(t in type_str for t in ['lodging', 'hotel']):
            return SpotCategory.ACCOMMODATION
        elif any(t in type_str for t in ['transit', 'station', 'airport']):
            return SpotCategory.TRANSPORT
        elif any(t in type_str for t in ['park', 'natural']):
            return SpotCategory.NATURE
        elif any(t in type_str for t in ['amusement', 'entertainment']):
            return SpotCategory.ACTIVITY
        else:
            return SpotCategory.SIGHTSEEING  # デフォルト
    
    def _extract_photo_urls(self, photos: List[Dict[str, Any]]) -> List[str]:
        """Google Places APIの写真URLを抽出"""
        if not self.gmaps_client or not photos:
            return []
        
        photo_urls = []
        for photo in photos[:5]:  # 最大5枚
            try:
                photo_ref = photo.get('photo_reference')
                if photo_ref:
                    url = f"https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference={photo_ref}&key={settings.GOOGLE_PLACES_API_KEY}"
                    photo_urls.append(url)
            except Exception as e:
                logger.warning(f"Failed to extract photo URL: {e}")
        
        return photo_urls
    
    def _generate_cache_key(self, *args) -> str:
        """キャッシュキー生成"""
        import hashlib
        key_string = '|'.join(str(arg) for arg in args)
        return hashlib.md5(key_string.encode()).hexdigest()
    
    def _get_cached_result(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """キャッシュから結果取得"""
        if cache_key in self.search_cache:
            result, timestamp = self.search_cache[cache_key]
            if time.time() - timestamp < self.cache_ttl:
                return result
            else:
                del self.search_cache[cache_key]
        return None
    
    def _cache_result(self, cache_key: str, result: Dict[str, Any]):
        """結果をキャッシュ"""
        self.search_cache[cache_key] = (result, time.time())
        
        # キャッシュサイズ制限
        if len(self.search_cache) > settings.CACHE_MAX_SIZE:
            # 古いエントリを削除
            oldest_key = min(self.search_cache.keys(), 
                           key=lambda k: self.search_cache[k][1])
            del self.search_cache[oldest_key]
    
    async def _mock_search_results(
        self, 
        query: str, 
        location: Optional[str], 
        max_results: int
    ) -> Dict[str, Any]:
        """モック検索結果（開発・テスト用）"""
        import random
        
        mock_spots = [
            {"name": "東京タワー", "category": "sightseeing", "lat": 35.6586, "lng": 139.7454},
            {"name": "浅草寺", "category": "culture", "lat": 35.7148, "lng": 139.7967},
            {"name": "築地本願寺", "category": "culture", "lat": 35.6687, "lng": 139.7727},
            {"name": "上野公園", "category": "nature", "lat": 35.7165, "lng": 139.7737},
            {"name": "新宿御苑", "category": "nature", "lat": 35.6851, "lng": 139.7103},
        ]
        
        results = []
        for i, spot in enumerate(mock_spots[:max_results]):
            result = SpotSearchResult(
                external_id=f"mock_{i}",
                name=spot["name"],
                description=f"{spot['name']}の説明",
                category=SpotCategory(spot["category"]),
                coordinates=CoordinatesSchema(lat=spot["lat"], lng=spot["lng"]),
                rating=round(random.uniform(3.5, 5.0), 1),
                review_count=random.randint(100, 2000),
                estimated_duration=random.randint(60, 180),
                estimated_cost=random.randint(0, 3000),
                ai_confidence=random.uniform(0.7, 0.95),
                why_recommended=f"{query}に関連するおすすめスポットです"
            )
            results.append(result)
        
        return {
            'query': query,
            'location': location,
            'results': results,
            'total': len(results),
            'search_time_ms': 150.0,
            'cached': False,
            'suggestions': [f"{query} 周辺", f"{query} 人気", f"{query} おすすめ"]
        }