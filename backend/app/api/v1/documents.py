"""
[Gate R3-6] FR-013文書ウォレット 最小実装API(documents/document_links)。

スコープ限定の理由はapp/models/models.pyのDocumentクラス直上コメントと
docs/adr/ADR-reservation-minimal.mdを参照。要旨: Object Storage連携が
未導入のため実ファイルは一切扱わず、storage_key(呼び出し側が別途
アップロード済みのオブジェクトキー)を受け取ってメタデータのみを管理する。

権限(DOC-04 §9 SC-11マトリクスに準拠。documentsはplan単位の資源):
- 作成/更新/削除: owner/editor
- 閲覧(一覧・詳細): viewer以上。classificationに関わらず、本Gateでは
  original_filenameを含め通常表示する(DOC-11 §2でoriginal_filenameは
  "権限"表示に分類されており、confirmation_number/pin/ticket payloadの
  ような明示revealを要求する"reveal"表示ではないため)。
"""
from datetime import datetime, timezone as dt_timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    Document,
    DocumentClassification,
    DocumentLink,
    DocumentLinkRelationType,
    DocumentMalwareStatus,
    DocumentOcrStatus,
    Reservation,
    Ticket,
    TravelEvent,
    User,
)
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["documents"])

_VALID_CLASSIFICATIONS = {c.value for c in DocumentClassification}
_VALID_RELATION_TYPES = {r.value for r in DocumentLinkRelationType}
_VALID_ENTITY_TYPES = {"reservation", "ticket", "event", "attachment"}


# ==========================================
# スキーマ
# ==========================================

class DocumentCreateRequest(BaseModel):
    classification: str = DocumentClassification.INTERNAL.value
    document_type: Optional[str] = Field(None, max_length=100)
    original_filename: str = Field(..., max_length=500)
    storage_key: str = Field(..., max_length=1000)
    mime_type: Optional[str] = Field(None, max_length=255)
    size: Optional[int] = Field(None, ge=0)
    sha256: Optional[str] = Field(None, min_length=64, max_length=64)
    retention_until: Optional[datetime] = None

    @field_validator("classification")
    @classmethod
    def _validate_classification(cls, v: str) -> str:
        if v not in _VALID_CLASSIFICATIONS:
            raise ValueError(f"classificationは次のいずれかである必要があります: {sorted(_VALID_CLASSIFICATIONS)}")
        return v


class DocumentUpdateRequest(BaseModel):
    classification: Optional[str] = None
    document_type: Optional[str] = Field(None, max_length=100)
    original_filename: Optional[str] = Field(None, max_length=500)
    retention_until: Optional[datetime] = None

    @field_validator("classification")
    @classmethod
    def _validate_classification(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_CLASSIFICATIONS:
            raise ValueError(f"classificationは次のいずれかである必要があります: {sorted(_VALID_CLASSIFICATIONS)}")
        return v


class DocumentResponse(BaseModel):
    id: str
    plan_id: str
    owner_user_id: Optional[str]
    classification: str
    document_type: Optional[str]
    original_filename: Optional[str]
    storage_key: str
    mime_type: Optional[str]
    size: Optional[int]
    sha256: Optional[str]
    malware_status: str
    ocr_status: str
    retention_until: Optional[datetime]
    revision: int
    created_at: datetime
    updated_at: Optional[datetime]


class DocumentLinkCreateRequest(BaseModel):
    entity_type: str
    entity_id: str
    relation_type: str = DocumentLinkRelationType.ATTACHMENT.value
    display_order: int = 0

    @field_validator("entity_type")
    @classmethod
    def _validate_entity_type(cls, v: str) -> str:
        if v not in _VALID_ENTITY_TYPES:
            raise ValueError(f"entity_typeは次のいずれかである必要があります: {sorted(_VALID_ENTITY_TYPES)}")
        return v

    @field_validator("relation_type")
    @classmethod
    def _validate_relation_type(cls, v: str) -> str:
        if v not in _VALID_RELATION_TYPES:
            raise ValueError(f"relation_typeは次のいずれかである必要があります: {sorted(_VALID_RELATION_TYPES)}")
        return v


class DocumentLinkResponse(BaseModel):
    id: str
    document_id: str
    entity_type: str
    entity_id: str
    relation_type: str
    display_order: int
    created_at: datetime


# ==========================================
# ヘルパー
# ==========================================

def _to_response(d: Document) -> DocumentResponse:
    filename = None
    if d.original_filename_ciphertext:
        try:
            filename = decrypt_payload(d.original_filename_ciphertext).decode("utf-8")
        except (EncryptionNotConfigured, ValueError):
            filename = None
    return DocumentResponse(
        id=str(d.id),
        plan_id=str(d.plan_id),
        owner_user_id=str(d.owner_user_id) if d.owner_user_id else None,
        classification=d.classification,
        document_type=d.document_type,
        original_filename=filename,
        storage_key=d.storage_key,
        mime_type=d.mime_type,
        size=d.size,
        sha256=d.sha256,
        malware_status=d.malware_status,
        ocr_status=d.ocr_status,
        retention_until=d.retention_until,
        revision=d.revision,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


def _to_link_response(link: DocumentLink) -> DocumentLinkResponse:
    return DocumentLinkResponse(
        id=str(link.id),
        document_id=str(link.document_id),
        entity_type=link.entity_type,
        entity_id=str(link.entity_id),
        relation_type=link.relation_type,
        display_order=link.display_order,
        created_at=link.created_at,
    )


def _get_document_or_404(db: Session, plan_id, document_id) -> Document:
    d = (
        db.query(Document)
        .filter(Document.id == document_id, Document.plan_id == plan_id, Document.deleted_at.is_(None))
        .first()
    )
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文書が見つかりません")
    return d


def _get_link_or_404(db: Session, document_id, link_id) -> DocumentLink:
    link = (
        db.query(DocumentLink)
        .filter(DocumentLink.id == link_id, DocumentLink.document_id == document_id)
        .first()
    )
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文書リンクが見つかりません")
    return link


def _require_if_match(d: Document, if_match: Optional[str]) -> None:
    if if_match is None or if_match.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="If-Matchヘッダーが必要です(現在のリビジョンをGETで取得してから指定してください)",
        )
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="If-Matchの形式が不正です")
    if expected != d.revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"文書が他の変更で更新されています(現在のリビジョン: {d.revision})",
        )


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:255]


def _validate_link_target_exists(db: Session, plan_id, entity_type: str, entity_id: str) -> None:
    """entity_typeが検証可能な種別(reservation/ticket/event)の場合、
    対象が同一plan内に存在することを確認する(誤って他planのリソースへ
    リンクしないためのIDOR対策。event_reservations同様のパターン)。
    attachmentは汎用種別のため検証しない。"""
    if entity_type == "reservation":
        exists = (
            db.query(Reservation)
            .filter(Reservation.id == entity_id, Reservation.plan_id == plan_id, Reservation.deleted_at.is_(None))
            .first()
        )
    elif entity_type == "event":
        exists = (
            db.query(TravelEvent)
            .filter(TravelEvent.id == entity_id, TravelEvent.plan_id == plan_id)
            .first()
        )
    elif entity_type == "ticket":
        exists = (
            db.query(Ticket)
            .join(Reservation, Ticket.reservation_id == Reservation.id)
            .filter(Ticket.id == entity_id, Reservation.plan_id == plan_id, Ticket.deleted_at.is_(None))
            .first()
        )
    else:
        return
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="紐付け先が見つかりません(同一旅行プラン内である必要があります)",
        )


# ==========================================
# エンドポイント: documents
# ==========================================

@router.post("/{plan_id}/documents", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def create_document(
    plan_id: str,
    payload: DocumentCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")

    d = Document(
        plan_id=plan.id,
        owner_user_id=current_user.id,
        classification=payload.classification,
        document_type=payload.document_type,
        storage_key=payload.storage_key,
        mime_type=payload.mime_type,
        size=payload.size,
        sha256=payload.sha256,
        retention_until=payload.retention_until,
        # [スコープ限定] スキャナ・OCR未導入のため常に既定値で作成する
        # (クライアント入力を受け付けない。上部モジュールdocstring参照)。
        malware_status=DocumentMalwareStatus.NOT_SCANNED.value,
        ocr_status=DocumentOcrStatus.NOT_REQUESTED.value,
    )

    try:
        d.original_filename_ciphertext = encrypt_payload(payload.original_filename.encode("utf-8"))
    except EncryptionNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ファイル名の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )

    db.add(d)
    db.commit()
    db.refresh(d)

    record_audit_event(
        action="document_created",
        resource_type="document",
        user_id=current_user.id,
        resource_id=d.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "classification": d.classification},
    )

    return _to_response(d)


@router.get("/{plan_id}/documents", response_model=List[DocumentResponse])
def list_documents(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (
        db.query(Document)
        .filter(Document.plan_id == plan.id, Document.deleted_at.is_(None))
        .order_by(Document.created_at.desc())
        .all()
    )
    return [_to_response(d) for d in rows]


@router.get("/{plan_id}/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    plan_id: str,
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    d = _get_document_or_404(db, plan.id, document_id)
    return _to_response(d)


@router.patch("/{plan_id}/documents/{document_id}", response_model=DocumentResponse)
def update_document(
    plan_id: str,
    document_id: str,
    payload: DocumentUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
    if_match: Optional[str] = Header(None, alias="If-Match"),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    d = _get_document_or_404(db, plan.id, document_id)
    _require_if_match(d, if_match)

    data = payload.model_dump(exclude_unset=True)

    if "original_filename" in data:
        raw = data.pop("original_filename")
        if raw:
            try:
                d.original_filename_ciphertext = encrypt_payload(raw.encode("utf-8"))
            except EncryptionNotConfigured:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="ファイル名の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
                )

    for field, value in data.items():
        setattr(d, field, value)

    d.revision += 1
    db.commit()
    db.refresh(d)

    record_audit_event(
        action="document_updated",
        resource_type="document",
        user_id=current_user.id,
        resource_id=d.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "fields": sorted(data.keys())},
    )

    return _to_response(d)


@router.delete("/{plan_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    plan_id: str,
    document_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
    if_match: Optional[str] = Header(None, alias="If-Match"),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    d = _get_document_or_404(db, plan.id, document_id)
    _require_if_match(d, if_match)

    d.deleted_at = datetime.now(dt_timezone.utc)
    d.revision += 1
    db.commit()

    record_audit_event(
        action="document_deleted",
        resource_type="document",
        user_id=current_user.id,
        resource_id=d.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id)},
    )
    return None


# ==========================================
# エンドポイント: document_links
# ==========================================

@router.post(
    "/{plan_id}/documents/{document_id}/links",
    response_model=DocumentLinkResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_document_link(
    plan_id: str,
    document_id: str,
    payload: DocumentLinkCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    d = _get_document_or_404(db, plan.id, document_id)
    _validate_link_target_exists(db, plan.id, payload.entity_type, payload.entity_id)

    link = DocumentLink(
        document_id=d.id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        relation_type=payload.relation_type,
        display_order=payload.display_order,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _to_link_response(link)


@router.get(
    "/{plan_id}/documents/{document_id}/links",
    response_model=List[DocumentLinkResponse],
)
def list_document_links(
    plan_id: str,
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    d = _get_document_or_404(db, plan.id, document_id)
    rows = (
        db.query(DocumentLink)
        .filter(DocumentLink.document_id == d.id)
        .order_by(DocumentLink.display_order.asc(), DocumentLink.created_at.asc())
        .all()
    )
    return [_to_link_response(link) for link in rows]


@router.delete(
    "/{plan_id}/documents/{document_id}/links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_document_link(
    plan_id: str,
    document_id: str,
    link_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    d = _get_document_or_404(db, plan.id, document_id)
    link = _get_link_or_404(db, d.id, link_id)

    db.delete(link)
    db.commit()
    return None
