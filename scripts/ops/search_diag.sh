#!/usr/bin/env bash
# [Gate SearchUAT] 旅行相談の「候補を探す」(OpenStreetMap)の失敗の調査。omega-dev2 で実行する(何も変えない)。
#
#   bash scripts/ops/search_diag.sh             # 標準: DNS・server の状態の照会(外へ 1 回)・待機・利用の記録・ログ
#   bash scripts/ops/search_diag.sh --probe     # + アプリと同じ要求で伊勢 10km の 観光・食べ物・市場(外へ最大 3 回)
#   bash scripts/ops/search_diag.sh --compare   # + User-Agent の条件の比較(外へ最大 3 回・送った header を記録)
#
# [Gate SearchUAT-S3] 以前は毎回 6 回送り、毎回 User-Agent の無い要求で 406 を受けていた。標準は外へ 1 回(検索ではない
# 状態の照会)だけにした。--probe・--compare は明示した時だけ(429・406 の後は送らない)。
# ログの出どころを分ける: (a) 反映の前に退避したログ(TC_PREDEPLOY_LOG、無ければ ~/tc-artifacts の最新)、
# (b) 今の backend コンテナのログ(作成の時刻を示す。作り直した直後は空で、それは「失敗なし」ではない)。
# 結果は ~/tc-artifacts/search-diag-<日時>.txt にも残す。鍵・.env の値は読まない。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ART="${TC_ARTIFACTS:-$HOME/tc-artifacts}"
mkdir -p "$ART"
OUT="$ART/search-diag-$(date +%Y%m%d-%H%M%S).txt"
ARGS=()
for a in "$@"; do
  case "$a" in
    --probe|--compare|--json) ARGS+=("$a") ;;
    *) echo "使い方: bash $0 [--probe] [--compare] [--json]" >&2; exit 2 ;;
  esac
done
PRE="${TC_PREDEPLOY_LOG:-$(ls -1t "$ART"/predeploy-search-log-*.txt 2>/dev/null | head -1)}"
{
  echo "== 1. backend コンテナからの確認(app.ops.search_diag ${ARGS[*]:-標準})"
  docker compose exec -T backend python -m app.ops.search_diag "${ARGS[@]}"
  rc=$?
  echo "== 2a. 反映の前に退避したログの Overpass の失敗(出どころ: ${PRE:-なし})"
  if [ -n "$PRE" ] && [ -f "$PRE" ]; then
    if [ -s "$PRE" ]; then cat "$PRE"; else echo "(退避したログに失敗の記録はありません)"; fi
  else
    echo "(退避したログがありません: 反映の前のログは確かめられない)"
  fi
  STARTED="$(docker inspect -f '{{.State.StartedAt}}' "$(docker compose ps -q backend 2>/dev/null | head -1)" 2>/dev/null || echo 不明)"
  echo "== 2b. 今の backend コンテナのログ(作成 $STARTED 以降・最大 72 時間)の Overpass の失敗"
  LOGS="$(docker compose logs --since 72h --no-color backend 2>/dev/null \
    | grep -o 'Overpass search failed (query length [0-9]*): .*' \
    | sed -E 's/\(query length [0-9]*\): //' | sort | uniq -c | sort -rn | head -20)"
  if [ -n "$LOGS" ]; then echo "$LOGS"; else
    echo "(このコンテナのログに失敗の記録はありません。コンテナを作り直した直後なら、まだ検索していないだけです)"
  fi
  exit $rc
} 2>&1 | tee "$OUT"
rc=${PIPESTATUS[0]}
echo "記録: $OUT"
exit "$rc"
