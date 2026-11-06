"""[Gate BookletTiers] しおりのデザインの会員クラス別の開放と「リゾート」のデザイン。

- 今は全てのデザインを全員(ゲスト・Free を含む)に開放(利用者の判断 2026-11-06)
- 表(THEME_MIN_TIER)を上位のクラスへ変えると、下のクラスのプレビュー・版の作成をサーバーが 403 で断る
- 一覧(GET /plans/{id}/booklet/themes)は使える最も低いクラスと、この人が使えるかを返す
"""
import uuid

from app.models.models import Entitlement
from app.services import booklet
from app.services import cost_guard as cg

SECTIONS = ["cover", "schedule"]


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "石垣島", "destination": "石垣島"}).json()["id"]
    client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-12-01", "timezone_id": "Asia/Tokyo"},
                headers={"Idempotency-Key": str(uuid.uuid4())})
    return p


def test_theme_rules():
    assert "resort" in booklet.THEMES
    assert set(booklet.THEME_MIN_TIER) == set(booklet.THEMES)
    assert all(v == "free" for v in booklet.THEME_MIN_TIER.values())  # 今は全部開放
    assert booklet.theme_allowed("resort", "guest") and booklet.theme_allowed("resort", "free")
    assert not booklet.theme_allowed("unknown", "explorer")
    assert not booklet.theme_allowed("simple", "unknown_class")


def test_resort_preview_and_export_for_free(auth_client):
    client, _owner = auth_client
    p = _plan(client)
    r = client.get(f"/api/v1/plans/{p}/booklet/themes")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_class"] == "free"
    assert {t["theme"] for t in body["themes"]} == set(booklet.THEMES)
    assert all(t["available"] for t in body["themes"])
    r = client.post(f"/api/v1/plans/{p}/booklet/preview", json={"theme": "resort", "sections": SECTIONS})
    assert r.status_code == 200, r.text
    assert r.json()["theme"] == "resort"
    r = client.post(f"/api/v1/plans/{p}/booklet-exports", json={"theme": "resort", "sections": SECTIONS, "format": "web"})  # noqa: E501
    assert r.status_code == 201, r.text


def test_locked_theme_is_refused_by_server_and_opens_with_class(auth_client, db_session, monkeypatch):
    client, owner = auth_client
    p = _plan(client)
    monkeypatch.setitem(booklet.THEME_MIN_TIER, "resort", "journey")
    themes = {t["theme"]: t for t in client.get(f"/api/v1/plans/{p}/booklet/themes").json()["themes"]}
    assert themes["resort"] == {"theme": "resort", "min_tier": "journey", "available": False}
    r = client.post(f"/api/v1/plans/{p}/booklet/preview", json={"theme": "resort", "sections": SECTIONS})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "tier_feature_not_included"
    assert r.json()["detail"]["min_tier"] == "journey"
    r = client.post(f"/api/v1/plans/{p}/booklet-exports", json={"theme": "resort", "sections": SECTIONS, "format": "web"})  # noqa: E501
    assert r.status_code == 403
    assert client.post(f"/api/v1/plans/{p}/booklet/preview", json={"theme": "simple", "sections": SECTIONS}).status_code == 200  # noqa: E501
    db_session.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=owner.id,
                               feature_key=cg.FEATURE_PREFIX + "class.journey", status="active", source="admin"))
    db_session.commit()
    assert client.post(f"/api/v1/plans/{p}/booklet/preview", json={"theme": "resort", "sections": SECTIONS}).status_code == 200  # noqa: E501
