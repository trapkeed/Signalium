# Signalium Platform — Production Deployment Guide

**Target server:** `root@198.177.123.71`
**Deploy path:** `/var/www/signalium`
**Live URL:** `https://signaliumai.com`
**Trainer URL:** `https://trainer.signaliumai.com`

This guide covers deploying Signalium from a pre-built release tarball onto a
Ubuntu VPS that is already running other websites. Nothing in these steps
touches your other three sites, their Nginx vhosts, or their databases.

---

## Table of contents

1. [Overview](#overview)
2. [Prerequisites (one-time VPS setup)](#prerequisites-one-time-vps-setup)
3. [**Replacing the old Signalium site**](#replacing-the-old-signalium-site) ← start here
4. [Build and transfer the release tarball](#step-1--build-the-release-tarball-on-your-dev-machine)
5. [Deploy on the server (Steps 2–9)](#step-2--transfer-to-the-server)
6. [Configure Nginx + HTTPS (Steps 10–11)](#step-10--configure-nginx)
7. [Updating an existing deployment](#updating-an-existing-deployment-zero-downtime)
8. [Rollback](#rollback)
9. [Troubleshooting](#troubleshooting)

---

## Overview

```
Your machine                           VPS (198.177.123.71)
────────────────                       ──────────────────────────────
                                       [R1] Stop + delete old PM2 process
                                       [R2] Remove old Nginx vhost
                                       [R3] Drop old database permanently
                                       [R4] Delete old site files
                                       [R5] Create fresh database
                                            ↓
1. Build release   ──► .tar.gz ──scp──►  2. Extract to /var/www/signalium
                                         3. npm install --omit=dev
                                         4. Create .env
                                         5. Deploy-check
                                         6. Run DB migrations
                                         7. PM2 start
                                         8. Nginx config + HTTPS
```

---

## Prerequisites (one-time VPS setup)

SSH into the server:

```bash
ssh root@198.177.123.71
```

Install Node.js 20, PM2, and verify Nginx:

```bash
# Node.js 20 (skip if already installed — check with: node -v)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PM2
npm install -g pm2

# Nginx (usually already present)
apt-get install -y nginx

# Confirm
node -v    # must be v20.x or higher
pm2 -v
nginx -v
```

---

## Replacing the old Signalium site

> **⚠ This permanently and irreversibly destroys the old site's data and files.
> There is no undo. Your other three websites are not affected — these steps
> only touch the Signalium PM2 process, its Nginx vhost, its PostgreSQL
> database, and its files directory.**

Take a final backup before you start, in case you need to recover anything:

```bash
ssh root@198.177.123.71

# Backup the old database (adjust the database name if yours is different)
pg_dump -U postgres signalium > ~/signalium_FINAL_BACKUP_$(date +%Y%m%d).sql
echo "Backup saved to: ~/signalium_FINAL_BACKUP_$(date +%Y%m%d).sql"
```

---

### R1 — Stop and remove the old PM2 process

```bash
# List running processes so you can see the exact name
pm2 list
```

Stop and delete the Signalium process (use the exact name shown in pm2 list):

```bash
pm2 stop  signalium-api
pm2 delete signalium-api

# Save the updated process list so PM2 doesn't restart the old site on reboot
pm2 save --force
```

> Your other PM2 processes keep running — `pm2 stop` only stops the named
> process.

---

### R2 — Remove the old Nginx vhost

Find the Signalium vhost config file:

```bash
grep -rl "signaliumai.com" /etc/nginx/sites-enabled/
grep -rl "signaliumai.com" /etc/nginx/sites-available/
```

Confirm the output shows only the Signalium config files, then delete them:

```bash
# Disable the site (remove the symlink from sites-enabled)
rm /etc/nginx/sites-enabled/signalium

# Remove the source file from sites-available
rm /etc/nginx/sites-available/signalium
```

Test and reload Nginx — your other sites stay up during this reload:

```bash
nginx -t && systemctl reload nginx
```

---

### R3 — Drop the old database permanently

> **⚠ The next commands permanently delete all data. This cannot be undone.**

```bash
sudo -u postgres psql -c "DROP DATABASE IF EXISTS signalium;"
sudo -u postgres psql -c "DROP USER IF EXISTS signalium_user;"
```

If `DROP DATABASE` fails with **"being accessed by other users"**, the old
Node.js process is still running. Go back to R1, wait 5 seconds, then retry.

Confirm the database is gone:

```bash
sudo -u postgres psql -c "\l" | grep signalium
# Should return nothing
```

---

### R4 — Delete the old site files

Find where the old files are (the path shown by PM2 before you deleted it, or
check your previous Nginx config):

```bash
# Common locations — check which one exists
ls /var/www/signalium 2>/dev/null && echo "Found at /var/www/signalium"
ls /var/www/html      2>/dev/null | grep -i signal
```

Delete the old directory:

```bash
# Replace with your actual old path if different
rm -rf /var/www/signalium
echo "Old files deleted."
```

---

### R5 — Create a fresh database

```bash
sudo -u postgres psql <<SQL
CREATE USER signalium_user WITH PASSWORD 'YOUR_DB_PASSWORD';
CREATE DATABASE signalium OWNER signalium_user;
GRANT ALL PRIVILEGES ON DATABASE signalium TO signalium_user;
SQL
```

Confirm it was created:

```bash
sudo -u postgres psql -c "\l" | grep signalium
# Should show:  signalium | signalium_user | UTF8 ...
```

Your `DATABASE_URL` for the new `.env` will be:

```
postgresql://signalium_user:YOUR_DB_PASSWORD@localhost:5432/signalium
```

> Replace `YOUR_DB_PASSWORD` with your real password. Keep it only in the
> `.env` file on the server — never commit the real password to source control.

The old site is now completely gone. Continue with Step 1 below to deploy the
new release onto the clean server.

---

## Step 1 — Build the release tarball (on your dev machine)

```bash
# From the workspace root
./scripts/build-release.sh
./scripts/package-release.sh
```

This produces `signalium-platform-release.tar.gz` in the workspace root.

---

## Step 2 — Transfer to the server

```bash
scp signalium-platform-release*.tar.gz root@198.177.123.71:/root/
```

---

## Step 3 — Extract on the server

```bash
ssh root@198.177.123.71

mkdir -p /var/www/signalium
tar xzf ~/signalium-platform-release*.tar.gz --strip-components=1 -C /var/www/signalium
cd /var/www/signalium
```

`--strip-components=1` drops the top-level folder in the archive so all files
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
| `@swc/helpers` | Required by fontkit/pdfkit with no fallback guard |
| `nodemailer` | Dynamic transport resolution |

~30 seconds, ~90 packages, ~16 MB.

---

## Step 5 — Configure environment variables

```bash
cp .env.example .env
nano .env
```

Fill in every value. Required variables for this deployment:

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

Expected: **all checks pass** (PM2 present, env vars set, database reachable,
build artifacts present, port 3000 free).

Fix any `[FAIL]` lines before continuing. `[WARN]` lines for unconfigured
optional services (Stripe, SMTP, etc.) are non-blocking.

---

## Step 7 — Run database migrations

```bash
cd /var/www/signalium
set -a; source .env; set +a
./scripts/migrate.sh
```

On a fresh database this creates every table, enum, and index from scratch.
On future updates it only applies new migration files. Always safe to re-run.

---

## Step 8 — Seed the super-admin account (first deploy only)

The seeder uses TypeScript source and must run from your development machine:

```bash
# Run on your dev machine, pointed at the production DB
DATABASE_URL="postgresql://signalium_user:YOUR_DB_PASSWORD@198.177.123.71:5432/signalium" \
SUPER_ADMIN_EMAIL="admin@signaliumai.com" \
SUPER_ADMIN_PASSWORD="<choose-a-strong-password>" \
pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
```

> If the VPS firewall blocks direct PostgreSQL access from your machine, use
> an SSH tunnel instead:
> ```bash
> # In a separate terminal — keeps the tunnel open
> ssh -L 5433:localhost:5432 root@198.177.123.71
>
> # Then use localhost:5433 in DATABASE_URL
> DATABASE_URL="postgresql://signalium_user:YOUR_DB_PASSWORD@localhost:5433/signalium" ...
> ```

The script is idempotent — re-running updates the password without duplicating.

---

## Step 9 — Start with PM2

```bash
cd /var/www/signalium
set -a; source .env; set +a

pm2 start ecosystem.config.cjs --env production
pm2 save       # persist process list across reboots
pm2 startup    # run the printed command to enable PM2 on boot
```

Verify it started cleanly:

```bash
pm2 status
pm2 logs signalium-api --lines 50 --nostream
```

A healthy startup ends with:

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

Paste and save:

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

    # SPA fallback — all non-asset routes serve index.html
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

> `systemctl reload nginx` is graceful — your other sites stay live.

---

## Step 11 — Enable HTTPS (Let's Encrypt)

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d signaliumai.com -d www.signaliumai.com
```

Certbot edits only the Signalium Nginx config and sets up auto-renewal.
Test renewal:

```bash
certbot renew --dry-run
```

---

## Updating an existing deployment (zero downtime)

Use this for all future code updates — no need to touch the database or Nginx.

```bash
# 1. Build + package on your dev machine
./scripts/build-release.sh
./scripts/package-release.sh

# 2. Transfer
scp signalium-platform-release*.tar.gz root@198.177.123.71:/root/

# 3. SSH in and apply
ssh root@198.177.123.71

mkdir -p /tmp/signalium-new
tar xzf ~/signalium-platform-release*.tar.gz --strip-components=1 -C /tmp/signalium-new/

# Sync — preserves .env and logs/ on the server
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

# Zero-downtime reload
pm2 reload ecosystem.config.cjs --env production
pm2 logs signalium-api --lines 30 --nostream

# Clean up
rm ~/signalium-platform-release*.tar.gz
rm -rf /tmp/signalium-new
```

---

## Rollback

```bash
# Re-extract a previous tarball you kept
mkdir -p /tmp/signalium-prev
tar xzf ~/signalium-platform-release-PREVIOUS.tar.gz --strip-components=1 -C /tmp/signalium-prev/

rsync -av --delete \
  --exclude='.env' --exclude='logs/' --exclude='node_modules/' \
  /tmp/signalium-prev/ /var/www/signalium/

cd /var/www/signalium
npm install --omit=dev
set -a; source .env; set +a
pm2 reload ecosystem.config.cjs --env production
```

> **Database rollbacks:** If the update ran new migrations, rolling back code
> alone may cause schema errors. Always take a `pg_dump` backup before
> deploying.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `pm2 start` exits immediately | Missing env var or DB unreachable | `pm2 logs signalium-api`; run `./scripts/deploy-check.sh` |
| `502 Bad Gateway` | Backend not running | `pm2 status`, `pm2 logs signalium-api` |
| `404` on all `/api/` routes | Nginx `proxy_pass` port mismatch | Confirm `PORT=3000` in `.env` matches `proxy_pass http://127.0.0.1:3000` |
| Blank page, no API data | CORS or wrong app URL | Check `ALLOWED_ORIGINS=https://signaliumai.com` and `PUBLIC_APP_URL` in `.env` |
| `ECONNREFUSED` in logs | Wrong `DATABASE_URL` or Postgres down | `./scripts/deploy-check.sh`, `systemctl status postgresql` |
| `Cannot find package '@swc/helpers'` | `npm install --omit=dev` not run | `cd /var/www/signalium && npm install --omit=dev` |
| Migrations fail — `already exists` | Schema applied by `push`, not tracked | Back up DB, drop and recreate, re-run `./scripts/migrate.sh` |
| `DROP DATABASE` — "being accessed" | Old Node.js process still alive | Repeat R1, wait 5 s, retry DROP |
| Other sites down after Nginx reload | Nginx config syntax error | Always run `nginx -t` before `systemctl reload nginx` |
| WebSocket disconnects immediately | Nginx missing `Upgrade`/`Connection` headers | Check `/ws/ea` and `/api/ws/` location blocks in Nginx config |

Check startup logs at any time:

```bash
pm2 logs signalium-api --lines 100 --nostream
```
