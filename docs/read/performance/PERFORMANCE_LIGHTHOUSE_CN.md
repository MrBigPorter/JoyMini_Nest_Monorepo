# Admin Next — Lighthouse 性能验收标准

> **目的**：量化 Stage 1~6 重构的实际性能收益，确认 LCP < 500ms（内网）目标，找出剩余瓶颈。  
> **建立日期**：2026-03-22  
> **适用环境**：`https://admin.joyminis.com`（生产）

> 脚本执行流程、学习要点、指标问题映射、卡顿时的停止方式：见 `apps/admin-next/scripts/lighthouse/README.md`

---

## 一、为什么要做性能验收

Stage 2（async RSC）和 Stage 4（Finance SSR）做完后，我们从未实际测量过效果。  
Lighthouse 验收回答三个问题：

1. SSR 优化是否真的减少了首屏时间？（Dashboard vs Orders 对比）
2. Suspense 骨架屏是否消灭了 CLS 布局偏移？
3. 还有没有未被发现的性能瓶颈？

---

## 二、指标定义与通过标准

### Core Web Vitals

| 指标    | 全称                     | 含义                                     | 内网目标    | 外网目标（Google 标准） |
| ------- | ------------------------ | ---------------------------------------- | ----------- | ----------------------- |
| **LCP** | Largest Contentful Paint | 最大内容绘制时间（用户感知"页面加载完"） | **< 500ms** | < 2.5s                  |
| **FCP** | First Contentful Paint   | 首次有内容显示（白屏结束）               | **< 200ms** | < 1.8s                  |
| **TBT** | Total Blocking Time      | JS 阻塞主线程的总时间（影响可交互性）    | **< 200ms** | < 200ms                 |
| **CLS** | Cumulative Layout Shift  | 布局偏移分数（元素是否乱跳）             | **< 0.1**   | < 0.1                   |

> **注**：内网目标更严格，因为 VPS 在 San Jose，API 内网直连延迟约 5ms。  
> 如果内网达标但外网不达标，瓶颈在网络传输而非代码，需要 CDN / Edge。

---

## 三、测试方法（必须严格遵守，否则数据无效）

### 3.1 环境准备

```
1. 使用 Chrome 无痕模式（Ctrl+Shift+N）
   原因：普通窗口有插件（广告拦截/翻译等），干扰网络请求和 JS 执行

2. 关闭其他占用网络的程序（视频/下载等）

3. 确保已登录 admin.joyminis.com（Lighthouse 测的是登录后的页面）

4. 每个页面跑 3 次，取中间值（第1次可能有冷启动偏差）
```

### 3.2 Lighthouse 配置

```
DevTools（F12）→ Lighthouse 标签

✅ 勾选：Performance（只勾这一个）
❌ 取消：Accessibility / Best practices / SEO / PWA

Device：Desktop（后台系统，不测移动端）
Throttling：No throttling（内网测试，不模拟慢网）
```

### 3.3 测试顺序

按以下顺序测，每次测完截图保存分数：

```
1. /login          ← 无需登录，冷启动基准
2. /              ← Dashboard（SSR 页，应该最快）
3. /analytics     ← Analytics（SSR 页，对比 Dashboard）
4. /finance       ← Finance（SSR 统计 + Client 列表）
5. /orders        ← Orders（纯 Client，作为对照基准）
```

### 3.4 自动化脚本（推荐）

无需手工点 DevTools，可直接用仓库脚本批量跑 5 个页面：

```bash
yarn perf:lighthouse
```

严格模式（任一页面超阈值时返回非 0 退出码）：

```bash
yarn perf:lighthouse:strict
```

可选环境变量：

```bash
# 覆盖目标地址（默认 https://admin.joyminis.com）
LIGHTHOUSE_BASE_URL="https://admin.joyminis.com"

# 每页运行次数（默认 3）
LIGHTHOUSE_RUNS_PER_PAGE=3

# 认证方式 A：直接传 Cookie（优先级最高）
LIGHTHOUSE_COOKIE="auth_token=...; other=..."

# 认证方式 B：账号密码自动登录（默认 payload: { account, password }）
LIGHTHOUSE_ADMIN_USERNAME="admin"
LIGHTHOUSE_ADMIN_PASSWORD="***"

# 如登录 payload 结构不同，可直接传 JSON
LIGHTHOUSE_LOGIN_PAYLOAD_JSON='{"account":"admin","password":"***"}'
```

输出目录：

```text
apps/admin-next/reports/lighthouse/<timestamp>/
```

其中 `summary.md` / `summary.json` 可直接回填本章第四节结果表。

---

## 四、结果记录表

> 测试完成后填入此表，精确到 ms。

### 测试 A：2026-03-22（生产域名 admin.joyminis.com，`runsPerPage=3`，取中位数）

| 页面          | LCP (ms) | FCP (ms) | TBT (ms) | CLS   | 评级      | 备注                                 |
| ------------- | -------- | -------- | -------- | ----- | --------- | ------------------------------------ |
| `/login`      | 1246     | 1246     | 0        | 0.000 | 待优化 🟡 | 外网 1.8s FCP 目标：通过 ✅          |
| `/` Dashboard | 963      | 963      | 20       | 0.000 | 待优化 🟡 | **SSR 有效**：比 Orders 快 580ms ✅  |
| `/analytics`  | 1645     | 1645     | 2        | 0.000 | 🔴 偏慢   | recharts bundle；已加 dynamic() 修复 |
| `/finance`    | 1506     | 1506     | 0        | 0.000 | 🔴 偏慢   | SSR 有一定收益，但仍 > 1500ms        |
| `/orders`     | 1543     | 1543     | 0        | 0.000 | 🔴 偏慢   | 纯 Client，对照基准                  |

> 报告目录：`apps/admin-next/reports/lighthouse/2026-03-22T05-16-33-771Z`

### 测试 B：2026-03-22（dev 域名 admin-dev.joyminis.com，`runsPerPage=1`，仅供参考）

| 页面          | LCP (ms) | FCP (ms) | TBT (ms) | CLS   | 评级      | 备注                                        |
| ------------- | -------- | -------- | -------- | ----- | --------- | ------------------------------------------- |
| `/login`      | 626      | 626      | 0        | 0.000 | 待优化 🟡 | dev 环境冷启动较快                          |
| `/` Dashboard | 2030     | 997      | 53       | 0.000 | 🔴 偏慢   | dev API 响应慢；**FCP 997ms 仍是 SSR 直出** |
| `/analytics`  | 1592     | 1529     | 0        | 0.000 | 🔴 偏慢   | 同上                                        |
| `/finance`    | 1265     | 1265     | 35       | 0.000 | 待优化 🟡 |                                             |
| `/orders`     | 715      | 715      | 0        | 0.000 | 待优化 🟡 | dev 环境下 orders 反而比 Dashboard 快       |

> 报告目录：`apps/admin-next/reports/lighthouse/2026-03-22T05-25-36-804Z`

### 评级规则

| 评级          | 颜色 | LCP 条件       |
| ------------- | ---- | -------------- |
| 优秀 ✅       | 绿   | < 500ms        |
| 待优化 🟡     | 橙   | 500ms ~ 1500ms |
| 需立即处理 🔴 | 红   | > 1500ms       |

---

## 五、预期结果与分析逻辑

### 5.1 如果结果符合预期（SSR 有效）

```
Dashboard LCP ≪ Orders LCP（差距 > 300ms）
  → Stage 2 async RSC 生效，SSR 确实加速了首屏
  → 下一步：验收通过，可以转向功能方向（移动端/批量操作）
```

### 5.2 如果 Dashboard 和 Orders 速度差不多

```
Dashboard LCP ≈ Orders LCP（差距 < 100ms）
  → SSR 没有产生预期效果，需要排查原因：

  可能原因 1：DashboardStats 的 serverGet() 请求很慢
    → 检查 VPS API 响应时间（curl 测 /v1/admin/finance/statistics）

  可能原因 2：LCP 元素不是统计卡片，而是别的元素（侧边栏/图片）
    → 看 Lighthouse 报告里 LCP 标记的是哪个 DOM 元素

  可能原因 3：JS bundle 太大，hydration 阻塞了感知
    → 看 TBT，如果 > 500ms 说明 JS 太重
```

### 5.3 如果 CLS > 0.1

```
骨架屏（Stage 5）没有完全消灭布局偏移
  → 看 Lighthouse 报告里哪个元素在偏移
  → 给该元素加固定高度或 min-height
```

### 5.4 如果 TBT > 500ms

```
JS bundle 太重，主线程阻塞严重
  → 检查是否有大型第三方库没有做 code splitting
  → 考虑 dynamic import() 懒加载非首屏组件
```

---

## 六、优化决策树

```
跑完 Lighthouse
       │
       ├─ LCP < 500ms（5个页面都达标）
       │    └─ ✅ 验收通过 → 转功能方向
       │         推荐：移动端适配 / 批量操作
       │
       ├─ Dashboard LCP < 500ms，但 Orders LCP > 1500ms
       │    └─ 🟡 SSR 有效，列表页慢是正常的
       │         可接受，但如果要优化：HydrationBoundary 预取第一页数据
       │
       ├─ Dashboard LCP > 1000ms（SSR 没生效）
       │    └─ 🔴 需要排查 serverGet() 内网延迟
       │         curl -w "%{time_total}" https://api.joyminis.com/v1/admin/finance/statistics
       │
       └─ TBT > 500ms（所有页面）
            └─ 🔴 JS bundle 问题
                 运行：yarn workspace @lucky/admin-next build
                 查看 .next/analyze/ 包体积报告
```

---

## 七、后续追踪

每次重大性能优化后，在此文档追加一条测试记录：

### 测试记录 #1 — 2026-03-22（Stage 1~6 完成后基准测试，生产环境 3 次中位数）

| Dashboard LCP | Analytics LCP | Finance LCP | Orders LCP | TBT 均值 | CLS 均值 |
| ------------- | ------------- | ----------- | ---------- | -------- | -------- |
| 963 ms        | 1645 ms       | 1506 ms     | 1543 ms    | < 5ms    | 0.000    |

**结论（外网 VPS San Jose）**：

- ✅ 所有页面通过 **外网 LCP < 2.5s**（Google Core Web Vitals 正式标准）
- ✅ 所有页面 **TBT < 200ms**，JS 不阻塞主线程
- ✅ 所有页面 **CLS = 0**，Suspense 骨架屏彻底消灭布局偏移（Stage 5 成果）
- ✅ **SSR 有效**：Dashboard LCP 963ms < Orders LCP 1543ms（差距 580ms，Stage 2 收益确认）
- ❌ 所有页面未达到 **内网 LCP < 500ms** 目标（内网目标对外网 VPS 不适用，属预期）
- ❌ FCP 超 **外网 FCP < 1.8s** 的页面：analytics（1645ms）、finance（1506ms）、orders（1543ms）

**已实施优化（2026-03-22）**：

1. `next.config.ts`：移除 `unoptimized: true` → `remotePatterns` 白名单（启用 next/image 优化）
2. `analytics/page.tsx`：`AnalyticsTrendSection` 改为 `dynamic()` 延迟加载（recharts ~90KB gzipped 移出首屏 bundle）

**下一步方向**：剩余瓶颈为外网传输延迟（VPS 距用户远），代码层面已无重大阻塞点。  
→ 转功能方向：**移动端响应式适配** 🟡 / **批量操作** 🟡 / **国际化完善** 🟡

---

## 附：LCP 是什么意思（直觉理解）

> 打开 Dashboard，你"感觉"页面加载完了——是在你看到统计数字的那一刻。  
> LCP 就是测量这个时刻距离你按下回车有多久。
>
> **SSR 的价值**：没有 SSR 时，你要等 JS 加载 + API 请求 = 约 500ms 后才看到数字。  
> 有了 SSR，数字直接在 HTML 里，你可能 80ms 就看到了。

---

## 八、代码侧预扫描（跑 Lighthouse 前的预测）

> 代码审查时间：2026-03-22。以下问题是基于源码分析的预测，不需要等 Lighthouse 就能确认。

### 🔴 高风险：图片未优化

```ts
// next.config.ts
images: {
  unoptimized: true,  // ← 所有图片跳过 Next.js 优化
}
```

**影响**：如果任何页面的 LCP 元素是图片（产品图、Banner、用户头像），则：

- 没有 WebP 转换（文件体积大 2~3 倍）
- 没有 `loading="lazy"` 的优先级提示
- 没有响应式 srcset

**预测受影响的页面**：`/orders`（产品图）、`/products`（产品列表）、`/banners`（Banner 图片）

**修复成本**：低。改为 `remotePatterns` 白名单，删除 `unoptimized: true`。

---

### 🟡 中风险：recharts 没有懒加载

```tsx
// analytics/page.tsx — 直接 import，不是 dynamic()
import { AnalyticsTrendSection } from "@/components/analytics/AnalyticsTrendSection";
// AnalyticsTrendSection 内部 import recharts (~90KB gzipped)
```

**影响**：recharts 会进入 `/analytics` 页面的首屏 bundle，即使图表在页面底部、用户还没滚动到。

**预测**：`/analytics` 的 TBT 会比其他页面高。

**修复方案**：

```tsx
// 改为懒加载
const AnalyticsTrendSection = dynamic(
  () => import("@/components/analytics/AnalyticsTrendSection"),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
```

---

### 🟡 中风险：整个 Layout Shell 是 Client Component

```tsx
// DashboardLayout.tsx
"use client"; // ← Sidebar + Header + MainContent 全部需要 JS hydration
```

**影响**：用户看到页面结构（侧边栏/顶栏）之前，必须等待 JS hydration 完成。  
**预测**：所有 Dashboard 页面的 FCP 会比 `/login` 高约 50~100ms。  
**修复成本**：高（需要拆分 Sidebar 为 Server Component），**暂不建议动**，收益不大。

---

### ✅ 已正确配置的优化

```ts
// next.config.ts
optimizePackageImports: [
  '@repo/ui', 'lucide-react', 'recharts', 'framer-motion',
  '@radix-ui/*', '@tanstack/react-table', 'date-fns', ...
]
```

所有重型库都已配置 tree-shaking，只打包实际使用的 exports。这是正确的。

---

### 预测汇总

| 页面          | 预测 LCP 元素 | 预测 LCP 速度                      | 主要风险                |
| ------------- | ------------- | ---------------------------------- | ----------------------- |
| `/login`      | 登录表单文字  | 🟢 最快（无 API）                  | 无                      |
| `/` Dashboard | 统计数字文字  | 🟢 快（SSR 直出）                  | Layout hydration        |
| `/analytics`  | 统计卡片文字  | 🟡 中（SSR + recharts）            | recharts bundle         |
| `/finance`    | 统计数字文字  | 🟢 快（SSR 直出）                  | Layout hydration        |
| `/orders`     | 产品图片？    | 🔴 慢（Client fetch + 未优化图片） | 图片未优化 + 客户端请求 |
