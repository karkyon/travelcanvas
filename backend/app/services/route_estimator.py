"""
[Gate #32] 移動時間・距離の概算サービス。

外部ルーティングAPI(Google Directions等)はAPIキー未提供のため使用しない。
2地点間の大円距離(haversine)を、移動手段ごとの想定巡航速度で割った
「概算」を返す。これは実際の道路網に沿った経路ではなく直線距離ベースの
下限推定であり、常に is_estimate=True・provider="haversine_estimate" を
伴わせて呼び出し側へ渡す(v5.1仕様: 「計算失敗時は直線距離を確定値に
せず概算/取得日時を明示する」に対応)。

将来、実ルーティングprovider(APIキー入手後)を追加する場合は、本モジュール
と同じ関数シグネチャのadapterを追加し、呼び出し側で切り替えられるように
設計している。
"""
import math
from datetime import datetime, timezone
from typing import Optional

ALGORITHM_VERSION = "haversine-v1"
PROVIDER_NAME = "haversine_estimate"

# 移動手段ごとの想定巡航速度(km/h)。実測ではなく一般的な目安値。
_MODE_SPEED_KMH = {
    "walking": 4.5,
    "driving": 30.0,
    "transit": 20.0,
}

# 直線距離に対し実際の道路網で生じる迂回を補正する係数(目安)。
_MODE_DETOUR_FACTOR = {
    "walking": 1.3,
    "driving": 1.4,
    "transit": 1.5,
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """2点間の大円距離(km)。"""
    r = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def estimate_leg(
    from_lat: Optional[float], from_lon: Optional[float],
    to_lat: Optional[float], to_lon: Optional[float],
    mode: str = "walking",
) -> Optional[dict]:
    """区間の概算距離・所要時間を返す。座標が片方でも欠けている場合は
    Noneを返す(架空の値を作らず「unknown」として扱う)。"""
    if from_lat is None or from_lon is None or to_lat is None or to_lon is None:
        return None

    mode = mode if mode in _MODE_SPEED_KMH else "walking"
    straight_km = haversine_km(from_lat, from_lon, to_lat, to_lon)
    detour_km = straight_km * _MODE_DETOUR_FACTOR[mode]
    speed = _MODE_SPEED_KMH[mode]
    duration_minutes = (detour_km / speed) * 60 if speed > 0 else None

    return {
        "mode": mode,
        "distance_km": round(detour_km, 2),
        "duration_minutes": round(duration_minutes, 1) if duration_minutes is not None else None,
        "is_estimate": True,
        "provider": PROVIDER_NAME,
        "algorithm_version": ALGORITHM_VERSION,
        "computed_at": datetime.now(timezone.utc),
    }
