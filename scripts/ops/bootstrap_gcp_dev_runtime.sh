#!/usr/bin/env bash
# TravelCanvas GCP dev runtime foundation.
# Run as a child process: bash scripts/ops/bootstrap_gcp_dev_runtime.sh
# Never source this file. It is resumable and does not terminate the parent Cloud Shell.
set -Eeuo pipefail

PROJECT_ID="${PROJECT_ID:-travelcanvas-development}"
PROJECT_NUMBER="${PROJECT_NUMBER:-142651556966}"
REGION="${REGION:-asia-northeast1}"
DEPLOYER_SA="tc-dev-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="tc-dev-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
MIGRATOR_SA="tc-dev-migrator@${PROJECT_ID}.iam.gserviceaccount.com"
LOG_FILE="${HOME}/travelcanvas_runtime_bootstrap_$(date +%Y%m%d_%H%M%S).log"
FAILED=0

trap 'rc=$?; echo "[ERROR] line ${LINENO}, exit ${rc}. Parent console remains open." | tee -a "$LOG_FILE"; exit "$rc"' ERR
exec > >(tee -a "$LOG_FILE") 2>&1

run() {
  echo "+ $*"
  if ! "$@"; then
    FAILED=$((FAILED + 1))
    echo "[WARN] command failed; continuing audit-safe bootstrap"
  fi
}

ensure_secret() {
  local name="$1"
  if ! gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    run gcloud secrets create "$name" --project="$PROJECT_ID" --replication-policy=automatic
  fi
}

ensure_generated_version() {
  local name="$1"
  if ! gcloud secrets versions list "$name" --project="$PROJECT_ID" --filter='state=ENABLED' --format='value(name)' | grep -q .; then
    local value
    value="$(openssl rand -base64 48 | tr -d '\n')"
    printf '%s' "$value" | gcloud secrets versions add "$name" --project="$PROJECT_ID" --data-file=- >/dev/null
    unset value
    echo "[OK] generated first version: $name"
  else
    echo "[OK] enabled version already exists: $name"
  fi
}

echo "===== TravelCanvas dev runtime bootstrap ====="
echo "project=$PROJECT_ID region=$REGION"
run gcloud config set project "$PROJECT_ID"
run gcloud services enable run.googleapis.com secretmanager.googleapis.com iam.googleapis.com artifactregistry.googleapis.com --project="$PROJECT_ID"

if ! gcloud iam service-accounts describe "$MIGRATOR_SA" --project="$PROJECT_ID" >/dev/null 2>&1; then
  run gcloud iam service-accounts create tc-dev-migrator --project="$PROJECT_ID" --display-name="TravelCanvas dev DB migrator"
fi

# WIF deployer can deploy using, but cannot become, runtime/migrator outside Cloud Run.
for sa in "$RUNTIME_SA" "$MIGRATOR_SA"; do
  run gcloud iam service-accounts add-iam-policy-binding "$sa"     --project="$PROJECT_ID"     --member="serviceAccount:$DEPLOYER_SA"     --role=roles/iam.serviceAccountUser
done

GENERATED_SECRETS=(
  tc-dev-jwt-secret
  tc-dev-encryption-key
  tc-dev-lookup-index-key
  tc-dev-document-signing-key
  tc-dev-mfa-key
  tc-dev-offline-pack-key
  tc-dev-metrics-token
)
DATA_SECRETS=(tc-dev-db-owner-url tc-dev-db-app-url tc-dev-redis-url)

for secret in "${GENERATED_SECRETS[@]}" "${DATA_SECRETS[@]}"; do
  ensure_secret "$secret"
done
for secret in "${GENERATED_SECRETS[@]}"; do
  ensure_generated_version "$secret"
done

# Least privilege: runtime cannot read DB-owner credentials; migrator cannot read app keys.
for secret in tc-dev-db-app-url tc-dev-redis-url "${GENERATED_SECRETS[@]}"; do
  run gcloud secrets add-iam-policy-binding "$secret"     --project="$PROJECT_ID"     --member="serviceAccount:$RUNTIME_SA"     --role=roles/secretmanager.secretAccessor
done
run gcloud secrets add-iam-policy-binding tc-dev-db-owner-url   --project="$PROJECT_ID"   --member="serviceAccount:$MIGRATOR_SA"   --role=roles/secretmanager.secretAccessor

echo
echo "===== Verification ====="
run gcloud iam service-accounts keys list --iam-account="$RUNTIME_SA" --managed-by=user --project="$PROJECT_ID"
run gcloud iam service-accounts keys list --iam-account="$MIGRATOR_SA" --managed-by=user --project="$PROJECT_ID"
run gcloud secrets list --project="$PROJECT_ID" --filter='name:tc-dev-' --format='table(name,replication.automatic)'

missing=0
for secret in "${DATA_SECRETS[@]}"; do
  if ! gcloud secrets versions list "$secret" --project="$PROJECT_ID" --filter='state=ENABLED' --format='value(name)' | grep -q .; then
    echo "[NEXT] data-service value is still required: $secret"
    missing=$((missing + 1))
  fi
done

echo
echo "Log: $LOG_FILE"
if (( FAILED > 0 )); then
  echo "PARTIAL: $FAILED command(s) failed. Parent console remains open."
  exit 1
fi
if (( missing > 0 )); then
  echo "FOUNDATION PASS: IAM and generated secrets are ready; DB/Redis URLs remain intentionally unset."
else
  echo "PASS: runtime foundation and all required secret versions are ready."
fi
