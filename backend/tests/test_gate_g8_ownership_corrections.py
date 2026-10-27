"""
[Gate G8] FR-021・FR-039 所有者の移譲と、出典・確認・履歴つきの訂正の統合テスト(実PostgreSQL)。

所有者の移譲:
- 所有者がパスワードで本人確認して、参加済みの会員の共同編集者へ申し出る(招待中・部外者・ゲストは選べない)
- 手続き中は1件。旅行の削除・受け取る人を外すことは 409。取り下げ・断る・期限切れ(410)
- 受け入れはパスワード。所有者が替わり、前の所有者は選んだ役割で残る(none なら外れる)。受け取る人の共同編集者の行は消える
- 受け入れの前に所有者が替わった・受け取る人が外れた等は 409(申し出は無効になる)
- アカウントを削除すると手続き中の移譲は取り下げになる。旅行の書き出しに含まれる
- 監査に旅行名・メッセージ・メールアドレスを残さない

訂正:
- 表示名は本人のセッションで、メールアドレスはパスワードで訂正する。出典・補足・前後の値を本人の鍵で暗号化して履歴に残す
- メールアドレスの訂正は確認済みの印を外す。取り消しは今の値が訂正の後のままの時だけ
- 参加者は所有者へ訂正を申し出る(所有者には通知)。所有者は全て、参加者は自分の申し出だけ見える。所有者が対応・見送りを記録
- アカウントの書き出しに入り、アカウントの削除で消える
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import corrections as corrections_api
from app.api.v1 import ownership as ownership_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import (
    DataCorrection, Notification, PlanCollaborator, PlanOwnershipTransfer, TravelPlan, User,
)

PW = "TestPass123!"


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(ownership_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(corrections_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(ownership_api, "check_rate_limit", lambda *a, **k: True)
    monkeypatch.setattr(corrections_api, "check_rate_limit", lambda *a, **k: True)
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _plan(client, title="移譲テスト旅行"):
    r = client.post("/api/v1/travel-plans/", json={"title": title})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _member(db_session, make_user, plan_id, role="editor", status="accepted"):
    user, _ = make_user()
    c = PlanCollaborator(id=uuid.uuid4(), plan_id=uuid.UUID(plan_id), user_id=user.id, email=user.email, role=role,
                         status=status)
    db_session.add(c)
    db_session.commit()
    return user, c


def test_transfer_request_accept_and_roles(auth_client, make_user, db_session, audit_calls):
    client, owner = auth_client
    p = _plan(client)
    bob, bob_c = _member(db_session, make_user, p)
    invited, inv_c = _member(db_session, make_user, p, status="pending")
    url = f"/api/v1/plans/{p}/ownership-transfer"
    info = client.get(url).json()
    assert info["can_transfer"] is True and [c["collaborator_id"] for c in info["candidates"]] == [str(bob_c.id)]
    # 招待中の人は選べない・パスワードが違えば断る
    bad = client.post(url, json={"collaborator_id": str(inv_c.id), "password": PW})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "not_eligible"
    bad = client.post(url, json={"collaborator_id": str(bob_c.id), "password": "wrong"})
    assert bad.status_code == 403 and bad.json()["detail"]["code"] == "reauth_failed"
    r = client.post(url, json={"collaborator_id": str(bob_c.id), "password": PW, "keep_role": "viewer",
                               "message": "よろしく"})
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "pending" and t["is_sender"] is True and t["keep_role"] == "viewer"
    # 手続き中は2件目・削除・受け取る人を外すことはできない
    assert client.post(url, json={"collaborator_id": str(bob_c.id), "password": PW}).status_code == 409
    d = client.delete(f"/api/v1/travel-plans/{p}")
    assert d.status_code == 409 and d.json()["detail"]["code"] == "ownership_transfer_pending"
    rm = client.delete(f"/api/v1/travel-plans/{p}/collaborators/{bob_c.id}")
    assert rm.status_code == 409
    notes = db_session.query(Notification).filter(Notification.user_id == bob.id,
                                                  Notification.type == "ownership_transfer").all()
    assert len(notes) == 1
    try:
        _act_as(bob)
        incoming = client.get("/api/v1/ownership-transfers/incoming").json()
        assert [x["id"] for x in incoming] == [t["id"]] and incoming[0]["plan_title"] == "移譲テスト旅行"
        assert client.post(f"/api/v1/ownership-transfers/{t['id']}/accept",
                           json={"password": "wrong"}).status_code == 403
        ok = client.post(f"/api/v1/ownership-transfers/{t['id']}/accept", json={"password": PW})
        assert ok.status_code == 200, ok.text
        assert ok.json()["status"] == "accepted"
        plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).one()
        db_session.refresh(plan)
        assert plan.user_id == bob.id
        collabs = {c.user_id: c.role for c in db_session.query(PlanCollaborator).filter(
            PlanCollaborator.plan_id == plan.id).all()}
        assert collabs.get(owner.id) == "viewer" and bob.id not in collabs
        # 新しい所有者は削除・共有の管理ができる
        assert client.get(url).json()["role"] == "owner"
    finally:
        _act_as(owner)
    assert client.get(url).json()["role"] == "viewer"
    assert client.delete(f"/api/v1/travel-plans/{p}").status_code in (403, 404)
    for c in audit_calls:
        s = str(c)
        assert "移譲テスト旅行" not in s and "よろしく" not in s and (owner.email or "x") not in s


def test_transfer_decline_cancel_expire_and_invalidated(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    bob, bob_c = _member(db_session, make_user, p)
    carol, carol_c = _member(db_session, make_user, p)
    url = f"/api/v1/plans/{p}/ownership-transfer"
    t = client.post(url, json={"collaborator_id": str(bob_c.id), "password": PW, "keep_role": "none"}).json()
    try:
        _act_as(bob)
        assert client.post(f"/api/v1/ownership-transfers/{t['id']}/decline").json()["status"] == "declined"
        assert client.post(f"/api/v1/ownership-transfers/{t['id']}/accept",
                           json={"password": PW}).status_code == 409
    finally:
        _act_as(owner)
    t2 = client.post(url, json={"collaborator_id": str(carol_c.id), "password": PW}).json()
    assert client.post(f"{url}/cancel").json()["status"] == "cancelled"
    # 期限切れ: 受け入れられず(410)、次の申し出で閉じる
    t3 = client.post(url, json={"collaborator_id": str(carol_c.id), "password": PW}).json()
    row = db_session.query(PlanOwnershipTransfer).filter(PlanOwnershipTransfer.id == uuid.UUID(t3["id"])).one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()
    assert client.get(url).json()["transfer_in_progress"] is False
    assert client.delete(f"/api/v1/travel-plans/{p}/collaborators/{bob_c.id}").status_code == 200
    try:
        _act_as(carol)
        assert client.get("/api/v1/ownership-transfers/incoming").json() == []
        r = client.post(f"/api/v1/ownership-transfers/{t3['id']}/accept", json={"password": PW})
        assert r.status_code == 410
    finally:
        _act_as(owner)
    t4 = client.post(url, json={"collaborator_id": str(carol_c.id), "password": PW, "keep_role": "editor"})
    assert t4.status_code == 201, t4.text
    db_session.expire_all()
    assert db_session.query(PlanOwnershipTransfer).filter(
        PlanOwnershipTransfer.id == uuid.UUID(t3["id"])).one().status == "cancelled"
    # 受け入れの前に受け取る人が外れていた → 無効(409)
    db_session.query(PlanCollaborator).filter(PlanCollaborator.id == carol_c.id).update({"status": "declined"})
    db_session.commit()
    try:
        _act_as(carol)
        r = client.post(f"/api/v1/ownership-transfers/{t4.json()['id']}/accept", json={"password": PW})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "transfer_invalidated"
    finally:
        _act_as(owner)
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).one()
    assert plan.user_id == owner.id
    assert t2["status"] == "pending"


def test_account_deletion_closes_transfers_and_export_includes(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    bob, bob_c = _member(db_session, make_user, p)
    t = client.post(f"/api/v1/plans/{p}/ownership-transfer",
                    json={"collaborator_id": str(bob_c.id), "password": PW}).json()
    exp = client.get(f"/api/v1/plans/{p}/data-export")
    assert exp.status_code == 200, exp.text
    tables = exp.json()["plans"][0]["tables"]
    assert [x["id"] for x in tables["plan_ownership_transfers"]] == [t["id"]]
    from app.services import account_deletion

    me = db_session.query(User).filter(User.id == bob.id).one()
    summary = account_deletion.delete_account(db_session, me)
    db_session.commit()
    assert summary["ownership_transfers_closed"] == 1
    row = db_session.query(PlanOwnershipTransfer).filter(PlanOwnershipTransfer.id == uuid.UUID(t["id"])).one()
    assert row.status == "cancelled"


# ---------------------------------------------------------------- 訂正

def test_self_correction_history_revert_and_email_reauth(auth_client, db_session, audit_calls):
    client, owner = auth_client
    old_name, old_email = owner.username, owner.email
    r = client.post("/api/v1/privacy/corrections", json={
        "field": "username", "value": "  正しい名前 ", "source": "official_document", "source_note": "旅券の表記"})
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["before"] == old_name and c["after"] == "正しい名前" and c["verification"] == "session"
    assert c["source_label"] == "公的な書類" and c["source_note"] == "旅券の表記"
    row = db_session.query(DataCorrection).filter(DataCorrection.id == uuid.UUID(c["id"])).one()
    assert b"tc2:dek:" in bytes(row.payload_ciphertext) and "正しい名前".encode() not in bytes(row.payload_ciphertext)
    # 同じ値・不明な項目・不明な出典
    assert client.post("/api/v1/privacy/corrections", json={"field": "username", "value": "正しい名前",
                                                            "source": "other"}).status_code == 422
    assert client.post("/api/v1/privacy/corrections", json={"field": "role", "value": "admin",
                                                            "source": "other"}).status_code == 422
    assert client.post("/api/v1/privacy/corrections", json={"field": "username", "value": "x",
                                                            "source": "rumor"}).status_code == 422
    # メールアドレスはパスワードが要る
    new_email = f"fixed_{uuid.uuid4().hex[:8]}@example.com"
    assert client.post("/api/v1/privacy/corrections", json={"field": "email", "value": new_email,
                                                            "source": "self_statement"}).status_code == 403
    e = client.post("/api/v1/privacy/corrections", json={"field": "email", "value": new_email,
                                                         "source": "self_statement", "password": PW})
    assert e.status_code == 201, e.text
    db_session.refresh(owner)
    assert owner.email == new_email and owner.is_verified is False
    hist = client.get("/api/v1/privacy/corrections").json()
    assert [h["field"] for h in hist["history"]] == ["email", "username"]
    # 取り消し: 表示名
    rv = client.post(f"/api/v1/privacy/corrections/{c['id']}/revert", json={})
    assert rv.status_code == 200 and rv.json()["status"] == "reverted"
    db_session.refresh(owner)
    assert owner.username == old_name
    assert client.post(f"/api/v1/privacy/corrections/{c['id']}/revert", json={}).status_code == 409
    # 訂正の後に値が変わっていれば取り消せない
    owner.email = f"other_{uuid.uuid4().hex[:6]}@example.com"
    db_session.commit()
    assert client.post(f"/api/v1/privacy/corrections/{e.json()['id']}/revert",
                       json={"password": PW}).status_code == 409
    for call in audit_calls:
        s = str(call)
        assert "正しい名前" not in s and "旅券の表記" not in s and new_email not in s
    assert old_email


def test_correction_requests_to_owner(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client, "訂正の旅行")
    bob, _ = _member(db_session, make_user, p, role="viewer")
    carol, _ = _member(db_session, make_user, p, role="editor")
    url = f"/api/v1/plans/{p}/correction-requests"
    assert client.post(url, json={"field_label": "予約の名義", "proposed_value": "A",
                                  "source": "other"}).status_code == 422  # 所有者は直接直す
    try:
        _act_as(bob)
        r = client.post(url, json={"field_label": "予約の名義", "current_value": "山田 太朗",
                                   "proposed_value": "山田 太郎", "source": "booking_document",
                                   "source_note": "確認書の通り"})
        assert r.status_code == 201, r.text
        req = r.json()
        assert req["status"] == "open" and req["proposed_value"] == "山田 太郎"
        _act_as(carol)
        assert client.get(url).json() == []  # 他の人の申し出は見えない
        assert client.post(f"{url}/{req['id']}/resolve", json={"status": "resolved"}).status_code in (403, 404)
    finally:
        _act_as(owner)
    rows = client.get(url).json()
    assert len(rows) == 1 and rows[0]["requester_name"] == bob.username and rows[0]["current_value"] == "山田 太朗"
    note = db_session.query(Notification).filter(Notification.user_id == owner.id,
                                                 Notification.type == "correction_request").one()
    assert "山田" not in (note.message or "")
    done = client.post(f"{url}/{req['id']}/resolve", json={"status": "resolved", "note": "直しました"})
    assert done.status_code == 200 and done.json()["status"] == "resolved"
    assert client.post(f"{url}/{req['id']}/resolve", json={"status": "declined"}).status_code == 409
    try:
        _act_as(bob)
        mine = client.get("/api/v1/privacy/corrections").json()["requests"]
        assert mine[0]["status"] == "resolved" and mine[0]["resolution_note"] == "直しました"
        assert mine[0]["plan_title"] == "訂正の旅行"
        exp = client.get("/api/v1/privacy/data-export")
        assert exp.status_code == 200, exp.text
        assert exp.json()["corrections"]["requests"][0]["proposed_value"] == "山田 太郎"
        from app.services import account_deletion

        me = db_session.query(User).filter(User.id == bob.id).one()
        assert account_deletion.delete_account(db_session, me)["data_corrections"] == 1
        db_session.commit()
    finally:
        _act_as(owner)
    assert client.get(url).json() == []


def test_corrections_without_encryption_change_nothing(auth_client, make_user, db_session, monkeypatch):
    """暗号化が設定されていない時は、値を変えずに 503(訂正の前後・申し出の内容は暗号化して残す決まり)。"""
    client, owner = auth_client
    p = _plan(client)
    bob, _ = _member(db_session, make_user, p)
    before = owner.username
    from app.core import crypto

    def boom(*a, **k):
        raise crypto.EncryptionNotConfigured("no key")

    monkeypatch.setattr(crypto, "encrypt_payload", boom)
    r = client.post("/api/v1/privacy/corrections", json={"field": "username", "value": "変わらない名前",
                                                         "source": "self_statement"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "encryption_not_configured"
    db_session.expire_all()
    assert db_session.query(User).filter(User.id == owner.id).one().username == before
    assert db_session.query(DataCorrection).filter(DataCorrection.user_id == owner.id).count() == 0
    try:
        _act_as(bob)
        r = client.post(f"/api/v1/plans/{p}/correction-requests", json={
            "field_label": "名義", "proposed_value": "B", "source": "other"})
        assert r.status_code == 503
    finally:
        _act_as(owner)
    assert db_session.query(DataCorrection).count() == 0
