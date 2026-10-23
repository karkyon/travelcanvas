"""[Gate G4] MAP-03 検索のコマンド(``>予定を追加 11/3 10:00 清水寺`` 等)の一覧と、入力の読み取り(DB 非依存)。

検索(読むだけ)と操作を分ける:
- 検索の窓で ``>`` から始めるとコマンドになる。読み取り(``parse``)と確認(preview)は何も変えない
- 実行は確認の画面の後だけ(execute。Idempotency-Key と旅行の revision(If-Match)が必須)。権限は役割で確かめる
- 予定・日程・候補を足すコマンドは「元に戻す」ができる(自分が実行し、その後に別の変更が無い時だけ)
- 移動だけのコマンド(画面を開く)は確認なしで、何も変えない

日付は旅行の日程から決める: ``11/3``・``2026-11-03``・``2日目``。時刻は ``10:00``・``9:30``(省略できる)。
"""
from dataclasses import dataclass, field
from datetime import date
import re
from typing import Dict, List, Optional, Sequence, Tuple

MAX_TITLE = 200


@dataclass(frozen=True)
class Command:
    name: str
    label: str
    aliases: Tuple[str, ...]
    kind: str               # mutate / navigate / run
    min_role: str           # viewer / editor
    undoable: bool
    usage: str
    path: Optional[str] = None  # navigate の時の画面(/planner/{plan_id}/...)


COMMANDS: Tuple[Command, ...] = (
    Command("add_event", "予定を追加", ("予定を追加", "予定追加", "予定"), "mutate", "editor", True,
            "予定を追加 11/3 10:00 清水寺"),
    Command("add_day", "日程を追加", ("日程を追加", "日程追加", "日を追加"), "mutate", "editor", True,
            "日程を追加 11/4"),
    Command("add_candidate", "候補を追加", ("候補を追加", "候補追加", "候補に追加"), "mutate", "editor", True,
            "候補を追加 錦市場"),
    Command("run_validation", "検証を実行", ("検証を実行", "検証", "チェック"), "run", "viewer", False,
            "検証を実行"),
    Command("open_today", "今日の画面を開く", ("今日", "今日の画面"), "navigate", "viewer", False, "今日",
            "/planner/{plan_id}/today"),
    Command("open_reservations", "予約を開く", ("予約", "予約を開く"), "navigate", "viewer", False, "予約",
            "/planner/{plan_id}/reservations"),
    Command("open_candidates", "候補箱を開く", ("候補箱", "候補箱を開く"), "navigate", "viewer", False, "候補箱",
            "/planner/{plan_id}/candidates"),
    Command("open_expenses", "費用を開く", ("費用", "費用を開く", "精算"), "navigate", "viewer", False, "費用",
            "/planner/{plan_id}/expenses"),
    Command("open_discussion", "投票・コメントを開く", ("投票", "コメント", "相談"), "navigate", "viewer", False,
            "投票", "/planner/{plan_id}/discussion"),
)
BY_NAME: Dict[str, Command] = {c.name: c for c in COMMANDS}
_ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}

_DATE_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_DATE_MD = re.compile(r"^(\d{1,2})/(\d{1,2})$")
_DAY_N = re.compile(r"^(\d{1,3})日目$")
_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


class CommandError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def allowed(cmd: Command, role: Optional[str]) -> bool:
    return _ROLE_RANK.get(role or "", 0) >= _ROLE_RANK[cmd.min_role]


def registry(role: Optional[str]) -> List[dict]:
    return [{"name": c.name, "label": c.label, "kind": c.kind, "usage": c.usage, "undoable": c.undoable,
             "allowed": allowed(c, role), "aliases": list(c.aliases)} for c in COMMANDS]


def _match(text: str) -> Tuple[Command, str]:
    body = text.strip()
    if body.startswith(">"):
        body = body[1:].strip()
    if not body:
        raise CommandError("command_empty", "コマンドを入力してください(例: 予定を追加 11/3 10:00 清水寺)")
    best: Optional[Tuple[Command, str]] = None
    for c in COMMANDS:
        for a in sorted(c.aliases, key=len, reverse=True):
            if body == a or body.startswith(a + " ") or body.startswith(a + "　"):
                if best is None or len(a) > len(best[1]):
                    best = (c, a)
                break
    if best is None:
        raise CommandError("command_unknown", "そのコマンドはありません。「>」の後に、一覧のコマンドを入力してください")
    return best[0], body[len(best[1]):].strip()


def _resolve_date(token: str, day_dates: Sequence[date], default_year: int) -> Optional[date]:
    m = _DATE_ISO.match(token)
    try:
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        m = _DATE_MD.match(token)
        if m:
            mo, d = int(m.group(1)), int(m.group(2))
            same = [x for x in day_dates if x.month == mo and x.day == d]
            if same:
                return sorted(same)[0]
            return date(default_year, mo, d)
    except ValueError:
        raise CommandError("command_invalid", "日付「%s」はありません" % token)
    m = _DAY_N.match(token)
    if m:
        n = int(m.group(1))
        ordered = sorted(day_dates)
        if not 1 <= n <= len(ordered):
            raise CommandError("command_invalid", "%d日目の日程がありません" % n)
        return ordered[n - 1]
    return None


@dataclass
class Parsed:
    command: Command
    args: Dict[str, object] = field(default_factory=dict)


def parse(text: str, day_dates: Sequence[date], default_year: int) -> Parsed:
    """入力を読み取り、コマンドと引数にする(DB を変えない)。日付は旅行の日程(day_dates)から決める。"""
    if len(text or "") > 300:
        raise CommandError("command_invalid", "コマンドが長すぎます(300文字まで)")
    cmd, rest = _match(text or "")
    tokens = rest.replace("　", " ").split()
    if cmd.name == "add_event":
        if not tokens:
            raise CommandError("command_invalid", "日付と予定の名前を入れてください(例: %s)" % cmd.usage)
        d = _resolve_date(tokens[0], day_dates, default_year)
        if d is None:
            raise CommandError("command_invalid", "最初に日付(11/3・2026-11-03・2日目)を入れてください")
        tokens = tokens[1:]
        t = None
        tm = _TIME.match(tokens[0]) if tokens else None
        if tm:
            h, mi = tm.groups()
            t = "%02d:%s" % (int(h), mi)
            tokens = tokens[1:]
        title = " ".join(tokens).strip()
        if not title:
            raise CommandError("command_invalid", "予定の名前を入れてください")
        if len(title) > MAX_TITLE:
            raise CommandError("command_invalid", "予定の名前は%d文字までです" % MAX_TITLE)
        return Parsed(cmd, {"date": d.isoformat(), "time": t, "title": title})
    if cmd.name == "add_day":
        if len(tokens) != 1:
            raise CommandError("command_invalid", "日付を1つ入れてください(例: %s)" % cmd.usage)
        d = _resolve_date(tokens[0], [], default_year)
        if d is None or _DAY_N.match(tokens[0]):
            raise CommandError("command_invalid", "日付は 11/4 か 2026-11-04 の形で入れてください")
        return Parsed(cmd, {"date": d.isoformat()})
    if cmd.name == "add_candidate":
        title = " ".join(tokens).strip()
        if not title:
            raise CommandError("command_invalid", "候補の名前を入れてください(例: %s)" % cmd.usage)
        if len(title) > MAX_TITLE:
            raise CommandError("command_invalid", "候補の名前は%d文字までです" % MAX_TITLE)
        return Parsed(cmd, {"title": title})
    if tokens:
        raise CommandError("command_invalid", "「%s」には続きを入れません" % cmd.label)
    return Parsed(cmd, {})


def default_year(day_dates: Sequence[date], plan_start: Optional[date], today: date) -> int:
    """月/日 だけの時の年: 旅行の日程・開始日の年、無ければ今日から見て次に来るその月/日の年(呼ぶ側で使う)。"""
    if day_dates:
        return sorted(day_dates)[0].year
    if plan_start:
        return plan_start.year
    return today.year
