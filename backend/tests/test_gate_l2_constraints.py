"""
[Gate L2] FR-016 制約管理(constraints)の統合テスト(実PostgreSQL)。

検証する主な性質:
- ハード/ソフトと重み(DOC-05 §17: hardはweight不要)、operatorごとの値検証
- 適用範囲(plan/day/event/member)のプラン所属検証
- 秘匿制約は題名・値を平文列に持たず暗号文だけに保存し、作成者以外
  (プラン所有者を含む)には存在とhard/softの別しか返さない
- 理由は共有制約でも作成者本人にだけ返す(DOC-05 §19)
- 権限(DOC-06 §21)、If-Match楽観ロック、論理削除、監査ログ(本文を記録しない)
- 判定用読み出し(load_constraints_for_evaluation)は秘匿制約も復号して使う
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import constraints as constraints_module
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import PlanCollaborator, PlanConstraint, TravelPlan
from app.services.constraint_evaluation import load_constraints_for_evaluation

ENDPOINT = "/api/v1/plans/{plan_id}/constraints"
SECRET_TITLE = "甲殻類アレルギーのため海鮮不可"
SECRET_VALUE = "えび・かに"
SECRET_REASON = "医師から強く止められている"


@pytest.fixture(autouse=True)
def _encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(constraints_module, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _create_plan(client, title="制約テスト旅行"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_day(client, plan_id, local_date="2026-11-01"):
    res = client.post(
        f"/api/v1/plans/{plan_id}/days",
        json={"local_date": local_date, "timezone_id": "Asia/Tokyo"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert res.status_code == 201, res.text
    return res.json()


def _create_event(client, plan_id, day_id, title="清水寺"):
    res = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": title, "local_start_time": "10:00"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert res.status_code == 201, res.text
    return res.json()


def _body(**overrides):
    body = {
        "title": "予算は1人5万円まで",
        "constraint_type": "budget_limit",
        "hardness": "hard",
        "operator": "max",
        "value": {"value": 50000, "unit": "JPY"},
    }
    body.update(overrides)
    return body


def _private_body(**overrides):
    body = _body(
        title=SECRET_TITLE, constraint_type="forbidden", operator="avoid",
        value={"value": SECRET_VALUE}, privacy_level="private", scope_type="member",
        reason=SECRET_REASON,
    )
    body.update(overrides)
    return body


def _add_member(db_session, plan_id, user, role):
    db_session.add(PlanCollaborator(
        plan_id=uuid.UUID(plan_id), user_id=user.id, email=user.email, role=role, status="accepted",
    ))
    db_session.commit()


# ---------------------------------------------------------------- 作成・値検証

def test_create_shared_hard_constraint(auth_client, audit_calls):
    client, user = auth_client
    plan_id = _create_plan(client)
    res = client.post(ENDPOINT.format(plan_id=plan_id), json=_body(reason="家計の都合"))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["visibility"] == "full"
    assert body["is_mine"] is True
    assert body["hardness"] == "hard" and body["weight"] is None
    assert body["value"] == {"value": 50000, "value_to": None, "unit": "JPY"}
    assert body["scope_type"] == "plan" and body["scope_id"] is None and body["scope_label"] is None
    assert body["reason"] == "家計の都合" and body["has_reason"] is True
    assert body["revision"] == 1
    assert audit_calls[-1]["action"] == "constraint_created"
    assert audit_calls[-1]["details"] == {"plan_id": plan_id, "hardness": "hard", "privacy_level": "shared"}


def test_weight_rules_follow_hardness(auth_client):
    client, _ = auth_client
    plan_id = _create_plan(client)
    url = ENDPOINT.format(plan_id=plan_id)
    assert client.post(url, json=_body(weight=10)).status_code == 422
    soft = client.post(url, json=_body(hardness="soft", constraint_type="preference")).json()
    assert soft["weight"] == 50
    assert client.post(url, json=_body(hardness="soft", weight=80)).json()["weight"] == 80
    assert client.post(url, json=_body(hardness="soft", weight=0)).status_code == 422
    assert client.post(url, json=_body(hardness="soft", weight=101)).status_code == 422


@pytest.mark.parametrize("operator,value,ok", [
    ("before", {"value": "21:30"}, True),
    ("before", {"value": "2026-11-01T21:30:00+09:00"}, True),
    ("before", {"value": "25:00"}, False),
    ("before", {"value": "2026-11-01T21:30:00"}, False),  # タイムゾーン無し
    ("before", {"value": "21:30", "value_to": "22:00"}, False),
    ("between", {"value": "22:00", "value_to": "02:00"}, True),  # 日跨ぎは許す
    ("between", {"value": "10:00", "value_to": "10:00"}, False),
    ("between", {"value": "10:00", "value_to": "2026-11-01T12:00:00+09:00"}, False),
    ("between", {"value": "2026-11-01T12:00:00+09:00", "value_to": "2026-11-01T11:00:00+09:00"}, False),
    ("max", {"value": 90, "unit": "minutes"}, True),
    ("max", {"value": 90}, False),
    ("min", {"value": -1, "unit": "minutes"}, False),
    ("max", {"value": True, "unit": "count"}, False),
    ("avoid", {"value": "  タクシー  "}, True),
    ("prefer", {"value": ""}, False),
    ("equals", {"value": 3}, False),
])
def test_value_validation_by_operator(auth_client, operator, value, ok):
    client, _ = auth_client
    plan_id = _create_plan(client)
    res = client.post(ENDPOINT.format(plan_id=plan_id), json=_body(operator=operator, value=value))
    assert (res.status_code == 201) is ok, res.text
    if operator == "avoid" and ok:
        assert res.json()["value"]["value"] == "タクシー"


def test_unknown_fields_and_vocabularies_are_rejected(auth_client):
    client, _ = auth_client
    plan_id = _create_plan(client)
    url = ENDPOINT.format(plan_id=plan_id)
    assert client.post(url, json=_body(constraint_type="unknown")).status_code == 422
    assert client.post(url, json=_body(hardness="medium")).status_code == 422
    assert client.post(url, json=_body(operator="like")).status_code == 422
    assert client.post(url, json=_body(value={"value": 1, "unit": "JPY", "extra": 1})).status_code == 422
    assert client.post(url, json={**_body(), "owner_user_id": str(uuid.uuid4())}).status_code == 422
    assert client.post(url, json=_body(title="   ")).status_code == 422
    start = datetime(2026, 11, 1, tzinfo=timezone.utc)
    window = {"active_from": start.isoformat(), "active_to": (start - timedelta(hours=1)).isoformat()}
    assert client.post(url, json=_body(**window)).status_code == 422


# ---------------------------------------------------------------- 適用範囲

def test_scope_resolution_and_labels(auth_client, make_user):
    client, user = auth_client
    plan_id = _create_plan(client)
    day = _create_day(client, plan_id)
    event = _create_event(client, plan_id, day["id"])
    url = ENDPOINT.format(plan_id=plan_id)

    by_day = client.post(url, json=_body(scope_type="day", scope_id=day["id"])).json()
    assert by_day["scope_label"] == "2026-11-01"
    by_event = client.post(url, json=_body(scope_type="event", scope_id=event["id"])).json()
    assert by_event["scope_label"] == "清水寺"
    by_member = client.post(url, json=_body(scope_type="member")).json()
    assert by_member["scope_id"] == str(user.id) and by_member["scope_label"] == user.username

    assert client.post(url, json=_body(scope_type="plan", scope_id=day["id"])).status_code == 422
    assert client.post(url, json=_body(scope_type="day")).status_code == 422
    assert client.post(url, json=_body(scope_type="day", scope_id="not-a-uuid")).status_code == 422
    stranger, _ = make_user()
    assert client.post(url, json=_body(scope_type="member", scope_id=str(stranger.id))).status_code == 422

    other_plan = _create_plan(client, "別の旅行")
    other_day = _create_day(client, other_plan)
    res = client.post(url, json=_body(scope_type="day", scope_id=other_day["id"]))
    assert res.status_code == 422


def test_deleted_scope_target_is_reported_as_missing(auth_client):
    client, _ = auth_client
    plan_id = _create_plan(client)
    day = _create_day(client, plan_id)
    event = _create_event(client, plan_id, day["id"])
    created = client.post(ENDPOINT.format(plan_id=plan_id), json=_body(scope_type="event", scope_id=event["id"])).json()

    plan = client.get(f"/api/v1/plans/{plan_id}").json()
    res = client.delete(
        f"/api/v1/plans/{plan_id}/events/{event['id']}", headers={"If-Match": str(plan["revision"])}
    )
    assert res.status_code == 200, res.text

    got = client.get(f"{ENDPOINT.format(plan_id=plan_id)}/{created['id']}").json()
    assert got["scope_missing"] is True and got["scope_label"] is None


# ---------------------------------------------------------------- 秘匿

def test_private_constraint_is_stored_only_as_ciphertext(auth_client, db_session):
    client, _ = auth_client
    plan_id = _create_plan(client)
    res = client.post(ENDPOINT.format(plan_id=plan_id), json=_private_body())
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["visibility"] == "full"
    assert body["title"] == SECRET_TITLE and body["value"]["value"] == SECRET_VALUE
    assert body["reason"] == SECRET_REASON

    row = db_session.query(PlanConstraint).filter(PlanConstraint.id == uuid.UUID(body["id"])).one()
    assert row.title is None and row.value_json is None
    assert row.value_ciphertext and row.reason_ciphertext
    for secret in (SECRET_TITLE, SECRET_VALUE, SECRET_REASON):
        assert secret.encode("utf-8") not in row.value_ciphertext
        assert secret.encode("utf-8") not in row.reason_ciphertext


def test_private_detail_is_hidden_from_other_members_including_plan_owner(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id = _create_plan(client)
    editor, _ = make_user()
    _add_member(db_session, plan_id, editor, "editor")

    _act_as(editor)
    created = client.post(ENDPOINT.format(plan_id=plan_id), json=_private_body(hardness="soft", weight=90)).json()

    _act_as(owner)
    listed = client.get(ENDPOINT.format(plan_id=plan_id))
    single = client.get(f"{ENDPOINT.format(plan_id=plan_id)}/{created['id']}")
    for res in (listed, single):
        assert res.status_code == 200
        assert SECRET_TITLE not in res.text and SECRET_VALUE not in res.text and SECRET_REASON not in res.text
    masked = single.json()
    assert masked["visibility"] == "masked" and masked["is_mine"] is False
    assert masked["hardness"] == "soft" and masked["privacy_level"] == "private" and masked["scope_type"] == "member"
    for key in ("title", "constraint_type", "operator", "value", "weight", "scope_id", "scope_label",
                "reason", "revision", "active_from", "active_to"):
        assert masked[key] is None, key
    assert masked["has_reason"] is False


def test_shared_constraint_reason_is_visible_only_to_its_author(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id = _create_plan(client)
    created = client.post(ENDPOINT.format(plan_id=plan_id), json=_body(reason=SECRET_REASON)).json()
    viewer, _ = make_user()
    _add_member(db_session, plan_id, viewer, "viewer")

    _act_as(viewer)
    res = client.get(f"{ENDPOINT.format(plan_id=plan_id)}/{created['id']}")
    assert res.json()["visibility"] == "full"
    assert res.json()["has_reason"] is True and res.json()["reason"] is None
    assert SECRET_REASON not in res.text


# ---------------------------------------------------------------- 権限

def test_permission_matrix(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id = _create_plan(client)
    url = ENDPOINT.format(plan_id=plan_id)
    shared = client.post(url, json=_body()).json()
    viewer, _ = make_user()
    editor, _ = make_user()
    stranger, _ = make_user()
    _add_member(db_session, plan_id, viewer, "viewer")
    _add_member(db_session, plan_id, editor, "editor")

    _act_as(viewer)
    assert client.post(url, json=_body()).status_code == 403  # 閲覧者は共有制約を作れない
    mine = client.post(url, json=_private_body())  # 自分の秘匿制約は作れる
    assert mine.status_code == 201
    mine = mine.json()
    res = client.patch(f"{url}/{shared['id']}", json={"title": "x"}, headers={"If-Match": "1"})
    assert res.status_code == 403
    res = client.patch(f"{url}/{mine['id']}", json={"is_active": False}, headers={"If-Match": "1"})
    assert res.status_code == 200 and res.json()["is_active"] is False
    # 閲覧者は自分の秘匿制約を共有へ切り替えられない(共有の作成権限が無いため)
    res = client.patch(f"{url}/{mine['id']}", json={"privacy_level": "shared"}, headers={"If-Match": "2"})
    assert res.status_code == 403

    _act_as(editor)
    assert client.patch(f"{url}/{shared['id']}", json={"title": "予算変更"}, headers={"If-Match": "1"}).status_code == 200
    assert client.patch(f"{url}/{mine['id']}", json={"title": "x"}, headers={"If-Match": "2"}).status_code == 403
    assert client.delete(f"{url}/{mine['id']}", headers={"If-Match": "2"}).status_code == 403
    # 共有制約を他人が秘匿へ切り替えることはできない(作成者の制約を他人から隠せない)
    res = client.patch(f"{url}/{shared['id']}", json={"privacy_level": "private"}, headers={"If-Match": "2"})
    assert res.status_code == 403

    _act_as(owner)
    # プラン所有者でも他人の秘匿制約は変更・削除できない
    assert client.delete(f"{url}/{mine['id']}", headers={"If-Match": "2"}).status_code == 403

    _act_as(stranger)
    assert client.get(url).status_code == 403
    assert client.post(url, json=_private_body()).status_code == 403


# ---------------------------------------------------------------- 更新・削除

def test_update_requires_if_match_and_bumps_revision(auth_client, audit_calls):
    client, _ = auth_client
    plan_id = _create_plan(client)
    url = ENDPOINT.format(plan_id=plan_id)
    created = client.post(url, json=_body(hardness="soft", weight=30, constraint_type="preference")).json()
    item = f"{url}/{created['id']}"

    assert client.patch(item, json={"weight": 40}).status_code == 428
    assert client.patch(item, json={"weight": 40}, headers={"If-Match": "abc"}).status_code == 400
    assert client.patch(item, json={"weight": 40}, headers={"If-Match": "9"}).status_code == 409

    res = client.patch(item, json={"weight": 40}, headers={"If-Match": '"1"'})
    assert res.status_code == 200 and res.json()["weight"] == 40 and res.json()["revision"] == 2
    assert audit_calls[-1]["action"] == "constraint_updated"

    # soft→hardで重みは消える。hardへ重み指定は拒否。
    assert client.patch(item, json={"hardness": "hard", "weight": 10}, headers={"If-Match": "2"}).status_code == 422
    res = client.patch(item, json={"hardness": "hard"}, headers={"If-Match": "2"})
    assert res.status_code == 200 and res.json()["weight"] is None
    # hard→softで既定の重みに戻る
    res = client.patch(item, json={"hardness": "soft"}, headers={"If-Match": "3"})
    assert res.json()["weight"] == 50

    # operator変更時は既存値を新しいoperatorで再検証する(max用の数値はavoidに使えない)
    assert client.patch(item, json={"operator": "avoid"}, headers={"If-Match": "4"}).status_code == 422
    res = client.patch(item, json={"operator": "avoid", "value": {"value": "夜行バス"}}, headers={"If-Match": "4"})
    assert res.status_code == 200 and res.json()["value"]["value"] == "夜行バス"
    assert client.patch(item, json={"title": None}, headers={"If-Match": "5"}).status_code == 422


def test_author_can_switch_privacy_and_payload_moves_between_columns(auth_client, db_session):
    client, _ = auth_client
    plan_id = _create_plan(client)
    url = ENDPOINT.format(plan_id=plan_id)
    created = client.post(url, json=_body(title="集合は駅前")).json()
    item = f"{url}/{created['id']}"

    res = client.patch(item, json={"privacy_level": "private"}, headers={"If-Match": "1"})
    assert res.status_code == 200 and res.json()["title"] == "集合は駅前"
    row = db_session.query(PlanConstraint).filter(PlanConstraint.id == uuid.UUID(created["id"])).one()
    db_session.refresh(row)
    assert row.title is None and row.value_json is None and row.value_ciphertext is not None

    res = client.patch(item, json={"privacy_level": "shared", "title": "集合は北口"}, headers={"If-Match": "2"})
    assert res.status_code == 200
    db_session.refresh(row)
    assert row.title == "集合は北口" and row.value_ciphertext is None
    assert row.value_json == {"value": 50000, "value_to": None, "unit": "JPY"}


def test_delete_is_soft_and_hides_the_constraint(auth_client, db_session, audit_calls):
    client, _ = auth_client
    plan_id = _create_plan(client)
    url = ENDPOINT.format(plan_id=plan_id)
    created = client.post(url, json=_body()).json()
    item = f"{url}/{created['id']}"
    assert client.delete(item).status_code == 428
    res = client.delete(item, headers={"If-Match": "1"})
    assert res.status_code == 200 and res.json()["revision"] == 2
    assert audit_calls[-1]["action"] == "constraint_deleted"
    assert client.get(item).status_code == 404
    assert client.get(url).json() == []
    row = db_session.query(PlanConstraint).filter(PlanConstraint.id == uuid.UUID(created["id"])).one()
    assert row.deleted_at is not None


def test_list_orders_hard_first_and_rejects_unknown_ids(auth_client):
    client, _ = auth_client
    plan_id = _create_plan(client)
    url = ENDPOINT.format(plan_id=plan_id)
    client.post(url, json=_body(hardness="soft", title="景色の良い道", constraint_type="scenery"))
    client.post(url, json=_body(title="終電23時"))
    assert [c["hardness"] for c in client.get(url).json()] == ["hard", "soft"]
    assert client.get(f"{url}/{uuid.uuid4()}").status_code == 404
    assert client.get(f"{url}/not-a-uuid").status_code == 404


def test_audit_details_never_contain_constraint_text(auth_client, audit_calls):
    client, _ = auth_client
    plan_id = _create_plan(client)
    created = client.post(ENDPOINT.format(plan_id=plan_id), json=_private_body()).json()
    client.patch(
        f"{ENDPOINT.format(plan_id=plan_id)}/{created['id']}", json={"reason": "別の理由"}, headers={"If-Match": "1"}
    )
    text = json.dumps(audit_calls, default=str, ensure_ascii=False)
    for secret in (SECRET_TITLE, SECRET_VALUE, SECRET_REASON, "別の理由"):
        assert secret not in text


def test_private_constraint_requires_encryption_key(auth_client, monkeypatch):
    client, _ = auth_client
    plan_id = _create_plan(client)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", None)
    crypto_module.reset_cache_for_tests()
    res = client.post(ENDPOINT.format(plan_id=plan_id), json=_private_body())
    assert res.status_code == 503
    # 共有制約でも理由は暗号化するため、鍵が無ければ理由付きは作れない(理由無しは作れる)
    assert client.post(ENDPOINT.format(plan_id=plan_id), json=_body(reason="x")).status_code == 503
    assert client.post(ENDPOINT.format(plan_id=plan_id), json=_body()).status_code == 201


# ---------------------------------------------------------------- メンバー離脱・プラン削除

def test_private_constraints_of_departed_members_are_excluded(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id = _create_plan(client)
    editor, _ = make_user()
    _add_member(db_session, plan_id, editor, "editor")
    _act_as(editor)
    created = client.post(ENDPOINT.format(plan_id=plan_id), json=_private_body()).json()
    shared = client.post(ENDPOINT.format(plan_id=plan_id), json=_body()).json()

    collab = db_session.query(PlanCollaborator).filter(PlanCollaborator.user_id == editor.id).one()
    db_session.delete(collab)
    db_session.commit()

    _act_as(owner)
    ids = [c["id"] for c in client.get(ENDPOINT.format(plan_id=plan_id)).json()]
    assert created["id"] not in ids and shared["id"] in ids
    assert client.get(f"{ENDPOINT.format(plan_id=plan_id)}/{created['id']}").status_code == 404
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(plan_id)).one()
    assert [c.id for c in load_constraints_for_evaluation(db_session, plan).constraints] == [uuid.UUID(shared["id"])]


def test_plan_deletion_cascades_to_constraints(auth_client, db_session):
    client, _ = auth_client
    plan_id = _create_plan(client)
    client.post(ENDPOINT.format(plan_id=plan_id), json=_body())
    client.post(ENDPOINT.format(plan_id=plan_id), json=_private_body())
    res = client.delete(f"/api/v1/travel-plans/{plan_id}")
    assert res.status_code == 200, res.text
    # [Gate B-012] DELETEは論理削除。制約は猶予期間中は残り、完全削除で消える
    db_session.expire_all()
    assert db_session.query(PlanConstraint).filter(PlanConstraint.plan_id == uuid.UUID(plan_id)).count() == 2
    assert client.delete(f"/api/v1/travel-plans/{plan_id}/permanent").status_code == 200
    db_session.expire_all()
    assert db_session.query(PlanConstraint).filter(PlanConstraint.plan_id == uuid.UUID(plan_id)).count() == 0


# ---------------------------------------------------------------- 判定用読み出し

def test_evaluation_loader_uses_private_values_and_filters(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id = _create_plan(client)
    url = ENDPOINT.format(plan_id=plan_id)
    editor, _ = make_user()
    _add_member(db_session, plan_id, editor, "editor")

    shared = client.post(url, json=_body()).json()
    inactive = client.post(url, json=_body(is_active=False)).json()
    start = datetime(2026, 11, 1, tzinfo=timezone.utc)
    windowed = client.post(url, json=_body(
        active_from=start.isoformat(), active_to=(start + timedelta(days=1)).isoformat(),
    )).json()
    deleted = client.post(url, json=_body()).json()
    client.delete(f"{url}/{deleted['id']}", headers={"If-Match": "1"})
    _act_as(editor)
    private = client.post(url, json=_private_body(hardness="soft", weight=70)).json()

    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(plan_id)).one()
    loaded = load_constraints_for_evaluation(db_session, plan)
    by_id = {str(c.id): c for c in loaded.constraints}
    assert set(by_id) == {shared["id"], windowed["id"], private["id"]}
    assert inactive["id"] not in by_id and deleted["id"] not in by_id
    p = by_id[private["id"]]
    assert p.is_private and p.value == {"value": SECRET_VALUE, "value_to": None, "unit": None}
    assert p.weight == 70 and p.owner_user_id == editor.id
    # 同一トランザクション内の作成はcreated_atが同時刻になるため、順序ではなく集合で比べる
    assert {c.id for c in loaded.hard} == {uuid.UUID(shared["id"]), uuid.UUID(windowed["id"])}
    assert [c.id for c in loaded.soft] == [uuid.UUID(private["id"])]
    assert not hasattr(p, "reason") and not hasattr(p, "title")

    outside = load_constraints_for_evaluation(db_session, plan, at=start + timedelta(days=2))
    assert windowed["id"] not in {str(c.id) for c in outside.constraints}
    inside = load_constraints_for_evaluation(db_session, plan, at=start + timedelta(hours=1))
    assert windowed["id"] in {str(c.id) for c in inside.constraints}


def test_undecryptable_private_constraint_is_reported_not_dropped(auth_client, db_session):
    client, _ = auth_client
    plan_id = _create_plan(client)
    created = client.post(ENDPOINT.format(plan_id=plan_id), json=_private_body()).json()
    row = db_session.query(PlanConstraint).filter(PlanConstraint.id == uuid.UUID(created["id"])).one()
    row.value_ciphertext = b"not-a-valid-fernet-token"
    db_session.commit()

    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(plan_id)).one()
    loaded = load_constraints_for_evaluation(db_session, plan)
    assert loaded.constraints == [] and loaded.unavailable == [uuid.UUID(created["id"])]

    got = client.get(f"{ENDPOINT.format(plan_id=plan_id)}/{created['id']}").json()
    assert got["visibility"] == "unavailable" and got["title"] is None
    res = client.patch(
        f"{ENDPOINT.format(plan_id=plan_id)}/{created['id']}", json={"is_active": False}, headers={"If-Match": "1"}
    )
    assert res.status_code == 409


def test_database_check_constraints_guard_invariants(auth_client, db_session):
    """APIを経由しない書込でもDOC-05 §17の不変条件が破れないこと。"""
    from sqlalchemy.exc import IntegrityError

    client, owner = auth_client
    plan_id = _create_plan(client)
    base = dict(
        plan_id=uuid.UUID(plan_id), owner_user_id=owner.id, scope_type="plan", constraint_type="preference",
        operator="prefer", privacy_level="shared", title="t", value_json={"value": "x"},
    )
    bad_rows = [
        dict(base, hardness="hard", weight=10),
        dict(base, hardness="soft", weight=None),
        dict(base, hardness="soft", weight=0),
        dict(base, hardness="hard", privacy_level="private"),  # 暗号文なし
        dict(base, hardness="hard", privacy_level="private", value_ciphertext=b"x"),  # 平文も残っている
        dict(base, hardness="hard", scope_type="day"),  # scope_id無し
    ]
    for row in bad_rows:
        with pytest.raises(IntegrityError):
            with db_session.begin_nested():
                db_session.add(PlanConstraint(**row))
                db_session.flush()
