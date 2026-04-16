#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# CPL Cron Job Setup
# Run this once on the Hetzner server to register the three cron jobs.
#
# Prerequisites:
#   - The app must be running (docker compose up -d)
#   - CRON_SECRET must be set in your .env file
#   - Edit the APP_URL and CRON_SECRET values below before running
#
# Usage:
#   chmod +x scripts/setup-cron.sh
#   ./scripts/setup-cron.sh
# ─────────────────────────────────────────────────────────────────────────────

APP_URL="https://yourdomain.com"    # ← change this
CRON_SECRET="your_cron_secret"      # ← change this (must match .env CRON_SECRET)

CRON_HEADER="Authorization: Bearer $CRON_SECRET"

# Cron schedule explanation:
#   result-verify   — every 15 minutes  (auto-verifies match results after deadline)
#   challenge-forfeit — every hour       (forfeits overdue challenges)
#   freeze-drops    — daily at 2am       (applies weekly ladder drops for frozen teams)

CRON_JOBS=(
  "*/15 * * * * curl -s -H \"$CRON_HEADER\" $APP_URL/api/cron/result-verify >> /var/log/cpl-cron.log 2>&1"
  "0 * * * *    curl -s -H \"$CRON_HEADER\" $APP_URL/api/cron/challenge-forfeit >> /var/log/cpl-cron.log 2>&1"
  "0 2 * * *    curl -s -H \"$CRON_HEADER\" $APP_URL/api/cron/freeze-drops >> /var/log/cpl-cron.log 2>&1"
)

# Install to system crontab
(crontab -l 2>/dev/null; printf '%s\n' "${CRON_JOBS[@]}") | crontab -

echo "✅ Cron jobs installed. Current crontab:"
crontab -l

echo ""
echo "Logs will be written to: /var/log/cpl-cron.log"
echo "To check logs: tail -f /var/log/cpl-cron.log"
echo "To edit cron jobs later: crontab -e"
