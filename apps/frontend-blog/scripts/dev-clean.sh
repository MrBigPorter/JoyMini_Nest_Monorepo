#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================"
echo "  🧹 开发环境缓存清理 & 重启"
echo "========================================"

# 1. 强制杀掉所有 Next.js/Turbopack 相关进程
#    原因：Turbopack 可能 spawn 子进程（文件监听器、编译 worker）不监听 3000 端口，
#    只杀端口进程无法清除 Turbopack 内存中的编译缓存。
#    这些子进程存活时，即使删了 .next/ 目录，重启后仍从内存恢复旧编译产物。
#    - pkill -9 发送 SIGKILL，子进程无法忽略
#    - 匹配 "next" 而不是 "next dev" 以覆盖所有相关进程
echo ""
echo "📌 Step 1/3: 强制停止所有 Next.js/Turbopack 进程..."
KILLED=false
if pgrep -f "next" > /dev/null 2>&1; then
  pkill -9 -f "next" 2>/dev/null || true
  KILLED=true
  echo "   ✅ 已强制杀掉所有 next 相关进程"
fi

# 也杀一下可能残留的端口 3000 进程（兜底）
PORT_PID=$(lsof -ti:3000 2>/dev/null || true)
if [ -n "$PORT_PID" ]; then
  kill -9 "$PORT_PID" 2>/dev/null || true
  echo "   ✅ 已杀掉占用端口 3000 的残留进程 PID=$PORT_PID"
  KILLED=true
fi

# 如果杀了进程，等 3 秒确保完全退出
if [ "$KILLED" = true ]; then
  sleep 3
fi

# 2. 删除所有缓存目录（包括 node_modules/.cache）
echo ""
echo "📌 Step 2/3: 清除编译缓存..."
cd "$PROJECT_DIR"

if [ -d ".next" ]; then
  rm -rf .next
  echo "   ✅ 已删除 .next/"
fi
if [ -d ".turbo" ]; then
  rm -rf .turbo
  echo "   ✅ 已删除 .turbo/"
fi
if [ -d "node_modules/.cache" ]; then
  rm -rf node_modules/.cache
  echo "   ✅ 已删除 node_modules/.cache/"
fi

# 3. 重启 dev server
echo ""
echo "📌 Step 3/3: 启动 dev server..."
echo "========================================"
echo ""
exec yarn dev
