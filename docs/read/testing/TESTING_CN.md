# 自动化测试规范

> **适用范围**：任何使用 Next.js（App Router）+ NestJS 的全栈项目  
> **前端测试**：Vitest + Testing Library  
> **后端测试**：Jest + ts-jest  
> **集成测试**：Playwright  
> **最后更新**：2026-03-17

---

## 目录

1. [测试金字塔 — 先建立全局观](#一测试金字塔--先建立全局观)
2. [快速上手 — 先跑起来再说](#二快速上手--先跑起来再说)
3. [前端单元测试（Vitest）](#三前端单元测试vitest)
4. [后端单元测试（NestJS / Jest）](#四后端单元测试nestjs--jest)
5. [E2E 测试（Playwright）](#五e2e-测试playwright)
6. [公开页 E2E — 隔离模式](#六公开页-e2e--隔离模式)
7. [新增测试 — 逐步 Checklist](#七新增测试--逐步-checklist)
8. [十条铁律 — 写测试前必读](#八十条铁律--写测试前必读)
9. [报错速查](#九报错速查)

---

## 一、测试金字塔 — 先建立全局观

在写第一行测试代码之前，先理解"为什么需要三种测试"。

```
            /\
           /  \          E2E（Playwright）
          / E2E\         · 少量、慢、真实浏览器
         /------\        · 验证"整体流程"能走通
        /        \
       / 单元测试 \       单元测试（Vitest / Jest）
      /  (大多数)  \      · 大量、快、隔离
     /______________\    · 验证"每个零件"逻辑正确
```

|              | 单元测试                | E2E 测试                       |
| ------------ | ----------------------- | ------------------------------ |
| **速度**     | 毫秒级                  | 秒～分钟级                     |
| **环境**     | 模拟（jsdom / Node）    | 真实 Chromium                  |
| **依赖**     | 全部 Mock               | 真实 API + 真实数据库          |
| **发现问题** | 单个函数 / 组件逻辑错误 | 跨层集成问题、路由跳转、Cookie |
| **何时跑**   | 每次 commit / push      | PR 合并前                      |
| **数量比**   | 多（占 80%）            | 少（占 20%）                   |

**一句话原则**：单元测试保证"零件没问题"，E2E 保证"整辆车能开"。两者缺一不可，但不要互相替代。

---

## 二、快速上手 — 先跑起来再说

### 前端单元测试

```bash
yarn workspace @lucky/admin-next test          # 跑一次，输出结果后退出
yarn workspace @lucky/admin-next test:watch    # 监听模式，保存文件自动重跑
yarn workspace @lucky/admin-next test:coverage # 生成覆盖率报告（HTML）
```

### 后端单元测试

```bash
yarn workspace @lucky/api test                 # 跑一次
yarn workspace @lucky/api test:watch           # 监听模式
yarn workspace @lucky/api test:cov             # 覆盖率报告

# 只跑某个模块（更快）
cd apps/api && npx jest register-application
cd apps/api && npx jest --testPathPattern=service
```

### E2E 测试

```bash
# 前置：确保服务已启动（make up）
yarn workspace @lucky/admin-next test:e2e          # 全量无界面
yarn workspace @lucky/admin-next test:e2e:ui       # 带调试 UI（强烈推荐）
yarn workspace @lucky/admin-next test:e2e:headed   # 有头浏览器（能看到操作过程）
yarn workspace @lucky/admin-next test:e2e:report   # 查看上次跑的 HTML 报告

# 只跑某个文件 / 某个用例
npx playwright test users.spec.ts
npx playwright test --grep "登录后跳转"
npx playwright test --project=public register-apply.spec.ts  # 只跑公开页
```

---

## 三、前端单元测试（Vitest）

### 3.1 测什么，不测什么

| 测 ✅                       | 不测 ❌                                   |
| --------------------------- | ----------------------------------------- |
| Store 方法调用后状态变化    | 第三方库的内部逻辑（React、Zustand 本身） |
| 组件渲染出了哪些元素        | 纯样式（颜色、字号）                      |
| 用户交互后触发了什么        | 只有 1 行代码的 getter/setter             |
| HTTP 错误码处理、token 注入 | 已被 E2E 覆盖的业务流程                   |
| 表单校验逻辑                |                                           |

### 3.2 配置速读（`vitest.config.ts`）

```typescript
export default defineConfig({
  test: {
    environment: "jsdom", // 用 jsdom 模拟浏览器，让 React 组件能运行
    globals: true, // 全局注入 describe / it / expect，无需每次 import
    setupFiles: ["./src/__tests__/setup.ts"], // 每个测试前先跑的初始化文件
    exclude: ["src/__e2e__/**"], // E2E 文件由 Playwright 负责，排除
  },
  resolve: {
    alias: {
      // next/navigation 的 useRouter 依赖服务器运行时，jsdom 里直接 import 会崩
      // 用 alias 替换为 vi.fn() Mock 版本
      "next/navigation": path.resolve(
        "./src/__tests__/mocks/next-navigation.ts",
      ),
    },
  },
});
```

> **为什么需要 jsdom？**  
> Vitest 默认在 Node.js 环境运行，没有 `document`、`window`。  
> jsdom 是纯 JS 实现的"假浏览器"，让 React 能正常渲染和操作 DOM。

### 3.3 全局初始化（`setup.ts`）

每个测试文件执行前，`setup.ts` 先跑，补全 jsdom 缺失的浏览器 API：

```typescript
// ① 引入 jest-dom 扩展断言
// 没有这行：expect(el).toBeInTheDocument() 会报 "not a function"
import "@testing-library/jest-dom";

// ② 补全 localStorage（jsdom 内置版不完整）
const store: Record<string, string> = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  },
});

// ③ 补全 matchMedia（Tailwind 暗色模式用到，jsdom 没有）
Object.defineProperty(window, "matchMedia", {
  value: vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
});
```

### 3.4 测试 Store

Store 测试最简单：直接调用方法，检查状态变化。

```typescript
// auth-store.test.ts
import { useAuthStore } from "@/store/useAuthStore";
import { act } from "@testing-library/react";

beforeEach(() => {
  localStorage.clear();
  // 每次测试前将 store 重置到初始状态，防止测试间互相污染
  useAuthStore.setState({ isAuthenticated: false, token: null });
});

describe("login()", () => {
  it("存储 token 并将 isAuthenticated 置为 true", () => {
    // act() 包裹：等待 React 状态批处理完成再断言
    act(() => {
      useAuthStore.getState().login("my-jwt-token", "admin");
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe("my-jwt-token");
    expect(localStorage.getItem("auth_token")).toBe("my-jwt-token"); // 副作用
  });

  it("logout() 清空 token 并重置状态", () => {
    act(() => {
      useAuthStore.getState().login("my-jwt-token", "admin");
      useAuthStore.getState().logout();
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem("auth_token")).toBeNull();
  });
});
```

> **为什么用 `act()`？**  
> Zustand 的 `set()` 是同步的，但 React 的重渲染是异步批处理的。  
> `act()` 等待所有挂起的更新处理完毕，确保断言读到最新状态。

### 3.5 测试 HTTP 客户端（MSW 拦截网络层）

**不要** 直接 mock axios 本身——那样会跳过拦截器、错误处理等核心逻辑。  
用 MSW 在**网络层**拦截，让 axios 真实运行：

```
直接 mock axios：axios 被整体替换 → 拦截器 / 401 处理全部跑不到（覆盖太少）
MSW 拦截：       axios 真实运行 → 发出网络请求 → MSW 截住 → 返回假数据
                                                 ↑ 所有中间件都被完整测到
```

```typescript
// http.test.ts
import { setupServer } from "msw/node";
import { http as mswHttp, HttpResponse } from "msw";
import { http } from "@/api/http"; // 你的 axios 封装

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers(); // 清空本次测试注册的拦截规则
  localStorage.clear();
});

it("请求头自动携带 Bearer token", async () => {
  localStorage.setItem("auth_token", "my-jwt");
  let capturedAuth = "";

  server.use(
    mswHttp.get("*/api/profile", ({ request }) => {
      capturedAuth = request.headers.get("Authorization") ?? "";
      return HttpResponse.json({ code: 200, data: {} });
    }),
  );

  await http.get("/profile");
  expect(capturedAuth).toBe("Bearer my-jwt");
});

it("收到业务 code=401 时，清除 token 并跳转 /login", async () => {
  localStorage.setItem("auth_token", "expired-token");

  server.use(
    mswHttp.get("*/api/secret", () =>
      HttpResponse.json({ code: 401, message: "未授权", data: null }),
    ),
  );

  await expect(http.get("/secret")).rejects.toBeDefined();
  expect(localStorage.getItem("auth_token")).toBeNull();
  expect(window.location.href).toContain("/login");
});
```

### 3.6 测试组件（四步走）

组件测试固定节奏：**声明 Mock → 渲染 → 模拟操作 → 断言**

#### 第一步：声明 Mock

> ⚠️ **关键**：`vi.mock()` 会被 Vitest 提升（hoisting）到文件最顶部执行。  
> 如果 mock 工厂里引用了普通变量，此时变量还未初始化（值是 `undefined`）。  
> 用 `vi.hoisted()` 让变量和 `vi.mock()` 同步提升，解决这个问题。

```typescript
// 每个外部依赖都要声明 mock，然后在 vi.mock() 里使用
const mockPush = vi.hoisted(() => vi.fn());
const mockLogin = vi.hoisted(() => vi.fn());
const mockApiCall = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));
vi.mock("@/store/useAuthStore", () => ({
  useAuthStore: (sel: Function) => sel({ login: mockLogin }),
}));
vi.mock("@/api", () => ({
  authApi: { login: mockApiCall },
}));

// ✅ 被测组件必须在所有 vi.mock() 之后 import
import { LoginPage } from "@/views/LoginPage";
```

#### 第二步：渲染

```typescript
it('渲染用户名和密码输入框', () => {
  render(<LoginPage />);
  expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});
```

#### 第三步：模拟用户输入

```typescript
// ✅ 用 userEvent.type() 逐字符输入，触发完整事件链（onChange、onBlur、表单校验）
// ❌ 不要用 fireEvent.change()，它不触发 react-hook-form 受控组件的校验逻辑
const user = userEvent.setup();
await user.type(screen.getByPlaceholderText("Username"), "admin");
await user.type(screen.getByPlaceholderText("Password"), "pass123");
```

#### 第四步：等待异步操作并断言

```typescript
it('登录成功后跳转首页', async () => {
  mockApiCall.mockResolvedValue({ tokens: { accessToken: 'jwt-abc' } });

  render(<LoginPage />);
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('Username'), 'admin');
  await user.type(screen.getByPlaceholderText('Password'), 'pass123');
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  // waitFor：轮询等待，直到断言全部通过或超时
  // 用于：API 调用完成 → 状态更新 → 组件重渲染 这条异步链
  await waitFor(() => {
    expect(mockApiCall).toHaveBeenCalledWith({ username: 'admin', password: 'pass123' });
    expect(mockLogin).toHaveBeenCalledWith('jwt-abc');
    expect(mockPush).toHaveBeenCalledWith('/');
  });
});
```

### 3.7 Mock 速查

```typescript
// ── 控制返回值 ─────────────────────────────────────────────────
fn.mockReturnValue(42); // 每次调用都返回 42
fn.mockReturnValueOnce("first"); // 仅下一次调用返回 'first'
fn.mockResolvedValue({ ok: true }); // 返回 Promise.resolve(...)
fn.mockRejectedValue(new Error()); // 返回 Promise.reject(...)
fn.mockImplementation((x) => x * 2); // 自定义实现逻辑

// ── 调用断言 ───────────────────────────────────────────────────
expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledWith("arg1", "arg2");
expect(fn).toHaveBeenCalledTimes(3);
expect(fn).not.toHaveBeenCalled();

// ── 重置（通常在 beforeEach / afterEach 里）─────────────────────
vi.clearAllMocks(); // 清调用记录，保留 mockReturnValue 配置
vi.resetAllMocks(); // 清调用记录 + 清 mockReturnValue 配置
vi.restoreAllMocks(); // 恢复所有 spyOn 的真实实现

// ── Mock Zustand Store 两种场景 ────────────────────────────────
// 场景 1：组件里 useXxxStore(selector) 的写法（React Hook 形式）
vi.mock("@/store/useMyStore", () => ({
  useMyStore: (sel: Function) => sel({ count: 0, increment: vi.fn() }),
}));

// 场景 2：非组件里 useXxxStore.getState() 的写法（如 HttpClient 内部）
vi.mock("@/store/useMyStore", () => ({
  useMyStore: { getState: () => ({ count: 0 }) },
}));

// ── Testing Library 常用 API ───────────────────────────────────
screen.getByRole("button", { name: /submit/i }); // 按 ARIA role 查找（最推荐）
screen.getByText("Hello"); // 按文本内容查找
screen.getByPlaceholderText("Enter name"); // 按 placeholder 查找
screen.getByLabelText("Username"); // 按 label 关联 input 查找
screen.queryByText("Maybe not here"); // 找不到返回 null，不抛错
await screen.findByText("Loaded!"); // 异步等待元素出现

await waitFor(() => expect(x).toBe(true)); // 等待断言通过
```

---

## 四、后端单元测试（NestJS / Jest）

### 4.1 测试策略

后端单元测试只针对 **Service 层**（业务逻辑）。Controller 和 Guard 通过 E2E 覆盖。

```
Controller ──→ 只做路由分发，逻辑少，E2E 覆盖
    │
Service    ──→ 核心业务逻辑，单元测试重点
    │
Prisma     ──→ 数据访问层，全部 Mock 掉
```

测试 Service 时，**不启动 NestJS 应用**，只实例化 Service + Mock 依赖：

```
完整 NestJS 应用（不启动）       Service 测试（只实例化这些）
──────────────────────          ─────────────────────────────
AppModule                       Test.createTestingModule({
  DatabaseModule        →         providers: [
  RedisModule                       MyService,
  MyModule                          { provide: PrismaService, useValue: mockPrisma },
    MyService                       { provide: RedisService,  useValue: mockRedis },
                                  ]
                                })
```

### 4.2 配置（`jest.config.js`）

```javascript
// apps/api/jest.config.js
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$", // 只找 *.spec.ts 文件
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        // 用 ts-jest 直接读 TypeScript 源文件
        tsconfig: "<rootDir>/../tsconfig.json",
      },
    ],
  },
  testEnvironment: "node",
  testPathIgnorePatterns: [
    "/node_modules/",
    "app.controller.spec.ts", // 脚手架自带的 stub，永久排除
  ],
  moduleNameMapper: {
    // 必须与 tsconfig.json 的 paths 配置一一对应
    "^@api/(.*)$": "<rootDir>/$1",
    "^@myorg/shared$":
      "<rootDir>/../../../node_modules/@myorg/shared/dist/index.js",
  },
};
```

> **为什么用 ts-jest 而不是 Babel？**  
> Babel 只剥离类型，不做类型检查。ts-jest 直接调用 TypeScript 编译器，  
> 能在测试时发现类型错误（参数数量不对、字段名拼错等）。

### 4.3 Service 测试模板

```typescript
// my-feature.service.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ConflictException } from "@nestjs/common";
import { MyFeatureService } from "./my-feature.service";
import { PrismaService } from "@api/common/prisma/prisma.service";

// ─── 1. 建立 Mock 对象（只需镜像 Service 里实际调用的方法）────────
const mockPrisma = {
  myModel: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
};

// ─── 2. 套件固定结构 ──────────────────────────────────────────────
describe("MyFeatureService", () => {
  let service: MyFeatureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyFeatureService,
        { provide: PrismaService, useValue: mockPrisma },
        // Service 构造函数有几个依赖，这里就要提供几个 Mock
      ],
    }).compile();

    service = module.get<MyFeatureService>(MyFeatureService);
  });

  afterEach(() => jest.clearAllMocks()); // 清调用记录，防止测试间污染

  // ─── 3. 基础用例（每个 Service 必须有）──────────────────────────
  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ─── 4. 按方法分组，每个分支一个用例 ────────────────────────────
  describe("findOne(id)", () => {
    it("记录存在时返回数据", async () => {
      const mockData = { id: "1", name: "test", createdAt: new Date() };
      mockPrisma.myModel.findUnique.mockResolvedValue(mockData);

      const result = await service.findOne("1");

      expect(result).toEqual(mockData);
      // 验证调用参数正确（不只是"被调用了"）
      expect(mockPrisma.myModel.findUnique).toHaveBeenCalledWith({
        where: { id: "1" },
      });
    });

    it("记录不存在时抛出 NotFoundException", async () => {
      mockPrisma.myModel.findUnique.mockResolvedValue(null);
      await expect(service.findOne("no-id")).rejects.toThrow(NotFoundException);
    });
  });

  describe("create(dto)", () => {
    it("名称冲突时抛出 ConflictException", async () => {
      mockPrisma.myModel.findUnique.mockResolvedValue({ id: "existing" }); // 已存在
      await expect(service.create({ name: "duplicate" })).rejects.toThrow(
        ConflictException,
      );
    });

    it("成功创建并返回新记录", async () => {
      mockPrisma.myModel.findUnique.mockResolvedValue(null); // 无冲突
      mockPrisma.myModel.create.mockResolvedValue({
        id: "new-id",
        name: "new",
      });

      const result = await service.create({ name: "new" });

      expect(result.id).toBe("new-id");
      // expect.objectContaining：只断言关心的字段，其余忽略
      expect(mockPrisma.myModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "new" }),
        }),
      );
    });
  });
});
```

### 4.4 常用 Mock 技巧

```typescript
// ── $transaction 两种用法 ──────────────────────────────────────────

// 写法 1：数组模式 — prisma.$transaction([query1, query2])
mockPrisma.$transaction.mockImplementation(
  async ([countQ, listQ]: [Promise<number>, Promise<unknown[]>]) => [
    await countQ,
    await listQ,
  ],
);

// 写法 2：回调模式 — prisma.$transaction(async (ctx) => { ... })
mockPrisma.$transaction.mockImplementation(
  async (fn: (ctx: typeof mockPrisma) => Promise<void>) => fn(mockPrisma),
);

// ── 测试 fire-and-forget（不阻塞主流程的异步操作）─────────────────
// 常见场景：发邮件、发推送通知
// Service 里通常是：this.emailService.send(...).catch(e => logger.error(e))
// 加一次 await Promise.resolve() 清空微任务队列，再断言

it("触发邮件发送（不阻塞主流程）", async () => {
  const mockSend = jest.fn().mockResolvedValue(undefined);
  await service.doSomething();
  await Promise.resolve(); // 让 fire-and-forget 的微任务执行
  expect(mockSend).toHaveBeenCalled();
});

it("邮件失败不影响主业务", async () => {
  const mockSend = jest.fn().mockRejectedValue(new Error("SMTP down"));
  // 即使邮件失败，主业务的 Promise 应该正常 resolve
  await expect(service.doSomething()).resolves.toBeDefined();
});

// ── it.each：批量测试相似用例（避免重复代码）─────────────────────
const INVALID_DOMAINS = ["mailinator.com", "guerrillamail.com", "tempmail.com"];

it.each(INVALID_DOMAINS)("拒绝垃圾邮箱域名: %s", async (domain) => {
  await expect(service.create({ email: `user@${domain}` })).rejects.toThrow(
    BadRequestException,
  );
});
```

---

## 五、E2E 测试（Playwright）

### 5.1 测试架构

```
playwright test
       │
[setup project]  auth.setup.ts（只跑一次）
  ① 通过 UI 登录 → 保存 Cookie + localStorage 到 admin.json
  ② 预热所有路由（触发 Turbopack 编译，避免 spec 里超时）
       │
[chromium project]  *.spec.ts（串行执行）
  每个 spec 加载 admin.json → 浏览器已登录状态 → 直接测试业务
```

**为什么要「预热」路由？**  
Next.js Turbopack 是懒编译的，第一次访问某路由才开始编译，耗时 1~2 分钟。  
setup 阶段提前访问所有路由，后续每个 spec 打开页面就是秒级的。

### 5.2 配置速读（`playwright.config.ts`）

```typescript
export default defineConfig({
  fullyParallel: false, // 禁止并行——共享数据库，并行会互相干扰数据
  retries: process.env.CI ? 2 : 0, // CI 里失败自动重试 2 次（容错网络抖动）
  workers: 1, // 单线程，保证测试顺序可控
  timeout: 120_000, // 每个 test 最多 2 分钟

  use: {
    baseURL: "https://your-dev-domain.com",
    ignoreHTTPSErrors: true, // 本地自签名证书，忽略 HTTPS 报错
    trace: "on-first-retry", // 失败重试时录制操作轨迹
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },

  projects: [
    // 1. setup：全局初始化（只跑一次）
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      timeout: 1_800_000, // 30 分钟（冷启动 Turbopack 编译所有路由）
    },
    // 2. chromium：认证保护页（依赖 setup，复用登录状态）
    {
      name: "chromium",
      use: { storageState: "playwright/.auth/admin.json" },
      dependencies: ["setup"],
      testIgnore: [/auth\.setup\.ts/],
    },
    // 3. public：公开页（见第六章）
  ],
});
```

### 5.3 共享工具（`fixtures.ts` / `helpers.ts`）

```typescript
// fixtures.ts

// 等侧边栏 <aside> 出现 = Auth Guard 完成 + 布局渲染完毕
export async function waitForDashboard(page: Page, timeout = 60_000) {
  await page.locator("aside").waitFor({ state: "visible", timeout });
}

// 验证页面没崩（Next.js 崩溃时会向页面注入错误文本）
export async function expectNoError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error", {
    timeout: 10_000,
  });
}

// 清除 Next.js 开发模式覆盖层（会遮挡按钮导致点击失败）
export async function dismissDevOverlay(page: Page) {
  await page
    .evaluate(() => {
      document
        .querySelectorAll("nextjs-portal, [data-nextjs-dev-overlay]")
        .forEach((el) => el.remove());
    })
    .catch(() => {});
}
```

```typescript
// helpers.ts

// auth.setup.ts 用：通过 UI 完整走登录流程
export async function loginViaUI(page: Page) {
  await page.goto("/login/");
  await page
    .getByLabel("Username")
    .fill(process.env.E2E_ADMIN_USERNAME ?? "admin");
  await page
    .getByLabel("Password")
    .fill(process.env.E2E_ADMIN_PASSWORD ?? "Admin@123456");
  await page.getByRole("button", { name: /sign in/i }).click({ force: true });
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 600_000,
    waitUntil: "commit", // 只等 URL 改变，不等页面完全加载（更快）
  });
}
```

### 5.4 spec 文件模板（认证保护页）

```typescript
// src/__e2e__/my-page.spec.ts
import { test, expect } from "@playwright/test";
import { expectNoError, dismissDevOverlay, waitForDashboard } from "./fixtures";

test.describe("My Page — /my-page", () => {
  // 每个 test 前固定四步：导航 → 等待布局 → 清覆盖层 → 验证无崩溃
  test.beforeEach(async ({ page }) => {
    await page.goto("/my-page/");
    await waitForDashboard(page);
    await expectNoError(page);
    await dismissDevOverlay(page);
  });

  test("页面加载不崩溃", async ({ page }) => {
    await expect(page.locator("body")).not.toContainText("Application error", {
      timeout: 20_000,
    });
  });

  test("显示页面标题", async ({ page }) => {
    await expect(page.getByText(/my page title/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("表格渲染（含必要列头）", async ({ page }) => {
    await expect(page.locator("table").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Name").first()).toBeVisible();
    await expect(page.getByText("Status").first()).toBeVisible();
  });

  test("搜索框可输入内容", async ({ page }) => {
    const input = page.getByPlaceholderText(/search/i).first();
    await input.fill("test");
    await expect(input).toHaveValue("test");
  });

  test("点击 Create 按钮弹出弹窗", async ({ page }) => {
    await page.getByRole("button", { name: /create/i }).click({ force: true });
    await expect(
      page.locator('[role="dialog"]').or(page.locator('[data-state="open"]')),
    ).toBeVisible({ timeout: 8_000 });
    await expectNoError(page);
  });
});
```

### 5.5 处理「需要未登录状态」的测试

所有 spec 默认加载了已登录的 storageState。需要未登录状态时，在用例开头手动清除：

```typescript
test("未登录访问 / 时自动跳转到 /login", async ({ page }) => {
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear()).catch(() => {});

  await page.goto("/");
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  expect(page.url()).toContain("/login");
});
```

### 5.6 auth.setup.ts — 预热路由规范

```typescript
// 认证路由（需要登录，等侧边栏 <aside> 出现确认加载完毕）
const WARMUP_ROUTES = [
  "/",
  "/orders/",
  "/users/",
  "/products/",
  // ⚠️ 新增受保护路由时在这里追加
];

// 公开路由（不需要登录，只等 <body> 可见）
const PUBLIC_WARMUP_ROUTES = [
  "/register-apply/",
  // ⚠️ 新增公开路由时在这里追加
];
```

> **规范**：每次新增业务路由，必须同步在对应数组里追加。  
> 否则该路由的 spec 会在首次运行时触发冷编译，超时风险大增。

---

## 六、公开页 E2E — 隔离模式

### 6.1 为什么需要特殊处理

公开页（如 `/register-apply/`、`/reset-password/`）的特殊性：

1. **不需要登录** — 不应依赖 `setup` project（否则 setup 失败会拖累公开页测试）
2. **Server Component 陷阱** — `page.tsx` 是 RSC，若直接 import 使用 `React.createContext()` 的 Client-only 库，会在服务端渲染时崩溃（HTTP 500）

如果把公开页测试混入 `chromium` project：

- 公开页 500 → 产生误导性 FAIL，报告里全是 Turbopack 内部堆栈
- 公开页与认证页共用依赖链，一处出问题影响全部

### 6.2 三层防御体系

```
公开页出现 500 或 RSC 编译错误
         │
    第 1 层  auth.setup.ts 预热（PUBLIC_WARMUP_ROUTES）
             setup 阶段就能发现问题，⚠️ 打印警告，人工介入
             不等 <aside>，只等 <body> 可见（公开页没有侧边栏）
         │
    第 2 层  playwright.config.ts 的 public project
             独立 project，无 auth，不依赖 setup
             chromium.testIgnore 排除公开页 spec
             → 公开页失败，100% 不影响其他认证页测试
         │
    第 3 层  spec 内 beforeAll 健康检查
             HTTP status >= 500 → test.skip() 整组
             runtime 错误文本检测 → test.skip()
             产生清晰的 ⛔ 日志，不产生误导性 FAIL
```

### 6.3 `playwright.config.ts` 三段式结构

```typescript
projects: [
  // 段 1：setup（认证 + 预热，包含公开路由）
  { name: 'setup', testMatch: /auth\.setup\.ts/, timeout: 1_800_000 },

  // 段 2：chromium（认证保护页）
  {
    name: 'chromium',
    use: { storageState: STORAGE_STATE },
    dependencies: ['setup'],
    // ⚠️ 新增公开页 spec 时，在 testIgnore 里加上文件名
    testIgnore: [/auth\.setup\.ts/, /register-apply\.spec\.ts/],
  },

  // 段 3：public（公开页，独立运行，无需等 setup）
  {
    name: 'public',
    use: { storageState: { cookies: [], origins: [] } },
    // ⚠️ 新增公开页 spec 时，在 testMatch 里加上文件名
    testMatch: /register-apply\.spec\.ts/,
  },
],
```

### 6.4 公开页 spec 模板（含健康检查 guard）

```typescript
/**
 * E2E — Xxx Page (/xxx)
 *
 * ✅ 属于 "public" project（无需登录，不依赖 setup）
 * ✅ beforeAll 健康检查：页面 500 时自动 skip，不影响 chromium project
 */
import { test, expect } from "@playwright/test";
import { dismissDevOverlay, expectNoError } from "./fixtures";

const PATH = "/xxx/";

// ── 第 3 层防御：beforeAll 健康检查 ───────────────────────────────────
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  try {
    const res = await page.goto(PATH, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if ((res?.status() ?? 0) >= 500) {
      console.error(`⛔ ${PATH} 返回 HTTP ${res?.status()} — 跳过整组测试`);
      test.skip();
    }

    // Next.js RSC 渲染失败时，错误文本会被注入到页面 body
    const body = await page.textContent("body").catch(() => "");
    if (
      body?.includes("Application error") ||
      body?.includes("createContext) is not a function")
    ) {
      console.error(`⛔ ${PATH} 存在 runtime 错误 — 跳过整组测试`);
      test.skip();
    }
  } finally {
    await ctx.close();
  }
});

// ── 测试主体 ────────────────────────────────────────────────────────────
test.describe("Xxx Page — /xxx", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PATH);
    await page.waitForLoadState("domcontentloaded");
    await dismissDevOverlay(page);
    await expectNoError(page);
  });

  test("页面加载不崩溃，不跳转到 /login", async ({ page }) => {
    expect(page.url()).toContain("/xxx");
    await expect(page.locator("body")).not.toContainText("Application error", {
      timeout: 20_000,
    });
  });

  test("表单元素全部渲染", async ({ page }) => {
    await expect(page.locator("form").first()).toBeVisible({ timeout: 15_000 });
  });

  test("空提交触发校验错误", async ({ page }) => {
    await page.getByRole("button", { name: /submit/i }).click({ force: true });
    await expect(
      page
        .locator('[class*="text-red"], [class*="error"], [role="alert"]')
        .first(),
    ).toBeVisible({ timeout: 8_000 });
  });
});
```

### 6.5 公开页常见错误

| 错误信息                                | 根因                                                                                                                | 修法                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `createContext is not a function`       | `page.tsx`（Server Component）直接 import 了使用 `React.createContext()` 的 Client-only 库（如 reCAPTCHA Provider） | 新建加了 `'use client'` 的包装组件，在 `page.tsx` 里改用包装组件，不直接 import Provider |
| `Module not found: Can't resolve 'xxx'` | 包在 `package.json` 声明了但未 `yarn install`，或 Docker volume 是旧的                                              | `yarn workspace <app> add xxx` + 重建 volume（见下方）                                   |
| `beforeAll guard skip` 整组被跳过       | 页面本身有问题，guard 正确触发                                                                                      | 先修页面，不要绕过 guard                                                                 |

```bash
# Docker volume 过期时的重建命令
docker rm -f <container-name>
docker volume rm <project>_admin_next_build <project>_admin_next_nm
docker compose --env-file deploy/.env.dev up -d admin-next
```

---

## 七、新增测试 — 逐步 Checklist

### ✅ 新增前端组件单元测试

```
□ 在 src/__tests__/views/ 下创建 MyPage.test.tsx
□ 用 vi.hoisted() 声明所有需要 mock 的函数
□ 用 vi.mock() 替换所有外部依赖（api、store、router）
□ 在所有 vi.mock() 之后 import 被测组件
□ beforeEach 里 vi.clearAllMocks() + 重置 store
□ 覆盖：正常渲染、用户交互、异步成功、异步失败、loading 状态
□ yarn workspace @lucky/admin-next test 确认全绿
```

### ✅ 新增后端 Service 单元测试

```
□ 在对应模块目录创建 my-feature.service.spec.ts
□ 建立 mockPrisma 等 Mock 对象，只镜像 Service 里实际调用的方法
□ 每个构造函数依赖都用 { provide: XxxService, useValue: mockXxx } 替换
□ afterEach(() => jest.clearAllMocks())
□ 覆盖：
    - 正常路径（happy path）
    - 记录不存在（NotFoundException）
    - 重复冲突（ConflictException）
    - 每种 throw 分支
    - fire-and-forget 副作用（邮件、通知）
□ yarn workspace @lucky/api test 确认全绿
```

### ✅ 新增 E2E 测试（认证保护页）

```
□ 创建 src/__e2e__/my-page.spec.ts，复用 §5.4 模板
□ auth.setup.ts → WARMUP_ROUTES 数组加入新路由
□ beforeEach 固定四步：goto → waitForDashboard → expectNoError → dismissDevOverlay
□ 覆盖：页面加载、主要元素渲染、核心交互（搜索、创建、弹窗）
□ npx playwright test my-page.spec.ts 单独验证后再合入
```

### ✅ 新增 E2E 测试（公开页）

```
□ 创建 src/__e2e__/my-public.spec.ts，复用 §6.4 模板
□ playwright.config.ts → chromium.testIgnore 追加 /my-public\.spec\.ts/
□ playwright.config.ts → public.testMatch 更新正则（加入新文件名）
□ auth.setup.ts → PUBLIC_WARMUP_ROUTES 加入新路由
□ 不要在 spec 文件里写 test.use({ storageState: ... })（由 public project 统一配置）
□ npx playwright test --project=public my-public.spec.ts 单独验证
```

---

## 八、十条铁律 — 写测试前必读

这些规则来自实际踩坑，违反任意一条都会导致测试不稳定或覆盖失效。

**1. 每个 test 必须独立**  
不依赖其他 test 的执行顺序和副作用。`beforeEach` 里重置 store、清空 localStorage、`clearAllMocks()`。

**2. 只 Mock 边界，不 Mock 被测代码内部**  
错误：mock Service 里的私有方法。正确：mock Service 依赖的 PrismaService、RedisService。

**3. 用 `getByRole` 而不是 `getByClassName`**  
className 会因样式重构而变，ARIA role 是语义稳定的，重构不会破坏测试。

**4. 禁止用 `fireEvent.change()` 测试 react-hook-form**  
不触发完整事件链，校验逻辑不会执行。正确做法：`userEvent.type()`。

**5. 禁止在 E2E 里直接操作数据库**  
破坏测试隔离，多人跑测试时数据互相干扰。通过 UI 操作或调用专用测试 API。

**6. E2E test 标题要说明「做了什么 + 期望什么」**  
错误：`test('table')`。正确：`test('渲染用户表格，包含 Username 和 Role 列')`。

**7. 公开页必须使用 `public` project，不能混入 `chromium` project**  
混入后，公开页 500 会导致报告里出现误导性失败，并可能影响其他测试。

**8. 新增路由必须同步更新 `auth.setup.ts` 的 warmup 列表**  
否则该路由首次被 spec 访问时触发 Turbopack 冷编译，大概率超时失败。

**9. 每个测试后必须清理资源**  
前端：`vi.clearAllMocks()`。MSW 测试：`server.resetHandlers()`。E2E 健康检查：`await ctx.close()`。

**10. 覆盖率是手段，不是目标**  
不要为了凑覆盖率写无意义的 `it('should be defined')`。  
每个用例都要能回答："如果这个测试失败，说明哪段业务逻辑出了问题？"

---

## 九、报错速查

### 前端单元测试（Vitest）

| 报错                                                  | 原因                                          | 修法                                                              |
| ----------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| `useRouter is not a function`                         | `vitest.config.ts` 的 alias 路径不对          | 检查 `next/navigation` 的 alias 指向正确的 mock 文件              |
| `Cannot read properties of undefined (reading 'xxx')` | mock 返回了 `undefined`，组件访问深层属性崩溃 | 检查 `mockReturnValue` 提供了完整的数据结构                       |
| `Warning: An update to X was not wrapped in act(...)` | 异步状态更新没被包裹                          | 用 `await waitFor(() => ...)` 或 `await act(async () => { ... })` |
| `vi.mock() factory 里变量是 undefined`                | 在工厂里用了普通变量（提升顺序问题）          | 改用 `vi.hoisted()` 声明该变量                                    |
| `toBeInTheDocument is not a function`                 | 没有引入 jest-dom                             | 在 `setup.ts` 里加 `import '@testing-library/jest-dom'`           |

### 后端单元测试（Jest）

| 报错                                | 原因                                                     | 修法                                                                               |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Cannot find module '@api/xxx'`     | `moduleNameMapper` 配置缺失或路径错误                    | 检查 `jest.config.js` 的 `moduleNameMapper` 与 `tsconfig.json` 的 `paths` 一一对应 |
| `SyntaxError: Unexpected token '<'` | ts-jest 未安装，Jest 用 Babel 解析 TS                    | `yarn workspace @lucky/api add -D ts-jest @types/jest`                             |
| `Expected 2 arguments, but got 3`   | 测试调用参数数量与 Service 方法签名不符                  | 去源文件确认方法签名，不要凭记忆写参数                                             |
| `$transaction` 相关断言失败         | mock 写法与 Service 实际使用的 `$transaction` 模式不匹配 | 确认 Service 用的是数组模式还是回调模式，参见 §4.4                                 |

### E2E 测试（Playwright）

| 报错                                          | 原因                                                         | 修法                                                     |
| --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `Timeout 120000ms exceeded`                   | Turbopack 首次编译太慢                                       | 先单独跑 setup 预热：`npx playwright test auth.setup.ts` |
| `getByLabel('Username') 找不到元素`           | `<label>` 的 `htmlFor` 与 `<input>` 的 `id` 不匹配，或有遮挡 | 检查 HTML 结构；加 `dismissDevOverlay(page)` 清除覆盖层  |
| `createContext is not a function`（HTTP 500） | Server Component 直接 import 了 Client-only 库               | 新建 `'use client'` 包装组件，`page.tsx` 改用包装组件    |
| `Module not found: Can't resolve 'xxx'`       | 包未安装或 Docker volume 过期                                | `yarn add xxx` + 重建 volume                             |
| 本地通过，CI 失败                             | GitHub Secrets 缺失                                          | 检查 `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD`         |
| 公开页 `beforeAll guard` 整组 skip            | 页面本身有问题，guard 正确触发                               | 先修页面，不要绕过 guard                                 |
