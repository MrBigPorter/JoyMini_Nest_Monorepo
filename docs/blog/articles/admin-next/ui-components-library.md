---
title: 'admin-next UI 组件库——12 个基础组件：Button、Card、Modal、Input、Select、Switch、Badge、Toast、Dropdown、ImageUpload、Breadcrumbs'
slug: admin-next-ui-components-library
tags: Next.js, Admin, React, TypeScript, UI Components, Tailwind CSS, Framer Motion
description: A comprehensive walkthrough of the admin-next UI component library — 12 reusable components built with React, Tailwind CSS, and Framer Motion. Covers Button, Card, Modal, Input, Select, Switch, Badge, Toast, Dropdown, ImageUpload, Breadcrumbs, and utility exports.
---

# admin-next UI 组件库——12 个基础组件：Button、Card、Modal、Input、Select、Switch、Badge、Toast、Dropdown、ImageUpload、Breadcrumbs

> **Article A12** — The admin-next UI component library provides 12 reusable base components built on React, Tailwind CSS, and Framer Motion. Each component is designed for dark mode compatibility, accessibility, and developer ergonomics.

- **Source**: [`UIComponents.tsx`](apps/admin-next/src/components/UIComponents.tsx) (631L)
- **Animation**: Framer Motion `motion` primitives + custom `Variants`
- **Icons**: `lucide-react` icon set
- **Series**: admin-next Architecture Deep Dive

---

## 1. 概述

在 admin-next 项目中，我们维护了一套轻量级 UI 组件库，包含 **12 个基础组件**。与全功能 UI 框架（如 Ant Design、MUI）不同，这套组件库遵循以下设计原则：

- **Tailwind CSS 驱动**：所有样式使用 Tailwind utility classes，无额外 CSS 文件
- **Framer Motion 动画**：交互动效使用 `motion` 原语，支持 `AnimatePresence` 进出场动画
- **暗色模式优先**：每个组件都内置 `dark:` 前缀的暗色变体
- **极简依赖**：仅依赖 `react`、`lucide-react`、`framer-motion`，无第三方 UI 库
- **类型安全**：所有 props 都使用 TypeScript 接口定义

组件清单：

| # | 组件 | 行数 | 核心特性 |
|---|------|------|---------|
| 1 | `Button` | 48 | 5 种变体 + 3 种尺寸 + loading 态 |
| 2 | `Card` | 22 | 标题 + 操作插槽 + 暗色模式 |
| 3 | `Input` | 24 | label + error 态 + focus ring |
| 4 | `Textarea` | 15 | label + 暗色适配 |
| 5 | `Select` | 32 | 自定义 chevron + label |
| 6 | `Switch` | 31 | spring 动画 + aria 无障碍 |
| 7 | `Badge` | 19 | 6 种颜色语义 |
| 8 | `Modal` | 55 | AnimatePresence + 3 种尺寸 |
| 9 | `ImageUpload` | 88 | 拖拽上传 + 预览 + loading |
| 10 | `Dropdown` | 56 | 点击外部关闭 + 动画菜单 |
| 11 | `Toast` + `ToastContainer` | 64 | 自动消除 + 3 种类型 |
| 12 | `Breadcrumbs` | 18 | ChevronRight 分隔 + 高亮末项 |

---

## 2. Button——5 种变体 + 3 种尺寸

[`Button`](apps/admin-next/src/components/UIComponents.tsx:119) 是 UI 组件库中最核心的交互元素，支持 5 种视觉变体和 3 种尺寸：

```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}
```

**变体设计**：

| 变体 | 用途 | 样式 |
|------|------|------|
| `primary` | 主要操作 | 渐变色 + shadow-lg |
| `secondary` | 次要操作 | 灰色背景 + 透明边框 |
| `danger` | 危险操作 | 红色背景 + 红色阴影 |
| `ghost` | 轻量操作 | 透明背景 |
| `outline` | 边框按钮 | 透明背景 + 灰色边框 |

**动画交互**：

```tsx
<motion.button
  whileHover={{ scale: 1.02, filter: 'brightness(1.1)' }}
  whileTap={{ scale: 0.95 }}
  // ...
>
  {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
  {children}
</motion.button>
```

`whileHover` 在悬停时略微放大并增加亮度，`whileTap` 在点击时缩小，提供触感反馈。Loading 态下显示旋转图标并禁用点击。

---

## 3. Card——容器组件

[`Card`](apps/admin-next/src/components/UIComponents.tsx:89) 是最常用的布局容器，提供标题和操作插槽：

```tsx
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
}
```

```tsx
<Card title="用户统计" action={<Button size="sm">导出</Button>}>
  <p>内容区域</p>
</Card>
```

Card 使用 `rounded-xl shadow-sm border` 组合，暗色模式下自动切换 `dark:bg-dark-800` 背景。所有子元素的 `transition-colors duration-300` 确保主题切换动画平滑。

---

## 4. Input & Textarea——表单输入

[`Input`](apps/admin-next/src/components/UIComponents.tsx:192) 包装原生 `<input>`，增加 label 和 error 状态：

```tsx
<Input
  label="邮箱"
  error="请输入有效的邮箱地址"
  placeholder="user@example.com"
/>
```

**Focus ring** 实现技巧：将 `focus-within:ring-2` 放在外层 `<div>` 而非直接在 `<input>` 上，这样 `:-webkit-autofill` 不会影响边框颜色：

```tsx
<div className={`flex items-center bg-gray-50 dark:bg-black/20 border ... rounded-lg
  focus-within:ring-2 focus-within:ring-primary-500/50 focus-within:border-primary-500`}>
  <input className="w-full px-4 py-2.5 bg-transparent border-0 outline-none ..." />
</div>
```

[`Textarea`](apps/admin-next/src/components/UIComponents.tsx:218) 类似实现，固定 `min-h-[100px]` + `resize-none`，适用于多行文本输入。

---

## 5. Select——下拉选择

[`Select`](apps/admin-next/src/components/UIComponents.tsx:239) 包装原生 `<select>`，使用 `appearance-none` 隐藏默认箭头，用 `lucide-react` 的 `ChevronDown` 替代：

```tsx
interface SelectOption {
  label: string;
  value: string | number;
}

<Select
  label="状态"
  options={[
    { label: '全部', value: '' },
    { label: '启用', value: 'active' },
    { label: '禁用', value: 'inactive' },
  ]}
/>
```

使用 `pointer-events-none` 让自定义 chevron 图标不干扰 select 点击事件。

---

## 6. Switch——开关

[`Switch`](apps/admin-next/src/components/UIComponents.tsx:270) 使用 `role="switch"` 和 `aria-checked` 确保无障碍访问。圆形滑块使用 Framer Motion 的 `layout` prop 实现弹簧动画：

```tsx
<motion.span
  layout
  transition={{ type: 'spring', stiffness: 700, damping: 30 }}
  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
    ${checked ? 'translate-x-5' : 'translate-x-0'}`}
/>
```

`spring` 动画的 `stiffness: 700` 提供快速响应，`damping: 30` 防止过度弹跳。

---

## 7. Badge——标签

[`Badge`](apps/admin-next/src/components/UIComponents.tsx:311) 支持 6 种颜色语义：

```tsx
type BadgeColor = 'green' | 'blue' | 'yellow' | 'red' | 'purple' | 'gray';

<Badge color="green">已通过</Badge>
<Badge color="red">已拒绝</Badge>
<Badge color="yellow">待审核</Badge>
```

每种颜色提供浅色/暗色双模式样式：

```
green: bg-emerald-100 text-emerald-700
       dark:bg-emerald-500/10 dark:text-emerald-400
       border border-emerald-200 dark:border-emerald-500/20
```

---

## 8. Modal——弹窗

[`Modal`](apps/admin-next/src/components/UIComponents.tsx:336) 使用 Framer Motion 的 `AnimatePresence` 实现进出场动画：

```tsx
<AnimatePresence>
  {isOpen && (
    <>
      {/* 遮罩层 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={onCloseAction}
      >
        {/* 弹窗内容 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className={`bg-white dark:bg-dark-900 w-full ${sizes[size]} rounded-2xl shadow-2xl ...`}
        >
```

**3 种尺寸**：`sm`（max-w-sm）、`md`（max-w-lg）、`lg`（max-w-2xl）。遮罩层点击关闭，弹窗内容区域使用 `onClick={(e) => e.stopPropagation()}` 防止冒泡。

---

## 9. ImageUpload——图片上传

[`ImageUpload`](apps/admin-next/src/components/UIComponents.tsx:408) 是最复杂的组件，支持拖拽上传和点击选择：

```
┌──────────────────────────────────┐
│          [UploadCloud]            │
│    Click or drag image here      │
│    SVG, PNG, JPG or GIF (5MB)    │
└──────────────────────────────────┘
         ↓ 拖入图片
┌──────────────────────────────────┐
│       ┌────────────────┐         │
│       │   [预览图片]     │         │
│       └────────────────┘         │
│       [UploadCloud] Change Image │  ← hover 显示
└──────────────────────────────────┘
```

关键实现细节：

```tsx
const handleFile = (file: File) => {
  setUploading(true);
  // 模拟上传延迟 1.5s
  setTimeout(() => {
    const fakeUrl = URL.createObjectURL(file);
    onChangeAction(fakeUrl);
    setUploading(false);
  }, 1500);
};
```

拖拽状态使用 `isDragging` 状态变量，在 `onDragOver`/`onDragLeave` 中切换，视觉上改变边框颜色和背景。

---

## 10. Dropdown——下拉菜单

[`Dropdown`](apps/admin-next/src/components/UIComponents.tsx:508) 使用 `useRef` + `useEffect` 实现点击外部关闭：

```tsx
useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    if (ref.current && !ref.current.contains(event.target as Node)) {
      setOpen(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, []);
```

菜单项支持 `danger` 属性，为危险操作提供红色样式：

```tsx
<Dropdown
  trigger={<Button>操作</Button>}
  items={[
    { label: '编辑', icon: <Edit size={14} />, onClick: () => handleEdit(row) },
    { label: '删除', icon: <Trash size={14} />, onClick: () => handleDelete(row), danger: true },
  ]}
/>
```

---

## 11. Toast & ToastContainer——消息通知

[`Toast`](apps/admin-next/src/components/UIComponents.tsx:572) 和 [`ToastContainer`](apps/admin-next/src/components/UIComponents.tsx:615) 组成轻量级通知系统：

```tsx
interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}
```

Toast 自动在 3 秒后消失，使用左侧彩色边框区分类型：

```
┌──────────────────────────────────┐
│ 🟢 操作成功！                   ✕ │  ← success: border-l-green-500
├──────────────────────────────────┤
│ 🔴 操作失败！                   ✕ │  ← error:   border-l-red-500
├──────────────────────────────────┤
│ 🔵 加载中...                    ✕ │  ← info:    border-l-blue-500
└──────────────────────────────────┘
```

`ToastContainer` 使用 `AnimatePresence mode="popLayout"` 确保多个 Toast 堆叠时动画流畅。

---

## 12. Breadcrumbs——面包屑导航

[`Breadcrumbs`](apps/admin-next/src/components/UIComponents.tsx:69) 是最简单的组件，使用 `ChevronRight` 图标分隔：

```tsx
<Breadcrumbs items={['系统管理', '用户管理', '编辑用户']} />
// 渲染: 系统管理 > 用户管理 > 编辑用户
```

最后一项自动加粗（`font-semibold`），表示当前页面。

---

## 13. 动画变体与工具函数

除了组件本身，[`UIComponents.tsx`](apps/admin-next/src/components/UIComponents.tsx) 还导出了通用动画变体和工具函数：

**动画变体**：

```tsx
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};
```

**CSV 导出**：

```tsx
const exportToCSV = (data: Record<string, unknown>[], filename: string) => {
  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];
  for (const row of data) {
    const values = headers.map((header) => `"${('' + row[header]).replace(/"/g, '\\"')}"`);
    csvRows.push(values.join(','));
  }
  // 创建 Blob 并触发下载
};
```

结合 `ExportButton` 组件使用，支持外部数据源和自定义 onClick 两种模式。

---

## 14. 设计决策

### 为什么不用 Ant Design / MUI？

admin-next 选择自建组件库而非使用 Ant Design 或 MUI，原因如下：

| 对比维度 | 自建组件库 | Ant Design / MUI |
|---------|-----------|-----------------|
| 包体积 | ~50KB（lucide + framer-motion） | 500KB+ |
| 样式覆盖 | Tailwind classes 直接覆盖 | `!important` 或 CSS-in-JS override |
| 暗色模式 | 原生支持 | 需额外配置 |
| 学习成本 | 零，就是 React + Tailwind | 需学习组件 API |
| 定制自由度 | 完全控制 | 受限于框架 |

### 动画策略

- **交互动画**（hover/tap）：使用 `motion` 的 `whileHover`/`whileTap`
- **进出场动画**（Modal/Toast/Dropdown）：使用 `AnimatePresence`
- **布局动画**（Switch）：使用 `layout` prop + spring transition

### 确保无障碍

- Button: 原生 `<button>`，`disabled` 态
- Switch: `role="switch"` + `aria-checked`
- Modal: `role="dialog"` + `aria-modal="true"`
- Input/Select: 原生 label 关联
- Dropdown: 点击外部关闭（Escape 键待补充）

---

## 15. 使用示例

在 admin-next 中，组件组合使用构建典型列表页：

```tsx
export default function UserListPage() {
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={['系统管理', '用户管理']} />

      <Card title="用户列表" action={<ExportButton data={users} filename="users" />}>
        {/* 搜索栏 */}
        <div className="flex gap-4 mb-4">
          <Input placeholder="搜索用户名..." />
          <Select options={statusOptions} />
          <Button>搜索</Button>
        </div>

        {/* 表格操作 */}
        <div className="flex gap-2 mb-4">
          <Button variant="primary">新增用户</Button>
          <Button variant="ghost">批量删除</Button>
        </div>

        {/* 表格 */}
        <table>{/* ... */}</table>

        {/* 状态标签 */}
        <Badge color="green">活跃</Badge>
      </Card>

      {/* 全局 Toast */}
      <ToastContainer toasts={toasts} removeToastAction={removeToast} />
    </div>
  );
}
```

---

## 16. 总结

| 组件 | 复杂度 | 使用频率 | 关键设计点 |
|------|-------|---------|-----------|
| Button | ⭐⭐ | 极高 | 5 变体 + motion 动画 |
| Card | ⭐ | 极高 | 容器 + 标题插槽 |
| Input/Textarea | ⭐⭐ | 高 | Focus ring 隔离技巧 |
| Select | ⭐⭐ | 高 | appearance-none + 自定义 chevron |
| Switch | ⭐⭐ | 中 | spring 动画 + aria 无障碍 |
| Badge | ⭐ | 高 | 6 色语义 + 暗色适配 |
| Modal | ⭐⭐⭐ | 中 | AnimatePresence + 3 尺寸 |
| ImageUpload | ⭐⭐⭐ | 中 | 拖拽 + URL.createObjectURL |
| Dropdown | ⭐⭐⭐ | 中 | 点击外部关闭 |
| Toast | ⭐⭐ | 高 | 自动消除 + 类型语义色 |
| Breadcrumbs | ⭐ | 中 | 纯 CSS 分隔 |

### 相关文章

- [`admin-next HttpClient`](docs/blog/articles/admin/http-client-auth-refresh-retry.md) — 与 UI 组件配合使用的 API 请求层
- [`SmartTable`](docs/blog/articles/admin/smart-table-generic-data-grid.md) — 基于 UI 组件的 ProTable 风格智能表格
- [`Sentry 可观测性体系`](docs/blog/articles/admin/sentry-observability-span-utils.md) — 组件性能监控与错误追踪
