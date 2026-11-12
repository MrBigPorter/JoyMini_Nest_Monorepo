#!/usr/bin/env bash
# =============================================================================
# AI 客服端到端自测（真实流量，不是单元测试）
#
# 为什么需要它：
#   jest 单测只覆盖"函数逻辑"，覆盖不了这一整条链路：
#     POST /chat/message → ChatService.sendMessage → AI_MESSAGE_REQUESTED
#     → AiMessageListener → LangGraph → publishAiReply → Socket 双通道
#   而 N-9（AI 回复只发会话房间，断线重连的用户一条都收不到）这种问题，
#   单测永远发现不了 —— 只有真的发一条消息、真的看日志才会暴露。
#
# 它做什么：
#   1. 用容器里的 JWT_SECRET 临时签发一个 client token（不碰密码 / 不发 OTP）
#   2. 复用或新建一条专用的 SUPPORT 自测会话（名字：【AI自测】）
#   3. 每条消息前重置会话状态（handlerId=NULL、换新 threadId = 干净的记忆）
#   4. 发消息 → 按 traceId 从后端日志捞 chat.start / intent / transfer / chat.done
#   5. 断言：转人工与否、转人工原因、意图、以及双通道投递日志是否出现
#
# 用法：
#   bash scripts/ai-e2e-smoke.sh                  # 跑默认场景
#   bash scripts/ai-e2e-smoke.sh 转人工           # 只跑名字里含"转人工"的场景
#   WAIT_SECONDS=180 bash scripts/ai-e2e-smoke.sh # LLM 慢时放宽等待
#   WITH_REPEAT=1 bash scripts/ai-e2e-smoke.sh    # 追加"连续重复 4 次才转人工"（很慢）
#   WITH_FAILURE=1 bash scripts/ai-e2e-smoke.sh   # 追加"模型故障降级"（写 Redis 故障开关）
#   REDIS=lucky-redis-1 bash scripts/...          # Redis 容器名不是 lucky-redis 时覆盖
#
# 可覆盖的环境变量：
#   TEST_USER_ID         指定测试用户（默认取最近加入会话的真人用户 is_robot=false）
#   TEST_BOT_ID          指定 AI 占位账号（默认取 is_robot=true 的账号）
#   TEST_CONVERSATION_ID 指定已有会话（设置后不会新建【AI自测】会话）
#
# 依赖：docker（lucky-db / lucky-backend-dev）、curl、jq、uuidgen
# =============================================================================
set -uo pipefail
# LC_ALL=C：下面用 [[ $ts > $since ]] 比较 ISO 时间串，必须按字节比较，
# 否则中文 locale 下的排序规则可能把 "17:10:29Z" 和 "17:9:.." 排错。
export LC_ALL=C

API_BASE=${API_BASE:-http://localhost/api/v1}
BACKEND=${BACKEND:-lucky-backend-dev}
DB=${DB:-lucky-db}
REDIS=${REDIS:-lucky-redis}
WAIT_SECONDS=${WAIT_SECONDS:-150}
WITH_REPEAT=${WITH_REPEAT:-0}
WITH_FAILURE=${WITH_FAILURE:-0}
FILTER=${1:-}
SMOKE_TITLE='【AI自测】'

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

PASS=0
FAIL=0
SEEN_TRACES=""
ROWS=()

# ---------------------------------------------------------------------------
# 基础设施小工具
# ---------------------------------------------------------------------------
die() { printf '%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }

sql() {
  # SQL 通过环境变量传进容器，避免引号在 sh -c 里被撕裂
  docker exec -e SQL="$1" "$DB" \
    sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "$SQL"'
}

# ⚠️ docker logs --since 在这台机器上会卡死（Colima + json-file，2026-11-11 实测），
#    所以日志统一用 `--tail N` 取最近 N 行，再按结构化日志自带的 ts 过滤。
#    结构化日志的 ts 形如 "2026-11-11T17:12:06.467Z"，去掉毫秒后按 ISO8601
#    字符串比较（配合文件顶部的 LC_ALL=C）。
TAIL_LINES=${TAIL_LINES:-4000}

recent_logs() { docker logs --tail "$TAIL_LINES" "$BACKEND" 2>&1; }

# Redis 有 requirepass：密码用容器内的 REDISCLI_AUTH 传，
# 既不写进命令行参数（宿主机 ps 可见），也不出现在脚本里。
redis_cli() {
  docker exec "$REDIS" sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli "$@"' sh "$@" 2>/dev/null
}

json_since() { # $1=起始时间（YYYY-MM-DDTHH:MM:SSZ）→ 只留 ts >= 起点的结构化日志行
  recent_logs | jq -R -r --arg since "$1" '
    . as $raw
    | (fromjson? // empty) as $o
    | select($o.ts != null)
    | select(($o.ts | sub("\\.[0-9]+Z$"; "Z")) >= $since)
    | $raw' 2>/dev/null
}

esc_json() { printf '%s' "$1" | jq -Rs .; }

# ---------------------------------------------------------------------------
# 0. 前置检查
# ---------------------------------------------------------------------------
command -v jq >/dev/null || die '缺少 jq（brew install jq）'
docker inspect "$BACKEND" >/dev/null 2>&1 || die "后端容器 $BACKEND 不在运行"
docker inspect "$DB" >/dev/null 2>&1 || die "数据库容器 $DB 不在运行"

# ---------------------------------------------------------------------------
# 1. 解析测试用户 / AI 账号 / 会话
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
  WHERE type = 'SUPPORT' AND name = '$SMOKE_TITLE'
  ORDER BY \"createdAt\" ASC
  LIMIT 1")}

if [ -z "$CONV_ID" ]; then
  CONV_ID="smk$(uuidgen | tr -d '-' | tr 'A-Z' 'a-z' | cut -c1-24)"
  sql "INSERT INTO \"Conversation\" (id, type, name, thread_id, \"createdAt\", \"updatedAt\")
       VALUES ('$CONV_ID', 'SUPPORT', '$SMOKE_TITLE', gen_random_uuid()::text, now(), now())" >/dev/null \
    || die "新建自测会话失败（$CONV_ID）"
  sql "INSERT INTO \"ChatMember\" (id, \"conversationId\", \"userId\")
       VALUES ('smk$(uuidgen | tr -d '-' | tr 'A-Z' 'a-z' | cut -c1-24)', '$CONV_ID', '$USER_ID')" >/dev/null \
    || die '写入会话成员失败（测试用户）'
  sql "INSERT INTO \"ChatMember\" (id, \"conversationId\", \"userId\")
       VALUES ('smk$(uuidgen | tr -d '-' | tr 'A-Z' 'a-z' | cut -c1-24)', '$CONV_ID', '$BOT_ID')" >/dev/null \
    || die '写入会话成员失败（AI 账号）'
  printf '%s新建自测会话 %s（用户 %s）%s\n' "$DIM" "$CONV_ID" "$USER_ID" "$RESET"
fi

# 临时 JWT：密钥只存在于容器进程里，不打印、不落盘
TOKEN=$(docker exec -e SUB="$USER_ID" "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "user", type: "client" },
    process.env.JWT_SECRET,
    { expiresIn: "30m" },
  ));
') || die '签发测试 JWT 失败'
[ -n "$TOKEN" ] || die '签发测试 JWT 失败（JWT_SECRET 为空？）'

reset_conversation() {
  # handlerId=NULL          → AI 重新接管（转人工场景会把它写成 awaiting_human）
  # thread_id=新 UUID       → MemorySaver 换一个 thread，历史 / repeatCount 归零
  sql "UPDATE \"Conversation\"
       SET handler_id = NULL,
           handler_assigned_at = NULL,
           thread_id = gen_random_uuid()::text
       WHERE id = '$CONV_ID'" >/dev/null
}

# ---------------------------------------------------------------------------
# 2. 发消息 + 从日志里捞 trace
# ---------------------------------------------------------------------------
SEND_SINCE=""
SEND_CODE=""

send_message() {
  local content="$1"
  local id="smk-$(uuidgen | tr 'A-Z' 'a-z')"
  SEND_SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local body
  body=$(printf '{"id":"%s","conversationId":"%s","content":%s,"type":0}' \
    "$id" "$CONV_ID" "$(esc_json "$content")")
  SEND_CODE=$(curl -s -o /tmp/ai-smoke-last.json -w '%{http_code}' \
    -X POST "$API_BASE/chat/message" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "$body")
  [ "$SEND_CODE" = "200" ] || [ "$SEND_CODE" = "201" ]
}

find_trace() {
  # 从 since 之后的日志里找一条"还没被别的用例用过"的 chat.start
  local since="$1" i trace
  for i in $(seq 1 60); do
    trace=$(json_since "$since" \
      | grep -F '"stage":"chat.start"' \
      | grep -F "\"conversationId\":\"$CONV_ID\"" \
      | sed -n 's/.*"traceId":"\([^"]*\)".*"stage":"chat.start".*/\1/p' \
      | tail -1)
    if [ -n "$trace" ] && ! printf '%s' "$SEEN_TRACES" | grep -qxF "$trace"; then
      printf '%s' "$trace"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

wait_for_done() {
  local trace="$1" since="$2"
  local deadline=$(( $(date +%s) + WAIT_SECONDS )) line
  while [ "$(date +%s)" -lt "$deadline" ]; do
    line=$(json_since "$since" \
      | grep -F "\"traceId\":\"$trace\"" \
      | grep -F '"stage":"chat.done"' \
      | tail -1)
    if [ -n "$line" ]; then
      printf '%s' "$line"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

stage_line() { # $1=traceId $2=since $3=stage
  json_since "$2" \
    | grep -F "\"traceId\":\"$1\"" \
    | grep -F "\"stage\":\"$3\"" \
    | tail -1
}

# 等某个 stage 出现。失败路径没有 chat.done，所以要能等 chat.error。
wait_for_stage() { # $1=traceId $2=since $3=stage
  local trace="$1" since="$2" stage="$3"
  local deadline=$(( $(date +%s) + WAIT_SECONDS )) line
  while [ "$(date +%s)" -lt "$deadline" ]; do
    line=$(stage_line "$trace" "$since" "$stage")
    if [ -n "$line" ]; then
      printf '%s' "$line"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# ---------------------------------------------------------------------------
# 3. 单个用例
# ---------------------------------------------------------------------------
report() { # name intent transferred reason tokens ms verdict
  local name="$1" intent="$2" transferred="$3" reason="$4"
  local tokens="$5" ms="$6" errs="$7"
  if [ -z "$errs" ]; then
    PASS=$((PASS + 1))
    ROWS+=("$name|$intent|$transferred|$reason|$tokens|$ms|${GREEN}PASS${RESET}")
  else
    FAIL=$((FAIL + 1))
    ROWS+=("$name|$intent|$transferred|$reason|$tokens|$ms|${RED}FAIL${RESET} ${errs}")
  fi
}

run_case() { # name content expect_transfer expect_intent expect_reason
  local name="$1" content="$2" exp_transfer="$3" exp_intent="$4" exp_reason="$5"
  local errs="" trace done_line intent_line transfer_line
  local transferred intent reason tokens ms delivery

  printf '%s▶ %s%s  %s"%s"%s\n' "$BOLD" "$name" "$RESET" "$DIM" "$content" "$RESET"

  reset_conversation

  # 记下发送前的最大 seqId：后面用它判断"这一轮到底有没有新落库的 AI 回复"
  local before_seq
  before_seq=$(sql "SELECT COALESCE(MAX(\"seqId\"), 0) FROM \"ChatMessage\" WHERE \"conversationId\" = '$CONV_ID'")

  if ! send_message "$content"; then
    report "$name" "-" "-" "-" "-" "-" "发送失败 HTTP $SEND_CODE"
    return
  fi

  if ! trace=$(find_trace "$SEND_SINCE"); then
    report "$name" "-" "-" "-" "-" "-" \
      "等 chat.start 超时（handlerId 没清掉？成员缺失？后端没在跑？）"
    return
  fi
  SEEN_TRACES="${SEEN_TRACES}${trace}"$'\n'

  if ! done_line=$(wait_for_done "$trace" "$SEND_SINCE"); then
    report "$name" "-" "-" "-" "-" "-" "等 chat.done 超时（${WAIT_SECONDS}s）"
    return
  fi

  intent_line=$(stage_line "$trace" "$SEND_SINCE" intent)
  transfer_line=$(stage_line "$trace" "$SEND_SINCE" transfer)
  transferred=$(printf '%s' "$done_line" | jq -r '.transferred // false')
  tokens=$(printf '%s' "$done_line" | jq -r '.tokenTotal // 0')
  ms=$(printf '%s' "$done_line" | jq -r '.totalMs // 0')
  intent=$([ -n "$intent_line" ] && printf '%s' "$intent_line" | jq -r '.intent // ""' || printf '')
  reason=$([ -n "$transfer_line" ] && printf '%s' "$transfer_line" | jq -r '.reason // ""' || printf '')

  [ "$transferred" = "$exp_transfer" ] \
    || errs="$errs transferred=$transferred 期望 $exp_transfer;"
  if [ "$exp_intent" != "*" ] && [ "$intent" != "$exp_intent" ]; then
    errs="$errs intent=$intent 期望 $exp_intent;"
  fi
  if [ -n "$exp_reason" ] && [ "$reason" != "$exp_reason" ]; then
    errs="$errs reason=$reason 期望 $exp_reason;"
  fi

  # 落库断言：一轮对话应当恰好落 1 条 AI 回复，且 role/source 标成 assistant/ai。
  # 转人工场景尤其重要 —— 修复前 AI 的"正在为您转接"只生成不落库（seqId 断档）。
  local ai_count ai_tagged
  ai_count=$(sql "SELECT count(*) FROM \"ChatMessage\"
                  WHERE \"conversationId\" = '$CONV_ID'
                    AND \"seqId\" > ${before_seq:-0}
                    AND \"senderId\" = '$BOT_ID'")
  ai_tagged=$(sql "SELECT count(*) FROM \"ChatMessage\"
                   WHERE \"conversationId\" = '$CONV_ID'
                     AND \"seqId\" > ${before_seq:-0}
                     AND \"senderId\" = '$BOT_ID'
                     AND role = 'assistant' AND source = 'ai'")
  [ "${ai_count:-0}" = "1" ] \
    || errs="$errs AI 落库=$ai_count 期望 1;"
  [ "${ai_tagged:-0}" = "${ai_count:-0}" ] \
    || errs="$errs role/source 未标 assistant/ai（$ai_tagged/$ai_count）;"

  # 双通道投递：会话房间 + 成员私有房间（N-9 的修复点）
  delivery=$(recent_logs \
    | grep -F '[DispatchFallback]' | grep -F "Room: $CONV_ID" | tail -1)
  if [ -z "$delivery" ]; then
    errs="$errs 缺少双通道投递日志 [DispatchFallback];"
  else
    local rooms
    rooms=$(printf '%s' "$delivery" | sed -n 's/.*private rooms: \([0-9]*\).*/\1/p')
    [ "${rooms:-0}" -ge 2 ] || errs="$errs private rooms=$rooms 期望 >=2;"
  fi

  report "$name" "${intent:--}" "$transferred" "${reason:--}" "$tokens" "$ms" "$errs"
}

# ---------------------------------------------------------------------------
# 4. 连续重复场景（走 repeated_attempts 分支，慢，默认关闭）
# ---------------------------------------------------------------------------
run_repeat_case() {
  local name="连续重复 4 次" content="我的订单到哪了"
  local errs="" trace done_line transfer_line reason transferred i

  printf '%s▶ %s%s  %s"%s" ×4%s\n' "$BOLD" "$name" "$RESET" "$DIM" "$content" "$RESET"
  reset_conversation

  for i in 1 2 3 4; do
    if ! send_message "$content"; then
      report "$name" "-" "-" "-" "-" "-" "第 $i 条发送失败 HTTP $SEND_CODE"
      return
    fi
    if ! trace=$(find_trace "$SEND_SINCE"); then
      report "$name" "-" "-" "-" "-" "-" "第 $i 条等 chat.start 超时"
      return
    fi
    SEEN_TRACES="${SEEN_TRACES}${trace}"$'\n'
    if ! done_line=$(wait_for_done "$trace" "$SEND_SINCE"); then
      report "$name" "-" "-" "-" "-" "-" "第 $i 条等 chat.done 超时"
      return
    fi
    transferred=$(printf '%s' "$done_line" | jq -r '.transferred // false')
    # 前 3 条必须不转，第 4 条必须因为"重复"转
    if [ "$i" -lt 4 ] && [ "$transferred" != "false" ]; then
      errs="$errs 第 $i 条提前转人工;"
    fi
  done

  transfer_line=$(stage_line "$trace" "$SEND_SINCE" transfer)
  reason=$([ -n "$transfer_line" ] && printf '%s' "$transfer_line" | jq -r '.reason // ""' || printf '')
  [ "$transferred" = "true" ] || errs="$errs 第 4 条没有转人工;"
  [ "$reason" = "repeated_attempts" ] || errs="$errs reason=$reason 期望 repeated_attempts;"

  report "$name" "order" "$transferred" "${reason:--}" "-" "-" "$errs"
}

# ---------------------------------------------------------------------------
# 4b. 模型故障降级（N-15）
#
# 怎么制造"模型挂了"：后端在 chatStream 开头有一个测试钩子 ——
#   消息以 __CHAOS__ 开头 + NODE_ENV≠production + Redis 里有 ai:chaos:fail
# 三个条件同时满足才抛错，普通消息零开销、生产环境物理上不可能触发。
#
# 断言四件事（对应 ai-failure-handler.ts 的四步）：
#   ① 兜底话术落库（恰好 1 条，assistant/ai）
#   ② handler_id 变成 awaiting_human（止血：下一轮不再进 AI）
#   ③ 日志里有 transfer{source:fallback, reason:ai_error}
#   ④ 出现 chat.error（说明确实走的是异常路径，不是正常完成）
# ---------------------------------------------------------------------------
cleanup_chaos() { redis_cli DEL ai:chaos:fail >/dev/null 2>&1 || true; }

# 轮询一个 SQL 标量直到等于期望值。
# 为什么需要：失败路径的写库发生在 chat.error 之后（先记日志、再降级），
# 日志一出现就读库会撞上毫秒级时序差，必须等状态落定。
wait_sql_eq() { # $1=SQL $2=期望值 $3=超时秒数（默认 10）
  local q="$1" want="$2" deadline=$(( $(date +%s) + ${3:-10} )) got=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    got=$(sql "$q")
    if [ "$got" = "$want" ]; then printf '%s' "$got"; return 0; fi
    sleep 0.3
  done
  printf '%s' "$got"
  return 1
}

run_failure_case() {
  local name="模型故障降级" content="__CHAOS__ 你好"
  local errs="" trace err_line transfer_line before_seq
  local ai_count ai_tagged src reason handler db_text

  printf '%s▶ %s%s  %s"%s"%s\n' \
    "$BOLD" "$name" "$RESET" "$DIM" "$content" "$RESET"

  reset_conversation
  cleanup_chaos
  if ! redis_cli SET ai:chaos:fail 1 EX 120 >/dev/null; then
    report "$name" "-" "-" "-" "-" "-" \
      "无法写入 Redis 开关 ai:chaos:fail（容器名？用 REDIS=xxx 覆盖）"
    return
  fi

  before_seq=$(sql "SELECT COALESCE(MAX(\"seqId\"), 0) FROM \"ChatMessage\" WHERE \"conversationId\" = '$CONV_ID'")

  if ! send_message "$content"; then
    cleanup_chaos
    report "$name" "-" "-" "-" "-" "-" "发送失败 HTTP $SEND_CODE"
    return
  fi

  if ! trace=$(find_trace "$SEND_SINCE"); then
    cleanup_chaos
    report "$name" "-" "-" "-" "-" "-" "等 chat.start 超时（后端是否已含故障注入代码？）"
    return
  fi
  SEEN_TRACES="${SEEN_TRACES}${trace}"$'\n'

  # 失败路径没有 chat.done，等 chat.error
  if ! err_line=$(wait_for_stage "$trace" "$SEND_SINCE" chat.error); then
    cleanup_chaos
    report "$name" "-" "-" "-" "-" "-" "等 chat.error 超时（注入没生效？）"
    return
  fi

  # ③ transfer 事件必须来自 fallback
  transfer_line=$(stage_line "$trace" "$SEND_SINCE" transfer)
  src=$([ -n "$transfer_line" ] && printf '%s' "$transfer_line" | jq -r '.source // ""' || printf '')
  reason=$([ -n "$transfer_line" ] && printf '%s' "$transfer_line" | jq -r '.reason // ""' || printf '')
  [ "$src" = "fallback" ] || errs="$errs source=$src 期望 fallback;"
  [ "$reason" = "ai_error" ] || errs="$errs reason=$reason 期望 ai_error;"

  # ② 止血：会话必须被置为等待人工
  handler=$(wait_sql_eq \
    "SELECT COALESCE(handler_id, '<NULL>') FROM \"Conversation\" WHERE id = '$CONV_ID'" \
    awaiting_human 10)
  [ "$handler" = "awaiting_human" ] \
    || errs="$errs handler_id=$handler 期望 awaiting_human;"

  # ① 兜底话术恰好落 1 条，且标注 assistant/ai
  ai_count=$(wait_sql_eq \
    "SELECT count(*) FROM \"ChatMessage\"
     WHERE \"conversationId\" = '$CONV_ID'
       AND \"seqId\" > ${before_seq:-0}
       AND \"senderId\" = '$BOT_ID'" \
    1 10) || true
  ai_tagged=$(sql "SELECT count(*) FROM \"ChatMessage\"
                   WHERE \"conversationId\" = '$CONV_ID'
                     AND \"seqId\" > ${before_seq:-0}
                     AND \"senderId\" = '$BOT_ID'
                     AND role = 'assistant' AND source = 'ai'")
  [ "${ai_count:-0}" = "1" ] || errs="$errs AI 落库=${ai_count:-0} 期望 1;"
  [ "${ai_tagged:-0}" = "${ai_count:-0}" ] \
    || errs="$errs role/source 未标 assistant/ai（${ai_tagged:-0}/${ai_count:-0}）;"

  # 话术必须是静态兜底文案（不能是 LLM 现场生成 —— 那时它已经挂了）
  db_text=$(sql "SELECT content FROM \"ChatMessage\"
                 WHERE \"conversationId\" = '$CONV_ID'
                   AND \"seqId\" > ${before_seq:-0}
                   AND \"senderId\" = '$BOT_ID'
                 ORDER BY \"seqId\" DESC LIMIT 1")
  printf '%s' "$db_text" | grep -q '转接人工' \
    || errs="$errs 兜底话术内容不符: ${db_text:0:20};"

  cleanup_chaos
  reset_conversation

  report "$name" "-" "true" "${reason:-ai_error}" "-" "-" "$errs"
}

# ---------------------------------------------------------------------------
# 5. 场景表
#    name | content | expect_transfer | expect_intent | expect_reason
#    expect_intent / expect_reason 写 * 表示不断言
# ---------------------------------------------------------------------------
CASES=(
  '闲聊问候|你好|false|general|'
  '知识问答|退款怎么弄|false|rag|'
  '明确转人工|我要转人工|true|transfer|explicit_request'
  '强负面词|我要投诉你们|true|transfer|negative_sentiment'
  '弱负面单个|太慢了|false|*|'
  '弱负面两个|好烦啊，快递太慢了|true|transfer|negative_sentiment'
  '子串误判-麻烦|麻烦帮我查一下订单|false|*|'
  '子串误判-没用过|这个券我没用过|false|*|'
)

printf '\n%sAI 客服端到端自测%s  会话=%s  用户=%s  后端=%s\n\n' \
  "$BOLD" "$RESET" "$CONV_ID" "$USER_ID" "$BACKEND"

for row in "${CASES[@]}"; do
  IFS='|' read -r name content exp_transfer exp_intent exp_reason <<<"$row"
  if [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]]; then
    continue
  fi
  run_case "$name" "$content" "$exp_transfer" "$exp_intent" "$exp_reason"
done

if [ "$WITH_REPEAT" = "1" ] && { [ -z "$FILTER" ] || [[ "连续重复 4 次" == *"$FILTER"* ]]; }; then
  run_repeat_case
fi

# 模型故障降级：默认不跑（要写 Redis 开关 + 后端需已部署注入代码）。
# 用法：WITH_FAILURE=1 ./scripts/ai-e2e-smoke.sh
if [ "$WITH_FAILURE" = "1" ] && { [ -z "$FILTER" ] || [[ "模型故障降级" == *"$FILTER"* ]]; }; then
  run_failure_case
fi

# ---------------------------------------------------------------------------
# 6. 汇总
# ---------------------------------------------------------------------------
printf '\n%s结果%s\n' "$BOLD" "$RESET"
printf '%-18s %-9s %-11s %-20s %8s %8s  %s\n' \
  '场景' '意图' '转人工' '原因' 'tokens' '耗时ms' '判定'
printf '%s\n' "$(printf '%.0s-' {1..96})"
for row in "${ROWS[@]}"; do
  IFS='|' read -r n i t r tok ms verdict <<<"$row"
  printf '%-18s %-9s %-11s %-20s %8s %8s  %b\n' "$n" "$i" "$t" "$r" "$tok" "$ms" "$verdict"
done

printf '\n%sPASS %d%s  %sFAIL %d%s\n' "$GREEN" "$PASS" "$RESET" "$RED" "$FAIL" "$RESET"
[ "$FAIL" -eq 0 ]
