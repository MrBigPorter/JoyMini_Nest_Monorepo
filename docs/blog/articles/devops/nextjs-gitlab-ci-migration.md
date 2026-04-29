---
tags:
  - CI/CD
  - DevOps
  - Docker
  - Cloudflare
  - GitLab
---

# GitHub Actions 到 GitLab CI：Monorepo 双线部署实战

## 1. 背景：为什么需要双线 CI？

### 1.1 迁移动机

年初我们决定将 Monorepo 从 GitHub 迁移到 GitLab，核心原因是：

1. **自建 Runner 成本控制**：GitLab 的 Runner 可以部署在自有 VPS 上，长期成本更低
2. **容器镜像仓库整合**：GitLab 内置 Container Registry，不需要额外维护 Docker Hub 或 GHCR
3. **合规要求**：部分客户要求代码托管在境内或 EU 区域的 GitLab 实例上
4. **双线容灾**：两个 CI 平台同时配置，任一平台故障都不阻塞发布

### 1.2 Monorepo 的 CI 挑战

这个 Monorepo 包含 6 个 workspace 应用：

| 应用 | 技术栈 | CI 任务 |
|-----|-------|--------|
| `apps/api` | NestJS + Prisma | 构建 + 测试 + Docker 镜像 |
| `apps/frontend-blog` | Next.js (Cloudflare) | 构建 + 部署 Workers |
| `apps/admin-next` | Next.js (Node) | 构建 + Docker 镜像 |
| `apps/admin-blog` | Next.js (Node) | 构建 + Docker 镜像 |
| `apps/liveness-web` | Vite + React | 构建 + Docker 镜像 |
| E2E | Playwright | 端到端测试 |

完整 CI 流程（含并行 Job）在 GitHub Actions 上需要 **18 分钟**。迁移到 GitLab CI 的初期，时间不降反升到了 **22 分钟**，而且遇到了 7 个新问题。

---

## 2. 七大已知问题与修复

### 问题 1：GitLab Runner 内存不足（P0）

**现象**：Next.js 构建过程中被静默杀死，没有任何错误日志。Job 状态显示 "failed"，但展开日志最后一行只有 `Killed`。

**根因**：GitLab 默认 Runner 的内存限制是 4GB。Next.js 生产构建（尤其是 `admin-next` 和 `frontend-blog` 两个应用同时构建）需要约 6-8GB 内存。超出限制时，Linux OOM Killer 直接终止进程。

**修复**：两步解决

```yaml
# 1. 配置全局 NODE_OPTIONS 限制 Node.js 内存
variables:
  NODE_OPTIONS: "--max-old-space-size=4096"

# 2. 在 CI 配置中请求 large runner
tags:
  - large-runner
```

### 问题 2：Yarn 4 PnP Git 配置（P0）

**现象**：`yarn install` 随机失败，报 `ENOENT` 或 `fatal: not a git repository`。

**根因**：Yarn 4 的 PnP 模式在安装依赖时需要读取 Git 配置来判断 `core.filemode`。GitLab CI 的默认 Runner 环境中 Git 配置不完整。

**修复**：在 CI 的第一步显式修复 Git 配置：

```yaml
before_script:
  - git config --global core.filemode false
  - git config --global core.autocrlf input
```

### 问题 3：Prisma 缓存丢失（P1）

**现象**：类型检查随机失败，报 `Cannot find module '@prisma/client'` 或模型类型缺失。

**根因**：Prisma 生成的客户端代码位于 `node_modules/.prisma` 目录中。如果 CI 缓存只缓存 `node_modules` 根目录，这个子目录会被忽略。下一个 Job 恢复缓存时，Prisma 类型全部丢失。

**修复**：显式将 `.prisma` 目录加入缓存路径：

```yaml
cache:
  key: $CI_COMMIT_REF_SLUG
  paths:
    - .yarn/cache
    - node_modules/.prisma       # ← Prisma 生成客户端
    - apps/*/node_modules/.prisma # ← 每个 workspace 的 Prisma 客户端
```

### 问题 4：Playwright 沙箱崩溃（P1）

**现象**：E2E 测试直接退出，报 `Chromium sandbox failed`。

**根因**：GitLab Runner 容器中默认没有启用 `--no-sandbox` 所需的 `seccomp` 配置。Playwright 的 Chromium 无法在沙箱模式下运行。

**修复**：在 Playwright 启动参数中禁用沙箱：

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',  // ← 防止 /dev/shm 空间不足
      ],
    },
  },
});
```

### 问题 5：SSH 密钥换行损坏（P1）

**现象**：部署 Job 在执行 SSH 命令时失败，报 `Permissions 0644 for '/root/.ssh/id_rsa' are too open` 或 `Load key "/root/.ssh/id_rsa": invalid format`。

**根因**：SSH 私钥包含换行符。如果使用 Variable 类型的 CI 变量，GitLab 会在保存时压缩所有换行符，导致密钥变成长长的一行，OpenSSH 无法解析。

**修复**：使用 GitLab 的 **File** 类型变量：

```
# 在 GitLab CI 变量中：
# SSH_PRIVATE_KEY → Type: File → 粘贴完整私钥内容（含换行符）
```

在 CI 中直接引用：

```yaml
script:
  - chmod 600 $SSH_PRIVATE_KEY
  - ssh -i $SSH_PRIVATE_KEY user@host ...
```

> **注意**：File 类型变量不能设置为 Masked。这是 GitLab 的限制——多行内容无法 masking。确保 Project 是 Private 的即可。

### 问题 6：并发 Job 不自动取消（P2）

**现象**：同一分支推送多次，多个 CI pipeline 同时运行，排队耗时，浪费 Runner 资源。

**修复**：配置 `interruptible` 和 `resource_group`：

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      auto_cancel:
        on_new_commit: interruptible

build:
  interruptible: true
  resource_group: build-$CI_COMMIT_REF_SLUG
```

### 问题 7：外部 PR 无法访问 Secrets（P2）

**现象**：从 Fork 仓库提交的 Merge Request，所有用到 Protected Variables 的 Job 都失败。

**根因**：GitLab 默认只为保护分支（main）提供 Secrets。外部 PR 的目标分支虽然是 main，但来源分支不受保护。

**修复**：在分支规则中配置：

```
Settings → CI/CD → Token Access:
  - 允许从 Fork 的 MR 访问 Secrets
  - 限制只有 Maintainer 角色的 MR 可以触发
```

---

## 3. 变量配置：安全等级矩阵

GitLab CI 的变量系统比 GitHub Actions 更精细。46 个变量按安全等级分为 5 类：

| 等级 | 安全设置 | 适用变量 | 数量 |
|------|---------|---------|------|
| 🟢 最高 | `Masked and hidden` + `Protected` | API Token, 密钥, 密码 | 8 |
| 🟡 普通密钥 | `Masked` + `Protected` | 账号, ID, 用户名 | 6 |
| 🔵 特殊 | `File` 类型 | SSH 私钥 | 1 |
| 🔵 公开 | `Visible` + `Protected` | 主机地址, 端口 | 5 |
| 🟣 构建展开 | `Visible` + `Expand variable reference` | `NEXT_PUBLIC_*` 等 | ~26 |

### 关键配置原则

```
1. ❌ 所有密钥必须关闭 "Expand variable reference"
   → 否则 $ 符号会被 GitLab 当成变量引用解析

2. ✅ 只有公开变量可以打开变量展开
   → NEXT_PUBLIC_API_URL 等构建时注入的变量

3. ✅ SSH_PRIVATE_KEY 必须用 File 类型
   → GitLab 不支持 Mask 多行内容

4. ✅ 所有变量默认开启 Protect variable
   → 只有保护分支可以访问
```

### 内置变量（不需要手动配置）

GitLab CI 自动注入以下变量，完全不需要手动创建：

| 变量名 | 说明 | 有效期 |
|-------|------|-------|
| `CI_REGISTRY` | GitLab 容器仓库地址 | 永久 |
| `CI_REGISTRY_USER` | 自动生成的临时用户名 | 每次 Job |
| `CI_REGISTRY_PASSWORD` | 自动生成的临时访问令牌 | 每次 Job |
| `CI_JOB_TOKEN` | 本次 Job 的访问令牌 | 每次 Job |

这是 GitLab CI 对比 GitHub Actions 的**最大优势**：容器认证完全自动，不需要维护 PAT（Personal Access Token）。

---

## 4. 镜像拉取认证方案

### 从 GHCR 到 GitLab Registry

旧方案需要在 CI 变量中维护 `GHCR_TOKEN` 和 `VPS_GHCR_PAT`：

```
# ❌ 旧方案 — 已移除
GHCR_TOKEN: ghp_xxx...
VPS_GHCR_PAT: ghp_yyy...
```

新方案使用 GitLab 的内置认证：

| 场景 | 认证方式 |
|-----|---------|
| CI 内部构建镜像 | 内置 `CI_REGISTRY_PASSWORD`，自动生成 |
| VPS 服务器拉取镜像 | 项目 Deploy Token（只读权限） |

### Deploy Token 配置

```bash
# 1. 创建 Deploy Token（项目 → Settings → Repository → Deploy tokens）
#    名称: gitlab-deploy-token
#    权限: read_registry（只读容器仓库）

# 2. 将生成的凭证添加到 CI 变量
#    DEPLOY_TOKEN_USERNAME → Masked and hidden
#    DEPLOY_TOKEN_PASSWORD → Masked and hidden

# 3. 服务器登录命令
echo $DEPLOY_TOKEN_PASSWORD | docker login \
  --username $DEPLOY_TOKEN_USERNAME \
  --password-stdin \
  $CI_REGISTRY
```

Deploy Token 的优势：
- 关联项目而非个人账号，人员变动不影响
- 可以单独吊销和过期
- 权限精确控制（只读容器仓库即可）

---

## 5. CI 配置核心架构

完整的 `.gitlab-ci.yml` 配置文件涵盖以下阶段：

```yaml
stages:
  - lint          # ESLint + Prettier + Type Check
  - test          # 单元测试
  - build         # 构建
  - docker        # Docker 镜像构建 + 推送
  - deploy        # 部署到 VPS
  - e2e           # Playwright 端到端测试
```

### 缓存策略

```yaml
cache:
  key:
    files:
      - yarn.lock
    prefix: $CI_COMMIT_REF_SLUG
  paths:
    - .yarn/cache            # Yarn PnP 零安装缓存
    - node_modules/.prisma    # Prisma 生成客户端
    - apps/*/.next/cache      # Next.js 构建缓存
  policy: pull-push
```

### 跳过不需要的 Job

```yaml
rules:
  - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    when: always
  - if: '$CI_COMMIT_BRANCH == "main"'
    when: always
  - if: '$CI_COMMIT_MESSAGE =~ /^docs:/'
    when: never               # 文档变更不触发 CI
```

---

## 6. 分支保护配置

```
项目 → Settings → Repository → Protected branches

main 分支保护规则：
  ✅ All pipelines must succeed
  ✅ No one can push directly
  ✅ Require approval = 1
  ❌ Skip outdated pipelines = OFF
```

> **`Skip outdated pipelines` 必须关闭**。开启后，后续提交会自动撤销旧 MR 的通过状态，导致需要重新审批，拖慢发布流程。

---

## 7. 性能对比与优化

| 指标 | GitHub Actions | GitLab CI（初始） | GitLab CI（优化后） |
|-----|---------------|------------------|-------------------|
| 完整 CI 运行时间 | 18 min | 22 min | **11 min** |
| 依赖安装 | 2 min | 3 min | 45 sec |
| Next.js 构建 | 7 min | 9 min | 4 min |
| E2E 测试 | 5 min | 6 min | 3 min |

### 优化手段

```
↓ 45% 总时间
├── 缓存命中率优化 → 依赖安装从 3min → 45s
├── 并行 Job 调整 → 构建和测试同时运行
├── NODE_OPTIONS 配置 → 避免 OOM 导致的重复构建
└── interruptible 配置 → 取消过期 Job，减少排队
```

---

## 8. 回滚方案

如果 GitLab CI 出现不可解决的问题，可以快速切回 GitHub Actions：

```bash
# 1. 临时删除 .gitlab-ci.yml
git rm .gitlab-ci.yml

# 2. 恢复 GitHub Actions
git checkout main -- .github/workflows/ci.yml

# 3. 双线运行
# 仓库可以同时在 GitHub 和 GitLab 上运行 CI
# 推送代码到任一平台都触发对应的流水线
```

---

## 9. 常见问题快速排查

### Q: CI 运行时被杀死，没有错误日志

```
内存不足。确认：
1. NODE_OPTIONS="--max-old-space-size=4096" 已配置
2. Runner 标签为 large-runner
3. 查看 Runner 日志：Settings → CI/CD → Runners → 对应 Runner 详情
```

### Q: Yarn install 报 ENOENT

```
Git 配置问题。在 before_script 中加入：
git config --global core.filemode false
git config --global core.autocrlf input
```

### Q: Prisma 类型找不到

```
缓存未包含 .prisma 目录。检查 cache:paths 是否包含：
- node_modules/.prisma
- apps/*/node_modules/.prisma
```

### Q: Playwright 启动失败

```
确认启动参数包含 --disable-dev-shm-usage。
如果依然失败，检查 Runner 容器是否缺少系统依赖：
npx playwright install-deps
```

---

## 10. 总结

从 GitHub Actions 迁移到 GitLab CI 的核心收获：

1. **变量管理更精细**：5 级安全矩阵 + 内置容器认证，减少密钥泄露风险
2. **已知问题有套路**：7 个问题都有标准修复方案，新项目可以直接套用
3. **性能可以比 GitHub 更好**：优化后 11 分钟 vs GitHub 的 18 分钟，降低 39%
4. **双线运行是安全网**：两个平台同时配置，任一故障都不阻塞发布

### 迁移检查清单

```
[ ] CI 变量配置完成（46 个变量按安全等级分类）
[ ] Yarn PnP Git 配置修复
[ ] NODE_OPTIONS 内存限制
[ ] Prisma 缓存路径包含
[ ] Playwright 沙箱禁用
[ ] SSH 密钥使用 File 类型
[ ] Deploy Token 创建（替代 GHCR PAT）
[ ] 分支保护规则配置
[ ] interruptible + resource_group 配置
[ ] 首次空提交验证（8 分钟内完成）
```
