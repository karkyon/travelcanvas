"""
[Gate P6] FR-039 データポータビリティ(旅行単位・アカウント単位のエクスポート、保持期間の説明)の統合テスト。

検証する主な性質:
- 旅行単位: 所有者だけ(編集者は403 owner_only)。正本の各表が入り、件数と一致する
- 暗号文・照合用ハッシュ・トークン・保存キー・メールは出さず、policy.omitted_fields に列挙する
- 本人だけの情報(個人の持ち物・秘匿制約・個人予算)は要求者本人の分だけ復号して出し、他人の分は行ごと出さない
- 匿名の投票は他人の回答を出さない。削除済みコメントの本文は出さない。文書はmanifest(SHA-256等)
- アカウント単位: 本人のプロフィール(メールを含む)・所有する旅行・参加している旅行での本人の作成物だけ
- 応答はattachment・no-store・X-Content-SHA256。監査は範囲と件数だけ
- 保持期間の説明は設定値(削除の猶予日数)と一致する
"""
import hashlib
import io
import json
import uuid

import pytest

from app.api.v1 import data_export as export_api
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import Comment, PlanCollaborator

CONFIRMATION = "PNR7788990011"


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(export_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _setup(auth_client, make_user, db_session):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "エクスポート旅行"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    editor, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=editor.id, email=editor.email, role="editor",
                                    status="accepted"))
    db_session.commit()
    day = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()
    client.post(f"{base}/events", json={"day_id": day["id"], "title": "清水寺"}, headers=_ik())
    res = client.post(f"{base}/reservations", json={
        "type": "flight", "provider_name": "航空", "confirmation_number": CONFIRMATION}).json()
    client.post(f"{base}/reservations/{res['id']}/tickets",
                json={"ticket_type": "boarding_pass", "payload": "QR-PAYLOAD-SECRET"})
    client.post(f"{base}/packing-items", json={"name": "傘", "category": "other"})
    client.post(f"{base}/packing-items", json={"name": "自分の薬", "category": "health", "scope": "personal"})
    client.post(f"{base}/budgets", json={"kind": "member", "amount": "30000"})
    client.post(f"{base}/expenses", json={"title": "昼食", "amount": "2000", "currency": "JPY", "category": "food"})
    anon = client.post(f"{base}/polls", json={"title": "匿名", "is_anonymous": True,
                                              "options": [{"label": "A"}]}).json()
    option_id = anon["options"][0]["id"]
    client.put(f"{base}/polls/{anon['id']}/votes", json={"votes": [{"option_id": option_id, "value": "love"}]})
    c = client.post(f"{base}/comments", json={"body": "消すコメント"}).json()
    client.delete(f"{base}/comments/{c['id']}", headers={"If-Match": str(c["revision"])})
    client.post(f"{base}/comments", json={"body": "残るコメント"})

    _act_as(editor)
    client.post(f"{base}/packing-items", json={"name": "編集者の薬", "category": "health", "scope": "personal"})
    client.post(f"{base}/budgets", json={"kind": "member", "amount": "99999"})
    r = client.post(f"{base}/constraints", json={
        "title": "編集者の秘匿上限", "constraint_type": "forbidden", "hardness": "soft", "operator": "avoid",
        "value": {"value": "12345"}, "privacy_level": "private", "scope_type": "member", "reason": "編集者の事情"})
    assert r.status_code == 201, r.text
    client.put(f"{base}/polls/{anon['id']}/votes", json={"votes": [
        {"option_id": option_id, "value": "concern", "reason": "編集者の理由"}]})
    client.post(f"{base}/comments", json={"body": "編集者のコメント"})
    _act_as(owner)
    return client, p, owner, editor, r


def _load(res):
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("application/json")
    assert res.headers["cache-control"] == "no-store"
    assert "attachment" in res.headers["content-disposition"]
    assert res.headers["x-content-sha256"] == hashlib.sha256(res.content).hexdigest()
    return json.loads(res.content)


def test_plan_export_contents_and_privacy(auth_client, make_user, db_session, audit_calls):
    client, p, owner, editor, constraint_res = _setup(auth_client, make_user, db_session)
    data = _load(client.get(f"/api/v1/plans/{p}/data-export"))
    raw = json.dumps(data, ensure_ascii=False)
    assert data["format"] == "travelcanvas-export" and data["version"] == 1 and data["scope"] == "plan"
    assert data["requested_by"]["username"] == owner.username
    exp = data["plans"][0]
    t = exp["tables"]
    assert exp["plan"]["id"] == p and exp["plan"]["title"] == "エクスポート旅行"
    assert exp["counts"] == {k: len(v) for k, v in t.items()}
    assert [e["title"] for e in t["travel_events"]] == ["清水寺"]
    # 暗号文・ハッシュ・トークン・メールは出さない
    for secret in (CONFIRMATION, "QR-PAYLOAD-SECRET", editor.email, owner.email):
        assert secret not in raw
    assert t["reservations"][0]["confirmation_number_masked"].endswith("0011")
    assert "pin_ciphertext" not in t["reservations"][0] and "payload_ciphertext" not in t["tickets"][0]
    assert "email" not in t["plan_collaborators"][0]
    omitted = data["policy"]["omitted_fields"]
    assert "confirmation_number_ciphertext" in omitted["reservations"] and omitted["plan_collaborators"] == ["email"]
    # 本人だけの情報は本人の分だけ
    personal = [x for x in t["packing_items"] if x["scope"] == "personal"]
    assert [x["personal"]["name"] for x in personal] == ["自分の薬"]
    for other in ("編集者の薬", "99999", "編集者の秘匿上限", "12345", "編集者の事情"):
        assert other not in raw
    assert [b["amount"] for b in t["budgets"] if b["kind"] == "member"] == ["30000"]
    assert t["constraints"] == []
    # 匿名の投票は他人の回答を出さない。削除済みコメントは本文なし
    assert [v["value"] for v in t["votes"]] == ["love"] and "編集者の理由" not in raw
    bodies = sorted(c["body"] or "" for c in t["comments"])
    assert bodies == ["", "残るコメント", "編集者のコメント"] and "消すコメント" not in raw
    assert data["retention"]["plan_delete_grace_days"] == settings.PLAN_DELETE_GRACE_DAYS
    assert audit_calls[-1]["action"] == "plan_data_exported"
    assert audit_calls[-1]["details"]["counts"]["travel_events"] == 1
    assert "清水寺" not in json.dumps(audit_calls, ensure_ascii=False, default=str)


def test_plan_export_owner_only(auth_client, make_user, db_session):
    client, p, owner, editor, _ = _setup(auth_client, make_user, db_session)
    _act_as(editor)
    res = client.get(f"/api/v1/plans/{p}/data-export")
    assert res.status_code == 403 and res.json()["detail"]["code"] == "owner_only"
    stranger, _ = make_user()
    _act_as(stranger)
    assert client.get(f"/api/v1/plans/{p}/data-export").status_code == 403


def test_document_manifest(auth_client, db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "文書"}).json()["id"]
    content = b"%PDF-1.4\n%gate p6 export manifest\n"
    res = client.post(f"/api/v1/plans/{p}/documents/upload",
                      files={"file": ("領収書.pdf", io.BytesIO(content), "application/pdf")})
    assert res.status_code == 201, res.text
    doc = res.json()
    data = _load(client.get(f"/api/v1/plans/{p}/data-export"))
    manifest = data["plans"][0]["document_manifest"]
    assert len(manifest) == 1
    assert manifest[0]["id"] == doc["id"] and manifest[0]["original_filename"] == "領収書.pdf"
    assert manifest[0]["sha256"] == hashlib.sha256(content).hexdigest() and manifest[0]["size"] == len(content)
    assert manifest[0]["mime_type"] == "application/pdf"
    row = data["plans"][0]["tables"]["documents"][0]
    assert "storage_key" not in row and "original_filename_ciphertext" not in row


def test_account_export(auth_client, make_user, db_session, audit_calls):
    client, p, owner, editor, constraint_res = _setup(auth_client, make_user, db_session)
    other_owned = client.post("/api/v1/travel-plans/", json={"title": "2つ目の旅行"}).json()["id"]
    data = _load(client.get("/api/v1/privacy/data-export"))
    assert data["scope"] == "account" and data["profile"]["email"] == owner.email
    assert "hashed_password" not in data["profile"]
    assert {x["plan"]["id"] for x in data["plans"]} == {p, other_owned}
    assert data["memberships"] == [] and data["contributions"] == []
    assert audit_calls[-1]["details"] == {"owned_plans": 2, "member_plans": 0}

    _act_as(editor)
    ed = _load(client.get("/api/v1/privacy/data-export"))
    raw = json.dumps(ed, ensure_ascii=False)
    assert ed["plans"] == [] and ed["memberships"] == [{"plan_id": p, "title": "エクスポート旅行", "role": "editor"}]
    contrib = ed["contributions"][0]
    assert [x["personal"]["name"] for x in contrib["personal_packing_items"]] == ["編集者の薬"]
    assert contrib["constraints"][0]["private_value"]["title"] == "編集者の秘匿上限"
    assert contrib["constraints"][0]["reason"] == "編集者の事情"
    assert [b["amount"] for b in contrib["member_budgets"]] == ["99999"]
    assert [c["body"] for c in contrib["comments"]] == ["編集者のコメント"]
    assert [v["reason"] for v in contrib["votes"]] == ["編集者の理由"]
    for other in ("自分の薬", "30000", "残るコメント", owner.email):
        assert other not in raw
    # 招待の通知は本人宛てのものだけ
    assert all(n["user_id"] == str(editor.id) for n in ed["notifications"])
    assert db_session.query(Comment).count() >= 3


def test_retention_info(auth_client):
    client, _ = auth_client
    res = client.get("/api/v1/privacy/retention")
    assert res.status_code == 200
    body = res.json()
    assert body["plan_delete_grace_days"] == settings.PLAN_DELETE_GRACE_DAYS
    keys = [i["key"] for i in body["items"]]
    assert keys == ["deleted_plan", "quick_draft", "documents", "audit", "backup", "exported"]
    assert f"{settings.PLAN_DELETE_GRACE_DAYS}日間" in body["items"][0]["note"]
