# CI/CD 可公用配置分析

## 现有 CI/CD 文件对比

| 文件 | 用途 | 平台 |
|------|------|------|
| `.github/workflows/deploy-admin-cloudflare.yml` | admin-next 部署 | GitHub Actions |
| `.github/workflows/deploy-blog-cloudflare.yml` | frontend-blog 部署 | GitHub Actions |
| `.gitlab/deploy-admin.yml` | admin-next 部署 | GitLab CI |
| `.gitlab/deploy-blog.yml` | frontend-blog 部署 | GitLab CI |

## 可公用的部分

### 1. GitHub Actions — 可提取为 Reusable Workflow

以下步骤在 admin-next 和 frontend-blog 的 workflow 中**完全相同**：

| 步骤 | 说明 |
|------|------|
| Checkout Code | `actions/checkout@v4` |
| Setup Node.js 20 | `actions/setup-node@v4` |
| Enable Corepack | `corepack enable && corepack prepare yarn@4.9.2 --activate` |
| Cache Yarn zip cache | `actions/cache@v4` with `yarn-${{ hashFiles('yarn.lock') }}` |
| Cache node_modules | `actions/cache@v4` with app-specific key |
| Install Dependencies | `yarn install --immutable` |
| Build shared packages | `node packages/shared/scripts/build.js && node packages/ui/scripts/build.js` |
| Validate Cloudflare Secrets | curl verify + error messages (完全一样) |
| Deploy to Cloudflare | `yarn exec opennextjs-cloudflare deploy -c wrangler.jsonc` |
| Create GitHub Deployment Record | curl POST (完全一样) |
| Mark GitHub Deployment Success | curl POST (完全一样) |
| Smoke Check | curl healthcheck URL (逻辑一样，URL 不同) |
| Publish Deployment Summary | echo to GITHUB_STEP_SUMMARY (完全一样) |
| Send Telegram Notification | curl to Telegram API (完全一样) |

**差异点（每个 app 不同）：**
- `working-directory`: `apps/admin-next` vs `apps/frontend-blog` vs `apps/admin-blog`
- Cache key prefix: `nm-admin` vs `nm-blog` vs `nm-admin-blog`
- Turbo cache key prefix: `turbo-admin` vs `turbo-blog`
- Environment variables: 每个 app 需要不同的 env vars
- Worker name / route: 每个 app 不同
- Healthcheck URL: 每个 app 不同
- Quality job commands: `yarn workspace @lucky/admin-next lint` vs `yarn workspace @lucky/frontend-blog lint`
- Telegram URL: `admin.joyminis.com` vs `blog.joyminis.com` vs `admin-blog.joyminis.com`

### 2. GitLab CI — 可提取为 Hidden Job Template

以下步骤完全相同：
- `corepack enable && corepack prepare yarn@4.9.2 --activate`
- `yarn install --immutable`
- `node packages/shared/scripts/build.js && node packages/ui/scripts/build.js`
- Cloudflare token 验证脚本
- Telegram 通知脚本

## 建议方案

### 方案 A：GitHub Actions Reusable Workflow（推荐）

创建 `.github/workflows/deploy-cloudflare-reusable.yml`，用 `workflow_call` 定义通用部署流程。

**输入参数：**

| 参数 | 说明 | 示例 |
|------|------|------|
| `app-name` | 应用目录名 | `admin-next` |
| `workspace-name` | Yarn workspace 名 | `@lucky/admin-next` |
| `cache-prefix` | 缓存 key 前缀 | `admin` |
| `worker-name` | Cloudflare Worker 名 | `lucky-admin-prod` |
| `prod-url` | 生产环境 URL | `https://admin.joyminis.com` |
| `dev-url` | 预览环境 URL | `https://admin-dev.joyminis.com` |
| `healthcheck-url-secret` | Healthcheck URL secret 名 | `CF_ADMIN_HEALTHCHECK_URL` |
| `env-vars` | 构建环境变量（JSON） | `{"NEXT_PUBLIC_API_BASE_URL": "...", ...}` |

**每个 app 的 workflow 变成：**

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
      - ".github/workflows/deploy-admin-cloudflare.yml"

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

### 方案 B：提取公共 Shell 脚本（更简单）

将 Cloudflare 验证和 Telegram 通知提取到 `deploy/` 目录：

- `deploy/cloudflare-validate.sh` — 验证 Cloudflare API token
- `deploy/telegram-notify.sh` — 发送 Telegram 通知

然后在每个 workflow 中 `source` 这些脚本。

### 方案 C：Composite Action（最干净但限制多）

创建 `.github/actions/deploy-cloudflare/action.yml`，但 composite action 对 env vars 和 working-directory 的支持有限。

## 推荐：方案 A + 方案 B 结合

1. **提取公共 shell 脚本**到 `deploy/`（Cloudflare 验证 + Telegram 通知）
2. **创建 reusable workflow** `.github/workflows/deploy-cloudflare-reusable.yml`
3. **每个 app 的 workflow 只保留 quality job + 调用 reusable workflow**
4. **GitLab CI 用 `extends` + hidden job 模板**

这样 admin-next、admin-blog、frontend-blog 三个 app 的 CI/CD 配置可以大幅减少重复代码。

---

## 具体实施步骤

### Step 1: 创建公共 shell 脚本

**`deploy/cloudflare-validate.sh`** — 从现有 workflow 提取 Cloudflare token 验证逻辑

**`deploy/telegram-notify.sh`** — 从现有 workflow 提取 Telegram 通知逻辑

### Step 2: 创建 GitHub Actions Reusable Workflow

**`.github/workflows/deploy-cloudflare-reusable.yml`** — 包含：
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

**`.github/workflows/deploy-admin-blog-cloudflare.yml`** — 调用 reusable workflow

### Step 4: 重构 admin-next 的 workflow

**`.github/workflows/deploy-admin-cloudflare.yml`** — 改为调用 reusable workflow（可选，可以先不改）

### Step 5: 创建 GitLab CI 模板

**`.gitlab/deploy-cloudflare-template.yml`** — hidden job 模板

### Step 6: 创建 admin-blog 的 GitLab CI

**`.gitlab/deploy-admin-blog.yml`** — extends 模板
