---
title: AI 翻译任务监控面板：1309 行完整工程实现
description: 构建一个企业级的 AI 翻译监控中心——从 BullMQ 队列实时监控、多维度进度追踪、到任务历史管理和错误告警
date: 2026-04-30
category: frontend
tags: [AI, Translation, BullMQ, Monitoring, React, TypeScript, Queue]
---

# AI 翻译任务监控面板：1309 行完整工程实现

## 概述

[`BlogTranslationProgress`](apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx) 是 admin-blog 中最大（1309 行）、功能最完整的页面之一。它是一个 AI 翻译任务的实时监控中心，集成了 BullMQ 队列监控、翻译进度追踪、任务历史管理和错误告警。

### 功能矩阵

| 模块 | 行数 | 功能 |
|------|------|------|
| 全局概览 | ~100 | 总体进度条、统计卡片、队列状态 |
| 未翻译文章 | ~200 | 文章列表 + 进度 + 单篇/批量翻译 |
| 未翻译分类 | ~100 | 分类列表 + 翻译触发 |
| 未翻译标签 | ~100 | 标签列表 + 翻译触发 |
| 数据库任务 | ~200 | 任务历史表（分页、筛选） |
| 实时队列 | ~200 | BullMQ active/waiting/failed |
| 错误告警 | ~100 | 失败项告警、重复翻译保护 |
| 状态组件 | ~200 | Alert/Skeleton/Checkbox/ProgressBar/StatCard |

## 一、数据模型

### API 响应结构

```typescript
// 总体进度
interface TranslationProgress {
  totalItems: number
  completedItems: number
  failedItems: number
  inProgressItems: number
  percentComplete: number
  estimatedTimeRemaining: string
}

// BullMQ 队列状态
interface QueueStatus {
  name: string
  active: number      // 正在执行
  waiting: number     // 等待中
  completed: number   // 已完成
  failed: number      // 失败
  delayed: number     // 延迟
  priority: number    // 优先级
}

// 任务记录（来自数据库）
interface TranslationJob {
  id: string
  type: string            // 'ARTICLE' | 'CATEGORY' | 'TAG'
  status: string          // 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  sourceLang: string
  targetLang: string
  progress: number        // 0-100
  createdAt: string
  updatedAt: string
  error?: string
}

// 未翻译文章
interface UntranslatedArticle {
  id: string
  title: Record<string, string>  // 多语言标题
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  progress: number
}
```

## 二、全局概览区域

### 统计卡片

```typescript
const StatCard = ({
  title, value, icon, bg, textColor
}: {
  title: string
  value: string | number
  icon: React.ReactNode
  bg: string
  textColor?: string
}) => (
  <Card className={`p-4 ${bg}`}>
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
        {title}
      </span>
      <Badge>{icon}</Badge>
    </div>
    <p className={`text-2xl font-bold ${textColor || 'text-gray-900 dark:text-white'}`}>
      {value}
    </p>
  </Card>
)
```

四个统计卡片展示核心指标：
- 总待翻译数
- 翻译进行中
- 已完成数
- 失败数

### 总体进度条

```typescript
const ProgressBar = ({ value, className }: { value: number; className?: string }) => (
  <div className={`w-full bg-gray-200 dark:bg-white/10 rounded-full h-2 ${className}`}>
    <div
      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
)
```

- 渐变色进度条
- `transition-all duration-500` 平滑动画
- `Math.min/max` 确保百分比在 0-100 范围

### 队列状态卡片

显示三个 BullMQ 队列的实时状态：

```typescript
const QueueStatus = ({ stats }: { stats: QueueMonitoringResponse }) => (
  <Card title="队列状态" className="col-span-2">
    {stats.queues.map((queue) => (
      <div key={queue.name} className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={getQueueVariant(queue)}>{queue.name}</Badge>
          <span>Active: {queue.active}</span>
          <span>Waiting: {queue.waiting}</span>
          <span>Failed: {queue.failed}</span>
        </div>
      </div>
    ))}
  </Card>
)
```

## 三、未翻译内容管理

### 未翻译文章列表

```typescript
{untranslatedArticles.map((article: any) => (
  <div key={article.id} className="...">
    <div className="flex items-center gap-2 mt-1">
      <Badge variant={getStatusVariant(article.status)}>
        {statusLabels[article.status]}
      </Badge>
    </div>
    {article.status === 'PROCESSING' && (
      <ProgressBar value={article.progress} />
    )}
    <Button onClick={() => translateSingle(article.id)}>
      {article.status === 'PENDING' ? '翻译' : '重试'}
    </Button>
  </div>
))}
```

每篇未翻译文章显示：
- 标题（多语言渲染）
- 状态 Badge（PENDING/PROCESSING/COMPLETED/FAILED）
- 进度条（仅 PROCESSING 时）
- 操作按钮（PENDING → 翻译，FAILED → 重试）

### 时间信息

```typescript
const TimeInfo = () => {
  return (
    <Card title="时间信息" className="col-span-2">
      {stats.estimatedTimeRemaining && (
        <div>预计剩余时间: {stats.estimatedTimeRemaining}</div>
      )}
      <div>最后更新: {format(new Date(), 'HH:mm:ss')}</div>
    </Card>
  )
}
```

使用 `date-fns` 格式化和国际化（支持 `zhCN`/`enUS` locale）。

## 四、任务历史管理

### 表格实现

```typescript
<thead className="bg-gray-50">
  <tr>
    <th className="px-4 py-3 text-sm font-medium text-gray-700">任务类型</th>
    <th className="px-4 py-3 text-sm font-medium text-gray-700">状态</th>
    <th className="px-4 py-3 text-sm font-medium text-gray-700">源语言</th>
    <th className="px-4 py-3 text-sm font-medium text-gray-700">目标语言</th>
    <th className="px-4 py-3 text-sm font-medium text-gray-700">进度</th>
    <th className="px-4 py-3 text-sm font-medium text-gray-700">创建时间</th>
  </tr>
</thead>
```

### 筛选功能

```typescript
const [statusFilter, setStatusFilter] = useState<string>('all')
const [page, setPage] = useState(1)
const pageSize = 20

const filteredJobs = dbJobs.items
  .filter((job) => statusFilter === 'all' || job.status === statusFilter)
```

支持按状态筛选和分页浏览。

## 五、实时队列监控

### BullMQ 数据获取

```typescript
const { data: jobs, loading: jobsLoading, refresh } = useRequest(
  () => blogApi.translation.getQueueJobs(),
  {
    refreshDeps: [],
    pollingInterval: 5000, // 5 秒轮询
  },
)
```

- **5 秒自动轮询**：实时追踪队列变化
- **手动刷新**：提供刷新按钮

### 实时队列渲染

```typescript
// Active Jobs
{jobs.active.map((job: any) => (
  <div key={job.id} className="...">
    <Badge variant="processing">{job.name}</Badge>
    <span className="text-sm">{formatDistanceToNow(new Date(job.timestamp))}</span>
  </div>
))}

// Waiting Jobs
{jobs.waiting.slice(0, 5).map((job: any) => (
  // 只显示前 5 个等待任务
))}

// Failed Jobs
{jobs.failed.slice(0, 3).map((job: any) => (
  // 只显示前 3 个失败任务
))}
```

限制显示数量避免 UI 溢出。

## 六、错误告警与防护

### 告警系统

```typescript
const Alert = ({
  variant = 'default',
  title,
  description,
  action,
}: {
  variant?: 'default' | 'error' | 'warning' | 'success'
  title: string
  description: string
  action?: React.ReactNode
}) => {
  const variantClasses = {
    default: 'bg-gray-50 border-gray-200 text-gray-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  }

  return (
    <div className={`border rounded-lg p-4 ${variantClasses[variant]}`}>
      <div className="flex items-start">
        <div className="flex-1">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm mt-1">{description}</p>
        </div>
        {action && <div className="ml-4">{action}</div>}
      </div>
    </div>
  )
}
```

### 告警条件

```typescript
// 错误告警：有失败的翻译项
{progressData.failedItems > 0 && (
  <Alert
    variant="error"
    title="翻译任务存在失败项"
    description={`${progressData.failedItems} 个任务执行失败，请检查原因并重试`}
    action={<Button onClick={retryFailed}>重试全部</Button>}
  />
)}

// 进度提示：翻译未完成
{progressData.completedItems < progressData.totalItems && (
  <Alert
    variant="warning"
    title="翻译进行中"
    description={`已完成 ${progressData.completedItems}/${progressData.totalItems}`}
  />
)}

// 完成提示：全部完成
{progressData.totalItems > 0 &&
 progressData.completedItems === progressData.totalItems && (
  <Alert
    variant="success"
    title="全部翻译完成"
    description="所有内容已翻译完成"
  />
)}
```

## 七、数据获取策略

### 多重数据源

```typescript
// 1. 进度数据（一次性）
const { data: progressData, loading: progressLoading } = useRequest(
  () => blogApi.translation.getProgress(),
)

// 2. 未翻译文章
const { data: untranslatedArticles, loading: untranslatedLoading } = useRequest(
  () => blogApi.translation.getUntranslated(),
)

// 3. 数据库任务记录（分页）
const { data: dbJobs, loading: dbJobsLoading } = useRequest(
  () => blogApi.translation.getJobs({ page, pageSize, status: statusFilter }),
  { refreshDeps: [page, statusFilter] },
)

// 4. BullMQ 实时队列（5s 轮询）
const { data: jobs, loading: jobsLoading, refresh } = useRequest(
  () => blogApi.translation.getQueueJobs(),
  { pollingInterval: 5000 },
)
```

| 数据源 | 刷新策略 | 用途 |
|--------|---------|------|
| 进度数据 | 页面加载 + 手动刷新 | 概览卡片 |
| 未翻译列表 | 页面加载 + 翻译后刷新 | 内容管理 |
| 任务历史 | 分页/筛选切换 | 历史查询 |
| 实时队列 | 5 秒自动轮询 | 实时监控 |

## 八、UI 布局

```
┌──────────────────────────────────────────────────────┐
│  Alert 区域 (错误/进度告警)                            │
├──────────────────────────────────────────────────────┤
│  总体进度条                                           │
├──────────────┬──────────────┬──────────┬─────────────┤
│  待翻译数     │  进行中       │  已完成   │  失败数      │
├──────────────┴──────────────┴──────────┴─────────────┤
│  队列状态卡    │  时间信息                               │
├──────────────────────────────────────────────────────┤
│  未翻译文章列表                                         │
├──────────────────────────────────────────────────────┤
│  未翻译分类列表                                         │
├──────────────────────────────────────────────────────┤
│  未翻译标签列表                                         │
├──────────────────────────────────────────────────────┤
│  任务历史 (表格 + 分页 + 筛选)                          │
├──────────────────────────────────────────────────────┤
│  实时队列 (Active / Waiting / Failed)                  │
└──────────────────────────────────────────────────────┘
```

## 九、工程要点

1. **多数据源协调**：四个独立 API 调用，不同刷新策略
2. **轮询 vs 手动**：实时队列用轮询，其他用按需刷新
3. **渐进显示**：未翻译文章 + 分类 + 标签逐步展示
4. **空状态处理**：无数据时显示 "暂无未翻译内容"
5. **深色模式**：所有组件都有 `dark:` 适配
6. **国际化**：日期使用 `date-fns` locale，文案使用 `useTranslation`
7. **防护**：已完成项不被误触翻译、错误项可重试

## 总结

`BlogTranslationProgress`（1309 行）是一个完整的 AI 翻译任务监控中心，展示了如何：

1. 将 **BullMQ 队列数据** 可视化到管理面板
2. 管理 **多数据源** 的加载和刷新策略
3. 设计 **企业级告警系统**（错误/警告/成功）
4. 实现 **实时轮询 + 按需刷新** 的数据获取模式

对于任何需要 AI 批处理任务监控的系统，这是一个完整的参考实现。
