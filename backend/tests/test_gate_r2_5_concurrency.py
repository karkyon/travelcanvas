"""
[Gate R2-5] Idempotencyの並行性(concurrency)テスト。

これまでのGate R2-2テストは「既にIN_PROGRESSのrecordが存在する状態」を
DBへ直接INSERTして再現するシミュレーションだった。本テストは
claim_or_get_cached() を2つの独立したDB接続(SessionLocal()、pytestの
db_session fixtureが使う「外部で開始済みのconnection transaction」とは
別物)から真に同時実行し、部分unique indexによる排他制御が本物の
コネクション競合下でも機能する(片方だけ成功し、もう片方は即座に
競合を検出してblockしない)ことを確認する。

TestClient越しに検証しない理由: tests/conftest.pyのdb_session fixtureは
1テスト内の全リクエストで同一Session(=同一DBコネクション)を共有する
設計であり、SQLAlchemy SessionはスレッドセーフではないためTestClient経由の
真のマルチスレッドテストは不安定になる(実際に試したところ、共有された
Session上で2スレッドが同時にORM操作を行い、想定外のエラーで失敗した)。
そのため、backendコンテナ内で実際に使われるのと同じ`SessionLocal()`を
直接使う。
"""
import hashlib
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.database import SessionLocal
from app.models.models import Device
from app.services.quickdraft_idempotency import (
    IdempotencyInProgress,
    IdempotencyKeyReused,
    claim_or_get_cached,
    compute_payload_hash,
    finalize_success,
)


def _make_device_committed():
    """db_session fixtureとは別の、本当にcommitされるSessionでdeviceを作る
    (他コネクションから見える必要があるため)。"""
    session = SessionLocal()
    try:
        token = secrets.token_urlsafe(16)
        device = Device(
            token_digest=hashlib.sha256(token.encode()).digest(),
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
        session.add(device)
        session.commit()
        session.refresh(device)
        return device.id
    finally:
        session.close()


def test_concurrent_claim_same_key_only_one_claims_immediately():
    """同一key×同一payload_hashで2つの独立コネクションが真に同時に
    claim_or_get_cachedを呼んだ場合、片方だけ"claimed"となり、
    もう片方は即座に(blockせず)IdempotencyInProgressで弾かれることを
    確認する。"""
    device_id = _make_device_committed()
    key = str(uuid.uuid4())
    endpoint = "POST /v1/quick-drafts"
    payload_hash = compute_payload_hash({"title": "並行性テスト"})

    results = []
    barrier = threading.Barrier(2)

    def _attempt():
        session = SessionLocal()
        try:
            barrier.wait(timeout=5)
            try:
                outcome, record = claim_or_get_cached(
                    session, key, endpoint, payload_hash, device_id=device_id,
                )
                results.append(("ok", outcome, record.id))
            except IdempotencyInProgress:
                results.append(("in_progress", None, None))
            except IdempotencyKeyReused:
                results.append(("key_reused", None, None))
        finally:
            session.close()

    threads = [threading.Thread(target=_attempt) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
        assert not t.is_alive(), "スレッドがtimeout内に完了しなかった(blockしている可能性)"

    assert len(results) == 2
    claimed = [r for r in results if r[0] == "ok"]
    blocked = [r for r in results if r[0] == "in_progress"]
    assert len(claimed) == 1, f"results={results}"
    assert len(blocked) == 1, f"results={results}"

    # 後始末: claimしたrecordをCOMPLETEDへ確定させ、DBにIN_PROGRESSのまま
    # 残さない(他テストへの副作用防止)。
    cleanup_session = SessionLocal()
    try:
        finalize_success(cleanup_session, claimed[0][2], 201, {"ok": True})
    finally:
        cleanup_session.close()


def test_concurrent_claim_different_keys_both_succeed_independently():
    """異なるkeyであれば、同時実行でも互いに競合せず両方claimできることを
    確認する(排他制御がkey単位で正しくスコープされていることの確認)。"""
    device_id = _make_device_committed()
    endpoint = "POST /v1/quick-drafts"
    payload_hash = compute_payload_hash({"title": "並行性テスト2"})

    results = []
    barrier = threading.Barrier(2)

    def _attempt(key):
        session = SessionLocal()
        try:
            barrier.wait(timeout=5)
            outcome, record = claim_or_get_cached(
                session, key, endpoint, payload_hash, device_id=device_id,
            )
            results.append((outcome, record.id))
        finally:
            session.close()

    key_a, key_b = str(uuid.uuid4()), str(uuid.uuid4())
    threads = [
        threading.Thread(target=_attempt, args=(key_a,)),
        threading.Thread(target=_attempt, args=(key_b,)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
        assert not t.is_alive()

    assert len(results) == 2
    assert all(outcome == "claimed" for outcome, _ in results)

    cleanup_session = SessionLocal()
    try:
        for _, record_id in results:
            finalize_success(cleanup_session, record_id, 201, {"ok": True})
    finally:
        cleanup_session.close()
