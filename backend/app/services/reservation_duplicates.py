"""[Gate② FC-042] 同じ旅行の中で「同じ予約かもしれない」予約の組を見つける。

DOC-02 FC-042「confirmation/provider/日時/名義で候補検出し自動削除しない」。
- 予約番号が同じ(平文は比べず、保存済みの blind index `confirmation_number_lookup_hash` の一致だけを見る)
- 予約先・利用日・種類が同じで、名義が同じか片方が空
の時に候補とする。**消したり統合したりはしない。** 画面に「同じ予約かもしれません」と出し、利用者が確かめて消す。
取り消し済みの予約は候補にしない(取り直しの予約と並ぶのは正常なため)。
"""
from __future__ import annotations

import unicodedata
from typing import Dict, Iterable, List, Optional, Tuple

REASON_CONFIRMATION = "same_confirmation_number"
REASON_PROVIDER_DATE = "same_provider_and_date"


def _norm(value: Optional[str]) -> str:
    return "".join(unicodedata.normalize("NFKC", value or "").lower().split())


def _day(r) -> Optional[str]:
    return r.start_at.date().isoformat() if getattr(r, "start_at", None) is not None else None


def find_duplicates(rows: Iterable, holder_of=lambda r: None) -> Dict[str, List[Tuple[str, str]]]:
    """予約の id → [(相手の id, 理由)]。理由は REASON_* 。同じ相手は理由が強い方(予約番号)だけを返す。"""
    live = [r for r in rows if getattr(r, "deleted_at", None) is None and r.status != "cancelled"]
    out: Dict[str, Dict[str, str]] = {}

    def add(a, b, reason: str) -> None:
        for x, y in ((a, b), (b, a)):
            seen = out.setdefault(str(x.id), {})
            if seen.get(str(y.id)) != REASON_CONFIRMATION:
                seen[str(y.id)] = reason

    by_conf: Dict[str, list] = {}
    for r in live:
        if r.confirmation_number_lookup_hash:
            by_conf.setdefault(r.confirmation_number_lookup_hash, []).append(r)
    for group in by_conf.values():
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                add(a, b, REASON_CONFIRMATION)

    by_key: Dict[Tuple[str, str, str], list] = {}
    for r in live:
        provider, day = _norm(r.provider_name), _day(r)
        if provider and day:
            by_key.setdefault((r.type, provider, day), []).append(r)
    for group in by_key.values():
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                ha, hb = _norm(holder_of(a)), _norm(holder_of(b))
                if ha and hb and ha != hb:
                    continue  # 名義がはっきり違う(同じ店に別々の予約)は候補にしない
                add(a, b, REASON_PROVIDER_DATE)

    return {rid: sorted(peers.items()) for rid, peers in out.items()}
