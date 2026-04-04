y# Next.js命令速查表（本项目专用）

> **重要**：执行任何Next.js命令前，必须先查阅本文件。这是AI协作开发规范的一部分。

## 📋 使用说明

### 为什么需要本速查表？

1. **记忆不可靠**：AI没有长期记忆，需要文档辅助
2. **项目特定**：每个项目有自己的命令习惯和脚本
3. **环境差异**：不同环境需要不同的命令参数
4. **错误预防**：避免因命令错误导致的问题

### 使用原则：

1. **执行前必查**：每次执行命令前查阅本文件
2. **记录命令**：所有执行的命令必须在沟通中明确写出
3. **验证结果**：执行后验证命令效果
4. **更新文档**：发现新的有用命令时更新本文件

## 🚀 命令分类索引

### 1. 开发环境命令

### 2. 代码质量命令

### 3. 测试命令

### 4. 运行命令

### 5. 构建命令

### 6. 部署命令

### 7. 性能监控命令

### 8. 项目特定命令

### 9. 调试命令

## 📝 详细命令列表

### 重要提醒：本项目使用Yarn Workspaces管理

**所有命令必须在仓库根目录执行**，使用 `yarn workspace @lucky/admin-next` 前缀，例如：

- ❌ `next dev` → ✅ `yarn workspace @lucky/admin-next dev`
- ❌ `npm run build` → ✅ `yarn workspace @lucky/admin-next build`
- ❌ `npx playwright test` → ✅ `yarn workspace @lucky/admin-next e2e`

### 1. 开发环境命令

#### 项目初始化

```bash
# 安装所有依赖（在仓库根目录）
yarn install

# 清理并重新安装
rm -rf node_modules .yarn/cache .turbo
yarn install
```

#### 环境变量管理

```bash
# 复制环境变量模板
cp apps/admin-next/.env.example apps/admin-next/.env.development
cp apps/admin-next/.env.example apps/admin-next/.env.production
cp apps/admin-next/.env.example apps/admin-next/.env.test

# 查看当前环境变量
cat apps/admin-next/.env.development
```

#### 项目清理

```bash
# 清理构建文件
yarn workspace @lucky/admin-next clean

# 清理所有缓存
rm -rf apps/admin-next/.next apps/admin-next/.turbo apps/admin-next/node_modules/.cache
```

### 2. 代码质量命令

#### 静态分析

```bash
# TypeScript类型检查
yarn workspace @lucky/admin-next check-types

# ESLint检查
yarn workspace @lucky/admin-next lint

# 项目特定分析脚本
make analyze
```

#### 代码格式化

```bash
# 使用Prettier格式化
npx prettier --write apps/admin-next/src/

# 检查格式化（不实际修改）
npx prettier --check apps/admin-next/src/
```

#### 代码检查

```bash
# 检查未使用的导入和代码
yarn workspace @lucky/admin-next lint --fix

# 检查依赖版本
yarn workspace @lucky/admin-next outdated
```

### 3. 测试命令

#### 单元测试（Vitest）

```bash
# 运行所有测试
yarn workspace @lucky/admin-next test

# 运行测试并监听变化
yarn workspace @lucky/admin-next test:watch

# 运行测试并生成覆盖率报告
yarn workspace @lucky/admin-next test:coverage

# 运行测试UI界面
yarn workspace @lucky/admin-next test:ui
```

#### 端到端测试（Playwright）

```bash
# 运行所有E2E测试
yarn workspace @lucky/admin-next e2e

# 运行E2E测试并打开UI
yarn workspace @lucky/admin-next e2e:ui

# 运行E2E测试并显示浏览器
yarn workspace @lucky/admin-next e2e:headed

# 查看E2E测试报告
yarn workspace @lucky/admin-next e2e:report
```

#### 项目特定测试

```bash
# 使用项目测试脚本
make test

# 运行特定测试文件
yarn workspace @lucky/admin-next test apps/admin-next/src/components/__tests__/Button.test.tsx
```

### 4. 运行命令

#### 开发运行

```bash
# 开发模式运行（默认端口4001）
yarn workspace @lucky/admin-next dev

# 指定端口运行
yarn workspace @lucky/admin-next dev --port 3000

# 指定主机运行
yarn workspace @lucky/admin-next dev --hostname 0.0.0.0

# 启用Turbo模式
yarn workspace @lucky/admin-next dev --turbo
```

#### 项目特定运行

```bash
# 开发环境运行（使用项目脚本）
make dev

# 生产模式运行（本地测试）
yarn workspace @lucky/admin-next start
```

#### Docker运行

```bash
# 使用Docker Compose启动
docker compose --env-file deploy/.env.dev up -d admin-next

# 查看Docker日志
docker compose --env-file deploy/.env.dev logs --tail=100 admin-next

# 重启服务
docker compose --env-file deploy/.env.dev restart admin-next
```

### 5. 构建命令

#### 开发构建

```bash
# 开发构建
yarn workspace @lucky/admin-next build

# 构建并分析包大小
yarn workspace @lucky/admin-next build:analyze
```

#### 生产构建

```bash
# 生产构建（使用生产环境变量）
NODE_ENV=production yarn workspace @lucky/admin-next build

# 项目特定生产构建
make prod
```

#### 静态导出

```bash
# 静态导出（如果配置了静态导出）
yarn workspace @lucky/admin-next export
```

### 6. 部署命令

#### Cloudflare Workers部署

```bash
# 构建并部署到Cloudflare Workers
yarn workspace @lucky/admin-next opennextjs-cloudflare deploy

# 使用Wrangler部署
yarn workspace @lucky/admin-next wrangler deploy
```

#### 项目特定部署

```bash
# 完整部署流程
yarn deploy:admin

# 仅同步配置文件
yarn deploy:sync

# 快速重启（不重建）
yarn deploy:quick
```

#### 部署验证

```bash
# 健康检查
curl -sS https://admin.joyminis.com

# Smoke Check
curl -sS $CF_ADMIN_HEALTHCHECK_URL
```

### 7. 性能监控命令

#### Lighthouse审计

```bash
# 本地Lighthouse审计
yarn workspace @lucky/admin-next lighthouse:audit

# 严格模式审计
yarn workspace @lucky/admin-next lighthouse:audit:strict

# 生产环境审计
yarn workspace @lucky/admin-next lighthouse:audit:prod
```

#### Sentry监控

```bash
# 上传source maps到Sentry
yarn workspace @lucky/admin-next sentry:sourcemaps

# 验证Sentry配置
yarn workspace @lucky/admin-next sentry:verify
```

### 8. 项目特定命令（Make命令）

#### 开发工作流

```bash
# 完整的开发启动流程
make dev

# 生产构建
make prod

# 代码分析
make analyze

# 运行测试
make test

# 清理项目
make clean
```

#### 平台特定修复

```bash
# 修复Next.js问题
docker rm -f lucky-admin-next-dev
docker volume rm lucky_nest_monorepo_admin_next_nm lucky_nest_monorepo_admin_next_build
docker compose --env-file deploy/.env.dev up -d admin-next
```

#### 工具脚本

```bash
# 生成页面
bash apps/admin-next/create-pages.sh

# 修复导入
python apps/admin-next/fix-pages-import.py
```

### 9. 调试命令

#### 日志和调试

```bash
# 启用详细日志
yarn workspace @lucky/admin-next dev --verbose

# 查看构建日志
yarn workspace @lucky/admin-next build 2>&1 | tee build.log

# 查看Docker日志
docker logs --tail=200 lucky-admin-next-dev
```

#### 性能分析

```bash
# 性能分析运行
yarn workspace @lucky/admin-next dev --profile

# 内存分析
NODE_OPTIONS='--inspect' yarn workspace @lucky/admin-next dev
```

#### 网络调试

```bash
# 检查API连接
curl -sS https://api.joyminis.com/api/v1/health

# 检查WebSocket连接
curl -sS -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Host: api.joyminis.com" -H "Origin: https://admin.joyminis.com" https://api.joyminis.com/socket.io/
```

## 🔄 常用工作流

### 日常开发工作流

```bash
# 1. 开始新的一天
yarn install
yarn workspace @lucky/admin-next check-types
yarn workspace @lucky/admin-next lint
make dev

# 2. 修改代码后
yarn workspace @lucky/admin-next check-types
yarn workspace @lucky/admin-next lint
yarn workspace @lucky/admin-next test

# 3. 提交代码前
make analyze
make test
npx prettier --check apps/admin-next/src/
```

### 问题排查工作流

```bash
# 1. 遇到构建问题
rm -rf apps/admin-next/.next
yarn workspace @lucky/admin-next clean
yarn workspace @lucky/admin-next check-types
yarn workspace @lucky/admin-next build

# 2. 遇到运行时问题
docker compose --env-file deploy/.env.dev logs --tail=200 admin-next
yarn workspace @lucky/admin-next dev --verbose

# 3. 遇到测试问题
yarn workspace @lucky/admin-next test --verbose
yarn workspace @lucky/admin-next e2e:headed
```

### 发布工作流

```bash
# 1. 准备发布
yarn workspace @lucky/admin-next check-types
yarn workspace @lucky/admin-next lint
yarn workspace @lucky/admin-next test
yarn workspace @lucky/admin-next e2e

# 2. 构建发布版本
make prod
# 或
NODE_ENV=production yarn workspace @lucky/admin-next build

# 3. 部署到生产
yarn deploy:admin

# 4. 验证发布
curl -sS https://admin.joyminis.com
yarn workspace @lucky/admin-next lighthouse:audit:prod
```

## ⚠️ 注意事项

### 环境相关

1. **Yarn Workspaces使用**：本项目使用Yarn Workspaces管理

   ```bash
   # 正确：在仓库根目录使用workspace命令
   yarn workspace @lucky/admin-next dev

   # 错误：直接进入子目录执行
   cd apps/admin-next && npm run dev
   ```

2. **环境变量**：
   - 开发环境：`.env.development`
   - 生产环境：`.env.production`
   - 测试环境：`.env.test`
   - 必须使用 `NEXT_PUBLIC_` 前缀公开客户端变量

3. **平台特定**：
   - Cloudflare Workers部署：需要配置 `wrangler.jsonc`
   - Docker开发：使用 `deploy/.env.dev` 环境文件
   - 生产部署：通过GitHub Actions自动部署

### 常见问题解决

#### 问题1：`yarn workspace @lucky/admin-next dev` 失败

```bash
# 解决方案：
rm -rf apps/admin-next/.next apps/admin-next/node_modules/.cache
yarn install
yarn workspace @lucky/admin-next check-types
docker compose --env-file deploy/.env.dev up -d admin-next
```

#### 问题2：构建失败

```bash
# 解决方案：
rm -rf apps/admin-next/.next
yarn workspace @lucky/admin-next clean
yarn workspace @lucky/admin-next check-types
# 检查环境变量配置
# 检查TypeScript错误
```

#### 问题3：Docker容器启动失败

```bash
# 解决方案：
docker compose --env-file deploy/.env.dev down
docker volume rm lucky_nest_monorepo_admin_next_nm lucky_nest_monorepo_admin_next_build
docker compose --env-file deploy/.env.dev up -d admin-next
docker compose --env-file deploy/.env.dev logs --tail=200 admin-next
```

## 📊 命令执行记录规范

### 必须记录的信息：

1. **命令内容**：完整的命令字符串
2. **执行目的**：为什么要执行这个命令
3. **预期结果**：期望命令产生什么效果
4. **实际结果**：命令实际执行的结果
5. **问题记录**：如果命令失败，记录问题和解决方案

### 记录示例：

```
## 命令执行记录

### 命令1：类型检查
**命令**: `yarn workspace @lucky/admin-next check-types`
**目的**: 检查TypeScript类型错误
**预期**: 无类型错误
**实际**: ✅ 成功执行，输出"Found 0 errors."
**问题**: 无

### 命令2：开发服务器启动
**命令**: `yarn workspace @lucky/admin-next dev`
**目的**: 启动Next.js开发服务器
**预期**: 服务器在端口4001启动
**实际**: ✅ 成功执行，输出"Ready on http://localhost:4001"
**问题**: 无
```

## 🔄 文档更新

### 发现新命令时：

1. **测试验证**：先测试命令的有效性
2. **分类归档**：按照分类添加到相应章节
3. **添加说明**：提供详细的说明和示例
4. **更新日期**：更新文档的最后修改日期

### 命令过时时：

1. **标记废弃**：使用⚠️标记过时命令
2. **提供替代**：提供新的替代命令
3. **说明原因**：说明为什么命令过时

---

**最后更新：2026-03-26**
**文档状态：生效中**
**下次检查：2026-04-02**

> **提醒**：本文件是AI协作开发规范的一部分，必须严格遵守。
