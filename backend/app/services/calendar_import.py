"""[Gate P8] カレンダー(ICS)の取込(FR-036「外部更新の取込は差分確認後に適用する」)。DB非依存の純粋関数。

- parse_ics: RFC 5545 の最小限の解析(行の折り返し・エスケープ・DTSTART/DTEND の UTC・TZID・日付のみ・浮動時刻)。
  繰り返し(RRULE)は展開せず、その予定を取り込まない(理由を返す)。
- plan_candidates: 解析結果を本案と照らして、取り込み案(追加・変更・取り込まない+理由)を作る。DBは変えない。
  TravelCanvas が書き出した ICS(UID: event-<id>@travelcanvas.app)の予定は、同じ予定の変更として扱う。

取り込むのは予定名・日付・開始時刻・終日・場所(住所欄)だけで、説明(DESCRIPTION)は取り込まない
(他のカレンダーの説明に会議URLやパスコード等が含まれることがあるため)。
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_BYTES = 1_000_000
MAX_EVENTS = 500
OWN_UID_RE = re.compile(r"^event-([0-9a-fA-F-]{36})@travelcanvas\.app$")


class IcsError(ValueError):
    pass


@dataclass
class IcsEvent:
    uid: Optional[str]
    summary: str
    location: Optional[str]
    start: Optional[datetime]         # 時刻付き(tz-aware)。日付のみは None
    start_date: Optional[date]        # 日付のみ(終日)
    floating: bool                    # TZ無しの時刻(現地時刻として解釈する)
    floating_local: Optional[datetime]
    status: Optional[str]
    recurring: bool


def _unfold(text: str) -> List[str]:
    lines: List[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return [ln for ln in lines if ln]


def _unescape(v: str) -> str:
    out, i = [], 0
    while i < len(v):
        c = v[i]
        if c == "\\" and i + 1 < len(v):
            n = v[i + 1]
            out.append("\n" if n in "nN" else n)
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _split(line: str) -> Tuple[str, Dict[str, str], str]:
    head, _, value = line.partition(":")
    parts = head.split(";")
    params = {}
    for p in parts[1:]:
        k, _, v = p.partition("=")
        params[k.upper()] = v.strip('"')
    return parts[0].upper(), params, value


def _zone(tzid: Optional[str]):
    if not tzid:
        return None
    try:
        return ZoneInfo(tzid)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _parse_dt(params: Dict[str, str], value: str):
    """(aware datetime | None, date | None, floating local datetime | None)"""
    value = value.strip()
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
        return None, datetime.strptime(value, "%Y%m%d").date(), None
    m = re.fullmatch(r"(\d{8}T\d{6})(Z?)", value)
    if not m:
        raise IcsError(f"日時の形式が正しくありません: {value[:20]}")
    local = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S")
    if m.group(2) == "Z":
        return local.replace(tzinfo=timezone.utc), None, None
    tz = _zone(params.get("TZID"))
    if tz is not None:
        return local.replace(tzinfo=tz), None, None
    return None, None, local


def parse_ics(data: bytes) -> List[IcsEvent]:
    if len(data) > MAX_BYTES:
        raise IcsError("ファイルが大きすぎます(1MBまで)")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise IcsError("UTF-8のICSファイルを選んでください")
    lines = _unfold(text)
    if not lines or lines[0].strip().upper() != "BEGIN:VCALENDAR":
        raise IcsError("ICS(iCalendar)形式のファイルではありません")
    events: List[IcsEvent] = []
    cur: Optional[Dict[str, Any]] = None
    for line in lines:
        name, params, value = _split(line)
        if name == "BEGIN" and value.upper() == "VEVENT":
            cur = {"recurring": False}
        elif name == "END" and value.upper() == "VEVENT" and cur is not None:
            if "start" not in cur:
                cur = None
                continue
            start, start_date, floating = cur["start"]
            events.append(IcsEvent(
                uid=cur.get("uid"), summary=(cur.get("summary") or "").strip() or "(無題)",
                location=cur.get("location"), start=start, start_date=start_date, floating=floating is not None,
                floating_local=floating, status=cur.get("status"), recurring=cur["recurring"],
            ))
            if len(events) > MAX_EVENTS:
                raise IcsError(f"予定が多すぎます({MAX_EVENTS}件まで)")
            cur = None
        elif cur is not None:
            if name == "UID":
                cur["uid"] = value.strip()
            elif name == "SUMMARY":
                cur["summary"] = _unescape(value)
            elif name == "LOCATION":
                cur["location"] = _unescape(value).strip() or None
            elif name == "STATUS":
                cur["status"] = value.strip().upper()
            elif name in ("RRULE", "RDATE"):
                cur["recurring"] = True
            elif name == "DTSTART":
                cur["start"] = _parse_dt(params, value)
    return events


# ===================================================================== 本案との照合

FIELDS = ("title", "local_date", "local_start_time", "is_all_day", "address")


def to_local(e: IcsEvent, plan_tz: str) -> Tuple[date, Optional[str], bool]:
    """(現地の日付, 開始時刻HH:MM|None, 終日)。時刻付きは本案の時刻帯の現地時刻へ変換する。"""
    if e.start_date is not None:
        return e.start_date, None, True
    if e.floating_local is not None:
        return e.floating_local.date(), e.floating_local.strftime("%H:%M"), False
    if e.start is None:  # 読み込みで start・start_date・floating_local のどれかは必ず入る
        raise IcsError("開始日時を読み取れません")
    local = e.start.astimezone(_zone(plan_tz) or timezone.utc)
    return local.date(), local.strftime("%H:%M"), False


def plan_candidates(events: Sequence[IcsEvent], plan_tz: str, days: Dict[str, str],
                    current: Dict[str, Dict[str, Any]], create_missing_days: bool) -> List[Dict[str, Any]]:
    """events: 解析結果、days: {local_date(iso): day_id}、current: {event_id: {title, local_date, local_start_time,
    is_all_day, address, locked}}。戻り値は取り込み案(画面で選んで apply へ送る)。"""
    out: List[Dict[str, Any]] = []
    seen_keys = set()
    existing_keys = {(c["title"], c["local_date"], c["local_start_time"]) for c in current.values()}
    for idx, e in enumerate(events):
        local_date, local_time, all_day = to_local(e, plan_tz)
        fields = {"title": e.summary[:200], "local_date": local_date.isoformat(), "local_start_time": local_time,
                  "is_all_day": all_day, "address": (e.location or None) and e.location[:500]}
        item: Dict[str, Any] = {"index": idx, "uid": e.uid, **fields, "action": "skip", "reason": None,
                                "event_id": None, "changes": None, "day_exists": fields["local_date"] in days}
        own = OWN_UID_RE.match(e.uid or "")
        if e.recurring:
            item["reason"] = "recurring"
        elif e.status == "CANCELLED":
            item["reason"] = "cancelled"
        elif own and own.group(1) in current:
            cur = current[own.group(1)]
            item["event_id"] = own.group(1)
            # 書き出しで住所を含めなかった場合に、空の住所で本案の住所を消さない
            compare = [f for f in FIELDS if not (f == "address" and fields["address"] is None)]
            changes = {f: {"before": cur[f], "after": fields[f]} for f in compare if cur[f] != fields[f]}
            if not changes:
                item["reason"] = "unchanged"
            elif cur.get("locked"):
                item["reason"] = "locked"
                item["changes"] = changes
            elif not item["day_exists"] and not create_missing_days:
                item["reason"] = "no_day"
                item["changes"] = changes
            else:
                item["action"] = "update"
                item["changes"] = changes
        else:
            key = (fields["title"], fields["local_date"], fields["local_start_time"])
            if key in existing_keys or key in seen_keys:
                item["reason"] = "duplicate"
            elif not item["day_exists"] and not create_missing_days:
                item["reason"] = "no_day"
            else:
                item["action"] = "create"
                seen_keys.add(key)
        out.append(item)
    return out


def summarize(candidates: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    reasons: Dict[str, int] = {}
    for c in candidates:
        if c["action"] == "skip":
            reasons[c["reason"]] = reasons.get(c["reason"], 0) + 1
    return {
        "total": len(candidates),
        "create": sum(1 for c in candidates if c["action"] == "create"),
        "update": sum(1 for c in candidates if c["action"] == "update"),
        "skip": sum(1 for c in candidates if c["action"] == "skip"),
        "skipped_by_reason": reasons,
    }
