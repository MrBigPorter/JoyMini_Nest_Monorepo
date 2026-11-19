#!/usr/bin/env bash
# =============================================================================
# RAG faithfulness —— LLM-as-Judge 评测
#
# 需要两个 token：
#   - client token：调 /ai/customer/test-chat 拿 answer + sources
#   - admin token ：调 /admin/rag/documents/judge 做判断
# 两个 token 都在容器内临时签，不落盘。
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

JUDGE_TOKEN=$(docker exec -e SUB="faithfulness-judge" "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "ADMIN", type: "admin", username: "faithfulness-judge" },
    process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30m" },
  ));
') || { echo "❌ 签发 admin token 失败" >&2; exit 1; }

[ -n "$EVAL_TOKEN" ] && [ -n "$JUDGE_TOKEN" ] || { echo "❌ token 为空" >&2; exit 1; }

export EVAL_TOKEN
export JUDGE_TOKEN
export EVAL_BASE_URL=${EVAL_BASE_URL:-http://localhost/api/v1}
exec python3 "$SCRIPT_DIR/faithfulness-llm.py" "$@"
