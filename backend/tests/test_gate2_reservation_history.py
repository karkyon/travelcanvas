"""[Gate② FC-041] 変更・取消のメールを元の予約の履歴へまとめる(自動ではまとめない)。

DOC-02 FC-041「原予約と更新・取消メールを同一予約の履歴へ統合」。FC-042 の「同じ予約かもしれません」の組を、
利用者が「変更として」「取消として」選んだ時だけまとめる。履歴には値を持たない(項目の名前だけ)。
"""
import pytest

from app.core import crypto as crypto_module
from app.core.config import settings
from app.models.models import Reservation, ReservationHistory

RES = "/api/v1/plans/{plan_id}/reservations"


@pytest.fixture(autouse=True)
def _reservation_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _plan(client):
    res = client.post("/api/v1/travel-plans/", json={"title": "変更の旅", "destination": "伊勢",
                                                     "start_date": "2026-11-28", "end_date": "2026-11-29"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _add(client, plan_id, **body):
    res = client.post(RES.format(plan_id=plan_id), json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _absorb(client, plan_id, target, source_id, kind):
    return client.post(f"{RES.format(plan_id=plan_id)}/{target['id']}/absorb",
                       json={"source_reservation_id": source_id, "kind": kind},
                       headers={"If-Match": str(target["revision"])})


def test_change_mail_is_merged_into_the_original_and_kept_as_history(auth_client, db_session):
    client, _ = auth_client
    p = _plan(client)
    orig = _add(client, p, type="accommodation", provider_name="伊勢の宿", confirmation_number="ABC-123456",
                start_at="2026-11-28T15:00:00+09:00", total_amount=20000, currency="JPY")
    change = _add(client, p, type="accommodation", provider_name="伊勢の宿", confirmation_number="ABC-123456",
                  start_at="2026-11-29T15:00:00+09:00", total_amount=24000, currency="JPY")
    res = _absorb(client, p, orig, change["id"], "change")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "modified" and body["total_amount"] == 24000 and body["start_at"].startswith("2026-11-29")
    # まとめた側は一覧から消え、元の予約だけが残る
    ids = [r["id"] for r in client.get(RES.format(plan_id=p)).json()]
    assert ids == [orig["id"]]
    hist = client.get(f"{RES.format(plan_id=p)}/{orig['id']}/history").json()
    assert len(hist) == 1 and hist[0]["kind"] == "change" and hist[0]["source_reservation_id"] == change["id"]
    assert set(hist[0]["fields"]) >= {"start_at", "total_amount", "status"}
    # 履歴に値(予約番号・金額)は持たない
    row = db_session.query(ReservationHistory).one()
    assert "ABC-123456" not in str(row.fields) and "24000" not in str(row.fields)


def test_cancel_mail_marks_the_original_cancelled_without_changing_its_values(auth_client):
    client, _ = auth_client
    p = _plan(client)
    orig = _add(client, p, type="restaurant", provider_name="伊勢の食堂", confirmation_number="R-778899",
                start_at="2026-11-28T19:00:00+09:00", total_amount=8000, currency="JPY")
    cancel = _add(client, p, type="restaurant", provider_name="伊勢の食堂", confirmation_number="R-778899",
                  total_amount=0, currency="JPY")
    res = _absorb(client, p, orig, cancel["id"], "cancel")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelled" and res.json()["total_amount"] == 8000
    assert client.get(f"{RES.format(plan_id=p)}/{orig['id']}/history").json()[0]["kind"] == "cancel"


def test_refuses_different_numbers_stale_revision_and_viewers(auth_client, make_user, db_session):
    from app.core.auth import AuthResult, get_current_user
    from app.main import app
    from app.models.models import PlanCollaborator
    import uuid

    client, owner = auth_client
    p = _plan(client)
    a = _add(client, p, type="accommodation", provider_name="伊勢の宿", confirmation_number="ABC-123456")
    b = _add(client, p, type="accommodation", provider_name="伊勢の宿", confirmation_number="XYZ-000001")
    no_number = _add(client, p, type="accommodation", provider_name="伊勢の宿")
    for src in (b, no_number):
        r = _absorb(client, p, a, src["id"], "change")
        assert r.status_code == 422 and r.json()["detail"]["code"] == "not_same_reservation"
    same = _add(client, p, type="accommodation", provider_name="伊勢の宿", confirmation_number="ABC-123456")
    stale = dict(a, revision=a["revision"] + 5)
    assert _absorb(client, p, stale, same["id"], "change").status_code == 409
    assert _absorb(client, p, a, a["id"], "change").status_code == 422
    # 閲覧だけのメンバーはまとめられない(履歴は見られる)
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.flush()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=viewer, is_authenticated=True, is_guest=False)
    try:
        assert _absorb(client, p, a, same["id"], "change").status_code == 403
        assert client.get(f"{RES.format(plan_id=p)}/{a['id']}/history").status_code == 200
    finally:
        app.dependency_overrides[get_current_user] = (
            lambda: AuthResult(user=owner, is_authenticated=True, is_guest=False))
    # 何も変わっていない
    assert db_session.query(Reservation).filter(Reservation.plan_id == uuid.UUID(p),
                                                Reservation.deleted_at.is_(None)).count() == 4
