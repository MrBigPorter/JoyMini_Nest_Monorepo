# 翻译进度监控页面实施计划

## 🎯 目标

创建一个完整的翻译进度监控页面，让管理员能够实时查看翻译任务的进度、状态和详细日志。

## 📋 实施步骤

### 第一阶段：后端API (1-2小时)

1. **创建API端点**
   - `GET /api/v1/admin/blog/translation-progress` - 获取翻译进度统计
   - `GET /api/v1/admin/blog/translation-jobs` - 获取详细任务列表
   - `GET /api/v1/admin/blog/translation-logs` - 获取翻译日志

2. **扩展BlogService**
   - 添加`getTranslationProgress()`方法
   - 添加`getTranslationJobs()`方法
   - 添加`getTranslationLogs()`方法

3. **数据模型**
   ```typescript
   interface TranslationProgress {
     totalItems: number;
     completedItems: number;
     failedItems: number;
     inProgressItems: number;
     articles: {
       total: number;
       completed: number;
       failed: number;
       pending: number;
     };
     categories: {
       total: number;
       completed: number;
       failed: number;
       pending: number;
     };
     tags: {
       total: number;
       completed: number;
       failed: number;
       pending: number;
     };
     queueStatus: {
       active: number;
       waiting: number;
       failed: number;
       completed: number;
     };
     startTime: Date;
     estimatedCompletionTime: Date;
     elapsedTime: number;
   }
   ```

### 第二阶段：前端页面 (3-4小时)

1. **创建页面组件**
   - `BlogTranslationProgress.tsx` - 主页面
   - `components/TranslationProgressCard.tsx` - Dashboard卡片
   - `components/TranslationStats.tsx` - 统计组件
   - `components/TranslationQueueTable.tsx` - 队列表格
   - `components/TranslationLogs.tsx` - 日志组件

2. **页面布局设计**
   - 顶部：总体进度条和关键指标
   - 中部：分类统计卡片（文章/分类/标签）
   - 下部：实时任务列表和详细日志
   - 侧边：控制面板（刷新、暂停、重试）

3. **实时更新机制**
   - 使用`useInterval`进行轮询（每5秒）
   - 可选：Server-Sent Events (SSE) 实时推送

### 第三阶段：集成与优化 (1-2小时)

1. **Dashboard集成**
   - 在Dashboard添加进度卡片
   - 添加链接到完整监控页面

2. **路由配置**
   - 添加路由：`/blog/translation-progress`
   - 更新导航菜单

3. **错误处理与用户体验**
   - 加载状态显示
   - 错误提示和重试机制
   - 空状态处理

## 🏗️ 文件结构

```
apps/admin-next/src/views/blog/
├── BlogTranslationProgress.tsx          # 主页面
├── components/
│   ├── TranslationProgressCard.tsx      # Dashboard卡片
│   ├── TranslationStats.tsx             # 统计组件
│   ├── TranslationQueueTable.tsx        # 队列表格
│   ├── TranslationLogs.tsx              # 日志组件
│   └── TranslationControls.tsx          # 控制面板
└── hooks/
    └── useTranslationProgress.ts        # 自定义Hook

apps/api/src/blog/
├── blog.controller.ts                    # 添加新端点
├── blog.service.ts                       # 添加进度方法
└── dto/
    └── translation-progress.dto.ts       # DTO定义
```

## 🎨 UI设计要点

### 1. 总体进度区域

```
[=================================== 75%]
总进度: 75% | 已完成: 15/39 | 进行中: 3 | 失败: 0
```

### 2. 分类统计卡片

```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    文章 (6/6)   │ │   分类 (6/6)    │ │   标签 (3/27)   │
│     100%      │ │     100%      │ │    ⏳ 11%       │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 3. 实时任务列表

```
┌─────────────────────────────────────────────────────────────┐
│ 类型    │ 名称              │ 状态     │ 开始时间   │ 耗时   │
├─────────────────────────────────────────────────────────────┤
│ 标签    │ "Performance"     │  完成  │ 14:54:41  │ 2.8s   │
│ 标签    │ "Best Practices"  │  完成  │ 14:54:41  │ 4.1s   │
│ 标签    │ "Error Handling"  │  完成  │ 14:54:44  │ 5.6s   │
│ 标签    │ "Security"        │ ⏳ 翻译中│ 14:55:00  │ --     │
└─────────────────────────────────────────────────────────────┘
```

### 4. 控制面板

```
┌─────────────────┐
│  控制面板       │
├─────────────────┤
│ 🔄 刷新数据     │
│ ⏸️  暂停翻译     │
│ 🔁 重试失败任务 │
│ 📊 查看详细日志 │
└─────────────────┘
```

## 🔧 技术实现细节

### 1. 后端实现

```typescript
// blog.service.ts
async getTranslationProgress(): Promise<TranslationProgress> {
  // 查询数据库统计
  const articles = await this.getArticleTranslationStats();
  const categories = await this.getCategoryTranslationStats();
  const tags = await this.getTagTranslationStats();

  // 查询队列状态
  const queueStatus = await this.getQueueStatus();

  return {
    totalItems: articles.total + categories.total + tags.total,
    completedItems: articles.completed + categories.completed + tags.completed,
    // ... 其他字段
  };
}
```

### 2. 前端Hook

```typescript
// useTranslationProgress.ts
export function useTranslationProgress() {
  const { data, loading, error, refresh } = useRequest(
    () => blogApi.getTranslationProgress(),
    {
      pollingInterval: 5000, // 每5秒轮询
      loadingDelay: 300,
    },
  );

  return { progress: data, loading, error, refresh };
}
```

### 3. 进度条组件

```tsx
const ProgressBar = ({ value, max = 100 }) => {
  const percentage = (value / max) * 100;

  return (
    <div className="w-full bg-gray-200 rounded-full h-4">
      <div
        className="bg-blue-600 h-4 rounded-full transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};
```

## 🚀 优先级建议

**立即实施：**

1. 后端API端点（Phase 1）
2. 基础监控页面（Phase 2基础）
3. Dashboard卡片（快速可见）

**后续优化：**

1. 实时SSE推送
2. 详细日志查看
3. 任务控制功能
4. 性能图表

## 📊 预期效果

管理员将能够：

- 实时查看翻译进度
- 监控每个分类的完成情况
- 查看失败任务和重试
- 了解预计完成时间
- 控制翻译过程（暂停/恢复）

## ⏱️ 时间估计

- **Phase 1 (后端)**: 2小时
- **Phase 2 (前端基础)**: 3小时
- **Phase 3 (优化集成)**: 2小时
- **总计**: 7小时

## 📚 相关文档

- [翻译问题检测与批量修复方案](translation-issue-detection-fix-plan.md)
- [博客问题修复方案](../docs/blog/plans/BLOG_ISSUES_FIX_PLAN.md)
- [本地化表单修复计划](localized-form-fix-plan.md)

现在开始实施！
