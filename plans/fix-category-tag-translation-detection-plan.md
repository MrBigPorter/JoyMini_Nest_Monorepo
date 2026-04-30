# Fix: 分类与标签翻译检测缺失

## 问题

管理员后台的翻译检测页面已经可以统计分类和标签的翻译进度，但无法检测和操作未翻译的分类和标签。

## 根因

| 功能 | 文章 | 分类 | 标签 |
|------|------|------|------|
| 翻译进度统计 | ✅ | ✅ | ✅ |
| 待翻译列表 + 翻译按钮 | ✅ | ❌ | ❌ |
| 翻译问题检测 | ✅ | ❌ | ❌ |
| API 翻译端点 | ✅ | ❌ | ❌ |

## 架构

```mermaid
flowchart LR
    subgraph Backend
        BS[BlogService]
        BC[BlogController]
        CC[CategoryController]
        TC[TagController]
        BS -->|has| TAC[translateArticle]
        BS -->|has| TCC[translateCategory]
        BS -->|has| TTC[translateTag]
        BS -->|has| UTA[getUntranslatedArticles]
        BS -->|MISSING| UTC[getUntranslatedCategories]
        BS -->|MISSING| UTT[getUntranslatedTags]
        BC -->|exposes| TAE[/articles/:id/translate]
        BC -->|exposes| UTAE[/untranslated-articles]
        CC -->|MISSING| CTE[/:id/translate]
        TC -->|MISSING| TTE[/:id/translate]
    end

    subgraph Frontend
        BTP[BlogTranslationProgress.tsx]
        BTI[BlogTranslationIssues.tsx]
        BTP -->|has| AL[Pending Articles list]
        BTP -->|MISSING| CL[Pending Categories list]
        BTP -->|MISSING| TL[Pending Tags list]
        BTI -->|only checks| ART[Article issues]
        BTI -->|MISSING| CAT[Category/Tag issues]
    end

    subgraph AI_Translation
        CAT_P[processCategoryTranslation]
        TAG_P[processTagTranslation]
        CAT_P -->|uses| AIS[aiService.translateText]
        TAG_P -->|uses| AIS
        AIS -->|Prompt protects| TECH[English technical terms]
    end
```

## 实施步骤

### Step 1: BlogService — 新增待翻译查询方法

**文件:** `apps/api/src/blog/blog.service.ts`
- 新增 `getUntranslatedCategories(languageCode: string)` — 使用 raw SQL 查询 `blog_categories` 表中 `name->targetLang IS NULL`
- 新增 `getUntranslatedTags(languageCode: string)` — 类似查询 `blog_tags` 表
- 扩展 `detectTranslationIssues()` 使其同时包含分类和标签

### Step 2: Controller — 新增翻译端点

**文件:** `apps/api/src/blog/blog.controller.ts`
- 新增 `GET untranslated-categories` → 调用 blogService.getUntranslatedCategories
- 新增 `GET untranslated-tags` → 调用 blogService.getUntranslatedTags

**文件:** `apps/api/src/blog/category/category.controller.ts`
- 新增 `POST :id/translate` → 调用 blogService.translateCategory

**文件:** `apps/api/src/blog/tag/tag.controller.ts`
- 新增 `POST :id/translate` → 调用 blogService.translateTag

### Step 3: Admin API 客户端 — 新增方法

**文件:** `apps/admin-blog/src/api/` (找到 translation API 定义文件)
- 新增 `getUntranslatedCategories(languageCode)` 方法
- 新增 `getUntranslatedTags(languageCode)` 方法
- 新增 `translateCategory(id, targetLang)` 方法
- 新增 `translateTag(id, targetLang)` 方法

### Step 4: 翻译进度页面 — 添加待翻译分类/标签区域

**文件:** `apps/admin-blog/src/views/blog/BlogTranslationProgress.tsx`
- 新增 `getUntranslatedCategories()` 和 `getUntranslatedTags()` 请求 hook
- 在"待翻译文章"卡片下方新增两个卡片：
  - "待翻译分类" — 列出未翻译的分类名 + 翻译按钮
  - "待翻译标签" — 列出未翻译的标签名 + 翻译按钮
- 每个分类/标签显示：名称(中文)、slug、创建时间

### Step 5: 翻译问题检测页面 — 扩展

**文件:** `apps/admin-blog/src/views/blog/BlogTranslationIssues.tsx`
- 扩展后端 `detectTranslationIssues()` 返回的分类/标签问题
- 在 UI 中增加分类/标签问题展示区域

### 关于英文专业名词

不需要特殊处理。AI 翻译服务 `translateText()` 的 Prompt 已经包含保护技术术语的规则：
- `{ zh: '系统架构' }` → 翻译为 `{"en": "System Architecture"}`
- `{ zh: 'NestJS' }` → AI 保持为 `{"en": "NestJS"}`
