# Yarn PnP 单体仓库的 CI/CD 缓存策略：5 层缓存，15 分钟降到 3 分钟

> GitHub Actions + Yarn 4 PnP + Docker + Turborepo + Playwright 的缓存实战。每种缓存的原理、配置和陷阱，一次性讲清楚。

---

## 1. 背景：4 个工作流，每次跑 15 分钟

项目是一个 Yarn 4 PnP 单体仓库，包含三个子应用：

- `apps/api` — NestJS 后端（Docker 部署到 VPS）
- `apps/admin-next` — 管理后台（部署到 Cloudflare Workers）
- `apps/frontend-blog` — 博客前端（部署到 Cloudflare Pages）

CI/CD 有 4 个主要工作流：

| 工作流 | 触发条件 | 主要耗时步骤 | 耗时 |
|--------|----------|-------------|------|
| `ci.yml` | PR / push | Lint + Type Check + Test + E2E | ~8 min |
| `deploy-backend.yml` | 后端代码推送 | Docker 构建 + 推送 + SSH 部署 | ~10 min |
| `deploy-admin-cloudflare.yml` | 管理后台推送 | 构建 + 部署到 Workers | ~6 min |
| `playwright.yml` | 定时 / 手动 | 安装依赖 + 运行 E2E | ~5 min |

每次提交代码，开发者平均要等 **10-15 分钟**才能看到 CI 结果。对于追求快速迭代的团队来说，这是不可接受的。

## 2. 缓存策略总览

优化后的 CI 使用 **5 种不同类型的缓存**：

```
┌──────────────────────────────────────────────────────┐
│                   CI/CD 缓存全景                       │
├──────────────────────────────────────────────────────┤
│ 1. Docker Layer Cache  ── 加速 Docker 镜像构建         │
│ 2. Yarn Zip Cache      ── 缓存在线依赖包               │
│ 3. node_modules Cache  ── 缓存 PnP 虚拟节点            │
│ 4. Tur bor repo Cache   ── 跨工作流复用构建产物         │
│ 5. Playwright Cache    ── 缓存浏览器二进制文件          │
└──────────────────────────────────────────────────────┘
```

下面逐一讲解每种缓存的配置和原理。

## 3. 缓存详解

### 3.1 Docker Layer Cache（deploy-backend.yml）

**目的**：加速 NestJS API 的 Docker 镜像构建。

**原理**：Docker 镜像构建是基于层的（layer-based）。每一行 `RUN`、`COPY`、`CMD` 指令都会创建一个新的 layer。如果 layer 没有变化，Docker 可以复用之前构建的缓存。

**问题**：原始的 `deploy-backend.yml` 中，Docker layer cache 配置被注释掉了：

```yaml
# 优化前 — cache 被注释
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    # cache-from: type=gha     ← 被注释
    # cache-to: type=gha,mode=max  ← 被注释
```

结果：每次 Docker 构建都是从零开始，`yarn install` 和 TypeScript 编译全部重跑。

**解决**：

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build and push
  uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
    # type=gha: 使用 GitHub Actions 缓存存储
    # mode=max: 缓存所有层（包括中间层），而非只缓存最终层
```

**效果**：Docker 构建从 ~6 分钟降到 ~2 分钟。

**注意陷阱**：
- GHA 缓存有大小限制（~10GB 压缩后），如果 Docker 镜像太大，需要迁移到 Docker Hub 或 GHCR 作为 cache backend
- `mode=max` 比默认的 `mode=min` 占用更多缓存空间，但缓存命中率更高

### 3.2 Yarn Zip Cache（所有工作流）

**目的**：缓存 `.yarn/cache` 目录中的依赖 zip 文件。

**Yarn 4 PnP 的特殊性**：Yarn 4 的 PnP（Plug'n'Play）模式不再将依赖解压到 `node_modules`，而是将依赖包以 zip 文件形式存储在 `.yarn/cache` 目录中。Node.js 通过 `.pnp.cjs` 文件中的映射表来解析这些 zip。

```yaml
- name: Cache Yarn packages
  uses: actions/cache@v4
  with:
    path: .yarn/cache
    key: yarn-cache-${{ runner.os }}-${{ hashFiles('yarn.lock') }}
    restore-keys: |
      yarn-cache-${{ runner.os }}-
```

**缓存 key 设计**：

- `hashFiles('yarn.lock')`：依赖锁文件变化 → key 变化 → 缓存失效。这是精确匹配
- `runner.os`：macOS 和 Linux runner 的缓存不能混用
- `restore-keys`：当精确匹配失败时（比如 `yarn.lock` 有微小变更），使用最近一次的缓存作为兜底

### 3.3 node_modules Cache（需要时）

**Yarn 4 PnP 的另一个特殊性**：虽然大部分依赖在 `.yarn/cache` 的 zip 中，但有一些包（原生模块、带 postinstall 脚本的包）会解压到 `.yarn/unplugged`。此外，`yarn install --immutable` 会生成：

- `.pnp.cjs` — PnP 映射文件
- `.pnp.loader.mjs` — PnP loader
- `.yarn/build-state.yml` — 构建状态

这些文件也需要缓存：

```yaml
- name: Cache node_modules (PnP)
  uses: actions/cache@v4
  with:
    path: |
      .yarn/unplugged
      .pnp.*
    key: modules-${{ runner.os }}-${{ hashFiles('yarn.lock') }}
    restore-keys: |
      modules-${{ runner.os }}-
```

**注意**：不要缓存不存在的路径。在 PnP 模式下，没有完整的 `node_modules` 目录。

### 3.4 Turborepo Remote Cache

**目的**：跨工作流复用构建产物。

项目中 `turbo.json` 定义了每个任务的输出：

```json
{
  "tasks": {
    "build": {
      "outputs": [".next/**", "dist/**"],
      "dependsOn": ["^build"]
    },
    "lint": {
      "outputs": []
    }
  }
}
```

通过缓存 Turborepo 的 `.turbo` 目录，可以实现跨运行、跨工作流的构建缓存：

```yaml
- name: Cache Turborepo
  uses: actions/cache@v4
  with:
    path: |
      .turbo
      apps/*/.turbo
    key: turbo-${{ runner.os }}-${{ hashFiles('yarn.lock') }}-${{ github.sha }}
    restore-keys: |
      turbo-${{ runner.os }}-${{ hashFiles('yarn.lock') }}-
      turbo-${{ runner.os }}-
```

**注意**：Turborepo 也有官方的 Remote Cache 服务（Vercel），但使用 GHA 缓存是零成本的替代方案。

### 3.5 Playwright Browser Cache

**目的**：缓存 Playwright 浏览器二进制文件（~300MB）。

Playwright 每次 `npx playwright install` 会下载 Chromium、Firefox、WebKit 三个浏览器，总大小约 300MB。不缓存的话，每次 CI 都要重新下载：

```yaml
- name: Cache Playwright browsers
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('yarn.lock') }}
```

**注意**：Playwright 的缓存路径在不同操作系统上不同：
- Linux/macOS：`~/.cache/ms-playwright`
- Windows：`%USERPROFILE%\AppData\Local\ms-playwright`

## 4. Cache Key 设计原则

经过实践，我总结了一套 cache key 设计原则：

```yaml
# 推荐的模式
key: <cache-type>-${{ runner.os }}-${{ hashFiles('yarn.lock') }}
restore-keys: |
  <cache-type>-${{ runner.os }}-
```

1. **颗粒度要合适**：`hashFiles('yarn.lock')` 是最合适的——有变化时一定需要新缓存，没变化时一定能命中
2. **避免使用 `github.sha` 作为 main key**：`sha` 每次提交都不同，会导致缓存永远不会命中。可以用在 restore-keys 中作为辅助
3. **提供 fallback**：`restore-keys` 是兜底方案，当精确 key 不匹配时，会使用最近匹配的缓存
4. **区分 runner OS**：macOS 和 Linux 的缓存路径可能不同

## 5. 需要避免的陷阱

### 陷阱 1：actions/setup-node 的内置缓存

`actions/setup-node@v4` 有一个 `cache: 'yarn'` 选项，会自动缓存 Yarn 的全局缓存目录。但 Yarn 4 PnP 的缓存路径与旧版 Yarn 不同，可能导致缓存不命中。

**建议**：手动配置 `actions/cache`，明确指定缓存路径。

### 陷阱 2：缓存大小限制

GitHub Actions 的缓存上限是：
- 每个仓库：~10GB（压缩后）
- 单个缓存条目：无明确限制，但建议 < 5GB

如果缓存太大，旧的缓存会被自动清理。Docker layer cache 尤其容易占用大量空间。

**建议**：定期检查 Actions 缓存页面，清理不需要的缓存。

### 陷阱 3：PnP 模式下缓存一致性

Yarn 4 PnP 的完整性检查非常严格。如果 `.yarn/cache` 中的 zip 文件不完整或者 `.pnp.cjs` 与 zip 不匹配，`yarn install --immutable` 会失败。

**建议**：确保缓存是在 `yarn install` 之后捕获的，并且 `yarn.lock` 作为 cache key 的一部分。

## 6. 优化效果

| 工作流 | 优化前 | 优化后 | 加速 | 主要缓存类型 |
|--------|--------|--------|------|-------------|
| ci.yml | ~8min | ~3min | 2.7x | Yarn zip + module + Turbo |
| deploy-backend.yml | ~10min | ~4min | 2.5x | Docker layer + Yarn zip |
| deploy-admin-cloudflare.yml | ~6min | ~2min | 3x | Yarn zip + Turbo |
| playwright.yml | ~5min | ~2min | 2.5x | Playwright browser + Yarn zip |
| **合计** | **~29min** | **~11min** | **2.6x** | |

> 注意：这些是典型的冷启动到热启动的时间变化。如果 runner 在不同机器上运行（GitHub Actions 默认行为），第一次运行可能仍然较慢，但后续提交会显著加速。

## 7. 总结

### 关键收获

1. **缓存不是银弹**——每种缓存解决特定问题，需要理解底层原理
2. **Cache key 设计决定一切**——太粗的 key 命中率高但可能用错缓存，太细的 key 命中率低
3. **Yarn 4 PnP 需要特殊处理**——与传统 `node_modules` 模式不同，要缓存 `.yarn/cache` + `.pnp.*` + `.yarn/unplugged`
4. **Docker layer cache 收益最高但代价也高**——需要权衡构建速度提升和缓存空间占用
5. **多一层缓存就多一分收益**——每层缓存解决不同阶段的瓶颈，叠加效果显著

### 检查清单

在配置 CI 缓存时，可以按以下清单逐项检查：

- [ ] Docker 构建是否有 layer cache（`cache-from` / `cache-to`）
- [ ] Yarn/npm 依赖缓存是否配置（路径是否正确）
- [ ] Turborepo/Nx 等构建工具的缓存是否启用
- [ ] Playwright/Cypress 等测试工具的浏览器缓存是否启用
- [ ] Cache key 是否包含 hashFiles('yarn.lock') 和 runner.os
- [ ] 是否有 restore-keys 作为兜底
- [ ] 缓存大小是否在 GHA 限制内

---

*本文基于 JoyMini Nest Monorepo 项目的 CI/CD 优化经验。项目使用 Yarn 4 PnP + GitHub Actions + Docker，代码开源可在 GitHub 上查看。*
