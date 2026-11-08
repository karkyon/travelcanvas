"""[Gate CandidateFilters] 候補のタグ(付ける・置き換える・形の検査・まとめる時に引き継ぐ)"""
from app.services import candidates as cs


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "鳥羽"}).json()["id"]
    return f"/api/v1/plans/{p}/candidates"


def test_tags_create_update_validate_and_merge(auth_client):
    client, _owner = auth_client
    url = _plan(client)
    a = client.post(url, json={"title": "鳥羽城", "tags": ["#城", "雨でもOK", "城", " "]}).json()
    item = next(i for i in a["items"] if i["id"] == a["id"])
    assert item["tags"] == ["城", "雨でもOK"]
    r = client.patch(f"{url}/{item['id']}", json={"tags": ["朝", "絶景"]}, headers={"If-Match": str(item["revision"])})
    assert r.status_code == 200, r.text
    item = next(i for i in r.json()["items"] if i["id"] == a["id"])
    assert item["tags"] == ["朝", "絶景"]
    for bad in (["x" * 21], [f"t{i}" for i in range(11)], ["改\n行"]):
        assert client.patch(f"{url}/{item['id']}", json={"tags": bad},
                            headers={"If-Match": str(item["revision"])}).status_code == 422
    b = client.post(url, json={"title": "鳥羽城跡", "tags": ["城", "朝"]}).json()
    merged = client.post(f"{url}/{b['id']}/merge", json={"into_id": a["id"]},
                         headers={"If-Match": "1"})
    assert merged.status_code == 200, merged.text
    target = next(i for i in merged.json()["items"] if i["id"] == a["id"])
    assert target["tags"] == ["朝", "絶景", "城"]
    assert cs.clean_tags(None) is None and cs.clean_tags([]) is None
