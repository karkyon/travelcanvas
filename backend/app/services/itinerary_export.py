"""[Gate P5] カレンダー・地図・表計算への書き出し(FR-036、FC-091 ICS / FC-092 KML・GPX、CSV)。

旅程の正本(travel_days / travel_events / travel_segments)から、外部アプリが読める形式の文字列を作る
DB非依存の純粋関数群。データの収集はAPI側(app/api/v1/itinerary_export.py)が行う。

共通の方針:
- 予約番号・PIN・チケット・メモ(description)・参加者名は、どの形式にも含めない
- 住所(ICSのLOCATION・CSVの住所列)は利用者が選んだ時だけ含める
- 位置(GPX/KML)は既定で約1km単位に丸め、宿泊場所(寝泊まりする場所)を除外する。精度を出力内に明記する(FC-092)
- ICSの時刻はUTCで出力する(VTIMEZONEを持たないカレンダーでも誤解が無い)。UIDは予定ごとに固定し、
  SEQUENCEは旅程の版(revision)を使う(再取込で更新として扱われる、FC-091)
- 時刻が未定の予定は推測で時刻を付けず、ICSでは終日予定「(時刻未定)」として出す
"""
import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Sequence
from xml.sax.saxutils import escape, quoteattr

PRODID = "-//TravelCanvas//Itinerary Export 1.0//JA"
UID_DOMAIN = "travelcanvas.app"
PRECISION_DIGITS = {"exact": 5, "approx": 2}
PRECISION_NOTE = {
    "exact": "位置は約1m単位(小数5桁)です。",
    "approx": "位置は約1km単位(小数2桁)に丸めています。正確な場所はアプリで確認してください。",
}
ACCOMMODATION_TYPES = {"accommodation", "lodging", "hotel"}


@dataclass
class ExportEvent:
    id: str
    title: str
    event_type: str
    local_date: date
    timezone_id: str
    start: Optional[datetime]          # UTC。時刻未定・終日は None
    end: Optional[datetime]            # UTC
    is_all_day: bool
    local_start_time: Optional[str]
    place_name: Optional[str]
    address: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    locked: bool
    is_accommodation: bool
    reservation_types: List[str] = field(default_factory=list)


@dataclass
class ExportSegment:
    id: str
    mode: str
    from_label: Optional[str]
    to_label: Optional[str]
    departure: Optional[datetime]      # UTC
    arrival: Optional[datetime]        # UTC
    transport_number: Optional[str]
    status: str


MODE_LABEL = {
    "walking": "徒歩", "driving": "車", "train": "鉄道", "bus": "バス", "ferry": "船", "flight": "航空",
    "bicycle": "自転車", "taxi": "タクシー", "mixed": "混合",
}
EVENT_TYPE_LABEL = {
    "sightseeing": "観光", "activity": "アクティビティ", "meal": "食事", "dining": "食事", "restaurant": "食事",
    "transport": "移動", "transportation": "移動", "accommodation": "宿泊", "lodging": "宿泊", "shopping": "買い物",
    "meeting": "集合", "other": "その他",
}


def _type_label(t: str) -> str:
    return EVENT_TYPE_LABEL.get(t, t)


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


# ===================================================================== ICS (RFC 5545)

def ics_escape(text: str) -> str:
    return (text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n"))


def ics_fold(line: str) -> str:
    """75オクテットごとに折り返す(UTF-8の文字の途中では切らない)。"""
    out: List[str] = []
    current = b""
    limit = 75
    for ch in line:
        b = ch.encode("utf-8")
        if len(current) + len(b) > limit:
            out.append(current.decode("utf-8"))
            current = b" " + b
            limit = 75
        else:
            current += b
    out.append(current.decode("utf-8"))
    return "\r\n".join(out)


def _ics_dt(dt: datetime) -> str:
    return _utc(dt).strftime("%Y%m%dT%H%M%SZ")


def build_ics(plan_title: str, calendar_tz: Optional[str], revision: int, events: Sequence[ExportEvent],
              segments: Sequence[ExportSegment], include_addresses: bool, now: datetime) -> str:
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:{PRODID}", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        f"X-WR-CALNAME:{ics_escape(plan_title)}",
    ]
    if calendar_tz:
        lines.append(f"X-WR-TIMEZONE:{calendar_tz}")
    stamp = _ics_dt(now)
    for e in events:
        lines += ["BEGIN:VEVENT", f"UID:event-{e.id}@{UID_DOMAIN}", f"DTSTAMP:{stamp}", f"SEQUENCE:{revision}"]
        summary = e.title
        if e.start is not None:
            lines.append(f"DTSTART:{_ics_dt(e.start)}")
            if e.end is not None and _utc(e.end) > _utc(e.start):
                lines.append(f"DTEND:{_ics_dt(e.end)}")
        else:
            lines.append(f"DTSTART;VALUE=DATE:{e.local_date.strftime('%Y%m%d')}")
            lines.append(f"DTEND;VALUE=DATE:{(e.local_date + timedelta(days=1)).strftime('%Y%m%d')}")
            if not e.is_all_day:
                summary = f"(時刻未定) {e.title}"
        lines.append(f"SUMMARY:{ics_escape(summary)}")
        location = ", ".join(x for x in (e.place_name, e.address if include_addresses else None) if x)
        if location:
            lines.append(f"LOCATION:{ics_escape(location)}")
        lines.append(f"CATEGORIES:{ics_escape(EVENT_TYPE_LABEL.get(e.event_type, e.event_type))}")
        desc = [f"種類: {EVENT_TYPE_LABEL.get(e.event_type, e.event_type)}"]
        if e.reservation_types:
            desc.append("予約あり(予約番号はアプリで確認してください)")
        lines.append(f"DESCRIPTION:{ics_escape(' / '.join(desc))}")
        lines.append(f"STATUS:{'CONFIRMED' if e.locked else 'TENTATIVE'}")
        lines.append("END:VEVENT")
    for s in segments:
        if s.departure is None:
            continue
        label = MODE_LABEL.get(s.mode, s.mode)
        title = f"{label}: {s.from_label or '?'} → {s.to_label or '?'}"
        if s.transport_number:
            title += f" ({s.transport_number})"
        lines += ["BEGIN:VEVENT", f"UID:segment-{s.id}@{UID_DOMAIN}", f"DTSTAMP:{stamp}", f"SEQUENCE:{revision}",
                  f"DTSTART:{_ics_dt(s.departure)}"]
        if s.arrival is not None and _utc(s.arrival) > _utc(s.departure):
            lines.append(f"DTEND:{_ics_dt(s.arrival)}")
        status = {"cancelled": "CANCELLED", "confirmed": "CONFIRMED"}.get(s.status, "TENTATIVE")
        lines += [f"SUMMARY:{ics_escape(title)}", "CATEGORIES:移動", f"STATUS:{status}", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(ics_fold(line) for line in lines) + "\r\n"


# ===================================================================== GPX / KML

@dataclass
class Waypoint:
    label: str
    local_date: date
    event_type: str
    latitude: float
    longitude: float


def waypoints(events: Sequence[ExportEvent], precision: str, exclude_accommodation: bool, zones=()):
    """(書き出す地点, 除外した件数: 位置なし, 除外した件数: 宿泊・守る範囲)。

    [Gate G6] LOC-02 守る範囲(自宅・職場など。app/services/location_privacy.py)の中の地点は書き出さない。"""
    from app.services import location_privacy as lp

    digits = PRECISION_DIGITS[precision]
    out: List[Waypoint] = []
    no_location = lodging = 0
    for e in events:
        if e.latitude is None or e.longitude is None:
            no_location += 1
            continue
        if (exclude_accommodation and e.is_accommodation) or lp.in_zones(e.latitude, e.longitude, zones):
            lodging += 1
            continue
        out.append(Waypoint(e.place_name or e.title, e.local_date, e.event_type,
                            round(e.latitude, digits), round(e.longitude, digits)))
    return out, no_location, lodging


def _by_day(points: Sequence[Waypoint]):
    days: dict = {}
    for p in points:
        days.setdefault(p.local_date, []).append(p)
    return sorted(days.items())


def build_gpx(plan_title: str, points: Sequence[Waypoint], precision: str, now: datetime) -> str:
    digits = PRECISION_DIGITS[precision]
    fmt = f"{{:.{digits}f}}"
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="TravelCanvas" xmlns="http://www.topografix.com/GPX/1/1">',
        "  <metadata>",
        f"    <name>{escape(plan_title)}</name>",
        f"    <desc>{escape(PRECISION_NOTE[precision])}</desc>",
        f"    <time>{_utc(now).strftime('%Y-%m-%dT%H:%M:%SZ')}</time>",
        "  </metadata>",
    ]
    for p in points:
        parts += [
            f"  <wpt lat={quoteattr(fmt.format(p.latitude))} lon={quoteattr(fmt.format(p.longitude))}>",
            f"    <name>{escape(p.label)}</name>",
            f"    <desc>{escape(p.local_date.isoformat() + ' ' + _type_label(p.event_type))}</desc>",
            "  </wpt>",
        ]
    for d, pts in _by_day(points):
        if len(pts) < 2:
            continue
        parts += ["  <rte>", f"    <name>{escape(d.isoformat() + ' の順路')}</name>"]
        for p in pts:
            parts.append(f"    <rtept lat={quoteattr(fmt.format(p.latitude))} lon={quoteattr(fmt.format(p.longitude))}>"
                         f"<name>{escape(p.label)}</name></rtept>")
        parts.append("  </rte>")
    parts.append("</gpx>")
    return "\n".join(parts) + "\n"


def build_kml(plan_title: str, points: Sequence[Waypoint], precision: str) -> str:
    digits = PRECISION_DIGITS[precision]
    fmt = f"{{:.{digits}f}}"
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        "  <Document>",
        f"    <name>{escape(plan_title)}</name>",
        f"    <description>{escape(PRECISION_NOTE[precision])}</description>",
    ]
    for d, pts in _by_day(points):
        parts += ["    <Folder>", f"      <name>{escape(d.isoformat())}</name>"]
        for p in pts:
            parts += [
                "      <Placemark>",
                f"        <name>{escape(p.label)}</name>",
                f"        <description>{escape(_type_label(p.event_type))}</description>",
                f"        <Point><coordinates>{fmt.format(p.longitude)},{fmt.format(p.latitude)},0"
                "</coordinates></Point>",
                "      </Placemark>",
            ]
        if len(pts) >= 2:
            coords = " ".join(f"{fmt.format(p.longitude)},{fmt.format(p.latitude)},0" for p in pts)
            parts += ["      <Placemark>", f"        <name>{escape(d.isoformat() + ' の順路')}</name>",
                      f"        <LineString><tessellate>1</tessellate><coordinates>{coords}</coordinates></LineString>",
                      "      </Placemark>"]
        parts.append("    </Folder>")
    parts += ["  </Document>", "</kml>"]
    return "\n".join(parts) + "\n"


# ===================================================================== CSV

CSV_HEADER = ["日付", "開始", "終了", "種類", "予定", "場所", "住所", "予約", "確定"]
_FORMULA_PREFIX = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value) -> str:
    """表計算ソフトで数式として実行されないよう、数式の先頭文字で始まる値の前に ' を付ける(CSV injection対策)。"""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIX) else text


def build_csv(events: Sequence[ExportEvent], include_addresses: bool, local_time_text) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(CSV_HEADER)
    for e in events:
        if e.is_all_day:
            start_text = "終日"
        elif e.start is not None:
            start_text = local_time_text(e.start, e.timezone_id)
        else:
            start_text = "未定"
        end_text = local_time_text(e.end, e.timezone_id) if e.end is not None else ""
        w.writerow([csv_safe(x) for x in (
            e.local_date.isoformat(), start_text, end_text, EVENT_TYPE_LABEL.get(e.event_type, e.event_type),
            e.title, e.place_name or "", (e.address or "") if include_addresses else "",
            "・".join(e.reservation_types), "はい" if e.locked else "",
        )])
    # Excelで文字化けしないようBOMを付ける
    return "\ufeff" + buf.getvalue()
