#!/usr/bin/env python3
"""[Gate G11] E2E の間の接続元の点数(Gate S6 の自動遮断)の見積もりを、backend の access log から出す(標準ライブラリだけ)。

    docker compose logs -t --no-color backend | python3 scripts/ci/e2e_guard_report.py

CI の E2E で、途中から全ての要求が 429(「短時間に不審な操作が続いた」)になる連鎖が2回あった(PR #13・#15 の
pull_request の run)。サンドボックスの全件では点数は 150 に届かない(最大 95)。CI の job の log は手元から読めないため、
失敗の時も合格の時も、何の応答が点数になったかを job の要約と注記(::notice)に残す。

- 点数は ``app/services/threat_guard.py`` の ``classify_response`` に合わせた見積もり(log に Authorization の有無が無いため、
  ログイン以外の 401 は bearer 付きとして数える = 上限の見積もり)。428(計算の確認)は 2 点の上限で数える
- 時間窓(既定 900 秒)の中の合計の最大と、その時刻。遮断の log(「接続元を一時遮断しました」)の時刻
- 経路の ID(UUID)・長い token は伏せる。query は落とす。接続元の IP は出さない
- 読めない行は飛ばす。報告を作れなくても失敗にしない(E2E の合否はこの前の段で決まっている)
"""
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Tuple

WINDOW_SECONDS = 900
# [Gate G11] threat_guard が実際に足した点数の log(``guard: 点数 +3 rate_limited(/api/v1/auth/register)= 42``)
SIGNAL = re.compile(r"guard: 点数 \+(?P<w>\d+) (?P<kind>[a-z_]+)\((?P<route>[^)]*)\)= (?P<score>\d+)")
ACCESS = re.compile(r'"(?P<method>[A-Z]+) (?P<path>\S+) HTTP/[0-9.]+" (?P<status>\d{3})')
STAMP = re.compile(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z')
UUID = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
EXEMPT = ("/health", "/ready", "/metrics", "/api/v1/health")


def template(path: str) -> str:
    """経路の ID・token を伏せる(共有の URL の token は秘密なので出さない)。"""
    path = path.split("?", 1)[0]
    parts = []
    for part in path.split("/"):
        if UUID.fullmatch(part):
            parts.append("{id}")
        elif len(part) >= 20 and re.fullmatch(r"[A-Za-z0-9_\-.~]+", part):
            parts.append("{token}")
        else:
            parts.append(part)
    return "/".join(parts)


def weight(method: str, path: str, status: int) -> int:
    """classify_response と同じ分け方の点数(ログイン以外の 401 は bearer 付きとして数える上限)。"""
    if status < 400 or path.startswith(EXEMPT) or not path.startswith("/api/"):
        return 0
    if status == 401:
        return 5 if path.endswith("/auth/login") else 3
    if status == 403:
        return 2
    if status == 404 and UUID.search(path):
        return 2
    if status == 429:
        return 3
    if status == 413:
        return 10
    if status == 428:
        return 2
    return 0


def _stamp(line: str) -> Optional[float]:
    m = STAMP.search(line)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def analyse(lines: Iterable[str]) -> dict:
    events: List[Tuple[Optional[float], int, str]] = []
    routes: Counter = Counter()
    points: Counter = Counter()
    blocks: List[str] = []
    actual: Counter = Counter()
    actual_before_block: Counter = Counter()
    actual_total, actual_peak = 0, 0
    for line in lines:
        s = SIGNAL.search(line)
        if s:
            w = int(s.group("w"))
            key = f'{s.group("kind")} {s.group("route")}'
            actual[key] += w
            if not blocks:
                actual_before_block[key] += w
            actual_total += w
            actual_peak = max(actual_peak, int(s.group("score")))
            continue
        if "接続元を一時遮断しました" in line:
            m = STAMP.search(line)
            detail = line.split("guard:", 1)[-1].strip()
            blocks.append(f"{m.group(1) if m else '?'} {detail}"[:160])
            continue
        m = ACCESS.search(line)
        if not m:
            continue
        status = int(m.group("status"))
        if status < 400:
            continue
        key = f'{m.group("method")} {template(m.group("path"))} {status}'
        routes[key] += 1
        w = weight(m.group("method"), m.group("path"), status)
        if w:
            points[key] += w
            events.append((_stamp(line), w, key))
    timed = sorted((t, w) for t, w, _ in events if t is not None)
    peak, peak_at, j, total = 0, None, 0, 0
    for i, (t, w) in enumerate(timed):
        total += w
        while timed[j][0] < t - WINDOW_SECONDS:
            total -= timed[j][1]
            j += 1
        if total > peak:
            peak, peak_at = total, t
    return {
        "actual": actual, "actual_before_block": actual_before_block, "actual_total": actual_total,
        "actual_peak": actual_peak,
        "points": sum(w for _, w, _ in events), "routes": routes, "by_points": points, "blocks": blocks,
        "peak": peak if timed else None,
        "peak_at": datetime.fromtimestamp(peak_at, timezone.utc).strftime("%H:%M:%S") if peak_at else None,
    }


def render(result: dict, top: int = 15) -> str:
    lines = ["## E2E の接続元の点数(Gate S6)", ""]
    if result["actual_total"]:
        lines.append(f"- **実際に足した点数**: 合計 {result['actual_total']}・時間窓の点数の最大 {result['actual_peak']}")
        lines += ["", "| 実際の点数(最初の遮断より前) | 種類と経路の型 |", "|---:|---|"]
        for key, pts in result["actual_before_block"].most_common(top):
            lines.append(f"| {pts} | `{key}` |")
        lines += ["", "以下は access log からの上限の見積もり(遮断の後の 429 も含む)", ""]
    peak = result["peak"]
    lines.append(f"- 点数の合計(上限の見積もり): {result['points']}")
    lines.append(f"- {WINDOW_SECONDS} 秒の窓の最大: {peak if peak is not None else '時刻なし'}"
                 + (f"(UTC {result['peak_at']} まで)" if result["peak_at"] else ""))
    lines.append(f"- 遮断の log: {len(result['blocks'])} 件")
    for b in result["blocks"][:5]:
        lines.append(f"  - {b}")
    lines += ["", "| 点数 | 件数 | 応答 |", "|---:|---:|---|"]
    for key, pts in result["by_points"].most_common(top):
        lines.append(f"| {pts} | {result['routes'][key]} | `{key}` |")
    return "\n".join(lines) + "\n"


def main() -> int:
    try:
        result = analyse(sys.stdin)
        text = render(result)
    except Exception as error:  # noqa: BLE001
        print(f"::warning::接続元の点数の報告を作れませんでした: {error}")
        return 0
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text)
    if os.environ.get("GITHUB_ACTIONS"):
        short = [f"実際 合計 {result['actual_total']}・最大 {result['actual_peak']}(遮断の前の内訳)"]
        short += [f"{pts} {key}" for key, pts in result["actual_before_block"].most_common(8)]
        short += [f"見積もり 合計 {result['points']}・窓の最大 {result['peak']}・遮断 {len(result['blocks'])} 件"]
        short += result["blocks"][:2]
        short += [f"{pts} {key}" for key, pts in result["by_points"].most_common(6)]
        print("::notice title=E2E guard report::" + "%0A".join(s.replace("%", "%25") for s in short))
    return 0


if __name__ == "__main__":
    sys.exit(main())
