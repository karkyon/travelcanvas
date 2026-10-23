"""[Gate G4] MAP-03 検索のコマンド(FR-009。DOC-04 §2.2 グローバルコマンド)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET  /commands                     : 使えるコマンドの一覧(役割ごとに allowed)
- POST /commands/preview             : 入力(``>予定を追加 11/3 10:00 清水寺``)を読み取り、何をするかを返す。何も変えない
- POST /commands/execute             : 確認の後に実行する。Idempotency-Key(必須。同じキーは同じ結果)・If-Match(旅行の
                                       revision。違えば 409)。予定・日程は変更セット(source=command)に記録する
- POST /commands/{run_id}/undo       : 元に戻す。実行した本人だけ。予定・日程は、その後に別の変更が無い時だけ(あれば 409)。
                                       候補は、予定に置かれていない・まとめられていない時だけ

監査には コマンドの名前・結果だけを残す(予定の名前などの入力値は残さない)。
"""
import uuid
from datetime import date, datetime, timezone as dt_timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import ChangeSet, CommandRun, PlanCandidate, TravelDay, TravelEvent, TravelPlan, User
from app.services import commands as cmds
from app.services import member_policy
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["commands"])


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _audit(action: str, user: User, plan: TravelPlan, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="plan", user_id=user.id, resource_id=plan.id,
                       details={"plan_id": str(plan.id), **details})


def _days(db: Session, plan: TravelPlan):
    return db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()


def _parse(db: Session, plan: TravelPlan, text: str) -> cmds.Parsed:
    days = _days(db, plan)
    dates = [d.local_date for d in days if d.local_date]
    start = plan.start_date.date() if plan.start_date else None
    try:
        return cmds.parse(text, dates, cmds.default_year(dates, start, date.today()))
    except cmds.CommandError as e:
        raise _bad(e.code, str(e))


def _summary(db: Session, plan: TravelPlan, parsed: cmds.Parsed) -> Dict[str, Any]:
    """確認の画面に出す文と、実行できるかどうか(読むだけ)。"""
    c, a = parsed.command, parsed.args
    lines, problem = [], None
    if c.name == "add_event":
        d = date.fromisoformat(str(a["date"]))
        day = db.query(TravelDay).filter(TravelDay.plan_id == plan.id, TravelDay.local_date == d).first()
        when = "(%s から)" % a["time"] if a.get("time") else "(時刻なし)"
        lines.append("%s に予定「%s」を足します%s" % (d.strftime("%m/%d"), a["title"], when))
        if not day:
            problem = ("day_not_found", "%s の日程がありません。先に「>日程を追加 %s」を実行してください"
                       % (d.strftime("%m/%d"), "%d/%d" % (d.month, d.day)))
    elif c.name == "add_day":
        d = date.fromisoformat(str(a["date"]))
        lines.append("%s の日程を足します" % d.isoformat())
        if db.query(TravelDay).filter(TravelDay.plan_id == plan.id, TravelDay.local_date == d).first():
            problem = ("day_exists", "%s の日程はもうあります" % d.isoformat())
    elif c.name == "add_candidate":
        lines.append("候補箱に「%s」を足します" % a["title"])
    elif c.name == "run_validation":
        lines.append("旅程の実行可能性の検証を実行します(旅程は変えません)")
    else:
        lines.append("%s(何も変えません)" % c.label)
    return {"lines": lines, "problem": {"code": problem[0], "message": problem[1]} if problem else None}


def _preview_json(db: Session, plan: TravelPlan, role: str, parsed: cmds.Parsed) -> Dict[str, Any]:
    c = parsed.command
    s = _summary(db, plan, parsed)
    return {
        "command": c.name, "label": c.label, "kind": c.kind, "args": parsed.args, "undoable": c.undoable,
        "allowed": cmds.allowed(c, role),
        "reason": None if cmds.allowed(c, role) else "この旅行では閲覧だけの権限のため、実行できません",
        "needs_confirmation": c.kind != "navigate",
        "summary": s["lines"], "problem": s["problem"],
        "link": c.path.format(plan_id=plan.id) if c.path else None,
        "plan_revision": plan.revision,
    }


@router.get("/{plan_id}/commands")
def list_commands(plan_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return {"commands": cmds.registry(role), "plan_revision": plan.revision}


class PreviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(..., min_length=1, max_length=300)


@router.post("/{plan_id}/commands/preview")
def preview_command(plan_id: str, body: PreviewInput, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return _preview_json(db, plan, role, _parse(db, plan, body.text))


class ExecuteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(..., min_length=1, max_length=300)


def _run_out(run: CommandRun) -> Dict[str, Any]:
    out = dict(run.response_json or {})
    out.update({"run_id": str(run.id), "status": run.status})
    return out


@router.post("/{plan_id}/commands/execute", status_code=201)
async def execute_command(plan_id: str, body: ExecuteInput, db: Session = Depends(get_db),
                          idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                          if_match: Optional[str] = Header(None, alias="If-Match"),
                          current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    key = (idempotency_key or "").strip()
    if not key or len(key) > 100:
        raise _bad("idempotency_key_required", "Idempotency-Key(100文字まで)が必要です", 400)
    done = db.query(CommandRun).filter(CommandRun.user_id == current_user.id,
                                       CommandRun.idempotency_key == key).first()
    if done:
        if done.plan_id != plan.id:
            raise _bad("idempotency_key_reused", "この Idempotency-Key は別の操作に使われています", 409)
        return _run_out(done)
    parsed = _parse(db, plan, body.text)
    c, a = parsed.command, parsed.args
    if not cmds.allowed(c, role):
        raise HTTPException(status_code=403, detail={"code": "command_forbidden",
                                                     "message": "この旅行では閲覧だけの権限のため、実行できません"})
    if c.kind == "navigate":
        raise _bad("command_not_executable", "画面を開くコマンドは実行しません(画面で開いてください)")
    plans_api._require_if_match(plan, if_match)
    problem = _summary(db, plan, parsed)["problem"]
    if problem:
        raise _bad(problem["code"], problem["message"], 409)

    # 実行の記録を先に置く(同じキーの同時の再送は、ここで一意の制約に当たって先の結果を返す。二重に作らない)
    run: Any = CommandRun(plan_id=plan.id, user_id=current_user.id, command=c.name, idempotency_key=key)
    db.add(run)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        done = db.query(CommandRun).filter(CommandRun.user_id == current_user.id,
                                           CommandRun.idempotency_key == key).first()
        if done:
            return _run_out(done)
        raise
    result: Dict[str, Any] = {"command": c.name, "label": c.label, "undoable": c.undoable}
    if c.name == "add_event":
        hidden = member_policy.hidden_for(db, plan, role, current_user)
        member_policy.require_writable(hidden, ["title", "local_start_time"] if a.get("time") else ["title"])
        day: Any = db.query(TravelDay).filter(TravelDay.plan_id == plan.id,
                                              TravelDay.local_date == date.fromisoformat(str(a["date"]))).first()
        ev = TravelEvent(plan_id=plan.id, day_id=day.id, title=str(a["title"]), event_type="activity",
                         local_start_time=a.get("time"),
                         sort_order=db.query(TravelEvent).filter(TravelEvent.day_id == day.id).count())
        db.add(ev)
        db.flush()
        cs = _record(db, plan, current_user, [("travel_event", ev.id, "create", None, plans_api._event_to_dict(ev))])
        run.target_type, run.target_id, run.change_set_id = "travel_event", ev.id, cs.id
        result.update({"message": "予定を足しました", "event_id": str(ev.id), "day_id": str(day.id),
                       "link": "/planner/%s" % plan.id})
    elif c.name == "add_day":
        tz = next((d.timezone_id for d in _days(db, plan) if d.timezone_id), None) or "UTC"
        new_day: Any = TravelDay(plan_id=plan.id, local_date=date.fromisoformat(str(a["date"])), timezone_id=tz,
                                 sort_order=db.query(TravelDay).filter(TravelDay.plan_id == plan.id).count())
        db.add(new_day)
        db.flush()
        cs = _record(db, plan, current_user,
                     [("travel_day", new_day.id, "create", None, plans_api._day_to_dict(new_day))])
        run.target_type, run.target_id, run.change_set_id = "travel_day", new_day.id, cs.id
        result.update({"message": "日程を足しました", "day_id": str(new_day.id), "link": "/planner/%s" % plan.id})
    elif c.name == "add_candidate":
        from app.api.v1 import candidates as candidates_api
        candidates_api._limit(db, plan)
        cand = PlanCandidate(plan_id=plan.id, created_by_user_id=current_user.id,
                             title=candidates_api._guard(lambda: candidates_api.cs.clean_text(
                                 str(a["title"]), 200, "名前", required=True)),
                             source_kind="manual", priority=2, status="open")
        db.add(cand)
        db.flush()
        run.target_type, run.target_id = "plan_candidate", cand.id
        result.update({"message": "候補箱に足しました", "candidate_id": str(cand.id),
                       "link": "/planner/%s/candidates" % plan.id})
    elif c.name == "run_validation":
        from app.api.v1 import validation as validation_api
        vr = validation_api._run_validation(db, plan, current_user)
        run.target_type, run.target_id = "validation_run", vr.id
        result.update({"message": "検証を実行しました", "validation_run_id": str(vr.id),
                       "link": "/planner/%s/constraints" % plan.id})
    db.refresh(plan)
    result["plan_revision"] = plan.revision
    run.response_json = result
    db.add(run)
    db.commit()
    _audit("plan.command.execute", current_user, plan, {"command": c.name, "run_id": str(run.id)})
    return _run_out(run)


def _record(db: Session, plan: TravelPlan, user: User, changes: Any) -> Any:
    plans_api._record_batch_change_and_bump_revision(db, plan, user, "command", changes)
    return (db.query(ChangeSet).filter(ChangeSet.plan_id == plan.id)
            .order_by(ChangeSet.resulting_revision.desc()).first())


async def undo_change_set(db: Session, plan: TravelPlan, user: User, change_set_id, if_match: Optional[str]) -> dict:
    """変更セットを1つ取り消す。旅行の一番新しい(まだ取り消していない)変更の時だけ(後の別の変更を巻き戻さない)。"""
    latest = (db.query(ChangeSet).filter(ChangeSet.plan_id == plan.id, ChangeSet.undone_at.is_(None))
              .order_by(ChangeSet.resulting_revision.desc()).first())
    if latest is None or latest.id != change_set_id:
        raise _bad("undo_not_latest", "この後に別の変更があるため、元に戻せません(変更の履歴から戻してください)", 409)
    return await plans_api.undo_last_change(plan_id=str(plan.id), if_match=if_match, current_user=user, db=db)


@router.post("/{plan_id}/commands/{run_id}/undo")
async def undo_command(plan_id: str, run_id: str, db: Session = Depends(get_db),
                       if_match: Optional[str] = Header(None, alias="If-Match"),
                       current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    try:
        rid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="コマンドの実行が見つかりません")
    run: Any = db.query(CommandRun).filter(CommandRun.id == rid, CommandRun.plan_id == plan.id,
                                           CommandRun.user_id == current_user.id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="コマンドの実行が見つかりません")
    if run.status == "undone":
        raise _bad("already_undone", "もう元に戻しています", 409)
    if not cmds.BY_NAME[run.command].undoable:
        raise _bad("not_undoable", "このコマンドは元に戻せません", 409)
    if run.change_set_id is not None:
        res = await undo_change_set(db, plan, current_user, run.change_set_id, if_match)
        revision = res["revision"]
    else:
        plans_api._require_if_match(plan, if_match)
        cand: Any = db.query(PlanCandidate).filter(PlanCandidate.id == run.target_id,
                                                   PlanCandidate.plan_id == plan.id).first()
        if cand is not None:
            if cand.status != "open" or cand.scheduled_event_id or cand.place_id or db.query(PlanCandidate).filter(
                    PlanCandidate.merged_into_id == cand.id).first():
                raise _bad("undo_conflict", "この候補は後で使われた(予定に置いた・まとめた)ため、元に戻せません", 409)
            db.delete(cand)
        revision = plan.revision
    run.status, run.undone_at = "undone", datetime.now(dt_timezone.utc)
    db.commit()
    _audit("plan.command.undo", current_user, plan, {"command": run.command, "run_id": str(run.id)})
    return {"run_id": str(run.id), "status": "undone", "plan_revision": revision, "message": "元に戻しました"}
