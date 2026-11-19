#!/usr/bin/env bash
# =============================================================================
# 任务成功率评测 —— 一条命令跑完（ai-quality-loop 3.x）
#
# 做三件事：
#   1. 在容器内用 fixture 用户签一个 client token
#   2. 在容器内签一个只读 admin token（judge 接口）
#   3. 调 run-task-eval.py：test-chat → 不同厂商 judge
#
# 前置：
#   - 后端在跑
#   - fixture 已 seed：yarn workspace @lucky/api seed:ai-eval-fixture
#   - judge key 已配置：GROQ_API_KEY（模型与 DeepSeek 不同厂商）
#
# 用法：
#   tools/eval/task/run-task-eval.sh
#   tools/eval/task/run-task-eval.sh --collect-only   # 只收集回答，供人工标注
#   tools/eval/task/run-task-eval.sh --transcripts tools/eval/task/reports/xxx-transcripts.json
#
# 可覆盖：BACKEND / EVAL_BASE_URL / EVAL_FIXTURE_USER_ID / PYTHON
# =============================================================================
set -uo pipefail

BACKEND=${BACKEND:-lucky-backend-dev}
PYTHON=${PYTHON:-python3}
FIXTURE_USER_ID=${EVAL_FIXTURE_USER_ID:-aiq_fixture_user_01}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if ! docker ps --format '{{.Names}}' | grep -qx "$BACKEND"; then
  echo "❌ 容器 $BACKEND 没在运行。先 make up-backend" >&2
  exit 1
fi

EVAL_CLIENT_TOKEN=$(docker exec -e SUB="$FIXTURE_USER_ID" "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "user", type: "client" },
    process.env.JWT_SECRET,
    { expiresIn: "30m" },
  ));
') || { echo "❌ 签发 client token 失败" >&2; exit 1; }

EVAL_TOKEN=$(docker exec -e SUB="eval-runner" "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "VIEWER", type: "admin", username: "eval-runner" },
    process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30m" },
  ));
') || { echo "❌ 签发 admin token 失败" >&2; exit 1; }

export EVAL_CLIENT_TOKEN EVAL_TOKEN

exec "$PYTHON" "$SCRIPT_DIR/run-task-eval.py" "$@"
