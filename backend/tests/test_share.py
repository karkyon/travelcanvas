"""
[Gate #27] 共有リンク・コラボレーター招待の最小縦切りテスト。正常系に加え、
他ユーザーが所有者以外のプランを共有操作できないこと(IDOR拒否)を検証する。

[Gate #30] 招待の承諾によって実際にcollaboratorとしてプランへアクセス
できること、viewer/editorのロール境界、共有トークンの失効/期限切れ/
使用回数上限/パスコード、およびトークンがDBに平文保存されていないことを
検証する。

[Gate #31.5B] 使用回数上限の消費が同時アクセス下でも原子的であること、
IPベースのレート制限、監査ログ(ShareAccessLog)、公開ビューへのfield
policy(itinerary内の機微情報の除去)を検証する。
"""
from app.core.auth import get_current_user, AuthResult
from app.core.database import SessionLocal
from app.models.models import PlanShareLink, ShareAccessLog


def _create_plan(client, title="共有テストプラン"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={"title": title, "destination": "大阪"},
    )
    assert res.status_code == 201
    return res.json()["id"]


def _act_as(app, user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=user, is_authenticated=True, is_guest=False
    )


def test_create_share_link(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/share",
        json={"permission": "view"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["permission"] == "view"
    assert body["plan_id"] == plan_id


def test_invite_collaborator(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "collaborator@example.com", "role": "viewer"},
    )
    assert res.status_code == 200
    assert res.json()["role"] == "viewer"
    assert res.json()["status"] == "pending"


def test_non_owner_cannot_create_share_link(client, make_user):
    from app.main import app

    owner, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=owner, is_authenticated=True, is_guest=False
    )
    plan_id = _create_plan(client, title="他人のプラン")

    other_user, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=other_user, is_authenticated=True, is_guest=False
    )
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/share",
        json={"permission": "view"},
    )
    assert res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)


# ===== Gate #30: 招待の承諾によるcollaboratorアクセス =====

def test_accepted_viewer_can_read_but_not_write(client, make_user, db_session):
    """[Gate #30] 招待を承諾したviewerは対象プランを閲覧できるが、
    更新(PUT)は403で拒否される(以前は承諾しても永久にアクセス不能だった)。"""
    from app.main import app

    owner, _ = make_user()
    viewer, _ = make_user(email="viewer@example.com")

    _act_as(app, owner)
    plan_id = _create_plan(client, title="共有先プラン")
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "viewer@example.com", "role": "viewer"},
    )
    assert res.status_code == 200
    collab_id = res.json()["id"]

    _act_as(app, viewer)
    # 承諾前はまだアクセス不可
    res = client.get(f"/api/v1/travel-plans/{plan_id}")
    assert res.status_code == 403

    res = client.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept")
    assert res.status_code == 200
    assert res.json()["status"] == "accepted"

    # 承諾後は閲覧可能
    res = client.get(f"/api/v1/travel-plans/{plan_id}")
    assert res.status_code == 200

    # だが更新はviewerには許可されない
    res = client.put(f"/api/v1/travel-plans/{plan_id}", json={"title": "改変"})
    assert res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)


def test_accepted_editor_can_write_but_not_delete_or_manage_share(client, make_user):
    """[Gate #30] editorは編集はできるが、プラン削除・共有リンク管理・
    コラボレーター管理はowner専権のため403になる。"""
    from app.main import app

    owner, _ = make_user()
    editor, _ = make_user(email="editor@example.com")

    _act_as(app, owner)
    plan_id = _create_plan(client, title="editor検証プラン")
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "editor@example.com", "role": "editor"},
    )
    collab_id = res.json()["id"]

    _act_as(app, editor)
    res = client.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept")
    assert res.status_code == 200

    res = client.put(f"/api/v1/travel-plans/{plan_id}", json={"title": "editorが編集"})
    assert res.status_code == 200
    assert res.json()["title"] == "editorが編集"

    res = client.delete(f"/api/v1/travel-plans/{plan_id}")
    assert res.status_code == 403

    res = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"})
    assert res.status_code == 403

    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "another@example.com", "role": "viewer"},
    )
    assert res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)


def test_declined_invitation_grants_no_access(client, make_user):
    """[Gate #30] 招待を辞退した場合はアクセス権を得ない。辞退後の再度の
    accept/decline操作は409で拒否される(処理済みのため)。"""
    from app.main import app

    owner, _ = make_user()
    invitee, _ = make_user(email="invitee@example.com")

    _act_as(app, owner)
    plan_id = _create_plan(client, title="辞退検証プラン")
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "invitee@example.com", "role": "viewer"},
    )
    collab_id = res.json()["id"]

    _act_as(app, invitee)
    res = client.post(f"/api/v1/travel-plans/invitations/{collab_id}/decline")
    assert res.status_code == 200
    assert res.json()["status"] == "declined"

    res = client.get(f"/api/v1/travel-plans/{plan_id}")
    assert res.status_code == 403

    res = client.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept")
    assert res.status_code == 409

    app.dependency_overrides.pop(get_current_user, None)


def test_other_user_cannot_accept_someone_elses_invitation(client, make_user):
    """[Gate #30 IDOR] 招待IDを知っていても、宛先メールアドレスと一致しない
    ユーザーは承諾できない(404で応答し、存在有無を漏らさない)。"""
    from app.main import app

    owner, _ = make_user()
    _act_as(app, owner)
    plan_id = _create_plan(client, title="IDOR検証プラン")
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "target@example.com", "role": "viewer"},
    )
    collab_id = res.json()["id"]

    attacker, _ = make_user(email="attacker@example.com")
    _act_as(app, attacker)
    res = client.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept")
    assert res.status_code == 404

    app.dependency_overrides.pop(get_current_user, None)


def test_removed_collaborator_loses_access_immediately(client, make_user):
    """[Gate #30] コラボレーター削除直後、そのユーザーは対象プランへ
    アクセスできなくなる。"""
    from app.main import app

    owner, _ = make_user()
    viewer, _ = make_user(email="removed@example.com")

    _act_as(app, owner)
    plan_id = _create_plan(client, title="削除検証プラン")
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "removed@example.com", "role": "viewer"},
    )
    collab_id = res.json()["id"]

    _act_as(app, viewer)
    client.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept")
    assert client.get(f"/api/v1/travel-plans/{plan_id}").status_code == 200

    _act_as(app, owner)
    res = client.delete(f"/api/v1/travel-plans/{plan_id}/collaborators/{collab_id}")
    assert res.status_code == 200

    _act_as(app, viewer)
    res = client.get(f"/api/v1/travel-plans/{plan_id}")
    assert res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)


# ===== Gate #30: 共有トークンのセキュリティ =====

def test_share_token_is_not_stored_in_plaintext(auth_client, db_session):
    """[Gate #30 監査是正] DBには生トークンが一切保存されず、ハッシュ値
    (token_hash)とprefixのみが保存されていることを直接検証する。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"})
    assert res.status_code == 200
    body = res.json()
    raw_url = body["url"]
    assert raw_url is not None
    raw_token = raw_url.rsplit("/", 1)[-1]

    share = db_session.query(PlanShareLink).filter(PlanShareLink.id == body["id"]).first()
    assert not hasattr(PlanShareLink, "token")  # カラム自体が削除されている
    assert share.token_hash is not None
    assert share.token_hash != raw_token
    assert share.token_prefix == raw_token[:8]


def test_public_resolve_share_link_success(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client, title="公開閲覧テスト")

    res = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"})
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["plan_id"] == plan_id
    assert body["title"] == "公開閲覧テスト"
    assert body["can_edit"] is False
    # フィールドポリシー: budgetは匿名公開ビューに含めない
    assert "budget" not in body


def test_public_resolve_unknown_token_returns_404(client):
    res = client.post("/api/v1/public/share/not-a-real-token/resolve", json={})
    assert res.status_code == 404


def test_public_resolve_revoked_token_returns_404(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"})
    share_id = res.json()["id"]
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    res = client.post(f"/api/v1/travel-plans/{plan_id}/share/{share_id}/revoke")
    assert res.status_code == 200
    assert res.json()["revoked_at"] is not None

    res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert res.status_code == 404


def test_public_resolve_respects_max_uses(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/share",
        json={"permission": "view", "max_uses": 1},
    )
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert res.status_code == 200

    res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert res.status_code == 404


def test_public_resolve_requires_correct_passcode(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/share",
        json={"permission": "view", "passcode": "sesame123"},
    )
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={"passcode": "wrong"})
    assert res.status_code == 401

    res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert res.status_code == 401

    res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={"passcode": "sesame123"})
    assert res.status_code == 200


# ===== Gate #31.5B: 使用回数の原子性・レート制限・監査ログ・field policy =====

def test_concurrent_resolve_never_exceeds_max_uses(auth_client, db_session):
    """[Gate #31.5B 監査是正R-05] max_uses=1のリンクに対し、複数スレッドから
    同時に解決を試みても、成功するのはちょうど1件のみであることを検証する
    (read-modify-writeのレースコンディションが無いことの直接的な証明)。"""
    import threading

    client, _user = auth_client
    plan_id = _create_plan(client, title="同時アクセス検証プラン")
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/share",
        json={"permission": "view", "max_uses": 1},
    )
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    results = []
    lock = threading.Lock()

    def _attempt():
        r = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
        with lock:
            results.append(r.status_code)

    threads = [threading.Thread(target=_attempt) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(200) == 1, f"200が複数/0件発生: {results}"
    assert results.count(404) == 7

    share = db_session.query(PlanShareLink).filter(PlanShareLink.plan_id == plan_id).first()
    db_session.refresh(share)
    assert share.use_count == 1  # 8回試行しても1しか消費されていない


def test_public_resolve_is_rate_limited_per_ip(auth_client):
    """[Gate #31.5B] 同一IPからの過剰なリクエストは429で拒否される。"""
    from app.core.config import settings

    client, _user = auth_client
    plan_id = _create_plan(client)
    res = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"})
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    last_status = None
    for _ in range(settings.RATE_LIMIT_PUBLIC_SHARE + 5):
        last_status = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={}).status_code

    assert last_status == 429


def test_public_resolve_sets_no_store_cache_control(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"})
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    resolve_res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert resolve_res.headers.get("cache-control") == "no-store"


def test_public_resolve_writes_audit_log(auth_client, db_session):
    """[Gate #31.5B] 成功・失敗いずれの試行もShareAccessLogへ記録される。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"})
    share_id = res.json()["id"]
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    client.post("/api/v1/public/share/completely-invalid-token/resolve", json={})

    logs = db_session.query(ShareAccessLog).all()
    results = {log.result for log in logs}
    assert "success" in results
    assert "invalid" in results
    success_log = next(log for log in logs if log.result == "success")
    assert str(success_log.share_id) == share_id


def test_public_resolve_redacts_sensitive_itinerary_fields(auth_client, db_session):
    """[Gate #34] 公開ビューは正規化テーブル(TravelDay/TravelEvent)から
    固定ホワイトリストで構築されるため、address/緯度経度/内部ID等は
    そもそも出力候補に含まれない(ブロックリストの除去漏れという構造的
    リスクごと解消されていることを検証する)。"""
    import datetime as _dt
    from app.models.models import TravelDay, TravelEvent

    client, _user = auth_client
    plan_id = _create_plan(client)

    day = TravelDay(plan_id=plan_id, local_date=_dt.date(2026, 10, 1), title="1日目")
    db_session.add(day)
    db_session.flush()
    event = TravelEvent(
        plan_id=plan_id,
        day_id=day.id,
        title="ホテルチェックイン",
        event_type="accommodation",
        address="大阪府大阪市北区1-2-3 ホテル内 予約番号RSV-12345",
        latitude=34.687315,
        longitude=135.526201,
        description="confirmation_code: ABCDEF / tel 090-1234-5678",
    )
    db_session.add(event)
    db_session.commit()

    res = client.post(f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"})
    raw_token = res.json()["url"].rsplit("/", 1)[-1]

    resolve_res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert resolve_res.status_code == 200
    body = resolve_res.json()
    assert "itinerary" not in body  # [Gate #34] 旧itineraryキーはもう返らない

    public_day = body["days"][0]
    assert public_day["date"] == "2026-10-01"
    public_event = public_day["events"][0]

    assert public_event["title"] == "ホテルチェックイン"
    assert public_event["event_type"] == "accommodation"
    # ホワイトリスト方式のため、そもそも住所・座標・自由記述descriptionは
    # 公開投影のフィールドとして存在しない。
    assert "address" not in public_event
    assert "latitude" not in public_event
    assert "longitude" not in public_event
    assert "description" not in public_event


def test_utils_permissions_module_no_longer_exists(auth_client):
    """[Gate #31.5B 監査是正R-04] 旧app/utils/permissions.py(ghost code、
    plan_access.pyとの認可正本二重化の原因)が削除されていることを確認する。"""
    import importlib.util

    spec = importlib.util.find_spec("app.utils.permissions")
    assert spec is None, "app/utils/permissions.py が依然として存在します(認可正本が二重化しています)"
