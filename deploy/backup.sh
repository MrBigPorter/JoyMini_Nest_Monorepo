#!/usr/bin/env bash
# ============================================================
# 数据库备份脚本 (在 VPS 上通过 cron 运行)
# ============================================================
# 安装 cron (每天凌晨 3 点):
#   echo "0 3 * * * /opt/lucky/deploy/backup.sh >> /var/log/lucky-backup.log 2>&1" | crontab -
# ============================================================
set -euo pipefail

BACKUP_DIR="/opt/lucky/backups"
COMPOSE_FILE="/opt/lucky/compose.prod.yml"
ENV_FILE="/opt/lucky/deploy/.env.prod"
KEEP_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "[$(date)] 开始数据库备份..."

# 从 .env.prod 读取数据库信息
POSTGRES_USER=$(grep POSTGRES_USER "$ENV_FILE" | cut -d'=' -f2)
POSTGRES_DB=$(grep POSTGRES_DB "$ENV_FILE" | cut -d'=' -f2)

# pg_dump 通过 docker exec
docker exec lucky-db-prod pg_dump \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    --no-owner \
    --no-privileges \
    --format=custom \
    > "$BACKUP_DIR/backup_${DATE}.dump"

# 压缩
gzip "$BACKUP_DIR/backup_${DATE}.dump"
BACKUP_FILE="$BACKUP_DIR/backup_${DATE}.dump.gz"
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

echo "[$(date)]  备份完成: $BACKUP_FILE ($BACKUP_SIZE)"

# 清理旧备份
find "$BACKUP_DIR" -name "backup_*.dump.gz" -mtime +${KEEP_DAYS} -delete
echo "[$(date)] 清理 ${KEEP_DAYS} 天前的备份"

# 列出现有备份
echo "[$(date)] 当前备份:"
ls -lh "$BACKUP_DIR"/backup_*.dump.gz 2>/dev/null || echo "  (无)"

echo "[$(date)] 完成"

