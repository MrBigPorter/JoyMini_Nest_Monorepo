# NestJS命令速查表（本项目专用）

> **重要**：执行任何NestJS命令前，必须先查阅本文件。这是AI协作开发规范的一部分。

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

### 2. 代码生成命令

### 3. 数据库命令

### 4. 测试命令

### 5. 运行命令

### 6. 构建命令

### 7. 部署命令

### 8. 调试命令

### 9. 项目特定命令

## 📝 详细命令列表

### 重要提醒：本项目使用Yarn Workspaces管理

**所有命令必须在仓库根目录执行**，使用 `yarn workspace @lucky/api` 前缀，例如：

- ❌ `nest start:dev` → ✅ `yarn workspace @lucky/api start:dev`
- ❌ `prisma migrate dev` → ✅ `yarn workspace @lucky/api prisma migrate dev`
- ❌ `jest test` → ✅ `yarn workspace @lucky/api test`

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
cp apps/api/.env.example apps/api/.env

# 查看当前环境变量
cat apps/api/.env
```

#### 项目清理

```bash
# 清理构建文件
yarn workspace @lucky/api clean

# 清理所有缓存
rm -rf apps/api/dist apps/api/.turbo apps/api/node_modules/.cache
```

### 2. 代码生成命令

#### NestJS CLI命令

```bash
# 生成新模块
yarn workspace @lucky/api generate module users

# 生成新服务
yarn workspace @lucky/api generate service users --no-spec

# 生成新控制器
yarn workspace @lucky/api generate controller users --no-spec

# 生成完整资源（模块+服务+控制器+DTO）
yarn workspace @lucky/api generate resource users --no-spec
```

#### 错误代码生成

```bash
# 生成错误代码
yarn workspace @lucky/api codes:gen

# 构建前自动生成错误代码
yarn workspace @lucky/api prebuild
```

### 3. 数据库命令

#### Prisma Schema管理

```bash
# 格式化Prisma Schema
yarn workspace @lucky/api pr:fmt

# 验证Prisma Schema
yarn workspace @lucky/api pr:val
```

#### 数据库迁移

```bash
# 开发环境迁移（创建并应用）
yarn workspace @lucky/api prisma migrate dev --name <迁移名称>

# 生产环境迁移（仅应用）
yarn workspace @lucky/api prisma migrate deploy

# 重置数据库（开发环境）
yarn workspace @lucky/api prisma migrate reset --force --skip-seed

# 查看迁移状态
yarn workspace @lucky/api prisma migrate status
```

#### Prisma Client生成

```bash
# 生成Prisma Client
yarn workspace @lucky/api prisma generate

# 开发启动前生成Client
yarn workspace @lucky/api prestart:dev
```

#### 数据库工具

```bash
# 打开Prisma Studio（数据库GUI）
yarn workspace @lucky/api prisma studio

# 执行SQL查询
docker exec -it lucky-db-prod psql -U dev -d app
```

### 4. 测试命令

#### 单元测试（Jest）

```bash
# 运行所有测试
yarn workspace @lucky/api test

# 运行测试并监听变化
yarn workspace @lucky/api test:watch

# 运行测试并生成覆盖率报告
yarn workspace @lucky/api test:cov

# 运行特定测试文件
yarn workspace @lucky/api test apps/api/src/users/users.service.spec.ts
```

#### 集成测试

```bash
# 运行集成测试
yarn workspace @lucky/api test --testPathPattern=integration

# 运行E2E测试
yarn workspace @lucky/api test --testPathPattern=e2e
```

### 5. 运行命令

#### 开发运行

```bash
# 开发模式运行（热重载）
yarn workspace @lucky/api start:dev

# 指定端口运行
PORT=4000 yarn workspace @lucky/api start:dev
```

#### 生产运行

```bash
# 构建后运行
yarn workspace @lucky/api build
yarn workspace @lucky/api start

# 直接运行构建后的代码
node apps/api/dist/main.js
```

#### Docker运行

```bash
# 使用Docker Compose启动
docker compose --env-file deploy/.env.dev up -d backend

# 查看Docker日志
docker compose --env-file deploy/.env.dev logs --tail=100 backend

# 重启服务
docker compose --env-file deploy/.env.dev restart backend

# 进入容器
docker exec -it lucky-backend-dev sh
```

### 6. 构建命令

#### 开发构建

```bash
# 开发构建
yarn workspace @lucky/api build

# 清理后构建
yarn workspace @lucky/api clean && yarn workspace @lucky/api build
```

#### CLI工具构建

```bash
# 构建CLI工具
yarn workspace @lucky/api build:cli
```

### 7. 部署命令

#### 生产部署

```bash
# 完整部署流程
yarn deploy:backend

# 仅同步配置文件
yarn deploy:sync

# 快速重启（不重建）
yarn deploy:quick
```

#### 容器部署

```bash
# 构建Docker镜像
docker build -t lucky-api -f apps/api/Dockerfile.dev .

# 运行容器
docker run -p 3001:3001 --env-file apps/api/.env lucky-api
```

#### 部署验证

```bash
# 健康检查
curl -sS https://api.joyminis.com/api/v1/health

# Swagger文档
curl -sS https://api.joyminis.com/docs
```

### 8. 调试命令

#### 日志和调试

```bash
# 启用详细日志
NODE_ENV=development yarn workspace @lucky/api start:dev

# 查看Docker日志
docker logs --tail=200 lucky-backend-dev

# 查看生产日志
ssh root@<VPS_IP> 'docker logs --tail=200 lucky-backend-prod'
```

#### 性能分析

```bash
# 启用Node.js调试
NODE_OPTIONS='--inspect' yarn workspace @lucky/api start:dev

# 内存分析
NODE_ENV=development node --inspect apps/api/dist/main.js
```

#### API调试

```bash
# 测试API端点
curl -sS http://localhost:3001/api/v1/health

# 测试Swagger
curl -sS http://localhost:3001/docs

# 测试数据库连接
curl -sS http://localhost:3001/api/v1/dbcheck
```

### 9. 项目特定命令

#### 数据管理

```bash
# 运行种子数据
yarn workspace @lucky/api seed

# 运行特定种子
yarn workspace @lucky/api seed:treasures

# 创建管理员
yarn workspace @lucky/api create-admin
```

#### 容器内命令

```bash
# 容器内运行Prisma命令
docker exec -it lucky-backend-dev sh -lc "cd /app && yarn workspace @lucky/api prisma migrate dev"

# 容器内运行种子
docker exec -it lucky-backend-dev node /app/apps/api/dist/cli/seed/run-seed.js

# 容器内创建管理员
docker exec -it lucky-backend-dev node /app/apps/api/dist/cli/cli/create-admin.js
```

#### Make命令

```bash
# 开发环境启动
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

## 🔄 常用工作流

### 日常开发工作流

```bash
# 1. 开始新的一天
yarn install
yarn workspace @lucky/api prisma generate
yarn workspace @lucky/api start:dev

# 2. 修改代码后
yarn workspace @lucky/api test
yarn workspace @lucky/api lint

# 3. 提交代码前
make analyze
make test
```

### 数据库变更工作流

```bash
# 1. 修改Prisma Schema
# 编辑 apps/api/prisma/schema.prisma

# 2. 创建迁移
yarn workspace @lucky/api prisma migrate dev --name add_new_field

# 3. 生成Prisma Client
yarn workspace @lucky/api prisma generate

# 4. 重启服务
docker compose --env-file deploy/.env.dev restart backend
```

### 问题排查工作流

```bash
# 1. 遇到构建问题
yarn workspace @lucky/api clean
yarn workspace @lucky/api build
yarn workspace @lucky/api check-types

# 2. 遇到运行时问题
docker compose --env-file deploy/.env.dev logs --tail=200 backend
yarn workspace @lucky/api start:dev

# 3. 遇到数据库问题
yarn workspace @lucky/api prisma migrate status
docker exec -it lucky-db-dev psql -U dev -d app -c "SELECT * FROM _prisma_migrations;"
```

### 发布工作流

```bash
# 1. 准备发布
yarn workspace @lucky/api test
yarn workspace @lucky/api lint
yarn workspace @lucky/api check-types

# 2. 构建发布版本
make prod

# 3. 部署到生产
yarn deploy:backend

# 4. 验证发布
curl -sS https://api.joyminis.com/api/v1/health
ssh root@<VPS_IP> 'docker logs --tail=100 lucky-backend-prod'
```

## ⚠️ 注意事项

### 环境相关

1. **Yarn Workspaces使用**：本项目使用Yarn Workspaces管理

   ```bash
   # 正确：在仓库根目录使用workspace命令
   yarn workspace @lucky/api start:dev

   # 错误：直接进入子目录执行
   cd apps/api && npm run start:dev
   ```

2. **环境变量**：
   - 开发环境：`.env`
   - 生产环境：`deploy/.env.prod`
   - 必须配置 `DATABASE_URL`、`JWT_SECRET` 等关键变量

3. **数据库连接**：
   - 开发环境：本地PostgreSQL或Docker容器
   - 生产环境：VPS上的PostgreSQL容器
   - 迁移必须在正确的环境中执行

### 常见问题解决

#### 问题1：`prisma migrate dev` 失败

```bash
# 解决方案：
# 1. 检查数据库连接
docker ps | grep postgres

# 2. 重置开发数据库
yarn workspace @lucky/api prisma migrate reset --force --skip-seed

# 3. 重新创建迁移
yarn workspace @lucky/api prisma migrate dev --name init
```

#### 问题2：`nest start:dev` 失败

```bash
# 解决方案：
rm -rf apps/api/dist
yarn workspace @lucky/api clean
yarn workspace @lucky/api prestart:dev
yarn workspace @lucky/api start:dev
```

#### 问题3：Docker容器启动失败

```bash
# 解决方案：
docker compose --env-file deploy/.env.dev down
docker volume rm lucky_nest_monorepo_backend_nm
docker compose --env-file deploy/.env.dev up -d backend
docker compose --env-file deploy/.env.dev logs --tail=200 backend
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

### 命令1：生成Prisma Client
**命令**: `yarn workspace @lucky/api prisma generate`
**目的**: 根据schema.prisma生成TypeScript类型
**预期**: 成功生成Prisma Client
**实际**: ✅ 成功执行，输出"Generated Prisma Client"
**问题**: 无

### 命令2：开发服务器启动
**命令**: `yarn workspace @lucky/api start:dev`
**目的**: 启动NestJS开发服务器
**预期**: 服务器在端口3001启动
**实际**: ✅ 成功执行，输出"Nest application successfully started"
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
