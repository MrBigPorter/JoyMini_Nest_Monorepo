---
tags:
  - CI/CD
  - GitHub Actions
  - GitLab CI
  - DevOps
  - Monorepo
  - Yarn
  - Cloudflare
  - Automation
---

# CI/CD 可复用工作流模式：Monorepo 多应用部署的 DRY 实践

> 基于 JoyMini Monorepo 的真实 CI/CD 重构经验，深入分析如何在 GitHub Actions 和 GitLab CI 中消除多应用部署流水线的重复代码，实现"一次定义，多处复用"。

---

## 目录

1. [背景与问题](#1-背景与问题)
2. [现有 CI/CD 文件分析](#2-现有-cicd-文件分析)
3. [可复用部分识别](#3-可复用部分识别)
4. [方案对比](#4-方案对比)
5. [推荐方案：Reusable Workflow + Shell 脚本](#5-推荐方案reusable-workflow--shell-脚本)
6. [具体实施步骤](#6-具体实施步骤)
7. [GitLab CI 模板方案](#7-gitlab-ci-模板方案)
8. [总结](#8-总结)

---

## 1. 背景与问题

### 1.1 现状

JoyMini Monorepo 有 **3 个前端应用**需要部署到 Cloudflare Workers：

| 应用 | 目录 | 平台 |
|------|------|------|
| Admin 管理后台 | `apps/admin-next` | GitHub Actions + GitLab CI |
| Blog 博客前端 | `apps/frontend-blog` | GitHub Actions + GitLab CI |
| Admin Blog | `apps/admin-blog` | GitHub Actions + GitLab CI |

当前有 **4 个 CI/CD 配置文件**：

| 文件 | 用途 | 行数 |
|------|------|------|
| [`.github/workflows/deploy-admin-cloudflare.yml`](.github/workflows/deploy-admin-cloudflare.yml) | admin-next 部署 | ~368 |
| [`.github/workflows/deploy-blog-cloudflare.yml`](.github/workflows/deploy-blog-cloudflare.yml) | frontend-blog 部署 | ~389 |
| `.gitlab/deploy-admin.yml` | admin-next 部署 | ~200 |
| `.gitlab/deploy-blog.yml` | frontend-blog 部署 | ~200 |

### 1.2 问题

这些配置文件之间存在 **大量重复代码**：

- **Setup 步骤**（Checkout、Node.js、Corepack）— 3 个文件完全一样
- **缓存策略**（Yarn cache、node_modules、Turbo）— 逻辑相同，仅 key 前缀不同
- **依赖安装**（`yarn install --immutable`）— 完全一样
- **共享包构建**（`packages/shared` + `packages/ui`）— 完全一样
- **Cloudflare 验证**（API token、Account ID 检查）— 完全一样
- **Telegram 通知**（部署成功/失败通知）— 完全一样
- **GitHub Deployment 记录**（创建/更新 deployment）— 完全一样

**差异点**只有：

- `working-directory`：`apps/admin-next` vs `apps/frontend-blog`
- 缓存 key 前缀：`nm-admin` vs `nm-blog`
- 环境变量：每个应用需要不同的 env vars
- Worker 名称/路由：每个应用不同
- Healthcheck URL：每个应用不同
- Quality job 命令：`yarn workspace @lucky/admin-next lint` vs `@lucky/frontend-blog`

**估算重复率**：约 **70-80%** 的代码是重复的。

---

## 2. 现有 CI/CD 文件分析

### 2.1 GitHub Actions 通用步骤

以下步骤在 admin-next 和 frontend-blog 的 workflow 中**完全相同**：

| 步骤 | Action/命令 | 说明 |
|------|------------|------|
| Checkout Code | `actions/checkout@v4` | 检出代码 |
| Setup Node.js 20 | `actions/setup-node@v4` | 设置 Node 运行时 |
| Enable Corepack | `corepack enable && corepack prepare yarn@4.9.2 --activate` | 启用 Yarn 4 |
| Cache Yarn zip cache | `actions/cache@v4` with `yarn-${{ hashFiles('yarn.lock') }}` | 缓存 Yarn 包 |
| Cache node_modules | `actions/cache@v4` with app-specific key | 缓存 node_modules |
| Install Dependencies | `yarn install --immutable` | 安装依赖 |
| Build shared packages | `node packages/shared/scripts/build.js && node packages/ui/scripts/build.js` | 构建共享包 |
| Validate Cloudflare Secrets | curl verify + error messages | 验证 CF 凭据 |
| Deploy to Cloudflare | `yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc` | 部署 |
| Create GitHub Deployment | curl POST | 创建部署记录 |
| Mark Deployment Success | curl POST | 标记部署成功 |
| Smoke Check | curl healthcheck URL | 健康检查 |
| Publish Summary | echo to GITHUB_STEP_SUMMARY | 发布摘要 |
| Telegram Notification | curl to Telegram API | 发送通知 |

### 2.2 差异点

| 差异项 | admin-next | frontend-blog |
|--------|-----------|---------------|
| `working-directory` | `apps/admin-next` | `apps/frontend-blog` |
| Cache key prefix | `nm-admin` | `nm-blog` |
| Turbo cache prefix | `turbo-admin` | `turbo-blog` |
| Quality commands | `yarn workspace @lucky/admin-next lint` | `yarn workspace @lucky/frontend-blog lint` |
| Worker name | `lucky-admin-prod` | `lucky-blog-prod` |
| Healthcheck URL | `https://admin.joyminis.com` | `https://blog.joyminis.com` |
| Telegram URL | `admin.joyminis.com` | `blog.joyminis.com` |

---

## 3. 可复用部分识别

### 3.1 可提取为 Reusable Workflow 的部分

**Setup 阶段**（约 50 行）：
```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: corepack enable && corepack prepare yarn@4.9.2 --activate
```

**缓存策略**（约 40 行）：
```yaml
- uses: actions/cache@v4
  with:
    path: .yarn/cache
    key: yarn-${{ hashFiles('yarn.lock') }}
    restore-keys: yarn-
```

**构建与部署**（约 60 行）：
```yaml
- run: yarn install --immutable
- run: node packages/shared/scripts/build.js && node packages/ui/scripts/build.js
- run: yarn exec opennextjs-cloudflare build
- run: yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc
```

**通知与记录**（约 50 行）：
```yaml
- run: curl -X POST ... # GitHub Deployment
- run: curl ... # Telegram notification
- run: echo ... # Summary
```

### 3.2 可提取为公共 Shell 脚本的部分

Cloudflare 凭据验证和 Telegram 通知可以提取为独立脚本，放在 [`deploy/`](deploy/) 目录下：

- `deploy/cloudflare-validate.sh` — 验证 Cloudflare API token 和 Account ID
- `deploy/telegram-notify.sh` — 发送部署成功/失败通知到 Telegram

---

## 4. 方案对比

### 方案 A：GitHub Actions Reusable Workflow（推荐）

创建 `.github/workflows/deploy-cloudflare-reusable.yml`，使用 `workflow_call` 定义通用部署流程。

**输入参数设计**：

| 参数 | 说明 | 示例 |
|------|------|------|
| `app-name` | 应用目录名 | `admin-next` |
| `workspace-name` | Yarn workspace 名 | `@lucky/admin-next` |
| `cache-prefix` | 缓存 key 前缀 | `admin` |
| `worker-name` | Cloudflare Worker 名 | `lucky-admin-prod` |
| `prod-url` | 生产环境 URL | `https://admin.joyminis.com` |
| `dev-url` | 预览环境 URL | `https://admin-dev.joyminis.com` |
| `healthcheck-url-secret` | Healthcheck URL secret 名 | `CF_ADMIN_HEALTHCHECK_URL` |
| `env-vars` | 构建环境变量（JSON） | `{"NEXT_PUBLIC_API_BASE_URL": "..."}` |

**调用方 workflow 简化后**：

```yaml
# .github/workflows/deploy-admin-cloudflare.yml
name: Deploy Admin (Cloudflare)
on:
  push:
    branches: [main, test]
    paths:
      - "apps/admin-next/**"
      - "packages/shared/**"
      - "packages/ui/**"

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: corepack enable && corepack prepare yarn@4.9.2 --activate
      - uses: actions/cache@v4  # yarn cache
      - uses: actions/cache@v4  # node_modules
      - run: yarn install --immutable
      - run: node packages/shared/scripts/build.js && node packages/ui/scripts/build.js
      - run: yarn workspace @lucky/admin-next lint
      - run: yarn workspace @lucky/admin-next check-types
      - run: yarn workspace @lucky/admin-next test

  deploy:
    needs: quality
    uses: ./.github/workflows/deploy-cloudflare-reusable.yml
    with:
      app-name: "admin-next"
      workspace-name: "@lucky/admin-next"
      cache-prefix: "admin"
      worker-name: "lucky-admin-prod"
      prod-url: "https://admin.joyminis.com"
      dev-url: "https://admin-dev.joyminis.com"
      healthcheck-url-secret: "CF_ADMIN_HEALTHCHECK_URL"
    secrets: inherit
```

**优势**：
- 消除 70-80% 重复代码
- 统一部署逻辑，修改一处即可影响所有应用
- 新应用接入只需新增一个 30 行的 workflow 文件

**劣势**：
- Reusable workflow 不支持 `working-directory` 动态设置（需用 `defaults.run.working-directory`）
- 环境变量传递较复杂（需用 JSON 序列化）

### 方案 B：提取公共 Shell 脚本（更简单）

将 Cloudflare 验证和 Telegram 通知提取到 `deploy/` 目录，然后在每个 workflow 中 `source` 这些脚本。

```bash
# deploy/cloudflare-validate.sh
#!/bin/bash
set -euo pipefail
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "::error::CLOUDFLARE_API_TOKEN is not set"
  exit 1
fi
# ... 更多验证逻辑
```

```yaml
# 在 workflow 中使用
- name: Validate Cloudflare Secrets
  run: source deploy/cloudflare-validate.sh
```

**优势**：实现简单，不依赖 GitHub Actions 特性，GitLab CI 也能复用
**劣势**：只能消除脚本级别的重复，workflow 结构重复仍需手动维护

### 方案 C：Composite Action（最干净但限制多）

创建 `.github/actions/deploy-cloudflare/action.yml`，将整个部署流程封装为一个自定义 Action。

**优势**：封装最彻底，调用方只需一个 step
**劣势**：
- Composite action 对 `env` 和 `working-directory` 的支持有限
- 不支持 `secrets` 直接传递
- 调试困难

### 方案对比总结

| 维度 | 方案 A (Reusable Workflow) | 方案 B (Shell 脚本) | 方案 C (Composite Action) |
|------|---------------------------|-------------------|--------------------------|
| 重复消除率 | 70-80% | 30-40% | 80-90% |
| 实现复杂度 | 中 | 低 | 高 |
| 维护成本 | 低 | 中 | 低 |
| 调试难度 | 中 | 低 | 高 |
| GitLab 兼容 | 否 | 是 | 否 |
| 新应用接入成本 | 低（30 行） | 中（100 行） | 最低（10 行） |

---

## 5. 推荐方案：Reusable Workflow + Shell 脚本

**推荐方案 A + B 结合**，取各自优势：

### 5.1 架构设计

```
.github/workflows/
├── deploy-cloudflare-reusable.yml   # Reusable workflow (通用部署逻辑)
├── deploy-admin-cloudflare.yml      # admin-next 调用方 (仅 quality + 参数)
├── deploy-blog-cloudflare.yml       # frontend-blog 调用方
└── deploy-admin-blog-cloudflare.yml # admin-blog 调用方 (新增)

deploy/
├── cloudflare-validate.sh           # Cloudflare 凭据验证脚本
└── telegram-notify.sh               # Telegram 通知脚本
```

### 5.2 Reusable Workflow 核心逻辑

```yaml
# .github/workflows/deploy-cloudflare-reusable.yml
name: Deploy Cloudflare (Reusable)

on:
  workflow_call:
    inputs:
      app-name:
        required: true
        type: string
      workspace-name:
        required: true
        type: string
      cache-prefix:
        required: true
        type: string
      worker-name:
        required: true
        type: string
      prod-url:
        required: true
        type: string
      dev-url:
        required: true
        type: string
      healthcheck-url-secret:
        required: true
        type: string
    secrets:
      CLOUDFLARE_API_TOKEN:
        required: true
      CLOUDFLARE_ACCOUNT_ID:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/${{ inputs.app-name }}

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: corepack enable && corepack prepare yarn@4.9.2 --activate

      # 缓存
      - uses: actions/cache@v4
        with:
          path: .yarn/cache
          key: yarn-${{ hashFiles('yarn.lock') }}
      - uses: actions/cache@v4
        id: nm-cache
        with:
          path: node_modules
          key: nm-${{ inputs.cache-prefix }}-${{ runner.os }}-${{ hashFiles('yarn.lock') }}

      # 安装 + 构建
      - run: yarn install --immutable
      - run: node packages/shared/scripts/build.js && node packages/ui/scripts/build.js

      # 构建 + 部署
      - run: yarn exec opennextjs-cloudflare build
      - run: yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc

      # 验证 + 通知
      - run: source deploy/cloudflare-validate.sh
      - run: source deploy/telegram-notify.sh
```

### 5.3 调用方示例

```yaml
# .github/workflows/deploy-admin-cloudflare.yml
name: Deploy Admin (Cloudflare)
on:
  push:
    branches: [main, test]
    paths:
      - "apps/admin-next/**"
      - "packages/shared/**"
      - "packages/ui/**"

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: corepack enable && corepack prepare yarn@4.9.2 --activate
      - run: yarn install --immutable
      - run: node packages/shared/scripts/build.js && node packages/ui/scripts/build.js
      - run: |
          yarn workspace @lucky/admin-next lint
          yarn workspace @lucky/admin-next check-types
          yarn workspace @lucky/admin-next test

  deploy:
    needs: quality
    uses: ./.github/workflows/deploy-cloudflare-reusable.yml
    with:
      app-name: "admin-next"
      workspace-name: "@lucky/admin-next"
      cache-prefix: "admin"
      worker-name: "lucky-admin-prod"
      prod-url: "https://admin.joyminis.com"
      dev-url: "https://admin-dev.joyminis.com"
      healthcheck-url-secret: "CF_ADMIN_HEALTHCHECK_URL"
    secrets: inherit
```

---

## 6. 具体实施步骤

### Step 1: 创建公共 Shell 脚本

**`deploy/cloudflare-validate.sh`** — 从现有 workflow 提取 Cloudflare token 验证逻辑：

```bash
#!/bin/bash
set -euo pipefail

validate_cloudflare_secrets() {
  local env_name="${1:-unknown}"

  if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "::error::CLOUDFLARE_API_TOKEN is not set for environment '$env_name'"
    exit 1
  fi
  if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo "::error::CLOUDFLARE_ACCOUNT_ID is not set"
    exit 1
  fi

  # Verify token validity via Cloudflare API
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID")

  if [ "$response" != "200" ]; then
    echo "::error::Cloudflare API token validation failed (HTTP $response)"
    exit 1
  fi

  echo "✅ Cloudflare secrets validated for '$env_name'"
}
```

**`deploy/telegram-notify.sh`** — 从现有 workflow 提取 Telegram 通知逻辑：

```bash
#!/bin/bash
set -euo pipefail

send_telegram_notification() {
  local status="$1"  # "success" or "failure"
  local app_name="$2"
  local env_name="$3"
  local deploy_url="$4"

  local message
  if [ "$status" = "success" ]; then
    message="✅ *$app_name* deployed successfully to *$env_name*%0A🌐 $deploy_url"
  else
    message="❌ *$app_name* deployment failed on *$env_name*"
  fi

  curl -s -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${message}" \
    -d "parse_mode=Markdown" > /dev/null
}
```

### Step 2: 创建 GitHub Actions Reusable Workflow

创建 [`.github/workflows/deploy-cloudflare-reusable.yml`](.github/workflows/) 包含：

- Setup + Cache + Install
- Build shared packages
- Prepare build metadata
- opennextjs-cloudflare build
- Validate Cloudflare secrets
- Deploy
- Create GitHub Deployment
- Smoke check
- Publish summary
- Telegram notification

### Step 3: 创建 admin-blog 的 workflow

新增 [`.github/workflows/deploy-admin-blog-cloudflare.yml`](.github/workflows/) — 调用 reusable workflow，仅需约 30 行。

### Step 4: 重构现有 workflow

将 admin-next 和 frontend-blog 的 workflow 改为调用 reusable workflow，保留 quality job。

### Step 5: 创建 GitLab CI 模板

参见下一节。

---

## 7. GitLab CI 模板方案

### 7.1 Hidden Job 模板

GitLab CI 使用 `extends` + hidden job 实现复用：

```yaml
# .gitlab/deploy-cloudflare-template.yml
.deploy-cloudflare: &deploy-cloudflare
  image: node:20
  before_script:
    - corepack enable && corepack prepare yarn@4.9.2 --activate
    - yarn install --immutable
    - node packages/shared/scripts/build.js
    - node packages/ui/scripts/build.js
  script:
    - yarn exec opennextjs-cloudflare build
    - yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc
  after_script:
    - source deploy/telegram-notify.sh
```

### 7.2 调用方示例

```yaml
# .gitlab/deploy-admin.yml
include:
  - local: .gitlab/deploy-cloudflare-template.yml

deploy-admin:
  extends: .deploy-cloudflare
  variables:
    APP_NAME: "admin-next"
    WORKSPACE_NAME: "@lucky/admin-next"
  environment:
    name: production
    url: https://admin.joyminis.com
  only:
    - main
```

---

## 8. 总结

### 8.1 关键收获

1. **Monorepo 的 CI/CD 天然适合抽象复用**：多个应用共享相同的技术栈（Node.js、Yarn、Cloudflare），部署流程高度相似。

2. **Reusable Workflow + Shell 脚本是最佳组合**：Reusable workflow 消除 workflow 级别的重复，Shell 脚本消除命令级别的重复，两者互补。

3. **参数化设计是关键**：将差异点（app-name、cache-prefix、env-vars）提取为参数，调用方只需传入参数即可。

4. **GitLab CI 的 `extends` 同样强大**：虽然不是完全等价于 GitHub Actions 的 `workflow_call`，但 hidden job + extends 模式也能达到类似的复用效果。

### 8.2 预期效果

| 指标 | 重构前 | 重构后 | 改善 |
|------|--------|--------|------|
| 每个 workflow 行数 | ~370 行 | ~30 行 (调用方) + ~200 行 (reusable) | 92% |
| 总 CI/CD 代码量 | ~1200 行 (4 个文件) | ~500 行 (1 reusable + 3 调用方 + 2 脚本) | 58% |
| 新应用接入成本 | 复制粘贴 370 行 | 编写 30 行调用方 | 92% |
| 部署逻辑修改 | 修改 4 个文件 | 修改 1 个文件 | 75% |

### 8.3 与现有文档的关系

本文聚焦于 CI/CD 配置的 **可复用模式设计**，与以下文档互补：

- [`ssg-ssr-isr-cloudflare-complete-guide.md`](docs/blog/articles/devops/ssg-ssr-isr-cloudflare-complete-guide.md) — Cloudflare Workers 配置全面指南
- [`cloudflare-workers-cpu-limit-deep-dive.md`](docs/blog/articles/devops/cloudflare-workers-cpu-limit-deep-dive.md) — Workers CPU 性能优化

---

> **相关文件**：[`ci-cd-reusable-config.md`](plans/ci-cd-reusable-config.md) — 原始分析与实施计划
