#!/usr/bin/env bash
# ============================================================
# 本地构建 + 远程部署脚本
# ============================================================
# 策略: 在本地 Mac 构建 Docker 镜像 (内存充足)
#        → 传输到 1GB VPS (避免服务器 OOM)
#
# 使用方法:
#   ./deploy/deploy.sh              # 全量部署
#   ./deploy/deploy.sh --backend    # 仅后端
#   ./deploy/deploy.sh --admin      # 仅前端
#   ./deploy/deploy.sh --quick      # 跳过构建, 仅重启服务
#   ./deploy/deploy.sh --sync       # 仅同步配置文件
# ============================================================
set -euo pipefail

# ---- 配置 ----
# 优先读环境变量 VPS_IP；若未设置则交互式询问
if [ -z "${VPS_IP:-}" ]; then
    read -rp "请输入 VPS IP 地址: " VPS_IP
fi
if [ -z "${VPS_IP:-}" ]; then
    err "VPS_IP 不能为空"
fi
VPS_USER="root"
VPS_DIR="/opt/lucky"
SSH_TARGET="${VPS_USER}@${VPS_IP}"

# 镜像名称
BACKEND_IMAGE="lucky-backend-prod:latest"
ADMIN_IMAGE="lucky-admin-next-prod:latest"
ADMIN_BUILD_DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ADMIN_BUILD_GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo local-dev)"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ---- 解析参数 ----
BUILD_BACKEND=true
BUILD_ADMIN=true
SKIP_BUILD=false
SYNC_ONLY=false

for arg in "$@"; do
    case $arg in
        --backend) BUILD_ADMIN=false ;;
        --admin)   BUILD_BACKEND=false ;;
        --quick)   SKIP_BUILD=true ;;
        --sync)    SYNC_ONLY=true ;;
        --help)
            echo "用法: ./deploy/deploy.sh [选项]"
            echo "  --backend   仅构建/部署后端"
            echo "  --admin     仅构建/部署前端"
            echo "  --quick     跳过构建, 仅重启服务"
            echo "  --sync      仅同步配置文件"
            exit 0
            ;;
        *) err "未知参数: $arg" ;;
    esac
done

# ---- 确认当前在项目根目录 ----
if [ ! -f "compose.prod.yml" ]; then
    err "请在项目根目录执行此脚本"
fi

# ---- SSH 连通性检查 ----
log "检查 SSH 连接 → $SSH_TARGET..."
ssh -o ConnectTimeout=5 "$SSH_TARGET" "echo 'SSH OK'" || err "无法连接到 $SSH_TARGET"

# ============================================================
# Step 1: 同步配置文件到 VPS
# ============================================================
sync_configs() {
    log "同步配置文件..."

    # 确保目录存在
    ssh "$SSH_TARGET" "mkdir -p $VPS_DIR/{certs,nginx/html,redis,deploy}"

    # 核心配置
    scp compose.prod.yml                    "$SSH_TARGET:$VPS_DIR/"
    scp deploy/.env.prod                    "$SSH_TARGET:$VPS_DIR/deploy/"
    scp deploy/init-db.sh                   "$SSH_TARGET:$VPS_DIR/deploy/"
    scp deploy/baseline-db.sh              "$SSH_TARGET:$VPS_DIR/deploy/"
    scp deploy/install-turn.sh              "$SSH_TARGET:$VPS_DIR/deploy/"
    scp nginx/nginx.prod.conf               "$SSH_TARGET:$VPS_DIR/nginx/"
    scp nginx/whitelist.conf                "$SSH_TARGET:$VPS_DIR/nginx/"
    scp redis/redis.conf                    "$SSH_TARGET:$VPS_DIR/redis/"

    # 静态文件目录 (如果存在)
    if [ -d "nginx/html" ] && [ "$(ls -A nginx/html 2>/dev/null)" ]; then
        scp -r nginx/html/ "$SSH_TARGET:$VPS_DIR/nginx/"
    fi

    log "✅ 配置文件同步完成"
}

sync_configs

if [ "$SYNC_ONLY" = true ]; then
    log "仅同步模式, 退出"
    exit 0
fi

# ============================================================
# Step 2: 构建 Docker 镜像 (本地, linux/amd64)
# ============================================================
if [ "$SKIP_BUILD" = false ]; then
    log "开始本地构建 (--platform linux/amd64)..."

    if [ "$BUILD_BACKEND" = true ]; then
        log "构建后端镜像: $BACKEND_IMAGE"
        docker build \
            --platform linux/amd64 \
            -f Dockerfile.prod \
            -t "$BACKEND_IMAGE" \
            .
        log "✅ 后端镜像构建完成"
    fi

    if [ "$BUILD_ADMIN" = true ]; then
        log "构建 admin-next 镜像: $ADMIN_IMAGE"
        docker build \
            --platform linux/amd64 \
            -f apps/admin-next/Dockerfile.prod \
            --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.joyminis.com/api \
            --build-arg NEXT_PUBLIC_APP_ENV=production \
            --build-arg NEXT_PUBLIC_DEPLOYED_AT="$ADMIN_BUILD_DEPLOYED_AT" \
            --build-arg NEXT_PUBLIC_GIT_SHA="$ADMIN_BUILD_GIT_SHA" \
            -t "$ADMIN_IMAGE" \
            .
        log "✅ admin-next 镜像构建完成"
    fi
fi

# ============================================================
# Step 3: 传输镜像到 VPS (docker save | ssh docker load)
# ============================================================
if [ "$SKIP_BUILD" = false ]; then
    log "传输镜像到 VPS (压缩传输)..."

    IMAGES_TO_SEND=""
    [ "$BUILD_BACKEND" = true ] && IMAGES_TO_SEND="$BACKEND_IMAGE"
    [ "$BUILD_ADMIN" = true ]   && IMAGES_TO_SEND="$IMAGES_TO_SEND $ADMIN_IMAGE"
    IMAGES_TO_SEND=$(echo "$IMAGES_TO_SEND" | xargs)  # trim

    if [ -n "$IMAGES_TO_SEND" ]; then
        log "传输: $IMAGES_TO_SEND"
        docker save $IMAGES_TO_SEND | gzip | \
            ssh "$SSH_TARGET" "gunzip | docker load"
        log "✅ 镜像传输完成"
    fi
fi

# ============================================================
# Step 4: 在 VPS 上启动/更新服务
# ============================================================
log "在 VPS 上启动服务..."

# 将本地标志传入 heredoc (本地展开)
_DEPLOY_BACKEND=$BUILD_BACKEND

ssh "$SSH_TARGET" << REMOTE_SCRIPT
    set -e
    cd $VPS_DIR

    echo "→ 当前镜像:"
    docker images | grep lucky || true

    echo "→ 拉取基础镜像 (nginx, redis, postgres)..."
    docker compose -f compose.prod.yml --env-file deploy/.env.prod pull nginx redis db 2>/dev/null || true

    # ── 数据库迁移 (仅部署后端时执行，与 CI 保持一致) ──────────────
    if [ "$_DEPLOY_BACKEND" = "true" ]; then
        echo "→ 运行数据库迁移..."
        NETWORK=\$(docker inspect lucky-db-prod \
            --format '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}}{{end}}' 2>/dev/null \
            | awk '{print \$1}')
        if [ -n "\$NETWORK" ]; then
            MIGRATE_OUT=\$(docker run --rm \
              --network "\$NETWORK" \
              --env-file deploy/.env.prod \
              --entrypoint "" \
              lucky-backend-prod:latest \
              ./node_modules/.bin/prisma migrate deploy \
                --schema=apps/api/prisma/schema.prisma 2>&1) && MIGRATE_OK=true || MIGRATE_OK=false

            echo "\$MIGRATE_OUT"

            if [ "\$MIGRATE_OK" = false ]; then
                if echo "\$MIGRATE_OUT" | grep -q "P3005"; then
                    echo ""
                    echo "❌ P3005: 数据库已有表但无迁移历史记录！"
                    echo "   请先执行基线操作:"
                    echo "   bash deploy/baseline-db.sh"
                    echo ""
                fi
                exit 1
            fi
            echo "✅ 迁移完成"
        else
            echo "⚠️  DB 容器未运行，跳过迁移 (首次部署请先运行 init-db.sh)"
        fi
    fi

    # ── 保存当前后端镜像 SHA (用于回滚) ──────────────────────────────
    PREV_IMAGE=\$(docker inspect lucky-backend-prod \
        --format '{{.Config.Image}}' 2>/dev/null || echo "")

    # ── 启动/更新服务 ─────────────────────────────────────────────
    BACKEND_IMAGE_VAL="lucky-backend-prod:latest"
    ADMIN_IMAGE_VAL="lucky-admin-next-prod:latest"

    echo "→ 启动/更新服务 (不在服务器上构建)..."
    BACKEND_IMAGE="\$BACKEND_IMAGE_VAL" ADMIN_IMAGE="\$ADMIN_IMAGE_VAL" \
        docker compose -f compose.prod.yml --env-file deploy/.env.prod \
        up -d --no-build --force-recreate

    # ── 健康检查 + 自动回滚 (仅后端, 与 CI 保持一致) ─────────────────
    if [ "$_DEPLOY_BACKEND" = "true" ]; then
        echo "→ 等待后端健康检查 (最多 90s)..."
        HEALTHY=false
        for i in \$(seq 1 30); do
            if docker exec lucky-backend-prod wget -qO- http://localhost:3000/api/v1/health >/dev/null 2>&1; then
                echo "✅ 健康检查通过 (第 \${i} 次, 约 \$((i*3))s)"
                HEALTHY=true
                break
            fi
            sleep 3
        done

        if [ "\$HEALTHY" = false ]; then
            echo "❌ 健康检查超时! 正在回滚..."
            docker logs --tail=50 lucky-backend-prod
            if [ -n "\$PREV_IMAGE" ]; then
                echo "→ 回滚到旧镜像: \$PREV_IMAGE"
                BACKEND_IMAGE="\$PREV_IMAGE" docker compose -f compose.prod.yml \
                    --env-file deploy/.env.prod \
                    up -d --no-build --force-recreate backend
                echo "⚠️  已回滚到旧版本！请检查新镜像日志排查原因。"
            fi
            exit 1
        fi
    else
        echo "→ 等待服务就绪..."
        sleep 5
    fi

    echo "→ 服务状态:"
    docker compose -f compose.prod.yml ps

    echo "→ 清理旧镜像..."
    docker image prune -f

    echo "→ 系统资源:"
    free -h
    df -h /
REMOTE_SCRIPT

log "✅ 部署完成！"
echo ""
echo -e "${CYAN}验证:${NC}"
echo "  curl -k https://$VPS_IP/api/v1/health"
echo "  ssh $SSH_TARGET 'docker compose -f $VPS_DIR/compose.prod.yml logs -f'"
echo ""

