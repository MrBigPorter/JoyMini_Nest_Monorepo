# ✅ ADMIN-NEXT 设计系统对照表 (博客前台)

> 🎯 **所有组件必须 100% 符合这个对照表**
>
> 每次写代码前打开，写完后对照检查每一项

---

## 🔴 检查清单 (✅ 为已完成)

### 🟢 1. 定位与层级

| 组件            | z-index | 定位方式     | 检查 |
| --------------- | ------- | ------------ | ---- |
| Header          | 30      | sticky top-0 | ✅   |
| 固定侧边栏      | 40      | fixed        | ⬜   |
| 模态框/下拉菜单 | 50      | absolute     | ⬜   |
| Toast通知       | 100     | fixed        | ⬜   |

### 🟢 2. 间距标准

| 场景       | 间距值                 | 检查 |
| ---------- | ---------------------- | ---- |
| 容器内边距 | `px-4 md:px-6 lg:px-8` | ✅   |
| 卡片内边距 | `p-6`                  | ✅   |
| 元素间距   | `gap-3`                | ✅   |
| 区块间距   | `gap-6`                | ✅   |

### 🟢 3. 圆角标准

| 组件   | 圆角值         | 检查 |
| ------ | -------------- | ---- |
| 按钮   | `rounded-lg`   | ⬜   |
| 卡片   | `rounded-xl`   | ✅   |
| 输入框 | `rounded-lg`   | ⬜   |
| 头像   | `rounded-full` | ⬜   |
| 标签   | `rounded-md`   | ✅   |

### 🟢 4. 阴影标准

| 状态 | 阴影值      | 检查 |
| ---- | ----------- | ---- |
| 默认 | `shadow-sm` | ✅   |
| 悬停 | `shadow-md` | ✅   |
| 弹窗 | `shadow-lg` | ⬜   |

### 🟢 5. 按钮标准 (Button.tsx)

| Variant   | 样式                                                                                                               | 检查 |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ---- |
| primary   | `bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30 hover:brightness-110` | ⬜   |
| secondary | `bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/20`           | ⬜   |
| ghost     | `text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5`                                         | ⬜   |
| outline   | `border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5`                               | ⬜   |

### 🟢 6. 大小标准

| Size | 内边距                | 检查 |
| ---- | --------------------- | ---- |
| sm   | `px-3 py-1.5 text-sm` | ⬜   |
| md   | `px-4 py-2`           | ✅   |
| lg   | `px-6 py-3 text-lg`   | ⬜   |

### 🟢 7. 颜色标准

| 场景     | 浅色模式           | 深色模式           | 检查 |
| -------- | ------------------ | ------------------ | ---- |
| 标题     | `text-slate-800`   | `text-slate-100`   | ✅   |
| 正文     | `text-slate-700`   | `text-slate-300`   | ✅   |
| 次要文字 | `text-slate-500`   | `text-slate-400`   | ✅   |
| 边框     | `border-slate-200` | `border-slate-700` | ✅   |

### 🟢 8. 过渡标准

所有可交互元素统一使用:
`transition-all duration-150 ease-in-out` | ✅ |

### 🟢 9. 动画标准

| 交互     | 效果                    | 检查 |
| -------- | ----------------------- | ---- |
| 卡片悬停 | 阴影加深 + 轻微上移 1px | ✅   |
| 按钮按下 | `scale(0.95)`           | ✅   |
| 按钮悬停 | 背景色加深 / 亮度 +10%  | ⬜   |
| 链接悬停 | 下划线 + 颜色加深       | ✅   |

---

## 📦 组件系统架构

✅ **所有基础UI组件统一在 `packages/ui` 公共库中实现**
✅ 前台博客 / 后台管理 / 所有应用 100% 复用同一个组件库
✅ 设计系统天然统一，不需要重复开发

| 组件        | 状态      | 位置              |
| ----------- | --------- | ----------------- |
| ✅ Button   | ✅ 已完成 | @repo/ui/button   |
| ✅ Card     | ✅ 已完成 | @repo/ui/card     |
| ✅ Badge    | ✅ 已完成 | @repo/ui/badge    |
| ✅ Input    | ✅ 已完成 | @repo/ui/input    |
| ✅ Modal    | ✅ 已完成 | @repo/ui/modal    |
| ✅ Skeleton | ✅ 已完成 | @repo/ui/skeleton |
| ✅ Avatar   | ✅ 已完成 | @repo/ui/avatar   |
| ✅ Dropdown | ✅ 已完成 | @repo/ui/dropdown |

---

## 📋 已验证组件

- ✅ ArticleCard
- ✅ Header
- ✅ Button (共享库)
- ✅ Card (共享库)
- ⬜ Footer
- ⬜ Sidebar
- ⬜ Pagination

---

> **最后更新**: 2026-04-07
> **参考来源**:
> ✅ admin-next 设计系统
> ✅ packages/ui 共享组件库
> ✅ BLOG_DESIGN_GUIDELINES.md
