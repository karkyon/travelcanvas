#!/usr/bin/env bash
# [Gate ConsultAI] omega-dev2 での取り込み・反映(秘密の値は表示しない)。
#
#   TC_EXPECT_HEAD=<40桁> bash consultai_apply.sh push
#       1/3 push : 期待の SHA を持つ bundle を検証して gate/provider-connect へ fast-forward で push(済みなら飛ばす)
#       2/3 PR   : 統合の PR を作る(本文は期待の SHA の docs/trace/gate-consultai-trace.md。古い作業ツリーでも作れる)。
#                  既にあれば作らない。PR の head が期待の SHA と同じことを確かめてから、古い PR #43 を閉じる
#       3/3 CI   : workflow「CI」・期待の SHA・push の実行を待ち、成功を確かめる
#       4/4 PR の検査: PR 側の必須の検査(pull_request の CI 等)を待つ。失敗・flaky・未完了なら名前と URL を出して止める
#                  (push 側の CI が成功でも、PR 側の E2E が失敗していれば GitHub は merge を断る。PR #45 で起きた)
#       途中で止まっても、同じコマンドをもう一度実行すれば終わった段は飛ばして続きから進む
#
#   TC_EXPECT_HEAD=<40桁> bash consultai_apply.sh merge
#       統合の PR を squash で merge する(このリポジトリは merge commit を許さない。--merge は使わない)。
#       PR の head が期待の SHA・push の CI が success・PR の必須の検査が全て成功の時だけ。--match-head-commit で
#       別の commit を merge しない。GitHub が断った時は、断った理由(mergeStateStatus・レビュー)を出す。--admin は使わない。
#       済みなら飛ばし、main の merge commit の CI(push)を待って成功を確かめる
#
#   TC_EXPECT_HEAD=<40桁> bash consultai_apply.sh deploy
#       0 事前の確認(何も変えない): origin/main に期待の変更が入っているか(merge・squash のどちらでも)、
#         未追跡のファイルが新しいファイルとぶつからないか、.env の模擬の設定が無いか
#       1 記録: 元の branch・SHA・DB の revision・退避(stash)・バックアップの ID を ~/tc-artifacts/ に残す
#       2 退避・バックアップ → main を反映 → migrate の終了 0・DB の revision が head・health/ready 200・
#         画面(/・/trip-consult・/admin/ops)200・LAN の画面から API を呼べる(CORS)
#       失敗したら止まり、元の状態と戻し方を表示する(DB を勝手に戻さない)
#
# - git reset --hard / git clean / docker compose down -v / volume の削除はしない。強制 push はしない
# - .env へ API キーを足さない。ENCRYPTION_KEY は変えない
# - 別の Gate でも使える: TC_BRANCH・TC_TRACE(PR の本文)・TC_PR_TITLE・TC_BUNDLE_GLOB・TC_OLD_PR(空なら閉じない)
set -uo pipefail

REPO="${TC_REPO:-$HOME/projects/travelcanvas}"
BRANCH="${TC_BRANCH:-gate/provider-connect}"
OLD_PR="${TC_OLD_PR-43}"
BUNDLE_GLOB="${TC_BUNDLE_GLOB:-consultai_*.bundle}"
PR_TITLE="${TC_PR_TITLE:-Gate SecretPolicy・ProviderConnect・ConsultAI: 鍵の確認・旅行相談の AI と Google}"
EXPECT="${TC_EXPECT_HEAD:-}"
LAN_HOST="${TC_LAN_HOST:-192.168.1.11}"
API="${TC_API:-http://127.0.0.1:8001}"
WEB="${TC_WEB:-http://127.0.0.1:4173}"
ART="${TC_ARTIFACTS:-$HOME/tc-artifacts}"
TRACE="${TC_TRACE:-docs/trace/gate-consultai-trace.md}"

die() { echo "NG: $*" >&2; exit 1; }
step() { echo "== $*"; }
[ -n "$EXPECT" ] && [[ "$EXPECT" =~ ^[0-9a-f]{40}$ ]] || die "TC_EXPECT_HEAD に期待の SHA(40桁)を指定してください"
cd "$REPO" || die "リポジトリがありません: $REPO"
mkdir -p "$ART" && chmod 700 "$ART"

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" || echo 000; }

find_bundle() {
  # 期待の SHA を gate/provider-connect に持つ bundle だけを使う(新しさでは選ばない)
  local f tip
  for f in "$REPO"/$BUNDLE_GLOB "$HOME"/$BUNDLE_GLOB "$HOME"/Downloads/$BUNDLE_GLOB; do
    [ -f "$f" ] || continue
    git bundle verify "$f" >/dev/null 2>&1 || continue
    tip="$(git bundle list-heads "$f" "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}' | head -1)"
    [ "$tip" = "$EXPECT" ] && { echo "$f"; return 0; }
  done
  return 1
}

cmd_push() {
  git fetch -q origin || die "origin から取得できません"
  local remote
  remote="$(git rev-parse -q --verify "origin/$BRANCH" || true)"
  # ---- 1/3 push
  if [ "$remote" = "$EXPECT" ]; then
    step "1/3 push: 済み(origin/$BRANCH = ${EXPECT:0:7})"
  else
    local B
    B="$(find_bundle)" || die "1/3 push: ${EXPECT:0:7} を持つ $BUNDLE_GLOB がありません(travelcanvas・ホーム・Downloads を探しました)"
    git fetch -q "$B" "refs/heads/$BRANCH:refs/tmp/consultai" || die "1/3 push: bundle の基点がありません(git fetch origin の後でも足りない)"
    [ "$(git rev-parse refs/tmp/consultai)" = "$EXPECT" ] || { git update-ref -d refs/tmp/consultai; die "1/3 push: bundle の SHA が違います"; }
    if [ -n "$remote" ] && ! git merge-base --is-ancestor "$remote" "$EXPECT"; then
      git update-ref -d refs/tmp/consultai; die "1/3 push: origin/$BRANCH が先に進んでいます(fast-forward でない)。push しません"
    fi
    git push origin "refs/tmp/consultai:refs/heads/$BRANCH" || { git update-ref -d refs/tmp/consultai; die "1/3 push: push に失敗"; }
    git update-ref -d refs/tmp/consultai
    mv -n "$B" "$ART/" 2>/dev/null || true
    step "1/3 push: 完了 ${EXPECT:0:7}"
  fi
  # ---- 2/3 PR
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh が無いため、ここからは手で行ってください:"
    echo "  PR: https://github.com/karkyon/travelcanvas/compare/main...${BRANCH}?expand=1"
    echo "  CI: https://github.com/karkyon/travelcanvas/actions?query=branch%3A${BRANCH//\//%2F}"
    exit 2
  fi
  local pr head
  pr="$(gh pr list --head "$BRANCH" --state open --json number -q '.[0].number' 2>/dev/null || true)"
  if [ -z "$pr" ]; then
    local body
    body="$(mktemp)"
    git show "$EXPECT:$TRACE" > "$body" 2>/dev/null || die "2/3 PR: ${EXPECT:0:7} に $TRACE がありません"
    gh pr create --base main --head "$BRANCH" \
      --title "$PR_TITLE" --body-file "$body" \
      || { rm -f "$body"; die "2/3 PR: 作成に失敗(push は済み。もう一度このコマンドで続きから)"; }
    rm -f "$body"
    pr="$(gh pr list --head "$BRANCH" --state open --json number -q '.[0].number')"
  fi
  head="$(gh pr view "$pr" --json headRefOid -q .headRefOid)"
  [ "$head" = "$EXPECT" ] || die "2/3 PR: PR #$pr の head が ${head:0:7}(期待 ${EXPECT:0:7})"
  step "2/3 PR: #$pr(head ${EXPECT:0:7}・base main)"
  if [ -n "$OLD_PR" ] && [ "$(gh pr view "$OLD_PR" --json state -q .state 2>/dev/null || true)" = "OPEN" ] \
     && [ "$OLD_PR" != "$pr" ]; then
    gh pr close "$OLD_PR" --comment "PR #$pr に統合しました(同じ SecretPolicy の commit を含み、CI はそちらで確認します)" \
      && echo "   古い PR #$OLD_PR を閉じました"
  fi
  # ---- 3/3 CI(workflow CI・期待の SHA・push)
  local run="" i
  for i in $(seq 1 40); do
    run="$(gh run list --workflow CI --branch "$BRANCH" --event push --limit 20 --json databaseId,headSha \
          -q ".[] | select(.headSha == \"$EXPECT\") | .databaseId" 2>/dev/null | head -1)"
    [ -n "$run" ] && break
    sleep 15
  done
  [ -n "$run" ] || die "3/3 CI: ${EXPECT:0:7} の CI の実行が見つかりません(もう一度このコマンドで続きから)"
  gh run watch "$run" --exit-status >/dev/null || die "3/3 CI: 失敗(run $run)。merge・反映しないでください"
  step "3/3 CI: push の CI 成功(run $run)"
  # ---- 4/4 PR の必須の検査
  pr_checks_ok "$pr" || die "4/4 PR の検査: 上の検査が成功していません。merge・反映しないでください(re-run で緑にせず原因を直す)"
  step "4/4 PR の検査: 成功。次: TC_EXPECT_HEAD=$EXPECT bash $0 merge(squash で merge → main の CI)"
}

cmd_merge() {
  command -v gh >/dev/null 2>&1 || die "merge: gh がありません(GitHub の画面で Squash and merge してから deploy)"
  local pr state head c oid run i
  pr="$(gh pr list --head "$BRANCH" --state all --json number -q '.[0].number' 2>/dev/null || true)"
  [ -n "$pr" ] || die "merge: $BRANCH の PR がありません(先に push)"
  state="$(gh pr view "$pr" --json state -q .state 2>/dev/null || true)"
  if [ "$state" = "MERGED" ]; then
    step "merge: PR #$pr は merge 済み"
  else
    [ "$state" = "OPEN" ] || die "merge: PR #$pr が $state です"
    head="$(gh pr view "$pr" --json headRefOid -q .headRefOid)"
    [ "$head" = "$EXPECT" ] || die "merge: PR #$pr の head が ${head:0:7}(期待 ${EXPECT:0:7})。merge しません"
    c="$(gh run list --workflow CI --branch "$BRANCH" --event push --limit 20 --json headSha,conclusion \
        -q ".[] | select(.headSha == \"$EXPECT\") | .conclusion" 2>/dev/null | head -1)"
    [ "$c" = "success" ] || die "merge: ${EXPECT:0:7} の CI が success ではありません(${c:-未実行})。merge しません"
    pr_checks_ok "$pr" || die "merge: PR #$pr の検査が成功していません。merge しません"
    # このリポジトリは merge commit を許さない(--merge は失敗する)。squash で、期待の head の時だけ
    if ! gh pr merge "$pr" --squash --match-head-commit "$EXPECT"; then
      echo "   GitHub の判定: $(gh pr view "$pr" --json mergeStateStatus,reviewDecision,mergeable \
        -q '"状態 \(.mergeStateStatus)・レビュー \(.reviewDecision // "不要")・merge 可否 \(.mergeable)"' 2>/dev/null)" >&2
      die "merge: PR #$pr を merge できません(上の理由。--admin・保護の解除はしません)"
    fi
    step "merge: PR #$pr を squash で merge"
  fi
  oid="$(gh pr view "$pr" --json mergeCommit -q '.mergeCommit.oid // empty' 2>/dev/null || true)"
  [[ "$oid" =~ ^[0-9a-f]{40}$ ]] || die "merge: merge の commit を確かめられません"
  run=""
  for i in $(seq 1 60); do
    run="$(gh run list --workflow CI --branch main --event push --commit "$oid" --limit 1 --json databaseId \
          -q '.[0].databaseId // empty' 2>/dev/null || true)"
    [ -n "$run" ] && break
    sleep 10
  done
  [ -n "$run" ] || die "merge: main ${oid:0:7} の CI が見つかりません(反映しないでください。もう一度このコマンドで続きから)"
  gh run watch "$run" --exit-status >/dev/null || die "merge: main ${oid:0:7} の CI が失敗(run $run)。反映しないでください"
  step "merge: main ${oid:0:7} の CI 成功(run $run)。次: TC_EXPECT_HEAD=$EXPECT bash $0 deploy"
}

# [Gate MergeGate] PR の必須の検査を待つ(全て終わるまで)。成功なら 0、失敗・取り消し・無しなら理由を出して 1。
# 必須の検査が設定されていない時は、PR の全ての検査(飛ばしたものを除く)を必須として扱う
pr_checks_ok() {
  local pr="$1" i out pending failed scope="--required"
  for i in $(seq 1 "${TC_CHECK_WAIT:-180}"); do
    out="$(gh pr checks "$pr" $scope --json name,state,bucket,link 2>/dev/null || true)"
    if [ -z "$out" ] || [ "$out" = "[]" ]; then
      if [ "$scope" = "--required" ]; then scope=""; continue; fi
      echo "   PR #$pr の検査がまだありません(待っています)"; sleep "${TC_CHECK_INTERVAL:-20}"; continue
    fi
    failed="$(printf '%s' "$out" | python3 -c 'import json,sys
d=json.load(sys.stdin)
print("\n".join("%s: %s %s" % (c.get("name"), c.get("state"), c.get("link") or "") for c in d if c.get("bucket") in ("fail", "cancel")))')"
    if [ -n "$failed" ]; then
      echo "NG: PR #$pr の検査が失敗しています(flaky も失敗として扱います):" >&2
      echo "$failed" | sed 's/^/     /' >&2
      return 1
    fi
    pending="$(printf '%s' "$out" | python3 -c 'import json,sys
print(sum(1 for c in json.load(sys.stdin) if c.get("bucket") == "pending"))')"
    if [ "$pending" = "0" ]; then
      echo "   PR #$pr の検査: 全て成功($(printf '%s' "$out" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') 件${scope:+・必須})"
      return 0
    fi
    sleep "${TC_CHECK_INTERVAL:-20}"
  done
  echo "NG: PR #$pr の検査が時間内に終わりません" >&2
  return 1
}

env_true() {  # .env の最後の値を真偽として読む(1/true/yes/on)
  local v
  v="$(grep -E "^[[:space:]]*$1[[:space:]]*=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r' | tr 'A-Z' 'a-z')"
  case "$v" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac
}

cmd_deploy() {
  local TS STATE
  TS="$(date +%Y%m%d-%H%M%S)"
  STATE="$ART/deploy-$TS.state"
  # ---- 0 事前の確認(何も変えない)
  git fetch -q origin || die "0: origin から取得できません"
  git cat-file -e "$EXPECT^{commit}" 2>/dev/null || die "0: ${EXPECT:0:7} の commit がありません(origin/$BRANCH を消していないか確かめる)"
  local TARGET
  TARGET="$(git rev-parse origin/main)"
  if git merge-base --is-ancestor "$EXPECT" "$TARGET"; then
    echo "0: origin/main ${TARGET:0:7} は ${EXPECT:0:7} を含む(merge)"
  elif files="$(git diff --name-only "$(git merge-base "$EXPECT" "$TARGET")" "$EXPECT")" && [ -n "$files" ] \
       && git diff --quiet "$EXPECT" "$TARGET" -- $files; then
    # squash・rebase: 期待の branch が変えた全てのファイルが、main で同じ内容になっている
    echo "0: origin/main ${TARGET:0:7} は ${EXPECT:0:7} の変更を全て同じ内容で含む(squash・rebase)"
  else
    die "0: origin/main に ${EXPECT:0:7} の変更が入っていません。PR を merge してから(何も変えていません)"
  fi
  if command -v gh >/dev/null 2>&1; then
    local c
    c="$(gh run list --workflow CI --branch main --limit 20 --json headSha,conclusion \
        -q ".[] | select(.headSha == \"$TARGET\") | .conclusion" 2>/dev/null | head -1)"
    [ -z "$c" ] || [ "$c" = "success" ] || die "0: main ${TARGET:0:7} の CI が $c(何も変えていません)"
  fi
  local clash
  clash="$(comm -12 <(git ls-files --others --exclude-standard | sort) <(git ls-tree -r --name-only "$TARGET" | sort))"
  [ -z "$clash" ] || die "0: 未追跡のファイルが main の新しいファイルとぶつかります(上書きしません): $(echo "$clash" | tr '\n' ' ')"
  env_true PROVIDER_HTTP_STUB && die "0: .env の PROVIDER_HTTP_STUB が真です(CI だけの模擬)。外してから(何も変えていません)"
  [ -n "$(git ls-tree "$TARGET" scripts/ops/tcops.py)" ] || die "0: main に scripts/ops/tcops.py がありません"
  # ---- 1 記録
  local PREV PREV_BRANCH DBREV
  PREV="$(git rev-parse HEAD)"
  PREV_BRANCH="$(git symbolic-ref -q --short HEAD || echo "(detached)")"
  DBREV="$(docker compose exec -T backend alembic current 2>/dev/null | awk '{print $1}' | tail -1)"
  { echo "prev_sha=$PREV"; echo "prev_branch=$PREV_BRANCH"; echo "prev_db_revision=${DBREV:-unknown}";
    echo "target_sha=$TARGET"; echo "expect_sha=$EXPECT"; } > "$STATE"
  chmod 600 "$STATE"
  echo "1: 元の状態を記録: $STATE(branch $PREV_BRANCH・${PREV:0:7}・DB ${DBREV:-unknown})"
  # [Gate SearchUAT] コンテナを作り直すと前のログが消えるため、外部の検索の失敗の記録(型・分類だけ)を先に残す
  docker compose logs --since 72h --no-color backend 2>/dev/null \
    | grep -o 'Overpass search failed (query length [0-9]*): .*' | sed -E 's/\(query length [0-9]*\): //' \
    | sort | uniq -c | sort -rn > "$ART/predeploy-search-log-$TS.txt" 2>/dev/null || true
  echo "1: 反映前の場所の検索の失敗の記録: $ART/predeploy-search-log-$TS.txt($(wc -l < "$ART/predeploy-search-log-$TS.txt" 2>/dev/null || echo 0) 種類)"
  # ---- 2 退避・設定・バックアップ
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git diff HEAD --binary > "$ART/predeploy-$TS.patch"; chmod 600 "$ART/predeploy-$TS.patch"
    git stash push -m "consultai deploy 前の退避 $TS" >/dev/null || die "2: 退避に失敗(何も変えていません)"
    echo "stash=$(git rev-parse -q --verify refs/stash)" >> "$STATE"
    echo "2: 追跡ファイルの変更を退避(git stash・$ART/predeploy-$TS.patch)"
  fi
  if ! grep -qE '^[[:space:]]*SECRET_BACKEND[[:space:]]*=' .env; then
    printf '\nSECRET_BACKEND=db_encrypted\n' >> .env   # 非秘密の 1 行(暫定の DB 暗号化の保管先を明示)
    echo "2: .env に SECRET_BACKEND=db_encrypted を足しました"
  fi
  local BK
  BK="$(python3 scripts/ops/tcops.py backup 2>&1 | tee /dev/stderr | grep -oE 'tc-[0-9]{8}T[0-9]{6}Z' | tail -1)"
  [ -n "$BK" ] || die "2: バックアップの ID が取れません(反映していません。$STATE)"
  python3 scripts/ops/tcops.py verify "$BK" || die "2: バックアップ $BK の検証に失敗(反映していません)"
  echo "backup=$BK" >> "$STATE"
  # ---- 3 反映
  git checkout -q main && git merge -q --ff-only "$TARGET" || die "3: main を ${TARGET:0:7} にできません(main がずれている)。$STATE"
  echo "3: main ${TARGET:0:7} を反映。コンテナを作り直します"
  docker compose up -d --build || fail_after "docker compose up に失敗"
  local MID MEXIT
  MID="$(docker compose ps -aq migrate | head -1)"
  MEXIT="$(docker inspect -f '{{.State.ExitCode}}' "$MID" 2>/dev/null || echo 1)"
  [ "$MEXIT" = "0" ] || fail_after "migrate の終了 $MEXIT(docker compose logs migrate)"
  local CUR HEADS
  CUR="$(docker compose exec -T backend alembic current 2>/dev/null | awk '{print $1}' | tail -1)"
  HEADS="$(docker compose exec -T backend alembic heads 2>/dev/null | awk '{print $1}' | tail -1)"
  [ -n "$CUR" ] && [ "$CUR" = "$HEADS" ] || fail_after "DB の revision $CUR が head $HEADS と違う"
  echo "3: DB revision $CUR(head)"
  local code i
  for i in $(seq 1 "${TC_READY_WAIT:-30}"); do [ "$(http_code "$API/ready")" = "200" ] && break; sleep 4; done
  for u in "$API/health" "$API/ready" "$WEB/" "$WEB/trip-consult" "$WEB/admin/ops"; do
    code="$(http_code "$u")"
    [ "$code" = "200" ] || fail_after "$u が HTTP $code"
    echo "3: $u 200"
  done
  local acao
  acao="$(curl -s -o /dev/null -D - --max-time 10 -X OPTIONS -H "Origin: http://$LAN_HOST:4173" \
          -H 'Access-Control-Request-Method: GET' "$API/api/v1/trip-intents/ai/status" | tr -d '\r' \
          | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
  [ "$acao" = "http://$LAN_HOST:4173" ] || fail_after "LAN の画面(http://$LAN_HOST:4173)から API を呼べません(CORS)。.env の TC_PUBLIC_HOSTS に $LAN_HOST を入れて backend を再起動"
  echo "3: LAN の画面から API を呼べる(CORS http://$LAN_HOST:4173)"
  echo "OK: main ${TARGET:0:7} を反映(DB $CUR・バックアップ $BK・記録 $STATE)"
  echo "    旅行相談: http://$LAN_HOST:4173/trip-consult   運用: http://$LAN_HOST:4173/admin/ops"
  echo "    次: /admin/ops の概要「旅行相談の UAT の準備」を確かめる(鍵が確認済みで期限内なら確認し直さない。再入力は不要)"
  if [ -f scripts/ops/search_diag.sh ]; then
    echo "4: 場所の検索(OpenStreetMap)の診断(外への要求 6 回。反映の成否とは別の結果)"
    bash scripts/ops/search_diag.sh || echo "4: 場所の検索の診断に NG があります(上の結果。反映は済んでいます)"
  fi
  echo "    音声の UAT: bash scripts/ops/uat_https.sh up → https://$LAN_HOST:4443/trip-consult(docs/runbooks/consult-uat-omega-dev2.md)"
}

fail_after() {
  echo "NG: $*" >&2
  echo "反映を止めました。元の状態: $(tr '\n' ' ' < "$STATE" 2>/dev/null)" >&2
  echo "戻し方(DB は自動で戻しません。新しいデータを失わないため):" >&2
  echo "  - 原因を直して前へ進める(推奨): 直した main で docker compose up -d --build" >&2
  echo "  - コードだけ戻す: DB の revision が変わっていなければ git checkout <prev_sha> && docker compose up -d --build" >&2
  echo "  - DB も戻す: 元のコードで python3 scripts/ops/tcops.py restore <backup>(その後のデータは消えます)" >&2
  echo "  - 退避した変更: git stash list で確かめて git stash pop" >&2
  exit 1
}

case "${1:-}" in
  push) cmd_push ;;
  merge) cmd_merge ;;
  deploy) cmd_deploy ;;
  *) echo "使い方: TC_EXPECT_HEAD=<SHA> bash $0 push | merge | deploy"; exit 2 ;;
esac
