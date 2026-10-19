#!/usr/bin/env python3
"""[Gate S11] SEC-24 main の保護と CI の合格を必須にする運用の道具(標準ライブラリだけ。omega-dev2 の python3 で動く)。

    python3 scripts/ops/ci_gate.py wait --sha <commit> [--timeout 3600] [--reruns 1]
        その commit の CI(必須の5つのジョブ)が全部合格するまで待つ。0=合格、1=不合格、2=時間切れ・GitHub に届かない
        不合格の時は、落ちたジョブの注記(Playwright の失敗)とログの要点を表示し、ログの全体を一時ファイルに残す。
        [Gate L5-r2] 落ちたのが e2e だけなら、その内容を表示したうえで1回だけ再実行する(不安定の疑い)。
        再実行で合格したら「不安定」と表示して合格にする(内容は表示済みなので、次の Gate で原因を直す)
    python3 scripts/ops/ci_gate.py failures --sha <commit>
        その commit で落ちたジョブの注記とログの要点を表示する
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
import tempfile
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
# 不安定の疑いで再実行してよいジョブ
# (ブラウザの E2E だけ。検査・単体の試験の不合格は再実行しない)
RERUNNABLE = ("e2e",)

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
    latest = latest_runs(check_runs)
    return {n: (str(r.get("status")), r.get("conclusion")) for n, r in latest.items()}


def _order(run: dict) -> Tuple[int, str]:
    # 再実行の check run は id が大きい(始まる前は started_at が無いので id を先に見る)
    try:
        rid = int(run.get("id") or 0)
    except (TypeError, ValueError):
        rid = 0
    return rid, str(run.get("started_at") or "")


def latest_runs(check_runs: List[dict]) -> Dict[str, dict]:
    latest: Dict[str, dict] = {}
    for run in check_runs:
        name = run.get("name")
        if name in REQUIRED_CHECKS:
            prev = latest.get(name)
            if prev is None or _order(run) >= _order(prev):
                latest[name] = run
    return latest


def rerunnable(states: Dict[str, Tuple[str, Optional[str]]]) -> bool:
    """落ちたのが再実行してよいジョブだけで、ほかは合格しているか。"""
    failed = [n for n, (st, c) in states.items() if st == "completed" and c not in ("success", "neutral")]
    if not failed or any(n not in RERUNNABLE for n in failed):
        return False
    return all(states.get(n, ("", None))[1] in ("success", "neutral") for n in REQUIRED_CHECKS if n not in failed)


# ---------------------------------------------------------------------------
# 落ちた内容(注記・ログの要点)
# ---------------------------------------------------------------------------

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z ")
_FAIL_HEAD = re.compile(r"^\s+\d+\) \[")          # Playwright の「  1) [chromium] › e2e/...」
_SUMMARY = re.compile(r"^\s+\d+ (failed|flaky|passed|skipped)|^\s+\[chromium\] › ")


def clean_line(line: str) -> str:
    return _STAMP.sub("", _ANSI.sub("", line.rstrip("\r\n")))


def log_excerpt(text: str, limit: int = 160) -> List[str]:
    """ジョブのログから、落ちた試験の内容と末尾の集計を抜き出す(Playwright の list の出力)。"""
    lines = [clean_line(x) for x in text.splitlines()]
    out: List[str] = []
    for i, line in enumerate(lines):
        if _FAIL_HEAD.match(line):
            block = [line]
            for nxt in lines[i + 1:i + 60]:
                if _FAIL_HEAD.match(nxt) or _SUMMARY.match(nxt) and not nxt.strip().startswith("["):
                    break
                block.append(nxt)
            out.extend(b for b in block if b.strip())
            out.append("")
        elif re.match(r"^\s+\d+ (failed|flaky|passed)", line) or "✘" in line:
            out.append(line)
        if len(out) >= limit:
            break
    if not out:
        tail = [x for x in lines if x.strip()][-40:]
        out = ["(Playwright の失敗の行が見つかりません。ログの末尾:)"] + tail
    return out[:limit]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


def job_log(repo: str, job_id: int, tok: Optional[str]) -> Optional[str]:
    """ジョブのログ(GitHub は保存先の一時 URL へ転送する。転送先へはトークンを送らない)。"""
    if not tok:
        return None
    req = urllib.request.Request("%s/repos/%s/actions/jobs/%d/logs" % (API, repo, job_id))
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "travelcanvas-ci-gate")
    req.add_header("Authorization", "Bearer " + tok)
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=30) as res:
            return res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        location = e.headers.get("Location") if e.code in (301, 302, 303, 307, 308) else None
        if not location:
            return None
    except (urllib.error.URLError, OSError):
        return None
    try:
        plain = urllib.request.Request(location, headers={"User-Agent": "travelcanvas-ci-gate"})
        with urllib.request.urlopen(plain, timeout=60) as res:
            return res.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError):
        return None


def show_failures(repo: str, sha: str, tok: Optional[str], check_runs: List[dict]) -> None:
    latest = latest_runs(check_runs)
    for name, run in sorted(latest.items()):
        if run.get("status") != "completed" or run.get("conclusion") in ("success", "neutral"):
            continue
        rid = run.get("id")
        log("---- 落ちたジョブ: %s(%s)" % (name, run.get("conclusion")))
        if rid:
            status, notes = request("GET", "/repos/%s/check-runs/%s/annotations?per_page=50" % (repo, rid), tok=tok)
            shown = 0
            if status == 200 and isinstance(notes, list):
                for a in notes:
                    if a.get("annotation_level") != "failure" or "exit code" in str(a.get("message") or ""):
                        continue
                    shown += 1
                    msg = clean_line(str(a.get("message") or "")).replace("\n", "\n      ")
                    log("  注記 %s:%s %s" % (a.get("path"), a.get("start_line"), (a.get("title") or "").strip()))
                    print("      " + msg[:1500], flush=True)
            if not shown:
                log("  (注記に失敗の内容がありません)")
            text = job_log(repo, int(rid), tok)
            if text:
                path = Path(tempfile.gettempdir()) / ("travelcanvas-ci-%s-%s.log" % (sha[:7], name))
                path.write_text(text, encoding="utf-8")
                log("  ログの要点(全体は %s):" % path)
                for line in log_excerpt(text):
                    print("      " + line, flush=True)
            else:
                log("  ログを取得できませんでした(トークンが無いか、GitHub に届かない)")
    log("---- 詳細: https://github.com/%s/commit/%s の Checks" % (repo, sha))


def rerun_failed(repo: str, tok: Optional[str], check_runs: List[dict]) -> bool:
    """落ちた e2e のジョブを含む workflow run の、落ちたジョブだけを再実行する。"""
    if not tok:
        log("トークンが無いため再実行できません")
        return False
    run = latest_runs(check_runs).get("e2e")
    if not run or not run.get("id"):
        return False
    status, job = request("GET", "/repos/%s/actions/jobs/%s" % (repo, run["id"]), tok=tok)
    run_id = job.get("run_id") if status == 200 and isinstance(job, dict) else None
    if not run_id:
        log("再実行する workflow run が見つかりません(HTTP %s)" % status)
        return False
    status, _body = request("POST", "/repos/%s/actions/runs/%s/rerun-failed-jobs" % (repo, run_id), body={}, tok=tok)
    if status not in (200, 201, 204):
        log("再実行を始められませんでした(HTTP %s)" % status)
        return False
    return True


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


def cmd_wait(sha: str, timeout: int, interval: int, reruns: int = 1) -> int:
    if not re.match(r"^[0-9a-f]{40}$", sha):
        log("--sha は40桁の commit にしてください")
        return EXIT_UNREACHABLE
    repo, tok = repo_slug(), token()
    deadline = time.time() + timeout
    last = None
    errors = 0
    rerun_done = 0
    rerun_wait_id: Optional[int] = None
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
        runs = body.get("check_runs") or []
        if rerun_wait_id is not None:
            e2e = latest_runs(runs).get("e2e") or {}
            if int(e2e.get("id") or 0) <= rerun_wait_id:
                time.sleep(interval)  # 再実行の check run がまだ登録されていない
                continue
            rerun_wait_id = None
        states = summarize(runs)
        result, notes = verdict(states)
        line = "%s %s" % (result, " / ".join(notes))
        if line != last:
            log("CI(%s): %s" % (sha[:7], line))
            last = line
        if result == "success":
            if rerun_done:
                log("CI に合格しました(e2e は再実行で合格。「不安定」です。上に表示した1回目の失敗を次の Gate で直します)")
            else:
                log("CI に合格しました(%s)" % ", ".join(REQUIRED_CHECKS))
            return EXIT_OK
        if result == "failure":
            log("CI が不合格です。落ちた内容:")
            show_failures(repo, sha, tok, runs)
            if rerun_done < reruns and rerunnable(states):
                old = int((latest_runs(runs).get("e2e") or {}).get("id") or 0)
                if rerun_failed(repo, tok, runs):
                    rerun_done += 1
                    rerun_wait_id = old
                    last = None
                    log("落ちたのは e2e だけのため、1回だけ再実行します(不安定の疑い)")
                    time.sleep(interval)
                    continue
            return EXIT_FAILED
        time.sleep(interval)
    log("時間切れ(%d 秒)。CI が終わっていません" % timeout)
    return EXIT_UNREACHABLE


def cmd_failures(sha: str) -> int:
    if not re.match(r"^[0-9a-f]{7,40}$", sha):
        log("--sha は commit にしてください")
        return EXIT_UNREACHABLE
    repo, tok = repo_slug(), token()
    status, body = request("GET", "/repos/%s/commits/%s/check-runs?per_page=100" % (repo, sha), tok=tok)
    if status != 200 or not isinstance(body, dict):
        log("GitHub に問い合わせられません(HTTP %s)" % status)
        return EXIT_UNREACHABLE
    runs = body.get("check_runs") or []
    result, notes = verdict(summarize(runs))
    log("CI(%s): %s %s" % (sha[:7], result, " / ".join(notes)))
    if result == "failure":
        show_failures(repo, sha, tok, runs)
        return EXIT_FAILED
    return EXIT_OK if result == "success" else EXIT_UNREACHABLE


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
    p.add_argument("--reruns", type=int, default=1)
    p = sub.add_parser("failures")
    p.add_argument("--sha", required=True)
    p = sub.add_parser("protect")
    p.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    args = parser.parse_args(argv)
    if args.cmd == "wait":
        return cmd_wait(args.sha, args.timeout, max(10, args.interval), max(0, min(1, args.reruns)))
    if args.cmd == "failures":
        return cmd_failures(args.sha)
    if args.cmd == "protect":
        return cmd_protect(args.dry_run)
    return cmd_status()


if __name__ == "__main__":
    sys.exit(main())
