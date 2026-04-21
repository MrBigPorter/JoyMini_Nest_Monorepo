#!/usr/bin/env bash
# ============================================================
# 轻量级监控脚本 (在 VPS 上通过 cron 运行)
# ============================================================
# 安装 cron (每 5 分钟):
#   echo "*/5 * * * * /opt/lucky/deploy/monitor.sh >> /var/log/lucky-monitor.log 2>&1" | crontab -
# ============================================================
set -uo pipefail

COMPOSE_FILE="/opt/lucky/compose.prod.yml"
HEALTH_URL="http://localhost:3000/api/v1/health"
ALERT_LOG="/var/log/lucky-alerts.log"

ALERT=false
MESSAGES=""

alert() {
    ALERT=true
    MESSAGES="${MESSAGES}\n⚠️  $1"
    echo "[$(date)] ALERT: $1" >> "$ALERT_LOG"
}

# ------------------------------------------
# 1. 检查容器状态
# ------------------------------------------
for container in lucky-backend-prod lucky-db-prod lucky-redis-prod lucky-nginx-prod; do
    STATUS=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "not_found")
    if [ "$STATUS" != "running" ]; then
        alert "$container 状态异常: $STATUS"
    fi
done

# ------------------------------------------
# 2. 检查 API 健康
# ------------------------------------------
HTTP_CODE=$(docker exec lucky-nginx-prod wget -qO- --timeout=5 http://lucky-backend-prod:3000/api/v1/health 2>/dev/null && echo "200" || echo "FAIL")
if [ "$HTTP_CODE" = "FAIL" ]; then
    alert "API 健康检查失败"
fi

# ------------------------------------------
# 3. 内存使用率
# ------------------------------------------
MEM_TOTAL=$(free | awk '/^Mem:/{print $2}')
MEM_USED=$(free | awk '/^Mem:/{print $3}')
MEM_PERCENT=$((MEM_USED * 100 / MEM_TOTAL))
if [ "$MEM_PERCENT" -gt 90 ]; then
    alert "内存使用率过高: ${MEM_PERCENT}%"
fi

# ------------------------------------------
# 4. 磁盘使用率
# ------------------------------------------
DISK_PERCENT=$(df / | awk 'NR==2{gsub(/%/,""); print $5}')
if [ "$DISK_PERCENT" -gt 85 ]; then
    alert "磁盘使用率过高: ${DISK_PERCENT}%"
fi

# ------------------------------------------
# 5. Swap 使用
# ------------------------------------------
SWAP_USED=$(free | awk '/^Swap:/{print $3}')
SWAP_TOTAL=$(free | awk '/^Swap:/{print $2}')
if [ "$SWAP_TOTAL" -gt 0 ]; then
    SWAP_PERCENT=$((SWAP_USED * 100 / SWAP_TOTAL))
    if [ "$SWAP_PERCENT" -gt 50 ]; then
        alert "Swap 使用率偏高: ${SWAP_PERCENT}% — 内存可能不足"
    fi
fi

# ------------------------------------------
# 输出
# ------------------------------------------
if [ "$ALERT" = true ]; then
    echo "========================================"
    echo "[$(date)] ❌ 发现问题:"
    echo -e "$MESSAGES"
    echo "========================================"
    # TODO: 可在此处添加 webhook 通知
    # curl -s -X POST "https://hooks.slack.com/..." -d "{\"text\": \"$MESSAGES\"}"
else
    echo "[$(date)]  所有服务正常 | MEM: ${MEM_PERCENT}% | DISK: ${DISK_PERCENT}%"
fi

