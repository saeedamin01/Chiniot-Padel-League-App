#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# CPL Server Setup Script
# Run this ONCE on a fresh Hetzner Ubuntu 22.04 server as root.
#
# What it does:
#   1. Enables 4GB swap (critical for 4GB RAM server running Supabase)
#   2. Installs Docker + Docker Compose
#   3. Creates the app directory structure
#   4. Installs git and curl
#   5. Sets up UFW firewall (allow 22, 80, 443 only)
#
# Usage:
#   ssh root@YOUR_SERVER_IP
#   curl -sSL https://raw.githubusercontent.com/YOUR_ORG/YOUR_REPO/main/scripts/server-setup.sh | bash
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CPL Server Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. System packages ────────────────────────────────────────────────────────
echo ""
echo "→ Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

apt-get install -y -qq \
  curl git wget unzip ufw jq \
  apt-transport-https ca-certificates gnupg lsb-release

# ── 2. Swap (4GB) — critical for running Supabase on a 4GB server ─────────────
echo ""
echo "→ Setting up 4GB swap..."
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Tune swappiness — only use swap when really needed
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  sysctl vm.swappiness=10
  echo "  ✅ 4GB swap enabled"
else
  echo "  ✅ Swap already configured"
fi

# ── 3. Docker ─────────────────────────────────────────────────────────────────
echo ""
echo "→ Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "  ✅ Docker installed"
else
  echo "  ✅ Docker already installed ($(docker --version))"
fi

# ── 4. Docker Compose v2 ──────────────────────────────────────────────────────
echo ""
echo "→ Installing Docker Compose v2..."
if ! docker compose version &> /dev/null; then
  COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
  curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  echo "  ✅ Docker Compose installed"
else
  echo "  ✅ Docker Compose already installed ($(docker compose version))"
fi

# ── 5. App directory structure ────────────────────────────────────────────────
echo ""
echo "→ Creating app directory structure..."
mkdir -p /opt/cpl/{app,supabase,backups}
echo "  ✅ Created /opt/cpl/"

# ── 6. Firewall ───────────────────────────────────────────────────────────────
echo ""
echo "→ Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Traefik → redirect to HTTPS)'
ufw allow 443/tcp comment 'HTTPS'
# Supabase Kong is only accessible internally (not exposing 8000 publicly)
ufw --force enable
echo "  ✅ Firewall configured (22, 80, 443 open)"

# ── 7. Log rotation ───────────────────────────────────────────────────────────
cat > /etc/logrotate.d/cpl-cron << 'EOF'
/var/log/cpl-cron.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
}
EOF
echo "  ✅ Log rotation configured"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Server setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Clone your repo:  git clone https://github.com/YOUR_ORG/YOUR_REPO /opt/cpl/app"
echo "  2. Set up Supabase:  cd /opt/cpl/app && bash scripts/start-supabase.sh"
echo "  3. Deploy the app:   bash scripts/deploy.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
