"""
[Gate R3-6/M5/M7] FR-013文書ウォレット API(documents/document_links)。

[Gate M7 改訂 2026-09-13] 2026-09-13監査(P0-01/P0-02/P0-03)により、
以下の安全化を行った。詳細な設計判断はdocs/adr/ADR-documents-minimal.md
「Gate M7改訂」を参照。

- 旧`POST /{plan_id}/documents`(クライアント指定storage_keyを受理する
  metadata登録API)は、Gate M5でサーバー生成型upload APIへ信頼境界を
  移行した後も公開されたままであり、他文書のstorage_keyを指定した
  偽装metadata作成を許していた(P0-01)。本Gateで410 Goneとして閉鎖する。
- `storage_key`は内部参照であり、利用者に返す必要がないため通常の
  `DocumentResponse`から除外する(P0-02)。
- classification="restricted"の文書は、明示的なdocument単位の権限grant
  domainが現行に存在しないため、安全側の既定値として文書のowner本人
  (`owner_user_id`)のみが閲覧・ダウンロード・リンク操作できることとし、
  他のplan viewer/editorには存在・件数・ファイル名・download URLの
  いずれも一覧・詳細・リンク経路から漏らさない(存在しないdocument_idと
  区別できない404で応答する)(P0-03)。plan owner自身がRESTRICTED文書の
  owner_user_idでない場合も同様に404となる(誤って曖昧なplan owner特権を
  発明しない)。

権限(DOC-04 §9 SC-11マトリクスに準拠。documentsはplan単位の資源):
- 作成(アップロード)/更新/削除: owner/editor
- 閲覧(一覧・詳細): viewer以上、ただしRESTRICTED文書は上記の通り
  document owner本人限定。original_filenameはDOC-11 §2で「権限」表示に
  分類されており(confirmation_number/pin/ticket payloadのような明示
  revealを要求する"reveal"表示ではない)、閲覧権限がある場合は通常表示する。
"""
import re
from datetime import datetime, timezone as dt_timezone
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
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
    DocumentPurgeStatus,
    Reservation,
    Ticket,
    TravelEvent,
    User,
)
from app.services.audit_service import record_audit_event
from app.services.storage_backend import (
    DownloadSigningNotConfigured,
    DownloadTokenInvalid,
    FileTooLargeError,
    UnsupportedFileTypeError,
    compute_sha256,
    generate_storage_key,
    get_storage_backend,
    issue_download_token,
    load_decrypted_file,
    save_encrypted_file,
    validate_upload,
    verify_download_token,
)

router = APIRouter(prefix="/plans", tags=["documents"])

_VALID_CLASSIFICATIONS = {c.value for c in DocumentClassification}
_VALID_RELATION_TYPES = {r.value for r in DocumentLinkRelationType}
_VALID_ENTITY_TYPES = {"reservation", "ticket", "event", "attachment"}


def _is_document_owner(d: Document, user: User) -> bool:
    return d.owner_user_id is not None and str(d.owner_user_id) == str(user.id)


def _document_visible_to(d: Document, user: User) -> bool:
    """[Gate M7 P0-03] classification="restricted"の文書はdocument owner
    本人にのみ可視とする(明示的なdocument単位grant domainが無いため、
    安全側の既定値としてowner-onlyを採用する)。それ以外のclassification
    は既存通りplanロール(viewer以上)のみで可視とする。"""
    if d.classification != DocumentClassification.RESTRICTED.value:
        return True
    return _is_document_owner(d, user)


def _build_content_disposition(filename: str) -> str:
    """[Gate M7 P1-01] 復号済みfilenameをそのままheaderへ組み立てると、
    CR/LFによるheader injectionや非ASCII文字の不正なエンコードが起こり
    得た。RFC 6266 / RFC 5987相当の形式(ASCII fallback + filename*)で
    安全に組み立てる。"""
    cleaned = (filename or "document").replace("\r", "").replace("\n", "")
    ascii_fallback = cleaned.encode("ascii", "replace").decode("ascii").replace('"', "_")
    ascii_fallback = re.sub(r"[\x00-\x1f\x7f]", "_", ascii_fallback).strip() or "document"
    encoded = quote(cleaned, safe="")
    return f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded}'


# ==========================================
# スキーマ
# ==========================================

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
    """[Gate M7 P0-02] `storage_key`は内部のObject Storage参照であり、
    利用者への公開に必要な情報ではない(ダウンロードは署名付きURL経由の
    `download-url`/`download`エンドポイントで完結する)ため、通常の
    レスポンスからは意図的に除外する。"""
    id: str
    plan_id: str
    owner_user_id: Optional[str]
    classification: str
    document_type: Optional[str]
    original_filename: Optional[str]
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


def _get_document_or_404(db: Session, plan_id, document_id, current_user: User) -> Document:
    """[Gate M7 P0-03] RESTRICTED文書をdocument owner以外から隠すため、
    可視性チェックに失敗した場合も「存在しない」場合と同一の404を返す
    (存在の有無・件数・classificationを外部から推測できないようにする)。"""
    d = (
        db.query(Document)
        .filter(Document.id == document_id, Document.plan_id == plan_id, Document.deleted_at.is_(None))
        .first()
    )
    if d is None or not _document_visible_to(d, current_user):
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

@router.post("/{plan_id}/documents", status_code=status.HTTP_410_GONE, include_in_schema=False)
def create_document_deprecated(plan_id: str):
    """[Gate M7 P0-01是正] 旧metadata登録API(クライアントが`storage_key`/
    MIME/size/sha256を自由に指定できた)は、Gate M5でサーバー生成型
    upload API(`POST .../documents/upload`)へ信頼境界を移行した後も
    公開されたままであり、他文書のstorage_keyを指定した偽装metadata
    作成や、宣言値と実体が一致しないmetadata登録を許していた。

    本Gateで通常利用を410 Goneとして閉鎖する。内部移行専用の代替経路は
    現行コードベースに利用実績が無いため新設しない
    (docs/adr/ADR-documents-minimal.md「Gate M7改訂」参照)。
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail=(
            "このエンドポイントは廃止されました。"
            "POST /api/v1/plans/{plan_id}/documents/upload を使用してください。"
        ),
    )


@router.post(
    "/{plan_id}/documents/upload", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED
)
async def upload_document(
    plan_id: str,
    request: Request,
    file: UploadFile = File(...),
    classification: str = Form(DocumentClassification.INTERNAL.value),
    document_type: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """[Gate M5] FR-013 Object Storage実連携。実ファイルを受け取り、
    ローカルディスク(既定backend)へFernet暗号化して保存する。
    `storage_key`/`mime_type`/`size`/`sha256`はすべて実ファイル内容から
    算出し、クライアント入力を信頼しない(既存の`POST .../documents`
    (storage_key等をクライアントが指定するメタデータのみ登録用)とは
    別の、実アップロード専用エンドポイント。詳細はADR-object-storage.md
    参照)。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")

    if classification not in _VALID_CLASSIFICATIONS:
        raise HTTPException(
            status_code=422,
            detail=f"classificationは次のいずれかである必要があります: {sorted(_VALID_CLASSIFICATIONS)}",
        )

    content = await file.read()

    try:
        ext, mime_type = validate_upload(file.filename or "", content)
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail=str(e))
    except UnsupportedFileTypeError as e:
        raise HTTPException(status_code=422, detail=str(e))

    storage_key = generate_storage_key(plan.id, ext)
    backend = get_storage_backend()

    try:
        save_encrypted_file(backend, storage_key, content)
    except EncryptionNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ファイルの暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )

    d = Document(
        plan_id=plan.id,
        owner_user_id=current_user.id,
        classification=classification,
        document_type=document_type,
        storage_key=storage_key,
        mime_type=mime_type,
        size=len(content),
        sha256=compute_sha256(content),
        malware_status=DocumentMalwareStatus.NOT_SCANNED.value,
        ocr_status=DocumentOcrStatus.NOT_REQUESTED.value,
    )

    try:
        d.original_filename_ciphertext = encrypt_payload((file.filename or "unknown").encode("utf-8"))
    except EncryptionNotConfigured:
        backend.delete(storage_key)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ファイル名の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )

    db.add(d)
    db.commit()
    db.refresh(d)

    record_audit_event(
        action="document_uploaded",
        resource_type="document",
        user_id=current_user.id,
        resource_id=d.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "classification": d.classification, "size": d.size},
    )

    return _to_response(d)


@router.get("/{plan_id}/documents/{document_id}/download-url", response_model=dict)
def get_document_download_url(
    plan_id: str,
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    """[Gate M5] DOC-02 FR-013「期限付きURL」対応。ACL確認は本エンドポイント
    (通常のplan権限)でのみ行い、発行されたトークン自体は
    `GET /documents/download`で単独検証される(トークンにACL情報は
    含めず、発行時点のACLチェックとTTLで安全性を担保する設計)。"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    d = _get_document_or_404(db, plan.id, document_id, current_user)

    try:
        token, expires_at = issue_download_token(d.id)
    except DownloadSigningNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ダウンロードURLが設定されていません(サーバー側のDOCUMENT_DOWNLOAD_SIGNING_KEY未設定)",
        )

    return {"url": f"/api/v1/plans/documents/download?token={token}", "expires_at": expires_at}


@router.get("/documents/download")
def download_document(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """[Gate M5] 署名付きトークンによる期限付きダウンロード。トークン
    自体が発行時点のACLチェック済みの証跡であるため、本エンドポイントは
    再度plan権限を確認しない(トークンの有効期限とHMAC署名のみで安全性を
    担保する、S3署名付きURLと同じ設計思想)。

    [Gate M7 P1-02] 成功・失敗いずれもaudit_logsへ記録するが、token文字列
    やstorage_key、filenameといった機微値はdetailsへ含めない
    (resource_id=document_idのみを記録し、再度検索可能な形に留める)。"""
    try:
        document_id = verify_download_token(token)
    except DownloadTokenInvalid as e:
        record_audit_event(
            action="document_download_denied",
            resource_type="document",
            ip_address=_client_ip(request),
            user_agent=_user_agent(request),
            details={"reason": "invalid_token"},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except DownloadSigningNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ダウンロードURLが設定されていません(サーバー側のDOCUMENT_DOWNLOAD_SIGNING_KEY未設定)",
        )

    d = db.query(Document).filter(Document.id == document_id, Document.deleted_at.is_(None)).first()
    if d is None:
        record_audit_event(
            action="document_download_denied",
            resource_type="document",
            resource_id=document_id,
            ip_address=_client_ip(request),
            user_agent=_user_agent(request),
            details={"reason": "not_found"},
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文書が見つかりません")

    backend = get_storage_backend()
    try:
        content = load_decrypted_file(backend, d.storage_key)
    except EncryptionNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ファイルの復号が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )
    except FileNotFoundError:
        record_audit_event(
            action="document_download_denied",
            resource_type="document",
            resource_id=d.id,
            ip_address=_client_ip(request),
            user_agent=_user_agent(request),
            details={"reason": "file_missing"},
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ファイル本体が見つかりません")

    filename = "document"
    if d.original_filename_ciphertext:
        try:
            filename = decrypt_payload(d.original_filename_ciphertext).decode("utf-8")
        except (EncryptionNotConfigured, ValueError):
            pass

    record_audit_event(
        action="document_downloaded",
        resource_type="document",
        resource_id=d.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(d.plan_id)},
    )

    def _iter():
        yield content

    return StreamingResponse(
        _iter(),
        media_type=d.mime_type or "application/octet-stream",
        headers={"Content-Disposition": _build_content_disposition(filename)},
    )


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
    # [Gate M7 P0-03] RESTRICTED文書はdocument owner本人以外の一覧から除外する
    # (件数・ファイル名も含め、非ownerには一切露出しない)。
    return [_to_response(d) for d in rows if _document_visible_to(d, current_user)]


@router.get("/{plan_id}/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    plan_id: str,
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    d = _get_document_or_404(db, plan.id, document_id, current_user)
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
    d = _get_document_or_404(db, plan.id, document_id, current_user)
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
    d = _get_document_or_404(db, plan.id, document_id, current_user)
    _require_if_match(d, if_match)

    d.deleted_at = datetime.now(dt_timezone.utc)
    d.revision += 1
    db.commit()

    # [Gate M7 P0-04] soft delete直後に実storage fileの削除を試みる。
    # 失敗してもDBの論理削除自体は既に確定させ、purge_statusをpendingの
    # ままにしておくことで、後から`scripts/run_document_purge.py`が
    # 再試行できるようにする(即時失敗でユーザー操作自体を失敗させない)。
    # ファイル不在は成功として扱う(idempotent)。
    backend = get_storage_backend()
    try:
        backend.delete(d.storage_key)
        d.purge_status = DocumentPurgeStatus.PURGED.value
    except (OSError, ValueError):
        d.purge_status = DocumentPurgeStatus.FAILED.value
    db.commit()

    record_audit_event(
        action="document_deleted",
        resource_type="document",
        user_id=current_user.id,
        resource_id=d.id,
        ip_address=_client_ip(request),
        user_agent=_user_agent(request),
        details={"plan_id": str(plan.id), "purge_status": d.purge_status},
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
    d = _get_document_or_404(db, plan.id, document_id, current_user)
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
    d = _get_document_or_404(db, plan.id, document_id, current_user)
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
    d = _get_document_or_404(db, plan.id, document_id, current_user)
    link = _get_link_or_404(db, d.id, link_id)

    db.delete(link)
    db.commit()
    return None
