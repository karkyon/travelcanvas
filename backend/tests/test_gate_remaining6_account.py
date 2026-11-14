"""
[Gate Remaining-6] FR-003 パスワードの再設定・メールの確認、FR-007 予約の文の分割、GCP の公開 URL の元。

検証する主な性質:
- 忘れた時: 登録の有無で応答が変わらない(202・同じ文)。送るのは登録ずみ・有効な利用者だけ。メールの設定が無い時は送らない
- 再設定: 札で新しいパスワードになり、古いパスワードでは入れない。同じ札は 2 回使えない。期限切れ・改ざんは 400
- 弱いパスワードは方針どおり断る。用途の違う札(確認の札)では再設定できない
- メールの確認: 札で確認済みになる。メールを変えた後の札は使えない
- 1 通の文に予約が複数ある時は予約ごとに分ける
- 公開 URL の元は X-Forwarded-Proto を使い、許可の外の Host では設定の origin に戻す
"""
import re
import time

import pytest

from app.api.v1 import account_recovery as ar
from app.api.v1 import server_exports as se
from app.models.models import EmailOutbox, User
from app.services import reservation_extract as rx

STRONG = "Tc-Reset-Pass-2026!x"


@pytest.fixture()
def mail_on(monkeypatch):
    monkeypatch.setattr(ar.notify, "email_available", lambda: True)
    monkeypatch.setattr(ar, "record_audit_event", lambda **k: None)


def _token_from_outbox(db, user, kind):
    row = db.query(EmailOutbox).filter(EmailOutbox.user_id == user.id, EmailOutbox.kind == kind) \
        .order_by(EmailOutbox.created_at.desc()).first()
    assert row is not None
    m = re.search(r"token=([A-Za-z0-9_\-\.]+)", row.body)
    assert m
    return m.group(1)


def test_forgot_does_not_reveal_and_sends_only_to_real_user(client, make_user, db_session, mail_on):
    user, _ = make_user()
    a = client.post("/api/v1/auth/password/forgot", json={"email": user.email.upper()})
    b = client.post("/api/v1/auth/password/forgot", json={"email": "nobody-here@example.com"})
    assert a.status_code == b.status_code == 202
    assert a.json() == b.json()
    assert db_session.query(EmailOutbox).filter(EmailOutbox.user_id == user.id,
                                                EmailOutbox.kind == "password_reset").count() == 1


def test_forgot_without_smtp_sends_nothing(client, make_user, db_session, monkeypatch):
    monkeypatch.setattr(ar.notify, "email_available", lambda: False)
    user, _ = make_user()
    r = client.post("/api/v1/auth/password/forgot", json={"email": user.email})
    assert r.status_code == 202 and r.json()["email_available"] is False
    assert db_session.query(EmailOutbox).filter(EmailOutbox.user_id == user.id).count() == 0


def test_reset_changes_password_once(client, make_user, db_session, mail_on):
    user, old = make_user()
    client.post("/api/v1/auth/password/forgot", json={"email": user.email})
    tok = _token_from_outbox(db_session, user, "password_reset")
    r = client.post("/api/v1/auth/password/reset", json={"token": tok, "new_password": STRONG})
    assert r.status_code == 200, r.text
    again = client.post("/api/v1/auth/password/reset", json={"token": tok, "new_password": STRONG + "y"})
    assert again.status_code == 400 and again.json()["detail"]["code"] == "invalid_token"
    assert client.post("/api/v1/auth/login", json={"email": user.email, "password": old}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": user.email, "password": STRONG}).status_code == 200


def test_reset_rejects_bad_tokens_and_weak_password(client, make_user, db_session, mail_on):
    user, _ = make_user()
    expired = ar.make_token("reset", user, 10, now=time.time() - 100)
    r = client.post("/api/v1/auth/password/reset", json={"token": expired, "new_password": STRONG})
    assert r.status_code == 400
    good = ar.make_token("reset", user, 600)
    raw, sig = good.split(".")
    forged = raw[:-2] + ("AA" if raw[-2:] != "AA" else "BB") + "." + sig
    assert client.post("/api/v1/auth/password/reset", json={"token": forged, "new_password": STRONG}).status_code == 400
    verify_tok = ar.make_token("verify", user, 600)
    assert client.post("/api/v1/auth/password/reset",
                       json={"token": verify_tok, "new_password": STRONG}).status_code == 400
    weak = client.post("/api/v1/auth/password/reset", json={"token": good, "new_password": "short"})
    assert weak.status_code in (400, 422)
    db_session.refresh(user)
    assert client.post("/api/v1/auth/password/reset", json={"token": good, "new_password": STRONG}).status_code == 200


def test_email_verify_flow(auth_client, db_session, mail_on):
    client, user = auth_client
    user.is_verified = False
    db_session.commit()
    r = client.post("/api/v1/auth/email/verify/request")
    assert r.status_code == 202 and r.json()["accepted"] is True
    tok = _token_from_outbox(db_session, user, "email_verify")
    v = client.post("/api/v1/auth/email/verify", json={"token": tok})
    assert v.status_code == 200 and v.json()["verified"] is True
    db_session.refresh(user)
    assert user.is_verified is True
    again = client.post("/api/v1/auth/email/verify/request")
    assert again.json()["verified"] is True and again.json()["accepted"] is False


def test_verify_token_dies_when_email_changes(client, make_user, db_session, mail_on):
    user, _ = make_user()
    user.is_verified = False
    db_session.commit()
    tok = ar.make_token("verify", user, 600)
    user.email = "changed-" + user.email
    db_session.commit()
    assert client.post("/api/v1/auth/email/verify", json={"token": tok}).status_code == 400
    db_session.refresh(user)
    assert db_session.get(User, user.id).is_verified is False


def test_split_reservations():
    text = ("予約の確認\n\n"
            "【ホテル】京都ホテル\n予約番号: ABC12345\nチェックイン 2026-11-20\n\n"
            "【ホテル】大阪ホテル\n予約番号: XYZ98765\nチェックイン 2026-11-22\n")
    parts = rx.split_reservations(text)
    assert len(parts) == 2
    assert "ABC12345" in parts[0] and "XYZ98765" not in parts[0]
    assert "XYZ98765" in parts[1] and "ABC12345" not in parts[1]
    single = "予約番号: ABC12345\n京都ホテル"
    assert rx.split_reservations(single) == [single]


class _Req:
    def __init__(self, headers, scheme="http", netloc="testserver"):
        self.headers = headers
        self.url = type("U", (), {"scheme": scheme, "netloc": netloc})()


def test_public_base(monkeypatch):
    monkeypatch.setattr(type(se.settings), "cors_allowed_origins", property(lambda s: ["https://tc.example.ts.net"]),
                        raising=False)
    assert se._public_base(_Req({"host": "tc.example.ts.net", "x-forwarded-proto": "https"})) == \
        "https://tc.example.ts.net"
    assert se._public_base(_Req({"host": "evil.example.com", "x-forwarded-proto": "https"})) == \
        "https://tc.example.ts.net"
    assert se._public_base(_Req({"host": "localhost:8001"})) == "http://localhost:8001"
    assert se._public_base(_Req({"host": "localhost:8001", "x-forwarded-proto": "javascript"})) == \
        "http://localhost:8001"


def test_text_import_splits_into_jobs(auth_client, db_session):
    import uuid as _uuid

    from app.models.models import ImportJob

    client, _ = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "関西", "destination": "京都"}).json()["id"]
    client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-20", "timezone_id": "Asia/Tokyo"},
                headers={"Idempotency-Key": str(_uuid.uuid4())})
    text = ("ご予約の確認\n\n"
            "【ホテル】京都ホテル\n予約番号: ABC12345\nチェックイン 2026-11-20\n\n"
            "【ホテル】大阪ホテル\n予約番号: XYZ98765\nチェックイン 2026-11-21\n")
    r = client.post(f"/api/v1/plans/{p}/imports/extract/text", json={"text": text})
    assert r.status_code == 201, r.text
    split = r.json()["split"]
    assert split["count"] == 2 and len(set(split["job_ids"])) == 2
    assert db_session.query(ImportJob).filter(ImportJob.plan_id == _uuid.UUID(p)).count() == 2


def test_candidate_preview_reads_plain_web_page(auth_client, monkeypatch):
    """FR-007 SNS 以外の URL: 押した時に 1 ページ読み、題名・説明・場所を返す(内部のアドレスは読まない)"""
    import httpx

    from app.services import url_place as up

    client, _ = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "京都", "destination": "京都"}).json()["id"]
    page = ('<html><head><title>清水寺 | 公式</title><meta property="og:description" content="音羽山の寺">'
            '<script type="application/ld+json">{"@type":"Place","name":"清水寺","address":"京都市東山区清水1-294",'
            '"geo":{"latitude":34.9948,"longitude":135.785}}</script></head></html>')
    monkeypatch.setattr(up, "public_addresses", lambda host, port: ["93.184.216.34"])
    monkeypatch.setattr(up, "transport", httpx.MockTransport(
        lambda r: httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=page.encode())))
    r = client.post(f"/api/v1/plans/{p}/candidates/social-preview", json={"url": "https://www.kiyomizudera.or.jp/"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "ok" and d["platform"] is None and d["kind"] == "page"
    assert d["title"] == "清水寺" and d["description"] == "音羽山の寺" and d["author"] == "www.kiyomizudera.or.jp"
    assert d["place_suggestions"][0]["address"] == "京都市東山区清水1-294"

    monkeypatch.setattr(up, "public_addresses",
                        lambda host, port: (_ for _ in ()).throw(up.PageUnavailable("公開のページだけ読めます")))
    bad = client.post(f"/api/v1/plans/{p}/candidates/social-preview", json={"url": "http://intranet.example/"}).json()
    assert bad["status"] == "unavailable" and bad["reason"] == "page_unreadable" and "公開" in bad["message"]
