# Admin Next SSR + 体验 + 性能优化计划（执行版）

> 适用范围：`apps/admin-next`  
> 目标：在保持后台强交互能力的前提下，系统化提升首屏速度、交互流畅度、可观测性  
> 关联文档：
>
> - 架构现状评审：`../architecture/ADMIN_NEXT_SSR_CSR_REVIEW_CN.md`
> - Lighthouse 验收与历史记录：`./PERFORMANCE_LIGHTHOUSE_CN.md`
> - 生产 Lighthouse 运行手册：`../../../apps/admin-next/scripts/lighthouse/PRODUCTION_RUNBOOK.md`
> - 发布/回滚（唯一权威）：`../../../RUNBOOK.md`

---

## 1. 先说结论

当前 Admin Next 已不是纯 CSR，而是 **RSC(服务端入口) + Hydration + Client 交互组件** 的混合架构。  
方向正确，但仍存在以下可优化空间：

- 部分页面仍以客户端请求为主，首屏存在骨架等待
- 缓存策略相对统一，未按业务实时性分层
- 重交互组件较多，需继续做 chunk 拆分与惰性加载

---

## 2. 目标指标（验收口径）

以下指标用于阶段验收，按「关键后台页面」统计（Dashboard / Orders / Products / Finance / Users）：

| 指标                           | 当前基线（待补） | 目标（Phase 1） | 目标（Phase 2） |
| ------------------------------ | ---------------- | --------------- | --------------- |
| LCP（登录后关键页）            | -                | < 1.8s          | < 1.2s          |
| TBT                            | -                | < 250ms         | < 200ms         |
| CLS                            | -                | < 0.10          | < 0.05          |
| 列表筛选到首屏可见更新（命中） | -                | < 700ms         | < 500ms         |
| SSR 首屏请求失败率             | -                | < 1%            | < 0.5%          |

> 基线采集：按 `PRODUCTION_RUNBOOK.md` 执行 Lighthouse + 关键事务性能追踪（Sentry/日志）。

---

## 3. 页面分层策略（SSR/CSR 决策）

### 3.1 渲染边界原则

- **默认 Server Component**：页面壳、首屏可见统计、首屏列表数据
- **Client Component**：表格交互、筛选器、弹窗、编辑器、图表等浏览器交互
- **避免“整页 use client”**：Client 边界尽量下沉到叶子节点

### 3.2 数据缓存分层

- **强实时业务**（如支付状态、风控临界数据）：`revalidate: 0~5s`
- **常规运营列表**（订单、商品、用户）：`revalidate: 15~30s`
- **低频配置/统计**（系统配置、汇总看板）：`revalidate: 60~300s`

---

## 4. 分阶段执行计划

### ✅ 已完成的优化（2026-03-29）

#### Phase 1: 高收益页面首屏改造 ✅

- [x] Dashboard: SSR 预取 + Streaming + HydrationBoundary
- [x] Orders: SSR 预取 + URL searchParams 驱动筛选
- [x] Products: SSR 预取 + URL searchParams 驱动筛选
- [x] Users: SSR 预取 + URL searchParams 驱动筛选
- [x] Finance: 双 Suspense 并行流式渲染 + SSR 预取

#### Phase 2: 缓存与失效机制精细化 ✅

- [x] 建立 Cache Tag 体系（ORDERS*LIST_TAG, PRODUCTS_LIST_TAG, USERS_LIST_TAG, FINANCE*\*\_TAG）
- [x] FinanceStatsServer 缓存优化：revalidate 30s → 60s（低频统计）
- [x] DashboardStats 缓存：finance 60s, users 300s

#### Phase 3: Bundle 与交互流畅度治理 ✅

- [x] recharts 已分离为独立 chunk (362K)，仅 analytics 页面加载
- [x] AnalyticsTrendSectionLazy 使用 dynamic() + IntersectionObserver 延迟加载
- [x] optimizePackageImports 已配置 recharts, lucide-react, framer-motion 等

#### Phase 4: 质量闸门与回归机制 ✅

- [x] Lighthouse CI 已集成 GitHub Actions（lighthouse-ci.yml）
- [x] 性能阈值已配置：LCP < 2.5s, TBT < 200ms, CLS < 0.1, Performance > 0.7
- [x] 自动化报告上传（Artifacts 保留 30 天）

---

## Phase 0（0.5 天）：基线固化

1. 固定 5~8 个关键页面作为长期观测样本
2. 跑一轮生产 Lighthouse（3 runs/page）并存档
3. 记录当前首屏请求链路（SSR fetch、API RTT、失败率）

**产出物**：基线表（LCP/FCP/TBT/CLS + API 时延）

## Phase 1（1~2 天）：高收益页面首屏改造

优先确保「路由入口 Server 预取 + HydrationBoundary」模式在高频页统一落地：

- Orders / Products / Users / Finance / Dashboard
- 对尚未预取或预取不完整页进行补齐

**验收**：关键页首屏骨架时长显著下降，首屏请求瀑布减少

## Phase 2（2~3 天）：缓存与失效机制精细化

1. 为不同业务域建立 cache policy（按上文分层）
2. 使用 tag 失效进行精准刷新，减少全局无效刷新
3. 对高频突发接口增加失败重试与降级策略

**验收**：缓存命中率提升，后端峰值压力降低，数据新鲜度符合业务预期

## Phase 3（2~3 天）：Bundle 与交互流畅度治理

1. 跑 `build:analyze`，锁定 top 3 重 chunk
2. 对图表、富文本、低频面板进行动态加载（next/dynamic）
3. 优化大表格与筛选交互链路，降低主线程阻塞

**验收**：TBT 下降，页面操作卡顿减少

## Phase 4（持续）：质量闸门与回归机制

1. 将 Lighthouse 关键阈值纳入 CI（至少关键页面）
2. 建立每周性能回归检查（可自动化）
3. 变更评审模板增加“SSR/缓存策略”检查项

**验收**：性能不再随功能迭代持续回退

---

## 5. 优先级清单（建议）

### P0（必须先做）

- 关键页首屏统一预取策略（Orders/Products/Users/Finance/Dashboard）
- 缓存分层落地（强实时 vs 常规列表 vs 低频统计）

### P1（本轮建议完成）

- 重 chunk 拆分（图表/富文本/低频模块）
- 首屏骨架与真实内容切换一致性优化

### P2（持续优化）

- 细颗粒埋点与回归自动化
- 复杂交互路径（批量操作、大筛选）体验提升

---

## 6. 与 RUNBOOK 的边界

为避免重复维护，职责明确如下：

- 本文档：
  - 性能/体验目标
  - SSR/CSR 边界与优化路线
  - 验收指标与阶段计划
- `RUNBOOK.md`：
  - 发布、回滚、生产运维操作（唯一权威）
- Lighthouse 操作细节：
  - `apps/admin-next/scripts/lighthouse/PRODUCTION_RUNBOOK.md`

> 结论：本文是「优化策略文档」，不是「部署操作手册」。

---

## 7. 待优化空间（2026-03-29 分析）

### 7.1 缺少 SSR 预取的页面（11个）

以下页面当前使用普通 `function` 而非 `async function`，未实现 SSR 预取：

| 页面                 | 优先级 | 状态      | 建议                                    |
| -------------------- | ------ | --------- | --------------------------------------- |
| **Customer-service** | P1     | ✅ 已完成 | 已实现 SSR 预取 + HydrationBoundary     |
| **Notifications**    | P1     | ✅ 已完成 | 已实现 SSR 预取 + HydrationBoundary     |
| **Marketing**        | P1     | ✅ 已完成 | 已实现 SSR 预取 + HydrationBoundary     |
| **Categories**       | P1     | ✅ 已完成 | 已实现 SSR 预取 + HydrationBoundary     |
| Roles                | P2     | 待优化    | 角色管理，可能是静态配置                |
| Ads                  | P2     | 待优化    | 广告管理                                |
| Lucky-draw           | P2     | 待优化    | 抽奖配置                                |
| Flash-sale           | P2     | 待优化    | 秒杀配置                                |
| Act-sections         | P2     | 待优化    | 活动板块                                |
| Settings             | P2     | 待优化    | 已有特殊处理（initialData）             |
| Analytics            | -      | 已完成    | 已使用 dynamic() + IntersectionObserver |

### 7.2 Bundle 优化空间

**当前状态：**

- 主 chunk (1930): 408K - Next.js 核心，无法优化
- recharts chunk (4204): 362K - 已分离，仅 analytics 页面加载 ✅
- 共享 chunk: 186K

**潜在优化：**

- 检查 `@tanstack/react-table` 是否可以进一步拆分
- 评估 `framer-motion` 使用场景，考虑 CSS animation 替代

### 7.3 缓存策略优化

**当前状态：**

- 低频统计：60-300s ✅
- 常规列表：30s ✅
- 强实时：待确认（支付状态等）

**建议：**

- 为支付相关接口设置 `revalidate: 0` 或极短缓存
- 考虑为 Dashboard 统计卡片增加 `revalidate: 120s`

### 7.4 其他优化机会

1. **字体优化**：检查是否使用 `next/font` 优化字体加载
2. **第三方脚本**：使用 `next/script` 的 `strategy="lazyOnload"`
3. **Edge Runtime**：简单页面考虑 Edge Runtime 提升冷启动
4. **Streaming SSR**：扩展到更多页面（Customer-service, Notifications）

### 7.5 代码质量与性能优化（2026-03-29 新增）

#### 7.5.1 前端组件优化

**问题发现：**

- `CustomerServiceDesk.tsx` 组件过大（400+ 行），职责过多
- 状态管理复杂，多个 `useState` 可以合并
- 缺少虚拟化，大量消息时性能差

**优化建议：**

```typescript
// 1. 组件拆分
- 提取 ChatWindow 组件
- 提取 ConversationList 组件
- 提取 SearchAndFilter 组件

// 2. 状态管理优化
const chatReducer = (state, action) => {
  switch (action.type) {
    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    // ...
  }
};

// 3. 虚拟化长列表
import { useVirtualizer } from '@tanstack/react-virtual';
```

#### 7.5.2 API 层优化

**问题发现：**

- HTTP 客户端缺少请求重试机制
- 缓存策略不完善
- 错误处理不够细粒度

**优化建议：**

```typescript
// 1. 添加请求重试
const retryConfig = {
  retry: 3,
  retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
};

// 2. 完善缓存策略
const cacheConfig = {
  staleTime: 5 * 60 * 1000, // 5分钟
  cacheTime: 10 * 60 * 1000, // 10分钟
};

// 3. 细粒度错误处理
class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: any,
  ) {
    super(message);
  }
}
```

#### 7.5.3 工具函数优化

**已完成优化：**

- ✅ `format-utils.ts` 已优化，添加缓存和常量
- ✅ 提取公共辅助函数，减少代码重复
- ✅ 添加缓存机制，提升性能

**优化成果：**

```typescript
// 优化前：代码重复，无缓存
function formatMsgTime(timestamp) {
  // 重复的时间解析逻辑
}

// 优化后：提取公共函数，添加缓存
const parseTimestamp = (timestamp) => {
  /* 统一解析 */
};
const getDaysDiff = (date) => {
  /* 统一计算 */
};
const timeFormatCache = new Map(); // 缓存机制
```

#### 7.5.4 安全加固

**发现问题：**

- 输入验证不够严格
- 敏感数据可能泄露
- 缺少数据脱敏

**优化建议：**

```typescript
// 1. 输入验证
import { z } from "zod";
const UserInputSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
  nickname: z.string().min(1).max(50),
});

// 2. 敏感数据脱敏
const maskSensitiveData = (data) => {
  if (data.phone) {
    data.phone = data.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
  }
  return data;
};
```

#### 7.5.5 监控与日志

**优化建议：**

```typescript
// 1. 性能监控
import { getCLS, getFID, getFCP, getLCP, getTTFB } from "web-vitals";

// 2. 错误监控
import * as Sentry from "@sentry/nextjs";

// 3. 业务监控
const businessMetrics = {
  userRegistration: "counter",
  orderCreation: "counter",
  paymentSuccess: "gauge",
};
```

---

## 8. 下一步行动

### 立即执行（P1）

1. 检查 Customer-service 页面，评估是否需要 SSR 预取
2. 检查 Notifications 页面，评估是否需要 SSR 预取
3. 运行生产 Lighthouse 审计，获取基线数据

### 短期优化（P2）

1. 为 Marketing/Categories 页面添加 SSR 预取
2. 评估强实时接口缓存策略
3. 检查字体和第三方脚本优化

### 持续监控

1. 每周查看 Lighthouse CI 报告
2. 监控 Sentry 性能追踪
3. 定期 review 缓存命中率
