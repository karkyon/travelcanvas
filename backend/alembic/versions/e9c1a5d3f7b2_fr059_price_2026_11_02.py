"""fr059_price_2026_11_02

Revision ID: e9c1a5d3f7b2
Revises: c3e5a7b9d1f4
Create Date: 2026-11-02 12:00:00.000000

[Gate SearchUAT-S3 / FR059 F07-4] 4つのクラス(Free・Trip・Journey・Explorer)の価格の版 ``2026-11-02.1``。

単価の是正(公式の価格の表・2026-11-02 に確認。根拠は版の provider_price_snapshot.sources と各操作の basis):
- 場所の検索(Text Search): 送る field mask(id・displayName・formattedAddress・location・googleMapsUri)は
  Text Search **Pro** の範囲。以前の版は Enterprise($0.035/要求)で計上していた → Pro $0.032/要求
- AI(gpt-5-nano): 以前の版は入力 $0.10・出力 $0.50(100万 token)→ 公式の 入力 $0.05・出力 $0.40
- 為替 180・税 1.10・安全係数 1.15 は以前の版のまま(内部の利用枠の保守的な見込み。請求額ではない)

回数(F07-4): Journey・Explorer の AI は 1旅行 10回(以前は 3回・5回)。Journey の場所の検索は 3回(以前は 2回)。
受入の場面 AI 10回 + 場所の検索 3回 + 経路 4区間 が、無料枠・割引に頼らない見込みで 1旅行 50円の中に入る。

- 表・列は変えない。以前の版(2026-10-31.1 の 4つのクラス)は retired にする(行は残す。予約・確定は版で引く)
- 旧クラス(Plus・Family・Trip Pass・Pro・Guest。2026-10-29.1)は変えない(新しく付与しない移行用のクラス)
- downgrade は 2026-11-02.1 の行を消し、2026-10-31.1 の 4つのクラスを active に戻す。2026-11-02.1 で予約・確定した
  記録が残っている時は、その版で精算できなくなるため downgrade を断る(記録を消さない)
"""
import json
import uuid
from decimal import ROUND_CEILING, Decimal
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e9c1a5d3f7b2'
down_revision: Union[str, Sequence[str], None] = 'c3e5a7b9d1f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_VERSION = "2026-11-02.1"
OLD_VERSION = "2026-10-31.1"
TIERS = ("free", "trip", "journey", "explorer")

# provider_calls.PLACES_FIELD_MASK と同じ(migration はアプリのコードを import しない。試験で一致を確かめる)
PLACES_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri"

PRICE_SNAPSHOT = {
    "currency": "USD",
    "checked_at": "2026-11-02",
    "sources": {
        "google_maps_pricing": "https://developers.google.com/maps/billing-and-pricing/pricing",
        "google_text_search_fields": "https://developers.google.com/maps/documentation/places/web-service/text-search",
        "openai_gpt_5_nano": "https://developers.openai.com/api/docs/models/gpt-5-nano",
    },
    "operations": {
        "ai.generate": {"provider_kind": "ai", "sku": "openai-gpt-5-nano", "model": "gpt-5-nano",
                        "unit_prices": {"input_tokens": "0.00000005", "output_tokens": "0.0000004"},
                        "basis": "gpt-5-nano 入力 $0.05・出力 $0.40 / 100万 token(推論の token は出力に含めて数える)"},
        "ai.web_search": {"provider_kind": "ai", "sku": "openai-web-search",
                          "unit_prices": {"requests": "0.01", "input_tokens": "0.00000005"},
                          "basis": "Web 検索 $10 / 1,000 回 + 検索の内容の入力 token(gpt-5-nano の入力の単価)"},
        "places.search": {"provider_kind": "places", "sku": "places-text-search-pro",
                          "field_mask": PLACES_FIELD_MASK, "unit_prices": {"requests": "0.032"},
                          "basis": "Text Search Pro $32 / 1,000 要求(0〜100,000)。月 5,000 要求の無料の使用の上限は"
                                   "請求の側で引かれ、この見込みでは引かない"},
        "places.details": {"provider_kind": "places", "sku": "places-details-enterprise",
                           "unit_prices": {"requests": "0.02"},
                           "basis": "Place Details Enterprise $20 / 1,000(adapter は未接続。最も高い範囲で見込む)"},
        "places.photo": {"provider_kind": "places", "sku": "places-details-photos",
                         "unit_prices": {"requests": "0.007"}, "basis": "Place Details Photos $7 / 1,000"},
        "routes.element": {"provider_kind": "routes", "sku": "routes-compute-routes-essentials",
                           "unit_prices": {"elements": "0.005"}, "basis": "Compute Routes Essentials $5 / 1,000"},
        "map.load": {"provider_kind": "maps", "sku": "dynamic-maps", "unit_prices": {"loads": "0.007"},
                     "basis": "Dynamic Maps $7 / 1,000"},
    },
}

# membership_tiers.TIER_QUOTAS(2026-11-02.1)と同じ値
ZERO = {"ai_calls_per_plan": 0, "ai_input_tokens_per_call": 0, "ai_output_tokens_per_call": 0,
        "web_searches_per_plan": 0, "places_searches_per_plan": 0, "place_details_per_plan": 0, "photos_per_plan": 0,
        "route_elements_per_plan": 0, "dynamic_map_loads_per_plan": 0}
TRIP = {**ZERO, "places_searches_per_plan": 2, "place_details_per_plan": 1, "photos_per_plan": 1,
        "route_elements_per_plan": 4, "dynamic_map_loads_per_plan": 1}
JOURNEY = {**TRIP, "ai_calls_per_plan": 10, "ai_input_tokens_per_call": 10000, "ai_output_tokens_per_call": 2000,
           "places_searches_per_plan": 3}
EXPLORER = {"ai_calls_per_plan": 10, "ai_input_tokens_per_call": 10000, "ai_output_tokens_per_call": 2000,
            "web_searches_per_plan": 2, "places_searches_per_plan": 3, "place_details_per_plan": 2, "photos_per_plan": 2,
            "route_elements_per_plan": 4, "dynamic_map_loads_per_plan": 1}
QUOTAS = {"free": ZERO, "trip": TRIP, "journey": JOURNEY, "explorer": EXPLORER}

profiles_table = sa.table(
    'usage_policy_profiles',
    sa.column('id', postgresql.UUID(as_uuid=True)), sa.column('profile_key', sa.String),
    sa.column('version', sa.String), sa.column('currency', sa.String), sa.column('plan_cap_jpy', sa.Numeric),
    sa.column('monthly_cap_jpy', sa.Numeric), sa.column('plans_per_month', sa.Integer),
    sa.column('feature_quotas', postgresql.JSONB), sa.column('fx_rate', sa.Numeric), sa.column('tax_factor', sa.Numeric),
    sa.column('safety_factor', sa.Numeric), sa.column('provider_price_snapshot', postgresql.JSONB),
    sa.column('status', sa.String),
)

_COUNT = {"ai.web_search": ("web_searches_per_plan", "requests"), "places.search": ("places_searches_per_plan", "requests"),
          "places.details": ("place_details_per_plan", "requests"), "places.photo": ("photos_per_plan", "requests"),
          "routes.element": ("route_elements_per_plan", "elements"), "map.load": ("dynamic_map_loads_per_plan", "loads")}


def _worst(quotas, factor: Decimal) -> Decimal:
    """全ての回数の上限を同時に使った額(cost_guard.worst_case_plan_cost と同じ計算)。50円を越える版は入れない。"""
    q4 = Decimal("0.0001")
    ops = PRICE_SNAPSHOT["operations"]
    total = Decimal(0)
    n_ai = int(quotas.get("ai_calls_per_plan", 0))
    if n_ai:
        p = ops["ai.generate"]["unit_prices"]
        usd = (Decimal(p["input_tokens"]) * quotas["ai_input_tokens_per_call"]
               + Decimal(p["output_tokens"]) * quotas["ai_output_tokens_per_call"])
        total += (usd * factor).quantize(q4, rounding=ROUND_CEILING) * n_ai
    for name, (key, unit) in _COUNT.items():
        n = int(quotas.get(key, 0))
        if n <= 0:
            continue
        p = ops[name]["unit_prices"]
        usd = Decimal(p[unit]) * n
        if name == "ai.web_search":
            usd += Decimal(p["input_tokens"]) * 8000 * n
        total += (usd * factor).quantize(q4, rounding=ROUND_CEILING)
    return total


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT profile_key, currency, plan_cap_jpy, monthly_cap_jpy, plans_per_month, fx_rate, tax_factor, "
        "safety_factor FROM usage_policy_profiles WHERE version = :v AND profile_key IN :keys"
    ).bindparams(sa.bindparam("keys", expanding=True)), {"v": OLD_VERSION, "keys": list(TIERS)}).fetchall()
    found = {r[0]: r for r in rows}
    missing = [k for k in TIERS if k not in found]
    if missing:
        raise RuntimeError("usage_policy_profiles に %s の %s がありません(a1d3f5b7c9e2 の後に流します)"
                           % (OLD_VERSION, ",".join(missing)))
    inserts = []
    for key in TIERS:
        _k, currency, plan_cap, monthly_cap, per_month, fx, tax, safety = found[key]
        factor = Decimal(fx) * Decimal(tax) * Decimal(safety)
        worst = _worst(QUOTAS[key], factor)
        if worst > Decimal(plan_cap):
            raise RuntimeError("%s の全ての回数の上限の額 %s 円が 1旅行の上限 %s 円を越えます" % (key, worst, plan_cap))
        inserts.append({"id": uuid.uuid4(), "profile_key": key, "version": NEW_VERSION, "currency": currency,
                        "plan_cap_jpy": plan_cap, "monthly_cap_jpy": monthly_cap, "plans_per_month": per_month,
                        "feature_quotas": json.loads(json.dumps(QUOTAS[key])), "fx_rate": fx, "tax_factor": tax,
                        "safety_factor": safety, "provider_price_snapshot": json.loads(json.dumps(PRICE_SNAPSHOT)),
                        "status": "active"})
    op.bulk_insert(profiles_table, inserts)
    bind.execute(sa.text("UPDATE usage_policy_profiles SET status = 'retired' "
                         "WHERE version = :v AND profile_key IN :keys")
                 .bindparams(sa.bindparam("keys", expanding=True)), {"v": OLD_VERSION, "keys": list(TIERS)})


def downgrade() -> None:
    bind = op.get_bind()
    used = bind.execute(sa.text(
        "SELECT (SELECT count(*) FROM provider_usage_reservations WHERE policy_version = :v) + "
        "(SELECT count(*) FROM provider_usage_events WHERE price_version = :v) + "
        "(SELECT count(*) FROM usage_budget_accounts WHERE policy_version = :v)"), {"v": NEW_VERSION}).scalar()
    if used:
        raise RuntimeError("価格の版 %s で予約・確定・口座を作った記録が %d 件あるため、downgrade しません"
                           "(その版で精算できなくなります。バックアップから戻す判断は Runbook)" % (NEW_VERSION, used))
    bind.execute(sa.text("DELETE FROM usage_policy_profiles WHERE version = :v"), {"v": NEW_VERSION})
    bind.execute(sa.text("UPDATE usage_policy_profiles SET status = 'active' "
                         "WHERE version = :v AND profile_key IN :keys")
                 .bindparams(sa.bindparam("keys", expanding=True)), {"v": OLD_VERSION, "keys": list(TIERS)})
