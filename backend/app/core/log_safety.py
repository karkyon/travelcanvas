"""[Gate O2] ログの個人情報・秘密の保護(B-009)。

2つの部品からなる。どちらも標準ライブラリだけで書き、backend・試験・ホスト側の運用 CLI
(``scripts/ops/tcops.py log-scan``)から同じものを使う。

1. ``redact(text)`` と ``install()``: ログの記録(LogRecord)を作る時点で、本文・引数・例外の文面から
   メールアドレス・JWT・暗号文(Fernet)・パスワードのハッシュ・Bearer トークン・接続文字列の資格情報・
   URL の秘密のパラメータ(token= 等)・共有リンクのトークンを伏せる。記録の工場(record factory)に
   入れるので、どのロガー・どの出力先(uvicorn のアクセスログ、SQLAlchemy、Python 既定の stderr)にも効く。
2. ``find_leaks(text, secrets)``: ログの文面から、上の種類の値と「既知の秘密の値」(試験中に発行した
   トークン・パスワード)を探す。見つけた値そのものは返さない(種類・行番号・伏せた抜粋だけ)。

伏せ方の方針:
- 伏せた後も、何が起きたか(どの経路・どの状態)は読めるようにする。値の種類は ``<email>`` のように残す。
- 何度かけても同じ結果になる(冪等)。
- 誤って伏せすぎても障害にはならない(ログが読みにくくなるだけ)ので、迷う形は伏せる側に倒す。
"""
from __future__ import annotations

import logging
import numbers
import re
import traceback
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# 伏せる規則(順序に意味がある: 接続文字列の資格情報 → URL のパラメータ → 個別の値)
# ---------------------------------------------------------------------------

_RULES: Sequence[Tuple[str, "re.Pattern[str]", str]] = (
    # scheme://user:password@host → scheme://***@host
    ("url_credentials", re.compile(r"(?P<scheme>\b[a-zA-Z][a-zA-Z0-9+.\-]*://)[^/@\s'\"<>]+@"), r"\g<scheme>***@"),
    # Authorization: Bearer xxx
    ("bearer", re.compile(r"(?i)\b(bearer)\s+(?!\*\*\*)[A-Za-z0-9._~+/\-]+=*"), r"\1 ***"),
    # URL・フォームの秘密のパラメータ
    ("query_secret", re.compile(
        r"(?i)([?&;](?:token|access_token|refresh_token|id_token|sig|signature|code|passcode|password|"
        r"api_key|apikey|key|secret|client_secret)=)(?!\*\*\*)[^&\s\"'#<>]+"), r"\1***"),
    # 共有リンクのトークン(パスの中): /public/share/<token>/resolve、/s/<token>
    ("share_token", re.compile(r"(/public/share/|/s/)(?!\*\*\*)[A-Za-z0-9_\-.~%]{8,}"), r"\1***"),
    # JWT(アクセス・ゲスト・リフレッシュ)
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}"), "<jwt>"),
    # Fernet の暗号文(予約番号・チケット・秘匿制約・位置などの暗号化列)
    ("ciphertext", re.compile(r"\bgAAAAA[A-Za-z0-9_\-]{20,}={0,2}"), "<ciphertext>"),
    # bcrypt のパスワードハッシュ
    ("password_hash", re.compile(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}"), "<password-hash>"),
    # password=xxx / "password": "xxx" / secret: xxx(ログの文に混ざった秘密)
    ("key_value_secret", re.compile(
        r"(?i)(\b(?:password|passwd|passcode|secret|api_key|client_secret|access_token|refresh_token|token)"
        r"['\"]?\s*[:=]\s*['\"]?)(?!\*\*\*)[^\s'\",;&}\])]+"), r"\1***"),
    # PostgreSQL のエラー文に入る値(hide_parameters では消えない): DETAIL の Key (列)=(値)、
    # 型変換エラーの "値"、エラー位置の LINE n: (クライアント側で値を埋め込んだ SQL)
    ("db_error_value", re.compile(r"(\bKey \([^)]*\)=\()(?!\*\*\*\))[^)]*(?=\))"), r"\1***"),
    ("db_error_value", re.compile(r"(\binvalid input (?:syntax|value) for [^:\n]*:\s*)\"(?!\*\*\*\")[^\"]*\""),
     r'\1"***"'),
    ("db_error_value", re.compile(r"(\bLINE \d+:\s*)(?!<sql>)\S.*"), r"\1<sql>"),
    # メールアドレス(接続文字列の資格情報を先に伏せているので、user@host の誤検出は起きにくい)
    ("email", re.compile(r"(?<![\w.%+\-])[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}\b"),
     "<email>"),
)

# SQLAlchemy の echo が SQL の値(引数)を出している行。hide_parameters=True なら値は出ない。
_SQL_PARAMS_RE = re.compile(r"\[(?:generated in|cached since|raw sql|dialect \w+ does not support)[^\]]*\]\s*(?!\[SQL)"
                            r"[\(\{\[]")
_SQL_PARAMS_HIDDEN = "[SQL parameters hidden"

LEAK_KINDS = tuple(dict.fromkeys(name for name, _, _ in _RULES)) + ("sql_parameters", "known_secret")
# 自己試験(わざと秘密を出して伏せることを確かめる)用のロガー。出どころの検査から外す。
SELFTEST_LOGGER_PREFIX = "tc.selftest"


def redact(text: str) -> str:
    """文面の秘密・個人情報を伏せる(冪等)。"""
    if not text:
        return text
    for _, pattern, repl in _RULES:
        text = pattern.sub(repl, text)
    return text


class _Redacted:
    """%s / %r で整形された時に、伏せた文字列を返す引数の包み。"""

    __slots__ = ("_s", "_r")

    def __init__(self, value: object) -> None:
        self._s = redact(str(value))
        self._r = redact(repr(value))

    def __str__(self) -> str:
        return self._s

    def __repr__(self) -> str:
        return self._r

    def __format__(self, spec: str) -> str:
        return format(self._s, spec)


def _safe_arg(value: object) -> object:
    if value is None or isinstance(value, numbers.Number):
        return value  # %d・%f で整形される数(Decimal を含む)は変えない
    if isinstance(value, str):
        return redact(value)
    return _Redacted(value)


def sanitize_record(record: logging.LogRecord) -> logging.LogRecord:
    """LogRecord の本文・引数・例外の文面を伏せる。"""
    if isinstance(record.msg, str):
        record.msg = redact(record.msg)
    elif record.msg is not None and not isinstance(record.msg, (int, float)):
        record.msg = redact(str(record.msg))
    args = record.args
    if isinstance(args, tuple):
        record.args = tuple(_safe_arg(a) for a in args)
    elif isinstance(args, dict):
        record.args = {k: _safe_arg(v) for k, v in args.items()}
    if record.exc_info and record.exc_info[0] is not None and not record.exc_text:
        record.exc_text = redact("".join(traceback.format_exception(*record.exc_info)).rstrip("\n"))
    if record.stack_info:
        record.stack_info = redact(record.stack_info)
    return record


_INSTALLED = {"factory": None}
_INSPECTOR: Dict[str, object] = {"fn": None}


def set_raw_inspector(fn) -> None:
    """伏せる前の記録を検査する関数を登録する(試験用。None で解除)。"""
    _INSPECTOR["fn"] = fn


# リクエストの URL を丸ごと INFO で出すライブラリ。URL には検索語(外部検索への通信)やトークンが入るので、
# WARNING 以上だけにする(出しても上の規則で伏せるが、出どころで抑える)。
QUIET_LIBRARY_LOGGERS = ("httpx", "httpcore", "urllib3", "hpack")


def install() -> None:
    """記録の工場に伏せる処理を入れ、URL を出すライブラリのログを抑える(何度呼んでも1回だけ)。"""
    if _INSTALLED["factory"] is not None:
        return
    for name in QUIET_LIBRARY_LOGGERS:
        lg = logging.getLogger(name)
        if lg.level == logging.NOTSET or lg.level < logging.WARNING:
            lg.setLevel(logging.WARNING)
    previous = logging.getLogRecordFactory()

    def factory(*args, **kwargs):
        record = previous(*args, **kwargs)
        inspector = _INSPECTOR["fn"]
        if inspector is not None:
            try:
                inspector(record)  # type: ignore[operator]
            except Exception:  # noqa: BLE001 - 検査の失敗でログを止めない
                pass
        return sanitize_record(record)

    factory.__travelcanvas_redaction__ = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(factory)
    _INSTALLED["factory"] = previous


def installed() -> bool:
    return bool(getattr(logging.getLogRecordFactory(), "__travelcanvas_redaction__", False))


# ---------------------------------------------------------------------------
# 検査
# ---------------------------------------------------------------------------

def _excerpt(line: str, start: int, end: int, width: int = 40) -> str:
    """見つけた箇所の前後を、伏せた形で返す(値そのものは出さない)。"""
    left = max(0, start - width)
    right = min(len(line), end + width)
    masked = line[left:start] + "«" + "#" * min(8, max(1, end - start)) + "»" + line[end:right]
    return redact(masked).strip()


def find_leaks(text: str, secrets: Iterable[str] = (), *, max_findings: int = 200,
               allow_emails: Iterable[str] = ()) -> List[Dict[str, object]]:
    """文面から漏れを探す。戻り値は [{kind, line, excerpt}](値そのものは含めない)。

    secrets: 既知の秘密の値(8文字以上のものだけ使う)。
    allow_emails: 出てよいメールアドレス(運営の送信元など)。
    """
    known = sorted({s for s in secrets if isinstance(s, str) and len(s) >= 8}, key=len, reverse=True)
    allowed = {e.lower() for e in allow_emails}
    findings: List[Dict[str, object]] = []
    for no, line in enumerate((text or "").splitlines(), start=1):
        if len(findings) >= max_findings:
            break
        for secret in known:
            idx = line.find(secret)
            if idx >= 0:
                findings.append({"kind": "known_secret", "line": no, "excerpt": _excerpt(line, idx, idx + len(secret))})
                line = line.replace(secret, "***")
        m = _SQL_PARAMS_RE.search(line)
        if m and _SQL_PARAMS_HIDDEN not in line:
            findings.append({"kind": "sql_parameters", "line": no, "excerpt": _excerpt(line, m.end() - 1, len(line))})
        for name, pattern, _ in _RULES:
            for mm in pattern.finditer(line):
                matched = mm.group(0)
                if name == "email" and matched.lower() in allowed:
                    continue
                if "***" in matched and name in ("url_credentials",):
                    continue
                # 前置き(/public/share/ や token= など)は残し、値の部分だけを伏せて抜粋する
                start = mm.end(1) if pattern.groups else mm.start()
                findings.append({"kind": name, "line": no, "excerpt": _excerpt(line, start, mm.end())})
    return findings[:max_findings]


def summarize(findings: Sequence[Dict[str, object]]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for f in findings:
        out[str(f["kind"])] = out.get(str(f["kind"]), 0) + 1
    return dict(sorted(out.items()))


class LeakCollector(logging.Handler):
    """試験用: 出力されるすべてのログを整形して検査し、漏れだけを溜める(全文は溜めない)。"""

    def __init__(self, level: int = logging.DEBUG) -> None:
        super().__init__(level)
        self.secrets: set = set()
        self.findings: List[Dict[str, object]] = []
        self.records = 0
        self.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))

    def add_secret(self, value: Optional[str]) -> None:
        if isinstance(value, str) and len(value) >= 8:
            self.secrets.add(value)

    def inspect_raw(self, record: logging.LogRecord) -> None:
        """伏せる前の記録を検査する(出どころの不備を、ソースのファイル:行つきで見つける)。"""
        if record.name.startswith(SELFTEST_LOGGER_PREFIX):
            return
        try:
            text = record.getMessage()
        except Exception:  # noqa: BLE001
            text = str(record.msg)
        for f in find_leaks(text, self.secrets, max_findings=5):
            f = dict(f)
            f["kind"] = "source:" + str(f["kind"])
            f["logger"] = record.name
            f["level"] = record.levelname
            f["line"] = "%s:%s" % (record.pathname.rsplit("/backend/", 1)[-1], record.lineno)
            if len(self.findings) < 200:
                self.findings.append(f)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            text = self.format(record)
        except Exception:  # noqa: BLE001 - 整形できない記録も検査の対象にする
            text = "%s %s %r" % (record.levelname, record.name, record.msg)
        self.records += 1
        for f in find_leaks(text, self.secrets, max_findings=5):
            f = dict(f)
            f["logger"] = record.name
            f["level"] = record.levelname
            if len(self.findings) < 200:
                self.findings.append(f)
