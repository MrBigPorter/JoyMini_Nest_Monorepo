# Lucky Admin — 自动化测试 API 参考手册

> **定位**：速查手册，覆盖项目中实际使用的所有测试 API。  
> **配套文档**：`TESTING_CN.md`（原理与用法讲解）  
> **范围**：`apps/admin-next/src/__tests__/` 和 `src/__e2e__/`

---

## 目录

1. [Vitest — 测试框架核心](#一vitest--测试框架核心)
2. [@testing-library/react — 组件渲染与查询](#二testing-libraryreact--组件渲染与查询)
3. [@testing-library/user-event — 用户交互模拟](#三testing-libraryuser-event--用户交互模拟)
4. [@testing-library/jest-dom — DOM 断言扩展](#四testing-libraryjest-dom--dom-断言扩展)
5. [MSW — 网络请求拦截](#五msw--网络请求拦截)
6. [Playwright — E2E 浏览器自动化](#六playwright--e2e-浏览器自动化)
7. [项目专属工具函数](#七项目专属工具函数)
8. [各测试文件 API 速查索引](#八各测试文件-api-速查索引)

---

## 一、Vitest — 测试框架核心

### 1.1 测试组织

#### `describe(name, fn)` — 分组

将相关测试归组，支持嵌套。

```typescript
// useAuthStore.test.ts
describe("useAuthStore", () => {
  describe("login", () => {
    it("存储 token", () => {
      /* ... */
    });
  });
  describe("logout", () => {
    it("清除 token", async () => {
      /* ... */
    });
  });
});
```

#### `it(name, fn)` / `test(name, fn)` — 声明单个测试

两者完全等价，`it` 更接近自然语言（"it should..."）。

```typescript
it('renders the Dashboard heading', () => {
  render(<Dashboard />);
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
});
```

---

### 1.2 生命周期钩子

#### `beforeAll(fn)` / `afterAll(fn)`

整个 `describe` 块只执行一次（最开始 / 最结束）。

```typescript
// http.test.ts — MSW 服务器只启动和关闭一次
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
```

#### `beforeEach(fn)` / `afterEach(fn)`

每个 `it` 块执行前 / 后都运行一次。

```typescript
// useAuthStore.test.ts — 每个测试前重置 store
beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({
    isAuthenticated: false,
    userRole: "viewer",
    token: null,
  });
});

// http.test.ts — 每个测试后重置 MSW 规则
afterEach(() => {
  server.resetHandlers();
  mockAddToast.mockClear();
  localStorage.clear();
});
```

---

### 1.3 `vi.fn()` — 创建 Mock 函数

```typescript
const mockFn = vi.fn();
```

| 方法                        | 说明                              | 项目用例                                       |
| --------------------------- | --------------------------------- | ---------------------------------------------- |
| `.mockReturnValue(val)`     | 每次调用都返回 `val`              | `makeUseRequest` 里 `run: vi.fn()`             |
| `.mockReturnValueOnce(val)` | 仅下一次调用返回 `val`            | Dashboard 三个 `useRequest` 按序返回           |
| `.mockResolvedValue(val)`   | 返回 `Promise.resolve(val)`       | `mockAuthLogin.mockResolvedValue(...)`         |
| `.mockRejectedValue(err)`   | 返回 `Promise.reject(err)`        | 登录失败场景                                   |
| `.mockImplementation(fn)`   | 自定义实现                        | `vi.spyOn(Date,'now').mockImplementation(...)` |
| `.mockClear()`              | 清除调用记录，保留实现            | `afterEach` 里 `mockAddToast.mockClear()`      |
| `.mockReset()`              | 清除记录 + 清除 `mockReturnValue` | Dashboard `mockUseRequest.mockReset()`         |

```typescript
// Dashboard.test.tsx — 按顺序控制 3 次 useRequest 的返回值
mockUseRequest
  .mockReturnValueOnce(makeUseRequest(FINANCE_MOCK)) // 第 1 次：财务数据
  .mockReturnValueOnce(makeUseRequest(ORDER_MOCK)) // 第 2 次：订单数据
  .mockReturnValueOnce(makeUseRequest(USER_MOCK)); // 第 3 次：用户数据
```

---

### 1.4 `vi.mock(path, factory)` — 替换整个模块

> **重要**：`vi.mock()` 调用会被 Vitest 自动提升（hoisting）到文件顶部执行。

```typescript
// 替换 npm 包
vi.mock("framer-motion", () => framerMotionMock);

// 替换项目模块
vi.mock("@/api", () => ({
  authApi: { login: mockAuthLogin },
}));

// Zustand store — Hook 使用模式（组件里 useXxxStore(selector)）
vi.mock("@/store/useAuthStore", () => ({
  useAuthStore: (sel: (s: { login: typeof mockLogin }) => unknown) =>
    sel({ login: mockLogin }),
}));

// Zustand store — 静态访问模式（HttpClient 里 useXxxStore.getState()）
vi.mock("@/store/useToastStore", () => ({
  useToastStore: { getState: () => ({ addToast: mockAddToast }) },
}));
```

---

### 1.5 `vi.hoisted(fn)` — 提升变量初始化

解决 `vi.mock()` 被提升后，普通变量还未初始化（为 `undefined`）的问题。

```typescript
// 错误写法：vi.mock 提升执行时，mockFn 还是 undefined
const mockFn = vi.fn();
vi.mock("@/api", () => ({ fn: mockFn })); // mockFn 是 undefined！

// 正确写法：vi.hoisted 保证变量和 vi.mock 同步提升
const mockFn = vi.hoisted(() => vi.fn());
vi.mock("@/api", () => ({ fn: mockFn })); // mockFn 已是 vi.fn() ✓
```

```typescript
// Login.test.tsx 完整用法
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockAuthLogin = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));
vi.mock("@/api", () => ({
  authApi: { login: mockAuthLogin },
}));
```

---

### 1.6 `vi.spyOn(object, method)` — 监视真实函数

不完全替换，仅监听调用，可选择性覆盖返回值。

```typescript
// useToastStore.test.ts — 控制 Date.now() 确保每个 toast ID 唯一
let time = 100000;
const spy = vi.spyOn(Date, "now").mockImplementation(() => time++);
// ... 执行测试 ...
spy.mockRestore(); // 恢复真实实现，避免影响后续测试

// setup.ts — 静默 console.warn 输出
vi.spyOn(console, "warn").mockImplementation(() => {});
```

---

### 1.7 Mock 重置

| 函数                   | 作用                                     | 适用场景                                        |
| ---------------------- | ---------------------------------------- | ----------------------------------------------- |
| `vi.clearAllMocks()`   | 清调用记录，保留 mock 实现               | `beforeEach(() => vi.clearAllMocks())` — 最常用 |
| `vi.resetAllMocks()`   | 清调用记录 + 清 `mockReturnValue` 等设置 | 需要完全重置 mock 行为时                        |
| `vi.restoreAllMocks()` | 恢复所有 `spyOn` 的真实实现              | `afterEach` 里配合 `spyOn` 使用                 |

---

### 1.8 `expect` 断言

#### 基础断言

| 断言                  | 说明                  | 项目用例                                                |
| --------------------- | --------------------- | ------------------------------------------------------- |
| `.toBe(val)`          | 严格相等（`===`）     | `expect(token).toBe('my-jwt')`                          |
| `.toEqual(obj)`       | 深度相等（对象/数组） | `expect(result).toEqual([{ id: 1 }])`                   |
| `.toBeDefined()`      | 不是 `undefined`      | `expect(http).toBeDefined()`                            |
| `.toBeNull()`         | 是 `null`             | `expect(localStorage.getItem('auth_token')).toBeNull()` |
| `.toBeTruthy()`       | 真值                  | `expect(toasts[0].id).toBeTruthy()`                     |
| `.toBeGreaterThan(n)` | 大于 n                | `expect(animatePulse.length).toBeGreaterThan(0)`        |
| `.toThrow()`          | 抛出异常              | `expect(() => act(...)).not.toThrow()`                  |

#### Mock 函数断言

| 断言                                 | 说明               | 项目用例                                                                 |
| ------------------------------------ | ------------------ | ------------------------------------------------------------------------ |
| `.toHaveBeenCalled()`                | 被调用过           | `expect(mockAuthLogin).toHaveBeenCalled()`                               |
| `.toHaveBeenCalledTimes(n)`          | 恰好调用 n 次      | —                                                                        |
| `.toHaveBeenCalledWith(...args)`     | 用指定参数调用过   | `expect(mockAuthLogin).toHaveBeenCalledWith({ username: 'admin', ... })` |
| `.toHaveBeenLastCalledWith(...args)` | 最后一次调用的参数 | —                                                                        |
| `.not.toHaveBeenCalled()`            | 没有被调用         | —                                                                        |

#### 异步断言

```typescript
// 断言 Promise reject（用于测试 HTTP 错误处理）
await expect(http.get("/secret")).rejects.toBeDefined();

// 断言 Promise resolve
await expect(http.get("/users")).resolves.toEqual([{ id: 1 }]);
```

#### 模糊匹配

```typescript
// expect.stringContaining — 字符串包含关键词
expect(mockAddToast).toHaveBeenCalledWith(
  "success",
  expect.stringContaining("Welcome"), // "Welcome back, Admin!" 均可匹配
);

// expect.any — 任意指定类型
expect(mockAddToast).toHaveBeenCalledWith("error", expect.any(String));
```

---

## 二、@testing-library/react — 组件渲染与查询

### 2.1 `render(component)` — 渲染组件

```typescript
const { container, unmount, rerender } = render(<Dashboard />);

// container：DOM 根节点，可直接操作
expect(container.firstChild).not.toBeNull();
container.querySelectorAll('.animate-pulse') // 查找 loading skeleton
```

---

### 2.2 `screen` — DOM 查询入口

代表整个页面，所有查询方法都挂在上面。

#### `getBy*` — 找不到就抛错（适合断言元素**存在**）

| 方法                        | 说明             | 项目用例                                           |
| --------------------------- | ---------------- | -------------------------------------------------- |
| `getByText(text)`           | 按文本内容       | `screen.getByText('Dashboard')`                    |
| `getByText(/regex/i)`       | 文本正则匹配     | `screen.getByText(/view all/i)`                    |
| `getByRole(role, opts)`     | 按语义角色       | `screen.getByRole('button', { name: /sign in/i })` |
| `getByPlaceholderText(str)` | 按 placeholder   | `screen.getByPlaceholderText('Username')`          |
| `getByLabelText(str)`       | 按关联 label     | `screen.getByLabelText('Username')`                |
| `getByTestId(id)`           | 按 `data-testid` | `screen.getByTestId('smart-table')`                |

```typescript
// Login.test.tsx
expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();

// Dashboard.test.tsx
expect(screen.getByText("Total Deposits")).toBeInTheDocument();
expect(screen.getByText(/12,500/)).toBeInTheDocument(); // 正则匹配格式化数字
```

#### `queryBy*` — 找不到返回 `null`（适合断言元素**不存在**）

```typescript
expect(screen.queryByText("Error Message")).toBeNull();
```

#### `findBy*` — 异步等待元素出现

```typescript
const el = await screen.findByText("Data Loaded!");
expect(el).toBeInTheDocument();
```

---

### 2.3 `fireEvent` — 直接触发 DOM 事件

适合简单触发，不模拟完整用户行为链。

```typescript
// Login.test.tsx — 点击提交按钮
fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

// 直接改变 input 值（不适合 react-hook-form，用 userEvent 代替）
fireEvent.change(input, { target: { value: "new value" } });
```

> **选择原则**：表单验证必须用 `userEvent`；简单按钮点击用 `fireEvent` 即可。

---

### 2.4 `waitFor(fn, opts?)` — 等待异步断言通过

轮询执行 `fn`，直到不抛错或超时（默认 1000ms，可自定义）。

```typescript
// Login.test.tsx — 等待 useRequest onSuccess 回调执行完毕
await waitFor(() => {
  expect(mockAuthLogin).toHaveBeenCalledWith({
    username: "admin",
    password: "password123",
  });
  expect(mockLogin).toHaveBeenCalledWith("jwt-abc");
  expect(mockRouterPush).toHaveBeenCalledWith("/");
});

// 自定义超时
await waitFor(() => expect(el).toBeVisible(), { timeout: 3000 });
```

---

### 2.5 `act(fn)` — 包裹 React 状态更新

告诉 React：处理完所有挂起的更新再返回，确保断言时状态已是最新值。

```typescript
// 同步状态更新（Zustand set）
act(() => {
  useAuthStore.getState().login("my-jwt-token", "admin");
});
// act 返回后，状态已更新完毕，可直接断言

// 异步操作
await act(async () => {
  await useAuthStore.getState().logout();
});
```

> **何时必须用 `act`**：
>
> - 调用 Zustand store 方法（触发 React 订阅更新）
> - 调用会触发状态更新的异步函数
> - 不用会出现 `Warning: An update to X inside a test was not wrapped in act`

---

## 三、@testing-library/user-event — 用户交互模拟

比 `fireEvent` 更完整，模拟真实用户的完整交互链（focus → keydown → input → keyup → blur → change）。

### 3.1 初始化

```typescript
import userEvent from "@testing-library/user-event";

const user = userEvent.setup(); // 推荐：创建统一配置的实例
```

### 3.2 常用方法

| 方法                           | 说明                                | 项目用例                          |
| ------------------------------ | ----------------------------------- | --------------------------------- |
| `user.type(el, text)`          | 逐字符输入（触发完整键盘事件链）    | `await user.type(input, 'admin')` |
| `user.click(el)`               | 点击（触发 pointer + mouse 完整链） | —                                 |
| `user.clear(el)`               | 清空输入框                          | —                                 |
| `user.selectOptions(el, vals)` | 选择 select 选项                    | —                                 |
| `user.keyboard('{Enter}')`     | 模拟键盘按键                        | —                                 |

```typescript
// Login.test.tsx — 表单填写
const user = userEvent.setup();
render(<Login />);
await user.type(screen.getByPlaceholderText('Username'), 'admin');
await user.type(screen.getByPlaceholderText('Password'), 'password123');
fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
```

> **为什么 Login 测试用 `userEvent.type` 而不是 `fireEvent.change`**：  
> `Login.tsx` 使用 `react-hook-form` 注册的受控组件，只有 `userEvent.type()` 触发的
> 原生键盘事件链才能正确触发 `onChange` 更新和 `zod` 校验。

---

## 四、@testing-library/jest-dom — DOM 断言扩展

由 `setup.ts` 中 `import '@testing-library/jest-dom'` 全局注入，所有测试文件自动可用。

| 断言                           | 说明                               | 项目用例                                         |
| ------------------------------ | ---------------------------------- | ------------------------------------------------ |
| `.toBeInTheDocument()`         | 存在于 DOM                         | `expect(el).toBeInTheDocument()`                 |
| `.toBeVisible()`               | 元素可见（非 hidden/display:none） | `expect(input).toBeVisible()`                    |
| `.toHaveValue(val)`            | input/select/textarea 的当前值     | `expect(input).toHaveValue('admin')`             |
| `.toHaveClass(cls)`            | 有指定 CSS class                   | `expect(el).toHaveClass('bg-blue-100')`          |
| `.toHaveTextContent(text)`     | 元素文本内容                       | `expect(badge).toHaveTextContent('Active')`      |
| `.toBeDisabled()`              | 元素禁用状态                       | `expect(btn).toBeDisabled()`                     |
| `.toBeEnabled()`               | 元素启用状态                       | —                                                |
| `.toHaveAttribute(attr, val?)` | 有指定属性                         | `expect(img).toHaveAttribute('src', '/img.jpg')` |
| `.not.toBeInTheDocument()`     | 不存在于 DOM                       | —                                                |

```typescript
// UIComponents.test.tsx
expect(screen.getByText("Active")).toBeInTheDocument();
expect(container.firstChild).toHaveClass("bg-blue-100");

// BannerManagement.test.tsx
expect(screen.getByTestId("base-table")).toBeInTheDocument();
expect(screen.getByTestId("page-header")).toBeInTheDocument();
```

---

## 五、MSW — 网络请求拦截

用于 `http.test.ts`，在网络层拦截 axios 请求，测试完整的 HttpClient 逻辑（拦截器、错误处理、token 注入）。

### 5.1 服务器生命周期

```typescript
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer(); // 创建网络层拦截器（不是真实 HTTP 服务器）

beforeAll(() =>
  server.listen({
    onUnhandledRequest: "bypass", // 未匹配的请求直接放行（不报错）
  }),
);
afterAll(() => server.close());
afterEach(() => server.resetHandlers()); // 清空本轮注册的临时拦截规则
```

---

### 5.2 `server.use(...handlers)` — 注册拦截规则

```typescript
// http.test.ts 中封装的辅助函数
function mockGet(path: string, body: object, status = 200) {
  server.use(http.get(path, () => HttpResponse.json(body, { status })));
}
function mockPost(path: string, body: object, status = 200) {
  server.use(http.post(path, () => HttpResponse.json(body, { status })));
}

// 使用
mockGet("http://localhost/api/users", {
  code: 10000,
  message: "ok",
  data: [{ id: 1 }],
});
```

---

### 5.3 `http.*` — 请求处理器

```typescript
// GET 请求
http.get("http://localhost/api/users", () =>
  HttpResponse.json({ code: 10000, data: [], message: "ok" }),
);

// POST 请求（读取请求体）
http.post("http://localhost/api/login", async ({ request }) => {
  const body = await request.json();
  return HttpResponse.json({ code: 10000, data: { token: "jwt" } });
});

// 捕获请求头（验证 token 注入是否正确）
http.get("http://localhost/api/profile", ({ request }) => {
  const auth = request.headers.get("Authorization"); // 'Bearer my-jwt'
  return HttpResponse.json({ code: 10000, data: { id: 1 }, message: "ok" });
});
```

---

### 5.4 `HttpResponse.*` — 响应构造

| 方法                             | 说明                         | 项目用例                                       |
| -------------------------------- | ---------------------------- | ---------------------------------------------- |
| `HttpResponse.json(body, init?)` | 返回 JSON 响应               | `HttpResponse.json({ code: 10000, data: [] })` |
| `HttpResponse.error()`           | 模拟网络断开（非 HTTP 错误） | `http.test.ts` 网络断开测试                    |
| `HttpResponse.text(str)`         | 返回纯文本                   | —                                              |

```typescript
// 各种响应场景（http.test.ts 中的真实用例）

// 成功
HttpResponse.json({ code: 10000, message: "ok", data: [{ id: 1 }] });

// HTTP 状态码错误（500）
HttpResponse.json({ code: 500 }, { status: 500 });

// 业务逻辑错误（HTTP 200 但 code 非 10000）
HttpResponse.json({ code: 401, message: "未授权", data: null });

// 网络完全断开
HttpResponse.error();
```

---

## 六、Playwright — E2E 浏览器自动化

### 6.1 导航

| 方法                              | 说明             | 项目用例                                          |
| --------------------------------- | ---------------- | ------------------------------------------------- |
| `page.goto(url, opts?)`           | 导航到 URL       | `page.goto('/users/')`                            |
| `page.waitForURL(urlOrFn, opts?)` | 等待 URL 变化    | `page.waitForURL(/\/login/, { timeout: 10_000 })` |
| `page.waitForLoadState(state?)`   | 等待页面加载状态 | `page.waitForLoadState('domcontentloaded')`       |
| `page.url()`                      | 获取当前 URL     | `expect(page.url()).toContain('/login')`          |

```typescript
// auth.spec.ts — 等待跳转到登录页
await page.goto("/");
await page.waitForURL(/\/login/, { timeout: 10_000 });

// helpers.ts — 等待 URL 提交（比等 'load' 快）
await page.waitForURL((url) => !url.pathname.includes("/login"), {
  timeout: 600_000,
  waitUntil: "commit",
});
```

---

### 6.2 元素定位（Locators）

所有 Locator **惰性求值**：不立即查找 DOM，在调用 `.click()` / `.fill()` 等操作时才执行。

#### 语义化定位（推荐）

| 方法                          | 说明             | 项目用例                                         |
| ----------------------------- | ---------------- | ------------------------------------------------ |
| `page.getByRole(role, opts?)` | 按 ARIA role     | `page.getByRole('button', { name: /sign in/i })` |
| `page.getByLabel(text)`       | 按关联 `<label>` | `page.getByLabel('Username')`                    |
| `page.getByText(text)`        | 按文本内容       | `page.getByText(/client database/i)`             |
| `page.getByPlaceholder(text)` | 按 placeholder   | `page.getByPlaceholder(/enter id/i)`             |
| `page.getByTestId(id)`        | 按 `data-testid` | `page.getByTestId('smart-table')`                |

#### CSS / 结构定位（备用）

```typescript
page.locator("table").first();
page.locator("aside").first();
page.locator('[class*="border-l-red"], [role="alert"]');

// 链式过滤
page
  .locator("h1")
  .filter({ hasText: /dashboard/i })
  .first();

// 在已有 locator 内查找
const sidebar = page.locator("aside").first();
sidebar.getByText("Overview");
```

---

### 6.3 元素操作

| 方法                      | 说明                 | 项目用例                                                               |
| ------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `.click(opts?)`           | 点击                 | `page.getByRole('button').click()`                                     |
| `.click({ force: true })` | 强制点击（忽略遮挡） | overlay 遮挡时使用                                                     |
| `.fill(text)`             | 清空并填入文本       | `page.getByLabel('Username').fill('admin')`                            |
| `.waitFor(opts?)`         | 等待元素状态         | `page.locator('aside').waitFor({ state: 'visible', timeout: 60_000 })` |

```typescript
// auth.spec.ts 标准登录操作
await page.getByLabel("Username").fill(TEST_ADMIN.username);
await page.getByLabel("Password").fill(TEST_ADMIN.password);
await page.getByRole("button", { name: /sign in/i }).click({ force: true });
```

---

### 6.4 Playwright `expect` — 自动重试断言

> Playwright 的 `expect` 会**自动轮询重试**直到通过或超时，天然处理异步渲染。

| 断言                   | 说明         | 项目用例                                                              |
| ---------------------- | ------------ | --------------------------------------------------------------------- |
| `.toBeVisible(opts?)`  | 元素可见     | `expect(input).toBeVisible({ timeout: 10_000 })`                      |
| `.toContainText(text)` | 元素文本包含 | `expect(page.locator('body')).not.toContainText('Application error')` |
| `.toHaveValue(val)`    | input 当前值 | `expect(input).toHaveValue('12345')`                                  |
| `.toHaveURL(url)`      | 当前页面 URL | `expect(page).toHaveURL(/dashboard/)`                                 |
| `.not.toBeVisible()`   | 不可见       | —                                                                     |

```typescript
// users.spec.ts
await expect(page.getByText(/client database/i)).toBeVisible({
  timeout: 20_000,
});

// navigation.spec.ts
await expect(page.locator("body")).not.toContainText("Application error", {
  timeout: 10_000,
});
```

---

### 6.5 浏览器上下文操作

```typescript
// 清除所有 Cookie（模拟未登录状态）
await page.context().clearCookies();

// 在页面内执行任意 JS
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => {
  document.querySelector("nextjs-portal")?.remove();
});

// 保存当前登录状态到文件（auth.setup.ts 使用）
await page.context().storageState({ path: "playwright/.auth/admin.json" });

// 每次导航前往 localStorage 注入 token（跳过 UI 登录）
await context.addInitScript((token) => {
  localStorage.setItem("auth_token", token);
}, "my-test-token");
```

---

## 七、项目专属工具函数

### 7.1 `view-helpers.tsx`（路径：`src/__tests__/mocks/`）

所有 view 测试文件共用，避免重复写 Mock。

---

#### `makeUseRequest<T>(data, loading?)` → 完整的 `useRequest` 返回值结构

**签名**：

```typescript
function makeUseRequest<T>(data: T, loading = false): UseRequestReturn<T>;
```

**返回值**：

```typescript
{
  data: T,
  loading: boolean,
  error: undefined,
  run: vi.fn(),                              // 手动触发请求
  runAsync: vi.fn().mockResolvedValue(data), // 异步触发请求
  refresh: vi.fn(),
  mutate: vi.fn(),
  cancel: vi.fn(),
  params: [],
}
```

**用例**：

```typescript
// 正常数据状态
mockUseRequest.mockReturnValue(makeUseRequest({ list: [], total: 0 }));

// Loading 状态（触发组件渲染 Skeleton）
mockUseRequest.mockReturnValue(makeUseRequest(undefined, true));

// Dashboard：3 个请求按顺序返回
mockUseRequest
  .mockReturnValueOnce(makeUseRequest(FINANCE_MOCK))
  .mockReturnValueOnce(makeUseRequest(ORDER_MOCK))
  .mockReturnValueOnce(makeUseRequest(USER_MOCK));
```

---

#### `makeUseAntdTable<T>(list, total?, loading?)` → 完整的 `useAntdTable` 返回值结构

**签名**：

```typescript
function makeUseAntdTable<T>(
  list: T[],
  total = list.length,
  loading = false,
): UseAntdTableReturn<T>;
```

**返回值**：

```typescript
{
  tableProps: {
    dataSource: list,
    loading: boolean,
    pagination: { current: 1, pageSize: 20, total, showSizeChanger: true },
    onChange: vi.fn(),
    rowKey: 'id',
  },
  search: {
    submit: vi.fn(),     // 触发搜索
    reset: vi.fn(),      // 重置搜索
    run: vi.fn(),
    submitValue: {},
  },
  loading: boolean,
  refresh: vi.fn(),
  run: vi.fn(),
  params: [{ current: 1, pageSize: 20 }, {}],
}
```

**用例**：

```typescript
// BannerManagement — 有数据状态
mockUseAntdTable.mockReturnValue(makeUseAntdTable(BANNERS_MOCK, 2));

// 空数据 + loading 状态
mockUseAntdTable.mockReturnValue(makeUseAntdTable([], 0, true));
```

---

#### `framerMotionMock` — framer-motion 替代

将所有 `motion.*` 组件替换为原生 HTML 元素，并过滤掉动画专属属性（`initial`、`animate`、`exit`、`variants`、`transition`、`whileHover`、`whileTap`、`layout`、`whileInView`），避免 unknown DOM prop 警告。

```typescript
vi.mock("framer-motion", () => framerMotionMock);
// 效果：<motion.div initial={{...}} animate={{...}}>...</motion.div>
//    → <div>...</div>（动画属性被过滤，不影响结构测试）
```

**包含**：`motion`（Proxy，任意标签均可用）、`AnimatePresence`（直接渲染 children）

---

#### `repoUiMock` — `@repo/ui` 组件库替代

```typescript
vi.mock("@repo/ui", () => repoUiMock);
```

| 组件               | Mock 实现                                     | 保留的行为                         |
| ------------------ | --------------------------------------------- | ---------------------------------- |
| `Button`           | `<button>`                                    | `onClick`、`disabled`、`className` |
| `Badge`            | `<span>`                                      | `className`                        |
| `Tooltip` 系列     | 透传 `children`                               | —                                  |
| `BaseSelect`       | `<select aria-label>`                         | `placeholder` 作为 `aria-label`    |
| `DropdownMenuItem` | `<div role="menuitem">`                       | `onClick`                          |
| `ModalManager`     | `{ open: vi.fn(), close: vi.fn() }`           | 可断言 `open` 是否被调用           |
| `cn`               | `(...args) => args.filter(Boolean).join(' ')` | 基础 classnames 合并               |

---

#### `repoUiBadgeMock` — `@repo/ui/components/ui/badge` 替代

```typescript
vi.mock("@repo/ui/components/ui/badge", () => repoUiBadgeMock);
```

---

#### 脚手架组件 Stub

| 导出                   | `data-testid` | 替代目标                                 | 渲染内容                            |
| ---------------------- | ------------- | ---------------------------------------- | ----------------------------------- |
| `SmartTableMock`       | `smart-table` | `@/components/scaffold/SmartTable`       | `headerTitle` 插槽内容              |
| `BaseTableMock`        | `base-table`  | `@/components/scaffold/BaseTable`        | 行数与数据数量相同的 `<tr>`         |
| `SchemaSearchFormMock` | `search-form` | `@/components/scaffold/SchemaSearchForm` | `<form>`，提交时调用 `onSearch({})` |
| `PageHeaderMock`       | `page-header` | `@/components/scaffold/PageHeader`       | `title` 和 `extra` 插槽             |
| `SmartImageMock`       | `smart-image` | `@/components/ui/SmartImage`             | `<img src alt>`                     |

---

### 7.2 `next-navigation.ts`（路径：`src/__tests__/mocks/`）

由 `vitest.config.ts` 的 alias 自动替换 `next/navigation`，无需在每个测试里手动 `vi.mock`。

| 导出              | 类型      | 默认返回值                                                                                |
| ----------------- | --------- | ----------------------------------------------------------------------------------------- |
| `useRouter`       | `vi.fn()` | `{ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }` |
| `usePathname`     | `vi.fn()` | `'/'`                                                                                     |
| `useSearchParams` | `vi.fn()` | `new URLSearchParams()`                                                                   |

```typescript
// 在测试中覆盖路由行为（用 hoisted 变量）
const mockRouterPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// 断言路由跳转
expect(mockRouterPush).toHaveBeenCalledWith("/");
```

---

### 7.3 `next-dynamic.tsx`（路径：`src/__tests__/mocks/`）

由 `vitest.config.ts` 的 alias 自动替换 `next/dynamic`。

将 `next/dynamic` 替换为 `React.lazy` + `Suspense` 同步渲染版本，避免动态导入在 jsdom 环境中导致组件渲染空白。

```typescript
// 无需手动声明，alias 自动生效
// 效果：next/dynamic(() => import('./Comp')) 在测试中同步渲染，不会出现 Suspense 延迟
```

---

### 7.4 `fixtures.ts`（路径：`src/__e2e__/`）

所有 E2E spec 共用的页面级工具函数。

---

#### `waitForDashboard(page, timeout?)` → `Promise<void>`

等待侧边栏 `<aside>` 可见。这是"Dashboard 渲染完毕"的可靠信号：Auth Guard 通过 + DashboardLayout 挂载完成。

**参数**：

- `page: Page` — Playwright page 对象
- `timeout?: number` — 默认 `60_000`（60 秒），冷启动时传更大值

```typescript
// 标准 beforeEach 模式
test.beforeEach(async ({ page }) => {
  await page.goto("/users/");
  await waitForDashboard(page); // 默认 60s
  await expectNoError(page);
});

// auth.setup.ts 中每个路由的预热（Turbopack 编译慢）
await waitForDashboard(page, 300_000); // 5 分钟
```

---

#### `expectNoError(page)` → `Promise<void>`

断言页面没有出现崩溃错误文字。检查 `'Application error'` 和 `'Internal Server Error'`。

```typescript
await page.goto("/orders/");
await waitForDashboard(page);
await expectNoError(page); // 快速验证页面没崩溃
```

---

#### `gotoAndWait(page, path)` → `Promise<Page>`

三步组合：`page.goto(path)` + `waitForDashboard` + `expectNoError`。

```typescript
await gotoAndWait(page, "/products/");
```

---

#### `dismissDevOverlay(page)` → `Promise<void>`

移除 Next.js 开发模式的错误 overlay（`<nextjs-portal>`），防止遮挡按钮导致点击失败。

```typescript
await dismissDevOverlay(page);
await page.getByRole("button", { name: /sign in/i }).click({ force: true });
```

---

#### `forceClick(page, locator)` → `Promise<void>`

先调用 `dismissDevOverlay`，再 `force: true` 点击。

```typescript
await forceClick(page, page.getByRole("button", { name: /submit/i }));
```

---

#### `waitForContent(page, timeout?)` → `Promise<void>`

等待页面出现任意实质内容（`table tr`、`[data-testid]`、`h1`、`h2`、`h3`）。

```typescript
await waitForContent(page, 20_000);
```

---

#### 自定义 `test` fixture（含 `gotoPage` 参数）

```typescript
import { test } from "./fixtures"; // 使用扩展版 test，而不是 @playwright/test 的原版

test("example", async ({ page, gotoPage }) => {
  await gotoPage("/users/");
  // 等价于：await page.goto('/users/'); await page.waitForLoadState('domcontentloaded');
});
```

---

### 7.5 `helpers.ts`（路径：`src/__e2e__/`）

---

#### `loginViaUI(page)` → `Promise<void>`

通过 UI 表单完整执行登录流程。

**步骤**：

1. `page.goto('/login/')`
2. 移除 Next.js dev overlay
3. 填写账号密码（来自 `TEST_ADMIN`）
4. 点击 Sign In 按钮
5. 等待 URL 离开 `/login`（`waitUntil: 'commit'`，比 `'load'` 快）

```typescript
// auth.setup.ts — 登录一次并保存状态
await loginViaUI(page);
await page.context().storageState({ path: "playwright/.auth/admin.json" });

// auth.spec.ts — 测试需要完整登录流程时
await page.context().clearCookies();
await page.evaluate(() => localStorage.clear()).catch(() => {});
await loginViaUI(page);
```

---

#### `injectToken(context, token)` → `Promise<void>`

绕过 UI，直接向 localStorage 注入 token（用于调试单个 spec，速度更快）。

```typescript
await injectToken(context, process.env.E2E_STATIC_TOKEN!);
await page.goto("/dashboard/");
```

---

#### `TEST_ADMIN` — 测试账号

```typescript
export const TEST_ADMIN = {
  username: process.env.E2E_ADMIN_USERNAME || "admin",
  password: process.env.E2E_ADMIN_PASSWORD || "Admin@123456",
};
```

本地开发在 `apps/admin-next/.env.test.local` 中设置；CI 通过 GitHub Secrets 注入。

---

#### `BASE_URL` — E2E 基础 URL

```typescript
export const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || "https://admin-dev.joyminis.com";
```

与 `playwright.config.ts` 中的 `use.baseURL` 保持一致。

---

## 八、各测试文件 API 速查索引

### 单元测试文件

| 文件                        | 核心 API                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `useAuthStore.test.ts`      | `vi.mock`、`act`、`useAuthStore.setState`、`useAuthStore.getState`、`localStorage`                   |
| `useToastStore.test.ts`     | `act`、`useToastStore.setState`、`vi.spyOn(Date, 'now')`                                             |
| `useAppStore.test.ts`       | `act`、`useAppStore.setState`、`document.documentElement.classList`                                  |
| `http.test.ts`              | `setupServer`、`http.get/post`、`HttpResponse.json/error`、`localStorage`、`window.location`         |
| `Login.test.tsx`            | `vi.hoisted`、`vi.mock`、`render`、`screen`、`fireEvent`、`userEvent`、`waitFor`、`framerMotionMock` |
| `Dashboard.test.tsx`        | `makeUseRequest`、`SmartImageMock`、`mockReturnValueOnce`、`container.querySelectorAll`              |
| `BannerManagement.test.tsx` | `makeUseAntdTable`、`makeUseRequest`、`BaseTableMock`、`SchemaSearchFormMock`、`PageHeaderMock`      |
| `UserManagement.test.tsx`   | `repoUiMock`、`repoUiBadgeMock`、`SmartTableMock`、`PageHeaderMock`                                  |
| `UIComponents.test.tsx`     | `render`、`screen`、`act`、`userEvent`、内联 `framerMotionMock`                                      |

### E2E 测试文件

| 文件                 | 核心 API                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `auth.setup.ts`      | `loginViaUI`、`page.context().storageState`、`page.locator('aside').waitFor`                                               |
| `auth.spec.ts`       | `page.context().clearCookies()`、`page.evaluate`、`loginViaUI`、`dismissDevOverlay`、`waitForDashboard`、`page.waitForURL` |
| `navigation.spec.ts` | `waitForDashboard`、`page.locator('aside')`、`page.getByText`、`expect.toBeVisible`                                        |
| `users.spec.ts`      | `waitForDashboard`、`expectNoError`、`page.getByText`、`page.locator('table')`、`page.getByPlaceholder`、`page.getByRole`  |
| `orders.spec.ts`     | `waitForDashboard`、`expectNoError`、`page.locator('table')`、`page.getByRole`                                             |
