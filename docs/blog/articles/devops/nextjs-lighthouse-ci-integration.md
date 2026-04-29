---
tags:
  - Lighthouse
  - Performance
  - CI/CD
  - DevOps
  - Next.js
---

# Lighthouse CI 集成：自动化性能门禁实战

## 1. 背景：为什么需要性能门禁？

### 1.1 问题

我们完成了 Stage 2（async RSC）和 Stage 4（Finance SSR）的重构，团队自认为做了很多优化，但有一个根本问题没有答案：

> 这些优化到底有没有效果？首屏加载是真的快了，还是只是"感觉快了"？

没有数据支撑的优化只是自我安慰。

### 1.2 Lighthouse 验收回答的三个问题

```
1. SSR 优化是否真的减少了首屏时间？
   → Dashboard（SSR）vs Orders（纯 Client）的 LCP 对比

2. Suspense 骨架屏是否消灭了 CLS 布局偏移？
   → 所有页面的 CLS 是否 < 0.1

3. 还有没有未被发现的性能瓶颈？
   → 代码审查无法预测的运行时问题
```

---

## 2. Core Web Vitals：我们必须知道的指标

### 2.1 四个核心指标

| 指标 | 全称 | 含义 | 内网目标 | Google 标准 |
|-----|------|------|---------|------------|
| **LCP** | Largest Contentful Paint | 最大内容绘制时间（用户感觉页面加载完的时刻） | **< 500ms** | < 2.5s |
| **FCP** | First Contentful Paint | 首次有内容显示（白屏结束） | **< 200ms** | < 1.8s |
| **TBT** | Total Blocking Time | JS 阻塞主线程的总时间（影响可交互） | **< 200ms** | < 200ms |
| **CLS** | Cumulative Layout Shift | 布局偏移分数（元素是否乱跳） | **< 0.1** | < 0.1 |

### 2.2 为什么设两套标准？

内网目标更严格，因为 API 服务器和前端在同一个 VPS 上（San Jose），内网直连延迟约 5ms。

如果内网达标但外网不达标，说明瓶颈在网络传输而非代码，需要 CDN / Edge 优化。

```
内网 LCP < 500ms  →  代码层优化到位
外网 LCP < 2.5s   →  Google Core Web Vitals 合规
两者差距大        →  需要 CDN 边缘缓存
```

---

## 3. 测试方法（必须严格遵守，否则数据无效）

### 3.1 环境准备

```
1. Chrome 无痕模式（Ctrl+Shift+N）
   原因：普通窗口有插件（广告拦截/翻译等），干扰网络请求和 JS 执行

2. 关闭其他占用网络的程序（视频/下载等）

3. 确保已登录（Lighthouse 测的是登录后的页面）

4. 每个页面跑 3 次，取中间值（第 1 次可能有冷启动偏差）
```

### 3.2 Lighthouse 配置

```
DevTools（F12）→ Lighthouse 标签

只勾选：Performance
取消：Accessibility / Best practices / SEO / PWA

Device：Desktop（后台系统，不测移动端）
Throttling：No throttling（内网测试，不模拟慢网）
```

### 3.3 测试页面顺序

```
1. /login          ← 无需登录，冷启动基准
2. /              ← Dashboard（SSR 页，应该最快）
3. /analytics     ← Analytics（SSR 页，对比 Dashboard）
4. /finance       ← Finance（SSR 统计 + Client 列表）
5. /orders        ← Orders（纯 Client，对照基准）
```

### 3.4 自动化脚本（推荐）

无需手工操作，直接用仓库脚本批量测试：

```bash
# 运行基准测试（5 个页面，各跑 3 次，取中位数）
yarn perf:lighthouse

# 严格模式（任一页面超阈值时返回非 0 退出码，适合 CI 集成）
yarn perf:lighthouse:strict
```

环境变量配置：

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

# 认证方式 C：自定义登录 payload
LIGHTHOUSE_LOGIN_PAYLOAD_JSON='{"account":"admin","password":"***"}'
```

输出目录：

```text
apps/admin-next/reports/lighthouse/<timestamp>/
  ├── summary.md       # 可直接填入结果表
  ├── summary.json     # 机器可读格式
  └── *.html           # 每个页面的完整 Lighthouse 报告
```

---

## 4. 基准测试结果

### 4.1 测试 A：2026-03-22（生产环境，3 次中位数）

| 页面 | LCP (ms) | FCP (ms) | TBT (ms) | CLS | 评级 |
|-----|---------|---------|---------|-----|------|
| `/login` | 1246 | 1246 | 0 | 0.000 | 🟡 待优化 |
| `/` Dashboard | **963** | **963** | 20 | 0.000 | 🟡 待优化 |
| `/analytics` | 1645 | 1645 | 2 | 0.000 | 🔴 偏慢 |
| `/finance` | 1506 | 1506 | 0 | 0.000 | 🔴 偏慢 |
| `/orders` | 1543 | 1543 | 0 | 0.000 | 🔴 偏慢 |

### 4.2 关键发现

```
✅ 所有页面通过 Google Core Web Vitals（LCP < 2.5s）
✅ 所有页面 TBT < 200ms，JS 不阻塞主线程
✅ 所有页面 CLS = 0，骨架屏彻底消灭布局偏移
✅ SSR 有效：Dashboard LCP 963ms vs Orders 1543ms，差距 580ms

❌ 未达到内网 LCP < 500ms 目标（VPS 外网访问，属于预期）
❌ Analytics / Finance / Orders FCP 超 1.8s 外网标准
```

### 4.3 Dashboard vs Orders：SSR 效果的直接证明

```
Dashboard（SSR）:  LCP = 963ms
Orders（Client）:   LCP = 1543ms
─────────────────────────────
SSR 收益:          580ms（37.6% 提升）
```

这是 Stage 2 async RSC 重构效果的量化证明。Dashboard 的统计数字直接由 Server Component 在 HTML 中输出，用户看到页面时就看到了数字。而 Orders 需要等待 JS 加载 → 执行 → 发起 API 请求 → 数据返回 → 渲染，多了一个网络往返。

---

## 5. 优化决策树

```text
跑完 Lighthouse
       │
       ├─ LCP < 500ms（所有页面达标）
       │    └─ ✅ 验收通过 → 转功能方向
       │
       ├─ Dashboard LCP < 500ms，但 Orders LCP > 1500ms
       │    └─ 🟡 SSR 有效，列表页慢是正常的
       │         可接受；如果要优化：HydrationBoundary 预取第一页数据
       │
       ├─ Dashboard LCP > 1000ms（SSR 没生效）
       │    └─ 🔴 排查 serverGet() 内网延迟
       │         curl -w "%{time_total}" https://api.joyminis.com/v1/admin/finance/statistics
       │
       ├─ Dashboard LCP ≈ Orders LCP（差距 < 100ms）
       │    └─ 🔴 SSR 没有产生预期效果
       │         可能原因 1：serverGet() 请求很慢
       │         可能原因 2：LCP 元素不是统计卡片
       │         可能原因 3：JS bundle 太大，hydration 阻塞感知
       │
       └─ TBT > 500ms（所有页面）
            └─ 🔴 JS bundle 问题
                 yarn workspace @lucky/admin-next build
                 → 查看 .next/analyze/ 包体积报告
```

### 常见场景处理

**场景 1：CLS > 0.1**

骨架屏没有完全消灭布局偏移。查看 Lighthouse 报告中标记的偏移元素，给该元素添加固定高度或 `min-height`。

**场景 2：TBT > 500ms**

JS bundle 太重，主线程阻塞严重。检查是否有大型第三方库没有做 code splitting，考虑 `dynamic()` 懒加载非首屏组件。

**场景 3：特定页面特别慢**

对比该页面和 Dashboard 的代码差异，检查是否有同步执行的耗时操作。

---

## 6. 代码侧预扫描（跑 Lighthouse 前的预测）

在正式跑 Lighthouse 之前，通过代码审查可以发现大部分性能问题。以下是实际项目中发现的三个典型问题：

### 🔴 高风险：图片未优化

```typescript
// next.config.ts — 问题代码
images: {
  unoptimized: true,  // ← 所有图片跳过 Next.js 优化
}
```

**影响**：任何页面如果 LCP 元素是图片（产品图、Banner、用户头像），会缺少：
- WebP 转换（文件体积大 2~3 倍）
- `loading="lazy"` 优先级提示
- 响应式 `srcset`

**修复**：

```typescript
// next.config.ts — 修复后
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: 'cdn.joyminis.com',
    },
  ],
}
```

### 🟡 中风险：recharts 没有懒加载

```tsx
// analytics/page.tsx — 问题代码
import { AnalyticsTrendSection } from "@/components/analytics/AnalyticsTrendSection";
// AnalyticsTrendSection 内部 import recharts (~90KB gzipped)
```

**影响**：recharts 进入 `/analytics` 的首屏 bundle，即使图表在页面底部。

**修复**：

```tsx
// 改为懒加载
const AnalyticsTrendSection = dynamic(
  () => import("@/components/analytics/AnalyticsTrendSection"),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
```

### 🟡 中风险：Layout Shell 是 Client Component

```tsx
"use client"; // ← Sidebar + Header + MainContent 全部需要 JS hydration
```

**影响**：用户看到页面结构之前，必须等待 JS hydration 完成。

**修复成本**：高（需要拆分 Sidebar 为 Server Component）。收益不大，暂不建议动。

### ✅ 已正确配置的优化

```typescript
// next.config.ts
optimizePackageImports: [
  '@repo/ui', 'lucide-react', 'recharts', 'framer-motion',
  '@radix-ui/*', '@tanstack/react-table', 'date-fns', ...
]
```

所有重型库都已配置 tree-shaking，只打包实际使用的 exports。

### 预测 vs 实际结果

| 页面 | 预测 LCP 元素 | 预测速度 | 实际 LCP | 一致性 |
|-----|-------------|---------|---------|-------|
| `/login` | 登录表单文字 | 🟢 最快 | 1246ms | ✅ |
| `/` Dashboard | 统计数字文字 | 🟢 快 | 963ms | ✅ |
| `/analytics` | 统计卡片文字 | 🟡 中 | 1645ms | ✅ recharts 确认 |
| `/finance` | 统计数字文字 | 🟢 快 | 1506ms | ⚠️ 低于预期 |
| `/orders` | 产品图片 | 🔴 慢 | 1543ms | ✅ |

代码审查的预测和实际 Lighthouse 结果高度一致，说明大部分性能问题可以通过静态分析发现。

---

## 7. CI 集成：让性能成为门禁

### 7.1 严格模式

```bash
# 在 CI 中加入性能门禁步骤
yarn perf:lighthouse:strict
```

当任一页面的指标超过阈值时，该命令返回非 0 退出码，CI pipeline 失败。这样就实现了：

> 每次 PR 合并前自动验证性能，不会让性能退化悄悄进入生产环境。

### 7.2 阈值设置建议

```
内网环境（CI Runner 与 API 同 VPS）:
  LCP < 1500ms（宽松，避免 CI 波动误报）
  TBT < 300ms
  CLS < 0.1

生产环境（手动触发）:
  LCP < 500ms（内网目标）
  TBT < 200ms
  CLS < 0.05
```

### 7.3 环境变量配置

```yaml
# .gitlab-ci.yml 集成示例
lighthouse:
  stage: quality
  script:
    - yarn perf:lighthouse:strict
  variables:
    LIGHTHOUSE_BASE_URL: "https://admin-dev.joyminis.com"
    LIGHTHOUSE_ADMIN_USERNAME: $LIGHTHOUSE_ADMIN_USERNAME
    LIGHTHOUSE_ADMIN_PASSWORD: $LIGHTHOUSE_ADMIN_PASSWORD
    LIGHTHOUSE_RUNS_PER_PAGE: "1"     # CI 中只跑 1 次以节省时间
  artifacts:
    paths:
      - apps/admin-next/reports/lighthouse/
```

---

## 8. 后续追踪

### 8.1 每次重大优化后追加记录

```
┌─────────────────────────────────────────────────────────────┐
│ 测试记录 #N — YYYY-MM-DD                                    │
│ 优化内容：xxx                                                │
│                                                             │
│ Dashboard  Analytics  Finance  Orders  TBT 均值  CLS 均值   │
│ 963 ms    1645 ms   1506 ms  1543 ms  < 5ms   0.000        │
│                                                             │
│ 结论：xxx                                                    │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 当前基准状态

| Dashboard LCP | Analytics LCP | Finance LCP | Orders LCP | TBT 均值 | CLS 均值 |
|-------------|-------------|------------|-----------|---------|---------|
| 963 ms | 1645 ms | 1506 ms | 1543 ms | < 5ms | 0.000 |

**已实施优化**：

1. `next.config.ts`：移除 `unoptimized: true` → `remotePatterns` 白名单
2. `analytics/page.tsx`：`AnalyticsTrendSection` 改为 `dynamic()` 延迟加载

**下一步方向**：剩余瓶颈主要是外网传输延迟（VPS 距离用户远），代码层面已无重大阻塞点。团队转向功能方向。

---

## 9. 总结

Lighthouse CI 集成带来了三个核心价值：

1. **量化优化效果**：Dashboard 比 Orders 快 580ms（37.6%），SSR 优化的收益不再是"感觉快了"
2. **防止性能退化**：CI 门禁确保每次合并都符合性能标准，不会让劣质代码悄悄混入
3. **指导优化方向**：决策树告诉团队应该优化什么、不应该优化什么，避免无效投入

### 检查清单

```
[ ] Chrome 无痕模式测试
[ ] 每个页面跑 3 次取中位数
[ ] 记录结果到总结表
[ ] 对比 Dashboard vs Orders（判断 SSR 有效性）
[ ] 检查 CLS 是否 < 0.1
[ ] 检查 TBT 是否 < 200ms
[ ] 检查图片优化配置
[ ] 检查重型组件懒加载
[ ] CI 中集成 strict 模式
[ ] 每次优化后更新追踪记录
```
