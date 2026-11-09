"""[Gate GcpVm] GCP の開発の共有環境(VM 1 台 + Tailscale)の設定と運用スクリプト。

外の GCP・Tailscale・docker へは触らない(代わりのコマンドで動かす)。確かめること:
- VM には外部 IP を付けない・受け付けの規則は IAP の SSH(35.235.240.0/20)だけ・削除の保護・OS Login・鍵のファイルを作らない
- backend・画面・振り分けは 127.0.0.1 だけで待つ。CORS は https://<tailnet の名前> だけ。omega-dev2 の設定は変えない
- 振り分けは /api/*・/health・/ready だけを backend へ。Host・X-Forwarded-Proto を固定する
- .env は乱数の鍵で作り、値を画面に出さない・600・2 回目は変えない
- Funnel(インターネットへの公開)は使わない。有効なら check が NG で終わる
"""
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
OPS = ROOT / "scripts" / "ops"
VM = OPS / "gcp_vm.sh"
CREATE = OPS / "gcp_vm_create.sh"
CADDY = OPS / "gcp-vm" / "Caddyfile"
OVERRIDE = ROOT / "docker-compose.gcp.yml"

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="bash が無い")


class _Loader(yaml.SafeLoader):
    pass


_Loader.add_constructor("!override", lambda loader, node: loader.construct_sequence(node))


def _override():
    return yaml.load(OVERRIDE.read_text(encoding="utf-8"), Loader=_Loader)


def test_compose_override_binds_loopback_and_cors_is_tailnet_only():
    text = OVERRIDE.read_text(encoding="utf-8")
    assert text.count("ports: !override") == 2  # backend・frontend の 0.0.0.0 の公開を置き換える
    s = _override()["services"]
    assert s["backend"]["ports"] == ["127.0.0.1:8001:8000"]
    assert s["frontend"]["ports"] == ["127.0.0.1:4173:4173"]
    assert s["gateway"]["ports"] == ["127.0.0.1:8080:8080"]
    assert re.fullmatch(r"caddy:\d+\.\d+\.\d+-alpine", s["gateway"]["image"])  # 版を固定
    for key in ("CORS_ORIGINS", "API_CORS_ORIGINS"):
        assert s["backend"]["environment"][key].startswith("${TC_SITE_ORIGIN:?")
    # 元の docker-compose.yml(omega-dev2)は変えない: gateway は無い
    base = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    assert "gateway" not in base["services"] and base["services"]["backend"]["ports"] == ["8001:8000"]


def test_caddyfile_routes_only_api_health_ready_to_backend():
    text = CADDY.read_text(encoding="utf-8")
    body = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert "admin off" in body and "auto_https off" in body
    assert re.search(r"@backend path /api/\* /health /ready\n", body)
    assert body.count("reverse_proxy backend:8000") == 1 and body.count("reverse_proxy frontend:4173") == 1
    assert body.count("header_up Host {$TC_SITE_HOST}") == 2
    assert body.count("header_up X-Forwarded-Proto https") == 2
    assert "/metrics" not in body and "/docs" not in body and ":8080 {" in body


def test_create_script_has_no_public_entry():
    text = CREATE.read_text(encoding="utf-8")
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert "no-address" in code and "--deletion-protection" in code
    assert "enable-oslogin=TRUE" in code and "block-project-ssh-keys=TRUE" in code
    assert "--shielded-secure-boot" in code
    assert code.count("firewall-rules create") == 1 and "--source-ranges=35.235.240.0/20" in code
    assert "0.0.0.0/0" not in code
    for banned in ("keys create", "instances delete", "networks delete", "allUsers", "--address="):
        assert banned not in code, banned
    assert "${TC_GCP_PROJECT:?" in code  # project を既定値で選ばない


def test_vm_script_never_enables_funnel_or_destroys():
    code = "\n".join(line for line in VM.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))
    assert "tailscale funnel status" in code
    assert not re.search(r"tailscale funnel (?!status)", code)
    for banned in ("down -v", "volume rm", "reset --hard", "git clean", "push --force", "rm -rf"):
        assert banned not in code, banned


TAILSCALE = """#!/usr/bin/env bash
case "$1 $2" in
  "status --json") echo '{"Self": {"DNSName": "travelcanvas.tail-test.ts.net."}}' ;;
  "serve status")
    echo "https://travelcanvas.tail-test.ts.net (tailnet only)"
    echo "|-- / proxy http://127.0.0.1:8080" ;;
  "funnel status") if [ -n "$STUB_FUNNEL" ]; then echo "# Funnel on:"; else echo "(tailnet only)"; fi ;;
esac
exit 0
"""
SUDO = """#!/usr/bin/env bash
exec "$@"
"""
SS = """#!/usr/bin/env bash
echo "LISTEN 0 4096 127.0.0.1:8080 0.0.0.0:*"
echo "LISTEN 0 4096 127.0.0.1:8001 0.0.0.0:*"
[ -n "$STUB_WIDE" ] && echo "LISTEN 0 4096 0.0.0.0:4173 0.0.0.0:*"
exit 0
"""
CURL = """#!/usr/bin/env python3
import sys
a = sys.argv[1:]
url = [x for x in a if x.startswith("http")][-1]
origin = next((a[i + 1][8:] for i, x in enumerate(a) if x == "-H" and a[i + 1].startswith("Origin: ")), None)
if "-w" in a:
    print("200", end="")
elif "-D" in a and "OPTIONS" in a:
    print(f"access-control-allow-origin: {origin}\\r")
elif "-D" in a:
    print("content-security-policy: default-src 'self'; connect-src 'self' https://travelcanvas.tail-test.ts.net\\r")
elif url.endswith("/metrics"):
    print("<!doctype html>")
"""


@pytest.fixture()
def vm(tmp_path):
    root = tmp_path / "repo"
    (root / "scripts" / "ops").mkdir(parents=True)
    shutil.copy(VM, root / "scripts" / "ops" / "gcp_vm.sh")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("tailscale", TAILSCALE), ("sudo", SUDO), ("ss", SS), ("curl", CURL)):
        p = bin_dir / name
        p.write_text(body)
        p.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "TC_ARTIFACTS": str(tmp_path / "art")}

    def run(*args, **extra):
        return subprocess.run(["bash", str(root / "scripts" / "ops" / "gcp_vm.sh"), *args], cwd=root,
                              env={**env, **extra}, capture_output=True, text=True, timeout=60)
    return root, run


def test_env_is_random_private_and_not_printed(vm):
    root, run = vm
    out = run("env")
    assert out.returncode == 0, out.stderr
    dotenv = (root / ".env").read_text()
    assert stat.S_IMODE((root / ".env").stat().st_mode) == 0o600
    values = dict(line.split("=", 1) for line in dotenv.splitlines() if "=" in line and not line.startswith("#"))
    assert values["COMPOSE_FILE"] == "docker-compose.yml:docker-compose.gcp.yml"
    assert values["TC_SITE_HOST"] == "travelcanvas.tail-test.ts.net"
    assert values["TC_SITE_ORIGIN"] == "https://travelcanvas.tail-test.ts.net"
    assert values["APP_ENV"] == "development" and values["SECRET_BACKEND"] == "db_encrypted"
    secrets = [values[k] for k in ("DB_PASSWORD", "DB_APP_PASSWORD", "REDIS_PASSWORD", "SECRET_KEY", "JWT_SECRET_KEY",
                                   "ENCRYPTION_KEY", "LOOKUP_INDEX_KEY", "DOCUMENT_DOWNLOAD_SIGNING_KEY", "MFA_KEY",
                                   "OFFLINE_PACK_KEY_SECRET", "METRICS_TOKEN")]
    assert len(set(secrets)) == len(secrets) and all(len(v) >= 48 for v in secrets)
    assert values["APP_DATABASE_URL"] == f"postgresql://tc_app:{values['DB_APP_PASSWORD']}@postgres:5432/travelcanvas"
    for v in secrets:
        assert v not in out.stdout + out.stderr
    again = run("env")
    assert again.returncode == 0 and (root / ".env").read_text() == dotenv  # 2 回目は変えない


def test_check_passes_and_fails_on_funnel_or_wide_listen(vm):
    root, run = vm
    assert run("env").returncode == 0
    ok = run("check")
    assert ok.returncode == 0, ok.stdout + ok.stderr
    assert "CORS: https://travelcanvas.tail-test.ts.net を許可" in ok.stdout and "OK:" in ok.stdout
    funnel = run("check", STUB_FUNNEL="1")
    assert funnel.returncode != 0 and "Funnel" in funnel.stdout
    wide = run("check", STUB_WIDE="1")
    assert wide.returncode != 0 and "外向きに開いている" in wide.stdout


def test_deploy_refuses_bad_sha_and_missing_env(vm):
    root, run = vm
    assert run("deploy").returncode != 0
    assert run("deploy", "not-a-sha").returncode != 0
    out = run("deploy", "0123456789abcdef0123456789abcdef01234567")
    assert out.returncode != 0 and ".env がありません" in out.stderr
