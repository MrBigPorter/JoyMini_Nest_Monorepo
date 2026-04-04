#!/usr/bin/env bash
# ============================================================
# VPS 一次性初始化脚本 (Ubuntu 22.04, 1GB RAM, 1 CPU)
# ============================================================
# 使用方法:
#   scp deploy/server-init.sh root@<VPS_IP>:/root/
#   ssh root@<VPS_IP> 'chmod +x /root/server-init.sh && /root/server-init.sh'
# ============================================================
set -euo pipefail

VPS_IP="${VPS_IP:-}"
if [ -z "$VPS_IP" ]; then
    read -rp "请输入 VPS IP 地址: " VPS_IP
fi
PROJECT_DIR="/opt/lucky"
SWAP_SIZE="1G"

echo "============================================"
echo "  Lucky Nest VPS 初始化"
echo "  IP: $VPS_IP | RAM: 1GB | CPU: 1 Core"
echo "============================================"

# ------------------------------------------
# 1. 系统更新
# ------------------------------------------
echo "→ [1/7] 系统更新..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl wget git htop nano unzip fail2ban

# ------------------------------------------
# 2. 创建 Swap (1GB — 运行时安全网)
# ------------------------------------------
echo "→ [2/7] 配置 Swap ($SWAP_SIZE)..."
if [ ! -f /swapfile ]; then
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "    Swap 创建完成"
else
    echo "    Swap 已存在, 跳过"
fi

# 内核参数优化 (低 RAM 服务器)
cat > /etc/sysctl.d/99-lucky.conf << 'EOF'
# Swap 使用倾向 (10 = 尽量少用, 保持内存优先)
vm.swappiness=10
# Redis AOF 需要
vm.overcommit_memory=1
# 网络优化
net.core.somaxconn=512
net.ipv4.tcp_max_syn_backlog=512
EOF
sysctl --system

# ------------------------------------------
# 3. 安装 Docker Engine + Compose Plugin
# ------------------------------------------
echo "→ [3/7] 安装 Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "    Docker 安装完成: $(docker --version)"
else
    echo "    Docker 已安装: $(docker --version)"
fi

# 验证 docker compose
docker compose version

# Docker daemon 优化 (日志限制 + 低内存)
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
EOF
systemctl restart docker

# ------------------------------------------
# 4. 防火墙 (UFW)
# ------------------------------------------
echo "→ [4/7] 配置防火墙..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable
ufw status verbose

# ------------------------------------------
# 5. Fail2Ban (SSH 防暴力)
# ------------------------------------------
echo "→ [5/7] 配置 Fail2Ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
findtime = 600
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# ------------------------------------------
# 6. 创建项目目录
# ------------------------------------------
echo "→ [6/7] 创建项目目录..."
mkdir -p "$PROJECT_DIR"/{certs,nginx/html,redis,deploy,data}

# ------------------------------------------
# 7. 安装 Certbot (Let's Encrypt)
# ------------------------------------------
echo "→ [7/7] 安装 Certbot..."
apt-get install -y certbot

echo ""
echo "============================================"
echo "  ✅ 初始化完成！"
echo "============================================"
echo ""
echo "后续步骤:"
echo ""
echo "  1. 确认 DNS A 记录指向 $VPS_IP:"
echo "     - admin.joyminis.com  → $VPS_IP"
echo "     - dev-api.joyminis.com → $VPS_IP"
echo "     - dev.joyminis.com    → $VPS_IP"
echo ""
echo "  2. 申请 SSL 证书:"
echo "     certbot certonly --standalone \\"
echo "       -d admin.joyminis.com \\"
echo "       -d dev-api.joyminis.com \\"
echo "       -d dev.joyminis.com \\"
echo "       --agree-tos -m your@email.com"
echo ""
echo "  3. 复制证书到项目目录:"
echo "     cp /etc/letsencrypt/live/admin.joyminis.com/fullchain.pem $PROJECT_DIR/certs/server.crt"
echo "     cp /etc/letsencrypt/live/admin.joyminis.com/privkey.pem   $PROJECT_DIR/certs/server.key"
echo ""
echo "  4. 在本地执行部署:"
echo "     ./deploy/deploy.sh"
echo ""
echo "  5. 安装证书自动续期 cron (每周一凌晨 3 点):"
echo "     scp deploy/renew-cert.sh root@$VPS_IP:$PROJECT_DIR/deploy/"
echo "     ssh root@$VPS_IP 'chmod +x $PROJECT_DIR/deploy/renew-cert.sh'"
echo "     ssh root@$VPS_IP '(crontab -l 2>/dev/null; echo \"0 3 * * 1 $PROJECT_DIR/deploy/renew-cert.sh >> /var/log/lucky-cert.log 2>&1\") | crontab -'"
echo ""

