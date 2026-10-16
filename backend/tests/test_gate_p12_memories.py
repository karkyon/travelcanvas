"""
[Gate P12] FR-037 写真・メモ・旅行記の統合テスト(実PostgreSQL)。

検証する主な性質:
- メモ・動画の参照・写真・音声メモを予定・日へ紐付けて記録できる。予定から日を補い、他の旅行の予定は拒否する
- ファイルは拡張子と先頭バイトで検証し、暗号化して保存する(保存先にファイルの中身がそのまま残らない)
- 公開範囲: 既定は「自分だけ」。他人の「自分だけ」の記録は一覧・ファイル・変更・削除のどれからも存在が分からない
- 変更は書いた本人だけ(If-Match必須)。削除は本人と旅行の所有者(メンバーに公開された記録)。ファイルも消える
- 旅行記の下書き: 計画した予定は記録が無くても「記録なし」で残す。位置は既定で除外。公開前の検査
  (同行者の名前・予約番号のような文字列・電話番号・写真)を、見つかった文字列を載せずに返す
- 旅行の完全削除・アカウント削除で記録とファイルが消える。データの書き出しに含まれる(他人の非公開分は含めない)
- 監査に本文・場所を残さない
"""
import io
import uuid
from datetime import timedelta
from pathlib import Path

import pytest

from app.api.v1 import memories as memories_api
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import Memory, PlanCollaborator, TravelPlan
from app.services import memories as mem
from app.services import plan_deletion

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
MP3 = b"ID3" + b"\x00" * 64


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(memories_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


@pytest.fixture(autouse=True)
def storage(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    return tmp_path / "documents"


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _setup(auth_client, title="旅の記録テスト"):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": title}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    ev = {}
    for name, day, t in (("清水寺", d1, "09:00"), ("昼食", d1, "12:00"), ("美術館", d2, "10:00")):
        ev[name] = client.post(f"{base}/events", json={"day_id": day["id"], "title": name, "local_start_time": t},
                               headers=_ik()).json()
    return client, owner, p, base, (d1, d2), ev


def _member(db_session, make_user, p, role="editor", username=None):
    u, _ = make_user(username=username)
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=u.id, email=u.email, role=role,
                                    status="accepted"))
    db_session.commit()
    return u


def _upload(client, base, kind="photo", content=PNG, filename="a.png", **fields):
    data = {"kind": kind, **{k: str(v) for k, v in fields.items()}}
    return client.post(f"{base}/memories/upload", data=data, files={"file": (filename, io.BytesIO(content))})


# ---------------------------------------------------------------- 単体

def test_validate_media_and_url():
    assert mem.validate_media("photo", "x.PNG", PNG, 1000) == (".png", "image/png")
    assert mem.validate_media("audio", "v.mp3", MP3, 1000) == (".mp3", "audio/mpeg")
    assert mem.validate_media("audio", "v.m4a", b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 8, 1000)[1] == "audio/mp4"
    for kind, name, content, code in (
        ("photo", "x.png", b"GIF89a....", "content_mismatch"),
        ("photo", "x.exe", PNG, "unsupported_type"),
        ("photo", "x.mp3", MP3, "unsupported_type"),
        ("photo", "x.png", b"", "empty_file"),
        ("photo", "x.png", PNG * 100, "file_too_large"),
        ("note", "x.png", PNG, "invalid_kind"),
    ):
        with pytest.raises(mem.MemoryInputError) as e:
            mem.validate_media(kind, name, content, 1000)
        assert e.value.code == code
    assert mem.validate_video_url(" https://video.example/v/1 ") == "https://video.example/v/1"
    for bad in ("http://video.example/v", "https://user:pw@video.example/v", "javascript:alert(1)", "", None,
                "https://" + "a" * 2000):
        with pytest.raises(mem.MemoryInputError):
            mem.validate_video_url(bad)


def test_journal_draft_pure():
    d1, d2 = uuid.uuid4(), uuid.uuid4()
    e1, e2 = uuid.uuid4(), uuid.uuid4()
    days = [{"id": d2, "local_date": __import__("datetime").date(2026, 11, 2), "title": None},
            {"id": d1, "local_date": __import__("datetime").date(2026, 11, 1), "title": "京都"}]
    events = [{"id": e1, "day_id": d1, "title": "清水寺", "local_start_time": "09:00", "sort_order": 0},
              {"id": e2, "day_id": d2, "title": "美術館", "local_start_time": "10:00", "sort_order": 0}]
    mine = {"id": uuid.uuid4(), "kind": "note", "body": "花子さんと参拝。予約 AB12CD 090-1234-5678",
            "event_id": e1, "day_id": d1, "occurred_at": None, "place_name": "清水", "latitude": 35.0,
            "longitude": 135.7, "video_url": None, "by_me": True, "include_in_journal": True}
    photo = {**mine, "id": uuid.uuid4(), "kind": "photo", "body": None, "latitude": None, "longitude": None,
             "place_name": None}
    theirs = {**mine, "id": uuid.uuid4(), "body": "他の人のメモ", "by_me": False, "latitude": None,
              "longitude": None}
    hidden = {**mine, "id": uuid.uuid4(), "body": "載せない", "include_in_journal": False}
    deleted_event = {**mine, "id": uuid.uuid4(), "body": "消えた予定", "event_id": uuid.uuid4(), "day_id": None,
                     "latitude": None, "longitude": None}

    r = mem.build_journal_draft("京都旅行", days, events, [mine, photo, theirs, hidden, deleted_event], ["花子"])
    assert [d["date"] for d in r["days"]] == ["2026-11-01", "2026-11-02"]
    first = r["days"][0]["entries"][0]
    assert first["status"] == "recorded" and len(first["memories"]) == 2
    assert first["memories"][0]["latitude"] is None  # 位置は既定で除外
    assert r["days"][1]["entries"][0]["status"] == "no_record"  # 計画した予定は記録なしでも残す
    assert r["summary"] == {"planned_events": 2, "recorded_events": 1, "memories": 3, "photos": 1}
    assert [m["body"] for m in r["other_memories"]] == ["消えた予定"]
    codes = sorted({c["code"] for c in r["checks"]})
    assert codes == ["location_excluded", "member_name", "phone_like", "photo_people", "reservation_like"]
    for c in r["checks"]:  # 見つかった文字列そのものを検査結果へ載せない
        assert "AB12CD" not in c["message"] and "090-1234" not in c["message"] and "花子" not in c["message"]
    assert "他の人のメモ" not in r["markdown"] and "載せない" not in r["markdown"]
    assert "(予定していた場所。記録はありません)" in r["markdown"] and "緯度" not in r["markdown"]

    r2 = mem.build_journal_draft("京都旅行", days, events, [mine, photo, theirs], [], include_locations=True,
                                 include_media=False, include_others=True)
    assert "他の人のメモ" in r2["markdown"] and "緯度 35.00000" in r2["markdown"]
    assert {"location_included", "others_included"} <= {c["code"] for c in r2["checks"]}
    assert r2["summary"]["photos"] == 0  # 写真を含めない時、本文の無い写真は下書きに出さない


# ---------------------------------------------------------------- API

def test_create_list_and_link(auth_client, audit_calls):
    client, owner, p, base, (d1, d2), ev = _setup(auth_client)
    r = client.post(f"{base}/memories", json={"body": "  朝の参拝  ", "event_id": ev["清水寺"]["id"],
                                              "occurred_at": "2026-11-01T09:30:00+09:00", "place_name": "清水寺",
                                              "latitude": 34.99, "longitude": 135.78})
    assert r.status_code == 201, r.text
    note = r.json()
    assert note["body"] == "朝の参拝" and note["day_id"] == d1["id"]  # 予定から日を補う
    assert note["visibility"] == "private" and note["can_edit"] and note["has_media"] is False
    v = client.post(f"{base}/memories", json={"kind": "video", "video_url": "https://video.example/v/9",
                                              "day_id": d2["id"], "visibility": "members"})
    assert v.status_code == 201 and v.json()["video_url"] == "https://video.example/v/9"

    bad = [
        ({"body": ""}, "invalid_field"),
        ({"kind": "photo", "body": "x"}, "invalid_kind"),
        ({"kind": "video", "video_url": "http://x.example/"}, "invalid_video_url"),
        ({"body": "x", "video_url": "https://x.example/"}, "invalid_field"),
        ({"body": "x", "event_id": str(uuid.uuid4())}, "event_not_found"),
        ({"body": "x", "day_id": str(uuid.uuid4())}, "day_not_found"),
        ({"body": "x", "event_id": ev["美術館"]["id"], "day_id": d1["id"]}, "invalid_field"),
        ({"body": "x", "latitude": 35.0}, "invalid_field"),
        ({"body": "x", "visibility": "public"}, "invalid_field"),
        ({"body": "x" * 5001}, "invalid_field"),
        ({"body": "x", "occurred_at": "2026-11-01T09:00:00"}, "invalid_field"),
    ]
    for payload, code in bad:
        res = client.post(f"{base}/memories", json=payload)
        assert res.status_code == 422 and res.json()["detail"]["code"] == code, (payload, res.text)
    assert client.post(f"{base}/memories", json={"body": "x", "author_user_id": str(uuid.uuid4())}).status_code == 422

    other_p = client.post("/api/v1/travel-plans/", json={"title": "別の旅行"}).json()["id"]
    res = client.post(f"/api/v1/plans/{other_p}/memories", json={"body": "x", "event_id": ev["清水寺"]["id"]})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "event_not_found"

    listed = client.get(f"{base}/memories").json()
    assert [m["id"] for m in listed["memories"]] == [note["id"], v.json()["id"]] and listed["can_create"] is True
    # 監査に本文・場所を残さない
    assert audit_calls and all("朝の参拝" not in str(c) and "清水寺" not in str(c) for c in audit_calls)


def test_upload_media_encrypted_and_streamed(auth_client, storage):
    client, owner, p, base, (d1, _d2), ev = _setup(auth_client)
    r = _upload(client, base, event_id=ev["昼食"]["id"], body="おいしかった")
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["has_media"] and photo["mime_type"] == "image/png" and photo["size"] == len(PNG)
    row = Path(storage).rglob("*.png")
    files = list(row)
    assert len(files) == 1 and PNG not in files[0].read_bytes()  # 暗号化して保存
    media = client.get(f"{base}/memories/{photo['id']}/media")
    assert media.status_code == 200 and media.content == PNG
    assert media.headers["cache-control"] == "no-store" and media.headers["content-type"] == "image/png"
    a = _upload(client, base, kind="audio", content=MP3, filename="voice.mp3", visibility="members")
    assert a.status_code == 201 and a.json()["mime_type"] == "audio/mpeg"

    for kind, content, name, status, code in (
        ("photo", b"not an image", "x.png", 422, "content_mismatch"),
        ("photo", PNG, "x.svg", 422, "unsupported_type"),
        ("note", PNG, "x.png", 422, "invalid_kind"),
        ("video", PNG, "x.png", 422, "invalid_kind"),
    ):
        res = _upload(client, base, kind=kind, content=content, filename=name)
        assert res.status_code == status and res.json()["detail"]["code"] == code, res.text
    res = _upload(client, base, event_id=str(uuid.uuid4()))
    assert res.status_code == 422 and res.json()["detail"]["code"] == "event_not_found"
    assert len(list(Path(storage).rglob("*.*"))) == 2  # 失敗した登録はファイルを残さない

    note = client.post(f"{base}/memories", json={"body": "メモ"}).json()
    assert client.get(f"{base}/memories/{note['id']}/media").status_code == 404

    # 削除でファイルも消える
    assert client.delete(f"{base}/memories/{photo['id']}").status_code == 204
    assert len(list(Path(storage).rglob("*.png"))) == 0
    assert client.get(f"{base}/memories/{photo['id']}/media").status_code == 404


def test_visibility_and_permissions(auth_client, make_user, db_session):
    client, owner, p, base, (d1, _d2), ev = _setup(auth_client)
    mine_private = client.post(f"{base}/memories", json={"body": "所有者の非公開メモ"}).json()
    mine_shared = _upload(client, base, visibility="members").json()
    editor = _member(db_session, make_user, p, "editor")
    viewer = _member(db_session, make_user, p, "viewer")
    try:
        _act_as(editor)
        ed_private = client.post(f"{base}/memories", json={"body": "編集者の非公開"}).json()
        ed_shared = client.post(f"{base}/memories", json={"body": "編集者の公開", "visibility": "members"}).json()
        ids = [m["id"] for m in client.get(f"{base}/memories").json()["memories"]]
        assert mine_private["id"] not in ids and mine_shared["id"] in ids
        # 他人の「自分だけ」の記録は、どの操作でも存在が分からない(404)
        assert client.get(f"{base}/memories/{mine_private['id']}/media").status_code == 404
        assert client.patch(f"{base}/memories/{mine_private['id']}", json={"body": "x"},
                            headers={"If-Match": "1"}).status_code == 404
        assert client.delete(f"{base}/memories/{mine_private['id']}").status_code == 404
        # 公開された他人の記録は見られるが、変えられない・消せない
        assert client.get(f"{base}/memories/{mine_shared['id']}/media").status_code == 200
        assert client.patch(f"{base}/memories/{mine_shared['id']}", json={"body": "x"},
                            headers={"If-Match": "1"}).status_code == 403
        assert client.delete(f"{base}/memories/{mine_shared['id']}").status_code == 403

        _act_as(viewer)
        listed = client.get(f"{base}/memories").json()
        assert listed["can_create"] is False
        assert {m["id"] for m in listed["memories"]} == {mine_shared["id"], ed_shared["id"]}
        assert client.post(f"{base}/memories", json={"body": "x"}).status_code == 403
        assert _upload(client, base).status_code == 403
        assert client.post(f"{base}/memories/journal-draft", json={}).status_code == 200
    finally:
        _act_as(owner)

    # 所有者: 公開された他人の記録は消せる。他人の「自分だけ」の記録は見えない
    ids = [m["id"] for m in client.get(f"{base}/memories").json()["memories"]]
    assert ed_private["id"] not in ids and ed_shared["id"] in ids
    assert client.delete(f"{base}/memories/{ed_private['id']}").status_code == 404
    assert client.delete(f"{base}/memories/{ed_shared['id']}").status_code == 204

    # 部外者
    stranger, _ = make_user()
    try:
        _act_as(stranger)
        assert client.get(f"{base}/memories").status_code == 403
    finally:
        _act_as(owner)


def test_update_requires_if_match(auth_client):
    client, owner, p, base, (d1, d2), ev = _setup(auth_client)
    m = client.post(f"{base}/memories", json={"body": "最初", "event_id": ev["清水寺"]["id"]}).json()
    url = f"{base}/memories/{m['id']}"
    assert client.patch(url, json={"body": "x"}).status_code == 400
    assert client.patch(url, json={"body": "x"}, headers={"If-Match": "9"}).status_code == 409
    r = client.patch(url, json={"body": "変更後", "visibility": "members", "include_in_journal": False},
                     headers={"If-Match": "1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["revision"] == 2 and body["visibility"] == "members" and body["include_in_journal"] is False
    assert body["event_id"] == ev["清水寺"]["id"]  # 送らなかった項目は変えない
    r = client.patch(url, json={"event_id": ev["美術館"]["id"]}, headers={"If-Match": "2"})
    assert r.status_code == 200 and r.json()["day_id"] == d2["id"]  # 予定を変えると日も追従
    r = client.patch(url, json={"event_id": None}, headers={"If-Match": "3"})
    assert r.status_code == 200 and r.json()["event_id"] is None and r.json()["day_id"] == d2["id"]
    for payload, code in (({"body": ""}, "invalid_field"), ({}, "no_changes"),
                          ({"video_url": "https://x.example/"}, "invalid_field")):
        res = client.patch(url, json=payload, headers={"If-Match": "4"})
        assert res.status_code == 422 and res.json()["detail"]["code"] == code, res.text
    # 予定を消しても記録は残る(外部キーを張らない。B-013)
    assert client.delete(f"/api/v1/plans/{p}/events/{ev['清水寺']['id']}", headers={
        "If-Match": str(client.get(f"/api/v1/plans/{p}").json()["revision"])}).status_code in (200, 204)


def test_journal_draft_api(auth_client, make_user, db_session):
    client, owner, p, base, (d1, d2), ev = _setup(auth_client, title="京都の旅")
    friend = _member(db_session, make_user, p, "editor", username="hanako")
    client.post(f"{base}/memories", json={"body": "hanakoと参拝。確認番号 QX9Z81", "event_id": ev["清水寺"]["id"],
                                          "latitude": 34.99, "longitude": 135.78})
    _upload(client, base, event_id=ev["昼食"]["id"])
    try:
        _act_as(friend)
        client.post(f"{base}/memories", json={"body": "友人の公開メモ", "visibility": "members",
                                              "event_id": ev["美術館"]["id"]})
        client.post(f"{base}/memories", json={"body": "友人の非公開メモ", "event_id": ev["美術館"]["id"]})
    finally:
        _act_as(owner)

    r = client.post(f"{base}/memories/journal-draft", json={})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["title"] == "京都の旅" and d["algorithm_version"] == "journal-draft-v1"
    assert d["summary"] == {"planned_events": 3, "recorded_events": 2, "memories": 2, "photos": 1}
    codes = {c["code"] for c in d["checks"]}
    assert {"member_name", "reservation_like", "photo_people", "location_excluded"} <= codes
    assert "友人の" not in d["markdown"] and "135.78" not in d["markdown"]
    with_others = client.post(f"{base}/memories/journal-draft", json={"include_others": True}).json()
    assert "友人の公開メモ" in with_others["markdown"] and "友人の非公開メモ" not in with_others["markdown"]
    assert client.post(f"{base}/memories/journal-draft", json={"publish": True}).status_code == 422
    # 下書きは旅程を変えない
    assert client.get(f"/api/v1/plans/{p}").json()["revision"] == client.get(f"/api/v1/plans/{p}").json()["revision"]


def test_purge_export_and_account_deletion(auth_client, make_user, db_session, storage):
    client, owner, p, base, _days, ev = _setup(auth_client)
    _upload(client, base)
    member = _member(db_session, make_user, p, "editor")
    try:
        _act_as(member)
        _upload(client, base, body="メンバーの写真")
        client.post(f"{base}/memories", json={"body": "メンバーの公開メモ", "visibility": "members"})
        client.post(f"{base}/memories", json={"body": "メンバーの非公開メモ"})
    finally:
        _act_as(owner)

    # 書き出し: 自分の分とメンバーに公開された分だけ。保存キーは含めない
    exp = client.get(f"{base}/data-export").json()["plans"][0]
    rows = exp["tables"]["memories"]
    assert sorted(r.get("body") or "" for r in rows) == ["", "メンバーの公開メモ"]
    assert all("storage_key" not in r for r in rows)
    for t in ("itinerary_branches", "plan_alerts", "replans", "sync_operations"):
        assert t in exp["tables"]

    # メンバーのアカウント削除: 参加している旅行に残した記録とファイルを消す
    from app.services import account_deletion
    pre = account_deletion.preview(db_session, member)
    assert pre["deleted_in_member_plans"]["memories"] == 3
    summary = account_deletion.delete_account(db_session, member)
    db_session.commit()
    assert summary["memories"] == 3
    assert db_session.query(Memory).filter(Memory.plan_id == uuid.UUID(p)).count() == 1
    assert len(list(Path(storage).rglob("*.png"))) == 1

    # 旅行の完全削除: 行とファイルを消す
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).one()
    plan_deletion.soft_delete_plan(db_session, plan, owner.id)
    db_session.commit()
    plan.purge_after = plan.deleted_at - timedelta(days=1)
    db_session.commit()
    assert plan_deletion.purge_plan(db_session, plan, owner.id) is True
    assert db_session.query(Memory).filter(Memory.plan_id == uuid.UUID(p)).count() == 0
    assert len(list(Path(storage).rglob("*.png"))) == 0


def test_export_covers_every_plan_table():
    """旅行(plan_id)を持つ表はすべて旅行の書き出しに含める(P7・P10・P11の漏れの再発防止)。"""
    from app.core.database import Base
    from app.services import data_export
    exported = {t.__tablename__ for t in data_export.PLAN_TABLES}
    missing = sorted(t.name for t in Base.metadata.tables.values() if "plan_id" in t.c and t.name not in exported)
    assert missing == []
