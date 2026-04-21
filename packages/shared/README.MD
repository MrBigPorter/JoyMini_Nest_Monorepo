# @lucky/shared · 新手友好入门手册（优化版）

> 这是一个“**共享库包**”：放**纯函数、类型、常量**与**协议（DTO/Response 类型）**，供 Next/Nest 等复用。

---

## 0. 我是谁？

* 角色：mono‑repo 里的 **共享库（library）**，不是服务，不会监听端口。
* 产出：编译后的 **CommonJS** 代码（`dist/*.js`）和 **类型声明**（`dist/*.d.ts`）。
* 使用方：`apps/web`（Next）、`apps/api`（Nest）等。

---

## 1) TL;DR（30 秒跑一次）

```bash
# 安装依赖（在仓库根目录）
yarn install

# 编译 shared（在根目录执行即可）
yarn workspace @lucky/shared build
```

**验收**：出现 `packages/shared/dist/index.js` 和 `packages/shared/dist/index.d.ts`。

---

## 2) 目录结构（最小版）

```
packages/shared/
  src/
    index.ts           # 导出集合（统一出口）
    types.ts           # 共享类型（ApiResponse、User 等）
    utils/format.ts    # 纯函数（如 formatCurrency）
  dist/                # 构建产物（自动生成）
  package.json         # 包信息与脚本（见下）
  tsconfig.json        # TS 配置（继承根 base）
```

**示例：**

```ts
// src/types.ts
export type ApiResponse<T> = { code: number; message: string; data: T };
export type User = { id: string; name: string };

// src/utils/format.ts
export function formatCurrency(n: number, c = 'PHP') {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: c }).format(n);
}

// src/index.ts
export * from './types';
export * from './utils/format';
export const SHARED_VERSION = '0.1.0';
```

---

## 3) package.json（已配置好，了解一下含义）

```json
{
  "name": "@lucky/shared",
  "private": false,
  "type": "commonjs",          
  "main": "dist/index.js",     
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "dev": "tsc -w -p tsconfig.json",
    "build": "rimraf dist && tsc -p tsconfig.json",
    "clean": "rimraf dist"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "rimraf": "^6.0.1"
  }
}
```

* `type: "commonjs"`：当前产物走 CJS，Nest/Next 都能消费（最稳）。
* `main/types`：分别指向 JS 入口与类型入口。
* `sideEffects: false`：方便打包器 tree‑shaking。

> 需要 **ESM + CJS 双产物**？见文末【进阶：用 tsup 出双入口】。

---

## 4) tsconfig.json（关键项解释）

```json
{
  "extends": "../../config/tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,      
    "declarationMap": true,   
    "sourceMap": true,        
    "types": ["node"]        
  },
  "include": ["src"]
}
```

* `declaration: true` → 产出 `.d.ts`（让使用方拿到类型）。
* `declarationMap: true` → `.d.ts.map` 方便跳转到 TS 源码。
* `sourceMap: true` → 运行时报错能映射回 TS 源码（开发友好）。
* `types: ["node"]` → 允许在库里使用**类型层面的** Node 声明（*注意：不是让你写 Node 运行时代码*）。

> **原理（构建流）**
>
> 1. `tsc` 读取本包 `tsconfig.json`，通过 `extends` 合并根 `config/tsconfig.base.json`。
> 2. 扫描 `include`（`src`）建立 Program（类型检查）。
> 3. 按 `module: CommonJS` 输出到 `outDir: dist`，并生成 `.d.ts`。
> 4. 其它包通过 Yarn `workspace:*` 直接解析到本地 `dist/` 与 `types`。

---

## 5) 规则（放什么/不放什么）

 **应该放**

* 类型与协议：`User`, `Coupon`, `ApiResponse<T>` …
* 纯函数：**无浏览器/Node 依赖**（如 `formatCurrency`、`isPhone`、`parseLocale`）
* 常量/枚举：`Currency.PHP`, `Locale.EN`, `ROUTES` …

❌ **不应该放**

* 浏览器专属 API：`window`, `document`, `localStorage` …（会让 Nest 构建/运行报错）
* Node 运行时专属：`fs`, `path`, `crypto`（会让 Next 打包失败）
* UI/React Hooks/组件（这些放 web 包）

> 目的：**一份代码，两端可用**。只要你坚持“纯函数 + 类型 + 常量”，就不会炸。

---

## 6) 在其它包里使用（Nest / Next）

在消费者包 `package.json`：

```json
{
  "dependencies": {
    "@lucky/shared": "workspace:*"
  }
}
```

代码里：

```ts
// Next/Nest 都通用
import { formatCurrency, ApiResponse } from '@lucky/shared';

// Nest 里使用
type R = ApiResponse<{ id: string }>; // 有类型提示
```

---

## 7) 常见问题 & 排查

* **没有生成 dist** → 看 `tsconfig.json` 是否误继承了根 base 里的 `noEmit: true`（base 不应包含该项）。
* **构建提示顶层非法字段** → 确认根 `config/tsconfig.base.json` 没有多余字段（如以前的 `version`）。
* **Next 里导入报错** → 检查本包是否意外引入了 Node 运行时 API（`fs`/`crypto`）。
* **Nest 里导入报错** → 检查是否引入了 DOM 类型或使用了浏览器 API。库包不要加 `lib: ["DOM"]`。
* **import 进来没有类型** → 看本包 `types` 字段是否指向 `dist/index.d.ts`；确认 `declaration: true`。
* **Tree‑shaking 不生效** → 确认 `sideEffects: false`，并确保消费者侧使用 ESM 打包链（Next/Vite 默认 OK）。

调试技巧：

```bash
# 打印最终生效的 TS 配置（定位覆盖问题）
yarn -s tsc -p packages/shared/tsconfig.json --showConfig
```

---

## 8) 验收清单（合格即可打勾）

* [ ] 执行 `yarn workspace @lucky/shared build` 生成 `dist/`（含 `.js` 与 `.d.ts`）。
* [ ] 在 `apps/web` / `apps/api` 成功 `import` 并获得类型提示。
* [ ] `@lucky/shared` 未引用浏览器或 Node 运行时 API（纯函数过审）。
* [ ] `package.json` 的 `main/types` 路径正确，`sideEffects:false` 已设置。

---

## 9) 进阶：用 tsup 做 ESM + CJS 双产物（可选）

当需要“前端优先走 `import`（ESM）且后端还能 `require`”时，可用 `tsup` 一把梭：

```bash
yarn workspace @lucky/shared add -D tsup
```

`package.json`

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "default": "./dist/index.mjs"
    }
  },
  "main": "dist/index.cjs",
  "module": "dist/index.mjs",
  "scripts": {
    "build": "rimraf dist && tsup src/index.ts --dts --format esm,cjs --out-dir dist"
  }
}
```

> 初期不必强求；当前 CJS 方案已经满足 Next/Nest 的常见需求。

---

## 10) FAQ

**Q: 我能不能在 shared 里放 `Date`/`Intl` 这些全局？**
A: 可以，它们既存在于浏览器也存在于 Node（属于标准平台能力）。

**Q: 为什么要坚持“纯函数”？**
A: 这样 shared 才能被两端同时消费，不会因为某一端缺少运行时而报错。

**Q: 我应该如何组织导出？**
A: 统一从 `src/index.ts` 导出（再从这里分模块导出），方便消费者按需引入与 IDE 自动补全。
