# Signalium Platform — Production Deployment (Release Artifact Method)

This guide covers deploying Signalium using the pre-built release tarball. It
is the recommended path for automated / CI-CD deployments and for operators
who want to ship a tested, immutable build to the VPS without needing the full
development toolchain on the server.

For the manual source-based deployment method (git clone, build on server),
see [`DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md).

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
compiled migration runner + SQL migration files). The VPS only needs:
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
│   └── seed-admin.sh     Instructions for seeding the super-admin account
├── logs/                 PM2 log output (created empty)
├── ecosystem.config.cjs  PM2 process definition
├── package.json          Runtime npm dependencies only
├── .env.example          Environment variable template
└── BUILD_INFO            Git commit + build timestamp
```

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

The backend bundle externalises two packages (`nodemailer`, `@google-cloud/storage`)
because they use dynamic native bindings esbuild cannot inline. Install them:

```bash
npm install --omit=dev
```

This is fast (only 2 packages) and idempotent.

### 5. Configure environment variables

```bash
cp .env.example .env
nano .env          # fill in every CHANGE_ME value
```

Required values:

| Variable               | Description                                   |
|------------------------|-----------------------------------------------|
| `NODE_ENV`             | Must be `production`                          |
| `PORT`                 | Port the Node.js server listens on (e.g. 3000)|
| `DATABASE_URL`         | PostgreSQL connection string                  |
| `PUBLIC_APP_URL`       | Public URL of the app (no trailing slash)     |
| `ALLOWED_ORIGINS`      | Comma-separated list of allowed CORS origins  |
| `SESSION_SECRET`       | Random 32-byte hex (`openssl rand -hex 32`)   |
| `SECRETS_ENCRYPTION_KEY` | Random 32-byte hex (`openssl rand -hex 32`) |

See `.env.example` for the full list including optional payment/storage keys.

### 6. Verify the environment

```bash
./scripts/deploy-check.sh
```

All checks must pass before proceeding. Fix any failures (missing env vars,
DB connectivity, port conflicts) before continuing.

### 7. Run database migrations

```bash
./scripts/migrate.sh
```

This applies all pending SQL migration files in `dist/drizzle/` to the
database and records what has been applied (in `__drizzle_migrations`).
Safe to re-run — it only applies what's new.

### 8. Seed the super-admin account (first deploy only)

The seeder requires the full workspace source. Run it from your development
machine or from the VPS if you have the workspace source checked out there:

```bash
# On dev machine, pointing at the production DATABASE_URL
DATABASE_URL="postgresql://..." \
SUPER_ADMIN_EMAIL="admin@signaliumai.com" \
SUPER_ADMIN_PASSWORD="<strong-password>" \
pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
```

The script is idempotent — if the account exists it updates the password.

### 9. Start the application

```bash
# Load environment, then start via PM2
set -a; source .env; set +a
pm2 start ecosystem.config.cjs --env production
pm2 save       # persist the process list across reboots
pm2 startup    # follow the printed command to enable PM2 on boot
```

Verify it's running:

```bash
pm2 status
pm2 logs signalium-api --lines 50
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

### 11. Enable HTTPS (Let's Encrypt)

```bash
certbot --nginx -d signaliumai.com
```

Certbot edits the Nginx config automatically and sets up auto-renewal.

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
                                  5. rsync /tmp/release/ /var/www/signalium-platform-release/
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

# Sync build artifacts (preserves .env and logs/)
rsync -av --delete \
  --exclude='.env' \
  --exclude='logs/' \
  --exclude='node_modules/' \
  /tmp/signalium-platform-release/ \
  /var/www/signalium-platform-release/

cd /var/www/signalium-platform-release

# Install/update runtime deps
npm install --omit=dev

# Migrate (only applies new migration files — safe to run always)
set -a; source .env; set +a
./scripts/migrate.sh

# Verify environment
./scripts/deploy-check.sh

# Zero-downtime reload
# PM2 sends SIGINT to the old process, waits for it to exit cleanly,
# then starts the new process. Nginx upstream buffering absorbs the gap.
pm2 reload ecosystem.config.cjs --env production

# Confirm clean startup
pm2 logs signalium-api --lines 30 --nostream
```

---

## CI/CD pipeline integration

The build and package scripts are designed to run headlessly in any CI runner
(GitHub Actions, GitLab CI, Drone, etc.).

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
        cd /var/www &&
        tar xzf signalium-platform-release*.tar.gz -C /tmp/ &&
        rsync -av --delete
          --exclude=".env" --exclude="logs/" --exclude="node_modules/"
          /tmp/signalium-platform-release/
          /var/www/signalium-platform-release/ &&
        cd signalium-platform-release &&
        npm install --omit=dev &&
        source .env &&
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
- `exec_mode: fork` in `ecosystem.config.cjs` (required for ESM `.mjs`)
- `proxy_buffering on` in Nginx (already in the config template)
- The application handles SIGINT and drains connections before exiting
  (Express default behaviour on SIGINT is to close the HTTP server)

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
pm2 reload ecosystem.config.cjs --env production
```

**Note on database rollbacks:** If the new release ran migrations that the
old build doesn't understand, rolling back the code alone may leave the schema
incompatible. Always review migration files before deploying and maintain a
recent database backup (`pg_dump`) before each release.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `pm2 start` exits immediately | Missing env vars or DB not reachable | Check `pm2 logs signalium-api`; run `./scripts/deploy-check.sh` |
| `502 Bad Gateway` from Nginx | Backend not running | `pm2 status`, `pm2 logs signalium-api` |
| `404` on all API routes | Nginx proxy_pass port mismatch | Confirm `PORT` in `.env` matches Nginx `proxy_pass` port |
| Blank page (frontend loads, no data) | CORS or API URL wrong | Check `ALLOWED_ORIGINS` and `PUBLIC_APP_URL` in `.env` |
| `ECONNREFUSED` in logs | `DATABASE_URL` wrong or Postgres down | `./scripts/deploy-check.sh`, `systemctl status postgresql` |
| Migrations fail with `already exists` | Schema applied by `push` without migration tracking | Back up DB; see DEPLOYMENT_GUIDE.md §Troubleshooting |
| Source maps don't resolve | `--enable-source-maps` not in PM2 node_args | Check `ecosystem.config.cjs` — `node_args: "--enable-source-maps"` |

For issues not covered here, check the application startup logs:

```bash
pm2 logs signalium-api --lines 100 --nostream
```

The startup diagnostic block (`Startup diagnostic: dependency readiness report`)
is logged on every boot and shows which integrations are configured vs
unconfigured.
