#!/usr/bin/env bash
# Run pending database migrations.
# Must be executed from the release/ directory.
# Requires DATABASE_URL to be set in the environment (or loaded from .env).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$RELEASE_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$RELEASE_DIR/.env"
  set +a
fi

[[ -n "${DATABASE_URL:-}" ]] || { echo "ERROR: DATABASE_URL is not set" >&2; exit 1; }

echo "Running database migrations..."
cd "$RELEASE_DIR"
node dist/server/migrate.mjs
echo "Migrations complete."
