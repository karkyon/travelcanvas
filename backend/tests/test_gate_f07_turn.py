"""[Gate F07] 旅行相談の会話の1ターン(追加・訂正・削除・取消・矛盾・複数の予算)。

- AI へ送るのは最新の発言と今の条件の状態だけ(以前の発言の全文を送り直さない・黙って切らない)
- AI の操作は、根拠が最新の発言にある・対象の ID が状態にある・型と範囲が正しい時だけ変更案にする
- 確かめた行への変更は needs_confirmation(画面は採用するまで変えない)。未言及の項目は変えない
- 同じ項目に食い違う値を同じターンで出したら食い違いにする(片方に決めない)。両立する希望は食い違いにしない
- 予算は複数(額・全員か1人あたりか・何人分か・対象・期間・上限か目安か)。人数の変更で予算を計算し直さない
- 1ターン = AI の 1回の要求(同じ相談の回数・50円の枠)。発言・状態・答えはログ・監査に残さない
外への通信は httpx.MockTransport。AI の答えは試験が決める(実の AI の品質は omega-dev2 の UAT で確かめる)。
"""
import json
import logging
import uuid

import pytest

from app.models.models import ProviderUsageReservation, UsageBudgetAccount
from app.services import consult_turn as ct
from tests.test_gate_consult_ai import _ai_body, _session, _tier, admin, net  # noqa: F401  (fixture)
from tests.test_gate_providerconnect import _ready  # noqa: F401

BLANK = {"field": None, "text_value": None, "number_value": None, "bool_value": None, "target_id": None,
         "preference": None, "budget": None}


def op(kind, evidence, **kw):
    return {**BLANK, "op": kind, "evidence": evidence, **kw}


def budget(lo, hi, unit="undecided", people=None, target="undecided", period="undecided", kind="undecided"):
    return {"min_yen": lo, "max_yen": hi, "unit": unit, "people": people, "target": target, "period": period,
            "kind": kind}


def ai(*ops, conflicts=(), questions=()):
    return {"operations": list(ops), "conflicts": list(conflicts), "questions": list(questions)}


def apply(state, result, accept_all=True):
    """画面の適用(試験用): 変更案を全て採用した状態。確かめた行も採用する(利用者が採用を押した扱い)。"""
    st = json.loads(json.dumps(state))
    st.setdefault("fields", {})
    st.setdefault("budgets", [])
    st.setdefault("notes", [])
    st.setdefault("areas", [])
    st.setdefault("preferences", [])
    for c in result["changes"]:
        if c["needs_confirmation"] and not accept_all:
            continue
        k = c["op"]
        if k in ("set", "clear"):
            st["fields"][c["field"]] = {"value": c["after"], "confirmed": True}
        elif k == "add_preference":
            st["preferences"].append(c["preference"])
        elif k == "remove_preference":
            st["preferences"].remove(c["preference"])
        elif k == "add_note":
            st["notes"].append({"id": f"n{len(st['notes']) + 1}", "text": c["after"], "confirmed": True})
        elif k == "remove_note":
            st["notes"] = [n for n in st["notes"] if n["id"] != c["target_id"]]
        elif k == "add_budget":
            st["budgets"].append({"id": c["target_id"], "confirmed": True, **c["after"]})
        elif k == "update_budget":
            st["budgets"] = [{**b, **c["after"]} if b["id"] == c["target_id"] else b for b in st["budgets"]]
        elif k == "remove_budget":
            st["budgets"] = [b for b in st["budgets"] if b["id"] != c["target_id"]]
        elif k == "area_candidate":
            st["areas"].append({"name": c["area"], "status": "candidate"})
        elif k == "area_decide":
            st["areas"] = [a for a in st["areas"] if a["name"] != c["area"]]
            st["areas"].append({"name": c["area"], "status": "decided"})
        elif k == "area_remove":
            st["areas"] = [a for a in st["areas"] if a["name"] != c["area"]]
    st["revision"] = result.get("revision", state.get("revision", 0) + 1)
    return ct.clean_state(st)


# ===================================================================== 10 ターンの受入の場面(サーバーの検証)

def test_ten_turn_scenario_state_is_kept_corrected_and_conflicts_are_not_resolved():
    st = ct.clean_state({})
    # 1
    t1 = "家族4人。枚方から車で1泊2日。高速で片道3時間以内。人が多すぎない所で景色と地元の食べ物。まだ行き先は未定"
    r = ct.changes_of(ai(op("set", "家族4人", field="party_size", number_value=4),
                         op("set", "枚方から", field="origin", text_value="枚方"),
                         op("set", "車で", field="transport", text_value="car"),
                         op("set", "高速で", field="highway", bool_value=True),
                         op("set", "1泊2日", field="nights", number_value=1),
                         op("set", "片道3時間以内", field="one_way_hours", number_value=3),
                         op("add_preference", "人が多すぎない", preference="quiet"),
                         op("add_preference", "景色", preference="scenery"),
                         op("add_preference", "地元の食べ物", preference="food"),
                         op("area_decide", "行き先は未定", text_value="伊勢")), st, t1)
    assert {c["op"] for c in r["changes"]} >= {"set", "add_preference"}
    assert not any(c["op"] == "area_decide" for c in r["changes"]), "発言に無い方面を決めない"
    st = apply(st, r)
    assert st["fields"]["party_size"]["value"] == 4 and st["fields"]["nights"]["value"] == 1
    assert st["areas"] == []
    # 2
    t2 = "宿泊は4人一部屋。宿代は4人合わせて6〜8万円くらい"
    r = ct.changes_of(ai(op("set", "4人一部屋", field="room", text_value="same_room"),
                         op("add_budget", "宿代は4人合わせて6〜8万円くらい",
                            budget=budget(60000, 80000, "total", 4, "lodging", "undecided", "guide"))), st, t2)
    st = apply(st, r)
    assert st["budgets"][0]["target"] == "lodging" and st["budgets"][0]["unit"] == "total"
    assert st["budgets"][0]["people"] == 4 and st["budgets"][0]["kind"] == "guide"
    lodging_id = st["budgets"][0]["id"]
    # 3
    t3 = "市場も寄りたい。激しい運動はしない"
    r = ct.changes_of(ai(op("add_note", "市場も寄りたい", text_value="市場に寄りたい"),
                         op("add_note", "激しい運動はしない", text_value="激しい運動はしない")), st, t3)
    st = apply(st, r)
    assert [n["text"] for n in st["notes"]] == ["市場に寄りたい", "激しい運動はしない"]
    market_id = st["notes"][0]["id"]
    # 4: 人数の訂正は確かめた行への変更案。予算は計算し直さない
    t4 = "やっぱり人数は3人に変更。部屋は同じ一部屋"
    r = ct.changes_of(ai(op("set", "人数は3人に変更", field="party_size", number_value=3),
                         op("set", "部屋は同じ一部屋", field="room", text_value="same_room")), st, t4)
    assert [(c["field"], c["before"], c["after"], c["needs_confirmation"]) for c in r["changes"]] == \
        [("party_size", 4, 3, True)], "変わらない部屋は変更にしない"
    st = apply(st, r)
    assert st["budgets"][0]["people"] == 4 and st["budgets"][0]["max_yen"] == 80000
    # 5: 宿の上限と旅行全体の上限は別の予算
    t5 = "8万円は宿だけの上限。旅行全体は12万円まで"
    r = ct.changes_of(ai(op("update_budget", "8万円は宿だけの上限", target_id=lodging_id,
                            budget=budget(None, 80000, "undecided", None, "lodging", "undecided", "cap")),
                         op("add_budget", "旅行全体は12万円まで",
                            budget=budget(None, 120000, "total", None, "trip_total", "whole_trip", "cap"))), st, t5)
    st = apply(st, r)
    assert len(st["budgets"]) == 2
    lodging = next(b for b in st["budgets"] if b["id"] == lodging_id)
    assert (lodging["kind"], lodging["min_yen"], lodging["max_yen"], lodging["people"]) == ("cap", 60000, 80000, 4)
    total = next(b for b in st["budgets"] if b["id"] != lodging_id)
    assert (total["target"], total["max_yen"], total["kind"]) == ("trip_total", 120000, "cap")
    # 6: 候補の方面だけ。決めない
    t6 = "伊勢か滋賀が気になる。まだ決めない"
    r = ct.changes_of(ai(op("area_candidate", "伊勢か滋賀", text_value="伊勢"),
                         op("area_candidate", "伊勢か滋賀", text_value="滋賀")), st, t6)
    st = apply(st, r)
    assert st["areas"] == [{"name": "伊勢", "status": "candidate"}, {"name": "滋賀", "status": "candidate"}]
    # 7: 市場の削除・静かさ。次のターンで市場は戻らない
    t7 = "市場はもう行かなくていい。静かな所を優先"
    r = ct.changes_of(ai(op("remove_note", "市場はもう行かなくていい", target_id=market_id),
                         op("add_preference", "静かな所を優先", preference="quiet")), st, t7)
    assert [c["op"] for c in r["changes"]] == ["remove_note"], "既にある希望は足さない"
    st = apply(st, r)
    assert [n["text"] for n in st["notes"]] == ["激しい運動はしない"]
    # 8: 食い違いは決めない(同じターンで日帰りと1泊)
    t8 = "日帰りにしたい。でも必ず一泊したい"
    r = ct.changes_of(ai(op("set", "日帰りにしたい", field="nights", number_value=0),
                         op("set", "必ず一泊したい", field="nights", number_value=1)), st, t8)
    assert r["changes"] == [] and r["conflicts"][0]["about"] == "nights"
    assert "日帰りにしたい" in r["conflicts"][0]["question"]
    st = apply(st, r)
    assert st["fields"]["nights"]["value"] == 1
    # 9: 取消・1泊2日・伊勢に決める(滋賀は決めない)
    t9 = "日帰りは取り消し。1泊2日でお願い。伊勢に決める"
    r = ct.changes_of(ai(op("set", "1泊2日でお願い", field="nights", number_value=1),
                         op("area_decide", "伊勢に決める", text_value="伊勢")), st, t9)
    st = apply(st, r)
    assert {a["name"]: a["status"] for a in st["areas"]} == {"伊勢": "decided", "滋賀": "candidate"}
    # 10: 希望を足す。今までの条件は残る
    t10 = "温泉はできれば。景色を見る時間を長めに取りたい。食事は宿でも外でもいい"
    r = ct.changes_of(ai(op("add_preference", "温泉はできれば", preference="onsen"),
                         op("add_note", "景色を見る時間を長めに取りたい", text_value="景色を見る時間を長めに"),
                         op("add_preference", "食事は宿でも外でもいい", preference="flexible_meals"),
                         op("clear", "温泉はできれば", field="party_size")), st, t10)
    # 言及していない人数を消す誤った操作は、確かめた行への変更案(採用するまで変えない)。利用者は採用しない
    wrong = [c for c in r["changes"] if c["op"] == "clear"]
    assert wrong and all(c["needs_confirmation"] for c in wrong)
    st = apply(st, r, accept_all=False)
    assert st["fields"]["party_size"]["value"] == 3 and st["fields"]["origin"]["value"] == "枚方"
    assert set(st["preferences"]) >= {"quiet", "scenery", "food", "onsen", "flexible_meals"}
    assert len(st["budgets"]) == 2 and st["revision"] == 10


def test_operations_without_evidence_or_target_are_dropped():
    st = ct.clean_state({"fields": {"party_size": {"value": 4, "confirmed": True}},
                         "budgets": [{"id": "b1", "min_yen": 60000, "max_yen": 80000, "confirmed": True}],
                         "notes": [{"id": "n1", "text": "市場", "confirmed": False}]})
    r = ct.changes_of(ai(op("set", "5人で", field="party_size", number_value=5),          # 発言に無い根拠
                         op("remove_budget", "予算はなし", target_id="bX"),                 # 無い ID
                         op("set", "人数", field="party_size", number_value=99),           # 範囲の外
                         op("remove_note", "市場はやめ", target_id="n1"),
                         op("set", "人数", field="unknown_field", number_value=3)), st, "人数の話。予算はなし。市場はやめ")
    assert [c["op"] for c in r["changes"]] == ["remove_note"] and r["dropped"] == 4


def test_compatible_wishes_are_not_conflicts_and_unmentioned_fields_stay():
    st = ct.clean_state({"fields": {"nights": {"value": 1, "confirmed": True}}, "preferences": []})
    r = ct.changes_of(ai(op("add_preference", "静かな所", preference="quiet"),
                         op("add_note", "市場も", text_value="市場")), st, "静かな所がいいけど市場も見たい")
    assert r["conflicts"] == [] and len(r["changes"]) == 2
    assert all(c.get("field") != "nights" for c in r["changes"])


def test_state_sent_to_ai_has_no_previous_utterances_or_evidence():
    st = ct.clean_state({"fields": {"party_size": {"value": 4, "confirmed": True, "evidence": "家族4人"}},
                         "notes": [{"id": "n1", "text": "市場", "confirmed": True}], "history": ["前の発言の全文"]})
    prompt = ct.prompt_of(st, "やっぱり3人")
    assert "前の発言の全文" not in prompt and "家族4人" not in prompt and "evidence" not in prompt
    assert prompt.endswith("【最新の発言】\nやっぱり3人")


# ===================================================================== API(送る・数える・残さない)

def _turn(client, sid, utterance, state=None, key=None):
    payload = {"session_id": sid, "utterance": utterance, "state": state or {}}
    return client.post("/api/v1/trip-intents/ai/turn", json=payload,
                       headers={"Idempotency-Key": key or uuid.uuid4().hex})


def test_api_turn_sends_latest_utterance_counts_one_call_and_logs_no_text(admin, db_session, net, caplog):  # noqa: F811
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user, "journey")
    sid = _session(client)
    net.set("api.openai.com", 200, _ai_body(ai(op("set", "3人に変更", field="party_size", number_value=3))))
    caplog.set_level(logging.INFO)
    before = len(net.requests)
    state = {"revision": 3, "fields": {"party_size": {"value": 4, "confirmed": True}}}
    r = _turn(client, sid, "やっぱり3人に変更。秘密の理由XYZ", state)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["changes"][0]["needs_confirmation"] is True and body["revision"] == 4 and body["saved"] is False
    sent = json.loads(net.requests[-1].content)
    assert len(net.requests) == before + 1
    assert "やっぱり3人に変更" in sent["input"] and sent["text"]["format"]["name"] == "trip_turn"
    assert sent["text"]["format"]["strict"] is True and sent["store"] is False
    acc = db_session.query(UsageBudgetAccount).filter_by(scope_type="consult").one()
    assert acc.counts.get("ai_calls_per_plan") == 1
    assert "秘密の理由XYZ" not in caplog.text
    # 同じ鍵の再送は二度送らない
    key = uuid.uuid4().hex
    assert _turn(client, sid, "温泉も", state, key).status_code == 200
    n = len(net.requests)
    assert _turn(client, sid, "温泉も", state, key).status_code == 409
    assert len(net.requests) == n
    # 長すぎる発言は送らない(黙って切らない)
    r = _turn(client, sid, "あ" * (ct.MAX_UTTERANCE_CHARS + 1), state)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "input_too_long" and len(net.requests) == n
    assert db_session.query(ProviderUsageReservation).filter_by(status="reserved").count() == 0


def test_api_turn_requires_consent_and_class(admin, db_session, net):  # noqa: F811
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user, "journey", consent=False)
    sid = _session(client)
    before = sum(1 for req in net.requests if req.url.host == "api.openai.com")
    r = _turn(client, sid, "3人に変更")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "consent_required"
    assert sum(1 for req in net.requests if req.url.host == "api.openai.com") == before


def test_stub_turn_answer_reports_conflict():
    from app.services import provider_stub as st

    out = st._turn_answer("【今の条件】\n{}\n\n【最新の発言】\n日帰りにしたい。でも必ず一泊したい")
    assert not any(o["field"] == "nights" for o in out["operations"]) and out["conflicts"][0]["about"] == "nights"
    out = st._turn_answer("【今の条件】\n{}\n\n【最新の発言】\n家族3人で行きます")
    assert any(o["field"] == "party_size" and o["number_value"] == 3 for o in out["operations"])


@pytest.mark.parametrize("raw", [None, [], {"fields": "x"}, {"budgets": [{"id": 3}], "revision": -1}])
def test_clean_state_tolerates_bad_shapes(raw):
    st = ct.clean_state(raw)
    assert st["revision"] == 0 and st["budgets"] == [] and st["fields"] == {}


def test_draft_keeps_multiple_budgets(auth_client, db_session):
    from app.models.models import TravelPlan

    client, _user = auth_client
    budgets = [{"min_yen": 60000, "max_yen": 80000, "unit": "total", "people": 4, "target": "lodging",
                "period": "undecided", "kind": "cap"},
               {"min_yen": None, "max_yen": 120000, "unit": "total", "people": None, "target": "trip_total",
                "period": "whole_trip", "kind": "cap"}]
    body = {"area": {"name": "伊勢"}, "intent": {"nights": 1, "budgets": budgets}}
    r = client.post("/api/v1/trip-intents/draft", json=body)
    assert r.status_code == 201, r.text
    plan = db_session.get(TravelPlan, uuid.UUID(r.json()["plan_id"]))
    kept = next(v for v in plan.preferences.values() if isinstance(v, dict) and "intent" in v)["intent"]["budgets"]
    assert [b["target"] for b in kept] == ["lodging", "trip_total"] and kept[0]["people"] == 4
    bad = client.post("/api/v1/trip-intents/draft", json={"area": {"name": "伊勢"}, "intent": {"nights": 1, "budgets": [
        {"min_yen": 90000, "max_yen": 80000}]}})
    assert bad.status_code == 422
    empty = client.post("/api/v1/trip-intents/draft", json={"area": {"name": "伊勢"}, "intent": {"nights": 1, "budgets": [
        {"unit": "total"}]}})
    assert empty.status_code == 422
