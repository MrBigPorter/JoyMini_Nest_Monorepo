#!/bin/bash
# JWT 密钥一致性验证脚本
# 用于验证 Admin 登录后是否能正常访问受保护接口

set -e

API_BASE_URL="${API_BASE_URL:-https://dev-api.joyminis.com}"
ADMIN_USERNAME="${E2E_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-Admin@123456}"

echo "🔍 JWT 密钥一致性验证开始..."
echo "📍 API 地址: $API_BASE_URL"
echo ""

# 1. 登录获取 token
echo "1️⃣ 登录..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/v1/auth/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败！响应: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ 登录成功，获取 token: ${TOKEN:0:20}..."
echo ""

# 2. 验证 token
echo "2️⃣ 验证 token..."
VERIFY_RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/v1/auth/admin/verify-token" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}")

VERIFY_OK=$(echo "$VERIFY_RESPONSE" | grep -o '"ok":true' || echo "")

if [ -z "$VERIFY_OK" ]; then
  echo "❌ Token 验证失败！响应: $VERIFY_RESPONSE"
  exit 1
fi

echo "✅ Token 验证成功"
echo ""

# 3. 立即访问受保护接口（关键测试）
echo "3️⃣ 立即访问受保护接口（测试密钥一致性）..."

PROTECTED_ENDPOINTS=(
  "/api/v1/admin/applications/pending-count"
  "/api/v1/admin/order/list?page=1&pageSize=5"
  "/api/v1/admin/finance/statistics"
  "/api/v1/admin/client-user/list?page=1&pageSize=1"
)

FAILED_COUNT=0

for endpoint in "${PROTECTED_ENDPOINTS[@]}"; do
  echo "   测试: $endpoint"

  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    "$API_BASE_URL$endpoint")

  HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d':' -f2)
  BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d')

  if [ "$HTTP_STATUS" != "200" ]; then
    echo "   ❌ 失败 (HTTP $HTTP_STATUS)"
    echo "   响应: $BODY"
    FAILED_COUNT=$((FAILED_COUNT + 1))
  else
    # 检查是否包含 Unauthorized 错误码
    if echo "$BODY" | grep -q '"code":40100'; then
      echo "   ❌ 返回 200 但业务错误码为 40100 (Unauthorized)"
      echo "   响应: $BODY"
      FAILED_COUNT=$((FAILED_COUNT + 1))
    else
      echo "   ✅ 成功 (HTTP $HTTP_STATUS)"
    fi
  fi
done

echo ""

# 4. 结果汇总
if [ $FAILED_COUNT -eq 0 ]; then
  echo "🎉 全部测试通过！JWT 密钥配置一致。"
  exit 0
else
  echo "❌ 有 $FAILED_COUNT 个接口测试失败！"
  echo ""
  echo "🔧 排查建议:"
  echo "   1. 检查 apps/api/src/admin/auth/auth.module.ts 的 JwtModule.register({ secret })"
  echo "   2. 确认环境变量 ADMIN_JWT_SECRET 已在容器内正确加载"
  echo "   3. 重启后端容器: docker compose --env-file deploy/.env.dev restart backend"
  echo "   4. 查看详细复盘文档: docs/read/devops/JWT_SECRET_MISMATCH_INCIDENT_20260403_CN.md"
  exit 1
fi

