# Lighthouse CI + Sentry 接入指南

> **建立日期**：2026-03-22  
> **适用工程**：`apps/admin-next`（Next.js 15 standalone）  
> **目的**：用两个免费工具把性能监控从「手动跑一次」升级为「自动持续监控」

---

## 一、全景图：这两个工具解决什么问题

```
现状（手动）：
  你 → 记得 → 手动跑 yarn perf:lighthouse → 看结果 → 忘了

目标（自动）：
  git push → GitHub Actions 自动跑 → 结果发到 PR 评论 → LCP 变差了直接标红
                                    ↓
                              Sentry 收集真实用户的报错
                              （谁，什么页面，什么操作，stack trace）
```

### 两个工具的分工

| 工具                     | 解决什么                | 数据来源               | 免费额度                             |
| ------------------------ | ----------------------- | ---------------------- | ------------------------------------ |
| **Lighthouse CI (LHCI)** | 防止每次发布后性能退化  | 合成测试（模拟浏览器） | GitHub Actions 分钟数（2000min/月）  |
| **Sentry**               | 生产报错可见 + 定位到行 | 真实用户访问           | 10,000 事件/月（管理后台绝对用不完） |

---

## 二、Lighthouse CI — 原理与架构

### 2.1 LHCI 和我们现有的 `run.mjs` 有什么区别？

```
run.mjs（你已有）          LHCI（Google 官方工具）
─────────────────────────  ──────────────────────────────
✅ 手动触发               ✅ 自动触发（git push/PR）
✅ 多次运行取中位数        ✅ 多次运行取中位数
✅ 本地报告文件            ✅ 上传到临时公共存储（可看趋势图）
❌ 没有 PR 评论            ✅ 自动发 PR 评论（数字+状态）
❌ 没有历史趋势            ✅ 历史趋势（每次 deploy 的 LCP 变化）
❌ 不防退化                ✅ 断言（超阈值标红，阻止合并）
```

两者不冲突：

- 本地开发用 `run.mjs`（详细报告，支持登录态）
- CI 用 LHCI（自动化，趋势，PR 门禁）

### 2.2 LHCI 的执行流程

```
git push / PR 到 main
        ↓
GitHub Actions 启动虚拟机
        ↓
Step 1：curl 生产 API 拿登录 Token
        ↓
Step 2：把 Token 设为环境变量 LHCI_COOKIE
        ↓
Step 3：lhci autorun（= collect + upload + assert）
  │
  ├─ collect：Chrome 打开 5 个页面，每页跑 1 次
  ├─ upload：结果上传到 temporary-public-storage（免费，保存 7 天）
  └─ assert：LCP > 2500ms ？→ warn / TBT > 600ms ？→ error 标红
        ↓
Step 4：GitHub Actions 上传原始 HTML 报告为 Artifacts（保存 30 天）
        ↓
Step 5：在 PR 评论发布汇总表（LCP / TBT / CLS + 通过/失败）
```

### 2.3 涉及的文件

```
apps/admin-next/
  lighthouserc.js               ← LHCI 配置（页面 URL、阈值、上传目标，CI 主入口）
  lighthouserc.mjs              ← 兼容层（仅为旧引用保留）

.github/workflows/
  lighthouse-ci.yml             ← GitHub Actions 工作流（触发 + 登录 + 跑 LHCI）
```

### 2.4 需要在 GitHub Secrets 里配置

```
GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret

LIGHTHOUSE_ADMIN_USERNAME   管理员账号（用于生产域名登录拿 Token）
LIGHTHOUSE_ADMIN_PASSWORD   管理员密码
```

> Token 有效期一般是数小时，CI 每次跑前都会重新获取，不会过期。

### 2.5 关键概念：temporary-public-storage

LHCI 把结果上传到 Google 提供的临时公共存储（`storage.googleapis.com`），生成一个 URL，7 天后自动删除。

**这意味着什么：**

- ✅ 免费，不需要自己搭服务器
- ✅ 可以看历史趋势（URL 会贴在 PR 评论里）
- ⚠️ 数据是公开的（但只有指标数字，没有你的代码或用户数据，可以接受）
- ⚠️ 7 天后删除（本地 Artifacts 保存 30 天，更长久）

---

## 三、Sentry — 原理与接入架构

### 3.1 Sentry 做什么

```
用户在浏览器里点「审核通过」→ 前端 JS 报错 → Sentry SDK 捕获
                                                    ↓
                                          Sentry 后台看到：
                                          - 报错文件 + 行号（因为有 source map）
                                          - 用户操作路径（面包屑）
                                          - 请求 URL + 参数
                                          - 报错次数 + 影响用户数
```

### 3.2 Next.js + Sentry 的三层配置

Next.js 有三个运行环境，Sentry 分别配置：

```
sentry.client.config.ts    ← 浏览器端：捕获前端 JS 报错
sentry.server.config.ts    ← Node.js 服务端：捕获 Server Component / API Route 报错
sentry.edge.config.ts      ← Edge Runtime：捕获 middleware 报错

src/instrumentation.ts     ← Next.js 生命周期钩子，启动时初始化 Sentry
next.config.ts             ← 用 withSentryConfig 包裹，开启 source map 上传
```

### 3.3 为什么要 Source Map 上传

生产代码被打包压缩后，报错 stack trace 长这样：

```
Error: Cannot read property 'id' of undefined
  at e.default.t.render (main.abc123.js:1:8734)   ← 看不懂
```

上传 source map 后，Sentry 还原成原始代码：

```
Error: Cannot read property 'id' of undefined
  at OrderManagementClient.tsx:142:5               ← 直接定位到行
  in handleApprove()
```

Source map 上传在 CI 构建时进行，需要 `SENTRY_AUTH_TOKEN`。

### 3.4 性能监控为什么用低采样

管理后台用户少（大概 2~5 人），性能事务采样：

```
tracesSampleRate: 0.1   ← 10% 采样
每天约 50 次页面访问 × 10% = 5 次性能事务
```

10,000 个免费额度 / 5 次/天 = 2000 天不会超额。  
同时保留了足够数据来定位偶发慢请求。

### 3.4.1 哪些请求应该 `trace: false`

`apps/admin-next/src/api/http.ts` 现在默认会给客户端请求自动加 tracing，但**不是所有请求都值得上报**。

**建议关闭 tracing 的场景：**

- 角标计数 / badge count（例如待审批数量）
- fallback polling（例如 10s / 30s 轮询拉消息、拉会话）
- socket 失败后的兜底刷新
- 页面隐藏后仍可能发生的低价值后台刷新

**建议保留 tracing 的场景：**

- 首屏加载慢查询
- 创建 / 编辑 / 审核 / 支付 / 导出 / 上传
- 客服回复、会话切换、关键业务动作
- 你怀疑“这里慢”的请求

示例：

```ts
http.get("/v1/admin/applications/pending-count", undefined, {
  trace: false,
});

http.get("/v1/admin/settings/detail", undefined, {
  trace: {
    name: "admin.http.settings_load",
    attributes: { feature: "settings" },
  },
});
```

### 3.5 需要在 GitHub Secrets 里配置

**最小必配（当前仓库建议）**

```bash
NEXT_PUBLIC_SENTRY_DSN=你的 Sentry 项目 DSN（公开值，前端可见）
SENTRY_AUTH_TOKEN=你的 Sentry API Token（用于 source map 上传，私密）
```

**可选（仅当你把 org/project 改为环境变量时才需要）**

```bash
SENTRY_ORG=你的 Sentry 组织 slug
SENTRY_PROJECT=你的 Sentry 项目 slug
```

> 当前仓库的 `apps/admin-next/next.config.ts` 已写死 `org` / `project`，
> 所以默认不需要单独配置 `SENTRY_ORG` / `SENTRY_PROJECT`。

同时加入 `apps/admin-next/.env.production`（本地 production build 用）：

```bash
NEXT_PUBLIC_SENTRY_DSN=https://xxx@ooo.ingest.sentry.io/yyy
SENTRY_AUTH_TOKEN=sntrys_xxx
# 可选（仅当 next.config.ts 改为读环境变量时）
# SENTRY_ORG=your-org
# SENTRY_PROJECT=your-project
```

### 3.6 如何注册免费 Sentry 账号

1. 打开 https://sentry.io/signup/
2. 用 GitHub 登录（推荐，方便）
3. 创建项目：选 `Next.js` → 项目名 `admin-next`
4. 复制 DSN（在 `Settings → Projects → admin-next → Client Keys`）
5. 生成 Auth Token（在 `Settings → Auth Tokens → Create New Token`，勾选 `project:releases` 和 `org:read`）

---

## 四、完整文件清单

```
新增文件：
  apps/admin-next/lighthouserc.js           LHCI 配置（CI 主入口）
  apps/admin-next/lighthouserc.mjs          兼容层（旧引用）
  apps/admin-next/sentry.client.config.ts   Sentry 客户端
  apps/admin-next/sentry.server.config.ts   Sentry 服务端
  apps/admin-next/sentry.edge.config.ts     Sentry Edge
  apps/admin-next/src/instrumentation.ts    Next.js 初始化钩子
  .github/workflows/lighthouse-ci.yml       LHCI CI 工作流
  read/devops/LHCI_SENTRY_SETUP_CN.md       （本文件）

修改文件：
  apps/admin-next/next.config.ts            加 withSentryConfig 包裹
  apps/admin-next/package.json              加依赖 + scripts
  package.json (root)                       加 perf:lhci 脚本
```

---

## 五、上线后如何验证

### LHCI 验证

1. 推一次代码到 `main`
2. 打开 GitHub → Actions → `Lighthouse CI` 工作流
3. 等待运行完成
4. 看 PR 评论里有没有 LCP/TBT 数字
5. 点 LHCI 生成的临时 URL，看趋势图

### Sentry 验证

1. 打开 `https://admin.joyminis.com`，登录
2. 打开浏览器 DevTools Network 标签
3. 刷新页面，看有没有发到 `sentry.io` 的请求（或经 `/monitoring` 隧道）
4. 在代码里临时扔一个 `throw new Error('Sentry test')`，看 Sentry 后台能不能收到
5. 删掉测试代码

### Sentry 错误去哪里看（线上排障入口）

1. 打开 Sentry 项目 → `Issues`
2. 筛选 `environment:production`
3. 点进某条 Issue，重点看：
   - `Stack Trace`（是否还原到源码行）
   - `Breadcrumbs`（报错前用户操作）
   - `Tags`（release / browser / url）
4. 修复后把 Issue 标记 `Resolved`，观察是否 `Regressed`

---

## 六、学习要点（看懂这些就掌握了）

1. **LHCI = 自动化版 Lighthouse**：把手动跑变成每次 push 自动跑，结果存到云上
2. **temporary-public-storage**：Google 提供的免费临时存储，不需要自己搭服务器
3. **Sentry 三层配置**：Next.js 有三个运行环境，Sentry 分别初始化
4. **Source map 的作用**：把压缩后的报错还原成原始文件 + 行号
5. **采样率（tracesSampleRate）**：不是所有请求都记录，只记录 10%，控制成本
6. **withSentryConfig 包裹**：在 `next build` 时自动上传 source map，无需手动操作
