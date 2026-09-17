"""
[Gate M8] P1-03是正: RouteOption/RouteLegのUndo対応テスト。

2026-09-13監査で、`undo_last_change`が`route_option`/`route_leg`
entity_typeを一切処理しない(該当するif分岐自体が存在しない)ため、
adopt採用のUndoでtravel_segmentのみ戻りRouteOption.statusが
'adopted'のまま残る「部分Undo」が起きることが指摘された。本ファイルは
その是正を検証する。
"""
import uuid


PLAN_ENDPOINT = "/api/v1/plans/{plan_id}"
OPTIONS_ENDPOINT = PLAN_ENDPOINT + "/route-options"
UNDO_ENDPOINT = "/api/v1/plans/{plan_id}/undo"


def _create_plan(client, title="Gate M8テスト旅行"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_day(client, plan_id, local_date="2026-12-01"):
    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": local_date})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_event(client, plan_id, day_id, title="イベント", **extra):
    body = {"day_id": day_id, "title": title}
    body.update(extra)
    res = client.post(f"/api/v1/plans/{plan_id}/events", json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _plan_revision(client, plan_id):
    return client.get(PLAN_ENDPOINT.format(plan_id=plan_id)).json()["revision"]


def _post_option(client, plan_id, body, key=None):
    headers = {"Idempotency-Key": key or uuid.uuid4().hex}
    return client.post(OPTIONS_ENDPOINT.format(plan_id=plan_id), json=body, headers=headers)


def _undo(client, plan_id):
    rev = _plan_revision(client, plan_id)
    return client.post(UNDO_ENDPOINT.format(plan_id=plan_id), headers={"If-Match": str(rev)})


def _setup_option_with_legs(client, plan_id):
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "出発")
    e2 = _create_event(client, plan_id, day_id, "到着")
    body = {
        "from_event_id": e1, "to_event_id": e2,
        "legs": [
            {"mode": "walking", "from_label": "A", "to_label": "B"},
            {"mode": "train", "from_label": "B", "to_label": "C"},
        ],
    }
    res = _post_option(client, plan_id, body)
    assert res.status_code == 201, res.text
    return res.json()


# ===== adoptのUndo(部分Undo是正の本丸) =====

def test_undo_after_adopt_reverts_both_segment_and_option_status(auth_client):
    """[Gate M8] adopt後のUndoで、TravelSegmentの取り消しだけでなく
    RouteOption.statusも'adopted'から元(candidate)へ戻ること。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    option = _setup_option_with_legs(client, plan_id)

    rev = _plan_revision(client, plan_id)
    adopt_res = client.post(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/adopt",
        headers={"If-Match": str(rev)},
    )
    assert adopt_res.status_code == 200, adopt_res.text
    segment_id = adopt_res.json()["segment_id"]
    assert adopt_res.json()["route_option"]["status"] == "adopted"

    undo_res = _undo(client, plan_id)
    assert undo_res.status_code == 200, undo_res.text

    option_after = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}").json()
    assert option_after["status"] == "candidate"

    segment_after = client.get(f"/api/v1/plans/{plan_id}/segments/{segment_id}")
    assert segment_after.status_code == 404


# ===== route_option create/delete の cascade legs Undo =====

def test_undo_after_option_create_removes_option_and_legs(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    option = _setup_option_with_legs(client, plan_id)

    undo_res = _undo(client, plan_id)
    assert undo_res.status_code == 200, undo_res.text

    get_res = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}")
    assert get_res.status_code == 404


def test_undo_after_option_delete_restores_option_and_legs(auth_client):
    """[Gate M8] delete_route_optionのUndoで、経路候補本体だけでなく
    子RouteLeg(以前は_legsとして記録されていなかったため復元不能だった)
    も元通り復元されること。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    option = _setup_option_with_legs(client, plan_id)
    original_legs = option["legs"]
    assert len(original_legs) == 2

    rev = _plan_revision(client, plan_id)
    del_res = client.delete(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}",
        headers={"If-Match": str(rev)},
    )
    assert del_res.status_code == 200, del_res.text
    assert client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}").status_code == 404

    undo_res = _undo(client, plan_id)
    assert undo_res.status_code == 200, undo_res.text

    restored = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}")
    assert restored.status_code == 200, restored.text
    restored_legs = restored.json()["legs"]
    assert len(restored_legs) == 2
    assert {leg["mode"] for leg in restored_legs} == {"walking", "train"}
    assert {leg["from_label"] for leg in restored_legs} == {"A", "B"}


# ===== 単独のroute_leg操作のUndo =====

def test_undo_after_add_route_leg_removes_leg(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    option = _setup_option_with_legs(client, plan_id)

    rev = _plan_revision(client, plan_id)
    add_res = client.post(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/legs",
        json={"mode": "bus", "from_label": "C", "to_label": "D"},
        headers={"If-Match": str(rev)},
    )
    assert add_res.status_code == 201, add_res.text
    new_leg_id = add_res.json()["id"]

    undo_res = _undo(client, plan_id)
    assert undo_res.status_code == 200, undo_res.text

    option_after = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}").json()
    leg_ids_after = {leg["id"] for leg in option_after["legs"]}
    assert new_leg_id not in leg_ids_after
    assert len(option_after["legs"]) == 2


def test_undo_after_delete_route_leg_restores_leg(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    option = _setup_option_with_legs(client, plan_id)
    leg_to_delete = option["legs"][0]

    rev = _plan_revision(client, plan_id)
    del_res = client.delete(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/legs/{leg_to_delete['id']}",
        headers={"If-Match": str(rev)},
    )
    assert del_res.status_code == 200, del_res.text

    undo_res = _undo(client, plan_id)
    assert undo_res.status_code == 200, undo_res.text

    option_after = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}").json()
    leg_ids_after = {leg["id"] for leg in option_after["legs"]}
    assert leg_to_delete["id"] in leg_ids_after
    assert len(option_after["legs"]) == 2


def test_undo_after_update_route_leg_restores_previous_fields(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    option = _setup_option_with_legs(client, plan_id)
    leg = option["legs"][0]
    assert leg["mode"] == "walking"

    rev = _plan_revision(client, plan_id)
    patch_res = client.patch(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/legs/{leg['id']}",
        json={"mode": "taxi"},
        headers={"If-Match": str(rev)},
    )
    assert patch_res.status_code == 200, patch_res.text

    undo_res = _undo(client, plan_id)
    assert undo_res.status_code == 200, undo_res.text

    option_after = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}").json()
    restored_leg = next(item for item in option_after["legs"] if item["id"] == leg["id"])
    assert restored_leg["mode"] == "walking"


def test_undo_after_option_update_restores_previous_status(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    option = _setup_option_with_legs(client, plan_id)
    assert option["status"] == "candidate"

    rev = _plan_revision(client, plan_id)
    patch_res = client.patch(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}",
        json={"status": "discarded"},
        headers={"If-Match": str(rev)},
    )
    assert patch_res.status_code == 200, patch_res.text

    undo_res = _undo(client, plan_id)
    assert undo_res.status_code == 200, undo_res.text

    option_after = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}").json()
    assert option_after["status"] == "candidate"
