# Monorepo TypeScript 配置指南

> **适用范围**：`apps/api`（NestJS）跨包引用 `packages/shared` 的正确 tsconfig 写法。  
> **事故背景**：2026-03-21，`dist/main.js` 路径错误嵌套导致容器启动失败，详见 `DEPLOY_INCIDENT_20260321_CN.md`。

---

## 一、为什么 Monorepo 里 `paths` 要指向 `dist/` 而不是 `src/`

### 问题演示

```jsonc
// apps/api/tsconfig.json — 错误写法 ❌
{
  "compilerOptions": {
    "outDir": "./dist",
    "paths": {
      "@lucky/shared": ["../../packages/shared/src/index.ts"], // .ts 源码
    },
  },
  "include": ["src/**/*", "scripts/**/*.ts"],
}
```

**TypeScript 的行为**：

1. 解析 `@lucky/shared` → 找到 `packages/shared/src/index.ts`（`.ts` 文件）
2. `.ts` 文件被纳入**编译输出**，不只是类型检查
3. 现在编译的文件同时来自 `apps/api/src/` 和 `packages/shared/src/`
4. TypeScript 找公共祖先目录作为 `rootDir` → 推断为 **monorepo 根**（`/app/`）
5. 输出路径 = `outDir` + 相对于 `rootDir` 的路径：
   - `apps/api/src/main.ts` → `dist/apps/api/src/main.js` ❌（期望 `dist/main.js`）
   - `packages/shared/src/index.ts` → `dist/packages/shared/src/index.js` ❌

### 正确写法

```jsonc
// apps/api/tsconfig.json — 正确写法 ✅
{
  "compilerOptions": {
    "outDir": "./dist",
    "paths": {
      "@lucky/shared": ["../../packages/shared/dist/index"], // .d.ts 声明文件
      "@lucky/shared/*": ["../../packages/shared/dist/*"],
    },
  },
}
```

**TypeScript 的行为**：

1. 解析 `@lucky/shared` → 找到 `packages/shared/dist/index.d.ts`（`.d.ts` 文件）
2. `.d.ts` 文件**只用于类型检查，不纳入编译输出，不计入 rootDir**
3. rootDir 只由 `apps/api/src/` 和 `apps/api/scripts/` 决定 → 正确推断为 `apps/api/`
4. 输出路径正确：`src/main.ts` → `dist/src/main.js`（但还不对，见下节）

---

## 二、为什么 `tsconfig.build.json` 必须只含 `src/`

即使 `paths` 已经指向 `dist/`，`tsconfig.json` 的 `include` 里有 `scripts/**/*.ts`，仍然会影响 `nest build` 的 rootDir：

```
include: ["src/**/*", "scripts/**/*.ts"]
→ rootDir 推断为 apps/api/（src/ 和 scripts/ 的公共祖先）
→ src/main.ts 输出到 dist/src/main.js  ← 还是不对！
```

**解决方案**：`nest build` 使用单独的 `tsconfig.build.json`，只含 `src/`：

```jsonc
// apps/api/tsconfig.build.json
{
  "extends": "./tsconfig.json", // 继承基础配置（含正确的 paths）
  "compilerOptions": {
    "declaration": false, // 应用代码不需要生成 .d.ts
  },
  "include": ["src/**/*"], // ← 只编译 src/，rootDir 推断为 apps/api/src/
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

**最终 rootDir 推断结果**：

```
include: ["src/**/*"] only
→ rootDir 推断为 apps/api/src/
→ src/main.ts → dist/main.js ✅
→ src/common/xxx.ts → dist/common/xxx.js ✅
```

### NestJS CLI 如何选择 tsconfig

NestJS CLI (`nest build`) 按以下顺序查找配置：

1. `nest-cli.json` 里指定了 `tsConfigPath` → 用指定的
2. **存在 `tsconfig.build.json` → 优先使用**（当前项目走这条）
3. 否则用 `tsconfig.json`

本项目 `nest-cli.json` 未指定 `tsConfigPath`，所以 `tsconfig.build.json` 自动生效。

---

## 三、三个 tsconfig 的职责分工

```
apps/api/
├── tsconfig.json          # IDE + check-types 用
│                          # include: ["src/**/*", "scripts/**/*.ts"]
│                          # paths: @lucky/shared → dist/（声明文件）
│                          # 用于: tsc --noEmit（--noEmit 时 rootDir 不影响输出）
│
├── tsconfig.build.json    # nest build 专用
│                          # include: ["src/**/*"] 只含 src
│                          # 用于: nest build → dist/main.js ✅
│
└── tsconfig.cli.json      # 脚本编译专用
                           # include: ["scripts/cli/**/*.ts", "scripts/seed/**/*.ts"]
                           # outDir: ./dist/cli
                           # 用于: tsc -p apps/api/tsconfig.cli.json
```

---

## 四、`packages/shared` 修改后的必要操作

`tsconfig.json` 的 `paths` 指向 `dist/`，意味着 IDE 和编译器使用的是**编译产物**，不是源码。

```bash
# 修改 packages/shared/src/ 任意文件后，必须重新构建：
node packages/shared/scripts/build.js

# 或者（等效）：
yarn workspace @lucky/shared build
```

**不重建的后果**：

- IDE 仍显示旧的类型（看 `dist/index.d.ts`）
- `check-types` 可能报错（因为 dist 和 src 不同步）
- Docker 构建里已有 Step 5 `tsc -p packages/shared/tsconfig.json` 自动处理

---

## 五、诊断清单（容器启动失败时的检查顺序）

```bash
# 1. 确认 dist/main.js 在哪
docker run --rm --entrypoint="" <image> find apps/api/dist -name "main.js"

# 期望输出：apps/api/dist/main.js
# 如果是：apps/api/dist/apps/api/src/main.js → paths 指向了 .ts
# 如果是：apps/api/dist/src/main.js → tsconfig.build.json 包含了 scripts/

# 2. 检查 tsconfig.json 的 paths
grep -A3 '"@lucky/shared"' apps/api/tsconfig.json
# 期望：指向 dist/index 或 dist/*.d.ts

# 3. 检查 tsconfig.build.json 的 include
grep '"include"' apps/api/tsconfig.build.json
# 期望：["src/**/*"]
```

---

## 六、常见误区

| 误区                                             | 真相                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| "monorepo 不能共享 tsconfig"                     | 可以共享，本项目 `packages/typescript-config/` 已提供基础配置               |
| "`paths` 指向 `src/` 可以让 IDE 跳到源码"        | 代价是破坏 `rootDir`；用 Project References 才能同时满足 IDE 跳转和正确编译 |
| "`tsconfig.build.json` 只是排除测试文件"         | 还必须限制 `include` 只含 `src/`，否则 `scripts/` 会影响 rootDir            |
| "TypeScript 只用 `.d.ts` 做类型检查，不会输出它" | ✅ 正确，这是解决方案的核心：paths 指向 `.d.ts` 才安全                      |

---

## 七、参考

- 事故复盘：`read/DEPLOY_INCIDENT_20260321_CN.md`（问题 6c + 6d + rootDir 嵌套）
- 相关文件：`apps/api/tsconfig.json`、`apps/api/tsconfig.build.json`、`apps/api/tsconfig.cli.json`
- TypeScript 官方文档：[rootDir](https://www.typescriptlang.org/tsconfig#rootDir) / [paths](https://www.typescriptlang.org/tsconfig#paths)
