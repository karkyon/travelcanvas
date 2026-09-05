"""
[Gate #32] route_estimator.pyの契約テスト。外部APIを一切呼ばない
決定論的な計算のみを検証する(APIキー不要)。
"""
from app.services import route_estimator


def test_haversine_km_known_distance():
    # 東京駅と大阪駅の概算直線距離(約400km前後)
    tokyo = (35.681236, 139.767125)
    osaka = (34.702485, 135.495951)
    dist = route_estimator.haversine_km(*tokyo, *osaka)
    assert 390 <= dist <= 410


def test_haversine_km_same_point_is_zero():
    dist = route_estimator.haversine_km(35.0, 135.0, 35.0, 135.0)
    assert dist == 0


def test_estimate_leg_returns_none_when_coordinates_missing():
    """[Gate #32] 座標が片方でも欠けている場合は架空の値を作らずNoneを返す。"""
    assert route_estimator.estimate_leg(None, None, 35.0, 135.0) is None
    assert route_estimator.estimate_leg(35.0, 135.0, None, None) is None


def test_estimate_leg_marks_result_as_estimate():
    result = route_estimator.estimate_leg(34.687, 135.526, 34.702, 135.495, mode="walking")
    assert result is not None
    assert result["is_estimate"] is True
    assert result["provider"] == "haversine_estimate"
    assert result["algorithm_version"] == "haversine-v1"
    assert result["distance_km"] > 0
    assert result["duration_minutes"] > 0


def test_estimate_leg_unknown_mode_falls_back_to_walking():
    result = route_estimator.estimate_leg(34.687, 135.526, 34.702, 135.495, mode="teleport")
    assert result is not None
    assert result["mode"] == "walking"


def test_estimate_leg_driving_is_faster_than_walking_for_same_distance():
    walking = route_estimator.estimate_leg(34.687, 135.526, 34.900, 135.700, mode="walking")
    driving = route_estimator.estimate_leg(34.687, 135.526, 34.900, 135.700, mode="driving")
    assert driving["duration_minutes"] < walking["duration_minutes"]
