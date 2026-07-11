#!/usr/bin/env bash
# =============================================================================
# scripts/build-release.sh — Signalium Platform Production Build
# =============================================================================
#
# Produces a self-contained release/ directory ready for packaging and VPS
# deployment.  Run this on any Linux/macOS machine that has Node >= 20 and
# pnpm installed.
#
# Usage:
#   ./scripts/build-release.sh                 # defaults: PORT=3000 BASE_PATH=/
#   PORT=8080 BASE_PATH=/ ./scripts/build-release.sh
#
# What it does:
#   1. Validates the build environment
#   2. Installs all workspace dependencies (frozen lockfile)
#   3. Applies the recurring orval zod.looseObject patch (generated API types)
#   4. Type-checks all shared libraries (tsc project references)
#   5. Builds the frontend (Vite → release/dist/public/)
#   6. Builds the backend  (esbuild → release/dist/server/)
#   7. Bundles the migration runner (esbuild → release/dist/server/migrate.mjs)
#   8. Copies SQL migration files    (→ release/dist/drizzle/)
#   9. Assembles the full release/ layout (package.json, ecosystem config, scripts)
#  10. Creates logs/ directory and .env.example
#
# Output layout:
#   release/
#   ├── dist/
#   │   ├── public/         Frontend SPA (served by Nginx)
#   │   ├── server/         Bundled Node.js backend + migrate.mjs
#   │   └── drizzle/        SQL migration files (read by migrate.mjs)
#   ├── scripts/
#   │   ├── migrate.sh      Run pending DB migrations
#   │   └── seed-admin.sh   Seed the super-admin account (first deploy only)
#   ├── logs/               Created empty; PM2 writes logs here
#   ├── config/
#   │   └── nginx.conf      Nginx site config template
#   ├── ecosystem.config.cjs  PM2 process definition
#   ├── package.json          Runtime-only npm dependencies
#   └── .env.example          Environment variable template
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step()  { echo -e "\n${BOLD}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}✔ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }
die()   { echo -e "${RED}✖ $*${NC}" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$WORKSPACE_ROOT/release"

# Vite requires PORT at config-eval time (even for builds). The value only
# affects the dev server, so any valid port number is acceptable here.
BUILD_PORT="${PORT:-3000}"

# BASE_PATH controls the Vite `base` option. For a VPS served at the domain
# root (e.g. https://signaliumai.com), this must be "/".
BUILD_BASE_PATH="${BASE_PATH:-/}"

# ---------------------------------------------------------------------------
# Step 0 — Validate environment
# ---------------------------------------------------------------------------
step "Validating build environment"

node_version=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1) || die "Node.js not found"
[[ "$node_version" -ge 20 ]] || die "Node.js >= 20 required (found v$node_version)"
ok "Node.js v$(node --version)"

command -v pnpm >/dev/null 2>&1 || die "pnpm not found. Install: npm install -g pnpm"
ok "pnpm $(pnpm --version)"

cd "$WORKSPACE_ROOT"

# ---------------------------------------------------------------------------
# Step 1 — Clean previous release
# ---------------------------------------------------------------------------
step "Cleaning previous release"
rm -rf "$RELEASE_DIR"
ok "release/ removed"

# ---------------------------------------------------------------------------
# Step 2 — Install workspace dependencies
# ---------------------------------------------------------------------------
step "Installing dependencies (frozen lockfile)"
pnpm install --frozen-lockfile
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# Step 3 — Apply recurring orval zod.looseObject patch
# ---------------------------------------------------------------------------
# The code-generator emits zod.looseObject() which was removed in zod v3.24.
# Re-apply the patch every build since codegen may regenerate the file.
step "Patching generated API types (zod.looseObject → zod.object)"
GENERATED_API="$WORKSPACE_ROOT/lib/api-zod/src/generated/api.ts"
if [[ -f "$GENERATED_API" ]]; then
  sed -i 's/zod\.looseObject(/zod.object(/g' "$GENERATED_API"
  ok "Patch applied to lib/api-zod/src/generated/api.ts"
else
  warn "Generated API file not found — skipping patch (may fail typecheck)"
fi

# ---------------------------------------------------------------------------
# Step 4 — Type-check shared libraries
# ---------------------------------------------------------------------------
step "Type-checking shared libraries"
pnpm run typecheck:libs
ok "tsc project references — clean"

# ---------------------------------------------------------------------------
# Step 5 — Build frontend
# ---------------------------------------------------------------------------
step "Building frontend (Vite) → release/dist/public/"
NODE_ENV=production PORT="$BUILD_PORT" BASE_PATH="$BUILD_BASE_PATH" \
  pnpm --filter @workspace/signalium run build
ok "Frontend build complete"

# ---------------------------------------------------------------------------
# Step 6 — Build backend
# ---------------------------------------------------------------------------
step "Building backend (esbuild) → artifacts/api-server/dist/"
pnpm --filter @workspace/api-server run build
ok "Backend build complete"

# ---------------------------------------------------------------------------
# Step 7 — Bundle migration runner
# ---------------------------------------------------------------------------
step "Bundling migration runner → release/dist/server/migrate.mjs"
mkdir -p "$RELEASE_DIR/dist/server"
node "$WORKSPACE_ROOT/scripts/build-migrate.mjs"
ok "Migration runner bundled"

# ---------------------------------------------------------------------------
# Step 8 — Assemble release/ layout
# ---------------------------------------------------------------------------
step "Assembling release/ directory"

# Frontend
mkdir -p "$RELEASE_DIR/dist/public"
cp -r "$WORKSPACE_ROOT/artifacts/signalium/dist/public/." "$RELEASE_DIR/dist/public/"
ok "dist/public/ — frontend copied"

# Backend bundle (index.mjs + pino workers)
# migrate.mjs was already written directly to release/dist/server/ in step 7
cp -r "$WORKSPACE_ROOT/artifacts/api-server/dist/." "$RELEASE_DIR/dist/server/"
ok "dist/server/ — backend bundle copied"

# SQL migration files
# migrate.mjs references path.join(__dirname, "../drizzle") → dist/drizzle/
mkdir -p "$RELEASE_DIR/dist/drizzle"
cp -r "$WORKSPACE_ROOT/lib/db/drizzle/." "$RELEASE_DIR/dist/drizzle/"
ok "dist/drizzle/ — SQL migration files copied"

# PM2 ecosystem config
cp "$WORKSPACE_ROOT/ecosystem.config.cjs" "$RELEASE_DIR/ecosystem.config.cjs"
ok "ecosystem.config.cjs copied"

# Logs directory (PM2 writes here; created empty so PM2 doesn't warn)
mkdir -p "$RELEASE_DIR/logs"
ok "logs/ created"

# ---------------------------------------------------------------------------
# Step 9 — Runtime package.json
# ---------------------------------------------------------------------------
# The backend bundle externalises nodemailer and @google-cloud/storage because
# they use dynamic requires or native bindings that esbuild cannot inline.
# These must be installed on the VPS via: npm install --omit=dev
step "Writing release/package.json (runtime dependencies only)"
cat > "$RELEASE_DIR/package.json" <<'PKGJSON'
{
  "name": "signalium-platform",
  "version": "1.0.0",
  "description": "Signalium Platform — production build",
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start":   "pm2 start ecosystem.config.cjs --env production",
    "reload":  "pm2 reload ecosystem.config.cjs --env production",
    "stop":    "pm2 stop signalium-api",
    "migrate": "node dist/server/migrate.mjs",
    "logs":    "pm2 logs signalium-api --lines 100"
  },
  "dependencies": {
    "@google-cloud/storage": "^7.21.0",
    "nodemailer": "^9.0.3"
  }
}
PKGJSON
ok "release/package.json written"

# ---------------------------------------------------------------------------
# Step 10 — Production scripts
# ---------------------------------------------------------------------------
step "Writing release/scripts/"
mkdir -p "$RELEASE_DIR/scripts"

cat > "$RELEASE_DIR/scripts/migrate.sh" <<'MIGSH'
#!/usr/bin/env bash
# Run pending database migrations.
# Must be executed from the release/ directory.
# Requires DATABASE_URL to be set in the environment (or loaded from .env).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$RELEASE_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$RELEASE_DIR/.env"
  set +a
fi

[[ -n "${DATABASE_URL:-}" ]] || { echo "ERROR: DATABASE_URL is not set" >&2; exit 1; }

echo "Running database migrations..."
cd "$RELEASE_DIR"
node dist/server/migrate.mjs
echo "Migrations complete."
MIGSH
chmod +x "$RELEASE_DIR/scripts/migrate.sh"

cat > "$RELEASE_DIR/scripts/seed-admin.sh" <<'SEEDSH'
#!/usr/bin/env bash
# Seed the super-admin account (first deploy only).
# Must be executed from the release/ directory with the full workspace source
# available (the seeder uses tsx and imports from src/).
#
# Usage:
#   SUPER_ADMIN_EMAIL=admin@example.com \
#   SUPER_ADMIN_PASSWORD=changeme123 \
#   ./scripts/seed-admin.sh
#
# Note: Run this from the workspace root, not the release/ directory:
#   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... \
#   pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
echo "⚠  The seed-admin script must be run from the workspace source directory."
echo "   From the workspace root:"
echo ""
echo "   SUPER_ADMIN_EMAIL=admin@signaliumai.com \\"
echo "   SUPER_ADMIN_PASSWORD='<strong-password>' \\"
echo "   pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts"
SEEDSH
chmod +x "$RELEASE_DIR/scripts/seed-admin.sh"

ok "release/scripts/ written"

# ---------------------------------------------------------------------------
# Step 11 — Nginx config template
# ---------------------------------------------------------------------------
step "Writing release/config/nginx.conf template"
mkdir -p "$RELEASE_DIR/config"
cat > "$RELEASE_DIR/config/nginx.conf" <<'NGINXCONF'
# Signalium Platform — Nginx site configuration template
# Copy to /etc/nginx/sites-available/signalium, edit the placeholders,
# then run: ln -s /etc/nginx/sites-available/signalium /etc/nginx/sites-enabled/
#           nginx -t && systemctl reload nginx
#
# Placeholders to replace:
#   YOUR_DOMAIN   — e.g. signaliumai.com
#   BACKEND_PORT  — must match PORT in your .env (e.g. 3000)
#   RELEASE_PATH  — absolute path to the release/ directory on the server
#                   e.g. /var/www/signalium/release

server {
    listen 80;
    server_name YOUR_DOMAIN;

    # Redirect all HTTP to HTTPS once SSL is configured.
    # During initial setup, comment out the return line and use the block below.
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name YOUR_DOMAIN;

    # SSL — populated automatically by Certbot (certbot --nginx -d YOUR_DOMAIN)
    # ssl_certificate     /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;
    # include             /etc/letsencrypt/options-ssl-nginx.conf;
    # ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # Frontend SPA
    root RELEASE_PATH/dist/public;
    index index.html;

    # Serve static assets with long-lived cache headers.
    # Vite content-hashes filenames so this is safe.
    location ~* \.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # All other paths → SPA fallback (React Router handles client-side routing)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API routes → backend
    location /api/ {
        proxy_pass         http://127.0.0.1:BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        # Buffer upstream responses during zero-downtime PM2 reloads.
        proxy_buffering    on;
        proxy_buffer_size  16k;
        proxy_buffers      8 16k;
    }

    # WebSocket connections (EA gateway + admin ops)
    location /ws/ {
        proxy_pass         http://127.0.0.1:BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }
}
NGINXCONF
ok "release/config/nginx.conf template written"

# ---------------------------------------------------------------------------
# Step 12 — .env.example
# ---------------------------------------------------------------------------
step "Writing release/.env.example"
cat > "$RELEASE_DIR/.env.example" <<'ENVEX'
# =============================================================================
# Signalium Platform — Environment Variables
# =============================================================================
# Copy this file to .env and fill in every value before starting the app.
# Never commit .env to version control.
#
# Generate secrets:  openssl rand -hex 32

# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
NODE_ENV=production
PORT=3000

# Full PostgreSQL connection string
DATABASE_URL=postgresql://signalium_user:CHANGE_ME@localhost:5432/signalium

# Public URL of the app (no trailing slash)
PUBLIC_APP_URL=https://signaliumai.com

# Comma-separated list of allowed CORS origins
ALLOWED_ORIGINS=https://signaliumai.com

# Session signing key — generate: openssl rand -hex 32
SESSION_SECRET=CHANGE_ME

# Config vault encryption key — generate: openssl rand -hex 32
SECRETS_ENCRYPTION_KEY=CHANGE_ME

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL=info

# ---------------------------------------------------------------------------
# Object storage (optional — only if file uploads are used)
# ---------------------------------------------------------------------------
# PRIVATE_OBJECT_DIR=
# PUBLIC_OBJECT_SEARCH_PATHS=

# ---------------------------------------------------------------------------
# Payments (fill in the providers you actually use)
# ---------------------------------------------------------------------------
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
# PAYPAL_CLIENT_ID=
# PAYPAL_CLIENT_SECRET=
# PAYPAL_ENV=live
# PAYPAL_WEBHOOK_ID=
# FLUTTERWAVE_SECRET_KEY=
# FLUTTERWAVE_WEBHOOK_HASH=

# ---------------------------------------------------------------------------
# Compliance / ops (sensible defaults if omitted)
# ---------------------------------------------------------------------------
# AUDIT_LOG_RETENTION_DAYS=365
# BACKUP_RETENTION_DAYS=30
ENVEX
ok ".env.example written"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}============================================================${NC}"
echo -e "${GREEN}${BOLD}  Release build complete → release/${NC}"
echo -e "${GREEN}${BOLD}============================================================${NC}"
echo ""
echo "  dist/public/              Frontend SPA"
echo "  dist/server/              Backend bundle (Node.js)"
echo "  dist/drizzle/             SQL migration files"
echo "  ecosystem.config.cjs      PM2 process definition"
echo "  package.json              Runtime dependencies"
echo "  scripts/migrate.sh        Run DB migrations on VPS"
echo "  config/nginx.conf         Nginx site config template"
echo "  .env.example              Environment variable template"
echo ""
echo "Next steps:"
echo "  1. Run ./scripts/package-release.sh to create the tarball"
echo "  2. Transfer signalium-platform-release.tar.gz to your VPS"
echo "  3. Follow docs/PRODUCTION_DEPLOYMENT.md for the deploy steps"
echo ""
