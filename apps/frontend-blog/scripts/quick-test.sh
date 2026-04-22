#!/bin/bash

# 快速测试脚本 - 验证所有开发命令
# 使用方法：bash scripts/quick-test.sh

set -e

echo "⚡ 快速测试 - 验证开发环境"
echo "=========================="

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

check_command() {
    echo -n "检查 $1... "
    if grep -q "\"$1\":" package.json; then
        echo -e "${GREEN}✅${NC}"
        return 0
    else
        echo -e "${RED}❌ 不存在${NC}"
        return 1
    fi
}

echo ""
echo "📋 检查所有命令："

check_command "dev"
check_command "dev:app"
check_command "dev:tunnel"
check_command "dev:ios"
check_command "dev:full"
check_command "setup:ios"
check_command "build:ios"
check_command "reload:ios"
check_command "hotreload:ios"
check_command "dev:capacitor"

echo ""
echo "🎯 可用命令："
echo ""
echo "1. 完整开发流程（第一次使用）："
echo "   yarn dev:full"
echo ""
echo "2. 日常开发（已经初始化后）："
echo "   yarn dev:ios"
echo ""
echo "3. 单独命令："
echo "   yarn setup:ios    # 修复Xcode问题"
echo "   yarn build:ios    # 只构建不运行"
echo "   yarn reload:ios   # 重新安装App"
echo "   yarn hotreload:ios # 热重载模式"
echo ""
echo "4. 底层命令："
echo "   yarn dev:app      # 启动开发服务器+Tunnel"
echo "   yarn dev:capacitor # 运行Capacitor"
echo ""
echo "📖 一句话文档："
echo "   打命令：yarn dev:ios"
echo "   选设备"
echo "   改代码"
echo "   手机自动刷新"
echo ""
echo "✅ 测试完成！"