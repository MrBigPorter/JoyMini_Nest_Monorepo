#!/usr/bin/env bash
# ============================================================
# 数据库基线脚本 (一次性操作)
# ============================================================
# 适用场景:
#   数据库已有表结构，但没有 _prisma_migrations 迁移记录
#   报错: P3005 "The database schema is not empty"
#
# 原因: 数据库通过 db push / 手动 SQL 创建，从未走过 migrate
# 解决: 把所有已存在的迁移文件全部标记为"已应用"(baseline)
#       之后 prisma migrate deploy 只会跑增量变更
#
# 用法 (在 VPS /opt/lucky 目录执行):
#   bash deploy/baseline-db.sh
# ============================================================
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/.env.prod"
BACKEND_IMAGE="${BACKEND_IMAGE:-lucky-backend-prod:latest}"

[ ! -f "$ENV_FILE" ] && { echo "❌ 未找到 $ENV_FILE"; exit 1; }

DB_URL=$(grep ^DATABASE_URL "$ENV_FILE" | cut -d= -f2-)

echo "=========================================="
echo "  📍 Lucky 数据库基线操作 (Baseline)"
echo "=========================================="
echo ""
echo "  将 prisma/migrations/ 下所有迁移文件标记为已应用"
echo "  不会修改任何表结构，仅写入 _prisma_migrations 记录"
echo ""
echo "⚠️  仅在 P3005 错误时使用，正常情况无需执行"
echo ""
read -p "  确认执行? [y/N]: " confirm
[ "${confirm:-N}" != "y" ] && { echo "  已取消"; exit 0; }

# 获取 db 容器所在网络
NETWORK=$(docker inspect lucky-db-prod \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null \
  | awk '{print $1}')

[ -z "$NETWORK" ] && { echo "❌ lucky-db-prod 容器未运行，请先: docker compose -f compose.prod.yml up -d db"; exit 1; }

echo ""
echo "→ 基线化所有迁移..."
echo ""

docker run --rm \
  --network "$NETWORK" \
  --env DATABASE_URL="$DB_URL" \
  --entrypoint "" \
  "$BACKEND_IMAGE" \
  sh -c '
    set -e
    PRISMA="./node_modules/.bin/prisma"
    SCHEMA="apps/api/prisma/schema.prisma"
    count=0
    failed=0

    for dir in apps/api/prisma/migrations/*/; do
      migration=$(basename "$dir")
      # 跳过非迁移目录 (如 migration_lock.toml)
      [ ! -f "${dir}migration.sql" ] && continue

      if "$PRISMA" migrate resolve \
          --applied "$migration" \
          --schema="$SCHEMA" 2>/dev/null; then
        echo "  ✅ $migration"
        count=$((count + 1))
      else
        echo "  ⚠️  跳过 (已存在): $migration"
        failed=$((failed + 1))
      fi
    done

    echo ""
    echo "  基线化完成: ${count} 条新增, ${failed} 条已存在"
  '

echo ""
echo "→ 验证迁移状态..."
docker run --rm \
  --network "$NETWORK" \
  --env DATABASE_URL="$DB_URL" \
  --entrypoint "" \
  "$BACKEND_IMAGE" \
  ./node_modules/.bin/prisma migrate status \
    --schema=apps/api/prisma/schema.prisma

echo ""
echo "=========================================="
echo "  ✅ 基线操作完成！"
echo ""
echo "  现在可以正常部署:"
echo "    bash deploy/init-db.sh --migrate-only"
echo "    或直接: ./deploy/deploy.sh"
echo "=========================================="

