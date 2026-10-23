"""[Gate G5] BILL-02 使用量の上限(原子的・soft/hard・管理者の上書き・各機能の加算)/ ORG-01 ロゴ・ドメイン・席。"""
import io
import json
import threading
import uuid

import pytest
from sqlalchemy.orm import sessionmaker

from app.api.v1 import admin as admin_api
from app.api.v1 import organizations as orgs_api
from app.api.v1 import share as share_api
from app.core.config import settings
from app.core.database import engine
from app.models.models import Organization, OrganizationDomain, OrganizationSeatEvent, UsageCounter
from app.services import org_branding, usage

from tests.test_gate_c2_candidates_places import _act_as


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    for mod in (orgs_api, share_api, admin_api):
        monkeypatch.setattr(mod, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(orgs_api, "check_rate_limit", lambda *a, **kw: True)


def _limits(monkeypatch, **user):
    monkeypatch.setattr(settings, "USAGE_LIMITS", json.dumps({"user": user}))


def _plan(client):
    r = client.post("/api/v1/travel-plans/", json={"title": "使用量の旅"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------------------------------------------------------------- BILL-02

def test_limits_config_is_validated(monkeypatch):
    monkeypatch.setattr(settings, "USAGE_LIMITS", "not json")
    assert usage.default_limit("user", "imports") == usage.DEFAULT_LIMITS["user"]["imports"]
    odd = {"user": {"imports": 7, "share_links": -1, "x": 1}, "org": {"imports": True}, "zzz": {}}
    monkeypatch.setattr(settings, "USAGE_LIMITS", json.dumps(odd))
    assert usage.default_limit("user", "imports") == 7
    assert usage.default_limit("user", "share_links") == usage.DEFAULT_LIMITS["user"]["share_links"]
    assert usage.default_limit("org", "imports") == usage.DEFAULT_LIMITS["org"]["imports"]
    with pytest.raises(ValueError):
        usage.consume(None, "team", uuid.uuid4(), "imports")  # type: ignore[arg-type]


def test_share_links_hard_limit_soft_warning_and_rollback(auth_client, db_session, monkeypatch):
    client, owner = auth_client
    _limits(monkeypatch, share_links=3)
    p = _plan(client)
    for _ in range(3):
        assert client.post(f"/api/v1/travel-plans/{p}/share", json={"permission": "view"}).status_code == 200
    r = client.post(f"/api/v1/travel-plans/{p}/share", json={"permission": "view"})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "quota_exceeded"
    assert r.json()["detail"]["metric"] == "share_links" and r.json()["detail"]["limit"] == 3
    assert len(client.get(f"/api/v1/travel-plans/{p}/share").json()) == 3  # 断った要求は何も作らない
    me = client.get("/api/v1/usage").json()
    row = next(m for m in me["metrics"] if m["metric"] == "share_links")
    assert row["used"] == 3 and row["limit"] == 3 and row["warning"] and row["exceeded"] and row["remaining"] == 0
    assert "distributions" not in [m["metric"] for m in me["metrics"]]
    counter = db_session.query(UsageCounter).filter(UsageCounter.subject_id == owner.id,
                                                    UsageCounter.metric == "share_links").one()
    assert counter.warned_at is not None and counter.period == usage.period()
    # 操作が失敗して巻き戻れば数も戻る(期限の形が悪い共有の発行)
    _limits(monkeypatch, share_links=10)
    assert client.post(f"/api/v1/travel-plans/{p}/share", json={"permission": "nope"}).status_code == 400
    db_session.expire_all()
    assert db_session.query(UsageCounter).filter(UsageCounter.subject_id == owner.id,
                                                 UsageCounter.metric == "share_links").one().used == 3


def test_admin_override_with_reason(auth_client, make_user, db_session, monkeypatch):
    client, admin = auth_client
    target, _ = make_user()
    _limits(monkeypatch, imports=1)
    assert client.get("/api/v1/admin/usage", params={"subject_type": "user", "subject_id": str(target.id)}) \
        .status_code == 403
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    admin.user_type = "admin"
    db_session.flush()
    body = {"subject_type": "user", "subject_id": str(target.id), "metric": "imports", "limit": 5}
    assert client.put("/api/v1/admin/usage/override", json=body).status_code == 422  # 理由が無い
    assert client.put("/api/v1/admin/usage/override", json={**body, "metric": "x", "reason": "r"}).status_code == 422
    assert client.put("/api/v1/admin/usage/override", json={**body, "limit": -1, "reason": "r"}).status_code == 422
    r = client.put("/api/v1/admin/usage/override", json={**body, "reason": "繁忙期の団体旅行"})
    assert r.status_code == 200, r.text
    row = next(m for m in r.json()["metrics"] if m["metric"] == "imports")
    assert row["limit"] == 5 and row["overridden"] and row["override_reason"] == "繁忙期の団体旅行"
    assert usage.consume(db_session, "user", target.id, "imports", 5)["used"] == 5
    with pytest.raises(usage.QuotaExceeded):
        usage.consume(db_session, "user", target.id, "imports")
    back = client.put("/api/v1/admin/usage/override", json={**body, "limit": None})
    assert next(m for m in back.json()["metrics"] if m["metric"] == "imports")["limit"] == 1


def test_consume_is_atomic_under_concurrency(make_user, monkeypatch):
    """別の接続から同時に加算しても上限を越えない(UPDATE ... WHERE used + n <= 上限)。"""
    _limits(monkeypatch, route_requests=5)
    Session = sessionmaker(bind=engine)
    subject = uuid.uuid4()
    ok, ng = [], []
    barrier = threading.Barrier(8)

    def worker():
        s = Session()
        try:
            barrier.wait(timeout=10)
            usage.consume(s, "user", subject, "route_requests")
            s.commit()
            ok.append(1)
        except usage.QuotaExceeded:
            s.rollback()
            ng.append(1)
        finally:
            s.close()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    s = Session()
    try:
        used = s.query(UsageCounter.used).filter(UsageCounter.subject_id == subject).scalar()
        assert len(ok) == 5 and len(ng) == 3 and used == 5
    finally:
        s.query(UsageCounter).filter(UsageCounter.subject_id == subject).delete()
        s.commit()
        s.close()


def test_uploads_imports_routes_are_counted(auth_client, db_session, monkeypatch):
    client, owner = auth_client
    p = _plan(client)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    from app.core import crypto as crypto_module

    crypto_module.reset_cache_for_tests()
    try:
        up = client.post(f"/api/v1/plans/{p}/documents/upload",
                         files={"file": ("a.pdf", b"%PDF-1.4\n%test\n", "application/pdf")})
        assert up.status_code == 201, up.text
    finally:
        crypto_module.reset_cache_for_tests()
    assert client.post(f"/api/v1/plans/{p}/imports", json={"consent_given": True}).status_code == 201
    _limits(monkeypatch, imports=1)
    r = client.post(f"/api/v1/plans/{p}/imports", json={"consent_given": True})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "quota_exceeded"
    used = {m["metric"]: m["used"] for m in client.get("/api/v1/usage").json()["metrics"]}
    assert used["upload_bytes"] == len(b"%PDF-1.4\n%test\n") and used["imports"] == 1


# ---------------------------------------------------------------- ORG-01

def _org(client, name="ロゴの会社"):
    r = client.post("/api/v1/organizations", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _png(size=(64, 32), fmt="PNG", exif=False):
    from PIL import Image

    img = Image.new("RGB", size, (200, 40, 40))
    out = io.BytesIO()
    kw = {}
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "SecretCamera"
        kw["exif"] = ex.tobytes()
    img.save(out, format=fmt, **kw)
    return out.getvalue()


def test_logo_is_validated_and_rewritten(auth_client, make_user, db_session):
    client, owner = auth_client
    org = _org(client)
    url = f"/api/v1/organizations/{org['id']}/logo"
    assert client.get(url).status_code == 404
    r = client.put(url, files={"file": ("logo.jpg", _png((1200, 600), "JPEG", exif=True), "image/jpeg")})
    assert r.status_code == 200, r.text
    assert r.json()["has_logo"] and r.json()["logo_version"]
    got = client.get(url)
    assert got.status_code == 200 and got.headers["content-type"] == "image/png"
    assert got.headers["x-content-type-options"] == "nosniff"
    assert b"SecretCamera" not in got.content
    from PIL import Image

    with Image.open(io.BytesIO(got.content)) as im:
        assert im.format == "PNG" and max(im.size) == org_branding.OUTPUT_SIZE
    for bad, code in ((b"GIF89a" + b"\0" * 20, "logo_invalid"), (b"<svg/>", "logo_invalid"),
                      (_png(fmt="GIF"), "logo_invalid"), (_png((5000, 10)), "logo_dimensions"),
                      (b"x" * (org_branding.MAX_LOGO_BYTES + 1), "logo_too_large")):
        res = client.put(url, files={"file": ("x.png", bad, "image/png")})
        assert res.status_code in (413, 422) and res.json()["detail"]["code"] == code, (code, res.text)
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    assert client.put(url, files={"file": ("e.png", eicar, "image/png")}).json()["detail"]["code"] == "logo_rejected"
    # メンバーは見られる・変えられない。メンバーでなければ 404
    member, _ = make_user()
    assert client.post(f"/api/v1/organizations/{org['id']}/members", json={"email": member.email}).status_code == 201
    _act_as(member)
    assert client.get(url).status_code == 200
    assert client.put(url, files={"file": ("l.png", _png(), "image/png")}).status_code == 403
    stranger, _ = make_user()
    _act_as(stranger)
    assert client.get(url).status_code == 404
    _act_as(owner)
    assert client.delete(url).json()["has_logo"] is False and client.get(url).status_code == 404
    listed = db_session.query(Organization).filter(Organization.id == uuid.UUID(org["id"])).one()
    assert listed.logo_sha256 is None


def test_domain_verification_with_mocked_dns(auth_client, make_user, db_session, monkeypatch):
    client, owner = auth_client
    org = _org(client)
    base = f"/api/v1/organizations/{org['id']}/domains"
    for bad in ("https://example.co.jp", "localhost", "a..b", "1.2.3.4", "foo.local", "-x.com", "x" * 300 + ".com"):
        assert client.post(base, json={"domain": bad}).status_code == 422, bad
    d = client.post(base, json={"domain": "Travel.Example.CO.JP."})
    assert d.status_code == 201, d.text
    dom = d.json()
    assert dom["domain"] == "travel.example.co.jp" and dom["status"] == "pending"
    assert dom["txt_name"] == "_travelcanvas.travel.example.co.jp"
    assert dom["txt_value"].startswith("travelcanvas-verify=")
    assert client.post(base, json={"domain": "travel.example.co.jp"}).status_code == 409
    records = {}

    def fake(name):
        if name == "_travelcanvas.broken.co.jp":
            raise LookupError("Timeout")
        return records.get(name, [])

    monkeypatch.setattr(org_branding, "resolve_txt", fake)
    r = client.post(f"{base}/{dom['id']}/verify").json()
    assert r["status"] == "failed" and r["last_error"] == "txt_not_found"
    records[dom["txt_name"]] = ["other", dom["txt_value"]]
    r = client.post(f"{base}/{dom['id']}/verify").json()
    assert r["status"] == "verified" and r["verified_at"]
    assert client.get(f"/api/v1/organizations/{org['id']}").json()["verified_domains"] == ["travel.example.co.jp"]
    # 別の組織は同じドメインを確認できない
    org2 = _org(client, "別の会社")
    d2 = client.post(f"/api/v1/organizations/{org2['id']}/domains", json={"domain": "travel.example.co.jp"}).json()
    records[d2["txt_name"]] = [d2["txt_value"]]
    taken = client.post(f"/api/v1/organizations/{org2['id']}/domains/{d2['id']}/verify")
    assert taken.status_code == 409 and taken.json()["detail"]["code"] == "domain_taken"
    # 名前解決の失敗は理由だけを残す
    d3 = client.post(base, json={"domain": "broken.co.jp"}).json()
    assert client.post(f"{base}/{d3['id']}/verify").json()["last_error"] == "dns_error:Timeout"
    # 取り消すと別の組織が確認できる
    assert client.delete(f"{base}/{dom['id']}").json()["status"] == "revoked"
    assert client.post(f"/api/v1/organizations/{org2['id']}/domains/{d2['id']}/verify").json()["status"] == "verified"
    assert client.post(f"{base}/{dom['id']}/verify").status_code == 409
    member, _ = make_user()
    client.post(f"/api/v1/organizations/{org['id']}/members", json={"email": member.email})
    _act_as(member)
    assert client.get(base).status_code == 403
    _act_as(owner)
    assert db_session.query(OrganizationDomain).filter(OrganizationDomain.status == "verified",
                                                       OrganizationDomain.domain == "travel.example.co.jp").count() == 1


def test_seat_limit(auth_client, make_user, db_session):
    client, owner = auth_client
    org = _org(client)
    oid = org["id"]
    a, _ = make_user()
    b, _ = make_user()
    assert client.post(f"/api/v1/organizations/{oid}/members", json={"email": a.email}).status_code == 201
    r = client.put(f"/api/v1/organizations/{oid}/seat-limit", json={"seat_limit": 1})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "seat_limit_below_members"
    for bad in ({"seat_limit": 0}, {"seat_limit": "3"}, {"seat_limit": True}, {}):
        assert client.put(f"/api/v1/organizations/{oid}/seat-limit", json=bad).status_code == 422, bad
    assert client.put(f"/api/v1/organizations/{oid}/seat-limit", json={"seat_limit": 2}).json()["seat_limit"] == 2
    full = client.post(f"/api/v1/organizations/{oid}/members", json={"email": b.email})
    assert full.status_code == 409 and full.json()["detail"]["code"] == "seat_limit_reached"
    seats = client.get(f"/api/v1/organizations/{oid}/seats").json()
    assert seats["seats_used"] == 2 and seats["seats_remaining"] == 0
    assert [e["event"] for e in seats["events"]][:2] == ["limit", "join"]
    mid = next(m["id"] for m in client.get(f"/api/v1/organizations/{oid}/members").json() if m["user_id"] == str(a.id))
    assert client.delete(f"/api/v1/organizations/{oid}/members/{mid}").status_code == 200
    assert client.post(f"/api/v1/organizations/{oid}/members", json={"email": b.email}).status_code == 201
    assert client.put(f"/api/v1/organizations/{oid}/seat-limit", json={"seat_limit": None}).json()["seat_limit"] is None
    events = db_session.query(OrganizationSeatEvent).filter(
        OrganizationSeatEvent.organization_id == uuid.UUID(oid)).all()
    assert sorted(e.event for e in events) == ["join", "join", "leave", "limit", "limit"]
    # 席の上限は owner だけ
    _act_as(b)
    assert client.put(f"/api/v1/organizations/{oid}/seat-limit", json={"seat_limit": 5}).status_code == 403


def test_distributions_count_against_org(auth_client, monkeypatch):
    client, _owner = auth_client
    org = _org(client)
    p = _plan(client)
    monkeypatch.setattr(settings, "USAGE_LIMITS", json.dumps({"org": {"distributions": 1}}))
    url = f"/api/v1/organizations/{org['id']}/distributions"
    assert client.post(url, json={"plan_id": p}).status_code == 201
    r = client.post(url, json={"plan_id": p})
    assert r.status_code == 429 and r.json()["detail"]["metric"] == "distributions"
    u = client.get(f"/api/v1/organizations/{org['id']}/usage").json()
    assert next(m for m in u["metrics"] if m["metric"] == "distributions")["used"] == 1
