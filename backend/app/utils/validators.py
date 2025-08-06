"""
TravelCanvas バリデーター関数 (統合版)
~/travelcanvas/backend/app/utils/validators.py
"""

import re
import ipaddress
from datetime import date, datetime, time
from typing import List, Dict, Optional, Any, Union, Pattern
import logging

from email_validator import validate_email, EmailNotValidError

from app.core.config import settings

logger = logging.getLogger(__name__)

# 正規表現パターン定義
PATTERNS = {
    'username': re.compile(r'^[a-zA-Z0-9_-]{3,50}$'),
    'password': re.compile(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$'),
    'phone_jp': re.compile(r'^(0[1-9]-?[0-9]{4}-?[0-9]{4}|0[1-9][0-9]{8,9})$'),
    'postal_code_jp': re.compile(r'^\d{3}-?\d{4}$'),
    'time_format': re.compile(r'^([01]?[0-9]|2[0-3]):[0-5][0-9]$'),
    'url': re.compile(r'^https?://(?:[-\w.])+(?:\:[0-9]+)?(?:/(?:[\w/_.])*(?:\?(?:[\w&=%.])*)?(?:\#(?:\w*))?)?$'),
    'slug': re.compile(r'^[a-z0-9-_]+$'),
    'hex_color': re.compile(r'^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$'),
    'japanese_text': re.compile(r'[ひらがなカタカナ漢字]'),
    'coordinate': re.compile(r'^-?([1-8]?[0-9]\.{1}\d{1,6}$|90\.{1}0{1,6}$|180\.{1}0{1,6}$)')
}

# 許可されたファイル拡張子
ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}
ALLOWED_DOCUMENT_EXTENSIONS = {'.pdf', '.doc', '.docx', '.txt', '.md'}

# 危険なファイル拡張子
DANGEROUS_EXTENSIONS = {'.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js'}

class ValidationResult:
    """バリデーション結果クラス"""
    
    def __init__(self, is_valid: bool = True, errors: Optional[List[str]] = None, warnings: Optional[List[str]] = None):
        self.is_valid = is_valid
        self.errors = errors or []
        self.warnings = warnings or []
    
    def add_error(self, error: str):
        """エラー追加"""
        self.errors.append(error)
        self.is_valid = False
    
    def add_warning(self, warning: str):
        """警告追加"""
        self.warnings.append(warning)
    
    def to_dict(self) -> Dict[str, Any]:
        """辞書形式で結果を返す"""
        return {
            'is_valid': self.is_valid,
            'errors': self.errors,
            'warnings': self.warnings
        }

# ===== 基本データ型バリデーター =====

def validate_email_domain(email: str) -> bool:
    """
    メールアドレスドメイン検証
    
    Args:
        email: メールアドレス
    
    Returns:
        bool: 有効なドメインかどうか
    """
    try:
        # 基本的なメール形式チェック
        validated_email = validate_email(email)
        email_address = validated_email.email
        
        # ドメイン部分抽出
        domain = email_address.split('@')[1].lower()
        
        # 禁止ドメインリスト（設定から取得）
        blocked_domains = getattr(settings, 'BLOCKED_EMAIL_DOMAINS', [
            'tempmail.org', '10minutemail.com', 'guerrillamail.com',
            'mailinator.com', 'throwaway.email'
        ])
        
        if domain in blocked_domains:
            return False
        
        # 許可ドメインリスト（設定されている場合のみチェック）
        allowed_domains = getattr(settings, 'ALLOWED_EMAIL_DOMAINS', None)
        if allowed_domains:
            return domain in allowed_domains
        
        return True
        
    except EmailNotValidError:
        return False
    except Exception as e:
        logger.warning(f"Email domain validation error: {e}")
        return False

def validate_username(username: str) -> ValidationResult:
    """
    ユーザー名バリデーション
    
    Args:
        username: ユーザー名
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    if not username:
        result.add_error("ユーザー名は必須です")
        return result
    
    # 長さチェック
    if len(username) < 3:
        result.add_error("ユーザー名は3文字以上である必要があります")
    elif len(username) > 50:
        result.add_error("ユーザー名は50文字以下である必要があります")
    
    # 文字パターンチェック
    if not PATTERNS['username'].match(username):
        result.add_error("ユーザー名は英数字、ハイフン、アンダースコアのみ使用できます")
    
    # 予約語チェック
    reserved_words = {
        'admin', 'administrator', 'root', 'system', 'api', 'www',
        'mail', 'ftp', 'ssh', 'test', 'demo', 'guest', 'user'
    }
    if username.lower() in reserved_words:
        result.add_error("このユーザー名は予約されています")
    
    # 不適切な内容チェック
    inappropriate_words = ['fuck', 'shit', 'damn', 'hell']
    if any(word in username.lower() for word in inappropriate_words):
        result.add_error("不適切な内容が含まれています")
    
    return result

def validate_password_strength(password: str) -> Dict[str, Any]:
    """
    パスワード強度検証
    
    Args:
        password: パスワード
    
    Returns:
        Dict[str, Any]: 検証結果詳細
    """
    result = {
        'score': 0,
        'max_score': 5,
        'strength': '',
        'is_valid': False,
        'requirements': [],
        'suggestions': []
    }
    
    if not password:
        result['requirements'].append("パスワードは必須です")
        return result
    
    # 長さチェック
    if len(password) >= 8:
        result['score'] += 1
        result['requirements'].append("✓ 8文字以上")
    else:
        result['requirements'].append("✗ 8文字以上必要")
        result['suggestions'].append("8文字以上にしてください")
    
    # 小文字チェック
    if re.search(r'[a-z]', password):
        result['score'] += 1
        result['requirements'].append("✓ 小文字を含む")
    else:
        result['requirements'].append("✗ 小文字が必要")
        result['suggestions'].append("小文字を含めてください")
    
    # 大文字チェック
    if re.search(r'[A-Z]', password):
        result['score'] += 1
        result['requirements'].append("✓ 大文字を含む")
    else:
        result['requirements'].append("✗ 大文字が必要")
        result['suggestions'].append("大文字を含めてください")
    
    # 数字チェック
    if re.search(r'\d', password):
        result['score'] += 1
        result['requirements'].append("✓ 数字を含む")
    else:
        result['requirements'].append("✗ 数字が必要")
        result['suggestions'].append("数字を含めてください")
    
    # 特殊文字チェック
    if re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        result['score'] += 1
        result['requirements'].append("✓ 特殊文字を含む")
    else:
        result['requirements'].append("✗ 特殊文字推奨")
        result['suggestions'].append("特殊文字(!@#$%など)を含めると更に安全です")
    
    # 強度レベル判定
    strength_levels = ["非常に弱い", "弱い", "普通", "強い", "非常に強い"]
    result['strength'] = strength_levels[min(result['score'], 4)]
    result['is_valid'] = result['score'] >= 3
    
    # 一般的パスワードチェック
    common_passwords = [
        'password', '12345678', 'qwerty', 'abc123', 'password123',
        'admin', 'letmein', 'welcome', 'monkey', '1234567890'
    ]
    if password.lower() in common_passwords:
        result['score'] = max(0, result['score'] - 2)
        result['is_valid'] = False
        result['suggestions'].append("よく使われるパスワードは避けてください")
    
    return result

def validate_phone_number(phone: str, country: str = "JP") -> ValidationResult:
    """
    電話番号バリデーション
    
    Args:
        phone: 電話番号
        country: 国コード
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    if not phone:
        result.add_error("電話番号は必須です")
        return result
    
    # 日本の電話番号パターン
    if country == "JP":
        # ハイフンや空白を除去
        clean_phone = re.sub(r'[-\s()]', '', phone)
        
        if not PATTERNS['phone_jp'].match(clean_phone):
            result.add_error("正しい日本の電話番号形式で入力してください（例: 03-1234-5678）")
    else:
        # 国際電話番号の簡易チェック
        clean_phone = re.sub(r'[-\s()+(]', '', phone)
        if not clean_phone.isdigit() or len(clean_phone) < 10 or len(clean_phone) > 15:
            result.add_error("正しい電話番号形式で入力してください")
    
    return result

# ===== 旅行関連バリデーター =====

def validate_travel_dates(start_date: date, end_date: date) -> ValidationResult:
    """
    旅行日程バリデーション
    
    Args:
        start_date: 開始日
        end_date: 終了日
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    if not start_date or not end_date:
        result.add_error("開始日と終了日は必須です")
        return result
    
    # 日付順序チェック
    if end_date <= start_date:
        result.add_error("終了日は開始日より後である必要があります")
    
    # 過去日チェック
    today = date.today()
    if start_date < today:
        result.add_error("開始日は今日以降である必要があります")
    
    # 期間チェック
    duration = (end_date - start_date).days
    if duration > 365:
        result.add_error("旅行期間は1年以内である必要があります")
    elif duration > 30:
        result.add_warning("30日を超える長期旅行です")
    
    # 未来すぎる日付チェック
    max_future_days = 730  # 2年後まで
    if (start_date - today).days > max_future_days:
        result.add_warning("2年以上先の予定です")
    
    return result

def validate_coordinates(latitude: float, longitude: float) -> ValidationResult:
    """
    緯度経度バリデーション
    
    Args:
        latitude: 緯度
        longitude: 経度
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    # 緯度チェック
    if not (-90 <= latitude <= 90):
        result.add_error("緯度は-90から90の範囲で入力してください")
    
    # 経度チェック
    if not (-180 <= longitude <= 180):
        result.add_error("経度は-180から180の範囲で入力してください")
    
    # 日本周辺エリアかどうかの警告
    japan_bounds = {
        'north': 46, 'south': 24, 'east': 146, 'west': 123
    }
    
    if not (japan_bounds['south'] <= latitude <= japan_bounds['north'] and
            japan_bounds['west'] <= longitude <= japan_bounds['east']):
        result.add_warning("日本国外の座標です")
    
    return result

def validate_time_range(start_time: str, end_time: str) -> ValidationResult:
    """
    時間範囲バリデーション
    
    Args:
        start_time: 開始時間 "HH:MM"
        end_time: 終了時間 "HH:MM"
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    # 時間形式チェック
    if not PATTERNS['time_format'].match(start_time):
        result.add_error("開始時間の形式が正しくありません（HH:MM形式で入力）")
    
    if not PATTERNS['time_format'].match(end_time):
        result.add_error("終了時間の形式が正しくありません（HH:MM形式で入力）")
    
    if result.errors:
        return result
    
    # 時間順序チェック
    start_minutes = int(start_time.split(':')[0]) * 60 + int(start_time.split(':')[1])
    end_minutes = int(end_time.split(':')[0]) * 60 + int(end_time.split(':')[1])
    
    if end_minutes <= start_minutes:
        result.add_error("終了時間は開始時間より後である必要があります")
    
    # 長時間活動の警告
    duration_minutes = end_minutes - start_minutes
    if duration_minutes > 480:  # 8時間以上
        result.add_warning("8時間を超える長時間の活動です")
    
    return result

def validate_budget(budget: Optional[float], currency: str = "JPY") -> ValidationResult:
    """
    予算バリデーション
    
    Args:
        budget: 予算
        currency: 通貨
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    if budget is None:
        return result  # 予算は任意
    
    # 負の値チェック
    if budget < 0:
        result.add_error("予算は0以上である必要があります")
    
    # 通貨別の妥当性チェック
    if currency == "JPY":
        if budget > 10000000:  # 1000万円
            result.add_warning("非常に高額な予算です")
        elif budget < 1000:  # 1000円未満
            result.add_warning("予算が少なすぎる可能性があります")
    elif currency == "USD":
        if budget > 100000:  # $100,000
            result.add_warning("非常に高額な予算です")
        elif budget < 100:  # $100未満
            result.add_warning("予算が少なすぎる可能性があります")
    
    return result

# ===== ファイル・セキュリティ関連バリデーター =====

def validate_file_upload(
    filename: str, 
    file_size: int, 
    file_type: str = "image",
    max_size_mb: int = 10
) -> ValidationResult:
    """
    ファイルアップロードバリデーション
    
    Args:
        filename: ファイル名
        file_size: ファイルサイズ（バイト）
        file_type: ファイルタイプ（image, document）
        max_size_mb: 最大サイズ（MB）
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    if not filename:
        result.add_error("ファイル名が必要です")
        return result
    
    # ファイル拡張子取得
    file_ext = '.' + filename.split('.')[-1].lower() if '.' in filename else ''
    
    # 危険な拡張子チェック
    if file_ext in DANGEROUS_EXTENSIONS:
        result.add_error("このファイル形式はセキュリティ上アップロードできません")
        return result
    
    # ファイルタイプ別チェック
    if file_type == "image":
        if file_ext not in ALLOWED_IMAGE_EXTENSIONS:
            result.add_error(f"サポートされていない画像形式です。対応形式: {', '.join(ALLOWED_IMAGE_EXTENSIONS)}")
    elif file_type == "document":
        if file_ext not in ALLOWED_DOCUMENT_EXTENSIONS:
            result.add_error(f"サポートされていない文書形式です。対応形式: {', '.join(ALLOWED_DOCUMENT_EXTENSIONS)}")
    
    # ファイルサイズチェック
    file_size_mb = file_size / (1024 * 1024)
    if file_size_mb > max_size_mb:
        result.add_error(f"ファイルサイズが上限（{max_size_mb}MB）を超えています")
    
    # ファイル名の安全性チェック
    dangerous_chars = ['<', '>', ':', '"', '|', '?', '*', '\\', '/']
    if any(char in filename for char in dangerous_chars):
        result.add_error("ファイル名に使用できない文字が含まれています")
    
    # ファイル名長チェック
    if len(filename) > 255:
        result.add_error("ファイル名が長すぎます（255文字以内）")
    
    return result

def validate_ip_address(ip_address: str) -> ValidationResult:
    """
    IPアドレスバリデーション
    
    Args:
        ip_address: IPアドレス
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    try:
        ip_obj = ipaddress.ip_address(ip_address)
        
        # プライベートIPアドレスの警告
        if ip_obj.is_private:
            result.add_warning("プライベートIPアドレスです")
        
        # ローカルIPアドレスの警告
        if ip_obj.is_loopback:
            result.add_warning("ローカルIPアドレスです")
        
        # マルチキャストアドレスの警告
        if ip_obj.is_multicast:
            result.add_warning("マルチキャストIPアドレスです")
        
    except ValueError:
        result.add_error("有効なIPアドレスではありません")
    
    return result

def validate_url(url: str, require_https: bool = False) -> ValidationResult:
    """
    URL バリデーション
    
    Args:
        url: URL
        require_https: HTTPS必須かどうか
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    if not url:
        result.add_error("URLは必須です")
        return result
    
    # URL形式チェック
    if not PATTERNS['url'].match(url):
        result.add_error("有効なURL形式ではありません")
        return result
    
    # HTTPS必須チェック
    if require_https and not url.startswith('https://'):
        result.add_error("HTTPSのURLが必要です")
    
    # HTTP/HTTPSチェック
    if not url.startswith(('http://', 'https://')):
        result.add_error("http://またはhttps://で始まる必要があります")
    
    # 禁止ドメインチェック
    blocked_domains = ['malware.com', 'phishing.com']  # 実際の実装では設定から読み込み
    domain = url.split('/')[2].lower()
    if any(blocked in domain for blocked in blocked_domains):
        result.add_error("このドメインはブロックされています")
    
    return result

# ===== 日本語特有バリデーター =====

def validate_japanese_postal_code(postal_code: str) -> ValidationResult:
    """
    日本郵便番号バリデーション
    
    Args:
        postal_code: 郵便番号
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    if not postal_code:
        result.add_error("郵便番号は必須です")
        return result
    
    # ハイフンの有無を考慮
    clean_code = postal_code.replace('-', '')
    
    if not PATTERNS['postal_code_jp'].match(postal_code):
        result.add_error("正しい郵便番号形式で入力してください（例: 123-4567）")
    
    return result

def validate_japanese_text(text: str, min_length: int = 1, max_length: int = 1000) -> ValidationResult:
    """
    日本語テキストバリデーション
    
    Args:
        text: テキスト
        min_length: 最小長
        max_length: 最大長
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    if not text:
        result.add_error("テキストは必須です")
        return result
    
    # 長さチェック
    if len(text) < min_length:
        result.add_error(f"テキストは{min_length}文字以上である必要があります")
    
    if len(text) > max_length:
        result.add_error(f"テキストは{max_length}文字以下である必要があります")
    
    # 日本語が含まれているかチェック（必要に応じて）
    if not PATTERNS['japanese_text'].search(text):
        result.add_warning("日本語が含まれていません")
    
    # 不適切内容のチェック（簡易版）
    inappropriate_words = ['バカ', 'アホ', '死ね', 'クソ']
    for word in inappropriate_words:
        if word in text:
            result.add_error("不適切な内容が含まれています")
            break
    
    return result

# ===== 統合バリデーション関数 =====

def validate_travel_plan_data(plan_data: Dict[str, Any]) -> ValidationResult:
    """
    旅行プランデータ統合バリデーション
    
    Args:
        plan_data: プランデータ
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    # 必須フィールドチェック
    required_fields = ['title', 'destination', 'start_date', 'end_date']
    for field in required_fields:
        if field not in plan_data or not plan_data[field]:
            result.add_error(f"{field}は必須です")
    
    if result.errors:
        return result
    
    # 個別バリデーション
    # タイトルチェック
    title_result = validate_japanese_text(plan_data['title'], 1, 300)
    result.errors.extend(title_result.errors)
    result.warnings.extend(title_result.warnings)
    
    # 日程チェック
    if 'start_date' in plan_data and 'end_date' in plan_data:
        date_result = validate_travel_dates(plan_data['start_date'], plan_data['end_date'])
        result.errors.extend(date_result.errors)
        result.warnings.extend(date_result.warnings)
    
    # 予算チェック
    if 'budget' in plan_data and plan_data['budget'] is not None:
        budget_result = validate_budget(plan_data['budget'])
        result.errors.extend(budget_result.errors)
        result.warnings.extend(budget_result.warnings)
    
    # グループサイズチェック
    if 'group_size' in plan_data:
        group_size = plan_data['group_size']
        if group_size < 1:
            result.add_error("グループサイズは1以上である必要があります")
        elif group_size > 50:
            result.add_warning("50人を超える大規模グループです")
    
    # 最終判定
    result.is_valid = len(result.errors) == 0
    
    return result

def validate_api_request(request_data: Dict[str, Any], schema: Dict[str, Any]) -> ValidationResult:
    """
    APIリクエストデータバリデーション
    
    Args:
        request_data: リクエストデータ
        schema: バリデーションスキーマ
    
    Returns:
        ValidationResult: バリデーション結果
    """
    result = ValidationResult()
    
    # スキーマベースバリデーション
    for field, rules in schema.items():
        value = request_data.get(field)
        
        # 必須チェック
        if rules.get('required', False) and (value is None or value == ''):
            result.add_error(f"{field}は必須です")
            continue
        
        if value is None:
            continue
        
        # 型チェック
        expected_type = rules.get('type')
        if expected_type and not isinstance(value, expected_type):
            result.add_error(f"{field}の型が正しくありません")
            continue
        
        # 長さチェック
        if isinstance(value, str):
            min_length = rules.get('min_length', 0)
            max_length = rules.get('max_length', float('inf'))
            
            if len(value) < min_length:
                result.add_error(f"{field}は{min_length}文字以上である必要があります")
            elif len(value) > max_length:
                result.add_error(f"{field}は{max_length}文字以下である必要があります")
        
        # 数値範囲チェック
        if isinstance(value, (int, float)):
            min_value = rules.get('min_value')
            max_value = rules.get('max_value')
            
            if min_value is not None and value < min_value:
                result.add_error(f"{field}は{min_value}以上である必要があります")
            elif max_value is not None and value > max_value:
                result.add_error(f"{field}は{max_value}以下である必要があります")
        
        # パターンチェック
        pattern = rules.get('pattern')
        if pattern and isinstance(value, str):
            if isinstance(pattern, str):
                pattern = re.compile(pattern)
            if not pattern.match(value):
                result.add_error(f"{field}の形式が正しくありません")
    
    result.is_valid = len(result.errors) == 0
    return result