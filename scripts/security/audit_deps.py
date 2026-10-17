#!/usr/bin/env python3
"""
[Gate S1] SEC-23 依存ライブラリの既知の脆弱性の検査(CI blocking)。

AI を使った攻撃は、公開された脆弱性(CVE)が出てから短時間で無差別に試される。依存の脆弱性を
「気づいた時に直す」のではなく、変更のたびに機械で止める。

    python3 scripts/security/audit_deps.py python [--json pip-audit.json]   # backend(pip-audit)
    python3 scripts/security/audit_deps.py node   [--json npm-audit.json]   # frontend(npm audit)
    python3 scripts/security/audit_deps.py self-test

--json を省くと、その場で pip-audit / npm audit を実行する(pip-audit は requirements-dev.txt に入っている)。

方針:
- 見つかった脆弱性は、例外一覧(dependency-allowlist.json)に載っていなければ失敗。
- 例外は「助言の ID」単位で、理由(なぜ到達しないか)・範囲(build-only / test-only / not-reachable)・
  期限(expires)が必須。期限を過ぎた例外も失敗にする(放置させない)。
- frontend で、ブラウザへ届く依存(RUNTIME_ROOTS とその依存)に例外は認めない(範囲 not-reachable で
  理由のあるものを除く)。
- 使われなくなった例外は警告として出す(一覧から消してよい)。
標準ライブラリだけで書く(ホスト・CI・コンテナのどこでも動くように)。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ALLOWLIST_PATH = Path(__file__).resolve().parent / "dependency-allowlist.json"
VALID_SCOPES = ("build-only", "test-only", "not-reachable")

# ブラウザへ届く(本番の画面で動く)依存の根。これらとその依存の脆弱性は、原則として例外にしない。
RUNTIME_ROOTS = (
    "react", "react-dom", "react-router-dom", "axios", "zustand", "leaflet", "react-leaflet",
    "@tanstack/react-query", "lucide-react", "react-hot-toast", "qrcode", "clsx", "classnames",
)


class AuditError(Exception):
    pass


# ---------------------------------------------------------------- allowlist

def load_allowlist(path: Path = ALLOWLIST_PATH) -> List[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("entries", [])
    problems = []
    for i, e in enumerate(entries):
        for key in ("ecosystem", "package", "ids", "scope", "reason", "expires"):
            if not e.get(key):
                problems.append(f"例外 #{i} に {key} がありません")
        if e.get("scope") not in VALID_SCOPES:
            problems.append(f"例外 #{i} の scope は {VALID_SCOPES} のいずれか: {e.get('scope')}")
        try:
            dt.date.fromisoformat(str(e.get("expires")))
        except ValueError:
            problems.append(f"例外 #{i} の expires が日付(YYYY-MM-DD)ではありません")
    if problems:
        raise AuditError("例外一覧の形式が不正です:\n  - " + "\n  - ".join(problems))
    return entries


def match_allowlist(entries: List[dict], ecosystem: str, package: str, ids: Iterable[str],
                    today: dt.date) -> Tuple[Optional[dict], Optional[str]]:
    """(該当した例外, 問題) を返す。問題は期限切れ。"""
    id_set = {i.upper() for i in ids}
    for e in entries:
        if e["ecosystem"] != ecosystem or e["package"] != package:
            continue
        if id_set & {i.upper() for i in e["ids"]}:
            if dt.date.fromisoformat(e["expires"]) < today:
                return e, f"例外の期限({e['expires']})が過ぎています"
            return e, None
    return None, None


# ---------------------------------------------------------------- python

def run_pip_audit() -> dict:
    backend = REPO_ROOT / "backend"
    # 版を全て固定しているので依存の解決(仮想環境への導入)はせず、書かれた版をそのまま照合する。
    # --no-deps では requirements-dev.txt の中の -r をたどらないため、2つのファイルを明示する。
    cmd = [sys.executable, "-m", "pip_audit", "-r", str(backend / "requirements.txt"),
           "-r", str(backend / "requirements-dev.txt"), "--no-deps", "--disable-pip",
           "--cache-dir", "/tmp/pip-audit-cache", "-f", "json", "--progress-spinner", "off"]
    proc = subprocess.run(cmd, cwd=REPO_ROOT / "backend", capture_output=True, text=True)
    if not proc.stdout.strip():
        raise AuditError("pip-audit を実行できませんでした:\n" + proc.stderr[-2000:])
    return json.loads(proc.stdout)


def python_findings(report: dict) -> List[dict]:
    out = []
    for dep in report.get("dependencies", []):
        for v in dep.get("vulns") or []:
            ids = [v["id"], *v.get("aliases", [])]
            out.append({"package": dep["name"].lower(), "version": dep.get("version"), "ids": ids,
                        "fix": v.get("fix_versions") or [], "severity": "unknown"})
    return out


# ---------------------------------------------------------------- node

def run_npm_audit() -> dict:
    proc = subprocess.run(["npm", "audit", "--json"], cwd=REPO_ROOT / "frontend", capture_output=True, text=True)
    if not proc.stdout.strip():
        raise AuditError("npm audit を実行できませんでした:\n" + proc.stderr[-2000:])
    return json.loads(proc.stdout)


def run_npm_ls() -> dict:
    proc = subprocess.run(["npm", "ls", "--all", "--omit=dev", "--json"], cwd=REPO_ROOT / "frontend",
                          capture_output=True, text=True)
    return json.loads(proc.stdout or "{}")


def runtime_packages(tree: dict, roots: Iterable[str] = RUNTIME_ROOTS) -> Set[str]:
    """npm ls の木から、ブラウザへ届く依存の根とその依存の名前を集める。"""
    found: Set[str] = set()

    def walk(name: str, node: dict) -> None:
        if name in found:
            return
        found.add(name)
        for child_name, child in (node.get("dependencies") or {}).items():
            walk(child_name, child)

    top = tree.get("dependencies") or {}
    for root in roots:
        if root in top:
            walk(root, top[root])
    return found


def node_findings(report: dict) -> List[dict]:
    out = []
    for name, vuln in (report.get("vulnerabilities") or {}).items():
        for via in vuln.get("via", []):
            if not isinstance(via, dict):
                continue  # 依存元の脆弱性(根の助言は別の項目に出る)
            url = str(via.get("url", ""))
            ghsa = url.rsplit("/", 1)[-1] if "/advisories/" in url else str(via.get("source"))
            out.append({"package": name, "version": via.get("range"), "ids": [ghsa], "severity": via.get("severity"),
                        "title": via.get("title", ""), "fix": vuln.get("fixAvailable")})
    return out


# ---------------------------------------------------------------- evaluate

def evaluate(ecosystem: str, findings: List[dict], entries: List[dict], today: dt.date,
             runtime: Optional[Set[str]] = None) -> Tuple[List[str], List[str], List[str]]:
    """(失敗, 例外で許したもの, 使われなかった例外) を返す。"""
    failures, allowed = [], []
    used = set()
    for f in findings:
        entry, problem = match_allowlist(entries, ecosystem, f["package"], f["ids"], today)
        label = "%s %s %s [%s] %s" % (f["package"], f.get("version") or "", f["ids"][0], f.get("severity"),
                                      f.get("title", ""))
        label = label.strip()
        if entry is None:
            failures.append(f"{label} — 例外一覧にありません(直すか、理由・期限を付けて例外にする)")
            continue
        used.add(id(entry))
        if problem:
            failures.append(f"{label} — {problem}")
            continue
        if runtime is not None and f["package"] in runtime and entry["scope"] != "not-reachable":
            failures.append(f"{label} — ブラウザへ届く依存です。scope={entry['scope']} の例外は認めません")
            continue
        allowed.append(f"{label} — 例外({entry['scope']}、{entry['expires']}まで)")
    unused = [f"{e['package']} {e['ids']}" for e in entries if e["ecosystem"] == ecosystem and id(e) not in used]
    return failures, allowed, unused


def report(ecosystem: str, failures: List[str], allowed: List[str], unused: List[str]) -> int:
    print(f"[audit-deps] {ecosystem}: 失敗 {len(failures)} 件 / 例外で許可 {len(allowed)} 件")
    for line in failures:
        print(f"  ✗ {line}")
    for line in allowed:
        print(f"  - {line}")
    for line in unused:
        print(f"  (使われていない例外。一覧から消せます: {line})")
    return 1 if failures else 0


def self_test() -> int:
    today = dt.date(2026, 10, 18)
    entries = [
        {"ecosystem": "node", "package": "vite", "ids": ["GHSA-AAAA"], "scope": "build-only", "reason": "r",
         "expires": "2026-12-31"},
        {"ecosystem": "node", "package": "old", "ids": ["GHSA-OLD"], "scope": "build-only", "reason": "r",
         "expires": "2026-01-01"},
        {"ecosystem": "node", "package": "axios", "ids": ["GHSA-AX"], "scope": "build-only", "reason": "r",
         "expires": "2026-12-31"},
    ]
    findings = [
        {"package": "vite", "ids": ["GHSA-AAAA"], "severity": "high"},
        {"package": "vite", "ids": ["GHSA-NEW"], "severity": "low"},
        {"package": "old", "ids": ["GHSA-OLD"], "severity": "high"},
        {"package": "axios", "ids": ["GHSA-AX"], "severity": "high"},
    ]
    failures, allowed, _ = evaluate("node", findings, entries, today, runtime={"axios"})
    assert len(allowed) == 1 and "vite" in allowed[0], allowed
    assert any("GHSA-NEW" in f for f in failures)  # 新しい助言は失敗
    assert any("期限" in f for f in failures)  # 期限切れは失敗
    assert any("ブラウザへ届く" in f for f in failures)  # 実行時の依存は build-only の例外を認めない
    tree = {"dependencies": {"axios": {"dependencies": {"form-data": {}}}, "vite": {}}}
    assert runtime_packages(tree, ("axios",)) == {"axios", "form-data"}
    load_allowlist()  # 実際の一覧の形式も確かめる
    print("[audit-deps] self-test: ok")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("ecosystem", choices=("python", "node", "self-test"))
    parser.add_argument("--json", help="pip-audit / npm audit の JSON 出力(省略時はその場で実行)")
    parser.add_argument("--npm-ls-json", help="npm ls --all --omit=dev --json の出力(node のみ。省略時は実行)")
    args = parser.parse_args(argv)
    if args.ecosystem == "self-test":
        return self_test()
    today = dt.date.today()
    try:
        entries = load_allowlist()
        if args.ecosystem == "python":
            data = json.loads(Path(args.json).read_text()) if args.json else run_pip_audit()
            failures, allowed, unused = evaluate("python", python_findings(data), entries, today)
        else:
            data = json.loads(Path(args.json).read_text()) if args.json else run_npm_audit()
            tree = json.loads(Path(args.npm_ls_json).read_text()) if args.npm_ls_json else run_npm_ls()
            failures, allowed, unused = evaluate("node", node_findings(data), entries, today,
                                                 runtime=runtime_packages(tree))
    except AuditError as e:
        print(f"[audit-deps] {e}")
        return 2
    return report(args.ecosystem, failures, allowed, unused)


if __name__ == "__main__":
    sys.exit(main())
