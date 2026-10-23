#!/usr/bin/env python3
"""[Gate G3] CI-04 E2E の「再試行で通った試験」(flaky)を、合格とは別に数えて残す(標準ライブラリだけ)。

    python3 scripts/ci/e2e_flaky_report.py frontend/e2e-results/report.json [--issue]

- Playwright の JSON の結果から、合格・失敗・flaky(1回目に落ち、再試行で通った)を数え、job の要約へ書く
- flaky が1件でもあれば GitHub の注記(::warning)を出す。``--issue`` と GH_TOKEN(または GITHUB_TOKEN)・
  GITHUB_REPOSITORY があれば、spec ごとに issue(ラベル flaky-e2e)を作るか、開いている同じ題の issue に追記する
  (合格の扱いのままにせず、直すまで残す)
- 結果のファイルが無い・読めない時は失敗にしない(E2E の合否はこの前の段で決まっている)
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Tuple

LABEL = "flaky-e2e"


def collect(report: dict) -> Tuple[Dict[str, int], List[Tuple[str, str, str]]]:
    """戻り値: (件数, flaky の [(spec のファイル, 試験の名前, 1回目のエラーの先頭)])。"""
    counts = {"passed": 0, "failed": 0, "flaky": 0, "skipped": 0}
    flaky: List[Tuple[str, str, str]] = []

    def walk(suite: dict, file_name: str) -> None:
        fname = suite.get("file") or file_name
        for spec in suite.get("specs", []) or []:
            for test in spec.get("tests", []) or []:
                status = test.get("status")  # expected / unexpected / flaky / skipped
                if status == "flaky":
                    counts["flaky"] += 1
                    first = (test.get("results") or [{}])[0]
                    err = ((first.get("error") or {}).get("message") or "").strip().splitlines()
                    flaky.append((fname, spec.get("title", ""), (err[0] if err else "")[:200]))
                elif status == "unexpected":
                    counts["failed"] += 1
                elif status == "skipped":
                    counts["skipped"] += 1
                else:
                    counts["passed"] += 1
        for child in suite.get("suites", []) or []:
            walk(child, fname)

    for suite in report.get("suites", []) or []:
        walk(suite, suite.get("file", ""))
    return counts, flaky


def summary(counts: Dict[str, int], flaky: List[Tuple[str, str, str]]) -> str:
    lines = ["### %s E2E の再試行" % ("⚠️" if flaky else "✅"), "",
             "| 合格 | 失敗 | 再試行で合格(flaky) | 飛ばし |", "|---:|---:|---:|---:|",
             "| %d | %d | %d | %d |" % (counts["passed"], counts["failed"], counts["flaky"], counts["skipped"]), ""]
    for f, t, e in flaky:
        lines.append("- `%s` — %s(1回目: %s)" % (f, t, e.replace("\n", " ")))
    return "\n".join(lines) + "\n"


def _api(method: str, url: str, token: str, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as res:  # noqa: S310 - GitHub の API だけ
        return json.loads(res.read().decode() or "null")


def file_issues(flaky: List[Tuple[str, str, str]], repo: str, token: str, sha: str) -> int:
    base = "https://api.github.com/repos/%s" % repo
    by_file: Dict[str, List[Tuple[str, str]]] = {}
    for f, t, e in flaky:
        by_file.setdefault(f, []).append((t, e))
    done = 0
    for f, items in by_file.items():
        title = "E2E flaky: %s" % f
        body = "commit `%s` で、再試行で合格した試験があります(合格の扱いのまま放置しない)。\n\n" % sha[:12]
        body += "\n".join("- %s — %s" % (t, e) for t, e in items)
        q = urllib.parse.quote('repo:%s is:issue is:open label:%s in:title "%s"' % (repo, LABEL, title))
        found = _api("GET", "https://api.github.com/search/issues?q=" + q, token) or {}
        hits = [i for i in found.get("items", []) if i.get("title") == title]
        if hits:
            _api("POST", "%s/issues/%d/comments" % (base, hits[0]["number"]), token, {"body": body})
        else:
            _api("POST", base + "/issues", token, {"title": title, "body": body, "labels": [LABEL]})
        done += 1
    return done


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("report")
    ap.add_argument("--issue", action="store_true")
    args = ap.parse_args(argv)
    p = Path(args.report)
    if not p.is_file():
        print("[e2e-flaky] 結果のファイルがありません: %s" % p)
        return 0
    try:
        counts, flaky = collect(json.loads(p.read_text(encoding="utf-8")))
    except (ValueError, OSError) as e:
        print("[e2e-flaky] 結果を読めません: %s" % e)
        return 0
    text = summary(counts, flaky)
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(text)
    sys.stdout.write(text)
    for f, t, _e in flaky:
        print("::warning file=frontend/%s::E2E flaky(再試行で合格): %s" % (f, t))
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if args.issue and flaky and token and repo:
        try:
            n = file_issues(flaky, repo, token, os.environ.get("GITHUB_SHA", ""))
            print("[e2e-flaky] issue を %d 件作成・追記しました" % n)
        except Exception as e:  # noqa: BLE001 - issue の作成の失敗で CI を落とさない
            print("[e2e-flaky] issue を作れませんでした: %s" % e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
