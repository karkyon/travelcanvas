"""[Gate G3] SEC-F5 旅行ごと・利用者ごとのデータ鍵(DEK)と、鍵の破棄による削除(cryptographic erasure)。

- 鍵は対象(``("plan", 旅行のID)``・``("user", 利用者のID)``)ごとに1つ。初めて暗号化する時に作る。
- 鍵そのものは ENCRYPTION_KEY(鍵を包む鍵、KEK)で包んで ``data_keys.wrapped_key_ciphertext`` に持つ。
  ENCRYPTION_KEY を切り替えると `tcops.py keys rekey` が包み直す(データの暗号文は掛け直さなくてよい)。
- 旅行の完全削除・アカウントの削除で ``destroy`` する: 包んだ鍵を消し(NULL)、破棄した日時と理由だけを残す。
  その鍵の暗号文は DB にもバックアップにも残っていても読めない(バックアップの鍵の写しは app/ops/key_escrow.py が消す)。
- 鍵の読み書きは、呼び出し元の DB のセッションとは別の接続で行い、すぐ確定する(作った鍵が要求の取り消しで
  消えて、暗号文だけが残ることを防ぐ)。破棄は呼び出し元のセッションで行う(データの削除と同時に確定する)。
- 外した鍵は、このプロセスの記憶(最大 CACHE_SECONDS 秒)からもすぐ消す。
"""
import threading
import time
import uuid
from typing import Any, Dict, Iterable, Optional, Tuple

from cryptography.fernet import Fernet
from sqlalchemy import text
from sqlalchemy.orm import Session

SUBJECT_TYPES = ("plan", "user")
CACHE_SECONDS = 300.0

Subject = Tuple[str, str]

_lock = threading.Lock()
_by_subject: Dict[Subject, Tuple[str, Fernet, float]] = {}
_by_id: Dict[str, Tuple[Fernet, float]] = {}


class DataKeyDestroyed(ValueError):
    """鍵を破棄した(または鍵が無い)ため、その暗号文は読めない。"""


def subject(kind: str, ident: object) -> Optional[Subject]:
    """対象を作る。ID が無い・読めない時は None(呼び出し側は ENCRYPTION_KEY だけで暗号化する)。"""
    if kind not in SUBJECT_TYPES or ident is None:
        return None
    try:
        return (kind, str(uuid.UUID(str(ident))))
    except (ValueError, TypeError):
        return None


def _engine() -> Any:
    from app.core.database import engine

    return engine


def _wrap(raw_key: bytes) -> bytes:
    from app.core.crypto import _get_fernet

    return _get_fernet().encrypt(raw_key)


def _unwrap(wrapped: bytes) -> Fernet:
    from app.core.crypto import _get_fernet

    return Fernet(_get_fernet().decrypt(bytes(wrapped)))


def reset_cache() -> None:
    with _lock:
        _by_subject.clear()
        _by_id.clear()


def _forget(dek_ids: Iterable[Any]) -> None:
    with _lock:
        for dek_id in dek_ids:
            _by_id.pop(dek_id, None)
        for k in [k for k, v in _by_subject.items() if v[0] in set(dek_ids)]:
            _by_subject.pop(k, None)


def active_key(subj: Subject) -> Tuple[str, Fernet]:
    """対象の使える鍵(無ければ作る)。戻り値は (鍵の ID の16進, Fernet)。"""
    now = time.monotonic()
    with _lock:
        hit = _by_subject.get(subj)
        if hit and hit[2] > now:
            return hit[0], hit[1]
    kind, ident = subj
    with _engine().begin() as conn:
        row = conn.execute(
            text("SELECT id, wrapped_key_ciphertext FROM data_keys "
                 "WHERE subject_type = :t AND subject_id = :s AND destroyed_at IS NULL"),
            {"t": kind, "s": ident}).first()
        if row is None:
            raw = Fernet.generate_key()
            conn.execute(
                text("INSERT INTO data_keys (id, subject_type, subject_id, wrapped_key_ciphertext) "
                     "VALUES (:id, :t, :s, :w) "
                     "ON CONFLICT (subject_type, subject_id) WHERE destroyed_at IS NULL DO NOTHING"),
                {"id": uuid.uuid4(), "t": kind, "s": ident, "w": _wrap(raw)})
            row = conn.execute(
                text("SELECT id, wrapped_key_ciphertext FROM data_keys "
                     "WHERE subject_type = :t AND subject_id = :s AND destroyed_at IS NULL"),
                {"t": kind, "s": ident}).first()
    dek_id = uuid.UUID(str(row[0])).hex
    f = _unwrap(row[1])
    with _lock:
        _by_subject[subj] = (dek_id, f, now + CACHE_SECONDS)
        _by_id[dek_id] = (f, now + CACHE_SECONDS)
    return dek_id, f


def key_for(dek_id: str) -> Fernet:
    """鍵の ID から鍵を読む。破棄した・無い鍵は DataKeyDestroyed。"""
    now = time.monotonic()
    with _lock:
        hit = _by_id.get(dek_id)
        if hit and hit[1] > now:
            return hit[0]
    try:
        ident = uuid.UUID(dek_id)
    except ValueError as e:
        raise DataKeyDestroyed("データ鍵の ID が壊れています") from e
    with _engine().connect() as conn:
        row = conn.execute(text("SELECT wrapped_key_ciphertext, destroyed_at FROM data_keys WHERE id = :id"),
                           {"id": ident}).first()
    if row is None:
        raise DataKeyDestroyed("データ鍵がありません")
    if row[1] is not None or row[0] is None:
        raise DataKeyDestroyed("データ鍵は破棄されました")
    f = _unwrap(row[0])
    with _lock:
        _by_id[dek_id] = (f, now + CACHE_SECONDS)
    return f


def key_state(dek_id: str) -> str:
    """'active'(読める)・'destroyed'(破棄した)・'missing'(記録が無い)。"""
    try:
        ident = uuid.UUID(dek_id)
    except ValueError:
        return "missing"
    with _engine().connect() as conn:
        row = conn.execute(text("SELECT destroyed_at FROM data_keys WHERE id = :id"), {"id": ident}).first()
    if row is None:
        return "missing"
    return "destroyed" if row[0] is not None else "active"


def destroy(db: Session, kind: str, ident: object, reason: str) -> int:
    """対象の鍵を破棄する(呼び出し元のセッションで。確定は呼び出し元)。破棄した鍵の数を返す。"""
    subj = subject(kind, ident)
    if subj is None:
        return 0
    rows = db.execute(
        text("UPDATE data_keys SET wrapped_key_ciphertext = NULL, destroyed_at = now(), destroy_reason = :r "
             "WHERE subject_type = :t AND subject_id = :s AND destroyed_at IS NULL RETURNING id"),
        {"r": (reason or "erased")[:40], "t": subj[0], "s": subj[1]}).fetchall()
    ids = [uuid.UUID(str(r[0])).hex for r in rows]
    _forget(ids)
    with _lock:
        _by_subject.pop(subj, None)
    return len(ids)
