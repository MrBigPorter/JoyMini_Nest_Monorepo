#!/bin/bash

# Capacitor热更新测试脚本
# 使用方法：bash scripts/test-hot-reload.sh

set -e

echo "🚀 Capacitor热更新测试脚本"
echo "=========================="

# 检查是否在正确目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误：请在apps/frontend-blog目录下运行此脚本"
    exit 1
fi

echo "✅ 1. 检查Capacitor配置..."
if grep -q "dev.blog.joyminis.com" capacitor.config.ts; then
    echo "   ✅ Capacitor配置正确：包含dev.blog.joyminis.com"
else
    echo "   ❌ Capacitor配置错误：未找到dev.blog.joyminis.com"
    exit 1
fi

echo "✅ 2. 检查package.json脚本..."
if grep -q "dev:tunnel" package.json; then
    echo "   ✅ dev:tunnel脚本存在"
else
    echo "   ❌ dev:tunnel脚本不存在"
    exit 1
fi

if grep -q "dev:app" package.json; then
    echo "   ✅ dev:app脚本存在"
else
    echo "   ❌ dev:app脚本不存在"
    exit 1
fi

if grep -q "dev:capacitor" package.json; then
    echo "   ✅ dev:capacitor脚本存在"
else
    echo "   ❌ dev:capacitor脚本不存在"
    exit 1
fi

echo "✅ 3. 检查cloudflared.yml配置..."
if [ -f "../../cloudflared.yml" ]; then
    if grep -q "dev.blog.joyminis.com" ../../cloudflared.yml; then
        echo "   ✅ cloudflared.yml配置正确"
    else
        echo "   ❌ cloudflared.yml中未找到dev.blog.joyminis.com"
        exit 1
    fi
else
    echo "   ⚠️  cloudflared.yml文件不存在，请确保已创建"
fi

echo "✅ 4. 检查环境变量..."
if [ -z "$NODE_ENV" ]; then
    echo "   ⚠️  NODE_ENV未设置，建议设置：export NODE_ENV=development"
else
    echo "   ✅ NODE_ENV=$NODE_ENV"
fi

echo ""
echo "📋 测试完成！"
echo ""
echo "🎯 下一步操作："
echo "1. 启动开发环境："
echo "   yarn dev:app"
echo ""
echo "2. 另开窗口运行模拟器："
echo "   yarn dev:capacitor"
echo ""
echo "3. 修改代码测试热更新："
echo "   修改 src/app/[locale]/page.tsx 中的文字"
echo "   保存文件"
echo "   观察模拟器是否自动刷新"
echo ""
echo "📖 详细指南请查看：CAPACITOR_HOT_RELOAD_GUIDE.md"
echo ""

# 检查cloudflared是否安装
if command -v cloudflared &> /dev/null; then
    echo "✅ cloudflared已安装"
else
    echo "⚠️  cloudflared未安装，请运行："
    echo "   brew install cloudflare/cloudflare/cloudflared"
    echo "   cloudflared tunnel login"
    echo "   cloudflared tunnel create lucky-nest-monorepo"
fi

echo ""
echo "🎉 所有检查完成！开始享受10倍速开发体验吧！"