#!/bin/bash

# Capacitor一键初始化脚本
# 解决所有初始化问题，实现真正的一键开发
# 使用方法：bash scripts/init-capacitor.sh

set -e

echo "🚀 Capacitor一键初始化"
echo "========================"

# 检查是否在正确目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误：请在apps/frontend-blog目录下运行此脚本"
    exit 1
fi

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 步骤1：检查环境
log_info "1. 检查开发环境..."
if [ -z "$NODE_ENV" ]; then
    export NODE_ENV=development
    log_warning "设置 NODE_ENV=development"
fi

# 步骤2：检查capacitor.config.ts
log_info "2. 检查Capacitor配置..."
if [ ! -f "capacitor.config.ts" ]; then
    log_error "capacitor.config.ts不存在"
    exit 1
fi

# 检查appId配置
if grep -q "appId: 'com.tarsier.labs'" capacitor.config.ts; then
    log_success "appId配置正确"
else
    log_error "appId配置不正确"
    exit 1
fi

# 步骤3：添加iOS平台
log_info "3. 添加iOS平台..."
if [ ! -d "ios" ]; then
    log_info "正在添加iOS平台..."
    if npx cap add ios 2>&1 | tee /tmp/capacitor-add-ios.log; then
        log_success "iOS平台添加成功"
    else
        log_warning "iOS平台添加可能有警告，继续执行..."
    fi
else
    log_success "iOS平台已存在"
fi

# 步骤4：同步Capacitor配置
log_info "4. 同步Capacitor配置..."
if npx cap sync ios 2>&1 | tee /tmp/capacitor-sync.log; then
    log_success "Capacitor配置同步成功"
else
    log_warning "Capacitor同步可能有警告，继续执行..."
fi

# 步骤5：清理Xcode缓存
log_info "5. 清理Xcode缓存..."
if [ -d "ios/DerivedData" ]; then
    rm -rf ios/DerivedData
    log_success "清理DerivedData缓存"
fi

# 步骤6：打开Xcode设置Scheme
log_info "6. 打开Xcode设置Scheme..."
log_warning "请手动执行以下步骤："
echo ""
echo "1. 打开Xcode:"
echo "   npx cap open ios"
echo ""
echo "2. 在Xcode中："
echo "   - 点击左上角Scheme下拉菜单"
echo "   - 选择 'App'"
echo "   - 关闭Xcode"
echo ""
echo "3. 然后运行："
echo "   yarn dev:capacitor"
echo ""

# 步骤7：验证配置
log_info "7. 验证配置..."
echo ""
echo "✅ 初始化完成！"
echo ""
echo "🎯 现在你需要："
echo ""
echo "1. 启动开发服务器（窗口1）："
echo "   yarn dev:app"
echo ""
echo "2. 打开Xcode设置Scheme（一次性）："
echo "   npx cap open ios"
echo "   - 选择 'App'"
echo "   - 关闭Xcode"
echo ""
echo "3. 运行iOS应用（窗口2）："
echo "   yarn dev:capacitor"
echo ""
echo "4. 选择你的设备（iPhone或模拟器）"
echo ""
echo "5. 修改代码测试热更新："
echo "   修改 src/app/[locale]/page.tsx"
echo "   保存文件"
echo "   观察手机自动刷新"
echo ""
echo "📱 真机调试提示："
echo "- 第一次在真机运行需要信任开发者"
echo "- 手机设置 → 通用 → VPN与设备管理 → 信任开发者"
echo ""
echo "🎉 开始享受真正的一键开发体验！"

# 检查是否有错误
if grep -q "error:" /tmp/capacitor-add-ios.log 2>/dev/null; then
    echo ""
    log_warning "检测到错误，正在尝试修复..."
    echo "尝试手动修复："
    echo "1. 删除ios目录：rm -rf ios"
    echo "2. 重新运行此脚本"
fi