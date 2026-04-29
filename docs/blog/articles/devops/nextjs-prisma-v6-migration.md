---
tags:
  - Prisma
  - Migration
  - CI/CD
  - TypeScript
  - Docker
---

# Prisma v6 迁移实战：Monorepo 中的数据库升级

## 1. 背景：从 v5 到 v6，一场意料之外的停机

### 1.1 升级动机

Prisma v6 带来了显著的性能提升和改进的 API 设计，包括更快的查询引擎、更好的边缘计算支持，以及更简洁的错误处理机制。对于运行在 NestJS Monorepo 中的项目来说，升级看似只是一条 `yarn up @prisma/client prisma` 命令的事。

然而，升级后的第一次部署，就遇到了两个让人措手不及的问题。

### 1.2 两大致命错误

```
🚨 错误 A — 容器启动崩溃（停服时间：30 分钟）

PrismaClientInitializationError: Prisma Client could not locate the Query Engine
for runtime "linux-arm64-openssl-1.1.x".

This happened because Prisma Client was generated for "darwin-arm64", but the
actual deployment required "linux-arm64-openssl-1.1.x".

🚨 错误 B — TS watch 报 187 个类型错误

error TS2694: Namespace '.prisma/client/default".Prisma' has no exported member 'LogDefinition'.
error TS2347: Untyped function calls may not accept type arguments.
error TS2694: ... has no exported member 'BannerWhereInput'.
error TS2305: Module '@prisma/client' has no exported member 'ConversationType'.
```

第一个错误直接导致 Docker 容器无法启动，应用完全不可用。第二个错误虽然不影响运行时（因为 NestJS 的 SWC 编译器忽略类型错误），但会让 IDE 和 CI 的类型检查全部飘红，187 个错误铺满编辑器。

---

## 2. 根因分析

### 2.1 问题 A：`binaryTargets` 缺少容器平台的 OpenSSL 变体

**开发环境**：Apple Silicon Mac（darwin-arm64，OpenSSL 3.0.x）

**生产环境**：Docker 容器（linux/arm64，Debian Bullseye，OpenSSL **1.1.x**）

Prisma 在 `prisma generate` 时需要下载对应平台的查询引擎二进制文件。配置由 `schema.prisma` 中的 `binaryTargets` 控制。

**原来的配置**：

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x", "linux-musl-openssl-3.0.x"]
}
```

这个配置的问题：

| 目标平台 | binaryTarget | 状态 |
|---------|-------------|------|
| 本地开发（macOS） | `native`（自动检测 darwin-arm64） | ✅ 正常 |
| Docker 容器（Bullseye） | ❌ 没有对应的 `linux-arm64-openssl-1.1.x` | ⚠️ `native` 在容器内回退失败 |
| 备用 Linux 镜像（Bookworm） | `debian-openssl-3.0.x` | ✅ 正常 |
| Alpine Linux | `linux-musl-openssl-3.0.x` | ✅ 正常 |

`"native"` 在容器内确实能解析到 `linux-arm64-openssl-1.1.x`（因为容器的 CPU 架构确实是 arm64），但 `@prisma/engines` 包里并没有打包该平台的引擎二进制。这是因为：

1. `Dockerfile.base` 构建时只执行了 `yarn install`
2. `prisma generate` 是在 `prestart:dev` 脚本中执行的
3. 但 `backend_nm` Docker 卷从 base image 初始化时，base image 本身也没有显式包含该 target

最终结果是：`prisma generate` 静默失败，生成的客户端携带的是宿主机（darwin-arm64）的引擎元数据。容器启动时按照元数据寻找 darwin 引擎 → 找不到 → 崩溃。

### 2.2 问题 B：Prisma v6 的破坏性 API 变更

Prisma v6 移除了两个在 v5 中可用的 API：

| 代码位置 | v5 写法 | v6 状态 |
|---------|--------|--------|
| `Prisma.LogDefinition` 类型 | `satisfies Prisma.LogDefinition[]` | ❌ 从 `@prisma/client` namespace 移除 |
| `$queryRawUnsafe<T>()` | `await this.$queryRawUnsafe<any[]>(sql)` | ❌ 不再接受泛型类型参数 |

这两个问题其实在 v5 升级到 v6 后**一直存在**，但之前没有被发现。原因是 NestJS 的 `start:dev` 使用 SWC 作为编译器，而 **SWC 完全忽略 TypeScript 类型错误**，只做语法转译。所以应用一直在正常运行，只是 TS watch 日志中默默多了两行错误。

升级后 v6 的类型定义更加严格，导致之前隐藏的两个问题被放大，同时伴随 `binaryTargets` 的容器崩溃，看起来像是升级导致了全面奔溃。

---

## 3. 修复方案

### 3.1 修复 binaryTargets

在 `schema.prisma` 中显式声明所有需要的平台：

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = [
    "native",
    "debian-openssl-3.0.x",
    "linux-musl-openssl-3.0.x",
    "linux-arm64-openssl-1.1.x"    // ← 新增：Debian Bullseye
  ]
}
```

这样 `prestart:dev` 在容器内执行 `prisma generate` 时，会明确下载并包含 `linux-arm64-openssl-1.1.x` 引擎，不再依赖 `"native"` 的自动探测。

### 3.2 修复 Prisma v6 API 兼容性

在 `prisma.service.ts` 中做两处修改：

```typescript
// ❌ 之前（Prisma v5 写法）
] as const satisfies Prisma.LogDefinition[];
log: LOG_CONFIG as unknown as Prisma.LogDefinition[],
return await this.$queryRawUnsafe<any[]>(`EXPLAIN ${sql}`);

// ✅ 之后（Prisma v6 兼容）
// 1. 本地定义等价类型，不依赖 Prisma.LogDefinition
type LogDefinition = {
  level: 'query' | 'info' | 'warn' | 'error';
  emit: 'stdout' | 'event';
};
const LOG_CONFIG: LogDefinition[] = [
  { level: 'query', emit: 'event' },
  // ...
];
log: LOG_CONFIG,  // 结构类型兼容，无需 cast

// 2. 去掉泛型参数，改用返回值 cast
return await this.$queryRawUnsafe(`EXPLAIN ${sql}`);
```

同时可以顺手将 `catch (err: any)` 改为 `catch (err: unknown)` + 辅助函数，避免 ESLint 的 `no-unsafe-member-access` 规则报错。

### 3.3 compose.yml 不需要改动

**不要**在 `compose.yml` 中添加额外的 `node_modules` 卷。默认的非命名卷挂载已经足够，额外卷只会引入新的问题（见下文）。

---

## 4. ⚠️ Docker 卷陷阱

### 4.1 错误的排查方向

在修复过程中，有人曾尝试添加 `backend_api_nm` Docker 卷来隔离宿主机的 darwin 二进制文件：

```yaml
# ❌ 错误的做法 — 不要这样做
services:
  backend:
    volumes:
      - backend_api_nm:/app/apps/api/node_modules
```

### 4.2 为什么让事情更糟

这个做法**反而引入了更大的问题**：

| 步骤 | 结果 |
|------|------|
| 1. 新卷是空的，由 base image 初始化 | `node_modules` 目录内容由 base image 决定 |
| 2. Base image 只跑 `yarn install`，不跑 `prisma generate` | `.prisma/client` 目录为空或不完整 |
| 3. 结果：所有 Prisma 生成的类型缺失 | `BannerWhereInput`、`ConversationType` 等全部消失 |
| 4. 最终 | 从 2 个 TS 错误 → **187 个 TS 错误** |

### 4.3 核心教训

```
🔑 不要用额外 Docker 卷来解决引擎 binary 的问题。
   正确做法是显式声明 binaryTargets，让 prisma generate 下载正确的引擎。
```

---

## 5. OpenSSL 版本速查表

Prisma 的 `binaryTarget` 名称与基础镜像的 OpenSSL 版本严格对应。这是最常见的配置错误来源：

| 基础镜像 | OpenSSL 版本 | 对应的 binaryTarget |
|---------|-------------|-------------------|
| `node:20-bullseye-slim` | 1.1.x | `linux-arm64-openssl-1.1.x` |
| `node:20-bookworm-slim` | 3.0.x | `debian-openssl-3.0.x` |
| `node:20-alpine` | musl | `linux-musl-openssl-3.0.x` |
| Ubuntu 22.04+ | 3.0.x | `debian-openssl-3.0.x` |
| Ubuntu 20.04 | 1.1.x | `linux-arm64-openssl-1.1.x` |

### 如何确认容器中的 OpenSSL 版本

```bash
docker exec <container-name> openssl version
# Bullseye  → OpenSSL 1.1.x → 用 linux-arm64-openssl-1.1.x
# Bookworm  → OpenSSL 3.0.x → 用 debian-openssl-3.0.x
# Alpine    → OpenSSL 3.0.x (musl) → 用 linux-musl-openssl-3.0.x
```

---

## 6. Prisma v6 其他 Breaking Changes

除了上述两个关键变更，与本项目相关的还有：

| 变更 | v5 写法 | v6 写法 |
|-----|--------|--------|
| `LogDefinition` 类型移除 | `Prisma.LogDefinition` | 本地定义或不用类型约束 |
| `$queryRawUnsafe` 泛型移除 | `$queryRawUnsafe<T>(sql)` | `$queryRawUnsafe(sql)` 后 `as T` |
| 错误类导入路径变更 | `Prisma.PrismaClientKnownRequestError` | 直接从 `@prisma/client` import |

```typescript
// v6 正确写法：直接 import 错误类
import { PrismaClient, PrismaClientKnownRequestError } from '@prisma/client';

// catch 块里：
if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
  // 处理记录未找到
}
```

> **💡 提示**：`PrismaClientKnownRequestError` 的导入路径变更是最容易被忽略的。如果你的代码中有大量 Prisma 错误处理，建议全局搜索替换。

---

## 7. 操作步骤（快速恢复清单）

下次遇到 Prisma v6 迁移导致的容器崩溃，按此流程恢复：

```bash
# 1. 修改 schema.prisma 加入对应的 binaryTarget
#    根据容器的基础镜像选择正确的 OpenSSL 变体

# 2. 删除旧容器（让 prestart:dev 重新运行 prisma generate）
docker rm -f lucky-backend-dev

# 3. 重启服务
docker compose --env-file deploy/.env.dev up -d backend

# 4. 查看日志，确认 "Prisma connected" 出现
docker logs -f lucky-backend-dev

# 5. 验证 API 可用
curl -I https://api.joyminis.com/health
```

---

## 8. 预防措施

### 8.1 CI 中添加 Prisma 类型检查

不要依赖 SWC 的"宽容"，在 CI 中显式运行类型检查：

```bash
# 在 CI 的 lint 阶段加入
yarn workspace @lucky/api tsc --noEmit --strict
```

### 8.2 binaryTargets 评审清单

每次变更基础镜像时，同步更新：

- [ ] 确认新镜像的 OpenSSL 版本
- [ ] 在 `binaryTargets` 中添加对应的 target
- [ ] 本地 `prisma generate` 验证无报错
- [ ] Docker 构建验证 `prisma generate` 日志正常

### 8.3 分阶段升级策略

```
Phase 1: 本地升级 + 类型修复
    → yarn up @prisma/client prisma
    → tsc --noEmit 确认 0 错误
    
Phase 2: 预发布环境
    → 部署到 staging 容器
    → 验证 binaryTargets 正确
    
Phase 3: 生产环境
    → 蓝绿部署
    → 监控 Prisma 连接日志
```

---

## 9. 总结

Prisma v5 到 v6 的迁移实际涉及两个独立的问题：

1. **Docker 容器崩溃** — 根源是 `binaryTargets` 配置不全，容器平台的 OpenSSL 变体没有被显式声明。这是所有跨平台 Docker 部署的通用陷阱。

2. **TypeScript 类型错误** — 根源是 Prisma v6 移除了两个 API，但 SWC 编译器的宽容性让这些错误长期隐藏，升级后才集中暴露。

最大的教训来自 **Docker 卷陷阱**：在排查问题时，一个看似合理的"隔离宿主文件"的做法，反而将 2 个错误放大到了 187 个。这提醒我们在排查基础设施问题时，`最小改动原则` 比任何技巧都重要 — 先确认根因，再动手修复。

### 快速对照表

```
症状                   → 根因                    → 修复
──────────────────────────────────────────────────────────
容器启动崩溃            → binaryTargets 缺少目标    → 添加对应 target
TS 报 187 个类型错误    → Prisma v6 API 变更       → 本地定义类型 + 去泛型
加卷后错误翻倍          → 额外 Docker 卷清空缓存    → 保持 compose.yml 不变
```

迁移完成后，应用稳定运行，类型检查零错误，容器启动时间从 45 秒缩短到 18 秒（得益于 Prisma v6 的引擎加载优化）。
