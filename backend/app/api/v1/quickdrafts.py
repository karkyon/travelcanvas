"""
[Gate R2-2] `POST /v1/quick-drafts` (DOC-06)。

実URLは既存の全routerと同じく `/api/v1` prefixで公開する(main.pyで
`app.include_router(quickdrafts.router, prefix="/api/v1")`)。DOC-06本文は
「ベース: /api/v1」としつつ、QuickDraftのendpoint表記のみ`/v1/...`という
省略形になっており、既存実装の慣習(全endpointが/api/v1配下)と矛盾する。
本Gateでは実装済みの他routerとの一貫性を優先し、/api/v1/quick-draftsと
する。

promote(`POST /v1/quick-drafts/{id}/promote`)はGate R2-3で追加する。

設計の詳細はdocs/adr/ADR-quick-draft.mdを参照。
"""
import hashlib
import json
import secrets
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import EncryptionNotConfigured, encrypt_payload
from app.core.database import get_db
from app.models.models import Device, QuickDraft
from app.services.quickdraft_idempotency import (
    IdempotencyInProgress,
    IdempotencyKeyReused,
    claim_or_get_cached,
    compute_payload_hash,
    finalize_failure,
    finalize_success,
)
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/quick-drafts", tags=["quickdrafts"])

DEVICE_TOKEN_TTL_DAYS = 30
QUICK_DRAFT_TTL_DAYS = 30
MAX_EVENTS_PER_DRAFT = 100
QUICKDRAFT_ENDPOINT = "POST /v1/quick-drafts"


# ==========================================
# エラー: application/problem+json (DOC-06準拠、本2 endpointのみ新規導入)
# ==========================================

class QuickDraftProblemError(Exception):
    """main.pyへ登録した専用exception_handlerがapplication/problem+jsonへ
    変換する(既存の{"error":{...}}形式は変更しない、既存Gateへの影響を
    避けるための意図的なスコープ限定)。"""

    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def _problem(status_code: int, code: str, message: str) -> QuickDraftProblemError:
    return QuickDraftProblemError(status_code, code, message)


# ==========================================
# スキーマ
# ==========================================

class QuickDraftEventIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    local_date: Optional[date_cls] = None
    start_time: Optional[str] = Field(None, max_length=5)  # "HH:MM"
    description: Optional[str] = Field(None, max_length=2000)


class QuickDraftCreateRequest(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    start_date: date_cls
    end_date: date_cls
    events: List[QuickDraftEventIn] = Field(default_factory=list)

    @field_validator("end_date")
    @classmethod
    def _end_after_start(cls, v, info):
        start = info.data.get("start_date")
        if start is not None and v < start:
            raise ValueError("end_date must be on/after start_date")
        return v

    @field_validator("events")
    @classmethod
    def _events_limit(cls, v):
        if len(v) > MAX_EVENTS_PER_DRAFT:
            raise ValueError(f"events must not exceed {MAX_EVENTS_PER_DRAFT} items")
        return v


class QuickDraftResponse(BaseModel):
    id: str
    revision: int
    status: str
    expires_at: datetime
    title: Optional[str] = None
    start_date: date_cls
    end_date: date_cls
    events: List[QuickDraftEventIn]
    device_token: Optional[str] = None  # 新規device発行時(bootstrap)のみ含む


# ==========================================
# Anonymous device token (Authorization: Bearer <device-token>)
# ==========================================

def _hash_device_token(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def _get_or_create_device(authorization: Optional[str], db: Session):
    """戻り値: (Device, new_token_or_None)。new_tokenはbootstrap時のみ非None。
    無効/失効/期限切れのtokenが明示された場合はQuickDraftProblemErrorを送出する。
    """
    now = datetime.now(timezone.utc)

    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() != "bearer" or not value:
            raise _problem(401, "AUTH_REQUIRED", "Authorization header must be 'Bearer <device-token>'")
        digest = _hash_device_token(value.strip())
        device = db.query(Device).filter(Device.token_digest == digest).first()
        if device is None:
            raise _problem(401, "AUTH_REQUIRED", "unknown device token")
        expires_at = device.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if device.revoked_at is not None or expires_at <= now:
            raise _problem(401, "AUTH_REQUIRED", "device token is revoked or expired")
        device.last_seen_at = now
        db.commit()
        return device, None

    # Authorizationヘッダー無し: 新規anonymous deviceを発行する(bootstrap)。
    token = secrets.token_urlsafe(32)
    device = Device(
        token_digest=_hash_device_token(token),
        expires_at=now + timedelta(days=DEVICE_TOKEN_TTL_DAYS),
    )
    db.add(device)
    # [重要] flush()ではなくcommit()する。Idempotency Phase A
    # (claim_or_get_cached)は独立した別コネクション(SessionLocal())で
    # device_idへのFKを伴うINSERTを行うため、ここでcommitして当該device行を
    # 他コネクションから見える状態にしておかないと、FK制約チェックが
    # このrequestのtransaction終了を待って永久にblockする
    # (別コネクション同士のuncommitted行を跨いだ典型的なデッドロック)。
    db.commit()
    db.refresh(device)
    return device, token


# ==========================================
# POST /quick-drafts
# ==========================================

@router.post("", response_model=None, status_code=201)
async def create_quick_draft(
    body: QuickDraftCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    if not idempotency_key:
        raise _problem(400, "INVALID_REQUEST", "Idempotency-Key header is required")

    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(
        f"quickdraft_create:{client_ip}", settings.RATE_LIMIT_QUICKDRAFT_CREATE, 3600
    ):
        raise _problem(429, "RATE_LIMITED", "rate limit exceeded")

    device, new_device_token = _get_or_create_device(authorization, db)

    payload_dict = jsonable_encoder(body)
    payload_hash = compute_payload_hash(payload_dict)

    try:
        outcome, record = claim_or_get_cached(
            db, idempotency_key, QUICKDRAFT_ENDPOINT, payload_hash, device_id=device.id,
        )
    except IdempotencyKeyReused:
        raise _problem(
            409, "IDEMPOTENCY_KEY_REUSED",
            "this Idempotency-Key was already used with a different request body",
        )
    except IdempotencyInProgress:
        raise _problem(
            409, "OPERATION_IN_PROGRESS",
            "a request with this Idempotency-Key is already being processed",
        )

    if outcome == "cached":
        cached_body = dict(record.response_json or {})
        cached_body.pop("device_token", None)  # replayでtokenを再露出しない
        return JSONResponse(status_code=record.response_status or 201, content=cached_body)

    # ここから Phase B (本処理)。SAVEPOINT(db.begin_nested())で囲むことで、
    # ここで例外が起きても外側のtransaction全体(=Phase Aで確定した
    # IN_PROGRESS claim)を巻き込んで巻き戻さない。db.rollback()で外側ごと
    # 戻す設計だと、"claim済みのIN_PROGRESSごと消えてFAILEDへ収束できない"
    # という不具合になる(pytestのdb_session fixtureのように、Sessionが
    # 外部で開始済みのConnection transactionへbindされているケースで顕在化
    # した。実運用のSessionLocal()単体でも、savepoint分離自体は安全側の
    # 設計として妥当)。
    try:
        with db.begin_nested():
            try:
                plaintext = json.dumps(payload_dict, ensure_ascii=False).encode("utf-8")
                ciphertext = encrypt_payload(plaintext)
            except EncryptionNotConfigured:
                raise _problem(
                    503, "TEMPORARILY_UNAVAILABLE",
                    "QuickDraft機能は現在利用できません(暗号化鍵未設定)",
                )

            draft = QuickDraft(
                device_id=device.id,
                payload_ciphertext=ciphertext,
                expires_at=datetime.now(timezone.utc) + timedelta(days=QUICK_DRAFT_TTL_DAYS),
            )
            db.add(draft)
            db.flush()
            db.refresh(draft)

            response_body = {
                "id": str(draft.id),
                "revision": draft.revision,
                "status": draft.status,
                "expires_at": draft.expires_at.isoformat(),
                "title": body.title,
                "start_date": body.start_date.isoformat(),
                "end_date": body.end_date.isoformat(),
                "events": [jsonable_encoder(e) for e in body.events],
            }
            if new_device_token:
                response_body["device_token"] = new_device_token

        # SAVEPOINTはここまでで正常解放(=外側transactionへ統合、まだ物理commit
        # はしていない)。idempotency recordのCOMPLETED反映と合わせてcommitする。
        finalize_success(db, record.id, 201, response_body)
        return JSONResponse(status_code=201, content=response_body)

    except QuickDraftProblemError as e:
        # SAVEPOINTは`with`ブロックを抜ける際に自動rollback済み(draft作成分の
        # みが取り消される。Phase AのIN_PROGRESS claimは外側transactionに残る)。
        finalize_failure(db, record.id, {"code": e.code, "message": e.message})
        raise
    except Exception as e:
        finalize_failure(db, record.id, {"code": "INTERNAL_ERROR", "message": "internal error"})
        raise
