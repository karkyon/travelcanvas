"""[Gate FR059-Tiers] 会員の機能クラス Free / Trip / Journey / Explorer(機械が読む policy)。

正本: docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §3.2〜§3.5(policy ``2026-10-31.1``)。

- 4つのクラスは「外部の有料 API・AI をどこまで使えるか」の段階。旅行の日数(日帰り・長期)の種類ではない
- 旅行の中の権限(owner/editor/viewer/guest)、認証のゲスト、Family/Group の共同利用、Pro/B2B の契約、Trip Pass とは別の Entitlement
- 価格・販売・決済(FR-058)は持たない。付与は管理者の二者の承認(または開発環境の試験の切り替え)だけ
- どのクラスでも 1旅行の有料の原価は 50円まで(FR-059 の hard cap)。回数の上限はクラスごとの価格の版(usage_policy_profiles)に置き、
  ここは「その操作をクラスに含めるか」を決める(含まない操作は provider の前で 403 ``tier_feature_not_included``)
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

TIER_POLICY_VERSION = "2026-10-31.1"
TIERS: Tuple[str, ...] = ("free", "trip", "journey", "explorer")
TIER_LABEL = {"free": "Free", "trip": "Trip", "journey": "Journey", "explorer": "Explorer"}
TIER_SUBTITLE = {"free": "自分でつくる", "trip": "行先を見つける", "journey": "計画を一緒に考える",
                 "explorer": "比較して深掘りする"}
TIER_SUMMARY = {
    "free": "手入力・保存・無料の地図と検索で、日帰りから長期の旅行までまとめる。外部の AI・有料の検索は使わない",
    "trip": "少ない回数の場所の検索・詳細・写真と経路の確認。AI は使わない",
    "journey": "制限つきの AI で条件の整理・旅程の案・限られた見直し。場所と経路は限られた回数",
    "explorer": "4つの中で最も多い検索と AI の枠で、複数の候補を比べて追加で調べる。回数は無制限ではない",
}

_PLACES_ROUTES = ("places.search", "places.details", "places.photo", "routes.element", "map.load")
# クラスに含める有料の操作(cost_guard.OPERATIONS のキー)。含まない操作は送る前に断る
TIER_OPERATIONS: Dict[str, Tuple[str, ...]] = {
    "free": (),
    "trip": _PLACES_ROUTES,
    "journey": _PLACES_ROUTES + ("ai.generate",),
    "explorer": _PLACES_ROUTES + ("ai.generate", "ai.web_search"),
}

# クラスごとの回数の上限(価格の版 2026-10-31.1 の feature_quotas)。根拠と検算は FR-059 §3.3
_ZERO = {"ai_calls_per_plan": 0, "ai_input_tokens_per_call": 0, "ai_output_tokens_per_call": 0,
         "web_searches_per_plan": 0, "places_searches_per_plan": 0, "place_details_per_plan": 0, "photos_per_plan": 0,
         "route_elements_per_plan": 0, "dynamic_map_loads_per_plan": 0}
TIER_QUOTAS: Dict[str, Dict[str, int]] = {
    "free": dict(_ZERO),
    "trip": {**_ZERO, "places_searches_per_plan": 2, "place_details_per_plan": 1, "photos_per_plan": 1,
             "route_elements_per_plan": 4, "dynamic_map_loads_per_plan": 1},
    "journey": {**_ZERO, "ai_calls_per_plan": 3, "ai_input_tokens_per_call": 10000, "ai_output_tokens_per_call": 2000,
                "places_searches_per_plan": 2, "place_details_per_plan": 1, "photos_per_plan": 1,
                "route_elements_per_plan": 4, "dynamic_map_loads_per_plan": 1},
    "explorer": {"ai_calls_per_plan": 5, "ai_input_tokens_per_call": 10000, "ai_output_tokens_per_call": 2000,
                 "web_searches_per_plan": 2, "places_searches_per_plan": 3, "place_details_per_plan": 2,
                 "photos_per_plan": 2, "route_elements_per_plan": 4, "dynamic_map_loads_per_plan": 1},
}
# (1旅行の上限, 月の上限, 月の旅行の数)。Free は有料の操作を含まないため月の口座を持たない
TIER_CAPS: Dict[str, Tuple[str, Any, Any]] = {
    "free": ("50", None, None),
    "trip": ("50", "150", 5),
    "journey": ("50", "150", 5),
    "explorer": ("50", "250", 5),
}

# 機能の開放の表(画面・運用コンソールに出す)。enforcement: server = この版でサーバーが断る / existing = 既存の機能の
# 上限のまま(クラスでは変えない。クラス別の制限は未実装と表示する) / none = 予約・決済は未実装(FR-058)
FEATURE_MATRIX: List[Dict[str, Any]] = [
    {"key": "manual_planning", "label": "旅行の作成・編集・日程/メモ/予算の手入力",
     "free": "○", "trip": "○", "journey": "○", "explorer": "○", "enforcement": "existing",
     "note": "外部の API・AI が無くても基本の計画を完成できる"},
    {"key": "save_list_copy", "label": "旅行の保存・一覧・複製",
     "free": "△", "trip": "○", "journey": "○", "explorer": "○", "enforcement": "existing",
     "note": "Free の保存数の上限は未決定。今は既存の上限のまま(クラスで減らさない)"},
    {"key": "manual_places", "label": "手入力の場所の登録・並べ替え",
     "free": "○", "trip": "○", "journey": "○", "explorer": "○", "enforcement": "existing",
     "note": "原価 0円の手での経路をいつも残す"},
    {"key": "open_data_search", "label": "無料・オープンデータの検索(OpenStreetMap・Wikipedia など)",
     "free": "△", "trip": "△", "journey": "△", "explorer": "△", "enforcement": "existing",
     "note": "0円でも送った回数を記録する(FR-059 D11)。規約・帰属の表示・回数の制限を守る。有料へ自動で切り替えない"},
    {"key": "places_search", "label": "場所の検索・詳細・写真(Places 等の有料の検索)",
     "free": "—", "trip": "△", "journey": "△", "explorer": "△", "enforcement": "server",
     "operations": ["places.search", "places.details", "places.photo"],
     "note": "回数はクラスの枠まで。提供元の接続(adapter)までは送らない"},
    {"key": "routes", "label": "経路・所要時間(Routes 等)",
     "free": "—", "trip": "△", "journey": "△", "explorer": "△", "enforcement": "server",
     "operations": ["routes.element", "map.load"], "note": "未接続の間は「未照会」と表示し、手での距離の入力を残す"},
    {"key": "ai_planning", "label": "AI による条件の整理・行先の候補・旅程の案・見直し",
     "free": "—", "trip": "—", "journey": "△", "explorer": "△", "enforcement": "server",
     "operations": ["ai.generate"], "note": "明示の操作の時だけ。出典・取得の時刻・未確認を分け、再生成も原価に数える"},
    {"key": "ai_web_search", "label": "AI の追加の調査(Web 検索)",
     "free": "—", "trip": "—", "journey": "—", "explorer": "△", "enforcement": "server",
     "operations": ["ai.web_search"], "note": "Explorer だけ。1旅行 2回まで"},
    {"key": "sharing", "label": "家族の共有・共同編集・投票",
     "free": "△", "trip": "△", "journey": "△", "explorer": "△", "enforcement": "existing",
     "note": "共有の人数・編集の権限は旅行の中の権限(owner/editor/viewer)で決める。人数で API の枠を増やさない"},
    {"key": "offline_export", "label": "オフラインの参照・書き出し",
     "free": "△", "trip": "△", "journey": "○", "explorer": "○", "enforcement": "existing",
     "note": "今は既存の機能の上限のまま(クラス別の制限は未実装)"},
    {"key": "usage_meter", "label": "API の原価の利用枠の表示",
     "free": "○", "trip": "○", "journey": "○", "explorer": "○", "enforcement": "existing",
     "note": "旅行の予算(宿・交通・食事)とは別に表示する"},
    {"key": "booking_payment", "label": "予約・決済・会員の販売",
     "free": "—", "trip": "—", "journey": "—", "explorer": "—", "enforcement": "none",
     "note": "FR-058(価格・決済)は未決定。予約は手での確認・公式サイトへ"},
]

# 旧クラス・役割との関係(移行の表)。自動の昇格・降格はしない
LEGACY_MAPPING: List[Dict[str, str]] = [
    {"legacy": "Guest / Anonymous", "rule": "認証・一時利用の主体として維持。Free とは別(外部の AI・有料の検索は 0円)"},
    {"legacy": "Free(policy 2026-10-29.1: AI 5回)",
     "rule": "新しい Free(AI なし・有料の API なし)に置き換える。付与の無い会員は全員 Free。以前の版で予約・確定した記録は版のまま残す"},
    {"legacy": "Trip Pass", "rule": "旅行に割り当てる付与として維持(その旅行だけ以前の枠)。販売は FR-058 まで無効"},
    {"legacy": "Plus", "rule": "付与は残し、以前の枠のまま。Journey・Explorer へは一律に変えない(管理者が付与した時だけ新しいクラス)"},
    {"legacy": "Family / Group", "rule": "支払う人の枠として維持。人数で API の枠を増やさない。新しいクラスとは別"},
    {"legacy": "Pro / B2B", "rule": "契約の付与として維持。契約の枠が無い間は 0円(fail closed)。Explorer へ自動で変えない"},
    {"legacy": "Admin / Support", "rule": "権限の役割。管理者であることは有料の機能を使う根拠にしない"},
    {"legacy": "owner / editor / viewer / guest", "rule": "旅行の中のデータの権限。クラスと別に両方を確かめる"},
]


def operations_for(profile_key: str) -> Tuple[str, ...]:
    """クラスに含める有料の操作。4つのクラス以外(旧クラス)は None ではなく全ての操作(回数の上限で制限)。"""
    if profile_key in TIER_OPERATIONS:
        return TIER_OPERATIONS[profile_key]
    from app.services.cost_guard import OPERATIONS

    return tuple(OPERATIONS)


def is_tier(profile_key: str) -> bool:
    return profile_key in TIER_OPERATIONS


def tier_info(profile_key: str) -> Dict[str, Any]:
    """画面に出すクラスの説明(4つのクラス以外は tier=None)。"""
    if not is_tier(profile_key):
        return {"key": None, "label": None, "subtitle": None, "summary": None,
                "operations": list(operations_for(profile_key)), "ai": True, "paid_api": True}
    ops = TIER_OPERATIONS[profile_key]
    return {"key": profile_key, "label": TIER_LABEL[profile_key], "subtitle": TIER_SUBTITLE[profile_key],
            "summary": TIER_SUMMARY[profile_key], "operations": list(ops),
            "ai": any(op.startswith("ai.") for op in ops), "paid_api": bool(ops)}
