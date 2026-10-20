"""[Gate C2] FR-007 候補箱の純粋関数(DB非依存)。

- URL の正規化(FC-019 canonical URL): http/https だけ、ホストを小文字・既定のポートを外す・断片(#)を外す・
  追跡用のパラメータ(utm_*・fbclid・gclid 等)を外す。URL の先をサーバーから取りに行かない(SSRF を起こさない)。
  利用者名・パスワード付きの URL、制御文字、2000文字超は受け付けない。
- 重複の候補(FC-023): 提供元の ID が同じ・名前が同じ(全角半角・大文字小文字・空白・記号を無視)・100m 以内・住所が同じ。
  自動で消さず、理由を付けて示す(利用者が統合を決める)。
"""
import math
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

MAX_URL = 2000
DUPLICATE_DISTANCE_M = 100.0
TRACKING_PARAMS = {"fbclid", "gclid", "dclid", "msclkid", "yclid", "igshid", "mc_cid", "mc_eid", "_ga", "ref_src"}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_NAME_STRIP = re.compile(r"[\s\-‐‑‒–—―ー・･,，.。、'\"“”‘’()（）\[\]［］【】「」『』!！?？:：;；/／&＆]+")


class CandidateInputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def canonical_url(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return None
    if len(value) > MAX_URL or _CONTROL.search(value):
        raise CandidateInputError("invalid_url", "URL が長すぎるか、使えない文字を含んでいます")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        raise CandidateInputError("invalid_url", "URL の形式が正しくありません")
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        raise CandidateInputError("invalid_url", "URL は http:// か https:// で始めてください")
    if parts.username or parts.password:
        raise CandidateInputError("invalid_url", "利用者名・パスワードを含む URL は登録できません")
    host = parts.hostname.lower().rstrip(".")
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        host = f"{host}:{port}"
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in TRACKING_PARAMS]
    path = parts.path or "/"
    return urlunsplit((scheme, host, path, urlencode(query, doseq=True), ""))


def url_label(url: Optional[str]) -> Optional[str]:
    """表示用の出典の名前(ホスト名。www. を外す)。"""
    if not url:
        return None
    host = urlsplit(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def normalize_name(name: Optional[str]) -> str:
    if not name:
        return ""
    return _NAME_STRIP.sub("", unicodedata.normalize("NFKC", name).lower())


def _distance_m(a: Dict[str, Any], b: Dict[str, Any]) -> Optional[float]:
    if None in (a.get("latitude"), a.get("longitude"), b.get("latitude"), b.get("longitude")):
        return None
    la1, lo1, la2, lo2 = map(math.radians, (a["latitude"], a["longitude"], b["latitude"], b["longitude"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1.0, math.sqrt(h)))


def duplicate_reasons(a: Dict[str, Any], b: Dict[str, Any]) -> List[str]:
    reasons: List[str] = []
    if a.get("provider") and a.get("external_id") and (a.get("provider"), a.get("external_id")) == \
            (b.get("provider"), b.get("external_id")):
        reasons.append("same_provider_id")
    na, nb = normalize_name(a.get("title")), normalize_name(b.get("title"))
    if na and na == nb:
        reasons.append("same_name")
    d = _distance_m(a, b)
    if d is not None and d <= DUPLICATE_DISTANCE_M:
        reasons.append("nearby")
    aa, ab = normalize_name(a.get("address")), normalize_name(b.get("address"))
    if aa and aa == ab:
        reasons.append("same_address")
    if a.get("source_url") and a.get("source_url") == b.get("source_url"):
        reasons.append("same_url")
    return reasons


def find_duplicates(items: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """id → [{id, title, reasons}]。統合済み・見送りの候補は比べない。
    「近い」だけ(名前も ID も住所も違う)は別の場所のことが多いため、重複としない。"""
    active = [i for i in items if i.get("status") != "dismissed" and not i.get("merged_into_id")]
    out: Dict[str, List[Dict[str, Any]]] = {}
    for i, a in enumerate(active):
        for b in active[i + 1:]:
            reasons = duplicate_reasons(a, b)
            if not reasons or reasons == ["nearby"]:
                continue
            out.setdefault(a["id"], []).append({"id": b["id"], "title": b["title"], "reasons": reasons})
            out.setdefault(b["id"], []).append({"id": a["id"], "title": a["title"], "reasons": reasons})
    return out


def clean_text(value: Optional[str], limit: int, label: str, required: bool = False) -> Optional[str]:
    v = (value or "").strip()
    if not v:
        if required:
            raise CandidateInputError("invalid_field", f"{label}を入力してください")
        return None
    if len(v) > limit:
        raise CandidateInputError("invalid_field", f"{label}は{limit}文字までです")
    if _CONTROL.sub("", v.replace("\n", "").replace("\t", "")) != v.replace("\n", "").replace("\t", ""):
        raise CandidateInputError("invalid_field", f"{label}に使えない文字が含まれています")
    return v


def check_location(lat: Any, lng: Any):
    if lat is None and lng is None:
        return None, None
    if lat is None or lng is None:
        raise CandidateInputError("invalid_field", "緯度と経度は両方を入れてください")
    try:
        la, lo = float(lat), float(lng)
    except (TypeError, ValueError):
        raise CandidateInputError("invalid_field", "緯度・経度は数値で入れてください")
    if not (-90 <= la <= 90 and -180 <= lo <= 180) or not (math.isfinite(la) and math.isfinite(lo)):
        raise CandidateInputError("invalid_field", "緯度・経度の範囲が正しくありません")
    return la, lo
