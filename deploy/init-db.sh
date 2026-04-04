#!/usr/bin/env bash
# ============================================================
# 数据库首次初始化脚本 (全新服务器只运行一次)
# ============================================================
# 用法 (在 VPS 的 /opt/lucky 目录执行):
#   bash deploy/init-db.sh                 # 迁移 + Seed
#   bash deploy/init-db.sh --migrate-only  # 仅迁移，不写 Seed
# ============================================================
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/.env.prod"
COMPOSE_FILE="$ROOT_DIR/compose.prod.yml"

MIGRATE_ONLY=false
[[ "${1:-}" == "--migrate-only" ]] && MIGRATE_ONLY=true

[ ! -f "$ENV_FILE" ] && { echo "❌ 未找到 $ENV_FILE"; exit 1; }

# 读取关键变量
DB_USER=$(grep ^POSTGRES_USER     "$ENV_FILE" | cut -d= -f2)
DB_NAME=$(grep ^POSTGRES_DB       "$ENV_FILE" | cut -d= -f2)
DB_URL=$(grep  ^DATABASE_URL      "$ENV_FILE" | cut -d= -f2-)
BACKEND_IMAGE="${BACKEND_IMAGE:-lucky-backend-prod:latest}"

echo "=========================================="
echo "  🗄️  Lucky 数据库初始化"
echo "=========================================="

# ------------------------------------------
# Step 1: 启动 db + redis
# ------------------------------------------
echo ""
echo "→ [1/3] 启动 PostgreSQL + Redis ..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d db redis

echo "→ 等待 PostgreSQL 就绪 (最多 60s)..."
for i in $(seq 1 30); do
  if docker exec lucky-db-prod pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "✅ PostgreSQL 已就绪 (${i}次)"; break
  fi
  [ "$i" -eq 30 ] && { echo "❌ 超时！"; docker logs --tail=20 lucky-db-prod; exit 1; }
  sleep 2
done

# ------------------------------------------
# Step 2: 运行 Prisma Migrate Deploy
# ------------------------------------------
echo ""
echo "→ [2/3] 运行数据库迁移 ..."

# 获取 db 容器所在的 Docker 网络
NETWORK=$(docker inspect lucky-db-prod \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null \
  | awk '{print $1}')

# 用生产镜像执行 migrate (镜像内含 prisma binary + schema + 迁移文件)
# --entrypoint "" 覆盖 entrypoint.sh，直接执行 prisma 命令，避免启动 NestJS
docker run --rm \
  --network "$NETWORK" \
  --env DATABASE_URL="$DB_URL" \
  --entrypoint "" \
  "$BACKEND_IMAGE" \
  ./node_modules/.bin/prisma migrate deploy \
    --schema=apps/api/prisma/schema.prisma

APPLIED=$(docker run --rm \
  --network "$NETWORK" \
  --env DATABASE_URL="$DB_URL" \
  --entrypoint "" \
  "$BACKEND_IMAGE" \
  ./node_modules/.bin/prisma migrate status \
    --schema=apps/api/prisma/schema.prisma 2>&1 | grep -c 'Applied' || echo '?')
echo "✅ 迁移完成 — ${APPLIED} 个迁移已应用"

if [ "$MIGRATE_ONLY" = true ]; then
  echo ""
  echo "→ 启动全部服务 ..."
  BACKEND_IMAGE="$BACKEND_IMAGE" \
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
  echo "✅ 完成 (已跳过 Seed)"
  exit 0
fi

# ------------------------------------------
# Step 3: 运行 Seed 数据
# ------------------------------------------
echo ""
echo "→ [3/3] 写入初始 Seed 数据 ..."
echo "   (首次运行需要下载 tsx + prisma, 约 1 分钟)"

docker run --rm \
  --network "$NETWORK" \
  --env DATABASE_URL="$DB_URL" \
  -v "$ROOT_DIR/apps/api:/workspace/api:ro" \
  -v "$ROOT_DIR/packages:/workspace/packages:ro" \
  -w /workspace/api \
  node:20-alpine \
  sh -c "
    set -e
    echo '--- 安装运行时工具 ---'
    apk add --no-cache openssl >/dev/null 2>&1
    npm install -g tsx prisma --silent
    echo '--- 安装项目依赖 ---'
    npm install --silent
    echo '--- 生成 Prisma Client ---'
    prisma generate --schema=prisma/schema.prisma
    echo '--- 执行 Seed ---'
    tsx scripts/seed/index.ts
  "

echo "✅ Seed 数据写入完成"

# ------------------------------------------
# 启动全部服务
# ------------------------------------------
echo ""
echo "→ 启动全部生产服务 ..."
BACKEND_IMAGE="$BACKEND_IMAGE" \
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

echo ""
echo "=========================================="
echo "  ✅ 数据库初始化完成！"
echo "=========================================="
echo ""
docker compose -f "$COMPOSE_FILE" ps
echo ""
echo "查看后端日志: docker logs -f lucky-backend-prod"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  💡 创建/重置超级管理员 (推荐方式):"
echo ""
echo "     docker exec -it lucky-backend-prod \\"
echo "       node apps/api/dist/scripts/cli/create-admin.js"
echo ""
echo "  📝 交互式输入用户名、显示名、密码 (密码不回显)"
echo "  🔁 可重复运行 — 已存在则提示是否重置密码"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
