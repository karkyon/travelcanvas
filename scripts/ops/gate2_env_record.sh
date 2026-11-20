#!/usr/bin/env bash
# [Gate②] 環境の状態を記録するだけ(何も変えない)。omega-dev2・GCP VM のどちらでも使う。追補 D の証拠にする。
#
#   cd ~/projects/travelcanvas && bash scripts/ops/gate2_env_record.sh            # 反映の前と後に 1 回ずつ
#   (反映前のチェックアウトにこの道具が無い時)
#   cd ~/projects/travelcanvas && git fetch origin main && bash <(git show origin/main:scripts/ops/gate2_env_record.sh)
#
# 記録すること: 日時・機械の名前・Git の HEAD と origin/main・作業ツリーの変更の件数・コンテナの状態・Alembic の current/head・
#   /health /ready(checks)/admin/ops の HTTP 状態・判断票 T2 の重複確認 SQL・メールの大文字小文字の重複の件数。
# 出さないもの: .env の値(COMPOSE_FILE の行だけを読む)・個人の情報(メールアドレス・利用者 ID は出さない。件数だけ)。
# 書くもの: ~/tc-artifacts/gate2-record-<日時>.txt(600)。DB・コンテナ・Git には何も書かない(SELECT だけ)。
set -uo pipefail

REPO="${TC_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)}"
[ -d "$REPO/.git" ] || REPO="$HOME/projects/travelcanvas"
cd "$REPO" || { echo "NG: リポジトリがありません: $REPO" >&2; exit 1; }
ART="${TC_ARTIFACTS:-$HOME/tc-artifacts}"
mkdir -p "$ART" && chmod 700 "$ART"
OUT="$ART/gate2-record-$(date +%Y%m%d-%H%M%S).txt"
umask 077

compose_file="$( (grep -E '^COMPOSE_FILE=' .env 2>/dev/null || true) | tail -1 | cut -d= -f2- | tr -d '"')"
if [[ "$compose_file" == *gcp* ]]; then
  ENVNAME="gcp-vm"; API="${TC_API:-http://127.0.0.1:8080}"; WEB="${TC_WEB:-http://127.0.0.1:8080}"
else
  ENVNAME="omega-dev2"; API="${TC_API:-http://127.0.0.1:8001}"; WEB="${TC_WEB:-http://127.0.0.1:4173}"
fi
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" || echo 000; }

{
  echo "# gate2 env record"
  echo "env=$ENVNAME"
  echo "host=$(hostname)"
  echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git fetch -q origin main 2>/dev/null || echo "warn=origin/main を取得できない(前回の値で比べる)"
  echo "head=$(git rev-parse HEAD)"
  echo "origin_main=$(git rev-parse origin/main 2>/dev/null || echo unknown)"
  echo "branch=$(git symbolic-ref -q --short HEAD || echo detached)"
  echo "tracked_changes=$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
  echo "## containers (service state health)"
  docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || echo "NG: docker compose ps"
  echo "## alembic"
  echo "current=$(docker compose exec -T backend alembic current 2>/dev/null | awk '{print $1}' | tail -1)"
  echo "heads=$(docker compose exec -T backend alembic heads 2>/dev/null | awk '{print $1}' | tail -1)"
  echo "expected_head=d5e9f3a7b2c6"
  echo "## http"
  echo "health=$(code "$API/health")"
  echo "ready=$(code "$API/ready")"
  echo "ready_checks=$(curl -s --max-time 15 "$API/ready" | python3 -c 'import json,sys
try: print(json.dumps(json.load(sys.stdin).get("checks"), sort_keys=True))
except Exception: print("unreadable")' 2>/dev/null)"
  echo "web_root=$(code "$WEB/")"
  echo "admin_ops=$(code "$WEB/admin/ops")"
  echo "## db (read only)"
  docker compose exec -T backend python - <<'PY' 2>/dev/null || echo "NG: DB の確認を実行できない"
from sqlalchemy import text
from app.core.database import engine

with engine.connect() as c:
    c.execute(text("SET TRANSACTION READ ONLY"))
    # 判断票 T2: 候補からの採用で同じ (作成者, 候補) の Place が 2 件以上あるか(0 行なら一意制約を足せる)
    rows = c.execute(text(
        "SELECT created_by, adopted_from_candidate_id, count(*) FROM places "
        "WHERE adopted_from_candidate_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1")).fetchall()
    print(f"t2_duplicate_groups={len(rows)}")
    print(f"t2_max_places_per_group={max((r[2] for r in rows), default=0)}")
    # #150: 大文字小文字だけ違うメールのアカウントの組(あると、その人は完全一致のメールでしかログインできない)
    n = c.execute(text("SELECT count(*) FROM (SELECT lower(email) FROM users WHERE email IS NOT NULL "
                       "GROUP BY 1 HAVING count(*) > 1) d")).scalar()
    print(f"users_case_duplicate_groups={n}")
    # #147: 大文字・前後の空白を含む宛先の招待(修正前に保存された行。照合は双方を小文字にするので承諾はできる)
    n = c.execute(text("SELECT count(*) FROM plan_collaborators WHERE email <> lower(trim(email))")).scalar()
    print(f"invites_non_normalized={n}")
    c.rollback()
PY
} | tee "$OUT"
chmod 600 "$OUT"
echo "記録: $OUT(このファイルの中身を貼ってください。秘密の値・個人の情報は入っていません)"
