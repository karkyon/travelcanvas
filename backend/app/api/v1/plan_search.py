"""
[Gate C3] FR-009 情報内検索・コマンドパレット(DOC-02 FR-009、DOC-04 SC-10・§2.2・§12、app/services/plan_search.py)。

- GET /plans/{plan_id}/search?q=&filter=  : 1つの旅行の中を横断して探す(viewer以上)
- GET /search/everything?q=&filter=       : 参加している全ての旅行を横断して探す(コマンドパレット)

対象: 日程・予定・場所・候補・予約・チケット・文書・費用・メンバー・記録。固定の絞り込み: 今日・予約・チケット・ホテル・緊急。
権限の無いものは結果にも件数にも出さない(SC-10「権限外カテゴリの存在件数も返さない」):
- 機密(restricted)の文書は持ち主だけ。記録は本人の分とメンバーに公開された分だけ。予約番号・PIN・名義・チケットの中身は出さない
- 予約番号の末尾(4文字)は「予約」に絞った時だけ索引で照合し、結果は伏せた番号だけ。文書は復号したファイル名で照合する
検索語は監査・ログに残さない(件数だけ)。回数制限: 利用者ごとに1分60回。
"""
from datetime import date, datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, compute_suffix_lookup_hash, decrypt_payload
from app.core.database import get_db
from app.core.plan_access import require_plan_access, resolve_plan_role
from app.models.models import (
    Document, DocumentClassification, Expense, Memory, Place, PlanCandidate, PlanCollaborator, Reservation, Ticket,
    TravelDay, TravelEvent, TravelPlan, User,
)
from app.services import member_policy, place_access
from app.services import plan_search as ps
from app.utils.rate_limiter import check_rate_limit

plan_router = APIRouter(prefix="/plans", tags=["search"])
global_router = APIRouter(prefix="/search", tags=["search"])

RATE_PER_MINUTE = 60
MAX_PLANS = 50
RESERVATION_TYPE_LABEL = {"accommodation": "宿泊", "flight": "航空", "train": "鉄道", "bus": "バス", "ferry": "船",
                          "rental_car": "レンタカー", "restaurant": "飲食", "activity": "体験", "admission": "入場",
                          "other": "その他"}


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _local_today(tz: Optional[str], now: datetime) -> date:
    try:
        return now.astimezone(ZoneInfo(tz or "UTC")).date()
    except (ZoneInfoNotFoundError, ValueError):
        return now.date()


def _check(q: str, filt: Optional[str]) -> Tuple[str, Optional[str]]:
    q = (q or "").strip()
    if len(q) > ps.MAX_QUERY:
        raise _bad("invalid_field", f"検索語は{ps.MAX_QUERY}文字までです")
    if filt is not None and filt not in ps.FILTERS:
        raise _bad("invalid_field", "絞り込みは 今日・予約・チケット・ホテル・緊急 のいずれかです")
    if not q and not filt:
        raise _bad("invalid_field", "検索語を入れるか、絞り込みを選んでください")
    return q, filt


def _rate(user: User) -> None:
    if not check_rate_limit(f"search:{user.id}", RATE_PER_MINUTE, 60):
        raise HTTPException(status_code=429, detail="検索の回数が多すぎます。少し待ってから再試行してください")


def _hit(cat: str, s: int, id_: Any, title: str, plan: TravelPlan, link: str, subtitle: Optional[str] = None,
         when: Optional[str] = None, badge: Optional[str] = None) -> Dict[str, Any]:
    return {"category": cat, "score": s, "id": str(id_), "title": title, "subtitle": subtitle, "when": when,
            "badge": badge, "plan_id": str(plan.id), "plan_title": plan.title or "(名前なし)", "link": link}


def _search_plan(db: Session, plan: TravelPlan, user: User, q: str, filt: Optional[str],
                 now: datetime) -> Dict[str, List[Dict[str, Any]]]:
    toks = ps.tokens(q)
    pid = plan.id
    base = f"/planner/{pid}"
    allowed = set(ps.FILTER_CATEGORIES[filt]) if filt else set(ps.CATEGORIES)
    out: Dict[str, List[Dict[str, Any]]] = {c: [] for c in allowed}
    # [Gate G2] FR-045 所有者が隠した項目は、結果にも件数にも出さない(照合にも使わない)
    hidden = member_policy.hidden_for(db, plan, resolve_plan_role(db, plan, user), user)
    for cat, key in (("reservation", "reservations"), ("ticket", "tickets"), ("document", "documents"),
                     ("expense", "costs"), ("place", "event_address")):
        if key in hidden:
            allowed.discard(cat)
    ev_addr = (lambda e: None) if "event_address" in hidden else (lambda e: e.address)
    ev_note = (lambda e: None) if "event_notes" in hidden else (lambda e: e.description)
    days = db.query(TravelDay).filter(TravelDay.plan_id == pid).all()
    days_by_id = {d.id: d for d in days}
    plan_today = _local_today(days[0].timezone_id if days else None, now)
    target_day = ps.parse_date_word(q, plan_today, {d.local_date.year for d in days}) if q else None
    today_ids = {d.id for d in days if d.local_date == _local_today(d.timezone_id, now)}

    def when(day_id, time_: Optional[str] = None) -> Optional[str]:
        d = days_by_id.get(day_id)
        return f"{d.local_date.isoformat()}{(' ' + time_) if time_ else ''}" if d else None

    if "day" in allowed:
        for d in days:
            s = 100 if target_day and d.local_date == target_day else ps.score(toks, d.title, [d.notes]) if toks else 0
            if filt == "today":
                s = 100 if d.id in today_ids else 0
            if s:
                label = d.local_date.isoformat() + (f" {d.title}" if d.title else "")
                out["day"].append(_hit("day", s, d.id, label, plan, base))
    if "event" in allowed:
        for e in db.query(TravelEvent).filter(TravelEvent.plan_id == pid).all():
            if e.day_id not in days_by_id:
                continue
            if filt == "today":
                matched = ps.score(toks, e.title, [ev_addr(e), ev_note(e)]) if toks else 50
                s = matched if e.day_id in today_ids else 0
            elif filt == "hotel":
                matched = ps.score(toks, e.title, [ev_addr(e)]) if toks else 50
                s = matched if e.event_type in ps.HOTEL_EVENT_TYPES else 0
            elif filt == "emergency":
                s = 50 if ps.emergency_text(e.title, ev_note(e)) and (not toks or ps.score(toks, e.title)) else 0
            elif target_day:
                s = 90 if days_by_id[e.day_id].local_date == target_day else 0
            else:
                s = ps.score(toks, e.title, [ev_addr(e), ev_note(e)])
            if s:
                out["event"].append(_hit("event", s, e.id, e.title, plan, base, ev_addr(e),
                                         when(e.day_id, e.local_start_time)))
    if "place" in allowed:
        place_ids = {r[0] for r in db.query(TravelEvent.place_id).filter(
            TravelEvent.plan_id == pid, TravelEvent.place_id.isnot(None)).all()}
        place_ids |= {r[0] for r in db.query(PlanCandidate.place_id).filter(PlanCandidate.plan_id == pid,
                                                                            PlanCandidate.place_id.isnot(None)).all()}
        for p in (db.query(Place).filter(Place.id.in_(place_ids)).all() if place_ids else []):
            if filt == "hotel":
                in_hotel = db.query(TravelEvent.id).filter(TravelEvent.plan_id == pid, TravelEvent.place_id == p.id,
                                                           TravelEvent.event_type.in_(ps.HOTEL_EVENT_TYPES)).first()
                s = (ps.score(toks, p.name, [p.address]) if toks else 50) if in_hotel else 0
            elif filt == "emergency":
                s = 50 if ps.emergency_text(p.name, p.category, p.note) else 0
            else:
                s = ps.score(toks, p.name, list(p.aliases or []) + [p.address, p.phone]) if toks else 0
            if s and place_access.can_view(db, p, user):
                out["place"].append(_hit("place", s, p.id, p.name, plan, f"{base}/places/{p.id}", p.address))
    if "candidate" in allowed and toks:
        rows = db.query(PlanCandidate).filter(PlanCandidate.plan_id == pid,
                                              PlanCandidate.merged_into_id.is_(None)).all()
        for c in rows:
            s = ps.score(toks, c.title, [c.note, c.address])
            if s:
                out["candidate"].append(_hit("candidate", s, c.id, c.title, plan, f"{base}/candidates", c.address))
    if "reservation" in allowed:
        suffix_hash = None
        if q and filt == "reservation" and ps.is_suffix_query(q) and "reservation_secrets" not in hidden:
            try:
                suffix_hash = compute_suffix_lookup_hash(q)
            except Exception:  # noqa: BLE001 - 索引の鍵が無い環境では末尾検索をしない
                suffix_hash = None
        for r in db.query(Reservation).filter(Reservation.plan_id == pid, Reservation.deleted_at.is_(None)).all():
            label = RESERVATION_TYPE_LABEL.get(r.type, r.type)
            title = r.provider_name or f"{label}の予約"
            badge = None
            if suffix_hash and r.confirmation_number_suffix_lookup_hash == suffix_hash:
                s, badge = 100, "予約番号の末尾に一致"
            elif filt == "hotel":
                s = (ps.score(toks, title, [r.notes]) if toks else 50) if r.type in ps.HOTEL_RESERVATION_TYPES else 0
            elif filt == "reservation" and not toks:
                s = 50
            else:
                s = ps.score(toks, title, [label, r.notes]) if toks else 0
            if s:
                start = r.start_at.astimezone(ZoneInfo(r.timezone_id)).strftime("%Y-%m-%d %H:%M") \
                    if r.start_at and r.timezone_id else (r.start_at.isoformat()[:16] if r.start_at else None)
                out["reservation"].append(_hit("reservation", s, r.id, title, plan, f"{base}/reservations",
                                               f"{label}・{r.confirmation_number_masked or '番号なし'}", start, badge))
    if "ticket" in allowed:
        res = {r.id: r for r in db.query(Reservation).filter(
            Reservation.plan_id == pid, Reservation.deleted_at.is_(None)).all()}
        for t in (db.query(Ticket).filter(Ticket.reservation_id.in_(list(res)), Ticket.deleted_at.is_(None)).all()
                  if res else []):
            r = res[t.reservation_id]
            title = f"{r.provider_name or RESERVATION_TYPE_LABEL.get(r.type, r.type)}のチケット"
            s = (ps.score(toks, title, [t.ticket_type]) if toks else 50)
            if s:
                out["ticket"].append(_hit("ticket", s, t.id, title, plan, f"{base}/reservations", t.ticket_type))
    if "document" in allowed:
        for d in db.query(Document).filter(Document.plan_id == pid, Document.deleted_at.is_(None)).all():
            if d.classification == DocumentClassification.RESTRICTED.value and d.owner_user_id != user.id:
                continue  # 機密の文書は持ち主だけ(件数にも出さない)
            try:
                name = decrypt_payload(d.original_filename_ciphertext).decode("utf-8") \
                    if d.original_filename_ciphertext else ""
            except (EncryptionNotConfigured, ValueError, UnicodeDecodeError):  # 復号できなければ種類だけで照合
                name = ""
            title = name or (d.document_type or "文書")
            if filt == "emergency":
                s = 50 if ps.emergency_text(d.document_type, name) else 0
            else:
                s = ps.score(toks, title, [d.document_type]) if toks else 0
            if s:
                out["document"].append(_hit("document", s, d.id, title, plan, f"{base}/documents", d.document_type,
                                            badge="機密" if d.classification == "restricted" else None))
    if "expense" in allowed and toks:
        for x in db.query(Expense).filter(Expense.plan_id == pid, Expense.deleted_at.is_(None)).all():
            s = ps.score(toks, x.title, [x.category, x.note])
            if s:
                out["expense"].append(_hit("expense", s, x.id, x.title or "(名前なし)", plan, f"{base}/expenses",
                                           f"{x.amount} {x.currency}" if x.amount is not None else None,
                                           x.local_date.isoformat() if x.local_date else None))
    if "member" in allowed and toks:
        ids = [plan.user_id] + [c.user_id for c in db.query(PlanCollaborator).filter(
            PlanCollaborator.plan_id == pid, PlanCollaborator.status == "accepted").all() if c.user_id]
        for u in db.query(User).filter(User.id.in_(ids)).all():
            s = ps.score(toks, u.username)
            if s:
                out["member"].append(_hit("member", s, u.id, u.username or "(名前なし)", plan, base,
                                          "所有者" if u.id == plan.user_id else "メンバー"))
    if "memory" in allowed and toks:
        mems = db.query(Memory).filter(Memory.plan_id == pid).filter(
            (Memory.author_user_id == user.id) | (Memory.visibility == "members")).all()
        for m in mems:
            title = (m.body or m.place_name or "記録")[:60]
            s = ps.score(toks, title, [m.body, m.place_name])
            if s:
                at = m.occurred_at or m.created_at
                out["memory"].append(_hit("memory", s, m.id, title, plan, f"{base}/memories", m.place_name,
                                          at.isoformat()[:16] if at else None))
    return out


def _shape(found: Dict[str, List[Dict[str, Any]]], q: str, filt: Optional[str]) -> Dict[str, Any]:
    cats = []
    total = 0
    for c in ps.CATEGORIES:
        items = found.get(c) or []
        if not items:
            continue
        items.sort(key=lambda h: (-h["score"], h["when"] or "", h["title"]))
        total += len(items)
        cats.append({"category": c, "label": ps.CATEGORY_LABEL[c], "count": len(items),
                     "results": [{k: v for k, v in h.items() if k != "score"} for h in items[:ps.PER_CATEGORY]]})
    return {"query": q, "filter": filt, "filter_label": ps.FILTER_LABEL.get(filt) if filt else None,
            "categories": cats, "total": total}


@plan_router.get("/{plan_id}/search")
def search_plan(plan_id: str, q: str = Query("", max_length=400), filter: Optional[str] = Query(None),
                db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    q, filt = _check(q, filter)
    _rate(current_user)
    return {"plan_id": str(plan.id), **_shape(_search_plan(db, plan, current_user, q, filt, _now()), q, filt)}


def _member_plans(db: Session, user: User) -> List[TravelPlan]:
    member_ids = {r[0] for r in db.query(PlanCollaborator.plan_id).filter(
        PlanCollaborator.user_id == user.id, PlanCollaborator.status == "accepted").all()}
    qry = db.query(TravelPlan).filter(TravelPlan.deleted_at.is_(None))
    qry = qry.filter((TravelPlan.user_id == user.id) | (TravelPlan.id.in_(member_ids))) if member_ids \
        else qry.filter(TravelPlan.user_id == user.id)
    return qry.order_by(TravelPlan.updated_at.desc().nullslast(), TravelPlan.created_at.desc()).limit(MAX_PLANS).all()


@global_router.get("/everything")
def search_everything(q: str = Query("", max_length=400), filter: Optional[str] = Query(None),
                      db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    q, filt = _check(q, filter)
    _rate(current_user)
    merged: Dict[str, List[Dict[str, Any]]] = {}
    now = _now()
    plans_out = []
    for plan in _member_plans(db, current_user):
        if not resolve_plan_role(db, plan, current_user):
            continue
        plans_out.append({"plan_id": str(plan.id), "title": plan.title or "(名前なし)"})
        for cat, hits in _search_plan(db, plan, current_user, q, filt, now).items():
            merged.setdefault(cat, []).extend(hits)
    # 旅行の名前そのものも当てる(旅行へ移るため)
    toks = ps.tokens(q)
    plan_hits = []
    if toks:
        for p in plans_out:
            s = ps.score(toks, p["title"])
            if s:
                plan_hits.append({"plan_id": p["plan_id"], "title": p["title"], "link": f"/planner/{p['plan_id']}"})
    return {**_shape(merged, q, filt), "plans": plan_hits[:ps.PER_CATEGORY], "searched_plans": len(plans_out)}
