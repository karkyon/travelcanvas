import time
from typing import Dict
from collections import defaultdict, deque

# メモリベースのレート制限（シンプル版）
_rate_limit_storage: Dict[str, deque] = defaultdict(deque)

def check_rate_limit(key: str, limit: int, window_seconds: int) -> bool:
    """
    レート制限チェック（シンプル版）
    
    Args:
        key: レート制限のキー
        limit: 制限回数
        window_seconds: 時間窓（秒）
    
    Returns:
        bool: 制限内であればTrue、制限を超えている場合False
    """
    current_time = time.time()
    window_start = current_time - window_seconds
    
    # 古いエントリを削除
    timestamps = _rate_limit_storage[key]
    while timestamps and timestamps[0] < window_start:
        timestamps.popleft()
    
    # 制限チェック
    if len(timestamps) >= limit:
        return False
    
    # 新しいタイムスタンプを追加
    timestamps.append(current_time)
    return True

def get_remaining_attempts(key: str, limit: int, window_seconds: int) -> int:
    """残り試行回数を取得"""
    current_time = time.time()
    window_start = current_time - window_seconds
    
    timestamps = _rate_limit_storage[key]
    # 古いエントリを削除
    while timestamps and timestamps[0] < window_start:
        timestamps.popleft()
    
    return max(0, limit - len(timestamps))

def reset_rate_limit(key: str):
    """レート制限をリセット"""
    if key in _rate_limit_storage:
        _rate_limit_storage[key].clear()
