"""[Gate Remaining-2] FR-014・FR-015・FR-017 時刻表・運賃の経路探索の接続口(駅すぱあと Web サービス。有料の契約の鍵)。

- 鍵は運用コンソールで登録した ekispert_api_key だけ。無い時は Unavailable("not_configured")
  → 画面は今までどおり区間・経路を手で入れる(架空の時刻表を作らない)
- 送るのは出発・到着の駅名と日時だけ(旅行・利用者・予定の名前は送らない)。結果は 10 分使い回す
- 返すのは経路の候補(区間・乗り換え・運賃)。保存は利用者が選んで手入力の経路候補として作る(勝手に旅程を変えない)
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import ext_http
from app.services import provider_secrets as ps
from app.services.ext_http import Unavailable

NAME = "ekispert"
SLOT = "ekispert_api_key"
SOURCE_LABEL = "駅すぱあと"
MAX_RESULTS = 5


def _root() -> str:
    return (getattr(settings, "EKISPERT_API_URL", "") or "https://api.ekispert.jp/v1/json").rstrip("/")


def configured(db: Session) -> bool:
    try:
        _key(db)
        return True
    except Unavailable:
        return False


def _key(db: Session) -> str:
    if not ext_http.allowed(NAME, "EKISPERT_ENABLED"):
        raise Unavailable("disabled")
    try:
        return ps.resolve(db, SLOT)
    except ps.SecretUnavailable:
        raise Unavailable("not_configured")


def _list(v: Any) -> List[Any]:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _dt(state: Any) -> Optional[str]:
    text = ((state or {}).get("Datetime") or {}).get("text") if isinstance(state, dict) else None
    if not text:
        return None
    try:
        return datetime.fromisoformat(str(text)).isoformat()
    except ValueError:
        return None


def _int(v: Any) -> Optional[int]:
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return None


# 駅すぱあとの種類 → 経路の区間の移動手段(app/api/v1/segments.py の MODES の中だけ)
MODE_OF = {"train": "train", "bus": "bus", "plane": "flight", "ship": "ferry", "walk": "walking",
           "strange": "mixed"}


def _parse(body: Any) -> List[Dict[str, Any]]:
    courses = _list(((body or {}).get("ResultSet") or {}).get("Course"))
    out: List[Dict[str, Any]] = []
    for c in courses[:MAX_RESULTS]:
        route = (c or {}).get("Route") or {}
        points = [str(((p or {}).get("Station") or {}).get("Name") or (p or {}).get("Name") or "")
                  for p in _list(route.get("Point"))]
        legs = []
        for i, line in enumerate(_list(route.get("Line"))):
            line = line or {}
            kind = line.get("Type")
            kind = kind.get("text") if isinstance(kind, dict) else kind
            mode = MODE_OF.get(str(kind or "train"), "mixed")
            if mode == "train" and "新幹線" in str(line.get("Name") or ""):
                mode = "shinkansen"
            legs.append({
                "mode": mode,
                "line": str(line.get("Name") or "")[:100] or None,
                "from_label": points[i][:100] if i < len(points) and points[i] else None,
                "to_label": points[i + 1][:100] if i + 1 < len(points) and points[i + 1] else None,
                "departure_at": _dt(line.get("DepartureState")), "arrival_at": _dt(line.get("ArrivalState")),
                "duration_minutes": _int(line.get("timeOnBoard")),
            })
        fare = None
        for price in _list(c.get("Price")):
            if (price or {}).get("kind") == "FareSummary":
                one = price.get("Oneway")
                fare = _int(one.get("text") if isinstance(one, dict) else one)
        total = sum(_int(route.get(k)) or 0 for k in ("timeOnBoard", "timeWalk", "timeOther"))
        out.append({"total_duration_minutes": total or None, "transfer_count": _int(route.get("transferCount")),
                    "total_cost": fare, "currency": "JPY" if fare is not None else None,
                    "walking_minutes": _int(route.get("timeWalk")), "legs": legs, "source": SOURCE_LABEL})
    return out


def search(db: Session, origin: str, destination: str, day: date, hhmm: Optional[str],
           arrive_by: bool = False) -> List[Dict[str, Any]]:
    key = _key(db)
    origin, destination = origin.strip()[:60], destination.strip()[:60]
    if not origin or not destination:
        raise Unavailable("bad_request")
    params: Dict[str, Any] = {"key": key, "viaList": f"{origin}:{destination}", "date": day.strftime("%Y%m%d"),
                              "answerCount": MAX_RESULTS, "searchType": "arrival" if arrive_by else "departure"}
    if hhmm:
        params["time"] = hhmm.replace(":", "")[:4]

    def call() -> List[Dict[str, Any]]:
        return _parse(ext_http.get_json(NAME, f"{_root()}/search/course/extreme", params=params, timeout=10.0))

    cache_key = f"{origin}:{destination}:{params['date']}:{params.get('time', '')}:{params['searchType']}"
    return ext_http.cached(NAME, cache_key, 600, call)
