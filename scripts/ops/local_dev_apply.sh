#!/usr/bin/env bash
# [Local Dev] omega-dev2 (192.168.1.11) に開発の branch をそのまま反映する(PR・CI・main を通さない一時の運用)。
#
#   cd ~/projects/travelcanvas && git fetch origin dev/plan-b && bash <(git show origin/dev/plan-b:scripts/ops/local_dev_apply.sh)
#   (2 回目からは: bash scripts/ops/local_dev_apply.sh)
#
#   1 確認: origin/$BRANCH を取得。手元の $BRANCH が origin より先に進んでいたら止める(手元の commit を消さない)
#   2 記録・退避・バックアップ: 元の branch・SHA・DB の revision を ~/tc-artifacts/ に。追跡ファイルの変更は git stash。
#     tcops.py backup → verify(バックアップが取れなければ反映しない)
#   3 反映: $BRANCH を origin に合わせて checkout。Dockerfile の FROM の image を先に取得(Docker Hub が詰まる時に
#     時間を区切って再試行。手元に image があれば続ける)→ docker compose up -d --build
#   4 確認: migrate の終了 0・DB の revision が head・/health・/ready・画面 200・LAN の画面から API を呼べる(CORS)
#
# - git reset --hard / git clean / docker compose down -v / volume の削除はしない。.env の鍵は触らない
# - 失敗したら止まり、元の状態と戻し方を表示する(DB を勝手に戻さない)
# - 変数: TC_BRANCH(既定 dev/plan-b)・TC_REPO・TC_LAN_HOST・TC_PULL_TRIES・TC_PULL_TIMEOUT・TC_SKIP_BACKUP=1(非推奨)
set -uo pipefail

REPO="${TC_REPO:-$HOME/projects/travelcanvas}"
BRANCH="${TC_BRANCH:-dev/plan-b}"
LAN_HOST="${TC_LAN_HOST:-192.168.1.11}"
API="${TC_API:-http://127.0.0.1:8001}"
WEB="${TC_WEB:-http://127.0.0.1:4173}"
ART="${TC_ARTIFACTS:-$HOME/tc-artifacts}"
PULL_TRIES="${TC_PULL_TRIES:-3}"
PULL_TIMEOUT="${TC_PULL_TIMEOUT:-240}"

die() { echo "NG: $*" >&2; exit 1; }
step() { echo "== $*"; }
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" || echo 000; }

cd "$REPO" || die "リポジトリがありません: $REPO"
mkdir -p "$ART" && chmod 700 "$ART"
TS="$(date +%Y%m%d-%H%M%S)"
STATE="$ART/localdev-$TS.state"

fail_after() {
  echo "NG: $*" >&2
  echo "反映を止めました。元の状態: $(tr '\n' ' ' < "$STATE" 2>/dev/null)" >&2
  echo "戻し方(DB は自動で戻しません):" >&2
  echo "  - 原因を直して前へ進める(推奨): 直した $BRANCH で docker compose up -d --build" >&2
  echo "  - コードを元へ: git checkout <prev_branch> && docker compose up -d --build" >&2
  echo "    (DB の revision が進んでいる時は、新しいコードのまま docker compose exec backend alembic downgrade <prev_db_revision>)" >&2
  echo "  - DB も戻す: python3 scripts/ops/tcops.py restore <backup>(その後のデータは消えます)" >&2
  echo "  - 退避した変更: git stash list で確かめて git stash pop" >&2
  exit 1
}

# ---- 1 確認
step "1 確認: origin/$BRANCH を取得"
git fetch -q origin "$BRANCH" || die "1: origin/$BRANCH を取得できません(GitHub への接続・branch 名)"
TARGET="$(git rev-parse "origin/$BRANCH")"
if git rev-parse -q --verify "refs/heads/$BRANCH" >/dev/null; then
  LOCAL="$(git rev-parse "refs/heads/$BRANCH")"
  git merge-base --is-ancestor "$LOCAL" "$TARGET" \
    || die "1: 手元の $BRANCH (${LOCAL:0:7}) に origin に無い commit があります。消さないため止めます(git log origin/$BRANCH..$BRANCH)"
fi
echo "1: 反映する ${TARGET:0:7} $(git log -1 --format=%s "$TARGET")"
clash="$(comm -12 <(git ls-files --others --exclude-standard | sort) <(git ls-tree -r --name-only "$TARGET" | sort))"
[ -z "$clash" ] || die "1: 未追跡のファイルが新しいファイルとぶつかります(上書きしません): $(echo "$clash" | tr '\n' ' ')"

# ---- 2 記録・退避・バックアップ
PREV="$(git rev-parse HEAD)"
PREV_BRANCH="$(git symbolic-ref -q --short HEAD || echo "(detached)")"
DBREV="$(docker compose exec -T backend alembic current 2>/dev/null | awk '{print $1}' | tail -1)"
{ echo "prev_sha=$PREV"; echo "prev_branch=$PREV_BRANCH"; echo "prev_db_revision=${DBREV:-unknown}";
  echo "target_branch=$BRANCH"; echo "target_sha=$TARGET"; } > "$STATE"
chmod 600 "$STATE"
echo "2: 元の状態を記録: $STATE(branch $PREV_BRANCH・${PREV:0:7}・DB ${DBREV:-unknown})"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git diff HEAD --binary > "$ART/localdev-$TS.patch"; chmod 600 "$ART/localdev-$TS.patch"
  git stash push -m "local dev 反映前の退避 $TS" >/dev/null || die "2: 退避に失敗(何も変えていません)"
  echo "stash=$(git rev-parse -q --verify refs/stash)" >> "$STATE"
  echo "2: 追跡ファイルの変更を退避(git stash・$ART/localdev-$TS.patch)"
fi
if [ "${TC_SKIP_BACKUP:-0}" = "1" ]; then
  echo "2: バックアップを飛ばしました(TC_SKIP_BACKUP=1)"
else
  BK="$(python3 scripts/ops/tcops.py backup 2>&1 | tee /dev/stderr | grep -oE 'tc-[0-9]{8}T[0-9]{6}Z' | tail -1)"
  [ -n "$BK" ] || die "2: バックアップの ID が取れません(反映していません。$STATE)"
  python3 scripts/ops/tcops.py verify "$BK" || die "2: バックアップ $BK の検証に失敗(反映していません)"
  echo "backup=$BK" >> "$STATE"
  echo "2: バックアップ $BK"
fi

# ---- 3 反映
git checkout -q -B "$BRANCH" "$TARGET" || fail_after "3: $BRANCH を ${TARGET:0:7} にできません"
git branch -q --set-upstream-to="origin/$BRANCH" "$BRANCH" 2>/dev/null || true
echo "3: $BRANCH ${TARGET:0:7} を checkout"
# Docker Hub の取得が止まる時のため、FROM の image を時間を区切って先に取る(手元にあれば失敗しても続ける)
DFILES="$(git ls-files | grep -E '(^|/)Dockerfile[^/]*$')"
# FROM の image(多段の build の段の名前「FROM … AS 名前」と、ARG の変数は除く)
STAGES="$(grep -hiE '^FROM[[:space:]]' $DFILES 2>/dev/null | awk 'tolower($3)=="as"{print $4}' | sort -u)"
for img in $(grep -hiE '^FROM[[:space:]]' $DFILES 2>/dev/null | awk '{print $2}' | grep -v '^\$' | sort -u \
             | grep -vxF -f <(echo "$STAGES"; echo "scratch")); do
  ok=0
  for i in $(seq 1 "$PULL_TRIES"); do
    if timeout "$PULL_TIMEOUT" docker pull -q "$img" >/dev/null 2>&1; then ok=1; break; fi
    echo "3: $img の取得に失敗($i/$PULL_TRIES)。再試行します"
    sleep 5
  done
  if [ "$ok" = 1 ]; then echo "3: image $img を取得"
  elif docker image inspect "$img" >/dev/null 2>&1; then echo "3: $img は取れませんでしたが手元にあるので続けます"
  else fail_after "3: base image $img を取れません(Docker Hub。時間をおいて同じコマンドで続きから)"
  fi
done
echo "3: コンテナを作り直します"
timeout "${TC_BUILD_TIMEOUT:-2400}" docker compose up -d --build || fail_after "docker compose up に失敗"
MID="$(docker compose ps -aq migrate | head -1)"
for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Status}}' "$MID" 2>/dev/null)" = "exited" ] && break; sleep 3
done
MEXIT="$(docker inspect -f '{{.State.ExitCode}}' "$MID" 2>/dev/null || echo 1)"
[ "$MEXIT" = "0" ] || fail_after "migrate の終了 $MEXIT(docker compose logs migrate)"

# ---- 4 確認
CUR="$(docker compose exec -T backend alembic current 2>/dev/null | awk '{print $1}' | tail -1)"
HEADS="$(docker compose exec -T backend alembic heads 2>/dev/null | awk '{print $1}' | tail -1)"
[ -n "$CUR" ] && [ "$CUR" = "$HEADS" ] || fail_after "DB の revision $CUR が head $HEADS と違う"
echo "4: DB revision $CUR(head)"
for i in $(seq 1 "${TC_READY_WAIT:-30}"); do [ "$(http_code "$API/ready")" = "200" ] && break; sleep 4; done
for u in "$API/health" "$API/ready" "$WEB/" "$WEB/admin/ops"; do
  code="$(http_code "$u")"
  [ "$code" = "200" ] || fail_after "$u が HTTP $code"
  echo "4: $u 200"
done
acao="$(curl -s -o /dev/null -D - --max-time 10 -X OPTIONS -H "Origin: http://$LAN_HOST:4173" \
        -H 'Access-Control-Request-Method: GET' "$API/api/v1/trip-intents/ai/status" | tr -d '\r' \
        | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
[ "$acao" = "http://$LAN_HOST:4173" ] || fail_after "LAN の画面(http://$LAN_HOST:4173)から API を呼べません(CORS)"
echo "4: LAN の画面から API を呼べる(CORS http://$LAN_HOST:4173)"
echo "OK: $BRANCH ${TARGET:0:7} を反映(DB $CUR・バックアップ ${BK:-なし}・記録 $STATE)"
echo "    画面: http://$LAN_HOST:4173/"
echo "    次の反映: bash scripts/ops/local_dev_apply.sh"
