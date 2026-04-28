# Plan: Decouple admin-next Locale Toggle from Blog Translation

## Background

**发现的问题：** admin-next 开启语言时，后端 `toggleLocale()` 会 emit `locale.enabled` 事件，而 [`blog.service.ts:1027`](../apps/api/src/blog/blog.service.ts:1027) 监听了同一个事件名，导致**自动触发 blog 全库 AI 翻译**（文章、分类、标签）。

## Changes Required

### 1️⃣ Backend: Rename event for blog locale toggle

**File: [`apps/api/src/admin/system-config/system-config.service.ts`](../apps/api/src/admin/system-config/system-config.service.ts)**

| 位置 | 当前 | 改为 |
|------|------|------|
| Line 184 | `emitAsync('locale.enabled', code)` | **不变** (admin-next 通用 locale) |
| Line 254 | `emitAsync('locale.enabled', code)` | **`emitAsync('locale.blog.enabled', code)`** |

**File: [`apps/api/src/blog/blog.service.ts`](../apps/api/src/blog/blog.service.ts)**

| 位置 | 当前 | 改为 |
|------|------|------|
| Line 1027 | `@OnEvent('locale.enabled')` | **`@OnEvent('locale.blog.enabled')`** |

**效果：** 只有 admin-blog 切换语言才会触发 blog 翻译，admin-next 切换语言不会。

---

### 2️⃣ Frontend: Hide translation settings in admin-next Settings page

**File: [`apps/admin-next/src/components/settings/SettingsClient.tsx`](../apps/admin-next/src/components/settings/SettingsClient.tsx)**

| 操作 | 位置 | 说明 |
|------|------|------|
| Remove tab button | Lines 578-588 | 移除 `Translation` tab 按钮 |
| Remove conditional render | Line 645 | 移除 `activeTab === 'translation'` 分支 |
| Remove `TranslationSettingsContent` | Lines 369-520 | 移除整个 `TranslationSettingsContent` 组件（或保留但不导出） |
| Remove `'translation'` from `Tab` union type | Line 321 | `type Tab = 'general' \| 'locales'` |

**File: [`apps/admin-next/src/api/index.ts`](../apps/admin-next/src/api/index.ts)**

可选：移除 blog 翻译 API 方法
| 方法 | 位置 |
|------|------|
| `systemConfig.getDefaultSourceLang` | Lines 901-906 |
| `systemConfig.updateDefaultSourceLang` | Lines 908-912 |

这些是 blog 专用 API，admin-next 不再需要。

---

### 3️⃣ Analysis: Translating admin-next Full System UI

#### Current State
- admin-next 已有完善的 `next-intl` i18n 架构
- 6 种语言 locale JSON 文件（en/zh/ja/ko/fr/de），约 1500+ 行翻译 keys
- 大部分组件通过 `useTranslation()` 使用 `t()` 函数获取翻译
- 已覆盖的主要模块：translations, orders, coupon, ads, flashSale, luckyDraw, notifications, customerService, analytics, finance, adminUsers, roles, paymentChannel, systemConfig, login 等

#### What's Missing / What Would Need Work

| 模块 | 状态 | 工作量 |
|------|------|--------|
| 现有 locale keys 翻译质量检查 | 已有翻译但可能不完整/不准确 | 中 |
| 检查是否有硬编码的中文字符串 | 需全局搜索中文/日文/韩文硬编码内容 | 中 |
| locale JSON 文件维护 | 每次新增 UI 都需要添加对应的 i18n keys | 持续 |
| 动态内容翻译 (后台管理数据) | 数据库中的内容无法通过 i18n 翻译 | 大 |
| 翻译审核流程 | 确保多语言 UI 一致性 | 中 |

#### Recommendation
鉴于 admin-next 是内部后台管理系统，使用者主要是中文管理员，**当前不推荐投入资源做完整的 admin-next 多语言 UI 翻译**。Locale 切换功能保留但仅用于控制前端显示语言，翻译设置 tab 隐藏，locale 切换不触发任何后台翻译。

## Execution Order

1. Backend: Change event name in `system-config.service.ts` (toggleBlogLocale) and `blog.service.ts`
2. Frontend: Hide translation tab in `SettingsClient.tsx`
3. (Optional) Frontend: Remove blog-specific translation API methods from admin-next `api/index.ts`
4. Run `check-types` and verify
