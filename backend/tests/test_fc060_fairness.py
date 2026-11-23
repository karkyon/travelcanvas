"""[FC-060 公平性・監査 2026-11-23] 一人の希望だけを最大化せず、メンバーごとの満たされ方の開きを指標にする。

`optimizer.fairness` は、制約を持つメンバーごとの「守れていない割合」の最大と最小の開き(%・10 刻み)を返す。
開きが大きい(一人だけ守られない)ほど目的の点が増える。メンバーごとの内訳・名前は返さない(秘匿の条件を推測させない)。
"""
import uuid
from types import SimpleNamespace

from app.services import optimizer as opt
from app.services.feasibility import EvaluationResult


def _c(owner):
    return SimpleNamespace(id=uuid.uuid4(), owner_user_id=owner)


def _setup(statuses):
    """statuses: {owner: [satisfied/violated/unknown ...]}"""
    cons, results = [], []
    for owner, sts in statuses.items():
        for st in sts:
            c = _c(owner)
            cons.append(c)
            results.append({"constraint_id": str(c.id), "status": st})
    return EvaluationResult(constraint_results=results), SimpleNamespace(constraints=cons)


def test_spread_is_zero_when_everyone_is_treated_alike_and_grows_when_one_member_loses():
    a, b = uuid.uuid4(), uuid.uuid4()
    even = opt.fairness(*_setup({a: ["satisfied", "violated"], b: ["violated", "satisfied"]}))
    assert even == {"members": 2, "spread_percent": 0}
    uneven = opt.fairness(*_setup({a: ["satisfied", "satisfied"], b: ["violated", "violated"]}))
    assert uneven == {"members": 2, "spread_percent": 100}
    half = opt.fairness(*_setup({a: ["satisfied", "satisfied"], b: ["violated", "satisfied"]}))
    assert half["spread_percent"] == 50
    # 確かめられない制約は数えない・1 人だけなら指標にしない
    assert opt.fairness(*_setup({a: ["satisfied"], b: ["unknown"]})) == {"members": 1, "spread_percent": None}
    # 内訳(誰が守られていないか)は返さない
    assert set(uneven) == {"members", "spread_percent"}


def test_objective_penalises_the_uneven_plan_only_when_fairness_has_weight():
    move = {"fatigue_percent": None}
    summary = {"error": 0, "constraints_violated": 0, "warning": 0}
    w = dict(opt.DEFAULT_WEIGHTS)
    fair_even = opt.objective(summary, 1.0, move, {"members": 2, "spread_percent": 0}, w)
    fair_uneven = opt.objective(summary, 1.0, move, {"members": 2, "spread_percent": 100}, w)
    assert fair_uneven["total"] > fair_even["total"]
    w0 = {**w, "fairness": 0}
    assert opt.objective(summary, 1.0, move, {"members": 2, "spread_percent": 100}, w0)["total"] == \
        opt.objective(summary, 1.0, move, {"members": 2, "spread_percent": 0}, w0)["total"]
