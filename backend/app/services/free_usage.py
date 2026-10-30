"""[Gate FR059-D11] 無料の provider の使用の記録(FR-059 正本 §2.3・§13 D11)。

無料の provider(OpenStreetMap の Nominatim・Overpass、Wikipedia、Wikimedia Commons、SNS の oEmbed)も、外へ送った回数を
``provider_usage_events`` に額 0円・価格の版 ``free`` で残す。将来、有料の provider へ切り替えた時に記録と制御が抜けないため。

- 記録するのは送った回数・結果の分類・利用者・クラス・(分かる時は)旅行だけ。検索の言葉・URL・座標・結果は残さない
- 記録に失敗しても機能は止めない(無料の provider の利用規約・回数の制限は各 provider の側で守る)
- 50円の枠の計算には入れない(額 0円)。無料の終わりに自動で有料へ切り替えない
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import ProviderUsageEvent, User

logger = logging.getLogger(__name__)

FREE_PROVIDERS = frozenset({"nominatim", "overpass", "wikipedia", "wikimedia_commons", "oembed"})
FREE_PRICE_VERSION = "free"
RESULT_CODES = frozenset({"ok", "empty", "unavailable", "error"})


def record(db: Session, user: Optional[User], provider: str, operation: str, *, request_count: int = 1,
           result_code: str = "ok", plan_id: Optional[uuid.UUID] = None) -> None:
    """1つの外への呼び出し(または回数)を記録する。呼び手の transaction に足す(commit は呼び手)。"""
    if request_count <= 0:
        return
    if provider not in FREE_PROVIDERS:
        raise ValueError("free_usage は無料の provider だけ: %s" % provider)
    if result_code not in RESULT_CODES:
        result_code = "error"
    try:
        from app.services import cost_guard as cg

        klass, _source = cg.user_class(db, user)
        with db.begin_nested():  # 失敗しても呼び手の transaction を壊さない
            db.add(ProviderUsageEvent(
                id=uuid.uuid4(), user_id=getattr(user, "id", None), plan_id=plan_id, class_snapshot=klass[:16],
                provider=provider, operation=operation[:32], request_count=int(request_count),
                estimated_cost_jpy=Decimal("0"), actual_cost_jpy=Decimal("0"), raw_cost=Decimal("0"),
                raw_currency="USD", price_version=FREE_PRICE_VERSION, result_code=result_code,
            ))
    except Exception as exc:  # noqa: BLE001 - 記録の失敗で無料の機能を止めない
        logger.warning("free provider usage not recorded (%s/%s): %s", provider, operation, type(exc).__name__)
