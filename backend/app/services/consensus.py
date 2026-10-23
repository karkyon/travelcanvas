"""[Gate P3] 合意形成(FR-022)の集計(DB非依存の純粋関数)。

選択肢ごとの状態:
- blocked: 不可(veto)が未解決のまま残っている(veto_policy が advisory 以外の時)
- pending: 未回答のメンバーがいる(締切前)
- has_concerns: 懸念または(advisory の時の)不可が未解決で残っている
- agreed: 全員が回答し、未解決の懸念・不可が無い(締切後は未回答者がいても回答者の中で判定する)

点数(並べ替えと「最有力」の判定用): Love=2、OK=1、懸念=-1、advisory の不可=-2、棄権=0。
不成立(blocked)の選択肢は最有力にしない。

匿名の投票(FC-067 秘匿回答): 回答者が ANONYMITY_THRESHOLD 人未満の間は件数も出さない
(少人数だと件数から個人の回答が推測できるため)。誰が未回答かは表示する(参加の有無は回答内容ではない)。
"""
from dataclasses import dataclass
from typing import Dict, Hashable, List, Optional, Sequence, Set

ALGORITHM_VERSION = "consensus-v1"
ANONYMITY_THRESHOLD = 3
VALUES = ("love", "ok", "concern", "veto", "abstain")
SCORE = {"love": 2, "ok": 1, "concern": -1, "abstain": 0}


@dataclass(frozen=True)
class VoteView:
    user_id: Hashable
    value: str
    resolved: bool


def option_state(votes: Sequence[VoteView], members: Set[Hashable], veto_policy: str, is_closed: bool) -> dict:
    counts = {v: 0 for v in VALUES}
    for v in votes:
        counts[v.value] += 1
    responders = {v.user_id for v in votes}
    unanswered = members - responders
    unresolved_veto = sum(1 for v in votes if v.value == "veto" and not v.resolved)
    unresolved_concern = sum(1 for v in votes if v.value == "concern" and not v.resolved)
    advisory = veto_policy == "advisory"
    score = sum(SCORE.get(v.value, 0) for v in votes) + (-2 * counts["veto"] if advisory else 0)
    if unresolved_veto and not advisory:
        state = "blocked"
    elif unanswered and not is_closed:
        state = "pending"
    elif unresolved_concern or (advisory and unresolved_veto):
        state = "has_concerns"
    elif not responders:
        state = "pending"
    else:
        state = "agreed"
    return {
        "state": state,
        "counts": counts,
        "score": score,
        "responders": responders,
        "unanswered": unanswered,
        "unresolved_concerns": unresolved_concern + (unresolved_veto if advisory else 0),
        "unresolved_vetoes": unresolved_veto,
    }


def leading_option(states: Dict[Hashable, dict], order: List[Hashable]) -> Optional[Hashable]:
    candidates = [oid for oid in order if states[oid]["state"] != "blocked" and states[oid]["responders"]]
    if not candidates:
        return None
    best = max(states[oid]["score"] for oid in candidates)
    return next(oid for oid in candidates if states[oid]["score"] == best)


def poll_state(states: Dict[Hashable, dict], is_closed: bool, decided: Optional[Hashable]) -> str:
    if decided is not None:
        return "decided"
    if any(s["state"] == "agreed" for s in states.values()):
        return "agreed"
    if not is_closed and any(s["state"] == "pending" for s in states.values()):
        return "voting"
    if all(s["state"] == "blocked" for s in states.values()):
        return "blocked"
    return "needs_discussion"


# ===== [Gate G4] COL-02 決定の状態遷移(締切・定足数・同票・採用)
#
#   voting(回答中)─締切(手で/期限)→ closed ─決定→ decided ─採用(予定に反映。変更セット)→ adopted
#        ↑ 再開(採用前だけ)            │ 定足数に届かない → no_quorum(決定できない。再開して回答を集める)
#   決定を変える・再開する・回答を変えるのは採用の前だけ(採用後は「採用を元に戻す」が先)

def tied_leaders(states: Dict[Hashable, dict], order: List[Hashable]) -> List[Hashable]:
    """最有力が同点で2つ以上ある時、その選択肢(不成立・回答なしは除く)。1つだけなら空。"""
    candidates = [oid for oid in order if states[oid]["state"] != "blocked" and states[oid]["responders"]]
    if not candidates:
        return []
    best = max(states[oid]["score"] for oid in candidates)
    top = [oid for oid in candidates if states[oid]["score"] == best]
    return top if len(top) > 1 else []


def quorum_met(responders: int, quorum: Optional[int]) -> bool:
    return quorum is None or responders >= quorum


def phase(is_closed: bool, decided: Optional[Hashable], adopted: bool, responders: int,
          quorum: Optional[int]) -> str:
    if adopted:
        return "adopted"
    if decided is not None:
        return "decided"
    if not is_closed:
        return "voting"
    return "closed" if quorum_met(responders, quorum) else "no_quorum"
