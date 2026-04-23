#!/bin/bash
# CPL Cron Runner
# Runs all timer-driven endpoints.
# Called by crontab every minute for timer events, daily for maintenance tasks.
#
# Setup on Hetzner:
#   chmod +x /path/to/cpl-app/scripts/cron-runner.sh
#   crontab -e   (then add the entries shown at the bottom of this file)

APP_URL="http://localhost:3000"
CRON_SECRET="${CRON_SECRET}"   # reads from environment, set in /etc/environment or inline

# If CRON_SECRET isn't in the environment, load it from the app's .env.local
if [ -z "$CRON_SECRET" ]; then
  CRON_SECRET=$(grep '^CRON_SECRET=' "$(dirname "$0")/../.env.local" | cut -d '=' -f2-)
fi

AUTH_HEADER="Authorization: Bearer ${CRON_SECRET}"

# ── Timer-driven (every minute) ───────────────────────────────────────────────

case "$1" in
  result-verify)
    curl -sf -H "$AUTH_HEADER" "${APP_URL}/api/cron/result-verify" -o /dev/null
    ;;
  time-confirm)
    curl -sf -H "$AUTH_HEADER" "${APP_URL}/api/cron/time-confirm" -o /dev/null
    ;;
  challenge-forfeit)
    curl -sf -H "$AUTH_HEADER" "${APP_URL}/api/cron/challenge-forfeit" -o /dev/null
    ;;

  # ── Maintenance (daily) ───────────────────────────────────────────────────
  freeze-drops)
    curl -sf -H "$AUTH_HEADER" "${APP_URL}/api/cron/freeze-drops" -o /dev/null
    ;;
  ladder-snapshot)
    curl -sf -H "$AUTH_HEADER" "${APP_URL}/api/cron/ladder-snapshot" -o /dev/null
    ;;

  *)
    echo "Usage: $0 {result-verify|time-confirm|challenge-forfeit|freeze-drops|ladder-snapshot}"
    exit 1
    ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
# CRONTAB ENTRIES (run: crontab -e and paste these)
# Replace /path/to/cpl-app with your actual app path, e.g. /var/www/cpl-app
#
# Timer-driven — every minute:
# * * * * * CRON_SECRET=your_secret_here /path/to/cpl-app/scripts/cron-runner.sh result-verify
# * * * * * CRON_SECRET=your_secret_here /path/to/cpl-app/scripts/cron-runner.sh time-confirm
# * * * * * CRON_SECRET=your_secret_here /path/to/cpl-app/scripts/cron-runner.sh challenge-forfeit
#
# Maintenance — daily (runs at 2:00 AM and 2:15 AM server time):
# 0  2 * * * CRON_SECRET=your_secret_here /path/to/cpl-app/scripts/cron-runner.sh freeze-drops
# 15 2 * * * CRON_SECRET=your_secret_here /path/to/cpl-app/scripts/cron-runner.sh ladder-snapshot
# ─────────────────────────────────────────────────────────────────────────────
