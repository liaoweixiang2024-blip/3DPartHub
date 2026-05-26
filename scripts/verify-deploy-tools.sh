#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

run_step() {
  printf '\n==> %s\n' "$1"
  shift
  "$@"
}

check_syntax() {
  cd "$ROOT_DIR"
  bash -n install.sh
  bash -n deploy.sh
  sh -n scripts/deploy-health-check.sh
  sh -n scripts/collect-deploy-evidence.sh
  sh -n scripts/verify-production-deploy-evidence.sh
  sh -n scripts/test-deploy-health-check.sh
  node --check scripts/verify-deploy-health-report.mjs
  node --check scripts/verify-deploy-wiring.mjs
  node --check scripts/verify-enterprise-acceptance.mjs
}

check_cli_help() {
  cd "$ROOT_DIR"
  npm run deploy:check -- --help >/dev/null
  npm run deploy:evidence -- --help >/dev/null
  npm run deploy:report:verify -- --help >/dev/null
  npm run deploy:acceptance -- --help >/dev/null
  npm run verify:enterprise -- --help >/dev/null
}

check_enterprise_acceptance_failure_summary() {
  tmp_dir="${TMPDIR:-/tmp}/3dparthub-enterprise-acceptance-$$"
  mkdir -p "$tmp_dir/bin"
  trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' 'echo "simulated prettier failure" >&2'
    printf '%s\n' 'exit 23'
  } >"$tmp_dir/bin/npx"
  chmod +x "$tmp_dir/bin/npx"

  summary_file="$tmp_dir/local-enterprise-acceptance.md"
  summary_json_file="$tmp_dir/local-enterprise-acceptance.json"
  output_file="$tmp_dir/output.txt"

  set +e
  PATH="$tmp_dir/bin:$PATH" node "$ROOT_DIR/scripts/verify-enterprise-acceptance.mjs" \
    --summary "$summary_file" \
    --summary-json "$summary_json_file" \
    >"$output_file" 2>&1
  status="$?"
  set -e

  if [ "$status" -eq 0 ]; then
    echo "Expected enterprise acceptance to fail when Prettier command fails" >&2
    exit 1
  fi
  if [ ! -s "$summary_file" ] || [ ! -s "$summary_json_file" ]; then
    echo "Enterprise acceptance failure did not write summary artifacts" >&2
    exit 1
  fi
  grep -q '结论: failed' "$summary_file"
  grep -q '本地企业级验收未通过' "$summary_file"
  node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (data.result !== "failed") throw new Error("Expected failed result");
if (!data.failure || !data.failure.message.includes("Prettier format check failed")) {
  throw new Error("Expected failure message to name the failed step");
}
if (!data.failedStep || data.failedStep.label !== "Prettier format check") {
  throw new Error("Expected failedStep to capture Prettier format check");
}
if (!Array.isArray(data.steps) || data.steps.length !== 1 || data.steps[0].status !== "failed") {
  throw new Error("Expected one failed step in failure summary");
}
' "$summary_json_file"
}

run_regression_tests() {
  cd "$ROOT_DIR"
  npm run deploy:check:test
}

run_step "Deploy script syntax" check_syntax
run_step "Deploy CLI smoke checks" check_cli_help
run_step "Enterprise acceptance failure summary" check_enterprise_acceptance_failure_summary
run_step "Deploy wiring invariants" node "$ROOT_DIR/scripts/verify-deploy-wiring.mjs"
run_step "Deploy health-check regression" run_regression_tests

printf '\nDeploy tool verification passed.\n'
