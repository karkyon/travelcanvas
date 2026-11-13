"""[Gate Remaining-1] FR-036 地図・表の取り込み(GPX・KML・CSV)。DB 非依存の純粋関数。

- GPX: 地点(wpt)を取り込む。名前・座標・時刻(time。無ければ日付なし)・説明(desc)。
  線(trk・rte)は位置の記録として扱うため予定にはしない(理由を返す)
- KML: Placemark の点(Point)を取り込む。名前・座標・住所(address)・時刻(TimeStamp/when)。
  線・面(LineString・Polygon)は予定にしない
- CSV: 1 行目が見出し。日付・時刻・名前・住所・緯度・経度の列(日本語・英語の見出し。TravelCanvas の書き出しの列も読む)

日付のある地点は予定の取り込み案(calendar_import.plan_candidates で本案と照らす)、日付の無い地点は候補箱に入れる案にする。
XML は DTD(<!DOCTYPE>・<!ENTITY>)を含む物を受け付けない(外部実体・展開の爆発を起こさない)。
"""
import csv
import io
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

from app.services import calendar_import as ci

MAX_BYTES = 2_000_000
MAX_ITEMS = 500
FORMATS = ("gpx", "kml", "csv")


class MapImportError(ValueError):
    pass


@dataclass
class MapItem:
    title: str
    address: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    start: Optional[datetime]          # tz 付き(UTC など)
    local_date: Optional[date]         # 日付だけ・時刻帯の無い時刻
    local_time: Optional[str]          # HH:MM(時刻帯の無い時刻)
    note: Optional[str]


def detect_format(filename: Optional[str], data: bytes) -> Optional[str]:
    """中身で分かる物(ICS・GPX・KML)は中身を優先し、分からなければファイル名の拡張子で決める"""
    head = data[:600].lstrip(b"\xef\xbb\xbf").lstrip().lower()
    if head.startswith(b"begin:vcalendar"):
        return "ics"
    if b"<gpx" in head:
        return "gpx"
    if b"<kml" in head:
        return "kml"
    name = (filename or "").lower()
    for f in FORMATS:
        if name.endswith("." + f):
            return f
    if name.endswith(".ics"):
        return "ics"
    return None


def _text(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return data.decode("cp932")
        except UnicodeDecodeError:
            raise MapImportError("文字コードを読み取れません(UTF-8 か Shift_JIS のファイルを選んでください)")


def _xml(data: bytes) -> ET.Element:
    if len(data) > MAX_BYTES:
        raise MapImportError("ファイルが大きすぎます(2MBまで)")
    low = data[:4096].lower()
    if b"<!doctype" in low or b"<!entity" in low:
        raise MapImportError("DTD を含む XML は取り込めません")
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        raise MapImportError("XML として読み取れません")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(el: ET.Element, name: str) -> Optional[ET.Element]:
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _child_text(el: ET.Element, name: str) -> Optional[str]:
    c = _child(el, name)
    v = (c.text or "").strip() if c is not None else ""
    return v or None


def _coord(lat: Optional[str], lng: Optional[str]) -> Tuple[Optional[float], Optional[float]]:
    try:
        la, lo = float(lat or ""), float(lng or "")
    except ValueError:
        return None, None
    if not (-90 <= la <= 90 and -180 <= lo <= 180):
        return None, None
    return round(la, 6), round(lo, 6)


def _iso(v: Optional[str]) -> Tuple[Optional[datetime], Optional[date], Optional[str]]:
    """ISO 8601 の時刻 → (tz 付きの時刻, 日付, 時刻帯の無い時の HH:MM)"""
    if not v:
        return None, None, None
    s = v.strip().replace("Z", "+00:00")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return None, date.fromisoformat(s), None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None, None, None
    if dt.tzinfo is None:
        return None, dt.date(), dt.strftime("%H:%M")
    return dt, None, None


def _item(title: Optional[str], address: Optional[str], lat, lng, when: Optional[str], note: Optional[str]) -> MapItem:
    start, d, t = _iso(when)
    return MapItem(title=(title or "(無題の地点)").strip()[:200], address=(address or None) and address[:500],
                   latitude=lat, longitude=lng, start=start, local_date=d, local_time=t,
                   note=(note or None) and note[:2000])


def parse_gpx(data: bytes) -> Tuple[List[MapItem], Dict[str, int]]:
    root = _xml(data)
    if _local(root.tag) != "gpx":
        raise MapImportError("GPX 形式のファイルではありません")
    items: List[MapItem] = []
    skipped = {"track": 0, "no_position": 0}
    for el in root.iter():
        name = _local(el.tag)
        if name in ("trk", "rte"):
            skipped["track"] += 1
        elif name == "wpt":
            lat, lng = _coord(el.get("lat"), el.get("lon"))
            if lat is None:
                skipped["no_position"] += 1
                continue
            items.append(_item(_child_text(el, "name"), None, lat, lng, _child_text(el, "time"),
                               _child_text(el, "desc") or _child_text(el, "cmt")))
            if len(items) > MAX_ITEMS:
                raise MapImportError(f"地点が多すぎます({MAX_ITEMS}件まで)")
    return items, skipped


def parse_kml(data: bytes) -> Tuple[List[MapItem], Dict[str, int]]:
    root = _xml(data)
    if _local(root.tag) != "kml":
        raise MapImportError("KML 形式のファイルではありません")
    items: List[MapItem] = []
    skipped = {"track": 0, "no_position": 0}
    for pm in root.iter():
        if _local(pm.tag) != "Placemark":
            continue
        point = next((c for c in pm.iter() if _local(c.tag) == "Point"), None)
        if point is None:
            if any(_local(c.tag) in ("LineString", "Polygon", "Track", "MultiGeometry") for c in pm.iter()):
                skipped["track"] += 1
            else:
                skipped["no_position"] += 1
            continue
        coords = (_child_text(point, "coordinates") or "").split(",")
        lat, lng = _coord(coords[1] if len(coords) > 1 else None, coords[0] if coords else None)
        if lat is None:
            skipped["no_position"] += 1
            continue
        when = None
        for c in pm.iter():
            if _local(c.tag) == "when" or (_local(c.tag) == "begin"):
                when = (c.text or "").strip() or None
                break
        desc = _child_text(pm, "description")
        if desc:
            desc = re.sub(r"<[^>]+>", " ", desc)
            desc = re.sub(r"\s+", " ", desc).strip() or None
        items.append(_item(_child_text(pm, "name"), _child_text(pm, "address"), lat, lng, when, desc))
        if len(items) > MAX_ITEMS:
            raise MapImportError(f"地点が多すぎます({MAX_ITEMS}件まで)")
    return items, skipped


# 見出しの別名(小文字・空白なしで照らす)
_COLS = {
    "date": ("date", "日付", "日", "local_date", "day"),
    "time": ("time", "時刻", "開始", "開始時刻", "start", "start_time", "local_start_time"),
    "title": ("title", "name", "名前", "予定", "予定名", "タイトル", "場所名", "spot"),
    "address": ("address", "住所", "場所", "location"),
    "lat": ("lat", "latitude", "緯度"),
    "lng": ("lng", "lon", "long", "longitude", "経度"),
    "note": ("note", "notes", "memo", "メモ", "備考", "説明", "description"),
}


def _norm(h: str) -> str:
    return re.sub(r"\s+", "", h.strip().lower())


def _csv_date(v: str) -> Optional[date]:
    v = v.strip().replace("/", "-").replace(".", "-")
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", v)
    if not m:
        m2 = re.fullmatch(r"(\d{4})年(\d{1,2})月(\d{1,2})日", v)
        m = m2
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _csv_time(v: str) -> Optional[str]:
    m = re.fullmatch(r"(\d{1,2})[:時](\d{2})分?(?::\d{2})?", v.strip())
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def parse_csv(data: bytes) -> Tuple[List[MapItem], Dict[str, int]]:
    if len(data) > MAX_BYTES:
        raise MapImportError("ファイルが大きすぎます(2MBまで)")
    text = _text(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if not rows:
        raise MapImportError("CSV に行がありません")
    header = [_norm(h) for h in rows[0]]
    idx: Dict[str, int] = {}
    for key, names in _COLS.items():
        for i, h in enumerate(header):
            if h in names and key not in idx:
                idx[key] = i
    if "title" not in idx:
        raise MapImportError("CSV の 1 行目に「名前(title・予定名)」の列が必要です")
    items: List[MapItem] = []
    skipped = {"bad_row": 0, "no_position": 0}

    def cell(row: List[str], key: str) -> str:
        i = idx.get(key)
        return row[i].strip() if i is not None and i < len(row) else ""

    for row in rows[1:]:
        if not any(c.strip() for c in row):
            continue
        title = cell(row, "title")
        if not title:
            skipped["bad_row"] += 1
            continue
        d = _csv_date(cell(row, "date")) if cell(row, "date") else None
        if cell(row, "date") and d is None:
            skipped["bad_row"] += 1
            continue
        t = _csv_time(cell(row, "time")) if cell(row, "time") and d else None
        lat, lng = _coord(cell(row, "lat"), cell(row, "lng")) if cell(row, "lat") else (None, None)
        items.append(MapItem(title=title[:200], address=cell(row, "address")[:500] or None, latitude=lat, longitude=lng,
                             start=None, local_date=d, local_time=t, note=cell(row, "note")[:2000] or None))
        if len(items) > MAX_ITEMS:
            raise MapImportError(f"行が多すぎます({MAX_ITEMS}件まで)")
    return items, skipped


def parse(fmt: str, data: bytes) -> Tuple[List[MapItem], Dict[str, int]]:
    if fmt == "gpx":
        return parse_gpx(data)
    if fmt == "kml":
        return parse_kml(data)
    if fmt == "csv":
        return parse_csv(data)
    raise MapImportError("GPX・KML・CSV・ICS のファイルを選んでください")


def to_ics_events(items: List[MapItem]) -> Tuple[List[Tuple[int, ci.IcsEvent]], List[int]]:
    """日付のある地点 → (元の番号, IcsEvent)。日付の無い地点の番号は別に返す(候補箱へ)。"""
    dated: List[Tuple[int, ci.IcsEvent]] = []
    undated: List[int] = []
    for i, it in enumerate(items):
        if it.start is not None:
            ev = ci.IcsEvent(uid=None, summary=it.title, location=it.address, start=it.start.astimezone(timezone.utc),
                             start_date=None, floating=False, floating_local=None, status=None, recurring=False)
        elif it.local_date is not None and it.local_time:
            hh, mm = it.local_time.split(":")
            ev = ci.IcsEvent(uid=None, summary=it.title, location=it.address, start=None, start_date=None,
                             floating=True,
                             floating_local=datetime(it.local_date.year, it.local_date.month, it.local_date.day,
                                                     int(hh), int(mm)),
                             status=None, recurring=False)
        elif it.local_date is not None:
            ev = ci.IcsEvent(uid=None, summary=it.title, location=it.address, start=None, start_date=it.local_date,
                             floating=False, floating_local=None, status=None, recurring=False)
        else:
            undated.append(i)
            continue
        dated.append((i, ev))
    return dated, undated
