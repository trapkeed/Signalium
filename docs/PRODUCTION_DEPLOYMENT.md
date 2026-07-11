# Signalium Platform — Production Deployment (Release Artifact Method)

This guide covers deploying Signalium using the pre-built release tarball on a
Ubuntu VPS that may already be running other websites. Every destructive step is
clearly marked — the other sites on your server are never touched.

For the manual source-based method (git clone + build on server), see
[`DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md).

---

## Table of contents

1. [Overview](#overview)
2. [Release layout](#release-layout)
3. [Replacing an existing Signalium installation](#replacing-an-existing-signalium-installation)
4. [First deploy (clean server)](#first-deploy)
5. [Updating an existing deployment (zero downtime)](#updating-an-existing-deployment)
6. [CI/CD pipeline integration](#cicd-pipeline-integration)
7. [Zero-downtime reload explained](#zero-downtime-reload-explained)
8. [Rollback](#rollback)
9. [Troubleshooting](#troubleshooting)

---

## Overview

```
Developer machine / CI runner          VPS
─────────────────────────────          ──────────────────────────
1. ./scripts/build-release.sh   ─┐
2. ./scripts/package-release.sh  ├─► signalium-platform-release.tar.gz
                                 │
                                 └──► scp to VPS
                                             │
                                             ▼
                                  3. tar xzf ...
                                  4. npm install --omit=dev
                                  5. ./scripts/migrate.sh
                                  6. pm2 start / pm2 reload
```

The tarball is fully self-contained (frontend SPA + bundled Node.js backend +
compiled migration runner + SQL migration files). The VPS only needs
Node.js ≥ 20, PM2, and optionally Nginx.

---

## Release layout

```
signalium-platform-release/
├── dist/
│   ├── public/           Frontend SPA — serve with Nginx
│   ├── server/           Node.js backend bundle (index.mjs) + migrate.mjs
│   └── drizzle/          SQL migration files (read by migrate.mjs)
├── config/
│   └── nginx.conf        Nginx site config template (edit placeholders)
├── scripts/
│   ├── migrate.sh        Run pending DB migrations
│   ├── deploy-check.sh   Pre-deploy environment verifier
│   └── seed-admin.sh     Instructions for seeding the super-admin account
├── logs/                 PM2 log output (created empty)
├── ecosystem.config.cjs  PM2 process definition
├── package.json          Runtime npm dependencies only
├── .env.example          Environment variable template
└── BUILD_INFO            Git commit + build timestamp
```

**Runtime dependencies** (`npm install --omit=dev` installs these three):

| Package | Why it must be external |
|---------|------------------------|
| `@google-cloud/storage` | Native gRPC bindings esbuild cannot inline |
| `@swc/helpers` | Called directly by fontkit (used by pdfkit); no try/catch guard |
| `nodemailer` | Dynamic transport resolution at runtime |

---

## Replacing an existing Signalium installation

> **⚠ This section permanently and irreversibly destroys data.**
> The database and all files for the old site will be gone. There is no undo.
> Your other three websites are not affected — the steps below only touch
> the Signalium PM2 process, the Signalium Nginx site config, the Signalium
> PostgreSQL database, and the Signalium files directory.

Before you begin, take a manual backup in case you want to recover anything:

```bash
# Snapshot the old database (adjust DB name / user as needed)
pg_dump -U postgres signalium_db > ~/signalium_db_FINAL_BACKUP_$(date +%Y%m%d).sql

# Note where the old files are
pm2 show signalium-api | grep -E "cwd|script"
```

### Step R1 — Stop and remove the old PM2 process

```bash
# Stop the process and remove it from PM2's process list
pm2 stop  signalium-api
pm2 delete signalium-api

# Save the updated (smaller) process list — so PM2 doesn't restart the old
# process after a server reboot
pm2 save --force
```

> **Other sites:** `pm2 stop signalium-api` only stops the process named
> `signalium-api`. Every other PM2 process continues running unaffected.

### Step R2 — Remove the old Nginx site config

```bash
# Disable the site (do NOT touch any other file in sites-enabled/)
SIGNALIUM_CONF=$(grep -rl "signalium\|signaliumai" /etc/nginx/sites-enabled/)
echo "Will remove: $SIGNALIUM_CONF"   # verify it's the right file
```

Confirm the output is only the Signalium config, then:

```bash
rm "$SIGNALIUM_CONF"

# Also remove the source file in sites-available
SIGNALIUM_AVAIL=$(grep -rl "signalium\|signaliumai" /etc/nginx/sites-available/)
echo "Will remove: $SIGNALIUM_AVAIL"   # verify
rm "$SIGNALIUM_AVAIL"

# Test and reload (your other sites stay up during this reload)
nginx -t && systemctl reload nginx
```

> **Other sites:** `systemctl reload nginx` applies the new config gracefully —
> all other virtual hosts continue serving requests with zero interruption.

### Step R3 — Drop the old database permanently

```bash
# Identify the database name first
psql -U postgres -c "\l" | grep -i signalium
```

> **⚠ The next command permanently deletes all data in that database.**

```bash
# Replace "signalium_db" with the actual name from the listing above
psql -U postgres -c "DROP DATABASE signalium_db;"
```

If the command fails with `ERROR: database is being accessed by other users`,
the old Node.js process is still running. Repeat Step R1, wait 5 seconds, then
retry the DROP.

> **Other databases:** PostgreSQL DROP DATABASE only removes the named database.
> Every other database on the server is untouched.

### Step R4 — Delete the old site files

```bash
# Identify the old directory (use the path you noted at the start)
OLD_DIR="/var/www/signalium-old"   # adjust to your actual path
echo "Will permanently delete: $OLD_DIR"
ls "$OLD_DIR"                       # one last look before deletion
```

```bash
# Permanently delete
rm -rf "$OLD_DIR"
```

### Step R5 — Create a fresh PostgreSQL database for the new deployment

```bash
# Create a dedicated user and database
psql -U postgres <<SQL
CREATE USER signalium WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE signalium_db OWNER signalium;
GRANT ALL PRIVILEGES ON DATABASE signalium_db TO signalium;
SQL
```

Your `DATABASE_URL` for the new `.env` will be:

```
DATABASE_URL=postgresql://signalium:choose-a-strong-password@localhost:5432/signalium_db
```

You can now proceed to [First deploy](#first-deploy) below — the server is
clean, the URL is free, and the other sites are still running normally.

---

## First deploy

### 1. Build the release (on your development machine or CI runner)

Prerequisites: Node.js ≥ 20, pnpm.

```bash
# From the workspace root
./scripts/build-release.sh
./scripts/package-release.sh
```

This produces `signalium-platform-release.tar.gz` in the workspace root.

### 2. Transfer to the VPS

```bash
scp signalium-platform-release.tar.gz user@your-server:/var/www/
```

### 3. Extract on the VPS

```bash
ssh user@your-server
cd /var/www
tar xzf signalium-platform-release.tar.gz
cd signalium-platform-release
```

### 4. Install runtime dependencies

```bash
npm install --omit=dev
```

Installs the three external runtime packages and their transitive deps (~90
packages, ~16 MB). Fast and idempotent.

### 5. Configure environment variables

```bash
cp .env.example .env
nano .env          # fill in every CHANGE_ME value
```

Required variables:

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Must be `production` |
| `PORT` | Port the Node.js server listens on (e.g. 3000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `PUBLIC_APP_URL` | Public URL of the app (no trailing slash) |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins |
| `SESSION_SECRET` | Random 32-byte hex — `openssl rand -hex 32` |
| `SECRETS_ENCRYPTION_KEY` | Random 32-byte hex — `openssl rand -hex 32` |

See `.env.example` for the full list including optional payment/storage keys.

### 6. Verify the environment

```bash
./scripts/deploy-check.sh
```

Expected output: **20+ checks pass, 0 failures**. The script checks Node.js
version, PM2, all required env vars, database connectivity, filesystem
permissions, build artifact presence, and port availability.

Fix any `[FAIL]` lines before continuing. `[WARN]` lines (e.g. optional Stripe
key not set) are non-blocking.

### 7. Run database migrations

```bash
set -a; source .env; set +a
./scripts/migrate.sh
```

Applies all SQL migration files in `dist/drizzle/` and records what was applied
in `__drizzle_migrations`. Safe to re-run — only new migrations are executed.

On a fresh database (as created in Step R5 above) all migrations will run from
scratch, including creating every table, type, and index.

### 8. Seed the super-admin account (first deploy only)

The seeder uses TypeScript source and must run from the development workspace.
Run it on your dev machine pointing at the production database:

```bash
DATABASE_URL="postgresql://signalium:password@your-server:5432/signalium_db" \
SUPER_ADMIN_EMAIL="admin@signaliumai.com" \
SUPER_ADMIN_PASSWORD="<strong-password>" \
pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
```

The script is idempotent — re-running it updates the password rather than
creating a duplicate account.

### 9. Start the application

```bash
# Load .env into the shell, then start via PM2
set -a; source .env; set +a

pm2 start ecosystem.config.cjs --env production
pm2 save       # persist the process list across reboots
pm2 startup    # copy and run the printed command to enable PM2 on boot
```

Verify it's running:

```bash
pm2 status
pm2 logs signalium-api --lines 50
```

A healthy startup ends with the startup diagnostic block:

```
Server listening  port=3000
required_env_vars: ok
database: ok
pgBroadcast: LISTEN connection established
```

### 10. Configure Nginx

```bash
# Edit the template — replace YOUR_DOMAIN, BACKEND_PORT, RELEASE_PATH
cp config/nginx.conf /etc/nginx/sites-available/signalium
nano /etc/nginx/sites-available/signalium

# Enable and reload
ln -s /etc/nginx/sites-available/signalium /etc/nginx/sites-enabled/
nginx -t                  # must say "syntax is ok"
systemctl reload nginx
```

> **Other sites:** `systemctl reload nginx` applies changes gracefully. Your
> other three sites are not affected.

### 11. Enable HTTPS (Let's Encrypt)

```bash
certbot --nginx -d signaliumai.com
```

Certbot edits only the Signalium Nginx config and sets up auto-renewal.
Other site certificates are unaffected.

---

## Updating an existing deployment (zero downtime)

```
Developer machine / CI runner          VPS
─────────────────────────────          ──────────────────────────
1. git pull (new code)
2. ./scripts/build-release.sh
3. ./scripts/package-release.sh   ──► scp to VPS
                                             │
                                             ▼
                                  4. tar xzf ... -C /tmp/
                                  5. rsync /tmp/release/ → /var/www/signalium-platform-release/
                                  6. npm install --omit=dev
                                  7. ./scripts/migrate.sh
                                  8. ./scripts/deploy-check.sh
                                  9. pm2 reload ecosystem.config.cjs --env production
```

Steps 4–9 expanded:

```bash
ssh user@your-server
cd /var/www

# Extract to a temp location
tar xzf signalium-platform-release.tar.gz -C /tmp/

# Sync build artifacts — preserves .env and logs/
rsync -av --delete \
  --exclude='.env' \
  --exclude='logs/' \
  --exclude='node_modules/' \
  /tmp/signalium-platform-release/ \
  /var/www/signalium-platform-release/

cd /var/www/signalium-platform-release

# Install/update runtime deps
npm install --omit=dev

# Migrate (only applies new migration files — always safe to run)
set -a; source .env; set +a
./scripts/migrate.sh

# Verify environment
./scripts/deploy-check.sh

# Zero-downtime reload — SIGINT to old process, start new process, Nginx
# upstream buffering absorbs the brief gap (see explanation section below)
pm2 reload ecosystem.config.cjs --env production

# Confirm clean startup
pm2 logs signalium-api --lines 30 --nostream

# Clean up tarball
rm -f /var/www/signalium-platform-release-*.tar.gz /tmp/signalium-platform-release.tar.gz
```

---

## CI/CD pipeline integration

### GitHub Actions example

```yaml
# .github/workflows/deploy.yml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Build release
        run: ./scripts/build-release.sh
        env:
          PORT: 3000
          BASE_PATH: /

      - name: Package release
        run: VERSION=${{ github.sha }} ./scripts/package-release.sh

      - name: Transfer to VPS
        run: |
          scp signalium-platform-release-*.tar.gz \
            ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/var/www/

      - name: Deploy on VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            set -euo pipefail
            cd /var/www
            tar xzf signalium-platform-release-*.tar.gz -C /tmp/
            rsync -av --delete \
              --exclude='.env' --exclude='logs/' --exclude='node_modules/' \
              /tmp/signalium-platform-release/ \
              /var/www/signalium-platform-release/
            cd /var/www/signalium-platform-release
            npm install --omit=dev
            set -a; source .env; set +a
            ./scripts/migrate.sh
            ./scripts/deploy-check.sh
            pm2 reload ecosystem.config.cjs --env production
            rm -f /var/www/signalium-platform-release-*.tar.gz
```

### GitLab CI example

```yaml
# .gitlab-ci.yml
stages:
  - build
  - deploy

build:
  stage: build
  image: node:20
  before_script:
    - npm install -g pnpm
  script:
    - ./scripts/build-release.sh
    - VERSION=$CI_COMMIT_SHORT_SHA ./scripts/package-release.sh
  artifacts:
    paths:
      - signalium-platform-release*.tar.gz
    expire_in: 1 hour

deploy:
  stage: deploy
  script:
    - scp signalium-platform-release*.tar.gz $DEPLOY_USER@$DEPLOY_HOST:/var/www/
    - ssh $DEPLOY_USER@$DEPLOY_HOST '
        set -euo pipefail
        cd /var/www &&
        tar xzf signalium-platform-release*.tar.gz -C /tmp/ &&
        rsync -av --delete
          --exclude=".env" --exclude="logs/" --exclude="node_modules/"
          /tmp/signalium-platform-release/
          /var/www/signalium-platform-release/ &&
        cd signalium-platform-release &&
        npm install --omit=dev &&
        set -a; source .env; set +a &&
        ./scripts/migrate.sh &&
        ./scripts/deploy-check.sh &&
        pm2 reload ecosystem.config.cjs --env production
      '
  environment: production
  only:
    - main
```

---

## Zero-downtime reload explained

```
                    PM2 reload timeline
┌──────────────────────────────────────────────────────────┐
│  t=0   pm2 reload issued                                  │
│  t=0   PM2 sends SIGINT to old process                    │
│  t=0   Nginx upstream buffering holds in-flight requests  │
│  t=1s  Old process finishes active requests, exits 0      │
│  t=1s  PM2 starts new process                             │
│  t=3s  New process HTTP server is up (listen_timeout=10s) │
│  t=3s  Nginx routes traffic to new process                │
│  t=3s  Buffered requests served by new process            │
└──────────────────────────────────────────────────────────┘
```

**Requirements:**
- `exec_mode: fork` in `ecosystem.config.cjs` (required for ESM `.mjs` entry points — cluster mode is incompatible with ESM)
- `proxy_buffering on` in Nginx (already in the config template)
- The application handles SIGINT and drains connections before exiting (Express default behaviour)

---

## Rollback

If a deployment causes issues, roll back to the previous build:

```bash
# On the VPS — if you kept the previous tarball
cd /var/www
tar xzf signalium-platform-release-PREVIOUS.tar.gz -C /tmp/
rsync -av --delete \
  --exclude='.env' --exclude='logs/' --exclude='node_modules/' \
  /tmp/signalium-platform-release/ \
  /var/www/signalium-platform-release/
cd /var/www/signalium-platform-release
npm install --omit=dev
set -a; source .env; set +a
pm2 reload ecosystem.config.cjs --env production
```

**Note on database rollbacks:** If the new release ran migrations that the
old build doesn't understand, rolling back the code alone may leave the schema
incompatible. Always review migration files before deploying and take a
`pg_dump` backup before each release.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `pm2 start` exits immediately | Missing env vars or DB not reachable | Check `pm2 logs signalium-api`; run `./scripts/deploy-check.sh` |
| `502 Bad Gateway` from Nginx | Backend not running | `pm2 status`, `pm2 logs signalium-api` |
| `404` on all API routes | Nginx `proxy_pass` port mismatch | Confirm `PORT` in `.env` matches Nginx `proxy_pass` port |
| Blank page (frontend loads, no data) | CORS or API URL wrong | Check `ALLOWED_ORIGINS` and `PUBLIC_APP_URL` in `.env` |
| `ECONNREFUSED` in logs | `DATABASE_URL` wrong or Postgres down | `./scripts/deploy-check.sh`, `systemctl status postgresql` |
| `Cannot find package '@swc/helpers'` | `npm install --omit=dev` not run after extracting tarball | Run `npm install --omit=dev` in the release directory |
| Migrations fail with `already exists` | Schema was applied by `push` without migration tracking | Back up DB; see DEPLOYMENT_GUIDE.md §Troubleshooting |
| `DROP DATABASE` fails with "being accessed by other users" | Old Node.js process still running | Repeat Step R1, wait 5 s, retry |
| Source maps don't resolve | `--enable-source-maps` not in PM2 node_args | Check `ecosystem.config.cjs` — `node_args: "--enable-source-maps"` |
| Other sites down after Nginx reload | Nginx config syntax error | `nginx -t` before every `systemctl reload nginx` |

For issues not covered here, check the application startup logs:

```bash
pm2 logs signalium-api --lines 100 --nostream
```

The startup diagnostic block (`Startup diagnostic: dependency readiness report`)
is logged on every boot and shows exactly which env vars and integrations are
configured vs missing.
