# 分片上传（Chunked Upload）架构设计

> 本文档仅作架构设计参考，不实现。记录了分片上传的逻辑流程、组件设计、难度评估。

---

## 1. 难度评估

| 方案 | 代码量 | 新增文件 | 复杂度 | 核心难点 |
|------|--------|---------|--------|---------|
| 预签名直传 ✅ 已实现 | ~80 行 | 1 DTO + 改 4 文件 | ⭐ 低 | axios 拦截器 |
| 分片上传（方案A：服务端合并） | ~500 行 | 5+ 文件 | ⭐⭐⭐ 高 | 临时存储 + 合并 |
| 分片上传（方案B：R2 Multipart） | ~400 行 | 5+ 文件 | ⭐⭐⭐ 高 | 分片编排 + 超时处理 |

**结论**：分片上传的复杂度是预签名直传的 **5 倍左右**，主要增加在：
- 前端需要切片、并发控制、进度聚合、续传逻辑
- 后端需要 Redis 状态管理、分片编排、临时存储清理
- 两个方案都需要处理大量边界情况（如最后一个分片小于 chunkSize）

---

## 2. 整体架构

### 2.1 方案 B（推荐）：R2 Multipart Upload

最优雅的方案——不经过服务端中转分片，浏览器直接上传每个分片到 R2。

```
浏览器                           NestJS                         Cloudflare R2
  │                                │                                │
  │  POST /upload/chunked/init     │                                │
  │  {fileName, fileType, size}    │                                │
  │ ──────────────────────────────→│                                │
  │                                │  InitiateMultipartUpload       │
  │                                │ ──────────────────────────────→│
  │                                │ ← {UploadId}                   │
  │  ← {uploadId, chunkSize,      │                                │
  │      partPreSignedUrls: []}    │                                │
  │                                │                                │
  │  PUT {partPreSignedUrls[0]}    │                                │
  │  (分片 1, 直接上传到 R2)        │                                │
  │ ───────────────────────────────────────────────────────────────→│
  │  ← {ETag: "xxx"}              │                                │
  │                                │                                │
  │  PUT {partPreSignedUrls[1]}    │                                │
  │  (分片 2)                      │                                │
  │ ───────────────────────────────────────────────────────────────→│
  │  ← {ETag: "xxx"}              │                                │
  │                                │                                │
  │  ...并行上传 N 个分片...       │                                │
  │                                │                                │
  │  POST /upload/chunked/complete │                                │
  │  {uploadId, parts: [{ETag,    │                                │
  │    PartNumber}]}              │                                │
  │ ──────────────────────────────→│                                │
  │                                │  CompleteMultipartUpload       │
  │                                │ ──────────────────────────────→│
  │                                │ ← {Location, Bucket, Key}      │
  │  ← {url, key}                  │                                │
  │                                │                                │
  │  POST /upload/confirm          │                                │
  │  (触发转码，沿用现有逻辑)       │                                │
  │ ──────────────────────────────→│                                │
```

**关键优势**：文件始终不经过应用服务器，零内存消耗。

### 2.2 方案 A（备选）：服务端临时存储 + 合并

如果 R2 不支持 MultipartUpload，退而求其次：

```
浏览器 → 分片上传 → NestJS (磁盘 tmp/) → 合并 Buffer → R2
```

**问题**：合并时仍然需要将整个文件 Buffer 载入内存，等于回到 Multer 的老路。不推荐。

---

## 3. 后端设计

### 3.1 数据模型（Redis）

```typescript
interface ChunkedUploadSession {
  uploadId: string;          // UUID
  userId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  chunkSize: number;         // 5MB
  totalChunks: number;
  status: 'init' | 'uploading' | 'completed' | 'cancelled';
  parts: Array<{             // 已上传的分片信息
    partNumber: number;
    etag: string;
    size: number;
  }>;
  r2UploadId: string;        // R2 MultipartUpload ID
  r2Key: string;             // 最终 R2 对象 Key
  createdAt: Date;
  expiresAt: Date;           // TTL 自动过期
}
```

Redis 使用 `SET upload:chunked:{uploadId}` 存储，TTL=1小时。

### 3.2 新增端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/upload/chunked/init` | 创建上传会话，返回 uploadId + 每个分片的预签名 URL 列表 |
| GET | `/admin/upload/chunked/:uploadId` | 查询已上传分片列表（续传用） |
| POST | `/admin/upload/chunked/:uploadId/complete` | 完成上传，触发 CompleteMultipartUpload |
| DELETE | `/admin/upload/chunked/:uploadId` | 取消上传，中止 MultipartUpload |

### 3.3 核心逻辑

#### `POST /init`

```typescript
async initChunkedUpload(dto: InitChunkedUploadDto, userId: string) {
  const { bucket } = this.getBucketConfig('blog');
  const key = `uploads/blog/${userId}/${uuidv4()}${extname(dto.fileName)}`;

  // 1. 初始化 R2 MultipartUpload
  const multipart = await this.s3Client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: dto.fileType,
  }));

  // 2. 计算分片信息
  const chunkSize = 5 * 1024 * 1024; // 5MB
  const totalChunks = Math.ceil(dto.fileSize / chunkSize);

  // 3. 为每个分片生成预签名 UploadPart URL
  const partPreSignedUrls = await Promise.all(
    Array.from({ length: totalChunks }, (_, i) =>
      getSignedUrl(this.s3Client, new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: multipart.UploadId,
        PartNumber: i + 1,
      }), { expiresIn: 3600 })
    )
  );

  // 4. 保存会话到 Redis
  await this.redis.set(`upload:chunked:${multipart.UploadId}`, {
    uploadId: multipart.UploadId,
    key, totalChunks, chunkSize,
    parts: [], status: 'init',
    expiresAt: Date.now() + 3600_000,
  }, 'EX', 3600);

  return {
    uploadId: multipart.UploadId,
    chunkSize,
    totalChunks,
    partPreSignedUrls,  // 前端直接 PUT 到这些 URL
    key,
  };
}
```

#### `POST /complete`

```typescript
async completeChunkedUpload(uploadId: string, parts: Part[], articleId?: string) {
  const session = await this.redis.get(`upload:chunked:${uploadId}`);

  // 1. 完成 R2 MultipartUpload
  const result = await this.s3Client.send(new CompleteMultipartUploadCommand({
    Bucket: session.bucket,
    Key: session.key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
  }));

  // 2. 清理 Redis 会话
  await this.redis.del(`upload:chunked:${uploadId}`);

  // 3. 触发媒体处理
  if (articleId && isVideo(session.key)) {
    await this.enqueueTranscodeVideo(articleId, session.key);
  }

  return { url: result.Location, key: session.key };
}
```

### 3.4 新增 DTO

```typescript
class InitChunkedUploadDto {
  fileName: string;
  fileType: string;
  fileSize: number;
  articleId?: string;
}

class CompleteChunkedUploadDto {
  uploadId: string;
  parts: Array<{
    partNumber: number;
    etag: string;
  }>;
  articleId?: string;
}
```

### 3.5 新增文件

| 文件 | 作用 |
|------|------|
| `apps/api/src/common/upload/dto/chunked-upload.dto.ts` | Init + Complete DTO |
| `apps/api/src/common/upload/chunked-upload.service.ts` | 核心逻辑（init/complete/abort/status） |
| 改 `upload.controller.ts` | 注册 4 个新端点 |
| 改 `upload.module.ts` | 注入 Redis |

---

## 4. 前端设计

### 4.1 `FileChunkedUploader` 工具类

```typescript
class FileChunkedUploader {
  private uploadId: string;
  private chunkSize: number;
  private totalChunks: number;
  private partPreSignedUrls: string[];
  private uploadedParts: Map<number, { etag: string }>;
  private activeUploads: Map<number, XMLHttpRequest>;

  async start(file: File) {
    // 1. Init 获取 uploadId 和预签名 URL 列表
    const session = await http.post('/upload/chunked/init', {
      fileName: file.name, fileType: file.type, fileSize: file.size
    });
    this.uploadId = session.uploadId;
    this.partPreSignedUrls = session.partPreSignedUrls;
    this.totalChunks = session.totalChunks;
    this.chunkSize = session.chunkSize;

    // 2. 检查是否有已上传的分片（续传）
    const uploaded = await http.get(`/upload/chunked/${this.uploadId}`);
    this.uploadedParts = new Map(uploaded.parts.map(p => [p.partNumber, p]));

    // 3. 并行上传未完成的分片
    await this.uploadPendingChunks(file);
  }

  private async uploadPendingChunks(file: File) {
    const concurrency = 3; // 同时上传 3 个分片
    const pending = this.getPendingChunks();

    // 限流并发
    for (let i = 0; i < pending.length; i += concurrency) {
      const batch = pending.slice(i, i + concurrency);
      await Promise.all(batch.map(chunk => this.uploadSingleChunk(file, chunk)));
    }
  }

  private uploadSingleChunk(file: File, partNumber: number): Promise<void> {
    const start = (partNumber - 1) * this.chunkSize;
    const end = Math.min(start + this.chunkSize, file.size);
    const blob = file.slice(start, end);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', this.partPreSignedUrls[partNumber - 1]);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = (e) => {
        // 分片级进度 → 聚合为整体进度
        this.reportProgress();
      };

      xhr.onload = () => {
        const etag = xhr.getResponseHeader('ETag');
        this.uploadedParts.set(partNumber, { etag });
        resolve();
      };

      xhr.onerror = reject;
      xhr.send(blob);
    });
  }

  async complete(articleId?: string) {
    const parts = [...this.uploadedParts.entries()]
      .map(([partNumber, { etag }]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);

    return http.post('/upload/chunked/complete', {
      uploadId: this.uploadId, parts, articleId
    });
  }

  async abort() {
    await http.delete(`/upload/chunked/${this.uploadId}`);
  }
}
```

### 4.2 进度聚合

```typescript
public getProgress(): number {
  const completedBytes = this.uploadedParts.size * this.chunkSize;
  return Math.round((completedBytes * 100) / this.fileSize);
}
```

---

## 5. 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| 最后一个分片 < chunkSize | `file.slice()` 自然处理，服务端无需特殊逻辑 |
| 分片上传顺序乱序 | R2 Multipart 不要求顺序，Complete 时按 PartNumber 排序即可 |
| 上传中途断网 | 前端查询已上传分片，跳过已完成的，重传失败的 |
| 分片上传到错误 URL | 不会发生——前端只持有分配的预签名 URL |
| 会话过期（超过 1 小时） | Redis TTL 自动清理，前端检测到 404 后重新 init |
| 用户取消上传 | 前端调用 abort → R2 AbortMultipartUpload → 清理 |

---

## 6. 与预签名直传对比

| 维度 | 预签名直传（已实现） | 分片上传（本文档） |
|------|--------------------|-------------------|
| **总量代码** | ~80 行 | ~400 行 |
| **新增后端文件** | 1 DTO | 1 DTO + 1 Service |
| **新增前端文件** | 0（改 http.ts） | 1 工具类 FileChunkedUploader |
| **Redis 依赖** | 不需要 | 需要 |
| **R2 API** | PutObject | CreateMultipartUpload + UploadPart + CompleteMultipartUpload |
| **断点续传** | ❌ | ✅ |
| **并发加速** | ❌ 单线程上传 | ✅ 3-5 个分片并行 |
| **进度精度** | 文件级 | 分片级（略粗糙，但可接受） |
| **服务器内存** | 0 | 0 ✅（R2 Multipart 方案） |
| **实现风险** | 低 | 中（R2 对 MultipartUpload 的兼容性需验证） |

---

## 7. 什么时候值得做？

分片上传的断点续传 + 并发加速优势，在以下场景才真正值得付出复杂度：

1. **移动端 App 弱网环境**——用户在地铁/电梯里上传，随时可能断连
2. **超大文件** > 1GB——重传成本高，分片自动续传体验好很多
3. **UGC 平台**——上传体验直接影响用户留存率 vs 管理后台内部工具

如果这些条件都不满足，**预签名直传已经够用**。
