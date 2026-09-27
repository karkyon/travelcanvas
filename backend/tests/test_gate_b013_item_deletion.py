"""
[Gate B-013] 予定・日程・経路候補・共同編集者の個別削除(紐付け解除して削除)の受入試験(実PostgreSQL)。

B-013: 予約・経路候補・移動区間・参加者・チケット担当者に紐付いたデータを個別に削除すると、
外部キー違反で500になっていた。検証する性質:
- 14パターン(予定5・日程5・共同編集者3・採用済み経路候補1)がすべて500にならず成功する
- 予約・チケット・参加者・文書の本体は残り、関連だけが外れる。従属データ(経路候補・区間)は消える
- 予定・日程・経路候補の削除は1回のUndoで、元のIDのまま関連まで含めて戻る
- 確定ロックされた紐付けがある場合だけ、何も変更せずに構造化された409を返す
- Undo時に対象が削除・再紐付けされていたら、既存の状態を上書きせずに409(一部だけ戻さない)
- 権限(viewer・非所有者)と他プランへの非干渉
- 外部キーの扱いが漏れなく定義されている(将来テーブルを追加した時の検査を兼ねる)
"""
import io
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1 import share as share_module
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import (
    ChangeSet, DocumentLink, EventReservation, Reservation, ReservationParticipant, RouteLeg, RouteOption,
    Ticket, TravelDay, TravelEvent, TravelSegment,
)
from app.services import plan_item_deletion

H = lambda: {"Idempotency-Key": str(uuid.uuid4())}  # noqa: E731
PDF = b"%PDF-1.4\n%gate b013\n"


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "docs"))
    crypto_module.reset_cache_for_tests()
    for mod in ("app.api.v1.documents", "app.api.v1.reservations"):
        m = __import__(mod, fromlist=["x"])
        if hasattr(m, "record_audit_event"):
            monkeypatch.setattr(m, "record_audit_event", lambda **kw: None)
    yield
    crypto_module.reset_cache_for_tests()


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(share_module, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


# ---------------------------------------------------------------- 操作ヘルパー

def _plan(c, title="B013"):
    res = c.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _rev(c, p):
    res = c.get(f"/api/v1/plans/{p}")
    assert res.status_code == 200, res.text
    return str(res.json()["revision"])


def _day(c, p, d="2026-11-02"):
    res = c.post(f"/api/v1/plans/{p}/days", json={"local_date": d, "timezone_id": "Asia/Tokyo"}, headers=H())
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


def _link_event(c, p, r, e):
    res = c.post(f"/api/v1/plans/{p}/reservations/{r['id']}/events", json={"event_id": e["id"]})
    assert res.status_code == 201, res.text
    return res.json()


def _route_option(c, p, a, b):
    res = c.post(f"/api/v1/plans/{p}/route-options",
                 json={"from_event_id": a["id"], "to_event_id": b["id"],
                       "legs": [{"mode": "walking", "sequence": 0}, {"mode": "train", "sequence": 1}]},
                 headers=H())
    assert res.status_code == 201, res.text
    return res.json()


def _segment(c, p, a, b):
    res = c.post(f"/api/v1/plans/{p}/segments", json={"from_event_id": a["id"], "to_event_id": b["id"],
                                                      "mode": "walking"}, headers=H())
    assert res.status_code == 201, res.text
    return res.json()


def _upload(c, p):
    res = c.post(f"/api/v1/plans/{p}/documents/upload",
                 files={"file": ("a.pdf", io.BytesIO(PDF), "application/pdf")},
                 data={"classification": "confidential", "document_type": "receipt"})
    assert res.status_code == 201, res.text
    return res.json()


def _doc_link(c, p, doc, e):
    res = c.post(f"/api/v1/plans/{p}/documents/{doc['id']}/links", json={"entity_type": "event", "entity_id": e["id"]})
    assert res.status_code == 201, res.text
    return res.json()


def _invite(c, p, user, role="editor"):
    res = c.post(f"/api/v1/travel-plans/{p}/collaborators", json={"email": user.email, "role": role})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _accept(c, collab_id, user, owner):
    _act_as(user)
    assert c.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept").status_code == 200
    _act_as(owner)


def _delete_event(c, p, e):
    return c.delete(f"/api/v1/plans/{p}/events/{e['id']}", headers={"If-Match": _rev(c, p)})


def _delete_day(c, p, d):
    return c.delete(f"/api/v1/plans/{p}/days/{d['id']}", headers={"If-Match": _rev(c, p)})


def _undo(c, p):
    return c.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": _rev(c, p)})


def _uid(v):
    return uuid.UUID(str(v))


def _event_exists(db, e):
    db.expire_all()
    return db.query(TravelEvent).filter(TravelEvent.id == _uid(e["id"])).count() == 1


# ---------------------------------------------------------------- 予定・日程の削除(5種の紐付け × 予定/日程)

def _setup_primary_reservation(c, p, db):
    d = _day(c, p)
    e = _event(c, p, d)
    r = _reservation(c, p, event_id=e["id"])
    return d, e, {"reservation": r}


def _setup_primary_reservation_soft_deleted(c, p, db):
    d, e, ctx = _setup_primary_reservation(c, p, db)
    r = ctx["reservation"]
    res = c.delete(f"/api/v1/plans/{p}/reservations/{r['id']}", headers={"If-Match": str(r["revision"])})
    assert res.status_code == 204, res.text
    return d, e, ctx


def _setup_secondary_link(c, p, db):
    d = _day(c, p)
    e = _event(c, p, d)
    r = _reservation(c, p)
    link = _link_event(c, p, r, e)
    return d, e, {"reservation": r, "link": link}


def _setup_route_option(c, p, db):
    d = _day(c, p)
    a, b = _event(c, p, d, "A"), _event(c, p, d, "B")
    return d, a, {"route_option": _route_option(c, p, a, b), "other_event": b}


def _setup_segment(c, p, db):
    d = _day(c, p)
    a, b = _event(c, p, d, "A"), _event(c, p, d, "B")
    return d, a, {"segment": _segment(c, p, a, b), "other_event": b}


SETUPS = {
    "primary_reservation": _setup_primary_reservation,
    "primary_reservation_soft_deleted": _setup_primary_reservation_soft_deleted,
    "secondary_event_link": _setup_secondary_link,
    "route_option_endpoint": _setup_route_option,
    "segment_endpoint": _setup_segment,
}


def _assert_detached(db, name, ctx):
    db.expire_all()
    if "reservation" in ctx:
        r = db.query(Reservation).filter(Reservation.id == _uid(ctx["reservation"]["id"])).one()
        assert r.event_id is None  # 予約本体は残り、紐付けだけ外れる
        assert db.query(EventReservation).filter(EventReservation.reservation_id == r.id).count() == 0
    if "route_option" in ctx:
        oid = _uid(ctx["route_option"]["id"])
        assert db.query(RouteOption).filter(RouteOption.id == oid).count() == 0
        assert db.query(RouteLeg).filter(RouteLeg.route_option_id == oid).count() == 0
    if "segment" in ctx:
        assert db.query(TravelSegment).filter(TravelSegment.id == _uid(ctx["segment"]["id"])).count() == 0


def _assert_restored(db, name, e, ctx):
    db.expire_all()
    assert _event_exists(db, e)
    if name in ("primary_reservation", "primary_reservation_soft_deleted"):
        r = db.query(Reservation).filter(Reservation.id == _uid(ctx["reservation"]["id"])).one()
        assert str(r.event_id) == e["id"]
    if "link" in ctx:
        link = db.query(EventReservation).filter(EventReservation.id == _uid(ctx["link"]["id"])).one()
        assert str(link.event_id) == e["id"]
    if "route_option" in ctx:
        oid = _uid(ctx["route_option"]["id"])
        assert db.query(RouteOption).filter(RouteOption.id == oid).count() == 1
        assert db.query(RouteLeg).filter(RouteLeg.route_option_id == oid).count() == 2
    if "segment" in ctx:
        seg = db.query(TravelSegment).filter(TravelSegment.id == _uid(ctx["segment"]["id"])).one()
        assert str(seg.from_event_id) == e["id"]


EXPECTED_IMPACT = {
    "primary_reservation": {"reservations_unlinked": 1},
    "primary_reservation_soft_deleted": {"reservations_unlinked": 1},
    "secondary_event_link": {"reservations_unlinked": 1},
    "route_option_endpoint": {"route_options_removed": 1},
    "segment_endpoint": {"segments_removed": 1},
}


@pytest.mark.parametrize("name", list(SETUPS))
def test_event_with_related_data_can_be_deleted_and_undone(name, auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    d, e, ctx = SETUPS[name](c, p, db_session)

    res = _delete_event(c, p, e)
    assert res.status_code == 200, res.text
    impact = res.json()["detached"]
    for key, value in EXPECTED_IMPACT[name].items():
        assert impact[key] == value, impact
    assert not _event_exists(db_session, e)
    _assert_detached(db_session, name, ctx)

    res = _undo(c, p)
    assert res.status_code == 200, res.text
    _assert_restored(db_session, name, e, ctx)


@pytest.mark.parametrize("name", list(SETUPS))
def test_day_with_related_data_can_be_deleted_and_undone(name, auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    _day(c, p, "2026-11-01")  # 最後の1日ではない状態にしておく
    d, e, ctx = SETUPS[name](c, p, db_session)

    res = _delete_day(c, p, d)
    assert res.status_code == 200, res.text
    for key, value in EXPECTED_IMPACT[name].items():
        assert res.json()["detached"][key] == value
    assert not _event_exists(db_session, e)
    _assert_detached(db_session, name, ctx)

    res = _undo(c, p)
    assert res.status_code == 200, res.text
    _assert_restored(db_session, name, e, ctx)
    if "other_event" in ctx:  # 日程内の他の予定も元のIDで戻る
        assert _event_exists(db_session, ctx["other_event"])


def test_day_undo_keeps_event_ids_times_and_place(auth_client, db_session):
    """日程のUndoは予定を新しいIDで作り直していたため、予約・制約・文書の参照先が失われていた。"""
    c, _owner = auth_client
    p = _plan(c)
    _day(c, p, "2026-11-01")
    d = _day(c, p)
    e = _event(c, p, d)
    db_session.execute(text("UPDATE travel_events SET start_at = '2026-11-02T01:00:00+00', "
                            "end_at = '2026-11-02T02:00:00+00' WHERE id = :e"), {"e": e["id"]})
    constraint = c.post(f"/api/v1/plans/{p}/constraints", json={
        "scope_type": "event", "scope_id": e["id"], "constraint_type": "preference", "hardness": "soft",
        "operator": "prefer", "weight": 30, "title": "静かな席", "value": {"value": "静か"}})
    assert constraint.status_code == 201, constraint.text
    assert _delete_day(c, p, d).status_code == 200
    assert _undo(c, p).status_code == 200
    db_session.expire_all()
    ev = db_session.query(TravelEvent).filter(TravelEvent.id == _uid(e["id"])).one()
    assert ev.start_at is not None and ev.end_at is not None and ev.day_id == _uid(d["id"])
    # 制約の適用対象(予定ID)が有効なまま戻り、検証でも「適用対象が削除されています」にならない
    body = c.get(f"/api/v1/plans/{p}/constraints/{constraint.json()['id']}").json()
    assert body["scope_id"] == e["id"]
    run = c.post(f"/api/v1/plans/{p}/validation-runs")
    assert run.status_code in (200, 201), run.text
    detail = c.get(f"/api/v1/plans/{p}/validation-runs/{run.json()['id']}").json()
    assert "CONSTRAINT_SCOPE_MISSING" not in {i["code"] for i in detail["issues"]}


def test_legacy_day_change_without_event_ids_is_still_undoable(auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    _day(c, p, "2026-11-01")
    d = _day(c, p)
    _event(c, p, d, "旧形式")
    assert _delete_day(c, p, d).status_code == 200
    item = db_session.execute(text(
        "SELECT ci.id, ci.before_json FROM change_items ci JOIN change_sets cs ON cs.id = ci.change_set_id "
        "WHERE cs.plan_id = :p AND ci.entity_type = 'travel_day' AND ci.action = 'delete'"), {"p": p}).one()
    legacy = dict(item.before_json)
    legacy["_events"] = [{k: v for k, v in ev.items() if k != "id"} for ev in legacy["_events"]]
    db_session.execute(text("UPDATE change_items SET before_json = CAST(:j AS json) WHERE id = :i"),
                       {"j": __import__("json").dumps(legacy), "i": item.id})
    assert _undo(c, p).status_code == 200
    titles = [e["title"] for day in c.get(f"/api/v1/plans/{p}").json()["days"] for e in day["events"]]
    assert "旧形式" in titles


def test_document_link_and_event_note_are_detached_and_restored(auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    d = _day(c, p)
    e = _event(c, p, d)
    doc = _upload(c, p)
    dl = _doc_link(c, p, doc, e)
    note_id = uuid.uuid4()
    db_session.execute(text("INSERT INTO event_links (id, event_id, link_type, label) VALUES (:i, :e, 'note', 'メモ')"),
                       {"i": note_id, "e": e["id"]})

    res = _delete_event(c, p, e)
    assert res.status_code == 200, res.text
    assert res.json()["detached"]["document_links_removed"] == 1
    db_session.expire_all()
    assert db_session.query(DocumentLink).filter(DocumentLink.id == _uid(dl["id"])).count() == 0
    assert c.get(f"/api/v1/plans/{p}/documents/{doc['id']}").status_code == 200  # 文書本体は残る

    assert _undo(c, p).status_code == 200
    db_session.expire_all()
    assert db_session.query(DocumentLink).filter(DocumentLink.id == _uid(dl["id"])).count() == 1
    assert db_session.execute(text("SELECT count(*) FROM event_links WHERE id = :i"), {"i": note_id}).scalar() == 1


def test_adopted_route_option_can_be_deleted_keeping_segment_and_undone(auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    d = _day(c, p)
    a, b = _event(c, p, d, "A"), _event(c, p, d, "B")
    option = _route_option(c, p, a, b)
    res = c.post(f"/api/v1/plans/{p}/route-options/{option['id']}/adopt", headers={"If-Match": _rev(c, p), **H()})
    assert res.status_code == 200, res.text
    seg_id = _uid(res.json()["segment_id"])

    res = c.delete(f"/api/v1/plans/{p}/route-options/{option['id']}", headers={"If-Match": _rev(c, p)})
    assert res.status_code == 200, res.text
    assert res.json()["detached"] == {"segments_unlinked": 1}
    db_session.expire_all()
    seg = db_session.query(TravelSegment).filter(TravelSegment.id == seg_id).one()  # 採用した区間は残る
    assert seg.route_option_id is None

    assert _undo(c, p).status_code == 200
    db_session.expire_all()
    seg = db_session.query(TravelSegment).filter(TravelSegment.id == seg_id).one()
    assert seg.route_option_id == _uid(option["id"])
    assert db_session.query(RouteLeg).filter(RouteLeg.route_option_id == _uid(option["id"])).count() == 2


def test_event_with_adopted_route_is_deleted_and_undone_in_fk_safe_order(auth_client, db_session):
    """採用済み経路候補とその区間が同じ予定を端点に持つ場合、Undoは経路候補を先に戻す。"""
    c, _owner = auth_client
    p = _plan(c)
    d = _day(c, p)
    a, b = _event(c, p, d, "A"), _event(c, p, d, "B")
    option = _route_option(c, p, a, b)
    seg_id = c.post(f"/api/v1/plans/{p}/route-options/{option['id']}/adopt",
                    headers={"If-Match": _rev(c, p), **H()}).json()["segment_id"]
    res = _delete_event(c, p, a)
    assert res.status_code == 200, res.text
    assert res.json()["detached"]["route_options_removed"] == 1
    assert res.json()["detached"]["segments_removed"] == 1
    assert _undo(c, p).status_code == 200
    db_session.expire_all()
    restored = db_session.query(TravelSegment).filter(TravelSegment.id == _uid(seg_id)).one()
    assert restored.route_option_id == _uid(option["id"])


# ---------------------------------------------------------------- 確定ロック(409)

@pytest.mark.parametrize("target", ["event", "day"])
def test_locked_reservation_link_blocks_deletion_without_any_change(target, auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    _day(c, p, "2026-11-01")
    d = _day(c, p)
    e = _event(c, p, d)
    other = _event(c, p, d, "別の予定")
    seg = _segment(c, p, e, other)
    r = _reservation(c, p, event_id=e["id"])
    link = db_session.query(EventReservation).filter(EventReservation.reservation_id == _uid(r["id"])).one()
    res = c.patch(f"/api/v1/plans/{p}/reservations/{r['id']}/events/{link.id}", json={"is_locked": True})
    assert res.status_code == 200, res.text
    revision = _rev(c, p)

    res = _delete_event(c, p, e) if target == "event" else _delete_day(c, p, d)
    assert res.status_code == 409, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "locked_relation"
    assert detail["blocking"] == [{"type": "event_reservation", "id": str(link.id), "event_id": e["id"],
                                   "reservation_id": r["id"], "reason": "locked"}]
    # 何も変更されていない
    assert _rev(c, p) == revision
    assert _event_exists(db_session, e)
    db_session.expire_all()
    assert db_session.query(TravelSegment).filter(TravelSegment.id == _uid(seg["id"])).count() == 1
    assert str(db_session.query(Reservation).filter(Reservation.id == _uid(r["id"])).one().event_id) == e["id"]


# ---------------------------------------------------------------- Undoの競合(上書きしない・一部だけ戻さない)

def _assert_undo_refused(c, p, db, e, reason):
    revision = _rev(c, p)
    res = _undo(c, p)
    assert res.status_code == 409, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "undo_conflict"
    assert reason in {x["reason"] for x in detail["conflicts"]}
    assert _rev(c, p) == revision
    assert not _event_exists(db, e)  # 予定も戻っていない(一部だけ戻さない)
    db.expire_all()
    assert db.query(ChangeSet).filter(ChangeSet.plan_id == _uid(p), ChangeSet.undone_at.is_(None)).count() >= 1


def test_undo_refuses_when_reservation_was_relinked(auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    d = _day(c, p)
    e, other = _event(c, p, d), _event(c, p, d, "別")
    r = _reservation(c, p, event_id=e["id"])
    assert _delete_event(c, p, e).status_code == 200
    rev = db_session.query(Reservation).filter(Reservation.id == _uid(r["id"])).one().revision
    res = c.patch(f"/api/v1/plans/{p}/reservations/{r['id']}", json={"event_id": other["id"]},
                  headers={"If-Match": str(rev)})
    assert res.status_code == 200, res.text

    _assert_undo_refused(c, p, db_session, e, "relinked")
    db_session.expire_all()  # 利用者が付け直した紐付けは上書きされない
    assert str(db_session.query(Reservation).filter(Reservation.id == _uid(r["id"])).one().event_id) == other["id"]


def test_undo_refuses_when_reservation_was_deleted_afterwards(auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    d = _day(c, p)
    e = _event(c, p, d)
    r = _reservation(c, p)
    _link_event(c, p, r, e)
    assert _delete_event(c, p, e).status_code == 200
    rev = db_session.query(Reservation).filter(Reservation.id == _uid(r["id"])).one().revision
    assert c.delete(f"/api/v1/plans/{p}/reservations/{r['id']}", headers={"If-Match": str(rev)}).status_code == 204
    _assert_undo_refused(c, p, db_session, e, "deleted")
    # 主紐付けと中間表の紐付けで同じ予約が重複して報告されない
    conflicts = _undo(c, p).json()["detail"]["conflicts"]
    assert conflicts == [{"type": "reservation", "id": r["id"], "reason": "deleted"}]


def test_undo_refuses_when_document_was_deleted_afterwards(auth_client, db_session):
    c, _owner = auth_client
    p = _plan(c)
    d = _day(c, p)
    e = _event(c, p, d)
    doc = _upload(c, p)
    _doc_link(c, p, doc, e)
    assert _delete_event(c, p, e).status_code == 200
    db_session.execute(text("UPDATE documents SET deleted_at = now() WHERE id = :d"), {"d": doc["id"]})
    _assert_undo_refused(c, p, db_session, e, "deleted")


def test_undo_refuses_when_same_date_day_was_recreated(auth_client, db_session):
    """以前は一意制約違反で500になっていた。"""
    c, _owner = auth_client
    p = _plan(c)
    _day(c, p, "2026-11-01")
    d = _day(c, p, "2026-11-05")
    e = _event(c, p, d)
    assert _delete_day(c, p, d).status_code == 200
    # Undoは直近の変更を戻すため、日程の再作成を戻さずに競合を作る
    db_session.execute(text("INSERT INTO travel_days (id, plan_id, local_date, timezone_id, sort_order) "
                            "VALUES (:i, :p, '2026-11-05', 'UTC', 9)"), {"i": uuid.uuid4(), "p": p})
    _assert_undo_refused(c, p, db_session, e, "date_taken")


def test_unexpected_failure_during_undo_rolls_back_everything(auth_client, db_session, monkeypatch):
    c, _owner = auth_client
    p = _plan(c)
    d = _day(c, p)
    e = _event(c, p, d)
    _reservation(c, p, event_id=e["id"])
    assert _delete_event(c, p, e).status_code == 200

    def _boom(db, plan, item):
        raise IntegrityError("restore", {}, Exception("simulated"))

    monkeypatch.setattr(plan_item_deletion, "restore_relation_item", _boom)
    _assert_undo_refused(c, p, db_session, e, "restore_failed")
    monkeypatch.undo()
    assert _undo(c, p).status_code == 200  # 原因が無くなれば同じ変更をUndoできる
    assert _event_exists(db_session, e)


# ---------------------------------------------------------------- 共同編集者の削除(アクセス取消し)

@pytest.mark.parametrize("kind", ["ticket_holder", "participant", "participant_soft_deleted", "both_accepted"])
def test_collaborator_removal_always_succeeds_and_only_detaches(kind, auth_client, make_user, db_session, audit_calls):
    c, owner = auth_client
    member, _ = make_user()
    p = _plan(c)
    collab_id = _invite(c, p, member)
    if kind == "both_accepted":
        _accept(c, collab_id, member, owner)
    r = _reservation(c, p)
    ticket_id = participant_id = None
    if kind in ("ticket_holder", "both_accepted"):
        res = c.post(f"/api/v1/plans/{p}/reservations/{r['id']}/tickets",
                     json={"ticket_type": "entry", "payload": "QR", "holder_member_id": collab_id})
        assert res.status_code == 201, res.text
        ticket_id = res.json()["id"]
    if kind != "ticket_holder":
        res = c.post(f"/api/v1/plans/{p}/reservations/{r['id']}/participants",
                     json={"name": "同行者", "plan_member_id": collab_id})
        assert res.status_code == 201, res.text
        participant_id = res.json()["id"]
        if kind == "participant_soft_deleted":
            assert c.delete(f"/api/v1/plans/{p}/reservations/{r['id']}/participants/{participant_id}",
                            headers={"If-Match": str(res.json()["revision"])}).status_code == 204

    res = c.delete(f"/api/v1/travel-plans/{p}/collaborators/{collab_id}")
    assert res.status_code == 200, res.text
    detached = res.json()["detached"]
    assert detached == {"ticket_holders": 1 if ticket_id else 0, "participants": 1 if participant_id else 0}

    db_session.expire_all()
    if ticket_id:
        t = db_session.query(Ticket).filter(Ticket.id == _uid(ticket_id)).one()  # チケット本体は残る
        assert t.holder_member_id is None and t.deleted_at is None
    if participant_id:
        pt = db_session.query(ReservationParticipant).filter(ReservationParticipant.id == _uid(participant_id)).one()
        assert pt.plan_member_id is None
    assert db_session.query(Reservation).filter(Reservation.id == _uid(r["id"])).count() == 1
    # アクセスは取り消される
    _act_as(member)
    assert c.get(f"/api/v1/plans/{p}").status_code in (403, 404)
    _act_as(owner)
    # 監査に件数は残すが、メールアドレス等は残さない
    assert audit_calls[-1]["action"] == "collaborator_removed"
    assert member.email not in str(audit_calls[-1])


# ---------------------------------------------------------------- 権限・他プランへの非干渉

def test_viewer_cannot_delete_and_editor_cannot_remove_collaborators(auth_client, make_user, db_session):
    c, owner = auth_client
    viewer, _ = make_user()
    editor, _ = make_user()
    p = _plan(c)
    d = _day(c, p)
    e = _event(c, p, d)
    _reservation(c, p, event_id=e["id"])
    v_id = _invite(c, p, viewer, role="viewer")
    ed_id = _invite(c, p, editor, role="editor")
    _accept(c, v_id, viewer, owner)
    _accept(c, ed_id, editor, owner)

    _act_as(viewer)
    assert _delete_event(c, p, e).status_code == 403
    assert c.delete(f"/api/v1/plans/{p}/days/{d['id']}", headers={"If-Match": "1"}).status_code == 403
    _act_as(editor)
    assert c.delete(f"/api/v1/travel-plans/{p}/collaborators/{v_id}").status_code == 403
    assert _delete_event(c, p, e).status_code == 200  # editorは予定を削除できる
    _act_as(owner)


def test_other_plans_are_not_affected(auth_client, make_user, db_session):
    c, owner = auth_client
    p = _plan(c, "A")
    q = _plan(c, "B")
    e_p = _event(c, p, _day(c, p))
    d_q = _day(c, q)
    e_q = _event(c, q, d_q)
    r_q = _reservation(c, q, event_id=e_q["id"])
    _reservation(c, p, event_id=e_p["id"])

    # 他プランの予定・日程を、別プランのURLから消すことはできない
    assert c.delete(f"/api/v1/plans/{p}/events/{e_q['id']}", headers={"If-Match": _rev(c, p)}).status_code == 404
    assert c.delete(f"/api/v1/plans/{p}/days/{d_q['id']}", headers={"If-Match": _rev(c, p)}).status_code == 404
    # 所有者でも共同編集者でもない利用者からは見えない
    stranger, _ = make_user()
    _act_as(stranger)
    assert c.delete(f"/api/v1/plans/{q}/events/{e_q['id']}", headers={"If-Match": "1"}).status_code in (403, 404)
    _act_as(owner)

    assert _delete_event(c, p, e_p).status_code == 200
    db_session.expire_all()
    assert str(db_session.query(Reservation).filter(Reservation.id == _uid(r_q["id"])).one().event_id) == e_q["id"]
    assert _event_exists(db_session, e_q)
    assert db_session.query(TravelDay).filter(TravelDay.id == _uid(d_q["id"])).count() == 1


# ---------------------------------------------------------------- 外部キーの扱いの網羅性

def _fk_refs(db, table):
    rows = db.execute(text(
        """
        SELECT c.conrelid::regclass::text, a.attname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = CAST(:t AS regclass)
        """
    ), {"t": table}).all()
    return {(r[0], r[1]) for r in rows}


@pytest.mark.parametrize("table, policy", [
    ("travel_events", plan_item_deletion.EVENT_REFERENCE_POLICY),
    ("travel_days", plan_item_deletion.DAY_REFERENCE_POLICY),
    ("route_options", plan_item_deletion.ROUTE_OPTION_REFERENCE_POLICY),
    ("plan_collaborators", plan_item_deletion.COLLABORATOR_REFERENCE_POLICY),
])
def test_every_foreign_key_into_individually_deletable_tables_has_a_policy(table, policy, db_session):
    """テーブルを追加して予定・日程・経路候補・共同編集者を参照したら、削除時の扱いを
    plan_item_deletion に追加しないとこの試験が失敗する(B-013の再発防止)。"""
    assert _fk_refs(db_session, table) == set(policy), (
        f"{table} を参照する外部キーと、個別削除の扱い(plan_item_deletion)が一致しません")
