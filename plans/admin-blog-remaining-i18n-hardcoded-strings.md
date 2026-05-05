# Admin Blog — 剩余硬编码英文字符串国际化

## 概述

解决 4 个区域中剩余的硬编码英文字符串：
1. **Sidebar 左下角**: `Blog Admin` 标题 + `Admin` 回退显示名
2. **Header**: `title="Switch language"` 提示文字
3. **Settings**: `CONFIG_META` 中 3 个系统配置项的硬编码英文标签/描述
4. **翻译进度页 - AI 服务状态 + Provider 配置**: `BlogTranslationProgress.tsx` 中 `AiServiceStatusCard` 和 `ProviderSelector` 的大量硬编码英文标签

---

## Step 1: Sidebar.tsx

**文件**: [`apps/admin-blog/src/components/layout/Sidebar.tsx`](/apps/admin-blog/src/components/layout/Sidebar.tsx)

| 行号 | 当前内容 | 改为 |
|------|---------|------|
| 68 | `'Admin'` | `t('user_fallbackName')` |
| 101 | `Blog Admin` | `{t('app_title')}` |

## Step 2: Header.tsx

**文件**: [`apps/admin-blog/src/components/layout/Header.tsx`](/apps/admin-blog/src/components/layout/Header.tsx)

| 行号 | 当前内容 | 改为 |
|------|---------|------|
| 52 | `title="Switch language"` | `title={t('header_switchLanguage')}` |

## Step 3: SettingsClient.tsx — 重构 CONFIG_META

**文件**: [`apps/admin-blog/src/components/settings/SettingsClient.tsx`](/apps/admin-blog/src/components/settings/SettingsClient.tsx)

删除静态 `CONFIG_META` 对象（`line 25-41`），替换为 `getConfigMeta(key, t)` 函数：

- `blog.translation.defaultSourceLang` → `t('systemConfig.defaultSourceLangLabel')` / `t('systemConfig.defaultSourceLangDesc')` (新建键)
- `blog.translation.sourceLangDetection` → `t('systemConfig.detectionStrategy')` / `t('systemConfig.detectionStrategyDesc')` (键已存在)
- `blog.translation.fallbackChain` → `t('systemConfig.fallbackChain')` / `t('systemConfig.fallbackChainDesc')` (键已存在)

ConfigRow 组件中 `const meta = CONFIG_META[item.key]` → `const meta = getConfigMeta(item.key, t)`

## Step 4: BlogTranslationProgress.tsx — AiServiceStatusCard + ProviderSelector

**文件**: [`apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx`](/apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx)

### 4a: 更新 `t` 函数类型（2 处）

AiServiceStatusCard (line 298) 和 ProviderSelector (line 497) 的 `t` 类型从 `(key: string) => string` 改为 `TFunc`（支持 params）。

### 4b: AiServiceStatusCard — 替换所有硬编码英文

| 行号 | 当前内容 | 改为 |
|------|---------|------|
| 302, 334 | `title="🤖 AI Service Status"` | `title={t('aiService.statusTitle')}` |
| 338 | `'Service Level'` | `t('aiService.serviceLevel')` |
| 348 | `'Health'` | `t('aiService.health')` |
| 358 | `'Healthy'` / `'Unhealthy'` | `t('aiService.healthy')` / `t('aiService.unhealthy')` |
| 366 | `'Circuit Breaker'` | `t('aiService.circuitBreaker')` |
| 373 | `` `OPEN (resets ${...})` `` | `t('aiService.circuitBreakerOpen', { time: ... })` |
| 374 | `'Closed'` | `t('aiService.circuitBreakerClosed')` |
| 383 | `'Total Usage'` | `t('aiService.totalUsage')` |
| 390 | `'Requests'` | `t('aiService.requests')` |
| 396 | `'Tokens'` | `t('aiService.tokens')` |
| 402 | `'Daily Tokens'` | `t('aiService.dailyTokens')` |
| 412 | `'Providers'` | `t('aiService.providers')` |
| 422-423 | `` `${req} req / ${tok}k tok` `` | `t('aiService.reqPerTok', { ... })` |
| 440 | `#{key.index + 1}` | `t('aiService.keyIndex', { index: key.index + 1 })` |
| 449-450 | `` `${used}k / ${limit}k` `` | `t('aiService.keyDaily', { ... })` |
| 454 | `'BLOCKED'` | `t('aiService.blocked')` |
| 472 | `'Rate Limits'` | `t('aiService.rateLimits')` |
| 475-476 | `` `RPM: ${...} \| TPM: ${...} \| TPD: ${...}` `` | `t('aiService.rateLimitsFormat', { ... })` |

### 4c: ProviderSelector — 替换所有硬编码英文

| 行号 | 当前内容 | 改为 |
|------|---------|------|
| 540, 551 | `title="⚙️ AI Provider Config"` | `title={t('aiService.providerConfigTitle')}` |
| 556 | `'Provider'` | `t('aiService.providerLabel')` |
| 563 | `'-- Select Provider --'` | `t('aiService.selectProvider')` |
| 567 | `' (unavailable)'` | `t('aiService.unavailable')` |
| 576 | `'Model'` | `t('aiService.modelLabel')` |
| 584 | `'-- Select Model --'` | `t('aiService.selectModel')` |
| 607 | `'Saving...'` / `'Save Config'` | `t('systemConfig.saving')` / `t('aiService.saveConfig')` |
| 613 | `'Current: {provider} / {model}'` | `t('aiService.currentConfig', { ... })` |

## Step 5: 新增 i18n 键（所有 6 个语言文件）

### 通用键

```json
"app_title": "Blog Admin",
"user_fallbackName": "Admin",
"header_switchLanguage": "Switch language",
```

### systemConfig 新增

```json
"systemConfig.defaultSourceLangLabel": "Default Source Language for Translation",
"systemConfig.defaultSourceLangDesc": "Default source language for AI translation, defaults to Chinese (zh)",
```

### aiService 新段落

```json
"aiService": {
  "statusTitle": "🤖 AI Service Status",
  "serviceLevel": "Service Level",
  "health": "Health",
  "healthy": "Healthy",
  "unhealthy": "Unhealthy",
  "circuitBreaker": "Circuit Breaker",
  "circuitBreakerOpen": "OPEN (resets {time})",
  "circuitBreakerClosed": "Closed",
  "totalUsage": "Total Usage",
  "requests": "Requests",
  "tokens": "Tokens",
  "dailyTokens": "Daily Tokens",
  "providers": "Providers",
  "reqPerTok": "{req} req / {tok}k tok",
  "keyIndex": "#{index}",
  "keyDaily": "{used}k / {limit}k",
  "blocked": "BLOCKED",
  "rateLimits": "Rate Limits",
  "rateLimitsFormat": "RPM: {rpm} | TPM: {tpm} | TPD: {tpd}",
  "providerConfigTitle": "⚙️ AI Provider Config",
  "providerLabel": "Provider",
  "modelLabel": "Model",
  "selectProvider": "-- Select Provider --",
  "selectModel": "-- Select Model --",
  "saveConfig": "Save Config",
  "currentConfig": "Current: {provider} / {model}",
  "unavailable": " (unavailable)"
}
```

## Step 6: 验证

- 运行 `prettier --write` 格式化所有修改文件
- 运行 `npx tsc --noEmit` 验证前端编译
- 运行 `npx tsc --noEmit` 验证后端编译

## 完整的文件清单

| # | 文件 | 改动类型 |
|---|------|---------|
| 1 | `src/components/layout/Sidebar.tsx` | 2 处替换为 t() |
| 2 | `src/components/layout/Header.tsx` | 1 处替换为 t() |
| 3 | `src/components/settings/SettingsClient.tsx` | 重构 CONFIG_META |
| 4 | `src/views/blog/BlogTranslationProgress.tsx` | ~28 处替换为 t() + 类型更新 |
| 5-10 | `src/i18n/en.json` 等 6 个文件 | 新增 ~24 个 i18n 键 |
