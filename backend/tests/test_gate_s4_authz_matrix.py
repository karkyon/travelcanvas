"""[Gate S4] SEC-10 認可の網羅試験(全 API × 立場)。

アプリの全ルートを列挙し、次の立場で呼んで「他人のデータに届かない」ことを機械的に確かめる。

- 資格情報なし: 公開してよいと決めたルート(PUBLIC_ROUTES)以外は 401/403 になる
- 関係のない会員・関係のないゲスト: 他人の旅行プラン(/{plan_id}/ を含むルート)には 403/404 になる
  (要求の本文が空なので 422 になるルートもある。その場合も 2xx・5xx にはならないことを確かめる)

新しいルートを足した時に、認可の付け忘れがあればこの試験が落ちる。公開ルートを増やす時は
PUBLIC_ROUTES に理由と一緒に足す(そこで見直しが入る)。
"""
import re
import uuid

import pytest

from app.core.route_index import iter_routes
from app.main import app

DUMMY = "00000000-0000-4000-8000-000000000000"

# 資格情報なしで 401/403 以外を返してよいルート(メソッド, パス)と理由
PUBLIC_ROUTES = {
    ("GET", "/"): "案内",
    ("GET", "/health"): "死活確認",
    ("GET", "/api/v1/health"): "死活確認",
    ("GET", "/ready"): "準備確認(中身は真偽値だけ)",
    ("GET", "/metrics"): "合言葉か私設アドレスだけ(app/ops/metrics.py。試験の接続元は私設扱い)",
    ("GET", "/test"): "DEBUG の時だけの疎通確認",
    ("GET", "/docs"): "開発用の API 画面(本番では出さない)",
    ("GET", "/docs/oauth2-redirect"): "同上",
    ("GET", "/redoc"): "同上",
    ("GET", "/openapi.json"): "同上",
    ("GET", "/api/v1/auth/test"): "DEBUG の時だけの疎通確認",
    ("GET", "/api/v1/spots/test/ping"): "疎通確認",
    ("GET", "/api/v1/travel-plans/test/ping"): "疎通確認",
    ("POST", "/api/v1/auth/guest"): "ゲストの開始(回数制限あり)",
    ("POST", "/api/v1/auth/login"): "ログイン(回数制限あり)",
    ("POST", "/api/v1/auth/register"): "会員登録(回数制限あり)",
    ("POST", "/api/v1/auth/refresh"): "cookie の更新鍵で認証する",
    ("GET", "/api/v1/plans/documents/download"): "署名付きの期限付き URL(発行時と受け取り時に権限を確かめる)",
    ("POST", "/api/v1/public/share/{token}/resolve"): "公開共有(公開してよい項目だけを返す)",
    ("POST", "/api/v1/quick-drafts"): "ログイン前の下書き(端末の合言葉で本人を見分ける)",
    ("POST", "/api/v1/quick-drafts/{draft_id}/promote"): "同上",
    ("POST", "/api/v1/auth/logout"): "この端末の cookie を消す(cookie の更新鍵が正しければそのセッションも失効させる)",
    ("GET", "/api/v1/spots/categories/list"): "固定の分類一覧(利用者のデータを含まない)",
}

# 廃止して 410 Gone を返すだけのルート(中身の処理に入らない)
GONE_ROUTES = {
    ("GET", "/api/v1/optimization/{job_id}"),
    ("POST", "/api/v1/optimization/{job_id}/apply"),
    ("POST", "/api/v1/optimization/{job_id}/cancel"),
    ("POST", "/api/v1/optimize-route"),
    ("POST", "/api/v1/plans/{plan_id}/documents"),
    ("POST", "/api/v1/travel-plans/{plan_id}/optimize"),
}

_SKIP_METHODS = {"HEAD", "OPTIONS"}


def _all_routes():
    seen = set()
    for path, methods, _route in iter_routes(app):
        for method in methods:
            if method in _SKIP_METHODS or (method, path) in seen:
                continue
            seen.add((method, path))
            yield method, path


def _fill(path: str, plan_id: str) -> str:
    path = path.replace("{plan_id}", plan_id)
    return re.sub(r"\{[^}]+\}", DUMMY, path)


def _call(client, method, url, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    kwargs = {"headers": headers}
    if method in ("POST", "PUT", "PATCH"):
        kwargs["json"] = {}
    return client.request(method, url, **kwargs)


def _register(client):
    suffix = uuid.uuid4().hex[:10]
    res = client.post("/api/v1/auth/register", json={
        "username": f"s4_{suffix}", "email": f"s4_{suffix}@example.com", "password": "Gate-S4-Matrix-Pass1",
    })
    assert res.status_code == 200, res.text
    client.cookies.clear()
    return res.json()["access_token"]


def _guest(client):
    res = client.post("/api/v1/auth/guest")
    assert res.status_code == 201, res.text
    return res.json()["access_token"]


@pytest.fixture()
def owner_plan(client):
    token = _register(client)
    res = client.post("/api/v1/travel-plans/", json={"title": "S4 認可の網羅"},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 201, res.text
    return token, res.json()["id"]


def test_public_route_list_matches_app():
    """公開ルートの一覧に、実在しないルートが残っていないこと(消したルートの名残で穴を開けない)。"""
    existing = set(_all_routes())
    stale = sorted(set(PUBLIC_ROUTES) - existing)
    assert not stale, f"PUBLIC_ROUTES に実在しないルートがあります: {stale}"


def test_every_private_route_requires_credentials(client, owner_plan):
    _token, plan_id = owner_plan
    problems = []
    for method, path in sorted(_all_routes(), key=lambda r: (r[1], r[0])):
        if (method, path) in PUBLIC_ROUTES:
            continue
        res = _call(client, method, _fill(path, plan_id))
        if (method, path) in GONE_ROUTES and res.status_code == 410:
            continue
        if res.status_code not in (401, 403):
            problems.append(f"{method} {path} -> {res.status_code}")
    assert not problems, "資格情報なしで 401/403 にならないルート:\n" + "\n".join(problems)


@pytest.mark.parametrize("who", ["member", "guest"])
def test_unrelated_user_cannot_reach_others_plan(client, owner_plan, who):
    _owner_token, plan_id = owner_plan
    token = _register(client) if who == "member" else _guest(client)
    problems = []
    checked = 0
    for method, path in sorted(_all_routes(), key=lambda r: (r[1], r[0])):
        if "{plan_id}" not in path:
            continue
        checked += 1
        res = _call(client, method, _fill(path, plan_id), token=token)
        if (method, path) in GONE_ROUTES and res.status_code == 410:
            continue
        # 422 は要求の形の誤り(本文・必須の検索条件)で、処理に入る前に止まっている。
        # ゲストは会員限定の機能(共有・招待・経路の提案など)では 401 になる。
        allowed = {403, 404, 422}
        if who == "guest":
            allowed.add(401)
        if res.status_code not in allowed:
            problems.append(f"{method} {path} -> {res.status_code}")
    assert checked >= 150, f"plan のルートが少なすぎます({checked})。列挙が壊れていないか確認してください"
    assert not problems, f"{who} が他人のプランで 403/404 にならないルート:\n" + "\n".join(problems)


def test_unrelated_user_cannot_touch_others_plan_even_with_valid_body(client, owner_plan):
    """本文の形が正しくても、他人のプランの主な書き込み口は 403/404 で止まる(422 で隠れていないこと)。"""
    _owner_token, plan_id = owner_plan
    token = _register(client)
    h = {"Authorization": f"Bearer {token}"}
    cases = [
        ("PUT", f"/api/v1/travel-plans/{plan_id}", {"title": "乗っ取り"}),
        ("POST", f"/api/v1/plans/{plan_id}/reservations", {"type": "accommodation"}),
        ("POST", f"/api/v1/plans/{plan_id}/packing-items", {"name": "x"}),
        ("POST", f"/api/v1/plans/{plan_id}/expenses", {"title": "x", "amount": 1, "currency": "JPY"}),
        ("POST", f"/api/v1/plans/{plan_id}/memories", {"kind": "note", "body": "x"}),
        ("POST", f"/api/v1/travel-plans/{plan_id}/share", {"permission": "view"}),
        ("POST", f"/api/v1/travel-plans/{plan_id}/collaborators", {"email": "x@example.com", "role": "editor"}),
        ("DELETE", f"/api/v1/travel-plans/{plan_id}", None),
    ]
    problems = []
    for method, url, body in cases:
        res = client.request(method, url, json=body, headers=h) if body is not None else \
            client.request(method, url, headers=h)
        if res.status_code not in (403, 404):
            problems.append(f"{method} {url} -> {res.status_code} {res.text[:120]}")
    assert not problems, "\n".join(problems)
