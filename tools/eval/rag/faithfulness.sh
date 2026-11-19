#!/usr/bin/env bash
# =============================================================================
# RAG faithfulness proxy 评测
#
# 1. 从 DB 取一个测试用户
# 2. 在容器内签 client JWT（不落盘）
# 3. 调真实 test-chat 图路径，拿 answer + sources
# =============================================================================
set -uo pipefail

BACKEND=${BACKEND:-lucky-backend-dev}
DB=${DB:-lucky-db}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if ! docker ps --format '{{.Names}}' | grep -qx "$BACKEND"; then
  echo "❌ 容器 $BACKEND 没在运行。先 make up-backend" >&2
  exit 1
fi

EVAL_USER_ID=$(docker exec "$DB" psql -U postgres -d joy_mini -At -c 'SELECT id FROM users LIMIT 1;' 2>/dev/null | tr -d '[:space:]')
[ -n "$EVAL_USER_ID" ] || { echo "❌ 找不到测试用户" >&2; exit 1; }

EVAL_TOKEN=$(docker exec -e SUB="$EVAL_USER_ID" "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "user", type: "client" },
    process.env.JWT_SECRET,
    { expiresIn: "30m" },
  ));
') || { echo "❌ 签发 client token 失败" >&2; exit 1; }
[ -n "$EVAL_TOKEN" ] || { echo "❌ 签发 client token 失败" >&2; exit 1; }

export EVAL_TOKEN
export EVAL_BASE_URL=${EVAL_BASE_URL:-http://localhost/api/v1}
exec python3 "$SCRIPT_DIR/faithfulness.py" "$@"
