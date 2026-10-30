#!/usr/bin/env bash
# Recreate the known TravelCanvas development baseline in the target GCP project.
# Safe to re-run. Does not create Cloud Run services, databases, VMs, or secret versions.
set -Eeuo pipefail
set +x
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

PROJECT_ID="project-c883e9da-6ebc-4d0d-a23"
PROJECT_NUMBER="1072503803591"
EXPECTED_ACCOUNT="karkyon.omega@gmail.com"
REGION="asia-northeast1"
REPOSITORY="travelcanvas-dev"
BUDGET_TOPIC="tc-dev-budget-alerts"
BUDGET_NAME="TravelCanvas Development JPY 3000 monthly"
POOL="github-actions"
PROVIDER="github"

die() { printf 'STOP: %s\n' "$1" >&2; exit 1; }

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
[[ "$ACTIVE_ACCOUNT" == "$EXPECTED_ACCOUNT" ]] || die "Active account is $ACTIVE_ACCOUNT; expected $EXPECTED_ACCOUNT"

gcloud config set project "$PROJECT_ID" --quiet >/dev/null
FOUND_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
FOUND_STATE="$(gcloud projects describe "$PROJECT_ID" --format='value(lifecycleState)')"
[[ "$FOUND_NUMBER" == "$PROJECT_NUMBER" ]] || die "Project number mismatch: $FOUND_NUMBER"
[[ "$FOUND_STATE" == "ACTIVE" ]] || die "Project is not ACTIVE: $FOUND_STATE"

BILLING_JSON="$(gcloud billing projects describe "$PROJECT_ID" --format=json)"
BILLING_ENABLED="$(printf '%s' "$BILLING_JSON" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("billingEnabled", False)).lower())')"
BILLING_ACCOUNT="$(printf '%s' "$BILLING_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("billingAccountName", ""))' | sed 's#^.*/##')"
[[ "$BILLING_ENABLED" == "true" ]] || die "Target project has billing disabled; no resources were created"
[[ -n "$BILLING_ACCOUNT" ]] || die "Could not resolve the target billing account"

# Check budget permissions before changing project resources.
gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --limit=1 --format='value(name)' >/dev/null

printf 'Target: %s (%s), billing account %s\n' "$PROJECT_ID" "$PROJECT_NUMBER" "$BILLING_ACCOUNT"
printf 'Applying the known development baseline. No database, runtime service, VM, or secret value will be created.\n'

# Match the APIs observed on the source project, including Compute/SQL Admin that
# were enabled during its inventory. API enablement alone does not create a SQL instance.
gcloud services enable \
  analyticshub.googleapis.com apptopology.googleapis.com artifactregistry.googleapis.com \
  bigquery.googleapis.com bigqueryconnection.googleapis.com bigquerydatapolicy.googleapis.com \
  bigquerydatatransfer.googleapis.com bigquerymigration.googleapis.com bigqueryreservation.googleapis.com \
  bigquerystorage.googleapis.com billingbudgets.googleapis.com cloudapis.googleapis.com \
  cloudbuild.googleapis.com cloudtrace.googleapis.com containerregistry.googleapis.com \
  dataform.googleapis.com dataplex.googleapis.com datastore.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  pubsub.googleapis.com run.googleapis.com secretmanager.googleapis.com servicemanagement.googleapis.com \
  serviceusage.googleapis.com sql-component.googleapis.com storage-api.googleapis.com \
  storage-component.googleapis.com storage.googleapis.com sts.googleapis.com telemetry.googleapis.com \
  compute.googleapis.com sqladmin.googleapis.com \
  --project="$PROJECT_ID" --quiet

if ! gcloud artifacts repositories describe "$REPOSITORY" --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --project="$PROJECT_ID" --location="$REGION" --repository-format=docker \
    --description="Short-lived TravelCanvas development images" --quiet
fi

# Keep the old cleanup intent, initially in dry-run so the first rebuilt image is protected.
POLICY_FILE="$(mktemp)"
trap 'rm -f "$POLICY_FILE"' EXIT
cat >"$POLICY_FILE" <<'JSON'
{
  "rules": [
    {
      "name": "delete-untagged-older-than-7-days",
      "action": {"type": "Delete"},
      "condition": {"tagState": "untagged", "olderThan": "604800s"}
    },
    {
      "name": "keep-5-most-recent-versions",
      "action": {"type": "Keep"},
      "mostRecentVersions": {"keepCount": 5}
    }
  ]
}
JSON
gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" \
  --project="$PROJECT_ID" --location="$REGION" --policy="$POLICY_FILE" --dry-run

if ! gcloud pubsub topics describe "$BUDGET_TOPIC" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud pubsub topics create "$BUDGET_TOPIC" --project="$PROJECT_ID"
fi

create_sa() {
  local id="$1" display="$2"
  if ! gcloud iam service-accounts describe "$id@$PROJECT_ID.iam.gserviceaccount.com" \
      --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$id" --project="$PROJECT_ID" --display-name="$display"
  fi
}
create_sa "tc-dev-runtime" "TravelCanvas dev runtime"
create_sa "tc-dev-deployer" "TravelCanvas dev deployer"
create_sa "tc-dev-migrator" "TravelCanvas dev DB migrator"

DEPLOYER="tc-dev-deployer@$PROJECT_ID.iam.gserviceaccount.com"
RUNTIME="tc-dev-runtime@$PROJECT_ID.iam.gserviceaccount.com"
MIGRATOR="tc-dev-migrator@$PROJECT_ID.iam.gserviceaccount.com"

if ! gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --project="$PROJECT_ID" \
    --display-name="GitHub Actions" --description="TravelCanvas deployment from karkyon/travelcanvas"
fi

if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" --project="$PROJECT_ID" \
    --display-name="GitHub Actions: karkyon/travelcanvas" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == 'karkyon/travelcanvas' && assertion.repository_owner == 'karkyon' && assertion.ref == 'refs/heads/main'"
fi

WIF_MEMBER="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/karkyon/travelcanvas"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --project="$PROJECT_ID" --member="$WIF_MEMBER" --role="roles/iam.workloadIdentityUser" --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER" --role="roles/run.developer" --quiet
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
  --project="$PROJECT_ID" --location="$REGION" \
  --member="serviceAccount:$DEPLOYER" --role="roles/artifactregistry.writer" --quiet
for SA in "$RUNTIME" "$MIGRATOR"; do
  gcloud iam service-accounts add-iam-policy-binding "$SA" \
    --project="$PROJECT_ID" --member="serviceAccount:$DEPLOYER" \
    --role="roles/iam.serviceAccountUser" --quiet
done

# Recreate secret containers and least-privilege readers only. No secret payloads are copied.
RUNTIME_SECRETS="tc-dev-db-app-url tc-dev-document-signing-key tc-dev-encryption-key tc-dev-jwt-secret tc-dev-lookup-index-key tc-dev-metrics-token tc-dev-mfa-key tc-dev-offline-pack-key tc-dev-redis-url"
for SECRET in $RUNTIME_SECRETS; do
  if ! gcloud secrets describe "$SECRET" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$SECRET" --project="$PROJECT_ID" --replication-policy=automatic
  fi
  gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME" --role="roles/secretmanager.secretAccessor" --quiet
done
if ! gcloud secrets describe "tc-dev-db-owner-url" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create "tc-dev-db-owner-url" --project="$PROJECT_ID" --replication-policy=automatic
fi
gcloud secrets add-iam-policy-binding "tc-dev-db-owner-url" --project="$PROJECT_ID" \
  --member="serviceAccount:$MIGRATOR" --role="roles/secretmanager.secretAccessor" --quiet

# Create the source project's JPY 3,000 monthly alerts-only budget if it is absent.
if ! gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
    --filter="displayName=\"$BUDGET_NAME\"" --format='value(name)' | grep -q .; then
  gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
    --display-name="$BUDGET_NAME" --budget-amount=3000JPY --calendar-period=month \
    --filter-projects="projects/$PROJECT_ID" \
    --threshold-rule=percent=0.20 --threshold-rule=percent=0.40 \
    --threshold-rule=percent=0.70 --threshold-rule=percent=0.85 \
    --threshold-rule=percent=1.00 \
    --threshold-rule=percent=1.00,basis=forecasted-spend \
    --notifications-rule-pubsub-topic="projects/$PROJECT_ID/topics/$BUDGET_TOPIC"
fi

printf '\nBaseline provisioning commands completed.\n'
printf 'Next: verify WIF/repository/budget, populate DB/Redis secrets only after selecting those services, then run GitHub Actions with deploy_service=false.\n'
printf 'Budget alerts notify; they do not cap spending.\n'
