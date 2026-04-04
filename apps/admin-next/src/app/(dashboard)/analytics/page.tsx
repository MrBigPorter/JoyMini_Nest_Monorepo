/**
 * ============================================================
 * Analytics Page — 数据分析页
 * ============================================================
 *
 * 【这个文件是什么？】
 *   Next.js App Router 的"路由入口文件"。
 *   文件本身是 Server Component（服务端组件），
 *   意味着它在服务器上执行，HTML 直接返回给浏览器，
 *   浏览器不需要等待 JS 下载完再渲染内容。
 *
 * 【页面由两层组成】
 *   ┌─────────────────────────────────────────────┐
 *   │  Server Component (这个文件)                 │
 *   │  ├─ AnalyticsOverview  ← 也是 Server Component │
 *   │  │    在服务器直接查数据库，首屏就有数字       │
 *   │  └─ AnalyticsTrendSection ← Client Component  │
 *   │       recharts 图表，浏览器加载后才渲染        │
 *   └─────────────────────────────────────────────┘
 *
 * 【性能优化时间线】
 *   Stage 2（2026-03-16）：AnalyticsOverview 改为 SSR，消灭加载闪烁
 *   Stage 5（2026-03-17）：加 Suspense 骨架屏，流式推送（Streaming）
 *   2026-03-22：recharts 改为 dynamic() 延迟加载，降低 TBT
 */
import type { Metadata } from 'next';

/**
 * 【metadata 是什么？】
 *   Next.js 内置的 SEO 方案。
 *   这里设置的 title 会变成浏览器标签页标题，
 *   也会被 Google 抓取为搜索结果标题。
 *   写在 Server Component 里才生效，Client Component 里写无效。
 */
export const metadata: Metadata = { title: 'Analytics' };

import React, { Suspense } from 'react';
import { AnalyticsOverview } from '@/components/analytics/AnalyticsOverview';
import { AnalyticsOverviewSkeleton } from '@/components/analytics/AnalyticsOverviewSkeleton';
import { AnalyticsTrendSectionLazy } from '@/components/analytics/AnalyticsTrendSectionLazy';
import { PageHeader } from '@/components/scaffold/PageHeader';

/**
 * 【为什么不在这个 Server Component 里直接写 dynamic({ ssr: false })？】
 *   Next.js App Router 里，`page.tsx` 默认是 Server Component，
 *   在这里使用 `ssr: false` 会触发构建错误。
 *
 *   正确做法：把 dynamic() 下沉到 Client Component 文件中。
 */

/**
 * 【页面主体结构说明】
 *
 *   Suspense + AnalyticsOverview（流式 SSR）：
 *     服务器开始处理页面时，先把 HTML 框架发给浏览器，
 *     AnalyticsOverview 里的数据库查询在后台异步跑。
 *     查完了，服务器把这块 HTML "流式追加"到已发出的响应里。
 *     浏览器无需等全部数据就绪，就能看到页面框架。
 *     等待期间显示 AnalyticsOverviewSkeleton（灰色骨架屏）。
 *
 *   AnalyticsTrendSection（纯客户端）：
 *     服务端返回一个空占位（loading 里的 div），
 *     浏览器加载完成后异步下载 recharts chunk，
 *     下载完才渲染图表。
 */
export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      {/* 页头：纯静态展示，无数据依赖，立即渲染 */}
      <PageHeader
        title="Data Analytics"
        description="Real-time overview of users, orders, revenue and trends."
      />

      {/*
       * 统计卡片区 — Suspense 流式 SSR
       *
       * fallback={<AnalyticsOverviewSkeleton />}
       *   → 服务器数据还没准备好时，先发这个骨架屏给浏览器
       *
       * <AnalyticsOverview />
       *   → async Server Component，内部直接 fetch/db 查询
       *   → 查完后，Next.js 把真实内容"流式"替换骨架屏
       */}
      <Suspense fallback={<AnalyticsOverviewSkeleton />}>
        <AnalyticsOverview />
      </Suspense>

      {/**
       * 趋势图表区 — Client 包装组件内部 dynamic() 延迟加载
       *
       * Server 页面只渲染客户端边界，
       * 真正的 recharts 组件在浏览器侧按需下载。
       */}
      <AnalyticsTrendSectionLazy />
    </div>
  );
}
