"""
[Gate PlanB] 日ごとの案(プランB)。docs: claude/TravelCanvas_プランB_日ごとの案_要件と画面設計_2026-11-12.md

しくみ
- 案は「同じ日付の別の日の行(TravelDay)」。1 日付に今の案(variant_status='active')は 1 つ(部分一意の索引)
- 控え(standby)・しまった(archived)案の日・予定・区間は、ふだんの問い合わせから自動で外す(下の do_orm_execute)。
  旅程・全日程・しおり・共有・今日・検証・書き出しなど、日や予定を一覧する所は何も変えずに「今の案だけ」になる
- 案そのものを編集する API(予定・日・区間の ID を指定する・元に戻す・案の API)だけは、すべての案を見る
  (all_variants_scope。main.py の中間処理が URL で決める。決まった処理の中では with all_variants(db): で開く)
- 予定・区間の variant_standby は日の状態から flush の前に自動で合わせる(問い合わせを軽くするための写し)
"""
from __future__ import annotations

import contextvars
import re
import uuid
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, cast

from sqlalchemy import event, or_, select, update
from sqlalchemy.orm import Session, with_loader_criteria

from app.models.models import TravelDay, TravelEvent, TravelSegment

ALL = "tc_all_variants"
LABELS = ("A", "B", "C", "D", "E")
REASONS = ("rain", "party", "transport", "delay", "fatigue", "budget", "closure", "other")
REASON_LABEL = {"rain": "雨", "party": "人数", "transport": "移動手段", "delay": "遅れ", "fatigue": "疲れ",
                "budget": "予算", "closure": "休業", "other": "その他"}
DEFAULT_NAME = {"A": "プランA", "B": "プランB", "C": "プランC", "D": "プランD", "E": "プランE"}
MAX_VARIANTS = 5

_scope: contextvars.ContextVar[bool] = contextvars.ContextVar("tc_all_variants", default=False)

# 案そのものを編集する API(すべての案を見る)。予定・日・区間を ID で指す・元に戻す・案の API
_ALL_PATHS = re.compile(
    r"^/api/v1/plans/[^/]+/("
    r"events(/[^/]+(/.*)?)?$|days/[^/]+(/.*)?$|segments(/[^/]+)?$|undo$|redo$|variants(/.*)?$|day-variants(/.*)?$"
    # [P7] 旅の記録の実績・思い出(写真・メモ)は、途中で切り替えた日の元の案の済んだ予定にも付ける
    r"|journey/events/[^/]+(/.*)?$|memories(/.*)?$)")


def path_needs_all(method: str, path: str, query: str = "") -> bool:
    if _ALL_PATHS.match(path):
        if path.endswith("/segments") and method == "GET":
            return False  # 区間の一覧は今の案だけ(案の区間は案の API で読む)
        return True
    # 日を指定した営業時間の照合・予約の札(控えの案を開いている時)
    if re.match(r"^/api/v1/plans/[^/]+/(hours-check|booking-status)$", path) and re.search(r"(^|&)day_id=", query):
        return True
    return False


@contextmanager
def all_variants_scope() -> Iterator[None]:
    token = _scope.set(True)
    try:
        yield
    finally:
        _scope.reset(token)


@contextmanager
def all_variants(db: Session) -> Iterator[Session]:
    """この中の問い合わせは、控え・しまった案も含める"""
    prev = db.info.get(ALL)
    db.info[ALL] = True
    try:
        yield db
    finally:
        if prev is None:
            db.info.pop(ALL, None)
        else:
            db.info[ALL] = prev


def _wants_all(state: Any) -> bool:
    return bool(state.execution_options.get(ALL) or state.session.info.get(ALL) or _scope.get())


def _day_active(cls: Any) -> Any:
    return cls.variant_status == "active"


def _not_standby(cls: Any) -> Any:
    return cls.variant_standby.is_(False)


@event.listens_for(Session, "do_orm_execute")
def _only_active(state: Any) -> None:
    if not state.is_select or _wants_all(state):
        return
    state.statement = state.statement.options(
        with_loader_criteria(TravelDay, cast(Any, _day_active), include_aliases=True),
        with_loader_criteria(TravelEvent, cast(Any, _not_standby), include_aliases=True),
        with_loader_criteria(TravelSegment, cast(Any, _not_standby), include_aliases=True),
    )


def _day_status(session: Session, day_id: Any) -> Optional[str]:
    if day_id is None:
        return None
    for obj in list(session.new) + list(session.identity_map.values()):
        if isinstance(obj, TravelDay) and obj.id == day_id:
            return obj.variant_status
    row = session.execute(select(TravelDay.variant_status).where(TravelDay.id == day_id),
                          execution_options={"tc_all_variants": True}).first()
    return row[0] if row else None


def _event_standby(session: Session, event_id: Any) -> Optional[bool]:
    if event_id is None:
        return None
    for obj in list(session.new) + list(session.identity_map.values()):
        if isinstance(obj, TravelEvent) and obj.id == event_id:
            return bool(obj.variant_standby)
    row = session.execute(select(TravelEvent.variant_standby).where(TravelEvent.id == event_id),
                          execution_options={"tc_all_variants": True}).first()
    return bool(row[0]) if row else None


@event.listens_for(Session, "before_flush")
def _sync_standby(session: Session, _ctx: Any, _instances: Any) -> None:
    """予定・区間の variant_standby を日の状態に合わせる"""
    changed_days: List[TravelDay] = []
    for obj in list(session.new) + list(session.dirty):
        if isinstance(obj, TravelDay):
            if obj.variant_status is None:
                obj.variant_status = "active"
            if obj in session.dirty:
                hist = _history(obj, "variant_status")
                if hist:
                    changed_days.append(obj)
    for obj in list(session.new) + list(session.dirty):
        if isinstance(obj, TravelEvent) and (obj in session.new or _history(obj, "day_id")):
            st = _day_status(session, obj.day_id)
            obj.variant_standby = bool(st and st != "active")
    for obj in list(session.new) + list(session.dirty):
        if isinstance(obj, TravelSegment) and (obj in session.new or _history(obj, "to_event_id")
                                               or _history(obj, "from_event_id")):
            sb = _event_standby(session, obj.to_event_id)
            if sb is None:
                sb = _event_standby(session, obj.from_event_id)
            obj.variant_standby = bool(sb)
    for d in changed_days:
        standby = d.variant_status != "active"
        session.execute(update(TravelEvent).where(TravelEvent.day_id == d.id).values(variant_standby=standby)
                        .execution_options(synchronize_session="fetch", **{ALL: True}))
        ev_ids = select(TravelEvent.id).where(TravelEvent.day_id == d.id)
        session.execute(update(TravelSegment)
                        .where(or_(TravelSegment.to_event_id.in_(ev_ids), TravelSegment.from_event_id.in_(ev_ids)))
                        .values(variant_standby=standby)
                        .execution_options(synchronize_session="fetch", **{ALL: True}))


def _history(obj: Any, attr: str) -> bool:
    from sqlalchemy import inspect as sa_inspect

    h = sa_inspect(obj).attrs[attr].history
    return bool(h.added or h.deleted)


# ---- 一覧・名前 --------------------------------------------------------------

def label_name(day: TravelDay) -> str:
    return day.variant_name or DEFAULT_NAME.get(day.variant_label or "A", "プランA")


def days_of_date(db: Session, plan_id: Any, local_date: Any) -> List[TravelDay]:
    with all_variants(db):
        return (db.query(TravelDay).filter(TravelDay.plan_id == plan_id, TravelDay.local_date == local_date)
                .order_by(TravelDay.variant_label).all())


def variant_counts(db: Session, plan_id: Any) -> Dict[str, Dict[str, Any]]:
    """日付ごとの控えの案(全日程の札「B あり」用)"""
    with all_variants(db):
        rows = (db.query(TravelDay).filter(TravelDay.plan_id == plan_id, TravelDay.variant_status == "standby")
                .order_by(TravelDay.local_date, TravelDay.variant_label).all())
    out: Dict[str, Dict[str, Any]] = {}
    for d in rows:
        out.setdefault(d.local_date.isoformat(), {"standby": []})["standby"].append(
            {"day_id": str(d.id), "label": d.variant_label, "name": label_name(d), "reason": d.variant_reason})
    return out


def next_label(days: List[TravelDay]) -> Optional[str]:
    used = {d.variant_label for d in days}
    return next((x for x in LABELS if x not in used), None)


def new_group() -> uuid.UUID:
    return uuid.uuid4()


# ---- 案を作る(写す・白紙) -----------------------------------------------------

_EVENT_SKIP = {"id", "day_id", "created_at", "updated_at", "variant_standby", "parent_event_id"}


def copy_day_into(db: Session, src: TravelDay, dst: TravelDay) -> Dict[str, Any]:
    """src の予定・エリア・区間・予約のつながりを dst へ写す(dst は flush 済み)。予約そのものは写さない"""
    from app.models.models import EventLink, EventReservation

    with all_variants(db):
        events = db.query(TravelEvent).filter(TravelEvent.day_id == src.id).order_by(TravelEvent.sort_order).all()
        idmap: Dict[Any, Any] = {}
        new_events: List[TravelEvent] = []
        cols = [c.key for c in TravelEvent.__table__.columns if c.key not in _EVENT_SKIP]
        for e in events:
            ne = TravelEvent(**{k: getattr(e, k) for k in cols})
            ne.id = uuid.uuid4()
            ne.day_id = dst.id
            idmap[e.id] = ne.id
            new_events.append(ne)
            db.add(ne)
        db.flush()
        for e, ne in zip(events, new_events):
            if e.parent_event_id is not None:
                ne.parent_event_id = idmap.get(e.parent_event_id)
        segs = (db.query(TravelSegment).filter(TravelSegment.to_event_id.in_(list(idmap) or [uuid.uuid4()])).all())
        seg_cols = [c.key for c in TravelSegment.__table__.columns
                    if c.key not in {"id", "created_at", "updated_at", "variant_standby", "revision"}]
        n_seg = 0
        for s in segs:
            if s.from_event_id is not None and s.from_event_id not in idmap:
                continue  # 前の夜の宿からの区間など、日の外を指す区間は写さない
            ns = TravelSegment(**{k: getattr(s, k) for k in seg_cols})
            ns.id = uuid.uuid4()
            ns.to_event_id = idmap[s.to_event_id]
            if s.from_event_id is not None:
                ns.from_event_id = idmap[s.from_event_id]
            db.add(ns)
            n_seg += 1
        links = db.query(EventLink).filter(EventLink.event_id.in_(list(idmap) or [uuid.uuid4()])).all()
        for lk in links:
            db.add(EventLink(event_id=idmap[lk.event_id], link_type=lk.link_type, label=lk.label, url=lk.url,
                             body=lk.body))
        rlinks = db.query(EventReservation).filter(EventReservation.event_id.in_(list(idmap) or [uuid.uuid4()])).all()
        for rl in rlinks:
            db.add(EventReservation(event_id=idmap[rl.event_id], reservation_id=rl.reservation_id,
                                    relation_type=rl.relation_type, is_locked=False))
        db.flush()
    return {"events": len(new_events), "segments": n_seg, "idmap": {str(k): str(v) for k, v in idmap.items()}}


# ---- たたき台(R3: 理由に合わせて組み替える) -----------------------------------

OUTDOOR_TYPES = {"sightseeing", "activity"}
# 画面の「移動の既定」→ 区間の手段
TRANSPORT_TO_MODE = {"car": "driving", "train": "train", "bus": "bus", "walk": "walking", "taxi": "taxi"}
# 手段を変えてよい区間(飛行機・船・手で入れた区間は変えない)
_SWITCHABLE_MODES = {"driving", "walking", "train", "bus", "taxi", "bicycle", "mixed"}
SCAFFOLD_REASONS = ("rain", "delay", "fatigue", "transport")


def _hm_shift(v: str, minutes: int) -> Optional[str]:
    m = re.match(r"^(\d{1,2}):(\d{2})", v or "")
    if not m:
        return None
    t = int(m.group(1)) * 60 + int(m.group(2)) + minutes
    return None if t > 23 * 60 + 59 else f"{t // 60:02d}:{t % 60:02d}"


def rain_candidates(db: Session, day: TravelDay, limit: int = 5) -> List[str]:
    """候補箱(まだ予定にしていない)の中で、雨の日に向く(屋内の)候補の名前"""
    from app.models.models import PlanCandidate
    from app.services import weather_fit as wf

    rows = (db.query(PlanCandidate).filter(PlanCandidate.plan_id == day.plan_id, PlanCandidate.status == "open")
            .order_by(PlanCandidate.priority.asc(), PlanCandidate.created_at.asc()).limit(200).all())
    return [c.title for c in rows if wf.indoor_like(c.title, c.category, c.tags)][:limit]


def apply_scaffold(db: Session, day: TravelDay, reason: Optional[str], cond: Dict[str, Any]) -> List[Dict[str, Any]]:
    """写した案 day を理由に合わせて組み替える。変えた所・印を付けた所の一覧を返す(案の条件に残して帯に出す)。
    確定(locked)の予定は動かさない。予定は消さない(外す候補の印だけ)"""
    from datetime import timedelta

    notes: List[Dict[str, Any]] = []
    with all_variants(db):
        evs = _events(db, day)
        top = [e for e in evs if e.parent_event_id is None]
        if reason == "rain":
            # 当たり前の感覚: 種類ではなく名前・説明で見分ける(屋外の BBQ・海水浴・展望台など。水族館・美術館は屋内)
            from app.services import weather_fit as wf

            for e in top:
                f = wf.fit(e.title, e.event_type, e.description)
                if f["fit"] in ("outdoor", "partly"):
                    notes.append({"kind": "rain", "event_id": str(e.id), "title": e.title, "fit": f["fit"],
                                  "text": wf.rain_note(e.title, f)})
            picks = rain_candidates(db, day)
            if picks:
                notes.append({"kind": "candidates", "event_id": None, "title": "候補箱の屋内の候補",
                              "text": "・".join(picks)})
        elif reason == "delay":
            minutes = int(cond.get("delay_minutes") or 60)
            after = cond.get("delay_after") or "00:00"
            for e in evs:
                if not e.local_start_time or e.is_all_day or e.local_start_time[:5] < after:
                    continue
                if e.locked:
                    notes.append({"kind": "delay", "event_id": str(e.id), "title": e.title,
                                  "text": "確定の予定なので動かしていません。遅れの影響を確かめてください"})
                    continue
                new = _hm_shift(e.local_start_time, minutes)
                if new is None:
                    notes.append({"kind": "delay", "event_id": str(e.id), "title": e.title,
                                  "text": f"{minutes}分ずらすと日付を越えるため動かしていません(要調整)"})
                    continue
                notes.append({"kind": "delay", "event_id": str(e.id), "title": e.title,
                              "text": f"{e.local_start_time[:5]} → {new}({minutes}分ずらしました)"})
                e.local_start_time = new
                if e.start_at is not None:
                    e.start_at = e.start_at + timedelta(minutes=minutes)
                if e.end_at is not None:
                    e.end_at = e.end_at + timedelta(minutes=minutes)
        elif reason == "fatigue":
            limit = int(cond.get("max_events") or 4)
            countable = [e for e in top if e.event_type not in ("accommodation", "transportation")]
            excess = len(countable) - limit
            for e in reversed(countable):
                if excess <= 0:
                    break
                if e.locked:
                    continue
                notes.append({"kind": "fatigue", "event_id": str(e.id), "title": e.title,
                              "text": f"1日{limit}件までにするなら外す候補です"})
                excess -= 1
        mode = TRANSPORT_TO_MODE.get(cond.get("transport_mode") or "")
        if mode is not None and reason in ("rain", "transport"):
            from app.api.v1 import segments as S

            ids = [e.id for e in evs]
            segs = (db.query(TravelSegment).filter(TravelSegment.to_event_id.in_(ids or [uuid.uuid4()])).all())
            changed = 0
            params, est_rev = S.te.load(db)
            for sg in segs:
                if sg.mode == mode or sg.mode not in _SWITCHABLE_MODES or sg.provider == "manual":
                    continue
                sg.mode = mode
                S._refresh_estimate(db, sg, params, est_rev)
                changed += 1
            if changed:
                notes.append({"kind": "transport", "event_id": None, "title": "移動の手段",
                              "text": f"区間 {changed} 件の手段を変えて、移動の見積もりを計算し直しました"})
        db.flush()
    return notes


# ---- 切り替え ---------------------------------------------------------------

def activate(db: Session, day: TravelDay) -> Optional[TravelDay]:
    """day を今の案にする。元の今の案を控えへ(部分一意の索引に当たらないよう、先に控えへ下ろして flush)"""
    with all_variants(db):
        cur = (db.query(TravelDay).filter(TravelDay.plan_id == day.plan_id, TravelDay.local_date == day.local_date,
                                          TravelDay.variant_status == "active", TravelDay.id != day.id).first())
        if cur is not None:
            cur.variant_status = "standby"
            db.flush()
        day.variant_status = "active"
        db.flush()
    return cur


def variant_dict(d: TravelDay) -> Dict[str, Any]:
    return {"variant_status": d.variant_status, "variant_label": d.variant_label, "variant_name": d.variant_name,
            "variant_reason": d.variant_reason, "variant_conditions": d.variant_conditions}


# ---- 前後のつながりの検証 -----------------------------------------------------

def _events(db: Session, day: Optional[TravelDay]) -> List[TravelEvent]:
    if day is None:
        return []
    with all_variants(db):
        return db.query(TravelEvent).filter(TravelEvent.day_id == day.id).order_by(TravelEvent.sort_order).all()


def _lodging(evs: List[TravelEvent]) -> Optional[TravelEvent]:
    lod = [e for e in evs if e.event_type == "accommodation"]
    return lod[-1] if lod else None


def _hm(v: Optional[str]) -> Optional[int]:
    if not v or not re.match(r"^\d{1,2}:\d{2}", v):
        return None
    h, m = v[:5].split(":")
    return int(h) * 60 + int(m)


def _end_min(e: TravelEvent, tz: Optional[str]) -> Optional[int]:
    from app.services import event_times as et

    s = _hm(e.local_start_time)
    if e.end_at is not None and e.day is not None:
        hhmm, off = et.end_fields(e.end_at, e.day.local_date, tz)
        if hhmm:
            return (_hm(hhmm) or 0) + 1440 * (off or 0)
    return s


def check_continuity(db: Session, day: TravelDay, party: Optional[int] = None) -> Dict[str, Any]:
    """案 day を今の案にした時の、前後の日・予約・時刻のつながり"""
    from datetime import timedelta

    from app.models.models import EventReservation, Reservation
    from app.services import booking_status as bs
    from app.services import place_lookup as pl

    items: List[Dict[str, Any]] = []
    with all_variants(db):
        active = (db.query(TravelDay).filter(TravelDay.plan_id == day.plan_id, TravelDay.local_date == day.local_date,
                                             TravelDay.variant_status == "active").first())
        prev = (db.query(TravelDay).filter(TravelDay.plan_id == day.plan_id,
                                           TravelDay.local_date == day.local_date - timedelta(days=1),
                                           TravelDay.variant_status == "active").first())
        nxt = (db.query(TravelDay).filter(TravelDay.plan_id == day.plan_id,
                                          TravelDay.local_date == day.local_date + timedelta(days=1),
                                          TravelDay.variant_status == "active").first())
    mine = _events(db, day)
    cur = _events(db, active) if active is not None and active.id != day.id else []
    timed = [e for e in mine if _hm(e.local_start_time) is not None]
    first = timed[0] if timed else (mine[0] if mine else None)

    # 1. 前の日から
    if prev is None:
        items.append({"kind": "prev", "level": "ok", "title": "前の日から: この日が最初の日です", "text": ""})
    else:
        lod = _lodging(_events(db, prev))
        if lod is None or first is None:
            items.append({"kind": "prev", "level": "ok", "title": "前の日から: 合います",
                          "text": "前の日に宿の予定がないため、移動だけを確かめます。"})
        else:
            km = pl.distance_m(lod.latitude, lod.longitude, first.latitude, first.longitude)
            far = km != float("inf") and km / 1000 > 150
            dist = "" if km == float("inf") else f"(直線で約 {round(km / 1000)}km)"
            items.append({"kind": "prev", "level": "warn" if far else "ok",
                          "title": "前の日から: 遠すぎます" if far else "前の日から: 合います",
                          "text": f"前の夜の宿「{lod.title}」から、最初の予定"
                                  f"({(first.local_start_time or '時刻なし')[:5]} {first.title})へ{dist}。"})
    # 2. 今夜の宿・翌日へ
    my_lod = _lodging(mine)
    cur_lod = _lodging(cur)
    if nxt is None:
        items.append({"kind": "next", "level": "ok", "title": "翌日へ: この日が最終日です", "text": ""})
    elif cur_lod is not None and my_lod is None:
        items.append({"kind": "next", "level": "bad", "title": "今夜の宿がありません",
                      "text": f"今の案の宿「{cur_lod.title}」がこの案にありません。翌日は宿から始まる予定です。"})
    elif cur_lod is not None and my_lod is not None and not bs.name_match(cur_lod.title, my_lod.title):
        items.append({"kind": "next", "level": "warn", "title": "今夜の宿が今の案と違います",
                      "text": f"この案は「{my_lod.title}」、翌日は今の案の宿「{cur_lod.title}」から始まります。"})
    else:
        items.append({"kind": "next", "level": "ok", "title": "翌日へ: 合います",
                      "text": f"今夜の宿「{my_lod.title}」から翌日が始まります。" if my_lod else ""})
    # 3. 時刻の重なり
    tz = day.timezone_id
    last_end: Optional[int] = None
    last_title = ""
    for e in timed:
        s = _hm(e.local_start_time) or 0
        if last_end is not None and s < last_end:
            items.append({"kind": "time", "level": "warn", "title": "予定の時刻が重なっています",
                          "text": f"「{last_title}」の終わりと「{e.title}」の始まり({(e.local_start_time or '')[:5]})。"})
        end = _end_min(e, tz)
        last_end = end if end is not None and end > s else s
        last_title = e.title
    # 4. 予約: 使わなくなる予約・この案の予約の札
    mine_ids = [e.id for e in mine]
    cur_ids = [e.id for e in cur]

    def res_of(ids: List[Any]) -> Dict[Any, Reservation]:
        if not ids:
            return {}
        rows = (db.query(Reservation).join(EventReservation, EventReservation.reservation_id == Reservation.id)
                .filter(EventReservation.event_id.in_(ids), Reservation.deleted_at.is_(None)).all())
        rows += db.query(Reservation).filter(Reservation.event_id.in_(ids), Reservation.deleted_at.is_(None)).all()
        return {r.id: r for r in rows if r.status in bs.LIVE}

    with all_variants(db):
        mine_res = res_of(mine_ids)
        cur_res = res_of(cur_ids)
    drops = [r for rid, r in cur_res.items() if rid not in mine_res]
    for r in drops:
        items.append({"kind": "drop", "level": "warn", "reservation_id": str(r.id),
                      "title": f"この案で使わなくなる予約: {r.provider_name or bs.TYPE_LABEL.get(r.type, r.type)}",
                      "text": "取り消しの手続きの準備を作れます(相手先へは送りません)。"})
    plan = day.plan
    party_n = party or (bs.party_size(plan) if plan is not None else None)
    for e in mine:
        rs = [r for r in mine_res.values()
              if r.event_id == e.id or db.query(EventReservation).filter(
                  EventReservation.event_id == e.id, EventReservation.reservation_id == r.id).first()]
        for r in rs:
            for msg in bs.check(r, e, day, party_n):
                items.append({"kind": "booking", "level": "warn", "title": f"予約の確認: {e.title}", "text": msg})
        if not rs and e.event_type in bs.BOOKABLE:
            items.append({"kind": "unbooked", "level": "info", "title": f"未予約: {e.title}",
                          "text": "切り替えた後に「予約を取り込む」で登録できます。"})
    # 5. 天気: 雨の案(屋内を優先)なのに屋外の予定が残っていないか(当たり前の感覚の検証)
    cond = day.variant_conditions or {}
    if day.variant_reason == "rain" or cond.get("prefer_indoor"):
        from app.services import weather_fit as wf

        for e in mine:
            if e.parent_event_id is not None:
                continue
            f = wf.fit(e.title, e.event_type, e.description)
            if f["fit"] == "outdoor":
                items.append({"kind": "weather", "level": "warn", "title": f"雨の案に屋外の予定: {e.title}",
                              "text": wf.rain_note(e.title, f)})
    order = {"bad": 3, "warn": 2, "info": 1, "ok": 0}
    worst = max((order[i["level"]] for i in items), default=0)
    return {"status": {3: "bad", 2: "warn"}.get(worst, "ok"), "items": items,
            "counts": {k: sum(1 for i in items if i["level"] == k) for k in ("ok", "info", "warn", "bad")}}


# ---- [P7] 実際に回った予定(旅の記録・思い出・訪問の判定) ----------------------------------------

def _live_switches(db: Session, plan_id: Any) -> List[Any]:
    """元に戻していない切り替えの記録(古い順)"""
    from app.models.models import ChangeSet, DayVariantSwitch

    rows = (db.query(DayVariantSwitch).filter(DayVariantSwitch.plan_id == plan_id)
            .order_by(DayVariantSwitch.switched_at.asc(), DayVariantSwitch.id.asc()).all())
    cs_ids = [r.change_set_id for r in rows if r.change_set_id is not None]
    undone = set()
    if cs_ids:
        q = db.query(ChangeSet.id).filter(ChangeSet.id.in_(cs_ids), ChangeSet.undone_at.isnot(None))
        undone = {row[0] for row in q.all()}
    return [r for r in rows if r.undone_at is None and r.change_set_id not in undone]


def switch_undone(db: Session, rec: Any) -> bool:
    if rec.undone_at is not None:
        return True
    if rec.change_set_id is None:
        return False
    from app.models.models import ChangeSet

    cs = db.query(ChangeSet).filter(ChangeSet.id == rec.change_set_id).first()
    return cs is not None and cs.undone_at is not None


def _order_key(e: TravelEvent):
    return (e.local_start_time or "99:99", e.sort_order or 0, str(e.id))


def travelled(db: Session, plan_id: Any) -> Dict[str, Any]:
    """日ごとに、実際に回った(回る)予定の並び。
    - 今の案の予定。旅行中に途中で切り替えた日は、元の案の済んだ予定 → 切り替え → 今の案の合流点から先
    - 合流点より前の今の案の予定は「切り替えでとばした」(回った予定に入れない)
    戻り値: {"days": [今の案の日], "events": {day_id: [予定]}, "skipped": {day_id: [予定]},
             "trail": {day_id: 切り替えの記録の dict(日の中の最後の切り替え)}, "day_of": {event_id: 今の案の日}}"""
    with all_variants(db):
        days = (db.query(TravelDay).filter(TravelDay.plan_id == plan_id, TravelDay.variant_status == "active")
                .order_by(TravelDay.local_date, TravelDay.sort_order).all())
        all_days = {d.id: d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan_id).all()}
        evs = db.query(TravelEvent).filter(TravelEvent.plan_id == plan_id).all()
        switches = _live_switches(db, plan_id)
    by_day: Dict[Any, List[TravelEvent]] = {}
    for e in evs:
        by_day.setdefault(e.day_id, []).append(e)
    ev_by_id = {e.id: e for e in evs}
    out_events: Dict[Any, List[TravelEvent]] = {}
    skipped: Dict[Any, List[TravelEvent]] = {}
    trail: Dict[Any, Dict[str, Any]] = {}
    day_of: Dict[Any, TravelDay] = {}
    for d in days:
        mine = sorted(by_day.get(d.id, []), key=_order_key)
        recs = [r for r in switches if r.local_date == d.local_date and r.to_day_id == d.id]
        rec = recs[-1] if recs else None
        if rec is not None:
            src = all_days.get(rec.from_day_id) if rec.from_day_id else None
            trail[d.id] = {
                "from_label": rec.from_label, "from_name": rec.from_name, "to_label": rec.to_label,
                "to_name": rec.to_name, "phase": rec.phase, "reason": rec.reason,
                "reason_label": REASON_LABEL.get(rec.reason or "", None), "place_label": rec.place_label,
                "switched_at": rec.switched_at.isoformat() if rec.switched_at else None,
                "from_day_id": str(src.id) if src else None,
                "join_event_id": str(rec.join_event_id) if rec.join_event_id else None,
            }
        done: List[TravelEvent] = []
        if rec is not None and rec.phase == "during" and rec.join_event_id is not None:
            done_ids = {str(x) for x in (rec.done_event_ids or [])}
            done = sorted((ev_by_id[i] for i in ev_by_id if str(i) in done_ids), key=_order_key)
            ids = [e.id for e in mine]
            if rec.join_event_id in ids:
                k = ids.index(rec.join_event_id)
                skipped[d.id] = [e for e in mine[:k] if e.parent_event_id is None]
                mine = [e for e in mine[k:]]
                # とばした予定の中のエリアの子は、合流点より前ならとばす
                skip_ids = {e.id for e in skipped[d.id]}
                mine = [e for e in mine if e.parent_event_id not in skip_ids]
        out_events[d.id] = done + mine
        for e in out_events[d.id] + skipped.get(d.id, []):
            day_of[e.id] = d
    return {"days": days, "events": out_events, "skipped": skipped, "trail": trail, "day_of": day_of}
