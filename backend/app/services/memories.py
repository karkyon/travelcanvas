"""[Gate P12] FR-037 写真・メモ・旅行記の純粋関数(DB非依存)。

- 写真・音声のファイル検証(拡張子と先頭バイト)。動画はURLの参照だけを持つ(動画ファイルは保存しない)。
- 旅行記の下書き: 計画(日・予定)と実績(予定へ紐付けた記録)から、日ごとの下書きを作る(journal-draft-v1)。
  計画した予定は記録が無くても「記録なし」として残し、予定と実績を混同しない(DOC-15 CA-012)。
- 公開前の検査(DOC-04 SC-28): 位置・写真に写った人・同行者の名前・予約番号や電話番号のような文字列を知らせる。
  検査結果の文には、見つかった文字列そのものを載せない(検査結果から機密値を広げないため)。
  顔の自動判定は行わない(写真がある時は「確認してください」と知らせる)。
"""
import re
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlsplit

ALGORITHM_VERSION = "journal-draft-v1"
KINDS = ("note", "photo", "audio", "video")
VISIBILITIES = ("private", "members")
MAX_BODY = 5000
MAX_PLACE_NAME = 200
MAX_URL = 2000
MAX_MEMORIES_PER_PLAN = 2000

PHOTO_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
               ".webp": "image/webp"}
AUDIO_TYPES = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
               ".webm": "audio/webm"}

_RESERVATION_LIKE = re.compile(r"(?<![A-Za-z0-9])(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,12}(?![A-Za-z0-9])")
_PHONE_LIKE = re.compile(r"(?<!\d)(\+?\d{1,4}[-\s]?)?\d{2,4}-\d{2,4}-\d{3,4}(?!\d)")


class MemoryInputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _magic_ok(ext: str, content: bytes) -> bool:
    if ext in (".jpg", ".jpeg"):
        return content.startswith(b"\xff\xd8\xff")
    if ext == ".png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == ".gif":
        return content.startswith(b"GIF87a") or content.startswith(b"GIF89a")
    if ext == ".webp":
        return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    if ext == ".mp3":
        return content.startswith(b"ID3") or content[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")
    if ext == ".m4a":
        return content[4:8] == b"ftyp"
    if ext == ".wav":
        return content[:4] == b"RIFF" and content[8:12] == b"WAVE"
    if ext == ".ogg":
        return content.startswith(b"OggS")
    if ext == ".webm":
        return content.startswith(b"\x1a\x45\xdf\xa3")
    return False


def validate_media(kind: str, filename: str, content: bytes, max_bytes: int) -> Tuple[str, str]:
    """(拡張子, MIME)を返す。写真・音声以外、偽装、空、上限超過は MemoryInputError。"""
    types = PHOTO_TYPES if kind == "photo" else AUDIO_TYPES if kind == "audio" else None
    if types is None:
        raise MemoryInputError("invalid_kind", "ファイルを付けられるのは写真と音声メモだけです")
    if not content:
        raise MemoryInputError("empty_file", "ファイルが空です")
    if len(content) > max_bytes:
        raise MemoryInputError("file_too_large", f"ファイルが大きすぎます(上限 {max_bytes // (1024 * 1024)}MB)")
    name = (filename or "").lower()
    ext = name[name.rfind("."):] if "." in name else ""
    if ext not in types:
        label = "写真" if kind == "photo" else "音声メモ"
        raise MemoryInputError("unsupported_type", f"{label}の形式に対応していません(対応: {', '.join(sorted(types))})")
    if not _magic_ok(ext, content):
        raise MemoryInputError("content_mismatch", f"ファイルの内容が拡張子({ext})と一致しません")
    return ext, types[ext]


def validate_video_url(url: Optional[str]) -> str:
    """動画は参照(https のURL)だけを持つ。認証情報を含むURL・https以外は受け付けない。"""
    value = (url or "").strip()
    if not value or len(value) > MAX_URL:
        raise MemoryInputError("invalid_video_url", "動画のURLを入力してください(2000文字まで)")
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.hostname:
        raise MemoryInputError("invalid_video_url", "動画のURLは https:// から始まるURLにしてください")
    if parts.username or parts.password:
        raise MemoryInputError("invalid_video_url", "ユーザー名やパスワードを含むURLは登録できません")
    return value


def clean_text(value: Optional[str], limit: int, label: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise MemoryInputError("invalid_field", f"{label}は文字列で入力してください")
    v = value.strip()
    if len(v) > limit:
        raise MemoryInputError("invalid_field", f"{label}は{limit}文字までです")
    return v or None


def check_location(latitude: Any, longitude: Any) -> Tuple[Optional[float], Optional[float]]:
    if latitude is None and longitude is None:
        return None, None
    if latitude is None or longitude is None:
        raise MemoryInputError("invalid_field", "緯度と経度は両方入力してください")
    for v, limit, label in ((latitude, 90, "緯度"), (longitude, 180, "経度")):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not -limit <= v <= limit:
            raise MemoryInputError("invalid_field", f"{label}の値が範囲外です")
    return float(latitude), float(longitude)


# ------------------------------------------------------------------ 旅行記の下書き

def _text_checks(body: Optional[str], names: Iterable[str]) -> List[str]:
    if not body:
        return []
    found = []
    if any(n and len(n) >= 2 and n in body for n in names):
        found.append("member_name")
    if _RESERVATION_LIKE.search(body):
        found.append("reservation_like")
    if _PHONE_LIKE.search(body):
        found.append("phone_like")
    return found


CHECK_MESSAGES = {
    "member_name": "同行者の名前が含まれています。公開してよいか確認してください",
    "reservation_like": "予約番号のような文字列が含まれています。公開する前に消してください",
    "phone_like": "電話番号のような文字列が含まれています。公開してよいか確認してください",
    "photo_people": "写真に人の顔が写っていないか確認してください(顔の自動判定は行っていません)",
    "location_included": "位置(緯度・経度)を含めています。自宅や宿の場所が分からないか確認してください",
}


def _time_key(m: Dict[str, Any]) -> Tuple[str, str]:
    occurred = m.get("occurred_at")
    return (occurred.isoformat() if isinstance(occurred, datetime) else str(occurred or "~"), str(m.get("id")))


def _memory_view(m: Dict[str, Any], include_location: bool, include_media: bool) -> Optional[Dict[str, Any]]:
    if m["kind"] in ("photo", "audio") and not include_media and not m.get("body"):
        return None
    out = {
        "id": str(m["id"]), "kind": m["kind"], "body": m.get("body"),
        "occurred_at": m["occurred_at"].isoformat() if isinstance(m.get("occurred_at"), datetime) else None,
        "place_name": m.get("place_name"),
        "has_media": bool(include_media and m["kind"] in ("photo", "audio")),
        "video_url": m.get("video_url") if include_media else None,
        "latitude": m.get("latitude") if include_location else None,
        "longitude": m.get("longitude") if include_location else None,
        "by_me": bool(m.get("by_me")),
    }
    return out


def _md_memory(v: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    if v["body"]:
        lines.extend(f"> {line}" if line else ">" for line in v["body"].splitlines())
    if v["has_media"]:
        lines.append("- 写真(アプリで表示)" if v["kind"] == "photo" else "- 音声メモ(アプリで再生)")
    if v["video_url"]:
        lines.append(f"- 動画: <{v['video_url']}>")
    if v["place_name"]:
        loc = f"(緯度 {v['latitude']:.5f}、経度 {v['longitude']:.5f})" if v["latitude"] is not None else ""
        lines.append(f"- 場所: {v['place_name']}{loc}")
    elif v["latitude"] is not None:
        lines.append(f"- 場所: 緯度 {v['latitude']:.5f}、経度 {v['longitude']:.5f}")
    return lines


def build_journal_draft(
    plan_title: str,
    days: List[Dict[str, Any]],
    events: List[Dict[str, Any]],
    memories: List[Dict[str, Any]],
    member_names: Iterable[str],
    include_locations: bool = False,
    include_media: bool = True,
    include_others: bool = False,
    generated_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """days: [{id, local_date(date), title}] / events: [{id, day_id, title, local_start_time, sort_order}]
    memories: 閲覧者に見える記録 [{id, kind, body, event_id, day_id, occurred_at, place_name, latitude, longitude,
    video_url, by_me, include_in_journal}](呼出側で見える範囲に絞る)。旅程は変えない。"""
    names = [n for n in member_names if n]
    day_by_id = {str(d["id"]): d for d in days}
    event_by_id = {str(e["id"]): e for e in events}
    used = [m for m in memories if m.get("include_in_journal", True) and (include_others or m.get("by_me"))]
    used.sort(key=_time_key)

    by_event: Dict[str, List[Dict[str, Any]]] = {}
    by_day: Dict[str, List[Dict[str, Any]]] = {}
    loose: List[Dict[str, Any]] = []
    for m in used:
        eid, did = str(m.get("event_id") or ""), str(m.get("day_id") or "")
        if eid and eid in event_by_id:
            by_event.setdefault(eid, []).append(m)
        elif did and did in day_by_id:
            by_day.setdefault(did, []).append(m)
        else:
            loose.append(m)

    checks: List[Dict[str, Any]] = []
    excluded_locations = 0
    included: List[Dict[str, Any]] = []

    def view(m):
        nonlocal excluded_locations
        v = _memory_view(m, include_locations, include_media)
        if v is None:
            return None
        if m.get("latitude") is not None and not include_locations:
            excluded_locations += 1
        included.append(m)
        for code in _text_checks(m.get("body"), names):
            checks.append({"code": code, "severity": "warning", "memory_id": v["id"], "message": CHECK_MESSAGES[code]})
        if v["has_media"] and m["kind"] == "photo":
            checks.append({"code": "photo_people", "severity": "info", "memory_id": v["id"],
                           "message": CHECK_MESSAGES["photo_people"]})
        if v["latitude"] is not None:
            checks.append({"code": "location_included", "severity": "warning", "memory_id": v["id"],
                           "message": CHECK_MESSAGES["location_included"]})
        return v

    def ev_key(e):
        return (e.get("local_start_time") or "99:99", e.get("sort_order") or 0, str(e["id"]))

    out_days = []
    md = [f"# {plan_title or '旅行記'}", ""]
    planned = recorded = 0
    for d in sorted(days, key=lambda x: (x["local_date"], str(x["id"]))):
        did = str(d["id"])
        entries: List[Dict[str, Any]] = []
        for e in sorted((e for e in events if str(e["day_id"]) == did), key=ev_key):
            planned += 1
            views = [v for v in (view(m) for m in by_event.get(str(e["id"]), [])) if v]
            status = "recorded" if views else "no_record"
            recorded += 1 if views else 0
            entries.append({"event_id": str(e["id"]), "title": e.get("title"),
                            "planned_time": e.get("local_start_time"), "status": status, "memories": views})
        day_notes = [v for v in (view(m) for m in by_day.get(did, [])) if v]
        local_date = d["local_date"]
        date_label = local_date.isoformat() if isinstance(local_date, date) else str(local_date)
        out_days.append({"day_id": did, "date": date_label, "title": d.get("title"), "entries": entries,
                         "day_memories": day_notes})
        md.append(f"## {date_label}" + (f" {d['title']}" if d.get("title") else ""))
        md.append("")
        for v in day_notes:
            md.extend(_md_memory(v))
        if day_notes:
            md.append("")
        for en in entries:
            md.append(f"### {(en['planned_time'] + ' ') if en['planned_time'] else ''}{en['title'] or '(名前なし)'}")
            if en["status"] == "no_record":
                md.append("(予定していた場所。記録はありません)")
            for v in en["memories"]:
                md.extend(_md_memory(v))
            md.append("")
    other = [v for v in (view(m) for m in loose) if v]
    if other:
        md.append("## そのほかの記録")
        md.append("")
        for v in other:
            md.extend(_md_memory(v))
        md.append("")

    if excluded_locations:
        checks.append({"code": "location_excluded", "severity": "info", "memory_id": None,
                       "message": f"位置(緯度・経度)は{excluded_locations}件の記録から除いています"})
    if include_others and any(not m.get("by_me") for m in included):
        checks.append({"code": "others_included", "severity": "info", "memory_id": None,
                       "message": "他のメンバーの記録を含めています。公開する前に本人に確認してください"})
    return {
        "title": plan_title,
        "algorithm_version": ALGORITHM_VERSION,
        "generated_at": generated_at.isoformat() if generated_at else None,
        "options": {"include_locations": include_locations, "include_media": include_media,
                    "include_others": include_others},
        "days": out_days,
        "other_memories": other,
        "summary": {"planned_events": planned, "recorded_events": recorded, "memories": len(included),
                    "photos": sum(1 for m in included if m["kind"] == "photo")},
        "checks": checks,
        "markdown": "\n".join(md).rstrip() + "\n",
    }
