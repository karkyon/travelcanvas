"""[Gate P1] 持ち物の候補生成(FR-025 / FC-069 スマート持ち物)。

旅程(日数・予定の種類と題名・予約・移動手段)と、利用者が画面で指定する条件
(海外・洗濯できるか・子ども連れ・常備薬)から、理由付きの持ち物候補を作る。

- 規則ベースの決定的な判定で、algorithm_version を付けて返す(同じ入力なら同じ結果)。
- 天候は取得元(天気予報provider)が未接続のため判定しない。判定しなかったことを
  `unverified` に明記し、「天候を考慮済み」と誤解させない(FR-017と同じ方針)。
- 採用済みの候補(PackingItem.suggestion_key)は候補から外し、旅程の変更で
  採用理由が無くなった持ち物は `remove`、数量が変わった持ち物は `change` として返す
  (FR-025「旅程変更時に追加・不要候補を提示する」)。候補の提示だけで、持ち物は
  自動で変更しない(DOC-02 v5.1 共通不変条件4)。
- 子ども連れ・常備薬などの条件は保存しない(画面の入力を毎回受け取る)。
"""
import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence

from sqlalchemy.orm import Session

from app.models.models import Reservation, TravelDay, TravelEvent, TravelPlan, TravelSegment

ALGORITHM_VERSION = "packing-rules-v1"

_OUTDOOR_TYPES = {"sightseeing", "activity"}
_HIKING = re.compile(r"(ハイキング|登山|トレッキング|山歩き|hike|hiking|trek)", re.IGNORECASE)
_BATH = re.compile(r"(温泉|銭湯|スパ|サウナ|onsen|spa)", re.IGNORECASE)
_WATER = re.compile(r"(海水浴|ビーチ|プール|シュノーケル|ダイビング|beach|pool|snorkel)", re.IGNORECASE)


@dataclass(frozen=True)
class SuggestionContext:
    day_count: int
    nights: int
    event_types: Dict[str, int]
    event_titles: Sequence[str]
    reservation_types: Sequence[str]
    segment_modes: Sequence[str]
    overseas: bool
    laundry: bool
    with_children: bool
    takes_medication: bool

    def has_title(self, pattern: re.Pattern) -> bool:
        return any(pattern.search(t or "") for t in self.event_titles)

    @property
    def outdoor_events(self) -> int:
        return sum(self.event_types.get(t, 0) for t in _OUTDOOR_TYPES)

    @property
    def has_flight(self) -> bool:
        return "flight" in self.reservation_types or "flight" in self.segment_modes

    @property
    def has_rail(self) -> bool:
        return "train" in self.reservation_types


@dataclass(frozen=True)
class Rule:
    key: str
    name: str
    category: str
    scope: str  # shared / personal
    is_required: bool
    applies: Callable[[SuggestionContext], bool]
    reason: Callable[[SuggestionContext], str]
    quantity: Callable[[SuggestionContext], int] = lambda c: 1


def _clothes_qty(c: SuggestionContext) -> int:
    n = c.nights + 1
    return min(n, 3) if c.laundry else min(n, 14)


def _clothes_reason(c: SuggestionContext) -> str:
    base = f"{c.nights}泊の旅程のため"
    return f"{base}(洗濯できるため最大3日分)" if c.laundry else f"{base}(日数分)"


RULES: List[Rule] = [
    Rule("id_card", "身分証明書", "documents", "shared", True,
         lambda c: True, lambda c: "予約の受け取りや本人確認に必要です"),
    Rule("wallet", "財布・現金・カード", "money", "shared", True,
         lambda c: True, lambda c: "支払いに必要です"),
    Rule("phone_charger", "スマートフォンの充電器", "electronics", "shared", True,
         lambda c: True, lambda c: "地図・チケット・連絡に使う端末の充電に必要です"),
    Rule("mobile_battery", "モバイルバッテリー", "electronics", "shared", False,
         lambda c: c.outdoor_events >= 1,
         lambda c: f"観光・アクティビティの予定が{c.outdoor_events}件あり、外出中の充電に備えるため"),
    Rule("underwear", "下着", "clothing", "shared", True,
         lambda c: c.nights >= 1, _clothes_reason, _clothes_qty),
    Rule("socks", "靴下", "clothing", "shared", False,
         lambda c: c.nights >= 1, _clothes_reason, _clothes_qty),
    Rule("tops", "着替え(上衣)", "clothing", "shared", False,
         lambda c: c.nights >= 1, _clothes_reason, _clothes_qty),
    Rule("sleepwear", "寝間着", "clothing", "shared", False,
         lambda c: c.nights >= 1, lambda c: f"{c.nights}泊の宿泊があるため"),
    Rule("toiletries", "洗面用具(歯ブラシ等)", "toiletries", "shared", True,
         lambda c: c.nights >= 1, lambda c: f"{c.nights}泊の宿泊があるため"),
    Rule("laundry_bag", "洗濯物を入れる袋", "gear", "shared", False,
         lambda c: c.nights >= 2, lambda c: f"{c.nights}泊と滞在が長いため"),
    Rule("walking_shoes", "歩きやすい靴", "clothing", "shared", False,
         lambda c: c.outdoor_events >= 2 or c.has_title(_HIKING),
         lambda c: "山歩きの予定があるため" if c.has_title(_HIKING)
         else f"観光・アクティビティの予定が{c.outdoor_events}件あるため"),
    Rule("rain_gear", "雨具(折りたたみ傘・レインウェア)", "gear", "shared", False,
         lambda c: c.has_title(_HIKING), lambda c: "山歩きの予定があり、天候の急変に備えるため"),
    Rule("bath_towel", "タオル", "toiletries", "shared", False,
         lambda c: c.has_title(_BATH), lambda c: "温泉・入浴施設の予定があるため"),
    Rule("swimwear", "水着", "clothing", "shared", False,
         lambda c: c.has_title(_WATER), lambda c: "海・プールの予定があるため"),
    Rule("boarding_pass", "搭乗券・eチケット", "documents", "shared", True,
         lambda c: c.has_flight, lambda c: "航空機での移動があるため"),
    Rule("rail_ticket", "乗車券・指定席券", "documents", "shared", True,
         lambda c: c.has_rail, lambda c: "鉄道の予約があるため"),
    Rule("hotel_confirmation", "宿泊予約の確認書", "documents", "shared", False,
         lambda c: "accommodation" in c.reservation_types, lambda c: "宿泊の予約があるため"),
    Rule("passport", "パスポート", "documents", "personal", True,
         lambda c: c.overseas, lambda c: "海外旅行のため"),
    Rule("power_adapter", "変換プラグ", "electronics", "shared", False,
         lambda c: c.overseas, lambda c: "海外旅行のため(電源の形状が異なる場合があります)"),
    Rule("travel_insurance", "海外旅行保険の証券", "documents", "personal", False,
         lambda c: c.overseas, lambda c: "海外旅行のため"),
    Rule("medication", "常備薬", "health", "personal", True,
         lambda c: c.takes_medication, lambda c: "常備薬があると指定されたため(医療上の判断は行いません)"),
    Rule("kids_spare_clothes", "子どもの着替え", "clothing", "shared", True,
         lambda c: c.with_children, lambda c: "子ども連れのため(汚れや体調変化に備える)"),
    Rule("kids_snacks", "子ども用のおやつ・飲み物", "other", "shared", False,
         lambda c: c.with_children, lambda c: "子ども連れのため"),
]

RULE_BY_KEY = {r.key: r for r in RULES}

UNVERIFIED_NOTES = [
    {
        "code": "weather_unavailable",
        "message": "天気予報の取得元が未接続のため、天候に応じた持ち物(雨具・防寒具など)は判定していません。",
    },
]


def load_context(db: Session, plan: TravelPlan, *, overseas: bool, laundry: bool, with_children: bool,
                 takes_medication: bool) -> SuggestionContext:
    day_count = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).count()
    if day_count == 0 and plan.start_date and plan.end_date:
        day_count = max((plan.end_date.date() - plan.start_date.date()).days + 1, 1)
    events = db.query(TravelEvent.event_type, TravelEvent.title).filter(TravelEvent.plan_id == plan.id).all()
    types: Dict[str, int] = {}
    for t, _title in events:
        types[t or "other"] = types.get(t or "other", 0) + 1
    reservations = (
        db.query(Reservation.type)
        .filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None), Reservation.status != "cancelled")
        .all()
    )
    modes = db.query(TravelSegment.mode).filter(TravelSegment.plan_id == plan.id).all()
    return SuggestionContext(
        day_count=day_count,
        nights=max(day_count - 1, 0),
        event_types=types,
        event_titles=[title for _t, title in events],
        reservation_types=sorted({r[0] for r in reservations}),
        segment_modes=sorted({m[0] for m in modes}),
        overseas=overseas,
        laundry=laundry,
        with_children=with_children,
        takes_medication=takes_medication,
    )


def applicable(ctx: SuggestionContext) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for r in RULES:
        if r.applies(ctx):
            out[r.key] = {
                "key": r.key,
                "name": r.name,
                "category": r.category,
                "scope": r.scope,
                "is_required": r.is_required,
                "quantity": r.quantity(ctx),
                "reason": r.reason(ctx),
            }
    return out


def build_suggestions(ctx: SuggestionContext, adopted: Sequence[dict]) -> dict:
    """adopted: 閲覧者に見える採用済みの持ち物 [{"id", "suggestion_key", "name", "quantity", "status"}]。"""
    current = applicable(ctx)
    adopted_keys = {a["suggestion_key"] for a in adopted if a.get("suggestion_key")}
    add = [s for k, s in current.items() if k not in adopted_keys]
    remove: List[dict] = []
    change: List[dict] = []
    for a in adopted:
        key = a.get("suggestion_key")
        if not key:
            continue
        if key not in current:
            rule = RULE_BY_KEY.get(key)
            remove.append({
                "item_id": a["id"],
                "suggestion_key": key,
                "name": a.get("name"),
                "reason": "旅程や条件の変更で、この持ち物を候補にした理由が無くなりました"
                          + ("" if rule is None else f"(以前の候補: {rule.name})"),
            })
        elif current[key]["quantity"] != a.get("quantity"):
            change.append({
                "item_id": a["id"],
                "suggestion_key": key,
                "name": a.get("name"),
                "current_quantity": a.get("quantity"),
                "suggested_quantity": current[key]["quantity"],
                "reason": current[key]["reason"],
            })
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "inputs": {
            "day_count": ctx.day_count,
            "nights": ctx.nights,
            "overseas": ctx.overseas,
            "laundry": ctx.laundry,
            "with_children": ctx.with_children,
            "takes_medication": ctx.takes_medication,
            "outdoor_events": ctx.outdoor_events,
            "reservation_types": list(ctx.reservation_types),
            "segment_modes": list(ctx.segment_modes),
        },
        "add": add,
        "remove": remove,
        "change": change,
        "unverified": UNVERIFIED_NOTES,
    }


def suggestion_for(key: str, ctx: SuggestionContext) -> Optional[dict]:
    return applicable(ctx).get(key)
