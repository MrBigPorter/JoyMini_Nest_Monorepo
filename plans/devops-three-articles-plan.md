# DevOps 系列写作计划 — 3 篇高价值文章

## 概述

响应式用户要求「还是都写把，后面做agent可能用到这些知识」，本计划涵盖 3 篇高价值 DevOps 文章：

1. **Docker Compose 容器化实践** — 基于 `compose.prod.yml` 271 行 + `Dockerfile.prod` 210 行
2. **部署管道全流程** — 基于 `deploy/deploy.sh` 276 行
3. **GitHub Actions CI/CD** — 基于 `.github/workflows/` 8 个 workflow 文件

---

## Article 1: Docker Compose 容器化实践

### 目标文件
`docs/blog/articles/devops/docker-compose-containerization.md`

### 来源文件
- `compose.prod.yml` 271 行 — 5 个服务编排
- `Dockerfile.prod` 210 行 — 三阶段构建
- `apps/admin-next/Dockerfile.prod`
- `redis/redis.conf`
- `deploy/.env.prod`

### 文章结构

#### 1. 背景
- 1GB VPS 面临的内存挑战
- 选择 Docker Compose 而非 Kubernetes 的理由
- Monorepo 多服务架构概述

#### 2. 内存预算设计（核心特色）
- 服务级内存分配表
  ```yaml
  # compose.prod.yml 内存预算
  #   OS + Docker: ~130 MB
  #   Backend:     ≤300 MB
  #   PostgreSQL:  ≤200 MB
  #   Redis:       ≤150 MB (maxmemory 128MB)
  #   Nginx:       ≤30 MB
  #   Swap 兜底:   1 GB
  #   总计:        ~810 MB + 1 GB swap
  ```
- 每个服务的 `deploy.resources.limits.memory` 配置
- Node.js `--max-old-space-size=256` 堆内存限制
- PostgreSQL 低内存调优 `shared_buffers=32MB`

#### Mermaid 图: 内存分配饼图

#### 3. 服务编排详解

##### 3.1 Backend API (`backend`)
- GHCR / 本地镜像切换 (`BACKEND_IMAGE` env var)
- 健康检查 `wget -qO- http://localhost:3000/api/v1/health`
- `depends_on: db/redis condition: service_healthy`
- 日志限制 `max-size: "10m" max-file: "3"`

##### 3.2 Admin 前端 (`admin-next`)
- SSR 模式 (PORT=3001)
- 内部直连 URL `INTERNAL_API_URL=http://lucky-backend-prod:3000/api`
- Server Components 不经过 nginx 公网

##### 3.3 Admin Blog (`admin-blog`)
- 类似 admin-next 结构
- PORT=3002

##### 3.4 Nginx 网关 (`nginx`)
- 配置卷挂载 `nginx.prod.conf` + `whitelist.conf`
- 证书目录 `./certs:/etc/nginx/certs`
- 缓存卷 `nginx_cache:/var/cache/nginx`
- `depends_on: backend/admin-next/admin-blog condition: service_healthy`

##### 3.5 Redis (`redis:7-alpine`)
- 自定义配置 `/etc/redis/redis.conf`
- 密码保护 `--requirepass`
- 健康检查 `redis-cli ping | grep PONG`

##### 3.6 PostgreSQL (`postgres:16-alpine`)
- 低内存参数调优
- 健康检查 `pg_isready`
- 持久化卷 `db_data:/var/lib/postgresql/data`

#### Mermaid 图: 容器依赖图

#### 4. 多阶段 Dockerfile 构建
##### 4.1 Builder 阶段
- Yarn 4 + Corepack
- `yarn workspaces focus @lucky/api` 只装后端依赖
- Prisma generate + tsc build
- CLI 脚本编译

##### 4.2 Pruner 阶段（特色裁剪）
- 删除前端框架 react/react-dom/zustand/tailwindcss...
- 删除构建工具 turbo/esbuild/typescript/eslint...
- 删除 sharp 跨平台二进制 (保留 Alpine musl)
- 删除 Prisma 引擎 (仅 debian 删除，保留 musl)
- 通用清理: *.md/*.map/*.ts/docs/tests

##### 4.3 Production 阶段
- `node:20-alpine` 极简基础镜像
- 仅 openssl + wget 运行时依赖
- Prisma Alpine 引擎兼容处理
- entrypoint.sh 执行迁移 + 启动

#### 5. 网络与卷
- 内部 `app` 网络 (所有服务隔离)
- 3 个 named volume: `db_data`, `redis_data`, `nginx_cache`
- 不需要 `ports` 暴露（nginx 统一暴露 80/443）

#### 6. 运维实践
- 常用命令速查
- 日志查看
- 服务重启
- 镜像更新策略

#### 7. 总结
- 1GB VPS 容器化的关键决策
- 最核心的经验教训

### 标签
`docker`, `docker-compose`, `containerization`, `devops`, `memory-optimization`, `multi-stage-build`

---

## Article 2: 部署管道全流程

### 目标文件
`docs/blog/articles/devops/deployment-pipeline-full-process.md`

### 来源文件
- `deploy/deploy.sh` 276 行
- `deploy/.env.prod`

### 文章结构

#### 1. 背景
- 为什么不在 VPS 上构建？(1GB OOM 风险)
- 本地构建 + 远程传输策略
- Monorepo 多镜像场景

#### 2. 部署脚本架构

##### 2.1 五种模式
| 模式 | 命令 | 行为 |
|------|------|------|
| 全量部署 | `deploy.sh` | 构建后端+前端 → 传输 → 启动 |
| 仅后端 | `deploy.sh --backend` | 仅构建部署后端 |
| 仅前端 | `deploy.sh --admin` | 仅构建部署前端 |
| 快速重启 | `deploy.sh --quick` | 跳过构建，仅重启服务 |
| 配置同步 | `deploy.sh --sync` | 仅同步配置文件 |

#### 3. 阶段一：配置同步
- SSH 连通性预检
- `scp` 同步 compose/prod.yml, nginx 配置, redis 配置, 部署脚本
- 目录结构 `mkdir -p /opt/lucky/{certs,nginx/html,redis,deploy}`

#### 4. 阶段二：本地 Docker 构建
- `docker build --platform linux/amd64` 指定目标架构
- 后端: `Dockerfile.prod` (项目根)
- 前端: `apps/admin-next/Dockerfile.prod`
- 构建元数据注入: `DEPLOYED_AT`, `GIT_SHA`
- Git commit SHA 用于 Build Info 页面

#### 5. 阶段三：镜像传输
- `docker save $IMAGES | gzip | ssh $TARGET "gunzip | docker load"`
- 管道压缩传输，大幅减少传输量
- 选择性传输（仅构建的镜像）

#### 6. 阶段四：远程部署脚本

##### 6.1 数据库迁移（临时容器）
- `docker run --rm --network $NETWORK --entrypoint "" $IMAGE prisma migrate deploy`
- 临时容器架构：不影响正在运行的后端
- P3005 错误处理（baseline-db.sh 提示）

##### 6.2 服务启动
- `docker compose up -d --no-build --force-recreate`
- 环境变量传镜像 Tag

##### 6.3 健康检查与自动回滚
```bash
for i in $(seq 1 30); do
  if docker exec lucky-backend-prod wget -qO- http://localhost:3000/api/v1/health >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 3
done
```
- 90 秒超时，30 次重试
- 失败时回滚到旧镜像 (`PREV_IMAGE_SHA`)
- `docker logs --tail=50` 输出错误日志

##### 6.4 Nginx 配置热重载
- `docker exec lucky-nginx-prod nginx -t` 校验
- `nginx -s reload` 无需重启容器

##### 6.5 清理与报告
- `docker image prune -f` 清理旧镜像
- `free -h`, `df -h` 系统资源报告
- 部署验证命令输出

#### Mermaid 图: 部署全流程时序图

#### 7. 错误处理矩阵
| 错误场景 | 检测方式 | 处理策略 |
|----------|----------|----------|
| SSH 连接失败 | ConnectTimeout=5 | 脚本立即退出 |
| 构建失败 | docker build exit code | set -e 自动中断 |
| 传输失败 | pipe exit code | 可重试 |
| 迁移 P3005 | grep P3005 | 提示 baseline 操作 |
| 健康检查超时 | 30 次循环 | 自动回滚旧镜像 |
| Nginx 语法错误 | nginx -t | 保留旧配置，不重启 |

#### 8. 与 CI/CD 的集成点
- 本地脚本与 GHCR 工作流的互补关系
- CI 使用 GHCR 拉取 vs 本地构建传输
- 相同的健康检查 + 回滚逻辑在 CI 和本地脚本中保持一致

#### 9. 总结
- 核心设计原则
- 从 nginx 文章到部署管道的完整 DevOps 视图

### 标签
`deployment`, `devops`, `shell-script`, `docker`, `ssh`, `rollback`, `health-check`

---

## Article 3: GitHub Actions CI/CD

### 目标文件
`docs/blog/articles/devops/github-actions-ci-cd.md`

### 来源文件
- `.github/workflows/ci.yml` — 298 行
- `.github/workflows/deploy-backend.yml` — 387 行
- `.github/workflows/deploy-master.yml` — 70 行
- `.github/workflows/deploy-admin-cloudflare.yml` — 368 行
- `.github/workflows/deploy-blog-cloudflare.yml` — 389 行
- `.github/workflows/deploy-admin-blog-cloudflare.yml` — 373 行
- `.github/workflows/lighthouse-ci.yml` — 146 行
- `.github/workflows/playwright.yml` — 270 行

### 文章结构

#### 1. 背景
- Monorepo 多目标部署的需求
- 双管道架构：VPS 后端 + Cloudflare 前端
- GitHub Actions 作为统一 CI/CD 平台

#### 2. 整体架构

##### 2.1 工作流全景
| 工作流 | 触发 | 目标 | 职责 |
|--------|------|------|------|
| CI | push/PR main | 代码质量 | Lint + 类型检查 + 单测 + E2E |
| Deploy Backend | push main/test + path filter | VPS | Docker build → GHCR → SSH 部署 |
| Deploy Admin CF | push main/test + path filter | Cloudflare Workers | opennext 构建 → CF Workers 部署 |
| Deploy Blog CF | push main/test + path filter | Cloudflare Pages | opennext 构建 → CF Pages 部署 |
| Deploy Admin Blog CF | push main/test + path filter | Cloudflare Workers | opennext 构建 → CF Workers 部署 |
| Deploy Master | workflow_dispatch | Orchestrator | 调用 backend + admin CF 工作流 |
| Lighthouse CI | 部署成功后触发 | 性能 | LHCI 性能审计 |
| Playwright E2E | push main | E2E 测试 | 独立 Playwright 运行 |

#### Mermaid 图: CI/CD 管道架构图

#### 3. CI 质量门禁 (`ci.yml`)
##### 3.1 并发控制
- `concurrency.group: ci-${{ github.ref }}`
- `cancel-in-progress: true` — 同一 PR 新提交取消旧运行

##### 3.2 三级缓存策略
- Yarn zip 缓存
- node_modules 缓存 (`hashFiles('yarn.lock')`)
- Turbo 远程缓存

##### 3.3 硬门禁步骤
1. Yarn install --immutable
2. Prisma generate
3. Build internal packages (shared + ui)
4. Lint (跳过 API 的 TypeScript-checked ESLint)
5. Type Check (`turbo run check-types`)
6. admin-next unit test
7. frontend-blog build
8. admin-blog build

##### 3.4 软门禁步骤
- 其他包测试 (`continue-on-error: true`)
- Playwright E2E (`continue-on-error: true`)

##### 3.5 E2E 作业
- Secret 门控 `E2E_ADMIN_PASSWORD`
- Mock API server (Node.js http)
- Playwright Chromium
- 报告上传到 Artifacts

#### 4. 后端部署 (`deploy-backend.yml`)
##### 4.1 触发条件
- Path filter: `apps/api/**`, `packages/shared/**`, `Dockerfile.prod`, `compose.prod.yml`, `nginx/*.conf`
- `workflow_dispatch` 手动触发
- `workflow_call` 可复用

##### 4.2 阶段零: 质量检查
- Lint + Type Check
- 独立于 `ci.yml`，保证部署前再次验证

##### 4.3 阶段一: Docker 构建 + GHCR 推送
- Docker Buildx + BuildKit
- `docker/metadata-action` 自动生成标签 (sha + latest)
- `docker/build-push-action` 推送到 `ghcr.io/mrbigporter/lucky-backend-prod`
- GHA layer 缓存 (`cache-from: type=gha`)

##### 4.4 阶段二: SSH 部署
- SSH 预检连通性 (3 次重试)
- `appleboy/scp-action` 同步脚本 + nginx 配置
- 重试机制 (网络抖动容错)
- `appleboy/ssh-action` 执行远程部署:
  - Login GHCR
  - Pull image
  - DB migration (临时容器)
  - 保存旧镜像 SHA
  - 重启服务
  - 健康检查 + 自动回滚
  - 清理旧镜像
  - Nginx 热重载

##### 4.5 阶段三: Telegram 通知
- 无论成功失败都通知
- 包含状态、环境、Commit、API Health URL

#### 5. 前端部署 (Cloudflare 三条工作流)
##### 5.1 共同模式
- quality + deploy 双 job
- 环境区分: main→production, test→preview
- `opennextjs-cloudflare build`
- Cloudflare API Token 验证
- GitHub Deployments API 集成
- Smoke check
- Telegram 通知

##### 5.2 Admin Next (Workers)
- Next.js SSR → opennext → CF Workers
- `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WS_URL`
- reCAPTCHA site key
- Sentry DSN

##### 5.3 Blog (Pages)
- `INTERNAL_API_URL` 优先于 `NEXT_PUBLIC_API_BASE_URL`
- 四级缓存（额外 Next.js `.next/cache`）
- `copy-manifests.sh` + `patch-worker-queue.mjs` 后处理
- CF Pages deploy (不同于 Workers)

##### 5.4 Admin Blog (Workers)
- 类似 Admin CF 结构
- Sentry DSN 不同

#### 6. 主控工作流 (`deploy-master.yml`)
##### 6.1 手动触发
- Workflow Dispatch 带参数
- 可选 deploy_admin_cloudflare / deploy_api

##### 6.2 可复用工作流
- `uses: ./.github/workflows/deploy-admin-cloudflare.yml`
- `uses: ./.github/workflows/deploy-backend.yml`
- `secrets: inherit` 继承密钥

##### 6.3 Preflight 摘要
- 部署意图追踪
- 提交 SHA / 触发者 / 分支

#### 7. 性能审计 (`lighthouse-ci.yml`)
##### 7.1 触发
- 手动触发
- Admin CF 部署成功后自动触发

##### 7.2 流程
- 生产 API 登录拿 Token
- LHCI autorun (Chrome)
- 结果上传到 Artifacts
- 性能报告写入 GitHub Step Summary

#### 8. 独立 E2E (`playwright.yml`)
##### 8.1 与 ci.yml 的分工
- ci.yml: 轻量 E2E smoke
- playwright.yml: 完整 E2E 套件

##### 8.2 失败分析
- 截图上传
- Trace 上传
- HTML 报告上传

#### 9. 密钥管理
| Secret | 用途 | 来源 |
|--------|------|------|
| SSH_HOST / SSH_PORT / SSH_USERNAME / SSH_PRIVATE_KEY | VPS SSH | Repository Secrets |
| VPS_GHCR_PAT | VPS 拉取 GHCR | Environment Secrets |
| CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID | CF 部署 | Environment Secrets |
| TELEGRAM_TOKEN / TELEGRAM_CHAT_ID | 通知 | Environment Secrets |
| NEXT_PUBLIC_API_BASE_URL / WS_URL | 前端构建 | Environment Secrets |
| E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD | E2E 测试 | Repository Secrets |
| LIGHTHOUSE_ADMIN_USERNAME / PASSWORD | LHCI | Repository Secrets |
| NEXT_PUBLIC_RECAPTCHA_SITE_KEY | reCAPTCHA | Environment Secrets |
| SENTRY_AUTH_TOKEN / SENTRY_DSN | Sentry | Environment Secrets |

#### 10. 模式总结
##### 10.1 环境条件模式
```yaml
environment: ${{ github.ref_name == 'main' && 'production' || 'preview' }}
```

##### 10.2 路径过滤模式
```yaml
on:
  push:
    branches: [main, test]
    paths:
      - "apps/api/**"
```

##### 10.3 双管道模式
- 后端: GHCR → VPS Docker (胖容器)
- 前端: opennext → Cloudflare Workers/Pages (无服务器)

##### 10.4 通知模式
- `if: always()` 确保无论成功失败都通知
- Telegram Markdown 格式
- 环境 URL 链接

#### 11. 与本地部署脚本的对比
| 维度 | CI/CD (GitHub Actions) | 本地脚本 (deploy.sh) |
|------|------------------------|---------------------|
| 构建环境 | GitHub Runner | 本地 Mac |
| 镜像存储 | GHCR | 本地 Docker |
| 传输方式 | docker pull | docker save \| gzip \| ssh \| docker load |
| 触发方式 | push / workflow_dispatch | 手动执行 |
| 通知 | Telegram | 终端输出 |
| 回滚 | 内置自动回滚 | 内置自动回滚 |

#### 12. 总结
- Monorepo CI/CD 设计原则
- 关键决策: 为什么后端 VPS Docker 而前端 Cloudflare
- 可复用工作流模式的价值

### 标签
`github-actions`, `ci-cd`, `devops`, `monorepo`, `cloudflare`, `docker`, `automation`

---

## 共用的写作规范

- 遵循 `ARTICLE_AUTHORING_STANDARD.md` v2.0.0
- YAML frontmatter 含 title, description, slug, tags, date
- 代码注释使用英文，文章正文使用中文
- 每个主要章节用 `##` 编号 (`## 1. 背景`, `## N. 总结`)
- Mermaid 图中不使用引号和括号以免解析错误
- 代码块标注语言 (`yaml`, `bash`, `typescript`)
- 每个文章末尾包含 `### 相关文章` 链接到 nginx 文章和其他 DevOps 文章

---

## 执行顺序

1. **Article 1** (Docker Compose) → 最基础，与 nginx 文章有直接关联
2. **Article 2** (部署管道) → 建立在 Docker Compose 基础上
3. **Article 3** (GitHub Actions) → 最复杂，8 个 workflow 文件

## 更新进度文件

完成后更新 `plans/writing-progress-analysis.md`，在 DevOps 系列中新增 3 个条目。
