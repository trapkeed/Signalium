# Signalium — VPS Deployment Guide (Beginner Friendly)

This guide walks you through putting Signalium on your own VPS (a rented Linux
server — e.g. from DigitalOcean, Hetzner, Linode, or AWS Lightsail) step by
step. No prior server experience assumed.

> **Easier alternative:** You can also just click "Publish" inside Replit and
> skip all of this. Use this guide only if you specifically need your own
> server (custom infrastructure, on-prem, compliance reasons, etc).

---

## 0. Already running other sites on this VPS? Read this first

If your server already hosts other live websites, Signalium can run
alongside them safely — Nginx and PM2 are both designed to host many
independent apps on one machine. Just keep these rules in mind as you go
through the guide:

- **Never reinstall or restart shared infrastructure carelessly.** In step 4,
  skip `apt install` for anything already present (`nginx`, `postgresql`,
  `pm2`) — check first with `nginx -v`, `psql --version`, `pm2 -v`. Installing
  again is harmless, but running `systemctl restart nginx` later will briefly
  drop connections for your *other* sites too, so only do it right after
  validating your new config with `nginx -t`.
- **Pick a backend port that isn't already taken.** Run `pm2 status` and
  `ss -tlnp` to see what ports your existing sites use, then choose a free one
  for Signalium's API (this guide uses `3000` as an example — change it to
  `3001`, `3002`, etc. if that's already in use by another app).
- **Give Signalium its own Nginx server block, not a shared one.** You'll add
  a *new* file in step 12 (`/etc/nginx/sites-available/signalium`) — never
  edit another site's existing config file. Nginx routes by `server_name`
  (domain), so each site's file stays independent as long as the domain and
  port combination is unique.
- **Use a unique PM2 process name.** This guide uses `signalium-api` — make
  sure it doesn't collide with a name already shown in `pm2 status`.
- **Use a separate database and database user.** Step 5 already creates a
  dedicated `signalium` database and `signalium_user` — don't reuse another
  site's database or credentials.
- **Put the code in its own directory**, e.g. `/var/www/signalium`, never
  inside another site's folder.

As long as each site has its own port, PM2 process name, Nginx server block,
and database, they won't interfere with each other.

---

## 0b. Replacing an old version of this same site at the same URL

If you already have an older deployment of this exact app running at the
same domain and you want to fully remove it (code, database, and all) before
putting the new version up, do it in this order — **back up first, then
delete, then deploy fresh** using the rest of this guide.

> **This is irreversible.** Deleting a database drops all rows in it
> permanently, and `rm -rf` does not go to a trash bin. Do not skip the
> backup step unless you are certain you don't need any existing data (users,
> trades, settings, etc.) from the old deployment.

**Step 1 — back up the old database (always do this, even if you think you
don't need it):**

```bash
# Replace with the old deployment's actual DB name/user
sudo -u postgres pg_dump old_database_name > ~/old_site_backup_$(date +%F).sql
```

Copy that `.sql` file somewhere off the server too (e.g. `scp` it to your own
computer) in case you need to recover something later.

**Step 2 — stop and remove the old app process:**

```bash
pm2 status                      # find the old app's process name
pm2 stop <old-process-name>
pm2 delete <old-process-name>
pm2 save
```

**Step 3 — remove the old Nginx site config:**

```bash
ls /etc/nginx/sites-enabled/     # find the old site's config filename
rm /etc/nginx/sites-enabled/<old-config-name>
rm /etc/nginx/sites-available/<old-config-name>
nginx -t                        # should say "syntax is ok"
systemctl reload nginx
```

**Step 4 — drop the old database** (only after Step 1's backup is safely
copied off-server):

```bash
sudo -u postgres psql -c "DROP DATABASE old_database_name;"
sudo -u postgres psql -c "DROP USER old_database_user;"
```

**Step 5 — delete the old code directory:**

```bash
rm -rf /var/www/<old-site-folder>
```

**Step 6 — confirm the URL is clear**, then continue from **Section 1**
below to deploy Signalium fresh at the same domain (steps 6–13 will
re-create the code directory, database, PM2 process, and Nginx config under
Signalium's own names).

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
Name: @  (or "app" for a subdomain like app.signaliumai.com)
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

> **Already have other sites on this box?** Check what's installed before
> running these — `node -v`, `pnpm -v`, `psql --version`, `nginx -v`, `pm2 -v`.
> Skip any `apt install`/`npm install -g` line below whose tool is already
> present; re-running them is harmless but unnecessary.

Run these commands one at a time on the server:

```bash
# Update the system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install pnpm (the package manager this project uses)
npm install -g pnpm

# Install Postgres (skip if you're using a managed database like Neon, or if
# it's already installed for one of your other sites)
apt install -y postgresql postgresql-contrib

# Install Nginx (reverse proxy — routes public traffic to your app; skip if
# already installed — one Nginx install can serve unlimited sites)
apt install -y nginx

# Install PM2 (keeps your app running forever, restarts it if it crashes;
# skip if already installed — one PM2 install can manage unlimited apps)
npm install -g pm2

# Install Certbot (free HTTPS certificates; skip if already installed)
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
PUBLIC_APP_URL=https://signaliumai.com
SESSION_SECRET=<generate with: openssl rand -hex 32>
SECRETS_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
ALLOWED_ORIGINS=https://signaliumai.com

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

## 8. Set up / migrate the database schema

The database schema is version-controlled as SQL migration files in
`lib/db/drizzle/`. On a **first deploy**, run the migration to create every
table the app needs:

```bash
cd /var/www/signalium
pnpm --filter @workspace/db run migrate
```

This applies each `.sql` file in `lib/db/drizzle/` in order and records which
ones have already run (in a `__drizzle_migrations` tracking table), so it's
always safe to re-run — it only applies what's new.

> **Quick reference:**
> - `pnpm --filter @workspace/db run generate` — after changing schema code
>   in `lib/db/src/schema/`, run this to create a new migration `.sql` file
>   under `lib/db/drizzle/`. Commit that file to git.
> - `pnpm --filter @workspace/db run migrate` — applies any migration files
>   that haven't been run against this database yet. Run this on the server
>   every time you pull code that includes a new migration file (see step 15
>   for adding new tables later).
> - `pnpm --filter @workspace/db run push` still exists for quick local/dev
>   iteration (it diffs the schema and applies changes directly, with no
>   migration file). **Don't use `push` in production** — it doesn't leave a
>   reviewable history and can prompt for destructive changes non-interactively.
>   Always use `generate` + `migrate` for the live server.

---

## 9. Seed your super admin account

The seed script requires you to pass in the email and password as
environment variables — it will refuse to run without them, so no shared
default credential ever ends up in your database:

```bash
cd /var/www/signalium
SUPER_ADMIN_EMAIL="admin@signaliumai.com" \
SUPER_ADMIN_PASSWORD="choose-a-strong-password" \
pnpm --filter @workspace/api-server exec tsx src/scripts/seed-super-admin.ts
```

- Password must be at least 12 characters.
- The script is idempotent — if a user with that email already exists it's
  promoted to `super_admin` and its password reset, rather than creating a
  duplicate. Re-running it later with a new password is a safe way to
  rotate the super admin credential.
- This is the account you'll use to sign in and access the Admin section
  once the app is live (step 14).

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
    server_name signaliumai.com;

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
certbot --nginx -d signaliumai.com
```

Follow the prompts (enter your email, agree to terms). Certbot will
automatically edit your Nginx config to redirect HTTP → HTTPS and set up
auto-renewal.

---

## 14. Verify everything works

- Visit `https://signaliumai.com` — you should see the Signalium sign-in page.
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
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/signalium run build
pm2 restart signalium-api
```

`migrate` is safe to run every time, even if the pull didn't include any
schema changes — it simply does nothing if there are no new migration files.

### Adding new tables / changing the schema

Do this on your development machine (not the VPS), then ship the resulting
file through git like any other code change:

1. Edit or add a file in `lib/db/src/schema/` (e.g. a new table definition).
2. Generate the migration: `pnpm --filter @workspace/db run generate`. This
   writes a new numbered `.sql` file into `lib/db/drizzle/` describing exactly
   what changed (new tables, columns, indexes, etc).
3. Review the generated `.sql` file — this is your chance to catch anything
   unexpected (e.g. an accidental column drop) before it ever touches
   production data.
4. Commit both the schema code change and the new migration file, then push
   to GitHub.
5. On the VPS, run the normal update flow above (`git pull` → `pnpm install`
   → `pnpm --filter @workspace/db run migrate` → rebuild → `pm2 restart`).
   The `migrate` step will apply only the new file(s), creating the new
   tables/columns without touching anything already there.

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
- **`relation "..." already exists` when running `migrate`** — this means the
  tables were previously created another way (e.g. an old `push` run) without
  the migration tracking table. Back up the database, then either restore
  from a truly fresh database and run `migrate` from scratch, or ask for help
  reconciling the two before proceeding — don't force it, since a failed
  migration can leave the schema half-applied.
- **Signalium-trainer (QDE) connection** — the trainer service runs at
  `https://trainer.signaliumai.com`. Set its base URL as a secret in the
  Secrets Vault (Admin → Secrets Vault → Add Secret → key `TRAINER_BASE_URL`,
  value `https://trainer.signaliumai.com`) once the app is running, rather
  than hardcoding it — this keeps rotation and audit logging intact.
