# Signalium — VPS Deployment Guide (Beginner Friendly)

This guide walks you through putting Signalium on your own VPS (a rented Linux
server — e.g. from DigitalOcean, Hetzner, Linode, or AWS Lightsail) step by
step. No prior server experience assumed.

> **Easier alternative:** You can also just click "Publish" inside Replit and
> skip all of this. Use this guide only if you specifically need your own
> server (custom infrastructure, on-prem, compliance reasons, etc).

---

## 1. What you'll need

- A VPS running **Ubuntu 22.04** (or newer), with at least 2GB RAM. Any
  provider works — DigitalOcean and Hetzner are cheap and beginner-friendly.
- A domain name pointed at the VPS (optional but recommended, needed for
  HTTPS/SSL).
- The following accounts/keys, gathered before you start:
  - A **Clerk** account (clerk.com) — for authentication.
  - A **Postgres** database — you can run one on the same VPS, or use a
    managed provider like Neon or Supabase.
  - Payment provider keys (Stripe/PayPal/Flutterwave) if you use payments.

---

## 2. Point your domain at the server (optional but recommended)

In your domain registrar's DNS settings, add an **A record**:

```
Type: A
Name: @  (or "app" for a subdomain like app.yourdomain.com)
Value: <your VPS's public IP address>
```

DNS changes can take a few minutes to a few hours to take effect.

---

## 3. Connect to your server

From your own computer's terminal:

```bash
ssh root@<your-server-ip>
```

(Your VPS provider will have emailed you the password, or you'll have set up
an SSH key during signup.)

---

## 4. Install the basics

Run these commands one at a time on the server:

```bash
# Update the system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install pnpm (the package manager this project uses)
npm install -g pnpm

# Install Postgres (skip if you're using a managed database like Neon)
apt install -y postgresql postgresql-contrib

# Install Nginx (reverse proxy — routes public traffic to your app)
apt install -y nginx

# Install PM2 (keeps your app running forever, restarts it if it crashes)
npm install -g pm2

# Install Certbot (free HTTPS certificates)
apt install -y certbot python3-certbot-nginx
```

---

## 5. Set up the database

**If using the local Postgres you just installed:**

```bash
sudo -u postgres psql
```

Inside the Postgres prompt:

```sql
CREATE DATABASE signalium;
CREATE USER signalium_user WITH ENCRYPTED PASSWORD 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE signalium TO signalium_user;
\q
```

Your database URL will be:
```
postgresql://signalium_user:choose-a-strong-password@localhost:5432/signalium
```

**If using a managed provider (Neon, Supabase, etc.)** — just copy the
connection string they give you. This is usually easier and more reliable
than self-hosting Postgres.

---

## 6. Get the code onto the server

```bash
cd /var/www
git clone <your-repo-url> signalium
cd signalium
pnpm install
```

(If you don't have a git repo yet, you can instead zip your project locally
and `scp` it to the server, then `unzip` it in `/var/www/signalium`.)

---

## 7. Configure environment variables

Every secret and config value the app needs is read from environment
variables. Create a file at `artifacts/api-server/.env`:

```bash
nano artifacts/api-server/.env
```

Paste in (replace every placeholder with your real value):

```bash
# Core
NODE_ENV=production
DATABASE_URL=postgresql://signalium_user:choose-a-strong-password@localhost:5432/signalium
PUBLIC_APP_URL=https://yourdomain.com
SESSION_SECRET=<generate with: openssl rand -hex 32>
SECRETS_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
ALLOWED_ORIGINS=https://yourdomain.com

# Auth (Clerk) — from your Clerk dashboard, Production instance
CLERK_SECRET_KEY=sk_live_xxxxxxxx
CLERK_PUBLISHABLE_KEY=pk_live_xxxxxxxx

# Object storage (optional — only if you use file uploads)
PRIVATE_OBJECT_DIR=
PUBLIC_OBJECT_SEARCH_PATHS=

# Payments — only fill in the ones you actually use
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=live
PAYPAL_WEBHOOK_ID=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_WEBHOOK_HASH=

# Compliance / ops (optional, sensible defaults if omitted)
AUDIT_LOG_RETENTION_DAYS=365
BACKUP_RETENTION_DAYS=30
LOG_LEVEL=info
```

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

The frontend needs its own two public values. Create
`artifacts/signalium/.env.production`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxxxxxxx
```

> **Never commit `.env` files to git.** They contain secrets.

---

## 8. Push the database schema

```bash
cd /var/www/signalium
pnpm --filter @workspace/db run push
```

This creates all the tables the app needs. It's safe to re-run any time you
pull new code — it only adds what's missing.

---

## 9. Seed your super admin account

```bash
cd /var/www/signalium
pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
```

This creates the initial super admin login. Open the script file first if
you want to change the seeded email/password before running it.

---

## 10. Build the app

```bash
cd /var/www/signalium
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/signalium run build
```

This compiles the backend into `artifacts/api-server/dist` and the frontend
into `artifacts/signalium/dist`.

---

## 11. Start the backend with PM2

```bash
cd /var/www/signalium/artifacts/api-server
PORT=3000 pm2 start dist/index.mjs --name signalium-api
pm2 save
pm2 startup   # follow the printed instructions to make PM2 survive reboots
```

Check it's running:

```bash
pm2 status
pm2 logs signalium-api
```

---

## 12. Serve the frontend + proxy the API with Nginx

Create a new Nginx site config:

```bash
nano /etc/nginx/sites-available/signalium
```

Paste in:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Serve the built frontend
    root /var/www/signalium/artifacts/signalium/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to the backend
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and restart Nginx:

```bash
ln -s /etc/nginx/sites-available/signalium /etc/nginx/sites-enabled/
nginx -t   # should say "syntax is ok"
systemctl restart nginx
```

---

## 13. Enable HTTPS (free, via Let's Encrypt)

```bash
certbot --nginx -d yourdomain.com
```

Follow the prompts (enter your email, agree to terms). Certbot will
automatically edit your Nginx config to redirect HTTP → HTTPS and set up
auto-renewal.

---

## 14. Verify everything works

- Visit `https://yourdomain.com` — you should see the Signalium sign-in page.
- Sign in with the super admin account you seeded in step 9.
- Go to **Admin → Secrets Vault** — confirm your environment variables show
  as "configured".
- Go to **Admin → Users** — confirm you can create/delete a test user.

---

## 15. Updating the app later

When you have new code to deploy:

```bash
cd /var/www/signalium
git pull
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/signalium run build
pm2 restart signalium-api
```

---

## Troubleshooting

- **502 Bad Gateway from Nginx** — the backend isn't running. Check
  `pm2 logs signalium-api` for errors, and confirm it's listening on the
  `PORT` you configured (Nginx proxies to `localhost:3000` by default here).
- **Blank page / assets not loading** — make sure you built the frontend
  (`pnpm --filter @workspace/signalium run build`) and that Nginx's `root`
  path points at `artifacts/signalium/dist`.
- **"Clerk has been loaded with development keys"** — you're using `pk_test`/
  `sk_test` keys. Switch to your Clerk **Production** instance keys
  (`pk_live_...` / `sk_live_...`) before going live.
- **Database connection errors** — double-check `DATABASE_URL` is correct and
  that Postgres is accepting connections (`systemctl status postgresql`, or
  check your managed provider's connection settings/IP allowlist).
- **Signalium-trainer (QDE) connection** — if this deployment needs to talk to
  a separate signalium-trainer service, set its base URL as a secret in the
  Secrets Vault (Admin → Secrets Vault → Add Secret) once the app is running,
  rather than hardcoding it — this keeps rotation and audit logging intact.
