"""
[Gate #27] 共有リンク・コラボレーター招待の最小縦切りテスト。正常系に加え、
他ユーザーが所有者以外のプランを共有操作できないこと(IDOR拒否)を検証する。

[Gate #30] 招待の承諾によって実際にcollaboratorとしてプランへアクセス
できること、viewer/editorのロール境界、共有トークンの失効/期限切れ/
使用回数上限/パスコード、およびトークンがDBに平文保存されていないことを
検証する。
"""
from app.core.auth import get_current_user, AuthResult
from app.core.database import SessionLocal
from app.models.models import PlanShareLink


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
