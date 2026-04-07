# 📚 Provider 组件完整指南

## ✨ 项目中两个核心 Provider 的说明

---

## 1️⃣ `QueryProvider` (React Query)

### 🎯 核心作用

- 全局管理 React Query 客户端
- 统一配置 API 缓存策略
- 提供全应用数据请求状态管理

### ⚙️ 关键配置

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // ✅ 数据 5 分钟内视为新鲜
      gcTime: 10 * 60 * 1000, // ✅ 闲置数据 10 分钟后回收
      retry: 1, // ✅ 请求失败只重试 1 次
      refetchOnWindowFocus: false, // ✅ 窗口聚焦不自动刷新
      refetchOnReconnect: true, // ✅ 网络恢复时自动刷新
    },
    mutations: {
      retry: 0, // ✅ 写操作永不重试
    },
  },
});
```

### 🚀 使用场景

✅ 任何需要使用 `useQuery` / `useMutation` 的组件
✅ API 数据缓存、去重、重试
✅ 后台静默刷新
✅ 乐观更新、请求取消
✅ 全局错误处理

### ⚠️ 注意事项

- 必须放在根布局最内层
- 所有数据请求 Hook 必须在这个 Provider 之内
- 不要在服务端组件中使用

---

## 2️⃣ `NextIntlClientProvider` (国际化)

### 🎯 核心作用

- 客户端国际化上下文
- 提供多语言翻译消息
- 管理当前语言和区域设置

### ⚙️ 关键属性

| 属性       | 说明                        |
| ---------- | --------------------------- |
| `locale`   | 当前语言代码 `zh-CN` / `en` |
| `messages` | 翻译 JSON 对象              |
| `timeZone` | 时区配置                    |
| `formats`  | 日期/数字格式               |

### 🚀 使用场景

✅ `useTranslations()` Hook
✅ 日期格式化 `useFormatter()`
✅ 相对时间显示
✅ 数字和货币本地化
✅ 页面内语言切换

### ⚠️ 注意事项

- 在 App Router 中必须在 Root Layout 中初始化
- 支持 SSR 水合
- 可以嵌套覆盖
- 静态导出页面需要单独配置

---

## 🏗️ 正确的嵌套顺序

```tsx
<NextIntlClientProvider>
  {" "}
  ← 最外层 (国际化)
  <QueryProvider>
    {" "}
    ← 第二层 (数据)
    <Header />
    <main>{children}</main>
    <BottomNavigation />
  </QueryProvider>
</NextIntlClientProvider>
```

## ✅ 最佳实践

1. ❌ 不要在每个页面重复创建 Provider
2. ✅ 全局配置只在根布局定义一次
3. ❌ 不要在 Provider 之外使用对应的 Hook
4. ✅ 所有配置保持和 admin 后台完全一致
5. ✅ 避免不必要的嵌套层级

---

**文档创建**: 2026-04-07
**适用项目**: apps/admin-next / apps/frontend-blog
