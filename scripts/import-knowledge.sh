#!/usr/bin/env bash
# =============================================================================
# 知识库一键导入（本地 / 生产）
#
# 复用 apps/api/scripts/cli/import-knowledge.ts，自动签 admin token，
# 不需要输入管理员密码，也不会把 token 打印到终端。
#
# 用法：
#   bash scripts/import-knowledge.sh --dry-run        # 只列文件
#   bash scripts/import-knowledge.sh                  # 导入本地环境
#   bash scripts/import-knowledge.sh --prod           # 导入生产
#   bash scripts/import-knowledge.sh --prod --dry-run
#
# 可覆盖：VPS_HOST（默认 129.121.97.120）、API_BASE、KNOWLEDGE_DIR
# =============================================================================
set -uo pipefail
export LC_ALL=C

VPS_HOST=${VPS_HOST:-129.121.97.120}
TARGET=local
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --prod) TARGET=prod ;;
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

if [ "$TARGET" = "prod" ]; then
  BACKEND=lucky-backend-prod
  API_BASE=${API_BASE:-https://api.joyminis.com/api}
  RUNNER="ssh -o BatchMode=yes -o ConnectTimeout=10 root@${VPS_HOST}"
  echo "▶ 目标：生产（${API_BASE}）"
else
  BACKEND=lucky-backend-dev
  API_BASE=${API_BASE:-http://localhost/api}
  RUNNER=""
  echo "▶ 目标：本地（${API_BASE}）"
fi

# 预检：后端容器存在
if [ "$TARGET" = "prod" ]; then
  $RUNNER "docker inspect $BACKEND" >/dev/null 2>&1 \
    || { echo "❌ 生产后端容器 $BACKEND 不可达" >&2; exit 1; }
else
  docker inspect "$BACKEND" >/dev/null 2>&1 \
    || { echo "❌ 本地后端容器 $BACKEND 不在运行" >&2; exit 1; }
fi

# 预检：生产 Meili（缺失时 BM25 会跳过，但向量仍可用）
if [ "$TARGET" = "prod" ]; then
  if ! $RUNNER "docker inspect joymini-meilisearch" >/dev/null 2>&1; then
    echo "⚠️  生产没有 joymini-meilisearch：BM25 层会跳过，向量检索仍可用"
  fi
fi

cd "$(dirname "$0")/.."

if [ "$DRY_RUN" = "1" ]; then
  API_BASE="$API_BASE" yarn workspace @lucky/api import-knowledge -- --dry-run
  exit $?
fi

# 在目标环境签一个 15 分钟的 admin token；只存 shell 变量，不打印
SIGN_JS='const jwt=require("jsonwebtoken");process.stdout.write(jwt.sign({sub:"kb-import",role:"ADMIN",type:"admin",username:"kb-import"},process.env.ADMIN_JWT_SECRET||process.env.JWT_SECRET,{expiresIn:"15m"}))'

if [ "$TARGET" = "prod" ]; then
  ADMIN_TOKEN=$($RUNNER "docker exec -e SUB=kb-import $BACKEND node -e '$SIGN_JS'") \
    || { echo "❌ 生产 admin token 签发失败" >&2; exit 1; }
else
  ADMIN_TOKEN=$(docker exec -e SUB=kb-import "$BACKEND" node -e "$SIGN_JS") \
    || { echo "❌ 本地 admin token 签发失败" >&2; exit 1; }
fi

[ -n "$ADMIN_TOKEN" ] || { echo "❌ token 为空" >&2; exit 1; }

ADMIN_TOKEN="$ADMIN_TOKEN" API_BASE="$API_BASE" \
  yarn workspace @lucky/api import-knowledge -- "$@"
STATUS=$?

unset ADMIN_TOKEN

if [ "$STATUS" -eq 0 ]; then
  echo ""
  echo "✅ 上传完成。注意：切分/向量化是异步的，稍后用下面命令看进度："
  if [ "$TARGET" = "prod" ]; then
    echo "  ssh root@${VPS_HOST} 'docker exec lucky-db-prod sh -lc \"psql -U \\\$POSTGRES_USER -d \\\$POSTGRES_DB -c \\\"select process_status, count(*) from knowledge_documents group by 1;\\\"\"'"
  else
    echo "  docker exec lucky-db sh -lc 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"select process_status, count(*) from knowledge_documents group by 1;\"'"
  fi
fi

exit "$STATUS"
