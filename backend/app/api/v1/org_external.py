"""[Gate B1] FR-042 外部連携の API(OAuth 2.0 client_credentials のトークンと、組織の配布版の読み取り)。

- `POST /oauth/token`(RFC 6749 §4.4。application/x-www-form-urlencoded、クライアントの資格は HTTP Basic か本文)。
  成功は {access_token, token_type: "Bearer", expires_in, scope}。失敗は RFC の {error} 形式(invalid_client は 401)。
- `GET /ext/distributions`・`/ext/distributions/{id}`(scope distributions:read)、
  `GET /ext/distributions/{id}/acknowledgements`(scope acknowledgements:read。件数だけ、誰が確認したかは返さない)。
- 外部 API は読み取りだけで、組織の配布版の写しだけを返す(個人の旅行・予約・メンバーの個人情報は返さない)。
- 回数制限: トークンは接続元ごと1分20回、外部 API はクライアントごと1分120回。応答は no-store。
- 監査: クライアント ID と経路の型だけ(トークン・秘密・内容は残さない)。
"""
import base64
import binascii
import uuid
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Organization, OrgApiClient, OrgDistribution
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


@router.get("/ext/distributions/{dist_id}")
async def ext_get(dist_id: uuid.UUID, ctx=Depends(require_scope("distributions:read")), db: Session = Depends(get_db)):
    _client, org = ctx
    return JSONResponse(content=_ext_dist(_get(db, org, dist_id), with_snapshot=True), headers=NO_STORE)


@router.get("/ext/distributions/{dist_id}/acknowledgements")
async def ext_acks(dist_id: uuid.UUID, ctx=Depends(require_scope("acknowledgements:read")),
                   db: Session = Depends(get_db)):
    _client, org = ctx
    d = _get(db, org, dist_id)
    return JSONResponse(content={"distribution_id": str(d.id), "version": d.version, **orgs.ack_status(db, d)},
                        headers=NO_STORE)
