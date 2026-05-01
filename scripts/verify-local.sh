#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SERVER_TESTS="${RUN_SERVER_TESTS:-0}"
RUN_STACK_CHECK="${RUN_STACK_CHECK:-0}"
SKIP_DOCKER="${SKIP_DOCKER:-0}"

run_step() {
  echo
  echo "==> $1"
  shift
  "$@"
}

run_step "Maintenance scans" bash "$ROOT_DIR/scripts/scan-maintenance.sh"

run_step "Client typecheck" bash -c "cd \"$ROOT_DIR/client\" && npm run typecheck"
run_step "Client lint" bash -c "cd \"$ROOT_DIR/client\" && npm run lint"
run_step "Client build" bash -c "cd \"$ROOT_DIR/client\" && npm run build"

run_step "Server typecheck" bash -c "cd \"$ROOT_DIR/server\" && npm run typecheck"
run_step "Server build" bash -c "cd \"$ROOT_DIR/server\" && npm run build"

if [[ "$RUN_SERVER_TESTS" == "1" ]]; then
  run_step "Server tests" bash -c "cd \"$ROOT_DIR/server\" && npm test"
else
  echo
  echo "==> Server tests skipped (set RUN_SERVER_TESTS=1 to run)"
fi

if [[ "$RUN_STACK_CHECK" == "1" ]]; then
  run_step "Local stack health" bash -c "cd \"$ROOT_DIR\" && CHECK_VITE=1 node scripts/check-local-stack.mjs"
else
  echo
  echo "==> Local stack health skipped (set RUN_STACK_CHECK=1 when 3780/5173 are running)"
fi

if [[ "$SKIP_DOCKER" == "1" ]]; then
  echo
  echo "==> Docker compose config skipped (SKIP_DOCKER=1)"
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  run_step "Docker compose config" bash -c "cd \"$ROOT_DIR\" && docker compose -f docker-compose.local.yml config --services >/dev/null"
else
  echo
  echo "==> Docker compose config skipped (docker compose not available)"
fi

echo "All local verification checks passed."
