"""[Gate P2] 予算・費用(FR-027)・立替・精算(FR-028)の計算(DB非依存の純粋関数)。

- 金額は Decimal で扱い、通貨ごとの最小単位(JPY=1円、USD=0.01ドル等)の整数に直して計算する。
  浮動小数点は使わない(NFR-006)。
- 分担: 均等(equal)・比率(ratio)・金額指定(amount)・負担なし=支払者のみ(none)。
  分担の合計は必ず支出額と一致させ、最小単位未満の端数を配った行には rounding_adjustment を記録する
  (DOC-05 §8.6「丸め差は明示的な調整行で処理」)。端数は「割当で切り捨てられた量の大きい順、同じなら入力順」に配る。
- 換算: 利用者が入力したレート(1 外貨 = rate 基準通貨)で基準通貨の最小単位へ四捨五入する。
  レートの無い外貨の支出は換算せず、集計・精算から除外して件数で示す(EX-013)。
- 精算: 各メンバーの差額(受け取るべき額が正)から、送金回数の少ない組み合わせ(大きい債務者→大きい債権者の順)を作る。
"""
from dataclasses import dataclass
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Dict, Hashable, List, Optional, Sequence, Tuple

ALGORITHM_VERSION = "finance-v1"

# ISO 4217 の小数桁が0の主な通貨。3桁の通貨(KWD等)は金額列(小数2桁)で表せないため扱わない。
ZERO_DECIMAL = {
    "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
}
THREE_DECIMAL = {"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"}


class FinanceError(ValueError):
    """入力が計算規則に合わない(APIは422で返す)。"""


def minor_digits(currency: str) -> int:
    if currency in THREE_DECIMAL:
        raise FinanceError(f"{currency}(小数3桁の通貨)には対応していません")
    return 0 if currency in ZERO_DECIMAL else 2


def to_minor(amount: Decimal, currency: str) -> int:
    digits = minor_digits(currency)
    scaled = amount * (Decimal(10) ** digits)
    if scaled != scaled.to_integral_value():
        raise FinanceError(f"{currency}の金額は小数{digits}桁までで入力してください")
    return int(scaled)


def from_minor(value: int, currency: str) -> Decimal:
    digits = minor_digits(currency)
    return (Decimal(value) / (Decimal(10) ** digits)).quantize(Decimal(1).scaleb(-digits))


def fmt(amount: Optional[Decimal], currency: str) -> Optional[str]:
    if amount is None:
        return None
    digits = minor_digits(currency)
    return str(Decimal(amount).quantize(Decimal(1).scaleb(-digits)))


def convert(amount: Decimal, rate: Decimal, base_currency: str) -> Decimal:
    digits = minor_digits(base_currency)
    return (amount * rate).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Participant:
    user_id: Hashable
    weight: Optional[Decimal] = None
    amount: Optional[Decimal] = None


@dataclass(frozen=True)
class ShareResult:
    user_id: Hashable
    share_minor: int
    adjustment_minor: int
    weight: Optional[Decimal]


def _allocate(total_minor: int, weights: Sequence[Decimal]) -> List[Tuple[int, int]]:
    """total_minor を weights の比で整数に配る。(配った額, 端数として上乗せした最小単位数) のリスト。"""
    wsum = sum(weights)
    if wsum <= 0:
        raise FinanceError("分担の比率の合計が0です")
    raw = [Decimal(total_minor) * w / wsum for w in weights]
    floors = [int(r.to_integral_value(rounding=ROUND_DOWN)) for r in raw]
    remainder = total_minor - sum(floors)
    order = sorted(range(len(weights)), key=lambda i: (-(raw[i] - floors[i]), i))
    extra = [0] * len(weights)
    for i in order[:remainder]:
        extra[i] = 1
    return [(floors[i] + extra[i], extra[i]) for i in range(len(weights))]


def split(amount: Decimal, currency: str, method: str, participants: Sequence[Participant],
          payer: Hashable) -> List[ShareResult]:
    total = to_minor(amount, currency)
    if method == "none":
        return [ShareResult(payer, total, 0, None)]
    if not participants:
        raise FinanceError("負担者を1人以上指定してください")
    ids = [p.user_id for p in participants]
    if len(set(ids)) != len(ids):
        raise FinanceError("同じ負担者が重複しています")
    if method == "equal":
        alloc = _allocate(total, [Decimal(1)] * len(participants))
        return [ShareResult(p.user_id, a, e, None) for p, (a, e) in zip(participants, alloc)]
    if method == "ratio":
        weights = []
        for p in participants:
            if p.weight is None or p.weight <= 0:
                raise FinanceError("比率で分ける場合は、全員に0より大きい比率を指定してください")
            weights.append(p.weight)
        alloc = _allocate(total, weights)
        return [ShareResult(p.user_id, a, e, p.weight) for p, (a, e) in zip(participants, alloc)]
    if method == "amount":
        shares = []
        for p in participants:
            if p.amount is None or p.amount < 0:
                raise FinanceError("金額で分ける場合は、全員に0以上の金額を指定してください")
            shares.append(to_minor(p.amount, currency))
        if sum(shares) != total:
            raise FinanceError(
                f"負担額の合計({from_minor(sum(shares), currency)})が支出額({from_minor(total, currency)})と一致しません"
            )
        return [ShareResult(p.user_id, s, 0, None) for p, s in zip(participants, shares)]
    raise FinanceError(f"不明な分担方法です: {method}")


def split_base(base_amount: Decimal, base_currency: str, shares: Sequence[ShareResult]) -> List[int]:
    """支出通貨での分担額の比で、基準通貨の額を配る(合計は base_amount と一致)。"""
    total = to_minor(base_amount, base_currency)
    weights = [Decimal(s.share_minor) for s in shares]
    if sum(weights) == 0:
        weights = [Decimal(1)] * len(shares)
    return [a for a, _e in _allocate(total, weights)]


@dataclass
class ExpenseView:
    """集計用の支出(基準通貨・最小単位)。refundは符号を反転して扱う。"""
    kind: str
    category: str
    local_date: Optional[str]
    paid_by: Hashable
    base_minor: Optional[int]
    tax_minor: int
    fee_minor: int
    shares: Dict[Hashable, int]  # 基準通貨の負担額(最小単位)


@dataclass
class SettlementView:
    from_user: Hashable
    to_user: Hashable
    amount_minor: int


def balances(expenses: Sequence[ExpenseView], settlements: Sequence[SettlementView]) -> Dict[Hashable, Dict[str, int]]:
    """メンバーごとの paid / owed / settled_out / settled_in / net(受け取るべき額が正)。"""
    out: Dict[Hashable, Dict[str, int]] = {}

    def row(uid):
        return out.setdefault(uid, {"paid": 0, "owed": 0, "settled_out": 0, "settled_in": 0, "net": 0})

    for e in expenses:
        if e.base_minor is None:
            continue
        sign = -1 if e.kind == "refund" else 1
        row(e.paid_by)["paid"] += sign * e.base_minor
        for uid, share in e.shares.items():
            row(uid)["owed"] += sign * share
    for s in settlements:
        row(s.from_user)["settled_out"] += s.amount_minor
        row(s.to_user)["settled_in"] += s.amount_minor
    for r in out.values():
        r["net"] = r["paid"] - r["owed"] + r["settled_out"] - r["settled_in"]
    return out


def suggest_transfers(nets: Dict[Hashable, int]) -> List[Tuple[Hashable, Hashable, int]]:
    """(支払う人, 受け取る人, 額)。大きい債務者から大きい債権者へ順に相殺する(送金回数を少なくする)。"""
    debtors = sorted(((-n, uid) for uid, n in nets.items() if n < 0), key=lambda x: (-x[0], str(x[1])))
    creditors = sorted(((n, uid) for uid, n in nets.items() if n > 0), key=lambda x: (-x[0], str(x[1])))
    debtors = [[a, u] for a, u in debtors]
    creditors = [[a, u] for a, u in creditors]
    transfers = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        pay = min(debtors[i][0], creditors[j][0])
        transfers.append((debtors[i][1], creditors[j][1], pay))
        debtors[i][0] -= pay
        creditors[j][0] -= pay
        if debtors[i][0] == 0:
            i += 1
        if creditors[j][0] == 0:
            j += 1
    return transfers


def actual_by(expenses: Sequence[ExpenseView], key: str) -> Dict[Optional[str], int]:
    out: Dict[Optional[str], int] = {}
    for e in expenses:
        if e.base_minor is None:
            continue
        k = getattr(e, key)
        out[k] = out.get(k, 0) + (-e.base_minor if e.kind == "refund" else e.base_minor)
    return out
