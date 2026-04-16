#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Start self-hosted Supabase
# Run this from /opt/cpl/app after cloning the repo.
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")/.."

SUPABASE_DIR="infra/supabase"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Supabase"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check .env exists
if [ ! -f "$SUPABASE_DIR/.env" ]; then
  echo ""
  echo "  ❌ Missing $SUPABASE_DIR/.env"
  echo "     Copy and fill in the template:"
  echo "     cp $SUPABASE_DIR/.env.example $SUPABASE_DIR/.env"
  echo "     nano $SUPABASE_DIR/.env"
  exit 1
fi

# Pull latest images and start
echo ""
echo "→ Creating shared Docker network (cpl-network)..."
docker network create cpl-network 2>/dev/null || echo "   (network already exists)"

echo ""
echo "→ Pulling Supabase images (first run takes a few minutes)..."
docker compose -f "$SUPABASE_DIR/docker-compose.yml" --env-file "$SUPABASE_DIR/.env" pull

echo ""
echo "→ Starting Supabase services..."
docker compose -f "$SUPABASE_DIR/docker-compose.yml" --env-file "$SUPABASE_DIR/.env" up -d

echo ""
echo "→ Waiting for database to be healthy..."
until docker compose -f "$SUPABASE_DIR/docker-compose.yml" --env-file "$SUPABASE_DIR/.env" \
  exec -T supabase-db pg_isready -U postgres -h localhost > /dev/null 2>&1; do
  sleep 2
  echo "   still waiting..."
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Supabase is running!"
echo ""
echo "  API:     http://localhost:8000"
echo "  Studio:  NOT public. Access via SSH tunnel:"
echo "           ssh -L 3001:localhost:3001 root@YOUR_SERVER_IP"
echo "           Then open: http://localhost:3001"
echo ""
echo "  Your ANON_KEY and SERVICE_ROLE_KEY are in: $SUPABASE_DIR/.env"
echo "  Copy them into your app .env file."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
