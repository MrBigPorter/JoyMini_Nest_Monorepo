#!/usr/bin/env bash
# =============================================================================
# RAG 检索评测 —— 一条命令跑完
#
# 做两件事：
#   1. 在 lucky-backend-dev 容器里签一个 ADMIN token（不落盘）
#   2. 把 token 通过环境变量传给 run.py，跑完即丢弃
#
# 用法：
#   tools/eval/rag/run-replay.sh
#   tools/eval/rag/run-replay.sh --topk 3 --limit 10
# =============================================================================
set -uo pipefail

BACKEND=${BACKEND:-lucky-backend-dev}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if ! docker ps --format '{{.Names}}' | grep -qx "$BACKEND"; then
  echo "❌ 容器 $BACKEND 没在运行。先 make up-backend" >&2
  exit 1
fi

EVAL_TOKEN=$(docker exec -e SUB=rag-eval-runner "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "ADMIN", type: "admin", username: "rag-eval-runner" },
    process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30m" },
  ));
') || { echo "❌ 签发 admin token 失败" >&2; exit 1; }

[ -n "$EVAL_TOKEN" ] || { echo "❌ 签发 admin token 失败（密钥为空？）" >&2; exit 1; }

export EVAL_TOKEN
export EVAL_BASE_URL=${EVAL_BASE_URL:-http://localhost/api/v1}
exec python3 "$SCRIPT_DIR/run.py" "$@"
