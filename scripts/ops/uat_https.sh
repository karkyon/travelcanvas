#!/usr/bin/env bash
# [Gate AdminUAT] 開発の UAT 用の https の入口(音声入力の UAT のため)。omega-dev2 で実行する。
#
#   bash scripts/ops/uat_https.sh up      # 入口を作る(.env に TC_UAT_* を足す → backend・frontend を作り直す → caddy)
#   bash scripts/ops/uat_https.sh check   # 証明書・health・ready・画面・CSP・CORS を確かめる(何も変えない)
#   bash scripts/ops/uat_https.sh stop    # 入口だけ止める(内部 CA は volume に残す。.env は変えない)
#
# 環境変数: TC_LAN_HOST(既定 192.168.1.11)・TC_UAT_NAMES(既定 "<TC_LAN_HOST>,<hostname>")・TC_UAT_HTTPS_PORT(既定 4443)
# 守ること: .env の鍵・秘密の値は読まない・出さない(触るのは TC_UAT_* と TC_PUBLIC_HOSTS の行だけ)。
#           volume を消さない。本番・staging(APP_ENV)では動かない。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ENV_FILE="${TC_ENV_FILE:-$ROOT/.env}"
LAN_HOST="${TC_LAN_HOST:-192.168.1.11}"
PORT="${TC_UAT_HTTPS_PORT:-4443}"
CA_PORT=4480
NAMES="${TC_UAT_NAMES:-$LAN_HOST,$(hostname)}"
ART="${TC_ARTIFACTS:-$HOME/tc-artifacts}"
CRT="$ART/travelcanvas-uat-root.crt"
DC=(docker compose)
DCU=(docker compose --profile uat-https)

say() { printf '%s\n' "$*"; }
die() { printf 'NG: %s\n' "$*" >&2; exit 1; }

names() { tr ',' '\n' <<<"$NAMES" | sed 's/^ *//;s/ *$//' | grep -E '^[A-Za-z0-9.-]+$' | awk '!seen[$0]++'; }

env_value() { # 秘密でない行(TC_UAT_*・TC_PUBLIC_HOSTS・APP_ENV)だけを読む
  case "$1" in TC_UAT_*|TC_PUBLIC_HOSTS|APP_ENV) ;; *) die "読まない設定: $1" ;; esac
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/^"//;s/"$//' || true
}

set_env() { # その行だけを書き換える(無ければ足す)。他の行は触らない
  local key="$1" value="$2"
  case "$key" in TC_UAT_*|TC_PUBLIC_HOSTS) ;; *) die "書かない設定: $key" ;; esac
  if grep -qE "^$key=" "$ENV_FILE"; then
    [ "$(env_value "$key")" = "$value" ] && return 0
    python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import sys
path, key, value = sys.argv[1:4]
lines = open(path, encoding="utf-8").read().split("\n")
out = [f"{key}={value}" if l.startswith(key + "=") else l for l in lines]
open(path, "w", encoding="utf-8").write("\n".join(out))
PY
    say "  .env: $key を更新"
  else
    [ -z "$(tail -c1 "$ENV_FILE")" ] || printf '\n' >>"$ENV_FILE"
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
    say "  .env: $key を追加"
  fi
}

guard() {
  [ -f "$ENV_FILE" ] || die ".env がありません($ENV_FILE)"
  case "$(env_value APP_ENV | tr 'A-Z' 'a-z')" in
    production|prod|staging|stage) die "APP_ENV が本番・staging です。UAT の https の入口は開発だけで使います" ;;
  esac
  [[ "$PORT" =~ ^[0-9]{2,5}$ ]] || die "TC_UAT_HTTPS_PORT が数字ではありません"
  [ "$PORT" = 4443 ] || die "docker-compose.yml の uat-https は 4443 を開けます(別のポートは compose も変える)"
}

export_cert() {
  mkdir -p "$ART"
  local i
  for i in $(seq 1 30); do
    if "${DCU[@]}" exec -T uat-https test -s /data/caddy/pki/authorities/local/root.crt 2>/dev/null; then
      "${DCU[@]}" exec -T uat-https cat /data/caddy/pki/authorities/local/root.crt >"$CRT.tmp"
      mv "$CRT.tmp" "$CRT"
      return 0
    fi
    sleep 2
  done
  die "caddy の内部 CA の証明書ができません(docker compose --profile uat-https logs uat-https を確認)"
}

check() {
  [ -s "$CRT" ] || export_cert
  local fp n code csp acao ok=0
  fp=$(openssl x509 -in "$CRT" -noout -fingerprint -sha256 | cut -d= -f2)
  say "ルート証明書: $CRT"
  say "  SHA-256 指紋: $fp(端末に入れる時に照合)"
  for n in $(names); do
    local base="https://$n:$PORT"
    for path in /health /ready / /trip-consult /admin/ops; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --cacert "$CRT" --connect-to "$n:$PORT:127.0.0.1:$PORT" \
        --max-time 20 "$base$path" || true)
      say "  $base$path $code"
      [ "$code" = 200 ] || ok=1
    done
    csp=$(curl -s -D - -o /dev/null --cacert "$CRT" --connect-to "$n:$PORT:127.0.0.1:$PORT" --max-time 20 "$base/" \
      | tr -d '\r' | grep -i '^content-security-policy:' || true)
    if grep -q "connect-src 'self' $base" <<<"$csp"; then
      say "  CSP の通信先: $base(同じ https の入口)"
    else
      say "  NG: CSP の通信先が $base ではありません"; ok=1
    fi
    acao=$(curl -s -D - -o /dev/null --cacert "$CRT" --connect-to "$n:$PORT:127.0.0.1:$PORT" --max-time 20 \
      -X OPTIONS -H "Origin: $base" -H 'Access-Control-Request-Method: POST' "$base/api/v1/auth/login" \
      | tr -d '\r' | grep -i '^access-control-allow-origin:' | cut -d' ' -f2- || true)
    if [ "$acao" = "$base" ]; then
      say "  CORS: $base を許可(backend が TC_UAT_HTTPS_PORT を読んだ)"
    else
      say "  NG: CORS が $base を許可していません(backend を作り直したか確認)"; ok=1
    fi
  done
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$CA_PORT/travelcanvas-uat-root.crt" || true)
  say "  証明書の配布 http://$LAN_HOST:$CA_PORT/travelcanvas-uat-root.crt $code"
  [ "$code" = 200 ] || ok=1
  # backend の /metrics は通さない(画面の SPA が index.html を返すのは可。Prometheus の本文が見えたら NG)
  if curl -s --cacert "$CRT" --connect-to "$LAN_HOST:$PORT:127.0.0.1:$PORT" --max-time 10 \
      "https://$LAN_HOST:$PORT/metrics" | grep -qE '^# (HELP|TYPE) '; then
    say "  NG: backend の /metrics が https の入口から見えます"; ok=1
  else
    say "  /metrics: backend へは通さない"
  fi
  [ "$ok" = 0 ] || die "確認に失敗した項目があります(上の NG・200 以外)"
  say "OK: https の入口 https://$LAN_HOST:$PORT/trip-consult"
}

howto() {
  cat <<EOF

端末に証明書を入れる(1回だけ。入れるのはルート証明書=公開の証明書。秘密鍵ではありません):
  1) 端末のブラウザで http://$LAN_HOST:$CA_PORT/travelcanvas-uat-root.crt を開いて保存
     (SHA-256 指紋が上の値と同じか確かめる)
  2) Windows: 保存したファイルを右クリック → 証明書のインストール → 現在のユーザー →
     「証明書をすべて次のストアに配置する」→ 信頼されたルート証明機関 → Chrome/Edge を開き直す
  3) Android: 設定 → セキュリティ → 暗号化と認証情報 → 証明書のインストール → CA 証明書 → 保存したファイル
  4) iPhone: Safari で開く → プロファイルをインストール(設定 → 一般 → VPN とデバイス管理)→
     設定 → 一般 → 情報 → 証明書信頼設定 で TravelCanvas の CA(Caddy Local Authority)を有効にする
  5) https://$LAN_HOST:$PORT/trip-consult を開く。マイクの許可を求められたら「許可」
     (音声認識は Chrome・Edge・Safari。Chrome は音声を Google のサーバーで文字にします)
試験が終わったら端末から証明書を消してください(設定の同じ場所)。止める: bash scripts/ops/uat_https.sh stop
EOF
}

up() {
  guard
  local sites="" n hosts current
  for n in $(names); do sites="${sites:+$sites, }https://$n:$PORT"; done
  [ -n "$sites" ] || die "TC_UAT_NAMES に使える名前がありません"
  say "1: .env(TC_UAT_* と TC_PUBLIC_HOSTS の行だけ)"
  set_env TC_UAT_HTTPS_PORT "$PORT"
  set_env TC_UAT_SITES "$sites"
  set_env TC_UAT_DEFAULT_SNI "$LAN_HOST"
  current="$(env_value TC_PUBLIC_HOSTS)"
  hosts="$current"
  for n in $(names); do
    grep -qE "(^|,) *$n *(,|$)" <<<"$current" || hosts="${hosts:+$hosts,}$n"
  done
  set_env TC_PUBLIC_HOSTS "$hosts"
  say "2: backend・frontend を作り直す(設定を読み直す。DB・volume は触らない)"
  "${DC[@]}" up -d --no-deps --force-recreate backend frontend
  say "3: https の入口(caddy)を起動"
  "${DCU[@]}" up -d uat-https
  local i code
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8001/ready || true)
    [ "$code" = 200 ] && break
    sleep 2
  done
  export_cert
  check
  howto
}

case "${1:-}" in
  up) up ;;
  check) guard; check ;;
  stop) "${DCU[@]}" stop uat-https; say "止めました(内部 CA は volume travelcanvas_uat_caddy に残ります)" ;;
  *) say "使い方: bash scripts/ops/uat_https.sh up|check|stop"; exit 2 ;;
esac
