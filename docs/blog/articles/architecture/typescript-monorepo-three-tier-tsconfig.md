---
title: TypeScript Monorepo 配置实战：三层 tsconfig 架构与共享包管理
slug: typescript-monorepo-three-tier-tsconfig
tags: TypeScript, Monorepo, NestJS, DevOps, Architecture
---

# TypeScript Monorepo 配置实战：三层 tsconfig 架构与共享包管理

## 1. 引言

> 一个 `dist/main.js` 路径错误，导致 Docker 容器启动失败，排查了 2 小时才找到根因——这是真实发生过的事故。

在 Monorepo 中管理 TypeScript 配置，最隐蔽也最容易踩的坑就是 **`rootDir` 推断**。当你优雅地在 `tsconfig.json` 里写下 `paths` 映射到共享包源码时，TypeScript 编译器的行为可能完全超出你的预期。

本文将以 `apps/api`（NestJS）跨包引用 `packages/shared` 的真实项目为例，深入剖析：

- `paths` 指向 `.ts` vs `.d.ts` 的 rootDir 差异
- 三层 tsconfig 架构（IDE / 构建 / 脚本）的设计思路
- 修改共享包后必须重建的原因
- 容器启动失败时的标准诊断流程

---

## 2. rootDir 推断：一个被低估的陷阱

### 2.1 问题演示

假设你的 Monorepo 结构如下：

```
apps/api/
├── src/
│   └── main.ts          # 入口文件
├── scripts/
│   └── seed.ts           # 数据填充脚本
└── tsconfig.json

packages/shared/
├── src/
│   └── index.ts          # 共享类型/工具
└── dist/
    └── index.d.ts
```

一个**看起来正确**但**实际致命**的配置：

```jsonc
// apps/api/tsconfig.json — 错误写法 ❌
{
  "compilerOptions": {
    "outDir": "./dist",
    "paths": {
      "@lucky/shared": ["../../packages/shared/src/index.ts"], // ← 指向 .ts 源码
    },
  },
  "include": ["src/**/*", "scripts/**/*.ts"],
}
```

**TypeScript 编译器的行为链：**

1. **路径解析**：`@lucky/shared` → `../../packages/shared/src/index.ts`（`.ts` 文件）
2. **纳入编译**：`.ts` 文件不只是类型检查，而是被纳入**编译输出**
3. **rootDir 推断**：TypeScript 找所有编译文件的公共祖先目录
   - 文件来自 `apps/api/src/` + `apps/api/scripts/` + `packages/shared/src/`
   - 公共祖先 = **Monorepo 根**（`/app/`）
4. **输出路径灾难**：
   ```
   apps/api/src/main.ts
     → dist/apps/api/src/main.js  ← ❌ 嵌套了三层！
   
   packages/shared/src/index.ts
     → dist/packages/shared/src/index.js  ← ❌
   ```
5. **容器启动失败**：`node dist/main.js` → `MODULE_NOT_FOUND`
   - 因为实际文件在 `dist/apps/api/src/main.js`

### 2.2 正确写法

```jsonc
// apps/api/tsconfig.json — 正确写法 ✅
{
  "compilerOptions": {
    "outDir": "./dist",
    "paths": {
      "@lucky/shared": ["../../packages/shared/dist/index"],      // ← .d.ts 声明文件
      "@lucky/shared/*": ["../../packages/shared/dist/*"],
    },
  },
  "include": ["src/**/*", "scripts/**/*.ts"],
}
```

**行为链对比：**

1. **路径解析**：`@lucky/shared` → `../../packages/shared/dist/index.d.ts`（`.d.ts` 文件）
2. **不纳入编译**：`.d.ts` 文件**只用于类型检查**，不参与编译输出，不影响 `rootDir`
3. **rootDir 推断**：只由 `apps/api/src/` + `apps/api/scripts/` 决定 → 推断为 `apps/api/`
4. **输出路径**：
   ```
   src/main.ts → dist/src/main.js  ← ✅ 不再嵌套
   ```

> **核心原则**：`paths` 必须指向编译产物（`.d.ts`），而不是源码（`.ts`）。源码属于自己的编译器，产物是给别人用的接口。

---

## 3. 为什么 `tsconfig.build.json` 必须只含 `src/`

即使 `paths` 已经指向 `.d.ts`，另一个问题仍然存在。

### 3.1 残留的 rootDir 问题

`tsconfig.json` 的 `include` 通常包含 `scripts/**/*.ts` 以便 IDE 支持：

```jsonc
// tsconfig.json
"include": ["src/**/*", "scripts/**/*.ts"]
```

这意味着 `nest build` 在编译时：

```
include: ["src/**/*", "scripts/**/*.ts"]
→ rootDir 推断为 apps/api/（src/ 和 scripts/ 的公共祖先）
→ src/main.ts → dist/src/main.js  ← ❌ 仍然不对！
```

### 3.2 解决方案：构建专用 tsconfig

NestJS CLI（`nest build`）按以下顺序查找配置：

1. `nest-cli.json` 的 `tsConfigPath` 指定
2. **存在 `tsconfig.build.json` → 优先使用** ✅
3. 否则用 `tsconfig.json`

创建只包含 `src/` 的构建配置：

```jsonc
// apps/api/tsconfig.build.json
{
  "extends": "./tsconfig.json",   // 继承基础配置（含正确的 paths）
  "compilerOptions": {
    "declaration": false,          // 应用代码不需要生成 .d.ts
  },
  "include": ["src/**/*"],         // ← 只编译 src/，不包含 scripts/
  "exclude": [
    "node_modules",
    "dist",
    "test",
    "scripts",
    "**/*.spec.ts",
    "**/*.test.ts",
    "**/*.e2e-spec.ts",
  ],
}
```

**最终 rootDir 推断：**

```
include: ["src/**/*"] only
→ rootDir 推断为 apps/api/src/
→ src/main.ts → dist/main.js       ← ✅ 完美
→ src/common/xxx.ts → dist/common/xxx.js  ← ✅
```

> **关键洞察**：`tsconfig.build.json` 的核心作用不仅是排除测试文件，更重要的是**通过限制 `include` 来控制 rootDir**。

---

## 4. 三层 tsconfig 架构设计

在实际项目中，我们维护了三个独立的 tsconfig 文件，各司其职：

```
apps/api/
├── tsconfig.json          # IDE + 类型检查
│   ├── include: src/**/*, scripts/**/*.ts
│   ├── paths: @lucky/shared → dist/（声明文件）
│   └── 用于: tsc --noEmit（--noEmit 时 rootDir 不影响输出）
│
├── tsconfig.build.json    # nest build 专用
│   ├── include: src/**/*（只含 src）
│   └── 用于: nest build → dist/main.js
│
└── tsconfig.cli.json      # 脚本编译专用
    ├── include: scripts/cli/**/*.ts, scripts/seed/**/*.ts
    ├── outDir: ./dist/cli
    └── 用于: tsc -p apps/api/tsconfig.cli.json
```

### 4.1 第一层：`tsconfig.json`（IDE）

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "declaration": false },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "scripts", "**/*.spec.ts", "**/*.test.ts", "**/*.e2e-spec.ts"]
}
```

- **用途**：VS Code、WebStorm 的智能提示，以及 CI 中的 `tsc --noEmit`
- **为什么 safe**：`--noEmit` 模式下 rootDir 不影响实际输出
- **包含 scripts**：让 IDE 能为 seed 脚本提供类型检查

### 4.2 第二层：`tsconfig.build.json`（构建）

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "declaration": false },
  "include": ["src/**/*"],
  "exclude": [
    "node_modules", "dist", "test", "scripts",
    "**/*.spec.ts", "**/*.test.ts", "**/*.e2e-spec.ts"
  ]
}
```

- **用途**：`nest build` 生产构建
- **关键约束**：`include: ["src/**/*"]` 确保 rootDir = `apps/api/src/`
- **自动选中**：NestJS CLI 优先检测 `tsconfig.build.json`

### 4.3 第三层：`tsconfig.cli.json`（脚本）

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist/cli",
    "noEmit": false,
    "strict": false,
    "module": "commonjs"
  },
  "include": ["scripts/cli/**/*.ts", "scripts/seed/**/*.ts"]
}
```

- **用途**：编译 CLI 管理工具和数据库 seed 脚本
- **独立输出**：`outDir: ./dist/cli`，与主应用产物隔离
- **宽松校验**：`strict: false`，脚本不需要极致的类型安全

---

## 5. 共享包修改后的必要操作

`tsconfig.json` 的 `paths` 指向 `dist/`，意味着 IDE 和编译器使用的是**编译产物**而不是源码。

### 5.1 手动重建

```bash
# 修改 packages/shared/src/ 任意文件后，必须重新构建：
yarn workspace @lucky/shared build

# 或者直接运行构建脚本：
node packages/shared/scripts/build.js
```

### 5.2 不重建的后果

| 问题 | 表现 |
|------|------|
| IDE 类型过时 | 查看 `packages/shared/dist/index.d.ts`，发现是旧版本 |
| `check-types` 报错 | `dist` 和 `src` 不同步，新导出的类型找不到 |
| 运行时错误 | `dist/` 产物没有新函数，但代码已经调用了 |

### 5.3 Docker 构建中的自动处理

在 Docker 构建流程中，这一步已经自动化：

```dockerfile
# Dockerfile 中的关键步骤
RUN yarn workspaces focus --all --production
RUN tsc -p packages/shared/tsconfig.json  # 先构建 shared
RUN nest build apps/api                     # 再构建 api
```

但本地开发时，需要手动执行 `yarn workspace @lucky/shared build`。

---

## 6. 容器启动失败诊断清单

当 Docker 容器启动报 `MODULE_NOT_FOUND` 时，按顺序检查：

```bash
# 1. 确认 dist/main.js 的实际位置
docker run --rm --entrypoint="" <image> find apps/api/dist -name "main.js"

# 期望输出：apps/api/dist/main.js
# 如果是：apps/api/dist/apps/api/src/main.js → paths 指向了 .ts
# 如果是：apps/api/dist/src/main.js → tsconfig.build.json 包含了 scripts/

# 2. 检查 tsconfig.json 的 paths
grep -A3 '"@lucky/shared"' apps/api/tsconfig.json
# 期望路径中的最后一个目录是 "dist" 而不是 "src"

# 3. 检查 tsconfig.build.json 的 include
grep '"include"' apps/api/tsconfig.build.json
# 期望：["src/**/*"]
```

### 诊断决策树

```
dist/main.js 不存在？
├─ find 命令没输出 → 构建步骤失败了
│  └─ 检查 nest build 日志
│
└─ find 输出路径不对？
   ├─ apps/api/src/main.js
   │  └─ tsconfig.build.json 的 include 包含了 scripts/ → 移除
   │
   └─ apps/api/src/main.js
      └─ tsconfig.json 的 paths 指向了 .ts → 改为 .d.ts
```

---

## 7. 常见误区一览

| 误区 | 真相 |
|------|------|
| "Monorepo 不能共享 tsconfig" | 可以，`packages/typescript-config/` 提供基础配置，各 app 通过 `extends` 继承 |
| "`paths` 指向 `src/` 可以让 IDE 跳到源码" | 代价是破坏 `rootDir`；用 Project References 才能同时满足 IDE 跳转和正确编译 |
| "`tsconfig.build.json` 只是排除测试文件" | 还必须限制 `include` 只含 `src/`，否则 `scripts/` 会影响 rootDir |
| "TypeScript 只用 `.d.ts` 做类型检查，不会输出它" | 正确，这是解决方案的核心：paths 指向 `.d.ts` 才安全 |
| "`nest-cli.json` 必须配 `tsConfigPath`" | 不配也行，NestJS CLI 会自动检测 `tsconfig.build.json` |

---

## 8. 面试要点

### Q：为什么 `paths` 指向 `.ts` 会导致 rootDir 异常？

因为 TypeScript 编译器会**将所有被 `paths` 解析到的 `.ts` 文件纳入编译输入**，而编译输入决定了 `rootDir`。当编译输入来自多个不相关的目录时，TypeScript 会选择它们的最近公共祖先作为 `rootDir`，导致输出路径嵌套。

### Q：三个 tsconfig 文件的设计思路是什么？

**关注点分离**：
- `tsconfig.json`：IDE 体验优先，覆盖尽可能多的文件（含 scripts）
- `tsconfig.build.json`：生产构建优先，严格控制编译范围
- `tsconfig.cli.json`：独立工具优先，使用宽松的类型校验

### Q：`tsconfig.build.json` 的 `include` 为什么不能包含 `scripts/`？

`include: ["src/**/*", "scripts/**/*.ts"]` 会让 TypeScript 推断 rootDir 为 `apps/api/` 而不是 `apps/api/src/`，导致输出路径变成 `dist/src/main.js`。NestJS 的 Docker 入口期望的是 `dist/main.js`。

---

## 9. 总结

TypeScript Monorepo 配置的陷阱源于一个核心问题：**rootDir 的隐式推断**。解决方案是三层防御：

1. **路径层**：`paths` 指向 `.d.ts`（声明文件），避免源码被二次编译
2. **构建层**：`tsconfig.build.json` 用严格限制的 `include` 控制 rootDir
3. **工具层**：`tsconfig.cli.json` 为脚本提供独立的编译通道

这三个层次的配置组合在一起，既保证了 IDE 的开发体验，又确保了生产构建的正确性。

---

*参考：TypeScript 官方文档 [rootDir](https://www.typescriptlang.org/tsconfig#rootDir) / [paths](https://www.typescriptlang.org/tsconfig#paths)*
