#!/usr/bin/env bash
# ============================================================
# 首次申请 SSL 证书 (在 VPS 上手动执行一次)
# ============================================================
# 前置条件：
#   1. DNS A 记录 api.joyminis.com 和 codepush.joyminis.com 已指向本服务器 IP
#   2. 80 端口未被占用（或 nginx 容器已停止）
#
# 使用方法：
#   scp deploy/init-cert.sh root@<VPS_IP>:/opt/lucky/deploy/
#   ssh root@<VPS_IP> 'bash /opt/lucky/deploy/init-cert.sh'
# ============================================================
set -euo pipefail

# 主域名（用于 cert 目录路径）
FIRST_DOMAIN="${CERT_FIRST_DOMAIN:-api.joyminis.com}"
# 所有域名列表（用空格分隔，certbot 会将其加入 Subject Alternative Names）
DOMAINS="${CERT_DOMAINS:-api.joyminis.com codepush.joyminis.com}"
EMAIL="${CERT_EMAIL:-}"
PROJECT_DIR="/opt/lucky"
CERT_DIR="$PROJECT_DIR/certs"
COMPOSE_FILE="$PROJECT_DIR/compose.prod.yml"
ENV_FILE="$PROJECT_DIR/deploy/.env.prod"

# ── 检查邮箱 ──────────────────────────────────────────────
if [ -z "$EMAIL" ]; then
    read -rp "请输入 Let's Encrypt 注册邮箱: " EMAIL
fi
if [ -z "$EMAIL" ]; then
    echo "❌ 邮箱不能为空"; exit 1
fi

echo "============================================"
echo "  申请 SSL 证书"
echo "  域名: ${DOMAINS}"
echo "  邮箱: $EMAIL"
echo "============================================"

# ── 检查 DNS 是否已生效（遍历所有域名）───────────────────
echo "→ 检查 DNS 解析..."
SERVER_IP=$(curl -4 -fsSL https://api.ipify.org 2>/dev/null || echo "")

for DOMAIN in $DOMAINS; do
    # 优先用 dig（dnsutils），否则回退到 python3 内置解析
    if command -v dig &>/dev/null; then
        RESOLVED_IP=$(dig +short "$DOMAIN" @1.1.1.1 | tail -1)
    elif command -v nslookup &>/dev/null; then
        RESOLVED_IP=$(nslookup "$DOMAIN" 1.1.1.1 2>/dev/null | awk '/^Address:/{ip=$2} END{print ip}')
    else
        RESOLVED_IP=$(python3 -c "import socket; print(socket.gethostbyname('$DOMAIN'))" 2>/dev/null || echo "")
    fi

    if [ -z "$RESOLVED_IP" ]; then
        echo "❌ $DOMAIN 未解析，请先在 Cloudflare 把 $DOMAIN A 记录指向本服务器"
        exit 1
    fi

    echo "  DNS 解析: $DOMAIN → $RESOLVED_IP"

    if [ -n "$SERVER_IP" ] && [ "$RESOLVED_IP" != "$SERVER_IP" ]; then
        echo "❌ $DOMAIN 未指向本机！请先更新 Cloudflare DNS 再运行此脚本"
        echo "   当前解析: $RESOLVED_IP"
        echo "   本机 IP:  $SERVER_IP"
        exit 1
    fi
done

echo "  本机 IP:  $SERVER_IP"
echo "  ✅ 所有域名 DNS 验证通过"

# ── 停止 nginx 释放 80 端口 ───────────────────────────────
echo "→ 临时停止 nginx（释放 80 端口）..."
if docker ps --format '{{.Names}}' | grep -q "lucky-nginx-prod"; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop nginx
    NGINX_WAS_RUNNING=true
else
    NGINX_WAS_RUNNING=false
fi

# ── 构造 certbot -d 参数 ──────────────────────────────────
CERTBOT_DOMAINS=""
for DOMAIN in $DOMAINS; do
    CERTBOT_DOMAINS="$CERTBOT_DOMAINS -d $DOMAIN"
done

# ── 申请证书（包含所有域名，自动添加 Subject Alternative Names）─
echo "→ 申请证书 (standalone 模式) — 域名: $DOMAINS ..."
# shellcheck disable=SC2086
certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --expand \
    -m "$EMAIL" \
    $CERTBOT_DOMAINS

# ── 复制证书到项目目录（从主域名的 Let's Encrypt 目录复制）────
echo "→ 复制证书到 $CERT_DIR ..."
mkdir -p "$CERT_DIR"
cp /etc/letsencrypt/live/$FIRST_DOMAIN/fullchain.pem "$CERT_DIR/server.crt"
cp /etc/letsencrypt/live/$FIRST_DOMAIN/privkey.pem   "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt"
chmod 600 "$CERT_DIR/server.key"
echo "  ✅ 证书已复制（包含域名: $DOMAINS）"

# ── 重启 nginx ────────────────────────────────────────────
if [ "$NGINX_WAS_RUNNING" = "true" ]; then
    echo "→ 重启 nginx..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" start nginx
fi

echo ""
echo "============================================"
echo "  ✅ SSL 证书申请完成！"
echo "  域名: ${DOMAINS}"
echo "  到期日: $(openssl x509 -enddate -noout -in $CERT_DIR/server.crt | cut -d= -f2)"
echo "============================================"
echo ""
echo "证书自动续期 cron 已由 server-init.sh 安装（每周一 03:00）"
echo "手动续期: bash $PROJECT_DIR/deploy/renew-cert.sh"
echo ""

