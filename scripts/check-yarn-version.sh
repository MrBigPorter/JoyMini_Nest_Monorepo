#!/usr/bin/env bash

set -e

# 从项目根目录.yarnrc.yml读取当前使用的Yarn版本
EXPECTED_YARN_VERSION=$(grep 'yarnPath:' .yarnrc.yml | sed -E 's/.*yarn-(.*)\.cjs/\1/')

echo "✅ 项目当前Yarn版本: $EXPECTED_YARN_VERSION"
echo ""

# 检查所有Dockerfile
DOCKERFILES=$(find . -name "Dockerfile*" -type f | grep -v node_modules | grep -v .next)
MISMATCH_FOUND=0

for file in $DOCKERFILES; do
  if grep -q "yarn@" "$file"; then
    DOCKER_YARN_VERSION=$(grep -E 'npm install -g yarn@|yarn --version' "$file" | head -1 | sed -E 's/.*yarn@?([0-9]+\.[0-9]+\.[0-9]+).*/\1/')
    
    if [ -n "$DOCKER_YARN_VERSION" ] && [ "$DOCKER_YARN_VERSION" != "$EXPECTED_YARN_VERSION" ]; then
      echo "❌ $file 中的Yarn版本不匹配: $DOCKER_YARN_VERSION (应该是 $EXPECTED_YARN_VERSION)"
      MISMATCH_FOUND=1
    else
      echo "✅ $file 版本一致"
    fi
  fi
done

echo ""
if [ $MISMATCH_FOUND -eq 1 ]; then
  echo "❌ 错误: 存在Dockerfile Yarn版本不匹配，请先修复后再构建"
  exit 1
else
  echo "✅ 所有Dockerfile Yarn版本检查通过"
  exit 0
fi