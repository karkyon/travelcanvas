"""[FR-063] SNS の下書きとリール(詳細設計 DD-2026-11-22-01 §8.8)。

文のひな形(型ごとの長さ・ハッシュタグの数・記号の除去)・自宅の近く・時刻・名前を外す・ほかの人の許していない写真が出ない・
route_shape が形だけ・書き出しの記録に写真の ID が入らない・AI で整えるは押した時だけ・顔の検査の鍵が無い時。
"""

import json
import uuid
from datetime import datetime, timezone

from app.core.auth import AuthResult, get_current_user
from app.core.crypto import encrypt_payload
from app.main import app
from app.models.models import (
    DayTripRoute,
    EventActual,
    Memory,
    PlanCollaborator,
    ReelExport,
    TravelPlan,
    UserHomePlace,
)
from app.services import day_trip as dt
from app.services import provider_calls as pc
from app.services import social_draft as sd

T = datetime(2026, 11, 28, 4, 0, tzinfo=timezone.utc)


def _plan(client, title="伊勢・おかげ横丁の旅", destination="伊勢"):
    p = client.post("/api/v1/travel-plans/", json={"title": title, "destination": destination}).json()["id"]
    days = [
        client.post(
            f"/api/v1/plans/{p}/days", json={"local_date": f"2026-11-2{i}", "timezone_id": "Asia/Tokyo"}
        ).json()["id"]
        for i in (8, 9)
    ]
    return p, days


def _visit(client, db, me, p, d, title, lat, lng, minute):
    res = client.post(
        f"/api/v1/plans/{p}/events",
        json={
            "day_id": d,
            "title": title,
            "event_type": "sightseeing",
            "start_at": "2026-11-28T10:00:00+09:00",
            "latitude": lat,
            "longitude": lng,
        },
        headers={"Idempotency-Key": uuid.uuid4().hex},
    )
    assert res.status_code == 201, res.text
    db.add(
        EventActual(
            plan_id=uuid.UUID(p),
            event_id=uuid.UUID(res.json()["id"]),
            status="visited",
            recorded_by_user_id=me.id,
            actual_start_at=T.replace(minute=minute),
        )
    )


def _photo(db, p, author, **kw):
    m = Memory(
        plan_id=uuid.UUID(p),
        author_user_id=author.id,
        kind="photo",
        storage_key=f"k/{uuid.uuid4().hex}",
        occurred_at=T,
        **kw,
    )
    db.add(m)
    db.flush()
    return m


def test_template_lengths_hashtags_and_symbols(auth_client, db_session):
    client, me = auth_client
    p, (d1, _d2) = _plan(client)
    names = ["内宮", "おかげ横丁", "赤福 本店", "伊勢うどん ちとせ", "夫婦岩", "二見興玉神社", "鳥羽水族館"]
    for i, n in enumerate(names):
        _visit(client, db_session, me, p, d1, n, 34.45 + i * 0.01, 136.72, i)
    db_session.add(
        Memory(
            plan_id=uuid.UUID(p),
            author_user_id=me.id,
            kind="note",
            body="また来たい。朝の内宮が良かった",
            occurred_at=T,
        )
    )
    db_session.commit()
    tk = client.get(f"/api/v1/plans/{p}/social/draft", params={"style": "tiktok"}).json()
    lines = tk["text"].split("\n")
    assert lines[0] == "伊勢へ1泊2日。"
    assert lines[1] == "内宮 → おかげ横丁 → 赤福 本店 → 伊勢うどん ちとせ → 夫婦岩"  # 最大 5
    assert lines[2].startswith("行った場所 7 か所")
    assert lines[3] == "また来たい。朝の内宮が良かった"
    assert len(tk["hashtags"]) == 8 and tk["hashtags"][-1] == "#旅の記録"
    assert "#赤福本店" in tk["hashtags"] and all(" " not in t for t in tk["hashtags"])  # 空白・記号を外す
    x = client.get(f"/api/v1/plans/{p}/social/draft", params={"style": "x"}).json()
    assert len(x["hashtags"]) == 3
    assert len(x["text"] + "\n" + " ".join(x["hashtags"])) <= 140
    line = client.get(f"/api/v1/plans/{p}/social/draft", params={"style": "line"}).json()
    assert line["text"].split("\n")[0] == "伊勢へ1泊2日。" and len(line["text"].split("\n")) == 2
    assert tk["char_limit"] == 4000 and tk["photo_range"] == [3, 20] and line["photo_range"] == [1, 10]


def test_home_near_names_and_time_are_excluded(auth_client, make_user, db_session):
    client, me = auth_client
    p, (d1, _d2) = _plan(client)
    friend, _ = make_user(username="hanako_tabi")
    db_session.add(
        PlanCollaborator(
            plan_id=uuid.UUID(p), user_id=friend.id, email=friend.email, role="editor", status="accepted"
        )
    )
    db_session.add(
        UserHomePlace(
            user_id=me.id,
            place_ciphertext=encrypt_payload(
                json.dumps({"label": "自宅", "address": None, "latitude": 34.80, "longitude": 135.60}).encode()
            ),
        )
    )
    _visit(client, db_session, me, p, d1, "近所のパン屋", 34.801, 135.601, 1)  # 自宅から約 140m
    _visit(client, db_session, me, p, d1, "内宮", 34.455, 136.725, 2)
    db_session.add(
        Memory(
            plan_id=uuid.UUID(p),
            author_user_id=me.id,
            kind="note",
            body="hanako_tabiさんと歩いた @hanako 楽しかった",
            occurred_at=T,
        )
    )
    _photo(db_session, p, me, latitude=34.8005, longitude=135.6005, place_name="近所")
    db_session.commit()
    body = client.get(f"/api/v1/plans/{p}/social/draft", params={"style": "tiktok"}).json()
    assert "近所のパン屋" not in body["text"] and "内宮" in body["text"]
    assert "hanako" not in body["text"]
    assert body["excluded"]["home_near"] >= 1 and body["excluded"]["names"] >= 2
    assert body["photos"][0]["place_name"] is None  # 自宅の近くの写真の場所の名前を出さない
    assert body["photos"][0]["taken_at"] == "2026-11-28"  # 既定は日付だけ
    with_time = client.get(
        f"/api/v1/plans/{p}/social/draft", params={"style": "tiktok", "include_time": "true"}
    ).json()
    assert with_time["photos"][0]["taken_at"].startswith("2026-11-28T")


def test_only_allowed_photos_and_own_audio(auth_client, make_user, db_session):
    client, me = auth_client
    p, _days = _plan(client)
    other, _ = make_user()
    db_session.add(
        PlanCollaborator(plan_id=uuid.UUID(p), user_id=other.id, email=other.email, role="editor", status="accepted")
    )
    mine = _photo(db_session, p, me)
    shared = _photo(db_session, p, other, visibility="members", include_in_journal=True)
    private = _photo(db_session, p, other, visibility="private")
    not_journal = _photo(db_session, p, other, visibility="members", include_in_journal=False)
    db_session.add(Memory(plan_id=uuid.UUID(p), author_user_id=me.id, kind="audio", storage_key="a/1", occurred_at=T))
    db_session.add(
        Memory(plan_id=uuid.UUID(p), author_user_id=other.id, kind="audio", storage_key="a/2", occurred_at=T)
    )
    db_session.commit()
    body = client.get(f"/api/v1/plans/{p}/social/draft").json()
    ids = {x["memory_id"] for x in body["photos"]}
    assert ids == {str(mine.id), str(shared.id)}
    assert str(private.id) not in ids and str(not_journal.id) not in ids
    assert len(body["audios"]) == 1  # 自分の声だけ


def test_route_shape_is_normalized_and_home_cut(auth_client, db_session):
    client, me = auth_client
    plan = TravelPlan(id=uuid.uuid4(), user_id=me.id, title="桂坂へ日帰り", destination="桂坂", trip_style="day_trip")
    db_session.add(plan)
    db_session.flush()
    line = [(34.99, 135.70), (34.995, 135.69), (34.98, 135.66), (34.97, 135.65)]
    db_session.add(
        DayTripRoute(
            plan_id=plan.id,
            leg="out",
            origin_label="現在地のあたり",
            origin_lat=34.99,
            origin_lng=135.70,
            dest_label="桂坂",
            dest_lat=34.97,
            dest_lng=135.65,
            road="auto",
            depart_at="09:00",
            polyline=dt.encode_polyline(line),
            provider="osrm",
            computed_at=T,
            revision=1,
        )
    )
    db_session.commit()
    body = client.get(f"/api/v1/plans/{plan.id}/social/draft").json()
    shape = body["route_shape"]
    assert shape and all(0 <= x <= 1 and 0 <= y <= 1 for x, y in shape)
    assert len(shape) == 3  # 出発地から 1km 以内の点(最初の 1 点)は切る。約 1.06km 先の点は残る
    assert "34.9" not in json.dumps(shape) and body["text"].startswith("桂坂へ日帰り。")


def test_reel_export_record_has_no_photo_ids_and_validation(auth_client, make_user, db_session):
    client, me = auth_client
    p, _days = _plan(client)
    r = client.post(
        f"/api/v1/plans/{p}/reel-exports",
        json={
            "style": "tiktok",
            "scope": "trip",
            "duration_s": 30,
            "frame_count": 10,
            "status": "ready",
            "bytes": 1234,
        },
    )
    assert r.status_code == 201, r.text
    row = db_session.get(ReelExport, uuid.UUID(r.json()["id"]))
    assert row.renderer == "device" and row.frame_count == 10 and row.storage_key is None
    assert not hasattr(row, "memory_ids")
    bad = {"style": "tiktok", "scope": "trip", "duration_s": 30, "frame_count": 10, "status": "ready"}
    assert client.post(f"/api/v1/plans/{p}/reel-exports", json={**bad, "memory_ids": ["x"]}).status_code == 422
    assert client.post(f"/api/v1/plans/{p}/reel-exports", json={**bad, "renderer": "server"}).status_code == 422
    assert client.post(f"/api/v1/plans/{p}/reel-exports", json={**bad, "style": "facebook"}).status_code == 422
    assert client.get(f"/api/v1/plans/{p}/reel-exports").json()["exports"][0]["style"] == "tiktok"
    stranger, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=stranger, is_authenticated=True, is_guest=False
    )
    try:
        assert client.get(f"/api/v1/plans/{p}/social/draft").status_code in (403, 404)
        assert client.post(f"/api/v1/plans/{p}/reel-exports", json=bad).status_code in (403, 404)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    from app.services import data_export

    out = data_export.plan_tables(db_session, db_session.get(TravelPlan, uuid.UUID(p)), me.id)
    assert len(out["reel_exports"]) == 1


def test_polish_sends_only_text_and_face_boxes_need_key(auth_client, db_session, monkeypatch):
    client, me = auth_client
    p, _days = _plan(client)
    sent = []

    def fake(db, plan, caller, prompt, idem):
        sent.append(prompt)
        return {"text": "伊勢へ1泊2日。整えた文", "model": "m"}, {"used": 1}

    monkeypatch.setattr(pc, "ai_suggest", fake)
    r = client.post(f"/api/v1/plans/{p}/social/polish", json={"text": "伊勢へ1泊2日。", "style": "tiktok"})
    assert r.status_code == 200 and r.json()["text"] == "伊勢へ1泊2日。整えた文"
    assert "伊勢へ1泊2日。" in sent[0] and "下書きに無い場所" in sent[0]
    assert client.post(f"/api/v1/plans/{p}/social/polish", json={"text": "", "style": "tiktok"}).status_code == 422
    m = _photo(db_session, p, me)
    db_session.commit()
    r = client.post(f"/api/v1/plans/{p}/social/face-boxes", json={"memory_ids": [str(m.id)]})
    assert r.status_code == 200 and r.json() == {"configured": False, "boxes": {}}


def test_hashtag_helper():
    assert sd.hashtag("赤福 本店") == "#赤福本店"
    assert sd.hashtag("おかげ横丁・おはらい町!") == "#おかげ横丁おはらい町"
    assert sd.hashtag("a") is None
    assert sd.strip_names("花子と @hana_k で", ["花子"]) == ("と で", 2)
