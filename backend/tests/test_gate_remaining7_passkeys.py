"""
[Gate Remaining-7] FR-003 passkey(WebAuthn)。ソフトウェアの認証器(P-256)で登録・ログインを通す。

- 登録: 問題(challenge)は署名つきの state で 1 回だけ。本人の確認(UV)が無い・origin が違う応答は断る
- ログイン: 端末の passkey の署名で入れる(多要素認証を満たした扱い)。署名の回数が戻ったら断る
- 一覧・削除は本人だけ。ゲストは作れない
"""
import base64
import hashlib
import json
import os

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

from app.core.config import settings
from app.models.models import WebauthnCredential

ORIGIN = "https://tc.example.ts.net"


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class SoftAuthenticator:
    def __init__(self, rp_id="tc.example.ts.net"):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(32)
        self.rp_hash = hashlib.sha256(rp_id.encode()).digest()
        self.count = 0

    def _cose(self) -> bytes:
        n = self.key.public_key().public_numbers()
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")})

    def create(self, options, origin=ORIGIN, uv=True):
        client = json.dumps({"type": "webauthn.create", "challenge": options["challenge"], "origin": origin}).encode()
        flags = 0x41 | (0x04 if uv else 0)
        auth = (self.rp_hash + bytes([flags]) + self.count.to_bytes(4, "big") + b"\0" * 16
                + len(self.cred_id).to_bytes(2, "big") + self.cred_id + self._cose())
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth})
        return {"id": b64(self.cred_id), "rawId": b64(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64(client), "attestationObject": b64(att), "transports": ["internal"]}}

    def get(self, options, origin=ORIGIN, count=None):
        self.count = self.count + 1 if count is None else count
        client = json.dumps({"type": "webauthn.get", "challenge": options["challenge"], "origin": origin}).encode()
        auth = self.rp_hash + bytes([0x05]) + self.count.to_bytes(4, "big")
        sig = self.key.sign(auth + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64(self.cred_id), "rawId": b64(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64(client), "authenticatorData": b64(auth), "signature": b64(sig),
                             "userHandle": None}}


@pytest.fixture(autouse=True)
def _origin(monkeypatch):
    monkeypatch.setattr(type(settings), "cors_allowed_origins", property(lambda s: [ORIGIN]), raising=False)


def _register(client, dev, **kw):
    o = client.post("/api/v1/auth/passkeys/register/options").json()
    return client.post("/api/v1/auth/passkeys/register",
                       json={"state": o["state"], "credential": dev.create(o["options"], **kw), "name": "手元の端末"})


def test_register_list_login_and_delete(auth_client, client, db_session):
    authed, user = auth_client
    dev = SoftAuthenticator()
    o = authed.post("/api/v1/auth/passkeys/register/options").json()
    assert o["options"]["rp"]["id"] == "tc.example.ts.net"
    assert o["options"]["authenticatorSelection"]["userVerification"] == "required"
    body = {"state": o["state"], "credential": dev.create(o["options"])}
    r = authed.post("/api/v1/auth/passkeys/register", json=body)
    assert r.status_code == 201, r.text
    # 同じ state は 2 回使えない
    again = authed.post("/api/v1/auth/passkeys/register", json=body)
    assert again.status_code == 400 and again.json()["detail"]["code"] == "passkey_state_invalid"
    listed = authed.get("/api/v1/auth/passkeys").json()["passkeys"]
    assert len(listed) == 1 and listed[0]["name"] == "passkey"

    lo = client.post("/api/v1/auth/passkeys/login/options").json()
    assert lo["options"]["allowCredentials"] == [] and lo["options"]["rpId"] == "tc.example.ts.net"
    li = client.post("/api/v1/auth/passkeys/login", json={"state": lo["state"], "credential": dev.get(lo["options"])})
    assert li.status_code == 200, li.text
    assert li.json()["user"]["email"] == user.email and li.json()["access_token"]
    row = db_session.query(WebauthnCredential).one()
    db_session.refresh(row)
    assert row.sign_count == 1 and row.last_used_at is not None

    # 署名の回数が戻った(複製の疑い)は断る
    lo2 = client.post("/api/v1/auth/passkeys/login/options").json()
    bad = client.post("/api/v1/auth/passkeys/login",
                      json={"state": lo2["state"], "credential": dev.get(lo2["options"], count=1)})
    assert bad.status_code == 401

    d = authed.delete(f"/api/v1/auth/passkeys/{listed[0]['id']}")
    assert d.status_code == 200 and authed.get("/api/v1/auth/passkeys").json()["passkeys"] == []


def test_registration_requires_uv_and_matching_origin(auth_client):
    authed, _ = auth_client
    dev = SoftAuthenticator()
    assert _register(authed, dev, uv=False).status_code == 400
    assert _register(authed, dev, origin="https://evil.example").status_code == 400
    assert _register(authed, SoftAuthenticator(rp_id="evil.example")).status_code == 400


def test_unknown_credential_and_guest_refused(client):
    dev = SoftAuthenticator()
    lo = client.post("/api/v1/auth/passkeys/login/options").json()
    r = client.post("/api/v1/auth/passkeys/login", json={"state": lo["state"], "credential": dev.get(lo["options"])})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "passkey_unknown"
    guest = client.post("/api/v1/auth/guest").json()
    g = client.post("/api/v1/auth/passkeys/register/options",
                    headers={"Authorization": f"Bearer {guest['access_token']}"})
    assert g.status_code in (401, 403)
