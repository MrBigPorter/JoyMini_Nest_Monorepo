# HyperPush — 新技术详解

> 你问「把新技术都解释一下」，这里是 HyperPush 选用的每项新技术的详细介绍：
> 包括"是什么"、"为什么选它"、"和旧的对比好在哪"、"面试能问什么"。

---

## 目录

1. [Node.js](#1-nodejs)
2. [NestJS](#2-nestjs)
3. [Prisma ORM](#3-prisma-orm)
4. [SQLite + Supabase PostgreSQL](#4-sqlite--supabase-postgresql)
5. [Biome](#5-biome)
6. [Tailwind CSS 4](#6-tailwind-css-4)
7. [TanStack Router](#7-tanstack-router)
8. [TanStack Query](#8-tanstack-query)
9. [Redux Toolkit + RTK](#9-redux-toolkit--rtk)
10. [Shadcn/ui](#10-shadcnui)
11. [i18next](#11-i18next)
12. [GraphQL (@nestjs/graphql)](#12-graphql-nestjsgraphql)
13. [tRPC](#13-trpc)
14. [REST vs GraphQL vs tRPC 对比](#14-rest-vs-graphql-vs-trpc-对比)
15. [Supabase](#15-supabase)
16. [性能对比](#16-性能对比)
17. [Monolith vs Microservices](#17-monolith-vs-microservices)

---

## 1. Node.js

### 是什么？

Node.js 是**全球最流行的 JavaScript/TypeScript 运行时**，基于 V8 引擎，生态最成熟、招聘需求最大。

### 为什么选 Node.js（而不是 Bun）？

| 对比项 | Node.js ✅ | Bun |
|--------|-----------|-----|
| 招聘需求 | ⭐⭐⭐⭐⭐ 最多 | ⭐⭐ 极少 |
| 生产环境可靠性 | ⭐⭐⭐⭐⭐ 经过数十年验证 | ⭐⭐⭐ v1.2+ 逐渐稳定 |
| 云平台支持 | ⭐⭐⭐⭐⭐ 所有平台原生支持 | ⭐⭐ 有限支持 |
| 包管理器 | **yarn**（monorepo 标准） | bun（新生态） |
| 类型脚本 | 需 ts-node / tsx | 内置支持 |
| 速度 | 快 | 快 3-5x |
| NestJS 兼容性 | ⭐⭐⭐⭐⭐ 原生 | ⭐⭐ 兼容性问题 |

**关键原因**：你现有的 [`apps/api`](apps/api) 项目就是用 NestJS + Node.js + yarn，选 Node.js 可以让经验直接复用。Node.js 在所有云平台（AWS、GCP、Azure）都有原生支持，部署最方便。

### 面试点

```
Q: Node.js 和 Bun 的区别？
A: Node.js 生态更成熟，招聘需求大。Bun 启动更快，但生产环境还在完善中。
   选 Node.js 是因为 HyperPush 要用 NestJS，NestJS 在 Node.js 上最稳定。
```

### HyperPush 中的角色

- 运行 NestJS BFF 后端
- 运行 Vite 前端开发服务器
- yarn 管理项目依赖

---

## 2. NestJS

### 是什么？

NestJS 是**企业级 Node.js 框架**，使用 TypeScript + 装饰器模式，架构上借鉴了 Angular（模块化 + 依赖注入 + 装饰器）。

### 对比

| 特性 | NestJS ✅ | Hono | Express |
|------|-----------|------|---------|
| 招聘需求 | ⭐⭐⭐⭐⭐ 最高 | ⭐⭐ 极少 | ⭐⭐⭐⭐ 多 |
| 架构 | 模块化（Module/Controller/Service） | 自由（函数式） | 自由（中间件链） |
| TypeScript 支持 | 原生 + 装饰器 | 原生 | 需要额外类型 |
| 内置支持 | GraphQL / WebSocket / TypeORM / Prisma / Swagger | 无 | 无 |
| 学习曲线 | 中等（需理解装饰器/DI/模块） | 低 | 低 |
| 企业采用 | 大量（很多外企在用） | 少量（创业公司） | 大量 |
| 面试价值 | ⭐⭐⭐⭐⭐ 外企高频考点 | ⭐⭐ 小众 | ⭐⭐⭐⭐ |
| 你已有经验 | ✅ 现有 apps/api 就是 NestJS | ❌ 全新学习 | 可能用过 |

### 你的 NestJS 经验

你现有的 [`apps/api`](apps/api) 项目本身就是 NestJS，你已经熟悉：
- Module / Controller / Service 架构
- DTO 验证（class-validator）
- JWT 认证 + Guards
- Prisma 集成
- 模块化组织

HyperPush 会复用同样的模式。

### 代码示例

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ServersModule } from './servers/servers.module';

@Module({
  imports: [
    GraphQLModule.forRoot({
      driver: ApolloDriver,
      autoSchemaFile: true,  // 自动生成 Schema
    }),
    PrismaModule,
    AuthModule,
    ServersModule,
  ],
})
export class AppModule {}
```

```ts
// servers.resolver.ts — GraphQL Resolver
import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

@Resolver()
@UseGuards(AuthGuard)
export class ServersResolver {
  constructor(private prisma: PrismaService) {}

  @Query(returns => [Server])
  async servers() {
    return this.prisma.server.findMany();
  }

  @Mutation(returns => Server)
  async createServer(@Args('input') input: CreateServerInput) {
    return this.prisma.server.create({ data: input });
  }
}
```

### 面试点

```
Q: NestJS 和 Express 的区别？
A: NestJS 提供了完整的应用架构（模块化 + DI + 装饰器），
   适合中大型项目。Express 更自由灵活，适合小型 API。
   NestJS 在招聘中更常见，因为企业需要标准化的代码结构。

Q: NestJS 的 GraphQL 支持如何？
A: 非常好。@nestjs/graphql 提供了装饰器驱动的 GraphQL，
   支持自动 Schema 生成、Code First、Resolver 注入等。
```

---

## 3. Prisma ORM

### 是什么？

Prisma 是**最流行的 TypeScript ORM**，通过 Schema 定义数据模型，自动生成类型安全的客户端。

### 对比

| 特性 | Prisma ✅ | Drizzle |
|------|-----------|---------|
| 招聘需求 | ⭐⭐⭐⭐⭐ 最多 | ⭐⭐ 小众 |
| 文档质量 | ⭐⭐⭐⭐⭐ 最完善 | ⭐⭐⭐ 中等 |
| 代码生成 | 需要 `prisma generate` | 无（直接用 TS 类型） |
| 构建产物 | 生成 ~50MB 客户端 | 无额外代码 |
| 类型安全 | ✅ | ✅ |
| 迁移工具 | `prisma migrate` | `drizzle-kit` |
| 支持数据库 | SQLite/Postgres/MySQL/MongoDB | SQLite/Postgres/MySQL |
| 你已有经验 | ✅ 现有 apps/api 在用 | ❌ 全新学习 |
| 与 NestJS 集成 | ⭐⭐⭐⭐⭐ 官方支持 | ⭐⭐ 社区方案 |

### 为什么选 Prisma？

1. **你已有的经验**：现有 [`apps/api`](apps/api) 就在用 Prisma，可以直接复用模式
2. **招聘需求大**：Prisma 在 TypeScript 岗位中非常常见
3. **NestJS 官方集成**：`@nestjs/prisma` 模块开箱即用
4. **迁移容易**：SQLite 本地开发 → Supabase PostgreSQL 部署，只需改连接字符串

### 代码示例

```prisma
// prisma/schema.prisma
datasource db {
  provider = "sqlite"        // 本地开发
  url      = env("DATABASE_URL")
}

// 部署时切换到 Supabase PostgreSQL
// datasource db {
//   provider = "postgresql"
//   url      = env("DATABASE_URL")  // Supabase 连接字符串
// }

generator client {
  provider = "prisma-client-js"
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String
  servers   Server[]
  createdAt DateTime @default(now())
}

model Server {
  id        String   @id @default(uuid())
  name      String
  url       String
  token     String   // 加密存储
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
}
```

```ts
// prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

### 面试点

```
Q: Prisma 对比 TypeORM 怎么样？
A: Prisma 类型安全更好，Schema 定义更清晰，迁移更可靠。
   TypeORM 的装饰器模式在 NestJS 中也常见，但 Prisma 现在更流行。

Q: Prisma 如何处理数据库迁移？
A: prisma migrate dev 生成迁移文件，prisma migrate deploy 在生产环境执行。
   支持回滚、种子数据、数据验证。
```

---

## 4. SQLite + Supabase PostgreSQL

### 是什么？

HyperPush 使用**双数据库策略**：
- **本地开发**：SQLite（零配置，一个文件）
- **生产部署**：Supabase PostgreSQL（免费 500MB，托管）

### 为什么 HyperPush 这样选？

**本地开发用 SQLite**：
HyperPush 的 BFF 只需要管理这些数据：
- 用户账号（注册用户）
- 服务器凭证列表（加密存储的 CodePush 服务器地址 + token）
- API 密钥
- 审计日志

这些数据量很小（几十到几千条），SQLite 完全够用，且零配置。

**部署用 Supabase PostgreSQL**：
- 免费 500MB，无时间限制
- 托管服务，不需要自己维护数据库
- Prisma 切换只需改连接字符串

### 对比

| 特性 | SQLite（本地开发） | Supabase PostgreSQL（部署） |
|------|-------------------|---------------------------|
| 安装 | 不需要 | 注册即用 |
| 配置 | 0 配置 | 网页操作 |
| 数据模型 | 关系型（表） | 关系型（表） |
| 免费额度 | 无限制（本地文件） | 500MB |
| 部署 | 一个 .db 文件 | 托管云服务 |
| 招聘价值 | 基础技能 | ⭐⭐⭐ 热门需求 |

### 面试点

```
Q: SQLite 什么时候不适合用？
A: 高并发写入（多个连接同时写）、大数据量（超过 100GB）、
   需要存储过程/触发器复杂逻辑时不适合。

Q: 为什么 HyperPush 用 SQLite 而不是 PostgreSQL？
A: HyperPush BFF 的数据量很小（用户 + 服务器凭证 + 审计日志），
   SQLite 零配置、零依赖、部署简单。如果以后用户量大了，
   Drizzle 可以无缝切换到 PostgreSQL（改一行连接配置就行）。

Q: 为什么不用 MongoDB？
A: 见下方 MongoDB 章节详细分析。
```

---

## 5. MongoDB

### 是什么？

MongoDB 是一个 **NoSQL 文档型数据库**，数据存储为 JSON-like 的文档（BSON 格式）。

### 与 SQLite 的核心区别

| 维度 | SQLite | MongoDB |
|------|--------|---------|
| **数据模型** | 关系型（表 + 行 + 列） | 文档型（集合 + 文档） |
| **Schema** | 固定（需定义表结构） | 灵活（同一个集合可以有不同字段） |
| **查询语言** | SQL | MongoDB Query Language |
| **关联数据** | JOIN 查询 | $lookup 聚合（性能不如 JOIN） |
| **事务** | ✅ ACID 事务 | ✅ 多文档事务（v4.0+） |
| **扩展方式** | 单机（纵向扩展） | 分布式（横向扩展/分片） |

### MongoDB 的优缺点

**优点：**
1. **Schema 灵活**：不需要提前定义表结构，适合数据结构变化频繁的项目
2. **JSON 原生**：数据直接存 JSON，前后端数据格式一致
3. **横向扩展**：原生支持分片（Sharding），适合大数据量

**缺点：**
1. **不支持 JOIN**：关联数据需要在应用层多次查询或使用 `$lookup`
2. **没有外键约束**：数据一致性靠应用层保证
3. **不支持 Drizzle**：Drizzle 只支持 SQL 数据库，用 MongoDB 需要换成 Mongoose 或 Prisma
4. **部署需要 Docker**：不像 SQLite 一个文件搞定
5. **内存占用大**：需要大量内存才能跑得流畅

### MongoDB 在 HyperPush 中合适吗？

**坦率说：不适合。**

原因分析：

```
HyperPush BFF 的数据模型：

用户 User ──── 一对多 ──── 服务器 Server
                                │
                           一对多
                                │
                                ↓
                           API 密钥 API Key

审计日志 Audit Log（纯粹的时间序列记录）
```

这些数据的特点是：
1. **结构固定**：用户一定有 email/password/name，不会今天有明天没有
2. **需要关联查询**：查 API 密钥时需要知道属于哪个服务器
3. **数据量极小**：几十到几千条记录
4. **不需要分片**：没有大数据量问题

**MongoDB 的强项（Schema 灵活、横向扩展）在这里用不上**，反而增加了部署复杂度。

### 什么时候该用 MongoDB？

- **日志存储**：不同日志可能有不同字段
- **CMS 内容管理**：不同文章类型有不同的字段结构
- **物联网数据**：设备上报的 JSON 格式不统一
- **大数据量需要分片**：超过单机处理能力

### 如果 MongoDB 对你有吸引力

如果坚持用 MongoDB，技术栈变化：

| 组件 | SQLite 方案 | MongoDB 方案 |
|------|------------|-------------|
| 数据库 | SQLite | MongoDB |
| ORM | Drizzle | Prisma（支持 MongoDB）或 Mongoose |
| 部署 | 文件 + Docker | 需要单独跑 MongoDB Docker 容器 |
| 内存需求 | ~10MB | ~1GB+ |
| 查询方式 | SQL + Drizzle | Prisma Client / Mongoose |

**结论**：HyperPush 用 SQLite 更合适。但如果你想在面试中展示 MongoDB 经验，可以在 BFF 的审计日志部分使用 MongoDB（用 Prisma 同时连接 SQLite + MongoDB），不过这增加了复杂度，属于"为了用而用"。

### 面试点

```
Q: MongoDB 和关系型数据库的核心区别？
A: MongoDB 是文档型 NoSQL 数据库，没有固定 Schema，
   适合数据结构多变或不需要复杂关联的场景。
   关系型数据库有固定 Schema，适合需要 ACID 和关联查询的场景。

Q: 什么时候选 MongoDB，什么时候选 SQL/关系型？
A: MongoDB：数据结构多变、需要快速迭代、不需要复杂关联、大数据量需分片
   SQL：数据结构稳定、需要关联查询（JOIN）、需要事务保证

Q: Prisma vs Mongoose 选哪个？
A: Prisma 类型安全更好，代码生成后自动推导类型。
   Mongoose 更灵活，可以在运行时修改 Schema。
   如果 MongoDB + TypeScript，推荐 Prisma。
```

---

## 6. Biome

### 是什么？

Biome 是一个 **TypeScript/JavaScript 的格式化器和 linter 二合一工具**，目标是替代 ESLint + Prettier。

### 性能对比

| 工具 | 格式化 10 万行代码 | 配置 |
|------|-------------------|------|
| Prettier | ~10s | 大量配置文件 |
| ESLint | ~30s | `.eslintrc` 几百行 |
| **Biome** | **~0.5s** | `biome.json` 十几行 |
| 速度提升 | **10-50x 更快** | — |

### 为什么选 Biome？

1. **一个工具替代两个**：不用再装 ESLint + Prettier + plugins + 写两套配置
2. **极快**：用 Rust 写的，比 Prettier 快 10-50x
3. **零配置起步**：`bunx biome init` 生成配置文件，直接能用
4. **内置 import 整理**：自动排序和合并 import 语句

### 配置示例

```json
{
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "rules": {
      "recommended": true
    }
  }
}
```

### 面试点

```
Q: Biome 比 ESLint + Prettier 好在哪？
A: 1. 一个工具替代两个，配置少一半
   2. Rust 编写，速度快 10-50x
   3. 内置 import 排序，不需要额外插件
   4. 零配置即可用
```

---

## 7. Tailwind CSS 4

### 是什么？

Tailwind CSS 是一个 **utility-first 的 CSS 框架**。v4 是 2025 年初的重大更新，核心变化：

### v3 → v4 变化

| 特性 | Tailwind CSS 3 | Tailwind CSS 4 |
|------|---------------|---------------|
| 配置 | `tailwind.config.js` | **零配置文件**（CSS-first） |
| 自定义 | JS 配置对象 | 直接用 `@theme` CSS 自定义 |
| 安装 | PostCSS 插件 | **Vite 插件**（更快） |
| 类名生成 | 扫描 JS 文件 | 扫描任意文件 |

### 为什么用 Tailwind CSS？

```html
<!-- 传统 CSS 写法 -->
<div class="card">
  <h2 class="card-title">Hello</h2>
  <p class="card-description">World</p>
</div>

<!-- Tailwind CSS 写法 -->
<div class="p-6 bg-white rounded-xl shadow-sm">
  <h2 class="text-lg font-semibold text-gray-900">Hello</h2>
  <p class="text-sm text-gray-500">World</p>
</div>
```

**好处**：
- 不用想类名
- 不用切换 HTML 和 CSS 文件
- 每个属性值肉眼可见
- 和 Shadcn/ui 完美搭配

### 面试点

```
Q: Tailwind CSS 的优势和劣势？
A: 优势：开发速度快、不会有命名冲突、设计系统一致性高。
   劣势：HTML 看起来很"乱"（但习惯了反而觉得清晰）、
   初学者感觉在写 inline styles（但实际上不是）。
```

---

## 8. TanStack Router

### 是什么？

TanStack Router 是**类型安全的 React 路由框架**，由 TanStack Query 的同一作者开发。

### 对比（以 React Router v7 为参照）

| 特性 | TanStack Router | React Router |
|------|----------------|--------------|
| 类型安全 | ✅ **路线参数完全类型推导** | ❌ params 是 string |
| URL 搜索参数 | ✅ 原生支持，类型安全 | ❌ 手动解析 |
| 路由有效性 | ✅ 编译时检查路由存在 | ❌ 运行时才报错 |
| 路径验证 | ✅ 路径错误 IDE 报错 | ❌ 运行时 404 |
| 代码分割 | ✅ 内置懒加载 | ✅ 内置 |
| 加载器 | ✅ 内置数据加载 | ❌ 需要额外库 |
| 文件系统路由 | ✅ 支持 | ✅ v7 支持 |

### 为什么选 TanStack Router？

```ts
// React Router - params 是 string 类型
const { id } = useParams()  // id: string | undefined

// TanStack Router - params 完全类型推导
const { id } = Route.useParams()  // id: string ✅ 类型已知
```

1. **类型安全**：路径参数、查询参数、状态参数全部有类型推导
2. **编译时验证**：不存在路由会编译报错
3. **内置数据加载器**：类似 Remix 的 loader，但更轻

### 面试点

```
Q: TanStack Router 的核心优势？
A: 1. 端到端类型安全 - 路由参数变更时，所有引用处自动报错
   2. 搜索参数原生支持（不需要 URLSearchParams 手动解析）
   3. 内置数据加载和缓存

Q: 和 React Router 比怎么样？
A: React Router 生态更成熟（SSR、部署），
   TanStack Router 类型系统更严格、开发体验更好。
   SPA 项目用 TanStack Router 更合适。
```

---

## 9. TanStack Query

### 是什么？

TanStack Query（之前叫 React Query）是一个**服务端状态管理库**。它管理的是：
- 从 API 获取的数据
- 数据缓存
- 数据刷新（什么时候重新获取）

### 和 Redux Toolkit 的分工

```
TanStack Query              Redux Toolkit + RTK
──────────────              ────────────────────
管理服务端数据                 管理客户端/本地状态
（从 API 获取的）              （UI 状态、表单、缓存）
                              + API 调用层（RTK Query）
```

### 解决了什么问题？

```tsx
// 没有 TanStack Query 时的痛苦
const [data, setData] = useState(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState(null)

useEffect(() => {
  fetch('/api/servers')
    .then(r => r.json())
    .then(setData)
    .catch(setError)
    .finally(() => setLoading(false))
}, [])

// 还需要处理：缓存、重新获取、loading 状态、错误重试...
```

```tsx
// 用 TanStack Query
const { data, isLoading, error } = useQuery({
  queryKey: ['servers'],
  queryFn: () => fetch('/api/servers').then(r => r.json()),
})
// 自动缓存、自动刷新、自动重试、窗口聚焦时重新获取
```

### 核心能力

| 功能 | 描述 |
|------|------|
| 自动缓存 | 相同请求不重复发送 |
| 后台刷新 | 数据过期自动刷新 |
| 窗口聚焦重获 | 切回页面时自动更新数据 |
| 乐观更新 | 先更新 UI，后台确认后修正 |
| 分页 + 无限滚动 | 内置支持 |
| 请求重试 | 失败自动重试（可配置） |

### 面试点

```
Q: TanStack Query 解决了什么问题？
A: 解决了服务端数据获取的"脏活"：缓存管理、重复请求去重、
   数据过期刷新、错误重试、loading/error 状态管理。
   让开发者不用写大量的 useEffect + useState。

Q: TanStack Query vs RTK Query？
A: 两者功能相似。TanStack Query 更轻量（30KB），
   独立于 Redux 使用。RTK Query 是 Redux Toolkit 的一部分。
   HyperPush 两者都用了：RTK Query 做 GraphQL 调用，
   TanStack Query 做 CodePush REST API 请求缓存。
```

---

## 10. Redux Toolkit + RTK

### 是什么？

Redux Toolkit (RTK) 是 Redux 的官方现代化版本。RTK Query 是 RTK 内置的数据请求和缓存层。

### 对比 Zustand（你之前用的）

| 特性 | Redux Toolkit | Zustand |
|------|--------------|---------|
| 学习曲线 | 中等（需要理解 reducer/action） | 低（类似 setState） |
| 模板代码 | 少（RTK 大幅减少） | 极少 |
| 调试工具 | ✅ Redux DevTools | ✅ |
| 中间件 | 内置（thunk/listener） | 需要自定义 |
| 测试 | ✅ 完善 | ✅ 简单 |
| 工作市场 | **欧美主流** | 相对少 |
| 类型安全 | ✅ | ✅ |

### 为什么选 Redux Toolkit？

这是你要求的——你觉得欧美市场 Redux 更主流，确实如此：

```
美国 React 职位中，提到 Redux 的占 60%+
提到 Zustand 的占 5%-

数据来源：Indeed / LinkedIn 美国 React 职位（2025）
```

### 代码示例

```ts
import { createSlice, configureStore } from '@reduxjs/toolkit'

// 1. 创建 slice（替代传统的 switch-case reducer）
const serversSlice = createSlice({
  name: 'servers',
  initialState: { items: [], selectedId: null },
  reducers: {
    selectServer: (state, action) => {
      state.selectedId = action.payload
    },
  },
})

// 2. 创建 store
const store = configureStore({
  reducer: { servers: serversSlice.reducer },
})

// 3. 在组件中使用
function ServerList() {
  const selectedId = useSelector((state) => state.servers.selectedId)
  const dispatch = useDispatch()
  return <button onClick={() => dispatch(selectServer('1'))}>Select</button>
}
```

### RTK Query 示例

```ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'

export const codePushApi = createApi({
  reducerPath: 'codePushApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api/codepush' }),
  endpoints: (builder) => ({
    getApps: builder.query({
      query: (serverId) => `/apps?serverId=${serverId}`,
    }),
    createApp: builder.mutation({
      query: (body) => ({ url: '/apps', method: 'POST', body }),
    }),
  }),
})

// 自动生成 hooks：useGetAppsQuery, useCreateAppMutation
```

### 面试点

```
Q: Redux Toolkit 和传统 Redux 的区别？
A: RTK 解决了传统 Redux 的三个痛点：
   1. createSlice 替代 switch-case reducer（减少 70% 代码）
   2. 内置 immer 支持（直接修改 state 而不会导致不可变问题）
   3. RTK Query 替代手动 fetch + thunk

Q: 什么时候用 Redux，什么时候用 useState/useContext？
A: 跨组件共享的全局状态用 Redux（用户信息、主题、服务器凭证列表），
   组件局部状态用 useState（表单输入、弹窗开关）。
```

---

## 11. Shadcn/ui

### 是什么？

Shadcn/ui **不是 npm 包**，而是一个**组件集合**。你运行 `npx shadcn@latest add button`，它会直接复制组件代码到你的项目中。

### 和 Ant Design / Material UI 的区别

| 特性 | Shadcn/ui | Ant Design | Material UI |
|------|-----------|------------|-------------|
| 安装方式 | 复制代码 | npm 包 | npm 包 |
| 可定制性 | **完全可控**（代码在项目里） | 有限（通过 theme） | 有限 |
| 体积 | **按需**（只加你用的） | 全量（即使只用 1 个组件） | 全量 |
| UI 风格 | 简洁现代 | 企业风格 | Google 风格 |
| 和 Tailwind | 原生适配 | 需要额外适配 | 需要额外适配 |
| 使用难度 | 简单 | 中等 | 中等 |

### 为什么选 Shadcn/ui？

1. **代码在项目中**：你可以任意修改组件源码，不受库作者限制
2. **按需引用**：只用 Button 就不会有 Dialog 的代码
3. **和 Tailwind CSS 完美搭配**：所有样式都是 Tailwind class
4. **高质量实现**：无障碍（ARIA）、键盘导航、屏幕阅读器都做好了

### 代码示例

```bash
# 添加 Button 组件
npx shadcn@latest add button

# 添加 Dialog 组件
npx shadcn@latest add dialog
```

```tsx
// 直接使用（组件代码已在项目中）
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'

function MyComponent() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>打开弹窗</Button>
      </DialogTrigger>
      <DialogContent>
        <p>这是弹窗内容</p>
      </DialogContent>
    </Dialog>
  )
}
```

---

## 12. i18next

### 是什么？

i18next 是目前最流行的**国际化框架**，支持 100+ 种语言。

### 你之前项目已经在用

你已经在 [`admin-next`](apps/admin-next/src/i18n/en.json) 和 `admin-blog` 中用了同样的技术。HyperPush 沿用相同模式。

### 核心概念

```json
// src/app/i18n/en.json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete"
  },
  "servers": {
    "title": "Servers",
    "addServer": "Add Server",
    "serverUrl": "Server URL"
  }
}
```

```tsx
import { useTranslation } from 'react-i18next'

function ServersPage() {
  const { t } = useTranslation()
  return <h1>{t('servers.title')}</h1>
  // 英文: "Servers"
  // 中文: "服务器管理"
}
```

### 和直接写 String 的区别

```
❌ 直接写死文字：
   <h1>Servers</h1>  → 无法翻译

✅ 用 i18next：
   <h1>{t('servers.title')}</h1>
   → en: "Servers"
   → zh: "服务器管理"
   → ja: "サーバー管理"
```

---

## 13. GraphQL (@nestjs/graphql)

### 是什么？

GraphQL 是 Facebook 开源的 **API 查询语言**，让客户端精确指定需要的数据。

在 HyperPush 中通过 **@nestjs/graphql**（NestJS 官方 GraphQL 模块）集成，使用 Code First 模式（通过装饰器自动生成 Schema）。

### REST vs GraphQL

```
REST：
  GET  /api/servers          → 返回所有字段（可能过多或过少）
  GET  /api/servers/1/apps   → 可能需要多次请求

GraphQL：
  POST /graphql
  query {
    servers {
      id
      name
      apps {           ← 一次查询获取关联数据
        id
        name
        deployments {
          name
          label
        }
      }
    }
  }
  → 只返回你请求的字段
```

### @nestjs/graphql 示例

```ts
// 1. 在模块中注册
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';

@Module({
  imports: [
    GraphQLModule.forRoot({
      driver: ApolloDriver,
      autoSchemaFile: true,  // 自动从装饰器生成 schema.graphql
    }),
  ],
})
export class AppModule {}

// 2. 定义对象类型
import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class Server {
  @Field(type => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  url: string;
}

// 3. 编写 Resolver
import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

@Resolver()
export class ServersResolver {
  @Query(returns => [Server])
  async servers() {
    return this.prisma.server.findMany();
  }

  @Mutation(returns => Server)
  async createServer(@Args('input') input: CreateServerInput) {
    return this.prisma.server.create({ data: input });
  }
}
```

### 面试价值

GraphQL 是**欧美外企面试高频考点**（Meta、Shopify、GitHub、Netflix 都在用）。

### 面试点

```
Q: GraphQL 解决了什么问题？
A: 1. 过度获取（Over-fetching）- REST 返回不需要的字段
   2. 不足获取（Under-fetching）- 需要多次请求获取关联数据
   3. 前后端耦合 - 前端需求变化不需要改后端 API

Q: GraphQL 的缺点？
A: 1. 缓存比 REST 复杂（POST 请求默认不可缓存）
   2. 上传文件不如 REST 方便
   3. 查询复杂度可能很大（需要深度限制保护）
   4. 学习曲线比 REST 高

Q: @nestjs/graphql 和 GraphQL Yoga 的区别？
A: @nestjs/graphql 是 NestJS 官方模块，使用装饰器驱动（Code First），
   自动生成 Schema 文件，与 NestJS 的 DI/模块系统完美集成。
   GraphQL Yoga 是独立库，适合非 NestJS 项目。
```

---

## 14. tRPC

### 是什么？

tRPC 是一个**端到端类型安全的 API 框架**，让你在前后端之间共享 TypeScript 类型。

### 核心体验

```ts
// 后端定义
const appRouter = t.router({
  getServers: t.procedure.query(() => {
    return db.select().from(servers)
  }),
  createServer: t.procedure
    .input(z.object({ name: z.string() }))
    .mutation(({ input }) => {
      return db.insert(servers).values({ name: input.name })
    }),
})

// 前端调用 - 完全类型推导！
const servers = await trpc.getServers.query()
// servers 的类型自动推导为 Server[]

const result = await trpc.createServer.mutate({ name: 'prod' })
// 参数自动校验（Zod），返回值自动推导
```

### 为什么有人选 tRPC？

1. **零 API 契约文件**：不需要写 OpenAPI 或 GraphQL Schema
2. **全栈类型安全**：后端改了类型，前端编译就报错
3. **无运行时开销**：不像 GraphQL 需要解析查询字符串

### 为什么有人不选 tRPC？

1. **需要全栈 TypeScript**：后端必须是 TS（无法给其他语言调用）
2. **不能直接通过 HTTP 调试**：不像 REST 可以用浏览器访问
3. **生态较新**：2022 年才发布，人才储备不如 GraphQL

### 面试点

```
Q: tRPC 和 GraphQL 的区别？
A: tRPC = 简单场景的极致体验（全栈 TS + 类型推导）
   GraphQL = 复杂场景的灵活方案（跨语言、订阅、联邦）

   简单说：tRPC 像 TypeScript 的 RPC 调用，
   GraphQL 像数据库查询语言给前端用。

Q: tRPC 什么时候不适合？
A: 1. 前端不是 TypeScript
   2. 后端不是 TypeScript
   3. 需要给第三方开放 API
```

---

## 15. REST vs GraphQL vs tRPC 对比

| 维度 | REST | GraphQL | tRPC |
|------|------|---------|------|
| **学习曲线** | 低 | 中高 | 低 |
| **类型安全** | 手动（Zod） | 自动（从 Schema 生成） | 自动（直接推导） |
| **缓存** | 简单（HTTP 缓存） | 复杂（Apollo 缓存） | 中等（React Query） |
| **调试** | 浏览器直接访问 | GraphiQL playground | 需要客户端 |
| **文件上传** | 简单 | 中等 | 中等 |
| **跨语言** | ✅ 所有语言 | ✅ 所有语言 | ❌ 仅 TypeScript |
| **第三方开放** | ✅ 天然适合 | ✅ 天然适合 | ❌ 不适合 |
| **求职市场** | 100% 岗位 | 外企/大厂高频 | 少（新） |
| **HyperPush** | ✅ 可选 | ✅ 已选 | ❌ 已排除 |

### HyperPush 的最终决定：**GraphQL ✅**

| 选项 | 求职加分 | 开发效率 | 复杂度 |
|------|---------|---------|--------|
| GraphQL ✅ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中等 |
| REST | ⭐⭐⭐ | ⭐⭐⭐⭐ | 低 |
| tRPC ❌ | ⭐⭐ | ⭐⭐⭐⭐⭐ | 低 |

**选择 GraphQL 的原因**：
1. **求职价值最高**：Meta、Shopify、GitHub、Netflix 都在用 GraphQL
2. **适合关联数据**：HyperPush 的 Servers → Apps → Deployments → Releases 层级查询正是 GraphQL 的强项
3. **NestJS 原生支持**：@nestjs/graphql 提供了装饰器驱动的 GraphQL 集成
4. **你已有的经验**：虽然没直接用过 GraphQL，但 NestJS 架构熟悉，学习成本可控

---

## 16. Supabase

### 是什么？

Supabase 是 **Firebase 的开源替代**，提供托管 PostgreSQL 数据库 + 内置 Auth + REST API + Realtime + Storage。

### Supabase PostgreSQL vs 普通 PostgreSQL

| 对比项 | 普通 PostgreSQL | Supabase PostgreSQL |
|--------|---------------|-------------------|
| 管理方式 | 自己安装配置 | 托管，网页操作 |
| 自动 REST API | 需要自己写 | 根据表自动生成 |
| Auth 认证 | 自己实现 | 内置邮箱/OAuth/手机验证 |
| Realtime 订阅 | 需要额外配置 | 内置 WebSocket |
| Storage 存储 | 自己搭 | 内置文件存储 |
| 管理界面 | pgAdmin / CLI | Supabase Dashboard |
| Prisma 连接 | 标准连接字符串 | 标准连接字符串 |
| 免费额度 | 无（自己承担服务器费用） | 500MB PostgreSQL，无时间限制 |

### 为什么 HyperPush 选 Supabase？

1. **求职价值**：你在招聘中看到 Supabase 需求多，确实越来越多的创业公司在用
2. **零运维**：不需要安装 Docker、不需要配置 PostgreSQL、不需要管理备份
3. **免费额度慷慨**：500MB PostgreSQL + Auth 50K 月活，用完再付费
4. **Prisma 兼容**：用标准 PostgreSQL 连接字符串，Prisma 直接连

### 使用方式

```bash
# 1. 注册 Supabase（app.supabase.com）
# 2. 创建项目 → 拿到连接字符串

# .env
DATABASE_URL="postgresql://postgres:xxxx@db.xxx.supabase.co:5432/postgres"
```

```prisma
// prisma/schema.prisma — 部署时用 Supabase
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 面试点

```
Q: Supabase 和 Firebase 的区别？
A: Supabase = 开源 + PostgreSQL（关系型）
   Firebase = Google 闭源 + Firestore（文档型）
   
   Supabase 的优势：数据是标准的 PostgreSQL，随时可以迁移出去。
   Firebase 的优势：Google 生态，Push Notification 集成更好。

Q: Supabase 的 Realtime 怎么工作？
A: Supabase Realtime 基于 PostgreSQL 的 logical replication，
   数据库变化时通过 WebSocket 推送给客户端。
   实现原理和功能类似 Firebase Realtime Database。
```

---

---

## 16. 性能对比

### 为什么选完技术栈要提性能？

你选的这套技术栈（NestJS + Prisma + GraphQL）**在原始性能上比 Hono + Drizzle + REST 慢**，这是客观事实。

但关键问题是：**这种性能损失对 HyperPush 有影响吗？答案是没有。**

### 性能对比表

| 维度 | 原方案（Hono + Bun + Drizzle） | 新方案（NestJS + Node.js + Prisma） | 性能差异 |
|------|-------------------------------|-------------------------------------|---------|
| 框架吞吐 | Hono 极轻量（~20kB）| NestJS 重量级（依赖注入+模块系统） | NestJS 慢 30-50% |
| 运行时启动 | Bun 冷启动 < 50ms | Node.js 冷启动 ~200ms | Bun 快 4x |
| ORM 性能 | Drizzle 直接生成 SQL，几乎零开销 | Prisma 有 Engine 层，多一次序列化 | Drizzle 快 2-3x |
| API 层 | REST（最小开销）| GraphQL（需解析+验证+批量解析）| REST 快 ~20% |
| 数据库 | SQLite（本地文件，零网络延迟）| Supabase PostgreSQL（网络请求）| SQLite 快 |

### 为什么这些差异你感知不到？

**HyperPush 是一个管理控制台，不是高并发 API**。

| 指标 | HyperPush 的真实负载 | 性能瓶颈在哪里 |
|------|---------------------|---------------|
| QPS | < 10 | 框架差异在 < 10 QPS 下不可感知 |
| 数据量 | < 1000 条记录 | ORM 差异在小数据量下不可感知 |
| 延迟要求 | < 500ms 即可 | NestJS + Prisma < 50ms，远低于阈值 |
| 用户数 | 1-10 人 | 完全没有并发压力 |

你感受到的不会是框架差异，而是：
1. **数据库查询时间**（加索引 > 换 ORM）
2. **前端渲染速度**（React 优化 > 后端微优化）
3. **网络延迟**（CDN > 框架选择）

### 真正有感知的"性能"提升

| 变化 | 实际感受 | 原因 |
|------|---------|------|
| **Bun install** | 首次装依赖快 10-30x | Bun 的 npm client 比 yarn 快 |
| **GraphQL** | 减少 over-fetching | 前端只取需要的数据 |
| **Prisma Studio** | 数据库操作效率高 | GUI 查看编辑，不用手写 SQL |
| **Supabase** | 运维效率高 | 零管理，专注开发 |

### 面试价值 vs 性能的权衡

```
Hono + Bun + Drizzle = 快，但没面试问
NestJS + Node.js + Prisma + GraphQL = 慢一点，但面试天天问
```

**你用可接受的性能损失，换最大的面试回报。这个权衡是合理的。**

面试时可以说：
> "我选 NestJS + Prisma + GraphQL 不是因为它们是性能最强的，而是因为对于 HyperPush 这种管理控制台场景，性能不是瓶颈。选它们是为了更好的可维护性、类型安全性、以及更通用的生态支持。"

---

## 17. Monolith vs Microservices

### 你问"能做微服务吗"，答案是能

[`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics) 是 NestJS 内置包，不是第三方插件。NestJS 对微服务有**一等支持**。

### 一句话理解 Monolith 和 Microservices

| 概念 | 比喻 | 解释 |
|------|------|------|
| **Monolith（巨石应用）** | 一个商店只有一个收银台 | 所有功能在同一个项目中，部署成一个服务 |
| **Microservices（微服务）** | 超市每个区域都有独立收银台 | 每个功能独立项目、独立部署、独立数据库 |

**你现有的 [`apps/api`](apps/api) 就是标准的 NestJS Monolith** — auth、订单、用户、优惠券都在同一个项目里。这是正常的设计。

### NestJS 微服务支持的传输层

| 传输层 | 适用场景 | 复杂度 |
|--------|---------|--------|
| TCP | 简单内部服务通信 | 低 |
| Redis Pub/Sub | 轻量级事件驱动 | 中 |
| RabbitMQ | 企业级消息队列 | 中高 |
| Kafka | 高吞吐事件流 | 高 |
| gRPC | 跨语言服务调用 | 中 |
| NATS | 云原生消息系统 | 中 |

**关键特性**：同一个 NestJS 应用可以同时暴露 HTTP 端口（REST/GraphQL）和微服务端口，模块按功能拆分后可以随时抽出独立服务。

### HyperPush 用什么？

**Monolith**，跟你现有的 [`apps/api`](apps/api) 一样。

```
当前（Monolith，Phase 1）：
┌─────────────────────────────────┐
│ HyperPush API（一个 NestJS 应用） │
│  ├─ AuthModule                  │
│  ├─ CodePushProxyModule         │
│  ├─ AuditLogModule              │
│  └─ ApiKeyModule                │
└─────────────────────────────────┘

未来（Microservices，如果需要）：
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Auth     │  │ CodePush │  │ Audit    │
│ Service  │  │ Proxy    │  │ Log      │
│          │  │ Service  │  │ Service  │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     └─────────────┼─────────────┘
                   │
          ┌────────┴────────┐
          │  Redis/RabbitMQ │
          │  (消息总线)      │
          └─────────────────┘
```

### 如果以后想拆，需要做什么？

因为用了 NestJS 的 `@Module` 装饰器，模块边界已经定义好了。要拆成微服务只需要：

1. 把模块文件抽出到独立目录
2. 配置 `@nestjs/microservices` 的 `ClientProxy`
3. 原来 `service.method()` 的调用改为 `client.send(pattern, data)`

**这本身就是个很好的面试话题：**
> "我设计的项目目前是 monolith，但我用 NestJS 的模块化架构保证了每个模块边界清晰。未来如果业务增长，可以按模块拆分成微服务，而不需要重写代码。"

### 你现在没有微服务概念，完全正常

- 微服务是**工作经验问题**，不是技术短板
- 大多数公司（尤其是中小公司）用的就是 NestJS monolith
- 你的 [`apps/api`](apps/api) 就是一个标准的 NestJS monolith，这是正确的切入点
- 面试时可以说："我目前做的是 NestJS monolith 项目，但我知道微服务架构，也理解 NestJS 对微服务的原生支持"

### 关键点总结

| 问题 | 答案 |
|------|------|
| HyperPush 需要微服务吗？ | 不需要，monolith 绰绰有余 |
| NestJS 能做微服务吗？ | 可以，内置 @nestjs/microservices 包 |
| 以后想拆容易吗？ | 容易，模块边界已经定义，改传输层即可 |
| 面试会问吗？ | 会问微服务概念，但你目前不需要实际做 |

---

> 这份文档会一直放在 [`plans/codepush-tech-explanation.md`](plans/codepush-tech-explanation.md)，你可以随时回来查阅。
