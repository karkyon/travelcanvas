"""[監査 A01/A04/A05/A10] scripts/ops/consultai_apply.sh の失敗の経路(実の GitHub・サーバーへは触らない)。

一時の git(bare の origin・古い作業ツリー・bundle)と、gh・docker・curl・tcops の代わりのコマンドで動かす。
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ops" / "consultai_apply.sh"
TRACE = "docs/trace/gate-consultai-trace.md"
BR = "gate/provider-connect"

pytestmark = pytest.mark.skipif(shutil.which("git") is None or shutil.which("bash") is None, reason="git・bash が無い")


def git(cwd, *args, check=True):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                       env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@e",
                            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@e"})
    if check and r.returncode != 0:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


def commit(cwd, files, msg):
    for name, body in files.items():
        p = Path(cwd) / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
        git(cwd, "add", name)
    git(cwd, "commit", "-q", "-m", msg)
    return git(cwd, "rev-parse", "HEAD")


STUBS = {
    # gh: 状態はファイルで持つ(PR の有無・head・CI の結果)
    "gh": r'''#!/usr/bin/env bash
S="$STUB_STATE"; echo "gh $*" >> "$S/calls"
case "$1 $2" in
  "pr list") [ -f "$S/pr" ] && [ ! -f "$S/pr_closed" ] && cat "$S/pr" ;;
  "pr create") [ -f "$S/fail_pr_create" ] && exit 1
     shift 2; while [ $# -gt 0 ]; do [ "$1" = "--body-file" ] && cp "$2" "$S/body"; shift; done
     echo 7 > "$S/pr"; echo "https://example/pull/7" ;;
  "pr view") if [ "$3" = "43" ]; then echo OPEN
     elif echo "$*" | grep -q mergeCommit; then cat "$S/merge_oid" 2>/dev/null
     elif echo "$*" | grep -q -- "--json state"; then cat "$S/pr_state" 2>/dev/null || echo OPEN
     else cat "$S/pr_head" 2>/dev/null || echo "$EXPECT_FOR_STUB"; fi ;;
  "pr merge") echo "$*" >> "$S/merges"; [ -f "$S/fail_merge" ] && exit 1
     echo MERGED > "$S/pr_state"; echo 1111111111111111111111111111111111111111 > "$S/merge_oid" ;;
  "pr close") echo "$3" >> "$S/closed" ;;
  "run list") if echo "$*" | grep -q databaseId && echo "$*" | grep -q -- "--branch main"; then echo 98
              elif echo "$*" | grep -q -- "--branch main"; then cat "$S/main_ci" 2>/dev/null || echo success
              elif echo "$*" | grep -q conclusion; then cat "$S/branch_ci" 2>/dev/null || echo success
              else echo 99; fi ;;
  "run watch") [ -f "$S/ci_fail" ] && exit 1; exit 0 ;;
esac
''',
    "docker": r'''#!/usr/bin/env bash
S="$STUB_STATE"; echo "docker $*" >> "$S/calls"
case "$*" in
  *"ps -aq migrate"*) echo mig1 ;;
  "inspect"*) cat "$S/migrate_exit" 2>/dev/null || echo 0 ;;
  *"alembic current"*) cat "$S/db_current" 2>/dev/null || echo "c3e5a7b9d1f4 (head)" ;;
  *"alembic heads"*) echo "c3e5a7b9d1f4 (head)" ;;
esac
exit 0
''',
    "curl": r'''#!/usr/bin/env bash
S="$STUB_STATE"; url="${@: -1}"
if echo "$*" | grep -q -- "-X OPTIONS"; then
  o="$(cat "$S/acao" 2>/dev/null || echo http://192.168.1.11:4173)"
  printf 'HTTP/1.1 200 OK\r\naccess-control-allow-origin: %s\r\n\r\n' "$o"; exit 0
fi
case "$url" in
  *"/ready") cat "$S/ready" 2>/dev/null || echo -n 200 ;;
  *"/trip-consult") cat "$S/front" 2>/dev/null || echo -n 200 ;;
  *) echo -n 200 ;;
esac
''',
}

TCOPS = r'''import sys, os
open(os.environ["STUB_STATE"] + "/calls", "a").write("tcops " + " ".join(sys.argv[1:]) + "\n")
if sys.argv[1] == "backup":
    print("[tcops] バックアップが完了しました: tc-20261101T000000Z(DB 1 バイト)")
'''


@pytest.fixture()
def env(tmp_path):
    origin = tmp_path / "origin.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    src = tmp_path / "src"
    git(tmp_path, "clone", "-q", str(origin), str(src))
    base = commit(src, {"README.md": "x\n", "scripts/ops/tcops.py": TCOPS, ".gitignore": ".env\n*.bundle\n"}, "base")
    git(src, "push", "-q", "origin", "HEAD:main")
    git(src, "checkout", "-q", "-b", BR)
    commit(src, {"a.txt": "1\n"}, "pc")
    git(src, "push", "-q", "origin", BR)
    old = git(src, "rev-parse", "HEAD")
    new = commit(src, {TRACE: "# Gate ConsultAI の本文\n", "b.txt": "2\n"}, "consultai")
    # 利用者の古い作業ツリー(main の基点。新しい trace は無い)
    work = tmp_path / "work"
    git(tmp_path, "clone", "-q", str(origin), str(work))
    (work / ".env").write_text("SECRET_BACKEND=db_encrypted\nTC_PUBLIC_HOSTS=192.168.1.11\n")
    home = tmp_path / "home"
    (home / "Downloads").mkdir(parents=True)
    bundle = home / "Downloads" / f"consultai_{new[:7]}.bundle"
    git(src, "bundle", "create", str(bundle), f"{old}..{BR}")
    stub = tmp_path / "bin"
    stub.mkdir()
    for name, body in STUBS.items():
        (stub / name).write_text(body)
        (stub / name).chmod(0o755)
    state = tmp_path / "state"
    state.mkdir()
    (state / "pr_head").write_text(new)
    e = {**os.environ, "HOME": str(home), "TC_REPO": str(work), "TC_EXPECT_HEAD": new, "STUB_STATE": str(state),
         "EXPECT_FOR_STUB": new, "TC_READY_WAIT": "1", "PATH": f"{stub}:{os.environ['PATH']}",
         "TC_ARTIFACTS": str(tmp_path / "art"),
         "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@e", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@e"}
    return {"tmp": tmp_path, "origin": origin, "src": src, "work": work, "home": home, "bundle": bundle,
            "state": state, "env": e, "new": new, "old": old, "base": base}


def run(e, mode, script=SCRIPT, cwd=None):
    return subprocess.run(["bash", str(script), mode], env=e["env"], capture_output=True, text=True,
                          cwd=cwd or e["tmp"], timeout=120)


def calls(e):
    p = e["state"] / "calls"
    return p.read_text() if p.exists() else ""


def test_push_from_old_tree_reads_pr_body_from_new_sha_and_resumes(env):
    r = run(env, "push")
    assert r.returncode == 0, r.stdout + r.stderr
    assert git(env["origin"], "rev-parse", BR) == env["new"]
    assert (env["state"] / "body").read_text() == "# Gate ConsultAI の本文\n"  # 古い作業ツリーに trace は無い
    assert "1/3 push: 完了" in r.stdout and "2/3 PR: #7" in r.stdout and "3/3 CI: 成功" in r.stdout
    assert (env["state"] / "closed").read_text().strip() == "43"
    # もう一度: push と PR の作成は飛ばす(重複の PR を作らない)
    r2 = run(env, "push")
    assert r2.returncode == 0 and "1/3 push: 済み" in r2.stdout
    assert calls(env).count("pr create") == 1


def test_pr_create_failure_then_rerun_resumes(env):
    (env["state"] / "fail_pr_create").write_text("1")
    r = run(env, "push")
    assert r.returncode != 0 and "2/3 PR: 作成に失敗" in r.stderr
    assert git(env["origin"], "rev-parse", BR) == env["new"]
    assert not (env["state"] / "closed").exists()  # 新しい PR が無いまま古い PR を閉じない
    (env["state"] / "fail_pr_create").unlink()
    r2 = run(env, "push")
    assert r2.returncode == 0 and "1/3 push: 済み" in r2.stdout and "2/3 PR: #7" in r2.stdout


def test_wrong_sha_and_non_fast_forward_stop(env):
    bad = {**env, "env": {**env["env"], "TC_EXPECT_HEAD": env["old"][:-1] + ("0" if env["old"][-1] != "0" else "1")}}
    r = run(bad, "push")
    assert r.returncode != 0 and "bundle がありません" in r.stderr
    # origin が先に進んでいる(別の commit)→ push しない
    other = env["tmp"] / "other"
    git(env["tmp"], "clone", "-q", "-b", BR, str(env["origin"]), str(other))
    commit(other, {"c.txt": "x\n"}, "other")
    git(other, "push", "-q", "origin", BR)
    r = run(env, "push")
    assert r.returncode != 0 and "fast-forward でない" in r.stderr


def test_bundle_in_repo_or_home_and_absolute_script_path(env):
    shutil.move(str(env["bundle"]), str(env["work"] / env["bundle"].name))
    copy = env["home"] / "consultai_apply.sh"
    shutil.copy(SCRIPT, copy)
    r = run(env, "push", script=copy, cwd=env["home"] / "Downloads")
    assert r.returncode == 0, r.stderr


def _merge_to_main(env, squash=False):
    git(env["src"], "push", "-q", "origin", BR)  # push 済み(1/3)の後に merge する
    m = env["tmp"] / "m"
    git(env["tmp"], "clone", "-q", str(env["origin"]), str(m))
    git(m, "fetch", "-q", str(env["src"]), f"{BR}:refs/heads/x")
    if squash:
        git(m, "merge", "-q", "--squash", "x")
        git(m, "commit", "-q", "-m", "squash")
    else:
        git(m, "merge", "-q", "--no-ff", "-m", "merge", "x")
    git(m, "push", "-q", "origin", "HEAD:main")


def test_deploy_unmerged_stops_before_changing_anything(env):
    git(env["src"], "push", "-q", "origin", BR)
    (env["work"] / "README.md").write_text("changed\n")
    before_env = (env["work"] / ".env").read_text()
    r = run(env, "deploy")
    assert r.returncode != 0 and "PR を merge してから" in r.stderr
    assert git(env["work"], "stash", "list") == ""
    assert (env["work"] / ".env").read_text() == before_env
    assert "tcops" not in calls(env) and "docker compose up" not in calls(env)
    assert (env["work"] / "README.md").read_text() == "changed\n"


def test_deploy_untracked_collision_and_stub_flag_stop(env):
    _merge_to_main(env)
    (env["work"] / "b.txt").write_text("mine\n")  # main の新しいファイルと同じ名前の未追跡のファイル
    r = run(env, "deploy")
    assert r.returncode != 0 and "ぶつかります" in r.stderr and (env["work"] / "b.txt").read_text() == "mine\n"
    (env["work"] / "b.txt").unlink()
    (env["work"] / ".env").write_text("SECRET_BACKEND=db_encrypted\nPROVIDER_HTTP_STUB=True\n")
    r = run(env, "deploy")
    assert r.returncode != 0 and "PROVIDER_HTTP_STUB" in r.stderr


@pytest.mark.parametrize("squash", [False, True])
def test_deploy_keeps_changes_records_state_and_succeeds(env, squash):
    _merge_to_main(env, squash=squash)
    (env["work"] / "README.md").write_text("tracked change\n")
    git(env["work"], "add", "README.md")
    (env["work"] / "bin.dat").write_bytes(b"\x00\x01")
    git(env["work"], "add", "bin.dat")
    (env["work"] / "note.txt").write_text("untracked\n")
    r = run(env, "deploy")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "consultai deploy 前の退避" in git(env["work"], "stash", "list")
    assert (env["work"] / "note.txt").read_text() == "untracked\n"
    state = next((env["tmp"] / "art").glob("deploy-*.state")).read_text()
    assert f"prev_sha={env['base']}" in state and "prev_branch=main" in state
    assert "prev_db_revision=c3e5a7b9d1f4" in state and "backup=tc-20261101T000000Z" in state
    assert "tcops verify tc-20261101T000000Z" in calls(env)


@pytest.mark.parametrize("fault,msg", [("front", "HTTP 500"), ("ready", "HTTP 503"), ("migrate_exit", "migrate の終了 1"),
                                       ("db_current", "head"), ("acao", "CORS")])
def test_deploy_failures_are_not_reported_as_success(env, fault, msg):
    _merge_to_main(env)
    value = {"front": "500", "ready": "503", "migrate_exit": "1", "db_current": "b7e3c9d1f5a2",
             "acao": "http://x"}[fault]
    (env["state"] / fault).write_text(value)
    r = run(env, "deploy")
    assert r.returncode != 0 and msg in r.stderr and "OK: main" not in r.stdout
    assert "元の状態" in r.stderr and "tcops.py restore" in r.stderr  # 段階に合う戻し方を示す
    assert "downgrade b7e3c9d1f5a2" not in r.stderr + r.stdout  # 決め打ちの破壊的な downgrade を案内しない


def test_deploy_main_ci_red_stops(env):
    _merge_to_main(env)
    (env["state"] / "main_ci").write_text("failure")
    r = run(env, "deploy")
    assert r.returncode != 0 and "CI が failure" in r.stderr and "tcops" not in calls(env)


def test_script_has_no_fixed_downgrade_and_json_safe():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "downgrade b7e3c9d1f5a2" not in text and "--body-file docs/" not in text
    json.dumps(text)  # 文字コードの確認


def test_merge_uses_squash_with_the_expected_head_and_waits_for_main_ci(env):
    """[Gate AdminUAT] このリポジトリは merge commit を許さない。squash・期待の head の時だけ・main の CI を待つ"""
    assert run(env, "push").returncode == 0
    r = run(env, "merge")
    assert r.returncode == 0, r.stdout + r.stderr
    merges = (env["state"] / "merges").read_text()
    assert "--squash" in merges and f"--match-head-commit {env['new']}" in merges and "--merge " not in merges
    assert "--commit 1111111111111111111111111111111111111111" in calls(env)
    assert "main 1111111 の CI 成功" in r.stdout
    # 2回目は merge しない(済み)
    r = run(env, "merge")
    assert r.returncode == 0 and "merge 済み" in r.stdout
    assert (env["state"] / "merges").read_text().count("pr merge") == 1


def test_merge_refuses_wrong_head_or_red_ci(env):
    assert run(env, "push").returncode == 0
    (env["state"] / "pr_head").write_text("2" * 40)
    r = run(env, "merge")
    assert r.returncode != 0 and "merge しません" in r.stderr
    (env["state"] / "pr_head").write_text(env["new"])
    (env["state"] / "branch_ci").write_text("failure")
    r = run(env, "merge")
    assert r.returncode != 0 and "success ではありません" in r.stderr
    assert not (env["state"] / "merges").exists()


def test_other_gate_branch_trace_and_bundle_names(env):
    """TC_BRANCH・TC_TRACE・TC_BUNDLE_GLOB・TC_OLD_PR(空)で別の Gate にも使える"""
    src, other = env["src"], "gate/admin-ops-uat"
    git(src, "checkout", "-q", "-b", other)
    sha = commit(src, {"docs/trace/gate-admin-uat-trace.md": "# Gate AdminUAT\n"}, "admin uat")
    git(src, "bundle", "create", str(env["home"] / f"adminuat_{sha[:7]}.bundle"), f"{env['base']}..{other}")
    (env["state"] / "pr_head").write_text(sha)
    e = dict(env)
    e["env"] = {**env["env"], "TC_EXPECT_HEAD": sha, "EXPECT_FOR_STUB": sha, "TC_BRANCH": other,
                "TC_TRACE": "docs/trace/gate-admin-uat-trace.md", "TC_BUNDLE_GLOB": "adminuat_*.bundle",
                "TC_OLD_PR": "", "TC_PR_TITLE": "Gate AdminUAT"}
    r = run(e, "push")
    assert r.returncode == 0, r.stdout + r.stderr
    assert git(env["origin"], "rev-parse", other) == sha
    assert (env["state"] / "body").read_text() == "# Gate AdminUAT\n"
    assert "--title Gate AdminUAT" in calls(env) and not (env["state"] / "closed").exists()
