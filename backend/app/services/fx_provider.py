"""[Gate Remaining-2] FR-027 為替の自動取得(欧州中央銀行 ECB の参考値。Frankfurter 経由。鍵は要らない・無料)。

- 送るもの: 通貨の記号2つと日付だけ(旅行・利用者・金額は送らない)
- ECB の参考値は営業日の 16 時(中欧時間)ごと。土日・休日は直前の営業日の値になる(返す rate_date がその日)
- 対応は ECB の約 30 通貨だけ。対応外・失敗・無効(FX_AUTO_ENABLED=false)の時は Unavailable → 画面は出典つきの手入力
- 送り先は設定の FX_PROVIDER_URL だけ(利用者の入力で変えない)
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from typing import Any, Dict, Optional

from app.core.config import settings
from app.services import ext_http
from app.services.ext_http import Unavailable

NAME = "fx_ecb"
SOURCE_LABEL = "欧州中央銀行(ECB)の参考値・Frankfurter"
SUPPORTED = frozenset({
    "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK",
    "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
})
Q8 = Decimal("0.00000001")


def enabled() -> bool:
    return ext_http.allowed(NAME, "FX_AUTO_ENABLED")


def supported(currency: str) -> bool:
    return currency in SUPPORTED


def fetch(currency: str, base: str, on: Optional[date] = None) -> Dict[str, Any]:
    """1 currency あたりの base の額。{rate: Decimal, rate_date: date, source: str}。取れない時は Unavailable"""
    if not enabled():
        raise Unavailable("disabled")
    if currency == base:
        raise Unavailable("same_currency")
    if not (supported(currency) and supported(base)):
        raise Unavailable("unsupported_currency")
    root = (getattr(settings, "FX_PROVIDER_URL", "") or "https://api.frankfurter.dev/v1").rstrip("/")
    path = on.isoformat() if on else "latest"
    ttl = int(getattr(settings, "FX_CACHE_SECONDS", 3600) or 3600)

    def call() -> Dict[str, Any]:
        body = ext_http.get_json(NAME, f"{root}/{path}", params={"base": currency, "symbols": base})
        try:
            value = Decimal(str((body.get("rates") or {})[base]))
            day = date.fromisoformat(str(body["date"]))
        except (KeyError, TypeError, ValueError, InvalidOperation, AttributeError):
            raise Unavailable("bad_response")
        if not value.is_finite() or value <= 0:
            raise Unavailable("bad_response")
        rate = value.quantize(Q8, rounding=ROUND_HALF_EVEN)
        if rate <= 0:
            raise Unavailable("bad_response")
        return {"rate": rate, "rate_date": day, "source": SOURCE_LABEL}

    return ext_http.cached(NAME, f"{currency}:{base}:{path}", ttl, call)
