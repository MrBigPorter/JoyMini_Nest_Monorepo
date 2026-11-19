#!/usr/bin/env bash
# =============================================================================
# 确认卡片端到端验证（T3-1）
#
# 验证：写工具在评测/真实图路径上只生成 pendingConfirm，
# 不调用 service、不落库。
#
# 前置：
#   - 本地 backend/db/redis/nginx 在跑
#   - fixture 已 seed：yarn workspace @lucky/api seed:ai-eval-fixture
# 用法：bash scripts/ai-confirm-card-e2e.sh
# =============================================================================
set -uo pipefail
export LC_ALL=C

API_BASE=${API_BASE:-http://localhost/api/v1}
BACKEND=${BACKEND:-lucky-backend-dev}
DB=${DB:-lucky-db}
FIXTURE_USER=${EVAL_FIXTURE_USER_ID:-aiq_fixture_user_01}

RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
die() { printf '%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }
ok()  { printf '%s✓ %s%s\n' "$GREEN" "$1" "$RESET"; }

sql() {
  docker exec -e SQL="$1" "$DB" \
    sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "$SQL"'
}

docker inspect "$BACKEND" >/dev/null 2>&1 || die "后端容器 $BACKEND 不在运行"

BEFORE=$(sql "SELECT count(*) FROM user_coupons WHERE user_id='$FIXTURE_USER';")
[ -n "$BEFORE" ] || die '读不到 user_coupons'

TOKEN=$(docker exec -e SUB="$FIXTURE_USER" "$BACKEND" node -e '
  const jwt = require("jsonwebtoken");
  process.stdout.write(jwt.sign(
    { sub: process.env.SUB, role: "user", type: "client" },
    process.env.JWT_SECRET,
    { expiresIn: "10m" },
  ));
') || die '签发 client token 失败'

RESP=$(curl -s -X POST "$API_BASE/ai/customer/test-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我领取优惠码 AIQFI10 的优惠券","sessionId":"confirm-e2e-'$(date +%s)'","debug":false}')

ACTION=$(printf '%s' "$RESP" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s); const p=(j.data||{}).pendingConfirm;
    process.stdout.write(p ? `${p.action}|${JSON.stringify(p.params||{})}` : "");
  });
')

[ -n "$ACTION" ] || die "没有生成 pendingConfirm：$RESP"
case "$ACTION" in
  redeem_code*AIQFI10*) ok "确认卡片：$ACTION" ;;
  *) die "确认动作不符合预期：$ACTION" ;;
esac

AFTER=$(sql "SELECT count(*) FROM user_coupons WHERE user_id='$FIXTURE_USER';")
[ "$BEFORE" = "$AFTER" ] || die "写操作被真实执行：user_coupons $BEFORE → $AFTER"
ok "未落库：user_coupons 仍为 $AFTER"

printf '\n%s确认卡片：%sPASS%s\n' '' "$GREEN" "$RESET"
