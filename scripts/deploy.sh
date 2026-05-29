#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUTS_FILE="${ROOT_DIR}/infra/cdk-outputs.json"
ENV_FILE="${ROOT_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

extract_output() {
  local key="$1"
  node -e "const outputs=require(process.argv[1]); console.log(outputs.PersonalAlbumStack?.[process.argv[2]] ?? '')" "${OUTPUTS_FILE}" "${key}"
}

require_command aws
require_command node
require_command npm

node -e "const major=Number(process.versions.node.split('.')[0]); if (major < 22) { console.error('Node.js 22 or newer is required. Current: ' + process.version); process.exit(1); }"

cd "${ROOT_DIR}"

npm run check --workspaces --if-present
npm run cdk -w @album/infra -- deploy PersonalAlbumStack --outputs-file "${OUTPUTS_FILE}" --require-approval never

API_URL="$(extract_output HttpApiUrl)"
WEB_BUCKET="$(extract_output WebAssetsBucketName)"
WEB_DISTRIBUTION_ID="$(extract_output WebDistributionId)"

if [[ -z "${API_URL}" || -z "${WEB_BUCKET}" || -z "${WEB_DISTRIBUTION_ID}" ]]; then
  echo "CDK outputs are missing HttpApiUrl, WebAssetsBucketName, or WebDistributionId." >&2
  exit 1
fi

VITE_API_BASE_URL="${API_URL}" npm run build -w @album/web
aws s3 sync "${ROOT_DIR}/apps/web/dist" "s3://${WEB_BUCKET}" --delete
INVALIDATION_ID="$(
  aws cloudfront create-invalidation \
    --distribution-id "${WEB_DISTRIBUTION_ID}" \
    --paths "/*" \
    --query "Invalidation.Id" \
    --output text
)"
echo "Waiting for CloudFront invalidation ${INVALIDATION_ID} to complete..."
aws cloudfront wait invalidation-completed \
  --distribution-id "${WEB_DISTRIBUTION_ID}" \
  --id "${INVALIDATION_ID}"

echo "Deployment complete."
echo "SPA: https://${ALBUM_DOMAIN:-album.joe-cui.com}"
echo "API: ${API_URL}"
