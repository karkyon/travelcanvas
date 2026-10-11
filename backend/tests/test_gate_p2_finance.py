"""
[Gate P2] FR-027 予算・費用 / FR-028 立替・精算の統合テスト(実PostgreSQL)と計算の単体テスト。

検証する主な性質:
- 金額はDecimalで扱い、分担(均等・比率・金額・負担なし)の合計は必ず支出額に一致し、端数は rounding_adjustment に出る
- 外貨はレートで基準通貨へ換算し、レートが無ければ換算せず集計から除外して件数で示す(EX-013)
- 返金は元の支出を参照し、既定で元の負担割合で分け、集計・差額から差し引く。元の額を超えられない
- 予算: 全体・カテゴリ別・日別と、本人だけが見える個人の予算(金額は暗号文だけ)。予算と実績の差異・超過
- 精算: メンバーごとの差額と送金案、精算の記録で差額が0になる。当事者は閲覧者でも記録できる
- 基準通貨は支出等が無い時だけ変更できる。If-Match、論理削除、監査ログに金額・題名を残さない
"""
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.api.v1 import finance as finance_api
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import Budget, Expense, ExpenseShare, PlanCollaborator, Settlement
from app.services import finance


@pytest.fixture(autouse=True)
def _encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(finance_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _plan(client):
    res = client.post("/api/v1/travel-plans/", json={"title": "費用テスト旅行"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _add_member(db_session, plan_id, user, role="editor"):
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=user.id, email=user.email, role=role,
                                    status="accepted"))
    db_session.commit()


def _group(auth_client, make_user, db_session, roles=("editor", "editor")):
    client, owner = auth_client
    p = _plan(client)
    others = []
    for role in roles:
        u, _ = make_user()
        _add_member(db_session, p, u, role)
        others.append(u)
    return client, p, owner, others


def _expense(client, p, **body):
    payload = {"title": "夕食", "category": "food", "amount": "3000"}
    payload.update(body)
    return client.post(f"/api/v1/plans/{p}/expenses", json=payload)


def _summary(client, p):
    res = client.get(f"/api/v1/plans/{p}/finance-summary")
    assert res.status_code == 200, res.text
    return res.json()


def _net(summary, user):
    return next(m for m in summary["members"] if m["user_id"] == str(user.id))["net"]


# ---------------------------------------------------------------- 計算(単体)

def test_split_equal_puts_remainder_on_first_participants():
    shares = finance.split(Decimal("1000"), "JPY", "equal", [finance.Participant(i) for i in "abc"], "a")
    assert [(s.user_id, s.share_minor, s.adjustment_minor) for s in shares] == [
        ("a", 334, 1), ("b", 333, 0), ("c", 333, 0)]
    usd = finance.split(Decimal("10.00"), "USD", "equal", [finance.Participant(i) for i in "abc"], "a")
    assert sum(s.share_minor for s in usd) == 1000 and [s.share_minor for s in usd] == [334, 333, 333]


def test_split_ratio_amount_none_and_errors():
    r = finance.split(Decimal("1000"), "JPY", "ratio",
                      [finance.Participant("a", Decimal(2)), finance.Participant("b", Decimal(1))], "a")
    assert [s.share_minor for s in r] == [667, 333] and sum(s.adjustment_minor for s in r) == 1
    fixed = [finance.Participant("a", amount=Decimal(600)), finance.Participant("b", amount=Decimal(400))]
    a = finance.split(Decimal("1000"), "JPY", "amount", fixed, "a")
    assert [s.share_minor for s in a] == [600, 400]
    assert [(s.user_id, s.share_minor) for s in finance.split(Decimal("500"), "JPY", "none", [], "x")] == [("x", 500)]
    with pytest.raises(finance.FinanceError):
        finance.split(Decimal("1000"), "JPY", "amount", [finance.Participant("a", amount=Decimal(999))], "a")
    with pytest.raises(finance.FinanceError):
        finance.split(Decimal("10.5"), "JPY", "equal", [finance.Participant("a")], "a")
    with pytest.raises(finance.FinanceError):
        finance.split(Decimal("1"), "KWD", "equal", [finance.Participant("a")], "a")
    with pytest.raises(finance.FinanceError):
        finance.split(Decimal("1"), "JPY", "equal", [finance.Participant("a"), finance.Participant("a")], "a")


def test_suggest_transfers_minimises_and_balances():
    t = finance.suggest_transfers({"a": 700, "b": -400, "c": -300, "d": 0})
    assert t == [("b", "a", 400), ("c", "a", 300)]
    assert finance.suggest_transfers({"a": 0}) == []


# ---------------------------------------------------------------- 基準通貨

def test_settings_default_and_change_guarded(auth_client):
    client, _ = auth_client
    p = _plan(client)
    assert client.get(f"/api/v1/plans/{p}/finance-settings").json() == {
        "plan_id": p, "base_currency": "JPY", "revision": 0, "is_default": True}
    assert client.put(f"/api/v1/plans/{p}/finance-settings", json={"base_currency": "USD"}).status_code == 428
    res = client.put(f"/api/v1/plans/{p}/finance-settings", json={"base_currency": "USD"}, headers={"If-Match": "0"})
    assert res.status_code == 200 and res.json()["base_currency"] == "USD" and res.json()["revision"] == 1
    assert client.put(f"/api/v1/plans/{p}/finance-settings", json={"base_currency": "usd"},
                      headers={"If-Match": "1"}).status_code == 422
    assert client.put(f"/api/v1/plans/{p}/finance-settings", json={"base_currency": "KWD"},
                      headers={"If-Match": "1"}).status_code == 422
    assert _expense(client, p, amount="12.50").status_code == 201
    assert client.put(f"/api/v1/plans/{p}/finance-settings", json={"base_currency": "JPY"},
                      headers={"If-Match": "1"}).status_code == 409


# ---------------------------------------------------------------- 支出・分担

def test_expense_default_equal_split_among_members(auth_client, make_user, db_session, audit_calls):
    client, p, owner, others = _group(auth_client, make_user, db_session)
    res = _expense(client, p, amount="1000", title="秘密の店名", note="メモ本文")
    assert res.status_code == 201, res.text
    e = res.json()
    assert e["amount"] == "1000" and e["currency"] == "JPY" and e["base_amount"] == "1000" and e["is_converted"]
    assert e["fx_rate"] == "1" and e["paid_by_user_id"] == str(owner.id) and e["split_method"] == "equal"
    shares = e["shares"]
    assert len(shares) == 3 and sum(int(s["share_amount"]) for s in shares) == 1000
    assert sorted(s["share_amount"] for s in shares) == ["333", "333", "334"]
    assert sum(int(s["rounding_adjustment"]) for s in shares) == 1
    assert "秘密の店名" not in repr(audit_calls) and "1000" not in repr(audit_calls)
    rows = db_session.query(ExpenseShare).filter(ExpenseShare.expense_id == uuid.UUID(e["id"])).all()
    assert sum(r.share_amount for r in rows) == Decimal("1000")


def test_expense_ratio_amount_none_and_payer(auth_client, make_user, db_session):
    client, p, owner, (a, b) = _group(auth_client, make_user, db_session)
    ratio = _expense(client, p, amount="900", split_method="ratio", paid_by_user_id=str(a.id),
                     participants=[{"user_id": str(owner.id), "weight": "2"}, {"user_id": str(b.id), "weight": "1"}])
    assert ratio.status_code == 201, ratio.text
    assert [s["share_amount"] for s in ratio.json()["shares"]] == ["600", "300"]
    assert ratio.json()["paid_by_name"] == a.username
    amt = _expense(client, p, amount="1000", split_method="amount",
                   participants=[{"user_id": str(a.id), "amount": "700"}, {"user_id": str(b.id), "amount": "200"}])
    assert amt.status_code == 422 and "一致しません" in amt.json()["detail"]
    none = _expense(client, p, amount="500", split_method="none", paid_by_user_id=str(b.id))
    assert [(s["user_id"], s["share_amount"]) for s in none.json()["shares"]] == [(str(b.id), "500")]
    outsider, _ = make_user()
    assert _expense(client, p, paid_by_user_id=str(outsider.id)).status_code == 422
    assert _expense(client, p, participants=[{"user_id": str(outsider.id)}]).status_code == 422
    assert _expense(client, p, amount="10.5").status_code == 422
    assert _expense(client, p, amount="100", tax_amount="200").status_code == 422
    assert _expense(client, p, category="gift").status_code == 422


def test_foreign_currency_conversion_and_unconverted(auth_client, make_user, db_session):
    client, p, owner, (a, b) = _group(auth_client, make_user, db_session)
    usd = _expense(client, p, amount="10.00", currency="USD", fx_rate="150.25", fx_source="カード明細",
                   fx_date="2026-11-01", tax_amount="1.00")
    assert usd.status_code == 201, usd.text
    body = usd.json()
    assert body["amount"] == "10.00" and body["base_amount"] == "1503" and body["fx_rate"] == "150.25"
    assert sum(int(s["base_share_amount"]) for s in body["shares"]) == 1503
    assert sum(Decimal(s["share_amount"]) for s in body["shares"]) == Decimal("10.00")
    eur = _expense(client, p, amount="20.00", currency="EUR")
    assert eur.status_code == 201 and eur.json()["is_converted"] is False and eur.json()["base_amount"] is None
    assert all(s["base_share_amount"] is None for s in eur.json()["shares"])
    assert _expense(client, p, amount="100", fx_rate="2").status_code == 422  # 基準通貨にレートは不可
    s = _summary(client, p)
    assert s["unconverted_expenses"] == 1
    assert s["total"]["actual"] == "1503" and s["tax_total"] == "150"
    # 換算できない支出は差額にも入らない(1503円だけで計算される)
    owner_share = next(int(x["base_share_amount"]) for x in body["shares"] if x["user_id"] == str(owner.id))
    assert _net(s, owner) == str(1503 - owner_share)


def test_refund_reduces_balances_and_is_bounded(auth_client, make_user, db_session):
    client, p, owner, (a, b) = _group(auth_client, make_user, db_session)
    orig = _expense(client, p, amount="3000", title="宿", category="lodging").json()
    assert orig["refunded_amount"] == "0"
    r = _expense(client, p, kind="refund", refund_of_expense_id=orig["id"], amount="900", title="一部返金",
                 category="lodging")
    assert r.status_code == 201, r.text
    refund = r.json()
    assert refund["kind"] == "refund" and refund["split_method"] == "ratio"
    assert sorted(x["share_amount"] for x in refund["shares"]) == ["300", "300", "300"]
    listed = {x["id"]: x for x in client.get(f"/api/v1/plans/{p}/expenses").json()}
    assert listed[orig["id"]]["refunded_amount"] == "900"
    s = _summary(client, p)
    assert s["total"]["actual"] == "2100" and s["refund_total"] == "900"
    assert _net(s, owner) == "1400" and _net(s, a) == "-700"
    assert _expense(client, p, kind="refund", refund_of_expense_id=orig["id"], amount="2101").status_code == 422
    assert _expense(client, p, kind="refund", refund_of_expense_id=orig["id"], amount="1",
                    currency="USD").status_code == 422
    assert _expense(client, p, kind="refund", amount="1").status_code == 422
    assert _expense(client, p, refund_of_expense_id=orig["id"]).status_code == 422
    # 返金のある支出は削除できない
    assert client.delete(f"/api/v1/plans/{p}/expenses/{orig['id']}", headers={"If-Match": "1"}).status_code == 409
    assert client.delete(f"/api/v1/plans/{p}/expenses/{refund['id']}", headers={"If-Match": "1"}).status_code == 200
    assert client.delete(f"/api/v1/plans/{p}/expenses/{orig['id']}", headers={"If-Match": "1"}).status_code == 200
    assert client.get(f"/api/v1/plans/{p}/expenses").json() == []


def test_update_recomputes_shares_with_if_match(auth_client, make_user, db_session, audit_calls):
    client, p, owner, (a, b) = _group(auth_client, make_user, db_session)
    e = _expense(client, p, amount="1000").json()
    url = f"/api/v1/plans/{p}/expenses/{e['id']}"
    assert client.patch(url, json={"amount": "1200"}).status_code == 428
    assert client.patch(url, json={"amount": "1200"}, headers={"If-Match": "5"}).status_code == 409
    res = client.patch(url, json={"amount": "1200", "title": "変更"}, headers={"If-Match": "1"})
    assert res.status_code == 200, res.text
    assert res.json()["revision"] == 2 and sorted(s["share_amount"] for s in res.json()["shares"]) == ["400"] * 3
    res = client.patch(url, json={"split_method": "amount", "participants": [
        {"user_id": str(a.id), "amount": "1200"}]}, headers={"If-Match": "2"})
    assert res.status_code == 200 and [(s["user_id"], s["share_amount"]) for s in res.json()["shares"]] == [
        (str(a.id), "1200")]
    res = client.patch(url, json={"currency": "USD", "amount": "8.00", "fx_rate": "150", "split_method": "equal",
                                  "participants": None}, headers={"If-Match": "3"})
    assert res.status_code == 200 and res.json()["base_amount"] == "1200"
    assert res.json()["fx_rate"] == "150"  # 指数表記(1.5E+2)にしない
    assert client.patch(url, json={"kind": "refund"}, headers={"If-Match": "4"}).status_code == 422
    assert client.patch(url, json={"bogus": 1}, headers={"If-Match": "4"}).status_code == 422
    res = client.patch(url, json={"currency": "JPY", "amount": "1000"}, headers={"If-Match": "4"})
    assert res.status_code == 200 and res.json()["fx_rate"] == "1"
    assert "変更" not in repr(audit_calls)


def test_related_and_receipt_validation(auth_client, make_user, db_session):
    client, p, owner, _ = _group(auth_client, make_user, db_session, roles=())
    other = _plan(client)
    r_other = client.post(f"/api/v1/plans/{other}/reservations", json={"type": "restaurant"}).json()
    assert _expense(client, p, related_type="reservation", related_id=r_other["id"]).status_code == 422
    r = client.post(f"/api/v1/plans/{p}/reservations", json={"type": "restaurant", "provider_name": "料亭"}).json()
    ok = _expense(client, p, related_type="reservation", related_id=r["id"])
    assert ok.status_code == 201 and ok.json()["related_label"] == "料亭"
    assert _expense(client, p, receipt_document_id=str(uuid.uuid4())).status_code == 422
    assert _expense(client, p, related_type="reservation").status_code == 422


def test_viewer_cannot_write_expenses(auth_client, make_user, db_session):
    client, p, owner, (viewer,) = _group(auth_client, make_user, db_session, roles=("viewer",))
    _act_as(viewer)
    assert _expense(client, p).status_code == 403
    assert client.get(f"/api/v1/plans/{p}/expenses").status_code == 200


# ---------------------------------------------------------------- 予算

def test_budgets_and_private_member_budget(auth_client, make_user, db_session):
    client, p, owner, (viewer,) = _group(auth_client, make_user, db_session, roles=("viewer",))
    assert client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "total", "amount": "50000"}).status_code == 201
    assert client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "total", "amount": "1"}).status_code == 409
    cat = client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "category", "category": "food", "amount": "2000"})
    assert cat.status_code == 201
    assert client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "category", "amount": "1"}).status_code == 422
    day = {"kind": "day", "local_date": "2026-11-01", "amount": "10000"}
    assert client.post(f"/api/v1/plans/{p}/budgets", json=day).status_code == 201
    bad = {"kind": "total", "category": "food", "amount": "1"}
    assert client.post(f"/api/v1/plans/{p}/budgets", json=bad).status_code == 422
    assert client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "total", "amount": "-1"}).status_code == 422

    _act_as(viewer)
    lodging = {"kind": "category", "category": "lodging", "amount": "1"}
    assert client.post(f"/api/v1/plans/{p}/budgets", json=lodging).status_code == 403
    mine = client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "member", "amount": "30000"})
    assert mine.status_code == 201, mine.text
    assert mine.json()["is_private"] is True and mine.json()["amount"] == "30000"
    row = db_session.query(Budget).filter(Budget.id == uuid.UUID(mine.json()["id"])).one()
    assert row.amount is None and row.amount_ciphertext and b"30000" not in row.amount_ciphertext
    kinds = {b["kind"] for b in client.get(f"/api/v1/plans/{p}/budgets").json()}
    assert kinds == {"total", "category", "day", "member"}

    _act_as(owner)
    assert {b["kind"] for b in client.get(f"/api/v1/plans/{p}/budgets").json()} == {"total", "category", "day"}
    assert client.patch(f"/api/v1/plans/{p}/budgets/{mine.json()['id']}", json={"amount": "1"},
                        headers={"If-Match": "1"}).status_code == 404
    assert _summary(client, p)["my_budget"] is None
    res = client.patch(f"/api/v1/plans/{p}/budgets/{cat.json()['id']}", json={"amount": "2500"},
                       headers={"If-Match": "1"})
    assert res.status_code == 200 and res.json()["amount"] == "2500" and res.json()["revision"] == 2
    assert client.delete(f"/api/v1/plans/{p}/budgets/{cat.json()['id']}", headers={"If-Match": "2"}).status_code == 200


def test_summary_budget_vs_actual(auth_client, make_user, db_session):
    client, p, owner, (a,) = _group(auth_client, make_user, db_session, roles=("editor",))
    client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "total", "amount": "10000"})
    client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "category", "category": "food", "amount": "3000"})
    client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "day", "local_date": "2026-11-01", "amount": "5000"})
    client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "member", "amount": "3000"})
    _expense(client, p, amount="4000", category="food", local_date="2026-11-01")
    _expense(client, p, amount="2000", category="transport", local_date="2026-11-02", fee_amount="200")
    _expense(client, p, amount="600", category="activity")
    client.post(f"/api/v1/plans/{p}/reservations", json={"type": "accommodation", "total_amount": 12000,
                                                         "currency": "JPY"})
    client.post(f"/api/v1/plans/{p}/reservations", json={"type": "flight", "total_amount": 300, "currency": "USD"})
    client.post(f"/api/v1/plans/{p}/reservations", json={"type": "bus", "total_amount": 900, "currency": "JPY",
                                                         "status": "cancelled"})
    s = _summary(client, p)
    assert s["base_currency"] == "JPY" and s["algorithm_version"] == finance.ALGORITHM_VERSION
    assert s["total"] == {"budget": "10000", "actual": "6600", "remaining": "3400", "over": False}
    cats = {c["category"]: c for c in s["by_category"]}
    assert cats["food"] == {"category": "food", "budget": "3000", "actual": "4000", "remaining": "-1000", "over": True}
    assert cats["transport"]["budget"] is None and cats["transport"]["over"] is False
    days = {d["local_date"]: d for d in s["by_day"]}
    assert days["2026-11-01"]["over"] is False and days["2026-11-02"]["actual"] == "2000"
    assert s["undated_actual"] == "600" and s["fee_total"] == "200"
    assert s["reserved"] == {"total": "12000", "unconverted": 1}
    assert s["my_budget"]["budget"] == "3000" and s["my_budget"]["actual"] == "3300" and s["my_budget"]["over"] is True


# ---------------------------------------------------------------- 精算

def test_balances_transfers_and_settlement(auth_client, make_user, db_session):
    client, p, owner, (a, viewer) = _group(auth_client, make_user, db_session, roles=("editor", "viewer"))
    _expense(client, p, amount="3000")  # owner払い、3人均等
    _expense(client, p, amount="600", paid_by_user_id=str(a.id))
    s = _summary(client, p)
    assert _net(s, owner) == "1800" and _net(s, a) == "-600" and _net(s, viewer) == "-1200"
    assert s["is_settled"] is False
    assert [(t["from_user_id"], t["to_user_id"], t["amount"]) for t in s["transfers"]] == [
        (str(viewer.id), str(owner.id), "1200"), (str(a.id), str(owner.id), "600")]

    _act_as(viewer)
    assert client.post(f"/api/v1/plans/{p}/settlements", json={
        "from_user_id": str(a.id), "to_user_id": str(owner.id), "amount": "600"}).status_code == 403
    res = client.post(f"/api/v1/plans/{p}/settlements", json={
        "from_user_id": str(viewer.id), "to_user_id": str(owner.id), "amount": "1200", "settled_on": "2026-11-05"})
    assert res.status_code == 201, res.text
    assert res.json()["currency"] == "JPY" and res.json()["from_name"] == viewer.username
    _act_as(owner)
    assert client.post(f"/api/v1/plans/{p}/settlements", json={
        "from_user_id": str(a.id), "to_user_id": str(a.id), "amount": "1"}).status_code == 422
    assert client.post(f"/api/v1/plans/{p}/settlements", json={
        "from_user_id": str(a.id), "to_user_id": str(owner.id), "amount": "0"}).status_code == 422
    outsider, _ = make_user()
    assert client.post(f"/api/v1/plans/{p}/settlements", json={
        "from_user_id": str(outsider.id), "to_user_id": str(owner.id), "amount": "1"}).status_code == 422
    second = client.post(f"/api/v1/plans/{p}/settlements", json={
        "from_user_id": str(a.id), "to_user_id": str(owner.id), "amount": "600"}).json()
    s = _summary(client, p)
    assert s["is_settled"] is True and s["transfers"] == []
    assert len(client.get(f"/api/v1/plans/{p}/settlements").json()) == 2
    assert client.delete(f"/api/v1/plans/{p}/settlements/{second['id']}", headers={"If-Match": "1"}).status_code == 200
    assert _summary(client, p)["is_settled"] is False


def test_removed_member_keeps_balance(auth_client, make_user, db_session):
    client, p, owner, (a,) = _group(auth_client, make_user, db_session, roles=("editor",))
    _expense(client, p, amount="1000")
    db_session.query(PlanCollaborator).filter(PlanCollaborator.user_id == a.id).delete()
    db_session.commit()
    s = _summary(client, p)
    row = next(m for m in s["members"] if m["user_id"] == str(a.id))
    assert row["is_member"] is False and row["net"] == "-500"
    e = client.get(f"/api/v1/plans/{p}/expenses").json()[0]
    assert any(sh["user_id"] == str(a.id) and sh["is_member"] is False for sh in e["shares"])
    # 外れたメンバーとの精算も記録できる(支出に関わっているため)
    assert client.post(f"/api/v1/plans/{p}/settlements", json={
        "from_user_id": str(a.id), "to_user_id": str(owner.id), "amount": "500"}).status_code == 201
    assert _summary(client, p)["is_settled"] is True


def test_outsider_and_purge(auth_client, make_user, db_session):
    client, p, owner, _ = _group(auth_client, make_user, db_session, roles=())
    _expense(client, p)
    client.post(f"/api/v1/plans/{p}/budgets", json={"kind": "member", "amount": "1"})
    outsider, _ = make_user()
    _act_as(outsider)
    for path in ("finance-settings", "budgets", "expenses", "settlements", "finance-summary"):
        assert client.get(f"/api/v1/plans/{p}/{path}").status_code == 403
    _act_as(owner)
    db_session.execute(text("SET CONSTRAINTS ALL DEFERRED"))
    db_session.execute(text("DELETE FROM travel_plans WHERE id = :p"), {"p": p})
    db_session.flush()
    for model in (Expense, Budget, Settlement):
        assert db_session.query(model).filter(model.plan_id == uuid.UUID(p)).count() == 0
