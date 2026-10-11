"""
[Gate P4] FR-034 しおり生成 / FR-035 安全な印刷・公開 / FR-046 PDF出力の統合テスト(実PostgreSQL)。

検証する主な性質:
- しおり投影はホワイトリスト。既定では予約番号は伏字、住所・電話・参加者名・QR・個人の持ち物を含めない
- 機密項目を含めるのは所有者だけ。含めた版は作成者名の透かしと有効期限が必須で、内容は作成者だけが見られる
- 版番号はプランごとに連番。版の内容は作成時点で固定され、旅程が更新されると is_stale
- 失効・有効期限切れの版は410。失効すると保存していた内容を消去する
- 監査には設定(章・含めた項目の種類)だけを記録し、しおりの内容を記録しない
- 公開共有ページは検索エンジン除外(X-Robots-Tag)・Referrer-Policy・no-store をエラー時も返す
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import booklet as booklet_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import BookletExport, PlanCollaborator, TravelDay
from app.services import booklet

ALL_SECTIONS = list(booklet.SECTIONS)
CONFIRMATION = "ABC1234567"
PHONE = "075-123-4567"
ADDRESS = "京都府京都市東山区清水1-294"


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(booklet_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _future(days=7):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _setup(auth_client, make_user, db_session):
    """日程・予約(予約番号・電話・チケット)・持ち物(共有/個人)・費用のある旅行と、editor・viewer。"""
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "しおりテスト旅行", "destination": "京都"}).json()["id"]
    day = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                      headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    ev = client.post(f"/api/v1/plans/{p}/events",
                     json={"day_id": day["id"], "title": "清水寺", "event_type": "sightseeing",
                           "local_start_time": "10:00", "address": ADDRESS},
                     headers={"Idempotency-Key": str(uuid.uuid4())})
    assert ev.status_code == 201, ev.text
    r = client.post(f"/api/v1/plans/{p}/reservations", json={
        "type": "accommodation", "provider_name": "京の宿", "confirmation_number": CONFIRMATION,
        "contact_phone": PHONE, "start_at": "2026-11-01T06:00:00Z", "timezone_id": "Asia/Tokyo",
        "cancellation_deadline": "2030-10-30T15:00:00Z",
    })
    assert r.status_code == 201, r.text
    t = client.post(f"/api/v1/plans/{p}/reservations/{r.json()['id']}/tickets",
                    json={"ticket_type": "admission", "payload": "QR-SECRET-PAYLOAD", "barcode_format": "QR_CODE"})
    assert t.status_code == 201, t.text
    assert client.post(f"/api/v1/plans/{p}/packing-items",
                       json={"name": "折りたたみ傘", "category": "other"}).status_code == 201
    assert client.post(f"/api/v1/plans/{p}/packing-items",
                       json={"name": "常備薬", "category": "health", "scope": "personal"}).status_code == 201
    assert client.post(f"/api/v1/plans/{p}/expenses",
                       json={"title": "昼食", "amount": "3000", "currency": "JPY", "category": "food"}).status_code == 201
    assert client.post(f"/api/v1/plans/{p}/expenses",
                       json={"title": "土産", "amount": "20", "currency": "USD",
                             "category": "shopping"}).status_code == 201
    editor, _ = make_user()
    viewer, _ = make_user()
    for u, role in ((editor, "editor"), (viewer, "viewer")):
        db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=u.id, email=u.email, role=role,
                                        status="accepted"))
    db_session.commit()
    return client, p, owner, editor, viewer


def _opts(**kw):
    body = {"theme": "simple", "sections": ALL_SECTIONS}
    body.update(kw)
    return body


# ---------------------------------------------------------------- 単体

def test_section_order_and_local_time():
    assert booklet.normalize_sections(["notes", "cover", "schedule"]) == ["cover", "schedule", "notes"]
    dt = datetime(2026, 11, 1, 6, 0, tzinfo=timezone.utc)
    assert booklet.local_text(dt, "Asia/Tokyo") == "2026-11-01 15:00"
    assert booklet.local_text(dt, "Not/AZone") == "2026-11-01 06:00"
    assert booklet.local_text(None, "Asia/Tokyo") is None


# ---------------------------------------------------------------- プレビュー

def test_preview_default_is_whitelisted_and_masked(auth_client, make_user, db_session):
    client, p, owner, *_ = _setup(auth_client, make_user, db_session)
    res = client.post(f"/api/v1/plans/{p}/booklet/preview", json=_opts())
    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == "no-store"
    b = res.json()
    raw = json.dumps(b, ensure_ascii=False)
    for secret in (CONFIRMATION, PHONE, ADDRESS, "QR-SECRET-PAYLOAD", "常備薬", owner.username):
        assert secret not in raw, secret
    assert b["policy_version"] == "booklet-v1" and b["contains_sensitive"] is False
    assert b["cover"]["title"] == "しおりテスト旅行" and b["cover"]["member_count"] == 3
    ev = b["schedule"]["days"][0]["events"][0]
    assert ev["title"] == "清水寺" and ev["local_start_time"] == "10:00" and ev["address"] is None
    res_row = b["reservations"][0]
    assert res_row["confirmation"] == "******4567" and res_row["confirmation_is_full"] is False
    assert res_row["contact_phone"] is None and res_row["start"] == "2026-11-01 15:00"
    assert [i["name"] for i in b["packing"]] == ["折りたたみ傘"]
    assert b["contacts"] == {"member_count": 3, "members": None, "reservation_contacts": None,
                             "hidden": ["participants", "phones"]}
    assert b["map"]["places"][0] == {"label": "清水寺", "date": "2026-11-01", "address": None,
                                     "latitude": None, "longitude": None}
    assert b["costs"]["actual_total"] == "3000" and b["costs"]["unconverted_expenses"] == 1
    assert set(b["warnings"]) == {"qr_not_included", "unconverted_expenses"}
    assert any("無料取消期限" in n for n in b["notes"])
    assert any("QRコードは印刷物に含めていません" in n for n in b["notes"])
    # 選ばなかった章は null
    only = client.post(f"/api/v1/plans/{p}/booklet/preview", json=_opts(sections=["cover"])).json()
    assert only["sections"] == ["cover"] and only["schedule"] is None and only["warnings"] == []


def test_sensitive_includes_owner_only(auth_client, make_user, db_session, audit_calls):
    client, p, owner, editor, viewer = _setup(auth_client, make_user, db_session)
    inc = {"confirmation_numbers": True, "addresses": True, "phones": True, "participants": True}
    b = client.post(f"/api/v1/plans/{p}/booklet/preview", json=_opts(includes=inc)).json()
    assert b["contains_sensitive"] is True and "contains_sensitive" in b["warnings"]
    assert b["reservations"][0]["confirmation"] == CONFIRMATION and b["reservations"][0]["confirmation_is_full"]
    assert b["reservations"][0]["contact_phone"] == PHONE
    assert b["schedule"]["days"][0]["events"][0]["address"] == ADDRESS
    assert owner.username in b["contacts"]["members"] and len(b["contacts"]["members"]) == 3
    assert b["contacts"]["reservation_contacts"][0]["phone"] == PHONE
    # 監査は設定だけ
    assert audit_calls[-1]["action"] == "booklet_preview_sensitive"
    assert CONFIRMATION not in json.dumps(audit_calls, ensure_ascii=False, default=str)
    assert audit_calls[-1]["details"]["included"] == ["addresses", "confirmation_numbers", "participants", "phones"]

    _act_as(editor)
    res = client.post(f"/api/v1/plans/{p}/booklet/preview", json=_opts(includes={"phones": True}))
    assert res.status_code == 403 and res.json()["detail"]["code"] == "sensitive_requires_owner"
    assert client.post(f"/api/v1/plans/{p}/booklet/preview", json=_opts()).status_code == 200
    _act_as(viewer)
    assert client.post(f"/api/v1/plans/{p}/booklet/preview", json=_opts()).status_code == 403
    assert client.get(f"/api/v1/plans/{p}/booklet-exports").status_code == 403


def test_options_validation(auth_client, make_user, db_session):
    client, p, *_ = _setup(auth_client, make_user, db_session)
    url = f"/api/v1/plans/{p}/booklet/preview"
    assert client.post(url, json=_opts(theme="neon")).status_code == 422
    assert client.post(url, json=_opts(sections=[])).status_code == 422
    assert client.post(url, json=_opts(sections=["cover", "cover"])).status_code == 422
    assert client.post(url, json=_opts(sections=["qr"])).status_code == 422
    assert client.post(url, json=_opts(includes={"qr": True})).status_code == 422
    assert client.post(url, json=_opts(format="docx")).status_code == 422
    for theme in booklet.THEMES:
        assert client.post(url, json=_opts(theme=theme, sections=["cover"])).json()["theme"] == theme


# ---------------------------------------------------------------- 版

def test_export_versions_snapshot_and_stale(auth_client, make_user, db_session, audit_calls):
    client, p, owner, editor, _ = _setup(auth_client, make_user, db_session)
    first = client.post(f"/api/v1/plans/{p}/booklet-exports", json=_opts(theme="cute"))
    assert first.status_code == 201, first.text
    e1 = first.json()["export"]
    assert e1["version_no"] == 1 and e1["state"] == "active" and e1["is_stale"] is False
    assert e1["watermark_text"] is None and e1["valid_until"] is None and e1["can_view"] and e1["can_revoke"]
    assert first.json()["booklet"]["theme"] == "cute"
    assert audit_calls[-1]["action"] == "booklet_export_created"
    assert "清水寺" not in json.dumps(audit_calls, ensure_ascii=False, default=str)

    _act_as(editor)
    e2 = client.post(f"/api/v1/plans/{p}/booklet-exports", json=_opts(format="web")).json()["export"]
    assert e2["version_no"] == 2 and e2["created_by_name"] == editor.username

    # 旅程を更新すると古い版は is_stale。内容は作成時点のまま
    day = db_session.query(TravelDay).filter(TravelDay.plan_id == uuid.UUID(p)).one()
    assert client.post(f"/api/v1/plans/{p}/events", json={"day_id": str(day.id), "title": "八坂神社"},
                       headers={"Idempotency-Key": str(uuid.uuid4())}).status_code == 201
    got = client.get(f"/api/v1/plans/{p}/booklet-exports/{e1['id']}")
    assert got.status_code == 200 and got.headers["cache-control"] == "no-store"
    body = got.json()
    assert body["export"]["is_stale"] is True and body["booklet"]["is_stale"] is True
    assert "stale_revision" in body["booklet"]["warnings"]
    assert [e["title"] for e in body["booklet"]["schedule"]["days"][0]["events"]] == ["清水寺"]
    assert body["booklet"]["input_revision"] < body["booklet"]["current_revision"]
    listing = client.get(f"/api/v1/plans/{p}/booklet-exports").json()
    assert [x["version_no"] for x in listing] == [2, 1]
    assert listing[1]["is_mine"] is False and listing[1]["can_revoke"] is False
    # 保存された内容は暗号文
    row = db_session.query(BookletExport).filter(BookletExport.id == uuid.UUID(e1["id"])).one()
    assert "清水寺".encode() not in row.snapshot_ciphertext


def test_sensitive_export_guard_watermark_and_creator_only(auth_client, make_user, db_session, audit_calls):
    client, p, owner, editor, _ = _setup(auth_client, make_user, db_session)
    url = f"/api/v1/plans/{p}/booklet-exports"
    inc = {"confirmation_numbers": True}
    res = client.post(url, json=_opts(includes=inc))
    assert res.status_code == 422 and res.json()["detail"]["code"] == "valid_until_required"
    assert client.post(url, json=_opts(includes=inc, valid_until=_future(-1))).status_code == 422
    assert client.post(url, json=_opts(includes=inc, valid_until=_future(91))).status_code == 422
    assert client.post(url, json=_opts(includes=inc, valid_until="2030-01-01T00:00:00")).status_code == 422
    ok = client.post(url, json=_opts(includes=inc, valid_until=_future(10)))
    assert ok.status_code == 201, ok.text
    e = ok.json()["export"]
    assert e["contains_sensitive"] is True and e["watermark_text"] == f"{owner.username} 専用・持出注意"
    assert ok.json()["booklet"]["reservations"][0]["confirmation"] == CONFIRMATION

    assert client.get(f"{url}/{e['id']}").status_code == 200
    assert audit_calls[-1]["action"] == "booklet_export_viewed"
    _act_as(editor)
    listing = client.get(url).json()
    assert listing[0]["can_view"] is False and listing[0]["can_revoke"] is False
    denied = client.get(f"{url}/{e['id']}")
    assert denied.status_code == 403 and denied.json()["detail"]["code"] == "sensitive_creator_only"
    assert CONFIRMATION not in denied.text
    assert client.delete(f"{url}/{e['id']}").status_code == 403


def test_revoke_and_expiry(auth_client, make_user, db_session):
    client, p, owner, editor, _ = _setup(auth_client, make_user, db_session)
    url = f"/api/v1/plans/{p}/booklet-exports"
    _act_as(editor)
    e = client.post(url, json=_opts()).json()["export"]
    _act_as(owner)
    revoked = client.delete(f"{url}/{e['id']}")
    assert revoked.status_code == 200 and revoked.json()["export"]["state"] == "revoked"
    assert revoked.json()["export"]["can_view"] is False
    gone = client.get(f"{url}/{e['id']}")
    assert gone.status_code == 410 and gone.json()["detail"]["code"] == "revoked"
    row = db_session.query(BookletExport).filter(BookletExport.id == uuid.UUID(e["id"])).one()
    db_session.refresh(row)
    assert row.snapshot_ciphertext is None and row.revoked_at is not None
    assert client.delete(f"{url}/{e['id']}").status_code == 200  # 二重の失効は何もしない

    s = client.post(url, json=_opts(includes={"addresses": True}, valid_until=_future(1))).json()["export"]
    row = db_session.query(BookletExport).filter(BookletExport.id == uuid.UUID(s["id"])).one()
    row.valid_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()
    expired = client.get(f"{url}/{s['id']}")
    assert expired.status_code == 410 and expired.json()["detail"]["code"] == "expired"
    assert client.get(url).json()[0]["state"] == "expired"
    assert client.get(f"{url}/{uuid.uuid4()}").status_code == 404
    assert client.get(f"{url}/not-a-uuid").status_code == 404


def test_outsider_cannot_access(auth_client, make_user, db_session):
    client, p, *_ = _setup(auth_client, make_user, db_session)
    e = client.post(f"/api/v1/plans/{p}/booklet-exports", json=_opts()).json()["export"]
    stranger, _ = make_user()
    _act_as(stranger)
    assert client.get(f"/api/v1/plans/{p}/booklet-exports/{e['id']}").status_code == 403
    assert client.post(f"/api/v1/plans/{p}/booklet/preview", json=_opts()).status_code == 403


# ---------------------------------------------------------------- 公開ページ

def test_public_share_is_noindex(client, auth_client):
    owner_client, _ = auth_client
    p = owner_client.post("/api/v1/travel-plans/", json={"title": "公開テスト"}).json()["id"]
    token = owner_client.post(f"/api/v1/travel-plans/{p}/share", json={"permission": "view"}).json()["url"]
    token = token.rsplit("/", 1)[-1]
    ok = client.post(f"/api/v1/public/share/{token}/resolve", json={})
    assert ok.status_code == 200
    bad = client.post("/api/v1/public/share/invalid-token/resolve", json={})
    assert bad.status_code == 404
    for res in (ok, bad):
        assert res.headers["x-robots-tag"] == "noindex, nofollow"
        assert res.headers["referrer-policy"] == "no-referrer"
        assert res.headers["cache-control"] == "no-store"
