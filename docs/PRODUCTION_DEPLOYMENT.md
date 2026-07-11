# Signalium Platform — Production Deployment Guide

**Target server:** `root@198.177.123.71`
**Deploy path:** `/var/www/signalium`
**Live URL:** `https://signaliumai.com`
**Trainer URL:** `https://trainer.signaliumai.com`

This guide covers deploying Signalium from a pre-built release tarball onto a
Ubuntu VPS that is already running other websites. Nothing in these steps
touches your other sites, Nginx vhosts, or databases.

---

## Overview

```
Your machine                           VPS (198.177.123.71)
────────────────                       ────────────────────
1. Build release   ──► .tar.gz ──scp──►  2. Extract
                                         3. npm install --omit=dev
                                         4. Create .env
                                         5. Deploy-check
                                         6. Run DB migrations
                                         7. PM2 start
                                         8. Nginx + HTTPS
```

The tarball is fully self-contained — frontend SPA, bundled Node.js backend,
compiled migration runner, and SQL migration files. The VPS only needs
Node.js ≥ 20, PM2, PostgreSQL, and Nginx.

---

## Prerequisites (one-time VPS setup)

SSH into the server:

```bash
ssh root@198.177.123.71
```

Install Node.js 20, PM2, and verify Nginx is present:

```bash
# Node.js 20 (skip if already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PM2
npm install -g pm2

# Nginx (usually already present on a shared VPS)
apt-get install -y nginx

# Verify
node -v    # must be v20.x or higher
pm2 -v
nginx -v
```

---

## Database setup (one-time)

> **If you are replacing an old Signalium installation, see
> [Replacing an existing installation](#replacing-an-existing-installation) first.**

Create the database and user:

```bash
sudo -u postgres psql <<SQL
CREATE USER signalium_user WITH PASSWORD 'YOUR_DB_PASSWORD';
CREATE DATABASE signalium OWNER signalium_user;
GRANT ALL PRIVILEGES ON DATABASE signalium TO signalium_user;
SQL
```

Your `DATABASE_URL` will be:

```
postgresql://signalium_user:YOUR_DB_PASSWORD@localhost:5432/signalium
```

> Replace `YOUR_DB_PASSWORD` with your real password. Never commit the real
> password to source control — keep it only in the `.env` file on the server.

---

## Step 1 — Build the release tarball (on your dev machine)

```bash
# From the workspace root
./scripts/build-release.sh
./scripts/package-release.sh
```

This produces `signalium-platform-release.tar.gz` (or
`signalium-platform-release-<VERSION>.tar.gz`) in the workspace root.

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

The `--strip-components=1` flag drops the top-level folder from the archive so
all files land directly in `/var/www/signalium/`.

---

## Step 4 — Install runtime dependencies

```bash
cd /var/www/signalium
npm install --omit=dev
```

Installs the three runtime packages the backend bundle externalises:

| Package | Why external |
|---------|-------------|
| `@google-cloud/storage` | Native gRPC bindings |
| `@swc/helpers` | Required by fontkit / pdfkit with no fallback guard |
| `nodemailer` | Dynamic transport resolution |

Takes ~30 seconds; ~90 packages, ~16 MB.

---

## Step 5 — Configure environment variables

```bash
cp .env.example .env
nano .env
```

Fill in every value. The table below shows exactly what to set for this server:

| Variable | Value for this deployment |
|----------|--------------------------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgresql://signalium_user:YOUR_DB_PASSWORD@localhost:5432/signalium` |
| `PUBLIC_APP_URL` | `https://signaliumai.com` |
| `ALLOWED_ORIGINS` | `https://signaliumai.com` |
| `SESSION_SECRET` | Run `openssl rand -hex 32` and paste the result |
| `SECRETS_ENCRYPTION_KEY` | Run `openssl rand -hex 32` and paste the result |
| `QDE_TRAINER_URL` | `https://trainer.signaliumai.com` |

Optional but recommended:

| Variable | Description |
|----------|-------------|
| `LOG_LEVEL` | `info` (default) — use `warn` in production to reduce noise |
| `SMTP_*` | Mail credentials for user email notifications |
| `STRIPE_SECRET_KEY` | Payment processing |

See `.env.example` for the full list.

---

## Step 6 — Run the pre-deploy check

```bash
cd /var/www/signalium
set -a; source .env; set +a
./scripts/deploy-check.sh
```

Expected result: **all checks pass** (PM2 present, all env vars set,
database reachable, build artifacts present, port 3000 free).

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
On an update it only applies new migration files. Always safe to re-run.

---

## Step 8 — Seed the super-admin account (first deploy only)

The seeder uses TypeScript source and must run from your development machine,
pointed at the production database:

```bash
# Run this on your dev machine
DATABASE_URL="postgresql://signalium_user:YOUR_DB_PASSWORD@198.177.123.71:5432/signalium" \
SUPER_ADMIN_EMAIL="admin@signaliumai.com" \
SUPER_ADMIN_PASSWORD="<strong-password>" \
pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
```

> Make sure PostgreSQL on the VPS allows connections from your dev machine's IP,
> or use an SSH tunnel: `ssh -L 5433:localhost:5432 root@198.177.123.71`
> and connect to `localhost:5433` instead.
>
> The script is idempotent — re-running it updates the password without
> creating a duplicate account.

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

Create the site config:

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

    # API and WebSocket proxy → Node.js backend
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

    # SPA fallback — send all non-asset requests to index.html
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

> `systemctl reload nginx` is graceful — your other sites stay up.

---

## Step 11 — Enable HTTPS (Let's Encrypt)

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d signaliumai.com -d www.signaliumai.com
```

Certbot edits only the Signalium Nginx config and sets up auto-renewal.
Your other sites' certificates are unaffected.

Test auto-renewal:

```bash
certbot renew --dry-run
```

---

## Replacing an existing installation

> **⚠ Permanently and irreversibly destroys the old data. No undo.**
> Steps below only touch the Signalium PM2 process, Nginx vhost, database,
> and files. Your other three sites are not affected.

Take a backup first in case you need to recover anything:

```bash
pg_dump -U signalium_user signalium > ~/signalium_FINAL_BACKUP_$(date +%Y%m%d).sql
```

### R1 — Stop and remove the old PM2 process

```bash
pm2 stop  signalium-api
pm2 delete signalium-api
pm2 save --force
```

### R2 — Remove the old Nginx vhost

```bash
# Check which file is the Signalium config before deleting
grep -rl "signaliumai.com" /etc/nginx/sites-enabled/
```

Confirm it's the right file, then:

```bash
rm /etc/nginx/sites-enabled/signalium
rm /etc/nginx/sites-available/signalium   # if it exists
nginx -t && systemctl reload nginx
```

### R3 — Drop the database

> **⚠ This permanently deletes all data.**

```bash
sudo -u postgres psql -c "DROP DATABASE signalium;"
sudo -u postgres psql -c "DROP USER signalium_user;"
```

If `DROP DATABASE` fails with *"being accessed by other users"*, the old
Node.js process is still running — repeat R1, wait 5 seconds, then retry.

### R4 — Delete the old files

```bash
rm -rf /var/www/signalium
```

### R5 — Recreate the database

```bash
sudo -u postgres psql <<SQL
CREATE USER signalium_user WITH PASSWORD 'YOUR_DB_PASSWORD';
CREATE DATABASE signalium OWNER signalium_user;
GRANT ALL PRIVILEGES ON DATABASE signalium TO signalium_user;
SQL
```

Then continue from [Step 1](#step-1--build-the-release-tarball-on-your-dev-machine).

---

## Updating an existing deployment (zero downtime)

```bash
# 1. Build + package on dev machine (same as first deploy)
./scripts/build-release.sh
./scripts/package-release.sh

# 2. Transfer
scp signalium-platform-release*.tar.gz root@198.177.123.71:/root/

# 3. SSH in and apply
ssh root@198.177.123.71

tar xzf ~/signalium-platform-release*.tar.gz --strip-components=1 -C /tmp/signalium-new/

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

# Zero-downtime reload — PM2 sends SIGINT to old process, starts new process,
# Nginx upstream buffering absorbs the gap
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
tar xzf ~/signalium-platform-release-PREVIOUS.tar.gz --strip-components=1 -C /tmp/signalium-prev/
rsync -av --delete \
  --exclude='.env' --exclude='logs/' --exclude='node_modules/' \
  /tmp/signalium-prev/ /var/www/signalium/
cd /var/www/signalium
npm install --omit=dev
set -a; source .env; set +a
pm2 reload ecosystem.config.cjs --env production
```

> **Database rollbacks:** If the new release ran migrations, rolling back code
> alone may leave the schema incompatible with the old build. Always take a
> `pg_dump` backup before deploying.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `pm2 start` exits immediately | Missing env var or DB unreachable | `pm2 logs signalium-api`; run `./scripts/deploy-check.sh` |
| `502 Bad Gateway` | Backend not running | `pm2 status`, `pm2 logs signalium-api` |
| `404` on all `/api/` routes | Nginx `proxy_pass` port mismatch | Confirm `PORT=3000` in `.env` matches `proxy_pass http://127.0.0.1:3000` in Nginx |
| Blank page, no API data | CORS or wrong `PUBLIC_APP_URL` | Check `ALLOWED_ORIGINS=https://signaliumai.com` in `.env` |
| `ECONNREFUSED` in logs | `DATABASE_URL` wrong or Postgres down | `./scripts/deploy-check.sh`, `systemctl status postgresql` |
| `Cannot find package '@swc/helpers'` | `npm install --omit=dev` not run | `cd /var/www/signalium && npm install --omit=dev` |
| Migrations fail — `already exists` | Schema applied by `push` without migration tracking | Back up DB, drop schema, re-run `./scripts/migrate.sh` |
| `DROP DATABASE` — "being accessed" | Old Node.js process still alive | Repeat R1, wait 5 s, retry |
| Other sites down after Nginx reload | Nginx config syntax error | `nginx -t` before every `systemctl reload nginx` |
| WebSocket disconnects immediately | Nginx missing `Upgrade` / `Connection` headers | Check the `/ws/ea` and `/api/ws/` location blocks in Nginx config |

Check startup logs:

```bash
pm2 logs signalium-api --lines 100 --nostream
```

The `Startup diagnostic: dependency readiness report` block logged on every
boot shows exactly which services are configured vs unconfigured.
