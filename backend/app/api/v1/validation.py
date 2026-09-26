"""
[Gate L3] FR-017 実行可能性検証(DOC-02 FR-017 / DOC-06 §9 Validation / DOC-04 SC-15)。

- POST /plans/{plan_id}/validation-runs            検証を実行して結果を保存する(同期、201)
- GET  /plans/{plan_id}/validation-runs            検証履歴(新しい順、問題の一覧は含めない)
- GET  /plans/{plan_id}/validation-runs/{run_id}   検証結果の詳細(問題の一覧を含む)

DOC-06は `GET /validation-runs/{id}` だが、プラン単位の権限検査を他のAPIと揃えるため
プラン配下のパスにした(ADR-feasibility-validation)。検証はDBを変更しない読み取りの
判定なので、viewer以上なら実行できる(結果はプランのメンバー全員が見られる)。

秘匿制約に関する問題:
- 保存時点で制約の値を含めない(feasibility.py)。
- 読出時、作成者本人には制約の題名を付け、他のメンバーには根拠・修正候補も隠す。

入力(旅程・制約・予約・区間)の版の組み合わせ(input_fingerprint)が現在と違えば
is_stale=true を返す(古い結果を最新の判定として見せない)。
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import PlanConstraint, TravelPlan, User, ValidationIssue, ValidationRun
from app.services import feasibility
from app.services.constraint_evaluation import decrypt_private_payload, load_constraints_for_evaluation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plans", tags=["validation"])

# プランごとに残す検証結果の数(古いものから削除する)
MAX_RUNS_PER_PLAN = 20


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _parse_uuid(raw: str, detail: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


# ===== 実行 =====

def _run_validation(db: Session, plan: TravelPlan, user: User) -> ValidationRun:
    started = _utcnow()
    fingerprint = feasibility.compute_fingerprint(db, plan)
    run = ValidationRun(
        plan_id=plan.id, created_by_user_id=user.id, input_revision=plan.revision or 0,
        input_fingerprint=fingerprint, algorithm_version=feasibility.ALGORITHM_VERSION, started_at=started,
        status="completed", summary_json={},
    )
    try:
        snapshot = feasibility.load_snapshot(db, plan)
        constraint_set = load_constraints_for_evaluation(db, plan, at=started)
        rows = {
            c.id: c for c in db.query(PlanConstraint).filter(
                PlanConstraint.id.in_([c.id for c in constraint_set.constraints] + list(constraint_set.unavailable))
            )
        } if (constraint_set.constraints or constraint_set.unavailable) else {}
        titles = {cid: c.title for cid, c in rows.items() if c.privacy_level == "shared" and c.title}
        owners = {cid: c.owner_user_id for cid, c in rows.items()}
        result = feasibility.evaluate(snapshot, constraint_set, titles=titles, unavailable_owners=owners)
    except Exception:  # 判定の不具合で500にせず「検証失敗」として残す(問題なしとは表示しない)
        # 判定は読み取りだけなのでロールバックは不要(呼出側のトランザクションを壊さない)
        logger.exception("feasibility validation failed plan_id=%s", plan.id)
        run.status = "failed"
        run.summary_json = {"unchecked": {}, "constraint_results": []}
        run.finished_at = _utcnow()
        db.add(run)
        db.commit()
        db.refresh(run)
        return run

    private_ids = {c.id for c in constraint_set.constraints if c.is_private} | set(constraint_set.unavailable)
    run.summary_json = {
        "unchecked": result.unchecked,
        "constraint_results": [
            {**r, "is_private": uuid.UUID(r["constraint_id"]) in private_ids,
             "owner_user_id": str(owners.get(uuid.UUID(r["constraint_id"]), ""))}
            for r in result.constraint_results
        ],
    }
    c = feasibility.counts(result.findings)
    run.error_count, run.warning_count = c["error"], c["warning"]
    run.info_count, run.unverified_count = c["info"], c["unverified"]
    for i, f in enumerate(result.findings):
        con = f.constraint
        run.issues.append(ValidationIssue(
            sort_order=i, code=f.code, kind=f.kind, severity=f.severity, message=f.message,
            entity_type=f.entity_type, entity_id=f.entity_id, entity_label=f.entity_label, day_id=f.day_id,
            constraint_id=con.id if con else None,
            constraint_owner_user_id=owners.get(con.id, con.owner_user_id) if con else None,
            is_private_constraint=bool(con and con.is_private),
            evidence_json=f.evidence, suggestion_json=f.suggestion,
        ))
    run.finished_at = _utcnow()
    db.add(run)
    db.flush()
    _prune_old_runs(db, plan.id)
    db.commit()
    db.refresh(run)
    return run


def _prune_old_runs(db: Session, plan_id: uuid.UUID) -> None:
    stale = (
        db.query(ValidationRun)
        .filter(ValidationRun.plan_id == plan_id)
        .order_by(ValidationRun.created_at.desc(), ValidationRun.started_at.desc(), ValidationRun.id.desc())
        .offset(MAX_RUNS_PER_PLAN)
        .all()
    )
    for old in stale:
        db.delete(old)


# ===== レスポンス =====

def _private_titles(db: Session, run: ValidationRun, viewer: User) -> Dict[uuid.UUID, Optional[str]]:
    """閲覧者本人の秘匿制約の題名(復号できなければNone)。"""
    ids = {i.constraint_id for i in run.issues if i.is_private_constraint and i.constraint_owner_user_id == viewer.id}
    ids |= {
        uuid.UUID(r["constraint_id"]) for r in (run.summary_json or {}).get("constraint_results", [])
        if r.get("is_private") and r.get("owner_user_id") == str(viewer.id)
    }
    if not ids:
        return {}
    out: Dict[uuid.UUID, Optional[str]] = {}
    for c in db.query(PlanConstraint).filter(PlanConstraint.id.in_(list(ids))):
        data = decrypt_private_payload(c) if c.privacy_level == "private" else None
        out[c.id] = (data or {}).get("title") if data else None
    return out


def _shared_titles(db: Session, run: ValidationRun) -> Dict[uuid.UUID, Optional[str]]:
    ids = {i.constraint_id for i in run.issues if i.constraint_id and not i.is_private_constraint}
    ids |= {
        uuid.UUID(r["constraint_id"]) for r in (run.summary_json or {}).get("constraint_results", [])
        if not r.get("is_private")
    }
    if not ids:
        return {}
    return {
        c.id: (c.title if c.privacy_level == "shared" else None)
        for c in db.query(PlanConstraint).filter(PlanConstraint.id.in_(list(ids)))
    }


def _counts(run: ValidationRun) -> Dict[str, int]:
    return {"error": run.error_count, "warning": run.warning_count, "info": run.info_count,
            "unverified": run.unverified_count}


def _summary(run: ValidationRun, viewer: User, current_fingerprint: str) -> Dict[str, Any]:
    return {
        "id": str(run.id),
        "plan_id": str(run.plan_id),
        "status": run.status,
        "algorithm_version": run.algorithm_version,
        "input_revision": run.input_revision,
        "is_stale": run.input_fingerprint != current_fingerprint,
        "started_at": _iso(run.started_at),
        "finished_at": _iso(run.finished_at),
        "created_by_me": run.created_by_user_id == viewer.id,
        "counts": _counts(run),
    }


def _issue_response(issue: ValidationIssue, viewer: User, shared: Dict[uuid.UUID, Optional[str]],
                    private: Dict[uuid.UUID, Optional[str]]) -> Dict[str, Any]:
    masked = issue.is_private_constraint and issue.constraint_owner_user_id != viewer.id
    if issue.is_private_constraint:
        title = None if masked else private.get(issue.constraint_id)
    else:
        title = shared.get(issue.constraint_id) if issue.constraint_id else None
    return {
        "id": str(issue.id),
        "code": issue.code,
        "kind": issue.kind,
        "severity": issue.severity,
        "message": issue.message,
        "entity_type": issue.entity_type,
        "entity_id": str(issue.entity_id) if issue.entity_id else None,
        "entity_label": issue.entity_label,
        "day_id": str(issue.day_id) if issue.day_id else None,
        "constraint_id": str(issue.constraint_id) if issue.constraint_id else None,
        "constraint_title": title,
        "is_private_constraint": issue.is_private_constraint,
        "is_masked": masked,
        "evidence": None if masked else issue.evidence_json,
        "suggestion": None if masked else issue.suggestion_json,
    }


def _detail(db: Session, run: ValidationRun, viewer: User, current_fingerprint: str) -> Dict[str, Any]:
    shared = _shared_titles(db, run)
    private = _private_titles(db, run, viewer)
    summary = run.summary_json or {}
    results = []
    for r in summary.get("constraint_results", []):
        cid = uuid.UUID(r["constraint_id"])
        is_private = bool(r.get("is_private"))
        is_mine = r.get("owner_user_id") == str(viewer.id)
        results.append({
            "constraint_id": r["constraint_id"],
            "status": r["status"],
            "is_private": is_private,
            "is_mine": is_mine,
            "constraint_title": (private.get(cid) if is_mine else None) if is_private else shared.get(cid),
        })
    return {
        **_summary(run, viewer, current_fingerprint),
        "unchecked": dict(summary.get("unchecked", {})),
        "constraint_results": results,
        "issues": [_issue_response(i, viewer, shared, private) for i in run.issues],
    }


# ===== エンドポイント =====

@router.post("/{plan_id}/validation-runs", status_code=201, response_model=dict)
def create_validation_run(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    run = _run_validation(db, plan, current_user)
    return _detail(db, run, current_user, feasibility.compute_fingerprint(db, plan))


@router.get("/{plan_id}/validation-runs", response_model=List[dict])
def list_validation_runs(
    plan_id: str,
    limit: int = Query(10, ge=1, le=MAX_RUNS_PER_PLAN),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    fingerprint = feasibility.compute_fingerprint(db, plan)
    runs = (
        db.query(ValidationRun)
        .filter(ValidationRun.plan_id == plan.id)
        .order_by(ValidationRun.created_at.desc(), ValidationRun.started_at.desc(), ValidationRun.id.desc())
        .limit(limit)
        .all()
    )
    return [_summary(r, current_user, fingerprint) for r in runs]


@router.get("/{plan_id}/validation-runs/{run_id}", response_model=dict)
def get_validation_run(
    plan_id: str,
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rid = _parse_uuid(run_id, "検証結果が見つかりません")
    run = db.query(ValidationRun).filter(ValidationRun.id == rid, ValidationRun.plan_id == plan.id).first()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="検証結果が見つかりません")
    return _detail(db, run, current_user, feasibility.compute_fingerprint(db, plan))
