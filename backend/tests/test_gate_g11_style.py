"""[Gate G11] 見た目の系統をアカウントに保存する(users.preferences.ui_style、migration なし。仕様 §3.4)。"""
from app.api.v1.auth import UI_STYLES
from app.core.auth import get_current_active_user
from app.main import app


def _as(user):
    app.dependency_overrides[get_current_active_user] = lambda: user


def test_ui_style_saved_and_merged(client, make_user, db_session):
    user, _ = make_user()
    user.preferences = {"theme": "dark"}
    db_session.commit()
    _as(user)
    try:
        res = client.put("/api/v1/auth/me", json={"preferences": {"ui_style": "atlas"}})
        assert res.status_code == 200, res.text
        assert res.json()["preferences"] == {"theme": "dark", "ui_style": "atlas"}
        res = client.get("/api/v1/auth/me")
        assert res.json()["preferences"]["ui_style"] == "atlas"
        for name in UI_STYLES:
            assert client.put("/api/v1/auth/me", json={"preferences": {"ui_style": name}}).status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_active_user, None)


def test_ui_style_rejects_unknown(client, make_user, db_session):
    user, _ = make_user()
    _as(user)
    try:
        for bad in ("neon", "", 1, None, ["atlas"]):
            res = client.put("/api/v1/auth/me", json={"preferences": {"ui_style": bad}})
            assert res.status_code == 422, (bad, res.text)
        db_session.refresh(user)
        assert "ui_style" not in (user.preferences or {})
    finally:
        app.dependency_overrides.pop(get_current_active_user, None)


def test_user_response_carries_ui_style(make_user, db_session):
    from app.api.v1.auth import _user_response

    user, _ = make_user()
    assert _user_response(user).ui_style is None
    user.preferences = {"ui_style": "studio"}
    assert _user_response(user).ui_style == "studio"
    user.preferences = {"ui_style": "neon"}
    assert _user_response(user).ui_style is None


def test_login_response_has_ui_style(client, make_user, db_session):
    user, password = make_user()
    user.preferences = {"ui_style": "daylight"}
    db_session.commit()
    res = client.post("/api/v1/auth/login", json={"email": user.email, "password": password})
    assert res.status_code == 200, res.text
    assert res.json()["user"]["ui_style"] == "daylight"


def test_ui_style_names_match_frontend():
    from pathlib import Path
    import re

    ts = (Path(__file__).resolve().parents[2] / "frontend/src/styles/styleIds.ts").read_text(encoding="utf-8")
    m = re.search(r"STYLE_IDS = \[([^\]]+)\]", ts)
    assert m
    names = tuple(x.strip().strip("'") for x in m.group(1).split(","))
    assert names == UI_STYLES
