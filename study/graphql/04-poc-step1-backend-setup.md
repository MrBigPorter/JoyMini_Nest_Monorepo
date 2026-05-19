# GraphQL PoC — Step 1: 后端安装 + 配置

> 目标：后端装好 GraphQL 依赖，配置好 GraphQLModule，让 /graphql 端点可用
> 这个步骤不写任何 Query，只是确保基础设施就绪

---

## 1.1 安装依赖

在 monorepo 的 API workspace 里安装：

```bash
yarn workspace @lucky/api add @nestjs/graphql @nestjs/apollo graphql
```

不需要装 apollo-server-express，@nestjs/apollo 已经包含。

---

## 1.2 创建 GraphQL Module 配置文件

新建文件：apps/api/src/graphql/graphql.module.ts

```typescript
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // code-first: 根据 resolvers 自动生成 schema.gql
      autoSchemaFile: join(process.cwd(), 'apps/api/src/graphql/schema.gql'),
      // 开发环境开启 playground
      playground: process.env.NODE_ENV !== 'production',
      // 允许 introspection
      introspection: process.env.NODE_ENV !== 'production',
      sortSchema: true,
      path: '/graphql',
    }),
  ],
})
export class GraphqlAppModule {}
```

---

## 1.3 注册到 AppModule

在 apps/api/src/app.module.ts 的 imports 数组里添加：

```typescript
// 文件顶部加 import
import { GraphqlAppModule } from './graphql/graphql.module';

// @Module imports 里加
@Module({
  imports: [
    // ... 其他模块 ...
    GraphqlAppModule,
    BlogModule,
  ],
})
```

---

## 1.4 验证

启动 API 服务：

```bash
yarn workspace @lucky/api start:dev
```

打开浏览器访问：
```
http://localhost:3000/graphql
```

你应该能看到 Apollo Sandbox / GraphQL Playground 页面。

---

## 预期结果

| 检查点 | 结果 |
|--------|------|
| yarn add 安装成功 | ✅ |
| graphql.module.ts 文件创建 | ✅ |
| app.module.ts 注册 | ✅ |
| http://localhost:3000/graphql 显示 Playground | ✅ |

---

完成后告诉我，继续 Step 2：创建第一个 GraphQL Query（文章列表）
