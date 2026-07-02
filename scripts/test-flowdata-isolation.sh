#!/bin/bash
# ============================================================
# 跨业务上下文隔离 — 测试脚本
# 测试 intentRouter 话题切换 + flowData reducer 清空
# ============================================================
# 用法:
#   1. 确保本地服务已启动
#   2. 获取一个有效的 JWT token
#   3. 运行: TOKEN="your-jwt-token" bash scripts/test-flowdata-isolation.sh
# ============================================================

API_BASE="${API_BASE:-http://localhost:3000/api/client/ai/customer}"
TOKEN="${TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "❌ 请设置 TOKEN 环境变量"
  echo "   用法: TOKEN=\"your-jwt-token\" bash scripts/test-flowdata-isolation.sh"
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $TOKEN"

echo "=========================================="
echo "跨业务上下文隔离 — 测试套件"
echo "=========================================="
echo ""

# 助手函数：发送 testChat 请求
test_chat() {
  local scenario="$1"
  local session_id="$2"
  local message="$3"
  local round="$4"

  echo "  [轮次 $round] 发送: \"$message\""
  
  RESPONSE=$(curl -s -X POST "$API_BASE/test-chat" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"$message\", \"sessionId\": \"$session_id\", \"debug\": true}")

  echo "$RESPONSE" | python3 -c "
import json, sys
try:
    raw = json.load(sys.stdin)
    # 支持两种格式: 直接返回 或 {code, message, tid, data}
    data = raw.get('data', raw) if 'code' in raw else raw
    intent = data.get('intent', '?')
    flow_data = data.get('flowData', {})
    flow_type = data.get('flowType', '')
    flow_status = data.get('flowStatus', '')
    output = data.get('agentOutput', '')[:80]
    print(f'    → intent={intent}, flowType={flow_type}, flowStatus={flow_status}')
    print(f'    → flowData={json.dumps(flow_data)}')
    if output:
        print(f'    → output=\"{output}...\"')
except Exception as e:
    print(f'    → (parse error: {e})')
"
}

echo ""

# ============================================
# 场景 1：取款 → 查优惠券（核心场景）
# ============================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "场景 1: 取款 → 查优惠券"
echo "预期: 第3轮 flowData 应为 {} (被清空)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_chat "场景1" "scenario-1-flowdata" "我要取款 500" 1
sleep 1
test_chat "场景1" "scenario-1-flowdata" "确认取款" 2
sleep 1
test_chat "场景1" "scenario-1-flowdata" "帮我查优惠券" 3
echo ""

# ============================================
# 场景 2：查余额 → 查订单
# ============================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "场景 2: 查余额 → 查订单"
echo "预期: 第2轮 flowData 应为 {} (被清空)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_chat "场景2" "scenario-2-flowdata" "我的余额多少" 1
sleep 1
test_chat "场景2" "scenario-2-flowdata" "帮我看看最近订单" 2
echo ""

# ============================================
# 场景 3：领优惠券 → 取款
# ============================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "场景 3: 领优惠券 → 取款"
echo "预期: 第2轮 flowData 应为 {} (被清空)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_chat "场景3" "scenario-3-flowdata" "有什么优惠券可以领" 1
sleep 1
test_chat "场景3" "scenario-3-flowdata" "我要取款 300" 2
echo ""

# ============================================
# 场景 4：同域连续性（回归测试）
# ============================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "场景 4: 同域连续性 (回归测试)"
echo "预期: flowData 正常累积，不被清空"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_chat "场景4" "scenario-4-flowdata" "我要取款" 1
sleep 1
test_chat "场景4" "scenario-4-flowdata" "500" 2
sleep 1
test_chat "场景4" "scenario-4-flowdata" "确认取款" 3
echo ""

# ============================================
# 场景 5：首次进入（边界测试）
# ============================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "场景 5: 首次进入 (边界测试)"
echo "预期: flowData 为空对象"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_chat "场景5" "scenario-5-flowdata" "帮我查优惠券" 1
echo ""

# ============================================
# 场景 6：取款 → 查政策
# ============================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "场景 6: 取款 → 查政策"
echo "预期: 第2轮 flowData 应为 {} (被清空)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_chat "场景6" "scenario-6-flowdata" "取款 200" 1
sleep 1
test_chat "场景6" "scenario-6-flowdata" "退货政策是什么" 2
echo ""

echo ""
echo "=========================================="
echo "测试完成!"
echo "=========================================="
echo ""
echo "验证标准:"
echo "  ✅ 跨域场景(1/2/3/6): 最后一轮 flowData 应为 {}"
echo "  ✅ 同域场景(4): flowData 应正常累积,不为 {}"
echo "  ✅ 首次进入(5): flowData 应为 {}"
echo ""
