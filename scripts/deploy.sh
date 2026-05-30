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

require_command node
require_command npm

node -e "const major=Number(process.versions.node.split('.')[0]); if (major < 22) { console.error('Node.js 22 or newer is required. Current: ' + process.version); process.exit(1); }"

cd "${ROOT_DIR}"

if [[ -z "${VITE_API_BASE_URL:-}" ]]; then
  echo "Missing required config: set VITE_API_BASE_URL in ${ENV_FILE} before deploying." >&2
  exit 1
fi

npm run check --workspaces --if-present
npm run build -w @album/web
npm run build -w @album/infra
npm run cdk -w @album/infra -- deploy PersonalAlbumStack --outputs-file "${OUTPUTS_FILE}" --require-approval never

echo "Deployment complete."
echo "SPA: https://${ALBUM_DOMAIN:-album.joe-cui.com}"
echo "API: ${VITE_API_BASE_URL}"
