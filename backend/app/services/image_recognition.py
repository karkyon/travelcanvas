"""
TravelCanvas 画像認識サービス (統合版)
~/travelcanvas/backend/app/services/image_recognition.py
"""

import asyncio
import base64
import hashlib
import io
import time
from typing import List, Dict, Optional, Any, Tuple
import logging

try:
    from PIL import Image, ExifTags
    import cv2
    import numpy as np
    VISION_AVAILABLE = True
except ImportError:
    VISION_AVAILABLE = False
    logging.warning("Vision libraries not available. Using mock recognition.")

try:
    import openai
    from google.cloud import vision
    CLOUD_VISION_AVAILABLE = True
except ImportError:
    CLOUD_VISION_AVAILABLE = False
    logging.warning("Cloud Vision API not available.")

from app.core.config import settings
from app.core.exceptions import ImageRecognitionError
from app.schemas.schemas import (
    ImageRecognitionResult, SpotSearchResult, CoordinatesSchema, SpotCategory
)
from app.services.ai_search import AISearchService

logger = logging.getLogger(__name__)

class ImageRecognitionService:
    """
    AI画像認識スポット検索サービス
    業界初の機能: 写真からスポットを特定
    """
    
    def __init__(self):
        self.ai_search_service = AISearchService()
        self.vision_client = None
        self.recognition_cache = {}
        self.confidence_threshold = settings.IMAGE_RECOGNITION_CONFIDENCE_THRESHOLD
        
        # クラウドVision API初期化
        self._initialize_vision_api()
        
        # 建築物・ランドマーク認識用の特徴量データベース
        self.landmark_database = self._load_landmark_database()
    
    def _initialize_vision_api(self):
        """Vision API初期化"""
        try:
            if CLOUD_VISION_AVAILABLE and not settings.MOCK_EXTERNAL_APIS:
                self.vision_client = vision.ImageAnnotatorClient()
                logger.info("Google Cloud Vision API initialized")
        except Exception as e:
            logger.warning(f"Vision API initialization failed: {e}")
    
    def _load_landmark_database(self) -> Dict[str, Any]:
        """ランドマーク特徴量データベース読み込み"""
        # 実際の実装では外部DBやファイルから読み込み
        return {
            "tokyo_tower": {
                "keywords": ["東京タワー", "tokyo tower", "赤い塔", "333m"],
                "features": ["tower", "red", "steel", "broadcasting"],
                "location": {"lat": 35.6586, "lng": 139.7454},
                "category": "sightseeing"
            },
            "tokyo_skytree": {
                "keywords": ["スカイツリー", "skytree", "634m", "浅草"],
                "features": ["tower", "white", "modern", "broadcasting"],
                "location": {"lat": 35.7101, "lng": 139.8107},
                "category": "sightseeing"
            },
            "sensoji": {
                "keywords": ["浅草寺", "sensoji", "雷門", "kaminarimon"],
                "features": ["temple", "traditional", "gate", "red"],
                "location": {"lat": 35.7148, "lng": 139.7967},
                "category": "culture"
            },
            "fushimi_inari": {
                "keywords": ["伏見稲荷", "fushimi inari", "千本鳥居", "鳥居"],
                "features": ["shrine", "orange", "torii", "mountain"],
                "location": {"lat": 34.9671, "lng": 135.7727},
                "category": "culture"
            },
            "kinkaku": {
                "keywords": ["金閣寺", "kinkaku", "golden pavilion", "金"],
                "features": ["temple", "golden", "reflection", "pond"],
                "location": {"lat": 35.0394, "lng": 135.7292},
                "category": "culture"
            }
        }
    
    async def recognize_spots(
        self,
        image_data: bytes,
        location_hint: Optional[str] = None,
        confidence_threshold: float = 0.7,
        max_results: int = 10
    ) -> Dict[str, Any]:
        """
        画像認識メイン関数
        """
        start_time = time.time()
        
        try:
            # 画像前処理
            processed_image = await self._preprocess_image(image_data)
            
            # 画像ハッシュでキャッシュ確認
            image_hash = self._calculate_image_hash(image_data)
            cached_result = self._get_cached_recognition(image_hash)
            if cached_result:
                return cached_result
            
            # 複数の認識手法を並列実行
            recognition_tasks = [
                self._recognize_with_cloud_vision(processed_image, location_hint),
                self._recognize_with_ai_analysis(processed_image, location_hint),
                self._recognize_with_feature_matching(processed_image, location_hint),
                self._extract_exif_location(image_data)
            ]
            
            results = await asyncio.gather(*recognition_tasks, return_exceptions=True)
            
            # 結果統合・スコアリング
            combined_results = await self._combine_recognition_results(
                results, confidence_threshold
            )
            
            # 類似スポット検索
            enhanced_results = await self._enhance_with_similar_spots(
                combined_results, location_hint, max_results
            )
            
            processing_time_ms = (time.time() - start_time) * 1000
            
            final_result = {
                'recognition_results': enhanced_results[:max_results],
                'processing_time_ms': processing_time_ms,
                'ai_model_version': settings.AI_SEARCH_MODEL,
                'confidence_threshold': confidence_threshold,
                'location_hint': location_hint
            }
            
            # 結果をキャッシュ
            self._cache_recognition(image_hash, final_result)
            
            logger.info(f"Image recognition completed: {len(enhanced_results)} results in {processing_time_ms:.1f}ms")
            return final_result
            
        except Exception as e:
            logger.error(f"Image recognition error: {e}")
            if settings.MOCK_EXTERNAL_APIS:
                return await self._mock_recognition_results(location_hint, max_results)
            raise ImageRecognitionError(f"画像認識中にエラーが発生しました: {str(e)}")
    
    async def _preprocess_image(self, image_data: bytes) -> Dict[str, Any]:
        """画像前処理"""
        if not VISION_AVAILABLE:
            return {"original": image_data, "processed": image_data}
        
        try:
            # PILで画像読み込み
            image = Image.open(io.BytesIO(image_data))
            
            # 画像情報取得
            width, height = image.size
            format_type = image.format
            
            # 画像回転修正（EXIF情報基づく）
            image = self._fix_image_orientation(image)
            
            # リサイズ（処理速度向上のため）
            if width > 1920 or height > 1920:
                image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
            
            # 処理済み画像をバイトに変換
            processed_buffer = io.BytesIO()
            image.save(processed_buffer, format='JPEG', quality=85)
            processed_data = processed_buffer.getvalue()
            
            return {
                "original": image_data,
                "processed": processed_data,
                "width": image.width,
                "height": image.height,
                "format": format_type,
                "has_exif": hasattr(image, '_getexif') and image._getexif() is not None
            }
            
        except Exception as e:
            logger.warning(f"Image preprocessing failed: {e}")
            return {"original": image_data, "processed": image_data}
    
    def _fix_image_orientation(self, image: Image.Image) -> Image.Image:
        """EXIF情報に基づく画像回転修正"""
        try:
            if hasattr(image, '_getexif'):
                exif = image._getexif()
                if exif is not None:
                    for orientation in ExifTags.TAGS.keys():
                        if ExifTags.TAGS[orientation] == 'Orientation':
                            break
                    
                    if orientation in exif:
                        if exif[orientation] == 3:
                            image = image.rotate(180, expand=True)
                        elif exif[orientation] == 6:
                            image = image.rotate(270, expand=True)
                        elif exif[orientation] == 8:
                            image = image.rotate(90, expand=True)
        except Exception as e:
            logger.warning(f"Image orientation fix failed: {e}")
        
        return image
    
    async def _recognize_with_cloud_vision(
        self, 
        processed_image: Dict[str, Any], 
        location_hint: Optional[str]
    ) -> List[ImageRecognitionResult]:
        """Google Cloud Vision APIによる認識"""
        if not self.vision_client or settings.MOCK_EXTERNAL_APIS:
            return []
        
        try:
            image = vision.Image(content=processed_image["processed"])
            
            # ランドマーク検出
            landmarks_response = await asyncio.get_event_loop().run_in_executor(
                None, self.vision_client.landmark_detection, image
            )
            
            # テキスト検出（看板など）
            text_response = await asyncio.get_event_loop().run_in_executor(
                None, self.vision_client.text_detection, image
            )
            
            # ラベル検出
            labels_response = await asyncio.get_event_loop().run_in_executor(
                None, self.vision_client.label_detection, image
            )
            
            results = []
            
            # ランドマーク結果処理
            for landmark in landmarks_response.landmark_annotations:
                if landmark.score >= self.confidence_threshold:
                    # 位置情報取得
                    coordinates = None
                    if landmark.locations:
                        location = landmark.locations[0].lat_lng
                        coordinates = CoordinatesSchema(lat=location.latitude, lng=location.longitude)
                    
                    result = ImageRecognitionResult(
                        spot_name=landmark.description,
                        confidence=landmark.score,
                        category=self._infer_category_from_landmark(landmark.description),
                        coordinates=coordinates,
                        external_id=f"gv_landmark_{landmark.mid}",
                        description=f"Google Vision APIで認識されたランドマーク: {landmark.description}"
                    )
                    results.append(result)
            
            # テキスト結果処理（店名・施設名など）
            if text_response.text_annotations:
                detected_text = text_response.text_annotations[0].description
                text_spots = await self._analyze_text_for_spots(detected_text, location_hint)
                results.extend(text_spots)
            
            return results
            
        except Exception as e:
            logger.warning(f"Cloud Vision recognition failed: {e}")
            return []
    
    async def _recognize_with_ai_analysis(
        self, 
        processed_image: Dict[str, Any], 
        location_hint: Optional[str]
    ) -> List[ImageRecognitionResult]:
        """AI画像解析による認識"""
        if not hasattr(self.ai_search_service, 'openai_client') or settings.MOCK_EXTERNAL_APIS:
            return []
        
        try:
            # 画像をbase64エンコード
            image_base64 = base64.b64encode(processed_image["processed"]).decode('utf-8')
            
            prompt = f"""
            この画像を分析して、観光スポット・建物・ランドマークを特定してください。
            場所のヒント: {location_hint or '日本'}
            
            以下のJSON形式で回答してください：
            {{
                "spots": [
                    {{
                        "name": "スポット名",
                        "confidence": 0.85,
                        "category": "sightseeing|restaurant|shopping|accommodation|culture|nature|activity",
                        "description": "特定の根拠・特徴",
                        "keywords": ["キーワード1", "キーワード2"]
                    }}
                ]
            }}
            """
            
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.ai_search_service.openai_client.ChatCompletion.create(
                    model="gpt-4-vision-preview",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
                                }
                            ]
                        }
                    ],
                    max_tokens=800
                )
            )
            
            import json
            ai_result = json.loads(response.choices[0].message.content)
            
            results = []
            for spot in ai_result.get('spots', []):
                if spot['confidence'] >= self.confidence_threshold:
                    result = ImageRecognitionResult(
                        spot_name=spot['name'],
                        confidence=spot['confidence'],
                        category=SpotCategory(spot.get('category', 'sightseeing')),
                        description=spot.get('description'),
                        external_id=f"ai_analysis_{hashlib.md5(spot['name'].encode()).hexdigest()[:8]}"
                    )
                    results.append(result)
            
            return results
            
        except Exception as e:
            logger.warning(f"AI analysis recognition failed: {e}")
            return []
    
    async def _recognize_with_feature_matching(
        self, 
        processed_image: Dict[str, Any], 
        location_hint: Optional[str]
    ) -> List[ImageRecognitionResult]:
        """特徴量マッチングによる認識"""
        if not VISION_AVAILABLE or settings.MOCK_EXTERNAL_APIS:
            return []
        
        try:
            # OpenCVで画像処理
            nparr = np.frombuffer(processed_image["processed"], np.uint8)
            cv_image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            # 特徴量抽出（SIFT使用）
            sift = cv2.SIFT_create()
            keypoints, descriptors = sift.detectAndCompute(cv_image, None)
            
            if descriptors is None:
                return []
            
            # 色彩分析
            color_features = self._analyze_color_features(cv_image)
            
            # 形状分析
            shape_features = self._analyze_shape_features(cv_image)
            
            # ランドマークデータベースとマッチング
            results = []
            for landmark_id, landmark_data in self.landmark_database.items():
                match_score = self._calculate_feature_match_score(
                    color_features, shape_features, landmark_data
                )
                
                if match_score >= self.confidence_threshold:
                    coordinates = CoordinatesSchema(
                        lat=landmark_data["location"]["lat"],
                        lng=landmark_data["location"]["lng"]
                    )
                    
                    result = ImageRecognitionResult(
                        spot_name=landmark_data["keywords"][0],
                        confidence=match_score,
                        category=SpotCategory(landmark_data["category"]),
                        coordinates=coordinates,
                        external_id=f"feature_match_{landmark_id}",
                        description=f"特徴量マッチングで認識: {', '.join(landmark_data['features'])}"
                    )
                    results.append(result)
            
            return results
            
        except Exception as e:
            logger.warning(f"Feature matching recognition failed: {e}")
            return []
    
    def _analyze_color_features(self, cv_image: np.ndarray) -> Dict[str, float]:
        """色彩特徴分析"""
        try:
            # HSV色空間に変換
            hsv = cv2.cvtColor(cv_image, cv2.COLOR_BGR2HSV)
            
            # 主要色の割合計算
            red_mask = cv2.inRange(hsv, (0, 50, 50), (10, 255, 255)) + \
                      cv2.inRange(hsv, (170, 50, 50), (180, 255, 255))
            orange_mask = cv2.inRange(hsv, (10, 50, 50), (25, 255, 255))
            yellow_mask = cv2.inRange(hsv, (25, 50, 50), (35, 255, 255))
            green_mask = cv2.inRange(hsv, (35, 50, 50), (85, 255, 255))
            blue_mask = cv2.inRange(hsv, (85, 50, 50), (125, 255, 255))
            
            total_pixels = cv_image.shape[0] * cv_image.shape[1]
            
            return {
                "red_ratio": np.sum(red_mask > 0) / total_pixels,
                "orange_ratio": np.sum(orange_mask > 0) / total_pixels,
                "yellow_ratio": np.sum(yellow_mask > 0) / total_pixels,
                "green_ratio": np.sum(green_mask > 0) / total_pixels,
                "blue_ratio": np.sum(blue_mask > 0) / total_pixels,
            }
        except Exception:
            return {}
    
    def _analyze_shape_features(self, cv_image: np.ndarray) -> Dict[str, Any]:
        """形状特徴分析"""
        try:
            gray = cv2.cvtColor(cv_image, cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(gray, 50, 150)
            
            # 輪郭検出
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            # 主要輪郭の特徴
            if contours:
                largest_contour = max(contours, key=cv2.contourArea)
                area = cv2.contourArea(largest_contour)
                perimeter = cv2.arcLength(largest_contour, True)
                
                # 形状指標
                if perimeter > 0:
                    circularity = 4 * np.pi * area / (perimeter * perimeter)
                else:
                    circularity = 0
                
                return {
                    "has_large_shapes": area > (cv_image.shape[0] * cv_image.shape[1] * 0.1),
                    "circularity": circularity,
                    "contour_count": len(contours)
                }
            
            return {"has_large_shapes": False, "circularity": 0, "contour_count": 0}
            
        except Exception:
            return {}
    
    def _calculate_feature_match_score(
        self, 
        color_features: Dict[str, float], 
        shape_features: Dict[str, Any], 
        landmark_data: Dict[str, Any]
    ) -> float:
        """特徴量マッチングスコア計算"""
        score = 0.0
        
        # 色特徴マッチング
        landmark_features = landmark_data.get("features", [])
        
        if "red" in landmark_features and color_features.get("red_ratio", 0) > 0.1:
            score += 0.3
        if "orange" in landmark_features and color_features.get("orange_ratio", 0) > 0.1:
            score += 0.3
        if "golden" in landmark_features and color_features.get("yellow_ratio", 0) > 0.1:
            score += 0.3
        
        # 形状特徴マッチング
        if "tower" in landmark_features and shape_features.get("has_large_shapes", False):
            score += 0.2
        if "temple" in landmark_features and shape_features.get("contour_count", 0) > 5:
            score += 0.2
        
        return min(score, 1.0)
    
    async def _extract_exif_location(self, image_data: bytes) -> Optional[CoordinatesSchema]:
        """EXIF位置情報抽出"""
        if not VISION_AVAILABLE:
            return None
        
        try:
            image = Image.open(io.BytesIO(image_data))
            if hasattr(image, '_getexif'):
                exif = image._getexif()
                if exif is not None:
                    # GPS情報を探す
                    for tag, value in exif.items():
                        if ExifTags.TAGS.get(tag) == 'GPSInfo':
                            gps_data = value
                            lat, lon = self._parse_gps_data(gps_data)
                            if lat and lon:
                                return CoordinatesSchema(lat=lat, lng=lon)
        except Exception as e:
            logger.warning(f"EXIF location extraction failed: {e}")
        
        return None
    
    def _parse_gps_data(self, gps_data: Dict) -> Tuple[Optional[float], Optional[float]]:
        """GPS EXIFデータパース"""
        try:
            # GPS座標変換
            def convert_to_degrees(value):
                d, m, s = value
                return d + (m / 60.0) + (s / 3600.0)
            
            lat = None
            lon = None
            
            if 2 in gps_data and 1 in gps_data:  # 緯度
                lat = convert_to_degrees(gps_data[2])
                if gps_data[1] == 'S':
                    lat = -lat
            
            if 4 in gps_data and 3 in gps_data:  # 経度
                lon = convert_to_degrees(gps_data[4])
                if gps_data[3] == 'W':
                    lon = -lon
            
            return lat, lon
            
        except Exception:
            return None, None
    
    async def _analyze_text_for_spots(
        self, 
        detected_text: str, 
        location_hint: Optional[str]
    ) -> List[ImageRecognitionResult]:
        """検出テキストからスポット分析"""
        results = []
        
        # 日本語のスポット名パターン検索
        spot_patterns = [
            r'(.+)寺', r'(.+)神社', r'(.+)城', r'(.+)駅',
            r'(.+)タワー', r'(.+)ビル', r'(.+)公園', r'(.+)美術館'
        ]
        
        import re
        for pattern in spot_patterns:
            matches = re.findall(pattern, detected_text)
            for match in matches:
                spot_name = match + pattern.replace(r'(.+)', '').replace('\\', '')
                
                # AI検索で詳細情報を取得
                search_results = await self.ai_search_service.search_spots(
                    query=spot_name,
                    location=location_hint,
                    max_results=1
                )
                
                if search_results['results']:
                    search_result = search_results['results'][0]
                    result = ImageRecognitionResult(
                        spot_name=spot_name,
                        confidence=0.8,
                        category=search_result.category,
                        coordinates=search_result.coordinates,
                        external_id=f"text_detection_{hashlib.md5(spot_name.encode()).hexdigest()[:8]}",
                        description=f"画像内テキストから検出: {spot_name}"
                    )
                    results.append(result)
        
        return results
    
    async def _combine_recognition_results(
        self, 
        results_list: List[Any], 
        confidence_threshold: float
    ) -> List[ImageRecognitionResult]:
        """認識結果統合"""
        combined = []
        seen_spots = set()
        
        for results in results_list:
            if isinstance(results, Exception) or not results:
                continue
            
            if isinstance(results, list):
                for result in results:
                    if (result.confidence >= confidence_threshold and 
                        result.spot_name not in seen_spots):
                        seen_spots.add(result.spot_name)
                        combined.append(result)
        
        # 信頼度でソート
        combined.sort(key=lambda r: r.confidence, reverse=True)
        return combined
    
    async def _enhance_with_similar_spots(
        self, 
        recognition_results: List[ImageRecognitionResult], 
        location_hint: Optional[str],
        max_results: int
    ) -> List[ImageRecognitionResult]:
        """類似スポット検索で結果を拡張"""
        enhanced = recognition_results.copy()
        
        for result in recognition_results[:3]:  # 上位3件について類似検索
            try:
                similar_spots = await self.ai_search_service.search_spots(
                    query=f"{result.spot_name} 類似 周辺",
                    location=location_hint,
                    category=result.category,
                    max_results=3
                )
                
                for spot in similar_spots['results']:
                    # 既存結果と重複チェック
                    if not any(existing.spot_name == spot.name for existing in enhanced):
                        similar_result = ImageRecognitionResult(
                            spot_name=spot.name,
                            confidence=0.6,  # 類似検索なので信頼度は下げる
                            category=spot.category,
                            coordinates=spot.coordinates,
                            external_id=spot.external_id,
                            description=f"{result.spot_name}に類似するスポット",
                            similar_spots=[]
                        )
                        enhanced.append(similar_result)
                
            except Exception as e:
                logger.warning(f"Similar spots search failed for {result.spot_name}: {e}")
        
        return enhanced[:max_results]
    
    def _infer_category_from_landmark(self, landmark_name: str) -> SpotCategory:
        """ランドマーク名からカテゴリ推定"""
        name_lower = landmark_name.lower()
        
        if any(word in name_lower for word in ['temple', '寺', 'shrine', '神社', 'castle', '城']):
            return SpotCategory.CULTURE
        elif any(word in name_lower for word in ['tower', 'タワー', 'building', 'ビル']):
            return SpotCategory.SIGHTSEEING
        elif any(word in name_lower for word in ['park', '公園', 'garden', '庭園']):
            return SpotCategory.NATURE
        elif any(word in name_lower for word in ['museum', '美術館', '博物館']):
            return SpotCategory.CULTURE
        elif any(word in name_lower for word in ['station', '駅', 'airport', '空港']):
            return SpotCategory.TRANSPORT
        else:
            return SpotCategory.SIGHTSEEING
    
    def _calculate_image_hash(self, image_data: bytes) -> str:
        """画像ハッシュ計算"""
        return hashlib.md5(image_data).hexdigest()
    
    def _get_cached_recognition(self, image_hash: str) -> Optional[Dict[str, Any]]:
        """キャッシュから認識結果取得"""
        if image_hash in self.recognition_cache:
            result, timestamp = self.recognition_cache[image_hash]
            if time.time() - timestamp < settings.CACHE_TTL_SECONDS:
                return result
            else:
                del self.recognition_cache[image_hash]
        return None
    
    def _cache_recognition(self, image_hash: str, result: Dict[str, Any]):
        """認識結果をキャッシュ"""
        self.recognition_cache[image_hash] = (result, time.time())
        
        # キャッシュサイズ制限
        if len(self.recognition_cache) > settings.CACHE_MAX_SIZE:
            oldest_key = min(self.recognition_cache.keys(), 
                           key=lambda k: self.recognition_cache[k][1])
            del self.recognition_cache[oldest_key]
    
    async def _mock_recognition_results(
        self, 
        location_hint: Optional[str], 
        max_results: int
    ) -> Dict[str, Any]:
        """モック認識結果（開発・テスト用）"""
        import random
        
        mock_results = [
            {
                "spot_name": "東京タワー",
                "confidence": 0.92,
                "category": "sightseeing",
                "coordinates": {"lat": 35.6586, "lng": 139.7454},
                "description": "赤い鉄塔構造から東京タワーと認識"
            },
            {
                "spot_name": "浅草寺",
                "confidence": 0.87,
                "category": "culture", 
                "coordinates": {"lat": 35.7148, "lng": 139.7967},
                "description": "伝統的な寺院建築から浅草寺と認識"
            },
            {
                "spot_name": "スカイツリー",
                "confidence": 0.84,
                "category": "sightseeing",
                "coordinates": {"lat": 35.7101, "lng": 139.8107},
                "description": "現代的な高塔構造からスカイツリーと認識"
            }
        ]
        
        results = []
        for i, mock in enumerate(mock_results[:max_results]):
            result = ImageRecognitionResult(
                spot_name=mock["spot_name"],
                confidence=mock["confidence"],
                category=SpotCategory(mock["category"]),
                coordinates=CoordinatesSchema(**mock["coordinates"]),
                external_id=f"mock_recognition_{i}",
                description=mock["description"]
            )
            results.append(result)
        
        return {
            'recognition_results': results,
            'processing_time_ms': 200.0,
            'ai_model_version': 'mock-v1.0',
            'confidence_threshold': 0.7,
            'location_hint': location_hint
        }