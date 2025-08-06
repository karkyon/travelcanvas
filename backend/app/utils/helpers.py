"""
TravelCanvas ヘルパー関数ユーティリティ (統合版)
~/travelcanvas/backend/app/utils/helpers.py
"""

import re
import secrets
import string
import hashlib
import qrcode
import io
import base64
from datetime import datetime, date, timedelta, timezone
from typing import List, Dict, Optional, Any, Union, Tuple
from decimal import Decimal
import logging

from geopy.distance import geodesic
import pytz

from app.core.config import settings

logger = logging.getLogger(__name__)

# ===== 日付・時間関連ヘルパー =====

def validate_date_range(start_date: date, end_date: date) -> bool:
    """
    日付範囲の妥当性検証
    
    Args:
        start_date: 開始日
        end_date: 終了日
    
    Returns:
        bool: 有効な日付範囲かどうか
    """
    if not start_date or not end_date:
        return False
    
    # 終了日が開始日より後か
    if end_date <= start_date:
        return False
    
    # 過去の日付でないか（当日は許可）
    today = date.today()
    if start_date < today:
        return False
    
    # 期間が長すぎないか（1年以内）
    if (end_date - start_date).days > 365:
        return False
    
    return True

def calculate_duration_days(start_date: date, end_date: date) -> int:
    """
    旅行期間日数計算
    
    Args:
        start_date: 開始日
        end_date: 終了日
    
    Returns:
        int: 日数
    """
    if not validate_date_range(start_date, end_date):
        return 0
    
    return (end_date - start_date).days + 1

def format_duration_minutes(minutes: int) -> str:
    """
    分数を時間表記に変換
    
    Args:
        minutes: 分数
    
    Returns:
        str: "2時間30分" 形式
    """
    if minutes < 60:
        return f"{minutes}分"
    
    hours = minutes // 60
    remaining_minutes = minutes % 60
    
    if remaining_minutes == 0:
        return f"{hours}時間"
    else:
        return f"{hours}時間{remaining_minutes}分"

def parse_time_string(time_str: str) -> Optional[Tuple[int, int]]:
    """
    時間文字列解析
    
    Args:
        time_str: "09:30" 形式の時間文字列
    
    Returns:
        Optional[Tuple[int, int]]: (時, 分) または None
    """
    try:
        time_pattern = r'^([01]?[0-9]|2[0-3]):([0-5][0-9])$'
        match = re.match(time_pattern, time_str.strip())
        
        if match:
            hours = int(match.group(1))
            minutes = int(match.group(2))
            return (hours, minutes)
        
        return None
    except Exception:
        return None

def calculate_time_difference(start_time: str, end_time: str) -> int:
    """
    時間差計算（分単位）
    
    Args:
        start_time: 開始時間 "09:30"
        end_time: 終了時間 "11:45"
    
    Returns:
        int: 分数
    """
    start = parse_time_string(start_time)
    end = parse_time_string(end_time)
    
    if not start or not end:
        return 0
    
    start_minutes = start[0] * 60 + start[1]
    end_minutes = end[0] * 60 + end[1]
    
    # 日をまたぐ場合の処理
    if end_minutes < start_minutes:
        end_minutes += 24 * 60
    
    return end_minutes - start_minutes

def format_japanese_date(date_obj: date) -> str:
    """
    日本語日付フォーマット
    
    Args:
        date_obj: 日付オブジェクト
    
    Returns:
        str: "2025年8月1日（木）" 形式
    """
    weekdays = ['月', '火', '水', '木', '金', '土', '日']
    weekday = weekdays[date_obj.weekday()]
    
    return f"{date_obj.year}年{date_obj.month}月{date_obj.day}日（{weekday}）"

def get_timezone_offset(timezone_name: str = "Asia/Tokyo") -> str:
    """
    タイムゾーンオフセット取得
    
    Args:
        timezone_name: タイムゾーン名
    
    Returns:
        str: "+09:00" 形式のオフセット
    """
    try:
        tz = pytz.timezone(timezone_name)
        now = datetime.now(tz)
        offset = now.strftime('%z')
        return f"{offset[:3]}:{offset[3:]}"
    except Exception:
        return "+09:00"  # デフォルト

# ===== 地理・距離計算関連ヘルパー =====

def calculate_distance_km(
    lat1: float, lng1: float, 
    lat2: float, lng2: float
) -> float:
    """
    2点間の距離計算（km）
    
    Args:
        lat1, lng1: 地点1の緯度経度
        lat2, lng2: 地点2の緯度経度
    
    Returns:
        float: 距離（km）
    """
    try:
        point1 = (lat1, lng1)
        point2 = (lat2, lng2)
        distance = geodesic(point1, point2).kilometers
        return round(distance, 2)
    except Exception as e:
        logger.warning(f"Distance calculation failed: {e}")
        return 0.0

def estimate_travel_time(distance_km: float, transport_mode: str = "walking") -> int:
    """
    移動時間推定
    
    Args:
        distance_km: 距離（km）
        transport_mode: 交通手段
    
    Returns:
        int: 推定時間（分）
    """
    speed_map = {
        "walking": 4,      # 徒歩: 4km/h
        "bicycle": 15,     # 自転車: 15km/h
        "car": 30,         # 車: 30km/h (市内平均)
        "train": 40,       # 電車: 40km/h (平均)
        "bus": 20,         # バス: 20km/h
        "taxi": 25,        # タクシー: 25km/h
        "plane": 500,      # 飛行機: 500km/h
        "shinkansen": 200  # 新幹線: 200km/h
    }
    
    speed_kmh = speed_map.get(transport_mode, 4)
    travel_time_hours = distance_km / speed_kmh
    travel_time_minutes = int(travel_time_hours * 60)
    
    # 最低移動時間設定
    min_time_map = {
        "walking": 5,
        "bicycle": 3,
        "car": 5,
        "train": 10,
        "bus": 10,
        "taxi": 5,
        "plane": 60,
        "shinkansen": 30
    }
    
    min_time = min_time_map.get(transport_mode, 5)
    return max(travel_time_minutes, min_time)

def estimate_travel_cost(distance_km: float, transport_mode: str = "train") -> int:
    """
    移動費用推定
    
    Args:
        distance_km: 距離（km）
        transport_mode: 交通手段
    
    Returns:
        int: 推定費用（円）
    """
    cost_per_km = {
        "walking": 0,      # 徒歩: 無料
        "bicycle": 0,      # 自転車: 無料
        "car": 25,         # 車: 25円/km (ガソリン代)
        "train": 20,       # 電車: 20円/km
        "bus": 15,         # バス: 15円/km
        "taxi": 280,       # タクシー: 280円/km
        "plane": 50,       # 飛行機: 50円/km
        "shinkansen": 40   # 新幹線: 40円/km
    }
    
    cost_per_km_rate = cost_per_km.get(transport_mode, 20)
    base_cost = int(distance_km * cost_per_km_rate)
    
    # 最低料金設定
    min_cost_map = {
        "walking": 0,
        "bicycle": 0,
        "car": 200,
        "train": 150,
        "bus": 210,
        "taxi": 500,
        "plane": 8000,
        "shinkansen": 2000
    }
    
    min_cost = min_cost_map.get(transport_mode, 150)
    return max(base_cost, min_cost)

def is_within_bounds(
    lat: float, lng: float,
    bounds: Dict[str, float]
) -> bool:
    """
    境界内判定
    
    Args:
        lat, lng: 確認する座標
        bounds: 境界 {"north": ..., "south": ..., "east": ..., "west": ...}
    
    Returns:
        bool: 境界内かどうか
    """
    return (bounds["south"] <= lat <= bounds["north"] and
            bounds["west"] <= lng <= bounds["east"])

# ===== 文字列・データ処理関連ヘルパー =====

def generate_secure_token(length: int = 32) -> str:
    """
    セキュアトークン生成
    
    Args:
        length: トークン長
    
    Returns:
        str: ランダムトークン
    """
    return secrets.token_urlsafe(length)

def generate_share_token() -> str:
    """共有用トークン生成"""
    return generate_secure_token(16)

def generate_password_hash(password: str) -> str:
    """
    パスワードハッシュ生成（簡易版）
    
    Args:
        password: パスワード
    
    Returns:
        str: ハッシュ値
    """
    salt = secrets.token_hex(16)
    hash_value = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return f"{salt}:{hash_value.hex()}"

def verify_password_hash(password: str, hash_string: str) -> bool:
    """
    パスワードハッシュ検証
    
    Args:
        password: 入力パスワード
        hash_string: 保存されたハッシュ
    
    Returns:
        bool: 一致するかどうか
    """
    try:
        salt, stored_hash = hash_string.split(':')
        hash_value = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
        return hash_value.hex() == stored_hash
    except Exception:
        return False

def sanitize_filename(filename: str) -> str:
    """
    ファイル名サニタイズ
    
    Args:
        filename: 元ファイル名
    
    Returns:
        str: サニタイズ済みファイル名
    """
    # 危険な文字を除去
    unsafe_chars = r'[<>:"/\\|?*\x00-\x1f]'
    safe_filename = re.sub(unsafe_chars, '_', filename)
    
    # 長さ制限
    if len(safe_filename) > 100:
        name, ext = safe_filename.rsplit('.', 1) if '.' in safe_filename else (safe_filename, '')
        safe_filename = name[:100-len(ext)-1] + '.' + ext if ext else name[:100]
    
    return safe_filename.strip()

def truncate_text(text: str, max_length: int = 100, suffix: str = "...") -> str:
    """
    テキスト切り詰め
    
    Args:
        text: 元テキスト
        max_length: 最大長
        suffix: 切り詰め時の接尾辞
    
    Returns:
        str: 切り詰められたテキスト
    """
    if len(text) <= max_length:
        return text
    
    return text[:max_length - len(suffix)] + suffix

def extract_keywords(text: str, max_keywords: int = 10) -> List[str]:
    """
    キーワード抽出（簡易版）
    
    Args:
        text: 対象テキスト
        max_keywords: 最大キーワード数
    
    Returns:
        List[str]: キーワードリスト
    """
    # 日本語ストップワード
    stop_words = {
        'の', 'に', 'は', 'を', 'が', 'で', 'て', 'と', 'も', 'から', 'まで',
        'です', 'である', 'だ', 'である', 'これ', 'それ', 'あれ', 'この', 'その', 'あの'
    }
    
    # 単語分割（簡易版）
    words = re.findall(r'[ぁ-んァ-ヶー一-龠a-zA-Z0-9]+', text)
    
    # フィルタリング・カウント
    word_count = {}
    for word in words:
        if len(word) >= 2 and word not in stop_words:
            word_count[word] = word_count.get(word, 0) + 1
    
    # 頻度順ソート
    sorted_words = sorted(word_count.items(), key=lambda x: x[1], reverse=True)
    
    return [word for word, count in sorted_words[:max_keywords]]

# ===== QRコード・画像関連ヘルパー =====

def generate_qr_code(data: str, size: int = 200) -> str:
    """
    QRコード生成
    
    Args:
        data: QRコードに埋め込むデータ
        size: 画像サイズ（px）
    
    Returns:
        str: Base64エンコードされた画像データ
    """
    try:
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(data)
        qr.make(fit=True)
        
        # PIL画像生成
        img = qr.make_image(fill_color="black", back_color="white")
        img = img.resize((size, size))
        
        # Base64エンコード
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        img_data = buffer.getvalue()
        
        return base64.b64encode(img_data).decode('utf-8')
    except Exception as e:
        logger.error(f"QR code generation failed: {e}")
        return ""

def validate_image_file(file_data: bytes, max_size_mb: int = 10) -> Dict[str, Any]:
    """
    画像ファイル検証
    
    Args:
        file_data: ファイルデータ
        max_size_mb: 最大サイズ（MB）
    
    Returns:
        Dict[str, Any]: 検証結果
    """
    try:
        from PIL import Image
        
        # サイズチェック
        file_size_mb = len(file_data) / (1024 * 1024)
        if file_size_mb > max_size_mb:
            return {
                "valid": False,
                "error": f"ファイルサイズが{max_size_mb}MBを超えています",
                "file_size_mb": file_size_mb
            }
        
        # 画像形式チェック
        img = Image.open(io.BytesIO(file_data))
        
        # サポート形式チェック
        supported_formats = ['JPEG', 'PNG', 'WEBP', 'GIF']
        if img.format not in supported_formats:
            return {
                "valid": False,
                "error": f"サポートされていない形式です: {img.format}",
                "format": img.format
            }
        
        return {
            "valid": True,
            "format": img.format,
            "size": img.size,
            "mode": img.mode,
            "file_size_mb": file_size_mb
        }
        
    except Exception as e:
        return {
            "valid": False,
            "error": f"画像ファイルの検証に失敗しました: {str(e)}"
        }

# ===== URL・共有関連ヘルパー =====

def build_share_url(share_token: str, base_url: Optional[str] = None) -> str:
    """
    共有URL生成
    
    Args:
        share_token: 共有トークン
        base_url: ベースURL（省略時は設定から取得）
    
    Returns:
        str: 共有URL
    """
    if not base_url:
        base_url = getattr(settings, 'FRONTEND_URL', 'https://travelcanvas.app')
    
    return f"{base_url}/shared/{share_token}"

def build_api_url(endpoint: str, base_url: Optional[str] = None) -> str:
    """
    API URL生成
    
    Args:
        endpoint: エンドポイント
        base_url: ベースURL
    
    Returns:
        str: 完全URL
    """
    if not base_url:
        base_url = getattr(settings, 'API_BASE_URL', 'https://api.travelcanvas.app')
    
    return f"{base_url}/api/v1/{endpoint.lstrip('/')}"

# ===== データ変換・フォーマット関連ヘルパー =====

def format_currency(amount: Union[int, float, Decimal], currency: str = "JPY") -> str:
    """
    通貨フォーマット
    
    Args:
        amount: 金額
        currency: 通貨コード
    
    Returns:
        str: フォーマット済み金額
    """
    currency_symbols = {
        "JPY": "¥",
        "USD": "$",
        "EUR": "€",
        "GBP": "£",
        "KRW": "₩",
        "CNY": "¥"
    }
    
    symbol = currency_symbols.get(currency, currency)
    
    if currency == "JPY":
        # 日本円は小数点なし
        return f"{symbol}{int(amount):,}"
    else:
        return f"{symbol}{float(amount):,.2f}"

def convert_to_jst(utc_datetime: datetime) -> datetime:
    """
    UTC時刻をJSTに変換
    
    Args:
        utc_datetime: UTC時刻
    
    Returns:
        datetime: JST時刻
    """
    utc_tz = pytz.UTC
    jst_tz = pytz.timezone('Asia/Tokyo')
    
    if utc_datetime.tzinfo is None:
        utc_datetime = utc_tz.localize(utc_datetime)
    
    return utc_datetime.astimezone(jst_tz)

def format_relative_time(target_datetime: datetime, reference_datetime: Optional[datetime] = None) -> str:
    """
    相対時間フォーマット
    
    Args:
        target_datetime: 対象時刻
        reference_datetime: 基準時刻（省略時は現在時刻）
    
    Returns:
        str: 相対時間表記
    """
    if reference_datetime is None:
        reference_datetime = datetime.now(timezone.utc)
    
    if target_datetime.tzinfo is None:
        target_datetime = target_datetime.replace(tzinfo=timezone.utc)
    if reference_datetime.tzinfo is None:
        reference_datetime = reference_datetime.replace(tzinfo=timezone.utc)
    
    delta = target_datetime - reference_datetime
    
    if delta.days > 0:
        return f"{delta.days}日後"
    elif delta.days < 0:
        return f"{abs(delta.days)}日前"
    else:
        hours = delta.seconds // 3600
        minutes = (delta.seconds % 3600) // 60
        
        if hours > 0:
            return f"{hours}時間後"
        elif minutes > 0:
            return f"{minutes}分後"
        else:
            return "今"

# ===== 数値・統計関連ヘルパー =====

def calculate_statistics(values: List[Union[int, float]]) -> Dict[str, float]:
    """
    統計値計算
    
    Args:
        values: 数値リスト
    
    Returns:
        Dict[str, float]: 統計値
    """
    if not values:
        return {"count": 0, "sum": 0, "average": 0, "min": 0, "max": 0}
    
    count = len(values)
    total = sum(values)
    average = total / count
    minimum = min(values)
    maximum = max(values)
    
    return {
        "count": count,
        "sum": total,
        "average": round(average, 2),
        "min": minimum,
        "max": maximum
    }

def calculate_percentage(part: Union[int, float], total: Union[int, float]) -> float:
    """
    割合計算
    
    Args:
        part: 部分
        total: 全体
    
    Returns:
        float: 割合（%）
    """
    if total == 0:
        return 0.0
    
    percentage = (part / total) * 100
    return round(percentage, 1)

def normalize_score(value: float, min_value: float, max_value: float) -> float:
    """
    スコア正規化（0-1）
    
    Args:
        value: 正規化する値
        min_value: 最小値
        max_value: 最大値
    
    Returns:
        float: 正規化されたスコア
    """
    if max_value == min_value:
        return 0.5
    
    normalized = (value - min_value) / (max_value - min_value)
    return max(0.0, min(1.0, normalized))

# ===== デバッグ・ログ関連ヘルパー =====

def log_function_call(func_name: str, args: Tuple, kwargs: Dict[str, Any], result: Any = None):
    """
    関数呼び出しログ
    
    Args:
        func_name: 関数名
        args: 引数
        kwargs: キーワード引数
        result: 結果
    """
    if settings.DEBUG:
        logger.debug(f"Function call: {func_name}({args}, {kwargs}) -> {type(result).__name__}")

def safe_dict_get(dictionary: Dict[str, Any], key: str, default: Any = None) -> Any:
    """
    安全な辞書取得
    
    Args:
        dictionary: 辞書
        key: キー
        default: デフォルト値
    
    Returns:
        Any: 値またはデフォルト値
    """
    try:
        return dictionary.get(key, default)
    except (AttributeError, TypeError):
        return default

def deep_merge_dicts(dict1: Dict[str, Any], dict2: Dict[str, Any]) -> Dict[str, Any]:
    """
    辞書の深いマージ
    
    Args:
        dict1: 辞書1
        dict2: 辞書2（優先）
    
    Returns:
        Dict[str, Any]: マージされた辞書
    """
    result = dict1.copy()
    
    for key, value in dict2.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge_dicts(result[key], value)
        else:
            result[key] = value
    
    return result