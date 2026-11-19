"""[Gate②] メールアドレスの大文字小文字の違いでログインできない・同じ人の 2 つ目のアカウントが作れる問題。

登録時のメールは pydantic の正規化でドメインだけ小文字になり、ローカル部は入力のまま残る。以前はログイン・登録の重複確認・
メールの変更が完全一致で比べていたため、「Taro_x@example.com」で登録した人が「taro_x@example.com」でログインできず、
「TARO_X@example.com」で 2 つ目のアカウントも作れた(パスワードの再設定だけは既に大文字小文字を区別していなかった)。
"""
import uuid

from app.core.user_email import email_in_use, find_user_by_email
from app.models.models import User

PW = "TestPass123!"


def _register(client, email):
    return client.post("/api/v1/auth/register",
                       json={"username": f"u_{uuid.uuid4().hex[:10]}", "email": email, "password": PW})


def test_login_ignores_case_and_duplicate_signup_is_rejected(client):
    local = f"Taro_{uuid.uuid4().hex[:8]}"
    res = _register(client, f"{local}@Example.com")
    assert res.status_code == 200, res.text
    stored = res.json()["user"]["email"]

    for typed in (stored, stored.lower(), stored.upper(), f"  {stored.lower()}"[2:]):
        r = client.post("/api/v1/auth/login", json={"email": typed, "password": PW})
        assert r.status_code == 200, (typed, r.text)
        assert r.json()["user"]["email"] == stored

    # 大文字小文字だけ違う 2 つ目のアカウントは作れない
    assert _register(client, stored.upper()).status_code == 400
    # 違うパスワードは従来どおり 401
    assert client.post("/api/v1/auth/login", json={"email": stored.lower(), "password": "wrong-Pass-1"}).status_code == 401


def test_lookup_prefers_exact_and_refuses_ambiguous(db_session, make_user):
    """既に大文字小文字だけ違う 2 つのアカウントがある時は、完全一致だけで探す(どちらか分からないため推測しない)。"""
    local = f"dup_{uuid.uuid4().hex[:8]}"
    a, _ = make_user(email=f"{local}@example.com")
    b, _ = make_user(email=f"{local.upper()}@example.com")
    assert find_user_by_email(db_session, a.email).id == a.id
    assert find_user_by_email(db_session, b.email).id == b.id
    assert find_user_by_email(db_session, f"{local.capitalize()}@example.com") is None
    assert email_in_use(db_session, f"{local.capitalize()}@EXAMPLE.com") is True
    assert email_in_use(db_session, a.email, exclude_user_id=a.id) is True  # b がいる
    solo, _ = make_user(email=f"solo_{uuid.uuid4().hex[:8]}@example.com")
    assert email_in_use(db_session, solo.email.upper(), exclude_user_id=solo.id) is False
    assert find_user_by_email(db_session, solo.email.upper()).id == solo.id
    assert find_user_by_email(db_session, solo.email.upper(), User.is_active.is_(False)) is None
    assert find_user_by_email(db_session, "") is None
