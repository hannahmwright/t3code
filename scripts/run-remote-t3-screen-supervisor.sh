#!/usr/bin/env bash

set -euo pipefail

SESSION_NAME="${T3CODE_REMOTE_SCREEN_SESSION:-t3-remote}"
SERVER_SCRIPT="/Users/hannahwright/Code/t3code/scripts/run-remote-t3-service.sh"
REMOTE_PORT="${T3CODE_PORT:-3773}"
HEALTH_URL="${T3CODE_REMOTE_HEALTH_URL:-http://127.0.0.1:${REMOTE_PORT}/api/auth/session}"
STARTUP_GRACE_SECONDS="${T3CODE_REMOTE_STARTUP_GRACE_SECONDS:-30}"
CHECK_INTERVAL_SECONDS="${T3CODE_REMOTE_CHECK_INTERVAL_SECONDS:-5}"
MAX_UNHEALTHY_CHECKS="${T3CODE_REMOTE_MAX_UNHEALTHY_CHECKS:-3}"
NODE_PATTERN="dist/bin\\.mjs --mode web --host 127\\.0\\.0\\.1 --port ${REMOTE_PORT}"

cleanup_stale_processes() {
  /usr/bin/screen -S "${SESSION_NAME}" -X quit >/dev/null 2>&1 || true
  /usr/bin/pkill -f "${NODE_PATTERN}" >/dev/null 2>&1 || true
  /usr/bin/pkill -f "${SERVER_SCRIPT}" >/dev/null 2>&1 || true
}

start_session() {
  cleanup_stale_processes
  /usr/bin/screen -DmS "${SESSION_NAME}" "${SERVER_SCRIPT}"
}

session_exists() {
  /usr/bin/screen -ls 2>/dev/null | /usr/bin/grep -q "[.]${SESSION_NAME}[[:space:]]"
}

healthcheck_ok() {
  /usr/bin/curl -fsS --max-time 3 "${HEALTH_URL}" >/dev/null
}

cleanup() {
  cleanup_stale_processes
}

trap cleanup EXIT INT TERM

while true; do
  start_session
  unhealthy_checks=0
  grace_deadline=$(( $(/bin/date +%s) + STARTUP_GRACE_SECONDS ))

  while session_exists; do
    if healthcheck_ok; then
      unhealthy_checks=0
      sleep "${CHECK_INTERVAL_SECONDS}"
      continue
    fi

    if [[ "$(/bin/date +%s)" -lt "${grace_deadline}" ]]; then
      sleep 2
      continue
    fi

    unhealthy_checks=$((unhealthy_checks + 1))
    if [[ "${unhealthy_checks}" -ge "${MAX_UNHEALTHY_CHECKS}" ]]; then
      break
    fi

    sleep "${CHECK_INTERVAL_SECONDS}"
  done

  cleanup_stale_processes
  sleep 2
done
