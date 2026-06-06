#!/bin/sh
set -e

# ── Construct DATABASE_URL from individual env vars (AWS ECS Secrets Manager) ──
# RDS Secrets Manager stores username/password/host/port/dbname as separate fields.
# This block builds the full connection URL with URL-encoded password.
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  ENCODED_PASSWORD=$(node -p "encodeURIComponent(process.env.DB_PASSWORD || '')")
  export DATABASE_URL="postgresql://${DB_USER}:${ENCODED_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  echo "→ DATABASE_URL constructed from DB_* env vars (host=${DB_HOST})"
fi

# 如果传入了命令参数，直接执行 (供 init-db.sh / CI 调用 prisma)
# 例: docker run ... image ./node_modules/.bin/prisma migrate deploy ...
if [ $# -gt 0 ]; then
  exec "$@"
fi

# 默认总是执行迁移（prisma migrate deploy 幂等，只应用尚未执行的迁移）
# 若需跳过（极少情况），显式设置 SKIP_MIGRATIONS=true
if [ "$SKIP_MIGRATIONS" != "true" ]; then
  echo "→ Prisma migrate deploy"
  ./node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma
  echo "→ Migrations done"
fi

echo "→ Start Nest"
node apps/api/dist/main.js
