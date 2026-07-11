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
