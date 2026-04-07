# Blog 设计规范文档 v1.0.0

> ✅ 100% 复用 admin-next 设计系统，保持视觉完全一致

---

## 1. 颜色系统

### 1.1 主色调

| 名称        | 浅色模式  | 深色模式  | 使用场景      |
| ----------- | --------- | --------- | ------------- |
| Primary 50  | `#eff6ff` | `#1e3a8a` | 背景          |
| Primary 100 | `#dbeafe` | `#1e40af` | 背景          |
| Primary 200 | `#bfdbfe` | `#2563eb` | 边框          |
| Primary 300 | `#93c5fd` | `#3b82f6` | 边框/图标     |
| Primary 400 | `#60a5fa` | `#60a5fa` | 次要按钮      |
| Primary 500 | `#3b82f6` | `#3b82f6` | 主按钮/主链接 |
| Primary 600 | `#2563eb` | `#2563eb` | 悬停状态      |
| Primary 700 | `#1d4ed8` | `#1d4ed8` | 按下状态      |
| Primary 800 | `#1e40af` | `#1e40af` | 强调文字      |
| Primary 900 | `#1e3a8a` | `#eff6ff` | 标题文字      |

### 1.2 中性色

| 色阶 | 浅色模式  | 深色模式  | 使用场景   |
| ---- | --------- | --------- | ---------- |
| 50   | `#f8fafc` | `#0f172a` | 页面背景   |
| 100  | `#f1f5f9` | `#1e293b` | 卡片背景   |
| 200  | `#e2e8f0` | `#334155` | 边框       |
| 300  | `#cbd5e1` | `#475569` | 分隔线     |
| 400  | `#94a3b8` | `#64748b` | 次要文字   |
| 500  | `#64748b` | `#94a3b8` | 说明文字   |
| 600  | `#475569` | `#cbd5e1` | 正文文字   |
| 700  | `#334155` | `#e2e8f0` | 标题文字   |
| 800  | `#1e293b` | `#f1f5f9` | 大标题     |
| 900  | `#0f172a` | `#f8fafc` | 最高级标题 |

### 1.3 语义色

| 类型 | 颜色值    | 使用场景      |
| ---- | --------- | ------------- |
| 成功 | `#10b981` | 成功提示/状态 |
| 警告 | `#f59e0b` | 警告提示/状态 |
| 错误 | `#ef4444` | 错误提示/状态 |
| 信息 | `#3b82f6` | 信息提示      |

---

## 2. 间距系统

### 2.1 标准间距

| 代码     | 像素值 | 使用场景       |
| -------- | ------ | -------------- |
| `gap-1`  | 4px    | 图标与文字间距 |
| `gap-2`  | 8px    | 紧凑间距       |
| `gap-3`  | 12px   | 元素内部间距   |
| `gap-4`  | 16px   | 标准间距       |
| `gap-6`  | 24px   | 区块间距       |
| `gap-8`  | 32px   | 大区块间距     |
| `gap-10` | 40px   | 章节间距       |
| `gap-12` | 48px   | 大章节间距     |

### 2.2 内边距标准

| 组件类型         | 内边距                 |
| ---------------- | ---------------------- |
| 按钮             | `px-4 py-2`            |
| 卡片             | `p-6`                  |
| 侧边栏           | `p-4`                  |
| 页面容器         | `px-4 md:px-6 lg:px-8` |
| 内容区域最大宽度 | `max-w-7xl mx-auto`    |

---

## 3. 排版系统

### 3.1 字体层级

| 层级    | 字号            | 行高 | 字重 | 使用场景   |
| ------- | --------------- | ---- | ---- | ---------- |
| Display | 3rem / 48px     | 1.1  | 700  | 首页大标题 |
| H1      | 2.25rem / 36px  | 1.2  | 700  | 页面标题   |
| H2      | 1.875rem / 30px | 1.3  | 600  | 区块标题   |
| H3      | 1.5rem / 24px   | 1.4  | 600  | 文章标题   |
| H4      | 1.25rem / 20px  | 1.4  | 600  | 卡片标题   |
| H5      | 1.125rem / 18px | 1.5  | 600  | 小组件标题 |
| Base    | 1rem / 16px     | 1.5  | 400  | 正文       |
| Small   | 0.875rem / 14px | 1.5  | 400  | 辅助文字   |
| XS      | 0.75rem / 12px  | 1.5  | 400  | 标签/提示  |

### 3.2 字体规范

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
font-smoothing: antialiased;
```

---

## 4. 圆角与阴影

### 4.1 圆角标准

| 类型 | 圆角值              | 使用场景      |
| ---- | ------------------- | ------------- |
| 小   | `rounded-md` / 6px  | 按钮/输入框   |
| 标准 | `rounded-lg` / 8px  | 卡片/模态框   |
| 大   | `rounded-xl` / 12px | 大卡片/容器   |
| 完整 | `rounded-full`      | 头像/圆形按钮 |

### 4.2 阴影标准

| 类型 | 阴影值      | 使用场景 |
| ---- | ----------- | -------- |
| 小   | `shadow-sm` | 卡片默认 |
| 标准 | `shadow-md` | 卡片悬停 |
| 大   | `shadow-lg` | 模态框   |
| 超大 | `shadow-xl` | 弹出层   |

---

## 5. 组件规范

### 5.1 按钮规范

```tsx
// 主要按钮
<Button size="default" variant="default">
  主要操作
</Button>

// 次要按钮
<Button size="default" variant="secondary">
  次要操作
</Button>

// 幽灵按钮
<Button size="default" variant="ghost">
  文本按钮
</Button>

// 禁用状态
<Button size="default" disabled>
  禁用
</Button>
```

### 5.2 卡片规范

```tsx
<Card className="p-6 hover:shadow-md transition-shadow">
  <CardHeader>
    <CardTitle>卡片标题</CardTitle>
    <CardDescription>卡片描述文字</CardDescription>
  </CardHeader>
  <CardContent>卡片内容</CardContent>
</Card>
```

### 5.3 链接规范

```tsx
// 内联链接
<a className="text-primary hover:underline">链接文字</a>

// 按钮式链接
<Button variant="link" asChild>
  <Link href="/articles">查看所有文章</Link>
</Button>
```

---

## 6. 响应式断点

| 断点   | 宽度   | 设备     |
| ------ | ------ | -------- |
| `sm:`  | 640px  | 手机横向 |
| `md:`  | 768px  | 平板     |
| `lg:`  | 1024px | 小桌面   |
| `xl:`  | 1280px | 标准桌面 |
| `2xl:` | 1536px | 大桌面   |

### 6.1 布局适配规则

✅ 手机: 单列布局
✅ 平板: 左侧边栏 + 内容区
✅ 桌面: 左侧边栏 + 内容区 + 右侧边栏

---

## 7. 动画与过渡

### 7.1 标准过渡

```css
transition-property: all;
transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
transition-duration: 150ms;
```

### 7.2 悬停效果

- 卡片: 上移 2px + 阴影加深
- 按钮: 背景色加深
- 链接: 下划线出现
- 图标: 轻微缩放 1.05x

---

## 8. 无障碍规范

✅ 所有可交互元素有 `aria-label`
✅ 颜色对比度 ≥ 4.5:1
✅ 键盘导航支持
✅ 屏幕阅读器支持
✅ 适当的焦点指示器

---

**文档版本**: 1.0.0  
**最后更新**: 2026-04-06  
**参考来源**: admin-next 设计系统
