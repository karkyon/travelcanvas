#!/usr/bin/env bash
set -uo pipefail

# TravelCanvas development GCP IAM hardening.
# Run from an authenticated Google Cloud Shell only after
# .github/workflows/deploy-gcp-dev.yml is present on main.

PROJECT_ID="${PROJECT_ID:-travelcanvas-development}"
PROJECT_NUMBER="${PROJECT_NUMBER:-142651556966}"
REGION="${REGION:-asia-northeast1}"
REPOSITORY="${REPOSITORY:-travelcanvas-dev}"
POOL="${POOL:-github-actions}"
PROVIDER="${PROVIDER:-github}"
DEPLOYER_SA="${DEPLOYER_SA:-tc-dev-deployer@${PROJECT_ID}.iam.gserviceaccount.com}"
REPOSITORY_ID="${REPOSITORY_ID:-1351842847}"
REPOSITORY_OWNER_ID="${REPOSITORY_OWNER_ID:-20151723}"
WORKFLOW_REF="karkyon/travelcanvas/.github/workflows/deploy-gcp-dev.yml@refs/heads/main"
OLD_PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/karkyon/travelcanvas"
NEW_PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository_id/${REPOSITORY_ID}"
FAILURES=0

run() {
  printf '\n+ '
  printf '%q ' "$@"
  printf '\n'
  if ! "$@"; then
    FAILURES=$((FAILURES + 1))
    return 1
  fi
}

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $1" >&2
    exit 2
  }
}

require gcloud
ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
if [[ -z "${ACTIVE_ACCOUNT}" || "${ACTIVE_ACCOUNT}" == "(unset)" ]]; then
  echo "ERROR: gcloud account is not selected." >&2
  exit 2
fi

run gcloud config set project "${PROJECT_ID}" || exit 1

ACTUAL_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)' 2>/dev/null)"
if [[ "${ACTUAL_NUMBER}" != "${PROJECT_NUMBER}" ]]; then
  echo "ERROR: project number mismatch: expected ${PROJECT_NUMBER}, got ${ACTUAL_NUMBER:-none}" >&2
  exit 2
fi

echo "===== 1. PRE-FLIGHT AUDIT ====="
run gcloud projects describe "${PROJECT_ID}" --format='yaml(projectId,projectNumber,name,lifecycleState,parent,labels)'
run gcloud billing projects describe "${PROJECT_ID}" --format='yaml(projectId,billingAccountName,billingEnabled)'
run gcloud iam service-accounts keys list --iam-account="${DEPLOYER_SA}" --managed-by=user --project="${PROJECT_ID}" --format='table(name.basename(),keyType,validAfterTime,validBeforeTime)'

echo "===== 2. WIF: IMMUTABLE REPOSITORY + EXACT WORKFLOW ====="
ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner=assertion.repository_owner,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.job_workflow_ref=assertion.job_workflow_ref"
ATTRIBUTE_CONDITION="assertion.repository_id=='${REPOSITORY_ID}' && assertion.repository_owner_id=='${REPOSITORY_OWNER_ID}' && assertion.ref=='refs/heads/main' && assertion.job_workflow_ref=='${WORKFLOW_REF}'"

run gcloud iam workload-identity-pools providers update-oidc "${PROVIDER}" \
  --project="${PROJECT_ID}" \
  --location=global \
  --workload-identity-pool="${POOL}" \
  --attribute-mapping="${ATTRIBUTE_MAPPING}" \
  --attribute-condition="${ATTRIBUTE_CONDITION}"

run gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA}" \
  --project="${PROJECT_ID}" \
  --member="${NEW_PRINCIPAL}" \
  --role=roles/iam.workloadIdentityUser

if gcloud iam service-accounts get-iam-policy "${DEPLOYER_SA}" \
  --project="${PROJECT_ID}" \
  --flatten='bindings[].members' \
  --filter="bindings.role:roles/iam.workloadIdentityUser AND bindings.members:${OLD_PRINCIPAL}" \
  --format='value(bindings.members)' | grep -q .; then
  run gcloud iam service-accounts remove-iam-policy-binding "${DEPLOYER_SA}" \
    --project="${PROJECT_ID}" \
    --member="${OLD_PRINCIPAL}" \
    --role=roles/iam.workloadIdentityUser
fi

echo "===== 3. BLOCK USER-MANAGED SERVICE ACCOUNT KEYS ====="
# Project-scoped only: other projects in the organization are not changed.
run gcloud resource-manager org-policies enable-enforce \
  constraints/iam.disableServiceAccountKeyCreation \
  --project="${PROJECT_ID}"
run gcloud resource-manager org-policies enable-enforce \
  constraints/iam.disableServiceAccountKeyUpload \
  --project="${PROJECT_ID}"

echo "===== 4. ARTIFACT REGISTRY: REPOSITORY-SCOPED WRITER ====="
run gcloud artifacts repositories add-iam-policy-binding "${REPOSITORY}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role=roles/artifactregistry.writer

if gcloud projects get-iam-policy "${PROJECT_ID}" \
  --flatten='bindings[].members' \
  --filter="bindings.role:roles/artifactregistry.writer AND bindings.members:serviceAccount:${DEPLOYER_SA}" \
  --format='value(bindings.members)' | grep -q .; then
  run gcloud projects remove-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOYER_SA}" \
    --role=roles/artifactregistry.writer \
    --condition=None
fi

echo "===== 5. POST-CHANGE VERIFICATION ====="
run gcloud iam workload-identity-pools providers describe "${PROVIDER}" \
  --project="${PROJECT_ID}" \
  --location=global \
  --workload-identity-pool="${POOL}" \
  --format='yaml(name,state,oidc.issuerUri,attributeMapping,attributeCondition)'
run gcloud iam service-accounts get-iam-policy "${DEPLOYER_SA}" \
  --project="${PROJECT_ID}" \
  --format='yaml(bindings)'
run gcloud resource-manager org-policies describe \
  constraints/iam.disableServiceAccountKeyCreation \
  --project="${PROJECT_ID}" --effective
run gcloud resource-manager org-policies describe \
  constraints/iam.disableServiceAccountKeyUpload \
  --project="${PROJECT_ID}" --effective
run gcloud artifacts repositories get-iam-policy "${REPOSITORY}" \
  --project="${PROJECT_ID}" --location="${REGION}" --format='yaml(bindings)'
run gcloud projects get-iam-policy "${PROJECT_ID}" \
  --flatten='bindings[].members' \
  --filter="bindings.members:${DEPLOYER_SA}" \
  --format='table(bindings.role,bindings.members)'
run gcloud iam service-accounts keys list --iam-account="${DEPLOYER_SA}" \
  --managed-by=user --project="${PROJECT_ID}" \
  --format='table(name.basename(),keyType,validAfterTime,validBeforeTime)'

echo "===== RESULT ====="
if (( FAILURES > 0 )); then
  echo "PARTIAL: ${FAILURES} command(s) failed. Do not weaken IAM to work around errors."
  echo "The usual blocker is missing roles/orgpolicy.policyAdmin at organization 552296876955."
  exit 1
fi
echo "PASS: WIF, service-account-key policy, and repository-scoped Artifact Registry IAM are hardened."
