"""[FR-062/063・監査 2026-11-23 §4.E] アカウントの書き出し・退会で、本人の行きたい場所とリールの記録を扱う。

- 全データの書き出し(/privacy/data-export)に、本人の行きたい場所(今度・また。メモ・いつ・残した元)がすべて入る
- 退会の説明に行きたい場所の数が出る
- 退会で、非公開の行きたい場所は消える(予定からの参照は外れ、予定は残る)。公開している場所は場所の情報は残し、
  本人の思い(メモ・いつ・残した元・近くの知らせ・回数)だけ消える
- 参加している旅行で書き出したリールの記録(数だけ)も消える
"""
import json
import uuid

import pytest

from app.api.v1 import privacy as privacy_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator, ReelExport, Spot, TravelEvent, TravelPlan

PASSWORD = "TestPass123!"


@pytest.fixture(autouse=True)
def _no_audit(monkeypatch):
    monkeypatch.setattr(privacy_api, "record_audit_event", lambda **kw: None)


def _spot(db, owner, name, *, public=False, **kw):
    s = Spot(id=uuid.uuid4(), name=name, category="sightseeing", latitude=34.45, longitude=136.72, created_by=owner.id,
             is_public=public, wish_kind=kw.pop("wish_kind", "next"), wish_note=kw.pop("wish_note", "春に行く"),
             wish_when="someday", source_kind="search", source_label="検索から", remind_nearby=True, again_count=2,
             client_id=f"c-{uuid.uuid4().hex[:8]}", **kw)
    db.add(s)
    db.flush()
    return s


def test_wish_spots_are_exported_and_deleted_with_the_account(auth_client, make_user, db_session):
    client, me = auth_client
    other, _ = make_user(password=PASSWORD)
    private = _spot(db_session, me, "赤福 本店")
    public = _spot(db_session, me, "おかげ横丁", public=True, wish_kind="again", wish_note="家族と")
    theirs = _spot(db_session, other, "ほかの人の場所")

    # 自分の旅行の予定が非公開の行きたい場所を指している(旅行は退会で論理削除され、行は猶予の間残る)
    plan = client.post("/api/v1/travel-plans/", json={"title": "伊勢", "destination": "伊勢"}).json()["id"]
    day = client.post(f"/api/v1/plans/{plan}/days",
                      json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"}).json()
    ev = client.post(f"/api/v1/plans/{plan}/events", json={"day_id": day["id"], "title": "赤福"}).json()
    row = db_session.get(TravelEvent, uuid.UUID(ev["id"]))
    row.spot_id = private.id
    # 参加している旅行で書き出したリールの記録
    their_plan = TravelPlan(id=uuid.uuid4(), user_id=other.id, title="友だちの旅行")
    db_session.add(their_plan)
    db_session.flush()
    db_session.add(PlanCollaborator(id=uuid.uuid4(), plan_id=their_plan.id, user_id=me.id, email=me.email,
                                    role="editor", status="accepted"))
    db_session.add(ReelExport(plan_id=their_plan.id, user_id=me.id, scope="trip", style="tiktok", duration_s=15,
                              frame_count=3, renderer="device", status="ready"))
    db_session.commit()

    # 書き出し: 本人の行きたい場所はすべて(公開も)入り、ほかの人の物は入らない
    res = client.get("/api/v1/privacy/data-export")
    assert res.status_code == 200, res.text
    body = json.loads(res.content)
    exported = {s["name"]: s for s in body["wish_spots"]}
    assert set(exported) == {"赤福 本店", "おかげ横丁"}
    assert exported["赤福 本店"]["wish_note"] == "春に行く" and exported["おかげ横丁"]["wish_kind"] == "again"

    # 退会の説明に数が出る(DB は変えない)
    pv = client.get("/api/v1/privacy/account-deletion").json()
    assert pv["wish_spots"] == 2

    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=me, is_authenticated=True, is_guest=False)
    res = client.post("/api/v1/privacy/account-deletion", json={"confirmation": "退会する", "password": PASSWORD})
    assert res.status_code == 200, res.text
    s = res.json()["summary"]
    assert (s["wish_spots"], s["public_spots_scrubbed"], s["reel_exports"]) == (1, 1, 1)

    db_session.expire_all()
    assert db_session.get(Spot, private.id) is None
    kept = db_session.get(Spot, public.id)
    assert kept is not None and kept.name == "おかげ横丁" and kept.is_public is True
    assert (kept.wish_kind, kept.wish_note, kept.wish_when, kept.source_kind, kept.source_label, kept.client_id) == (
        None, None, None, None, None, None)
    assert kept.remind_nearby is False and kept.again_count == 0
    assert db_session.get(Spot, theirs.id).wish_note == "春に行く"  # ほかの人の物は変わらない
    ev_row = db_session.get(TravelEvent, uuid.UUID(ev["id"]))
    assert ev_row is not None and ev_row.spot_id is None
    assert db_session.query(ReelExport).filter(ReelExport.user_id == me.id).count() == 0


def test_data_export_is_rate_limited_per_user(auth_client, make_user, db_session, monkeypatch):
    """[監査 2026-11-23 §3.C] 書き出しは重いので本人ごとに 1 時間の回数の上限(超えたら 429・中身は出さない)"""
    from app.api.v1 import data_export as de

    client, me = auth_client
    monkeypatch.setattr(de, "EXPORT_ACCOUNT_PER_HOUR", 2)
    monkeypatch.setattr(de, "EXPORT_PLAN_PER_HOUR", 1)
    assert client.get("/api/v1/privacy/data-export").status_code == 200
    assert client.get("/api/v1/privacy/data-export").status_code == 200
    r = client.get("/api/v1/privacy/data-export")
    assert r.status_code == 429 and r.json()["detail"]["code"] == "export_rate_limited"
    # [監査 2026-11-24] 待つ秒を返す(最も古い 1 回が 1 時間の窓から出るまで。1〜3600 秒)
    assert 3000 < int(r.headers["retry-after"]) <= 3601
    assert "wish_spots" not in r.text
    plan = client.post("/api/v1/travel-plans/", json={"title": "伊勢", "destination": "伊勢"}).json()["id"]
    assert client.get(f"/api/v1/plans/{plan}/data-export").status_code == 200
    r2 = client.get(f"/api/v1/plans/{plan}/data-export")
    assert r2.status_code == 429 and int(r2.headers["retry-after"]) >= 1
    # ほかの人は数えない
    other, _ = make_user(password=PASSWORD)
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=other, is_authenticated=True, is_guest=False)
    assert client.get("/api/v1/privacy/data-export").status_code == 200


def test_retry_after_seconds_uses_the_oldest_hit_and_falls_back_to_the_window(monkeypatch):
    """記録が無ければ窓の長さ、あれば最も古い記録が窓から出るまで(プロセス内・Redis のどちらでも同じ)"""
    from app.utils import rate_limiter as rl

    key = f"ra-test:{uuid.uuid4().hex}"
    assert rl.retry_after_seconds(key, 3600) == 3600
    assert rl.check_rate_limit(key, 1, 60) and not rl.check_rate_limit(key, 1, 60)
    assert 1 <= rl.retry_after_seconds(key, 60) <= 61
