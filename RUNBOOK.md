# Lucky Nest Server Operations Runbook

> **💡 Tip:** You can also use `make <target>` shortcuts for deploy, rollback, and logs.
> The terminal will prompt you for the VPS IP interactively — no need to remember the full command.
> See [`Makefile`](Makefile) for all available targets.

> Can't remember the commands? They're all here. Find your scenario, copy, and paste.
> Last updated: 2026-04-27

---

## Table of Contents

- [🔑 Key Info](#-key-info)
- [🚀 Deployment](#-deployment)
- [🔄 Rollback](#-rollback)
- [🐳 Docker Container Management](#-docker-container-management)
- [🗄️ Database](#-database)
- [📋 Logs](#-logs)
- [🌐 Admin DNS Switch (Cloudflare)](#-admin-dns-switch-cloudflare)
- [☁️ Blog Cloudflare Deployment](#-blog-cloudflare-deployment)
- [💾 Backup](#-backup)
- [📊 Monitoring](#-monitoring)
- [🔒 SSL Certificates](#-ssl-certificates)
- [🖥️ VPS Initialization](#️-vps-initialization)
- [📞 TURN Server](#-turn-server)
- [🩺 Health Checks & Verification](#-health-checks--verification)
- [🛟 Troubleshooting](#-troubleshooting)
- [🏠 Local Dev Docker](#-local-dev-docker)
- [🚇 Cloudflare Tunnel (Local Dev)](#-cloudflare-tunnel-local-dev)

---

## 🔑 Key Info

| Item | Value |
|------|-------|
| VPS User | `root` |
| VPS Project Dir | `/opt/lucky` |
| Compose File | `/opt/lucky/compose.prod.yml` |
| Env File | `/opt/lucky/deploy/.env.prod` |
| Backup Dir | `/opt/lucky/backups` |
| Cert Dir | `/opt/lucky/certs` |

**Container Names:**

| Service | Container Name |
|---------|----------------|
| Backend API | `lucky-backend-prod` |
| Admin Next | `lucky-admin-next-prod` |
| Nginx | `lucky-nginx-prod` |
| Redis | `lucky-redis-prod` |
| PostgreSQL | `lucky-db-prod` |

---

## 🚀 Deployment

### Local Mac Deploy (Recommended)

**Run from the project root directory. The script handles build + transfer + deploy automatically.**

```bash
# Full deployment (backend + frontend)
VPS_IP=your.vps.ip ./deploy/deploy.sh

# Backend only
VPS_IP=your.vps.ip ./deploy/deploy.sh --backend

# Frontend only (admin-next)
VPS_IP=your.vps.ip ./deploy/deploy.sh --admin

# Skip build, just restart services (images already exist)
VPS_IP=your.vps.ip ./deploy/deploy.sh --quick

# Sync config files only (no images)
VPS_IP=your.vps.ip ./deploy/deploy.sh --sync
```

### Via yarn Commands

```bash
# Full deployment
VPS_IP=your.vps.ip yarn deploy

# Backend only
VPS_IP=your.vps.ip yarn deploy:backend

# Frontend only
VPS_IP=your.vps.ip yarn deploy:admin

# Quick restart
VPS_IP=your.vps.ip yarn deploy:quick

# Config sync only
VPS_IP=your.vps.ip yarn deploy:sync
```

### Deploy Flow (automatic, for reference)

1. Check SSH connectivity → `ssh root@<VPS_IP>`
2. Sync config files → `scp compose.prod.yml`, `scp nginx/nginx.prod.conf` etc.
3. Build Docker images locally (`--platform linux/amd64`)
4. Transfer images → `docker save | gzip | ssh | gunzip | docker load`
5. SSH to VPS, run `docker compose up -d`
6. Run `prisma migrate deploy`
7. Health check (max 90s, auto-rollback on failure)
8. Cleanup old images `docker image prune -f`

### CI Auto Deploy

Push to `main`/`test` branch triggers GitHub Actions automatically:

- Backend: `.github/workflows/deploy-backend.yml`
- Blog: `.github/workflows/deploy-blog-cloudflare.yml`
- Liveness: `.github/workflows/deploy-liveness-web-cloudflare.yml`

---

## 🔄 Rollback

### Container Rollback (run locally)

```bash
# Rollback backend + frontend
VPS_IP=your.vps.ip ./deploy/rollback.sh

# Backend only
VPS_IP=your.vps.ip ./deploy/rollback.sh --backend

# Via yarn
VPS_IP=your.vps.ip yarn rollback
VPS_IP=your.vps.ip yarn rollback:backend
```

### Database Rollback ⚠️ High Risk

```bash
# Restore latest DB backup (overwrites current database!)
VPS_IP=your.vps.ip ./deploy/rollback.sh --db

# Via yarn
VPS_IP=your.vps.ip yarn rollback:db
```

### Admin DNS Rollback (Cloudflare Workers → VPS)

```bash
# Dry-run first
CLOUDFLARE_API_TOKEN=xxx \
CLOUDFLARE_ZONE_ID=xxx \
CLOUDFLARE_DNS_RECORD_ID=xxx \
CF_ROLLBACK_TARGET=your.vps.ip \
  bash deploy/cloudflare-rollback.sh

# Execute after confirming
CLOUDFLARE_API_TOKEN=xxx \
CLOUDFLARE_ZONE_ID=xxx \
CLOUDFLARE_DNS_RECORD_ID=xxx \
CF_ROLLBACK_TARGET=your.vps.ip \
  bash deploy/cloudflare-rollback.sh --execute

# Via yarn
CLOUDFLARE_API_TOKEN=xxx yarn rollback:admin:dns
CLOUDFLARE_API_TOKEN=xxx yarn rollback:admin:dns:execute
```

---

## 🐳 Docker Container Management

**Run these on the VPS (SSH in first):**

```bash
# SSH into VPS
ssh root@<VPS_IP>
```

### Check Status

```bash
# All containers
docker compose -f /opt/lucky/compose.prod.yml ps

# List images
docker images | grep lucky

# Resource usage
docker stats
```

### Restart Services

```bash
cd /opt/lucky

# Restart everything
docker compose -f compose.prod.yml --env-file deploy/.env.prod up -d --no-build --force-recreate

# Restart single service
docker compose -f compose.prod.yml restart backend
docker compose -f compose.prod.yml restart admin-next
docker compose -f compose.prod.yml restart nginx

# Stop everything
docker compose -f compose.prod.yml down

# Stop nginx only (free 80/443 for certbot)
docker compose -f compose.prod.yml stop nginx

# Start nginx
docker compose -f compose.prod.yml start nginx
```

### Enter a Container

```bash
docker exec -it lucky-backend-prod sh
docker exec -it lucky-db-prod psql -U <DB_USER> -d <DB_NAME>
```

### Docker Maintenance

```bash
# Cleanup old images
docker image prune -f

# System resources
free -h
df -h /
```

---

## 🗄️ Database

### First-time Init (fresh VPS)

```bash
# SSH into VPS, then run
cd /opt/lucky
bash deploy/init-db.sh

# Migrate only, skip seed data
bash deploy/init-db.sh --migrate-only
```

### Prisma Migrations

```bash
# Check migration status
docker run --rm \
  --network "$(docker inspect lucky-db-prod --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' | awk '{print $1}')" \
  --env DATABASE_URL="$(grep ^DATABASE_URL /opt/lucky/deploy/.env.prod | cut -d= -f2-)" \
  --entrypoint "" \
  lucky-backend-prod:latest \
  ./node_modules/.bin/prisma migrate status --schema=apps/api/prisma/schema.prisma

# Run migrations manually
docker run --rm \
  --network "$(docker inspect lucky-db-prod --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' | awk '{print $1}')" \
  --env DATABASE_URL="$(grep ^DATABASE_URL /opt/lucky/deploy/.env.prod | cut -d= -f2-)" \
  --entrypoint "" \
  lucky-backend-prod:latest \
  ./node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

### Baseline (P3005 Error Fix)

```bash
# Use when DB has tables but no _prisma_migrations history
cd /opt/lucky
bash deploy/baseline-db.sh
```

### Create/Reset Admin Password

```bash
docker exec -it lucky-backend-prod \
  node apps/api/dist/scripts/cli/create-admin.js
```

### Enter Database (read-only)

```bash
docker exec -it lucky-db-prod psql -U <POSTGRES_USER> -d <POSTGRES_DB>
```

### Local Dev Database Commands

```bash
# Create new migration
MIGRATION_NAME=add_user_table yarn pr:m:new

# Run migrations (local dev)
yarn pr:m:deploy

# Check migration status (local dev)
yarn pr:m:status

# Reset database (local dev)
yarn pr:m:reset

# Prisma Studio (local dev)
yarn pr:studio
```

---

## 📋 Logs

```bash
# All services
ssh root@<VPS_IP> 'docker compose -f /opt/lucky/compose.prod.yml logs -f'

# Backend only
ssh root@<VPS_IP> 'docker logs -f lucky-backend-prod'

# Last N lines
ssh root@<VPS_IP> 'docker logs --tail=100 lucky-backend-prod'

# Nginx logs
ssh root@<VPS_IP> 'docker logs --tail=50 lucky-nginx-prod'

# DB logs
ssh root@<VPS_IP> 'docker logs --tail=50 lucky-db-prod'

# TURN server logs
ssh root@<VPS_IP> 'tail -n 100 /var/log/turnserver.log'
```

---

## 🌐 Admin DNS Switch (Cloudflare)

**Switch `admin.joyminis.com` between VPS and Cloudflare Workers:**

### Forward Switch (VPS → Cloudflare Workers)

```bash
# Dry-run first
CLOUDFLARE_API_TOKEN=xxx \
CLOUDFLARE_ZONE_ID=xxx \
CLOUDFLARE_DNS_RECORD_ID=xxx \
CF_SWITCH_TARGET=<cloudflare-worker-domain>.workers.dev \
  bash deploy/switch-admin-cloudflare.sh

# Execute after confirming
CLOUDFLARE_API_TOKEN=xxx \
CLOUDFLARE_ZONE_ID=xxx \
CLOUDFLARE_DNS_RECORD_ID=xxx \
CF_SWITCH_TARGET=<cloudflare-worker-domain>.workers.dev \
  bash deploy/switch-admin-cloudflare.sh --execute

# Via yarn
CLOUDFLARE_API_TOKEN=xxx yarn switch:admin:dns
CLOUDFLARE_API_TOKEN=xxx yarn switch:admin:dns:execute
```

### Rollback Switch (Cloudflare Workers → VPS)

```bash
# Dry-run first
CLOUDFLARE_API_TOKEN=xxx \
CLOUDFLARE_ZONE_ID=xxx \
CLOUDFLARE_DNS_RECORD_ID=xxx \
CF_ROLLBACK_TARGET=your.vps.ip \
  bash deploy/cloudflare-rollback.sh

# Execute after confirming
CLOUDFLARE_API_TOKEN=xxx \
CLOUDFLARE_ZONE_ID=xxx \
CLOUDFLARE_DNS_RECORD_ID=xxx \
CF_ROLLBACK_TARGET=your.vps.ip \
  bash deploy/cloudflare-rollback.sh --execute
```

**Required Env Vars:**

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `CLOUDFLARE_ZONE_ID` | Cloudflare Zone ID |
| `CLOUDFLARE_DNS_RECORD_ID` | DNS Record ID |
| `CF_SWITCH_TARGET` / `CF_ROLLBACK_TARGET` | Target address |

---

## ☁️ Blog Cloudflare Deployment

### Auto Deploy (CI)

Pushing to `main` or `test` with blog-related changes triggers auto-deploy:
- `apps/frontend-blog/**`
- `packages/shared/**`
- `packages/ui/**`

### Manual Deploy Script

```bash
# Manual blog deploy to Cloudflare Pages
CLOUDFLARE_ACCOUNT_ID=xxx \
CLOUDFLARE_API_TOKEN=xxx \
  bash deploy/blog-cloudflare.sh

# Specify environment
CLOUDFLARE_ACCOUNT_ID=xxx \
CLOUDFLARE_API_TOKEN=xxx \
  bash deploy/blog-cloudflare.sh --env staging
```

### Direct Wrangler CLI

```bash
cd apps/frontend-blog

# Build
yarn exec opennextjs-cloudflare build

# Deploy
CLOUDFLARE_API_TOKEN=xxx \
CLOUDFLARE_ACCOUNT_ID=xxx \
  yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc
```

---

## 💾 Backup

### Auto Backup (cron)

Configured on VPS — runs daily at 3 AM, keeps 7 days.

```bash
# Trigger backup manually
ssh root@<VPS_IP> 'bash /opt/lucky/deploy/backup.sh'

# List available backups
ssh root@<VPS_IP> 'ls -lh /opt/lucky/backups/'
```

### Install Backup Cron

```bash
ssh root@<VPS_IP> "echo '0 3 * * * /opt/lucky/deploy/backup.sh >> /var/log/lucky-backup.log 2>&1' | crontab -"
```

---

## 📊 Monitoring

### Manual Check

```bash
# Run monitor script
ssh root@<VPS_IP> 'bash /opt/lucky/deploy/monitor.sh'

# Container status
ssh root@<VPS_IP> 'docker ps -a'

# Memory
ssh root@<VPS_IP> 'free -h'

# Disk
ssh root@<VPS_IP> 'df -h /'
```

### Install Monitor Cron (every 5 min)

```bash
ssh root@<VPS_IP> "echo '*/5 * * * * /opt/lucky/deploy/monitor.sh >> /var/log/lucky-monitor.log 2>&1' | crontab -"
```

### View Alert Log

```bash
ssh root@<VPS_IP> 'tail -f /var/log/lucky-alerts.log'
```

---

## 🔒 SSL Certificates

### First-time Request

```bash
# SSH into VPS
certbot certonly --standalone \
  -d admin.joyminis.com \
  -d dev-api.joyminis.com \
  -d dev.joyminis.com \
  --agree-tos -m your@email.com

# Copy certs to project dir
cp /etc/letsencrypt/live/admin.joyminis.com/fullchain.pem /opt/lucky/certs/server.crt
cp /etc/letsencrypt/live/admin.joyminis.com/privkey.pem /opt/lucky/certs/server.key
chmod 644 /opt/lucky/certs/server.crt
chmod 600 /opt/lucky/certs/server.key
```

### Manual Renew

```bash
ssh root@<VPS_IP> 'bash /opt/lucky/deploy/renew-cert.sh'
```

### Install Auto-renew Cron (weekly, Monday 3 AM)

```bash
scp deploy/renew-cert.sh root@<VPS_IP>:/opt/lucky/deploy/
ssh root@<VPS_IP> 'chmod +x /opt/lucky/deploy/renew-cert.sh'
ssh root@<VPS_IP> '(crontab -l 2>/dev/null; echo "0 3 * * 1 /opt/lucky/deploy/renew-cert.sh >> /var/log/lucky-cert.log 2>&1") | crontab -'
```

---

## 🖥️ VPS Initialization

**For first-time deployment on a new VPS:**

```bash
# 1. Upload init script to VPS
scp deploy/server-init.sh root@<VPS_IP>:/root/

# 2. SSH in and run
ssh root@<VPS_IP>
chmod +x /root/server-init.sh
/root/server-init.sh
```

**Init script does automatically:**

| # | Step |
|---|------|
| 1 | System update + install tools (curl, git, htop, fail2ban) |
| 2 | Create 1GB Swap + kernel tuning |
| 3 | Install Docker Engine + Compose Plugin |
| 4 | Configure UFW firewall (open 22/80/443) |
| 5 | Configure Fail2Ban (SSH brute force protection) |
| 6 | Create project dirs at `/opt/lucky` |
| 7 | Install Certbot |

**Manual steps after init:**

```bash
# 1. Confirm DNS points to VPS
#    admin.joyminis.com  → <VPS_IP>
#    dev-api.joyminis.com → <VPS_IP>
#    dev.joyminis.com    → <VPS_IP>

# 2. Request SSL certs (see SSL section above)

# 3. Run deploy from local machine
VPS_IP=your.vps.ip ./deploy/deploy.sh

# 4. Install auto-renew cron (see SSL section above)
```

---

## 📞 TURN Server

### Install/Recover TURN (coturn)

```bash
# Run on VPS
export TURN_SECRET='replace-with-a-long-random-secret'
export TURN_PUBLIC_IP='YOUR_VPS_PUBLIC_IP'
export TURN_DOMAIN='turn.joyminis.com'
bash /opt/lucky/deploy/install-turn.sh
```

### Post-install Config

Edit `/opt/lucky/deploy/.env.prod`, add:

```
TURN_SECRET=<same secret>
TURN_URL=turn:<TURN_DOMAIN>:3478?transport=udp
```

### Verify TURN Server

```bash
ssh root@<VPS_IP>
ss -lntup | grep 3478
tail -n 100 /var/log/turnserver.log
```

---

## 🩺 Health Checks & Verification

```bash
# API health check
curl -k https://<VPS_IP>/api/v1/health
curl -k https://api.joyminis.com/api/v1/health

# Service status
ssh root@<VPS_IP> 'docker compose -f /opt/lucky/compose.prod.yml ps'

# List current images
ssh root@<VPS_IP> 'docker images | grep lucky'

# Verify deployment
echo "  curl -k https://$VPS_IP/api/v1/health"
```

---

## 🛟 Troubleshooting

### Container Crash on Startup

```bash
# Check error logs
ssh root@<VPS_IP> 'docker logs --tail=50 lucky-backend-prod'

# Check exit reason
ssh root@<VPS_IP> 'docker inspect lucky-backend-prod --format "{{.State.ExitCode}} {{.State.Error}}"'

# Restart service
ssh root@<VPS_IP> 'cd /opt/lucky && docker compose -f compose.prod.yml restart backend'
```

### Nginx Config Not Synced

```bash
# Sync nginx config from local
./deploy/deploy.sh --sync

# Hot-reload nginx on VPS (zero downtime)
ssh root@<VPS_IP> 'docker exec lucky-nginx-prod nginx -s reload'
```

### Backend Image Not Updated (old code after deploy)

```bash
# 1. Check actual code in production container
ssh root@<VPS_IP> 'docker exec lucky-backend-prod cat apps/api/dist/app.controller.js | head -20'

# 2. Manually restart backend
ssh root@<VPS_IP> 'cd /opt/lucky && docker compose -f compose.prod.yml restart backend'

# 3. Check health check
ssh root@<VPS_IP> 'docker exec lucky-backend-prod wget -qO- http://localhost:3000/api/v1/health'
```

### Prisma Migration Error P3005

```bash
ssh root@<VPS_IP> 'cd /opt/lucky && bash deploy/baseline-db.sh'
```

### Admin Cloudflare Deploy Failed

```bash
# Rollback DNS to VPS
CLOUDFLARE_API_TOKEN=xxx yarn rollback:admin:dns:execute
```

### Out of Memory

```bash
# Check memory usage
ssh root@<VPS_IP> 'free -h && docker stats --no-stream'
```

---

## 🏠 Local Dev Docker

```bash
# Start local dev environment
yarn docker:up

# Stop local dev environment
yarn docker:down

# View local logs
yarn docker:logs
```

---

## 🚇 Cloudflare Tunnel (Local Dev)

```bash
# Login to Cloudflare Tunnel
yarn tunnel:login

# Create Tunnel
yarn tunnel:create

# Start temporary tunnel (expose localhost:3000 to public)
yarn tunnel

# Configure DNS routing
yarn tunnel:route
```

---

> **Tip:** For most operations, you only need to remember one command:
> ```
> VPS_IP=your.vps.ip ./deploy/deploy.sh
> ```
> Come back here to look up any other command when you need it.
