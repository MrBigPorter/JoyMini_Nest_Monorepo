---
title: 'API 文件上传体系 — Cloudflare R2 S3 + BullMQ 媒体处理管道'
slug: file-upload-cloudflare-r2-media-processing
description: JoyMini API 的文件上传体系基于 Cloudflare R2 S3 对象存储和 BullMQ 异步队列，涵盖图片压缩（Sharp）、视频 HLS 转码（FFmpeg）和 BlurHash 生成的完整媒体处理管道。
tags:
  - NestJS
  - File Upload
  - Cloudflare R2
  - S3
  - BullMQ
  - Image Processing
  - Video Transcoding
  - TypeScript
---

# API 文件上传体系 — Cloudflare R2 S3 + BullMQ 媒体处理管道

## 一、概述

JoyMini API 的文件上传体系采用 **Cloudflare R2** 作为对象存储，结合 **BullMQ** 异步队列处理图片压缩和视频转码。整个体系分为三层：

```
Admin/Client App
      │
      ▼
┌──────────────────────┐
│   UploadController   │  ← Multer 接收文件 + ParseFilePipe 校验
├──────────────────────┤
│   UploadService      │  ← S3 Client → Cloudflare R2 上传
├──────────────────────┤
│   MediaProcessor     │  ← BullMQ Worker → 图片压缩 / 视频转码 HLS
└──────────────────────┘
      │
      ▼
   Cloudflare R2
```

---

## 二、UploadController — 文件接收层

```typescript
// apps/api/src/common/upload/upload.controller.ts
@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/upload')
export class UploadController {
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async uploadMedia(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new FileTypeValidator({
            fileType: /(jpg|jpeg|png|gif|webp|mp4|avi|mov|mkv|webm)$/i,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadFolderDto,
  ) {
    const isVideo = file.mimetype.startsWith('video/');
    const target = dto.folder ?? (isVideo ? 'videos' : 'images');

    const maxSize = FILE_SIZE_LIMITS[target] ?? 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File too large. Max size for "${target}" is ${maxSize / 1024 / 1024}MB.`,
      );
    }

    return this.uploadService.uploadFile(file, target, dto.articleId);
  }
}
```

**关键设计**：

| 维度 | 实现 |
|------|------|
| 文件大小限制 | 两级：Multer 硬限制 200MB + 模块级配置（图片 20MB / 视频 200MB / 聊天 10MB）|
| 文件类型校验 | `ParseFilePipe` + 正则白名单 |
| 目标目录 | 自动根据 MIME 类型分流（`images` / `videos` / `treasures` / `chat/images`）|
| 认证 | `JwtAuthGuard` 保护上传接口 |

---

## 三、UploadService — S3 上传层

### 3.1 R2 客户端初始化

```typescript
// apps/api/src/common/upload/upload.service.ts
constructor(private configService: ConfigService) {
  const accountId = this.configService.getOrThrow<string>('CF_R2_ACCOUNT_ID');
  const accessKeyId = this.configService.getOrThrow<string>('CF_R2_ACCESS_KEY_ID');
  const secretAccessKey = this.configService.getOrThrow<string>('CF_R2_SECRET_ACCESS_KEY');
  this.publicBucket = this.configService.getOrThrow<string>('R2_BUCKET_PUBLIC', 'mini-shop');
  this.privateBucket = this.configService.getOrThrow<string>('R2_BUCKET_PRIVATE', 'mini-kyc-private');

  this.s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}
```

### 3.2 公私桶隔离

```typescript
private getBucketConfig(module: string) {
  const privateModules = ['kyc', 'finance', 'contract', 'id-card'];
  if (privateModules.includes(module)) {
    return { bucket: this.privateBucket, isPrivate: true };
  }
  return { bucket: this.publicBucket, isPrivate: false };
}
```

**安全策略**：
- **公开桶**：博客图片、商品图 → 直接通过 CDN 访问
- **私有桶**：KYC 证件、财务凭证 → 仅通过签名 URL 访问 + 所有权校验

### 3.3 预签名 URL 上传（客户端直传）

```typescript
async generatePresignedUrl(userId, fileName, fileType, module = 'common') {
  const { bucket, isPrivate } = this.getBucketConfig(module);
  const key = `uploads/${module}/${userId}/${uuidv4()}${ext}`;

  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: fileType });
  const url = await getSignedUrl(this.s3Client, command, { expiresIn: 600 });

  return {
    url,          // PUT 上传链接（10分钟有效）
    key,          // S3 Key
    cdnUrl: isPrivate ? null : `${this.publicDomain}/${key}`,
    isPrivate,
  };
}
```

**客户端直传流程**：
1. App 调用 API 获取预签名 URL
2. App 直接使用 PUT 方法上传文件到 R2
3. 无需经过 API 服务器中转 → 减少服务器负载和带宽

### 3.4 所有权校验

```typescript
private assertOwnedKey(key: string, module: string, userId: string) {
  const normalized = (key || '').replace(/^\/+/, '');
  const allowedPrefixes = [`uploads/${module}/${userId}/`];
  const ok = allowedPrefixes.some((p) => normalized.startsWith(p));
  if (!ok) throw new ConflictException('File key not owned by current user');
}
```

确保用户只能访问自己上传的文件，防止越权读取他人敏感文件。

---

## 四、BullMQ 媒体处理管道

### 4.1 架构

```
UploadController
  │ 上传完成
  ▼
UploadService.uploadFile()
  │ 将任务加入 BullMQ 队列
  ▼
MEDIA_PROCESSOR_QUEUE (BullMQ)
  │
  ├── Job: compress-image
  │   └── MediaProcessor.handleCompressImage()
  │       ├── R2 HeadObject → 检查文件大小（超过50MB跳过）
  │       ├── R2 GetObject → 下载原始文件
  │       ├── MediaProcessorService.compressImage() → 生成变体
  │       └── R2 PutObject → 上传压缩版 + Prisma 更新 meta
  │
  └── Job: transcode-video
      └── MediaProcessor.handleTranscodeVideo()
          ├── R2 HeadObject → 检查文件大小（超过500MB跳过）
          ├── R2 GetObject → 下载原始视频
          ├── MediaProcessorService.transcodeVideoToHls() → HLS 转码
          ├── MediaProcessorService.extractVideoThumbnail() → 提取封面
          └── R2 PutObject → 上传 HLS 分片 + Prisma 更新 meta
```

### 4.2 MediaProcessor — BullMQ Worker

```typescript
// apps/api/src/common/media/media.processor.ts
@Processor(MEDIA_PROCESSOR_QUEUE, { concurrency: 2 })
export class MediaProcessor extends WorkerHost {
  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'compress-image':
        return this.handleCompressImage(job);
      case 'transcode-video':
        return this.handleTranscodeVideo(job);
    }
  }

  private async handleCompressImage(job: Job<CompressImageJobData>) {
    // 1. 文件大小预检（避免下载超大文件导致 OOM）
    const sizeOk = await this.checkFileSize(imageKey, 50 * 1024 * 1024, 'compress-image');
    if (!sizeOk) return;

    // 2. 从 R2 下载原始文件
    const buffer = await this.uploadService.getFileBuffer(imageKey, 'blog', articleId);

    // 3. 压缩并生成变体
    const variants = await this.mediaProcessorService.compressImage(buffer, articleId, imageKey);

    // 4. 更新文章 meta 字段
    await this.prisma.blogArticle.update({
      where: { id: articleId },
      data: { meta: { ...existingMeta, images: variants } },
    });
  }
}
```

**并发控制**：`concurrency: 2` — 同时最多处理 2 个任务，避免 CPU / 内存过载。

### 4.3 视频处理生命周期

```
上传完成 → meta.video.status = 'pending'
         → 加入队列 → meta.video.status = 'processing'
         → 转码完成 → meta.video.status = 'completed' + HLS URL + poster
         → 转码失败 → meta.video.status = 'failed'
```

前端通过轮询 `meta.video.status` 展示进度条：

```typescript
// 上传时立即设置 pending 状态
this.prisma.blogArticle.update({
  where: { id: articleId },
  data: { meta: { ...existingMeta, video: { status: 'pending' } } },
});
```

### 4.4 事件监听

```typescript
@OnWorkerEvent('completed')
onCompleted(job: Job) {
  this.logger.log(`Job ${job.id} of type ${job.name} completed.`);
}

@OnWorkerEvent('failed')
onFailed(job: Job, error: Error) {
  this.logger.error(
    `Job ${job.id} of type ${job.name} failed (attempt ${job.attemptsMade}): ${error.message}`,
  );
}
```

---

## 五、队列监控系统

[`QueueMonitorService`](apps/api/src/common/queue/queue-monitor.service.ts) 提供完整的队列监控能力：

```typescript
// 三个队列
private readonly queueNames = ['blog-ai', 'avatar', 'group_settlement'];

async getQueueStats(): Promise<QueueMonitoringResponse> {
  return {
    queues: [{ name, waiting, active, completed, failed, delayed, total }],
    jobStats: { 'blog-ai': [...], 'avatar': [...], 'group_settlement': [...] },
    system: { redisConnected, uptime, memoryUsage },
  };
}
```

**监控指标**：
| 指标 | 说明 |
|------|------|
| `waiting` | 等待处理的任务数 |
| `active` | 正在处理的任务数 |
| `completed/failed` | 已完成/失败的历史总数 |
| `avgProcessingTime` | 平均处理耗时 |
| `rateLimit` | blog-ai 队列的 Google API 配额（15 RPM）|

---

## 六、与上下层的配合

### 上传 → 数据库

上传完成后，UploadService 返回 `{ key, url }`，Controller 将其存入对应业务表的字段中（如 `blog_article.coverImage`）。

### 私有文件访问

```typescript
async getDownloadUrl(key: string, module: string, userId?: string) {
  if (!key) return null;
  // 公开桶 → 直接 CDN URL
  if (!isPrivate) return `${this.publicDomain}/${normalized}`;

  // 私有桶 → 签名 URL（5分钟有效）
  if (userId) this.assertOwnedKey(normalized, module, userId);
  return await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
}
```

### 与 admin-next 的 HttpClient 对比

| 维度 | API (NestJS) | admin-next (Next.js) |
|------|-------------|---------------------|
| 存储后端 | Cloudflare R2 (S3 兼容) | Cloudflare R2 |
| 上传方式 | Multer 接收 / 预签名 URL | HttpClient.upload() |
| 异步处理 | BullMQ Worker | — |
| 文件校验 | `ParseFilePipe` + `FileTypeValidator` | — |
| 私有文件 | 签名 URL + 所有权校验 | — |
| 压缩管道 | Sharp (服务端) | — |
| 视频转码 | FFmpeg → HLS | — |

---

## 七、最佳实践

1. **预签名 URL 减少服务器负载**：大文件通过客户端直传 R2，不经过 API 服务器
2. **文件大小预检**：Worker 使用 `HeadObject` 先检查大小，再决定是否下载处理，避免 OOM
3. **公私桶隔离**：敏感文件（KYC、财务）存在私有桶，通过临时签名 URL 访问
4. **视频状态机**：`pending → processing → completed/failed`，前端可实时展示处理进度
5. **队列监控**：内置 `QueueMonitorService` 提供运维 API，可查看队列积压情况
