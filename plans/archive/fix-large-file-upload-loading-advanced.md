# Large File Upload "一直loading" - Advanced Solution Plan

## Root Cause Analysis

### Current Upload Flow (broken)
```
User selects file → local preview
  → Click Save
    → BlogArticleModal.onSubmitAction()
      → http.upload() → axios POST /v1/admin/upload/image (250MB!)
        → NestJS Multer (memory storage → 250MB in RAM!)
          → uploadToS3 (another hop to R2)
            → enqueue transcode-video job
              → response ✅
```

### 3 Root Causes

| # | Problem | Detail |
|---|---------|--------|
| 1 | **Multer 内存瓶颈** | 250MB 文件完全缓冲在 Node.js heap。2GB 服务器并发上传 = GC 频繁/内存溢出/OOM → 请求永远拿不到 response |
| 2 | **上传发生在保存流程中** | featuredImage 在 `onSubmitAction` 里 `await upload.runAsync()` 串行上传，用户看到保存按钮转圈但不知道进度。`onProgress` 传的是 `undefined` |
| 3 | **还存在一个潜伏 bug** | `UploadService.uploadFile()` [L393](apps/api/src/common/upload/upload.service.ts:393) 判断视频仍用 `file.mimetype.startsWith('video/')`，没加 extension fallback。如果 `application/octet-stream` → 错判为图片 → 入队 `compress-image` 队列 → Sharp 处理视频数据失败 → 任务卡死 |

---

## Solution Options

### 方案A: 预签名URL直传 (Presigned URL Direct Upload) ⭐ 推荐

**原理**: 后端生成 R2 的预签名 PUT URL，浏览器**直接上传到 R2**，彻底绕过后端 Multer。

后端已有 `UploadService.generatePresignedUrl()` (目前给 KYC 模块用)，只需暴露为 API 并扩展。

#### Architecture
```
1. GET /v1/admin/upload/presigned-url?filename=xxx.mp4&type=video/mp4
   ← returns { url (presigned PUT), key, cdnUrl }

2. Browser → PUT {url} + file body → R2 (direct, no backend)
   ← 100% progress tracking via XMLHttpRequest.upload.onprogress

3. POST /v1/admin/upload/confirm { key, articleId? }
   → Backend enqueues transcode-video / compress-image
   ← returns { url }
```

#### File changes required:

**Backend (3 files):**

| File | Change |
|------|--------|
| [`upload.controller.ts`](apps/api/src/common/upload/upload.controller.ts) | Add `POST /presigned-url` and `POST /confirm` endpoints |
| [`upload.service.ts`](apps/api/src/common/upload/upload.service.ts) | Fix L393 `isVideo` check to use extension fallback (same pattern as controller) |
| [`upload.module.ts`](apps/api/src/common/upload/upload.module.ts) | Add `JwtModule` if not already (for auth on new endpoints) |

**Frontend (3-4 files):**

| File | Change |
|------|--------|
| [`http.ts`](apps/admin-blog/src/api/http.ts) | Add `uploadDirect()` method: ① GET presigned URL ② PUT file to R2 ③ POST confirm |
| [`index.ts`](apps/admin-blog/src/api/index.ts) | Add `uploadMediaDirect()` API wrapper |
| [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx) | Replace `upload.runAsync()` with `uploadMediaDirect()` + real progress bar |
| [`RichTextEditor.tsx`](apps/admin-blog/src/components/blog/RichTextEditor.tsx) | Replace `onUploadAction` with `uploadMediaDirect()` for video handler |

**Pros:**
- ✅ **零内存压力** — 文件不经过 Node 进程
- ✅ **快很多** — 直连 R2 CDN 边缘节点
- ✅ **真实进度** — 浏览器原生支持 PUT 进度跟踪
- ✅ **可扩展** — 上传和业务逻辑解耦

**Cons:**
- ❌ 需要新建 2 个 API endpoint (生成 URL + 确认)
- ❌ 前端上传逻辑需要重构

---

### 方案B: Multer磁盘存储 + 分步上传 + 进度条 (最小改动)

不改架构，只修当前流程的痛点。

#### Changes:

1. **Multer memory → disk storage**
   [`upload.controller.ts`](apps/api/src/common/upload/upload.controller.ts):
   ```typescript
   import { diskStorage } from 'multer';
   FileInterceptor('file', {
     storage: diskStorage({ destination: '/tmp/uploads' }),
     limits: { fileSize: MULTER_MAX_FILE_SIZE },
   })
   ```
   `UploadService.uploadFile()`: `file.buffer` → `fs.createReadStream(file.path)` + cleanup

2. **Fix UploadService L393 isVideo check** — add extension fallback

3. **Wire up onProgress in BlogArticleModal**
   [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx): pass a real progress callback + show progress bar in modal

4. **Retry/failure handling** — catch upload errors gracefully instead of hanging

**Pros:**
- ✅ 改动最小 (4-5 处修改)
- ✅ 解决 OOM 风险
- ✅ 用户能看到进度

**Cons:**
- ❌ 仍然双跳 (Browser → NestJS → R2)
- ❌ 上传速度受限于服务器带宽
- ❌ 需要清理临时文件

---

### 方案C: 分片上传 (Chunked Upload) - 不推荐

- S3 Multipart Upload 实现复杂
- R2 对 multipart 的支持有坑
- 对博客场景过度设计

---

## Recommendation

**方案A (预签名直传)** 是最彻底的解法，而且后端已经有一半的代码（`generatePresignedUrl`）。

**方案B** 可以作为短期缓解方案，改动小、见效快。但用户问的是"更高级的解法"，所以方案A更符合预期。

---

## Implementation Plan (方案A)

### Step 1: Backend - Add presigned URL endpoint
- File: [`upload.controller.ts`](apps/api/src/common/upload/upload.controller.ts)
- Add `POST /v1/admin/upload/presigned-url` 
  - Input: `{ fileName, fileType, articleId? }`
  - Calls `uploadService.generatePresignedUrl(userId, fileName, fileType, 'blog')`
  - Returns `{ url, key, cdnUrl }`

### Step 2: Backend - Add confirm endpoint
- File: [`upload.controller.ts`](apps/api/src/common/upload/upload.controller.ts)
- Add `POST /v1/admin/upload/confirm`
  - Input: `{ key, originalName, articleId? }`
  - Determines video vs image via extension
  - Enqueues BullMQ job (transcode-video or compress-image)
  - Returns `{ url }`

### Step 3: Backend - Fix isVideo check in UploadService
- File: [`upload.service.ts`](apps/api/src/common/upload/upload.service.ts:393)
- Change `file.mimetype.startsWith('video/')` to also check extension
```typescript
const VIDEO_EXT = /\.(mp4|avi|mov|mkv|webm)$/i;
const isVideo = file.mimetype.startsWith('video/') || VIDEO_EXT.test(file.originalname);
```

### Step 4: Frontend - Add uploadDirect() to http.ts
- File: [`http.ts`](apps/admin-blog/src/api/http.ts)
- New method: `async uploadDirect(file, onProgress?) → { url }`
  1. `GET /v1/admin/upload/presigned-url?fileName=${file.name}&fileType=${file.type}`
  2. `PUT {presignedUrl}` with file body, track progress via `xhr.upload.onprogress`
  3. `POST /v1/admin/upload/confirm { key }`
  4. Return `cdnUrl`

### Step 5: Frontend - Update BlogArticleModal
- File: [`BlogArticleModal.tsx`](apps/admin-blog/src/views/blog/BlogArticleModal.tsx)
- Replace `upload.runAsync(value, undefined, extraFields)` with new direct upload
- Add progress bar UI in the modal footer

### Step 6: Frontend - Update RichTextEditor video upload
- File: [`RichTextEditor.tsx`](apps/admin-blog/src/components/blog/RichTextEditor.tsx)
- The `onUploadAction` callback (passed from parent) uses `uploadApi.uploadMedia()`
- Update parent to use the new direct upload method
- The progress bar already works via `setUploadProgress(pct)` — just need the new method

### Step 7: Clean up old upload code (optional)
- The Multer-based `POST /v1/admin/upload/image` can be kept for backward compat or removed
