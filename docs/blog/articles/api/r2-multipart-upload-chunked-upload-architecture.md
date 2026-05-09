---
title: 大文件分片上传架构设计：R2 Multipart Upload 从方案到实现
slug: r2-multipart-upload-chunked-upload-architecture
tags: R2, Multipart Upload, File Upload, Architecture, Cloudflare, NestJS, S3
description: 本文深入分析了 R2 Multipart Upload 分片上传的技术方案选型、后端架构设计（Redis 会话管理 + 预签名分片 URL）、前端 FileChunkedUploader 工具类实现，以及与已有预签名直传方案的对比。
---

# 大文件分片上传架构设计：R2 Multipart Upload 从方案到实现

## 一、背景

我们的博客系统已经实现了[预签名 URL 直传方案](../frontend/presigned-url-direct-upload.md)，解决了 Multer 服务端 OOM 的问题。但预签名直传有一个天然限制：**文件越大，失败重传成本越高**。

在以下场景中，这个限制变得不可接受：

| 场景 | 文件大小 | 问题 |
|------|---------|------|
| 移动端弱网上传 | 100MB+ 视频 | 上传 90% 时断连，整个文件重传 |
| 管理后台批量导入 | 500MB+ CSV/ZIP | 单线程上传速度慢，进度条卡住 |
| UGC 平台用户投稿 | 1GB+ 原始视频 | 重传成本直接影响用户留存率 |

分片上传（Chunked Upload）正是为解决这些问题而生：将大文件切成小块，并发上传，断点续传。

---

## 二、方案选型

### 2.1 两种方案对比

| 维度 | 方案 A：服务端中转合并 | 方案 B：R2 Multipart Upload |
|------|----------------------|---------------------------|
| **数据流** | 浏览器 → NestJS 磁盘 tmp/ → 合并 Buffer → R2 | 浏览器 → R2（零服务端中转） |
| **服务端内存** | O(n) — 合并时整个文件在内存中 | O(1) — 仅存储元数据 |
| **新增依赖** | 磁盘临时存储 + 定时清理 | Redis（会话状态管理） |
| **复杂度** | ⭐⭐⭐ 高 | ⭐⭐⭐ 中 |
| **R2 API** | PutObject（仅最终上传） | CreateMultipartUpload + UploadPart + CompleteMultipartUpload |

**方案 A 存在一个致命缺陷**：合并分片时仍然需要将整个文件 Buffer 载入内存，等于回到 Multer 的老路，只是把 OOM 风险从"上传时"推迟到"合并时"而已。

**方案 B（推荐）**：R2 原生支持 S3 兼容的 Multipart Upload API，浏览器通过预签名 URL 直接将每个分片上传到 R2，服务端完全不接触文件数据。

### 2.2 最终选择：方案 B — R2 Multipart Upload

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
  │  (沿用已有转码流程)             │                                │
  │ ──────────────────────────────→│                                │
```

**关键优势**：文件数据始终不经过应用服务器，服务端只负责生成预签名 URL 和编排状态，零内存消耗。

---

## 三、后端设计

### 3.1 数据模型（Redis）

上传会话使用 Redis 存储，自动 TTL 过期：

```typescript
interface ChunkedUploadSession {
  uploadId: string;          // UUID, 即 R2 MultipartUpload ID
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
  r2Key: string;             // 最终 R2 对象 Key
  createdAt: Date;
  expiresAt: Date;           // 1 小时后 TTL 自动过期
}
```

使用 `SET upload:chunked:{uploadId}` 写入 Redis，TTL=3600 秒。过期后 R2 侧未完成的 Multipart Upload 需要单独清理（通过 AbortMultipartUpload 或在 R2 控制台手动管理）。

### 3.2 新增端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/upload/chunked/init` | 初始化上传会话，返回 uploadId + 预签名 URL 列表 |
| GET | `/admin/upload/chunked/:uploadId` | 查询已上传分片列表（续传用） |
| POST | `/admin/upload/chunked/:uploadId/complete` | 完成上传，触发 CompleteMultipartUpload |
| DELETE | `/admin/upload/chunked/:uploadId` | 取消上传，中止 MultipartUpload |

### 3.3 核心逻辑：Init

`POST /init` 做了四件事：

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

  // 4. 保存会话到 Redis（TTL=1h）
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
    partPreSignedUrls,
    key,
  };
}
```

设计要点：
- **`getSignedUrl` 生成 UploadPart 预签名 URL**：每个 URL 绑定特定 PartNumber，浏览器不能混用
- **一次性生成全部 URL**：`totalChunks` 在 init 时就确定，预签名 URL 有效期 1 小时
- **Redis 会话**：用于查询已上传分片状态（续传）和过渡期追踪

### 3.4 核心逻辑：Complete

`POST /complete` 完成上传并触发后续流程：

```typescript
async completeChunkedUpload(uploadId: string, parts: Part[], articleId?: string) {
  const session = await this.redis.get(`upload:chunked:${uploadId}`);

  // 1. 完成 R2 MultipartUpload
  const result = await this.s3Client.send(new CompleteMultipartUploadCommand({
    Bucket: session.bucket,
    Key: session.key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
    },
  }));

  // 2. 清理 Redis 会话
  await this.redis.del(`upload:chunked:${uploadId}`);

  // 3. 如果是视频，触发转码
  if (articleId && isVideo(session.key)) {
    await this.enqueueTranscodeVideo(articleId, session.key);
  }

  return { url: result.Location, key: session.key };
}
```

关键的可靠性保障：
- **CompleteMultipartUpload 是幂等的**：如果超时后前端重试，R2 返回相同结果
- **Part 需要按 PartNumber 排序**：R2 要求最终提交的分片列表是有序的
- **Complete 后清理 Redis**：节省存储，会话只在上传过程中有效

### 3.5 新增 DTO

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

### 3.6 新增/修改文件

| 文件 | 作用 |
|------|------|
| `apps/api/src/common/upload/dto/chunked-upload.dto.ts` | **新增** — Init + Complete DTO |
| `apps/api/src/common/upload/chunked-upload.service.ts` | **新增** — 核心逻辑（init/complete/abort/status） |
| `upload.controller.ts` | **修改** — 注册 4 个新端点 |
| `upload.module.ts` | **修改** — 注入 Redis |

---

## 四、前端设计

### 4.1 FileChunkedUploader 工具类

前端封装一个独立的工具类，不依赖 UI 框架，可在 Vue / React / 原生 JS 中复用：

```typescript
class FileChunkedUploader {
  private uploadId: string;
  private chunkSize: number;
  private totalChunks: number;
  private partPreSignedUrls: string[];
  private uploadedParts: Map<number, { etag: string }>;
  private activeUploads: Map<number, XMLHttpRequest>;
  private fileSize: number = 0;

  async start(file: File) {
    this.fileSize = file.size;

    // 1. Init 获取 uploadId 和预签名 URL 列表
    const session = await http.post('/upload/chunked/init', {
      fileName: file.name, fileType: file.type, fileSize: file.size,
    });
    this.uploadId = session.uploadId;
    this.partPreSignedUrls = session.partPreSignedUrls;
    this.totalChunks = session.totalChunks;
    this.chunkSize = session.chunkSize;

    // 2. 检查已上传分片（断点续传）
    const uploaded = await http.get(`/upload/chunked/${this.uploadId}`);
    this.uploadedParts = new Map(
      uploaded.parts.map((p: any) => [p.partNumber, p]),
    );

    // 3. 并行上传未完成的分片
    await this.uploadPendingChunks(file);
  }

  private async uploadPendingChunks(file: File) {
    const concurrency = 3; // 同时上传 3 个分片
    const pending = this.getPendingChunks();

    for (let i = 0; i < pending.length; i += concurrency) {
      const batch = pending.slice(i, i + concurrency);
      await Promise.all(batch.map((chunk) => this.uploadSingleChunk(file, chunk)));
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

      xhr.upload.onprogress = () => this.reportProgress();

      xhr.onload = () => {
        const etag = xhr.getResponseHeader('ETag');
        if (etag) {
          this.uploadedParts.set(partNumber, { etag: etag.replace(/"/g, '') });
        }
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
      uploadId: this.uploadId, parts, articleId,
    });
  }

  async abort() {
    await http.delete(`/upload/chunked/${this.uploadId}`);
  }
}
```

### 4.2 进度聚合

分片级别的精度略粗糙，但可接受：

```typescript
public getProgress(): number {
  const completedBytes = this.uploadedParts.size * this.chunkSize;
  return Math.min(
    Math.round((completedBytes * 100) / this.fileSize),
    99, // 保留 100% 给 complete 阶段
  );
}
```

### 4.3 并发控制策略

使用批量并发（`concurrency = 3`），而非一次性全发，原因：

| 策略 | 优点 | 缺点 |
|------|------|------|
| 全量并发 | 上传速度最快 | 浏览器连接数爆炸、服务器端 pre-sign URL 验证压力大 |
| 串行（1 个） | 最稳定 | 上传速度慢，失去分片意义 |
| **批量并发（3-5 个）** | 速度与稳定性平衡 | 实现略复杂 |

选择 `concurrency = 3` 的原因：
- 浏览器同域名最大并发连接数通常为 6，预留一些给其他请求
- R2 Pre-sign URL 验证是同步操作，过多并发会加重服务端验证压力
- 3 个并发足以填满大多数用户的带宽瓶颈

---

## 五、边界情况处理

| 场景 | 处理方式 |
|------|---------|
| **最后一个分片 < chunkSize** | `file.slice()` 自然处理剩余字节，服务端无需特殊逻辑 |
| **分片上传顺序乱序** | R2 Multipart 不要求分片按序上传，Complete 时按 PartNumber 排序即可 |
| **上传中途断网** | 前端调用 `GET /status` 查询已上传分片 → 跳过已完成的 → 重传失败的 |
| **分片上传到错误的 URL** | 不会发生 — 每个预签名 URL 绑定固定 PartNumber |
| **会话过期（超过 1 小时）** | Redis TTL 自动清理，前端检测到 404 后重新 init |
| **用户取消上传** | 前端调用 abort → R2 AbortMultipartUpload → 清理 Redis 会话 |
| **Complete 请求超时** | CompleteMultipartUpload 是幂等的，前端安全重试 |
| **同一个文件重复上传** | Key 含 UUID，不会覆盖。GC 策略：定期清理未关联任何 article 的对象 |

---

## 六、与预签名直传的对比

我们的博客系统已经实现了[预签名 URL 直传方案](../frontend/presigned-url-direct-upload.md)。分片上传不是替代而是补充——两者面向不同的场景：

| 维度 | 预签名直传（已实现） | R2 分片上传（本文） |
|------|--------------------|-------------------|
| **适用文件大小** | ≤ 100MB | ≥ 100MB |
| **总量代码** | ~80 行 | ~400 行 |
| **后端新增文件** | 1 DTO | 1 DTO + 1 Service |
| **前端新增文件** | 0（改 http.ts） | 1 工具类 FileChunkedUploader |
| **Redis 依赖** | 不需要 | 需要 |
| **R2 API** | PutObject | CreateMultipartUpload + UploadPart + CompleteMultipartUpload |
| **断点续传** | ❌ | ✅ |
| **并发加速** | ❌ 单线程上传 | ✅ 3 个分片并行 |
| **进度精度** | 文件级（精确） | 分片级（略粗糙） |
| **服务端内存** | 0 | 0 ✅ |
| **实现风险** | 低 | 中（R2 对 MultipartUpload 的兼容性需验证） |

### 6.1 何时使用预签名直传？

- 文件 < 100MB
- 用户网络稳定（管理后台内网）
- 上传体验不是核心指标

### 6.2 何时使用分片上传？

- 文件 > 100MB
- 移动端 / 弱网环境
- UGC 平台（上传体验直接影响留存率）
- 需要断点续传的场景

---

## 七、实现路线图

### Phase 1：后端核心（3-5 天）

1. 创建 [`chunked-upload.dto.ts`] — Init + Complete DTO
2. 创建 [`chunked-upload.service.ts`] — init / complete / abort / status
3. 修改 [`upload.controller.ts`] — 注册 4 个端点
4. 修改 [`upload.module.ts`] — 注入 Redis
5. 添加 Redis 会话 TTL 自动清理逻辑
6. 添加 R2 AbortMultipartUpload 手动清理逻辑（Redis 过期后的兜底 GC）

### Phase 2：前端集成（2-3 天）

1. 创建 `FileChunkedUploader` 工具类
2. 集成到文件上传组件：文件 > 100MB 自动切换为分片模式
3. 添加上传进度 UI（分片级聚合 → 整体百分比）
4. 添加断网续传提示
5. 添加取消上传按钮

### Phase 3：测试与验证（2 天）

1. 单元测试：分片切割、并发控制、进度聚合
2. 集成测试：R2 MultipartUpload 完整生命周期
3. 手动测试：弱网模拟、断网续传、多文件并发
4. 边界测试：正好 100MB、超大文件 2GB、空文件

### 风险点

- **R2 的 MultipartUpload 兼容性**：Cloudflare R2 自称兼容 S3 API，但 `UploadPart` 预签名 URL 的行为可能与 AWS S3 有细微差异，需要在开发前验证
- **ETag 格式**：R2 返回的 ETag 可能带引号（`"abc123"`），Complete 时需去掉引号
- **跨域**：R2 需要配置 CORS 允许来自前端域名 PUT 请求

---

## 八、总结

分片上传是一个经典的"投入产出比"决策：

- **方案选型**：R2 Multipart Upload（方案 B）比服务端中转（方案 A）优雅得多，数据始终不经过应用服务器
- **后端职责**：只做三件事——生成预签名 URL、管理 Redis 会话、编排 CompleteMultipartUpload
- **前端职责**：分片切割 + 并发控制 + 进度聚合 + 断点续传 + 取消/重试
- **边界情况**：最后一个分片处理、乱序提交、会话过期、Complete 幂等重试
- **使用场景**：文件 > 100MB 或弱网环境，否则预签名直传已经够用

核心教训是：**不要为了让系统"看起来高级"而引入分片上传**。1GB 文件一年上传不了几次，不值得为此付出 5 倍的代码复杂度。但如果是 UGC 平台每天有数千个大文件上传，那分片上传就是必要的投入。
