#!/usr/bin/env python3
"""[Gate G3] UX-04 エラーの一覧(docs/spec/error-catalog.md)を backend のコードから作る(標準ライブラリだけ)。

    python3 scripts/ci/render_error_catalog.py          # 書き出す
    python3 scripts/ci/render_error_catalog.py --check  # 文書がコードと一致するか(違えば終了コード 1)

backend/app の中で、エラーの code(``"code": "…"``・``_bad("…", "利用者向けの文", 状態)`` 等)と、近くにある
利用者向けの文・HTTP の状態を拾う。応答の決まり(request_id・retry)は app/core/error_catalog.py。
"""
import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "backend" / "app"
DOC = ROOT / "docs" / "spec" / "error-catalog.md"
# 応答のエラーではない(警告・画面の注記・運用の道具)
NOT_ERRORS = {"location_included", "location_excluded", "others_included", "photo_people", "weather_unavailable",
              "metrics_unavailable"}
PAT = re.compile(r'(?:"code"\s*:\s*|\b_?(?:bad|err|error|conflict|problem|fail|raise_\w+|_bad\w*|_http\w*)\(\s*)'
                 r'"([a-z][a-z0-9_]{2,})"')
JA = re.compile(r'"([^"\n]*[ぁ-んァ-ヶ一-龠][^"\n]*)"')
STATUS = re.compile(r"\b(4\d\d|5\d\d)\b")


def _retry(status: str, code: str) -> str:
    sys.path.insert(0, str(ROOT / "backend"))
    try:
        from app.core.error_catalog import retry_for  # noqa: WPS433 - 標準ライブラリだけで読める
    except Exception:  # noqa: BLE001
        return "—"
    return retry_for(int(status), code) if status else "—"


def collect():
    found = defaultdict(lambda: {"statuses": set(), "message": "", "files": set()})
    for path in sorted(APP.rglob("*.py")):
        src = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT).as_posix()
        for m in PAT.finditer(src):
            code = m.group(1)
            if code in NOT_ERRORS:
                continue
            after = src[m.end():m.end() + 400]
            entry = found[code]
            msg = JA.search(after)
            if msg and not entry["message"]:
                text = re.sub(r"\{[^}]*\}", "…", msg.group(1)).strip()
                entry["message"] = text[:90]
            # 状態は同じ呼び出しの中(code の後、閉じ括弧まで)を先に、無ければ直前(status_code=… detail={"code"…})を探す
            depth, end = 0, len(after)
            for i, ch in enumerate(after):
                if ch in "([{":
                    depth += 1
                elif ch in ")]}":
                    if depth == 0:
                        end = i
                        break
                    depth -= 1
            # [Gate G8] 直前を探す時は、code に一番近い状態を使う(以前は 160 文字の中で最初の状態を拾い、前の行の
            # raise の状態と取り違えることがあった)
            before = list(STATUS.finditer(src[max(0, m.start() - 160):m.start()]))
            st = STATUS.search(after[:end]) or (before[-1] if before else None)
            if st:
                entry["statuses"].add(st.group(1))
            entry["files"].add(rel.replace("backend/app/", ""))
    return found


def render(found) -> str:
    lines = [
        "# エラーの一覧(Gate G3・UX-04)",
        "",
        "> このファイルは `scripts/ci/render_error_catalog.py` が backend のコードから作る(手で直さない)。",
        "> 応答の決まりは `backend/app/core/error_catalog.py`。",
        "",
        "## 応答の形",
        "",
        "```json",
        '{"detail": "利用者向けの文、または {\\"code\\", \\"message\\", ...}、または入力の検証の一覧",',
        ' "request_id": "問い合わせ番号(応答の X-Request-ID と同じ)",',
        ' "retry": "later | after_reload | no",',
        ' "code": "detail.code(5xx は internal_error)"}',
        "```",
        "",
        "- `retry`: `later` = 時間をおいてもう一度(429・5xx)、`after_reload` = 読み直してからもう一度(版の競合の 409・412・428)、"
        "`no` = 入力・権限を直さない限り同じ結果",
        "- 画面は `detail.message`(文字列の `detail`)を出す。5xx は決まった文と問い合わせ番号だけ(例外の文・SQL・秘密の値は出さない)",
        "- 入力の検証(422)の `detail` は FastAPI の一覧(`loc`・`msg`・`type`)。送った値(`input`)は返さない",
        "",
        "## code の一覧",
        "",
        "| code | HTTP | 再試行 | 利用者向けの文(例) | 場所 |",
        "|---|---|---|---|---|",
    ]
    for code in sorted(found):
        e = found[code]
        statuses = sorted(e["statuses"])
        retry = ", ".join(sorted({_retry(s, code) for s in statuses})) if statuses else "—"
        lines.append("| `%s` | %s | %s | %s | %s |" % (
            code, ", ".join(statuses) or "—", retry, e["message"].replace("|", "/") or "—",
            ", ".join(sorted(e["files"]))[:120]))
    lines.append("")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    text = render(collect())
    if args.check:
        if not DOC.is_file() or DOC.read_text(encoding="utf-8") != text:
            print("[error-catalog] docs/spec/error-catalog.md がコードと一致しません。"
                  "python3 scripts/ci/render_error_catalog.py で作り直してください")
            return 1
        print("[error-catalog] 一致")
        return 0
    DOC.parent.mkdir(parents=True, exist_ok=True)
    DOC.write_text(text, encoding="utf-8")
    print("[error-catalog] %d 件を書き出しました" % text.count("\n| `"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
