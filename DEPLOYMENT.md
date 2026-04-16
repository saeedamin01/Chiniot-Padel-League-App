# 🚀 Chiniot Padel League — Deployment Guide

Complete step-by-step guide for deploying the Chiniot Padel League app to production using Hetzner VPS with Docker and Traefik.

## Prerequisites

- Domain name (e.g., `chiniotpadelleague.com`)
- Hetzner account
- SSH client (built into macOS/Linux; PuTTY on Windows)
- Docker knowledge (basic)
- 30 minutes to deploy

## Step 1: Create Hetzner VPS

### 1.1 Choose Server

1. Go to [console.hetzner.cloud](https://console.hetzner.cloud)
2. Click "Create Server"
3. **Image**: Ubuntu 22.04 LTS
4. **Type**: CX21 (2 vCPU, 4 GB RAM, 40 GB SSD)
   - Sufficient for 50-200 teams
   - Scales to CX41 if needed
5. **Location**: Falkenstein or Nuremberg (closest to Europe)
   - For Pakistan users: Consider Helsinki or other EU locations for better latency
6. **Network**: Default (public)
7. **SSH Key**: Create/select your SSH public key
   - First time? Generate: `ssh-keygen -t ed25519 -f ~/.ssh/hetzner_cpl`
   - Add public key to Hetzner console
8. **Name**: `cpl-app-prod`
9. Click "Create Server"

### 1.2 Note Server IP

- Copy the public IPv4 address (e.g., `123.45.67.89`)
- You'll use this to configure DNS and SSH

## Step 2: Initial Server Setup

### 2.1 SSH into Server

```bash
ssh -i ~/.ssh/hetzner_cpl root@123.45.67.89
```

### 2.2 Update System

```bash
apt update && apt upgrade -y
apt install -y curl wget git ufw nano
```

### 2.3 Configure Firewall

```bash
ufw enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw status
```

### 2.4 Create Application User

```bash
useradd -m -s /bin/bash cpl
usermod -aG docker cpl
su - cpl
```

Verify Docker access:
```bash
docker ps
```

Should return empty list (no error).

## Step 3: Install Docker & Docker Compose

### 3.1 Install Docker Engine

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

Verify:
```bash
docker --version
docker run hello-world
```

### 3.2 Install Docker Compose

```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

## Step 4: Clone and Setup Application

### 4.1 Create App Directory

```bash
mkdir -p ~/cpl-app
cd ~/cpl-app
```

### 4.2 Clone Repository

```bash
git clone https://github.com/your-org/cpl-app.git .
# OR upload your code via SFTP/Git
```

### 4.3 Create Environment File

```bash
nano .env
```

Paste your production environment variables:

```env
# Supabase (from Supabase dashboard)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# SMTP Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx
SMTP_FROM=noreply@chiniotpadelleague.com

# App Configuration
NEXT_PUBLIC_APP_URL=https://chiniotpadelleague.com
NODE_ENV=production

# Cron Job Security
CRON_SECRET=your-super-secret-random-string-32-chars
```

Generate a secure `CRON_SECRET`:
```bash
openssl rand -base64 32
```

Save and exit: `Ctrl+X`, then `Y`, then `Enter`

### 4.4 Create Docker Compose Override

For production, create `docker-compose.prod.yml`:

```bash
nano docker-compose.prod.yml
```

```yaml
version: '3.8'
services:
  cpl-app:
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    environment:
      - NODE_ENV=production
      - NEXT_TELEMETRY_DISABLED=1
    networks:
      - traefik

  traefik:
    restart: always
    command:
      - "--api.insecure=false"
      - "--providers.docker=true"
      - "--providers.docker.network=traefik"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.myresolver.acme.httpchallenge=true"
      - "--certificatesresolvers.myresolver.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.myresolver.acme.email=admin@chiniotpadelleague.com"
      - "--certificatesresolvers.myresolver.acme.storage=/letsencrypt/acme.json"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.traefik.rule=Host(`traefik.your-domain.com`)"
      - "traefik.http.routers.traefik.entrypoints=websecure"
      - "traefik.http.routers.traefik.tls.certresolver=myresolver"
      - "traefik.http.routers.traefik.service=api@internal"
      - "traefik.http.routers.traefik.middlewares=auth@docker"
      - "traefik.http.middlewares.auth.basicauth.users=admin:$$2y$$05$$K7vPEgFz4yZFzZRGxPBxKuCMjM5h3Q6"

networks:
  traefik:
    driver: bridge
```

Save with `Ctrl+X`, `Y`, `Enter`

## Step 5: Build and Deploy

### 5.1 Build Docker Image

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build
```

This may take 5-10 minutes depending on server speed.

### 5.2 Start Services

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Verify services are running:
```bash
docker-compose ps
# Should show cpl-app and traefik containers as 'Up'
```

### 5.3 Check Logs

```bash
docker-compose logs -f cpl-app
```

Wait for: "ready - started server on 0.0.0.0:3000" message

Press `Ctrl+C` to exit logs.

## Step 6: Configure Domain & DNS

### 6.1 Point Domain to Server

In your domain registrar (GoDaddy, Namecheap, etc.):

1. Go to DNS Settings
2. Create/update A record:
   - **Type**: A
   - **Name**: @ (or leave blank)
   - **Value**: Your Hetzner IPv4 (e.g., `123.45.67.89`)
   - **TTL**: 3600

Example:
```
Type    Name    Value           TTL
A       @       123.45.67.89    3600
```

3. Wait 5-30 minutes for DNS propagation

Test DNS:
```bash
nslookup chiniotpadelleague.com
# Should return your server IP
```

### 6.2 Update Traefik Labels

Update `docker-compose.yml` with your actual domain:

```yaml
labels:
  - "traefik.http.routers.cpl-app.rule=Host(`chiniotpadelleague.com`)"
```

Also add `www` subdomain:
```yaml
labels:
  - "traefik.http.routers.cpl-app.rule=Host(`chiniotpadelleague.com`, `www.chiniotpadelleague.com`)"
```

Restart services:
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Step 7: SSL/HTTPS with Let's Encrypt

Traefik automatically handles Let's Encrypt certificate generation via the ACME HTTP challenge.

### 7.1 Verify Certificate

```bash
docker-compose logs traefik | grep -i certificate
```

Should see: "Certificate received"

### 7.2 Test HTTPS

```bash
curl -I https://chiniotpadelleague.com
# Should return 200 OK with valid certificate
```

Check in browser: https://chiniotpadelleague.com
- Green padlock indicates valid SSL certificate
- Certificate auto-renews 30 days before expiry

## Step 8: Setup Cron Jobs

### 8.1 Add to Server Crontab

SSH into server and edit crontab:
```bash
crontab -e
# Select nano if prompted
```

Add these lines:

```bash
# Challenge forfeit (every 15 minutes)
*/15 * * * * curl -s https://chiniotpadelleague.com/api/cron/challenge-forfeit \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  >> /home/cpl/cron.log 2>&1

# Rank freeze/drops (every 15 minutes)
*/15 * * * * curl -s https://chiniotpadelleague.com/api/cron/freeze-drops \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  >> /home/cpl/cron.log 2>&1

# Result verification (every 30 minutes)
*/30 * * * * curl -s https://chiniotpadelleague.com/api/cron/result-verify \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  >> /home/cpl/cron.log 2>&1
```

Replace `YOUR_CRON_SECRET` with the value from your `.env` file.

Save: `Ctrl+X`, `Y`, `Enter`

### 8.2 Verify Cron Jobs

```bash
crontab -l
# Should show your three jobs

# Monitor cron output
tail -f /home/cpl/cron.log
```

## Step 9: Setup Monitoring & Backups

### 9.1 Monitor Docker Containers

```bash
# Check container stats
docker stats

# Check disk usage
df -h

# Check memory
free -h
```

### 9.2 Setup Automatic Backups

Create backup script (`~/backup.sh`):

```bash
#!/bin/bash
BACKUP_DIR="/home/cpl/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup .env file
cp /home/cpl/cpl-app/.env $BACKUP_DIR/.env_$DATE

# Backup database via Supabase CLI (if using)
# supabase db dump > $BACKUP_DIR/db_dump_$DATE.sql

# Keep only last 7 days
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed at $DATE" >> /home/cpl/backups/backup.log
```

Make executable:
```bash
chmod +x ~/backup.sh
```

Add to crontab (daily at 2 AM):
```bash
0 2 * * * /home/cpl/backup.sh
```

### 9.3 Monitor Application Logs

```bash
# View recent logs
docker-compose logs --tail 100 cpl-app

# Follow logs in real-time
docker-compose logs -f cpl-app

# Filter by keyword
docker-compose logs | grep -i error
```

## Step 10: Post-Deployment Checklist

- [ ] DNS resolves to server IP
- [ ] HTTPS works (green padlock in browser)
- [ ] Landing page loads at https://chiniotpadelleague.com
- [ ] Registration page works (/register)
- [ ] Login page works (/login)
- [ ] Can create account
- [ ] Can reset password (check email)
- [ ] Admin dashboard accessible (after account creation)
- [ ] Email notifications being sent
- [ ] Cron jobs running (check logs)
- [ ] Database backups working
- [ ] SSL certificate auto-renewal scheduled
- [ ] Monitoring alerts configured

## Step 11: Production Setup Tasks

### 11.1 Create Admin Account

1. Visit https://chiniotpadelleague.com/register
2. Create account with your email
3. In Supabase dashboard:
   - Go to Authentication → Users
   - Find your user
   - Edit user metadata, set: `"role": "admin"`
   - Save

### 11.2 Initialize Season

1. Go to admin dashboard
2. Create Season 3 with:
   - Start date: Season start
   - End date: Season end
   - Prize pools: Diamond (PKR 60K/30K), Platinum (50K/25K), etc.
   - Tier rules: Max 4 teams in Diamond, 15 in Platinum, etc.

### 11.3 Add Teams

1. Teams register via platform
2. Admin dashboard → Teams
3. Approve pending teams
4. Assign captains

### 11.4 Configure Email

Test email sending:
```bash
docker-compose exec cpl-app node -e "
require('dotenv').config();
console.log('SMTP_HOST:', process.env.SMTP_HOST);
console.log('SMTP_USER:', process.env.SMTP_USER);
"
```

## Scaling Guide

### When Server Gets Slow

1. **Monitor resources**: `docker stats`
2. **Upgrade server**: Hetzner Console → Server → Resize
   - CX21 → CX41 (4 vCPU, 8 GB RAM)
   - ~5-minute downtime, automatic
3. **Scale database**: Supabase auto-scales; monitor via dashboard

### Database Optimization

```bash
# In Supabase SQL editor, run:
-- Create index on frequently queried columns
CREATE INDEX idx_ladder_team ON ladder(team_id);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_challenges_status ON challenges(status);
```

## Troubleshooting

### App Container Won't Start

```bash
# Check logs
docker-compose logs cpl-app

# Common issues:
# 1. Missing environment variables
# 2. Database connection error
# 3. Port already in use

# Solution:
docker-compose down
docker-compose up -d
```

### SSL Certificate Not Renewing

```bash
# Check Traefik logs
docker-compose logs traefik | grep -i certificate

# Force renewal (if needed)
docker-compose down
rm -rf ./letsencrypt/acme.json
docker-compose up -d
```

### Cron Jobs Not Running

```bash
# Check crontab
crontab -l

# Verify curl works
curl -I https://chiniotpadelleague.com/api/cron/challenge-forfeit

# Check cron logs
grep CRON /var/log/syslog

# Manually test job
curl -s https://chiniotpadelleague.com/api/cron/challenge-forfeit \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### Database Connection Error

```bash
# Check environment variables
cat .env | grep SUPABASE

# Test Supabase connection
curl https://your-project.supabase.co/rest/v1/ \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Should return valid response
```

### High Memory Usage

```bash
# Check memory
docker stats

# Clear Docker cache
docker system prune -a

# Restart containers
docker-compose restart
```

## Security Hardening

### 1. Change Default Settings

- Update Traefik admin email: `--certificatesresolvers.myresolver.acme.email=YOUR_EMAIL`
- Set strong CRON_SECRET: `openssl rand -base64 32`
- Use strong Supabase anon key restrictions

### 2. Firewall Rules

```bash
# Only allow SSH from your IP
ufw delete allow 22/tcp
ufw allow from YOUR_IP to any port 22/tcp
ufw reload
```

### 3. Regular Updates

```bash
# Monthly: Update base images
docker-compose pull
docker-compose up -d

# Check for security updates
apt update && apt upgrade -y
```

### 4. Database Backups

Configure automated Supabase backups:
1. Supabase Dashboard → Settings → Backups
2. Enable daily backups (minimum 7 days retention)

### 5. Monitoring

Consider adding:
- Uptime monitoring (UptimeRobot, Pingdom)
- Error tracking (Sentry, LogRocket)
- Performance monitoring (DataDog, New Relic)

## Rollback Procedure

If deployment has issues:

```bash
# Stop current deployment
docker-compose down

# Restore from backup
cp ~/backups/.env_YYYYMMDD_HHMMSS .env

# Restart with previous image
docker-compose up -d
```

## Support

For deployment issues:
- Check logs: `docker-compose logs`
- Verify environment: `cat .env`
- Test connectivity: `curl https://chiniotpadelleague.com`
- Contact: deployment@chiniotpadelleague.com
