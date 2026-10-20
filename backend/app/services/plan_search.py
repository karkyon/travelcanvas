"""[Gate C3] FR-009 情報内検索・コマンドパレットの純粋関数(DB非依存。DOC-02 FR-009、DOC-04 SC-10・§12)。

- 照合: 全角半角・大文字小文字を揃え、空白で区切った語が全て含まれるものを当てる(AND)。名前の完全一致 > 前方一致 > 部分一致。
- 日付の語: 今日・明日・明後日・昨日、M/D、YYYY-MM-DD、M月D日 → その日の日程と予定を当てる。
- 予約番号の末尾: 4文字の英数字は「予約」に絞った時だけ、末尾の索引(HMAC)で照合する(SC-10・§12.1「秘密検索は明示カテゴリと
  権限が必要」)。結果は伏せた番号だけ(****1234)で、一致した箇所を強調しない(§12.2「予約に一致」)。
"""
import re
import unicodedata
from datetime import date, timedelta
from typing import Iterable, List, Optional

CATEGORIES = ("day", "event", "place", "candidate", "reservation", "ticket", "document", "expense", "member", "memory")
CATEGORY_LABEL = {
    "day": "日程", "event": "予定", "place": "場所", "candidate": "候補", "reservation": "予約", "ticket": "チケット",
    "document": "文書", "expense": "費用", "member": "メンバー", "memory": "記録",
}
FILTERS = ("today", "reservation", "ticket", "hotel", "emergency")
FILTER_LABEL = {"today": "今日", "reservation": "予約", "ticket": "チケット", "hotel": "ホテル", "emergency": "緊急"}
FILTER_CATEGORIES = {
    "today": ("day", "event"), "reservation": ("reservation",), "ticket": ("ticket",),
    "hotel": ("event", "reservation", "place"), "emergency": ("document", "place", "event"),
}
EMERGENCY_WORDS = ("insurance", "保険", "emergency", "緊急", "passport", "旅券", "パスポート", "visa", "ビザ", "病院",
                   "hospital", "police", "警察", "大使館", "embassy")
HOTEL_EVENT_TYPES = ("accommodation",)
HOTEL_RESERVATION_TYPES = ("accommodation",)
MAX_QUERY = 100
PER_CATEGORY = 10
_SUFFIX = re.compile(r"^[A-Za-z0-9]{4}$")


def norm(text: Optional[str]) -> str:
    return unicodedata.normalize("NFKC", text or "").lower()


def tokens(query: str) -> List[str]:
    return [t for t in norm(query).split() if t]


def score(query_tokens: List[str], title: Optional[str], others: Iterable[Optional[str]] = ()) -> int:
    """0 = 当たらない。大きいほど上に出す。"""
    if not query_tokens:
        return 0
    t = norm(title)
    hay = " ".join([t] + [norm(o) for o in others if o])
    if not all(tok in hay for tok in query_tokens):
        return 0
    q = " ".join(query_tokens)
    if t == q:
        return 100
    if t.startswith(query_tokens[0]):
        return 80
    if all(tok in t for tok in query_tokens):
        return 60
    return 40


def parse_date_word(query: str, today: date, years: Iterable[int] = ()) -> Optional[date]:
    q = norm(query).strip()
    words = {"今日": 0, "きょう": 0, "today": 0, "明日": 1, "あした": 1, "tomorrow": 1, "明後日": 2, "あさって": 2,
             "昨日": -1, "きのう": -1, "yesterday": -1}
    if q in words:
        return today + timedelta(days=words[q])
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", q)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
    m = re.fullmatch(r"(\d{1,2})[/月](\d{1,2})日?", q)
    if m:
        candidates_years = sorted(set(years)) or [today.year]
        for y in candidates_years:
            try:
                return date(y, int(m[1]), int(m[2]))
            except ValueError:
                continue
    return None


def is_suffix_query(query: str) -> bool:
    return bool(_SUFFIX.match(query.strip()))


def emergency_text(*texts: Optional[str]) -> bool:
    hay = " ".join(norm(t) for t in texts if t)
    return any(w in hay for w in EMERGENCY_WORDS)
