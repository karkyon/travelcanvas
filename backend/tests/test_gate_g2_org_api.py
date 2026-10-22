"""[Gate G2] FR-042 外部 API の書き込み・秘密と署名の鍵の切り替え・Webhook の自動の再送と dead-letter。

- 書き込み(distributions:write): 題名・お知らせの変更、改訂、停止。Idempotency-Key 必須(同じキーは同じ応答・中身の違う再送は
  422)、If-Match 必須(無ければ 428・違えば 412)、スコープが無ければ 403、他の組織の配布は 404、個人の情報を返さない
- 秘密の切り替え: 新しい秘密は1回だけ返す。猶予の間は前の秘密でも通る。猶予0・前の秘密の失効・トークンの失効
- 署名の鍵の切り替え: 猶予の間は新旧の両方で署名(どちらの鍵でも検証できる)。失効後は新しい鍵だけ
- 自動の再送: 1・5・30分…と間隔を伸ばし、上限で dead。410 Gone で Webhook を止める。手の送り直しは dead にもできる
- 監査に秘密・トークンを残さない
"""
import json
import uuid
from datetime import timedelta

import pytest

from app.api.v1 import org_external, organizations as org_router
from app.models.models import OrgApiToken, OrgWebhookDelivery
from app.services import org_api, organizations as orgs
from tests.test_gate_b1_organizations import CONF, _org, _seed_plan, _token


@pytest.fixture()
def audit(monkeypatch):
    calls = []
    monkeypatch.setattr(org_router, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(org_external, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


@pytest.fixture()
def no_send(monkeypatch):
    sent = []
    monkeypatch.setattr(org_api, "_post", lambda url, body, headers: sent.append((url, body, headers)) or 200)
    monkeypatch.setattr(org_api, "resolves_to_public", lambda host, port: True)
    monkeypatch.setattr(org_api, "deliver_pending", lambda ids: None)
    return sent


def _setup(client, scopes=("distributions:read", "distributions:write")):
    plan_id, _ = _seed_plan(client)
    org_id = _org(client)
    did = client.post(f"/api/v1/organizations/{org_id}/distributions", json={"plan_id": plan_id}).json()["id"]
    created = client.post(f"/api/v1/organizations/{org_id}/api-clients",
                          json={"name": "旅行会社G2", "scopes": list(scopes)}).json()
    tok = _token(client, created["client_id"], created["client_secret"]).json()["access_token"]
    return org_id, did, created, tok


def _h(tok, key=None, if_match=None):
    h = {"Authorization": f"Bearer {tok}"}
    if key:
        h["Idempotency-Key"] = key
    if if_match is not None:
        h["If-Match"] = if_match
    return h


def test_external_write_requires_scope_idempotency_and_if_match(auth_client, audit, no_send, db_session):
    client, _owner = auth_client
    org_id, did, created, tok = _setup(client)
    url = f"/api/v1/ext/distributions/{did}"
    got = client.get(url, headers=_h(tok))
    assert got.status_code == 200 and got.headers["etag"] == '"1"'

    key = "g2-key-" + uuid.uuid4().hex
    assert client.patch(url, json={"title": "新しい題名"}, headers=_h(tok, if_match='"1"')).status_code == 400
    assert client.patch(url, json={"title": "新しい題名"}, headers=_h(tok, key)).status_code == 428
    assert client.patch(url, json={"title": "新しい題名"}, headers=_h(tok, "g2-other-" + uuid.uuid4().hex,
                                                                      if_match='"9"')).status_code == 412
    assert client.patch(url, json={"secret": "x"}, headers=_h(tok, "g2-bad-" + uuid.uuid4().hex,
                                                              if_match='"1"')).status_code == 422
    assert client.patch(url, content=b"title=x", headers={**_h(tok, "g2-ct-" + uuid.uuid4().hex, if_match='"1"'),
                                                          "Content-Type": "text/plain"}).status_code == 415
    first = client.patch(url, json={"title": "新しい題名", "change_note": "集合時刻を変更"},
                         headers=_h(tok, key, if_match='"1"'))
    assert first.status_code == 200, first.text
    assert first.json()["title"] == "新しい題名" and first.json()["change_note"] == "集合時刻を変更"
    # 同じキーの再送は同じ応答(処理は二重にしない)・中身の違う再送は 422
    again = client.patch(url, json={"title": "新しい題名", "change_note": "集合時刻を変更"},
                         headers=_h(tok, key, if_match='"1"'))
    assert again.status_code == 200 and again.headers.get("idempotent-replayed") == "true"
    assert again.json() == first.json()
    assert client.patch(url, json={"title": "別の題名"}, headers=_h(tok, key, if_match='"1"')).status_code == 422

    # 改訂(版を上げる): 古い版の If-Match は 412、正しい版で 2 になる。Webhook の記録ができる
    hook = client.post(f"/api/v1/organizations/{org_id}/webhooks", json={
        "url": "https://hooks.example.com/g2", "events": ["distribution.revised", "distribution.revoked"]}).json()
    rk = "g2-revise-" + uuid.uuid4().hex
    assert client.post(url + "/revise", json={}, headers=_h(tok, rk, if_match='"0"')).status_code == 412
    rev = client.post(url + "/revise", json={"change_note": "宿を追加"}, headers=_h(tok, rk + "x", if_match='"1"'))
    assert rev.status_code == 200 and rev.json()["version"] == 2 and rev.headers["etag"] == '"2"'
    assert "changes" in rev.json()
    deliveries = (db_session.query(OrgWebhookDelivery)
                  .filter(OrgWebhookDelivery.webhook_id == uuid.UUID(hook["id"])).all())
    assert [d.event_type for d in deliveries] == ["distribution.revised"]
    assert deliveries[0].payload["schema_version"] == 1 and deliveries[0].next_attempt_at is not None

    # 個人の情報(予約番号・住所・メモ)は書き込みの応答にも出ない
    body = json.dumps([first.json(), rev.json()], ensure_ascii=False)
    for s in (CONF, "京都市東山区B1", "集合メモB1"):
        assert s not in body

    # 停止。停止した配布は 404
    revoke_headers = _h(tok, "g2-revoke-" + uuid.uuid4().hex, if_match='"2"')
    assert client.post(url + "/revoke", json={}, headers=revoke_headers).json()["revoked"] is True
    assert client.get(url, headers=_h(tok)).status_code == 404
    # 監査に秘密・トークンを残さない
    dumped = json.dumps(audit, ensure_ascii=False, default=str)
    assert created["client_secret"] not in dumped and tok not in dumped
    assert any(a["action"] == "org_api_distribution_revised" for a in audit)


def test_external_write_needs_write_scope_and_stays_in_own_org(auth_client, make_user, no_send):
    client, _owner = auth_client
    _org_id, did, _created, read_only = _setup(client, scopes=("distributions:read",))
    r = client.patch(f"/api/v1/ext/distributions/{did}", json={"title": "x"},
                     headers=_h(read_only, "g2-scope-" + uuid.uuid4().hex, if_match='"1"'))
    assert r.status_code == 403 and r.json() == {"error": "insufficient_scope"}
    # 別の組織のクライアントからは見えない(404)
    _org2, _did2, _c2, other = _setup(client)
    r = client.patch(f"/api/v1/ext/distributions/{did}", json={"title": "x"},
                     headers=_h(other, "g2-cross-" + uuid.uuid4().hex, if_match='"1"'))
    assert r.status_code == 404


def test_client_secret_rotation_with_grace_and_retire(auth_client, audit, no_send, db_session):
    client, _owner = auth_client
    org_id, _did, created, _tok = _setup(client)
    cid, old = created["client_id"], created["client_secret"]
    base = f"/api/v1/organizations/{org_id}/api-clients/{created['id']}"
    assert client.post(base + "/rotate-secret", json={"grace_hours": 999}).status_code == 422
    rotated = client.post(base + "/rotate-secret", json={"grace_hours": 2}).json()
    new = rotated["client_secret"]
    assert new.startswith("tcs_") and new != old and rotated["secret_version"] == 2
    assert rotated["previous_secret_valid_until"] is not None
    # 一覧には秘密を出さない
    listed = client.get(f"/api/v1/organizations/{org_id}/api-clients").json()["clients"][0]
    assert listed["client_secret"] is None and listed["secret_version"] == 2
    # 猶予の間は新旧どちらでも通る
    assert _token(client, cid, new).status_code == 200
    assert _token(client, cid, old).status_code == 200
    # 猶予を過ぎたら前の秘密は通らない
    from app.models.models import OrgApiClient
    row = db_session.query(OrgApiClient).filter(OrgApiClient.client_id == cid).one()
    row.previous_secret_expires_at = orgs.now() - timedelta(seconds=1)
    db_session.commit()
    assert _token(client, cid, old).status_code == 401
    assert _token(client, cid, new).status_code == 200
    # 猶予0: すぐに前の秘密が通らない。前の秘密の失効でトークンも消せる
    newer = client.post(base + "/rotate-secret", json={"grace_hours": 0}).json()["client_secret"]
    assert _token(client, cid, new).status_code == 401 and _token(client, cid, newer).status_code == 200
    retired = client.post(base + "/retire-previous", json={"revoke_tokens": True}).json()
    assert retired["tokens_revoked"] >= 1
    assert db_session.query(OrgApiToken).filter(OrgApiToken.client_id == row.id).count() == 0
    dumped = json.dumps(audit, ensure_ascii=False, default=str)
    for s in (old, new, newer):
        assert s not in dumped
    assert any(a["action"] == "org_api_client_secret_rotated" for a in audit)


def test_webhook_secret_rotation_signs_with_both_during_grace(auth_client, no_send):
    client, _owner = auth_client
    org_id = _org(client)
    hook = client.post(f"/api/v1/organizations/{org_id}/webhooks", json={
        "url": "https://hooks.example.com/g2rot", "events": ["distribution.published"]}).json()
    old = hook["secret"]
    base = f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}"
    rotated = client.post(base + "/rotate-secret", json={"grace_hours": 24}).json()
    new = rotated["secret"]
    assert new != old and rotated["secret_version"] == 2 and rotated["previous_secret_valid_until"]
    client.post(base + "/ping")
    _url, body, headers = no_send[-1]
    sig = headers["X-TravelCanvas-Signature"]
    assert sig.count("v1=") == 2
    assert org_api.verify_signature(new, sig, body) and org_api.verify_signature(old, sig, body)
    client.post(base + "/retire-previous")
    client.post(base + "/ping")
    _url, body, headers = no_send[-1]
    sig = headers["X-TravelCanvas-Signature"]
    assert sig.count("v1=") == 1
    assert org_api.verify_signature(new, sig, body) and not org_api.verify_signature(old, sig, body)
    # 古い時刻の署名は受け付けない(再送の拒否)
    assert not org_api.verify_signature(new, sig, body, now=int(sig.split(",")[0][2:]) + 3600)


def test_automatic_retry_backoff_dead_letter_and_gone(auth_client, no_send, db_session, monkeypatch):
    client, _owner = auth_client
    org_id = _org(client)
    hook = client.post(f"/api/v1/organizations/{org_id}/webhooks", json={
        "url": "https://hooks.example.com/g2retry", "events": ["distribution.published"]}).json()
    ids = org_api.enqueue(db_session, uuid.UUID(org_id), "distribution.published", {"distribution_id": "x"})
    db_session.commit()
    d = db_session.query(OrgWebhookDelivery).filter(OrgWebhookDelivery.id == ids[0]).one()
    monkeypatch.setattr(org_api, "_post", lambda url, body, headers: 503)
    delays = []
    t = orgs.now()
    for _ in range(org_api.MAX_ATTEMPTS):
        org_api.retry_due(db_session, now=t + timedelta(days=1))
        db_session.refresh(d)
        if d.next_attempt_at:
            delays.append(d.next_attempt_at)
    assert d.status == "dead" and d.attempts == org_api.MAX_ATTEMPTS and d.next_attempt_at is None
    assert len(delays) == org_api.MAX_ATTEMPTS - 1
    gaps = [(b - a).total_seconds() for a, b in zip(delays, delays[1:])]
    assert all(g > 0 for g in gaps)  # 間隔が伸びる
    listed = client.get(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/deliveries").json()
    assert listed[0]["status"] == "dead" and listed[0]["next_attempt_at"] is None
    # dead は自動では送らない。手で送り直せる
    assert org_api.retry_due(db_session, now=t + timedelta(days=30))["attempted"] == 0
    monkeypatch.setattr(org_api, "_post", lambda url, body, headers: 200)
    again = client.post(f"/api/v1/organizations/{org_id}/webhooks/{hook['id']}/deliveries/{d.id}/redeliver").json()
    assert again["status"] == "delivered"

    # 410 Gone: Webhook を止め、以後は送らない
    ids2 = org_api.enqueue(db_session, uuid.UUID(org_id), "distribution.published", {"distribution_id": "y"})
    db_session.commit()
    monkeypatch.setattr(org_api, "_post", lambda url, body, headers: 410)
    org_api.retry_due(db_session, now=orgs.now() + timedelta(minutes=1))
    gone = db_session.query(OrgWebhookDelivery).filter(OrgWebhookDelivery.id == ids2[0]).one()
    assert gone.status == "dead" and gone.last_error == "gone"
    h = client.get(f"/api/v1/organizations/{org_id}/webhooks").json()["webhooks"][0]
    assert h["revoked_at"] is not None and h["disabled_reason"] == "receiver_gone"
    assert org_api.enqueue(db_session, uuid.UUID(org_id), "distribution.published", {}) == []


def test_webhook_retry_job_outputs_counts_only(capsys, monkeypatch):
    from app.ops import webhook_retry

    monkeypatch.setattr(org_api, "retry_due", lambda db: {"attempted": 0, "delivered": 0, "failed": 0, "dead": 0})
    assert webhook_retry.main([]) == 0
    assert json.loads(capsys.readouterr().out) == {"ok": True, "attempted": 0, "delivered": 0, "failed": 0, "dead": 0}


def test_cron_runs_webhook_retry_every_five_minutes():
    from app.ops import opslib

    block = opslib.render_cron_block("/home/x/tc")
    assert "*/5 * * * * cd /home/x/tc && /usr/bin/python3 /home/x/tc/scripts/ops/tcops.py jobs webhook-retry" in block
