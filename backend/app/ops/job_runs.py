"""[Gate G8] FR-004・O02 定期の処理の実行の記録と、継続して動いているかの判定。

各処理(app/ops/* の jobs と scripts/run_*_purge.py)は ``recorded(job, fn)`` で包んで実行する。始めと終わりの時刻・
成否・件数(数と真偽だけ)を ops_job_runs へ残す。記録に失敗しても処理そのものは止めない(記録の失敗はログに1行)。

    python -m app.ops.job_runs status   # 処理ごとの最後の実行・最後の成功・続けての失敗・遅れ(1行の JSON)

判定(``status``):
- ok: 最後の成功が「間隔×2 + 10分」以内
- overdue: 一度は動いたが、最後の成功からそれより長く経っている(定期実行が止まった・失敗が続いている)
- failing: 最後の実行が失敗(続けての失敗の回数も出す)
- never: 記録が無い(定期実行を登録していない環境。omega-dev2 は Runbook §2.1 で登録する)
30日より古い記録は、その処理の次の実行の時に消す。
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("travelcanvas.ops")

# 処理の名前 → 期待する間隔(分)。opslib.render_cron_block の定期実行と合わせる
EXPECTED_MINUTES: Dict[str, int] = {
    "webhook-retry": 5,
    "poll-deadlines": 15,
    "email-outbox": 5,
    "abuse-scan": 60,
    "memory-trash": 1440,
    "account-deletions": 1440,
    "plan-purge": 1440,
    "document-purge": 1440,
    "quickdraft-purge": 1440,
}
RETENTION_DAYS = 30
GRACE_MINUTES = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _counts(result: Any) -> Dict[str, Any]:
    """件数・真偽だけを残す(名前・ID・本文は残さない)。入れ子は1段まで。"""
    out: Dict[str, Any] = {}
    if not isinstance(result, dict):
        return out
    for k, v in list(result.items())[:30]:
        key = str(k)[:40]
        if isinstance(v, bool) or isinstance(v, int):
            out[key] = v
        elif isinstance(v, dict):
            inner = {str(a)[:40]: b for a, b in list(v.items())[:20] if isinstance(b, (bool, int))}
            if inner:
                out[key] = inner
    return out


def _ok(result: Any) -> bool:
    if isinstance(result, dict):
        if result.get("ok") is False:
            return False
        failed = result.get("failed")
        return not (isinstance(failed, int) and failed > 0)
    return True


def recorded(job: str, fn: Callable[[], Any], session_factory: Optional[Callable[[], Any]] = None) -> Any:
    """fn() を実行し、実行の記録を残す。fn の例外はそのまま上げる(記録は失敗として残す)。"""
    if job not in EXPECTED_MINUTES:
        raise ValueError("unknown job: %s" % job)
    factory = session_factory
    if factory is None:
        from app.core.database import SessionLocal

        factory = SessionLocal
    run_id = None
    started = _now()
    try:
        from app.models.models import OpsJobRun

        db = factory()
        try:
            start_row = OpsJobRun(job=job, started_at=started)
            db.add(start_row)
            db.commit()
            run_id = start_row.id
        finally:
            db.close()
    except Exception as exc:  # 記録の失敗で処理を止めない(migration 前など)
        logger.warning("job run record failed (start): %s", type(exc).__name__)
    error_code: Optional[str] = None
    result: Any = None
    try:
        result = fn()
        return result
    except BaseException as exc:
        error_code = type(exc).__name__[:80]
        raise
    finally:
        if run_id is not None:
            try:
                from app.models.models import OpsJobRun

                db = factory()
                try:
                    row: Any = db.query(OpsJobRun).filter(OpsJobRun.id == run_id).first()
                    if row is not None:
                        row.finished_at = _now()
                        row.ok = error_code is None and _ok(result)
                        row.summary = _counts(result)
                        row.error_code = error_code
                    db.query(OpsJobRun).filter(OpsJobRun.job == job,
                                               OpsJobRun.started_at < _now() - timedelta(days=RETENTION_DAYS)
                                               ).delete(synchronize_session=False)
                    db.commit()
                finally:
                    db.close()
            except Exception as exc:
                logger.warning("job run record failed (finish): %s", type(exc).__name__)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    v = _aware(dt)
    return v.isoformat() if v else None


def status(db: Any, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    from app.models.models import OpsJobRun

    now = now or _now()
    out = []
    for job, minutes in EXPECTED_MINUTES.items():
        rows = (db.query(OpsJobRun).filter(OpsJobRun.job == job).order_by(OpsJobRun.started_at.desc())
                .limit(50).all())
        last = rows[0] if rows else None
        success = next((r for r in rows if r.ok), None)
        if success is None:
            success = (db.query(OpsJobRun).filter(OpsJobRun.job == job, OpsJobRun.ok.is_(True))
                       .order_by(OpsJobRun.started_at.desc()).first())
        failures = 0
        for r in rows:
            if r.ok is False:
                failures += 1
            elif r.ok:
                break
        limit = timedelta(minutes=minutes * 2 + GRACE_MINUTES)
        success_at = _aware(success.finished_at or success.started_at) if success else None
        if last is None:
            state = "never"
        elif success_at is None or now - success_at > limit:
            state = "overdue"
        elif last.ok is False:
            state = "failing"
        else:
            state = "ok"
        out.append({
            "job": job, "expected_minutes": minutes, "state": state,
            "last_started_at": _iso(last.started_at) if last else None,
            "last_finished_at": _iso(last.finished_at) if last else None,
            "last_ok": last.ok if last else None,
            "last_error": last.error_code if last else None,
            "last_summary": last.summary if last else None,
            "last_success_at": _iso(success_at),
            "minutes_since_success": int((now - success_at).total_seconds() // 60) if success_at else None,
            "consecutive_failures": failures,
        })
    return out


def main(argv: Optional[List[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] != ["status"]:
        print("usage: python -m app.ops.job_runs status", file=sys.stderr)
        return 2
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        jobs = status(db)
    finally:
        db.close()
    print(json.dumps({"ok": True, "jobs": jobs}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
