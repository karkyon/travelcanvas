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
from app.models.models import Device, IdempotencyRecord
from app.services.quickdraft_idempotency import (
    IdempotencyInProgress,
    IdempotencyKeyReused,
    claim_or_get_cached,
    compute_payload_hash,
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


@pytest.fixture()
def committed_device_id():
    """[Gate T-R2-5] 本テストはdb_session(ロールバックされる)を使わず本当にcommit
    するため、以前は実行のたびにdevice 1件とCOMPLETEDのidempotency_records
    (既定TTL=7日)がテストDBへ恒久的に残留していた。7日経過するとそれらが
    test_gate_r2_5_purge.pyのpurge対象へ混入し、`idempotency_records_purged == 1`
    等の件数assertを時限的に壊していた(omega-dev2で実際に発生)。
    テスト成否に関わらず、このテストがcommitした行をteardownで物理削除する。"""
    device_id = _make_device_committed()
    try:
        yield device_id
    finally:
        session = SessionLocal()
        try:
            session.query(IdempotencyRecord).filter(
                IdempotencyRecord.device_id == device_id
            ).delete(synchronize_session=False)
            session.query(Device).filter(Device.id == device_id).delete(
                synchronize_session=False
            )
            session.commit()
        finally:
            session.close()


def test_concurrent_claim_same_key_only_one_claims_immediately(committed_device_id):
    """同一key×同一payload_hashで2つの独立コネクションが真に同時に
    claim_or_get_cachedを呼んだ場合、片方だけ"claimed"となり、
    もう片方は即座に(blockせず)IdempotencyInProgressで弾かれることを
    確認する。"""
    device_id = committed_device_id
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
    # 後始末(claimしたrecord・device)はfixture committed_device_idのteardownで
    # 物理削除する(以前はCOMPLETEDへ確定させて残していたため7日後に他テストへ混入した)。


def test_concurrent_claim_different_keys_both_succeed_independently(committed_device_id):
    """異なるkeyであれば、同時実行でも互いに競合せず両方claimできることを
    確認する(排他制御がkey単位で正しくスコープされていることの確認)。"""
    device_id = committed_device_id
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
    # 後始末はfixture committed_device_idのteardownで行う。
