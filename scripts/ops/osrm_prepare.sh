#!/usr/bin/env bash
# [Gate RoadRoute] 地図の「道に沿った経路」(OSRM。無料・鍵は要らない)を omega-dev2 で動かす。
#
#   bash scripts/ops/osrm_prepare.sh up [地域]   # 地図データの取得 → 車・歩きの経路データを作る → 起動 → .env → backend を作り直す
#   bash scripts/ops/osrm_prepare.sh check       # 動いているか(伊勢の2点の経路を引いてみる。何も変えない)
#   bash scripts/ops/osrm_prepare.sh stop        # 止める(作った経路データは volume に残す。.env は変えない)
#
# 地域: Geofabrik の日本の地域の名前(kansai・chubu・kanto・chugoku・shikoku・kyushu・tohoku・hokkaido)、
#       または japan(日本全部。データの作成にメモリ約 10GB 以上・1〜2 時間)。既定は kansai(近畿。三重・京都を含む)。
#       カンマ区切りで複数(例: kansai,chubu)を指定すると、まとめて1つにする(osmium が要る。無ければ docker で動かす)。
# 目安: kansai(約 300MB)で、車・歩きの作成に合わせて 20〜40 分・メモリ 4〜6GB・ディスク 約 5GB。
# 守ること: .env の鍵・秘密の値は読まない・出さない(触るのは OSRM_CAR_URL・OSRM_FOOT_URL の行だけ)。
#           DB・ほかの volume を触らない。本番・staging では使わない(開発の地図の確認用)。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ENV_FILE="${TC_ENV_FILE:-$ROOT/.env}"
IMAGE="ghcr.io/project-osrm/osrm-backend:v5.27.1"
OSMIUM_IMAGE="${TC_OSMIUM_IMAGE:-iboates/osmium:latest}"
VOLUME="travelcanvas_osrm"
WORK="${TC_OSRM_WORK:-$HOME/.cache/travelcanvas-osrm}"
DC=(docker compose)
DCO=(docker compose --profile osrm)

say() { printf '%s\n' "$*"; }
die() { printf 'NG: %s\n' "$*" >&2; exit 1; }

set_env() { # その行だけを書き換える(無ければ足す)。他の行は触らない
  local key="$1" value="$2"
  case "$key" in OSRM_CAR_URL|OSRM_FOOT_URL) ;; *) die "書かない設定: $key" ;; esac
  [ -f "$ENV_FILE" ] || die ".env がありません($ENV_FILE)"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import sys
path, key, value = sys.argv[1:4]
lines = open(path, encoding="utf-8").read().split("\n")
out, done = [], False
for line in lines:
    if line.startswith(key + "="):
        if not done:
            out.append(f"{key}={value}")
            done = True
        continue
    out.append(line)
if not done:
    while out and out[-1] == "":
        out.pop()
    out += [f"{key}={value}", ""]
open(path, "w", encoding="utf-8").write("\n".join(out))
PY
}

url_of() {
  case "$1" in
    japan) echo "https://download.geofabrik.de/asia/japan-latest.osm.pbf" ;;
    kansai|chubu|kanto|chugoku|shikoku|kyushu|tohoku|hokkaido) echo "https://download.geofabrik.de/asia/japan/$1-latest.osm.pbf" ;;
    *) die "知らない地域: $1(kansai・chubu・kanto・chugoku・shikoku・kyushu・tohoku・hokkaido・japan)" ;;
  esac
}

check() {
  say "経路を引いてみる(伊勢市駅 → 内宮)"
  local ok=0 p host
  for p in car foot; do
    host="osrm-$p"
    if "${DC[@]}" exec -T backend curl -fsS --max-time 10 \
        "http://$host:5000/route/v1/driving/136.7071,34.4925;136.7258,34.4551?overview=false" 2>/dev/null | grep -q '"code":"Ok"'; then
      say "  OK: $host"
    else
      say "  NG: $host(docker compose --profile osrm logs $host)"; ok=1
    fi
  done
  grep -qE '^OSRM_CAR_URL=http' "$ENV_FILE" && grep -qE '^OSRM_FOOT_URL=http' "$ENV_FILE" \
    && say "  OK: .env に OSRM_CAR_URL・OSRM_FOOT_URL がある" || { say "  NG: .env に OSRM_*_URL が無い(up を実行)"; ok=1; }
  return $ok
}

up() {
  local regions="${1:-${TC_OSRM_REGION:-kansai}}" r
  grep -qE '^APP_ENV=(production|staging)' "$ENV_FILE" 2>/dev/null && die "本番・staging では使いません"
  command -v docker >/dev/null || die "docker がありません"
  mkdir -p "$WORK"
  say "1: 地図データ(OpenStreetMap・Geofabrik)の取得: $regions → $WORK"
  local files=()
  IFS=',' read -r -a list <<<"$regions"
  for r in "${list[@]}"; do
    r="$(echo "$r" | tr -d ' ')"
    local url; url="$(url_of "$r")"
    # 同じ日に取ったものがあれば使い回す(-z: 手元より新しい時だけ取る)
    curl -fL --retry 3 -z "$WORK/$r.osm.pbf" -o "$WORK/$r.osm.pbf" "$url" || die "取得に失敗: $url"
    files+=("$r.osm.pbf")
  done
  if [ "${#files[@]}" -gt 1 ]; then
    say "   複数の地域をまとめる(osmium merge)"
    local inputs=() f
    for f in "${files[@]}"; do inputs+=("/w/$f"); done
    docker run --rm -v "$WORK:/w" "$OSMIUM_IMAGE" osmium merge --overwrite -o /w/region.osm.pbf "${inputs[@]}"
  else
    cp -f "$WORK/${files[0]}" "$WORK/region.osm.pbf"
  fi
  docker volume create "$VOLUME" >/dev/null
  say "2: 経路データを作る(車・歩き。時間がかかります)"
  "${DCO[@]}" stop osrm-car osrm-foot >/dev/null 2>&1 || true
  for p in car foot; do
    say "   - $p"
    docker run --rm -v "$WORK:/src:ro" -v "$VOLUME:/data" "$IMAGE" sh -c "
      set -e
      rm -rf /data/$p.new && mkdir -p /data/$p.new
      cp /src/region.osm.pbf /data/$p.new/region.osm.pbf
      osrm-extract -p /opt/$p.lua /data/$p.new/region.osm.pbf
      osrm-partition /data/$p.new/region.osrm
      osrm-customize /data/$p.new/region.osrm
      rm -f /data/$p.new/region.osm.pbf
      rm -rf /data/$p && mv /data/$p.new /data/$p
    " || die "$p の経路データを作れません(メモリ不足の時は小さい地域にする)"
  done
  say "3: 起動(osrm-car・osrm-foot)"
  "${DCO[@]}" up -d osrm-car osrm-foot
  say "4: .env に送り先を書く(OSRM_CAR_URL・OSRM_FOOT_URL の行だけ)→ backend を作り直す(DB・volume は触らない)"
  set_env OSRM_CAR_URL "http://osrm-car:5000"
  set_env OSRM_FOOT_URL "http://osrm-foot:5000"
  "${DC[@]}" up -d --no-deps --force-recreate backend
  local i
  for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8001/ready || true)" = 200 ] && break
    sleep 3
  done
  check
  say "完了: 地図の線は、車・歩きの区間が道に沿った線、電車・飛行機・船は直線の点線になります(画面を再読み込み)"
}

stop() {
  "${DCO[@]}" stop osrm-car osrm-foot
  say "止めました(.env の OSRM_*_URL は残しています。地図は直線の点線に戻ります)"
}

case "${1:-}" in
  up) shift; up "${1:-}" ;;
  check) check ;;
  stop) stop ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
