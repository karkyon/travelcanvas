"""[Gate B1] FR-042 外部連携の API(OAuth 2.0 client_credentials のトークンと、組織の配布版の読み取り)。

- `POST /oauth/token`(RFC 6749 §4.4。application/x-www-form-urlencoded、クライアントの資格は HTTP Basic か本文)。
  成功は {access_token, token_type: "Bearer", expires_in, scope}。失敗は RFC の {error} 形式(invalid_client は 401)。
- `GET /ext/distributions`・`/ext/distributions/{id}`(scope distributions:read)、
  `GET /ext/distributions/{id}/acknowledgements`(scope acknowledgements:read。件数だけ、誰が確認したかは返さない)。
- 外部 API は読み取りだけで、組織の配布版の写しだけを返す(個人の旅行・予約・メンバーの個人情報は返さない)。
- 回数制限: トークンは接続元ごと1分20回、外部 API はクライアントごと1分120回。応答は no-store。
- 監査: クライアント ID と経路の型だけ(トークン・秘密・内容は残さない)。

[Gate G2] 書き込み(scope distributions:write):
- `PATCH /ext/distributions/{id}`(題名・お知らせ)・`POST …/revise`(元の旅行から写し直して版を上げる)・
  `POST …/revoke`(配布をやめる)。
- `Idempotency-Key` が必須(同じキーの再送は同じ応答を返し、`Idempotent-Replayed: true` を付ける。経路・本文が違えば 422)。
- 版を変える操作は `If-Match: "<版>"` が必須(無ければ 428、違えば 412)。読み取りの応答は `ETag` を返す。
- 個人の旅行・予約・メンバーの個人情報は外部から書き換えられない。
"""
import base64
import binascii
import json
import re
import uuid
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Organization, OrgApiClient, OrgDistribution, TravelPlan
from app.ops.metrics import route_template
from app.services import org_api, organizations as orgs
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(tags=["external-api"])
NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}
TOKEN_RATE = 20
API_RATE = 120


def _oauth_error(error: str, status: int = 400, description: Optional[str] = None) -> JSONResponse:
    body = {"error": error}
    if description:
        body["error_description"] = description
    headers = dict(NO_STORE)
    if status == 401:
        headers["WWW-Authenticate"] = 'Basic realm="travelcanvas"'
    return JSONResponse(status_code=status, content=body, headers=headers)


def _basic(request: Request) -> Tuple[Optional[str], Optional[str]]:
    h = request.headers.get("authorization") or ""
    if not h.lower().startswith("basic "):
        return None, None
    try:
        raw = base64.b64decode(h[6:].strip(), validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return None, None
    if ":" not in raw:
        return None, None
    cid, secret = raw.split(":", 1)
    return cid, secret


@router.post("/oauth/token")
async def token(request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"oauth_token:{ip}", TOKEN_RATE, 60):
        return _oauth_error("slow_down", 429, "しばらく待ってから再試行してください")
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ctype != "application/x-www-form-urlencoded":
        return _oauth_error("invalid_request", 400, "application/x-www-form-urlencoded で送ってください")
    form = await request.form()
    if form.get("grant_type") != "client_credentials":
        return _oauth_error("unsupported_grant_type")
    cid, secret = _basic(request)
    if cid is None:
        cid, secret = form.get("client_id"), form.get("client_secret")
    client = org_api.verify_client(db, str(cid or ""), str(secret or ""))
    if not client:
        return _oauth_error("invalid_client", 401)
    org = db.query(Organization).filter(Organization.id == client.organization_id,
                                        Organization.deleted_at.is_(None)).first()
    if not org:
        return _oauth_error("invalid_client", 401)
    requested = form.get("scope")
    try:
        scopes = org_api.clean_scopes(str(requested), client.scopes) if requested else list(client.scopes)
    except ValueError:
        return _oauth_error("invalid_scope")
    raw, tok = org_api.issue_token(db, client, scopes)
    db.commit()
    record_audit_event(action="org_api_token_issued", resource_type="organization", resource_id=org.id,
                       ip_address=ip, details={"api_client": client.client_id, "scopes": scopes})
    return JSONResponse(content={"access_token": raw, "token_type": "Bearer",
                                 "expires_in": int(org_api.TOKEN_TTL.total_seconds()), "scope": " ".join(scopes)},
                        headers=NO_STORE)


class ApiError(Exception):
    def __init__(self, status: int, error: str, scope: Optional[str] = None):
        self.status, self.error, self.scope = status, error, scope


def api_error_response(exc: ApiError) -> JSONResponse:
    www = f'Bearer error="{exc.error}"' + (f', scope="{exc.scope}"' if exc.scope else "")
    headers = dict(NO_STORE)
    if exc.status in (401, 403):
        headers["WWW-Authenticate"] = www
    return JSONResponse(status_code=exc.status, content={"error": exc.error}, headers=headers)


def require_scope(scope: str):
    def dep(request: Request, db: Session = Depends(get_db)) -> Tuple[OrgApiClient, Organization]:
        h = request.headers.get("authorization") or ""
        raw = h[7:].strip() if h.lower().startswith("bearer ") else ""
        found = org_api.resolve_token(db, raw)
        if not found:
            raise ApiError(401, "invalid_token")
        tok, client = found
        org = db.query(Organization).filter(Organization.id == client.organization_id,
                                            Organization.deleted_at.is_(None)).first()
        if not org:
            raise ApiError(401, "invalid_token")
        if scope not in (tok.scopes or []):
            raise ApiError(403, "insufficient_scope", scope)
        if not check_rate_limit(f"org_api:{client.client_id}", API_RATE, 60):
            raise ApiError(429, "rate_limited")
        record_audit_event(action="org_api_call", resource_type="organization", resource_id=org.id,
                           ip_address=request.client.host if request.client else None,
                           details={"api_client": client.client_id, "route": route_template(request.scope)})
        return client, org
    return dep


def _ext_dist(d: OrgDistribution, with_snapshot: bool = False) -> dict:
    out = {"id": str(d.id), "title": d.title, "version": d.version, "change_note": d.change_note,
           "published_at": d.published_at.isoformat() if d.published_at else None}
    if with_snapshot:
        out["snapshot"] = d.snapshot
    return out


def _get(db: Session, org: Organization, dist_id: uuid.UUID) -> OrgDistribution:
    d = db.query(OrgDistribution).filter(OrgDistribution.id == dist_id, OrgDistribution.organization_id == org.id,
                                         OrgDistribution.revoked_at.is_(None)).first()
    if not d:
        raise ApiError(404, "not_found")
    return d


@router.get("/ext/distributions")
async def ext_list(ctx=Depends(require_scope("distributions:read")), db: Session = Depends(get_db)):
    _client, org = ctx
    rows = (db.query(OrgDistribution).filter(OrgDistribution.organization_id == org.id,
                                             OrgDistribution.revoked_at.is_(None))
            .order_by(OrgDistribution.published_at.desc()).all())
    return JSONResponse(content={"organization": {"id": str(org.id), "name": org.name},
                                 "distributions": [_ext_dist(d) for d in rows]}, headers=NO_STORE)


def _etag(d: OrgDistribution) -> str:
    return '"%d"' % d.version


@router.get("/ext/distributions/{dist_id}")
async def ext_get(dist_id: uuid.UUID, ctx=Depends(require_scope("distributions:read")), db: Session = Depends(get_db)):
    _client, org = ctx
    d = _get(db, org, dist_id)
    return JSONResponse(content=_ext_dist(d, with_snapshot=True), headers={**NO_STORE, "ETag": _etag(d)})


# ---------- [Gate G2] 書き込み ----------

_IDEM_KEY = re.compile(r"^[A-Za-z0-9._:-]{8,100}$")
_IF_MATCH = re.compile(r'^(?:W/)?"?(\d{1,9})"?$')


async def _json_body(request: Request) -> Dict[str, Any]:
    raw = await request.body()
    if not raw:
        return {}
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ctype != "application/json":
        raise ApiError(415, "unsupported_media_type")
    try:
        body = json.loads(raw)
    except ValueError:
        raise ApiError(400, "invalid_json")
    if not isinstance(body, dict):
        raise ApiError(400, "invalid_json")
    return body


def _require_version(request: Request, d: OrgDistribution) -> None:
    h = (request.headers.get("if-match") or "").strip()
    if not h:
        raise ApiError(428, "if_match_required")
    m = _IF_MATCH.match(h)
    if not m or int(m.group(1)) != d.version:
        raise ApiError(412, "version_mismatch")


class _Write:
    """Idempotency-Key の確認・記録(同じキーの再送は保存した応答をそのまま返す)。"""

    def __init__(self, request: Request, db: Session, client: OrgApiClient, route: str, body: Dict[str, Any]):
        key = (request.headers.get("idempotency-key") or "").strip()
        if not _IDEM_KEY.match(key):
            raise ApiError(400, "idempotency_key_required")
        self.db, self.client, self.key, self.route = db, client, key, route
        self.hash = org_api.payload_hash({"route": route, "body": body, "if_match": request.headers.get("if-match")})
        try:
            self.cached = org_api.idempotency_lookup(db, client, key, route, self.hash)
        except ValueError:
            raise ApiError(422, "idempotency_key_reused")

    def replay(self) -> Optional[JSONResponse]:
        if not self.cached:
            return None
        return JSONResponse(status_code=self.cached.response_status, content=self.cached.response_json,
                            headers={**NO_STORE, "Idempotent-Replayed": "true"})

    def finish(self, status: int, content: Dict[str, Any], headers: Optional[Dict[str, str]] = None) -> JSONResponse:
        org_api.idempotency_store(self.db, self.client, self.key, self.route, self.hash, status, content)
        try:
            self.db.commit()
        except IntegrityError:
            # 同じキーの要求が同時に来た: 先に確定した方の応答を返す(処理は二重にしない)
            self.db.rollback()
            rec = org_api.idempotency_lookup(self.db, self.client, self.key, self.route, self.hash)
            if rec is None:
                raise ApiError(409, "conflict")
            return JSONResponse(status_code=rec.response_status, content=rec.response_json,
                                headers={**NO_STORE, "Idempotent-Replayed": "true"})
        return JSONResponse(status_code=status, content=content, headers={**NO_STORE, **(headers or {})})


def _audit_write(request: Request, client: OrgApiClient, org: Organization, action: str, d: OrgDistribution) -> None:
    record_audit_event(action=action, resource_type="organization", resource_id=org.id,
                       ip_address=request.client.host if request.client else None,
                       details={"api_client": client.client_id, "distribution_id": str(d.id), "version": d.version})


@router.patch("/ext/distributions/{dist_id}")
async def ext_update(dist_id: uuid.UUID, request: Request, ctx=Depends(require_scope("distributions:write")),
                     db: Session = Depends(get_db)):
    client, org = ctx
    body = await _json_body(request)
    w = _Write(request, db, client, "PATCH /ext/distributions/{id}:%s" % dist_id, body)
    if w.replay():
        return w.replay()
    d = _get(db, org, dist_id)
    _require_version(request, d)
    unknown = sorted(set(body) - {"title", "change_note"})
    if unknown or not body:
        raise ApiError(422, "invalid_fields")
    if "title" in body:
        title = body["title"]
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise ApiError(422, "invalid_title")
        d.title = title.strip()
    if "change_note" in body:
        try:
            d.change_note = orgs.clean_note(body["change_note"])
        except Exception:  # noqa: BLE001 - 形式の誤りは 422(内容は返さない)
            raise ApiError(422, "invalid_change_note")
    _audit_write(request, client, org, "org_api_distribution_updated", d)
    return w.finish(200, _ext_dist(d), {"ETag": _etag(d)})


@router.post("/ext/distributions/{dist_id}/revise")
async def ext_revise(dist_id: uuid.UUID, request: Request, background: BackgroundTasks,
                     ctx=Depends(require_scope("distributions:write")), db: Session = Depends(get_db)):
    client, org = ctx
    body = await _json_body(request)
    w = _Write(request, db, client, "POST /ext/distributions/{id}/revise:%s" % dist_id, body)
    if w.replay():
        return w.replay()
    d = _get(db, org, dist_id)
    _require_version(request, d)
    if set(body) - {"change_note"}:
        raise ApiError(422, "invalid_fields")
    plan = None
    if d.source_plan_id is not None:
        plan = db.query(TravelPlan).filter(TravelPlan.id == d.source_plan_id, TravelPlan.deleted_at.is_(None)).first()
    if plan is None:
        raise ApiError(409, "source_plan_gone")
    try:
        note = orgs.clean_note(body.get("change_note"))
    except Exception:  # noqa: BLE001
        raise ApiError(422, "invalid_change_note")
    new = orgs.build_snapshot(db, plan)
    changes = orgs.snapshot_changes(d.snapshot or {}, new)
    d.snapshot, d.version, d.change_note, d.published_at = new, d.version + 1, note, orgs.now()
    ids = org_api.enqueue(db, org.id, "distribution.revised", {"distribution_id": str(d.id), "version": d.version})
    _audit_write(request, client, org, "org_api_distribution_revised", d)
    res = w.finish(200, {**_ext_dist(d), "changes": changes}, {"ETag": _etag(d)})
    background.add_task(org_api.deliver_pending, ids)
    return res


@router.post("/ext/distributions/{dist_id}/revoke")
async def ext_revoke(dist_id: uuid.UUID, request: Request, background: BackgroundTasks,
                     ctx=Depends(require_scope("distributions:write")), db: Session = Depends(get_db)):
    client, org = ctx
    body = await _json_body(request)
    w = _Write(request, db, client, "POST /ext/distributions/{id}/revoke:%s" % dist_id, body)
    if w.replay():
        return w.replay()
    d = _get(db, org, dist_id)
    _require_version(request, d)
    if body:
        raise ApiError(422, "invalid_fields")
    d.revoked_at = orgs.now()
    ids = org_api.enqueue(db, org.id, "distribution.revoked", {"distribution_id": str(d.id), "version": d.version})
    _audit_write(request, client, org, "org_api_distribution_revoked", d)
    res = w.finish(200, {"id": str(d.id), "version": d.version, "revoked": True})
    background.add_task(org_api.deliver_pending, ids)
    return res


@router.get("/ext/distributions/{dist_id}/acknowledgements")
async def ext_acks(dist_id: uuid.UUID, ctx=Depends(require_scope("acknowledgements:read")),
                   db: Session = Depends(get_db)):
    _client, org = ctx
    d = _get(db, org, dist_id)
    return JSONResponse(content={"distribution_id": str(d.id), "version": d.version, **orgs.ack_status(db, d)},
                        headers=NO_STORE)
