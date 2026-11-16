"""
[Gate TripKitFix] 旅行箱の状態の意味を正す backend の変更(実 PostgreSQL)。

- 費用の概要 settlement_state: 立替が無い=none(以前は is_settled が真で「精算済み」と出ていた)/
  差額あり=open / 精算の記録で全員0=settled / 記録を取り消すと open に戻る。is_settled の意味は変えない
- 文書の一覧 link_count / receipt_count: 予約などへの関連と、領収書にしている支出の件数。取り消した支出は数えない。
  支出の題名・金額は文書の応答に出さない。単体の取得では None
"""
import io
import uuid

import pytest

from app.api.v1 import finance as finance_api
from app.core import crypto as crypto_module
from app.core.config import settings
from app.models.models import PlanCollaborator


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    monkeypatch.setattr(finance_api, "record_audit_event", lambda **kw: None)
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _plan(client):
    res = client.post("/api/v1/travel-plans/", json={"title": "旅行箱の補正テスト"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _member(db_session, plan_id, user, role="editor"):
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=user.id, email=user.email, role=role,
                                    status="accepted"))
    db_session.commit()


def _summary(client, p):
    res = client.get(f"/api/v1/plans/{p}/finance-summary")
    assert res.status_code == 200, res.text
    return res.json()


def test_settlement_state_none_open_settled(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    a, _ = make_user()
    _member(db_session, p, a)

    s = _summary(client, p)
    # 支出が無い: 払うものは無い(is_settled は真のまま)が、「精算済み」ではない
    assert s["is_settled"] is True
    assert s["settlement_state"] == "none"

    assert client.post(f"/api/v1/plans/{p}/expenses", json={
        "title": "夕食", "category": "food", "amount": "3000"}).status_code == 201
    s = _summary(client, p)
    assert s["settlement_state"] == "open" and s["is_settled"] is False

    res = client.post(f"/api/v1/plans/{p}/settlements", json={
        "from_user_id": str(a.id), "to_user_id": str(owner.id), "amount": "1500"})
    assert res.status_code == 201, res.text
    s = _summary(client, p)
    assert s["settlement_state"] == "settled" and s["is_settled"] is True

    assert client.delete(f"/api/v1/plans/{p}/settlements/{res.json()['id']}",
                         headers={"If-Match": "1"}).status_code == 200
    assert _summary(client, p)["settlement_state"] == "open"


def test_settlement_state_none_when_each_paid_own_share(auth_client, db_session):
    client, _owner = auth_client
    p = _plan(client)
    # 1人の旅行で自分が払った支出: 差額は0、精算の記録も無い → none
    assert client.post(f"/api/v1/plans/{p}/expenses", json={
        "title": "昼食", "category": "food", "amount": "1200"}).status_code == 201
    s = _summary(client, p)
    assert s["settlement_state"] == "none" and s["is_settled"] is True


def test_settlement_state_function():
    f = finance_api.settlement_state
    z = {"paid": 0, "owed": 0, "settled_out": 0, "settled_in": 0, "net": 0}
    assert f({}) == "none"
    assert f({1: dict(z)}) == "none"
    assert f({1: {**z, "net": 5}, 2: {**z, "net": -5}}) == "open"
    assert f({1: {**z, "settled_in": 5}, 2: {**z, "settled_out": 5}}) == "settled"


_PDF = b"%PDF-1.4\n%tripkit fix test\n"


def _upload(client, p, name):
    res = client.post(f"/api/v1/plans/{p}/documents/upload",
                      files={"file": (name, io.BytesIO(_PDF), "application/pdf")},
                      data={"classification": "internal", "document_type": "booking_confirmation"})
    assert res.status_code == 201, res.text
    return res.json()


def test_document_list_counts_links_and_receipts(auth_client):
    client, _owner = auth_client
    p = _plan(client)
    linked = _upload(client, p, "宿の確認書.pdf")
    receipt = _upload(client, p, "駅弁の領収書.pdf")
    lonely = _upload(client, p, "案内.pdf")
    r = client.post(f"/api/v1/plans/{p}/reservations", json={"type": "accommodation", "provider_name": "宿"})
    assert r.status_code == 201, r.text
    assert client.post(f"/api/v1/plans/{p}/documents/{linked['id']}/links", json={
        "entity_type": "reservation", "entity_id": r.json()["id"]}).status_code == 201
    e = client.post(f"/api/v1/plans/{p}/expenses", json={
        "title": "駅弁の秘密の題名", "category": "food", "amount": "2400", "receipt_document_id": receipt["id"]})
    assert e.status_code == 201, e.text

    rows = {d["id"]: d for d in client.get(f"/api/v1/plans/{p}/documents").json()}
    assert (rows[linked["id"]]["link_count"], rows[linked["id"]]["receipt_count"]) == (1, 0)
    assert (rows[receipt["id"]]["link_count"], rows[receipt["id"]]["receipt_count"]) == (0, 1)
    assert (rows[lonely["id"]]["link_count"], rows[lonely["id"]]["receipt_count"]) == (0, 0)
    # 支出の題名・金額は文書の一覧に出さない
    body = client.get(f"/api/v1/plans/{p}/documents").text
    assert "駅弁の秘密の題名" not in body and "2400" not in body

    # 取り消した支出は数えない
    ex = e.json()
    res = client.post(f"/api/v1/plans/{p}/expenses/{ex['id']}/void", json={"reason": "重複"},
                      headers={"If-Match": str(ex["revision"])})
    assert res.status_code == 200, res.text
    rows = {d["id"]: d for d in client.get(f"/api/v1/plans/{p}/documents").json()}
    assert rows[receipt["id"]]["receipt_count"] == 0

    # 単体の取得では数えない(None)
    one = client.get(f"/api/v1/plans/{p}/documents/{lonely['id']}").json()
    assert one["link_count"] is None and one["receipt_count"] is None


def test_document_counts_do_not_cross_plans(auth_client):
    """別の旅行の支出が、この旅行の文書を領収書として数えられないこと(数えるのは同じ旅行の支出だけ)。"""
    client, _owner = auth_client
    p = _plan(client)
    doc = _upload(client, p, "a.pdf")
    q = _plan(client)
    # 別の旅行から、この文書を領収書に指定しようとしても通らない(存在しない文書として拒否)
    res = client.post(f"/api/v1/plans/{q}/expenses", json={
        "title": "x", "category": "food", "amount": "100", "receipt_document_id": doc["id"]})
    assert res.status_code == 422, res.text
    rows = {d["id"]: d for d in client.get(f"/api/v1/plans/{p}/documents").json()}
    assert rows[doc["id"]]["receipt_count"] == 0
