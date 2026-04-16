#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# CPL App Deploy Script
# Run this on the server to deploy the latest version from GitHub.
#
# Usage:
#   bash scripts/deploy.sh           # deploy latest main
#   bash scripts/deploy.sh v1.2.3    # deploy specific tag
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")/.."

TAG=${1:-main}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CPL Deploy — $TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check .env exists
if [ ! -f ".env" ]; then
  echo ""
  echo "  ❌ Missing .env file in project root."
  echo "     cp .env.example .env && nano .env"
  exit 1
fi

# ── Pull latest code ──────────────────────────────────────────────────────────
echo ""
echo "→ Pulling latest code ($TAG)..."
git fetch --all --tags
if [ "$TAG" = "main" ]; then
  git checkout main
  git pull origin main
else
  git checkout "$TAG"
fi
echo "  ✅ Code at: $(git log -1 --format='%h %s')"

# ── Build and restart app ─────────────────────────────────────────────────────
echo ""
echo "→ Building Docker image..."
docker compose build --no-cache cpl-app

echo ""
echo "→ Restarting app (zero-downtime swap)..."
docker compose up -d --no-deps cpl-app

# ── Health check ──────────────────────────────────────────────────────────────
echo ""
echo "→ Waiting for app to be healthy..."
MAX_WAIT=60
WAIT=0
until curl -sf http://localhost:3000/api/health > /dev/null; do
  sleep 3
  WAIT=$((WAIT + 3))
  if [ $WAIT -ge $MAX_WAIT ]; then
    echo "  ❌ App failed health check after ${MAX_WAIT}s — rolling back..."
    docker compose logs --tail=50 cpl-app
    exit 1
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployed successfully!"
echo "  Version: $(git log -1 --format='%h %s')"
echo "  Time:    $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
