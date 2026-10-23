"""[Gate G5] BILL-02 使用量の上限(利用者・組織ごと、月ごと)。

- 指標(METRICS): upload_bytes(文書・記録のアップロードの量)・imports(取込の作成)・route_requests(移動の候補の作成)・
  share_links(共有の発行)・distributions(組織の配布の公開。組織に数える)。
- 上限: hard(越える要求は 429 quota_exceeded で断り、その操作は何も変えない)と soft(hard の SOFT_RATIO。越えたら
  warning を返し、初めて越えた時に warned_at を記録する)。既定は DEFAULT_LIMITS、設定 USAGE_LIMITS(JSON)で
  {"user": {"imports": 500}, "org": {...}} のように上書きできる。管理者は利用者・組織ごとに override_limit を理由つきで
  上書きできる(監査に残す)。
- 原子性: 行を INSERT ... ON CONFLICT DO NOTHING で用意してから、
  ``UPDATE ... SET used = used + n WHERE ... AND used + n <= 上限 RETURNING`` の1文で確かめて足す。同時の要求でも上限を越えない。
  呼び出した操作と同じトランザクションの中で数えるので、操作が失敗して巻き戻れば数も戻る。
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import UsageCounter

METRICS = ("upload_bytes", "imports", "route_requests", "share_links", "distributions")
SUBJECTS = ("user", "org")
SOFT_RATIO = 0.8
MAX_LIMIT = 10 ** 15
DEFAULT_LIMITS: Dict[str, Dict[str, int]] = {
    "user": {"upload_bytes": 5 * 1024 ** 3, "imports": 300, "route_requests": 3000, "share_links": 300,
             "distributions": 0},
    "org": {"upload_bytes": 50 * 1024 ** 3, "imports": 3000, "route_requests": 30000, "share_links": 3000,
            "distributions": 1000},
}
LABELS = {"upload_bytes": "アップロードの量", "imports": "取込", "route_requests": "移動の候補の作成",
          "share_links": "共有リンクの発行", "distributions": "組織の配布"}


class QuotaExceeded(Exception):
    def __init__(self, metric: str, limit: int, used: int):
        super().__init__(metric)
        self.metric, self.limit, self.used = metric, limit, used


def period(now: Optional[datetime] = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")


def _configured() -> Dict[str, Dict[str, int]]:
    raw = (getattr(settings, "USAGE_LIMITS", "") or "").strip()
    out = {k: dict(v) for k, v in DEFAULT_LIMITS.items()}
    if not raw:
        return out
    try:
        data = json.loads(raw)
    except ValueError:
        return out
    if not isinstance(data, dict):
        return out
    for subject, metrics in data.items():
        if subject not in out or not isinstance(metrics, dict):
            continue
        for metric, value in metrics.items():
            if metric in METRICS and isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_LIMIT:
                out[subject][metric] = value
    return out


def default_limit(subject_type: str, metric: str) -> int:
    return _configured()[subject_type][metric]


def _check(subject_type: str, metric: str) -> None:
    if subject_type not in SUBJECTS or metric not in METRICS:
        raise ValueError("unknown usage key")


def consume(db: Session, subject_type: str, subject_id, metric: str, amount: int = 1,
            now: Optional[datetime] = None) -> Dict[str, Any]:
    """上限の中なら amount を足して {used, limit, warning} を返す。越えるなら QuotaExceeded(何も変えない)。"""
    _check(subject_type, metric)
    if amount < 0:
        raise ValueError("amount must be >= 0")
    p = period(now)
    key = {"t": subject_type, "s": uuid.UUID(str(subject_id)), "m": metric, "p": p}
    db.execute(text(
        "INSERT INTO usage_counters (id, subject_type, subject_id, metric, period, used, updated_at) "
        "VALUES (:id, :t, :s, :m, :p, 0, now()) "
        "ON CONFLICT (subject_type, subject_id, metric, period) DO NOTHING"), {"id": uuid.uuid4(), **key})
    limit = default_limit(subject_type, metric)
    row = db.execute(text(
        "UPDATE usage_counters SET used = used + :n, updated_at = now() "
        "WHERE subject_type = :t AND subject_id = :s AND metric = :m AND period = :p "
        "AND used + :n <= COALESCE(override_limit, :lim) "
        "RETURNING used, COALESCE(override_limit, :lim) AS lim, warned_at"),
        {**key, "n": int(amount), "lim": limit}).first()
    if row is None:
        cur = db.execute(text(
            "SELECT used, COALESCE(override_limit, :lim) FROM usage_counters "
            "WHERE subject_type = :t AND subject_id = :s AND metric = :m AND period = :p"),
            {**key, "lim": limit}).first()
        raise QuotaExceeded(metric, int(cur[1]) if cur else limit, int(cur[0]) if cur else 0)
    used, lim = int(row[0]), int(row[1])
    warning = lim > 0 and used >= lim * SOFT_RATIO
    if warning and row[2] is None:
        db.execute(text(
            "UPDATE usage_counters SET warned_at = now() "
            "WHERE subject_type = :t AND subject_id = :s AND metric = :m AND period = :p"), key)
    return {"metric": metric, "used": used, "limit": lim, "warning": warning}


def quota_error(e: QuotaExceeded, subject_label: str = "この月") -> HTTPException:
    return HTTPException(status_code=429, detail={
        "code": "quota_exceeded",
        "message": (f"{subject_label}の{LABELS[e.metric]}の上限に達しました。"
                    "来月まで待つか、管理者に上限の見直しを依頼してください"),
        "metric": e.metric, "limit": e.limit, "used": e.used,
    })


def charge(db: Session, subject_type: str, subject_id, metric: str, amount: int = 1) -> Dict[str, Any]:
    """API から使う: 上限を越えたら 429(quota_exceeded)。"""
    try:
        return consume(db, subject_type, subject_id, metric, amount)
    except QuotaExceeded as e:
        raise quota_error(e, "今月" if subject_type == "user" else "組織の今月")


def summary(db: Session, subject_type: str, subject_id, now: Optional[datetime] = None) -> Dict[str, Any]:
    _check(subject_type, METRICS[0])
    p = period(now)
    found: List[Any] = db.query(UsageCounter).filter(
        UsageCounter.subject_type == subject_type, UsageCounter.subject_id == uuid.UUID(str(subject_id)),
        UsageCounter.period == p).all()
    rows: Dict[str, Any] = {r.metric: r for r in found}
    metrics: List[Dict[str, Any]] = []
    for metric in METRICS:
        r = rows.get(metric)
        base = default_limit(subject_type, metric)
        if subject_type == "user" and metric == "distributions":
            continue
        limit = int(r.override_limit) if r is not None and r.override_limit is not None else base
        used = int(r.used) if r is not None else 0
        metrics.append({
            "metric": metric, "label": LABELS[metric], "used": used, "limit": limit,
            "soft_limit": int(limit * SOFT_RATIO), "remaining": max(limit - used, 0),
            "warning": limit > 0 and used >= limit * SOFT_RATIO, "exceeded": used >= limit,
            "overridden": r is not None and r.override_limit is not None,
            "override_reason": r.override_reason if r is not None else None,
        })
    return {"subject_type": subject_type, "subject_id": str(subject_id), "period": p, "metrics": metrics}


def set_override(db: Session, subject_type: str, subject_id, metric: str, limit: Optional[int],
                 reason: Optional[str], admin_id, now: Optional[datetime] = None) -> None:
    """管理者の上書き(limit=None で既定に戻す)。理由は必須(戻す時は不要)。"""
    _check(subject_type, metric)
    p = period(now)
    sid = uuid.UUID(str(subject_id))
    row: Any = db.query(UsageCounter).filter(
        UsageCounter.subject_type == subject_type, UsageCounter.subject_id == sid, UsageCounter.metric == metric,
        UsageCounter.period == p).with_for_update().first()
    if row is None:
        row = UsageCounter(id=uuid.uuid4(), subject_type=subject_type, subject_id=sid, metric=metric, period=p, used=0)
        db.add(row)
    row.override_limit = limit
    row.override_reason = reason if limit is not None else None
    row.override_by_user_id = admin_id if limit is not None else None
    row.updated_at = now or datetime.now(timezone.utc)
    db.flush()
