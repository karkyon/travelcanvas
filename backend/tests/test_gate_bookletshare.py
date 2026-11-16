"""
[Gate BookletShare] しおりの版を同行者へ送る(実 PostgreSQL)。

- 共有の材料: 送り先の候補はメンバーだけ・自分を除く・アドレスを返さない。公開の URL は作成者・所有者にだけ、
  何度でも同じ URL を返す(以前は公開した直後にしか出せなかった)。以前の乱数の鍵の版は「作り直しが要る」
- メール: 設定が無ければ 503。送り先はメンバーだけ・リンクの土台は許可したオリジンだけ・機密の版は PDF を付けない・
  公開していない版のリンクは入れない。1 人ずつ別のメール。PDF を添付。回数の上限。監査に宛先・本文を残さない
- 閲覧者・非メンバーは使えない
"""
import uuid

import pytest

from app.api.v1 import booklet as booklet_api
from app.api.v1 import booklet_share
from app.core.config import settings
from app.models.models import BookletExport
from tests.test_gate_p4_booklet import _act_as, _future, _opts, _setup

ORIGIN = "http://localhost:4173"


@pytest.fixture
def sent(monkeypatch):
    out = []
    monkeypatch.setattr(booklet_share, "_send",
                        lambda to, subject, body, pdf, name: out.append(
                            {"to": to, "subject": subject, "body": body, "pdf": pdf, "name": name}))
    monkeypatch.setattr(booklet_share.sr, "booklet_pdf", lambda snap: (b"%PDF-1.4 test", 1))
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.invalid")
    monkeypatch.setattr(settings, "EMAIL_FROM", "travelcanvas@example.invalid")
    monkeypatch.setattr(settings, "CORS_ORIGINS", [ORIGIN])
    return out


@pytest.fixture
def share_audit(monkeypatch):
    calls = []
    monkeypatch.setattr(booklet_share, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _export(client, p, **kw):
    r = client.post(f"/api/v1/plans/{p}/booklet-exports", json=_opts(**kw))
    assert r.status_code == 201, r.text
    return r.json()["export"]


def test_share_info_members_only_no_addresses(auth_client, make_user, db_session, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    client, p, owner, editor, viewer = _setup(auth_client, make_user, db_session)
    e = _export(client, p)
    info = client.get(f"/api/v1/plans/{p}/booklet-exports/{e['id']}/share")
    assert info.status_code == 200, info.text
    body = info.json()
    assert body["email_available"] is False and body["email_sandbox"] is False
    assert body["is_public"] is False and body["public_path"] is None and body["can_publish"] is True
    assert body["app_path"] == f"/planner/{p}/booklet/{e['id']}"
    ids = {r["user_id"] for r in body["recipients"]}
    assert ids == {str(editor.id), str(viewer.id)}  # 自分(所有者)は入らない
    assert all(r["has_email"] for r in body["recipients"])
    assert editor.email not in info.text and viewer.email not in info.text  # アドレスは返さない
    assert info.headers["cache-control"] == "no-store"


def test_public_url_is_recoverable_and_rotates(auth_client, make_user, db_session):
    client, p, owner, editor, _viewer = _setup(auth_client, make_user, db_session)
    e = _export(client, p)
    base = f"/api/v1/plans/{p}/booklet-exports/{e['id']}"
    web = client.post(f"{base}/publish").json()["url"]
    # 公開した後で何度開いても、同じ URL を出せる
    for _ in range(2):
        info = client.get(f"{base}/share").json()
        assert info["public_path"] == web and info["public_url_recoverable"] is True
    assert client.get(f"/api/v1/public/booklets/{web[3:]}").status_code == 200
    # 作り直すと別の URL になり、前の URL は使えない
    web2 = client.post(f"{base}/publish").json()["url"]
    assert web2 != web and client.get(f"{base}/share").json()["public_path"] == web2
    assert client.get(f"/api/v1/public/booklets/{web[3:]}").status_code == 404
    # 以前の作り方(乱数の鍵)で公開した版は、URL を出せない(作り直しが要る)
    row = db_session.query(BookletExport).filter(BookletExport.id == uuid.UUID(e["id"])).first()
    row.public_token_hash = booklet_api._token_hash("legacy-random-token")
    db_session.commit()
    info = client.get(f"{base}/share").json()
    assert info["is_public"] is True and info["public_path"] is None and info["public_url_recoverable"] is False
    assert client.get("/api/v1/public/booklets/legacy-random-token").status_code == 200
    # 作成者・所有者でない編集者には、公開の URL を出さない
    _act_as(editor)
    info = client.get(f"{base}/share").json()
    assert info["public_path"] is None and info["can_publish"] is False


def test_viewer_and_outsider_cannot_share(auth_client, make_user, db_session):
    client, p, owner, _editor, viewer = _setup(auth_client, make_user, db_session)
    e = _export(client, p)
    outsider, _ = make_user()
    for u in (viewer, outsider):
        _act_as(u)
        assert client.get(f"/api/v1/plans/{p}/booklet-exports/{e['id']}/share").status_code in (403, 404)
        assert client.post(f"/api/v1/plans/{p}/booklet-exports/{e['id']}/email", json={
            "user_ids": [str(owner.id)], "app_origin": ORIGIN}).status_code in (403, 404)


def test_email_sends_each_member_with_pdf_and_links(auth_client, make_user, db_session, sent, share_audit):
    client, p, owner, editor, viewer = _setup(auth_client, make_user, db_session)
    e = _export(client, p)
    base = f"/api/v1/plans/{p}/booklet-exports/{e['id']}"
    web = client.post(f"{base}/publish").json()["url"]
    r = client.post(f"{base}/email", json={
        "user_ids": [str(editor.id), str(viewer.id), str(editor.id)], "message": "来週の旅行のしおりです",
        "attach_pdf": True, "include_web_link": True, "include_app_link": True, "app_origin": ORIGIN + "/"})
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == 2 and r.json()["failed"] == 0
    assert sorted(m["to"] for m in sent) == sorted([editor.email, viewer.email])  # 1 人ずつ・重複なし
    m = sent[0]
    assert m["pdf"] == b"%PDF-1.4 test" and m["name"].endswith(".pdf")
    assert f"{ORIGIN}{web}" in m["body"] and f"{ORIGIN}/planner/{p}/booklet/{e['id']}" in m["body"]
    assert "来週の旅行のしおりです" in m["body"] and "しおりテスト旅行" in m["subject"]
    assert "ABC1234567" not in m["body"]
    a = share_audit[-1]
    assert a["action"] == "booklet_emailed" and a["details"]["sent"] == 2 and a["details"]["pdf"] is True
    assert editor.email not in str(a) and "来週" not in str(a)  # 宛先・本文は監査に残さない


def test_email_guards(auth_client, make_user, db_session, sent, monkeypatch):
    client, p, owner, editor, _viewer = _setup(auth_client, make_user, db_session)
    e = _export(client, p)
    base = f"/api/v1/plans/{p}/booklet-exports/{e['id']}"
    ok = {"user_ids": [str(editor.id)], "app_origin": ORIGIN, "include_web_link": False}

    def code(body, url=None):
        res = client.post(url or f"{base}/email", json=body)
        return res.status_code, (res.json().get("detail") or {}).get("code") if res.status_code != 200 else None

    # メンバーでない人・許可していないリンクの土台
    stranger, _ = make_user()
    assert code({**ok, "user_ids": [str(stranger.id)]}) == (422, "not_member")
    assert code({**ok, "app_origin": "https://evil.example"}) == (422, "origin_not_allowed")
    # 公開していない版のリンクは入れない
    assert code({**ok, "include_web_link": True}) == (409, "not_public")
    # 何も付けない
    assert code({**ok, "attach_pdf": False, "include_app_link": False}) == (422, "nothing_to_send")
    # 余計な項目(任意のアドレス)は受け付けない
    assert client.post(f"{base}/email", json={**ok, "to": ["x@example.com"]}).status_code == 422
    # 機密項目を含む版は PDF を付けない
    s = _export(client, p, includes={"confirmation_numbers": True}, valid_until=_future(10))
    assert code(ok, f"/api/v1/plans/{p}/booklet-exports/{s['id']}/email") == (409, "sensitive_no_attachment")
    assert sent == []
    # 回数の上限
    monkeypatch.setattr(booklet_share, "EMAIL_RATE_LIMIT", 1)
    assert code(ok) == (200, None)
    assert code(ok) == (429, "rate_limited")
    # 送信の設定が無い
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    assert code(ok) == (503, "email_unavailable")


def test_email_reports_failure_without_leaking(auth_client, make_user, db_session, sent, monkeypatch):
    client, p, owner, editor, viewer = _setup(auth_client, make_user, db_session)
    e = _export(client, p)

    def boom(to, *a):
        raise OSError(f"smtp refused {to}")

    monkeypatch.setattr(booklet_share, "_send", boom)
    r = client.post(f"/api/v1/plans/{p}/booklet-exports/{e['id']}/email", json={
        "user_ids": [str(editor.id)], "app_origin": ORIGIN, "include_web_link": False})
    assert r.status_code == 502 and editor.email not in r.text


def test_sandbox_flag(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "mailpit")
    assert booklet_share.email_sandbox() is True
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.gmail.com")
    assert booklet_share.email_sandbox() is False


def test_send_builds_multipart_with_pdf(monkeypatch):
    """_send は本文(UTF-8)と PDF の添付を持つメールを作り、宛先は 1 人だけにする。"""
    captured = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            captured["host"] = host

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self, context=None):
            captured["tls"] = True

        def login(self, u, pw):
            captured["login"] = u

        def sendmail(self, frm, to, raw):
            captured["to"], captured["raw"] = to, raw

    monkeypatch.setattr(booklet_share.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "SMTP_HOST", "mailpit")
    monkeypatch.setattr(settings, "SMTP_USE_TLS", False)
    monkeypatch.setattr(settings, "SMTP_USERNAME", "")
    monkeypatch.setattr(settings, "EMAIL_FROM", "tc@example.invalid")
    booklet_share._send("a@example.invalid", "件名", "本文です", b"%PDF-1.4 x", "伊勢のしおり.pdf")
    assert captured["to"] == ["a@example.invalid"] and "tls" not in captured and "login" not in captured
    raw = captured["raw"]
    assert "application/pdf" in raw and "multipart/mixed" in raw
    assert "filename*=utf-8''%E4%BC%8A%E5%8B%A2" in raw
