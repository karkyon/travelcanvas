"""[Gate AdminUAT] 音声の UAT 用の https の入口(scripts/ops/uat_https.sh・docker-compose の uat-https・Caddyfile)。

docker・curl は代わりのコマンドで動かす(実のサーバーへは触らない)。確かめること:
- .env は TC_UAT_* と TC_PUBLIC_HOSTS の行だけを変え、他の行(鍵・秘密)は変えない・出さない。2回目は何も変えない
- 本番・staging では何もしない。volume を消すコマンドを使わない
- CORS・CSP・health が揃わなければ失敗で終わる(成功と言わない)
- caddy は profile の中だけ・版を固定・backend へは /api・/health・/ready だけを通す
"""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ops" / "uat_https.sh"
CADDYFILE = ROOT / "scripts" / "ops" / "uat-https" / "Caddyfile"

pytestmark = pytest.mark.skipif(shutil.which("bash") is None or shutil.which("openssl") is None,
                                reason="bash・openssl が無い")

SECRET = "sk-proj-must-never-be-printed-XYZ987"
DOCKER = """#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case " $* " in
  *" exec -T uat-https test "*) exit 0 ;;
  *" exec -T uat-https cat "*) cat "$STUB_CERT" ;;
esac
exit 0
"""
CURL = """#!/usr/bin/env python3
import os, sys
a = sys.argv[1:]
url = [x for x in a if x.startswith("http")][-1]
origin = next((a[i + 1][8:] for i, x in enumerate(a) if x == "-H" and a[i + 1].startswith("Origin: ")), None)
base = "/".join(url.split("/")[:3])
if "-w" in a:
    print("200", end="")
elif "-D" in a and "OPTIONS" in a:
    if not os.environ.get("STUB_CORS_FAIL"):
        print(f"access-control-allow-origin: {origin}\\r")
elif "-D" in a:
    print(f"content-security-policy: default-src 'self'; connect-src 'self' {base} https://maps.googleapis.com\\r")
else:
    print("<!doctype html><title>TravelCanvas</title>")
"""


@pytest.fixture()
def env(tmp_path):
    root = tmp_path / "repo"
    (root / "scripts" / "ops").mkdir(parents=True)
    shutil.copy(SCRIPT, root / "scripts" / "ops" / "uat_https.sh")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("docker", DOCKER), ("curl", CURL)):
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    cert = tmp_path / "root.crt"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(tmp_path / "k.pem"),
                    "-out", str(cert), "-days", "1", "-subj", "/CN=Caddy Local Authority"],
                   check=True, capture_output=True)
    (root / ".env").write_text(f"APP_ENV=development\nOPENAI_API_KEY={SECRET}\n"
                               "ENCRYPTION_KEY=do-not-touch-ABC\nTC_PUBLIC_HOSTS=192.168.1.11\n")
    log = tmp_path / "docker.log"
    e = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "STUB_LOG": str(log), "STUB_CERT": str(cert),
         "TC_ARTIFACTS": str(tmp_path / "art"), "TC_UAT_NAMES": "192.168.1.11,omega-dev2",
         "TC_LAN_HOST": "192.168.1.11"}
    return root, e, log


def run(root, e, *args):
    return subprocess.run(["bash", str(root / "scripts" / "ops" / "uat_https.sh"), *args], cwd=root, env=e,
                          capture_output=True, text=True, timeout=60)


def test_up_touches_only_uat_lines_and_reports_ok(env):
    root, e, log = env
    r = run(root, e, "up")
    assert r.returncode == 0, r.stdout + r.stderr
    text = (root / ".env").read_text()
    assert f"OPENAI_API_KEY={SECRET}\n" in text and "ENCRYPTION_KEY=do-not-touch-ABC\n" in text
    assert "TC_UAT_HTTPS_PORT=4443\n" in text
    assert "TC_UAT_SITES=https://192.168.1.11:4443, https://omega-dev2:4443\n" in text
    assert "TC_UAT_DEFAULT_SNI=192.168.1.11\n" in text
    assert "TC_PUBLIC_HOSTS=192.168.1.11,omega-dev2\n" in text
    assert SECRET not in r.stdout + r.stderr and "do-not-touch" not in r.stdout + r.stderr
    calls = log.read_text()
    assert "compose up -d --no-deps --force-recreate backend frontend" in calls
    assert "compose --profile uat-https up -d uat-https" in calls
    assert not re.search(r"\b(down|rm|volume|prune)\b", calls)
    assert "OK: https の入口 https://192.168.1.11:4443/trip-consult" in r.stdout
    assert "SHA-256 指紋" in r.stdout and (Path(e["TC_ARTIFACTS"]) / "travelcanvas-uat-root.crt").exists()
    # 2回目は .env を変えない
    before = (root / ".env").read_text()
    assert run(root, e, "up").returncode == 0
    assert (root / ".env").read_text() == before


def test_refuses_production_without_touching_anything(env):
    root, e, log = env
    p = root / ".env"
    p.write_text(p.read_text().replace("APP_ENV=development", "APP_ENV=production"))
    before = p.read_text()
    r = run(root, e, "up")
    assert r.returncode != 0 and "本番" in r.stderr
    assert p.read_text() == before and not log.exists()


def test_cors_not_picked_up_is_a_failure(env):
    root, e, _log = env
    r = run(root, {**e, "STUB_CORS_FAIL": "1"}, "up")
    assert r.returncode != 0
    assert "NG: CORS" in r.stdout and "OK: https の入口" not in r.stdout


def test_stop_keeps_the_ca_volume(env):
    root, e, log = env
    assert run(root, e, "stop").returncode == 0
    assert log.read_text().strip() == "compose --profile uat-https stop uat-https"


def test_compose_service_is_optional_pinned_and_gets_no_secrets():
    svc = yaml.safe_load((ROOT / "docker-compose.yml").read_text())["services"]["uat-https"]
    assert svc["profiles"] == ["uat-https"]
    assert re.fullmatch(r"caddy:\d+\.\d+\.\d+-alpine", svc["image"])
    assert "env_file" not in svc
    assert "./scripts/ops/uat-https/Caddyfile:/etc/caddy/Caddyfile:ro" in svc["volumes"]


def test_caddyfile_only_forwards_api_health_ready_to_backend():
    text = "\n".join(line for line in CADDYFILE.read_text().splitlines() if not line.lstrip().startswith("#"))
    assert "tls internal" in text and "admin off" in text
    assert re.search(r"@backend path /api/\* /health /ready\n", text)
    assert "/metrics" not in text and "/docs" not in text
    assert "root.key" not in text and "intermediate.key" not in text
