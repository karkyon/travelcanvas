"""[Gate SpotLinks] 予定(スポット)の URL(最大 5 件)と、地図の位置の変更。

- 作成・変更・空で消す・元に戻す。http/https 以外・6 件以上・長すぎる URL は 422。同じ URL は 1 件にまとめる
- 住所を見せない設定では、電話・位置と一緒に URL も隠す(書き込みも断る)
- 旅行の複製で電話と URL も写す
"""
import uuid

import pytest

from app.services import event_urls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "白浜"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()  # noqa: E501
    return p, base, d1


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _events(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["days"][0]["events"]


def test_clean_url_rules():
    assert event_urls.clean_url(" https://example.com/a ") == "https://example.com/a"
    for bad in ("javascript:alert(1)", "ftp://example.com", "example.com", "https://", "https://a b.com"):
        with pytest.raises(ValueError):
            event_urls.clean_url(bad)
    assert event_urls.to_json([]) is None
    assert event_urls.to_json([{"url": "https://a.example", "label": " 公式 "}, {"url": "https://a.example"}]) == [
        {"url": "https://a.example", "label": "公式"}]
    assert event_urls.from_website("not a url") is None


def test_event_urls_create_update_clear_undo_and_limits(auth_client):
    client, _owner = auth_client
    p, base, d1 = _plan(client)
    body = {"day_id": d1["id"], "title": "アドベンチャーワールド", "event_type": "sightseeing",
            "urls": [{"url": "https://www.aws-s.com/"}, {"url": "https://www.aws-s.com/"}, {"url": "https://x.example/t", "label": "SNS"}]}  # noqa: E501
    r = client.post(f"{base}/events", json=body, headers=_ik())
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["urls"] == [{"url": "https://www.aws-s.com/", "label": None}, {"url": "https://x.example/t", "label": "SNS"}]  # noqa: E501
    rev = _rev(client, p)
    r = client.put(f"{base}/events/{e['id']}", json={"urls": [{"url": "https://new.example/"}], "latitude": 33.66, "longitude": 135.36},  # noqa: E501
                   headers={"If-Match": str(rev)})
    assert r.status_code == 200 and r.json()["urls"] == [{"url": "https://new.example/", "label": None}]
    assert r.json()["latitude"] == 33.66
    r = client.put(f"{base}/events/{e['id']}", json={"urls": []}, headers={"If-Match": str(rev + 1)})
    assert r.status_code == 200 and r.json()["urls"] is None
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 2)}).status_code == 200
    assert _events(client, p)[0]["urls"] == [{"url": "https://new.example/", "label": None}]
    rev = _rev(client, p)
    six = [{"url": f"https://e{i}.example/"} for i in range(6)]
    assert client.put(f"{base}/events/{e['id']}", json={"urls": six}, headers={"If-Match": str(rev)}).status_code == 422
    bad = client.put(f"{base}/events/{e['id']}", json={"urls": [{"url": "javascript:alert(1)"}]}, headers={"If-Match": str(rev)})  # noqa: E501
    assert bad.status_code == 422
    long = client.put(f"{base}/events/{e['id']}", json={"urls": [{"url": "https://a.example/" + "x" * 2000}]},
                      headers={"If-Match": str(rev)})
    assert long.status_code == 422


def test_urls_are_hidden_with_address_for_members():
    from app.services import member_policy as mp

    out = mp.mask_event_dict({"urls": [{"url": "https://a.example"}], "phone": "1", "title": "x"}, frozenset({"event_address"}))  # noqa: E501
    assert out["urls"] is None and out["phone"] is None and out["title"] == "x"
    assert mp.forbidden_write_fields(frozenset({"event_address"}), ["urls"]) == ["urls"]


def test_plan_copy_keeps_phone_and_urls(auth_client):
    client, _owner = auth_client
    p, base, d1 = _plan(client)
    r = client.post(f"{base}/events", json={"day_id": d1["id"], "title": "とれとれ市場", "phone": "0739-42-1010",
                                            "urls": [{"url": "https://toretore.example/"}]}, headers=_ik())
    assert r.status_code == 201, r.text
    dup = client.post(f"/api/v1/travel-plans/{p}/clone", json={})
    assert dup.status_code == 201, dup.text
    events = _events(client, dup.json()["id"])
    assert events[0]["phone"] == "0739-42-1010"
    assert events[0]["urls"] == [{"url": "https://toretore.example/", "label": None}]
