#!/usr/bin/env bash
# =============================================================================
# scripts/deploy-check.sh — Pre-deployment verification
# =============================================================================
#
# Run this script on the VPS (from inside the release/ directory, after
# extracting the tarball and running npm install) to verify the environment
# is ready before starting the application.
#
# Usage:
#   ./scripts/deploy-check.sh          # checks everything
#   ./scripts/deploy-check.sh --skip-db  # skip database connectivity check
#
# Exit code:
#   0 — all checks passed (safe to start the app)
#   1 — one or more checks failed (do not start the app)
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SKIP_DB=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-db) SKIP_DB=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Support running from release/scripts/ or workspace root scripts/
if [[ -f "$SCRIPT_DIR/../ecosystem.config.cjs" ]]; then
  RELEASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [[ -f "$SCRIPT_DIR/../../ecosystem.config.cjs" ]]; then
  # Running from workspace root scripts/ against a release/ subdir
  RELEASE_DIR="$(cd "$SCRIPT_DIR/../../release" && pwd 2>/dev/null)" || RELEASE_DIR=""
else
  RELEASE_DIR="$(pwd)"
fi

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}[PASS]${NC} $*"; ((PASS++)) || true; }
fail() { echo -e "  ${RED}[FAIL]${NC} $*"; ((FAIL++)) || true; }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $*"; }
section() { echo -e "\n${BOLD}── $* ──${NC}"; }

# ---------------------------------------------------------------------------
# Load .env if present
# ---------------------------------------------------------------------------
ENV_FILE="$RELEASE_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo "Loaded environment from $ENV_FILE"
else
  warn ".env not found at $RELEASE_DIR/.env — checks use current shell environment"
fi

echo ""
echo -e "${BOLD}Signalium Platform — Pre-deployment Check${NC}"
echo "Release dir: $RELEASE_DIR"
echo "Timestamp:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# =============================================================================
# 1. Runtime requirements
# =============================================================================
section "Runtime requirements"

# Node.js version
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version | sed 's/v//' | cut -d. -f1)"
  if [[ "$NODE_VER" -ge 20 ]]; then
    pass "Node.js $(node --version)"
  else
    fail "Node.js >= 20 required (found v$NODE_VER)"
  fi
else
  fail "Node.js not found in PATH"
fi

# PM2
if command -v pm2 >/dev/null 2>&1; then
  pass "PM2 $(pm2 --version)"
else
  fail "PM2 not found in PATH — install: npm install -g pm2"
fi

# npm (for runtime dep install)
if command -v npm >/dev/null 2>&1; then
  pass "npm $(npm --version)"
else
  warn "npm not found — needed to run: npm install --omit=dev"
fi

# =============================================================================
# 2. Build artifacts
# =============================================================================
section "Build artifacts"

check_file() {
  local label="$1"
  local path="$2"
  if [[ -f "$path" ]]; then
    pass "$label"
  else
    fail "$label — not found: $path"
  fi
}

check_dir() {
  local label="$1"
  local path="$2"
  if [[ -d "$path" ]] && [[ -n "$(ls -A "$path" 2>/dev/null)" ]]; then
    pass "$label"
  else
    fail "$label — missing or empty: $path"
  fi
}

check_file "Backend bundle (dist/server/index.mjs)"     "$RELEASE_DIR/dist/server/index.mjs"
check_file "Migration runner (dist/server/migrate.mjs)" "$RELEASE_DIR/dist/server/migrate.mjs"
check_file "Frontend entry  (dist/public/index.html)"   "$RELEASE_DIR/dist/public/index.html"
check_dir  "SQL migrations  (dist/drizzle/)"            "$RELEASE_DIR/dist/drizzle"
check_file "PM2 config      (ecosystem.config.cjs)"     "$RELEASE_DIR/ecosystem.config.cjs"
check_file "Runtime deps    (package.json)"             "$RELEASE_DIR/package.json"

# node_modules for runtime externals
if [[ -d "$RELEASE_DIR/node_modules" ]]; then
  pass "node_modules present (runtime deps installed)"
else
  fail "node_modules not found — run: npm install --omit=dev"
fi

# =============================================================================
# 3. Required environment variables
# =============================================================================
section "Environment variables"

check_env() {
  local name="$1"
  local required="${2:-true}"
  local val="${!name:-}"
  if [[ -n "$val" ]]; then
    # Mask secrets in output — show only first 4 chars
    local display="${val:0:4}****"
    pass "$name = $display"
  elif [[ "$required" == "true" ]]; then
    fail "$name — not set (required)"
  else
    warn "$name — not set (optional)"
  fi
}

check_env "NODE_ENV"
check_env "PORT"
check_env "DATABASE_URL"
check_env "PUBLIC_APP_URL"
check_env "ALLOWED_ORIGINS"
check_env "SESSION_SECRET"
check_env "SECRETS_ENCRYPTION_KEY"
check_env "LOG_LEVEL" "false"
check_env "STRIPE_SECRET_KEY" "false"

# Validate NODE_ENV value
if [[ "${NODE_ENV:-}" != "production" ]]; then
  fail "NODE_ENV must be 'production' (currently: '${NODE_ENV:-unset}')"
fi

# Validate PORT is a number
if [[ -n "${PORT:-}" ]]; then
  if [[ "${PORT}" =~ ^[0-9]+$ ]] && [[ "${PORT}" -gt 0 ]] && [[ "${PORT}" -lt 65536 ]]; then
    : # already passed above
  else
    fail "PORT must be a valid port number (1-65535), got: ${PORT}"
  fi
fi

# =============================================================================
# 4. Database connectivity
# =============================================================================
section "Database connectivity"

if [[ "$SKIP_DB" == "true" ]]; then
  warn "Database check skipped (--skip-db flag)"
elif [[ -z "${DATABASE_URL:-}" ]]; then
  fail "DATABASE_URL not set — cannot check database"
else
  # Try psql first (lightest dependency)
  if command -v psql >/dev/null 2>&1; then
    if PGPASSWORD="" psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
      pass "Database reachable (psql)"
    else
      fail "Database connection failed — check DATABASE_URL and pg_hba.conf"
    fi
  # Fall back to Node.js pg if psql isn't available
  elif [[ -f "$RELEASE_DIR/node_modules/pg/lib/index.js" ]] || \
       [[ -d "$RELEASE_DIR/node_modules/pg" ]]; then
    DB_CHECK_RESULT=$(node --input-type=module <<EOF 2>&1
import pg from '${RELEASE_DIR}/node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: '${DATABASE_URL}' });
try {
  await pool.query('SELECT 1');
  console.log('OK');
} catch (e) {
  console.error('FAIL: ' + e.message);
  process.exit(1);
} finally {
  await pool.end();
}
EOF
    ) && true
    if echo "$DB_CHECK_RESULT" | grep -q "^OK"; then
      pass "Database reachable (node pg)"
    else
      fail "Database connection failed: $DB_CHECK_RESULT"
    fi
  else
    warn "psql not found and pg module not installed — cannot verify DB connectivity"
    warn "Run 'npm install --omit=dev' first, then re-run this check"
  fi
fi

# =============================================================================
# 5. Filesystem permissions
# =============================================================================
section "Filesystem permissions"

check_writable() {
  local label="$1"
  local path="$2"
  mkdir -p "$path" 2>/dev/null || true
  if [[ -w "$path" ]]; then
    pass "$label ($path)"
  else
    fail "$label — not writable: $path"
  fi
}

check_writable "Logs directory"   "$RELEASE_DIR/logs"
check_writable "Temp directory"   "/tmp"
check_writable "Release root"     "$RELEASE_DIR"

# =============================================================================
# 6. PM2 configuration validation
# =============================================================================
section "PM2 configuration"

if command -v pm2 >/dev/null 2>&1; then
  # Check if a process named signalium-api is already running
  if pm2 describe signalium-api >/dev/null 2>&1; then
    PM2_STATUS="$(pm2 describe signalium-api 2>/dev/null | grep "status" | awk '{print $4}' | head -1)"
    warn "Process 'signalium-api' already in PM2 (status: ${PM2_STATUS:-unknown})"
    warn "Use 'pm2 reload ecosystem.config.cjs --env production' for zero-downtime update"
  else
    pass "No existing 'signalium-api' process (clean start)"
  fi

  # Validate ecosystem config is parseable
  if node -e "require('$RELEASE_DIR/ecosystem.config.cjs')" 2>/dev/null; then
    pass "ecosystem.config.cjs is valid (syntax OK)"
  else
    fail "ecosystem.config.cjs parse error — check file syntax"
  fi
else
  warn "PM2 not available — skipping PM2 checks"
fi

# =============================================================================
# 7. Port availability
# =============================================================================
section "Port availability"

if [[ -n "${PORT:-}" ]] && [[ "${PORT}" =~ ^[0-9]+$ ]]; then
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnp | grep -q ":${PORT} "; then
      HOLDER="$(ss -tlnp | grep ":${PORT} " | awk '{print $6}' | head -1)"
      # If it's already our process, that's fine (reload scenario)
      if echo "$HOLDER" | grep -q "node\|signalium"; then
        warn "Port $PORT in use by a Node.js process (existing signalium-api deployment)"
        warn "This is expected if you are performing a reload — use: pm2 reload ecosystem.config.cjs --env production"
      else
        fail "Port $PORT already in use by another process: $HOLDER"
      fi
    else
      pass "Port $PORT is free"
    fi
  else
    warn "ss not available — skipping port check"
  fi
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${BOLD}════════════════════════════════════════${NC}"
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ALL CHECKS PASSED ($PASS passed, 0 failed)${NC}"
  echo -e "${GREEN}${BOLD}  Safe to deploy.${NC}"
  echo -e "${BOLD}════════════════════════════════════════${NC}"
  echo ""
  if pm2 describe signalium-api >/dev/null 2>&1; then
    echo "  Zero-downtime reload:"
    echo "    pm2 reload ecosystem.config.cjs --env production"
  else
    echo "  Start the application:"
    echo "    pm2 start ecosystem.config.cjs --env production"
    echo "    pm2 save && pm2 startup"
  fi
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}  $FAIL CHECK(S) FAILED ($PASS passed, $FAIL failed)${NC}"
  echo -e "${RED}${BOLD}  Fix the issues above before deploying.${NC}"
  echo -e "${BOLD}════════════════════════════════════════${NC}"
  echo ""
  exit 1
fi
