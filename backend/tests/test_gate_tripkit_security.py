"""
[Gate TripKitFix] 旅行箱の API の負の試験(実 PostgreSQL)。UI で隠すことを認可と見なさない。

- 旅行に入っていない人: 旅行箱の全一覧・集計・検索・作成が 200/201 にならない(403/404)。件数も返さない
- 自分の旅行の URL に、別の旅行の予約・文書・持ち物・タスク・取込の ID を入れても 404(ID の付け替え)
- 閲覧者: 読めるが、作成・変更・予約番号の開示はできない
- 予約番号・PIN は一覧・詳細・検索・応答に平文で出ない。開示(reveal)は Cache-Control: no-store、回数の上限あり
"""
import io
import uuid

import pytest

from app.api.v1 import reservations as reservations_api
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import PlanCollaborator

CONF_NO = "TOBA-884271"  # 試験用の予約番号(実在しない)
PIN_CODE = "4419"


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "LOOKUP_INDEX_KEY", "test-only-lookup-index-key-not-a-secret", raising=False)
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _plan(client, title):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _member(db_session, plan_id, user, role):
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=user.id, email=user.email, role=role,
                                    status="accepted"))
    db_session.commit()


def _fill(client, p):
    """旅行箱の中身を1つずつ作り、ID を返す。"""
    r = client.post(f"/api/v1/plans/{p}/reservations", json={
        "type": "accommodation", "provider_name": "秘密の宿", "confirmation_number": CONF_NO, "pin": PIN_CODE})
    assert r.status_code == 201, r.text
    d = client.post(f"/api/v1/plans/{p}/documents/upload",
                    files={"file": ("機密の保険証券.pdf", io.BytesIO(b"%PDF-1.4\n%x\n"), "application/pdf")},
                    data={"classification": "internal", "document_type": "insurance"})
    assert d.status_code == 201, d.text
    k = client.post(f"/api/v1/plans/{p}/packing-items", json={"name": "常備薬"})
    assert k.status_code == 201, k.text
    t = client.post(f"/api/v1/plans/{p}/preparation-tasks", json={"title": "保険の確認"})
    assert t.status_code == 201, t.text
    e = client.post(f"/api/v1/plans/{p}/expenses", json={"title": "夕食", "category": "food", "amount": "3000"})
    assert e.status_code == 201, e.text
    return {"reservation": r.json()["id"], "document": d.json()["id"], "packing": k.json()["id"],
            "task": t.json()["id"], "expense": e.json()["id"]}


LISTS = ["reservations", "documents", "packing-items", "preparation-tasks", "readiness", "expenses",
         "finance-summary", "settlements", "budgets", "imports", "members", "packing-suggestions"]


def test_outsider_cannot_read_or_write_trip_kit(auth_client, make_user):
    client, owner = auth_client
    p = _plan(client, "家族の旅行")
    ids = _fill(client, p)
    outsider, _ = make_user()
    _act_as(outsider)

    for name in LISTS:
        res = client.get(f"/api/v1/plans/{p}/{name}")
        assert res.status_code in (403, 404), (name, res.status_code)
        assert "秘密の宿" not in res.text and "常備薬" not in res.text
    res = client.get(f"/api/v1/plans/{p}/search", params={"q": "秘密"})
    assert res.status_code in (403, 404) and "秘密の宿" not in res.text

    for path, body in [("reservations", {"type": "other", "provider_name": "x"}),
                       ("packing-items", {"name": "x"}), ("preparation-tasks", {"title": "x"}),
                       ("expenses", {"title": "x", "category": "food", "amount": "1"})]:
        assert client.post(f"/api/v1/plans/{p}/{path}", json=body).status_code in (403, 404), path

    for path in [f"reservations/{ids['reservation']}", f"documents/{ids['document']}",
                 f"documents/{ids['document']}/links"]:
        assert client.get(f"/api/v1/plans/{p}/{path}").status_code in (403, 404), path
    assert client.post(f"/api/v1/plans/{p}/reservations/{ids['reservation']}/reveal").status_code in (403, 404)


def test_ids_from_another_trip_are_not_found(auth_client, make_user):
    """自分の旅行の URL に別の旅行の ID を付け替えても読めない・変えられない(IDOR)。"""
    client, owner = auth_client
    p = _plan(client, "家族の旅行")
    ids = _fill(client, p)
    attacker, _ = make_user()
    _act_as(attacker)
    q = _plan(client, "自分の旅行")

    assert client.get(f"/api/v1/plans/{q}/reservations/{ids['reservation']}").status_code == 404
    assert client.post(f"/api/v1/plans/{q}/reservations/{ids['reservation']}/reveal").status_code == 404
    assert client.patch(f"/api/v1/plans/{q}/reservations/{ids['reservation']}", json={"provider_name": "x"},
                        headers={"If-Match": "1"}).status_code == 404
    assert client.delete(f"/api/v1/plans/{q}/reservations/{ids['reservation']}",
                         headers={"If-Match": "1"}).status_code == 404
    assert client.get(f"/api/v1/plans/{q}/documents/{ids['document']}").status_code == 404
    assert client.get(f"/api/v1/plans/{q}/documents/{ids['document']}/links").status_code == 404
    assert client.patch(f"/api/v1/plans/{q}/packing-items/{ids['packing']}", json={"quantity": 2},
                        headers={"If-Match": "1"}).status_code == 404
    assert client.delete(f"/api/v1/plans/{q}/preparation-tasks/{ids['task']}",
                         headers={"If-Match": "1"}).status_code == 404
    assert client.patch(f"/api/v1/plans/{q}/expenses/{ids['expense']}", json={"title": "x"},
                        headers={"If-Match": "1"}).status_code in (404, 422)
    # 自分の旅行の文書に、別の旅行の予約を関連付けることもできない
    mine = client.post(f"/api/v1/plans/{q}/documents/upload",
                       files={"file": ("a.pdf", io.BytesIO(b"%PDF-1.4\n%y\n"), "application/pdf")},
                       data={"classification": "internal"})
    assert mine.status_code == 201, mine.text
    assert client.post(f"/api/v1/plans/{q}/documents/{mine.json()['id']}/links", json={
        "entity_type": "reservation", "entity_id": ids["reservation"]}).status_code == 404
    # 自分の旅行の検索に、別の旅行の中身は出ない
    res = client.get(f"/api/v1/plans/{q}/search", params={"q": "秘密の宿"})
    assert res.status_code == 200 and res.json()["total"] == 0 and res.json()["categories"] == []
    # 自分の旅行の文書の一覧に、別の旅行の文書は出ない(件数にも入らない)
    docs = client.get(f"/api/v1/plans/{q}/documents").json()
    assert [d["id"] for d in docs] == [mine.json()["id"]]


def test_viewer_reads_but_cannot_change_or_reveal(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client, "家族の旅行")
    ids = _fill(client, p)
    viewer, _ = make_user()
    _member(db_session, p, viewer, "viewer")
    _act_as(viewer)

    for name in ["reservations", "documents", "packing-items", "readiness", "finance-summary"]:
        assert client.get(f"/api/v1/plans/{p}/{name}").status_code == 200, name
    res = client.post(f"/api/v1/plans/{p}/reservations", json={"type": "other", "provider_name": "x"})
    assert res.status_code == 403
    assert client.post(f"/api/v1/plans/{p}/expenses", json={
        "title": "x", "category": "food", "amount": "1"}).status_code == 403
    assert client.post(f"/api/v1/plans/{p}/reservations/{ids['reservation']}/reveal").status_code == 403


def test_reservation_secrets_never_plain_in_lists_detail_or_search(auth_client):
    client, owner = auth_client
    p = _plan(client, "家族の旅行")
    ids = _fill(client, p)
    for url in [f"/api/v1/plans/{p}/reservations", f"/api/v1/plans/{p}/reservations/{ids['reservation']}",
                f"/api/v1/plans/{p}/readiness", f"/api/v1/plans/{p}/finance-summary"]:
        res = client.get(url)
        assert res.status_code == 200, url
        assert CONF_NO not in res.text and PIN_CODE not in res.text, url
    res = client.get(f"/api/v1/plans/{p}/search", params={"q": "秘密の宿"})
    assert res.status_code == 200 and CONF_NO not in res.text


def test_reveal_is_no_store_and_rate_limited(auth_client, monkeypatch):
    client, owner = auth_client
    p = _plan(client, "家族の旅行")
    ids = _fill(client, p)
    res = client.post(f"/api/v1/plans/{p}/reservations/{ids['reservation']}/reveal")
    assert res.status_code == 200, res.text
    assert res.json()["confirmation_number"] == CONF_NO
    assert res.headers.get("cache-control") == "no-store"

    monkeypatch.setattr(reservations_api, "REVEAL_RATE_LIMIT", 2)
    codes = [client.post(f"/api/v1/plans/{p}/reservations/{ids['reservation']}/reveal").status_code
             for _ in range(3)]
    assert codes[-1] == 429, codes
    assert CONF_NO not in client.post(f"/api/v1/plans/{p}/reservations/{ids['reservation']}/reveal").text


def test_no_store_header_rule():
    from app.core.security_headers import apply_security_headers

    for path in ["/api/v1/plans/x/reservations/y/reveal", "/api/v1/plans/x/reservations/y/tickets/z/reveal/"]:
        h: dict = {}
        apply_security_headers(path, h)
        assert h["Cache-Control"] == "no-store", path
    h = {}
    apply_security_headers("/api/v1/plans/x/reservations", h)
    assert "Cache-Control" not in h
