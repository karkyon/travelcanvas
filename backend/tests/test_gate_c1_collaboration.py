"""[Gate C1] FR-020 共同編集(準リアルタイム)・FR-023 秘匿プロフィールの統合テスト(実PostgreSQL)。

FR-020
- 同じ旅行を開いている人: 本人と参加者だけ(外れた人・関係のない人は数えない/使えない)。名前は利用者名(メールは出さない)
- 編集中の予定: 旅行の中の予定だけ。消された予定は出さない。他の人がいると問い合わせの間隔を短くする
- 他の人の変更: 知っている版より後の変更を、誰が・どの予定を・何をしたかで返す(自分の変更は is_self)
- 古い知らせは消える。画面を閉じると消える。Redis(届く環境だけ)でも同じに動く
- 同時に編集: 先に保存した方が通り、古い版の保存は 409(黙って上書きしない)

FR-023
- 項目の検査(種類・名前・時刻・単位・件数・重複)。保存は暗号文だけ(平文の列・監査に題名や値を残さない)。If-Match
- 旅行への適用: 本人の秘匿制約を項目ごとに作る。他の参加者には伏せた形だけ。制約の画面からは変えられない(409)
- 判定: 他の参加者の検証結果には「秘匿制約を満たしていません」だけ(題名・値なし)。プロフィールを変えると作り直す
- 適用をやめる・アカウントの削除で消える。書き出しには本人の分だけ
"""
import json
import time
import uuid

import pytest

from app.api.v1 import constraints as constraints_module
from app.api.v1 import private_profile as pp_api
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import PlanCollaborator, PlanConstraint, PrivateProfileLink, UserPrivateProfile
from app.services import account_deletion as ad
from app.services import data_export as dx
from app.services import presence as pr
from app.services import private_profile as pp
from app.services.feasibility import PRIVATE_MESSAGE
from app.utils import rate_limiter as rl


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    pr.reset_for_testing()
    yield
    pr.reset_for_testing()
    crypto_module.reset_cache_for_tests()


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(pp_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(constraints_module, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _cid():
    return uuid.uuid4().hex[:16]


def _setup(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id = client.post("/api/v1/travel-plans/", json={"title": "C1共同"}).json()["id"]
    base = f"/api/v1/plans/{plan_id}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"}, headers=_ik())
    assert day.status_code == 201, day.text
    ev = client.post(f"{base}/events", json={"day_id": day.json()["id"], "title": "清水寺", "local_start_time": "10:00"},
                     headers=_ik())
    assert ev.status_code == 201, ev.text
    editor, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=editor.id, email=editor.email, role="editor",
                                    status="accepted"))
    db_session.flush()
    return client, owner, editor, plan_id, base, day.json()["id"], ev.json()


def _revision(client, base):
    return client.get(base).json()["revision"]


# ================================================================ FR-020


def test_presence_viewers_editing_and_changes(auth_client, make_user, db_session):
    client, owner, editor, plan_id, base, day_id, ev = _setup(auth_client, make_user, db_session)
    me = client.post(f"{base}/presence", json={"client_id": _cid()}).json()
    assert [v["label"] for v in me["viewers"]] == ["あなた"] and me["viewers"][0]["role"] == "owner"
    assert me["poll_seconds"] == 15 and me["changes"] == []
    known = me["revision"]

    # 編集者が予定の編集を始める
    _act_as(editor)
    ed_client = _cid()
    r = client.post(f"{base}/presence", json={"client_id": ed_client, "editing": {"kind": "event", "id": ev["id"]}})
    assert r.status_code == 200, r.text
    _act_as(owner)
    seen = client.post(f"{base}/presence", json={"client_id": _cid(), "known_revision": known}).json()
    others = [v for v in seen["viewers"] if not v["is_self"]]
    assert len(others) == 1 and others[0]["label"] == editor.username and others[0]["role"] == "editor"
    assert others[0]["editing"] == {"kind": "event", "id": ev["id"], "label": "清水寺"}
    assert seen["poll_seconds"] == 5
    assert editor.email not in json.dumps(seen) and owner.email not in json.dumps(seen)

    # 編集者が保存する → 所有者には「誰が・どの予定を」が届く
    _act_as(editor)
    rev = _revision(client, base)
    up = client.put(f"{base}/events/{ev['id']}", json={"title": "清水寺(朝)"}, headers={"If-Match": str(rev)})
    assert up.status_code == 200, up.text
    mine = client.post(f"{base}/presence", json={"client_id": ed_client, "known_revision": rev}).json()
    assert mine["changes"][0]["is_self"] is True and mine["changes"][0]["actor_label"] == "あなた"
    _act_as(owner)
    seen = client.post(f"{base}/presence", json={"client_id": _cid(), "known_revision": known}).json()
    assert seen["revision"] == known + 1
    change = seen["changes"][-1]
    assert change["actor_label"] == editor.username and change["is_self"] is False
    assert change["items"] == [{"entity_type": "travel_event", "action": "update", "label": "清水寺(朝)"}]

    # 古い版での保存は 409(編集者の変更を黙って上書きしない)
    stale = client.put(f"{base}/events/{ev['id']}", json={"title": "上書き"}, headers={"If-Match": str(known)})
    assert stale.status_code == 409
    titles = [e["title"] for d in client.get(base).json()["days"] for e in d["events"]]
    assert titles == ["清水寺(朝)"]


def test_presence_access_and_hygiene(auth_client, make_user, db_session):
    client, owner, editor, plan_id, base, day_id, ev = _setup(auth_client, make_user, db_session)
    # 関係のない人は使えない
    stranger, _ = make_user()
    _act_as(stranger)
    assert client.post(f"{base}/presence", json={"client_id": _cid()}).status_code == 403
    assert client.delete(f"{base}/presence/{_cid()}").status_code == 403
    # 形の検査
    _act_as(owner)
    for bad in ({"client_id": "short"}, {"client_id": "x" * 65}, {"client_id": "bad id!!"},
                {"client_id": _cid(), "editing": {"kind": "day", "id": ev["id"]}},
                {"client_id": _cid(), "extra": 1}, {"client_id": _cid(), "known_revision": -1}):
        assert client.post(f"{base}/presence", json=bad).status_code == 422, bad
    # 他の旅行の予定を「編集中」にしても出さない
    other_plan = client.post("/api/v1/travel-plans/", json={"title": "別"}).json()["id"]
    d2 = client.post(f"/api/v1/plans/{other_plan}/days", json={"local_date": "2026-11-03", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()["id"]
    ev2 = client.post(f"/api/v1/plans/{other_plan}/events", json={"day_id": d2, "title": "別の予定"}, headers=_ik()).json()
    _act_as(editor)
    client.post(f"{base}/presence", json={"client_id": "editor-tab-1", "editing": {"kind": "event", "id": ev2["id"]}})
    _act_as(owner)
    view = client.post(f"{base}/presence", json={"client_id": _cid()}).json()
    assert [v["editing"] for v in view["viewers"] if not v["is_self"]] == [None]
    # 閉じると消える
    _act_as(editor)
    assert client.delete(f"{base}/presence/editor-tab-1").status_code == 204
    _act_as(owner)
    assert [v for v in client.post(f"{base}/presence", json={"client_id": _cid()}).json()["viewers"]
            if not v["is_self"]] == []
    # 古い知らせ(TTL を過ぎた)は数えない
    pr.touch(plan_id, f"{editor.id}:old-tab-123", {"user_id": str(editor.id), "editing": None},
             now=time.time() - pr.TTL_SECONDS - 5)
    assert [v for v in client.post(f"{base}/presence", json={"client_id": _cid()}).json()["viewers"]
            if not v["is_self"]] == []
    # 旅行から外れた人の端末は数えない
    _act_as(editor)
    client.post(f"{base}/presence", json={"client_id": "editor-tab-2"})
    db_session.query(PlanCollaborator).filter(PlanCollaborator.user_id == editor.id).delete()
    db_session.flush()
    _act_as(owner)
    assert [v for v in client.post(f"{base}/presence", json={"client_id": _cid()}).json()["viewers"]
            if not v["is_self"]] == []
    # 予定を消すと「編集中」から外れる
    _act_as(owner)
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=editor.id, email=editor.email, role="viewer",
                                    status="accepted"))
    db_session.flush()
    _act_as(editor)
    client.post(f"{base}/presence", json={"client_id": "editor-tab-3", "editing": {"kind": "event", "id": ev["id"]}})
    _act_as(owner)
    rev = _revision(client, base)
    assert client.delete(f"{base}/events/{ev['id']}", headers={"If-Match": str(rev)}).status_code == 200
    view = client.post(f"{base}/presence", json={"client_id": _cid()}).json()
    other = [v for v in view["viewers"] if not v["is_self"]]
    assert other[0]["role"] == "viewer" and other[0]["editing"] is None


def _redis_reachable() -> bool:
    try:
        import redis

        redis.Redis.from_url(settings.REDIS_URL, socket_timeout=0.3, socket_connect_timeout=0.3).ping()
        return True
    except Exception:  # noqa: BLE001
        return False


@pytest.mark.skipif(not _redis_reachable(), reason="Redis に届かない環境(CI の backend ジョブ等)")
def test_presence_in_redis_is_shared_and_expires(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_NAMESPACE", f"tc-test-{uuid.uuid4().hex[:8]}")
    rl.set_redis_client_for_testing(None)
    rl.use_backend("redis")
    try:
        plan = str(uuid.uuid4())
        pr.touch(plan, "u1:tab-aaaaaaaa", {"user_id": "u1", "editing": None})
        pr.touch(plan, "u2:tab-bbbbbbbb", {"user_id": "u2", "editing": {"kind": "event", "id": "e"}},
                 now=time.time() - pr.TTL_SECONDS - 1)
        pr.reset_for_testing()  # プロセス内の控えを消しても Redis から読める
        got = pr.entries(plan)
        assert [e["user_id"] for e in got] == ["u1"]
        assert rl._client().hlen(f"{rl.namespace()}:presence:{plan}") == 1  # 古い知らせは消えた
        assert rl._client().ttl(f"{rl.namespace()}:presence:{plan}") > 0
        pr.leave(plan, "u1:tab-aaaaaaaa")
        assert pr.entries(plan) == []
    finally:
        rl.use_backend("memory")
        rl.set_redis_client_for_testing(None)


# ================================================================ FR-023


def test_profile_items_are_checked():
    good = pp.clean_item({"kind": "earliest_start", "label": " 朝はゆっくり ", "value": "11:00"})
    assert good["label"] == "朝はゆっくり" and good["hardness"] == "hard" and good["unit"] is None
    assert pp.clean_item({"kind": "trip_budget_max", "label": "予算", "value": 80000, "unit": "JPY",
                          "hardness": "soft"})["unit"] == "JPY"
    for bad in ({"kind": "nope", "label": "x", "value": 1}, {"kind": "earliest_start", "label": "", "value": "11:00"},
                {"kind": "earliest_start", "label": "x" * 61, "value": "11:00"},
                {"kind": "earliest_start", "label": "x", "value": "25:00"},
                {"kind": "daily_travel_max", "label": "x", "value": 90, "unit": "JPY"},
                {"kind": "daily_travel_max", "label": "x", "value": True, "unit": "minutes"},
                {"kind": "trip_budget_max", "label": "x", "value": -1, "unit": "JPY"},
                {"kind": "avoid_text", "label": "x", "value": " "},
                {"kind": "avoid_text", "label": "x", "value": "生魚", "hardness": "maybe"}, "x"):
        with pytest.raises(Exception) as e:
            pp.clean_item(bad)
        assert getattr(e.value, "status_code", None) == 422, bad
    with pytest.raises(Exception):
        pp.clean_items([{"kind": "avoid_text", "label": "x", "value": "y"}] * 21)
    same = str(uuid.uuid4())
    with pytest.raises(Exception):
        pp.clean_items([{"id": same, "kind": "avoid_text", "label": "x", "value": "y"},
                        {"id": same, "kind": "avoid_text", "label": "z", "value": "w"}])
    spec = pp.constraint_spec(good, uuid.UUID(int=1))
    assert (spec["constraint_type"], spec["operator"], spec["scope_type"]) == ("preference", "after", "member")
    assert spec["scope_id"] == uuid.UUID(int=1) and spec["weight"] is None


PROFILE = "/api/v1/privacy/private-profile"


def test_private_profile_is_encrypted_and_versioned(auth_client, db_session, audit_calls):
    client, user = auth_client
    first = client.get(PROFILE).json()
    assert first["revision"] == 0 and first["items"] == [] and len(first["kinds"]) == len(pp.KINDS)
    body = {"items": [{"kind": "earliest_start", "label": "朝はゆっくりしたい", "value": "11:00"}]}
    assert client.put(PROFILE, json=body).status_code == 428
    r = client.put(PROFILE, json=body, headers={"If-Match": "0"})
    assert r.status_code == 200, r.text
    assert r.json()["revision"] == 1 and r.json()["items"][0]["label"] == "朝はゆっくりしたい"
    assert client.put(PROFILE, json=body, headers={"If-Match": "0"}).status_code == 409
    assert client.put(PROFILE, json={"items": [{"kind": "x"}]}, headers={"If-Match": "1"}).status_code == 422
    row = db_session.query(UserPrivateProfile).filter(UserPrivateProfile.user_id == user.id).one()
    assert "朝はゆっくり".encode() not in row.items_ciphertext and b"11:00" not in row.items_ciphertext
    logged = json.dumps([c.get("details") for c in audit_calls], ensure_ascii=False, default=str)
    assert "朝はゆっくり" not in logged and "11:00" not in logged


def test_profile_applied_to_trip_is_private_and_drives_feasibility(auth_client, make_user, db_session, audit_calls):
    client, owner, editor, plan_id, base, day_id, ev = _setup(auth_client, make_user, db_session)
    _act_as(editor)
    assert client.put(f"{base}/private-profile", json={"applied": True}).json is not None
    empty = client.put(f"{base}/private-profile", json={"applied": True})
    assert empty.status_code == 409 and empty.json()["detail"]["code"] == "profile_empty"
    item_id = str(uuid.uuid4())
    saved = client.put(PROFILE, headers={"If-Match": "0"}, json={"items": [
        {"id": item_id, "kind": "earliest_start", "label": "朝はゆっくりしたい", "value": "11:00"}]})
    assert saved.status_code == 200, saved.text
    applied = client.put(f"{base}/private-profile", json={"applied": True})
    assert applied.status_code == 200, applied.text
    assert applied.json()["applied"] is True and applied.json()["applied_constraints"] == 1
    assert client.get(PROFILE).json()["applied_plans"] == [{"plan_id": plan_id, "title": "C1共同"}]

    mine = client.get(f"{base}/constraints").json()
    assert len(mine) == 1 and mine[0]["from_profile"] is True and mine[0]["title"] == "朝はゆっくりしたい"
    cid = mine[0]["id"]
    rev = mine[0]["revision"]
    patched = client.patch(f"{base}/constraints/{cid}", json={"title": "変更"}, headers={"If-Match": str(rev)})
    assert patched.status_code == 409 and "非公開の条件" in patched.json()["detail"]
    assert client.delete(f"{base}/constraints/{cid}", headers={"If-Match": str(rev)}).status_code == 409

    # 所有者: 伏せた形だけ。判定は「秘匿制約を満たしていません」だけ
    _act_as(owner)
    theirs = client.get(f"{base}/constraints").json()
    assert len(theirs) == 1 and theirs[0]["visibility"] == "masked" and theirs[0]["title"] is None
    assert "from_profile" not in theirs[0]
    run = client.post(f"{base}/validation-runs")
    assert run.status_code == 201, run.text
    text = json.dumps(run.json(), ensure_ascii=False)
    assert PRIVATE_MESSAGE in text and "朝はゆっくり" not in text and "11:00" not in text
    _act_as(editor)
    own_run = json.dumps(client.post(f"{base}/validation-runs").json(), ensure_ascii=False)
    assert "朝はゆっくりしたい" in own_run

    # プロフィールを変える → 適用中の旅行の制約も変わる(条件を満たす)
    client.put(PROFILE, headers={"If-Match": "1"}, json={"items": [
        {"id": item_id, "kind": "earliest_start", "label": "朝はゆっくりしたい", "value": "09:00"},
        {"kind": "avoid_text", "label": "苦手なもの", "value": "湯豆腐", "hardness": "soft"}]})
    mine = client.get(f"{base}/constraints").json()
    assert sorted(c["title"] for c in mine) == ["朝はゆっくりしたい", "苦手なもの"]
    by_title = {c["title"]: c for c in mine}
    assert by_title["朝はゆっくりしたい"]["id"] == cid  # 同じ項目は同じ制約を更新する
    _act_as(owner)
    run = client.post(f"{base}/validation-runs").json()
    assert PRIVATE_MESSAGE not in json.dumps(run, ensure_ascii=False)

    # 項目を消すと制約も消える。適用をやめると全部消える
    _act_as(editor)
    client.put(PROFILE, headers={"If-Match": "2"}, json={"items": [
        {"id": item_id, "kind": "earliest_start", "label": "朝はゆっくりしたい", "value": "09:00"}]})
    assert len(client.get(f"{base}/constraints").json()) == 1
    off = client.put(f"{base}/private-profile", json={"applied": False}).json()
    assert off["applied"] is False and off["applied_constraints"] == 0
    assert client.get(f"{base}/constraints").json() == []
    logged = json.dumps([c.get("details") for c in audit_calls], ensure_ascii=False, default=str)
    assert "朝はゆっくり" not in logged and "湯豆腐" not in logged


def test_profile_export_and_account_deletion(auth_client, make_user, db_session):
    client, owner, editor, plan_id, base, day_id, ev = _setup(auth_client, make_user, db_session)
    _act_as(editor)
    client.put(PROFILE, headers={"If-Match": "0"}, json={"items": [
        {"kind": "latest_end", "label": "夜は早めに", "value": "20:00"}]})
    client.put(f"{base}/private-profile", json={"applied": True})
    plan = db_session.get(__import__("app.models.models", fromlist=["TravelPlan"]).TravelPlan, uuid.UUID(plan_id))
    links = dx.plan_tables(db_session, plan, editor.id)["private_profile_links"]
    assert len(links) == 1
    assert dx.plan_tables(db_session, plan, owner.id)["private_profile_links"] == []
    ad.delete_account(db_session, editor)
    db_session.flush()
    assert db_session.query(UserPrivateProfile).filter(UserPrivateProfile.user_id == editor.id).count() == 0
    assert db_session.query(PrivateProfileLink).filter(PrivateProfileLink.user_id == editor.id).count() == 0
    assert db_session.query(PlanConstraint).filter(PlanConstraint.owner_user_id == editor.id,
                                                   PlanConstraint.deleted_at.is_(None)).count() == 0
