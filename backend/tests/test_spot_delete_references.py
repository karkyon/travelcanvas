"""[監査 2026-11-24] 公開した場所を消すと、ほかの人のお気に入り・訪問・予定からの参照で 500 になっていた。

外部キー(user_spot_favorites.spot_id・user_spot_visits.spot_id・travel_events.spot_id)に削除の規則が無い。
消す時に、お気に入り・訪問は消し、予定は参照だけ外す(予定そのものは残す)。持ち主だけが消せることは変わらない。
"""
import uuid

from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import Spot, TravelDay, TravelEvent, TravelPlan, UserSpotFavorite, UserSpotVisit


def test_deleting_a_public_spot_used_by_others_succeeds_and_keeps_their_events(auth_client, make_user, db_session):
    client, me = auth_client
    other, _ = make_user()
    spot = Spot(id=uuid.uuid4(), name="公開の場所", category="sightseeing", created_by=me.id, is_public=True)
    db_session.add(spot)
    db_session.flush()
    db_session.add(UserSpotFavorite(user_id=other.id, spot_id=spot.id))
    db_session.add(UserSpotVisit(user_id=other.id, spot_id=spot.id))
    plan = TravelPlan(id=uuid.uuid4(), user_id=other.id, title="ほかの人の旅行")
    db_session.add(plan)
    db_session.flush()
    day = TravelDay(id=uuid.uuid4(), plan_id=plan.id, local_date=__import__("datetime").date(2026, 11, 28),
                    timezone_id="Asia/Tokyo")
    db_session.add(day)
    db_session.flush()
    ev = TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=day.id, title="公開の場所", spot_id=spot.id)
    db_session.add(ev)
    db_session.commit()

    # ほかの人は消せない
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=other, is_authenticated=True, is_guest=False)
    assert client.delete(f"/api/v1/spots/{spot.id}").status_code == 403
    # 持ち主は消せる(500 にならない)
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=me, is_authenticated=True, is_guest=False)
    r = client.delete(f"/api/v1/spots/{spot.id}")
    assert r.status_code == 200, r.text
    db_session.expire_all()
    assert db_session.get(Spot, spot.id) is None
    assert db_session.query(UserSpotFavorite).filter(UserSpotFavorite.spot_id == spot.id).count() == 0
    assert db_session.query(UserSpotVisit).filter(UserSpotVisit.spot_id == spot.id).count() == 0
    kept = db_session.get(TravelEvent, ev.id)
    assert kept is not None and kept.spot_id is None and kept.title == "公開の場所"
