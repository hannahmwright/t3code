#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${T3CODE_REMOTE_ENV_FILE:-${REPO_ROOT}/.env.remote.local}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${T3CODE_HOST:=127.0.0.1}"
: "${T3CODE_PORT:=3773}"
: "${T3CODE_MODE:=web}"
: "${T3CODE_NO_BROWSER:=1}"

required_vars=(
  T3CODE_AUTH_TOKEN
  T3CODE_VAPID_PUBLIC_KEY
  T3CODE_VAPID_PRIVATE_KEY
  T3CODE_VAPID_SUBJECT
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required environment variable: ${var_name}" >&2
    echo "Copy ${REPO_ROOT}/.env.remote.example to ${ENV_FILE} and fill it in." >&2
    exit 1
  fi
done

echo "Building web app..."
bun run --cwd "${REPO_ROOT}/apps/web" build

echo "Building server..."
bun run --cwd "${REPO_ROOT}/apps/server" build

echo "Starting T3 Code on http://${T3CODE_HOST}:${T3CODE_PORT}"
exec bun run --cwd "${REPO_ROOT}/apps/server" start -- \
  --mode "${T3CODE_MODE}" \
  --host "${T3CODE_HOST}" \
  --port "${T3CODE_PORT}" \
  --auth-token "${T3CODE_AUTH_TOKEN}" \
  --no-browser
