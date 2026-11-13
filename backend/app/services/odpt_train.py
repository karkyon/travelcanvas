"""[Gate Remaining-2] FR-030 鉄道の運行情報の接続口(公共交通オープンデータセンター ODPT。利用登録の鍵が要る)。

- 鍵は運用コンソールで登録した odpt_consumer_key だけ(provider_secrets)。無い時は Unavailable("not_configured")
  → 画面は「運行情報は手で入れる」のまま(作り話の運行情報を出さない)
- 送るのは鍵だけ(旅行・利用者・予定は送らない)。路線の一覧(1 日)と運行情報(5 分)を使い回す
- 旅程の文字(予定・経路の路線名)に出てくる路線のうち、平常でないものだけ返す
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List

from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import ext_http
from app.services import provider_secrets as ps
from app.services.ext_http import Unavailable

NAME = "odpt"
SLOT = "odpt_consumer_key"
SOURCE_LABEL = "公共交通オープンデータセンター(ODPT)"
NORMAL_WORDS = ("平常", "通常どおり", "通常通り")


def _root() -> str:
    return (getattr(settings, "ODPT_API_URL", "") or "https://api.odpt.org/api/v4").rstrip("/")


def _key(db: Session) -> str:
    if not ext_http.allowed(NAME, "ODPT_ENABLED"):
        raise Unavailable("disabled")
    try:
        return ps.resolve(db, SLOT)
    except ps.SecretUnavailable:
        raise Unavailable("not_configured")


def configured(db: Session) -> bool:
    try:
        _key(db)
        return True
    except Unavailable:
        return False


def _ja(v: Any) -> str:
    if isinstance(v, dict):
        return str(v.get("ja") or v.get("en") or "")
    return str(v or "")


def _railways(key: str) -> Dict[str, str]:
    def call() -> Dict[str, str]:
        body = ext_http.get_json(NAME, f"{_root()}/odpt:Railway", params={"acl:consumerKey": key}, timeout=10.0)
        out: Dict[str, str] = {}
        for r in body if isinstance(body, list) else []:
            rid = str((r or {}).get("owl:sameAs") or "")
            title = _ja((r or {}).get("odpt:railwayTitle")) or str((r or {}).get("dc:title") or "")
            if rid and title:
                out[rid] = title
        return out

    return ext_http.cached(NAME, "railways", 86400, call)


def _information(key: str) -> List[Dict[str, Any]]:
    def call() -> List[Dict[str, Any]]:
        body = ext_http.get_json(NAME, f"{_root()}/odpt:TrainInformation", params={"acl:consumerKey": key},
                                 timeout=10.0)
        return [x for x in body if isinstance(x, dict)] if isinstance(body, list) else []

    return ext_http.cached(NAME, "info", 300, call)


def disruptions(db: Session, texts: Iterable[str]) -> List[Dict[str, Any]]:
    """旅程の文字に出てくる路線の平常でない運行情報。{railway, status, text, observed_at, source}"""
    key = _key(db)
    names = _railways(key)
    hay = "\n".join(t for t in texts if t)
    out: List[Dict[str, Any]] = []
    for info in _information(key):
        rid = str(info.get("odpt:railway") or "")
        title = names.get(rid)
        if not title or len(title) < 2 or title not in hay:
            continue
        text = _ja(info.get("odpt:trainInformationText"))
        status = _ja(info.get("odpt:trainInformationStatus"))
        if not status and any(w in text for w in NORMAL_WORDS):
            continue
        out.append({"railway": title, "status": status or "お知らせ", "text": text[:300],
                    "observed_at": info.get("dc:date"), "source": SOURCE_LABEL,
                    "suggested_kind": "cancellation" if "運転見合わせ" in (status + text) or "運休" in (status + text)
                    else "delay"})
    return out
