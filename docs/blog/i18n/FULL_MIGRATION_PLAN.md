# 博客多语言完整迁移计划 ✅

> **最终目标**: 全链路无兼容层，100% 原生 LocalizedString 架构

---

## 📋 完整修改清单

| 优先级  | 模块          | 文件                                                         | 修改内容  | 状态 |
| ------- | ------------- | ------------------------------------------------------------ | --------- | ---- |
| 🔴 最高 | 核心类型      | `packages/shared/src/types/localized-string.ts`              | ✅ 已完成 |
| 🔴 最高 | Schema 验证   | `apps/admin-next/src/schema/blog.ts`                         | ✅ 已完成 |
| 🔴 最高 | 表单组件      | `apps/admin-next/src/views/blog/BlogArticleModal.tsx`        | ✅ 已完成 |
| 🟠 高   | API 客户端    | `apps/admin-next/src/api/blog.ts`                            | 待改      |
| 🟠 高   | 后端服务      | `apps/api/src/blog/blog.service.ts`                          | 待改      |
| 🟠 高   | 后端控制器    | `apps/api/src/blog/blog.controller.ts`                       | 待改      |
| 🟡 中   | 后台列表页    | `apps/admin-next/src/app/(dashboard)/blog/page.tsx`          | 待改      |
| 🟡 中   | 后台文章列表  | `apps/admin-next/src/app/(dashboard)/blog/articles/page.tsx` | 待改      |
| 🟢 低   | AI 翻译处理器 | `apps/api/src/blog/processors/blog-ai.processor.ts`          | 待改      |
| 🟢 低   | 博客前端列表  | `apps/frontend-blog/src/app/blog/page.tsx`                   | 待改      |
| 🟢 低   | 博客前端详情  | `apps/frontend-blog/src/app/blog/[slug]/page.tsx`            | 待改      |
| 🟢 低   | Sitemap 生成  | `apps/admin-next/src/app/sitemap.ts`                         | 待改      |

---

## 🚀 第一阶段: 核心链路 (现在执行)

### ✅ 1. API 接口改造

**文件**: `apps/admin-next/src/api/blog.ts`

- 修改 `createArticle` 参数类型
- 修改 `updateArticle` 参数类型
- 修改 `getArticle` 返回类型
- 删除所有 `xxxEn` 字段

### ✅ 2. 后端 BlogService 改造

**文件**: `apps/api/src/blog/blog.service.ts`

- 直接读写 `title` / `content` / `excerpt` Localized 字段
- 删除所有双写兼容逻辑
- 删除所有 `xxxEn` 字段读写
- 调用 `getLocalizedValue()` 进行回退

### ✅ 3. 后端 Controller 改造

**文件**: `apps/api/src/blog/blog.controller.ts`

- 更新 DTO 类型
- 删除旧字段映射

---

## 🚀 第二阶段: 列表页展示

### ✅ 4. 后台列表页

**文件**: `apps/admin-next/src/app/(dashboard)/blog/page.tsx`

- 列表标题自动使用当前语言显示
- 调用 `getLocalizedValue()`
- 不需要任何语言判断

### ✅ 5. 文章管理列表

**文件**: `apps/admin-next/src/app/(dashboard)/blog/articles/page.tsx`

- 同样使用自动回退逻辑
- 显示翻译状态指示器

---

## 🚀 第三阶段: 前端展示

### ✅ 6. 博客前端

- 所有页面自动根据 `Accept-Language` 显示对应语言
- 无缝降级回退
- 不需要任何语言参数

---

## ✅ 数据库迁移方案

> **零停机迁移**，不需要数据转换:

1.  保留旧字段 30 天
2.  新代码同时读写新旧字段
3.  运行后台脚本批量迁移历史数据
4.  30 天后删除旧字段

---

## 📊 预期结果

✅ **代码减少**: 删除约 300 行重复代码
✅ **零维护**: 新增语言不需要修改任何业务代码
✅ **零技术债务**: 没有任何兼容层和硬编码
✅ **100% 类型安全**: 全链路 TypeScript 验证
✅ **向后兼容**: 不影响任何现有功能

---

_最后更新: 2026-04-10_
