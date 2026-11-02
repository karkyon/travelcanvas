#!/usr/bin/env bash
# [Gate HomeHeroVideo] 社内 UAT の見た目の確認だけに、HOME の表紙の背景の動画を omega-dev2 の手元へ置く。
#
#   bash scripts/ops/install_hero_local.sh <hero-local-*.tar.gz>
#
#   1 束(tar.gz)の中身を確かめる: hero/local/ の mp4・jpg と heroVideos.local.json だけ(他のファイル・絶対パス・.. は断る)
#   2 frontend/public/hero/local/ と frontend/src/config/heroVideos.local.json へ置く
#   3 置いた物が git の対象外(.gitignore)であることを確かめる(公開リポジトリに入れない。対象なら消して止める)
#   4 画面だけを作り直す: docker compose up -d --build frontend → /hero/local/<最初の動画> が 200・video/mp4
#
# - 素材は透かし入りのプレビュー等。**社内 UAT の見た目の確認だけ**。本番の前に利用権のある版へ差し替える
#   (docs/ux/home-hero-video-assets.md の台帳)。git add しない・commit しない
# - 外す時: rm -rf frontend/public/hero/local frontend/src/config/heroVideos.local.json && docker compose up -d --build frontend
#   (以前の山並みの絵に戻る)
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
BUNDLE="${1:-}"
[ -n "$BUNDLE" ] && [ -f "$BUNDLE" ] || die "束(tar.gz)のパスを指定してください"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "travelcanvas の作業ツリーの中で実行してください"
cd "$ROOT"
[ -f docker-compose.yml ] && [ -d frontend ] || die "travelcanvas の作業ツリーではありません: $ROOT"

echo "1/4 束の中身を確かめる"
LIST="$(tar -tzf "$BUNDLE")" || die "tar.gz を読めません"
while IFS= read -r f; do
  case "$f" in
    ./) ;;
    hero/ | hero/local/ | ./hero/ | ./hero/local/) ;;
    heroVideos.local.json | ./heroVideos.local.json) ;;
    hero/local/*.mp4 | hero/local/*.jpg | ./hero/local/*.mp4 | ./hero/local/*.jpg)
      case "$f" in *..* | */*/*/*) die "想定外のパス: $f" ;; esac ;;
    *) die "想定外のファイル: $f" ;;
  esac
done <<< "$LIST"
grep -qE '(^|/)heroVideos\.local\.json$' <<< "$LIST" || die "heroVideos.local.json がありません"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$BUNDLE" -C "$TMP" --no-same-owner --no-same-permissions
python3 - "$TMP/heroVideos.local.json" "$TMP" <<'PY' || die "heroVideos.local.json の中身が正しくありません"
import json, os, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
scenes = data.get("scenes")
assert isinstance(scenes, list) and 1 <= len(scenes) <= 4, "scenes は 1〜4 件"
for s in scenes:
    paths = [s["poster"]] + [x["src"] for x in s["sources"]]
    for p in paths:
        assert p.startswith("/hero/local/") and ".." not in p, p
        assert os.path.isfile(os.path.join(sys.argv[2], p.lstrip("/"))), f"束に無い: {p}"
print(f"  場面 {len(scenes)} 件: " + "・".join(s["label"] for s in scenes))
PY

echo "2/4 置く"
mkdir -p frontend/public/hero/local
cp -f "$TMP"/hero/local/*.mp4 "$TMP"/hero/local/*.jpg frontend/public/hero/local/
cp -f "$TMP/heroVideos.local.json" frontend/src/config/heroVideos.local.json

echo "3/4 git の対象外であることを確かめる"
for p in frontend/public/hero/local/* frontend/src/config/heroVideos.local.json; do
  if ! git check-ignore -q "$p"; then
    rm -rf frontend/public/hero/local frontend/src/config/heroVideos.local.json
    die "$p が .gitignore の対象外です(main の .gitignore が古い)。置いた物を消しました。main を反映してからやり直してください"
  fi
done
[ -z "$(git status --porcelain -- frontend/public/hero frontend/src/config/heroVideos.local.json)" ] \
  || die "git status に出ています。commit しないでください"

echo "4/4 画面だけを作り直す"
docker compose up -d --build frontend
FIRST="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["scenes"][0]["sources"][0]["src"])' \
  frontend/src/config/heroVideos.local.json)"
PORT="${TC_FRONTEND_PORT:-4173}"
for i in $(seq 1 30); do
  CT="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "http://127.0.0.1:${PORT}${FIRST}" || true)"
  case "$CT" in "200 video/mp4"*) break ;; esac
  sleep 2
done
case "$CT" in
  "200 video/mp4"*) echo "OK: ${FIRST} → ${CT}。HOME(下書きが無い時の「最初の旅行を始めましょう」)で 7 秒ごとに切り替わります" ;;
  *) die "${FIRST} が ${CT:-応答なし}(docker compose logs frontend)" ;;
esac
echo "注意: 社内 UAT の見た目の確認だけ。本番の前に利用権のある版へ差し替える(docs/ux/home-hero-video-assets.md)"
