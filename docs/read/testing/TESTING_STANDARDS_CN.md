# 测试规范速查手册

> **使用方式**：
>
> - 测试挂了 → 直接跳 [§1 错误速查表](#一错误速查表按报错-ctrl-f)
> - 写新测试 → 跳 [§3 单元测试模板](#三单元测试-vitest) 或 [§4 E2E 模板](#四e2e-playwright)
> - CI 红了但本地是绿的 → 跳 [§5 CI 规范](#五ci-规范)

---

## 零、测试失败调试流程

```
测试失败
  │
  ├─ 单元测试（Vitest）
  │    ├─ 1. 看报错码 → §1 速查表
  │    ├─ 2. 有没有同名 describe 两个？→ 删旧的
  │    ├─ 3. API 签名/store action 改过？→ 同步所有 mockResolvedValue + toHaveBeenCalledWith
  │    └─ 4. 还不行 → 看 §3 模板，对比结构差异
  │
  └─ E2E（Playwright）
       ├─ 1. 看 HTML report（Artifacts → playwright-html-report）
       ├─ 2. 看 Annotations 面板里的"运行时错误"标注（拦截器写进去的）
       ├─ 3. 下载 trace.zip → playwright show-trace trace.zip
       └─ 4. 是否从 './fixtures' 而不是 '@playwright/test' 导入了 test？
```

---

## 一、错误速查表（按报错 Ctrl+F）

### 单元测试

| 报错关键字                      | 根因                                    | 一行解法                                                                  |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `react/display-name`            | `vi.mock` 里内联写了 `React.forwardRef` | 改工厂函数 + 加 `.displayName = 'Xxx'` → §3.1                             |
| `no-unused-vars` on destructure | 解构时丢弃的 prop 没有屏蔽              | 用 `/* eslint-disable/enable @typescript-eslint/no-unused-vars */` 块包裹 |
| `prettier/prettier: Delete ⏎`   | 文件末尾多了空行 / CRLF 混入            | 文件末只留**一个 `\n`**，无多余空行                                       |
| `toHaveBeenCalledWith` 不匹配   | API/store 签名改了但 mock 没改          | 同步更新所有 `mockXxx.mockResolvedValue` + `toHaveBeenCalledWith`         |
| 同一个用例跑两次 / 奇怪的冲突   | 同名 `describe` 块存了两个              | `grep -n 'describe(' 文件名`，删旧的                                      |
| `Cannot find module '...'`      | vi.mock 路径 / tsconfig alias 问题      | 路径用 `@/` alias，不用相对路径                                           |
| `act(...)` warning              | 状态更新没包在 `waitFor` 里             | 改成 `await waitFor(() => expect(...))` → §3.4                            |

### E2E

| 报错关键字                         | 根因                                        | 一行解法                                            |
| ---------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| `捕获到 N 个运行时错误`            | 页面有 pageerror / console.error / HTTP≥400 | 看 Annotation 详情，加白名单或修 bug → §4.1         |
| `auto fixture 不会运行`            | 从 `@playwright/test` 导入 test             | **必须**从 `./fixtures` 导入                        |
| `Timeout ... waiting for selector` | 页面还没渲染 / 元素名变了                   | 加 `waitForDashboard()` 或检查 selector             |
| `storageState not found`           | setup project 没跑或跑失败                  | 重跑 `yarn e2e --project=setup`                     |
| CI 里 Chromium 找不到              | 忘了 `playwright install`                   | ci 步骤加 `playwright install chromium --with-deps` |

### Prisma v6（后端）

| 报错关键字                                                  | 根因               | 解法                                                                             |
| ----------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `Namespace 'Prisma' has no exported member 'LogDefinition'` | Prisma v6 移除     | 本地定义等价类型 → `prisma.service.ts`                                           |
| `PrismaClientKnownRequestError does not exist on Prisma`    | v6 移到 runtime    | `import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'` |
| `null not assignable to NullableJsonNullValueInput`         | nullable JSON 字段 | 改用 `Prisma.JsonNull` 代替 `null`                                               |
| `linux-arm64-openssl-1.1.x not found`                       | binaryTargets 缺失 | 见 `read/PRISMA_V6_MIGRATION_CN.md`                                              |

---

## 二、强制规则清单（提交前过一遍）

```
□ 每个文件只有一个 describe 块
□ vi.mock 里的 React.forwardRef 用工厂函数写法 + .displayName
□ 所有 E2E 文件从 './fixtures' 导入 test（不是 '@playwright/test'）
□ API 签名改了 → 同步所有 mock 数据和 toHaveBeenCalledWith
□ 文件末尾只有一个 \n，无多余空行
□ 长调用（>80 字符）已拆行 + trailing comma
□ 修改 schema.prisma 后在宿主机跑了 prisma generate
```

---

## 三、单元测试（Vitest）

### 3.1 vi.mock 正确写法（工厂函数）

```typescript
vi.mock('@/components/UIComponents', () => {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const Button = ({
    children, onClick, type, isLoading, disabled,
    variant: _variant, size: _size, className: _className, ...rest
  }: React.PropsWithChildren<ButtonProps>) => (
    <button type={type ?? 'button'} onClick={onClick}
      disabled={disabled || isLoading} {...rest}>
      {isLoading ? 'Loading…' : children}
    </button>
  );

  const Input = React.forwardRef(
    ({ error, className: _className, ...props }: InputProps, ref) => (
      <div>
        <input ref={ref} {...props} />
        {error && <span role="alert">{error}</span>}
      </div>
    ),
  );
  /* eslint-enable @typescript-eslint/no-unused-vars */
  Input.displayName = 'Input'; // ← 必须！

  return { Button, Input };
});
```

### 3.2 Mock 数据同步规则

API 响应结构 / store action 签名改变时，**立刻**同步：

```typescript
// 场景：login(token, role, userInfo) 签名新增了 role 和 userInfo
// ❌ 旧断言（漏掉新参数 → toHaveBeenCalledWith 失败）
expect(mockLogin).toHaveBeenCalledWith("jwt-abc");

// ✅ 新断言
expect(mockLogin).toHaveBeenCalledWith(
  "jwt-abc",
  "SUPER_ADMIN",
  expect.objectContaining({ id: "admin-1", role: "SUPER_ADMIN" }),
);
```

### 3.3 文件结构模板

```typescript
// ① hoisted mock 函数（必须在 vi.mock 之前）
const mockApi = vi.hoisted(() => vi.fn());

// ② mock 声明（外部库优先）
vi.mock('framer-motion', () => framerMotionMock);
vi.mock('@/api', () => ({ xxxApi: { method: mockApi } }));
vi.mock('@/components/UIComponents', () => { /* 工厂函数 */ });

// ③ 被测模块（放最后）
import { MyView } from '@/views/MyView';

// ④ 唯一一个 describe
describe('MyView', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── rendering ──────────────────────────────────────
  it('renders correctly', () => { ... });

  // ── validation ─────────────────────────────────────
  it('shows error when field empty', async () => { ... });

  // ── success ────────────────────────────────────────
  it('submits and redirects', async () => { ... });

  // ── error handling ──────────────────────────────────
  it('shows server error message', async () => { ... });
});
// ← 文件结尾，单个 \n，不多
```

### 3.4 waitFor 正确姿势

```typescript
// ✅ 多个断言合在一个 waitFor
await waitFor(() => {
  expect(mockSubmit).toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenCalledWith("/dashboard");
});

// ❌ 串行两个 waitFor（后一个可能超时）
await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/dashboard"));
```

---

## 四、E2E（Playwright）

### 4.1 全局拦截机制

`fixtures.ts` 的 `_errorInterceptor`（`{ auto: true }`）自动监听三类错误：

| 事件                   | 触发条件           | 默认白名单                                                           |
| ---------------------- | ------------------ | -------------------------------------------------------------------- |
| `page.on('pageerror')` | JS 崩溃            | 无                                                                   |
| `page.on('console')`   | `type === 'error'` | React DevTools / Fast Refresh / chrome-extension                     |
| `page.on('response')`  | `status >= 400`    | favicon、`/_next/webpack-hmr`、401 on `/auth/`、`/_next/static/` 404 |

错误在**测试结束时统一断言**（不是立刻 fail），详情自动写入 HTML report 的 Annotations 面板。

**扩展白名单**（在 `fixtures.ts` 的 `shouldIgnoreHttpError` / `shouldIgnoreConsoleError` 里加）：

```typescript
// 例：忽略某个已知的第三方脚本 console.error
function shouldIgnoreConsoleError(text: string): boolean {
  // ...existing rules...
  if (text.includes("stripe.js")) return true; // ← 新增，注明理由
  return false;
}
```

### 4.2 必须从 fixtures 导入

```typescript
// ✅ 拦截器生效
import { test, expect } from "./fixtures";

// ❌ 拦截器不运行
import { test, expect } from "@playwright/test";
```

### 4.3 测试文件归属

| Playwright Project | 匹配规则                                 | 需要登录                    |
| ------------------ | ---------------------------------------- | --------------------------- |
| `setup`            | `auth.setup.ts`                          | 执行登录，保存 storageState |
| `chromium`         | 其他 `*.spec.ts`                         | ✅ 复用 setup               |
| `public`           | `home.spec.ts`, `register-apply.spec.ts` | ❌ 无需登录                 |

### 4.4 常用 Helper 速查

```typescript
import {
  test,
  expect, // 必须从这里导入
  dismissDevOverlay, // 移除 Next.js dev overlay
  waitForDashboard, // 等侧边栏出现（auth guard 完成标志）
  expectNoError, // 检查页面无 error boundary 文字
  waitForContent, // 等表格/内容出现
  gotoAndWait, // goto + waitForDashboard + expectNoError
  forceClick, // 移除 overlay 后点击
} from "./fixtures";
```

---

## 五、CI 规范

### 文件分工

| 工作流           | 触发           | 作用                           |
| ---------------- | -------------- | ------------------------------ |
| `ci.yml → check` | PR / push main | Lint + 类型检查 + 单元测试     |
| `ci.yml → e2e`   | PR / push main | 基础 E2E smoke（mock API）     |
| `playwright.yml` | PR / push main | 完整 Playwright E2E + 产物上传 |

### 产物规则（playwright.yml）

| 产物          | 上传时机   | 保留期 |
| ------------- | ---------- | ------ |
| 截图 `*.png`  | **仅失败** | 7 天   |
| Trace `*.zip` | **仅失败** | 7 天   |
| HTML report   | 始终       | 14 天  |

**生产服务器（1GB RAM）绝对不运行任何浏览器测试。**

### 本地运行命令

```bash
# 单元测试
yarn workspace @lucky/admin-next test          # 全量
yarn workspace @lucky/admin-next test Login    # 单文件

# E2E（需要目标服务运行中）
yarn workspace @lucky/admin-next e2e                   # 全量（含 setup）
yarn workspace @lucky/admin-next e2e --project=public  # 仅公开页（无需登录）
yarn workspace @lucky/admin-next e2e:ui                # UI 调试模式
yarn workspace @lucky/admin-next e2e:report            # 查看上次报告
```

---

## 六、常用 Accessible Role 速查

| 元素                      | role       | 推荐写法                                   |
| ------------------------- | ---------- | ------------------------------------------ |
| `<button>`                | `button`   | `getByRole('button', { name: /文字/i })`   |
| `<a href>`                | `link`     | `getByRole('link', { name: /文字/i })`     |
| `<input type="text">`     | `textbox`  | `getByLabel('标签')` 更语义化              |
| `<input type="password">` | —          | `getByLabel('Password')`                   |
| `<span role="alert">`     | `alert`    | `getAllByRole('alert')`                    |
| `<select>`                | `combobox` | `getByRole('combobox', { name: /标签/i })` |
