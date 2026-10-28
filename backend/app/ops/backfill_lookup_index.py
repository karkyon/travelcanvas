"""[Gate C2 v2] 盲検索の索引(blind index)を作り直す運用の道具。

LOOKUP_INDEX_KEY が未設定のあいだに作られた予約・同行者は、予約番号の完全一致・末尾4文字・同行者の名前の
索引(HMAC)が NULL のまま保存される(作成は止めない設計。app/api/v1/reservations.py)。この状態では
予約番号の末尾検索(情報内検索の「予約」・予約の画面)で見つからない。鍵を設定したあとでこの道具を実行し、
暗号文を復号して索引を埋める。

- 埋めるのは NULL の索引だけ(既にある索引は変えない)。何度実行しても同じ結果になる(冪等)。
- 復号できない行は飛ばして件数だけ数える。値・番号・名前は表示もログもしない(件数だけ)。
- 鍵が無ければ何もせず終了コード 2。

    python -m app.ops.backfill_lookup_index          # 実行して件数を JSON で表示
    python -m app.ops.backfill_lookup_index --check  # 鍵があるかだけを確かめる(終了コード 0/2)
    python -m app.ops.backfill_lookup_index --all    # [Gate G1] LOOKUP_INDEX_KEY を替えた後: 全ての索引を作り直す
"""
import json
import sys
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.crypto import (
    LookupIndexNotConfigured, compute_lookup_hash, compute_participant_name_lookup_hash, compute_suffix_lookup_hash,
    decrypt_payload,
)


def key_configured() -> bool:
    try:
        compute_lookup_hash("CHECK")
        return True
    except LookupIndexNotConfigured:
        return False


def _plain(ciphertext: Optional[bytes]) -> Optional[str]:
    if not ciphertext:
        return None
    try:
        return decrypt_payload(bytes(ciphertext)).decode("utf-8")
    except Exception:  # noqa: BLE001 - 復号できない行は数えるだけ
        return ""


def backfill(db: Session, recompute: bool = False) -> Dict[str, int]:
    """``recompute=True``(--all)は、既にある索引も今の LOOKUP_INDEX_KEY で作り直す(鍵を替えた後)。"""
    from app.models.models import Reservation, ReservationParticipant

    if not key_configured():
        raise LookupIndexNotConfigured("LOOKUP_INDEX_KEY が設定されていません")
    out = {"reservations_filled": 0, "participants_filled": 0, "undecryptable": 0}
    query = db.query(Reservation).filter(Reservation.confirmation_number_ciphertext.isnot(None))
    if not recompute:
        query = query.filter(
            (Reservation.confirmation_number_lookup_hash.is_(None))
            | (Reservation.confirmation_number_suffix_lookup_hash.is_(None)))
    rows = query.all()
    for r in rows:
        raw = _plain(r.confirmation_number_ciphertext)
        if not raw:
            out["undecryptable"] += 1
            continue
        changed = False
        if recompute or r.confirmation_number_lookup_hash is None:
            full = compute_lookup_hash(raw)
            changed = changed or full != r.confirmation_number_lookup_hash
            r.confirmation_number_lookup_hash = full
        if recompute or r.confirmation_number_suffix_lookup_hash is None:
            suffix = compute_suffix_lookup_hash(raw)
            if suffix or recompute:
                changed = changed or suffix != r.confirmation_number_suffix_lookup_hash
                r.confirmation_number_suffix_lookup_hash = suffix
        out["reservations_filled"] += int(changed)
    pq = db.query(ReservationParticipant).filter(ReservationParticipant.name_ciphertext.isnot(None))
    if not recompute:
        pq = pq.filter(ReservationParticipant.name_lookup_hash.is_(None))
    people = pq.all()
    for p in people:
        raw = _plain(p.name_ciphertext)
        if raw == "":
            out["undecryptable"] += 1
            continue
        if raw:
            new = compute_participant_name_lookup_hash(raw)
            if new != p.name_lookup_hash:
                p.name_lookup_hash = new
                out["participants_filled"] += 1
    db.flush()
    return out


def main(argv: Optional[List[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--check" in args:
        ok = key_configured()
        print(json.dumps({"lookup_index_key": "configured" if ok else "missing"}))
        return 0 if ok else 2
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        try:
            result = backfill(db, recompute="--all" in args)
        except LookupIndexNotConfigured:
            print(json.dumps({"error": "LOOKUP_INDEX_KEY が設定されていません", "ok": False}, ensure_ascii=False))
            return 2
        db.commit()
    finally:
        db.close()
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
