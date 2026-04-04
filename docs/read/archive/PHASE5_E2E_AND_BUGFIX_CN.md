# Phase 5 — E2E 测试补全 & OperationLogList Bug 修复

> **文档定位**：今日工作记录（2026-03-17），涵盖完成内容、发现的 Bug、根本原因分析与修复方式。  
> **改动范围**：`apps/admin-next/src/__e2e__/`（新增 9 个文件，更新 2 个）+ `src/views/OperationLogList.tsx`  
> **前置文档**：[自动化测试指南](./TESTING_CN.md)

---

## 目录

1. [今日完成内容总览](#一今日完成内容总览)
2. [E2E 测试补全](#二e2e-测试补全)
   - [测试覆盖策略](#21-测试覆盖策略)
   - [新增文件一览](#22-新增文件一览)
   - [各页面覆盖要点](#23-各页面覆盖要点)
   - [auth.setup.ts 路由预热更新](#24-authsetupts-路由预热更新)
3. [Bug 修复：RangeError Invalid time value](#三bug-修复rangeerror-invalid-time-value)
   - [问题现象](#31-问题现象)
   - [根本原因](#32-根本原因)
   - [SmartTable render 签名解析](#33-smarttable-render-签名解析)
   - [修复方案](#34-修复方案)
   - [衍生防御：safeFormat 工具函数](#35-衍生防御safeformat-工具函数)
4. [文件变更清单](#四文件变更清单)
5. [常见坑与防范原则](#五常见坑与防范原则)

---

## 一、今日完成内容总览

| 类别     | 内容                                                      | 状态    |
| -------- | --------------------------------------------------------- | ------- |
| E2E 测试 | 为 Phase 5 所有新页面补齐 E2E spec 文件（9 个）           | ✅ 完成 |
| E2E 测试 | `auth.setup.ts` 路由预热列表新增 9 条 Phase 5 路由        | ✅ 完成 |
| E2E 测试 | `navigation.spec.ts` 导航冒烟测试新增 9 条路由            | ✅ 完成 |
| Bug 修复 | `OperationLogList.tsx` — `RangeError: Invalid time value` | ✅ 完成 |

---

## 二、E2E 测试补全

### 2.1 测试覆盖策略

项目 E2E 测试遵循**"冒烟测试为主，关键交互为辅"**的原则。对于每一个新页面，至少覆盖以下层次：

```
Level 1 — 基础可用性
  ✓ 页面不崩溃（无 Application error）
  ✓ 页面标题 / 主要文字可见

Level 2 — 核心 UI 元素
  ✓ 表格 / 列表渲染
  ✓ 过滤器（select、input）可见且可交互
  ✓ 刷新 / Search / Reset 按钮可点击

Level 3 — 交互流
  ✓ 点击"新建"按钮弹出 Modal / Drawer
  ✓ Modal 中包含预期的表单字段
  ✓ 关闭弹窗后回到列表（无崩溃）
```

这个策略的核心出发点是：**E2E 测试运行在真实网络环境下，数据随时可变**。我们不测试具体的数据内容，而是测试"页面能正常呈现"和"用户的基本操作流程能走通"。

### 2.2 新增文件一览

```
apps/admin-next/src/__e2e__/
├── ads.spec.ts            ← Phase 5-A 广告管理 /ads
├── flash-sale.spec.ts     ← Phase 5-B 秒杀活动 /flash-sale
├── settings.spec.ts       ← Phase 5-C 系统配置 /settings
├── im.spec.ts             ← Phase 5-D 客服接待台 /im
├── login-logs.spec.ts     ← Phase 5-E 登录日志 /login-logs
├── analytics.spec.ts      ← 数据分析 /analytics
├── notifications.spec.ts  ← 推送通知 /notifications
├── roles.spec.ts          ← RBAC 角色管理 /roles
└── operation-logs.spec.ts ← 操作日志 /operation-logs
```

### 2.3 各页面覆盖要点

#### `/ads/` — 广告管理

| 测试用例    | 关键断言                                                           |
| ----------- | ------------------------------------------------------------------ |
| 页面加载    | `body` 不含 `Application error`                                    |
| 标题        | `getByText(/advertisements/i)` 可见                                |
| 表格列头    | `Preview` / `Title` / `Position` 三列头可见                        |
| 过滤器      | 至少 2 个 `<select>` — 状态 + 位置；位置 select 含 `All Positions` |
| New Ad 按钮 | 按钮可见，点击后 `.fixed.inset-0` 弹层出现                         |
| 弹窗字段    | `Ad Position` 文字可见                                             |

#### `/flash-sale/` — 秒杀活动

| 测试用例         | 关键断言                        |
| ---------------- | ------------------------------- |
| 标题             | `Flash Sale` 可见               |
| 场次计数         | `session(s)` 文字可见           |
| New Session 按钮 | 点击后弹层出现                  |
| 弹窗字段         | `Start Time` / `End Time` 可见  |
| 关闭弹窗         | `Escape` 键关闭后列表仍正常显示 |

#### `/settings/` — 系统配置

| 测试用例    | 关键断言                                  |
| ----------- | ----------------------------------------- |
| 标题        | `System Config` 可见                      |
| config 计数 | `config item(s)` 可见（API 返回后填充）   |
| 数据行      | `exchange_rate` 相关条目可见（Seed 数据） |
| 编辑按钮    | 至少 1 个含 `svg` 的按钮可见              |
| 页脚提示    | `Press … Enter … to save` 文字可见        |

#### `/im/` — 客服接待台

| 测试用例    | 关键断言                                             |
| ----------- | ---------------------------------------------------- |
| 双栏布局    | `conversation` 相关文字可见                          |
| 右侧空态    | `Select a conversation` 占位文字可见（未选中会话时） |
| Socket 状态 | `Live` / `Connecting` / `Polling` 三者其一可见       |
| 点击会话    | 若有会话条目，点击后空态消失（聊天窗口出现）         |

> **说明**：IM 页面状态依赖实时数据，测试均有 `catch` 非致命降级——如果没有会话数据，仅验证空态。

#### `/login-logs/` — 登录日志

| 测试用例       | 关键断言                                |
| -------------- | --------------------------------------- |
| 表格列头       | `User` / `Time` / `IP` 可见             |
| User ID 输入框 | placeholder `/user id/i` 可见，可输入   |
| IP 输入框      | placeholder `/ip/i` 可见，可输入        |
| 状态 select    | 含 `All` 选项                           |
| Search / Reset | 按钮可点击                              |
| 状态徽章       | 若有数据，`Success` / `Failed` 徽章可见 |

#### `/analytics/` — 数据分析

| 测试用例 | 关键断言                                       |
| -------- | ---------------------------------------------- |
| 标题     | `Data Analytics` 可见（SSR 服务端渲染，秒出）  |
| 统计卡片 | `users` 相关文字可见                           |
| 趋势图表 | `trend` / `revenue` 相关文字可见（客户端渲染） |

#### `/notifications/` — 推送通知

| 测试用例 | 关键断言                                           |
| -------- | -------------------------------------------------- |
| 标题     | `notification` / `push` 可见                       |
| 设备卡片 | `Android` / `iOS` / `device` 可见                  |
| 广播表单 | `Broadcast` 标签、`Title` label、`Body` label 可见 |
| 发送按钮 | `Send Broadcast` / `Broadcast` 按钮可见            |
| 日志区域 | `push log` / `history` / `log` 可见                |

#### `/roles/` — RBAC 角色管理

| 测试用例 | 关键断言                                         |
| -------- | ------------------------------------------------ |
| 标题     | `Roles` 可见                                     |
| 角色卡片 | `SUPER_ADMIN` / `ADMIN` 可见                     |
| 用户计数 | `users?$` 正则匹配（如 `3 users`）               |
| 内联面板 | 点击角色卡后 `members` / `users in` 相关文字出现 |

#### `/operation-logs/` — 操作日志

| 测试用例       | 关键断言                |
| -------------- | ----------------------- |
| 标题           | `Operation Log` 可见    |
| 表格列头       | `admin` / `action` 可见 |
| 类型过滤       | `<select>` 存在         |
| Search / Reset | 按钮可点击              |

### 2.4 auth.setup.ts 路由预热更新

**为什么需要路由预热？**

项目使用 Next.js Turbopack。每个路由在首次访问时，Turbopack 需要**即时编译（JIT compile）**该路由的所有依赖，耗时可达 30–120 秒（冷启动）。

如果不预热直接跑业务 spec，Playwright 超时（默认 2 分钟）会在编译完成前触发，导致误报"页面加载失败"。

**解决方案**：在 `auth.setup.ts` 中，登录成功后按顺序访问所有路由，触发一次性编译，后续 spec 直接使用已编译的缓存，执行时间从 "120s/page" 降至 "1-2s/page"。

```typescript
// Before（仅预热旧页面）
const WARMUP_ROUTES = [
  "/",
  "/orders/",
  "/users/",
  "/products/",
  "/categories/",
  "/banners/",
  "/finance/",
  "/marketing/",
  "/kyc/",
  "/groups/",
  "/admin-users/",
  "/address/",
  "/act/section/",
  "/payment/channels/",
];

// After（新增 Phase 5 页面）
const WARMUP_ROUTES = [
  // ... 以上所有旧路由
  "/ads/",
  "/flash-sale/",
  "/settings/",
  "/im/",
  "/login-logs/",
  "/analytics/",
  "/notifications/",
  "/roles/",
  "/operation-logs/",
];
```

---

## 三、Bug 修复：RangeError Invalid time value

### 3.1 问题现象

打开操作日志页面（`/operation-logs/`）时，控制台报错并触发 Next.js Error Boundary：

```
Runtime RangeError
Invalid time value

src/views/OperationLogList.tsx (131:23) @ OperationLogList.useMemo[columns] [as render]

  129 |           <div className="text-xs text-gray-500 whitespace-nowrap">
  130 |             {date
> 131 |               ? format(new Date(date as string), 'yyyy-MM-dd HH:mm:ss')
      |                       ^
  132 |               : '—'}
  133 |           </div>
```

页面显示全屏错误覆盖层，无法正常使用。

### 3.2 根本原因

**核心误解：`render` 函数的第一个参数不是原始数据，而是已渲染的 ReactNode。**

出错代码：

```typescript
// OperationLogList.tsx — 错误写法
{
  title: 'Time',
  dataIndex: 'createdAt',
  valueType: 'dateTime',
  render: (date) => (            // ❌ date 是 ReactNode，不是字符串！
    <div>
      {date
        ? format(new Date(date as string), 'yyyy-MM-dd HH:mm:ss')  // 💥 崩溃
        : '—'}
    </div>
  ),
},
```

开发者以为 `date` 是来自数据库的 ISO 日期字符串（如 `"2026-03-17T08:00:00.000Z"`），
实际上 `SmartTable` 在调用 `render` 之前，已经先将原始值用 `renderSmartCell` 处理成 React 元素：

```tsx
// SmartTable.tsx — renderSmartCell 对 dateTime 类型的处理
case 'dateTime':
  return (
    <span className="text-gray-500 text-xs">
      {TimeHelper.formatDateTime(text)}  // 已格式化的字符串
    </span>
  );
```

所以 `render` 的第一个参数是 `<span class="text-gray-500 text-xs">2026-03-17 08:00:00</span>` 这样一个 React 元素对象，而不是原始字符串。

`new Date(<React Element>)` → `new Date("[object Object]")` → `Invalid Date` → `format()` 抛出 `RangeError`。

### 3.3 SmartTable render 签名解析

```typescript
// packages/shared 或 SmartTable/types.ts
export type ProColumns<T = any> = {
  // ...
  render?: (
    dom: ReactNode, // ← 第 1 个参数：已渲染的 DOM（ReactNode）
    entity: T, // ← 第 2 个参数：完整的原始数据行对象
    index: number,
    action?: ActionType,
  ) => ReactNode;
};
```

| 参数     | 类型          | 含义                                                                               |
| -------- | ------------- | ---------------------------------------------------------------------------------- |
| `dom`    | `ReactNode`   | SmartTable 按 `valueType` 规则预先渲染好的单元格内容（`renderSmartCell` 的返回值） |
| `entity` | `T`（行数据） | `dataSource` 里的原始对象，即数据库返回的 JSON                                     |
| `index`  | `number`      | 当前行索引                                                                         |

这与 Ant Design ProTable 的 `render` API 完全一致，属于约定俗成的模式。

**调用链路**（SmartTable.tsx 内部）：

```
数据行 row.createdAt = "2026-03-17T08:00:00.000Z"
          ↓
renderSmartCell(rawValue, 'dateTime')
          ↓ 返回
<span class="text-gray-500 text-xs">2026-03-17 08:00:00</span>
          ↓ 作为 dom 参数
col.render(dom, row, index)
          ↓
开发者在 render 里拿到的第一个参数 = ReactNode，不是字符串
```

### 3.4 修复方案

**方案**：将 `render` 的第一个参数命名为 `_dom`（忽略），从第二个参数 `row` 直接取 `row.createdAt` 原始值。

```typescript
// ✅ 修复后
{
  title: 'Time',
  dataIndex: 'createdAt',
  valueType: 'dateTime',
  render: (_dom, row) => (               // _dom 忽略，row 是原始数据对象
    <div className="text-xs text-gray-500 whitespace-nowrap">
      {safeFormat(row.createdAt, 'yyyy-MM-dd HH:mm:ss')}
    </div>
  ),
},
```

同时将 View 详情弹窗中的日期格式化也统一走 `safeFormat`：

```typescript
// 弹窗内 Time 字段
<div>
  <span className="font-semibold">Time: </span>
  {safeFormat(row.createdAt, 'yyyy-MM-dd HH:mm:ss')}  // ✅
</div>
```

### 3.5 衍生防御：safeFormat 工具函数

修复过程中意识到，即便拿到了正确的字符串，也可能遇到以下情况：

- 数据库返回 `null`（已离职管理员的日志行）
- 数据库返回空字符串 `""`
- 时区处理异常导致的非法日期
- 旧数据格式不符合 ISO 8601

因此引入了一个简单的防御函数：

```typescript
import { format, isValid, parseISO } from "date-fns";

/** Safe date formatter — returns '—' for null, undefined, or invalid dates */
function safeFormat(val: string | null | undefined, fmt: string): string {
  if (!val) return "—"; // 空值直接返回占位符
  const d = parseISO(val); // date-fns 的 ISO 解析（比 new Date() 更严格）
  return isValid(d) ? format(d, fmt) : "—"; // 无效日期返回占位符，不抛错
}
```

**为什么用 `parseISO` 而不是 `new Date()`？**

|                    | `new Date(str)`             | `parseISO(str)`                 |
| ------------------ | --------------------------- | ------------------------------- |
| 对 `"invalid"`     | 返回 `Invalid Date`         | 返回 `Invalid Date`             |
| 对 `""`            | 返回 `Invalid Date`         | 返回 `Invalid Date`             |
| 对 ISO 8601 字符串 | ✅ 有效（但行为与环境有关） | ✅ 有效（行为确定，跨时区一致） |
| 对 `"2026-03-17"`  | ⚠️ 某些环境解析为 UTC 00:00 | ✅ 始终解析为本地 00:00         |
| 异常处理           | 不抛错，返回 Invalid Date   | 不抛错，返回 Invalid Date       |

**结论**：`parseISO` + `isValid` 的组合是 date-fns 生态中处理任意来源日期字符串的最佳实践。

---

## 四、文件变更清单

### E2E 新增文件

| 文件                                 | 行数 | 用途           |
| ------------------------------------ | ---- | -------------- |
| `src/__e2e__/ads.spec.ts`            | ~90  | 广告管理页 E2E |
| `src/__e2e__/flash-sale.spec.ts`     | ~90  | 秒杀活动页 E2E |
| `src/__e2e__/settings.spec.ts`       | ~58  | 系统配置页 E2E |
| `src/__e2e__/im.spec.ts`             | ~88  | 客服接待台 E2E |
| `src/__e2e__/login-logs.spec.ts`     | ~87  | 登录日志页 E2E |
| `src/__e2e__/analytics.spec.ts`      | ~50  | 数据分析页 E2E |
| `src/__e2e__/notifications.spec.ts`  | ~65  | 推送通知页 E2E |
| `src/__e2e__/roles.spec.ts`          | ~63  | 角色管理页 E2E |
| `src/__e2e__/operation-logs.spec.ts` | ~70  | 操作日志页 E2E |

### E2E 更新文件

| 文件                             | 变更内容                               |
| -------------------------------- | -------------------------------------- |
| `src/__e2e__/auth.setup.ts`      | `WARMUP_ROUTES` 新增 9 条 Phase 5 路由 |
| `src/__e2e__/navigation.spec.ts` | `routes` 数组新增 9 条路由冒烟测试     |

### Bug 修复文件

| 文件                             | 变更内容                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/views/OperationLogList.tsx` | 新增 `safeFormat` 工具函数；Time 列 `render(date)` → `render(_dom, row)`；import 增加 `isValid, parseISO` |

---

## 五、常见坑与防范原则

### 坑 1：ProColumns render 第一参数是 dom，不是原始值

```typescript
// ❌ 错误模式（全项目需排查）
render: (value) => format(new Date(value as string), ...)
render: (value) => Number(value as string) * 100
render: (value) => (value as string).toUpperCase()

// ✅ 正确模式
render: (_dom, row) => format(parseISO(row.createdAt), ...)
render: (_dom, row) => row.amount * 100
render: (_dom, row) => row.name.toUpperCase()
```

**记忆口诀**：`dom` 是展示用的，`entity`（row）才是原始数据。

---

### 坑 2：E2E 测试依赖真实 API，测试用例需要非致命降级

对于依赖真实数据的断言（如"若有会话则点击"），使用 `catch(() => false)` 模式：

```typescript
const visible = await item.isVisible({ timeout: 5_000 }).catch(() => false);
if (visible) {
  await item.click({ force: true });
  // 做进一步断言
}
// 非致命：空数据是合法状态，测试不应因此失败
await expectNoError(page);
```

---

### 坑 3：Turbopack 冷编译导致 E2E 超时

症状：spec 在本地首次运行 timeout，CI 始终超时。
原因：路由未预热，Turbopack 在 spec 超时前还未编译完成。
解决：将路由加入 `auth.setup.ts` 的 `WARMUP_ROUTES`。

---

### 坑 4：date-fns 的 `new Date()` vs `parseISO()`

在服务器端（SSR / Node.js）使用 `new Date("2026-03-17")` 会解析为 UTC 时间，而客户端会解析为本地时间，造成日期显示错位。  
**统一使用 `parseISO()` + `isValid()`，行为在所有环境下一致。**

---

_文档作者：GitHub Copilot Agent | 记录日期：2026-03-17_
