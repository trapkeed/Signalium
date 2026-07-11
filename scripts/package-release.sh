#!/usr/bin/env bash
# =============================================================================
# scripts/package-release.sh — Create the production release tarball
# =============================================================================
#
# Run AFTER scripts/build-release.sh.
#
# Usage:
#   ./scripts/package-release.sh
#   ./scripts/package-release.sh --output /tmp/builds   # custom output dir
#   VERSION=1.2.3 ./scripts/package-release.sh          # embed version in filename
#
# Output:
#   signalium-platform-release[-VERSION][-TIMESTAMP].tar.gz
#   (in the workspace root by default, or --output path)
#
# The tarball extracts to:  signalium-platform-release/
# On the VPS:  tar xzf signalium-platform-release.tar.gz
#              cd signalium-platform-release/
#              npm install --omit=dev
#              cp .env.example .env && nano .env
#              ./scripts/migrate.sh
#              pm2 start ecosystem.config.cjs --env production
#
# =============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${BOLD}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}✔ $*${NC}"; }
die()  { echo -e "${RED}✖ $*${NC}" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output|-o)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$WORKSPACE_ROOT/release"

# ---------------------------------------------------------------------------
# Validate release/ exists
# ---------------------------------------------------------------------------
[[ -d "$RELEASE_DIR" ]] || die "release/ directory not found. Run ./scripts/build-release.sh first."
[[ -f "$RELEASE_DIR/dist/server/index.mjs" ]] || die "Backend bundle missing. Run ./scripts/build-release.sh first."
[[ -d "$RELEASE_DIR/dist/public" ]] || die "Frontend build missing. Run ./scripts/build-release.sh first."

# ---------------------------------------------------------------------------
# Determine output path
# ---------------------------------------------------------------------------
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
VERSION="${VERSION:-}"
if [[ -n "$VERSION" ]]; then
  FILENAME="signalium-platform-release-${VERSION}-${TIMESTAMP}.tar.gz"
else
  FILENAME="signalium-platform-release.tar.gz"
fi

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
  TARBALL="$OUTPUT_DIR/$FILENAME"
else
  TARBALL="$WORKSPACE_ROOT/$FILENAME"
fi

# ---------------------------------------------------------------------------
# Write build metadata into the release
# ---------------------------------------------------------------------------
step "Writing build metadata"

GIT_COMMIT="$(git -C "$WORKSPACE_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
GIT_BRANCH="$(git -C "$WORKSPACE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$RELEASE_DIR/BUILD_INFO" <<EOF
build_time=$BUILD_TIME
git_commit=$GIT_COMMIT
git_branch=$GIT_BRANCH
version=${VERSION:-unversioned}
EOF
ok "BUILD_INFO written (commit=$GIT_COMMIT, branch=$GIT_BRANCH)"

# ---------------------------------------------------------------------------
# Create tarball
# ---------------------------------------------------------------------------
step "Creating tarball: $FILENAME"

# Extract to a directory named signalium-platform-release/ on the VPS
tar \
  --create \
  --gzip \
  --file="$TARBALL" \
  --directory="$WORKSPACE_ROOT" \
  --transform="s|^release|signalium-platform-release|" \
  release/

TARBALL_SIZE="$(du -sh "$TARBALL" | cut -f1)"
ok "Tarball created: $TARBALL ($TARBALL_SIZE)"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}============================================================${NC}"
echo -e "${GREEN}${BOLD}  Package ready: $FILENAME${NC}"
echo -e "${GREEN}${BOLD}============================================================${NC}"
echo ""
echo "Transfer to your VPS:"
echo "  scp $TARBALL user@your-server:/var/www/"
echo ""
echo "On the VPS:"
echo "  cd /var/www"
echo "  tar xzf $FILENAME"
echo "  cd signalium-platform-release"
echo "  npm install --omit=dev"
echo "  cp .env.example .env && nano .env     # fill in all values"
echo "  ./scripts/migrate.sh                  # run DB migrations"
echo "  pm2 start ecosystem.config.cjs --env production"
echo "  pm2 save && pm2 startup               # survive reboots"
echo ""
echo "See docs/PRODUCTION_DEPLOYMENT.md for the full deployment guide."
echo ""
