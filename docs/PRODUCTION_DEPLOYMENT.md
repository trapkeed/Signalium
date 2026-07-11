# Signalium Platform — Production Deployment Guide

**Server:** `root@198.177.123.71`
**Deploy path:** `/var/www/signalium`
**Live URL:** `https://signaliumai.com`
**Trainer URL:** `https://trainer.signaliumai.com`
**Database:** `signalium` · **DB user:** `signalium_user`

This guide deploys Signalium from a pre-built release tarball. The VPS already
runs three other websites — nothing in these steps touches them.

---

## Table of contents

1. [Overview](#overview)
2. [Prerequisites (one-time)](#prerequisites-one-time)
3. [Replacing the old Signalium site](#replacing-the-old-signalium-site) ← **do this first**
4. [Step 1 — Build the release tarball](#step-1--build-the-release-tarball)
5. [Step 2 — Transfer to the server](#step-2--transfer-to-the-server)
   - [Option A — FileZilla (SFTP)](#option-a--filezilla-sftp)
   - [Option B — GitHub Actions (automated)](#option-b--github-actions-automated)
   - [Option C — SCP (command line)](#option-c--scp-command-line)
6. [Steps 3–9 — Extract, configure, and start](#step-3--extract-on-the-server)
7. [Steps 10–11 — Nginx + HTTPS](#step-10--configure-nginx)
8. [Updating an existing deployment](#updating-an-existing-deployment)
9. [Rollback](#rollback)
10. [Troubleshooting](#troubleshooting)

---

## Overview

```
Replit (this workspace)                VPS (198.177.123.71)
───────────────────────                ─────────────────────────────
                                       [R0] Find PM2 process name
                                       [R1] Stop + delete PM2 process
                                       [R2] Remove old Nginx vhost
                                       [R3] Save DB credentials, drop DB
                                       [R4] Delete old source files
                                       [R5] Create fresh database
                                                ↓
Step 1. Build release tarball
Step 2. Transfer  ──────────────────►  Step 3. Extract
  FileZilla  ─ drag .tar.gz via SFTP   Step 4. npm install --omit=dev
  GitHub Actions  ─ auto on git push   Step 5. Create .env
  scp  ─ command line                  Step 6. deploy-check
                                       Step 7. DB migrations
                                       Step 8. Seed super-admin
                                       Step 9. PM2 start
                                       Step 10. Nginx config
                                       Step 11. HTTPS (Let's Encrypt)
```

---

## Prerequisites (one-time)

SSH in and install Node.js 20 + PM2 if not already present:

```bash
ssh root@198.177.123.71

node -v          # must be v20 or higher
pm2 -v           # must exist

# Install Node.js 20 if missing
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2 if missing
npm install -g pm2
```

---

## Replacing the old Signalium site

> **⚠ Permanently destroys the old site's data and files. No undo.**
> Your other three websites, their databases, and their Nginx vhosts are
> not touched.

Take a final backup before you start:

```bash
ssh root@198.177.123.71
pg_dump -U postgres signalium > ~/signalium_FINAL_BACKUP_$(date +%Y%m%d).sql
ls -lh ~/signalium_FINAL_BACKUP_*.sql      # confirm the file was written
```

---

### R0 — Find the old PM2 process name

```bash
pm2 list
```

Look at the **name** column. It may be `signalium-api`, `api-server`,
`signalium`, or something else depending on how the old site was started.
**Note the exact name** — you need it for R1.

Example output:

```
┌────┬───────────────┬─────────┬──────┬───────────┐
│ id │ name          │ mode    │ pid  │ status    │
├────┼───────────────┼─────────┼──────┼───────────┤
│  0 │ signalium-api │ fork    │ 1234 │ online    │
│  1 │ other-site    │ cluster │ 5678 │ online    │
└────┴───────────────┴─────────┴──────┴───────────┘
```

---

### R1 — Stop and remove the old PM2 process

Replace `signalium-api` with the name you found in R0:

```bash
pm2 stop   signalium-api
pm2 delete signalium-api
pm2 save --force          # update the saved process list so it won't restart on reboot
```

Your other PM2 processes keep running — only the named process is affected.

---

### R2 — Remove the old Nginx vhost

```bash
# Find the config file(s) for signaliumai.com
grep -rl "signaliumai.com" /etc/nginx/sites-enabled/
grep -rl "signaliumai.com" /etc/nginx/sites-available/
```

Confirm the output shows only Signalium config files, then delete them:

```bash
rm /etc/nginx/sites-enabled/signalium    # the symlink
rm /etc/nginx/sites-available/signalium  # the source file (if it exists)

nginx -t && systemctl reload nginx       # verify syntax, then reload gracefully
```

> `systemctl reload nginx` is graceful — your other sites stay live.

---

### R3 — Save old credentials, then drop the database

**Before deleting, read the old `.env` so you have the credentials:**

```bash
cat /var/www/signalium/.env 2>/dev/null || \
  find /var/www/signalium -name ".env" -maxdepth 3 2>/dev/null | xargs cat
```

Note the existing `DATABASE_URL` (database name, user, password) in case they
differ from the new setup. Also check the existing `SESSION_SECRET` and
`SECRETS_ENCRYPTION_KEY` if you want to reuse them.

> **⚠ The next commands permanently delete all data.**

```bash
sudo -u postgres psql -c "DROP DATABASE IF EXISTS signalium;"
sudo -u postgres psql -c "DROP USER IF EXISTS signalium_user;"

# Confirm both are gone
sudo -u postgres psql -c "\l"  | grep signalium    # should return nothing
sudo -u postgres psql -c "\du" | grep signalium    # should return nothing
```

If `DROP DATABASE` fails with **"being accessed by other users"** the old
Node.js process is still running — repeat R1, wait 5 seconds, then retry.

---

### R4 — Delete the old source files

The current `/var/www/signalium` is the full monorepo workspace source
(`pnpm-workspace.yaml`, `artifacts/`, `node_modules/`, etc.). Confirm what
you're about to delete, then remove it:

```bash
ls /var/www/signalium    # you should see: artifacts  pnpm-workspace.yaml  node_modules  ...
rm -rf /var/www/signalium

# Confirm it's gone
ls /var/www/signalium 2>/dev/null || echo "Deleted successfully."
```

---

### R5 — Create a fresh database

```bash
sudo -u postgres psql <<SQL
CREATE USER signalium_user WITH PASSWORD 'YOUR_DB_PASSWORD';
CREATE DATABASE signalium OWNER signalium_user;
GRANT ALL PRIVILEGES ON DATABASE signalium TO signalium_user;
SQL

# Confirm
sudo -u postgres psql -c "\l" | grep signalium
# Expected:  signalium | signalium_user | UTF8 ...
```

Your `DATABASE_URL` for the new `.env`:

```
postgresql://signalium_user:YOUR_DB_PASSWORD@localhost:5432/signalium
```

> Keep the real password only in the `.env` file on the server —
> never commit it to source control.

The old site is gone. Continue with Step 1 below.

---

## Step 1 — Build the release tarball

Run these commands in this Replit workspace (or on your local machine if
you have the repo checked out locally):

```bash
./scripts/build-release.sh
./scripts/package-release.sh
```

This produces `signalium-platform-release.tar.gz` (or
`signalium-platform-release-<VERSION>.tar.gz`) in the workspace root.

What gets built:

| Output | Contents |
|--------|----------|
| `dist/public/` | Frontend SPA (HTML, CSS, JS, images) |
| `dist/server/index.mjs` | Bundled Node.js backend (~6.7 MB) |
| `dist/server/migrate.mjs` | Self-contained database migration runner |
| `dist/drizzle/` | SQL migration files |

---

## Step 2 — Transfer to the server

Choose the method that fits your workflow. All three put the tarball at
`/root/` on the server, which is where Steps 3–9 expect it.

---

### Option A — FileZilla (SFTP)

FileZilla is a free desktop app — no command line needed for the transfer.

**Connect:**

1. Open FileZilla → **File → Site Manager → New Site**
2. Fill in:

   | Field | Value |
   |-------|-------|
   | Protocol | **SFTP – SSH File Transfer Protocol** |
   | Host | `198.177.123.71` |
   | Port | `22` |
   | Logon Type | **Normal** |
   | User | `root` |
   | Password | your root SSH password |

3. Click **Connect**.

**Transfer the tarball:**

4. In the **Local site** pane (left), navigate to the folder containing
   `signalium-platform-release.tar.gz`.
5. In the **Remote site** pane (right), navigate to `/root/`.
6. Drag the `.tar.gz` file from the left pane to the right pane.
   Wait for the transfer to complete (shown in the transfer queue at the bottom).

**Then SSH in to complete the deployment** (Steps 3–9):

```bash
ssh root@198.177.123.71
```

---

### Option B — GitHub Actions (automated)

Set this up once and every push to `main` will build and deploy automatically.

**One-time server setup — create a deploy SSH key:**

```bash
ssh root@198.177.123.71

# Generate a dedicated deploy key (no passphrase)
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/github_deploy -N ""

# Authorise it for SSH login
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys

# Print the private key — copy this entire block into GitHub
cat ~/.ssh/github_deploy
```

**Add secrets to your GitHub repository** (Settings → Secrets → Actions):

| Secret name | Value |
|-------------|-------|
| `DEPLOY_SSH_KEY` | The private key printed above (entire `-----BEGIN...-----END` block) |
| `DEPLOY_HOST` | `198.177.123.71` |
| `DEPLOY_USER` | `root` |

**Create the workflow file** in your repo at `.github/workflows/deploy.yml`:

```yaml
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
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          source: "signalium-platform-release-*.tar.gz"
          target: "/root/"

      - name: Deploy on VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            set -euo pipefail

            mkdir -p /tmp/signalium-new
            tar xzf ~/signalium-platform-release-*.tar.gz \
              --strip-components=1 -C /tmp/signalium-new/

            rsync -av --delete \
              --exclude='.env' \
              --exclude='logs/' \
              --exclude='node_modules/' \
              /tmp/signalium-new/ \
              /var/www/signalium/

            cd /var/www/signalium
            npm install --omit=dev
            set -a; source .env; set +a
            ./scripts/migrate.sh
            ./scripts/deploy-check.sh
            pm2 reload ecosystem.config.cjs --env production

            rm -f ~/signalium-platform-release-*.tar.gz
            rm -rf /tmp/signalium-new
```

> **First deploy:** GitHub Actions handles updates, but the very first deploy
> still needs `.env` on the server (Step 5) and Nginx configured (Step 10).
> Run Steps 3–11 manually once, then every push to `main` auto-deploys from
> Step 3 onward.

---

### Option C — SCP (command line)

```bash
scp signalium-platform-release*.tar.gz root@198.177.123.71:/root/
```

Then SSH in:

```bash
ssh root@198.177.123.71
```

---

## Step 3 — Extract on the server

```bash
mkdir -p /var/www/signalium
tar xzf ~/signalium-platform-release*.tar.gz \
  --strip-components=1 -C /var/www/signalium
cd /var/www/signalium
```

`--strip-components=1` drops the top-level folder in the archive so files
land directly in `/var/www/signalium/`.

---

## Step 4 — Install runtime dependencies

```bash
cd /var/www/signalium
npm install --omit=dev
```

Installs the three packages the backend bundle externalises:

| Package | Why external |
|---------|-------------|
| `@google-cloud/storage` | Native gRPC bindings |
| `@swc/helpers` | Required by fontkit/pdfkit — no fallback guard |
| `nodemailer` | Dynamic transport resolution |

~30 seconds, ~90 packages, ~16 MB.

---

## Step 5 — Configure environment variables

```bash
cp .env.example .env
nano .env
```

Required variables for this server:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgresql://signalium_user:YOUR_DB_PASSWORD@localhost:5432/signalium` |
| `PUBLIC_APP_URL` | `https://signaliumai.com` |
| `ALLOWED_ORIGINS` | `https://signaliumai.com` |
| `SESSION_SECRET` | Run `openssl rand -hex 32` — paste the result |
| `SECRETS_ENCRYPTION_KEY` | Run `openssl rand -hex 32` — paste the result |
| `QDE_TRAINER_URL` | `https://trainer.signaliumai.com` |

Optional:

| Variable | Description |
|----------|-------------|
| `LOG_LEVEL` | `info` (default) |
| `SMTP_*` | Mail credentials for email notifications |
| `STRIPE_SECRET_KEY` | Payment processing |

See `.env.example` for the full list.

---

## Step 6 — Run the pre-deploy check

```bash
cd /var/www/signalium
set -a; source .env; set +a
./scripts/deploy-check.sh
```

All checks must pass before continuing. Fix any `[FAIL]` lines.
`[WARN]` lines for optional unconfigured services are non-blocking.

---

## Step 7 — Run database migrations

```bash
cd /var/www/signalium
set -a; source .env; set +a
./scripts/migrate.sh
```

On a fresh database (as created in R5) this creates every table, enum, and
index from scratch. On future updates it only applies new migration files.
Always safe to re-run.

---

## Step 8 — Seed the super-admin account (first deploy only)

The seeder uses TypeScript source and must run from the Replit workspace (or
local machine), pointed at the production database:

```bash
DATABASE_URL="postgresql://signalium_user:YOUR_DB_PASSWORD@198.177.123.71:5432/signalium" \
SUPER_ADMIN_EMAIL="admin@signaliumai.com" \
SUPER_ADMIN_PASSWORD="<choose-a-strong-password>" \
pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
```

> If the VPS firewall blocks direct PostgreSQL access, use an SSH tunnel:
> ```bash
> # Terminal 1 — keep open
> ssh -L 5433:localhost:5432 root@198.177.123.71
>
> # Terminal 2 — use localhost:5433
> DATABASE_URL="postgresql://signalium_user:YOUR_DB_PASSWORD@localhost:5433/signalium" ...
> ```

The script is idempotent — re-running updates the password, no duplicate created.

---

## Step 9 — Start with PM2

```bash
cd /var/www/signalium
set -a; source .env; set +a

pm2 start ecosystem.config.cjs --env production
pm2 save       # persist across reboots
pm2 startup    # run the printed command to enable PM2 on boot
```

Verify:

```bash
pm2 status
pm2 logs signalium-api --lines 50 --nostream
```

Healthy startup ends with:

```
Server listening  port=3000
required_env_vars: ok
database: ok
pgBroadcast: LISTEN connection established
```

---

## Step 10 — Configure Nginx

```bash
nano /etc/nginx/sites-available/signalium
```

Paste:

```nginx
server {
    listen 80;
    server_name signaliumai.com www.signaliumai.com;

    # Frontend SPA
    root /var/www/signalium/dist/public;
    index index.html;

    # API proxy → Node.js backend
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_buffering    on;
        proxy_buffer_size  16k;
        proxy_buffers      4 32k;
        client_max_body_size 10m;
    }

    # EA Expert Advisor WebSocket
    location /ws/ea {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
    }

    # Admin ops WebSocket
    location /api/ws/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
    }

    # SPA fallback — non-asset routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Static asset caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable and reload:

```bash
ln -s /etc/nginx/sites-available/signalium /etc/nginx/sites-enabled/
nginx -t          # must say "syntax is ok"
systemctl reload nginx
```

---

## Step 11 — Enable HTTPS (Let's Encrypt)

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d signaliumai.com -d www.signaliumai.com
certbot renew --dry-run    # verify auto-renewal works
```

Your other sites' certificates are unaffected.

---

## Updating an existing deployment

Use for all future code updates — no need to touch the database or Nginx.

**Build and transfer** (same as Steps 1–2 above), then on the server:

```bash
ssh root@198.177.123.71

mkdir -p /tmp/signalium-new
tar xzf ~/signalium-platform-release*.tar.gz \
  --strip-components=1 -C /tmp/signalium-new/

rsync -av --delete \
  --exclude='.env' \
  --exclude='logs/' \
  --exclude='node_modules/' \
  /tmp/signalium-new/ \
  /var/www/signalium/

cd /var/www/signalium
npm install --omit=dev
set -a; source .env; set +a
./scripts/migrate.sh
./scripts/deploy-check.sh

# Zero-downtime reload — SIGINT to old process, start new, Nginx buffers the gap
pm2 reload ecosystem.config.cjs --env production
pm2 logs signalium-api --lines 30 --nostream

# Clean up
rm ~/signalium-platform-release*.tar.gz
rm -rf /tmp/signalium-new
```

> If you set up GitHub Actions (Option B), pushing to `main` does all of
> the above automatically after the first manual deploy.

---

## Rollback

```bash
ssh root@198.177.123.71

mkdir -p /tmp/signalium-prev
tar xzf ~/signalium-platform-release-PREVIOUS.tar.gz \
  --strip-components=1 -C /tmp/signalium-prev/

rsync -av --delete \
  --exclude='.env' --exclude='logs/' --exclude='node_modules/' \
  /tmp/signalium-prev/ /var/www/signalium/

cd /var/www/signalium
npm install --omit=dev
set -a; source .env; set +a
pm2 reload ecosystem.config.cjs --env production
```

> Always take a `pg_dump` backup before deploying — if new migrations ran,
> rolling back code alone may cause schema errors.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `pm2 start` exits immediately | Missing env var or DB unreachable | `pm2 logs signalium-api`; run `./scripts/deploy-check.sh` |
| `502 Bad Gateway` | Backend not running | `pm2 status`, `pm2 logs signalium-api` |
| `404` on all `/api/` routes | Nginx `proxy_pass` port mismatch | Confirm `PORT=3000` in `.env` matches `proxy_pass http://127.0.0.1:3000` |
| Blank page, no API data | CORS or wrong app URL | Check `ALLOWED_ORIGINS=https://signaliumai.com` in `.env` |
| `ECONNREFUSED` in logs | Wrong `DATABASE_URL` or Postgres down | `./scripts/deploy-check.sh`, `systemctl status postgresql` |
| `Cannot find package '@swc/helpers'` | `npm install --omit=dev` not run | `cd /var/www/signalium && npm install --omit=dev` |
| Migrations fail — `already exists` | Schema applied without migration tracking | Back up DB, drop and recreate, re-run `./scripts/migrate.sh` |
| `DROP DATABASE` — "being accessed" | Old Node.js process still alive | Repeat R1, wait 5 s, retry DROP |
| Other sites down after Nginx reload | Nginx config syntax error | Always run `nginx -t` before `systemctl reload nginx` |
| WebSocket disconnects immediately | Nginx missing `Upgrade`/`Connection` headers | Check `/ws/ea` and `/api/ws/` blocks in Nginx config |
| GitHub Actions deploy fails | SSH key not authorised on server | Confirm `~/.ssh/github_deploy.pub` is in `~/.ssh/authorized_keys` |
| FileZilla "Permission denied" | Wrong credentials or key auth required | Use password auth, or add your public key to `~/.ssh/authorized_keys` |

Check startup logs:

```bash
pm2 logs signalium-api --lines 100 --nostream
```
