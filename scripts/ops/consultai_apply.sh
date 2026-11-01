#!/usr/bin/env bash
# [Gate ConsultAI] omega-dev2 での取り込み・反映(秘密の値は表示しない)。
#
#   bash consultai_apply.sh push     bundle を検証して gate/provider-connect へ push(fast-forward だけ)し、CI を待つ
#   bash consultai_apply.sh deploy   main へ merge した後: 変更の退避 → バックアップ → main を反映 → migration・health・ready を確認
#   (このファイルと bundle は travelcanvas のフォルダー・ホーム・~/Downloads のどこに置いてもよい)
#
# - git reset --hard / git clean / docker compose down -v は使わない
# - 追跡しているファイルの変更は消さずに退避する(~/tc-artifacts/ へ差分を保存し、git stash にも残す)。未追跡のファイルはそのまま
# - 強制 push はしない(fast-forward でなければ止まる)
set -euo pipefail

REPO="${TC_REPO:-$HOME/projects/travelcanvas}"
BRANCH="gate/provider-connect"
EXPECT_HEAD="${TC_EXPECT_HEAD:-}"
cd "$REPO"

find_bundle() {
  # 一番新しい consultai_*.bundle(古いものが残っていても新しい方を使う)
  local f
  f="$(ls -t "$REPO"/consultai_*.bundle "$HOME"/consultai_*.bundle "$HOME"/Downloads/consultai_*.bundle 2>/dev/null | head -1)"
  [ -n "$f" ] && [ -f "$f" ] && { echo "$f"; return 0; }
  return 1
}

case "${1:-}" in
  push)
    B="$(find_bundle)" || { echo "ERROR: consultai_*.bundle が見つかりません(travelcanvas フォルダーか ~/Downloads に置く)"; exit 1; }
    git fetch origin
    git bundle verify "$B" >/dev/null
    git fetch "$B" "refs/heads/$BRANCH:refs/tmp/consultai"
    NEW="$(git rev-parse refs/tmp/consultai)"
    if [ -n "$EXPECT_HEAD" ] && [ "$NEW" != "$EXPECT_HEAD" ]; then echo "ERROR: bundle の SHA が違います($NEW)"; exit 1; fi
    git merge-base --is-ancestor "origin/$BRANCH" "$NEW" || { echo "ERROR: origin/$BRANCH が先に進んでいます(fast-forward でない)"; exit 1; }
    git push origin "refs/tmp/consultai:refs/heads/$BRANCH"
    git update-ref -d refs/tmp/consultai
    mkdir -p "$HOME/tc-artifacts" && mv -n "$B" "$HOME/tc-artifacts/"
    echo "OK: push 完了 $NEW"
    if command -v gh >/dev/null 2>&1; then
      gh pr view "$BRANCH" --json url,state -q '.url + " " + .state' 2>/dev/null \
        || gh pr create --base main --head "$BRANCH" --title "Gate SecretPolicy・ProviderConnect・ConsultAI: 鍵の確認・旅行相談の AI と Google" \
             --body-file docs/trace/gate-consultai-trace.md
      # SecretPolicy の PR #43 は同じ commit を含むこの PR に統合する(二重の PR を残さない)
      if [ "$(gh pr view 43 --json state -q .state 2>/dev/null || true)" = "OPEN" ]; then
        gh pr close 43 --comment "gate/provider-connect の PR に統合しました(SecretPolicy の commit を含み、CI はそちらで確認します)"
      fi
      sleep 15
      RUN="$(gh run list --branch "$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId')"
      gh run watch "$RUN" --exit-status && echo "OK: CI 成功(run $RUN)。PR を main へ merge してから: bash $0 deploy" \
        || { echo "NG: CI 失敗(run $RUN)。反映しないでください"; exit 1; }
    else
      echo "CI: https://github.com/karkyon/travelcanvas/actions?query=branch%3A${BRANCH//\//%2F}"
      echo "PR: https://github.com/karkyon/travelcanvas/compare/main...${BRANCH}?expand=1"
    fi
    ;;
  deploy)
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      TS="$(date +%Y%m%d-%H%M%S)"
      mkdir -p "$HOME/tc-artifacts"
      git diff HEAD > "$HOME/tc-artifacts/predeploy-$TS.patch"
      git stash push -m "consultai deploy 前の退避 $TS" >/dev/null
      echo "INFO: 追跡ファイルの変更を退避しました(~/tc-artifacts/predeploy-$TS.patch と git stash)。戻す時は git stash pop"
    fi
    grep -q '^PROVIDER_HTTP_STUB=' .env && { echo "ERROR: .env に PROVIDER_HTTP_STUB があります(CI だけの模擬)。外してから"; exit 1; } || true
    if ! grep -q '^SECRET_BACKEND=' .env; then
      # 非秘密の 1 行(暫定の DB 暗号化の保管先を明示する。無いと鍵を取得も送信もしない)
      printf '\nSECRET_BACKEND=db_encrypted\n' >> .env
      echo "INFO: .env に SECRET_BACKEND=db_encrypted を足しました"
    fi
    PREV="$(git rev-parse HEAD)"
    echo "反映前: $PREV"
    python3 scripts/ops/tcops.py backup
    python3 scripts/ops/tcops.py verify --latest
    git fetch origin && git checkout main && git pull --ff-only
    git merge-base --is-ancestor "origin/$BRANCH" HEAD || { echo "ERROR: main に $BRANCH が入っていません(PR を merge してから)"; git checkout "$PREV"; exit 1; }
    docker compose up -d --build
    docker compose ps -a
    docker compose exec -T backend alembic current
    for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8001/ready >/dev/null 2>&1 && break; sleep 4; done
    curl -fsS http://127.0.0.1:8001/health; echo
    curl -fsS http://127.0.0.1:8001/ready || { echo; echo "NG: ready が 200 でない。受入を始めない(docker compose logs migrate backend を確認)"; exit 1; }
    echo
    curl -sS -o /dev/null -w 'frontend_http=%{http_code}\n' http://127.0.0.1:4173/
    echo "OK: main $(git rev-parse --short HEAD) を反映。旅行相談: http://192.168.1.11:4173/trip-consult  運用: http://192.168.1.11:4173/admin/ops"
    echo "巻き戻し: docker compose run --rm migrate alembic downgrade b7e3c9d1f5a2 && git checkout $PREV && docker compose up -d --build"
    ;;
  *)
    echo "使い方: bash $0 push | deploy"; exit 2 ;;
esac
