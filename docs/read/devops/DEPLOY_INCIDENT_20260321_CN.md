# 部署问题复盘 — 2026-03-21

> 本文记录 2026-03-21 当晚集中暴露的 8 个部署配置问题、根因分析与最终修复。  
> 所有修复均已合并入 `dev`，相应注意事项已同步更新至 `RUNBOOK.md`。

---

## 问题总览

| #   | 类别       | 现象                                                              |    严重度     |
| --- | ---------- | ----------------------------------------------------------------- | :-----------: |
| 1   | Cloudflare | API Token 认证失败（code: 10000）                                 |    🔴 阻断    |
| 2   | Cloudflare | GitHub Actions artifact 存储配额满                                | 🟡 阻断流水线 |
| 3   | CI         | `test` 分支 `check-types` 报 `Cannot find module`                 |    🔴 阻断    |
| 4   | CI         | 推 `test` 分支后端未触发部署                                      |   🟡 漏部署   |
| 5   | CI         | GitHub Actions 排队拥堵                                           |    🟡 效率    |
| 6a  | Docker     | `yarn turbo run build` 找不到 turbo                               |    🔴 阻断    |
| 6b  | Docker     | `node_modules/.bin/tsc: not found`（子目录）                      |    🔴 阻断    |
| 6c  | Docker     | `@lucky/shared/dist/types/*` TS2307                               |    🔴 阻断    |
| 6d  | Docker     | `COPY apps/api/node_modules: not found`                           |    🔴 阻断    |
| 6e  | Docker     | `apps/api/node_modules/.bin/prisma: no such file` — 迁移/启动失败 |    🔴 阻断    |
| 7   | 开发体验   | `yarn workspace @lucky/api lint -- --fix` 报错                    |    🟢 体验    |

---

## 详细分析

### 问题 1 — Cloudflare API Token 认证失败

**现象**

```
✘ [ERROR] Authentication error [code: 10000]
Unable to retrieve email for this user. Are you missing the `User->User Details->Read` permission?
```

**根因**  
`CLOUDFLARE_API_TOKEN` GitHub Environment Secret 过期或被撤销。错误码 10000 = Token 本体无效，不是权限不足（权限问题是不同错误码）。

**修复**

1. 在 `deploy-admin-cloudflare.yml` 新增 **Step 7 Validate Cloudflare Secrets**：在 Wrangler 部署前调用 `/user/tokens/verify` 接口预检 Token 有效性，失败时打印 `::error::` 注解，清晰指明操作步骤。
2. 重建 Token 权限配置：

| 权限                             | 说明                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| Account > Workers Scripts > Edit | 部署必需                                                               |
| Account > Workers Assets > Edit  | 静态资源必需                                                           |
| User > User Details > Read       | 可选，消除 email 警告                                                  |
| Zone Resources: All zones        | **Cloudflare UI 必填字段**，不选无法保存（Workers 本身不用 Zone 权限） |

**受影响文件**  
`.github/workflows/deploy-admin-cloudflare.yml`

---

### 问题 2 — GitHub Actions Artifact 存储配额满

**现象**

```
Error: Failed to CreateArtifact: Artifact storage quota has been hit.
Unable to upload any new artifacts.
```

**根因**  
`deploy-admin-cloudflare.yml` 每次部署都上传一个 `admin-cloudflare-release-note-<run_id>.txt`，从未设置过期时间，历史 artifact 累积耗尽免费 500 MB 配额。

**分析**  
该 artifact 包含的所有信息（deployment id、version id、commit、rollback note）已被 Step 12（GitHub Actions Job Summary）和 Step 15（Telegram 通知）完全覆盖，无独立信息价值。

**修复**  
删除 Step 13（Save Rollback Note Artifact）和 Step 14（Upload Rollback Note Artifact），信息保留在 Summary 和 Telegram，存储压力归零。

**受影响文件**  
`.github/workflows/deploy-admin-cloudflare.yml`

---

### 问题 3 — test 分支 CI check-types 报 TS2307

**现象**

```
Error: scripts/seed/seed-address.ts(4,31): error TS2307:
Cannot find module './data/ph-address' or its corresponding type declarations.
```

**根因**  
`seed-address.ts`（import `./data/ph-address`）随某次早期 merge 进入了 `main`/`test` 分支，但其依赖的数据文件 `ph-address.ts`（1268 行）只存在于本地 `dev` 分支，**从未 push**。

```
local dev  → 50314eb  feat: add Philippines address seed data  ← 只在本地
origin/dev → 6d9f2ee
origin/test → b06de8f
```

**修复**

```bash
git push origin dev           # 推送包含 ph-address.ts 的 commit
git checkout test
git merge dev --no-edit
git push origin test          # test 分支补齐，CI 通过
```

---

### 问题 4 — 推 test 分支后端未触发部署

**现象**  
推送 `test` 分支后，Admin Cloudflare 部署触发了，但后端 VPS 部署没有触发。

**根因**  
`deploy-backend.yml` 分支触发只配置了 `main`，没有 `test`：

```yaml
# 修复前
on:
  push:
    branches: [main] # ← 缺少 test
```

**修复**

```yaml
# 修复后
on:
  push:
    branches: [main, test]
    paths:
      - "apps/api/**"
      - "packages/shared/**"
      - "packages/config/**"
      - "Dockerfile.prod"
      - "compose.prod.yml"
      - ".github/workflows/deploy-backend.yml" # 新增：工作流自身变更也触发
```

同时在 Telegram 通知里加入 `branch: \`${{ github.ref_name }}\``以区分`test`/`main` 的部署来源。

**受影响文件**  
`.github/workflows/deploy-backend.yml`

---

### 问题 5 — GitHub Actions 排队拥堵

**现象**  
后端部署工作流在 GitHub Actions 队列中等待超过 5 分钟。

**根因**  
GitHub 免费 tier 并发资源有限，高峰期排队。

**修复**  
为三个部署工作流（`deploy-backend.yml`、`deploy-admin-cloudflare.yml`、`deploy-admin.yml`）统一加入 `runner` 输入参数，`deploy-master.yml` 透传选择：

```yaml
# 用法：Actions → deploy-master.yml → Run workflow → Runner: self-hosted
inputs:
  runner:
    type: choice
    options: [ubuntu-latest, self-hosted]
    default: ubuntu-latest
```

`push` 自动触发仍走 `ubuntu-latest`，手动触发可选 `self-hosted`（本地 Mac）。

**受影响文件**  
`.github/workflows/deploy-master.yml`、`deploy-backend.yml`、`deploy-admin-cloudflare.yml`、`deploy-admin.yml`

---

### 问题 6a — Docker build: `yarn turbo run build` 找不到 turbo

**现象**

```
Usage Error: Couldn't find a script named "turbo".
```

**根因**  
`turbo` 在 root `devDependencies`。`yarn workspaces focus @lucky/api` 只安装 `@lucky/api` 的直接依赖，**不安装 root devDependencies**，因此容器内没有 `turbo` 二进制。

以前能工作是因为当时用了完整的 `yarn install`（全量安装）。

**修复**  
Docker 场景只需构建一个包，无需 turbo 的依赖图调度，直接用：

```dockerfile
# 修复前
RUN yarn turbo run build --filter=@lucky/api

# 修复后
RUN yarn workspace @lucky/api build
```

---

### 问题 6b — Docker build: `apps/api/node_modules/.bin/tsc: not found`

**现象**

```
/bin/sh: 1: node_modules/.bin/tsc: not found
```

（在 `cd apps/api && node_modules/.bin/tsc -p tsconfig.cli.json` 步骤）

**根因**  
Yarn 4 `nodeLinker: node-modules` 的提升机制：`typescript` 是 `@lucky/api` 的 devDep，安装后被提升到**根** `node_modules/.bin/tsc`，而非 `apps/api/node_modules/.bin/tsc`。

**修复**  
不 cd 子目录，从根目录使用提升后的路径：

```dockerfile
# 修复前
RUN cd apps/api && node_modules/.bin/tsc -p tsconfig.cli.json

# 修复后
RUN node_modules/.bin/tsc -p apps/api/tsconfig.cli.json
```

---

### 问题 6c — Docker build: `@lucky/shared/dist/types/*` TS2307

**现象**

```
error TS2307: Cannot find module '@lucky/shared/dist/types/treasure'
error TS2307: Cannot find module '@lucky/shared/dist/types/wallet'
（共 5 个错误）
```

**根因**  
`@lucky/shared` 是源码包，需先编译生成 `dist/` 目录。之前用 `yarn turbo run build --filter=@lucky/api` 时，turbo 会自动先编译 `@lucky/shared`（依赖图顺序）。改为 `yarn workspace @lucky/api build` 后，shared 没有被提前编译。

`@lucky/shared/scripts/build.js` 使用 `esbuild`，但 `esbuild` 只在 `apps/admin-next` 中声明，`yarn workspaces focus @lucky/api` 不会安装它。

**修复**  
在 api build 前，用 `tsc` 直接编译 shared（`typescript` 通过 `@lucky/api` devDep 提升到根 `node_modules`，无需 esbuild）：

```dockerfile
# 新增步骤（在 api build 之前）
RUN node_modules/.bin/tsc -p packages/shared/tsconfig.json
```

> 📖 完整原理与新手指南见 `read/TSCONFIG_MONOREPO_CN.md`

---

### 问题 6d — Docker build: `COPY apps/api/node_modules: not found`

**现象**

```
"/app/apps/api/node_modules": not found
```

（Pruner 阶段 `COPY --from=builder /app/apps/api/node_modules ./apps_api_nm`）

**根因**  
本地 `yarn install`（全量）时，因为多个 workspace 存在版本冲突，Yarn 把 `@prisma/client` 等包放进 `apps/api/node_modules`（无法提升）。

但 Docker 里 `yarn workspaces focus @lucky/api` 是干净安装，无冲突，**所有包都提升到根 `node_modules`**，`apps/api/node_modules` 目录根本不会被创建。

**修复**  
在 builder 阶段末尾确保目录存在：

```dockerfile
RUN mkdir -p apps/api/node_modules packages/shared/node_modules
```

生产容器通过 Node.js 向上查找链找到根 `node_modules/@prisma/client`，功能不受影响。

---

### 问题 6e — 容器启动/迁移: `apps/api/node_modules/.bin/prisma: no such file`

**现象**

```
exec: "./apps/api/node_modules/.bin/prisma": stat ./apps/api/node_modules/.bin/prisma: no such file or directory
```

（在 `entrypoint.sh` 和 `deploy-backend.yml` 迁移临时容器步骤）

**根因**  
与问题 6d 同源：`apps/api/node_modules` 在 Docker 里是 `mkdir -p` 创建的**空目录**，`prisma` CLI 被 Yarn 4 提升到了根 `node_modules/.bin/prisma`。

所有历史脚本都硬编码了 `apps/api/node_modules/.bin/prisma`，在新的 Docker 构建产物里全部失效。

**修复**  
全库扫描替换，共 6 处：

| 文件                                   | 行                              |
| -------------------------------------- | ------------------------------- |
| `apps/api/docker/entrypoint.sh`        | migrate deploy 调用             |
| `.github/workflows/deploy-backend.yml` | 迁移临时容器命令                |
| `deploy/init-db.sh`                    | migrate deploy + migrate status |
| `deploy/baseline-db.sh`                | PRISMA 变量 + migrate status    |
| `deploy/deploy.sh`                     | migrate deploy                  |
| `Dockerfile.prod`                      | 注释更新                        |

```sh
# 修复前
./apps/api/node_modules/.bin/prisma migrate deploy ...

# 修复后
./node_modules/.bin/prisma migrate deploy ...
```

**验证**

```bash
docker run --rm --entrypoint="" lucky-backend-prod-test sh -c \
  "ls node_modules/.bin/prisma && echo OK"
# → OK
```

---

### 问题 7 — `yarn workspace @lucky/api lint -- --fix` 报错

**现象**

```
No files matching the pattern "--fix" were found.
```

**根因**  
Yarn 4 处理 `yarn workspace <pkg> <script> -- <extra-args>` 时，会将 `--` 原样插入命令，导致 ESLint 收到：

```
eslint src --max-warnings 2000 -- --fix
```

ESLint 将 `--` 后面的所有内容视为文件 glob，`--fix` 被当作文件名查找，当然找不到。

**修复**  
在 `apps/api/package.json` 新增 `lint:fix` 脚本，直接内嵌 `--fix`：

```json
"lint:fix": "eslint src --fix --max-warnings 2000"
```

使用方式：`yarn workspace @lucky/api lint:fix`

---

## 修复涉及的文件汇总

| 文件                                            | 变更摘要                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy-admin-cloudflare.yml` | 新增 Step 7 Token 预检；移除 Step 13-14 artifact；步骤编号重排                                      |
| `.github/workflows/deploy-backend.yml`          | 触发分支加 `test`；paths 加工作流自身；Telegram 加分支名；加 `runner` input；prisma 路径修正        |
| `.github/workflows/deploy-admin.yml`            | 加 `runner` input                                                                                   |
| `.github/workflows/deploy-master.yml`           | 加 `runner` choice input；透传给三个子工作流                                                        |
| `Dockerfile.prod`                               | 替换 turbo → workspace build；tsc 路径改为根路径；新增 shared tsc 编译步骤；新增 mkdir -p；注释修正 |
| `apps/api/docker/entrypoint.sh`                 | prisma 路径从 `apps/api/node_modules/.bin/` 改为 `node_modules/.bin/`                               |
| `deploy/init-db.sh`                             | prisma 路径修正（2 处）                                                                             |
| `deploy/baseline-db.sh`                         | prisma 路径修正（2 处）                                                                             |
| `deploy/deploy.sh`                              | prisma 路径修正（1 处）                                                                             |
| `apps/api/package.json`                         | 新增 `lint:fix`；`prebuild` 改为直接调用 node                                                       |

---

## 经验总结

1. **`yarn workspaces focus` ≠ `yarn install`**：只装目标 workspace 的依赖，root devDeps（turbo、esbuild）和其他 workspace 的 devDeps 均不安装，Docker 里尤其要注意。

2. **Yarn 4 `nodeLinker: node-modules` 提升行为在 Docker 和本地不一致**：本地全量安装有版本冲突 → 产生子目录；Docker focused 安装无冲突 → 全部提升到根。任何依赖子目录存在的 COPY/脚本都要加防御。

3. **Cloudflare API Token 是 Environment Secret，不是 Repository Secret**：工作流用了 `environment: production`，Secrets 必须在对应 Environment 下配置，Repository 级别的 Secret 不生效。

4. **turbo 在 Docker 里没有价值**：Docker 场景只 build 一个包，不需要 turbo 的 DAG 调度；`yarn workspace <pkg> build` 更直接可靠。

5. **artifact 要设 `retention-days`，或直接用 Job Summary 替代**：免费账户 500 MB 配额很容易被历史 artifact 耗尽，阻断整个流水线。
