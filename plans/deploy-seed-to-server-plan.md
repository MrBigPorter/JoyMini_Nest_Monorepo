# Deploy Blog Category/Tag Seed to Production Server

## Problem

安全的分类标签 seed 脚本 [`seed-blog-categories-tags.ts`](../apps/api/scripts/seed/seed-blog-categories-tags.ts) 已创建，但该文件在本地机器上，需要上传到生产服务器并在线上数据库执行。

## Key Discovery: Production Docker Image 结构

生产环境 API 运行在 Docker 容器 [`lucky-backend-prod`](../compose.prod.yml:30) 中，镜像由 [`Dockerfile.prod`](../Dockerfile.prod) 构建。

查看 [`Dockerfile.prod`](../Dockerfile.prod:196-200) 可知，生产镜像只包含以下内容：
- `apps/api/dist/` — NestJS 编译产物
- `apps/api/prisma/` — Prisma schema/migrations
- `apps/api/node_modules/` — Prisma client
- `packages/shared/` — 共享包
- `entrypoint.sh`

**源代码 `.ts` 文件不在生产镜像中**，所以无法在生产容器内直接运行 `tsx scripts/seed/seed-blog-categories-tags.ts`。

但 [`tsconfig.cli.json`](../apps/api/tsconfig.cli.json:9) 的 `include` 包含 `scripts/seed/**/*.ts`，seed 脚本会被编译到 `dist/cli/`。且 [`Dockerfile.prod`](../Dockerfile.prod:55) 会执行：
```dockerfile
RUN node_modules/.bin/tsc -p apps/api/tsconfig.cli.json
```

所以 seed 脚本的编译产物会存在于生产镜像中。

## Critical Fix Needed: tsconfig.cli.json

[`tsconfig.cli.json`](../apps/api/tsconfig.cli.json) 的 `include` 只包含 `scripts/cli/**/*.ts` 和 `scripts/seed/**/*.ts`，但 seed 脚本依赖 [`scripts/utils/load-env-for-host.ts`](../apps/api/scripts/utils/load-env-for-host.ts)。TypeScript 的 `extends` 机制中 `include` 会**覆盖**而不是合并，所以 `scripts/utils/` 不会被编译。

### 修复

在 [`tsconfig.cli.json`](../apps/api/tsconfig.cli.json) 的 `include` 中添加 `"scripts/utils/**/*.ts"`：

```json
"include": ["scripts/cli/**/*.ts", "scripts/seed/**/*.ts", "scripts/utils/**/*.ts"]
```

> **生产环境中 `loadEnvForHost()` 是 no-op**（因为 Docker 已注入 `DATABASE_URL`），但为了编译不报错，仍需包含此文件。

## Deployment Steps

### Step 1: 修复 tsconfig.cli.json + 提交代码

```bash
git add apps/api/scripts/seed/seed-blog-categories-tags.ts
git add apps/api/package.json
git add apps/api/tsconfig.cli.json
git commit -m "feat(seed): add safe blog categories/tags seed script
- Add idempotent seed-blog-categories-tags.ts (no deleteMany, slug check)
- Update seed:blog script in package.json
- Fix tsconfig.cli.json to include scripts/utils/"
git push origin main
```

### Step 2: CI/CD 自动部署

GitLab CI 检测到 `apps/api/**/*` 变更后触发 [`deploy-backend`](../.gitlab/deploy-backend.yml) 流水线：
1. Build Docker 镜像（含编译后的 seed 脚本）
2. 推送到 GitLab Registry
3. SSH 到 VPS 拉取新镜像
4. 执行 `prisma migrate deploy`
5. 重启 `lucky-backend-prod` 容器
6. 健康检查通过

### Step 3: SSH 到服务器执行 seed

部署成功后，SSH 登录服务器并执行编译后的 seed 脚本：

```bash
# 方式 A：在运行中的容器内执行
docker exec lucky-backend-prod node /app/apps/api/dist/cli/seed/seed-blog-categories-tags.js

# 方式 B：一次性运行（不侵入运行中的容器）
docker run --rm \
  --network lucky_app \
  --env-file /opt/lucky/deploy/.env.prod \
  --entrypoint "" \
  lucky-backend-prod:latest \
  node /app/apps/api/dist/cli/seed/seed-blog-categories-tags.js
```

### Step 4: 验证结果

通过 API 验证：

```bash
# 验证分类
curl https://api.joyminis.com/api/v1/blog/categories | jq '.data | length'
# 预期: 6

# 验证标签  
curl https://api.joyminis.com/api/v1/blog/tags | jq '.data | length'
# 预期: 27

# 验证已有文章不受影响
curl https://api.joyminis.com/api/v1/blog/articles?pageSize=1 | jq '.data.meta.total'
# 应该 > 0（线上已有文章数）
```

## Safety Verification

已确认此 seed 脚本对线上数据安全：

| 安全措施 | 状态 |
|---------|------|
| `deleteMany` 调用 | ❌ 无 — 不删除任何数据 |
| 幂等性（slug 唯一性检测） | ✅ 已实现 — 存在则跳过 |
| 仅操作分类和标签表 | ✅ 不触及 articles/comments 等 |
| 无需修改已有数据 | ✅ upsert/createOrUpdate 都不用 |
| 可重复运行 | ✅ 重复运行无副作用 |

## Alternative: Direct Server SCP

如果不想触发 CI 重新部署，也可以直接复制脚本到服务器，在服务器本地运行：

```bash
# 将脚本 scp 到服务器
scp apps/api/scripts/seed/seed-blog-categories-tags.ts user@server:/tmp/

# SSH 到服务器
ssh user@server

# 在服务器上创建一个临时容器来运行（需要 tsx）
docker run --rm \
  -v /tmp/seed-blog-categories-tags.ts:/tmp/seed.ts \
  --network lucky_app \
  --env-file /opt/lucky/deploy/.env.prod \
  node:20-alpine \
  sh -c "corepack enable && npm install -g tsx && tsx /tmp/seed.ts"
```

但推荐方式仍然是 **push → CI → deploy → exec**，因为这样所有变更都有版本记录。
