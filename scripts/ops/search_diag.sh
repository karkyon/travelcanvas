#!/usr/bin/env bash
# [Gate SearchUAT] 旅行相談の「候補を探す」(OpenStreetMap)の失敗の調査。omega-dev2 で実行する(何も変えない)。
#
#   bash scripts/ops/search_diag.sh
#
# 1. backend コンテナの中から、アプリと同じ要求で伊勢の周りを探し、同じ本文で User-Agent だけを変えた比較をする
#    (app.ops.search_diag。外への要求は 6 回。原因は比較・反映前のログ・画面の検索の結果を合わせて判断する)
# 2. backend のログ(直近 72 時間)の「Overpass search failed」を、例外の型・分類・HTTP の状態ごとに数える
#    (ログに検索語・座標は出していない)
# 結果は ~/tc-artifacts/search-diag-<日時>.txt にも残す。鍵・.env の値は読まない。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ART="${TC_ARTIFACTS:-$HOME/tc-artifacts}"
mkdir -p "$ART"
OUT="$ART/search-diag-$(date +%Y%m%d-%H%M%S).txt"
{
  echo "== 1. backend コンテナからの検索(アプリと同じ要求)"
  docker compose exec -T backend python -m app.ops.search_diag
  rc=$?
  echo "== 2. backend のログ(直近 72 時間)の Overpass の失敗"
  docker compose logs --since 72h --no-color backend 2>/dev/null \
    | grep -o 'Overpass search failed (query length [0-9]*): .*' \
    | sed -E 's/\(query length [0-9]*\): //' | sort | uniq -c | sort -rn | head -20
  echo "(上が空なら、直近 72 時間に失敗の記録はありません)"
  exit $rc
} 2>&1 | tee "$OUT"
rc=${PIPESTATUS[0]}
echo "記録: $OUT"
exit "$rc"
