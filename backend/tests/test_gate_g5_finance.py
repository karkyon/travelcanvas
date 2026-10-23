"""[Gate G5] FIN-01 予算の版・為替の記録・予約額の換算 / FIN-02 取消・端数の規則・精算の締め・精算の冪等。"""
import uuid
from decimal import Decimal

import pytest

from app.api.v1 import finance as finance_api
from app.api.v1 import finance_ledger as ledger_api
from app.models.models import BudgetVersion, Expense, Settlement
from app.services import finance

from tests.test_gate_b012_plan_deletion import _reservation
from tests.test_gate_p2_finance import _act_as, _expense, _group, _net, _plan, _summary


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    for mod in (finance_api,):
        monkeypatch.setattr(mod, "record_audit_event", lambda **kw: None)


def _settings(client, p):
    return client.get(f"/api/v1/plans/{p}/finance-settings").json()


def _put_settings(client, p, **body):
    rev = _settings(client, p)["revision"]
    return client.put(f"/api/v1/plans/{p}/finance-settings", json=body, headers={"If-Match": str(rev)})


# ---------------------------------------------------------------- 純粋関数

def test_rounding_and_remainder_rules():
    assert finance.convert(Decimal("10.005"), Decimal(1), "USD") == Decimal("10.01")
    assert finance.convert(Decimal("10.005"), Decimal(1), "USD", "down") == Decimal("10.00")
    assert finance.convert(Decimal("10.001"), Decimal(1), "USD", "up") == Decimal("10.01")
    with pytest.raises(finance.FinanceError):
        finance.convert(Decimal(1), Decimal(1), "USD", "banker")
    ps = [finance.Participant("a"), finance.Participant("b"), finance.Participant("c")]
    largest = finance.split(Decimal("100"), "JPY", "equal", ps, "c")
    assert [s.share_minor for s in largest] == [34, 33, 33]
    payer = finance.split(Decimal("100"), "JPY", "equal", ps, "c", "payer")
    assert [s.share_minor for s in payer] == [33, 33, 34] and payer[2].adjustment_minor == 1
    # 支払った人が負担者にいなければ largest と同じ
    assert [s.share_minor for s in finance.split(Decimal("100"), "JPY", "equal", ps, "z", "payer")] == [34, 33, 33]
    first = finance.split(Decimal("101"), "JPY", "ratio",
                          [finance.Participant("a", Decimal(1)), finance.Participant("b", Decimal(2))], "a", "first")
    assert sum(s.share_minor for s in first) == 101 and first[0].share_minor == 34
    with pytest.raises(finance.FinanceError):
        finance.split(Decimal("100"), "JPY", "equal", ps, "a", "random")


# ---------------------------------------------------------------- FIN-01

def test_fx_rates_recorded_and_used_by_expense_and_reservations(auth_client):
    client, _owner = auth_client
    p = _plan(client)
    first = {"currency": "USD", "rate": "150.25", "rate_date": "2026-10-01", "source": "銀行の公示"}
    r = client.post(f"/api/v1/plans/{p}/fx-rates", json=first)
    assert r.status_code == 201, r.text
    rate = r.json()
    assert rate["base_currency"] == "JPY" and rate["rate"] == "150.25" and rate["retrieved_at"]
    for bad in ({"currency": "JPY", "rate": "1", "rate_date": "2026-10-01"},
                {"currency": "USD", "rate": "0", "rate_date": "2026-10-01"},
                {"currency": "USD", "rate": "1.123456789", "rate_date": "2026-10-01"},
                {"currency": "USD", "rate": "1", "rate_date": "2026-10-01", "retrieved_at": "2026-10-01T00:00:00"}):
        assert client.post(f"/api/v1/plans/{p}/fx-rates", json=bad).status_code == 422, bad
    e = _expense(client, p, amount="10.00", currency="USD", fx_rate_id=rate["id"])
    assert e.status_code == 201, e.text
    body = e.json()
    assert body["base_amount"] == "1503" and body["fx_rate_id"] == rate["id"] and body["fx_source"] == "銀行の公示"
    assert body["fx_date"] == "2026-10-01"
    # 新しいレートを足しても、記録した支出の換算は変わらない
    later = {"currency": "USD", "rate": "160", "rate_date": "2026-10-10"}
    newer = client.post(f"/api/v1/plans/{p}/fx-rates", json=later)
    assert newer.status_code == 201
    listed = client.get(f"/api/v1/plans/{p}/expenses").json()[0]
    assert listed["base_amount"] == "1503"
    # 通貨の合わないレート・別の旅行のレート・fx_rate と同時の指定は断る
    assert _expense(client, p, amount="1", currency="EUR", fx_rate_id=rate["id"]).status_code == 422
    assert _expense(client, p, amount="1", currency="USD", fx_rate_id=str(uuid.uuid4())).status_code == 422
    assert _expense(client, p, amount="1", currency="USD", fx_rate_id=rate["id"], fx_rate="99").status_code == 422
    # 予約: USD は最新のレートで換算、EUR はレートが無いので通貨ごとに別に示す
    _reservation(client, p, total_amount=100, currency="USD")
    _reservation(client, p, total_amount=20, currency="EUR")
    _reservation(client, p, total_amount=5000, currency="JPY")
    s = _summary(client, p)
    assert s["reserved"]["total"] == "21000" and s["reserved"]["converted_with_rates"] == 1
    assert s["reserved"]["unconverted"] == 1 and s["reserved"]["unconverted_by_currency"] == {"EUR": "20"}
    assert [x["rate"] for x in client.get(f"/api/v1/plans/{p}/fx-rates").json()] == ["160", "150.25"]


def test_budget_versions_are_snapshots(auth_client, db_session):
    client, _owner = auth_client
    p = _plan(client)
    empty = client.post(f"/api/v1/plans/{p}/budget-versions", json={"kind": "initial"})
    assert empty.status_code == 422 and empty.json()["detail"]["code"] == "budget_empty"
    assert client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "total", "amount": "50000"}).status_code == 201
    food = {"kind": "category", "category": "food", "amount": "20000"}
    assert client.post(f"/api/v1/plans/{p}/budgets", json=food).status_code == 201
    v1 = client.post(f"/api/v1/plans/{p}/budget-versions", json={"kind": "initial", "note": "出発前"})
    assert v1.status_code == 201, v1.text
    assert v1.json()["total_amount"] == "50000" and v1.json()["label"] == "当初の予算"
    assert v1.json()["lines"] == [{"key": "category:food", "label": "food", "amount": "20000"}]
    again = client.post(f"/api/v1/plans/{p}/budget-versions", json={"kind": "initial"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "budget_initial_exists"
    bid = next(b for b in client.get(f"/api/v1/plans/{p}/budgets").json() if b["kind"] == "total")
    assert client.patch(f"/api/v1/plans/{p}/budgets/{bid['id']}", json={"amount": "60000"},
                        headers={"If-Match": str(bid["revision"])}).status_code == 200
    v2 = client.post(f"/api/v1/plans/{p}/budget-versions", json={"kind": "revised", "label": "円安で見直し"}).json()
    assert v2["total_amount"] == "60000" and v2["label"] == "円安で見直し"
    _expense(client, p, amount="1200", category="food")
    _expense(client, p, amount="10", currency="EUR")  # レートが無い外貨は実績の合計に混ぜない
    _reservation(client, p, total_amount=30000, currency="JPY", type="accommodation")
    _reservation(client, p, total_amount=900, currency="JPY", status="candidate")  # 候補は確定に入れない
    committed = client.post(f"/api/v1/plans/{p}/budget-versions", json={"kind": "committed"}).json()
    assert committed["total_amount"] == "30000"
    assert committed["lines"] == [{"key": "reservation:accommodation", "label": "accommodation", "amount": "30000"}]
    actual = client.post(f"/api/v1/plans/{p}/budget-versions", json={"kind": "actual"}).json()
    assert actual["total_amount"] == "1200" and actual["unconverted"] == {"EUR": "10"}
    versions = client.get(f"/api/v1/plans/{p}/budget-versions").json()
    assert [v["kind"] for v in versions] == ["initial", "revised", "committed", "actual"]
    assert versions[0]["total_amount"] == "50000"  # 後で予算を変えても当初の版は変わらない
    assert db_session.query(BudgetVersion).filter(BudgetVersion.plan_id == uuid.UUID(p)).count() == 4
    assert client.post(f"/api/v1/plans/{p}/budget-versions", json={"kind": "draft"}).status_code == 422


# ---------------------------------------------------------------- FIN-02

def test_void_keeps_row_but_leaves_totals(auth_client, make_user, db_session):
    client, p, owner, (bob, _carol) = _group(auth_client, make_user, db_session)
    e = _expense(client, p, amount="3000").json()
    assert _net(_summary(client, p), owner) == "2000"
    url = f"/api/v1/plans/{p}/expenses/{e['id']}/void"
    assert client.post(url, json={"reason": "二重に入れた"}).status_code == 428
    assert client.post(url, json={"reason": " "}, headers={"If-Match": str(e["revision"])}).status_code == 422
    v = client.post(url, json={"reason": "二重に入れた"}, headers={"If-Match": str(e["revision"])})
    assert v.status_code == 200, v.text
    assert v.json()["is_voided"] and v.json()["void_reason"] == "二重に入れた"
    s = _summary(client, p)
    assert s["total"]["actual"] == "0" and s["voided_expenses"] == 1 and _net(s, owner) == "0"
    listed = client.get(f"/api/v1/plans/{p}/expenses").json()
    assert len(listed) == 1 and listed[0]["is_voided"]  # 一覧には残る
    rev = listed[0]["revision"]
    assert client.patch(f"/api/v1/plans/{p}/expenses/{e['id']}", json={"amount": "1"},
                        headers={"If-Match": str(rev)}).status_code == 409
    assert client.post(url, json={"reason": "もう一度"}, headers={"If-Match": str(rev)}).status_code == 409
    refund = _expense(client, p, amount="100", kind="refund", refund_of_expense_id=e["id"])
    assert refund.status_code == 422
    # 返金のある支出は取り消せない
    e2 = _expense(client, p, amount="1000").json()
    assert _expense(client, p, amount="100", kind="refund", refund_of_expense_id=e2["id"]).status_code == 201
    r = client.post(f"/api/v1/plans/{p}/expenses/{e2['id']}/void", json={"reason": "x"},
                    headers={"If-Match": str(e2["revision"])})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "expense_has_refunds"
    # 閲覧者は取り消せない
    viewer, _ = make_user()
    from tests.test_gate_p2_finance import _add_member

    _add_member(db_session, p, viewer, "viewer")
    _act_as(viewer)
    assert client.post(f"/api/v1/plans/{p}/expenses/{e2['id']}/void", json={"reason": "x"},
                       headers={"If-Match": str(e2["revision"])}).status_code == 403
    _act_as(owner)
    row = db_session.query(Expense).filter(Expense.id == uuid.UUID(e["id"])).one()
    assert row.deleted_at is None and row.voided_by_user_id == owner.id


def test_rounding_policy_applies_to_new_expenses(auth_client, make_user, db_session):
    client, p, owner, _others = _group(auth_client, make_user, db_session)
    before = _expense(client, p, amount="100", paid_by_user_id=str(owner.id)).json()
    assert sorted(x["share_amount"] for x in before["shares"]) == ["33", "33", "34"]
    r = _put_settings(client, p, rounding_mode="down", remainder_to="payer")
    assert r.status_code == 200 and r.json()["rounding_mode"] == "down" and r.json()["remainder_to"] == "payer"
    assert r.json()["base_currency"] == "JPY"
    after = _expense(client, p, amount="100").json()
    mine = next(x for x in after["shares"] if x["user_id"] == str(owner.id))
    assert mine["share_amount"] == "34" and mine["rounding_adjustment"] == "1"
    usd = _expense(client, p, amount="1.99", currency="USD", fx_rate="150.5").json()
    assert usd["base_amount"] == "299"  # 299.495 を切り捨て
    assert _put_settings(client, p, rounding_mode="bankers").status_code == 422
    assert _summary(client, p)["rounding_mode"] == "down"


def test_finance_lock_freezes_changes(auth_client, make_user, db_session):
    client, p, owner, (bob, _carol) = _group(auth_client, make_user, db_session)
    e = _expense(client, p, amount="3000").json()
    _act_as(bob)
    lock = client.post(f"/api/v1/plans/{p}/finance-lock")
    assert lock.status_code == 200 and lock.json()["locked_at"]
    assert client.post(f"/api/v1/plans/{p}/finance-lock").status_code == 409
    for r in (
        _expense(client, p, amount="1"),
        client.patch(f"/api/v1/plans/{p}/expenses/{e['id']}", json={"amount": "1"}, headers={"If-Match": "1"}),
        client.delete(f"/api/v1/plans/{p}/expenses/{e['id']}", headers={"If-Match": "1"}),
        client.post(f"/api/v1/plans/{p}/expenses/{e['id']}/void", json={"reason": "x"}, headers={"If-Match": "1"}),
        client.post(f"/api/v1/plans/{p}/settlements", json={"from_user_id": str(bob.id), "to_user_id": str(owner.id),
                                                            "amount": "1000"}),
        _put_settings(client, p, rounding_mode="up"),
    ):
        assert r.status_code == 409 and r.json()["detail"]["code"] == "finance_locked", r.text
    assert _summary(client, p)["locked"] is True
    # 解除は所有者だけ・理由が必須
    assert client.request("DELETE", f"/api/v1/plans/{p}/finance-lock", json={"reason": "直す"}).status_code == 403
    _act_as(owner)
    assert client.request("DELETE", f"/api/v1/plans/{p}/finance-lock", json={}).status_code == 422
    un = client.request("DELETE", f"/api/v1/plans/{p}/finance-lock", json={"reason": "金額の訂正"})
    assert un.status_code == 200 and un.json()["locked_at"] is None
    assert _expense(client, p, amount="1").status_code == 201


def test_settlement_idempotency_key(auth_client, make_user, db_session):
    client, p, owner, (bob, _carol) = _group(auth_client, make_user, db_session)
    _expense(client, p, amount="3000")
    body = {"from_user_id": str(bob.id), "to_user_id": str(owner.id), "amount": "1000"}
    h = {"Idempotency-Key": "settle-1"}
    first = client.post(f"/api/v1/plans/{p}/settlements", json=body, headers=h)
    assert first.status_code == 201, first.text
    again = client.post(f"/api/v1/plans/{p}/settlements", json=body, headers=h)
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"] and again.json()["replayed"]
    other = client.post(f"/api/v1/plans/{p}/settlements", json={**body, "amount": "999"}, headers=h)
    assert other.status_code == 409 and other.json()["detail"]["code"] == "idempotency_key_reused"
    assert db_session.query(Settlement).filter(Settlement.plan_id == uuid.UUID(p),
                                               Settlement.deleted_at.is_(None)).count() == 1
    assert _net(_summary(client, p), bob) == "0"
    # キー無しは従来どおり毎回記録する
    assert client.post(f"/api/v1/plans/{p}/settlements", json={**body, "amount": "1"}).status_code == 201
    assert client.post(f"/api/v1/plans/{p}/settlements", json=body,
                       headers={"Idempotency-Key": "x" * 101}).status_code == 422


def test_ledger_routes_need_membership(auth_client, make_user, db_session):
    client, p, owner, _others = _group(auth_client, make_user, db_session, roles=())
    outsider, _ = make_user()
    _act_as(outsider)
    for path in ("fx-rates", "budget-versions"):
        assert client.get(f"/api/v1/plans/{p}/{path}").status_code == 403
    assert client.post(f"/api/v1/plans/{p}/finance-lock").status_code == 403
    _act_as(owner)
    assert ledger_api.VERSION_KINDS == ("initial", "revised", "committed", "actual")
