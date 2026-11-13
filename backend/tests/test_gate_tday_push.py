"""[Gate TDay-Push / TDay-Transit] 端末への通知(Web Push)と乗換の時刻の試験(実PostgreSQL)。

- 中身の暗号化は RFC 8291 の付録 A の試験の値と一致する
- 送り先はブラウザの窓口だけ(任意の宛先へ送らせない)。購読は暗号化して保存し、送り先・鍵は画面へ出さない
- 試しの通知: 端末の鍵で読める中身。窓口の 410 で購読を外す
- 定期の処理: 出る時刻の 15 分前から「そろそろ出発」を1回だけ。印を押した予定・通知の設定が「なし」には送らない
- 同行者の遅れ: 10 分以上遅れる到着予定の共有で、ほかの参加者(端末を登録した人)へ。位置は送らない
- 乗換を調べて入れた区間の所要時間(manual)を出発の合図に使う
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import EventActual, NotificationPreference, PlanCollaborator
from app.ops import opslib
from app.ops.cli import JOBS
from app.services import eta_share, today_mode, today_push
from app.services import web_push as wp

FCM = "https://fcm.googleapis.com/fcm/send/abc123"


@pytest.fixture(autouse=True)
def _reset():
    eta_share.reset_for_testing()
    today_push.reset_for_testing()
    yield
    eta_share.reset_for_testing()
    today_push.reset_for_testing()


@pytest.fixture
def freeze_now(monkeypatch):
    def _f(dt: datetime):
        monkeypatch.setattr(today_mode, "utcnow", lambda: dt)
    return _f


class Outbox:
    def __init__(self, status: int = 201):
        self.status = status
        self.items = []

    def __call__(self, url, headers, body):
        self.items.append((url, headers, body))
        return self.status


@pytest.fixture
def outbox(monkeypatch):
    box = Outbox()
    monkeypatch.setattr(wp, "_http_send", box)
    return box


def _device():
    key = ec.generate_private_key(ec.SECP256R1())
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth = uuid.uuid4().bytes
    return key, wp.b64u(pub), wp.b64u(auth)


def _decrypt(body: bytes, key, auth_b64: str) -> dict:
    salt, idlen = body[:16], body[20]
    as_pub, ct = body[21:21 + idlen], body[21 + idlen:]
    ua_pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=wp.b64u_decode(auth_b64),
               info=b"WebPush: info\x00" + ua_pub + as_pub).derive(shared)
    cek = HKDF(algorithm=hashes.SHA256(), length=16, salt=salt, info=b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00").derive(ikm)
    plain = AESGCM(cek).decrypt(nonce, ct, None)
    assert plain.endswith(b"\x02")
    return json.loads(plain[:-1].decode("utf-8"))


def _subscribe(client, endpoint=FCM):
    key, p256dh, auth = _device()
    r = client.post("/api/v1/push/subscriptions",
                    json={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}, "label": "Android"})
    return r, key, auth


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(client, title="Push 大津") -> str:
    r = client.post("/api/v1/travel-plans/", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _day(client, plan_id, d) -> str:
    r = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": d, "timezone_id": "Asia/Tokyo"}, headers=_ik())
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _event(client, plan_id, day_id, title, **f) -> str:
    r = client.post(f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": title, **f}, headers=_ik())
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _two_stops(client, freeze_now):
    freeze_now(datetime(2026, 11, 13, 0, 0, tzinfo=timezone.utc))  # 09:00 JST
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13")
    a = _event(client, plan_id, d1, "ホテル", local_start_time="09:00", latitude=35.0045, longitude=135.8686)
    b = _event(client, plan_id, d1, "テラス", local_start_time="11:00", latitude=35.0143, longitude=135.8790)
    return plan_id, d1, a, b


def _guide(client, plan_id) -> dict:
    r = client.get(f"/api/v1/plans/{plan_id}/today/guide")
    assert r.status_code == 200, r.text
    return r.json()


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# ---- 純粋な部分 -----------------------------------------------------------------------------------------------

def test_encryption_matches_rfc8291_appendix_a():
    as_key = ec.derive_private_key(
        int.from_bytes(wp.b64u_decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1())
    out = wp.encrypt(b"When I grow up, I want to be a watermelon",
                     "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                     "BTBZMqHH6r4Tts7J_aSIgg", salt=wp.b64u_decode("DGv6ra1nlYgDCS1FRnbzlw"), server_key=as_key)
    assert wp.b64u(out) == (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8w"
        "EqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")


def test_endpoint_must_be_a_browser_push_service():
    for ok in (FCM, "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QX",
               "https://wns2-par02p.notify.windows.com/w/?token=x"):
        assert wp.check_endpoint(ok) == ok
    for bad in ("http://fcm.googleapis.com/x", "https://evil.example.com/x", "https://127.0.0.1/x",
                "https://fcm.googleapis.com.evil.io/x", "https://fcm.googleapis.com:8443/x",
                "https://u:p@fcm.googleapis.com/x"):
        with pytest.raises(wp.PushError):
            wp.check_endpoint(bad)


def test_vapid_header_is_signed_for_the_push_origin():
    import jwt as pyjwt

    h = wp.vapid_header(FCM, now=1_800_000_000)
    token = h.split("t=")[1].split(",")[0]
    k = h.split("k=")[1]
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), wp.b64u_decode(k))
    claims = pyjwt.decode(token, pub, algorithms=["ES256"], audience="https://fcm.googleapis.com",
                          options={"verify_exp": False})
    assert claims["aud"] == "https://fcm.googleapis.com" and claims["sub"].startswith(("mailto:", "https://"))
    assert k == wp.public_key()


def test_jobs_and_schedule_include_today_push():
    assert JOBS["today-push"] == ["-m", "app.ops.today_push"]
    assert "*/2 * * * *" in opslib.render_cron_block("/home/x/tc") and "jobs today-push" in opslib.render_cron_block(
        "/home/x/tc")


# ---- 購読・設定・試しの通知 ---------------------------------------------------------------------------------

def test_subscribe_store_encrypted_and_remove(auth_client, db_session):
    client, user = auth_client
    cfg = client.get("/api/v1/push/config").json()
    assert cfg["available"] is True and cfg["public_key"] == wp.public_key() and cfg["devices"] == []
    assert cfg["kinds"] == {"depart": True, "rain": True, "morning": True, "crew": True, "notice": True}
    r, _key, _auth = _subscribe(client)
    assert r.status_code == 200, r.text
    devices = r.json()["devices"]
    assert len(devices) == 1 and devices[0]["label"] == "Android" and devices[0]["current_key"] is True
    assert "endpoint" not in json.dumps(r.json())
    db_session.refresh(user)
    raw = json.dumps(user.preferences)
    assert "fcm.googleapis.com" not in raw and "abc123" not in raw  # 送り先は暗号化して置く
    bad, _k, _a = _subscribe(client, "https://evil.example.com/push")
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_endpoint"
    s = client.put("/api/v1/push/settings", json={"rain": False}).json()
    assert s["kinds"]["rain"] is False and s["kinds"]["depart"] is True
    gone = client.post("/api/v1/push/subscriptions/remove", json={"endpoint": FCM}).json()
    assert gone["devices"] == []


def test_subscriptions_are_capped(auth_client):
    client, _user = auth_client
    for i in range(wp.MAX_SUBSCRIPTIONS + 2):
        assert _subscribe(client, f"{FCM}{i}")[0].status_code == 200
    assert len(client.get("/api/v1/push/config").json()["devices"]) == wp.MAX_SUBSCRIPTIONS


def test_test_push_is_readable_on_the_device_and_gone_is_removed(auth_client, outbox):
    client, _user = auth_client
    _r, key, auth = _subscribe(client)
    res = client.post("/api/v1/push/test").json()
    assert res["sent"] == 1 and len(outbox.items) == 1
    url, headers, body = outbox.items[0]
    assert url == FCM and headers["Content-Encoding"] == "aes128gcm" and headers["Authorization"].startswith("vapid t=")
    msg = _decrypt(body, key, auth)
    assert msg["title"] == "TravelCanvas の通知" and msg["kind"] == "test"
    outbox.status = 410
    res = client.post("/api/v1/push/test").json()
    assert res["removed"] == 1 and res["devices"] == []


# ---- 定期の処理(出発の合図) -------------------------------------------------------------------------------

def test_sweep_sends_depart_soon_once(auth_client, db_session, freeze_now, outbox):
    client, user = auth_client
    plan_id, _d1, _a, b = _two_stops(client, freeze_now)
    _r, key, auth = _subscribe(client)
    client.put("/api/v1/push/settings", json={"morning": False, "rain": False})
    leave = _parse(_guide(client, plan_id)["events"][b]["leave_by"])
    freeze_now(leave - timedelta(minutes=10))
    counts = today_push.sweep(db_session)
    assert counts["sent"] == 1 and counts["plans"] == 1
    msg = _decrypt(outbox.items[0][2], key, auth)
    assert msg["title"] == "そろそろ出発 ・ あと10分" and "テラス" in msg["body"] and msg["kind"] == "depart"
    assert msg["url"] == f"/planner/{plan_id}/today"
    assert outbox.items[0][1]["Urgency"] == "high"
    assert today_push.sweep(db_session)["sent"] == 0  # 同じ知らせは二度送らない
    freeze_now(leave + timedelta(minutes=1))
    today_push.sweep(db_session)
    assert _decrypt(outbox.items[-1][2], key, auth)["title"] == "いま出れば間に合います"


def test_sweep_skips_visited_and_muted_plans(auth_client, db_session, freeze_now, outbox):
    client, user = auth_client
    plan_id, _d1, _a, b = _two_stops(client, freeze_now)
    _subscribe(client)
    client.put("/api/v1/push/settings", json={"morning": False, "rain": False})
    leave = _parse(_guide(client, plan_id)["events"][b]["leave_by"])
    freeze_now(leave - timedelta(minutes=10))
    db_session.add(NotificationPreference(user_id=user.id, plan_id=uuid.UUID(plan_id), level="none"))
    db_session.flush()
    assert today_push.sweep(db_session)["sent"] == 0
    db_session.query(NotificationPreference).filter(NotificationPreference.user_id == user.id).delete()
    db_session.add(EventActual(plan_id=uuid.UUID(plan_id), event_id=uuid.UUID(b), status="visited",
                               recorded_by_user_id=user.id))
    db_session.flush()
    assert today_push.sweep(db_session)["sent"] == 0


def test_morning_message_once_a_day():
    now = datetime(2026, 11, 12, 23, 30, tzinfo=timezone.utc)  # 08:30 JST
    guide = {"timezone_id": "Asia/Tokyo", "local_date": "2026-11-13", "day_index": 2, "day_title": "湖の日",
             "events": {"e1": {"start_at": "2026-11-13T00:30:00+00:00", "leave_by": "2026-11-13T00:10:00+00:00"},
                        "e2": {"start_at": "2026-11-13T03:00:00+00:00", "leave_by": None}}}
    key, msg, _u = today_push.morning_message("p1", guide, {"e1": "朝市"}, now)
    assert key == "p1:2026-11-13:morning" and msg["title"] == "旅の2日目 ・ 湖の日"
    assert msg["body"] == "今日は2件。最初は 09:30 朝市(09:10 に出発)"
    assert today_push.morning_message("p1", guide, {}, now - timedelta(hours=1)) is None  # 出発の60分より前
    assert today_push.morning_message("p1", guide, {}, datetime(2026, 11, 13, 0, 31, tzinfo=timezone.utc)) is None


# ---- 同行者の遅れ ------------------------------------------------------------------------------------------

def test_crew_delay_notifies_other_members(auth_client, make_user, db_session, freeze_now, outbox, monkeypatch):
    client, owner = auth_client
    # 共有の期限は実際の時計で切れる(eta_share)ため、固定の日時ではなく今の時刻を基準にする
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    freeze_now(now)
    start = now + timedelta(hours=1)
    local = start.astimezone(today_mode.zone_for("Asia/Tokyo"))
    plan_id = _plan(client)
    d1 = _day(client, plan_id, local.strftime("%Y-%m-%d"))
    e = _event(client, plan_id, d1, "テラス", local_start_time=local.strftime("%H:%M"))
    friend, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=friend.id, email=friend.email, role="viewer",
                                    status="accepted"))
    db_session.flush()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=friend, is_authenticated=True, is_guest=False)
    _r, key, auth = _subscribe(client)
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=owner, is_authenticated=True, is_guest=False)
    _subscribe(client, FCM + "owner")
    monkeypatch.setattr(today_push, "session_factory", lambda: db_session)
    body = {"event_id": e, "until": (now + timedelta(hours=4)).isoformat()}
    ok = client.put(f"/api/v1/plans/{plan_id}/today/eta",
                    json={**body, "arrive_at": (start + timedelta(minutes=5)).isoformat()})  # 5分遅れは送らない
    assert ok.status_code == 200 and outbox.items == []
    late = client.put(f"/api/v1/plans/{plan_id}/today/eta",
                      json={**body, "arrive_at": (start + timedelta(minutes=25)).isoformat()})  # 25分遅れ
    assert late.status_code == 200 and any(s["is_self"] for s in late.json()["shares"])
    assert len(outbox.items) == 1 and outbox.items[0][0] == FCM  # 本人の端末へは送らない
    msg = _decrypt(outbox.items[0][2], key, auth)
    arrive_hm = (start + timedelta(minutes=25)).astimezone(today_mode.zone_for("Asia/Tokyo")).strftime("%H:%M")
    assert msg["title"] == f"{owner.username}さんが遅れます" and "約25分" in msg["body"] and arrive_hm in msg["body"]
    client.put(f"/api/v1/plans/{plan_id}/today/eta",
               json={**body, "arrive_at": (start + timedelta(minutes=26)).isoformat()})
    assert len(outbox.items) == 1  # 同じくらいの遅れは二度送らない


# ---- 乗換を調べて入れた時刻 ------------------------------------------------------------------------------------

def test_guide_uses_manual_segment_duration(auth_client, freeze_now):
    client, _user = auth_client
    plan_id, _d1, a, b = _two_stops(client, freeze_now)
    before = _guide(client, plan_id)["events"][b]
    assert before["travel_source"] == "estimate" and before["segment_id"] is None and before["from_event_id"] == a
    r = client.post(f"/api/v1/plans/{plan_id}/segments", headers=_ik(),
                    json={"from_event_id": a, "to_event_id": b, "mode": "train", "duration_minutes": 25})
    assert r.status_code == 201, r.text
    after = _guide(client, plan_id)["events"][b]
    assert after["travel_source"] == "manual" and after["travel_minutes"] == 25 and after["travel_mode"] == "train"
    assert after["segment_id"] == r.json()["id"] and after["segment_revision"] == r.json()["revision"]
    assert _parse(after["leave_by"]) == _parse(after["start_at"]) - timedelta(minutes=25)
