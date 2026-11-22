"""[Gate② FC-026] 不適切な候補の報告: 閉業・住所の誤り・危険・重複を報告し、出典の状態へ反映する。

DOC-02 FC-026「閉業・誤住所・危険・重複を報告しソース状態へ反映」。
"""
import uuid
from datetime import datetime, timezone

from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import CandidateReport, Place, PlanCandidate, PlanCollaborator, SourceRecord


def _plan(client):
    res = client.post("/api/v1/travel-plans/", json={"title": "報告の旅"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _candidate(client, plan_id, title="伊勢の食堂"):
    res = client.post(f"/api/v1/plans/{plan_id}/candidates", json={"title": title, "address": "三重県伊勢市"})
    assert res.status_code == 201, res.text
    body = res.json()
    return body.get("id") or body["item"]["id"]


def test_report_is_kept_counted_and_marks_the_place_sources_for_recheck(auth_client, db_session):
    client, user = auth_client
    p = _plan(client)
    cid = _candidate(client, p)
    place = Place(name="伊勢の食堂", created_by=user.id)
    db_session.add(place)
    db_session.flush()
    db_session.add(SourceRecord(place_id=place.id, provider="nominatim", retrieved_at=datetime.now(timezone.utc)))
    db_session.query(PlanCandidate).filter(PlanCandidate.id == uuid.UUID(cid)).update(
        {PlanCandidate.place_id: place.id})
    db_session.flush()

    res = client.post(f"/api/v1/plans/{p}/candidates/{cid}/reports", json={"reason": "closed", "note": "閉店の貼り紙"})
    assert res.status_code == 201, res.text
    assert res.json()["reports"] == {"closed": 1} and res.json()["sources_marked_stale"] == 1
    assert db_session.query(SourceRecord).filter(SourceRecord.place_id == place.id).one().freshness_state == "stale"
    # 候補の一覧に理由ごとの件数が出る(誰が報告したかは出さない)
    item = next(i for i in client.get(f"/api/v1/plans/{p}/candidates").json()["items"] if i["id"] == cid)
    assert item["reports"] == {"closed": 1}
    assert str(user.id) not in str(item["reports"])
    # 候補・場所の値は変えない
    assert db_session.get(Place, place.id).name == "伊勢の食堂"


def test_viewer_can_report_but_reasons_and_rate_are_limited(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _plan(client)
    cid = _candidate(client, p)
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.flush()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=viewer, is_authenticated=True, is_guest=False)
    try:
        assert client.post(f"/api/v1/plans/{p}/candidates/{cid}/reports",
                           json={"reason": "wrong_address"}).status_code == 201
        assert client.post(f"/api/v1/plans/{p}/candidates/{cid}/reports",
                           json={"reason": "spam"}).status_code == 422  # 決まった理由だけ
        for _ in range(4):
            assert client.post(f"/api/v1/plans/{p}/candidates/{cid}/reports",
                               json={"reason": "duplicate"}).status_code == 201
        assert client.post(f"/api/v1/plans/{p}/candidates/{cid}/reports",
                           json={"reason": "dangerous"}).status_code == 429  # 1 人 5 件まで
    finally:
        app.dependency_overrides[get_current_user] = (
            lambda: AuthResult(user=owner, is_authenticated=True, is_guest=False))
    assert db_session.query(CandidateReport).filter(CandidateReport.candidate_id == uuid.UUID(cid)).count() == 5


def test_outsider_cannot_report(auth_client, make_user):
    client, owner = auth_client
    p = _plan(client)
    cid = _candidate(client, p)
    stranger, _ = make_user()
    app.dependency_overrides[get_current_user] = (
        lambda: AuthResult(user=stranger, is_authenticated=True, is_guest=False))
    try:
        assert client.post(f"/api/v1/plans/{p}/candidates/{cid}/reports",
                           json={"reason": "closed"}).status_code in (403, 404)
    finally:
        app.dependency_overrides[get_current_user] = (
            lambda: AuthResult(user=owner, is_authenticated=True, is_guest=False))
