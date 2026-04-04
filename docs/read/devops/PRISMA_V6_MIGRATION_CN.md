# Prisma v6 升级踩坑记录

> 发生时间：2026-03-17  
> 影响范围：`apps/api` 后端容器启动失败 + TS watch 报 187 个类型错误

---

## 一、现象

### 现象 A — 容器启动崩溃（14:15）

```
PrismaClientInitializationError: Prisma Client could not locate the Query Engine
for runtime "linux-arm64-openssl-1.1.x".

This happened because Prisma Client was generated for "darwin-arm64", but the
actual deployment required "linux-arm64-openssl-1.1.x".
```

### 现象 B — TS watch 报 187 个错误（每次重启都有）

```
error TS2694: Namespace '.prisma/client/default".Prisma' has no exported member 'LogDefinition'.
error TS2347: Untyped function calls may not accept type arguments.
error TS2694: ... has no exported member 'BannerWhereInput'.  // 以及其他所有模型类型
error TS2305: Module '@prisma/client' has no exported member 'ConversationType'.
```

---

## 二、根本原因

### 原因 A：`binaryTargets` 缺少 `linux-arm64-openssl-1.1.x`

**背景**：开发机是 Apple Silicon Mac（darwin-arm64），Docker 容器是 linux/arm64。  
Debian Bullseye（`node:20-bullseye-slim`）的 OpenSSL 版本是 **1.1.x**，不是 3.0.x。

**原来的配置**：

```prisma
binaryTargets = ["native", "debian-openssl-3.0.x", "linux-musl-openssl-3.0.x"]
```

`"native"` 在容器内确实能解析到 `linux-arm64-openssl-1.1.x`，但 `prestart:dev` 在容器内运行
`prisma generate` 时，`@prisma/engines` 包里找不到对应的引擎二进制文件（因为 `backend_nm`
卷是从 base image 初始化的，base image 构建时也没显式包含该 target），导致 generate 静默
失败或回退，最终生成的客户端带的是宿主机（darwin-arm64）的引擎元数据。

容器启动时按元数据找 darwin 引擎 → 找不到 → 崩溃。

### 原因 B：`prisma.service.ts` 使用了 Prisma v5 的 API

Prisma v6 做了两个破坏性变更：

| 代码                               | v5  | v6                                                        |
| ---------------------------------- | --- | --------------------------------------------------------- |
| `satisfies Prisma.LogDefinition[]` | ✅  | ❌ `LogDefinition` 从生成客户端的 `Prisma` namespace 移除 |
| `$queryRawUnsafe<any[]>(...)`      | ✅  | ❌ 不再接受泛型参数                                       |

这两处错误**不影响运行**（NestJS `start:dev` 默认使用 SWC 编译器，SWC 完全忽略
TypeScript 类型错误，只做语法转译），所以之前应用一直在跑，只是 TS watch 日志里
一直有这两行错误。

### ⚠️ 错误排查中的弯路

修复过程中曾经尝试加 `backend_api_nm:/app/apps/api/node_modules` Docker 卷来
隔离宿主机的 darwin 二进制。这个做法**反而引入了更大的问题**：

- 新卷是空的，由 base image 初始化
- Base image（`Dockerfile.base`）只跑 `yarn install`，**不跑 `prisma generate`**
- 所以 `apps/api/node_modules/.prisma/client` 是空的/不完整的
- 结果所有模型类型（`BannerWhereInput`、`ConversationType` 等）全部消失
- 从 2 个 TS 错误变成 187 个 TS 错误

**教训：不要用额外 Docker 卷来解决引擎 binary 的问题。**

---

## 三、正确的修复方式

### 修复 1：`apps/api/prisma/schema.prisma`

在 `binaryTargets` 中**显式声明** `linux-arm64-openssl-1.1.x`：

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x", "linux-musl-openssl-3.0.x", "linux-arm64-openssl-1.1.x"]
}
```

这样 `prestart:dev` 在容器内跑 `prisma generate` 时，会明确包含 linux-arm64-openssl-1.1.x
引擎，不再依赖 `"native"` 的自动探测。

### 修复 2：`apps/api/src/common/prisma/prisma.service.ts`

```typescript
// ❌ 之前（Prisma v5 写法）
] as const satisfies Prisma.LogDefinition[];
log: LOG_CONFIG as unknown as Prisma.LogDefinition[],
return await this.$queryRawUnsafe<any[]>(`EXPLAIN ${sql}`);

// ✅ 之后（Prisma v6 兼容）
// 1. 本地定义等价类型，不依赖 Prisma namespace
type LogDefinition = {
  level: 'query' | 'info' | 'warn' | 'error';
  emit: 'stdout' | 'event';
};
const LOG_CONFIG: LogDefinition[] = [...];
log: LOG_CONFIG,                          // 结构类型兼容，无需 cast

// 2. 去掉泛型，改用返回值 cast（或直接去掉，返回 any）
return await this.$queryRawUnsafe(`EXPLAIN ${sql}`);
```

同时顺手把 `catch (err: any)` 全部改为 `catch (err: unknown)` + `errMsg()` 辅助函数，
避免 ESLint `no-unsafe-member-access` 错误。

### compose.yml 不需要改动

`compose.yml` 保持原样，不要添加额外的 `node_modules` 卷。

---

## 四、操作步骤（下次遇到同类问题）

```bash
# 1. 修改 schema.prisma 加入对应 target（见上）
# 2. 删除旧容器（让 prestart:dev 重新运行 prisma generate）
docker rm -f lucky-backend-dev
# 3. 重启
docker compose --env-file deploy/.env.dev up -d backend
# 4. 查看日志确认 "Prisma connected"
docker logs -f lucky-backend-dev
```

---

## 五、如何判断是哪个 OpenSSL 版本

```bash
# 在容器内查看
docker exec lucky-backend-dev openssl version
# Bullseye → OpenSSL 1.1.x → 用 linux-arm64-openssl-1.1.x
# Bookworm/Ubuntu 22+ → OpenSSL 3.0.x → 用 debian-openssl-3.0.x
```

| Base Image              | OpenSSL | binaryTarget                |
| ----------------------- | ------- | --------------------------- |
| `node:20-bullseye-slim` | 1.1.x   | `linux-arm64-openssl-1.1.x` |
| `node:20-bookworm-slim` | 3.0.x   | `debian-openssl-3.0.x`      |
| Alpine                  | musl    | `linux-musl-openssl-3.0.x`  |

---

## 六、Prisma v6 已知 Breaking Changes（与本项目相关）

| 变更                            | v5 写法                                | v6 写法                          |
| ------------------------------- | -------------------------------------- | -------------------------------- |
| `LogDefinition` 类型            | `Prisma.LogDefinition`                 | 本地定义或不用类型约束           |
| `$queryRawUnsafe` 泛型          | `$queryRawUnsafe<T>(...)`              | `$queryRawUnsafe(...)` 后 `as T` |
| `PrismaClientKnownRequestError` | `Prisma.PrismaClientKnownRequestError` | 直接从 `@prisma/client` import   |

```typescript
// v6 正确写法：直接 import 错误类
import { PrismaClient, PrismaClientKnownRequestError } from '@prisma/client';

// catch 块里：
if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') { ... }
```
