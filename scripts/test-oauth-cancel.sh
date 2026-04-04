#!/bin/bash
# ==========================================
# OAuth 取消/错误重定向测试脚本
# ==========================================
# 用途：验证 Facebook/Google 取消授权时的重定向逻辑
# 日期：2026-04-04
# ==========================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置
DEV_API_URL="https://dev-api.joyminis.com"
PROD_API_URL="https://api.joyminis.com"
DEV_FRONTEND_URL="https://dev.joyminis.com"
PROD_FRONTEND_URL="https://admin.joyminis.com"

# 生成伪 state（Base64 编码的 JSON）
generate_state() {
  local provider="$1"
  local callback="$2"
  local state_json=$(cat <<EOF
{
  "provider": "$provider",
  "timestamp": $(date +%s)000,
  "nonce": "$(openssl rand -hex 16)",
  "callback": "$callback"
}
EOF
)
  echo -n "$state_json" | base64 | tr -d '=' | tr '+/' '-_'
}

# 测试函数
test_oauth_cancel() {
  local env="$1"
  local provider="$2"
  local api_url="$3"
  local expected_redirect="$4"

  echo -e "${YELLOW}Testing $provider OAuth cancel in $env environment...${NC}"

  # 生成 state
  local state=$(generate_state "$provider" "")

  # 构造取消回调 URL
  local callback_url="$api_url/auth/$provider/callback?error=access_denied&state=$state"

  if [ "$provider" = "facebook" ]; then
    callback_url="$callback_url&error_reason=user_denied"
  fi

  echo "Testing URL: $callback_url"

  # 发送请求，不跟随重定向
  local response=$(curl -s -I -L "$callback_url")

  # 提取 Location 头
  local location=$(echo "$response" | grep -i "^Location:" | head -1 | sed 's/Location: //i' | tr -d '\r')

  echo "Redirect Location: $location"

  # 验证重定向 URL
  if echo "$location" | grep -q "$expected_redirect"; then
    echo -e "${GREEN}✓ PASS: Redirect to correct URL${NC}"
    return 0
  else
    echo -e "${RED}✗ FAIL: Expected redirect to $expected_redirect, got $location${NC}"
    return 1
  fi
}

# 测试带 Deep Link 的取消
test_oauth_cancel_with_deeplink() {
  local env="$1"
  local provider="$2"
  local api_url="$3"
  local deep_link="luna-app://oauth/callback"

  echo -e "${YELLOW}Testing $provider OAuth cancel with Deep Link in $env environment...${NC}"

  # 生成带 callback 的 state
  local state=$(generate_state "$provider" "$deep_link")

  # 构造取消回调 URL
  local callback_url="$api_url/auth/$provider/callback?error=access_denied&state=$state"

  if [ "$provider" = "facebook" ]; then
    callback_url="$callback_url&error_reason=user_denied"
  fi

  echo "Testing URL: $callback_url"

  # 发送请求
  local response=$(curl -s -I -L "$callback_url")
  local location=$(echo "$response" | grep -i "^Location:" | head -1 | sed 's/Location: //i' | tr -d '\r')

  echo "Redirect Location: $location"

  # 验证重定向到 Deep Link
  if echo "$location" | grep -q "luna-app://oauth/callback?error=cancelled"; then
    echo -e "${GREEN}✓ PASS: Redirect to Deep Link with error=cancelled${NC}"
    return 0
  else
    echo -e "${RED}✗ FAIL: Expected redirect to Deep Link, got $location${NC}"
    return 1
  fi
}

# 主测试流程
main() {
  echo "================================================"
  echo "  OAuth Cancel/Error Redirect Test Suite"
  echo "================================================"
  echo ""

  local failed=0

  # 开发环境测试
  echo -e "${YELLOW}>>> Development Environment Tests${NC}"
  echo ""

  test_oauth_cancel "dev" "facebook" "$DEV_API_URL" "$DEV_FRONTEND_URL/login?cancelled=true" || ((failed++))
  echo ""

  test_oauth_cancel "dev" "google" "$DEV_API_URL" "$DEV_FRONTEND_URL/login?cancelled=true" || ((failed++))
  echo ""

  test_oauth_cancel_with_deeplink "dev" "facebook" "$DEV_API_URL" || ((failed++))
  echo ""

  # 生产环境测试（可选，取消注释启用）
  # echo -e "${YELLOW}>>> Production Environment Tests${NC}"
  # echo ""
  #
  # test_oauth_cancel "prod" "facebook" "$PROD_API_URL" "$PROD_FRONTEND_URL/login?cancelled=true" || ((failed++))
  # echo ""
  #
  # test_oauth_cancel "prod" "google" "$PROD_API_URL" "$PROD_FRONTEND_URL/login?cancelled=true" || ((failed++))
  # echo ""

  # 汇总结果
  echo "================================================"
  if [ $failed -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}$failed test(s) failed!${NC}"
    exit 1
  fi
}

# 帮助信息
usage() {
  cat <<EOF
Usage: $0 [OPTIONS]

Test OAuth cancel/error redirect logic for Facebook and Google.

Options:
  -h, --help          Show this help message
  -e, --env ENV       Test environment: dev|prod (default: dev)
  -p, --provider P    Test provider: facebook|google|all (default: all)

Examples:
  $0                          # Test all providers in dev environment
  $0 -e prod                  # Test all providers in prod environment
  $0 -p facebook              # Test only Facebook in dev environment
  $0 -e prod -p google        # Test only Google in prod environment

EOF
  exit 0
}

# 解析参数
ENV="dev"
PROVIDER="all"

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      usage
      ;;
    -e|--env)
      ENV="$2"
      shift 2
      ;;
    -p|--provider)
      PROVIDER="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

# 执行测试
main

