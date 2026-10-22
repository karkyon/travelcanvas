"""[Gate G2] FR-045 同行者(参加者)向けの項目の規則。所有者が隠した項目が、どの経路からも漏れないことを確かめる。

- 設定: 所有者だけが役割ごとの既定・参加者ごとの上書きを変えられる。参加者には自分に隠された項目だけを返す
- 予約を隠すと チケット・予約番号の表示 も隠れる
- 経路(閲覧者): 旅行の詳細・当日・予約・チケット・文書・費用・検索・ICS/CSV/GPX/KML・旧形式の旅行・準備状況・
  実行可能性の検証・コメント・場所の詳細
- 経路(編集者): 予定の作成・変更(隠した項目を含むと 403。応答にも出さない)・同期・しおり
- 所有者には何も隠さない。規則の無い旅行は本Gate以前と同じ(何も隠さない)
"""
import json
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.api.v1 import discussion, member_policy as mp_api, plan_search as search_api
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.core.crypto import encrypt_payload
from app.main import app
from app.models.models import Document, PlanCollaborator, Place, TravelEvent, TravelPlan
from app.services import member_policy as mp

NOTE = "集合は裏口G2メモ"
ADDR = "京都市東山区G2番地"
CONF = "G2CF-1234-8765"
DOCNAME = "保険証券G2.pdf"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    monkeypatch.setattr(mp_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(discussion, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(search_api, "check_rate_limit", lambda key, limit, window: True)
    yield
    crypto_module.reset_cache_for_tests()


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _setup(client, owner, db_session, make_user):
    p = client.post("/api/v1/travel-plans/", json={"title": "京都G2", "budget": 80000}).json()["id"]
    base = f"/api/v1/plans/{p}"
    today = datetime.now(ZoneInfo("Asia/Tokyo")).date()
    day = client.post(f"{base}/days", json={"local_date": today.isoformat(), "timezone_id": "Asia/Tokyo",
                                            "title": "1日目"}, headers=_ik()).json()
    place = Place(id=uuid.uuid4(), name="清水寺G2", address=ADDR, latitude=34.9949, longitude=135.7850,
                  created_by=owner.id)
    db_session.add(place)
    db_session.flush()
    ev = client.post(f"{base}/events", json={"day_id": day["id"], "title": "清水寺G2", "description": NOTE,
                                             "address": ADDR, "latitude": 34.9949, "longitude": 135.7850,
                                             "place_id": str(place.id),
                                             "local_start_time": (datetime.now(ZoneInfo("Asia/Tokyo"))
                                                                  + timedelta(minutes=30)).strftime("%H:%M")},
                     headers=_ik())
    assert ev.status_code == 201, ev.text
    ev = ev.json()
    res = client.post(f"{base}/reservations", json={"type": "accommodation", "provider_name": "宿G2本館",
                                                    "confirmation_number": CONF, "event_id": ev["id"],
                                                    "total_amount": 99000, "currency": "JPY"})
    assert res.status_code == 201, res.text
    rid = res.json()["id"]
    assert client.post(f"{base}/reservations/{rid}/tickets", json={"ticket_type": "entry", "payload": "QRG2"}
                       ).status_code == 201
    assert client.post(f"{base}/expenses", json={"title": "昼食G2", "amount": "2000", "currency": "JPY",
                                                 "category": "food"}).status_code == 201
    db_session.add(Document(plan_id=uuid.UUID(p), owner_user_id=owner.id, classification="internal",
                            document_type="insurance", original_filename_ciphertext=encrypt_payload(DOCNAME.encode()),
                            storage_key=f"docs/{uuid.uuid4().hex}", mime_type="application/pdf", size=10,
                            sha256="0" * 64))
    assert client.post(f"{base}/comments", json={"target_type": "reservation", "target_id": rid,
                                                 "body": "宿G2の件"}).status_code == 201
    viewer, _ = make_user()
    editor, _ = make_user()
    cv = PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                          status="accepted")
    ce = PlanCollaborator(plan_id=uuid.UUID(p), user_id=editor.id, email=editor.email, role="editor",
                          status="accepted")
    db_session.add_all([cv, ce])
    db_session.commit()
    return {"p": p, "base": base, "day": day["id"], "ev": ev["id"], "rid": rid, "place": str(place.id),
            "viewer": viewer, "editor": editor, "cv": cv, "ce": ce}


def _set_policy(client, base, **roles):
    r = client.put(f"{base}/member-policy", json={"roles": roles})
    assert r.status_code == 200, r.text
    return r.json()


def test_policy_settings_owner_only_and_expand(auth_client, make_user, db_session):
    client, owner = auth_client
    s = _setup(client, owner, db_session, make_user)
    base = s["base"]
    got = client.get(f"{base}/member-policy").json()
    assert got["role"] == "owner" and got["configured"] is False and got["roles"] == {"editor": [], "viewer": []}
    assert {c["key"] for c in got["catalog"]["categories"]} == set(mp.CATEGORIES)
    assert client.put(f"{base}/member-policy", json={"roles": {"viewer": ["nope"]}}).status_code == 422
    assert client.put(f"{base}/member-policy", json={"roles": {"owner": []}}).status_code == 422
    body = _set_policy(client, base, viewer=["reservations"])
    # 予約を隠すとチケット・予約番号の表示も隠れる
    assert body["roles"]["viewer"] == ["reservations", "reservation_secrets", "tickets"]
    by_id = {m["id"]: m for m in body["members"]}
    assert by_id[str(s["cv"].id)]["effective_hidden"] == ["reservations", "reservation_secrets", "tickets"]
    assert by_id[str(s["ce"].id)]["effective_hidden"] == []

    _act_as(s["viewer"])
    mine = client.get(f"{base}/member-policy").json()
    assert mine["role"] == "viewer" and mine["my_hidden"] == ["reservations", "reservation_secrets", "tickets"]
    assert "members" not in mine and "roles" not in mine
    assert client.put(f"{base}/member-policy", json={"roles": {"viewer": []}}).status_code == 403
    _act_as(s["editor"])
    assert client.put(f"{base}/member-policy/members/{s['cv'].id}", json={"hidden": []}).status_code == 403

    # 1人だけの上書き(空 = 何も隠さない)と、役割の既定に戻す(null)
    _act_as(owner)
    assert client.put(f"{base}/member-policy/members/{s['cv'].id}", json={"hidden": []}).status_code == 200
    _act_as(s["viewer"])
    assert client.get(f"{base}/reservations").status_code == 200
    _act_as(owner)
    assert client.put(f"{base}/member-policy/members/{s['cv'].id}", json={"hidden": None}).status_code == 200
    _act_as(s["viewer"])
    assert client.get(f"{base}/reservations").status_code == 403
    assert client.put(f"{base}/member-policy/members/{uuid.uuid4()}", json={"hidden": []}).status_code == 403


def test_viewer_sees_nothing_hidden_on_any_route(auth_client, make_user, db_session):
    client, owner = auth_client
    s = _setup(client, owner, db_session, make_user)
    base, p = s["base"], s["p"]
    # 規則が無い旅行は本Gate以前と同じ(何も隠さない)
    _act_as(s["viewer"])
    before = client.get(base).json()
    assert before["hidden_fields"] == [] and before["days"][0]["events"][0]["description"] == NOTE
    _act_as(owner)
    _set_policy(client, base, viewer=list(mp.CATEGORIES))

    _act_as(s["viewer"])
    secrets = (NOTE, ADDR, CONF, "8765", DOCNAME, "34.99", "135.78", "99000", "昼食G2")

    def clean(res):
        body = res.text
        try:
            data = res.json()
            if isinstance(data, dict) and "query" in data:  # 検索語の写しは除く(結果だけを見る)
                body = json.dumps({k: v for k, v in data.items() if k != "query"}, ensure_ascii=False)
        except ValueError:
            pass
        for x in secrets:
            assert x not in body, (res.request.url, x)

    detail = client.get(base)
    assert detail.status_code == 200
    e = detail.json()["days"][0]["events"][0]
    assert e["title"] == "清水寺G2" and e["description"] is None and e["address"] is None
    assert e["latitude"] is None and e["place_id"] is None
    assert detail.json()["hidden_fields"] == mp.CATEGORY_ORDER
    clean(detail)
    today = client.get(f"{base}/today")
    assert today.status_code == 200
    clean(today)
    for ev in today.json()["events"]:
        assert ev["reservation_id"] is None and ev["has_ticket"] is False and ev["address"] is None

    for path in (f"{base}/reservations", f"{base}/reservations/{s['rid']}", f"{base}/reservations/{s['rid']}/tickets",
                 f"{base}/documents", f"{base}/expenses", f"{base}/budgets", f"{base}/finance-summary",
                 f"{base}/exports/places.gpx", f"{base}/exports/places.kml", f"{base}/visits",
                 f"{base}/comments?target_type=reservation&target_id={s['rid']}"):
        r = client.get(path)
        assert r.status_code == 403, (path, r.status_code, r.text)
        assert r.json()["detail"]["code"] == "member_field_hidden"
        clean(r)
    assert client.post(f"{base}/reservations/{s['rid']}/reveal", json={}).status_code == 403

    for q in ("G2メモ", "東山区G2", "宿G2", "8765", "保険", "昼食G2"):
        r = client.get(f"{base}/search", params={"q": q})
        assert r.status_code == 200
        cats = {c["category"] for c in r.json()["categories"]}
        assert not cats & {"reservation", "ticket", "document", "expense", "place"}, (q, cats)
        clean(r)
    r = client.get(f"{base}/search", params={"q": "8765", "filter": "reservation"})
    assert r.json()["total"] == 0
    g = client.get("/api/v1/search/everything", params={"q": "宿G2"})
    clean(g)

    for path in (f"{base}/exports/calendar.ics?include_addresses=true",
                 f"{base}/exports/itinerary.csv?include_addresses=true"):
        r = client.get(path)
        assert r.status_code == 200, path
        clean(r)
        assert "清水寺G2" in r.text

    tp = client.get(f"/api/v1/travel-plans/{p}")
    assert tp.status_code == 200 and tp.json()["budget"] is None and tp.json()["itinerary"] is None
    lst = client.get("/api/v1/travel-plans/").json()["plans"]
    assert next(x for x in lst if x["id"] == p)["budget"] is None

    rd = client.get(f"{base}/readiness")
    assert rd.status_code == 200
    assert not [i for i in rd.json()["items"] if i["code"] in mp.READINESS_RESERVATION_CODES]
    clean(rd)

    comments = client.get(f"{base}/comments")
    assert comments.status_code == 200 and "宿G2の件" not in comments.text
    assert client.post(f"{base}/comments", json={"target_type": "reservation", "target_id": s["rid"],
                                                 "body": "x"}).status_code == 403
    assert client.get(f"/api/v1/places/{s['place']}").status_code == 404

    # 所有者には全て見える
    _act_as(owner)
    full = client.get(base).json()
    assert full["hidden_fields"] == [] and full["days"][0]["events"][0]["description"] == NOTE
    assert client.get(f"{base}/reservations").status_code == 200
    assert client.get(f"/api/v1/places/{s['place']}").status_code == 200


def test_validation_hides_budget_and_reservation_issues(auth_client, make_user, db_session):
    client, owner = auth_client
    s = _setup(client, owner, db_session, make_user)
    base = s["base"]
    assert client.post(f"{base}/constraints", json={
        "title": "予算G2", "constraint_type": "budget_limit", "hardness": "hard", "operator": "max",
        "value": {"value": 50000, "unit": "JPY"}}).status_code == 201
    run = client.post(f"{base}/validation-runs").json()
    assert any(i["code"].startswith("BUDGET_") for i in run["issues"])
    _set_policy(client, base, viewer=["costs", "reservations"])
    _act_as(s["viewer"])
    got = client.get(f"{base}/validation-runs/{run['id']}").json()
    assert not [i for i in got["issues"] if i["code"].startswith(("BUDGET_", "RESERVATION_"))]
    assert "99000" not in str(got) and "99,000" not in str(got)
    total = sum(got["counts"].values())
    assert total == len(got["issues"])
    listed = client.get(f"{base}/validation-runs").json()
    assert sum(listed[0]["counts"].values()) == total


def test_editor_cannot_write_or_read_hidden_fields(auth_client, make_user, db_session):
    client, owner = auth_client
    s = _setup(client, owner, db_session, make_user)
    base = s["base"]
    _set_policy(client, base, editor=["event_notes", "event_address", "reservations", "costs"])
    rev = client.get(base).json()["revision"]
    _act_as(s["editor"])
    url = f"{base}/events/{s['ev']}"
    r = client.put(url, json={"description": "上書き"}, headers={"If-Match": f'"{rev}"'})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "member_field_hidden"
    r = client.put(url, json={"address": "別の住所"}, headers={"If-Match": f'"{rev}"'})
    assert r.status_code == 403
    # 画面が見えない項目を空のまま送り返しても、所有者の値は消えない(変えない項目として扱う)
    ok = client.put(url, json={"title": "清水寺G2改", "description": None, "address": "", "latitude": None},
                    headers={"If-Match": f'"{rev}"'})
    assert ok.status_code == 200, ok.text
    assert ok.json()["description"] is None and ok.json()["address"] is None
    assert NOTE not in ok.text and ADDR not in ok.text
    db_session.expire_all()
    ev_row = db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(s["ev"])).first()
    assert ev_row.description == NOTE and ev_row.address == ADDR and ev_row.latitude is not None
    assert client.post(f"{base}/events", json={"day_id": s["day"], "title": "x", "description": "メモ"},
                       headers=_ik()).status_code == 403
    created = client.post(f"{base}/events", json={"day_id": s["day"], "title": "新しい予定"}, headers=_ik())
    assert created.status_code == 201, created.text
    # 経路・最適化は位置から計算するため使えない
    assert client.get(f"{base}/days/{s['day']}/route-preview").status_code == 403
    assert client.post(f"{base}/days/{s['day']}/optimization-proposal").status_code == 403
    # 同期(オフラインの変更)も隠した項目は受け付けない
    plan_rev = client.get(base).json()["revision"]
    sync = client.post(f"{base}/sync", json={"device_id": "dev-g2-0001", "operations": [{
        "operation_id": str(uuid.uuid4()), "entity_type": "event", "action": "update", "entity_id": s["ev"],
        "base_revision": plan_rev, "fields": {"description": "端末から"}}]})
    assert sync.status_code == 200, sync.text
    assert sync.json()["results"][0]["status"] == "rejected"
    assert sync.json()["results"][0]["code"] == "member_field_hidden"
    # しおり: 予約・費用・地図の章は作れない。予定の章には予約・住所を入れない
    assert client.post(f"{base}/booklet/preview", json={"sections": ["schedule", "reservations"]}).status_code == 403
    assert client.post(f"{base}/booklet/preview", json={"sections": ["costs"]}).status_code == 403
    prev = client.post(f"{base}/booklet/preview", json={"sections": ["cover", "schedule"]})
    assert prev.status_code == 200, prev.text
    assert "宿G2本館" not in prev.text and ADDR not in prev.text
    # 予算は変えられない
    assert client.put(f"/api/v1/travel-plans/{s['p']}", json={"budget": 1}).status_code == 403
    db_session.expire_all()
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(s["p"])).first()
    assert plan.budget == 80000
