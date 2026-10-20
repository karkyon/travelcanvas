"""[Gate B1] FR-041 組織・B2B(最小形)/ FR-042 API・Webhook(最小形)。

- 役割: owner・admin・member。メンバーでない人には 404、役割が足りなければ 403、最後の owner は外せない。ゲストは使えない。
- 配布: 写しは標準の共有項目だけ(予約・番号・住所・メモ・位置を写さない)。版の改訂・閲覧確認(古い版の確認は未確認)・
  複製(自分の旅行。以後の改訂で変わらない)。管理者でもメンバー個人の旅行(複製したもの)は見られない。
- 外部連携: client_credentials(Basic・本文)、スコープ、無効な資格・期限切れ・失効・スコープ不足、回数制限、監査に秘密なし。
- Webhook: https だけ・内部のアドレスは拒否、署名の検証、記録と再送、本文に個人・秘密の値が無い。
- 退会: 所属を外し、最後の owner なら admin を owner に、誰もいなければ組織と外部連携を止める。
"""
import base64
import json
import uuid
from datetime import timedelta

import pytest

from app.api.v1 import org_external, organizations as org_router
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import OrgApiToken, OrgWebhookDelivery, User
from app.services import org_api, organizations as orgs

CONF = "B1CONF-4242-9999"


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture()
def audit(monkeypatch):
    calls = []
    monkeypatch.setattr(org_router, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(org_external, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


@pytest.fixture()
def no_send(monkeypatch):
    """送信は記録だけ(外へは出さない)。名前解決は公開のアドレスとして扱う。"""
    sent = []
    monkeypatch.setattr(org_api, "_post", lambda url, body, headers: sent.append((url, body, headers)) or 200)
    monkeypatch.setattr(org_api, "resolves_to_public", lambda host, port: True)
    monkeypatch.setattr(org_api, "deliver_pending", lambda ids: None)
    return sent


def _seed_plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "修学旅行B1", "destination": "京都",
                                                   "description": "持ち物は前日に確認"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d = client.post(f"{base}/days", json={"local_date": "2026-11-03", "timezone_id": "Asia/Tokyo", "title": "1日目"},
                    headers=_ik()).json()
    client.post(f"{base}/events", json={"day_id": d["id"], "title": "清水寺B1", "address": "京都市東山区B1",
                                        "local_start_time": "10:00", "description": "集合メモB1",
                                        "latitude": 34.99, "longitude": 135.78}, headers=_ik())
    client.post(f"{base}/reservations", json={"type": "accommodation", "provider_name": "宿B1",
                                              "confirmation_number": CONF})
    return p, d["id"]


def _org(client, name="B1学校"):
    r = client.post("/api/v1/organizations", json={"name": name, "brand_color": "#1D4ED8"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _add(client, org_id, user, role="member"):
    r = client.post(f"/api/v1/organizations/{org_id}/members", json={"email": user.email, "role": role})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- 組織と役割 ----------

def test_roles_and_membership_rules(auth_client, make_user, audit):
    client, owner = auth_client
    admin, _ = make_user()
    member, _ = make_user()
    stranger, _ = make_user()
    org_id = _org(client)
    assert client.get("/api/v1/organizations").json()[0]["role"] == "owner"
    admin_mid = _add(client, org_id, admin, "admin")
    member_mid = _add(client, org_id, member)
    assert client.post(f"/api/v1/organizations/{org_id}/members", json={"email": member.email}).status_code == 409
    assert client.post(f"/api/v1/organizations/{org_id}/members",
                       json={"email": "nobody-b1@example.com"}).json()["detail"]["code"] == "user_not_found"
    assert client.post(f"/api/v1/organizations/{org_id}/members",
                       json={"email": stranger.email, "role": "owner"}).status_code == 422

    # 関係のない人には存在も見せない
    _as(stranger)
    assert client.get(f"/api/v1/organizations/{org_id}").status_code == 404
    assert client.get(f"/api/v1/organizations/{org_id}/distributions").status_code == 404
    # member は管理できない
    _as(member)
    assert client.get(f"/api/v1/organizations/{org_id}").json()["role"] == "member"
    assert client.get(f"/api/v1/organizations/{org_id}/members").status_code == 403
    assert client.post(f"/api/v1/organizations/{org_id}/api-clients",
                       json={"name": "x", "scopes": ["distributions:read"]}).status_code == 403
    # admin はメンバーを足せるが、役割の変更(owner)はできない・owner を外せない
    _as(admin)
    r = client.patch(f"/api/v1/organizations/{org_id}/members/{member_mid}", json={"role": "admin"})
    assert r.status_code == 403
    members = client.get(f"/api/v1/organizations/{org_id}/members").json()
    owner_mid = next(m["id"] for m in members if m["role"] == "owner")
    assert client.delete(f"/api/v1/organizations/{org_id}/members/{owner_mid}").status_code == 403
    # 最後の owner は降格・脱退できない
    _as(owner)
    r = client.patch(f"/api/v1/organizations/{org_id}/members/{owner_mid}", json={"role": "member"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "last_owner"
    assert client.delete(f"/api/v1/organizations/{org_id}/members/{owner_mid}").status_code == 409
    r = client.patch(f"/api/v1/organizations/{org_id}/members/{admin_mid}", json={"role": "owner"})
    assert r.status_code == 200
    assert client.delete(f"/api/v1/organizations/{org_id}/members/{owner_mid}").status_code == 200  # もう1人の owner がいる
    # 監査にメールアドレスを残さない
    dumped = json.dumps([a["details"] for a in audit], ensure_ascii=False)
    for u in (admin, member, stranger):
        assert u.email not in dumped
    # 入力の検査
    _as(admin)
    assert client.post("/api/v1/organizations", json={"name": ""}).status_code == 422
    assert client.post("/api/v1/organizations", json={"name": "x", "brand_color": "red"}).status_code == 422


def test_guest_cannot_use_organizations(client, make_user):
    guest = User(id=uuid.uuid4(), username=f"g{uuid.uuid4().hex[:6]}", user_type="guest", is_active=True)
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=guest, is_authenticated=True, is_guest=True)
    try:
        assert client.get("/api/v1/organizations").status_code == 401
        assert client.post("/api/v1/organizations", json={"name": "g"}).status_code == 401
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ---------- 配布・改訂・確認・複製 ----------

def test_distribution_snapshot_revise_ack_fork(auth_client, make_user, audit, no_send):
    client, owner = auth_client
    member, _ = make_user()
    plan_id, day_id = _seed_plan(client)
    org_id = _org(client)
    _add(client, org_id, member)
    r = client.post(f"/api/v1/organizations/{org_id}/distributions", json={"plan_id": plan_id})
    assert r.status_code == 201, r.text
    dist = r.json()
    did = dist["id"]
    snap = dist["snapshot"]
    assert snap["title"] == "修学旅行B1" and snap["days"][0]["title"] == "1日目"
    assert snap["days"][0]["events"][0] == {"title": "清水寺B1", "event_type": "activity", "local_start_time": "10:00",
                                            "is_all_day": False}
    text = json.dumps(snap, ensure_ascii=False)
    for secret in (CONF, "9999", "宿B1", "京都市東山区B1", "集合メモB1", "34.99", plan_id, day_id):
        assert secret not in text
    assert dist["ack_status"] == {"members": 2, "acknowledged_latest": 0, "pending": 2}
    # 自分のでない旅行は配布できない
    other, _ = make_user()
    _as(other)
    other_plan = client.post("/api/v1/travel-plans/", json={"title": "他人の旅"}).json()["id"]
    _as(owner)
    assert client.post(f"/api/v1/organizations/{org_id}/distributions",
                       json={"plan_id": other_plan}).status_code in (403, 404)

    # メンバー: 見る・確認・複製
    _as(member)
    lst = client.get(f"/api/v1/organizations/{org_id}/distributions").json()
    assert lst[0]["acknowledged"] is False and lst[0]["ack_status"] is None  # 件数は管理者だけ
    assert client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/acknowledge",
                       json={"version": 2}).status_code == 409
    ack = client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/acknowledge", json={"version": 1})
    assert ack.status_code == 200 and ack.json()["acknowledged"] is True
    assert client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/acknowledge",
                       json={"version": 1}).status_code == 200  # 二度押しは同じ結果
    fork = client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/fork").json()
    fork_id = fork["plan_id"]
    detail = client.get(f"/api/v1/plans/{fork_id}").json()
    assert [e["title"] for d in detail["days"] for e in d["events"]] == ["清水寺B1"]
    assert detail["days"][0]["events"][0].get("address") in (None, "")
    assert client.get(f"/api/v1/plans/{fork_id}/reservations").json() == []
    assert client.get(f"/api/v1/organizations/{org_id}/distributions/{did}/acknowledgements").status_code == 403

    # 管理者: 確認の状況。改訂で版が上がり、古い版の確認は「未確認」になる。複製した旅行は変わらない
    _as(owner)
    acks = client.get(f"/api/v1/organizations/{org_id}/distributions/{did}/acknowledgements").json()
    assert acks["acknowledged_latest"] == 1 and {m["acked_version"] for m in acks["members"]} == {None, 1}
    assert "email" not in json.dumps(acks)
    client.post(f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": "金閣寺B1",
                                                         "local_start_time": "14:00"}, headers=_ik())
    assert client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/revise",
                       json={"base_version": 5}).status_code == 409
    rev = client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/revise",
                      json={"change_note": "午後を追加", "base_version": 1})
    assert rev.status_code == 200, rev.text
    assert rev.json()["version"] == 2 and rev.json()["changes"]["events_added"] == 1
    assert rev.json()["ack_status"]["acknowledged_latest"] == 0
    # 管理者でもメンバー個人の旅行(複製したもの)は見られない
    assert client.get(f"/api/v1/plans/{fork_id}").status_code in (403, 404)
    _as(member)
    assert len(client.get(f"/api/v1/plans/{fork_id}").json()["days"][0]["events"]) == 1
    me = client.get(f"/api/v1/organizations/{org_id}/distributions/{did}").json()
    assert me["version"] == 2 and me["my_ack_version"] == 1 and me["acknowledged"] is False
    assert me["change_note"] == "午後を追加"

    # 配布をやめると、メンバーには見えない
    _as(owner)
    assert client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/revoke").status_code == 200
    _as(member)
    assert client.get(f"/api/v1/organizations/{org_id}/distributions").json() == []
    assert client.get(f"/api/v1/organizations/{org_id}/distributions/{did}").status_code == 404
    actions = [a["action"] for a in audit]
    assert {"org_distribution_published", "org_distribution_revised", "org_distribution_revoked",
            "org_distribution_forked"} <= set(actions)


# ---------- 外部 API ----------

def _client(client, org_id, scopes):
    r = client.post(f"/api/v1/organizations/{org_id}/api-clients", json={"name": "旅行会社B1", "scopes": scopes})
    assert r.status_code == 201, r.text
    return r.json()


def _token(client, cid, secret, scope=None, basic=False):
    data = {"grant_type": "client_credentials"}
    headers = {}
    if basic:
        headers["Authorization"] = "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode()
    else:
        data.update(client_id=cid, client_secret=secret)
    if scope:
        data["scope"] = scope
    return client.post("/api/v1/oauth/token", data=data, headers=headers)


def test_external_api_client_credentials_scopes(auth_client, make_user, audit, no_send, db_session):
    client, owner = auth_client
    plan_id, _ = _seed_plan(client)
    org_id = _org(client)
    did = client.post(f"/api/v1/organizations/{org_id}/distributions", json={"plan_id": plan_id}).json()["id"]
    other_org = _org(client, "別の組織B1")
    other_did = client.post(f"/api/v1/organizations/{other_org}/distributions", json={"plan_id": plan_id}).json()["id"]
    created = _client(client, org_id, ["distributions:read"])
    cid, secret = created["client_id"], created["client_secret"]
    assert secret.startswith("tcs_")
    listed = client.get(f"/api/v1/organizations/{org_id}/api-clients").json()
    assert listed["clients"][0]["client_secret"] is None and secret not in json.dumps(listed)

    app.dependency_overrides.pop(get_current_user, None)  # 外部からは利用者として認証しない
    assert client.post("/api/v1/oauth/token", json={"grant_type": "client_credentials"}).status_code == 400
    assert _token(client, cid, "wrong").status_code == 401
    assert _token(client, cid, "wrong").json() == {"error": "invalid_client"}
    r = client.post("/api/v1/oauth/token", data={"grant_type": "password", "client_id": cid, "client_secret": secret})
    assert r.json()["error"] == "unsupported_grant_type"
    assert _token(client, cid, secret, scope="acknowledgements:read").json()["error"] == "invalid_scope"
    res = _token(client, cid, secret, basic=True)
    assert res.status_code == 200 and res.headers["cache-control"] == "no-store"
    body = res.json()
    assert body["token_type"] == "Bearer" and body["expires_in"] == 3600 and body["scope"] == "distributions:read"
    tok = body["access_token"]
    H = {"Authorization": f"Bearer {tok}"}

    lst = client.get("/api/v1/ext/distributions", headers=H)
    assert lst.status_code == 200 and lst.headers["cache-control"] == "no-store"
    assert [d["id"] for d in lst.json()["distributions"]] == [did]  # 他の組織の配布は見えない
    one = client.get(f"/api/v1/ext/distributions/{did}", headers=H).json()
    assert one["snapshot"]["title"] == "修学旅行B1" and CONF not in json.dumps(one, ensure_ascii=False)
    assert client.get(f"/api/v1/ext/distributions/{other_did}", headers=H).status_code == 404
    r = client.get(f"/api/v1/ext/distributions/{did}/acknowledgements", headers=H)
    assert r.status_code == 403 and r.json() == {"error": "insufficient_scope"}
    assert 'scope="acknowledgements:read"' in r.headers["www-authenticate"]
    assert client.get("/api/v1/ext/distributions", headers={"Authorization": "Bearer tcat_nope"}).status_code == 401
    assert client.get("/api/v1/ext/distributions").status_code == 401
    # 利用者のトークンでは外部 API を使えず、外部のトークンでは利用者の API を使えない
    assert client.get("/api/v1/organizations", headers=H).status_code in (401, 403)

    # 期限切れ
    row = db_session.query(OrgApiToken).first()
    row.expires_at = row.expires_at - timedelta(hours=2)
    db_session.commit()
    assert client.get("/api/v1/ext/distributions", headers=H).status_code == 401

    # 失効したクライアントは新しいトークンも、既存のトークンも使えない
    tok2 = _token(client, cid, secret).json()["access_token"]
    _as(owner)
    client.post(f"/api/v1/organizations/{org_id}/api-clients/{created['id']}/revoke")
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/api/v1/ext/distributions", headers={"Authorization": f"Bearer {tok2}"}).status_code == 401
    assert _token(client, cid, secret).status_code == 401

    # 監査: クライアント ID と経路の型だけ(秘密・トークンは残さない)
    calls = [a for a in audit if a["action"] == "org_api_call"]
    assert calls and calls[0]["details"] == {"api_client": cid, "route": "/api/v1/ext/distributions"}
    dumped = json.dumps([a["details"] for a in audit], ensure_ascii=False)
    for s in (secret, tok, tok2):
        assert s not in dumped


def test_external_api_rate_limit(auth_client, no_send, monkeypatch):
    client, owner = auth_client
    org_id = _org(client)
    created = _client(client, org_id, ["distributions:read"])
    app.dependency_overrides.pop(get_current_user, None)
    tok = _token(client, created["client_id"], created["client_secret"]).json()["access_token"]
    monkeypatch.setattr(org_external, "check_rate_limit", lambda key, limit, window: not key.startswith("org_api:"))
    r = client.get("/api/v1/ext/distributions", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 429 and r.json() == {"error": "rate_limited"}
    monkeypatch.setattr(org_external, "check_rate_limit", lambda key, limit, window: False)
    assert _token(client, created["client_id"], created["client_secret"]).status_code == 429


# ---------- Webhook ----------

def test_webhook_url_rules():
    for url in ("http://example.com/h", "https://localhost/h", "https://127.0.0.1/h", "https://10.0.0.5/h",
                "https://[::1]/h", "https://169.254.169.254/latest", "https://user:pw@example.com/h",
                "https://svc.internal/h", "ftp://example.com", "https://exa mple.com", None, "https://"):
        with pytest.raises(ValueError):
            org_api.check_url(url)
    assert org_api.check_url("https://hooks.example.com/travel?x=1") == "https://hooks.example.com/travel?x=1"
    assert org_api.resolves_to_public("localhost", 443) is False


def test_webhook_signing_delivery_and_redelivery(auth_client, make_user, no_send, db_session):
    client, owner = auth_client
    member, _ = make_user()
    plan_id, _ = _seed_plan(client)
    org_id = _org(client)
    _add(client, org_id, member)
    assert client.post(f"/api/v1/organizations/{org_id}/webhooks",
                       json={"url": "https://127.0.0.1/h", "events": ["distribution.published"]}).json()["detail"][
        "code"] == "blocked_host"
    assert client.post(f"/api/v1/organizations/{org_id}/webhooks",
                       json={"url": "https://hooks.example.com/b1", "events": ["nope"]}).status_code == 422
    hook = client.post(f"/api/v1/organizations/{org_id}/webhooks", json={
        "url": "https://hooks.example.com/b1",
        "events": ["distribution.published", "distribution.acknowledged"]}).json()
    secret = hook["secret"]
    assert secret.startswith("whsec_")
    assert client.get(f"/api/v1/organizations/{org_id}/webhooks").json()["webhooks"][0]["secret"] is None

    # ping はその場で送る。署名を受け手の方法で検証できる
    ping = client.post(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/ping").json()
    assert ping["status"] == "delivered" and ping["last_status_code"] == 200
    url, body, headers = no_send[-1]
    assert url == "https://hooks.example.com/b1"
    assert org_api.verify_signature(secret, headers["X-TravelCanvas-Signature"], body)
    assert not org_api.verify_signature("whsec_wrong", headers["X-TravelCanvas-Signature"], body)
    assert not org_api.verify_signature(secret, headers["X-TravelCanvas-Signature"], body + b" ")
    assert headers["X-TravelCanvas-Event"] == "ping" and headers["X-TravelCanvas-Event-Id"] == ping["event_id"]

    # 配布・確認で記録ができる(購読していない「改訂」は作らない)。本文は ID・版・件数だけ
    did = client.post(f"/api/v1/organizations/{org_id}/distributions", json={"plan_id": plan_id}).json()["id"]
    _as(member)
    client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/acknowledge", json={"version": 1})
    _as(owner)
    client.post(f"/api/v1/organizations/{org_id}/distributions/{did}/revise", json={})
    rows = db_session.query(OrgWebhookDelivery).filter(OrgWebhookDelivery.event_type != "ping").all()
    assert sorted(r.event_type for r in rows) == ["distribution.acknowledged", "distribution.published"]
    payloads = json.dumps([r.payload for r in rows], ensure_ascii=False)
    for s in (member.email, member.username, "修学旅行B1", CONF, str(member.id)):
        assert s not in payloads
    ack = next(r for r in rows if r.event_type == "distribution.acknowledged")
    assert ack.payload["data"] == {"distribution_id": did, "version": 1, "members": 2, "acknowledged_latest": 1}

    # 記録を送る(BackgroundTasks の送り先)。失敗は記録され、送り直せる
    pending = rows[0]
    org_api.deliver(db_session, pending)
    assert pending.status == "delivered"
    failing = rows[1]
    import app.services.org_api as mod
    mod._post = lambda url, body, headers: 500  # noqa: E731 - no_send の差し替えの後で、この試験だけ失敗させる
    org_api.deliver(db_session, failing)
    db_session.commit()
    assert failing.status == "failed" and failing.last_status_code == 500 and failing.last_error == "http_status"
    lst = client.get(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/deliveries").json()
    assert {d["status"] for d in lst} >= {"delivered", "failed"}
    mod._post = lambda url, body, headers: 204  # noqa: E731
    again = client.post(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/deliveries/{failing.id}/redeliver")
    assert again.json()["status"] == "delivered" and again.json()["attempts"] == 2
    assert client.post(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/deliveries/{failing.id}/redeliver"
                       ).status_code == 409
    # 名前解決で内部のアドレスになる宛先へは送らない
    mod.resolves_to_public = lambda host, port: False  # noqa: E731
    blocked = client.post(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/ping").json()
    assert blocked["status"] == "failed" and blocked["last_error"] == "blocked_host"
    # 止めた Webhook には送らない
    client.post(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/revoke")
    assert client.post(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/ping").status_code == 409


# ---------- 退会 ----------

def test_account_deletion_hands_over_or_closes_organizations(auth_client, make_user, db_session, no_send):
    client, owner = auth_client
    admin, _ = make_user()
    org_a = _org(client, "引き継ぐB1")
    _add(client, org_a, admin, "admin")
    org_b = _org(client, "閉じるB1")
    created = _client(client, org_b, ["distributions:read"])
    db_session.flush()
    from app.services import account_deletion
    summary = account_deletion.delete_account(db_session, db_session.query(User).get(owner.id))
    db_session.commit()
    assert summary["organization_memberships"] == 2
    _as(admin)
    assert client.get(f"/api/v1/organizations/{org_a}").json()["role"] == "owner"
    from app.models.models import Organization, OrgApiClient
    assert db_session.query(Organization).get(uuid.UUID(org_b)).deleted_at is not None
    assert db_session.query(OrgApiClient).filter(OrgApiClient.client_id == created["client_id"]).one().revoked_at
    app.dependency_overrides.pop(get_current_user, None)
    assert _token(client, created["client_id"], created["client_secret"]).status_code == 401


def test_snapshot_changes_counts():
    old = {"days": [{"date": "2026-11-03", "events": [{"title": "A", "local_start_time": "10:00"}]}]}
    new = {"days": [{"date": "2026-11-03", "events": [{"title": "A", "local_start_time": "11:00"}, {"title": "B"}]}]}
    assert orgs.snapshot_changes(old, new) == {"events_added": 1, "events_removed": 0, "events_changed": 1,
                                               "days_before": 1, "days_after": 1}
