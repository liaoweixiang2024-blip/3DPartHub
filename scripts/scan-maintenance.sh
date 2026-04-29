#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

require_rg() {
  if ! command -v rg >/dev/null 2>&1; then
    echo "ripgrep (rg) is required for maintenance scans." >&2
    exit 127
  fi
}

check_absent() {
  local label="$1"
  local pattern="$2"
  shift 2

  local matches
  matches="$(rg -n "$pattern" "$@" --glob '!dist' --glob '!node_modules' || true)"
  if [[ -n "$matches" ]]; then
    echo
    echo "Maintenance scan failed: $label"
    echo "$matches"
    FAILED=1
  fi
}

check_dangerous_html() {
  local matches
  matches="$(rg -n "dangerouslySetInnerHTML" "$ROOT_DIR/client/src" --glob '!dist' --glob '!node_modules' | rg -v "sanitizeHtml|safe[A-Za-z0-9_]*Html" || true)"
  if [[ -n "$matches" ]]; then
    echo
    echo "Maintenance scan failed: raw dangerouslySetInnerHTML must pass through sanitizeHtml."
    echo "$matches"
    FAILED=1
  fi
}

require_rg

check_absent \
  "do not put JWT/access tokens in browser-visible URLs" \
  'allowQueryToken: true|\?token=|params\.set\("token"|searchParams\.set\("token"|withAccessToken|authUrl' \
  "$ROOT_DIR/client/src" "$ROOT_DIR/server/src"

check_absent \
  "do not use shell-string execSync in server code" \
  'execSync\(' \
  "$ROOT_DIR/server/src"

check_absent \
  "do not use Math.random for server auth tokens/codes" \
  'Math\.random\(' \
  "$ROOT_DIR/server/src/routes/auth.ts" \
  "$ROOT_DIR/server/src/lib/captcha.ts" \
  "$ROOT_DIR/server/src/routes/settings.ts" \
  "$ROOT_DIR/server/src/lib/downloadTokenStore.ts"

check_absent \
  "do not reintroduce ad-hoc backup download token files" \
  'DL_TOKEN_DIR|writeDownloadToken|consumeDownloadToken' \
  "$ROOT_DIR/server/src/routes/settings.ts"

check_absent \
  "do not put share passwords in URLs" \
  'req\.query\.password|\?password=|params:.*password|getShareDownloadUrl\([^)]*password|getShareInfo\([^)]*password' \
  "$ROOT_DIR/server/src/routes/shares.ts" \
  "$ROOT_DIR/client/src/api/shares.ts" \
  "$ROOT_DIR/client/src/pages/SharePage.tsx"

check_dangerous_html

check_absent \
  "pages must use page shell components instead of direct navigation wiring" \
  'from ["'\'']\.\./components/shared/(TopNav|BottomNav|Sidebar|MobileNavDrawer)["'\'']|navOpen|setNavOpen' \
  "$ROOT_DIR/client/src/pages"

check_absent \
  "pages should import concrete shell modules instead of PageScaffold barrel" \
  'from ["'\'']\.\./components/shared/PageScaffold["'\'']' \
  "$ROOT_DIR/client/src/pages"

if [[ "$FAILED" -ne 0 ]]; then
  exit 1
fi

echo "Maintenance scans passed."
