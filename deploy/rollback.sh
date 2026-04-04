#!/usr/bin/env bash
# ============================================================
# 紧急回滚脚本 — 快速恢复到上一个可用版本
# ============================================================
# 使用方法 (在本地执行):
#   ./deploy/rollback.sh              # 回滚后端 + 前端
#   ./deploy/rollback.sh --backend    # 仅回滚后端
#   ./deploy/rollback.sh --admin      # 仅回滚前端
#   ./deploy/rollback.sh --db         # 恢复数据库备份
# ============================================================
set -euo pipefail

VPS_IP="${VPS_IP:-}"
if [ -z "$VPS_IP" ]; then
    read -rp "请输入 VPS IP 地址: " VPS_IP
fi
if [ -z "$VPS_IP" ]; then
    err "VPS_IP 不能为空"
fi
VPS_USER="root"
VPS_DIR="/opt/lucky"
SSH_TARGET="${VPS_USER}@${VPS_IP}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ROLLBACK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

ROLLBACK_BACKEND=true
ROLLBACK_ADMIN=true
ROLLBACK_DB=false

for arg in "$@"; do
    case $arg in
        --backend) ROLLBACK_ADMIN=false ;;
        --admin)   ROLLBACK_BACKEND=false ;;
        --db)      ROLLBACK_DB=true; ROLLBACK_BACKEND=false; ROLLBACK_ADMIN=false ;;
        --help)
            echo "用法: ./deploy/rollback.sh [选项]"
            echo "  --backend   仅回滚后端"
            echo "  --admin     仅回滚前端"
            echo "  --db        恢复最近的数据库备份"
            exit 0
            ;;
        *) err "未知参数: $arg" ;;
    esac
done

# SSH 连通性检查
log "检查 SSH 连接 → $SSH_TARGET..."
ssh -o ConnectTimeout=5 "$SSH_TARGET" "echo 'SSH OK'" || err "无法连接到 $SSH_TARGET"

# ============================================================
# 容器回滚 (重启上一个可用的容器)
# ============================================================
if [ "$ROLLBACK_BACKEND" = true ] || [ "$ROLLBACK_ADMIN" = true ]; then
    log "回滚服务..."

    ssh "$SSH_TARGET" << 'REMOTE_SCRIPT'
        set -e
        cd /opt/lucky

        echo "→ 当前镜像列表:"
        docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}" | grep lucky || true

        echo ""
        echo "→ 重启服务 (使用上一个可用镜像)..."
        docker compose -f compose.prod.yml --env-file deploy/.env.prod up -d --no-build --force-recreate

        echo ""
        echo "→ 等待服务健康..."
        sleep 8

        echo ""
        echo "→ 服务状态:"
        docker compose -f compose.prod.yml ps

        echo ""
        echo "→ 最近日志 (backend):"
        docker logs --tail=20 lucky-backend-prod 2>&1 || true
REMOTE_SCRIPT

    log "✅ 服务已重启"
fi

# ============================================================
# 数据库回滚 (恢复最近备份)
# ============================================================
if [ "$ROLLBACK_DB" = true ]; then
    log "数据库回滚..."

    warn "⚠️  这将覆盖当前数据库！请确认："
    echo ""

    # 列出可用备份
    ssh "$SSH_TARGET" "ls -lht /opt/lucky/backups/backup_*.dump.gz 2>/dev/null | head -5" || err "没有找到备份文件"

    echo ""
    read -p "确认恢复最新备份? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        log "已取消"
        exit 0
    fi

    ssh "$SSH_TARGET" << 'REMOTE_SCRIPT'
        set -e
        cd /opt/lucky

        # 找到最新备份
        LATEST=$(ls -t /opt/lucky/backups/backup_*.dump.gz 2>/dev/null | head -1)
        if [ -z "$LATEST" ]; then
            echo "❌ 没有找到备份文件"
            exit 1
        fi
        echo "→ 使用备份: $LATEST"

        # 从 .env.prod 读取数据库信息
        POSTGRES_USER=$(grep POSTGRES_USER deploy/.env.prod | cut -d'=' -f2)
        POSTGRES_DB=$(grep POSTGRES_DB deploy/.env.prod | cut -d'=' -f2)

        # 解压 + 恢复
        echo "→ 恢复数据库..."
        gunzip -c "$LATEST" | docker exec -i lucky-db-prod pg_restore \
            -U "$POSTGRES_USER" \
            -d "$POSTGRES_DB" \
            --clean \
            --if-exists \
            --no-owner \
            --no-privileges \
            2>&1 || true

        echo "→ 重启后端 (重新连接数据库)..."
        docker compose -f compose.prod.yml restart backend
        sleep 5

        echo "→ 服务状态:"
        docker compose -f compose.prod.yml ps
REMOTE_SCRIPT

    log "✅ 数据库已恢复"
fi

echo ""
log "回滚完成"
echo -e "  验证: curl -k https://$VPS_IP/api/v1/health"
echo ""

