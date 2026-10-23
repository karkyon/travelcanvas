"""[Gate F45] FR-045(CA-003)項目単位の共有の規則。

- 規則(app/services/share_policy.py): 標準=INTERNAL、機密(CONFIDENTIAL)は1つずつ選び確認が要る、
  「すべて」でも機密を含めない、RESTRICTED・未知の項目は拒む、既存リンク(NULL)は標準。
- 公開閲覧は許可された項目だけをキーごと出す。予約の概要を許可しても予約番号(伏せた形も)・PIN・予約者名・
  連絡先・金額・正確な位置は出ない。
- 所有者の共有前プレビュー(発行前/発行後)は公開閲覧と同じ投影で、使用回数を消費しない。所有者以外は使えない。
- 監査にはトークン・合言葉・内容を残さず、項目名と設定の有無だけ。
"""
import json
import uuid

import pytest

from app.api.v1 import share as share_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanShareLink
from app.services import share_policy as sp

CONF = "F45CONF-7781-5678"
HOLDER = "山田花子F45"
PHONE = "090-4545-7878"


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _seed(client):
    plan_id = client.post("/api/v1/travel-plans/", json={"title": "F45共有", "destination": "京都",
                                                         "description": "家族で紅葉"}).json()["id"]
    base = f"/api/v1/plans/{plan_id}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-03", "timezone_id": "Asia/Tokyo", "title": "東山"},
                      headers=_ik()).json()
    ev = client.post(f"{base}/events", json={"day_id": day["id"], "title": "清水寺", "address": "京都市東山区清水1",
                                             "local_start_time": "10:00", "description": "入口は仁王門",
                                             "latitude": 34.9949, "longitude": 135.785}, headers=_ik())
    assert ev.status_code in (200, 201), ev.text
    r = client.post(f"{base}/reservations", json={
        "type": "accommodation", "provider_name": "祇園の宿F45", "confirmation_number": CONF,
        "holder_name": HOLDER, "contact_phone": PHONE, "total_amount": 32000, "currency": "JPY",
        "start_at": "2026-11-03T06:00:00Z", "timezone_id": "Asia/Tokyo",
    })
    assert r.status_code in (200, 201), r.text
    return plan_id


def _resolve(client, url):
    return client.post(f"/api/v1/public/share/{url.rsplit('/', 1)[-1]}/resolve", json={})


# ---------- 規則(純粋関数) ----------

def test_policy_rules():
    assert sp.resolve({})["fields"] == ["plan_description", "day_titles", "event_times"]
    assert sp.resolve({"preset": "minimal"})["fields"] == []
    # 「すべて」でも機密は含めない
    assert not set(sp.resolve({"preset": "all"})["fields"]) & set(sp.CONFIDENTIAL_FIELDS)
    with pytest.raises(sp.SharePolicyError) as e:
        sp.resolve({"fields": ["event_address"]})
    assert e.value.code == "confidential_needs_ack" and e.value.fields == ["event_address"]
    assert sp.resolve({"fields": ["event_address", "day_titles"], "acknowledge_confidential": True})["fields"] == [
        "day_titles", "event_address"]
    for bad, code in ((["confirmation_numbers"], "field_restricted"), (["tickets", "day_titles"], "field_restricted"),
                      (["nope"], "unknown_field"), ("day_titles", "invalid_fields"), ([1], "invalid_fields")):
        with pytest.raises(sp.SharePolicyError) as e:
            sp.resolve({"fields": bad, "acknowledge_confidential": True})
        assert e.value.code == code
    with pytest.raises(sp.SharePolicyError):
        sp.resolve({"preset": "everything"})
    # acknowledge は真偽値の true だけ
    with pytest.raises(sp.SharePolicyError):
        sp.resolve({"fields": ["event_notes"], "acknowledge_confidential": "yes"})
    # 保存済み(NULL=既存リンク)・壊れた値・RESTRICTED を混ぜた値
    assert sp.fields_of(None) == sp.DEFAULT_FIELDS
    assert sp.fields_of({"fields": ["tickets", "event_times", "x"]}) == ["event_times"]
    assert sp.fields_of({"fields": "event_times"}) == sp.DEFAULT_FIELDS
    cat = sp.catalog()
    assert [f["key"] for f in cat["fields"]] == sp.FIELD_ORDER
    assert {r["key"] for r in cat["restricted"]} == sp.RESTRICTED_KEYS


# ---------- API ----------

def test_default_link_shows_internal_only_and_never_restricted(auth_client):
    client, _ = auth_client
    plan_id = _seed(client)
    created = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"}).json()
    assert created["fields"] == ["plan_description", "day_titles", "event_times"]
    res = _resolve(client, created["url"])
    assert res.status_code == 200
    body = res.json()
    assert body["description"] == "家族で紅葉" and body["days"][0]["title"] == "東山"
    ev = body["days"][0]["events"][0]
    assert ev["local_start_time"] == "10:00"
    assert "address" not in ev and "notes" not in ev and "latitude" not in ev
    assert "reservations" not in body
    text = res.text
    for secret in (CONF, "5678", HOLDER, PHONE, "祇園の宿F45", "34.9949", "32000"):
        assert secret not in text


def test_minimal_hides_internal_fields(auth_client):
    client, _ = auth_client
    plan_id = _seed(client)
    created = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"preset": "minimal"}).json()
    assert created["fields"] == []
    body = _resolve(client, created["url"]).json()
    assert body["description"] is None and body["days"][0]["title"] is None
    ev = body["days"][0]["events"][0]
    assert ev == {"title": "清水寺", "event_type": ev["event_type"], "local_start_time": None, "is_all_day": False}
    assert body["title"] == "F45共有" and body["destination"] == "京都" and body["days"][0]["date"] == "2026-11-03"


def test_confidential_requires_ack_and_shows_only_summary(auth_client):
    client, _ = auth_client
    plan_id = _seed(client)
    fields = ["event_address", "event_notes", "reservation_summary"]
    bad = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"fields": fields})
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "confidential_needs_ack"
    assert sorted(bad.json()["detail"]["fields"]) == sorted(fields)
    assert client.get(f"/api/v1/travel-plans/{plan_id}/share").json() == []  # 作られていない

    restricted = client.post(f"/api/v1/travel-plans/{plan_id}/share",
                             json={"fields": ["confirmation_numbers"], "acknowledge_confidential": True})
    assert restricted.status_code == 422 and restricted.json()["detail"]["code"] == "field_restricted"

    ok = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"fields": fields, "acknowledge_confidential": True})
    assert ok.status_code == 200 and ok.json()["fields"] == fields
    res = _resolve(client, ok.json()["url"])
    body = res.json()
    ev = body["days"][0]["events"][0]
    assert ev["address"] == "京都市東山区清水1" and ev["notes"] == "入口は仁王門"
    assert ev["local_start_time"] is None  # event_times は選んでいない
    assert body["description"] is None
    assert body["reservations"] == [{"type": "accommodation", "provider_name": "祇園の宿F45", "status": "confirmed",
                                     "start": "2026-11-03 15:00", "end": None}]
    for secret in (CONF, "****", "5678", HOLDER, PHONE, "32000", "34.9949", "135.785"):
        assert secret not in res.text


def test_update_policy_and_legacy_null(auth_client, db_session):
    client, _ = auth_client
    plan_id = _seed(client)
    created = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={}).json()
    upd = client.put(f"/api/v1/travel-plans/{plan_id}/share/{created['id']}", json={"fields": ["event_notes"]})
    assert upd.status_code == 422
    upd = client.put(f"/api/v1/travel-plans/{plan_id}/share/{created['id']}", json={"preset": "minimal"})
    assert upd.status_code == 200 and upd.json()["fields"] == []
    # 他の設定だけを変えても項目は保たれる
    upd = client.put(f"/api/v1/travel-plans/{plan_id}/share/{created['id']}", json={"max_uses": 3})
    assert upd.json()["fields"] == [] and upd.json()["max_uses"] == 3
    # 本Gate以前のリンク(policy が NULL)は標準
    link = db_session.query(PlanShareLink).filter(PlanShareLink.id == created["id"]).one()
    link.policy = None
    db_session.commit()
    assert client.get(f"/api/v1/travel-plans/{plan_id}/share").json()[0]["fields"] == sp.DEFAULT_FIELDS
    body = _resolve(client, created["url"]).json()
    assert body["description"] == "家族で紅葉" and body["fields"] == sp.DEFAULT_FIELDS


def test_owner_preview_matches_public_and_does_not_consume(auth_client, make_user):
    client, _ = auth_client
    plan_id = _seed(client)
    before = client.post(f"/api/v1/travel-plans/{plan_id}/share-preview", json={"preset": "standard"})
    assert before.status_code == 200
    pv = before.json()
    assert pv["fields"] == sp.DEFAULT_FIELDS
    assert pv["withheld"] == {"reservations": 1, "confirmation_numbers": 1, "tickets": 0, "documents": 0,
                              "exact_locations": 1, "event_addresses": 1, "event_notes": 1}
    assert [f["key"] for f in pv["catalog"]["fields"]] == sp.FIELD_ORDER
    assert CONF not in before.text and HOLDER not in before.text
    # 機密は発行前のプレビューでも確認が必要
    assert client.post(f"/api/v1/travel-plans/{plan_id}/share-preview",
                       json={"fields": ["reservation_summary"]}).status_code == 422
    conf = client.post(f"/api/v1/travel-plans/{plan_id}/share-preview",
                       json={"fields": ["reservation_summary"], "acknowledge_confidential": True}).json()
    assert conf["withheld"]["reservations"] == 0 and conf["view"]["reservations"][0]["provider_name"] == "祇園の宿F45"
    assert client.post(f"/api/v1/travel-plans/{plan_id}/share-preview").status_code == 200  # 本文なし=標準

    created = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"max_uses": 1}).json()
    for _ in range(3):
        after = client.get(f"/api/v1/travel-plans/{plan_id}/share/{created['id']}/preview")
        assert after.status_code == 200
    link = client.get(f"/api/v1/travel-plans/{plan_id}/share").json()[0]
    assert link["use_count"] == 0 and link["last_accessed_at"] is None
    public = _resolve(client, created["url"]).json()
    view = after.json()["view"]
    # [Gate G4] COL-05 公開の応答だけに一時トークン・説明・複製の可否が付く(中身はプレビューと同じ)
    g4_keys = {"view_token", "view_expires_in", "allow_clone", "policy_explained"}
    assert g4_keys <= set(public)
    assert {k: v for k, v in view.items()} == {k: v for k, v in public.items() if k not in g4_keys}
    assert _resolve(client, created["url"]).status_code == 404  # 上限1回(プレビューは数えていない)

    # 所有者以外は使えない
    other, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=other, is_authenticated=True, is_guest=False)
    assert client.post(f"/api/v1/travel-plans/{plan_id}/share-preview", json={}).status_code in (403, 404)
    assert client.get(f"/api/v1/travel-plans/{plan_id}/share/{created['id']}/preview").status_code in (403, 404)
    assert client.get(f"/api/v1/travel-plans/{plan_id}/share/{uuid.uuid4()}/preview").status_code in (403, 404)


def test_audit_records_fields_without_secrets(auth_client, monkeypatch):
    client, user = auth_client
    events = []
    monkeypatch.setattr(share_api, "record_audit_event", lambda **kw: events.append(kw))
    plan_id = _seed(client)
    created = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={
        "passcode": "aikotoba-F45", "fields": ["reservation_summary"], "acknowledge_confidential": True}).json()
    client.put(f"/api/v1/travel-plans/{plan_id}/share/{created['id']}", json={"preset": "minimal"})
    client.post(f"/api/v1/travel-plans/{plan_id}/share/{created['id']}/revoke")
    client.delete(f"/api/v1/travel-plans/{plan_id}/share/{created['id']}")
    assert [e["action"] for e in events] == [
        "share_link_created", "share_link_updated", "share_link_revoked", "share_link_deleted"]
    assert events[0]["details"]["fields"] == ["reservation_summary"] and events[0]["details"]["has_passcode"] is True
    assert events[1]["details"]["changed"] == ["preset"] and events[1]["details"]["fields"] == []
    assert all(e["user_id"] == user.id and e["resource_type"] == "plan_share_link" for e in events)
    dumped = json.dumps([e["details"] for e in events], ensure_ascii=False)
    token = created["url"].rsplit("/", 1)[-1]
    for secret in (token, "aikotoba-F45", CONF, "祇園の宿F45", "F45共有"):
        assert secret not in dumped
