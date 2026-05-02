# Blog Import Page — Per-Article Cover Image Upload

## Blurhash 说明

通过完整调用链路追踪：

### ✅ BlogArticleModal（编辑文章）触发 blurhash

[`BlogArticleModal.tsx:201-205`](../../apps/admin-blog/src/views/blog/BlogArticleModal.tsx:201)：
```typescript
const extraFields = isEditing && editingArticle?.id
  ? { articleId: editingArticle.id }
  : undefined;
const res = await upload.runAsync(value, undefined, extraFields);
```

`articleId` 通过 FormData 传给后端 → [`upload.service.ts:392`](../../apps/api/src/common/upload/upload.service.ts:392) 的 `if (articleId)` → 入队 `compress-image` → `MediaProcessor` 生成 blurhash + WebP/JPEG 变体 → 写入 `article.meta.images`。

### ❌ Create 页面不触发

[`create/page.tsx:71`](../../apps/admin-blog/src/app/(dashboard)/blog/articles/create/page.tsx:71)：`upload.runAsync(value)` 没传 `extraFields`。

### 🔄 导入页面复用模式

先 `batchImportArticles` 创建文章拿到 `articleId`，再 upload 时传 `{ articleId }` → blurhash 自动触发。

## 设计方案：自动检测配对

### 用户操作

用户一次性拖入 `.md` 文件 + 封面图文件，系统自动配对：

```
用户拖入:  [my-article.md, my-article.jpg, another.md, another.png]
              ↓                   ↓           ↓           ↓
processFiles: 解析 md            检测图片    解析 md    检测图片
              └──────┬──────────────┘          └──┬────────┘
                     ▼                            ▼
              my-article (jpg 已配对)      another (png 已配对)
```

### 配对规则

取 `.md` 文件的 stem（不含扩展名），在同批文件中找同名的图片：
- `my-article.md` ↔ `my-article.jpg` / `my-article.png` / `my-article.webp` / `my-article.jpeg`
- 同时支持从 frontmatter 的 `coverImage` 字段提取图片文件名匹配

### 数据流

```mermaid
flowchart TD
    A[用户拖入多文件] --> B[processFiles 分离 .md 和图片]
    B --> C[解析 .md → ScannedArticle[]]
    B --> D[提取图片文件 → Map<stem, File>]
    C --> E[按 stem 配对: 找同名图片]
    D --> E
    E --> F[ScannedArticle.coverImage = File]
    F --> G[用户勾选 + 选分类]
    G --> H[点击导入]
    H --> I[batchImportArticles 创建文章]
    I --> J[拿到 articleId]
    J --> K{有配对封面图?}
    K -->|是| L[uploadApi.uploadMedia file, undefined, articleId]
    L --> M[后端触发 blurhash 生成]
    K -->|否| N[跳过]
    M --> O[完成]
    N --> O
```

## 变更范围（4 个文件）

### 1. [`batch-import.dto.ts`](../../apps/api/src/blog/dto/batch-import.dto.ts:58)
`BatchImportItem` 加 `coverImage?: string`

### 2. [`blog.service.ts`](../../apps/api/src/blog/blog.service.ts:297)
- Create 分支（L361-382）：加 `coverImage: item.coverImage || undefined`
- Update 分支（L316-331）：加 `coverImage: item.coverImage || undefined`
- 跳过分支（L340-347）：加 `articleId: existing.id` 返回已有文章 ID

### 3. [`api/index.ts`](../../apps/admin-blog/src/api/index.ts:124)
`batchImportArticles` payload 加 `coverImage?: string`

### 4. [`import/page.tsx`](../../apps/admin-blog/src/app/(dashboard)/blog/import/page.tsx)
核心改动：

- `ScannedArticle` 加 `coverImage?: File`（存配对的原生 File 对象）
- `processFiles` 改为两遍扫描：
  1. 第一遍：分离 .md 和图片文件，构建 `imageMap: Map<stem, File>`
  2. 第二遍：解析 .md 时用 stem 从 `imageMap` 找配对图片
- 新增 `coverImageUploading: Record<string, boolean>` state 跟踪上传进度
- 文章列表每行显示封面图缩略图（有配对则显示，无则空白）
- 预览面板显示封面图
- `handleImport` 改为两步：
  1. `blogApi.batchImportArticles({...})` → `ImportResult`
  2. 对成功结果中 `coverImage` 存在的 → `uploadApi.uploadMedia(file, undefined, { articleId })`

## Todo 列表

- [ ] 1. 后端 DTO：`BatchImportItem` 加 `coverImage?: string`
- [ ] 2. 后端 Service：create/update/跳过 分支处理 coverImage 和 articleId
- [ ] 3. 前端 API：`batchImportArticles` payload 加 `coverImage?`
- [ ] 4. 前端导入页面：`ScannedArticle` 加 `coverImage?: File`
- [ ] 5. 前端导入页面：`processFiles` 改为两遍扫描（.md + 图片配对）
- [ ] 6. 前端导入页面：添加 `coverImageUploading` state
- [ ] 7. 前端导入页面：文章列表行显示缩略图
- [ ] 8. 前端导入页面：预览面板显示封面图
- [ ] 9. 前端导入页面：`handleImport` 两步流程（先批量导入再逐个上传传 articleId）
- [ ] 10. 验证：前后端 type-check + lint
