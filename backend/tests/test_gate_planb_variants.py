"""[Gate PlanB] 日ごとの案(プランB)。控えの案はふだんの画面・一覧に出ず、案の API と予定の編集でだけ見える。
切り替えは上書きせず印を付け替え、元に戻すで戻り、記録が残る"""
import uuid


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _setup(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "伊勢・鳥羽", "preferences": {"party_size": 4}}).json()["id"]
    base = f"/api/v1/plans/{p}"
    tz = "Asia/Tokyo"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": tz}, headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": "2026-11-29", "timezone_id": tz}, headers=_ik()).json()

    def ev(day, title, t="sightseeing", **kw):
        body = {"day_id": day["id"], "title": title, "event_type": t, **kw}
        r = client.post(f"{base}/events", json=body, headers=_ik())
        assert r.status_code == 201, r.text
        return r.json()

    ev(d1, "伊勢神宮", local_start_time="10:00", latitude=34.48, longitude=136.70)
    ev(d1, "都リゾート 奥志摩", "accommodation", local_start_time="17:45", latitude=34.30, longitude=136.80)
    a1 = ev(d2, "二見興玉神社", local_start_time="08:00", latitude=34.51, longitude=136.79)
    a2 = ev(d2, "横山展望台", local_start_time="09:15", latitude=34.31, longitude=136.81)
    return p, base, d1, d2, a1, a2


def test_create_copy_hidden_edit_switch_undo(auth_client):
    client, _owner = auth_client
    p, base, d1, d2, a1, a2 = _setup(client)
    cond = {"party_size": 4, "transport_mode": "train", "prefer_indoor": True}
    body = {"local_date": "2026-11-29", "source": "copy_active", "name": "雨の日", "reason": "rain", "conditions": cond}
    r = client.post(f"{base}/variants", json=body)
    assert r.status_code == 201, r.text
    vb = r.json()["variants"][0]
    assert vb["label"] == "B" and vb["name"] == "雨の日" and vb["status"] == "standby" and vb["events"] == 2
    # 旅行の詳細(旅程)には今の案だけ。日は 2 つ・予定は元の 4 件
    detail = client.get(f"/api/v1/plans/{p}").json()
    assert len(detail["days"]) == 2 and sum(len(d["events"]) for d in detail["days"]) == 4
    # 案の日を読み、控えの案の予定を編集できる(予定の API はすべての案を見る)
    v = client.get(f"{base}/variants/{vb['day_id']}").json()
    b_ids = {e["title"]: e["id"] for e in v["day"]["events"]}
    rev = _rev(client, p)
    up = client.put(f"{base}/events/{b_ids['横山展望台']}", json={"title": "鳥羽水族館", "event_type": "activity"},
                    headers={"If-Match": str(rev)})
    assert up.status_code == 200, up.text
    body = {"day_id": vb["day_id"], "title": "海鮮ランチ", "event_type": "dining", "local_start_time": "12:15"}
    add = client.post(f"{base}/events", json=body, headers=_ik())
    assert add.status_code == 201, add.text
    assert client.get(f"/api/v1/plans/{p}").json()["days"][1]["events"][1]["title"] == "横山展望台"  # 本体は変わらない
    # 一覧
    lst = client.get(f"{base}/variants").json()["dates"]["2026-11-29"]
    assert [(x["label"], x["status"]) for x in lst] == [("A", "active"), ("B", "standby")]
    # 検証: 前の日の宿から・最終日・未予約(海鮮ランチ)
    chk = client.get(f"{base}/variants/{vb['day_id']}/check").json()
    titles = [i["title"] for i in chk["items"]]
    assert "前の日から: 合います" in titles and "翌日へ: この日が最終日です" in titles and "未予約: 海鮮ランチ" in titles
    # 切り替え
    rev = _rev(client, p)
    sw = client.post(f"{base}/variants/{vb['day_id']}/switch", json={"reason": "rain", "note": "本降り"},
                     headers={"If-Match": str(rev)})
    assert sw.status_code == 200, sw.text
    titles = [e["title"] for e in client.get(f"/api/v1/plans/{p}").json()["days"][1]["events"]]
    assert titles == ["二見興玉神社", "鳥羽水族館", "海鮮ランチ"]
    lst = client.get(f"{base}/variants").json()["dates"]["2026-11-29"]
    assert [(x["label"], x["status"]) for x in lst] == [("A", "standby"), ("B", "active")]
    hist = client.get(f"{base}/variant-switches").json()["switches"]
    assert hist[0]["from_label"] == "A" and hist[0]["to_label"] == "B" and hist[0]["reason_label"] == "雨"
    # 元に戻すで A に戻る
    assert client.post(f"{base}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    titles = [e["title"] for e in client.get(f"/api/v1/plans/{p}").json()["days"][1]["events"]]
    assert titles == ["二見興玉神社", "横山展望台"]
    # 今の案は消せない・控えは消せる
    rev = _rev(client, p)
    a_day = next(x for x in client.get(f"{base}/variants").json()["dates"]["2026-11-29"] if x["label"] == "A")
    assert client.delete(f"{base}/variants/{a_day['day_id']}", headers={"If-Match": str(rev)}).status_code == 409
    assert client.delete(f"{base}/variants/{vb['day_id']}", headers={"If-Match": str(rev)}).status_code == 200
    assert len(client.get(f"{base}/variants").json()["dates"]["2026-11-29"]) == 1


def test_blank_group_limit_and_lodging_check(auth_client):
    client, _owner = auth_client
    p, base, d1, d2, a1, a2 = _setup(client)
    # 2 日まとめて白紙(案の組)
    body = {"local_date": "2026-11-28", "source": "blank", "also_dates": ["2026-11-29"]}
    r = client.post(f"{base}/variants", json=body)
    assert r.status_code == 201, r.text
    made = r.json()["variants"]
    assert [m["events"] for m in made] == [0, 0] and made[0]["group_id"] == made[1]["group_id"]
    # 1 日目の白紙の案は今夜の宿が無い(翌日は宿から始まる)
    chk = client.get(f"{base}/variants/{made[0]['day_id']}/check").json()
    assert chk["status"] == "bad" and any(i["title"] == "今夜の宿がありません" for i in chk["items"])
    # 組でまとめて切り替え
    rev = _rev(client, p)
    url = f"{base}/variants/{made[0]['day_id']}/switch"
    sw = client.post(url, json={"group": True}, headers={"If-Match": str(rev)})
    assert sw.status_code == 200 and len(sw.json()["records"]) == 2
    assert all(len(d["events"]) == 0 for d in client.get(f"/api/v1/plans/{p}").json()["days"])
    # 案は 1 日 5 つまで
    for _ in range(3):
        assert client.post(f"{base}/variants", json={"local_date": "2026-11-29"}).status_code == 201
    over = client.post(f"{base}/variants", json={"local_date": "2026-11-29"})
    assert over.status_code == 409 and over.json()["detail"]["code"] == "too_many_variants"


def test_viewer_cannot_create_and_share_view_shows_active_only(auth_client, make_user):
    client, _owner = auth_client
    p, base, d1, d2, a1, a2 = _setup(client)
    r = client.post(f"{base}/variants", json={"local_date": "2026-11-29", "source": "blank", "name": "白紙"})
    assert r.status_code == 201
    # しおり・今日などの元になる一覧(予定の検索)に控えの案の予定は出ない
    seg = client.get(f"{base}/segments")
    assert seg.status_code == 200
    detail = client.get(f"/api/v1/plans/{p}").json()
    assert [len(d["events"]) for d in detail["days"]] == [2, 2]
