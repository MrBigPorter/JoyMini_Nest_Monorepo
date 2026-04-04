# /analytics LCP 优化记录 + 心智模型问答

> 基准测试：Lighthouse CI — main @ 3b94535  
> 问题页面：`/analytics` LCP 3459ms（Score 78）  
> 目标：LCP < 2000ms

---

## 一、问题诊断

### Lighthouse 基准数据

| Page       | LCP (ms) | TBT (ms) | CLS   | Score |
| ---------- | -------- | -------- | ----- | ----- |
| /          | 1234     | 93       | 0     | 96    |
| /analytics | **3459** | 31       | 0     | 78    |
| /finance   | 796      | 59       | 0     | 99    |
| /login     | 581      | 206      | 0.007 | 92    |
| /orders    | 1305     | 37       | 0     | 96    |

### 根因分析

`/analytics` 的特征：**LCP 高，TBT 极低**。

```
LCP 高 + TBT 低
  └─ 不是 JS 阻塞（TBT 31ms 几乎为零）
  └─ 是 HTML 到得慢
       ├─ 后端 API 计算复杂 → SSR 阶段等 HTML 返回
       ├─ 缓存未命中 → 每次请求都走后端
       └─ 图表骨架块大 → 被 Lighthouse 误选为 LCP 候选
```

`/analytics` 页面的 `AnalyticsOverview` 是 async Server Component，会在 SSR 阶段调用 `/v1/admin/stats/overview`，该接口聚合了用户/订单/收入多维度数据，后端计算成本高。每次没有缓存时，浏览器必须等到 SSR 完成才能收到 HTML。

---

## 二、优化方案

### 改动 1：`AnalyticsOverview.tsx` — 提高 ISR 缓存周期

**文件：** `apps/admin-next/src/components/analytics/AnalyticsOverview.tsx`

**改前：**

```ts
const data = await serverGet<StatsOverview>("/v1/admin/stats/overview").catch(
  () => null,
);
```

**改后：**

```ts
const data = await serverGet<StatsOverview>(
  "/v1/admin/stats/overview",
  undefined,
  { revalidate: 120 },
).catch(() => null);
```

**为什么有效：**  
`revalidate: 120` 让 Next.js 对这条 SSR fetch 结果缓存 120 秒。  
缓存命中时，SSR 阶段直接拿缓存值，无需等后端响应，HTML 立即返回。  
**本质：把"每次请求都付的 API 等待成本"转移到"每 2 分钟付一次"。**

**Trade-off：** 统计数字最多延迟 120 秒，对 admin 后台可接受（非实时交易场景）。

---

### 改动 2：`AnalyticsTrendSectionLazy.tsx` — 进入视口才挂载图表

**文件：** `apps/admin-next/src/components/analytics/AnalyticsTrendSectionLazy.tsx`

**改前（问题）：**  
`dynamic(..., { ssr: false })` 虽然不在服务端渲染，但页面渲染后客户端立即开始下载 recharts bundle，与首屏关键内容争抢 LCP 时间窗口。

**改后（核心逻辑）：**

```ts
export function AnalyticsTrendSectionLazy() {
  const [shouldMount, setShouldMount] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px 0px' }, // 提前 200px 预加载
    );
    observer.observe(anchorRef.current!);
    return () => observer.disconnect();
  }, [shouldMount]);

  return (
    <div ref={anchorRef}>
      {shouldMount ? <AnalyticsTrendSection /> : <占位骨架 />}
    </div>
  );
}
```

**为什么有效：**  
首屏渲染完成前，图表区只是一个轻量骨架块（无 JS 下载）。  
浏览器完成 LCP 后，用户滚动或接近图表区时，才触发 recharts bundle 下载和图表渲染。  
**本质：让首屏 LCP 候选元素缩小到"统计卡片区"，排除大骨架块的干扰。**

---

## 三、心智模型问答记录

### Q1：为什么这次优先改 LCP，不先压 TBT？

**回答（✅ 正确）：**  
LCP 高是因为后端计算复杂，浏览器一直在等 HTML 返回。TBT 已经很低（31ms），说明不是 JS 主线程阻塞的问题。TBT 低表示"JS 没堵"，LCP 高表示"内容来得慢"，两个是不同方向的问题，当前瓶颈在前者。

**补充：**

```
LCP 高 → 内容到达慢 → 看 SSR/API 链路
TBT 高 → JS 阻塞主线程 → 看 bundle size / 长任务
两者互相独立，先消灭更大的那个
```

---

### Q2：`revalidate: 120` 本质上把哪段成本转移了？

**回答（✅ 正确）：**  
把"每次请求都等后端 API"的成本，改成"每 120 秒等一次"。缓存命中时 SSR 直接拿缓存结果，HTML 立即返回，LCP 不再受后端 API 响应时间波动影响。

**图示：**

```
改前：每个用户访问 → SSR 等 API（可能 1~3s）→ HTML 返回 → LCP
改后：首次/过期 → 等 API → 缓存（2min）
      缓存命中 → 0ms 等待 → HTML 立即返回 → LCP 大幅降低
```

---

### Q3：`dynamic(ssr:false)` 有了，为什么还要 IntersectionObserver？

**回答（✅ 正确）：**  
`dynamic(ssr:false)` 只保证"不在服务端渲染"，但页面在浏览器渲染后立即开始下载图表 bundle，这个 bundle 下载会在首屏 LCP 计算窗口内进行，占用网络带宽，还可能让大骨架块成为 LCP 候选。  
IntersectionObserver 进一步推迟到"接近视口才触发 bundle 下载"，让首屏 LCP 完全不受图表影响。

**层级对比：**

```
ssr: false         → 不在服务端渲染（已做）
IntersectionObserver → 不在首屏浏览器渲染时下载（这次新增）
两者叠加 = 图表对 LCP 零干扰
```

---

### Q4：LCP 仍高但 TBT 很低，看哪条 Sentry span？

**答案（完整版）：**

**路径：**

```
Sentry → Performance → Transactions
  → 过滤 transaction = GET /analytics
  → 打开一条 transaction waterfall
  → 找这条 span：
```

**关键 span：**

```
admin.ssr.fetch.server_request
  └─ http.url = /v1/admin/stats/overview
```

这是 `serverFetch.ts` 里注册的 Sentry span，记录 SSR 阶段 Cloudflare Worker → 后端 API 的整段耗时。

**判断逻辑：**

| span 耗时   | 结论     | 下一步                             |
| ----------- | -------- | ---------------------------------- |
| > 2000ms    | 后端慢   | 查 API 查询是否有 DB 索引缺失、N+1 |
| < 300ms     | API 快   | 看 CDN 冷启动 / Worker 启动时间    |
| span 不存在 | 缓存命中 | revalidate 已生效，问题在别处      |

**完整等待链：**

```
浏览器发请求
    │
    ▼
Cloudflare Worker SSR 开始
    │
    ├─ admin.ssr.fetch.server_request  ← 这里如果长就是后端慢
    │     └─ GET /v1/admin/stats/overview
    │
    ▼
HTML 返回浏览器 → 绘制首屏 → LCP 完成
```

---

### Q5：这个方案的 Trade-off 是什么？

**数据新鲜度 vs 首屏速度：**

|          | revalidate: 30 | revalidate: 120 | revalidate: 600 |
| -------- | -------------- | --------------- | --------------- |
| 首屏速度 | 中             | 快              | 最快            |
| 数据延迟 | 最多 30s       | 最多 120s       | 最多 10min      |
| 适合场景 | 实时报表       | admin 概览      | 历史归档        |

当前选 120s 的原因：admin 后台的统计概览不是实时交易数据，延迟 2 分钟可接受，收益明显。

---

## 四、验收方式

### 代码验证

```bash
yarn workspace @lucky/admin-next exec eslint src/components/analytics/AnalyticsOverview.tsx src/components/analytics/AnalyticsTrendSectionLazy.tsx
yarn workspace @lucky/admin-next check-types
```

### Sentry 验证（改后发布）

1. 打开 `Sentry → Performance → Transactions`
2. 过滤 `transaction: GET /analytics`，`environment: production`
3. 找 `admin.ssr.fetch.server_request` span
4. 对比 p95 改前/改后数值

### Lighthouse 复测目标

| 指标  | 改前   | 目标     |
| ----- | ------ | -------- |
| LCP   | 3459ms | < 2000ms |
| TBT   | 31ms   | 不回退   |
| CLS   | 0      | 保持 0   |
| Score | 78     | > 90     |
