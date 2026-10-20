"""
[Gate C3] FR-009 情報内検索・コマンドパレットの試験(実PostgreSQL)。

検証する主な性質:
- 予定・日程(今日/明日/M/D)・場所・候補・予約・チケット・文書・費用・メンバー・記録を横断し、カテゴリごとに返す
- 固定の絞り込み(今日・予約・チケット・ホテル・緊急)
- 予約番号の末尾(4文字)は「予約」に絞った時だけ当て、結果は伏せた番号だけ(平文・PIN・名義を出さない)
- 権限の無いものは結果にも件数にも出さない: 他の人の機密の文書・他の人の非公開の記録・参加していない旅行
- 参加している全ての旅行を横断する(コマンドパレット)。検索語は監査・ログに残さない。回数制限
"""
import io
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.api.v1 import plan_search as search_api
from app.core.auth import AuthResult, get_current_user
from app.core.crypto import encrypt_payload
from app.main import app
from app.models.models import Document, Memory, PlanCollaborator
from app.services import plan_search as ps

PDF = b"%PDF-1.4\n" + b"0" * 64


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _tokyo_today():
    return datetime.now(ZoneInfo("Asia/Tokyo")).date()


# ---------------------------------------------------------------- 純粋関数


def test_score_and_date_words():
    t = ps.tokens("  清水 ＴＥＲＡ ")
    assert t == ["清水", "tera"]
    assert ps.score(["清水寺"], "清水寺") == 100
    assert ps.score(["清水"], "清水寺") == 80
    assert ps.score(["寺"], "清水寺") == 60
    assert ps.score(["東山"], "清水寺", ["京都市東山区"]) == 40
    assert ps.score(["清水", "大阪"], "清水寺") == 0
    today = datetime(2026, 11, 1).date()
    assert ps.parse_date_word("明日", today) == datetime(2026, 11, 2).date()
    assert ps.parse_date_word("11/3", today, [2026]) == datetime(2026, 11, 3).date()
    assert ps.parse_date_word("2026-11-04", today) == datetime(2026, 11, 4).date()
    assert ps.parse_date_word("11月5日", today) == datetime(2026, 11, 5).date()
    assert ps.parse_date_word("2/30", today) is None and ps.parse_date_word("清水", today) is None
    assert ps.is_suffix_query("5678") and ps.is_suffix_query("AB12") and not ps.is_suffix_query("56789")


# ---------------------------------------------------------------- API


def _setup(client, owner, db_session, make_user):
    p = client.post("/api/v1/travel-plans/", json={"title": "京都の旅"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    today = _tokyo_today()
    d1 = client.post(f"{base}/days", json={"local_date": today.isoformat(), "timezone_id": "Asia/Tokyo",
                                           "title": "東山"}, headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": (today + timedelta(days=1)).isoformat(),
                                           "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()
    ev = {}
    for name, day, kind, addr in (("清水寺", d1, "sightseeing", "京都市東山区"), ("祇園の宿", d1, "accommodation", None),
                                  ("嵐山", d2, "sightseeing", None), ("京都第一病院", d2, "other", None)):
        r = client.post(f"{base}/events", json={"day_id": day["id"], "title": name, "event_type": kind,
                                                "address": addr, "local_start_time": "10:00"}, headers=_ik())
        assert r.status_code in (200, 201), r.text
        ev[name] = r.json()["id"]
    res = client.post(f"{base}/reservations", json={
        "type": "accommodation", "provider_name": "祇園の宿 本館", "confirmation_number": "QZ-7781-5678",
        "pin": "9911", "holder_name": "山田太郎"})
    assert res.status_code == 201, res.text
    rid = res.json()["id"]
    assert client.post(f"{base}/reservations/{rid}/tickets", json={"ticket_type": "entry", "payload": "QRDATA"}
                       ).status_code == 201
    client.post(f"{base}/candidates", json={"title": "伏見稲荷大社", "note": "朝早く"})
    member, _ = make_user(username=f"hanako{uuid.uuid4().hex[:6]}")
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=member.id, email=member.email, role="viewer",
                                    status="accepted"))
    for owner_id, cls, name in ((owner.id, "restricted", "旅券の写し.pdf"), (owner.id, "internal", "海外旅行保険.pdf"),
                                (member.id, "restricted", "花子の秘密.pdf")):
        db_session.add(Document(plan_id=uuid.UUID(p), owner_user_id=owner_id, classification=cls,
                                document_type="insurance" if "保険" in name else "passport",
                                original_filename_ciphertext=encrypt_payload(name.encode("utf-8")),
                                storage_key=f"docs/{uuid.uuid4().hex}", mime_type="application/pdf", size=10,
                                sha256="0" * 64))
    db_session.add(Memory(plan_id=uuid.UUID(p), author_user_id=member.id, kind="note", body="清水の舞台で花子のひみつ",
                          visibility="private"))
    db_session.add(Memory(plan_id=uuid.UUID(p), author_user_id=member.id, kind="note", body="清水の坂でみんなで団子",
                          visibility="members"))
    db_session.commit()
    return p, base, ev, member


def _cat(body, cat):
    return next((c for c in body["categories"] if c["category"] == cat), None)


def test_plan_search(auth_client, make_user, db_session, monkeypatch):
    client, owner = auth_client
    p, base, ev, member = _setup(client, owner, db_session, make_user)
    url = f"{base}/search"

    r = client.get(url, params={"q": "清水"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [h["title"] for h in _cat(body, "event")["results"]] == ["清水寺"]
    assert _cat(body, "event")["results"][0]["when"].endswith(" 10:00")
    assert _cat(body, "memory")["count"] == 1  # 他の人の非公開の記録は出さない(メンバーに公開された分だけ)
    assert "ひみつ" not in r.text
    # 住所でも当たる
    assert [h["title"] for h in _cat(client.get(url, params={"q": "東山区"}).json(), "event")["results"]] == ["清水寺"]
    # 日付の語(明日)・M/D
    tomorrow = (_tokyo_today() + timedelta(days=1))
    for q in ("明日", f"{tomorrow.month}/{tomorrow.day}"):
        b = client.get(url, params={"q": q}).json()
        assert {h["title"] for h in _cat(b, "event")["results"]} == {"嵐山", "京都第一病院"}, q
    # 今日の絞り込み
    today = client.get(url, params={"filter": "today"}).json()
    assert {h["title"] for h in _cat(today, "event")["results"]} == {"清水寺", "祇園の宿"}
    assert _cat(today, "day")["count"] == 1 and today["filter_label"] == "今日"
    # ホテル: 宿泊の予定と予約
    hotel = client.get(url, params={"filter": "hotel"}).json()
    assert [h["title"] for h in _cat(hotel, "event")["results"]] == ["祇園の宿"]
    assert [h["title"] for h in _cat(hotel, "reservation")["results"]] == ["祇園の宿 本館"]
    assert _cat(hotel, "memory") is None and _cat(hotel, "document") is None
    # 予約番号の末尾: 「予約」に絞った時だけ。結果は伏せた番号だけ
    plain = client.get(url, params={"q": "5678"}).json()
    assert _cat(plain, "reservation") is None
    rs = client.get(url, params={"q": "5678", "filter": "reservation"})
    hit = _cat(rs.json(), "reservation")["results"][0]
    assert hit["badge"] == "予約番号の末尾に一致" and "5678" in hit["subtitle"] and "7781" not in rs.text
    assert "9911" not in rs.text and "山田" not in rs.text and "QZ" not in rs.text
    assert _cat(client.get(url, params={"q": "1234", "filter": "reservation"}).json(), "reservation") is None
    # チケット(中身は出さない)
    tk = client.get(url, params={"filter": "ticket"})
    assert _cat(tk.json(), "ticket")["results"][0]["title"] == "祇園の宿 本館のチケット" and "QRDATA" not in tk.text
    # 緊急: 保険の文書・病院の予定
    em = client.get(url, params={"filter": "emergency"}).json()
    assert {h["title"] for h in _cat(em, "document")["results"]} == {"旅券の写し.pdf", "海外旅行保険.pdf"}
    assert [h["title"] for h in _cat(em, "event")["results"]] == ["京都第一病院"]
    # 候補・メンバー
    assert _cat(client.get(url, params={"q": "稲荷"}).json(), "candidate")["count"] == 1
    assert _cat(client.get(url, params={"q": member.username[:6]}).json(), "member")["results"][0]["subtitle"] == "メンバー"
    # 他の人の機密の文書は、名前でも件数でも出さない
    secret = client.get(url, params={"q": "花子の秘密"})
    assert _cat(secret.json(), "document") is None and secret.json()["total"] == 0
    # 入力の検査
    assert client.get(url, params={"q": ""}).status_code == 422
    assert client.get(url, params={"q": "x", "filter": "secret"}).status_code == 422
    assert client.get(url, params={"q": "あ" * 101}).status_code == 422

    # メンバー(viewer)からは: 自分の機密の文書・自分の非公開の記録は見え、所有者の機密の文書は見えない
    stranger, _ = make_user()
    try:
        _act_as(member)
        mb = client.get(url, params={"q": "花子"}).json()
        assert _cat(mb, "document")["results"][0]["title"] == "花子の秘密.pdf"
        assert _cat(mb, "memory")["count"] == 1
        assert _cat(client.get(url, params={"q": "旅券"}).json(), "document") is None
        _act_as(stranger)
        assert client.get(url, params={"q": "清水"}).status_code in (403, 404)
        nothing = client.get("/api/v1/search/everything", params={"q": "清水"}).json()
        assert nothing["total"] == 0 and nothing["searched_plans"] == 0
    finally:
        _act_as(owner)

    # 全ての旅行を横断(コマンドパレット)
    p2 = client.post("/api/v1/travel-plans/", json={"title": "清水の旅 2027"}).json()["id"]
    d = client.post(f"/api/v1/plans/{p2}/days", json={"local_date": "2027-04-01", "timezone_id": "Asia/Tokyo"},
                    headers=_ik()).json()
    client.post(f"/api/v1/plans/{p2}/events", json={"day_id": d["id"], "title": "清水寺 再訪"}, headers=_ik())
    every = client.get("/api/v1/search/everything", params={"q": "清水寺"}).json()
    titles = {(h["plan_title"], h["title"]) for h in _cat(every, "event")["results"]}
    assert titles == {("京都の旅", "清水寺"), ("清水の旅 2027", "清水寺 再訪")}
    assert every["searched_plans"] == 2
    assert [x["title"] for x in client.get("/api/v1/search/everything", params={"q": "2027"}).json()["plans"]] == \
        ["清水の旅 2027"]

    # 回数制限
    monkeypatch.setattr(search_api, "RATE_PER_MINUTE", 0)
    assert client.get(url, params={"q": "清水"}).status_code == 429


def test_search_does_not_log_query(auth_client, make_user, db_session, caplog):
    client, owner = auth_client
    p, base, _ev, _m = _setup(client, owner, db_session, make_user)
    caplog.clear()
    with caplog.at_level("DEBUG"):
        client.get(f"{base}/search", params={"q": "極秘の検索語"})
    assert "極秘の検索語" not in caplog.text


def test_restricted_memory_and_upload_documents_hidden(auth_client, make_user, db_session):
    """文書を API で上げた場合も、ファイル名で探せる(復号して照合)"""
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "文書の検索"}).json()["id"]
    up = client.post(f"/api/v1/plans/{p}/documents/upload", files={"file": ("ホテルの予約確認.pdf", io.BytesIO(PDF),
                                                                            "application/pdf")},
                     data={"classification": "confidential", "document_type": "confirmation"})
    assert up.status_code == 201, up.text
    b = client.get(f"/api/v1/plans/{p}/search", params={"q": "予約確認"}).json()
    assert _cat(b, "document")["results"][0]["title"] == "ホテルの予約確認.pdf"


@pytest.fixture(autouse=True)
def _reset_rate(monkeypatch):
    monkeypatch.setattr(search_api, "check_rate_limit", lambda key, limit, window: limit > 0)
