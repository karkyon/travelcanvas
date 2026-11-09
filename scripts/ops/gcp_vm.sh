#!/usr/bin/env bash
# [Gate GcpVm] GCP の開発の共有環境の VM の中で使う(docs/runbooks/gcp-vm-tailscale.md)。
#
#   bash scripts/ops/gcp_vm.sh bootstrap      # 1 回だけ: スワップ 4GB・Docker・Tailscale(tailnet に入る)
#   bash scripts/ops/gcp_vm.sh env            # 1 回だけ: .env を作る(鍵・パスワードは乱数。値は表示しない)
#   bash scripts/ops/gcp_vm.sh deploy <SHA>   # omega-dev2 で確かめた main の commit をそのまま反映する
#   bash scripts/ops/gcp_vm.sh check          # 確かめるだけ(何も変えない)
#
# 守ること: .env の秘密の値を読まない・出さない(読むのは COMPOSE_FILE・TC_SITE_*・APP_ENV の行だけ)。
#           volume・DB を消さない。git reset --hard・git clean をしない。反映は main に入った commit だけ。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
ART="${TC_ARTIFACTS:-$HOME/tc-artifacts}"
GW="http://127.0.0.1:8080"
TS_NAME="${TC_TS_HOSTNAME:-travelcanvas}"
TS_TAG="${TC_TS_TAG:-tag:travelcanvas}"

say() { printf '%s\n' "$*"; }
die() { printf 'NG: %s\n' "$*" >&2; exit 1; }
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" || true; }

env_value() { # 秘密でない行だけを読む
  case "$1" in COMPOSE_FILE|TC_SITE_HOST|TC_SITE_ORIGIN|APP_ENV) ;; *) die "読まない設定: $1" ;; esac
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed 's/^"//;s/"$//' || true
}

ts_dns_name() { # この VM の tailnet の名前(例 travelcanvas.tail1234.ts.net)
  tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null
}

cmd_bootstrap() {
  command -v sudo >/dev/null || die "sudo がありません"
  say "1: スワップ 4GB(e2-small のメモリ 2GB では画面の build が足りないため)"
  if swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
    say "  ある"
  else
    sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null \
      && sudo swapon /swapfile || die "スワップを作れません"
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-travelcanvas.conf >/dev/null && sudo sysctl -q --system
    say "  作った"
  fi

  say "2: Docker(公式の apt。Compose 2.24.4 以上が要る)"
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    say "  ある: $(docker compose version --short 2>/dev/null)"
  else
    sudo apt-get update -q && sudo apt-get install -y -q ca-certificates curl >/dev/null || die "apt に失敗"
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc || die "Docker の鍵を取れません"
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update -q && sudo apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
      docker-compose-plugin >/dev/null || die "Docker を入れられません"
  fi
  if [ ! -f /etc/docker/daemon.json ]; then # ログでディスクが埋まらないように
    printf '{\n  "log-driver": "json-file",\n  "log-opts": {"max-size": "10m", "max-file": "3"}\n}\n' \
      | sudo tee /etc/docker/daemon.json >/dev/null && sudo systemctl restart docker
  fi
  id -nG "$USER" | grep -qw docker || { sudo usermod -aG docker "$USER"; say "  $USER を docker の組に入れた(入り直すと効く)"; }

  say "3: Tailscale(この VM の入口。tailnet の中の端末だけが画面を開ける)"
  if ! command -v tailscale >/dev/null; then
    curl -fsSL https://tailscale.com/install.sh | sh || die "Tailscale を入れられません"
  fi
  if [ -n "$(ts_dns_name)" ]; then
    say "  tailnet に入っている: $(ts_dns_name)"
  else
    say "  下に出る URL を、Tailscale の管理者のアカウントのブラウザで開いて承認してください"
    say "  (先に Runbook 2 章の アクセス規則(tagOwners に $TS_TAG)を保存しておく)"
    sudo tailscale up --ssh --hostname="$TS_NAME" --advertise-tags="$TS_TAG" || die "tailscale up に失敗"
    say "  tailnet に入った: $(ts_dns_name)"
  fi
  say ""
  say "OK: 次は一度 exit して入り直し(docker の組を効かせる)、bash scripts/ops/gcp_vm.sh env"
}

cmd_env() {
  local host
  host="$(ts_dns_name)"
  [ -n "$host" ] || die "Tailscale に入っていません(先に bootstrap)"
  if [ -f .env ]; then
    say ".env はある(変えない)。TC_SITE_HOST=$(env_value TC_SITE_HOST)・COMPOSE_FILE=$(env_value COMPOSE_FILE)"
    [ "$(env_value TC_SITE_HOST)" = "$host" ] || say "注意: tailnet の名前 $host と TC_SITE_HOST が違います(名前を変えたなら .env の TC_SITE_* と TC_PUBLIC_HOSTS を直す)"
    return 0
  fi
  umask 077
  python3 - "$host" > .env <<'PY' || die ".env を作れません"
import datetime
import secrets
import sys

host = sys.argv[1]
tok = lambda: secrets.token_urlsafe(48)  # noqa: E731
pg = lambda user, pw: "postgresql" + "://" + user + ":" + pw + "@postgres:5432/travelcanvas"  # noqa: E731
db_pw, app_pw, redis_pw = secrets.token_hex(24), secrets.token_hex(24), secrets.token_hex(24)
lines = [
    f"# [Gate GcpVm] {datetime.datetime.now().isoformat(timespec='seconds')} に scripts/ops/gcp_vm.sh env が作った。",
    "# 秘密の値を画面・ログ・Git・チャットに出さない。omega-dev2 の .env と同じ値にしない(環境ごとに別の鍵)",
    "COMPOSE_FILE=docker-compose.yml:docker-compose.gcp.yml",
    "APP_ENV=development",
    "DEBUG=false",
    f"TC_SITE_HOST={host}",
    f"TC_SITE_ORIGIN=https://{host}",
    f"TC_PUBLIC_HOSTS={host}",
    "VITE_API_URL=http://localhost:8001",
    "DB_NAME_DEV=travelcanvas",
    "DB_USER=travelcanvas_app",
    f"DB_PASSWORD={db_pw}",
    "DATABASE_URL=" + pg("travelcanvas_app", db_pw),
    f"DB_APP_PASSWORD={app_pw}",
    "APP_DATABASE_URL=" + pg("tc_app", app_pw),
    f"REDIS_PASSWORD={redis_pw}",
    f"SECRET_KEY={tok()}",
    f"JWT_SECRET_KEY={tok()}",
    f"ENCRYPTION_KEY={tok()}",
    f"LOOKUP_INDEX_KEY={tok()}",
    f"DOCUMENT_DOWNLOAD_SIGNING_KEY={tok()}",
    f"MFA_KEY={tok()}",
    f"OFFLINE_PACK_KEY_SECRET={tok()}",
    f"METRICS_TOKEN={tok()}",
    "SECRET_BACKEND=db_encrypted",
    "ADMIN_MFA_REQUIRED=true",
]
print("\n".join(lines))
PY
  chmod 600 .env
  say "OK: .env を作りました(600。値は表示しません)。画面の URL: https://$host"
  say "    ENCRYPTION_KEY をなくすと暗号化したデータが読めなくなります。Runbook 5 章の方法で控えを残してください"
}

cmd_check() {
  local host ok=0 code csp acao
  host="$(env_value TC_SITE_HOST)"
  [ -n "$host" ] || die ".env に TC_SITE_HOST がありません(先に env)"
  [ "$(env_value COMPOSE_FILE)" = "docker-compose.yml:docker-compose.gcp.yml" ] || { say "NG: .env の COMPOSE_FILE"; ok=1; }
  for path in /health /ready / /trip-consult /admin/ops; do
    code="$(http_code "$GW$path")"
    say "  $GW$path $code"
    [ "$code" = 200 ] || ok=1
  done
  csp="$(curl -s -D - -o /dev/null --max-time 15 "$GW/" | tr -d '\r' | grep -i '^content-security-policy:' || true)"
  if grep -q "https://$host" <<<"$csp"; then say "  CSP の通信先: https://$host(同じ origin)"; else say "  NG: CSP の通信先が https://$host ではない"; ok=1; fi
  acao="$(curl -s -D - -o /dev/null --max-time 15 -X OPTIONS -H "Origin: https://$host" \
    -H 'Access-Control-Request-Method: POST' "$GW/api/v1/auth/login" | tr -d '\r' \
    | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
  if [ "$acao" = "https://$host" ]; then say "  CORS: https://$host を許可"; else say "  NG: CORS が https://$host を許可しない"; ok=1; fi
  if curl -s --max-time 10 "$GW/metrics" | grep -qE '^# (HELP|TYPE) '; then say "  NG: /metrics が見える"; ok=1; else say "  /metrics: backend へ通さない"; fi
  # 外から届く口が無いこと: 0.0.0.0 で待つのは Tailscale・SSH だけ(backend・画面・振り分けは 127.0.0.1)
  local wide
  wide="$(ss -Hltn 2>/dev/null | awk '{print $4}' | grep -E '^(0\.0\.0\.0|\*|\[::\]):(8001|4173|8080|5432|6379)$' || true)"
  if [ -z "$wide" ]; then say "  待ち受け: 8001・4173・8080 は 127.0.0.1 だけ"; else say "  NG: 外向きに開いている: $wide"; ok=1; fi
  if command -v tailscale >/dev/null; then
    sudo tailscale serve status 2>/dev/null | sed 's/^/  serve: /'
    sudo tailscale serve status 2>/dev/null | grep -q "http://127.0.0.1:8080" || { say "  NG: Tailscale Serve が 127.0.0.1:8080 を出していない"; ok=1; }
    sudo tailscale funnel status 2>/dev/null | grep -qi "funnel on" && { say "  NG: Funnel(インターネットへの公開)が有効"; ok=1; }
  fi
  [ "$ok" = 0 ] || die "確認に失敗した項目があります(上の NG・200 以外)"
  say "OK: https://$host/ (tailnet の中の端末だけ)"
}

cmd_deploy() {
  local sha="${1:-}" target state ts prev dbrev bk mid mexit cur heads
  [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "使い方: bash scripts/ops/gcp_vm.sh deploy <omega-dev2 で確かめた main の SHA>"
  [ -f .env ] || die ".env がありません(先に env)"
  [ "$(env_value COMPOSE_FILE)" = "docker-compose.yml:docker-compose.gcp.yml" ] || die ".env の COMPOSE_FILE が GCP の設定ではありません"
  docker info >/dev/null 2>&1 || die "docker を使えません(bootstrap の後で入り直したか)"
  mkdir -p "$ART" && chmod 700 "$ART"
  ts="$(date +%Y%m%d-%H%M%S)"
  state="$ART/gcp-deploy-$ts.state"
  # ---- 0 事前の確認(何も変えない)
  git fetch -q origin main || die "0: origin から取れません"
  target="$(git rev-parse --verify -q "$sha^{commit}")" || die "0: $sha がありません"
  git merge-base --is-ancestor "$target" origin/main || die "0: ${target:0:7} は main に入っていません(merge した commit だけ反映する)"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "0: VM の作業ツリーに変更があります(VM では直接直さない)"
  # ---- 1 記録・バックアップ
  prev="$(git rev-parse HEAD)"
  dbrev="$(docker compose exec -T backend alembic current 2>/dev/null | awk '{print $1}' | tail -1)"
  { echo "prev_sha=$prev"; echo "prev_db_revision=${dbrev:-none}"; echo "target_sha=$target"; } > "$state"
  chmod 600 "$state"
  say "1: 元の状態: ${prev:0:7}・DB ${dbrev:-none}($state)"
  if [ -n "$dbrev" ]; then
    bk="$(python3 scripts/ops/tcops.py backup 2>&1 | tee /dev/stderr | grep -oE 'tc-[0-9]{8}T[0-9]{6}Z' | tail -1)"
    [ -n "$bk" ] && python3 scripts/ops/tcops.py verify "$bk" >/dev/null || die "1: バックアップに失敗(反映していません)"
    echo "backup=$bk" >> "$state"
    say "1: バックアップ $bk"
  else
    say "1: 初めての反映(DB がまだ無いのでバックアップは飛ばす)"
  fi
  # ---- 2 反映(確かめた commit そのもの)
  git -c advice.detachedHead=false checkout -q "$target" || die "2: ${target:0:7} にできません"
  say "2: ${target:0:7} を反映。build します(e2-small は数分かかります)"
  docker compose up -d --build --remove-orphans || die "2: docker compose up に失敗(元: ${prev:0:7}。戻す: bash $0 deploy ${prev:0:12})"
  mid="$(docker compose ps -aq migrate | head -1)"
  mexit="$(docker inspect -f '{{.State.ExitCode}}' "$mid" 2>/dev/null || echo 1)"
  [ "$mexit" = 0 ] || die "2: migrate の終了 $mexit(docker compose logs migrate)"
  cur="$(docker compose exec -T backend alembic current 2>/dev/null | awk '{print $1}' | tail -1)"
  heads="$(docker compose exec -T backend alembic heads 2>/dev/null | awk '{print $1}' | tail -1)"
  [ -n "$cur" ] && [ "$cur" = "$heads" ] || die "2: DB の revision $cur が head $heads と違う"
  say "2: DB revision $cur(head)"
  # ---- 3 入口(Tailscale Serve。tailnet の中だけ。Funnel=インターネットへの公開は使わない)
  sudo tailscale serve --bg http://127.0.0.1:8080 >/dev/null || die "3: tailscale serve に失敗"
  for _ in $(seq 1 40); do [ "$(http_code "$GW/ready")" = 200 ] && break; sleep 3; done
  # ---- 4 確認
  cmd_check || die "4: 確認に失敗(反映は済んでいます。上の NG を直す)"
  say "OK: ${target:0:7} を反映(記録 $state)"
}

case "${1:-}" in
  bootstrap) cmd_bootstrap ;;
  env) cmd_env ;;
  deploy) shift; cmd_deploy "$@" ;;
  check) cmd_check ;;
  *) say "使い方: bash scripts/ops/gcp_vm.sh bootstrap|env|deploy <SHA>|check"; exit 2 ;;
esac
