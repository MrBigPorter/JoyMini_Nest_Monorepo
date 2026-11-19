#!/usr/bin/env bash
# =============================================================================
# 一键同步 AI 数据：knowledge + ai-prompt + intent-examples
#
# 用法：
#   bash scripts/sync-ai-data.sh --dry-run          # 看会同步什么
#   bash scripts/sync-ai-data.sh                    # 本地 → 本地
#   bash scripts/sync-ai-data.sh --prod             # 本地 → 生产
#   bash scripts/sync-ai-data.sh --prod --dry-run
#
# 可用 SKIP_KNOWLEDGE=1 / SKIP_PROMPTS=1 / SKIP_INTENT=1 分项跳过。
# 可覆盖：VPS_HOST / LOCAL_API / TARGET_API / KNOWLEDGE_DIR
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
    --help|-h) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

if [ "$TARGET" = "prod" ]; then
  LOCAL_API=${LOCAL_API:-http://localhost/api}
  TARGET_API=${TARGET_API:-https://api.joyminis.com/api}
  TARGET_BACKEND=lucky-backend-prod
  echo "▶ 本地 → 生产（${TARGET_API}）"
else
  LOCAL_API=${LOCAL_API:-http://localhost/api}
  TARGET_API=${TARGET_API:-$LOCAL_API}
  TARGET_BACKEND=lucky-backend-dev
  echo "▶ 本地 → 本地（${TARGET_API}）"
fi

SIGN_JS='const jwt=require("jsonwebtoken");process.stdout.write(jwt.sign({sub:"data-sync",role:"ADMIN",type:"admin",username:"data-sync"},process.env.ADMIN_JWT_SECRET||process.env.JWT_SECRET,{expiresIn:"30m"}))'

LOCAL_TOKEN=$(docker exec -e SUB=data-sync lucky-backend-dev node -e "$SIGN_JS") \
  || { echo "❌ 本地 token 签发失败" >&2; exit 1; }

if [ "$DRY_RUN" = "0" ]; then
  if [ "$TARGET" = "prod" ]; then
    TARGET_TOKEN=$(ssh -o BatchMode=yes -o ConnectTimeout=10 root@${VPS_HOST} \
      "docker exec -e SUB=data-sync $TARGET_BACKEND node -e '$SIGN_JS'") \
      || { echo "❌ 生产 token 签发失败" >&2; exit 1; }
  else
    TARGET_TOKEN=$LOCAL_TOKEN
  fi
  [ -n "$LOCAL_TOKEN" ] && [ -n "$TARGET_TOKEN" ] || { echo "❌ token 为空" >&2; exit 1; }
fi

if [ "$TARGET" = "local" ] && [ -z "${TARGET_TOKEN:-}" ]; then TARGET_TOKEN=$LOCAL_TOKEN; fi

cd "$(dirname "$0")/.."

LOCAL_API="$LOCAL_API" TARGET_API="$TARGET_API" \
LOCAL_TOKEN="${LOCAL_TOKEN:-}" TARGET_TOKEN="${TARGET_TOKEN:-}" \
  yarn workspace @lucky/api sync-ai-data -- "$@"
STATUS=$?

unset LOCAL_TOKEN TARGET_TOKEN
exit "$STATUS"
