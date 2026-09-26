"""
[Gate B-012] プラン削除(論理削除 → 猶予期間 → 完全削除)の試験(実PostgreSQL)。

B-012: 日程を1件でも持つプランの DELETE /travel-plans/{id} が500だった(change_sets等の
外部キーに削除時の扱いが無かった)。検証する性質:
- 子データの種類によらず削除でき、以後プランは存在しないもの(404)として扱われる
- 共有リンクは即時失効、招待は見えなくなる。所有者は猶予期間内なら復元できる
- 完全削除でプランが所有する全テーブルの行が消え、文書の実ファイルも消える。
  通知・共有アクセスログはプラン外のデータとして残り、参照だけ外れる
- 外部キーの削除方針が漏れなく定義されている(将来テーブルを追加した時の検査を兼ねる)
- 通常の操作ではプラン内の横の参照は従来どおり即時に検査される
"""
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1 import travel as travel_module
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import TravelPlan
from app.services import plan_deletion

H = lambda: {"Idempotency-Key": str(uuid.uuid4())}  # noqa: E731
PDF = b"%PDF-1.4\n%gate b012\n"


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "docs"))
    crypto_module.reset_cache_for_tests()
    for mod in ("app.api.v1.documents", "app.api.v1.reservations", "app.api.v1.constraints", "app.api.v1.imports"):
        m = __import__(mod, fromlist=["x"])
        if hasattr(m, "record_audit_event"):
            monkeypatch.setattr(m, "record_audit_event", lambda **kw: None)
    yield
    crypto_module.reset_cache_for_tests()


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(travel_module, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(plan_deletion, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _plan(c, title="B012テスト"):
    res = c.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _day(c, p):
    res = c.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"}, headers=H())
    assert res.status_code == 201, res.text
    return res.json()


def _event(c, p, d, title="予定"):
    res = c.post(f"/api/v1/plans/{p}/events", json={"day_id": d["id"], "title": title, "local_start_time": "10:00"},
                 headers=H())
    assert res.status_code == 201, res.text
    return res.json()


def _reservation(c, p, **extra):
    res = c.post(f"/api/v1/plans/{p}/reservations", json={"type": "restaurant", "provider_name": "店", **extra})
    assert res.status_code == 201, res.text
    return res.json()


def _share_token(c, p):
    res = c.post(f"/api/v1/travel-plans/{p}/share", json={"permission": "view"})
    assert res.status_code == 200, res.text
    body = res.json()
    return body["id"], body["url"].rstrip("/").split("/")[-1]


def _invite(c, p, user, role="editor"):
    res = c.post(f"/api/v1/travel-plans/{p}/collaborators", json={"email": user.email, "role": role})
    assert res.status_code == 200, res.text


def _member_id(db, p):
    return db.execute(text("SELECT id FROM plan_collaborators WHERE plan_id = :p"), {"p": p}).scalar()


def _upload(c, p):
    res = c.post(f"/api/v1/plans/{p}/documents/upload",
                 files={"file": ("a.pdf", io.BytesIO(PDF), "application/pdf")},
                 data={"classification": "confidential", "document_type": "receipt"})
    assert res.status_code == 201, res.text
    return res.json()


# ---------------------------------------------------------------- B-012の再現(子データの種類ごと)

def _with_day(c, p, db, mk):
    _day(c, p)


def _with_reservation_on_event(c, p, db, mk):
    e = _event(c, p, _day(c, p))
    _reservation(c, p, event_id=e["id"])


def _with_segment_and_route(c, p, db, mk):
    d = _day(c, p)
    a, b = _event(c, p, d, "A"), _event(c, p, d, "B")
    assert c.post(f"/api/v1/plans/{p}/segments", json={"from_event_id": a["id"], "to_event_id": b["id"],
                                                       "mode": "walking"}, headers=H()).status_code == 201
    assert c.post(f"/api/v1/plans/{p}/route-options", json={"from_event_id": a["id"], "to_event_id": b["id"],
                                                            "legs": [{"mode": "walking", "sequence": 0}]},
                  headers=H()).status_code == 201


def _with_ticket_and_member_participant(c, p, db, mk):
    member, _ = mk()
    _invite(c, p, member)
    mid = str(_member_id(db, p))
    r = _reservation(c, p)
    assert c.post(f"/api/v1/plans/{p}/reservations/{r['id']}/tickets",
                  json={"ticket_type": "entry", "payload": "QR", "holder_member_id": mid}).status_code == 201
    assert c.post(f"/api/v1/plans/{p}/reservations/{r['id']}/participants",
                  json={"name": "同行者", "plan_member_id": mid}).status_code == 201


def _with_document_and_import(c, p, db, mk):
    doc = _upload(c, p)
    res = c.post(f"/api/v1/plans/{p}/imports", json={"consent_given": True, "document_id": doc["id"]})
    assert res.status_code == 201, res.text


def _with_accessed_share_link(c, p, db, mk):
    _, token = _share_token(c, p)
    assert c.post(f"/api/v1/public/share/{token}/resolve", json={}).status_code == 200


def _with_invitation_notification(c, p, db, mk):
    member, _ = mk()
    _invite(c, p, member)


SCENARIOS = {
    "day_only(change_sets)": _with_day,
    "reservation_on_event": _with_reservation_on_event,
    "segment_and_route_option": _with_segment_and_route,
    "ticket_and_member_participant": _with_ticket_and_member_participant,
    "document_and_import": _with_document_and_import,
    "accessed_share_link": _with_accessed_share_link,
    "invitation_notification": _with_invitation_notification,
}


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_plan_with_any_child_data_can_be_deleted_and_purged(name, auth_client, make_user, db_session):
    client, _owner = auth_client
    p = _plan(client)
    SCENARIOS[name](client, p, db_session, make_user)

    res = client.delete(f"/api/v1/travel-plans/{p}")
    assert res.status_code == 200, res.text
    assert client.get(f"/api/v1/travel-plans/{p}").status_code == 404

    res = client.delete(f"/api/v1/travel-plans/{p}/permanent")
    assert res.status_code == 200, res.text
    db_session.expire_all()
    assert db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).count() == 0


def test_plan_promoted_from_quickdraft_can_be_purged(auth_client, db_session):
    client, _owner = auth_client
    body = {"title": "qd", "start_date": str(date.today()), "end_date": str(date.today()),
            "events": [{"title": "x", "local_date": str(date.today())}]}
    draft = client.post("/api/v1/quick-drafts", json=body, headers=H()).json()
    promoted = client.post(f"/api/v1/quick-drafts/{draft['id']}/promote", json={"device_token": draft["device_token"]},
                           headers=H())
    assert promoted.status_code == 201, promoted.text
    p = promoted.json()["id"]
    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 200
    assert client.delete(f"/api/v1/travel-plans/{p}/permanent").status_code == 200
    # QuickDraftは残り、promote先の参照だけ外れる(下書き自体は既存の30日purgeに任せる)
    sql = text("SELECT promoted_plan_id FROM quick_drafts WHERE id = :d")
    row = db_session.execute(sql, {"d": draft["id"]}).first()
    assert row is not None and row[0] is None


# ---------------------------------------------------------------- 完全削除の網羅性

PLAN_TABLES = (
    "travel_days", "travel_events", "change_sets", "plan_versions", "plan_share_links", "plan_collaborators",
    "reservations", "travel_segments", "route_options", "documents", "import_jobs", "constraints", "validation_runs",
)


def _populate_everything(c, db, member):
    p = _plan(c, "全部入り")
    d = _day(c, p)
    a, b = _event(c, p, d, "A"), _event(c, p, d, "B")
    _invite(c, p, member)
    mid = str(_member_id(db, p))
    r = _reservation(c, p, event_id=a["id"], total_amount=1000, currency="JPY", confirmation_number="ABC123")
    assert c.post(f"/api/v1/plans/{p}/reservations/{r['id']}/tickets",
                  json={"ticket_type": "entry", "payload": "QR", "holder_member_id": mid}).status_code == 201
    assert c.post(f"/api/v1/plans/{p}/reservations/{r['id']}/participants",
                  json={"name": "同行者", "plan_member_id": mid}).status_code == 201
    assert c.post(f"/api/v1/plans/{p}/reservations/{r['id']}/events",
                  json={"event_id": b["id"], "relation_type": "related"}).status_code == 201
    ro = c.post(f"/api/v1/plans/{p}/route-options", json={"from_event_id": a["id"], "to_event_id": b["id"],
                                                          "legs": [{"mode": "walking", "sequence": 0}]}, headers=H())
    assert ro.status_code == 201, ro.text
    seg = c.post(f"/api/v1/plans/{p}/segments", json={"from_event_id": a["id"], "to_event_id": b["id"],
                                                      "mode": "walking", "reservation_id": r["id"]}, headers=H())
    assert seg.status_code == 201, seg.text
    db.execute(text("UPDATE travel_segments SET route_option_id = :o WHERE id = :s"),
               {"o": ro.json()["id"], "s": seg.json()["id"]})
    doc = _upload(c, p)
    assert c.post(f"/api/v1/plans/{p}/documents/{doc['id']}/links",
                  json={"entity_type": "reservation", "entity_id": r["id"]}).status_code == 201
    job = c.post(f"/api/v1/plans/{p}/imports", json={"consent_given": True, "document_id": doc["id"]}).json()
    assert c.post(f"/api/v1/plans/{p}/imports/{job['id']}/candidates",
                  json={"field_path": "provider_name", "value": "X"}).status_code == 201
    db.execute(text("UPDATE import_jobs SET result_reservation_id = :r WHERE id = :j"), {"r": r["id"], "j": job["id"]})
    _, token = _share_token(c, p)
    assert c.post(f"/api/v1/public/share/{token}/resolve", json={}).status_code == 200
    assert c.post(f"/api/v1/plans/{p}/constraints", json={
        "title": "t", "constraint_type": "preference", "hardness": "soft", "operator": "prefer",
        "value": {"value": "x"},
    }).status_code == 201
    assert c.post(f"/api/v1/plans/{p}/validation-runs").status_code == 201
    db.execute(text("INSERT INTO event_links (id, event_id, link_type, url) "
                    "VALUES (:i, :e, 'url', 'https://example.com')"),
               {"i": str(uuid.uuid4()), "e": a["id"]})
    db.flush()
    storage_key = db.execute(text("SELECT storage_key FROM documents WHERE id = :d"), {"d": doc["id"]}).scalar()
    return p, storage_key


def _plan_rows(db, p):
    counts = {
        t: db.execute(text(f"SELECT count(*) FROM {t} WHERE plan_id = :p"), {"p": p}).scalar() for t in PLAN_TABLES
    }
    for t in ("change_items", "event_reservations", "reservation_participants", "tickets", "route_legs",
              "document_links", "extraction_candidates", "event_links", "validation_issues"):
        counts[t] = db.execute(text(f"SELECT count(*) FROM {t}")).scalar()
    return counts


def test_purge_removes_every_owned_row_and_file_but_keeps_outside_records(
        auth_client, make_user, db_session, audit_calls):
    client, owner = auth_client
    member, _ = make_user()
    p, storage_key = _populate_everything(client, db_session, member)
    file_path = Path(settings.DOCUMENT_STORAGE_DIR) / storage_key
    assert file_path.exists()
    before = _plan_rows(db_session, p)
    assert all(v > 0 for v in before.values()), before
    notifications = db_session.execute(text("SELECT count(*) FROM notifications")).scalar()
    access_logs = db_session.execute(text("SELECT count(*) FROM share_access_logs")).scalar()

    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 200
    # 論理削除中は何も消えていない(復元できる)
    assert _plan_rows(db_session, p) == before and file_path.exists()

    # 猶予期間を過ぎたらバッチで完全削除される
    result = plan_deletion.purge_expired_plans(db_session, now=datetime.now(timezone.utc) + timedelta(days=31))
    assert result == {"purged": 1, "postponed": 0, "failed": 0}
    db_session.expire_all()
    after = _plan_rows(db_session, p)
    assert all(v == 0 for v in after.values()), after
    assert db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).count() == 0
    assert not file_path.exists()
    # プラン外のデータは残り、参照だけ外れる
    assert db_session.execute(text("SELECT count(*) FROM notifications")).scalar() == notifications
    sql = text("SELECT count(*) FROM notifications WHERE related_plan_id = :p")
    assert db_session.execute(sql, {"p": p}).scalar() == 0
    assert db_session.execute(text("SELECT count(*) FROM share_access_logs")).scalar() == access_logs
    # 監査: 削除と完全削除を記録し、題名等の内容は記録しない
    actions = [c["action"] for c in audit_calls]
    assert actions == ["plan.delete", "plan.purge"]
    assert all(str(c["resource_id"]) == p for c in audit_calls)
    assert "全部入り" not in repr(audit_calls)
    assert audit_calls[1]["details"]["counts"]["reservations"] == 1


def test_purge_expired_skips_plans_within_grace_period(auth_client, db_session, monkeypatch):
    client, _owner = auth_client
    monkeypatch.setattr(settings, "PLAN_DELETE_GRACE_DAYS", 7)
    p = _plan(client)
    _day(client, p)
    res = client.delete(f"/api/v1/travel-plans/{p}")
    body = res.json()
    deleted_at = datetime.fromisoformat(body["deleted_at"])
    assert datetime.fromisoformat(body["purge_after"]) - deleted_at == timedelta(days=7)
    assert plan_deletion.purge_expired_plans(db_session, now=deleted_at + timedelta(days=6)) == {
        "purged": 0, "postponed": 0, "failed": 0,
    }
    assert db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).count() == 1
    assert plan_deletion.purge_expired_plans(db_session, now=deleted_at + timedelta(days=7))["purged"] == 1


def test_purge_is_postponed_when_document_file_cannot_be_deleted(auth_client, db_session, monkeypatch):
    client, _owner = auth_client
    p = _plan(client)
    _upload(client, p)
    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 200

    class Broken:
        def delete(self, key):
            raise OSError("storage down")

    monkeypatch.setattr(plan_deletion, "get_storage_backend", lambda: Broken())
    res = client.delete(f"/api/v1/travel-plans/{p}/permanent")
    assert res.status_code == 503
    db_session.expire_all()
    assert db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).count() == 1
    sql = text("SELECT purge_status FROM documents WHERE plan_id = :p")
    assert db_session.execute(sql, {"p": p}).scalar() == "failed"
    assert plan_deletion.purge_expired_plans(db_session, now=datetime.now(timezone.utc) + timedelta(days=31)) == {
        "purged": 0, "postponed": 1, "failed": 0,
    }
    monkeypatch.undo()
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    assert client.delete(f"/api/v1/travel-plans/{p}/permanent").status_code == 200


def test_purge_requires_soft_delete_first(auth_client, db_session):
    client, _owner = auth_client
    p = _plan(client)
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).one()
    with pytest.raises(ValueError):
        plan_deletion.purge_plan(db_session, plan)
    assert client.delete(f"/api/v1/travel-plans/{p}/permanent").status_code == 404


# ---------------------------------------------------------------- 論理削除中の見え方

def test_soft_deleted_plan_is_hidden_everywhere(auth_client, make_user, db_session):
    client, owner = auth_client
    editor, _ = make_user()
    invitee, _ = make_user()
    p = _plan(client)
    _event(client, p, _day(client, p))
    _invite(client, p, editor)
    _act_as(editor)
    collab_id = str(_member_id(db_session, p))
    assert client.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept").status_code == 200
    _act_as(owner)
    _invite(client, p, invitee, role="viewer")
    share_id, token = _share_token(client, p)
    other = _plan(client, "残るプラン")

    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 200
    # 所有者: 詳細・正規化API・配下のAPI・再削除はすべて404、一覧には出ない
    assert client.get(f"/api/v1/travel-plans/{p}").status_code == 404
    assert client.get(f"/api/v1/plans/{p}").status_code == 404
    assert client.get(f"/api/v1/plans/{p}/reservations").status_code == 404
    assert client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-03"}, headers=H()).status_code == 404
    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 404
    listed = [x["id"] for x in client.get("/api/v1/travel-plans/").json()["plans"]]
    assert p not in listed and other in listed
    # 共有リンクは即時失効
    assert client.post(f"/api/v1/public/share/{token}/resolve", json={}).status_code == 404
    sql = text("SELECT revoked_at FROM plan_share_links WHERE id = :s")
    revoked = db_session.execute(sql, {"s": share_id}).scalar()
    assert revoked is not None
    # 共同編集者からも見えない
    _act_as(editor)
    assert client.get(f"/api/v1/plans/{p}").status_code == 404
    assert p not in [x["id"] for x in client.get("/api/v1/travel-plans/").json()["plans"]]
    # 招待中のユーザーには招待が見えず、承諾もできない
    _act_as(invitee)
    invitations = client.get("/api/v1/travel-plans/invitations").json()
    assert all(i["plan_id"] != p for i in invitations)
    pending_id = db_session.execute(
        text("SELECT id FROM plan_collaborators WHERE plan_id = :p AND status = 'pending'"), {"p": p}).scalar()
    assert client.post(f"/api/v1/travel-plans/invitations/{pending_id}/accept").status_code == 404
    _act_as(owner)


def test_admin_statistics_exclude_soft_deleted_plans(auth_client, db_session):
    client, owner = auth_client
    owner.is_superuser = True
    db_session.flush()

    def total():
        res = client.get("/api/v1/admin/stats/system")
        assert res.status_code == 200, res.text
        return res.json()["travel_plans"]["total_plans"]

    before = total()
    p = _plan(client)
    assert total() == before + 1
    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 200
    assert total() == before


# ---------------------------------------------------------------- 削除済み一覧・復元

def test_deleted_list_and_restore_keep_data_and_share_links_stay_revoked(
        auth_client, make_user, db_session, audit_calls):
    client, owner = auth_client
    p = _plan(client, "復元する旅")
    d = _day(client, p)
    _event(client, p, d, "清水寺")
    _reservation(client, p)
    share_id, token = _share_token(client, p)
    assert client.get("/api/v1/travel-plans/deleted").json() == []

    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 200
    deleted = client.get("/api/v1/travel-plans/deleted").json()
    assert [x["id"] for x in deleted] == [p]
    assert set(deleted[0]) == {"id", "title", "destination", "start_date", "end_date", "deleted_at", "purge_after"}
    assert deleted[0]["title"] == "復元する旅"

    # 他人(共同編集者を含む)は復元も完全削除もできない
    stranger, _ = make_user()
    _act_as(stranger)
    assert client.get("/api/v1/travel-plans/deleted").json() == []
    assert client.post(f"/api/v1/travel-plans/{p}/restore").status_code == 404
    assert client.delete(f"/api/v1/travel-plans/{p}/permanent").status_code == 404
    _act_as(owner)

    res = client.post(f"/api/v1/travel-plans/{p}/restore")
    assert res.status_code == 200, res.text
    assert res.json()["id"] == p
    detail = client.get(f"/api/v1/plans/{p}").json()
    assert [e["title"] for day in detail["days"] for e in day["events"]] == ["清水寺"]
    assert len(client.get(f"/api/v1/plans/{p}/reservations").json()) == 1
    assert client.get("/api/v1/travel-plans/deleted").json() == []
    # 共有リンクは失効したまま(再発行が必要)
    assert client.post(f"/api/v1/public/share/{token}/resolve", json={}).status_code == 404
    assert client.post(f"/api/v1/travel-plans/{p}/restore").status_code == 404  # 未削除は復元対象外
    assert [c["action"] for c in audit_calls] == ["plan.delete", "plan.restore"]


def test_restore_after_grace_period_is_gone(auth_client, db_session):
    client, _owner = auth_client
    p = _plan(client)
    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 200
    sql = text("UPDATE travel_plans SET purge_after = now() - interval '1 minute' WHERE id = :p")
    db_session.execute(sql, {"p": p})
    db_session.flush()
    assert client.post(f"/api/v1/travel-plans/{p}/restore").status_code == 410


def test_only_owner_can_delete(auth_client, make_user, db_session):
    client, owner = auth_client
    editor, _ = make_user()
    p = _plan(client)
    _invite(client, p, editor)
    _act_as(editor)
    assert client.post(f"/api/v1/travel-plans/invitations/{_member_id(db_session, p)}/accept").status_code == 200
    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 403
    _act_as(owner)


# ---------------------------------------------------------------- DB定義

def _fk_rows(db):
    return db.execute(text("""
        SELECT c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text, c.confdeltype, c.condeferrable
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
    """)).all()


def test_every_foreign_key_into_plan_owned_tables_has_a_deletion_policy(db_session):
    """プランから連鎖削除される表(CASCADEで到達できる表)を参照する外部キーは、
    CASCADE / SET NULL / DEFERRABLE のいずれかでなければならない(NO ACTIONのままだと
    完全削除が失敗する = B-012の再発)。新しい表を追加した時にもこの試験が検出する。"""
    rows = _fk_rows(db_session)
    owned = {"travel_plans"}
    changed = True
    while changed:
        changed = False
        for child, _col, parent, deltype, _deferrable in rows:
            if parent in owned and deltype == "c" and child not in owned:
                owned.add(child)
                changed = True
    assert {"travel_days", "travel_events", "reservations", "tickets", "documents", "import_jobs"} <= owned
    assert "share_access_logs" not in owned and "notifications" not in owned
    offenders = [
        f"{child}.{col} -> {parent}"
        for child, col, parent, deltype, deferrable in rows
        if parent in owned and deltype not in ("c", "n") and not deferrable
    ]
    assert offenders == []


def test_cross_references_are_still_checked_immediately_in_normal_operations(auth_client, db_session):
    client, _owner = auth_client
    p = _plan(client)
    e = _event(client, p, _day(client, p))
    _reservation(client, p, event_id=e["id"])
    nested = db_session.begin_nested()
    with pytest.raises(IntegrityError):
        db_session.execute(text("DELETE FROM travel_events WHERE id = :e"), {"e": e["id"]})
        db_session.flush()
    nested.rollback()


def test_deleted_columns_must_be_consistent(auth_client, db_session):
    client, _owner = auth_client
    p = _plan(client)
    nested = db_session.begin_nested()
    with pytest.raises(IntegrityError):
        db_session.execute(text("UPDATE travel_plans SET deleted_at = now() WHERE id = :p"), {"p": p})
        db_session.flush()
    nested.rollback()
