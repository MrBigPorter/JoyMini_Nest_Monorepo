#!/usr/bin/env bash
# =============================================================================
# 意图准确率回放 —— 一条命令跑完（T0-3 / #94）
#
# 做两件事：
#   1. 在 `lucky-backend-dev` 容器里用 JWT_SECRET 临时签一个 admin token
#      （密钥只存在于容器进程里，不打印、不落盘、不写进脚本）
#   2. 把 token 通过环境变量传给 replay.py，跑完即丢弃
#
# 用法：
#   tools/eval/run-replay.sh                 # 全量
#   tools/eval/run-replay.sh --tag trap      # 只跑陷阱题
#   tools/eval/run-replay.sh --limit 10 -v   # 调试
#
# 可覆盖的环境变量：
#   BACKEND     默认 lucky-backend-dev
#   EVAL_BASE_URL 默认 http://localhost/api/v1
#   PYTHON      默认 python3
# =============================================================================
set -uo pipefail

BACKEND=${BACKEND:-lucky-backend-dev}
PYTHON=${PYTHON:-python3}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if ! docker ps --format '{{.Names}}' | grep -qx "$BACKEND"; then
  echo "❌ 容器 $BACKEND 没在运行。先 make up-backend（或 docker compose up -d db redis backend nginx）" >&2
  exit 1
fi

# 临时 admin token：role 用 VIEWER —— 该接口只读，最小权限
EVAL_TOKEN=$(docker exec -e SUB="eval-runner" "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "VIEWER", type: "admin", username: "eval-runner" },
    process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: "15m" },
  ));
') || { echo "❌ 签发 admin token 失败" >&2; exit 1; }

[ -n "$EVAL_TOKEN" ] || { echo "❌ 签发 admin token 失败（密钥为空？）" >&2; exit 1; }

export EVAL_TOKEN
exec "$PYTHON" "$SCRIPT_DIR/replay.py" "$@"
