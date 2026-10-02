"""
[Gate P1] FR-025 持ち物 / FR-026 準備タスク・レディネスの統合テスト(実PostgreSQL)。

検証する主な性質:
- 持ち物: 共有/個人、個人の持ち物は名前・メモを暗号文だけに保存し、他のメンバー(所有者を含む)には
  一覧・件数・個別取得(404)のどれにも出ない。担当者はメンバーに限る。担当者本人は状態だけ変更できる
- 楽観ロック(If-Match 428/409)、論理削除、DB CHECK、監査ログに本文を残さない
- 候補: 日数・予定・予約・移動手段・条件から理由付きで作り、採用済みは外し、旅程変更で
  不要・数量変更を示す。天候は判定していないことを明記する
- タスク: 完了条件・担当・期限、完了/未完了の切替、担当者(viewer)は完了だけできる、関連先の検証
- レディネス: 未予約・未確認・未支払・支払状況未入力・取消期限・期限切れ/未割当タスク・
  持ち物不足/未割当を検出し、タスクにして完了すれば外れる。他人の個人の持ち物は数えない
- メンバーから外れた担当者は未割当として扱う。プラン削除で一緒に消える
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1 import preparation as preparation_module
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import PackingItem, PlanCollaborator, PreparationTask
from app.services import packing_suggestions, readiness as readiness_service

SECRET_MED = "心臓の薬(朝晩)"


@pytest.fixture(autouse=True)
def _encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(preparation_module, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _plan(client, title="準備テスト旅行"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _day(client, plan_id, local_date="2026-11-01"):
    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": local_date, "timezone_id": "Asia/Tokyo"},
                      headers={"Idempotency-Key": str(uuid.uuid4())})
    assert res.status_code == 201, res.text
    return res.json()


def _event(client, plan_id, day_id, title="清水寺", event_type="sightseeing"):
    res = client.post(f"/api/v1/plans/{plan_id}/events",
                      json={"day_id": day_id, "title": title, "event_type": event_type, "local_start_time": "10:00"},
                      headers={"Idempotency-Key": str(uuid.uuid4())})
    assert res.status_code == 201, res.text
    return res.json()


def _reservation(client, plan_id, **extra):
    res = client.post(f"/api/v1/plans/{plan_id}/reservations",
                      json={"type": "accommodation", "provider_name": "宿", **extra})
    assert res.status_code == 201, res.text
    return res.json()


def _add_member(db_session, plan_id, user, role):
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=user.id, email=user.email, role=role,
                                    status="accepted"))
    db_session.commit()


def _item(client, plan_id, **body):
    payload = {"name": "歯ブラシ", "category": "toiletries"}
    payload.update(body)
    return client.post(f"/api/v1/plans/{plan_id}/packing-items", json=payload)


def _task(client, plan_id, **body):
    payload = {"title": "両替する"}
    payload.update(body)
    return client.post(f"/api/v1/plans/{plan_id}/preparation-tasks", json=payload)


def _readiness(client, plan_id):
    res = client.get(f"/api/v1/plans/{plan_id}/readiness")
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------- メンバー

def test_members_lists_owner_and_accepted_collaborators(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    editor, _ = make_user()
    pending, _ = make_user()
    _add_member(db_session, p, editor, "editor")
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=pending.id, email=pending.email, role="viewer",
                                    status="pending"))
    db_session.commit()
    res = client.get(f"/api/v1/plans/{p}/members")
    assert res.status_code == 200
    body = res.json()
    assert [m["role"] for m in body] == ["owner", "editor"]
    assert body[0] == {"user_id": str(owner.id), "name": owner.username, "role": "owner", "is_me": True}
    assert str(pending.id) not in {m["user_id"] for m in body}


# ---------------------------------------------------------------- 持ち物

def test_create_shared_item_with_assignee_and_audit_without_name(auth_client, make_user, db_session, audit_calls):
    client, owner = auth_client
    p = _plan(client)
    member, _ = make_user()
    _add_member(db_session, p, member, "viewer")
    res = _item(client, p, name="モバイルバッテリー", category="electronics", quantity=2, is_required=True,
                assignee_user_id=str(member.id), note="20000mAh")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["scope"] == "shared" and body["is_mine"] is True and body["visibility"] == "full"
    assert body["name"] == "モバイルバッテリー" and body["note"] == "20000mAh"
    assert body["quantity"] == 2 and body["is_required"] is True and body["status"] == "to_prepare"
    assert body["source"] == "manual" and body["suggestion_key"] is None
    assert body["assignee_user_id"] == str(member.id) and body["assignee_name"] == member.username
    assert body["revision"] == 1
    assert audit_calls[-1]["action"] == "packing_item_created"
    assert "モバイルバッテリー" not in repr(audit_calls) and "20000" not in repr(audit_calls)


def test_assignee_must_be_member(auth_client, make_user):
    client, _ = auth_client
    p = _plan(client)
    outsider, _ = make_user()
    res = _item(client, p, assignee_user_id=str(outsider.id))
    assert res.status_code == 422
    assert _item(client, p, assignee_user_id="not-a-uuid").status_code == 422


@pytest.mark.parametrize("body", [
    {"name": "  "}, {"category": "food"}, {"quantity": 0}, {"quantity": 1000}, {"status": "lost"},
    {"scope": "team"}, {"unknown": 1}, {"suggestion_key": "no_such_rule"},
])
def test_invalid_item_payloads_are_rejected(auth_client, body):
    client, _ = auth_client
    p = _plan(client)
    assert _item(client, p, **body).status_code == 422


def test_personal_item_is_encrypted_and_invisible_to_others(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    member, _ = make_user()
    _add_member(db_session, p, member, "viewer")
    _act_as(member)
    res = _item(client, p, name=SECRET_MED, note="食後", category="health", scope="personal", is_required=True)
    assert res.status_code == 201, res.text
    item_id = res.json()["id"]
    assert res.json()["name"] == SECRET_MED and res.json()["note"] == "食後"
    # 担当者は設定できない
    assert _item(client, p, name="x", scope="personal", assignee_user_id=str(member.id)).status_code == 422

    row = db_session.query(PackingItem).filter(PackingItem.id == uuid.UUID(item_id)).one()
    assert row.name is None and row.note is None and row.payload_ciphertext
    assert SECRET_MED.encode() not in row.payload_ciphertext

    # 本人の準備状況には出る
    r_member = _readiness(client, p)
    assert any(SECRET_MED in i["title"] for i in r_member["items"])
    assert r_member["packing"]["required_total"] == 1

    # 所有者を含む他人には一覧・件数・個別操作のどれにも出ない
    _act_as(owner)
    assert client.get(f"/api/v1/plans/{p}/packing-items").json() == []
    r_owner = _readiness(client, p)
    assert r_owner["packing"] == {"total": 0, "packed": 0, "required_total": 0, "required_ready": 0}
    assert SECRET_MED not in repr(r_owner)
    assert client.patch(f"/api/v1/plans/{p}/packing-items/{item_id}", json={"status": "packed"},
                        headers={"If-Match": "1"}).status_code == 404
    assert client.delete(f"/api/v1/plans/{p}/packing-items/{item_id}", headers={"If-Match": "1"}).status_code == 404


def test_personal_item_check_constraint(auth_client, db_session):
    client, owner = auth_client
    p = _plan(client)
    nested = db_session.begin_nested()
    with pytest.raises(IntegrityError):
        db_session.add(PackingItem(plan_id=uuid.UUID(p), owner_user_id=owner.id, scope="personal", name="平文",
                                   category="health", status="to_prepare", source="manual"))
        db_session.flush()
    nested.rollback()


def test_viewer_cannot_create_shared_but_can_create_personal(auth_client, make_user, db_session):
    client, _owner = auth_client
    p = _plan(client)
    viewer, _ = make_user()
    _add_member(db_session, p, viewer, "viewer")
    _act_as(viewer)
    assert _item(client, p).status_code == 403
    assert _item(client, p, scope="personal").status_code == 201


def test_update_requires_if_match_and_detects_conflict(auth_client):
    client, _ = auth_client
    p = _plan(client)
    item = _item(client, p).json()
    url = f"/api/v1/plans/{p}/packing-items/{item['id']}"
    assert client.patch(url, json={"status": "packed"}).status_code == 428
    assert client.patch(url, json={"status": "packed"}, headers={"If-Match": "x"}).status_code == 400
    assert client.patch(url, json={"status": "packed"}, headers={"If-Match": "9"}).status_code == 409
    res = client.patch(url, json={"status": "packed", "quantity": 3, "name": "電動歯ブラシ", "note": ""},
                       headers={"If-Match": "1"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "packed" and body["quantity"] == 3 and body["name"] == "電動歯ブラシ"
    assert body["note"] is None and body["revision"] == 2
    assert client.patch(url, json={"name": None}, headers={"If-Match": "2"}).status_code == 422


def test_assigned_viewer_can_only_change_status(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    viewer, _ = make_user()
    _add_member(db_session, p, viewer, "viewer")
    mine = _item(client, p, assignee_user_id=str(viewer.id)).json()
    other = _item(client, p, name="地図").json()
    _act_as(viewer)
    assert client.patch(f"/api/v1/plans/{p}/packing-items/{mine['id']}", json={"status": "packed"},
                        headers={"If-Match": "1"}).status_code == 200
    assert client.patch(f"/api/v1/plans/{p}/packing-items/{mine['id']}", json={"quantity": 5},
                        headers={"If-Match": "2"}).status_code == 403
    assert client.patch(f"/api/v1/plans/{p}/packing-items/{other['id']}", json={"status": "packed"},
                        headers={"If-Match": "1"}).status_code == 403
    assert client.delete(f"/api/v1/plans/{p}/packing-items/{mine['id']}", headers={"If-Match": "2"}).status_code == 403


def test_delete_is_logical(auth_client, db_session):
    client, _ = auth_client
    p = _plan(client)
    item = _item(client, p).json()
    res = client.delete(f"/api/v1/plans/{p}/packing-items/{item['id']}", headers={"If-Match": "1"})
    assert res.status_code == 200 and res.json()["revision"] == 2
    assert client.get(f"/api/v1/plans/{p}/packing-items").json() == []
    row = db_session.query(PackingItem).filter(PackingItem.id == uuid.UUID(item["id"])).one()
    assert row.deleted_at is not None


def test_items_are_sorted_by_category(auth_client):
    client, _ = auth_client
    p = _plan(client)
    _item(client, p, name="財布", category="money")
    _item(client, p, name="Tシャツ", category="clothing")
    _item(client, p, name="パスポート", category="documents")
    names = [i["name"] for i in client.get(f"/api/v1/plans/{p}/packing-items").json()]
    assert names == ["Tシャツ", "パスポート", "財布"]


# ---------------------------------------------------------------- 候補

def test_suggestions_reflect_itinerary_and_conditions(auth_client):
    client, _ = auth_client
    p = _plan(client)
    d1 = _day(client, p, "2026-11-01")
    _day(client, p, "2026-11-02")
    _day(client, p, "2026-11-03")
    _event(client, p, d1["id"], "清水寺")
    _event(client, p, d1["id"], "嵐山ハイキング", "activity")
    _event(client, p, d1["id"], "温泉", "other")
    _reservation(client, p, type="flight", provider_name="航空会社")

    res = client.get(f"/api/v1/plans/{p}/packing-suggestions")
    assert res.status_code == 200
    body = res.json()
    assert body["algorithm_version"] == packing_suggestions.ALGORITHM_VERSION
    assert body["inputs"]["day_count"] == 3 and body["inputs"]["nights"] == 2
    keys = {s["key"]: s for s in body["add"]}
    assert {"id_card", "underwear", "toiletries", "laundry_bag", "walking_shoes", "rain_gear", "bath_towel",
            "boarding_pass", "mobile_battery"} <= set(keys)
    assert "passport" not in keys and "medication" not in keys and "swimwear" not in keys
    assert keys["underwear"]["quantity"] == 3 and "2泊" in keys["underwear"]["reason"]
    assert keys["rain_gear"]["reason"].startswith("山歩き")
    assert body["unverified"][0]["code"] == "weather_unavailable"
    assert body["remove"] == [] and body["change"] == []

    cond = client.get(f"/api/v1/plans/{p}/packing-suggestions",
                      params={"overseas": "true", "laundry": "true", "takes_medication": "true"}).json()
    ckeys = {s["key"]: s for s in cond["add"]}
    assert ckeys["passport"]["scope"] == "personal" and ckeys["medication"]["scope"] == "personal"
    assert ckeys["underwear"]["quantity"] == 3 and "洗濯" in ckeys["underwear"]["reason"]


def test_adopted_suggestions_are_excluded_and_changes_are_proposed(auth_client):
    client, _ = auth_client
    p = _plan(client)
    d1 = _day(client, p, "2026-11-01")
    d2 = _day(client, p, "2026-11-02")
    under = _item(client, p, name="下着", category="clothing", quantity=2, suggestion_key="underwear").json()
    shoes = _item(client, p, name="歩きやすい靴", category="clothing", suggestion_key="walking_shoes").json()
    assert under["source"] == "suggested"
    # 同じ候補の二重採用は409
    assert _item(client, p, name="下着", suggestion_key="underwear").status_code == 409

    body = client.get(f"/api/v1/plans/{p}/packing-suggestions").json()
    assert "underwear" not in {s["key"] for s in body["add"]}
    # 予定が無いので靴は不要候補、1泊になったので下着の数量は2のまま(変更なし)
    assert [r["item_id"] for r in body["remove"]] == [shoes["id"]]
    assert body["change"] == []

    # 旅程が3日に伸びると下着の数量変更が提案される
    _day(client, p, "2026-11-03")
    _event(client, p, d1["id"], "清水寺")
    _event(client, p, d2["id"], "金閣寺")
    body = client.get(f"/api/v1/plans/{p}/packing-suggestions").json()
    assert body["remove"] == []
    assert body["change"] == [{
        "item_id": under["id"], "suggestion_key": "underwear", "name": "下着", "current_quantity": 2,
        "suggested_quantity": 3, "reason": "2泊の旅程のため(日数分)",
    }]


def test_personal_suggestion_adoption_is_per_person(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    member, _ = make_user()
    _add_member(db_session, p, member, "viewer")
    assert _item(client, p, name="パスポート", scope="personal", suggestion_key="passport").status_code == 201
    _act_as(member)
    # 他人が採用済みでも自分の分は採用できる。他人の採用は候補の判定に影響しない
    body = client.get(f"/api/v1/plans/{p}/packing-suggestions", params={"overseas": "true"}).json()
    assert "passport" in {s["key"] for s in body["add"]}
    assert _item(client, p, name="パスポート", scope="personal", suggestion_key="passport").status_code == 201


# ---------------------------------------------------------------- タスク

def test_task_lifecycle_with_criteria_assignee_due(auth_client, make_user, db_session, audit_calls):
    client, owner = auth_client
    p = _plan(client)
    member, _ = make_user()
    _add_member(db_session, p, member, "viewer")
    due = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
    res = _task(client, p, description="空港で2万円分", completion_criteria="現地通貨を受け取った",
                assignee_user_id=str(member.id), due_at=due.isoformat())
    assert res.status_code == 201, res.text
    t = res.json()
    assert t["status"] == "open" and t["is_overdue"] is False and t["completed_at"] is None
    assert t["assignee_name"] == member.username and t["created_by_name"] == owner.username
    assert t["completion_criteria"] == "現地通貨を受け取った" and t["can_edit"] is True
    assert "空港" not in repr(audit_calls)

    url = f"/api/v1/plans/{p}/preparation-tasks/{t['id']}"
    _act_as(member)
    listed = client.get(f"/api/v1/plans/{p}/preparation-tasks").json()
    assert listed[0]["can_edit"] is False and listed[0]["can_complete"] is True
    assert client.patch(url, json={"title": "変更"}, headers={"If-Match": "1"}).status_code == 403
    done = client.patch(url, json={"status": "done"}, headers={"If-Match": "1"})
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "done" and done.json()["completed_by_name"] == member.username
    assert done.json()["completed_at"] is not None
    assert client.delete(url, headers={"If-Match": "2"}).status_code == 403

    _act_as(owner)
    reopened = client.patch(url, json={"status": "open"}, headers={"If-Match": "2"}).json()
    assert reopened["status"] == "open" and reopened["completed_at"] is None and reopened["completed_by_name"] is None
    assert client.delete(url, headers={"If-Match": "3"}).status_code == 200
    assert client.get(f"/api/v1/plans/{p}/preparation-tasks").json() == []


def test_task_validation(auth_client, make_user, db_session):
    client, _ = auth_client
    p = _plan(client)
    other_plan = _plan(client, "別の旅行")
    d = _day(client, other_plan)
    ev = _event(client, other_plan, d["id"])
    assert _task(client, p, title=" ").status_code == 422
    assert _task(client, p, due_at="2026-11-01T10:00:00").status_code == 422
    assert _task(client, p, related_type="event").status_code == 422
    assert _task(client, p, related_type="event", related_id=ev["id"]).status_code == 422
    assert _task(client, p, related_type="hotel", related_id=ev["id"]).status_code == 422
    assert _task(client, p, readiness_key="unreserved:event:" + str(uuid.uuid4())).status_code == 422
    viewer, _ = make_user()
    _add_member(db_session, p, viewer, "viewer")
    _act_as(viewer)
    assert _task(client, p).status_code == 403


def test_task_related_target_is_shown_and_missing_after_delete(auth_client):
    client, _ = auth_client
    p = _plan(client)
    d = _day(client, p)
    ev = _event(client, p, d["id"], "清水寺")
    t = _task(client, p, related_type="event", related_id=ev["id"]).json()
    assert t["related_label"] == "清水寺" and t["related_missing"] is False
    plan = client.get(f"/api/v1/plans/{p}").json()
    res = client.delete(f"/api/v1/plans/{p}/events/{ev['id']}", headers={"If-Match": str(plan["revision"])})
    assert res.status_code == 200, res.text
    t2 = client.get(f"/api/v1/plans/{p}/preparation-tasks").json()[0]
    assert t2["related_label"] is None and t2["related_missing"] is True


def test_tasks_sorted_open_first_then_due(auth_client):
    client, _ = auth_client
    p = _plan(client)
    now = datetime.now(timezone.utc)
    late = _task(client, p, title="後", due_at=(now + timedelta(days=9)).isoformat()).json()
    _task(client, p, title="期限なし")
    soon = _task(client, p, title="先", due_at=(now + timedelta(days=1)).isoformat()).json()
    client.patch(f"/api/v1/plans/{p}/preparation-tasks/{soon['id']}", json={"status": "done"},
                 headers={"If-Match": "1"})
    titles = [t["title"] for t in client.get(f"/api/v1/plans/{p}/preparation-tasks").json()]
    assert titles == ["後", "期限なし", "先"]
    assert late["is_overdue"] is False


# ---------------------------------------------------------------- レディネス

def test_readiness_detects_each_category(auth_client, db_session):
    client, owner = auth_client
    p = _plan(client)
    d = _day(client, p)
    hotel = _event(client, p, d["id"], "京都ホテル", "accommodation")
    covered = _event(client, p, d["id"], "新幹線", "transportation")
    _event(client, p, d["id"], "清水寺", "sightseeing")
    now = datetime.now(timezone.utc)
    _reservation(client, p, type="train", provider_name="JR", event_id=covered["id"], total_amount=14000,
                 payment_status="unpaid", cancellation_deadline=(now + timedelta(hours=24)).isoformat())
    _reservation(client, p, type="restaurant", provider_name="料亭", status="candidate")
    _reservation(client, p, type="activity", provider_name="体験", total_amount=3000)
    _reservation(client, p, type="admission", provider_name="入場", total_amount=1000, payment_status="paid")
    _reservation(client, p, type="bus", provider_name="取消済み", status="cancelled", total_amount=500)
    _task(client, p, title="期限切れ", due_at=(now - timedelta(hours=1)).isoformat())
    _item(client, p, name="充電器", category="electronics", is_required=True, status="to_buy")
    _item(client, p, name="任意の本", category="other")

    r = _readiness(client, p)
    assert r["is_ready"] is False and r["algorithm_version"] == readiness_service.ALGORITHM_VERSION
    codes = {(i["code"], i["entity_id"]) for i in r["items"]}
    assert ("unreserved", hotel["id"]) in codes
    assert ("unreserved", covered["id"]) not in codes
    by_code = {}
    for i in r["items"]:
        by_code.setdefault(i["code"], []).append(i)
    assert set(by_code) == {
        "unreserved", "reservation_unconfirmed", "reservation_unpaid", "payment_unknown",
        "cancellation_deadline_soon", "task_overdue", "task_unassigned", "packing_shortage", "packing_unassigned",
    }
    assert "料亭" in by_code["reservation_unconfirmed"][0]["title"]
    assert "JR" in by_code["reservation_unpaid"][0]["title"]
    assert by_code["cancellation_deadline_soon"][0]["due_at"] is not None
    assert "要購入" in by_code["packing_shortage"][0]["title"]
    assert r["counts"]["by_category"] == {"unreserved": 1, "unconfirmed": 1, "unpaid": 2, "deadline": 2,
                                          "unassigned": 2, "packing": 1}
    assert r["counts"]["total"] == 9 and r["counts"]["by_severity"]["high"] == 3
    assert [i["severity"] for i in r["items"]][:3] == ["high", "high", "high"]
    assert r["tasks"] == {"open": 1, "done": 0}
    assert r["packing"] == {"total": 2, "packed": 0, "required_total": 1, "required_ready": 0}
    assert {i["convertible"] for i in by_code["unreserved"]} == {True}
    assert by_code["task_overdue"][0]["convertible"] is False


def test_readiness_item_converted_to_task_and_resolved(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    d = _day(client, p)
    hotel = _event(client, p, d["id"], "宿", "accommodation")
    key = f"unreserved:event:{hotel['id']}"
    item = next(i for i in _readiness(client, p)["items"] if i["key"] == key)
    assert item["task"] is None

    res = _task(client, p, title="宿は予約不要か確認", readiness_key=key, assignee_user_id=str(owner.id))
    assert res.status_code == 201, res.text
    t = res.json()
    assert t["readiness_key"] == key and t["related_type"] == "event" and t["related_id"] == hotel["id"]
    assert _task(client, p, title="二重", readiness_key=key).status_code == 409

    item = next(i for i in _readiness(client, p)["items"] if i["key"] == key)
    assert item["task"]["id"] == t["id"] and item["task"]["status"] == "open"
    assert item["task"]["assignee_name"] == owner.username

    client.patch(f"/api/v1/plans/{p}/preparation-tasks/{t['id']}", json={"status": "done"},
                 headers={"If-Match": "1"})
    r = _readiness(client, p)
    assert all(i["key"] != key for i in r["items"])
    assert r["resolved_by_tasks"] == 1 and r["is_ready"] is True


def test_readiness_ready_when_everything_done(auth_client):
    client, _ = auth_client
    p = _plan(client)
    d = _day(client, p)
    hotel = _event(client, p, d["id"], "宿", "accommodation")
    _reservation(client, p, event_id=hotel["id"], total_amount=10000, payment_status="paid")
    _item(client, p, name="財布", category="money", is_required=True, status="packed")
    r = _readiness(client, p)
    assert r["is_ready"] is True and r["items"] == []
    assert r["packing"]["required_ready"] == 1


def test_removed_member_assignee_becomes_unassigned(auth_client, make_user, db_session):
    client, _owner = auth_client
    p = _plan(client)
    member, _ = make_user()
    _add_member(db_session, p, member, "editor")
    item = _item(client, p, name="地図", is_required=True, assignee_user_id=str(member.id)).json()
    task = _task(client, p, assignee_user_id=str(member.id)).json()
    assert {i["code"] for i in _readiness(client, p)["items"]} == {"packing_shortage"}
    db_session.query(PlanCollaborator).filter(PlanCollaborator.user_id == member.id).delete()
    db_session.commit()
    listed = client.get(f"/api/v1/plans/{p}/packing-items").json()[0]
    assert listed["id"] == item["id"] and listed["assignee_user_id"] is None and listed["assignee_missing"] is True
    t = client.get(f"/api/v1/plans/{p}/preparation-tasks").json()[0]
    assert t["id"] == task["id"] and t["assignee_missing"] is True
    assert {i["code"] for i in _readiness(client, p)["items"]} == {
        "packing_shortage", "packing_unassigned", "task_unassigned"}


def test_outsider_cannot_access(auth_client, make_user):
    client, _owner = auth_client
    p = _plan(client)
    outsider, _ = make_user()
    _act_as(outsider)
    for path in ("members", "packing-items", "packing-suggestions", "preparation-tasks", "readiness"):
        assert client.get(f"/api/v1/plans/{p}/{path}").status_code == 403
    assert client.get(f"/api/v1/plans/{uuid.uuid4()}/readiness").status_code == 404


def test_plan_purge_removes_packing_and_tasks(auth_client, db_session):
    client, _ = auth_client
    p = _plan(client)
    _item(client, p)
    _item(client, p, scope="personal")
    _task(client, p)
    db_session.execute(text("SET CONSTRAINTS ALL DEFERRED"))
    db_session.execute(text("DELETE FROM travel_plans WHERE id = :p"), {"p": p})
    db_session.flush()
    assert db_session.query(PackingItem).filter(PackingItem.plan_id == uuid.UUID(p)).count() == 0
    assert db_session.query(PreparationTask).filter(PreparationTask.plan_id == uuid.UUID(p)).count() == 0
