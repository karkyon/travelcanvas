"""[Gate ProviderConnect] 外部 API の鍵の有効性の確認(管理者の明示の操作だけ)。

- 保存・一覧・ページの表示・起動では確認しない(この関数を呼ぶのは運用コンソールの「有効性を確認」の API だけ)
- 確認も実の API の利用。見込みの額を送る前に予約し、管理者の確認の日の枠(全ての提供元の合計・既定 50円/日・
  日本時間の日付)を越える時は送らない。届いたか分からない(時間切れ)時も見込みの額のまま数える
- OpenAI は実際に使う Responses API とモデルで、Google のサーバー用の鍵は Places (Text Search) と Routes を
  それぞれ最小の field mask で確かめる(1つの成功で全部を確認済みにしない)
- 結果は固定のコードだけを残す(提供元の本文・URL・header・鍵は残さない)。確認には期限と設定の hash を付け、
  モデル・送り先・field mask が変わったら以前の確認は使わない
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import ProviderSecret, ProviderSecretVerification
from app.services import cost_guard as cg
from app.services import provider_calls as pc
from app.services import provider_http as ph
from app.services import provider_secrets as ps

JST = timezone(timedelta(hours=9))
PRICE_PROFILE = "explorer"  # 単価は全てのクラスで同じ版。全ての操作を含む版から引く
MIN_INTERVAL_SECONDS = 30   # 同じ鍵の連打を止める(枠とは別)
_LOCK_KEY = 0x7C0FFEE5      # 日の枠の排他(pg_advisory_xact_lock)

Hook = Callable[[Session, Dict[str, Any]], None]


class VerifyError(Exception):
    def __init__(self, code: str, status: int, message: str, extra: Optional[Dict[str, Any]] = None):
        super().__init__(code)
        self.code, self.status, self.message, self.extra = code, status, message, extra or {}


def ops_day(now: Optional[datetime] = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(JST).strftime("%Y-%m-%d")


def daily_cap() -> Decimal:
    return Decimal(int(getattr(settings, "OPS_VERIFY_DAILY_CAP_JPY", 50)))


def used_today(db: Session, day: Optional[str] = None) -> Decimal:
    total = (db.query(func.coalesce(func.sum(ProviderSecretVerification.estimated_cost_jpy), 0))
             .filter(ProviderSecretVerification.ops_day == (day or ops_day())).scalar())
    return Decimal(total or 0)


def budget(db: Session) -> Dict[str, Any]:
    cap, used = daily_cap(), used_today(db)
    note = ("管理者の鍵の確認の日の枠(全ての提供元の合計・日本時間)。旅行の 50円の枠とは別に数える。"
            "届いたか分からない確認も見込みの額のまま数える")
    return {"cap_jpy": cg.money(cap), "used_jpy": cg.money(used),
            "remaining_jpy": cg.money(max(Decimal(0), cap - used)), "day": ops_day(), "note": note}


def estimate(db: Session, slot: str) -> Decimal:
    checks = pc.SLOT_CHECKS.get(slot)
    if not checks:
        raise VerifyError("verify_unsupported", 422, "この鍵はサーバーから確認できません(ブラウザ用の鍵は実際の画面で確かめます)")
    try:
        profile = cg.load_profile(db, PRICE_PROFILE)
        return sum((cg.cost_of(profile, op, cg.normalize_units(op, pc.VERIFY_UNITS[op])) for _p, op in checks),
                   Decimal(0))
    except cg.CostGuardError:
        raise VerifyError("verify_price_unknown", 503, "確認の単価が分からないため、確認しません(料金の分からない確認はしない)")


def verify(db: Session, slot: str, version: Any, reason: str, actor_id: uuid.UUID,
           audit: Optional[Hook] = None) -> Dict[str, Any]:
    """版を確かめて結果を保存する。返す値に鍵は含まない。"""
    if slot not in ps.SLOTS:
        raise VerifyError("unknown_secret_slot", 404, "知らない鍵の種類です")
    if isinstance(version, bool) or not isinstance(version, int):
        raise VerifyError("invalid_version", 422, "確認する版を指定してください")
    cost = estimate(db, slot)
    checks = pc.SLOT_CHECKS[slot]
    try:
        row, key = ps.read_version_for_verify(db, slot, version)
    except ps.SecretUnavailable as error:
        raise VerifyError(error.code, 409 if error.code != "secret_backend_unavailable" else 503,
                          "この版は確認できません(有効な版か候補の版で、取得できる鍵だけ確認します)")
    now = datetime.now(timezone.utc)
    day = ops_day(now)
    # 日の枠と連打の確認・見込みの予約を、排他の中で1つの transaction にする
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
    recent = (db.query(ProviderSecretVerification)
              .filter(ProviderSecretVerification.slot == slot,
                      ProviderSecretVerification.created_at > now - timedelta(seconds=MIN_INTERVAL_SECONDS)).first())
    if recent is not None:  # 何も書いていない(鍵の行の排他は要求の終わりで外れる)
        raise VerifyError("verify_too_frequent", 429, f"同じ鍵の確認は {MIN_INTERVAL_SECONDS}秒あけてください",
                          {"retry_after": MIN_INTERVAL_SECONDS})
    used = used_today(db, day)
    if used + cost > daily_cap():
        raise VerifyError("ops_verify_budget_exceeded", 429,
                          "今日の鍵の確認の枠を越えるため、送りません(日本時間の日付が変わると戻ります)",
                          {"budget": {"cap_jpy": cg.money(daily_cap()), "used_jpy": cg.money(used),
                                      "estimate_jpy": cg.money(cost)}})
    profile = cg.load_profile(db, PRICE_PROFILE)
    records: List[ProviderSecretVerification] = []
    for provider, operation in checks:
        one = cg.cost_of(profile, operation, cg.normalize_units(operation, pc.VERIFY_UNITS[operation]))
        rec = ProviderSecretVerification(id=uuid.uuid4(), slot=slot, version=version, provider=provider,
                                         operation=operation, status="reserved", estimated_cost_jpy=one,
                                         ops_day=day, actor_id=actor_id, reason=reason[:200])
        db.add(rec)
        records.append(rec)
    db.commit()  # 見込みを先に数える(送った後に落ちても枠から消えない)

    results: Dict[str, str] = {}
    for rec in records:
        try:
            resp = pc.verify_request(rec.provider, key)
            code = ph.classify(rec.provider, resp.status, resp.body)
        except ph.ProviderNetworkError as error:
            code = error.code
        results[f"{rec.provider}:{rec.operation}"] = code

    auths = {ph.auth_of(c) for c in results.values()}
    overall = "rejected" if "rejected" in auths else ("inconclusive" if "inconclusive" in auths else "accepted")
    first_bad = next((c for c in results.values() if ph.auth_of(c) == overall and overall != "accepted"), None)
    finished = datetime.now(timezone.utc)
    row = (db.query(ProviderSecret).filter(ProviderSecret.id == row.id).with_for_update().populate_existing().one())
    if row.status in ("active", "pending"):
        row.provider_auth = overall
        row.verify_code = (first_bad or "accepted")[:40]
        row.verified_at = finished
        row.verify_expires_at = (finished + timedelta(hours=int(getattr(settings, "PROVIDER_VERIFY_TTL_HOURS", 72)))
                                 if overall == "accepted" else None)
        row.verified_config = pc.config_hash(slot)
        row.capabilities = results
    for rec in records:
        db.query(ProviderSecretVerification).filter(ProviderSecretVerification.id == rec.id).update(
            {"status": "finished", "result_code": results[f"{rec.provider}:{rec.operation}"][:40],
             "finished_at": finished})
    summary = {"slot": slot, "version": version, "provider_auth": overall, "code": row.verify_code,
               "results": [{"check": k, "code": v, "label": ph.label_of(v)} for k, v in results.items()],
               "estimated_cost_jpy": cg.money(cost)}
    try:
        if audit is not None:
            audit(db, summary)
        db.commit()
    except Exception:  # noqa: BLE001 - 監査が残せない時は確認の結果も保存しない(fail closed)
        db.rollback()
        for rec in records:
            db.query(ProviderSecretVerification).filter(ProviderSecretVerification.id == rec.id).update(
                {"status": "finished", "result_code": "audit_unavailable", "finished_at": finished})
        db.commit()
        raise VerifyError("audit_unavailable", 503, "監査を残せなかったため、確認の結果を保存しませんでした(枠は数えました)")
    summary["verification"] = ps.verification_view(row)
    summary["budget"] = budget(db)
    return summary
