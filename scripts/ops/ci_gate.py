#!/usr/bin/env python3
"""[Gate S11] SEC-24 main の保護と CI の合格を必須にする運用の道具(標準ライブラリだけ。omega-dev2 の python3 で動く)。

    python3 scripts/ops/ci_gate.py wait --sha <commit> [--timeout 3600]
        その commit の CI(必須の5つのジョブ)が全部合格するまで待つ。0=合格、1=不合格、2=時間切れ・GitHub に届かない
    python3 scripts/ops/ci_gate.py protect [--dry-run]
        GitHub の main を保護する(必須の CI・管理者も迂回しない・強制 push と削除の禁止・直線の履歴)。
        管理者の権限がある GitHub のトークン(GITHUB_TOKEN / GH_TOKEN、または `gh auth token`)が要る。
        トークンが無い時は、GitHub の画面での設定手順を表示して 3 で終わる。
    python3 scripts/ops/ci_gate.py status
        いまの main の保護の設定を表示する(トークンが要る)

パッチの流れ(docs/ops/RUNBOOK.md §9):
    検証 → commit → `gate/<名前>` へ push → この道具で CI の合格を待つ → 同じ commit を main へ push → gate ブランチを消す
GitHub は「別のブランチで必須の CI に合格した commit」なら、保護された main への直接の push を受け付ける
(PR は不要)。CI に合格していない commit は、管理者でも main へ push できない。

トークンの値は表示・保存しない。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO = Path(__file__).resolve().parents[2]
API = "https://api.github.com"
# .github/workflows/ci.yml のジョブ(GitHub の check run の名前)。backend の試験が ci.yml と一致することを確かめる
REQUIRED_CHECKS = ("secret-scan", "dependency-audit", "frontend", "backend", "e2e")
EXIT_OK, EXIT_FAILED, EXIT_UNREACHABLE, EXIT_NO_TOKEN = 0, 1, 2, 3

UI_STEPS = """GitHub の画面で main を保護する手順(管理者の操作。1回だけ):
  1. https://github.com/{repo}/settings/branches を開く → 「Add branch protection rule」(または Add classic branch protection rule)
  2. Branch name pattern: main
  3. 「Require status checks to pass before merging」をオンにし、
     「Require branches to be up to date before merging」もオン。検索欄で次の5つを追加:
     secret-scan / dependency-audit / frontend / backend / e2e
  4. 「Require linear history」をオン
  5. 「Do not allow bypassing the above settings」(管理者にも適用)をオン
  6. 「Allow force pushes」「Allow deletions」はオフのまま → Create
  ※「Require a pull request before merging」はオフのままにする(パッチは CI に合格した commit を直接 main へ送る)。
  トークンを使う場合: GITHUB_TOKEN=<管理者のトークン> python3 scripts/ops/ci_gate.py protect"""


def log(msg: str) -> None:
    print("[ci_gate] %s" % msg, flush=True)


def repo_slug() -> str:
    env = os.environ.get("TC_GITHUB_REPO")
    if env:
        return env
    try:
        url = subprocess.run(["git", "-C", str(REPO), "remote", "get-url", "origin"], capture_output=True, text=True,
                             check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "karkyon/travelcanvas"
    m = re.search(r"github\.com[:/]+([^/]+/[^/]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else "karkyon/travelcanvas"


def token() -> Optional[str]:
    for name in ("TC_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"):
        if os.environ.get(name):
            return os.environ[name].strip()
    if shutil.which("gh"):
        proc = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True)
        if proc.returncode == 0 and proc.stdout.strip():
            return proc.stdout.strip()
    return None


def request(method: str, path: str, *, body: Optional[dict] = None, tok: Optional[str] = None,
            timeout: float = 20.0) -> Tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "travelcanvas-ci-gate")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8", "replace")
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw[:300]


# ---------------------------------------------------------------------------
# wait
# ---------------------------------------------------------------------------


def summarize(check_runs: List[dict]) -> Dict[str, Tuple[str, Optional[str]]]:
    """必須のジョブごとに (status, conclusion)。同じ名前が複数あれば新しい方。"""
    latest: Dict[str, dict] = {}
    for run in check_runs:
        name = run.get("name")
        if name in REQUIRED_CHECKS:
            prev = latest.get(name)
            if prev is None or str(run.get("started_at") or "") >= str(prev.get("started_at") or ""):
                latest[name] = run
    return {n: (str(r.get("status")), r.get("conclusion")) for n, r in latest.items()}


def verdict(states: Dict[str, Tuple[str, Optional[str]]]) -> Tuple[str, List[str]]:
    """("success"|"failure"|"pending", 説明)。skipped・cancelled も不合格(前のジョブが落ちた等)。"""
    failed = [n for n, (st, c) in states.items() if st == "completed" and c not in ("success", "neutral")]
    if failed:
        return "failure", ["%s: %s" % (n, states[n][1]) for n in failed]
    missing = [n for n in REQUIRED_CHECKS if n not in states]
    running = [n for n, (st, _c) in states.items() if st != "completed"]
    if missing or running:
        return "pending", ["待ち: " + ", ".join(sorted(missing + running))]
    return "success", []


def cmd_wait(sha: str, timeout: int, interval: int) -> int:
    if not re.match(r"^[0-9a-f]{40}$", sha):
        log("--sha は40桁の commit にしてください")
        return EXIT_UNREACHABLE
    repo, tok = repo_slug(), token()
    deadline = time.time() + timeout
    last = None
    errors = 0
    while time.time() < deadline:
        status, body = request("GET", "/repos/%s/commits/%s/check-runs?per_page=100" % (repo, sha), tok=tok)
        if status != 200 or not isinstance(body, dict):
            errors += 1
            log("GitHub に問い合わせられません(HTTP %s、%d 回目)" % (status, errors))
            if errors >= 10:
                return EXIT_UNREACHABLE
            time.sleep(min(interval * 2, 120))
            continue
        errors = 0
        result, notes = verdict(summarize(body.get("check_runs") or []))
        line = "%s %s" % (result, " / ".join(notes))
        if line != last:
            log("CI(%s): %s" % (sha[:7], line))
            last = line
        if result == "success":
            log("CI に合格しました(%s)" % ", ".join(REQUIRED_CHECKS))
            return EXIT_OK
        if result == "failure":
            log("CI が不合格です。https://github.com/%s/commit/%s の Checks を確認してください" % (repo, sha))
            return EXIT_FAILED
        time.sleep(interval)
    log("時間切れ(%d 秒)。CI が終わっていません" % timeout)
    return EXIT_UNREACHABLE


# ---------------------------------------------------------------------------
# protect / status
# ---------------------------------------------------------------------------


def protection_body() -> dict:
    return {
        "required_status_checks": {"strict": True, "checks": [{"context": n} for n in REQUIRED_CHECKS]},
        "enforce_admins": True,
        "required_pull_request_reviews": None,
        "restrictions": None,
        "required_linear_history": True,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "block_creations": False,
        "required_conversation_resolution": False,
        "lock_branch": False,
        "allow_fork_syncing": False,
    }


def protection_problems(current: dict) -> List[str]:
    """いまの設定が求める設定を満たしていない点。"""
    problems = []
    rsc = current.get("required_status_checks") or {}
    have = {c.get("context") for c in rsc.get("checks") or []} | set(rsc.get("contexts") or [])
    missing = [n for n in REQUIRED_CHECKS if n not in have]
    if missing:
        problems.append("必須の CI が足りない: " + ", ".join(missing))
    if not rsc.get("strict"):
        problems.append("最新の main に追いついていない commit を許している")
    if not (current.get("enforce_admins") or {}).get("enabled"):
        problems.append("管理者が保護を迂回できる")
    if (current.get("allow_force_pushes") or {}).get("enabled"):
        problems.append("強制 push を許している")
    if (current.get("allow_deletions") or {}).get("enabled"):
        problems.append("main の削除を許している")
    if not (current.get("required_linear_history") or {}).get("enabled"):
        problems.append("直線の履歴を求めていない")
    return problems


def cmd_protect(dry_run: bool) -> int:
    repo, tok = repo_slug(), token()
    if dry_run:
        print(json.dumps(protection_body(), ensure_ascii=False, indent=1))
        return EXIT_OK
    if not tok:
        log("GitHub のトークンがありません。")
        print(UI_STEPS.format(repo=repo))
        return EXIT_NO_TOKEN
    status, body = request("PUT", "/repos/%s/branches/main/protection" % repo, body=protection_body(), tok=tok)
    if status not in (200, 201):
        message = body.get("message") if isinstance(body, dict) else body
        log("保護を設定できませんでした(HTTP %s: %s)。トークンに管理者(Administration: write)の権限が要ります。"
            % (status, message))
        print(UI_STEPS.format(repo=repo))
        return EXIT_NO_TOKEN if status in (401, 403, 404) else EXIT_FAILED
    problems = protection_problems(body if isinstance(body, dict) else {})
    if problems:
        log("設定しましたが、次の点が反映されていません: " + " / ".join(problems))
        return EXIT_FAILED
    log("main を保護しました(必須の CI: %s、管理者にも適用、強制 push・削除の禁止、直線の履歴)" % ", ".join(REQUIRED_CHECKS))
    return EXIT_OK


def cmd_status() -> int:
    repo, tok = repo_slug(), token()
    if not tok:
        log("GitHub のトークンがありません(保護の設定は公開されていないため、見るにはトークンが要ります)")
        return EXIT_NO_TOKEN
    status, body = request("GET", "/repos/%s/branches/main/protection" % repo, tok=tok)
    if status == 404:
        log("main は保護されていません")
        return EXIT_FAILED
    if status != 200 or not isinstance(body, dict):
        log("取得できませんでした(HTTP %s)" % status)
        return EXIT_UNREACHABLE
    problems = protection_problems(body)
    log("main の保護: " + ("求める設定を満たしています" if not problems else " / ".join(problems)))
    return EXIT_OK if not problems else EXIT_FAILED


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="CI の合格の待ち合わせと main の保護(Runbook §9)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("wait")
    p.add_argument("--sha", required=True)
    p.add_argument("--timeout", type=int, default=3600)
    p.add_argument("--interval", type=int, default=45)
    p = sub.add_parser("protect")
    p.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    args = parser.parse_args(argv)
    if args.cmd == "wait":
        return cmd_wait(args.sha, args.timeout, max(10, args.interval))
    if args.cmd == "protect":
        return cmd_protect(args.dry_run)
    return cmd_status()


if __name__ == "__main__":
    sys.exit(main())
