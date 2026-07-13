/**
 * Signalium Platform Guide — PDF Generator
 * Uses pdfkit (already installed in api-server) to produce a formatted PDF.
 * Run: node scripts/generate-platform-guide.mjs
 */
import { createRequire } from "module";
import { createWriteStream, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfkitPath = path.resolve(__dirname, "../artifacts/api-server/node_modules/pdfkit/js/pdfkit.js");
const PDFDocument = require(pdfkitPath);

const OUT_DIR = "exports";
mkdirSync(OUT_DIR, { recursive: true });
const OUT_PATH = path.join(OUT_DIR, "Signalium-Platform-Complete-Guide.pdf");

const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: true });
const stream = createWriteStream(OUT_PATH);
doc.pipe(stream);

// ─── Palette ───────────────────────────────────────────────────────────────
const C = {
  navy:    "#0A1628",
  blue:    "#1E3A8A",
  accent:  "#3B82F6",
  cyan:    "#06B6D4",
  green:   "#10B981",
  yellow:  "#F59E0B",
  red:     "#EF4444",
  white:   "#FFFFFF",
  light:   "#F1F5F9",
  muted:   "#64748B",
  body:    "#1E293B",
  border:  "#CBD5E1",
};

const PAGE_W = doc.page.width  - 100; // usable width (margins 50 each side)

// ─── Helpers ───────────────────────────────────────────────────────────────
function addPage() { doc.addPage(); }

function y() { return doc.y; }

function gap(n = 10) { doc.moveDown(n / 12); }

function hline(color = C.border, lw = 0.5) {
  doc.save()
     .strokeColor(color).lineWidth(lw)
     .moveTo(50, y()).lineTo(50 + PAGE_W, y())
     .stroke().restore();
  gap(8);
}

function coverPage() {
  // Background
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.navy);

  // Top accent bar
  doc.rect(0, 0, doc.page.width, 8).fill(C.accent);

  // Logo area
  doc.fontSize(42).fillColor(C.white).font("Helvetica-Bold")
     .text("SIGNALIUM", 50, 80, { align: "center" });

  doc.fontSize(14).fillColor(C.cyan).font("Helvetica")
     .text("AI-POWERED TRADING PLATFORM", 50, 132, { align: "center" });

  // Divider
  doc.save().strokeColor(C.accent).lineWidth(2)
     .moveTo(150, 165).lineTo(doc.page.width - 150, 165).stroke().restore();

  // Title block
  doc.fontSize(28).fillColor(C.white).font("Helvetica-Bold")
     .text("Complete Platform Guide", 50, 190, { align: "center" });

  doc.fontSize(14).fillColor(C.muted).font("Helvetica")
     .text("Deployment · Training · RunPod · Production", 50, 230, { align: "center" });

  // Info box
  const bx = 80, by = 310, bw = doc.page.width - 160, bh = 110;
  doc.roundedRect(bx, by, bw, bh, 8).fill("#132040");
  doc.fontSize(11).fillColor(C.muted).font("Helvetica").text("VERSION", bx + 24, by + 18);
  doc.fontSize(13).fillColor(C.white).font("Helvetica-Bold").text("1.0  —  July 2026", bx + 24, by + 32);
  doc.fontSize(11).fillColor(C.muted).font("Helvetica").text("COVERS", bx + 24, by + 60);
  doc.fontSize(11).fillColor(C.light).font("Helvetica")
     .text("VPS Setup · GitHub Integration · RunPod GPU Orchestration\nModel Training · Production Deployment · Troubleshooting", bx + 24, by + 74);

  // Sections list
  const sx = 80, sy = 460;
  const sections = [
    "1  Prerequisites & Architecture",
    "2  VPS Server Setup",
    "3  GitHub Repository Setup",
    "4  Platform Deployment",
    "5  RunPod GPU Orchestration",
    "6  Model Training Guide",
    "7  Production Configuration",
    "8  Maintenance & Troubleshooting",
  ];
  doc.fontSize(11).fillColor(C.accent).font("Helvetica-Bold").text("CONTENTS", sx, sy);
  sections.forEach((s, i) => {
    doc.fontSize(11).fillColor(C.light).font("Helvetica")
       .text(s, sx + 12, sy + 18 + i * 18);
  });

  // Bottom bar
  doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill("#050D1A");
  doc.fontSize(9).fillColor(C.muted).font("Helvetica")
     .text("CONFIDENTIAL — Internal Operations Document", 50, doc.page.height - 26, { align: "center" });
}

function sectionHeader(num, title, subtitle = "") {
  addPage();
  // Colored band
  doc.rect(0, 0, doc.page.width, 90).fill(C.navy);
  doc.rect(0, 86, doc.page.width, 4).fill(C.accent);

  // Section number pill
  doc.roundedRect(50, 18, 36, 36, 6).fill(C.accent);
  doc.fontSize(18).fillColor(C.white).font("Helvetica-Bold")
     .text(String(num), 50, 25, { width: 36, align: "center" });

  doc.fontSize(22).fillColor(C.white).font("Helvetica-Bold")
     .text(title, 96, 20);
  if (subtitle) {
    doc.fontSize(11).fillColor(C.cyan).font("Helvetica")
       .text(subtitle, 96, 46);
  }
  doc.y = 110;
}

function h2(text) {
  gap(14);
  doc.fontSize(15).fillColor(C.blue).font("Helvetica-Bold").text(text);
  gap(4);
  doc.save().strokeColor(C.accent).lineWidth(1.5)
     .moveTo(50, y()).lineTo(50 + PAGE_W, y()).stroke().restore();
  gap(8);
}

function h3(text) {
  gap(10);
  doc.fontSize(12).fillColor(C.navy).font("Helvetica-Bold").text(text);
  gap(4);
}

function body(text, opts = {}) {
  doc.fontSize(10).fillColor(C.body).font("Helvetica").text(text, { lineGap: 3, ...opts });
  gap(6);
}

function bullet(items, indent = 60) {
  items.forEach(item => {
    const cx = indent, cy = y();
    doc.save().fillColor(C.accent).circle(cx - 10, cy + 5, 2.5).fill().restore();
    doc.fontSize(10).fillColor(C.body).font("Helvetica")
       .text(item, indent, cy, { width: PAGE_W - (indent - 50), lineGap: 2 });
    gap(4);
  });
}

function numbered(items, indent = 60) {
  items.forEach((item, i) => {
    const cy = y();
    doc.save().fillColor(C.accent).font("Helvetica-Bold").fontSize(10)
       .text(`${i + 1}.`, indent - 14, cy).restore();
    doc.fontSize(10).fillColor(C.body).font("Helvetica")
       .text(item, indent, cy, { width: PAGE_W - (indent - 50), lineGap: 2 });
    gap(5);
  });
}

function code(text, label = "") {
  gap(6);
  const lines  = text.split("\n");
  const lh     = 14;
  const pad    = 14;
  const bh     = lines.length * lh + pad * 2 + (label ? 18 : 0);
  const bx     = 50, bw = PAGE_W;

  // ensure we don't split across pages crudely
  if (y() + bh > doc.page.height - 80) addPage();

  const by = y();
  doc.roundedRect(bx, by, bw, bh, 6).fill("#0F172A");
  if (label) {
    doc.roundedRect(bx, by, bw, 22, 6).fill("#1E3A5F");
    doc.rect(bx, by + 16, bw, 6).fill("#1E3A5F");
    doc.fontSize(8).fillColor(C.cyan).font("Helvetica-Bold")
       .text(label.toUpperCase(), bx + pad, by + 7);
  }
  const textY = by + pad + (label ? 18 : 0);
  doc.fontSize(8.5).fillColor("#E2E8F0").font("Courier")
     .text(text, bx + pad, textY, { lineGap: 3, width: bw - pad * 2 });
  doc.y = by + bh;
  gap(8);
}

function infoBox(title, text, color = C.accent) {
  gap(8);
  if (y() + 60 > doc.page.height - 80) addPage();
  const by = y(), bh = 54;
  doc.roundedRect(50, by, PAGE_W, bh, 6).fill(C.light);
  doc.save().strokeColor(color).lineWidth(3)
     .moveTo(50, by + 6).lineTo(50, by + bh - 6).stroke().restore();
  doc.fontSize(9).fillColor(color).font("Helvetica-Bold").text(title, 62, by + 10);
  doc.fontSize(9).fillColor(C.body).font("Helvetica")
     .text(text, 62, by + 22, { width: PAGE_W - 20, lineGap: 2 });
  doc.y = by + bh + 4;
  gap(6);
}

function table(headers, rows) {
  gap(8);
  const colW = PAGE_W / headers.length;
  const rowH = 22;
  let ty = y();

  // Header
  doc.rect(50, ty, PAGE_W, rowH).fill(C.blue);
  headers.forEach((h, i) => {
    doc.fontSize(9).fillColor(C.white).font("Helvetica-Bold")
       .text(h, 50 + i * colW + 6, ty + 7, { width: colW - 10 });
  });
  ty += rowH;

  // Rows
  rows.forEach((row, ri) => {
    if (ty + rowH > doc.page.height - 80) { addPage(); ty = y(); }
    doc.rect(50, ty, PAGE_W, rowH).fill(ri % 2 === 0 ? C.light : C.white);
    row.forEach((cell, ci) => {
      doc.fontSize(8.5).fillColor(C.body).font("Helvetica")
         .text(String(cell), 50 + ci * colW + 6, ty + 7, { width: colW - 10 });
    });
    doc.save().strokeColor(C.border).lineWidth(0.4)
       .rect(50, ty, PAGE_W, rowH).stroke().restore();
    ty += rowH;
  });
  doc.y = ty;
  gap(10);
}

function footer(pageNum) {
  doc.save()
     .fontSize(8).fillColor(C.muted).font("Helvetica")
     .text(`Signalium Platform Guide  ·  Page ${pageNum}`,
           50, doc.page.height - 30, { align: "center", width: PAGE_W })
     .restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// COVER
// ═══════════════════════════════════════════════════════════════════════════
coverPage();

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — Prerequisites & Architecture
// ═══════════════════════════════════════════════════════════════════════════
sectionHeader(1, "Prerequisites & Architecture", "What you need before you start");

h2("System Architecture");
body("Signalium is a multi-service platform running on a single VPS. The services communicate locally and are proxied externally through Nginx with SSL.");

table(
  ["Service", "Port", "Technology", "Purpose"],
  [
    ["signalium-api",     "3000", "Node.js / ESM",   "Main platform API & admin backend"],
    ["signalium-trainer", "3001", "Node.js / ESM",   "QDE inference & trainer gateway"],
    ["signalium-qde",     "varies","Node.js",         "Quantitative decision engine"],
    ["Research Lab",      "8002", "Python / FastAPI", "ML training & experiment tracking"],
    ["Nginx",             "80/443","Nginx 1.24",      "SSL termination & reverse proxy"],
    ["PostgreSQL",        "5432", "Postgres 15",      "Primary database"],
    ["Redis",             "6379", "Redis",            "Cache & pub/sub"],
  ]
);

h2("Minimum Server Requirements");
table(
  ["Resource", "Minimum", "Recommended"],
  [
    ["CPU",     "4 vCPU",  "8 vCPU"],
    ["RAM",     "8 GB",    "16 GB"],
    ["Storage", "80 GB SSD","200 GB SSD"],
    ["OS",      "Ubuntu 22.04", "Ubuntu 22.04 LTS"],
    ["Node.js", "v20.x",   "v20.x LTS"],
    ["Python",  "3.10+",   "3.11"],
    ["PM2",     "latest",  "latest"],
  ]
);

h2("Required Accounts");
bullet([
  "VPS provider account (Hetzner, DigitalOcean, Linode, AWS EC2, etc.)",
  "Domain name with DNS access (e.g. signaliumai.com)",
  "GitHub account (for source code & CI/CD)",
  "RunPod account with billing set up (for GPU training pods)",
  "Docker Hub account (to host your trainer Docker image)",
]);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — VPS Server Setup
// ═══════════════════════════════════════════════════════════════════════════
sectionHeader(2, "VPS Server Setup", "Prepare the production server");

h2("1. Initial Server Preparation");
code(`# Connect to your server
ssh root@YOUR_SERVER_IP

# Update system packages
apt update && apt upgrade -y

# Install essential tools
apt install -y curl wget git unzip build-essential nginx certbot python3-certbot-nginx

# Install Node.js 20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install Python 3.11 and pip
apt install -y python3.11 python3.11-venv python3.11-pip

# Install PostgreSQL 15
apt install -y postgresql postgresql-contrib

# Verify versions
node -v && npm -v && pm2 -v && python3.11 -V && nginx -v`, "bash");

h2("2. Database Setup");
code(`# Switch to postgres user
sudo -u postgres psql

-- Inside psql:
CREATE USER signalium_user WITH PASSWORD 'your_strong_password_here';
CREATE DATABASE signalium OWNER signalium_user;
GRANT ALL PRIVILEGES ON DATABASE signalium TO signalium_user;
\\q`, "bash");

h2("3. Directory Structure");
code(`# Create the deployment directories
mkdir -p /var/www/signalium/server
mkdir -p /var/www/signalium/public
mkdir -p /var/www/signalium/drizzle
mkdir -p /var/www/signalium/server/logs
mkdir -p /var/www/signalium/dist

# The final layout should be:
# /var/www/signalium/
#   server/          ← Node.js API bundle
#     index.mjs      ← main entry point
#     .env           ← environment variables
#     logs/          ← PM2 log output
#   public/          ← built React frontend
#   drizzle/         ← SQL migration files
#   ecosystem.config.cjs  ← PM2 config
#   dist/server → server/ (symlink, required)
#   node_modules/    ← runtime dependencies

# Create the required symlink
ln -sf /var/www/signalium/server /var/www/signalium/dist/server`, "bash");

h2("4. Environment Variables (.env)");
body("Create the environment file at /var/www/signalium/server/.env with all required values:");
code(`cat > /var/www/signalium/server/.env << 'EOF'
# Core
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://signalium_user:YOUR_PASSWORD@localhost:5432/signalium

# Security
SESSION_SECRET=generate_a_64_char_hex_string_here
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# JWT (SSO)
JWT_ISSUER=signalium
JWT_EXPIRATION=300
JWT_REFRESH_EXPIRATION=30

# Trainer integration
RESEARCH_LAB_ADMIN_TOKEN=your_shared_secret_token
QDE_RESEARCH_LAB_URL=http://localhost:8002
QDE_TRAINER_URL=http://localhost:3001

# RunPod (optional — can be set via Admin → Managed Secrets instead)
RUNPOD_API_KEY=your_runpod_api_key
RUNPOD_DEFAULT_GPU=NVIDIA GeForce RTX 4090
RUNPOD_MAX_HOURLY_COST_USD=2.50
RUNPOD_MAX_ACTIVE_PODS=3
EOF`, "bash");

infoBox("Security Note", "Generate SESSION_SECRET with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"", C.yellow);

h2("5. Nginx Configuration");
code(`# Create the Nginx site config
cat > /etc/nginx/sites-available/signalium << 'EOF'
upstream signalium_api {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Serve frontend
    root /var/www/signalium/public;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass         http://signalium_api;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }

    # Frontend SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# Enable the site
ln -s /etc/nginx/sites-available/signalium /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Install SSL certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com`, "bash");

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — GitHub Repository Setup
// ═══════════════════════════════════════════════════════════════════════════
sectionHeader(3, "GitHub Repository Setup", "Source control & CI/CD pipeline");

h2("1. Create GitHub Repository");
numbered([
  "Go to https://github.com/new and create a private repository named signalium-platform",
  "Do NOT initialize with README — the Replit workspace already has the code",
  "Copy the repository URL (e.g. https://github.com/yourusername/signalium-platform.git)",
]);

h2("2. Push Code from Replit to GitHub");
body("Run these commands inside the Replit workspace terminal:");
code(`# Configure git identity (first time only)
git config --global user.email "you@example.com"
git config --global user.name "Your Name"

# Add GitHub as remote
git remote add origin https://github.com/yourusername/signalium-platform.git

# Push all code
git push -u origin main`, "bash");

infoBox("Authentication Tip", "Use a GitHub Personal Access Token (PAT) instead of a password. Create one at: GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic). Give it repo scope.", C.accent);

h2("3. Set Up GitHub Secrets");
body("These secrets are used by the CI/CD workflow. Go to GitHub → Your Repo → Settings → Secrets and Variables → Actions:");
table(
  ["Secret Name", "Value"],
  [
    ["VPS_HOST",       "Your server IP address"],
    ["VPS_USER",       "root (or your deploy user)"],
    ["VPS_SSH_KEY",    "Private SSH key for server access"],
    ["VPS_DEPLOY_PATH","/var/www/signalium"],
  ]
);

h2("4. Add SSH Key to VPS");
code(`# On your LOCAL machine — generate a deploy key
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/signalium_deploy

# Copy the PUBLIC key to your VPS
ssh-copy-id -i ~/.ssh/signalium_deploy.pub root@YOUR_SERVER_IP

# Copy the PRIVATE key content — paste it into GitHub Secret VPS_SSH_KEY
cat ~/.ssh/signalium_deploy`, "bash");

h2("5. GitHub Actions CI/CD Workflow");
body("Create this file in your repository to auto-deploy on every push to main:");
code(`# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build platform
        run: bash scripts/build-release.sh

      - name: Package release
        run: bash scripts/package-release.sh

      - name: Deploy to VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USER }}
          key: \${{ secrets.VPS_SSH_KEY }}
          source: "release/server/*,release/public/*,release/drizzle/*"
          target: \${{ secrets.VPS_DEPLOY_PATH }}
          strip_components: 1

      - name: Restart services
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: \${{ secrets.VPS_HOST }}
          username: \${{ secrets.VPS_USER }}
          key: \${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/signalium
            set -a && source server/.env && set +a
            node server/migrate.mjs
            pm2 restart signalium-api --update-env
            pm2 save`, "bash");

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — Platform Deployment
// ═══════════════════════════════════════════════════════════════════════════
sectionHeader(4, "Platform Deployment", "Build, package and deploy the platform");

h2("1. Build the Release");
body("Run these commands in the Replit workspace terminal to produce the production bundles:");
code(`# Install all dependencies first
pnpm install

# Build frontend (React/Vite) + backend (esbuild)
bash scripts/build-release.sh

# This produces:
# release/
#   server/     ← bundled Node.js API (index.mjs + worker files)
#   public/     ← built React SPA (HTML, CSS, JS assets)
#   drizzle/    ← SQL migration files`, "bash");

h2("2. Upload to VPS (FileZilla / SCP)");
body("Using FileZilla:");
numbered([
  "Open FileZilla → File → Site Manager → New Site",
  "Protocol: SFTP | Host: YOUR_SERVER_IP | Port: 22",
  "Logon Type: Key file | Key file: your private SSH key",
  "Connect, then navigate to /var/www/signalium/ on the server",
  "Upload the contents of release/server/ → into /var/www/signalium/server/",
  "Upload the contents of release/public/ → into /var/www/signalium/public/",
  "Upload the contents of release/drizzle/ → into /var/www/signalium/drizzle/",
  "Upload ecosystem.config.cjs → into /var/www/signalium/",
]);

h2("3. Run Database Migrations");
code(`cd /var/www/signalium
set -a && source server/.env && set +a
node server/migrate.mjs`, "bash");

h2("4. Start Services with PM2");
code(`cd /var/www/signalium

# Source env and start all services
set -a && source server/.env && set +a

# Start the main API
pm2 start ecosystem.config.cjs --env production

# Save PM2 process list (survives reboots)
pm2 save

# Set PM2 to start on system boot
pm2 startup
# Copy and run the command it outputs

# Check everything is running
pm2 status`, "bash");

h2("5. Verify Deployment");
code(`# Check the API is responding
curl -s https://yourdomain.com/api/auth/login \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'x-signalium-client: 1' \
  -d '{"email":"admin@example.com","password":"yourpassword"}'

# Check PM2 logs
pm2 logs signalium-api --lines 20 --nostream`, "bash");

infoBox("symlink required", "After every upload, ensure /var/www/signalium/dist/server → /var/www/signalium/server exists. Without it PM2 cannot find index.mjs. Run: ln -sf /var/www/signalium/server /var/www/signalium/dist/server", C.red);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — RunPod GPU Orchestration
// ═══════════════════════════════════════════════════════════════════════════
sectionHeader(5, "RunPod GPU Orchestration", "On-demand GPU pods for model training");

h2("How It Works");
body("Signalium holds all RunPod credentials — the trainer never receives them. When a training run needs a GPU pod, Signalium launches it, issues the trainer a short-lived scoped token, and monitors cost accrual in real time.");

h2("1. Create RunPod Account & API Key");
numbered([
  "Sign up at https://runpod.io and add a payment method under Billing",
  "Go to Settings → API Keys → + Create API Key",
  "Name it signalium-platform and copy the key (shown only once)",
  "Keep the key safe — you will paste it into Admin → Managed Secrets",
]);

h2("2. Build & Push Your Docker Image");
body("Your trainer must be containerised so RunPod can start it. If a Dockerfile already exists in /opt/signalium-trainer/, use it:");
code(`# On your VPS — check what Python version & packages are in use
python3 --version
/opt/signalium-trainer/.venv/bin/pip freeze > requirements.txt
cat requirements.txt | head -20

# Check for existing Dockerfile
ls /opt/signalium-trainer/
find /opt/signalium-trainer -name "Dockerfile" 2>/dev/null`, "bash");

h3("If No Dockerfile Exists — Create One");
code(`# /opt/signalium-trainer/Dockerfile
FROM runpod/pytorch:2.2.0-py3.11-cuda12.1.0-devel-ubuntu22.04

WORKDIR /app

# Copy your trainer code
COPY . .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Expose the trainer API port
EXPOSE 8002

# Start the Research Lab API
CMD ["uvicorn", "trainer.research_lab.research_lab_server:app", \\
     "--host", "0.0.0.0", "--port", "8002", "--workers", "1"]`, "dockerfile");

code(`# Build and push to Docker Hub
# (run this on your local machine or VPS with Docker installed)

docker login  # enter Docker Hub username and password

cd /opt/signalium-trainer
docker build -t yourdockerhubuser/signalium-trainer:latest .
docker push yourdockerhubuser/signalium-trainer:latest`, "bash");

h2("3. Create a Pod Template on RunPod");
numbered([
  "RunPod Dashboard → My Templates → New Template",
  "Container Image: yourdockerhubuser/signalium-trainer:latest",
  "Container Disk: 20 GB minimum",
  "Expose HTTP Port: 8002",
  "Environment Variables: add RESEARCH_LAB_ADMIN_TOKEN=your_shared_secret",
  "Save the template and copy the Template ID",
]);

h2("4. Create a Persistent Volume (Recommended)");
numbered([
  "RunPod Dashboard → Storage → + New Network Volume",
  "Select your preferred region (e.g. EU-RO-1 or US-TX-3)",
  "Size: 50–100 GB (stores model checkpoints between runs)",
  "Copy the Volume ID",
]);

h2("5. Configure GPU Pricing");
body("GPU pricing must be server-side configured — Signalium enforces budget caps using these values. Create the JSON with current prices from runpod.io/gpu-instance/pricing:");
code(`{
  "NVIDIA GeForce RTX 4090": 0.74,
  "NVIDIA GeForce RTX 3090": 0.44,
  "NVIDIA A40": 0.48,
  "NVIDIA A100 80GB PCIe": 1.89,
  "NVIDIA H100 80GB HBM3": 3.49
}`, "json");

h2("6. Set All Values in Admin → Managed Secrets");
table(
  ["Vault Key", "Example Value", "Required"],
  [
    ["runpod.api_key",                "rpa_xxxxxxxxxxxx",           "Yes"],
    ["runpod.default_template_id",    "abc123def456",               "Yes"],
    ["runpod.default_gpu",            "NVIDIA GeForce RTX 4090",    "Yes"],
    ["runpod.allowed_gpus",           "NVIDIA GeForce RTX 4090,...","Yes"],
    ["runpod.gpu_pricing_json",       "{ see above }",              "Yes"],
    ["runpod.default_volume_id",      "vol_xxxxxxxx",               "Recommended"],
    ["runpod.region",                 "EU-RO-1",                    "Optional"],
    ["runpod.max_hourly_cost_usd",    "2.50",                       "Yes"],
    ["runpod.max_active_pods",        "3",                          "Yes"],
    ["runpod.auto_shutdown_idle_minutes","30",                       "Recommended"],
  ]
);

infoBox("Budget Enforcement", "Signalium checks total active pod cost before every launch. If the new pod would push total hourly spend above max_hourly_cost_usd, the launch is rejected and logged. Unknown GPU types are also blocked.", C.yellow);

h2("7. Security Model");
bullet([
  "Signalium holds the RunPod API key — the trainer process never sees it",
  "Signalium issues the trainer short-lived tokens (60 min) scoped to one pod only",
  "All launches, stops, and cost accrual events are written to the audit log",
  "The monitor polls RunPod every 60 seconds to sync status and cost",
  "Circuit breaker stops retrying after 4 consecutive RunPod API failures",
]);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — Model Training Guide
// ═══════════════════════════════════════════════════════════════════════════
sectionHeader(6, "Model Training Guide", "Train, validate and deploy the QDE model");

h2("What the Model Decides");
body("The Quantitative Decision Engine (QDE) model evaluates open trading positions and returns one of 7 actions:");
table(
  ["Action", "Meaning", "When"],
  [
    ["HOLD",        "Do nothing — position is healthy",             "Normal range P&L, low drawdown"],
    ["ADD",         "Increase position size",                       "Strong conviction, low risk"],
    ["REDUCE",      "Partially close the position",                 "Elevated drawdown (≥ 8%)"],
    ["CLOSE",       "Full exit",                                    "Risk limit breached (≥ 15% drawdown)"],
    ["TRAIL",       "Move stop-loss up to lock in profit",          "Profit ≥ 2%"],
    ["LOCK_PROFIT", "Hard lock at current profit level",            "Profit ≥ 5%"],
    ["BREAKEVEN",   "Move stop to entry price",                     "Small profit, protect from loss"],
  ]
);

h2("Input Data (TelemetrySnapshot)");
body("Every inference call sends this JSON to the trainer:");
code(`{
  "type":               "inference",       // or review-position, review-portfolio
  "symbol":             "EURUSD",          // broker-normalised symbol
  "telemetry": {
    "floatingPnl":       -45.20,           // Unrealised P&L in account currency
    "marginUtilization":  0.42,            // 0.0–1.0 (42% of margin in use)
    "drawdown":           3.8,             // Max drawdown % from peak
    "tradeAgeSeconds":    3600,            // Seconds since position opened
    "entryPrice":         1.0850,          // Price at entry
    "currentPrice":       1.0812,          // Current market price
    "spread":             1.2              // Current bid/ask spread in pips
  }
}`, "json");

h2("Output Format (TrainerDecision)");
code(`{
  "action":       "HOLD",             // Required — one of the 7 enum values
  "reasoning":    "Position within normal range...",  // Required — plain English
  "confidence":    0.87,              // Optional 0.0–1.0
  "risk_signal":  "MEDIUM",          // Optional: LOW | MEDIUM | HIGH | EXTREME
  "size_signal":  "NORMAL",          // Optional: MINIMAL | NORMAL | AGGRESSIVE
  "entry_urgency":"CONDITIONAL",     // Optional: IMMEDIATE | CONDITIONAL | WAIT
  "exit_horizon": "INTRADAY",        // Optional: SCALP | INTRADAY | SWING | HOLD
  "model_version":"v2.3.1"           // Optional: tag for audit trail
}`, "json");

h2("Step-by-Step Training Workflow");

h3("Step 1 — Define an Experiment");
code(`POST http://localhost:8002/experiments
X-Trainer-Api-Key: your_shared_secret

{
  "name": "v3-drawdown-aware",
  "config": {
    "model_type":    "gradient_boosted_tree",
    "features":      ["drawdown","floatingPnl","marginUtilization",
                      "tradeAgeSeconds","spread"],
    "target":        "optimal_action",
    "dataset_start": "2025-01-01",
    "dataset_end":   "2026-06-30",
    "train_split": 0.80,
    "val_split":   0.10,
    "test_split":  0.10
  }
}`, "bash");

h3("Step 2 — Start a Training Run");
code(`POST http://localhost:8002/training/runs
X-Trainer-Api-Key: your_shared_secret

{
  "experiment_id": "<id from step 1>",
  "hyperparameters": {
    "learning_rate": 0.05,
    "max_depth": 6,
    "n_estimators": 500,
    "early_stopping_rounds": 20
  }
}`, "bash");

h3("Step 3 — Monitor Progress");
code(`GET http://localhost:8002/training/runs/{run_id}
GET http://localhost:8002/training/resource-usage`, "bash");

h3("Step 4 — Review Validation Report");
body("Once training completes, check validation metrics:");
table(
  ["Metric", "Target", "Notes"],
  [
    ["accuracy",          "≥ 0.72",  "vs heuristic baseline"],
    ["precision_close",   "High",    "False CLOSE is very costly"],
    ["r_multiple_mean",   "≥ 1.3",   "1.3:1 reward/risk average"],
    ["max_drawdown_test", "< baseline","Must beat the heuristic"],
    ["sharpe_ratio",      "≥ 1.5",   "Risk-adjusted returns"],
    ["drift_score",       "< 0.15",  "Feature distribution drift"],
  ]
);

h3("Step 5 — Shadow Testing");
code(`# Run new model in shadow mode alongside the live model for 72 hours
POST http://localhost:8002/shadow-testing/deployments

{
  "run_id": "<training run id>",
  "shadow_duration_hours": 72,
  "symbols": ["EURUSD", "XAUUSD", "GBPUSD"]
}

# Check comparison results
GET http://localhost:8002/shadow-testing/deployments/{id}/comparison

# Minimum pass criteria:
# agreement_rate  ≥ 0.78  (agrees with live model 78%+ of the time)
# new_model_wins  ≥ 0.55  (outperforms on divergences)`, "bash");

h3("Step 6 — Promote to Production");
numbered([
  "Go to Admin → Research Lab → Deployment Candidates",
  "Find your validated candidate and click Approve",
  "Signalium hot-swaps the model on signalium-trainer — no restart needed",
  "Monitor Admin → Trainer Sync Status for 30 minutes post-promotion",
  "Healthy indicators: latency < 400ms, error rate < 0.1%, HOLD rate 50–80%",
]);

h2("Heuristic Fallback Baseline");
body("When the trainer is offline, this built-in logic runs automatically. Your model must beat it:");
table(
  ["Condition", "Action"],
  [
    ["drawdown ≥ 15% OR marginUtilization ≥ 0.80", "CLOSE"],
    ["drawdown ≥ 8%",                               "REDUCE"],
    ["floatingPnl% ≥ 5%",                           "LOCK_PROFIT"],
    ["floatingPnl% ≥ 2%",                           "TRAIL"],
    ["floatingPnl% ≥ 0.5%",                         "BREAKEVEN"],
    ["strong momentum + low risk",                  "ADD"],
    ["everything else",                             "HOLD"],
  ]
);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — Production Configuration
// ═══════════════════════════════════════════════════════════════════════════
sectionHeader(7, "Production Configuration", "Finalize platform settings before going live");

h2("Admin → Managed Secrets — Full Reference");
body("All sensitive config lives in the encrypted vault. Set these via Admin → Managed Secrets:");

h3("Trainer / Research Lab");
table(
  ["Key", "Value"],
  [
    ["trainer.url",     "http://localhost:3001  (trainer API)"],
    ["trainer.api_key", "your RESEARCH_LAB_ADMIN_TOKEN value"],
  ]
);

h3("RunPod");
table(
  ["Key", "Value"],
  [
    ["runpod.api_key",                  "your RunPod API key"],
    ["runpod.default_template_id",      "RunPod template ID"],
    ["runpod.default_gpu",              "GPU type string"],
    ["runpod.allowed_gpus",             "comma-separated GPU types"],
    ["runpod.gpu_pricing_json",         "{ GPU: price } JSON"],
    ["runpod.default_volume_id",        "RunPod volume ID"],
    ["runpod.max_hourly_cost_usd",      "e.g. 2.50"],
    ["runpod.max_active_pods",          "e.g. 3"],
    ["runpod.auto_shutdown_idle_minutes","e.g. 30"],
  ]
);

h2("PM2 Startup on Reboot");
code(`# Run this once — PM2 will auto-restart all services on server reboot
pm2 startup
# Copy and run the command it outputs, then:
pm2 save`, "bash");

h2("SSL Certificate Auto-Renewal");
code(`# Certbot auto-renews by default. Verify with:
certbot renew --dry-run

# If it fails, ensure port 80 is accessible:
ufw allow 80
ufw allow 443`, "bash");

h2("Firewall Setup");
code(`ufw allow ssh
ufw allow 80
ufw allow 443
ufw deny 3000    # block direct API port — Nginx is the entry point
ufw deny 5432    # block Postgres from outside
ufw deny 6379    # block Redis from outside
ufw enable
ufw status`, "bash");

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — Maintenance & Troubleshooting
// ═══════════════════════════════════════════════════════════════════════════
sectionHeader(8, "Maintenance & Troubleshooting", "Common issues and how to fix them");

h2("PM2 Command Reference");
table(
  ["Command", "Purpose"],
  [
    ["pm2 status",                       "View all services and their state"],
    ["pm2 logs signalium-api --lines 50","View last 50 log lines"],
    ["pm2 logs signalium-api --err",     "View error log only"],
    ["pm2 restart signalium-api",        "Restart without env update"],
    ["pm2 restart signalium-api --update-env","Restart and reload .env"],
    ["pm2 reload signalium-api",         "Zero-downtime reload"],
    ["pm2 stop signalium-api",           "Stop the service"],
    ["pm2 env 6",                        "Show env vars for process id 6"],
  ]
);

h2("Common Issues & Fixes");

h3("502 Bad Gateway from Nginx");
body("The API server isn't running or crashed. Check:");
code(`pm2 status                              # Is signalium-api 'online' or 'errored'?
pm2 logs signalium-api --err --lines 30  # What error caused the crash?
node /var/www/signalium/server/index.mjs # Run directly to see the error`, "bash");

h3("Research Lab Unavailable");
bullet([
  "Check the vault: Admin → Managed Secrets → trainer.url = http://localhost:8002",
  "Test the Research Lab directly: curl -s http://localhost:8002/experiments",
  "Check if it's running: pm2 status (look for signalium-researc…)",
  "If crashed: pm2 logs 11 --err --lines 20 --nostream",
]);

h3("Login Not Working");
code(`# Test login directly
curl -s -X POST https://yourdomain.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'x-signalium-client: 1' \
  -d '{"email":"you@example.com","password":"yourpassword"}' \
  -w "\nHTTP %{http_code}"`, "bash");

h3("Env Vars Not Loaded After Reboot");
code(`# After a reboot PM2 restores processes but loses unsaved env vars.
# Always persist env before rebooting:
cd /var/www/signalium
set -a && source server/.env && set +a
pm2 restart all --update-env
pm2 save`, "bash");

h3("Database Migration Errors");
code(`# Run migrations manually
cd /var/www/signalium
set -a && source server/.env && set +a
node server/migrate.mjs

# If migration fails, check the drizzle/ folder has the latest SQL files
ls -la /var/www/signalium/drizzle/`, "bash");

h2("Health Check Endpoints");
table(
  ["Endpoint", "Expected Response", "Checks"],
  [
    ["GET /api/auth/session",       "200 or 401",          "API is alive"],
    ["GET /api/account/security-status","200 or 304",     "Auth + DB working"],
    ["GET http://localhost:3001/health","{ status: ok }","Trainer running"],
    ["GET http://localhost:8002/health","{ status: ok }","Research Lab running"],
  ]
);

h2("Log File Locations");
table(
  ["Service", "Log Path"],
  [
    ["signalium-api (stdout)", "/var/www/signalium/server/logs/out.log"],
    ["signalium-api (stderr)", "/var/www/signalium/server/logs/error.log"],
    ["Research Lab",           "/root/.pm2/logs/signalium-research-lab-error.log"],
    ["Trainer",                "/root/.pm2/logs/signalium-trainer*.log"],
    ["Nginx access",           "/var/log/nginx/access.log"],
    ["Nginx error",            "/var/log/nginx/error.log"],
  ]
);

// ─── Final page ─────────────────────────────────────────────────────────────
addPage();
doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.navy);
doc.rect(0, 0, doc.page.width, 6).fill(C.accent);
doc.rect(0, doc.page.height - 6, doc.page.width, 6).fill(C.accent);

doc.fontSize(24).fillColor(C.white).font("Helvetica-Bold")
   .text("You're all set.", 50, doc.page.height / 2 - 80, { align: "center" });

doc.fontSize(13).fillColor(C.cyan).font("Helvetica")
   .text("Signalium Platform is production-ready.", 50, doc.page.height / 2 - 44, { align: "center" });

const checklist = [
  "VPS server configured with Node.js, Python, Postgres and Nginx",
  "GitHub repository connected with CI/CD auto-deploy",
  "PM2 services running and persisted across reboots",
  "SSL certificate installed and auto-renewing",
  "RunPod GPU pods configured with budget enforcement",
  "Trainer connected and Research Lab reachable",
  "Admin vault secrets all set",
];

const cl_x = 160, cl_y = doc.page.height / 2 + 10;
checklist.forEach((item, i) => {
  doc.save().fillColor(C.green).fontSize(11)
     .text("✓", cl_x - 18, cl_y + i * 22).restore();
  doc.fontSize(11).fillColor(C.light).font("Helvetica")
     .text(item, cl_x, cl_y + i * 22);
});

doc.fontSize(9).fillColor(C.muted).font("Helvetica")
   .text("signaliumai.com  ·  Confidential Internal Document  ·  July 2026",
         50, doc.page.height - 30, { align: "center", width: PAGE_W });

// ─── Finalize ───────────────────────────────────────────────────────────────
doc.end();

stream.on("finish", () => {
  console.log(`PDF written → ${OUT_PATH}`);
});
stream.on("error", (err) => {
  console.error("Stream error:", err);
  process.exit(1);
});
