"""
[Gate G11] 旅行の表紙の写真(docs/ux/G11_UIUX全範囲_実装仕様.md §1・§2.1)。

検証する主な性質:
- 編集できる人が同じ旅行の写真の記録を表紙に設定・位置の調整・解除できる。閲覧者は 403
- 他の旅行の記録・音声の記録・他人の非公開の記録は使えない(他人の非公開は存在も知らせず 404)
- 非公開の写真を表紙にしても公開範囲は変わらない。他のメンバーには表紙の情報も写真も返さない
- 表紙の写真の配信は撮影情報(GPS)を除去し、キャッシュさせない
- 記録を消すと表紙は外れる(ON DELETE SET NULL)。旅行の複製は表紙をコピーしない。PUT /travel-plans では変わらない
- 一覧・ダッシュボードの応答に、見える人だけ表紙が入る。監査に本文・ファイル名を残さない
"""
import io
import uuid

import pytest
from PIL import Image

from app.api.v1 import memories as memories_api
from app.api.v1 import plan_cover as plan_cover_api
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import Memory, PlanCollaborator, TravelPlan

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
MP3 = b"ID3" + b"\x00" * 64
GPS_IFD = 0x8825


def _gps_jpeg() -> bytes:
    ex = Image.Exif()
    ex[0x010F] = "TestMaker"
    gps = ex.get_ifd(GPS_IFD)
    gps[1] = "N"
    gps[2] = (35.0, 0.0, 0.0)
    gps[3] = "E"
    gps[4] = (135.0, 45.0, 0.0)
    out = io.BytesIO()
    Image.new("RGB", (32, 16), (10, 120, 200)).save(out, format="JPEG", quality=90, exif=ex.tobytes())
    return out.getvalue()


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(memories_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(plan_cover_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


@pytest.fixture(autouse=True)
def storage(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    return tmp_path / "documents"


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _plan(client, title="表紙の試験"):
    p = client.post("/api/v1/travel-plans/", json={"title": title, "destination": "京都"}).json()["id"]
    return p, f"/api/v1/plans/{p}"


def _upload(client, base, content=PNG, filename="a.png", kind="photo", **fields):
    data = {"kind": kind, **{k: str(v) for k, v in fields.items()}}
    r = client.post(f"{base}/memories/upload", data=data, files={"file": (filename, io.BytesIO(content))})
    assert r.status_code == 201, r.text
    return r.json()


def _member(db_session, make_user, p, role="editor"):
    u, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=u.id, email=u.email, role=role, status="accepted"))
    db_session.commit()
    return u


def test_set_move_clear_and_media(auth_client, audit_calls):
    client, owner = auth_client
    p, base = _plan(client)
    assert client.get(f"{base}/cover").json() == {"cover": None, "can_edit": True}
    assert client.get(f"{base}/cover/media").status_code == 404
    photo = _upload(client, base, _gps_jpeg(), "secret-name.jpg")
    assert photo["visibility"] == "private" and photo["source"] is None

    r = client.put(f"{base}/cover", json={"memory_id": photo["id"], "focus_x": 30, "focus_y": 70, "zoom": 150})
    assert r.status_code == 200, r.text
    cover = r.json()["cover"]
    assert cover["memory_id"] == photo["id"] and (cover["focus_x"], cover["focus_y"], cover["zoom"]) == (30, 70, 150)
    assert cover["visibility"] == "private" and cover["by_me"] is True

    media = client.get(f"{base}/cover/media")
    assert media.status_code == 200
    assert media.headers["cache-control"] == "no-store" and media.headers["x-content-type-options"] == "nosniff"
    assert b"Exif\x00\x00" not in media.content and b"TestMaker" not in media.content

    r = client.patch(f"{base}/cover", json={"zoom": 220})
    assert r.status_code == 200 and r.json()["cover"]["zoom"] == 220 and r.json()["cover"]["focus_x"] == 30
    for bad in ({"zoom": 99}, {"zoom": 301}, {"focus_x": -1}, {"focus_y": 101}, {"focus_x": True}):
        assert client.patch(f"{base}/cover", json=bad).status_code == 422, bad
    assert client.patch(f"{base}/cover", json={}).status_code == 422

    assert client.delete(f"{base}/cover").json() == {"cover": None, "can_edit": True}
    assert client.patch(f"{base}/cover", json={"zoom": 120}).status_code == 404
    # 写真そのものは消えない
    assert any(m["id"] == photo["id"] for m in client.get(f"{base}/memories").json()["memories"])

    actions = [c["action"] for c in audit_calls if c["action"].startswith("plan.cover")]
    assert actions == ["plan.cover_set", "plan.cover_move", "plan.cover_clear"]
    text = repr(audit_calls)
    assert "secret-name" not in text


def test_rejects_wrong_records(auth_client, make_user, db_session):
    client, owner = auth_client
    p, base = _plan(client)
    p2, base2 = _plan(client, "別の旅行")
    other_plan_photo = _upload(client, base2)
    audio = _upload(client, base, MP3, "v.mp3", kind="audio")
    note = client.post(f"{base}/memories", json={"kind": "note", "body": "メモ"}).json()
    assert client.put(f"{base}/cover", json={"memory_id": other_plan_photo["id"]}).status_code == 404
    assert client.put(f"{base}/cover", json={"memory_id": audio["id"]}).json()["detail"]["code"] == "not_a_photo"
    assert client.put(f"{base}/cover", json={"memory_id": note["id"]}).status_code == 422
    assert client.put(f"{base}/cover", json={"memory_id": str(uuid.uuid4())}).status_code == 404
    assert client.put(f"{base}/cover", json={"memory_id": "not-a-uuid"}).status_code == 422
    assert client.put(f"{base}/cover", json={"memory_id": other_plan_photo["id"], "x": 1}).status_code == 422

    # 他人の非公開の写真: 存在も知らせない(存在しない ID と同じ 404)
    editor = _member(db_session, make_user, p)
    _act_as(editor)
    theirs = _upload(client, base)
    _act_as(owner)
    r = client.put(f"{base}/cover", json={"memory_id": theirs["id"]})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "photo_not_found"


def test_private_cover_not_leaked_to_members(auth_client, make_user, db_session):
    client, owner = auth_client
    p, base = _plan(client)
    photo = _upload(client, base)
    assert client.put(f"{base}/cover", json={"memory_id": photo["id"]}).status_code == 200
    viewer = _member(db_session, make_user, p, role="viewer")
    editor = _member(db_session, make_user, p, role="editor")

    _act_as(viewer)
    assert client.get(f"{base}/cover").json() == {"cover": None, "can_edit": False}
    assert client.get(f"{base}/cover/media").status_code == 404
    assert client.put(f"{base}/cover", json={"memory_id": photo["id"]}).status_code == 403
    assert client.delete(f"{base}/cover").status_code == 403
    listed = [x for x in client.get("/api/v1/travel-plans/").json()["plans"] if x["id"] == p][0]
    assert listed["cover"] is None
    dash = [t for t in client.get("/api/v1/dashboard").json()["trips"] if t["id"] == p][0]
    assert dash["cover"] is None
    assert photo["id"] not in client.get(f"/api/v1/travel-plans/{p}").text

    _act_as(editor)
    assert client.get(f"{base}/cover").json()["cover"] is None
    assert client.patch(f"{base}/cover", json={"zoom": 120}).status_code == 404  # 見えない表紙は動かせない

    # 公開範囲は変わっていない。メンバーに公開すると見える
    _act_as(owner)
    assert db_session.get(Memory, uuid.UUID(photo["id"])).visibility == "private"
    rev = client.get(f"{base}/memories").json()["memories"][0]["revision"]
    assert client.patch(f"{base}/memories/{photo['id']}", json={"visibility": "members"},
                        headers={"If-Match": str(rev)}).status_code == 200
    _act_as(viewer)
    assert client.get(f"{base}/cover").json()["cover"]["memory_id"] == photo["id"]
    assert client.get(f"{base}/cover/media").status_code == 200
    dash = [t for t in client.get("/api/v1/dashboard").json()["trips"] if t["id"] == p][0]
    assert dash["cover"]["memory_id"] == photo["id"] and dash["cover"]["by_me"] is False
    listed = [x for x in client.get("/api/v1/travel-plans/").json()["plans"] if x["id"] == p][0]
    assert listed["cover"]["memory_id"] == photo["id"]

    # editor はメンバーに公開された写真で表紙を変えられる
    _act_as(editor)
    assert client.patch(f"{base}/cover", json={"focus_x": 10}).json()["cover"]["focus_x"] == 10


def test_delete_clone_and_plan_update(auth_client, db_session):
    client, owner = auth_client
    p, base = _plan(client)
    photo = _upload(client, base)
    assert client.put(f"{base}/cover", json={"memory_id": photo["id"], "zoom": 180}).status_code == 200

    # PUT /travel-plans は表紙を変えない(項目が無い)
    r = client.put(f"/api/v1/travel-plans/{p}", json={"title": "新しい題名", "cover": None, "cover_memory_id": None})
    assert r.status_code == 200 and r.json()["cover"]["memory_id"] == photo["id"]

    # 複製は表紙をコピーしない
    clone = client.post(f"/api/v1/travel-plans/{p}/clone", json={}).json()
    assert clone["cover"] is None
    assert db_session.get(TravelPlan, uuid.UUID(clone["id"])).cover_memory_id is None

    # 記録を消す(ゴミ箱へ) → 表紙は外れる(外部キーの SET NULL)
    assert client.delete(f"{base}/memories/{photo['id']}").status_code == 204
    db_session.expire_all()
    plan = db_session.get(TravelPlan, uuid.UUID(p))
    assert plan.cover_memory_id is None
    assert client.get(f"{base}/cover").json()["cover"] is None
    assert client.get(f"{base}/cover/media").status_code == 404


def test_db_constraints(db_session, make_user):
    from sqlalchemy.exc import IntegrityError

    u, _ = make_user()
    for fields in ({"cover_focus_x": 101}, {"cover_focus_y": -1}, {"cover_zoom": 99}, {"cover_zoom": 301},
                   {"cover_memory_id": uuid.uuid4()}):
        with pytest.raises(IntegrityError):
            with db_session.begin_nested():
                db_session.add(TravelPlan(user_id=u.id, title="制約", **fields))
                db_session.flush()
