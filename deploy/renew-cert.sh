#!/usr/bin/env bash
# ============================================================
# SSL 证书自动续期脚本 (在 VPS 上通过 cron 运行)
# ============================================================
# 安装 cron (每周一凌晨 3 点检查续期):
#   echo "0 3 * * 1 /opt/lucky/deploy/renew-cert.sh >> /var/log/lucky-cert.log 2>&1" | crontab -
#
# 手动执行:
#   ssh root@<VPS_IP> '/opt/lucky/deploy/renew-cert.sh'
# ============================================================
set -euo pipefail

PROJECT_DIR="/opt/lucky"
COMPOSE_FILE="$PROJECT_DIR/compose.prod.yml"
ENV_FILE="$PROJECT_DIR/deploy/.env.prod"
CERT_DIR="$PROJECT_DIR/certs"

# Let's Encrypt 域名 (与 certbot 申请时一致)
DOMAIN="admin.joyminis.com"
LE_CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

echo "[$(date)] 开始 SSL 证书续期检查..."

# ------------------------------------------
# 1. 检查证书到期时间
# ------------------------------------------
if [ -f "$LE_CERT_DIR/fullchain.pem" ]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "$LE_CERT_DIR/fullchain.pem" | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s)
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
    echo "[$(date)] 证书到期日: $EXPIRY (剩余 ${DAYS_LEFT} 天)"

    if [ "$DAYS_LEFT" -gt 30 ]; then
        echo "[$(date)] ✅ 证书有效期充足, 无需续期"
        exit 0
    fi
    echo "[$(date)] ⚠️ 证书即将到期, 开始续期..."
else
    echo "[$(date)] ⚠️ 未找到 Let's Encrypt 证书, 尝试续期..."
fi

# ------------------------------------------
# 2. 暂停 Nginx (释放 80/443 端口给 certbot)
# ------------------------------------------
echo "[$(date)] 暂停 Nginx..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop nginx || true

# ------------------------------------------
# 3. 执行 certbot renew
# ------------------------------------------
echo "[$(date)] 执行 certbot renew..."
certbot renew --non-interactive

# ------------------------------------------
# 4. 复制新证书到项目目录
# ------------------------------------------
if [ -f "$LE_CERT_DIR/fullchain.pem" ] && [ -f "$LE_CERT_DIR/privkey.pem" ]; then
    cp "$LE_CERT_DIR/fullchain.pem" "$CERT_DIR/server.crt"
    cp "$LE_CERT_DIR/privkey.pem"   "$CERT_DIR/server.key"
    chmod 644 "$CERT_DIR/server.crt"
    chmod 600 "$CERT_DIR/server.key"
    echo "[$(date)] ✅ 证书已更新"
else
    echo "[$(date)] ❌ 证书文件不存在, 请检查 certbot 配置"
fi

# ------------------------------------------
# 5. 重启 Nginx
# ------------------------------------------
echo "[$(date)] 重启 Nginx..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" start nginx

echo "[$(date)] ✅ SSL 证书续期完成"

