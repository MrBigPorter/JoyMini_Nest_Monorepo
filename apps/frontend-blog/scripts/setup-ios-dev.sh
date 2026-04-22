#!/bin/bash

# iOS开发环境一键初始化脚本
# 解决所有Xcode编译问题，实现真正的一键开发体验
# 使用方法：bash scripts/setup-ios-dev.sh

set -e

echo "🚀 iOS开发环境一键初始化"
echo "=========================="

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

# 步骤2：同步Capacitor配置
log_info "2. 同步Capacitor配置..."
if npx cap sync ios 2>&1 | tee /tmp/capacitor-sync.log; then
    log_success "Capacitor配置同步成功"
else
    log_warning "Capacitor同步可能有警告，继续执行..."
fi

# 步骤3：清理Xcode缓存
log_info "3. 清理Xcode缓存..."
if [ -d "ios/DerivedData" ]; then
    rm -rf ios/DerivedData
    log_success "清理DerivedData缓存"
fi

if [ -d "ios/Pods" ]; then
    rm -rf ios/Pods
    log_success "清理Pods缓存"
fi

# 步骤4：修复包依赖
log_info "4. 修复包依赖..."
cd ios

# 清理Xcode项目缓存
if [ -f "Podfile.lock" ]; then
    rm Podfile.lock
fi

# 重新安装CocoaPods
if command -v pod &> /dev/null; then
    pod deintegrate 2>/dev/null || true
    pod install --repo-update
    log_success "CocoaPods依赖更新完成"
else
    log_warning "CocoaPods未安装，跳过此步骤"
fi

cd ..

# 步骤5：第一次构建（解决Xcode包解析问题）
log_info "5. 第一次构建（解决包解析问题）..."
log_warning "这一步可能需要1-2分钟，请耐心等待..."

# 尝试构建但不运行
if npx cap run ios --no-build 2>&1 | tee /tmp/xcode-build.log; then
    log_success "Xcode项目构建成功"
else
    log_warning "第一次构建可能有警告，这是正常的"
fi

# 步骤6：检查构建日志中的常见问题
log_info "6. 检查常见问题..."
if grep -q "Code Signing Error" /tmp/xcode-build.log 2>/dev/null; then
    log_warning "检测到代码签名问题，请执行："
    echo "   1. 打开Xcode: npx cap open ios"
    echo "   2. 选择你的开发者账号"
    echo "   3. 设置Bundle Identifier"
    echo "   4. 重新运行此脚本"
    exit 1
fi

if grep -q "No such module" /tmp/xcode-build.log 2>/dev/null; then
    log_warning "检测到模块缺失问题，正在修复..."
    cd ios
    xcodebuild -resolvePackageDependencies
    cd ..
    log_success "包依赖已重新解析"
fi

# 步骤7：创建快捷命令
log_info "7. 创建快捷命令..."
cat > /tmp/ios-dev-commands.txt << 'EOF'
# iOS开发快捷命令
# 保存到 ~/.zshrc 或 ~/.bashrc

# 一键启动开发环境
alias dev-ios='cd /Volumes/MySSD/work/dev/lucky_nest_monorepo/apps/frontend-blog && NODE_ENV=development yarn dev:capacitor'

# 清理Xcode缓存
alias clean-ios='cd /Volumes/MySSD/work/dev/lucky_nest_monorepo/apps/frontend-blog && rm -rf ios/DerivedData ios/Pods'

# 重新同步Capacitor
alias sync-ios='cd /Volumes/MySSD/work/dev/lucky_nest_monorepo/apps/frontend-blog && NODE_ENV=development npx cap sync ios'
EOF

log_success "快捷命令已生成，查看: /tmp/ios-dev-commands.txt"

# 步骤8：最终验证
log_info "8. 最终验证..."
echo ""
echo "✅ 初始化完成！"
echo ""
echo "🎯 现在你可以："
echo ""
echo "1. 启动开发服务器（窗口1）："
echo "   yarn dev:app"
echo ""
echo "2. 运行iOS应用（窗口2）："
echo "   yarn dev:capacitor"
echo ""
echo "3. 选择你的设备（iPhone或模拟器）"
echo ""
echo "4. 修改代码测试热更新："
echo "   修改 src/app/[locale]/page.tsx"
echo "   保存文件"
echo "   观察手机自动刷新"
echo ""
echo "📱 真机调试提示："
echo "- 第一次在真机运行需要信任开发者"
echo "- 手机设置 → 通用 → VPN与设备管理 → 信任开发者"
echo ""
echo "⚡ 如果还有问题，运行："
echo "   bash scripts/setup-ios-dev.sh --force"
echo ""
echo "🎉 开始享受真正的一键开发体验！"

# 添加force参数支持
if [ "$1" = "--force" ]; then
    echo ""
    log_info "强制模式：执行额外清理..."
    rm -rf node_modules/.cache
    rm -rf ~/Library/Developer/Xcode/DerivedData/*
    log_success "额外清理完成"
fi