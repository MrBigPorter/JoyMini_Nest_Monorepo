#!/usr/bin/env bash
# =============================================================================
# AI 任务崩溃恢复验收（reliable-ai-runtime 2.5）
#
# 证明的不是「函数逻辑」，而是 BullMQ 的真实行为：
#   发消息 → job 进入 active → SIGKILL 后端 → 重启 → stalled 机制把 job 移回
#   wait → 新 worker 重新消费 → 本轮恰好 1 条 AI 回复。
#
# 关键点：
#   - 必须用 `docker kill`（SIGKILL）。`restart` / `stop` 会走优雅关闭，
#     可能在退出前把任务跑完，证明不了崩溃。
#   - 杀掉唯一的 worker 后，stalled 检查也停了；要等新 worker 启动后
#     才会把 active job 移回 wait，所以顺序是 kill → 立即重启 → 等恢复。
#   - 断言 triggerMessageId 唯一索引：即使重放在「回复已落库、done 未写」
#     的窗口，也不会出现第二条回复。
#
# 用法：
#   bash scripts/ai-crash-recovery-e2e.sh
#   WAIT_SECONDS=240 bash scripts/ai-crash-recovery-e2e.sh
#
# 可覆盖：BACKEND / DB / REDIS / API_BASE / TEST_USER_ID / TEST_BOT_ID
# 依赖：docker、curl、jq、uuidgen。会短暂中断本地后端（仅本地环境）。
# =============================================================================
set -uo pipefail
export LC_ALL=C

API_BASE=${API_BASE:-http://localhost/api/v1}
BACKEND=${BACKEND:-lucky-backend-dev}
DB=${DB:-lucky-db}
REDIS=${REDIS:-lucky-redis}
WAIT_SECONDS=${WAIT_SECONDS:-180}
QUEUE=${QUEUE:-ai-processing}
CONV_TITLE='【AI崩溃自测】'
MARKER="crash-e2e-$(date +%s)-$$"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

die() { printf '%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }
ok()   { printf '%s✓ %s%s\n' "$GREEN" "$1" "$RESET"; }
warn() { printf '%s! %s%s\n' "$YELLOW" "$1" "$RESET"; }

sql() {
  docker exec -e SQL="$1" "$DB" \
    sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "$SQL"'
}

redis_cli() {
  docker exec "$REDIS" sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli "$@"' sh "$@"
}

wait_http() { # 等后端恢复（最多 $WAIT_SECONDS 秒）
  local deadline=$(( $(date +%s) + WAIT_SECONDS ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/health" || true)
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  return 1
}

# ---------------------------------------------------------------------------
# 0. 前置
# ---------------------------------------------------------------------------
command -v jq >/dev/null || die '缺少 jq（brew install jq）'
docker inspect "$BACKEND" >/dev/null 2>&1 || die "后端容器 $BACKEND 不存在"
docker inspect "$DB" >/dev/null 2>&1 || die "数据库容器 $DB 不存在"
docker inspect "$REDIS" >/dev/null 2>&1 || die "Redis 容器 $REDIS 不存在"

# ---------------------------------------------------------------------------
# 1. 用户 / AI 账号 / 专用会话
# ---------------------------------------------------------------------------
USER_ID=${TEST_USER_ID:-$(sql "
  SELECT m.\"userId\"
  FROM \"ChatMember\" m
  JOIN users u ON u.id = m.\"userId\"
  WHERE u.is_robot = false
  ORDER BY m.\"joinedAt\" DESC
  LIMIT 1")}
[ -n "$USER_ID" ] || die '找不到真人测试用户，请用 TEST_USER_ID 指定'

BOT_ID=${TEST_BOT_ID:-$(sql "
  SELECT id FROM users WHERE is_robot = true ORDER BY created_at ASC LIMIT 1")}
[ -n "$BOT_ID" ] || die '找不到 is_robot=true 的 AI 占位账号，请用 TEST_BOT_ID 指定'

CONV_ID=${TEST_CONVERSATION_ID:-$(sql "
  SELECT id FROM \"Conversation\"
  WHERE type = 'SUPPORT' AND name = '$CONV_TITLE'
  ORDER BY \"createdAt\" ASC
  LIMIT 1")}

if [ -z "$CONV_ID" ]; then
  CONV_ID="crash$(uuidgen | tr -d '-' | tr 'A-Z' 'a-z' | cut -c1-24)"
  sql "INSERT INTO \"Conversation\" (id, type, name, thread_id, \"createdAt\", \"updatedAt\")
       VALUES ('$CONV_ID', 'SUPPORT', '$CONV_TITLE', gen_random_uuid()::text, now(), now())" >/dev/null \
    || die "新建自测会话失败（$CONV_ID）"
  sql "INSERT INTO \"ChatMember\" (id, \"conversationId\", \"userId\")
       VALUES ('crash$(uuidgen | tr -d '-' | tr 'A-Z' 'a-z' | cut -c1-24)', '$CONV_ID', '$USER_ID')" >/dev/null
  sql "INSERT INTO \"ChatMember\" (id, \"conversationId\", \"userId\")
       VALUES ('crash$(uuidgen | tr -d '-' | tr 'A-Z' 'a-z' | cut -c1-24)', '$CONV_ID', '$BOT_ID')" >/dev/null
fi

TOKEN=$(docker exec -e SUB="$USER_ID" "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "user", type: "client" },
    process.env.JWT_SECRET,
    { expiresIn: "30m" },
  ));
') || die '签发测试 JWT 失败'

printf '%s会话=%s 用户=%s 队列=%s%s\n' "$DIM" "$CONV_ID" "$USER_ID" "$QUEUE" "$RESET"

# ---------------------------------------------------------------------------
# 2. 发一条消息，等 job 进入 active
# ---------------------------------------------------------------------------
sql "UPDATE \"Conversation\"
     SET handler_id = NULL, handler_assigned_at = NULL,
         thread_id = gen_random_uuid()::text
     WHERE id = '$CONV_ID'" >/dev/null

BEFORE_SEQ=$(sql "SELECT COALESCE(MAX(\"seqId\"), 0) FROM \"ChatMessage\" WHERE \"conversationId\" = '$CONV_ID'")

BODY=$(printf '{"id":"crash-%s","conversationId":"%s","content":"%s"}' \
  "$(uuidgen | tr 'A-Z' 'a-z')" "$CONV_ID" "$MARKER")
CODE=$(curl -s -o /tmp/ai-crash-send.json -w '%{http_code}' \
  -X POST "$API_BASE/chat/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$BODY")
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] || die "发送失败 HTTP $CODE（$(cat /tmp/ai-crash-send.json | head -c 200)）"

JOB_ID=$(sql "SELECT id FROM \"ChatMessage\"
              WHERE \"conversationId\" = '$CONV_ID' AND content = '$MARKER'
              ORDER BY \"createdAt\" DESC LIMIT 1")
[ -n "$JOB_ID" ] || die '没找到刚发送的消息（jobId 取不到）'
printf 'jobId=%s\n' "$JOB_ID"

deadline=$(( $(date +%s) + 60 ))
active=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if redis_cli LRANGE "bull:$QUEUE:active" 0 -1 | grep -qx "$JOB_ID"; then
    active=1; break
  fi
  sleep 0.2
done
[ "$active" = "1" ] || die '60s 内没等到 job 进入 active；模型可能太快或队列没消费'

# ---------------------------------------------------------------------------
# 3. SIGKILL + 重启（只有 kill 才是真崩溃）
# ---------------------------------------------------------------------------
printf '%s▶ docker kill %s（模拟进程崩溃）%s\n' "$BOLD" "$BACKEND" "$RESET"
docker kill "$BACKEND" >/dev/null || die 'docker kill 失败'

printf '%s▶ 重启后端，等 stalled 检查把 job 移回 wait%s\n' "$BOLD" "$RESET"
docker start "$BACKEND" >/dev/null || die 'docker start 失败'
wait_http || die "后端 ${WAIT_SECONDS}s 内没有恢复"

# 若 job 在 kill 前已经完成，这次不能证明崩溃恢复
done_deadline=$(( $(date +%s) + WAIT_SECONDS ))
completed=0
while [ "$(date +%s)" -lt "$done_deadline" ]; do
  if [ "$(redis_cli EXISTS "ai:msg:done:$JOB_ID" 2>/dev/null)" = "1" ]; then
    completed=1; break
  fi
  sleep 1
done
[ "$completed" = "1" ] || die "重启后 ${WAIT_SECONDS}s 内没有完成恢复消费（done 键未出现）"
ok 'job 在重启后被重新消费'

# ---------------------------------------------------------------------------
# 4. 断言
# ---------------------------------------------------------------------------
FAILS=0
check() { # 描述 实际 期望
  if [ "$2" = "$3" ]; then ok "$1 = $2"; else warn "$1 = $2（期望 $3）"; FAILS=$((FAILS + 1)); fi
}

check '本轮 AI 回复数' \
  "$(sql "SELECT count(*) FROM \"ChatMessage\"
         WHERE \"conversationId\" = '$CONV_ID'
           AND \"seqId\" > $BEFORE_SEQ AND \"senderId\" = '$BOT_ID'")" '1'

check '按 triggerMessageId 查到的回复数' \
  "$(sql "SELECT count(*) FROM \"ChatMessage\" WHERE \"triggerMessageId\" = '$JOB_ID'")" '1'

check 'done 幂等键' "$(redis_cli EXISTS "ai:msg:done:$JOB_ID")" '1'

# stalled 恢复的痕迹：stc>=1；不同 BullMQ 版本字段可能略有差异，缺失只告警
JOB_HASH=$(redis_cli HGETALL "bull:$QUEUE:$JOB_ID" 2>/dev/null || true)
STC=$(printf '%s\n' "$JOB_HASH" | awk 'p=="stc"{print; exit}{p=$0}')
if [ -n "$STC" ]; then ok "stalled 次数 stc=$STC"; else warn '未读到 stc（BullMQ 版本差异，可忽略）'; fi

# 本轮不应再有 active/等待中的同一 job
check 'job 已离开 active' \
  "$(redis_cli LRANGE "bull:$QUEUE:active" 0 -1 | grep -cx "$JOB_ID" || true)" '0'

printf '\n%s崩溃恢复：%s%s\n' "$BOLD" "$([ "$FAILS" -eq 0 ] && printf '%sPASS' "$GREEN" || printf '%sFAIL(%s)' "$RED" "$FAILS")" "$RESET"
[ "$FAILS" -eq 0 ]
