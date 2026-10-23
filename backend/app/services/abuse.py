"""[Gate G4] FC-097 濫用への対応(公開の共有の phishing・malware・spam・scraping)。

- 通報: 公開の共有の画面から誰でも送れる(接続元ごとに1時間 REPORT_LIMIT 件まで)。通報した人は特定しない(接続元の
  sha256 だけ。同じ人の重複を数えないため)
- 自動の失効: 24時間以内に別々の AUTO_REVOKE_REPORTERS 人から phishing・malware の通報があった共有は自動で失効させ
  (revoked_reason=abuse_auto)、所有者に知らせる。管理者は内容を確かめて戻せる(restore)
- 自動の検知(定期実行 tcops jobs abuse-scan、1時間ごと): 1時間に SCRAPING_IPS 以上の接続元から開かれた共有(scraping)、
  合言葉の失敗が PASSCODE_FAILS 回以上(総当たり)、1人が1日に SPAM_SHARES 個以上の共有を作った(spam)、
  感染した文書(malware)を、管理者の確認の一覧(abuse_reports、source=auto)に入れる(同じ物は24時間に1回)
- 管理者の対応: 却下(dismissed)・失効(actioned。共有を revoked_reason=admin_abuse で失効)・失効を戻す
監査には共有の ID・理由・件数だけを残す(URL のトークン・合言葉・旅行の内容・接続元は残さない)。
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import AbuseReport, Document, PlanShareLink, ShareAccessLog, TravelPlan, User
from app.services import notify

REASONS = ("phishing", "malware", "spam", "scraping", "privacy", "other")
REASON_LABEL = {"phishing": "詐欺・なりすまし", "malware": "有害なファイル・リンク", "spam": "迷惑な宣伝",
                "scraping": "大量の自動の閲覧", "privacy": "個人の情報の公開", "other": "その他"}
REPORT_LIMIT = 5
AUTO_REVOKE_REPORTERS = 3
SCRAPING_IPS = 50
PASSCODE_FAILS = 20
SPAM_SHARES = 50
WINDOW = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def reporter_hash(ip: str) -> str:
    return hashlib.sha256(("tc-abuse|" + (ip or "")).encode("utf-8")).hexdigest()


def _notify_owner(db: Session, share: Any, title: str, message: str) -> None:
    plan: Any = db.query(TravelPlan).filter(TravelPlan.id == share.plan_id).first()
    if plan is not None:
        notify.deliver(db, plan, {plan.user_id}, "share_revoked_abuse", title, message, target_type="plan",
                       direct_ids={plan.user_id})


def file_report(db: Session, share: Optional[Any], reason: str, note: Optional[str], ip: str,
                now: Optional[datetime] = None) -> Dict[str, Any]:
    """通報を記録する(共有が無効でも、外からは同じ応答にする)。自動で失効させたら auto_revoked=True。"""
    now = now or _now()
    if share is None:
        return {"recorded": False, "auto_revoked": False}
    rh = reporter_hash(ip)
    db.add(AbuseReport(share_id=share.id, plan_id=share.plan_id, source="report", reason=reason,
                       note=(note or "").strip()[:500] or None, reporter_hash=rh))
    db.flush()
    auto = False
    if reason in ("phishing", "malware") and share.revoked_at is None:
        reporters: Set[Any] = {r[0] for r in db.query(AbuseReport.reporter_hash).filter(
            AbuseReport.share_id == share.id, AbuseReport.source == "report",
            AbuseReport.reason.in_(("phishing", "malware")), AbuseReport.created_at > now - WINDOW).all()}
        if len(reporters) >= AUTO_REVOKE_REPORTERS:
            share.revoked_at, share.revoked_reason = now, "abuse_auto"
            db.add(AbuseReport(share_id=share.id, plan_id=share.plan_id, source="auto", reason=reason,
                               status="actioned", resolution="通報が続いたため自動で失効しました(管理者が確かめます)",
                               handled_at=now))
            _notify_owner(db, share, "共有リンクを一時的に止めました",
                          "この共有リンクに問題の通報が続いたため、自動で止めました。心当たりが無い時はサポートへ連絡してください。")
            auto = True
    db.commit()
    return {"recorded": True, "auto_revoked": auto}


def _recent_auto(db: Session, share_id: Optional[Any], plan_id: Optional[Any], reason: str,
                 now: datetime) -> bool:
    q = db.query(AbuseReport.id).filter(AbuseReport.source == "auto", AbuseReport.reason == reason,
                                        AbuseReport.created_at > now - WINDOW)
    q = q.filter(AbuseReport.share_id == share_id) if share_id else q.filter(AbuseReport.plan_id == plan_id)
    return q.first() is not None


def scan(db: Session, now: Optional[datetime] = None) -> Dict[str, int]:
    now = now or _now()
    out = {"scraping": 0, "passcode_bruteforce": 0, "spam": 0, "malware": 0}
    hour = now - timedelta(hours=1)
    for share_id, ips in (db.query(ShareAccessLog.share_id, func.count(func.distinct(ShareAccessLog.ip_address)))
                          .filter(ShareAccessLog.created_at > hour, ShareAccessLog.result == "success",
                                  ShareAccessLog.share_id.isnot(None))
                          .group_by(ShareAccessLog.share_id).all()):
        if ips >= SCRAPING_IPS and not _recent_auto(db, share_id, None, "scraping", now):
            share: Any = db.query(PlanShareLink).filter(PlanShareLink.id == share_id).first()
            db.add(AbuseReport(share_id=share_id, plan_id=share.plan_id if share else None, source="auto",
                               reason="scraping", note="1時間に %d の接続元から開かれました" % ips))
            out["scraping"] += 1
    for share_id, fails in (db.query(ShareAccessLog.share_id, func.count(ShareAccessLog.id))
                            .filter(ShareAccessLog.created_at > hour, ShareAccessLog.result == "passcode_failed",
                                    ShareAccessLog.share_id.isnot(None))
                            .group_by(ShareAccessLog.share_id).all()):
        if fails >= PASSCODE_FAILS and not _recent_auto(db, share_id, None, "other", now):
            share2: Any = db.query(PlanShareLink).filter(PlanShareLink.id == share_id).first()
            db.add(AbuseReport(share_id=share_id, plan_id=share2.plan_id if share2 else None, source="auto",
                               reason="other", note="1時間に合言葉の失敗が %d 回ありました(総当たりの疑い)" % fails))
            out["passcode_bruteforce"] += 1
    for user_id, n in (db.query(TravelPlan.user_id, func.count(PlanShareLink.id))
                       .join(PlanShareLink, PlanShareLink.plan_id == TravelPlan.id)
                       .filter(PlanShareLink.created_at > now - WINDOW).group_by(TravelPlan.user_id).all()):
        if n >= SPAM_SHARES:
            plan = (db.query(TravelPlan).filter(TravelPlan.user_id == user_id)
                    .order_by(TravelPlan.created_at.desc()).first())
            if plan is not None and not _recent_auto(db, None, plan.id, "spam", now):
                db.add(AbuseReport(plan_id=plan.id, source="auto", reason="spam",
                                   note="1人が24時間に %d 個の共有リンクを作りました" % n))
                out["spam"] += 1
    infected = (db.query(Document.plan_id, func.count(Document.id))
                .filter(Document.malware_status.in_(("infected", "quarantined")), Document.created_at > now - WINDOW)
                .group_by(Document.plan_id).all())
    for plan_id, n in infected:
        if plan_id and not _recent_auto(db, None, plan_id, "malware", now):
            db.add(AbuseReport(plan_id=plan_id, source="auto", reason="malware",
                               note="ウイルスの検査で感染と判定された文書が %d 件あります" % n))
            out["malware"] += 1
    db.commit()
    return out


def _share_out(db: Session, share: Optional[Any]) -> Optional[Dict[str, Any]]:
    if share is None:
        return None
    now = _now()
    return {"id": str(share.id), "token_prefix": share.token_prefix, "plan_id": str(share.plan_id),
            "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None,
            "revoked_reason": share.revoked_reason,
            "is_active": share.revoked_at is None and not (share.expires_at and share.expires_at <= now),
            "use_count": share.use_count, "has_passcode": share.passcode_hash is not None,
            "accesses_24h": db.query(func.count(ShareAccessLog.id)).filter(
                ShareAccessLog.share_id == share.id, ShareAccessLog.created_at > now - WINDOW).scalar() or 0}


def list_reports(db: Session, status: Optional[str], limit: int = 100) -> Dict[str, Any]:
    q = db.query(AbuseReport)
    if status:
        q = q.filter(AbuseReport.status == status)
    rows: List[Any] = q.order_by(AbuseReport.created_at.desc()).limit(limit).all()
    shares = {s.id: s for s in db.query(PlanShareLink).filter(
        PlanShareLink.id.in_([r.share_id for r in rows if r.share_id])).all()} if rows else {}
    plans = {p.id: p for p in db.query(TravelPlan).filter(
        TravelPlan.id.in_([r.plan_id for r in rows if r.plan_id])).all()} if rows else {}
    counts = {s: c for s, c in db.query(AbuseReport.status, func.count(AbuseReport.id)).group_by(AbuseReport.status)}
    items = []
    for r in rows:
        plan = plans.get(r.plan_id)
        items.append({
            "id": str(r.id), "source": r.source, "reason": r.reason,
            "reason_label": REASON_LABEL.get(r.reason, r.reason),
            "note": r.note, "status": r.status, "resolution": r.resolution,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "handled_at": r.handled_at.isoformat() if r.handled_at else None,
            # 管理者には旅行の題名と所有者の ID だけ(中身は support の同意の閲覧(FR-040)で見る)
            "plan": {"id": str(plan.id), "title": plan.title, "owner_user_id": str(plan.user_id)} if plan else None,
            "share": _share_out(db, shares.get(r.share_id)),
        })
    return {"counts": {s: counts.get(s, 0) for s in ("open", "dismissed", "actioned")}, "reports": items}


class AbuseActionError(ValueError):
    def __init__(self, code: str, message: str, status_code: int = 409):
        super().__init__(message)
        self.code, self.status_code = code, status_code


def act(db: Session, report_id: uuid.UUID, admin: User, action: str, note: Optional[str]) -> AbuseReport:
    r: Any = db.query(AbuseReport).filter(AbuseReport.id == report_id).first()
    if r is None:
        raise AbuseActionError("not_found", "通報が見つかりません", 404)
    share: Any = db.query(PlanShareLink).filter(PlanShareLink.id == r.share_id).first() if r.share_id else None
    now = _now()
    if action == "dismiss":
        r.status = "dismissed"
    elif action == "revoke_share":
        if share is None:
            raise AbuseActionError("no_share", "この通報には共有リンクがありません", 422)
        if share.revoked_at is None:
            share.revoked_at, share.revoked_reason = now, "admin_abuse"
            _notify_owner(db, share, "共有リンクを止めました",
                          "この共有リンクは利用の規則に合わないため、管理者が止めました。心当たりが無い時はサポートへ連絡してください。")
        r.status = "actioned"
    elif action == "restore_share":
        if share is None or share.revoked_reason not in ("abuse_auto", "admin_abuse"):
            raise AbuseActionError("not_abuse_revoked", "濫用の対応で止めた共有リンクだけを戻せます")
        share.revoked_at, share.revoked_reason = None, None
        r.status = "dismissed"
    else:
        raise AbuseActionError("invalid_action", "対応は dismiss・revoke_share・restore_share のどれかです", 422)
    r.handled_by_user_id, r.handled_at = admin.id, now
    r.resolution = (note or "").strip()[:500] or r.resolution
    db.commit()
    return r
