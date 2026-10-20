"""[Gate C2 v2] LOOKUP_INDEX_KEY 未設定のあいだに作られた予約の索引を、鍵の設定後に埋める道具。

omega-dev2 の .env に LOOKUP_INDEX_KEY が無く、予約番号の末尾検索(情報内検索の「予約」)が何も返さなかった
(E2E search.spec.ts が omega でだけ落ちた)。鍵なしで作った予約は索引が NULL になることと、道具で埋めると
末尾検索で見つかることを確かめる。
"""
import json
import uuid

from app.api.v1 import plan_search as psapi
from app.core import crypto
from app.core.config import settings
from app.models.models import Reservation
from app.ops import backfill_lookup_index as bf

CONF = "BF-7781-5678"


def _without_key(monkeypatch):
    monkeypatch.setattr(settings, "LOOKUP_INDEX_KEY", None)
    crypto.reset_cache_for_tests()


def test_backfill_makes_suffix_search_work(auth_client, db_session, monkeypatch, capsys):
    client, _user = auth_client
    monkeypatch.setattr(psapi, "check_rate_limit", lambda *a: True)
    key = settings.LOOKUP_INDEX_KEY
    p = client.post("/api/v1/travel-plans/", json={"title": "索引B"}).json()["id"]
    _without_key(monkeypatch)
    try:
        assert bf.key_configured() is False
        assert bf.main(["--check"]) == 2
        r = client.post(f"/api/v1/plans/{p}/reservations", json={
            "type": "accommodation", "provider_name": "索引の宿", "confirmation_number": CONF})
        assert r.status_code in (200, 201), r.text
        row = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(r.json()["id"])).one()
        assert row.confirmation_number_lookup_hash is None and row.confirmation_number_suffix_lookup_hash is None
    finally:
        monkeypatch.setattr(settings, "LOOKUP_INDEX_KEY", key)
        crypto.reset_cache_for_tests()
    url = f"/api/v1/plans/{p}/search"
    before = client.get(url, params={"q": "5678", "filter": "reservation"}).json()
    assert not any(c["category"] == "reservation" and c["count"] for c in before["categories"])

    out = bf.backfill(db_session)
    db_session.commit()
    assert out["reservations_filled"] >= 1 and out["undecryptable"] == 0
    assert bf.backfill(db_session)["reservations_filled"] == 0  # 2回目は何もしない
    after = client.get(url, params={"q": "5678", "filter": "reservation"})
    hits = [h for c in after.json()["categories"] if c["category"] == "reservation" for h in c["results"]]
    assert [h["badge"] for h in hits] == ["予約番号の末尾に一致"]
    assert "7781" not in after.text
    # 表示は件数だけ(番号を出さない)
    capsys.readouterr()
    assert bf.main(["--check"]) == 0
    printed = capsys.readouterr().out
    assert json.loads(printed) == {"lookup_index_key": "configured"} and CONF not in printed
