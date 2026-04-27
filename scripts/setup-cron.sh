#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# CPL Cron Job Setup
# Run this on the Hetzner server to register (or re-register) all cron jobs.
# Safe to re-run — it always writes a fresh crontab, no duplicates.
#
# Prerequisites:
#   - The app must be running (docker compose up -d)
#   - .env must exist in the project root with CRON_SECRET set
#
# Usage:
#   bash scripts/setup-cron.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")/.."

# Read CRON_SECRET from .env
if [ ! -f ".env" ]; then
  echo "❌ .env not found. Run from the project root or check your setup."
  exit 1
fi

CRON_SECRET=$(grep -E '^CRON_SECRET=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")
if [ -z "$CRON_SECRET" ]; then
  echo "❌ CRON_SECRET not found in .env"
  exit 1
fi

APP_URL="http://localhost:3000"
HDR="Authorization: Bearer $CRON_SECRET"

# Cron schedule explanation:
#   result-verify     — every minute   (auto-verifies match results after deadline)
#   time-confirm      — every minute   (auto-confirms match times after deadline)
#   challenge-forfeit — every minute   (forfeits overdue challenges)
#   freeze-drops      — daily at 2am   (applies weekly ladder drops for frozen teams)
#   ladder-snapshot   — daily at 2:15am (records ladder state for rank-gain tracking)

TMPFILE=$(mktemp)
cat > "$TMPFILE" << ENDOFCRON
* * * * * curl -sf -H "$HDR" $APP_URL/api/cron/result-verify >> /var/log/cpl-cron.log 2>&1
* * * * * curl -sf -H "$HDR" $APP_URL/api/cron/time-confirm >> /var/log/cpl-cron.log 2>&1
* * * * * curl -sf -H "$HDR" $APP_URL/api/cron/challenge-forfeit >> /var/log/cpl-cron.log 2>&1
0 2 * * * curl -sf -H "$HDR" $APP_URL/api/cron/freeze-drops >> /var/log/cpl-cron.log 2>&1
15 2 * * * curl -sf -H "$HDR" $APP_URL/api/cron/ladder-snapshot >> /var/log/cpl-cron.log 2>&1
ENDOFCRON
crontab "$TMPFILE"
rm "$TMPFILE"

echo "✅ Cron jobs installed. Current crontab:"
crontab -l
echo ""
echo "Logs: tail -f /var/log/cpl-cron.log"
