"""
[Gate C2] FR-007 候補箱・FR-008 場所の一元管理の試験(実PostgreSQL)。

検証する主な性質:
- URL の正規化(追跡用のパラメータ・断片・既定のポートを外す、http/https だけ、利用者名つき・制御文字は拒否)。取りに行かない
- 重複の候補(提供元の ID・名前・住所・URL。近いだけは重複にしない)を理由つきで示し、自動で消さない。統合できる
- 候補→旅程に追加(場所を作り予定を作る。候補は残る。変更セットで元に戻すと候補に戻る)。If-Match で守る
- 権限: viewer は見るだけ、他人は見えない。他の人の検索結果は採用・候補にできない。場所は使う旅行のメンバーだけが見られ、
  使う全ての旅行を編集できる人だけが直せる。見られない場所は予定に付けられない(以前の IDOR)
- 場所の項目・営業時間を直すと、出典が「利用者の入力」になる。監査に名前・URL を残さない
"""
import json
import uuid
from datetime import datetime, timezone

import pytest

from app.api.v1 import candidates as candidates_api
from app.api.v1 import places as places_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator, SearchCandidate, SourceRecord
from app.services import candidates as cs

KYOTO = (34.9948, 135.7850)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    calls = []
    monkeypatch.setattr(candidates_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(places_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


# ---------------------------------------------------------------- 純粋関数


def test_canonical_url():
    assert cs.canonical_url("HTTPS://WWW.Example.COM:443/a/b?utm_source=x&id=3&fbclid=y#top") == \
        "https://www.example.com/a/b?id=3"
    assert cs.canonical_url("http://example.com") == "http://example.com/"
    assert cs.canonical_url("http://example.com:8080/x") == "http://example.com:8080/x"
    assert cs.canonical_url("  ") is None and cs.canonical_url(None) is None
    for bad in ("ftp://example.com/", "javascript:alert(1)", "https://user:pw@example.com/", "https:///nohost",
                "https://example.com/\x00", "https://example.com/" + "a" * 2000, "https://example.com:99999/"):
        with pytest.raises(cs.CandidateInputError):
            cs.canonical_url(bad)
    assert cs.url_label("https://www.kiyomizudera.or.jp/") == "kiyomizudera.or.jp"


def test_duplicates():
    base = {"status": "open", "merged_into_id": None, "provider": None, "external_id": None, "address": None,
            "source_url": None}
    items = [
        {**base, "id": "a", "title": "清水寺", "latitude": KYOTO[0], "longitude": KYOTO[1]},
        {**base, "id": "b", "title": "清 水 寺 ", "latitude": KYOTO[0] + 0.0003, "longitude": KYOTO[1]},
        {**base, "id": "c", "title": "近くの茶店", "latitude": KYOTO[0] + 0.0002, "longitude": KYOTO[1]},
        {**base, "id": "d", "title": "ＫＩＹＯＭＩＺＵ", "provider": "osm", "external_id": "n1"},
        {**base, "id": "e", "title": "kiyomizu", "provider": "osm", "external_id": "n1"},
        {**base, "id": "f", "title": "清水寺", "status": "dismissed"},
    ]
    d = cs.find_duplicates(items)
    assert [x["id"] for x in d["a"]] == ["b"] and set(d["a"][0]["reasons"]) == {"same_name", "nearby"}
    assert "c" not in d  # 近いだけは重複にしない
    assert set(d["d"][0]["reasons"]) == {"same_provider_id", "same_name"}
    assert "f" not in d


# ---------------------------------------------------------------- API


def _setup(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "候補箱"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                    headers=_ik()).json()
    return p, base, d["id"]


def _item(body, cid):
    return next(i for i in body["items"] if i["id"] == cid)


def test_candidate_box_flow(auth_client, make_user, db_session, _env):
    client, owner = auth_client
    p, base, day_id = _setup(client)
    url = f"{base}/candidates"

    r = client.post(url, json={"source_url": "https://www.kiyomizudera.or.jp/?utm_campaign=a#x", "priority": 1,
                               "latitude": KYOTO[0], "longitude": KYOTO[1], "note": "朝が空いている"})
    assert r.status_code == 201, r.text
    a = _item(r.json(), r.json()["id"])
    assert a["source_url"] == "https://www.kiyomizudera.or.jp/" and a["title"] == "kiyomizudera.or.jp"
    assert a["source_kind"] == "url" and a["status"] == "open" and a["created_by"] == owner.username
    b_id = client.post(url, json={"title": "kiyomizudera.or.jp", "latitude": KYOTO[0] + 0.0003,
                                  "longitude": KYOTO[1]}).json()["id"]
    assert client.post(url, json={}).status_code == 422
    assert client.post(url, json={"source_url": "ftp://x"}).json()["detail"]["code"] == "invalid_url"
    assert client.post(url, json={"title": "x", "latitude": 1}).status_code == 422

    listing = client.get(url).json()
    assert listing["duplicate_pairs"] == 1 and listing["can_edit"] is True
    assert _item(listing, a["id"])["duplicates"][0]["id"] == b_id
    assert set(_item(listing, a["id"])["duplicates"][0]["reasons"]) == {"same_name", "nearby"}
    # 監査に名前・URL を残さない
    assert "kiyomizu" not in json.dumps(_env, default=str)

    # 更新(If-Match)
    cu = f"{url}/{b_id}"
    assert client.patch(cu, json={"priority": 3}).status_code == 400
    assert client.patch(cu, json={"priority": 3}, headers={"If-Match": "9"}).status_code == 409
    up = client.patch(cu, json={"priority": 3, "note": "夕方"}, headers={"If-Match": "1"})
    assert up.status_code == 200 and _item(up.json(), b_id)["priority"] == 3
    assert client.patch(cu, json={"status": "scheduled"}, headers={"If-Match": "2"}).status_code == 422

    # 統合: b を a へまとめる → b は見送り、a に出典が残る、重複は消える
    m = client.post(f"{cu}/merge", json={"into_id": a["id"]}, headers={"If-Match": "2"})
    assert m.status_code == 200, m.text
    assert _item(m.json(), b_id)["status"] == "dismissed" and _item(m.json(), b_id)["merged_into_id"] == a["id"]
    assert _item(m.json(), a["id"])["merged_from"][0]["id"] == b_id and m.json()["duplicate_pairs"] == 0

    # 旅程に追加 → 場所と予定ができ、候補は残る
    s = client.post(f"{url}/{a['id']}/schedule", json={"day_id": day_id, "local_start_time": "09:00"},
                    headers={"If-Match": str(a["revision"])})
    assert s.status_code == 201, s.text
    body = s.json()
    sched = _item(body, a["id"])
    assert sched["status"] == "scheduled" and sched["scheduled_event_id"] == body["event_id"]
    assert client.post(f"{url}/{a['id']}/schedule", json={"day_id": day_id},
                       headers={"If-Match": str(sched["revision"])}).status_code == 409
    detail = client.get(f"/api/v1/plans/{p}").json()
    events = [e for d in detail.get("days", []) for e in d.get("events", [])]
    ev = next(e for e in events if e["id"] == body["event_id"])
    assert ev["place_id"] == body["place_id"] and ev["local_start_time"] == "09:00" and ev["title"] == a["title"]
    place = client.get(f"/api/v1/places/{body['place_id']}").json()
    assert place["sources"]["name"]["provider"] == "url" and place["events"][0]["event_id"] == body["event_id"]
    assert place["can_edit"] is True

    # 元に戻す(変更セット source=candidate)→ 予定が消え、候補に戻る
    u = client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(body["plan_revision"])})
    assert u.status_code == 200, u.text
    back = _item(client.get(url).json(), a["id"])
    assert back["status"] == "open" and back["scheduled_event_id"] is None

    # 権限: viewer は見るだけ、他人は見えない
    viewer, _ = make_user()
    stranger, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    try:
        _act_as(viewer)
        assert client.get(url).status_code == 200
        assert client.post(url, json={"title": "x"}).status_code == 403
        assert client.get(f"/api/v1/places/{body['place_id']}").json()["can_edit"] is False
        assert client.patch(f"/api/v1/places/{body['place_id']}", json={"phone": "075-1"},
                            headers={"If-Match": "1"}).status_code == 403
        _act_as(stranger)
        assert client.get(url).status_code in (403, 404)
        assert client.get(f"/api/v1/places/{body['place_id']}").status_code == 404
        assert client.get(f"/api/v1/search/places/{body['place_id']}").status_code == 404
        # 見られない場所は、自分の旅行の予定にも付けられない(以前の IDOR)
        sp = client.post("/api/v1/travel-plans/", json={"title": "他人の旅行"}).json()["id"]
        sd = client.post(f"/api/v1/plans/{sp}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                         headers=_ik()).json()
        bad = client.post(f"/api/v1/plans/{sp}/events", json={"day_id": sd["id"], "title": "x",
                                                              "place_id": body["place_id"]}, headers=_ik())
        assert bad.status_code == 404
    finally:
        _act_as(owner)

    # 削除(まとめられていた候補は戻る)
    assert client.delete(f"{url}/{a['id']}").status_code == 204
    after = client.get(url).json()
    assert [i["id"] for i in after["items"]] == [b_id] and after["items"][0]["status"] == "open"


def test_places_edit_hours_and_provenance(auth_client, make_user, db_session, _env):
    client, owner = auth_client
    p, base, day_id = _setup(client)
    cid = client.post(f"{base}/candidates", json={"title": "旅館", "address": "京都市東山区"}).json()["id"]
    s = client.post(f"{base}/candidates/{cid}/schedule", json={"day_id": day_id, "event_type": "accommodation"},
                    headers={"If-Match": "1"}).json()
    pid = s["place_id"]
    purl = f"/api/v1/places/{pid}"
    assert client.patch(purl, json={"phone": "075"}).status_code == 400
    r = client.patch(purl, json={"phone": "+81 75-123-4567", "entrance_note": "正面の門の右", "floor": "1F",
                                 "aliases": ["お宿", "お宿", " "], "reservation_required": True,
                                 "website": "https://example.com/ryokan?utm_source=ad", "closed_days": "水曜"},
                     headers={"If-Match": "1"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["phone"] == "+81 75-123-4567" and d["aliases"] == ["お宿"] and d["website"] == "https://example.com/ryokan"
    assert d["sources"]["phone"]["label"] == "利用者の入力" and d["sources"]["address"]["provider"] == "user"
    assert d["revision"] == 2
    assert client.patch(purl, json={"phone": "abc"}, headers={"If-Match": "2"}).status_code == 422
    assert client.patch(purl, json={"name": ""}, headers={"If-Match": "2"}).status_code == 422
    assert client.patch(purl, json={"phone": "1"}, headers={"If-Match": "1"}).status_code == 409
    h = client.put(f"{purl}/opening-hours", json={"hours": [
        {"day_of_week": 0, "open_time": "15:00", "close_time": "23:00"},
        {"day_of_week": 5, "open_time": "18:00", "close_time": "02:00"}]}, headers={"If-Match": "2"})
    assert h.status_code == 200, h.text
    assert [x["day_of_week"] for x in h.json()["opening_hours"]] == [0, 5]
    assert h.json()["sources"]["opening_hours"]["provider"] == "user"
    assert client.put(f"{purl}/opening-hours", json={"hours": [{"day_of_week": 1, "open_time": "9", "close_time":
                                                               "10:00"}]}, headers={"If-Match": "3"}).status_code == 422
    listing = client.get(f"{base}/places").json()["places"]
    assert listing[0]["id"] == pid and listing[0]["event_count"] == 1 and listing[0]["has_opening_hours"] is True

    # 別の旅行(編集できない)でも使われている場所は、直せない(共有の場所を書き換えさせない)
    other, _ = make_user()
    _act_as(other)
    try:
        op = client.post("/api/v1/travel-plans/", json={"title": "別の旅行"}).json()["id"]
    finally:
        _act_as(owner)
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(op), user_id=owner.id, email=owner.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    _act_as(other)
    try:
        od = client.post(f"/api/v1/plans/{op}/days", json={"local_date": "2026-11-03", "timezone_id": "Asia/Tokyo"},
                         headers=_ik()).json()
        # other は場所を見られないので付けられない
        assert client.post(f"/api/v1/plans/{op}/events", json={"day_id": od["id"], "title": "x", "place_id": pid},
                           headers=_ik()).status_code == 404
    finally:
        _act_as(owner)


def test_from_search_only_own_results(auth_client, make_user, db_session):
    client, owner = auth_client
    p, base, _day = _setup(client)
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    mine = SearchCandidate(query="寺", provider="nominatim", external_id="n9", name="清水寺", latitude=KYOTO[0],
                           longitude=KYOTO[1], searched_by_user_id=owner.id, retrieved_at=now)
    other_user, _ = make_user()
    theirs = SearchCandidate(query="寺", provider="nominatim", name="金閣寺", searched_by_user_id=other_user.id,
                             retrieved_at=now)
    db_session.add_all([mine, theirs])
    db_session.flush()
    db_session.add(SourceRecord(candidate_id=mine.id, provider="nominatim", source_url="https://osm.org/n9?utm_x=1",
                                retrieved_at=now))
    db_session.commit()
    r = client.post(f"{base}/candidates/from-search", json={"search_candidate_id": str(mine.id)})
    assert r.status_code == 201, r.text
    c = _item(r.json(), r.json()["id"])
    assert c["source_kind"] == "search" and c["provider"] == "nominatim" and c["retrieved_at"].startswith("2026-10-20")
    assert c["source_url"] == "https://osm.org/n9"  # 追跡用のパラメータを外す
    assert client.post(f"{base}/candidates/from-search",
                       json={"search_candidate_id": str(theirs.id)}).status_code == 404
    # 他の人の検索結果は採用もできない(以前の IDOR)
    assert client.post(f"/api/v1/search/candidates/{theirs.id}/adopt").status_code == 404
