"""[Gate G6] LOC-02 位置を外へ出す時のぼかし(書き出し・公開の共有・旅行記の公開で共通に使う)。

- 守る範囲(privacy_zones): 利用者が登録する自宅・職場など(中心と半径 100〜5000m)。中心の座標は利用者のデータ鍵で
  暗号化して保存する。この範囲の中の地点・軌跡の点は、外へ出す物から除く(座標を出さない)。
  旅行の所有者の範囲と、書き出す本人の範囲の両方を使う(メンバーの書き出しから所有者の自宅が分からないように)。
- 軌跡の始まりと終わりの切り落とし(truncate_m): 出発・帰着の地点(自宅・宿)が分からないよう、両端から既定 300m を除く。
- 格子へのまとめ(grid_decimals): 座標を小数の桁で丸め、同じ格子の点を1つにする(既定 2 桁 ≒ 1km)。

ここで作った物だけを外へ出し、生の座標は外へ出さない(URL の共有・PDF・画像・ログ・分析)。
"""
import json
import math
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_payload, encrypt_payload, user_subject

EARTH_RADIUS_M = 6371008.8
MIN_RADIUS_M = 100
MAX_RADIUS_M = 5000
MAX_ZONES = 10
DEFAULT_TRUNCATE_M = 300
DEFAULT_GRID_DECIMALS = 2

Zone = Tuple[float, float, int]  # (lat, lng, radius_m)


class ZoneInputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lng1, lat2, lng2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def clean_zone(label: Any, lat: Any, lng: Any, radius_m: Any) -> Tuple[str, float, float, int]:
    if not isinstance(label, str) or not label.strip() or len(label.strip()) > 50:
        raise ZoneInputError("invalid_zone_label", "名前を50文字までで入力してください(例: 自宅)")
    for v, lim, name in ((lat, 90, "緯度"), (lng, 180, "経度")):
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or not -lim <= v <= lim:
            raise ZoneInputError("invalid_zone_center", f"{name}の値が正しくありません")
    if not isinstance(radius_m, int) or isinstance(radius_m, bool) or not MIN_RADIUS_M <= radius_m <= MAX_RADIUS_M:
        raise ZoneInputError("invalid_zone_radius", f"半径は{MIN_RADIUS_M}〜{MAX_RADIUS_M}mの整数です")
    return label.strip(), float(lat), float(lng), radius_m


def seal_center(user_id: uuid.UUID, lat: float, lng: float) -> bytes:
    return encrypt_payload(json.dumps({"lat": lat, "lng": lng}).encode("utf-8"), user_subject(user_id))


def open_center(ciphertext: bytes) -> Optional[Tuple[float, float]]:
    try:
        data = json.loads(decrypt_payload(ciphertext).decode("utf-8"))
        return float(data["lat"]), float(data["lng"])
    except Exception:  # noqa: BLE001 - 読めない範囲は「無い」ではなく、呼び出し側で安全側(除外)に倒す
        return None


def zones_for(db: Session, user_ids: Iterable[Any]) -> List[Zone]:
    """利用者たちの守る範囲(重複を除く)。読めない範囲は世界全体を覆う範囲として扱う(座標を出さない側に倒す)。"""
    from app.models.models import PrivacyZone

    ids = {uuid.UUID(str(u)) for u in user_ids if u is not None}
    if not ids:
        return []
    out: List[Zone] = []
    z: Any
    for z in db.query(PrivacyZone).filter(PrivacyZone.user_id.in_(ids)).all():
        center = open_center(z.center_ciphertext)
        if center is None:
            return [(0.0, 0.0, -1)]  # 読めない: 全てを除く
        out.append((center[0], center[1], int(z.radius_m)))
    return out


def in_zones(lat: Optional[float], lng: Optional[float], zones: Sequence[Zone]) -> bool:
    if lat is None or lng is None:
        return False
    for zlat, zlng, radius in zones:
        if radius < 0 or haversine_m(lat, lng, zlat, zlng) <= radius:
            return True
    return False


def project_point(lat: Optional[float], lng: Optional[float], zones: Sequence[Zone],
                  decimals: Optional[int] = None) -> Tuple[Optional[float], Optional[float]]:
    """外へ出してよい座標(守る範囲の中なら None, None)。decimals を渡すと丸める。"""
    if lat is None or lng is None or in_zones(lat, lng, zones):
        return None, None
    if decimals is None:
        return lat, lng
    return round(lat, decimals), round(lng, decimals)


def project_track(points: Sequence[Dict[str, Any]], zones: Sequence[Zone], truncate_m: float = DEFAULT_TRUNCATE_M,
                  grid_decimals: Optional[int] = DEFAULT_GRID_DECIMALS) -> List[Dict[str, float]]:
    """軌跡({"lat","lng","t"} の並び)を外へ出せる形にする: 守る範囲の点を除き、両端を truncate_m 切り落とし、
    格子にまとめる(並びの順は保つ。同じ格子が続く点は1つにする)。"""
    pts = [p for p in sorted(points, key=lambda x: str(x.get("t", ""))) if p.get("lat") is not None
           and p.get("lng") is not None]

    def trim(seq: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if truncate_m <= 0 or not seq:
            return seq
        dist = 0.0
        for i in range(1, len(seq)):
            dist += haversine_m(seq[i - 1]["lat"], seq[i - 1]["lng"], seq[i]["lat"], seq[i]["lng"])
            if dist >= truncate_m:
                return seq[i:]
        return []

    pts = trim(pts)
    pts = list(reversed(trim(list(reversed(pts)))))
    pts = [p for p in pts if not in_zones(p["lat"], p["lng"], zones)]
    out: List[Dict[str, float]] = []
    for p in pts:
        lat, lng = (round(p["lat"], grid_decimals), round(p["lng"], grid_decimals)) if grid_decimals is not None \
            else (p["lat"], p["lng"])
        if in_zones(lat, lng, zones):
            continue  # 丸めた格子の点が守る範囲に入る(範囲の外の点を丸めると範囲の中を指すことがある)
        if out and out[-1]["lat"] == lat and out[-1]["lng"] == lng:
            continue
        out.append({"lat": lat, "lng": lng})
    return out
