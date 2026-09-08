"""
[Gate R2-2] Idempotency 2段階commitヘルパー(docs/adr/ADR-quick-draft.md 決定事項5)。

Phase A: request scopeのSessionでIN_PROGRESSを即commitして「予約」する。
Phase B: 呼び出し側が本処理(business logic)を同じSession上で実行する。
Phase C: 結果をCOMMITTED/FAILEDとして反映する(同じSessionで別途commit)。

同一Session上であっても、Phase Aを個別にcommitすることが重要である:
1リクエスト内の一連の処理を最後まで1つのtransactionにまとめてしまうと、
同時に届いた別リクエスト(別Session/別コネクション)が本リクエストの
commit完了を待ってblockしてしまい、「処理中は即409 OPERATION_IN_PROGRESS」
という契約(DOC-06 §22.3)を満たせない。Phase Aだけを独立commitすることで、
後続requestは(自分のIN_PROGRESS INSERTがunique constraintに弾かれることで)
概ね即座に競合を検出できる。

このモジュールはuser_id/device_idどちらのactorにも対応する
(idempotency_records の部分unique index 2本、Gate R2-1参照)。

[設計変更履歴] 初版は独立した`SessionLocal()`を都度生成する設計だったが、
このリポジトリのpytest fixture(`db_session`、tests/conftest.py)が外部で
既に開始済みのconnection transactionへSessionをbindする方式のため、
別Sessionからは同一トランザクション内のuncommitted行(例: 直前に作成した
device)が見えず、外部キー制約違反を「一意制約違反(=処理中)」と誤認して
しまう不具合が発生した。実運用ではrequestごとに独立したSessionLocal()が
払い出されるため本来問題にならないが、テスト環境依存の落とし穴を避ける
ため、呼び出し元のSession(FastAPIのDepends(get_db)で払い出される、
requestスコープのSession)をそのまま受け取って使う設計へ変更した。
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import IdempotencyRecord

IDEMPOTENCY_TTL_DAYS = 7
STALE_IN_PROGRESS_MINUTES = 15


class IdempotencyKeyReused(Exception):
    """同一key・異payload。呼び出し側は409 IDEMPOTENCY_KEY_REUSEDへ変換する。"""


class IdempotencyInProgress(Exception):
    """同一key・同payloadが処理中。呼び出し側は409 OPERATION_IN_PROGRESSへ変換する。"""


def compute_payload_hash(payload: dict) -> bytes:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_unique_violation(exc: IntegrityError) -> bool:
    """psycopg2のSQLSTATE 23505(unique_violation)かどうかを判定する。
    23503(foreign_key_violation)等、他の整合性エラーまで「処理中」として
    握りつぶさないための区別(これを区別しないと、実際のFK不整合のような
    本物のバグが誤って409へすり替わってしまう)。"""
    pgcode = getattr(getattr(exc, "orig", None), "pgcode", None)
    return pgcode == "23505"


def claim_or_get_cached(
    db: Session,
    key: str,
    endpoint: str,
    payload_hash: bytes,
    *,
    user_id=None,
    device_id=None,
) -> Tuple[str, IdempotencyRecord]:
    """Phase A。戻り値は ("claimed", record) または ("cached", record)。
    "cached"の場合、呼び出し側は本処理を行わず record.response_status /
    record.response_json をそのまま返すこと。
    IdempotencyKeyReused / IdempotencyInProgress を送出することがある。
    """
    if not key:
        raise ValueError("Idempotency-Key is required")
    if not user_id and not device_id:
        raise ValueError("user_id or device_id is required")

    record = IdempotencyRecord(
        key=key,
        endpoint=endpoint,
        payload_hash=payload_hash,
        status="IN_PROGRESS",
        user_id=user_id,
        device_id=device_id,
        expires_at=_now() + timedelta(days=IDEMPOTENCY_TTL_DAYS),
    )
    try:
        # SAVEPOINTで囲み、unique違反時にoutside(呼び出し元が積んでいるかも
        # しれない他の変更)を巻き込んでrollbackしないようにする。
        with db.begin_nested():
            db.add(record)
            db.flush()
        db.commit()
        db.refresh(record)
        return "claimed", record
    except IntegrityError as exc:
        if not _is_unique_violation(exc):
            # FK違反等、idempotency競合とは無関係な整合性エラーはそのまま
            # 呼び出し元へ伝播させる(誤って409へすり替えない)。
            raise

        query = db.query(IdempotencyRecord).filter(
            IdempotencyRecord.key == key,
            IdempotencyRecord.endpoint == endpoint,
        )
        if user_id:
            query = query.filter(IdempotencyRecord.user_id == user_id)
        else:
            query = query.filter(IdempotencyRecord.device_id == device_id)
        existing = query.first()

        if existing is None:
            # 理論上到達しない(unique制約違反したのに見つからない)。
            # 安全側に倒し、処理中として扱う。
            raise IdempotencyInProgress()

        if existing.status == "IN_PROGRESS":
            created = existing.created_at
            if created and created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            age = _now() - created if created else timedelta(0)
            if age > timedelta(minutes=STALE_IN_PROGRESS_MINUTES):
                # crash recovery: 放置されたIN_PROGRESSをFAILEDへ強制遷移し、
                # 今回のrequestで再試行を許可する。
                if existing.payload_hash != payload_hash:
                    raise IdempotencyKeyReused()
                existing.status = "IN_PROGRESS"
                existing.expires_at = _now() + timedelta(days=IDEMPOTENCY_TTL_DAYS)
                db.commit()
                db.refresh(existing)
                return "claimed", existing
            raise IdempotencyInProgress()

        if existing.status == "FAILED":
            if existing.payload_hash != payload_hash:
                raise IdempotencyKeyReused()
            existing.status = "IN_PROGRESS"
            existing.expires_at = _now() + timedelta(days=IDEMPOTENCY_TTL_DAYS)
            db.commit()
            db.refresh(existing)
            return "claimed", existing

        # COMPLETED
        if existing.payload_hash != payload_hash:
            raise IdempotencyKeyReused()
        return "cached", existing


def finalize_success(db: Session, record_id, response_status: int, response_json: dict) -> None:
    record = db.query(IdempotencyRecord).filter(IdempotencyRecord.id == record_id).first()
    if record:
        record.status = "COMPLETED"
        record.response_status = response_status
        record.response_json = response_json
        db.commit()


def finalize_failure(db: Session, record_id, error_json: dict) -> None:
    record = db.query(IdempotencyRecord).filter(IdempotencyRecord.id == record_id).first()
    if record:
        record.status = "FAILED"
        record.error_json = error_json
        db.commit()
