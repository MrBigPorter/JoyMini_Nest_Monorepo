---
title: '全栈文件上传管道 — API UploadService → Flutter GlobalUploadService → admin-next'
description: 'NestJS UploadService（Cloudflare R2 双桶策略）→ Flutter GlobalUploadService（预签名 URL 直传、魔数 MIME 矫正、压缩管道）→ admin-next HttpClient.upload（媒体上传与 CDN 处理）'
slug: full-stack-file-upload
tags: Upload, S3, R2, Cloudflare, File, Media, Pipeline
---

# 全栈文件上传管道 — API UploadService → Flutter GlobalUploadService → admin-next

## 1. 背景

在社交电商应用中，文件上传几乎无处不在——商品图片、KYC 身份证件、头像、聊天附件、博客媒体等。如果没有统一的上传服务，每个功能各自实现上传逻辑，会导致碎片化、安全漏洞和性能浪费。

本项目的上传管道横跨三个平台：

| 平台 | 角色 | 技术选型 |
|------|------|---------|
| **API (NestJS)** | 后端上传中枢 | Cloudflare R2 (S3 兼容)、BullMQ 媒体处理队列、预签名 URL 签发 |
| **Flutter** | 移动端上传客户端 | GlobalUploadService（压缩、MIME 矫正、队列、分片） |
| **admin-next** | 管理后台上传客户端 | HttpClient.upload（Axios multipart）、CDN 工具函数 |

本篇文章以 **文件传输路径** 为主线，追踪一个文件从移动端/后台选择 → 压缩 → 直传 S3 → CDN 分发的完整生命周期。

---

## 2. 架构概览

```
                        Cloudflare R2
                     ┌──────────────────┐
                     │  Public Bucket    │  ← mini-shop (images, avatars, chat)
                     │  (mini-shop)      │
                     │  ┌──────────────┐ │
                     │  │ CDN Edge     │ │  ← img.joyminis.com
                     │  │ (Cloudflare  │ │
                     │  │  Image Resize)│ │
                     │  └──────────────┘ │
                     │                  │
                     │  Private Bucket  │  ← mini-kyc-private (KYC, finance, contract)
                     │  (mini-kyc-      │
                     │   private)       │
                     └──────────────────┘
                           ▲        ▲
                           │        │
              ┌────────────┘        └────────────┐
              │                                   │
     ┌────────┴────────┐                ┌────────┴────────┐
     │  Flutter App    │                │  admin-next     │
     │                 │                │                 │
     │ GlobalUpload    │                │ HttpClient      │
     │  Service        │                │  .upload()      │
     │                 │                │                 │
     │ 1. PresignedURL │                │ 1. Multipart    │
     │ 2. MIME detect  │                │ 2. Progress     │
     │ 3. Compress     │                │ 3. ExtraFields  │
     │ 4. Queue+Retry  │                │                 │
     │ 5. Direct→S3    │                │ 4. Server→S3    │
     └────────┬────────┘                └────────┬────────┘
              │                                   │
              │  POST /chat/upload-token          │  POST /admin/upload/image
              │  (presigned URL only)              │  (server-side upload)
              │                                   │
              └──────────────┬────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  API (NestJS)   │
                    │                 │
                    │ UploadService   │
                    │  ├─ generatePresignedUrl()
                    │  ├─ getDownloadUrl()
                    │  ├─ getFileBuffer()
                    │  ├─ uploadBuffer()
                    │  └─ uploadFile()
                    │                 │
                    │ BullMQ Queue    │
                    │  ├─ compress-image
                    │  └─ transcode-video
                    └─────────────────┘
```

**两条上传路径：**

1. **Flutter 客户端直传** → 调用 API 获取预签名 URL（文件不经过服务器）→ 直接 PUT 到 Cloudflare R2
2. **admin-next 服务器中转** → 文件通过 HTTP multipart POST 到 API → 由 UploadService 转发到 R2

---

## 3. API 核心：UploadService

[`UploadService`](apps/api/src/common/upload/upload.service.ts:27) 是整个上传管道的中枢，封装了所有与 Cloudflare R2 的交互。

### 3.1 S3 客户端初始化

```typescript
// apps/api/src/common/upload/upload.service.ts
@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;
  private readonly publicBucket: string;   // mini-shop
  private readonly privateBucket: string;  // mini-kyc-private
  private readonly publicDomain: string;   // img.joyminis.com

  constructor(
    private configService: ConfigService,
    @InjectQueue(MEDIA_PROCESSOR_QUEUE)
    private readonly mediaProcessorQueue: Queue,
    private readonly prisma: PrismaService,
  ) {
    const accountId = this.configService.getOrThrow<string>('CF_R2_ACCOUNT_ID');
    const accessKeyId = this.configService.getOrThrow<string>('CF_R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.getOrThrow<string>('CF_R2_SECRET_ACCESS_KEY');
    this.publicBucket = this.configService.getOrThrow<string>('R2_BUCKET_PUBLIC', 'mini-shop');
    this.privateBucket = this.configService.getOrThrow<string>('R2_BUCKET_PRIVATE', 'mini-kyc-private');
    this.publicDomain = this.configService.getOrThrow<string>('CF_R2_PUBLIC_DOMAIN');

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
}
```

关键设计点：

- **双桶策略**：`mini-shop`（公开）和 `mini-kyc-private`（私有），通过 [`getBucketConfig()`](apps/api/src/common/upload/upload.service.ts:130) 按模块路由
- **路径格式**：`uploads/${module}/${userId}/${uuid}.ext`
- **私有模块**：`kyc`、`finance`、`contract`、`id-card` → 私有桶，需要签名才能访问
- **公开模块**：其他（`chat`、`blog`、`avatar`、`treasures` 等）→ 公开桶，直接 CDN 拼接

### 3.2 双桶路由策略

```typescript
// apps/api/src/common/upload/upload.service.ts:130
private getBucketConfig(module: string) {
  const privateModules = ['kyc', 'finance', 'contract', 'id-card'];
  if (privateModules.includes(module)) {
    return { bucket: this.privateBucket, isPrivate: true };
  }
  return { bucket: this.publicBucket, isPrivate: false };
}
```

| 模块 | 桶 | 访问方式 | 用途 |
|------|----|---------|------|
| `kyc` | mini-kyc-private | 签名 URL (5min) | KYC 身份证件、活体照片 |
| `finance` | mini-kyc-private | 签名 URL (5min) | 财务凭证 |
| `contract` | mini-kyc-private | 签名 URL (5min) | 用户合同 |
| `id-card` | mini-kyc-private | 签名 URL (5min) | 身份证件备份 |
| `chat` | mini-shop | CDN 直连 | 聊天图片/视频 |
| `blog` | mini-shop | CDN 直连 | 文章图片/视频 |
| `avatar` | mini-shop | CDN 直连 | 用户/群组头像 |
| `treasures` | mini-shop | CDN 直连 | 商品图片 |

### 3.3 预签名 URL 生成

[`generatePresignedUrl()`](apps/api/src/common/upload/upload.service.ts:174) 返回一个服务端签名的临时上传链接，客户端可以直接 PUT 文件到 R2，**不经过应用服务器**。

```typescript
async generatePresignedUrl(
  userId: string,
  fileName: string,
  fileType: string,
  module: string = 'common',
) {
  const { bucket, isPrivate } = this.getBucketConfig(module);

  // 后缀名兜底：从 mimeType 推断
  let fileExt = extname(fileName);
  if (!fileExt && fileType) {
    const ext = mime.extension(fileType);
    if (ext) fileExt = `.${ext}`;
  }
  const uniqueFileName = `${uuidv4()}${fileExt}`;
  const key = `uploads/${module}/${userId}/${uniqueFileName}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: fileType,
  });

  const url = await getSignedUrl(this.s3Client, command, { expiresIn: 600 });

  let publicUrl = null;
  if (!isPrivate) {
    // 公开模块 → 直接拼接永久 CDN 链接
    publicUrl = `${this.publicDomain}/${key}`;
  }

  return { url, key, cdnUrl: publicUrl, isPrivate };
}
```

**安全设计：**

| 机制 | 说明 |
|------|------|
| **URL 有效期** | 上传 URL 10 分钟过期，下载 URL 5 分钟过期 |
| **文件归属验证** | [`assertOwnedKey()`](apps/api/src/common/upload/upload.service.ts:80) — 强制校验 key 格式为 `uploads/${module}/${userId}/` |
| **S3 服务端加密** | `uploadBuffer()` 默认启用 AES256 加密（仅私有桶） |
| **模块隔离** | 公私桶分离，敏感数据不暴露于公开 CDN |

### 3.4 下载 URL 生成

[`getDownloadUrl()`](apps/api/src/common/upload/upload.service.ts:231) 用于生成查看/下载链接：

```typescript
async getDownloadUrl(key: string, module: string = 'common', userId?: string) {
  if (!key) return null;
  if (key.startsWith('http')) return key;  // 兼容旧数据

  const { bucket, isPrivate } = this.getBucketConfig(module);

  if (!isPrivate) {
    // 公开桶 → 直接返回 CDN 链接（永久有效）
    return `${this.publicDomain.replace(/\/$/, '')}/${normalized}`;
  }

  // 私有桶 → 验证归属 → 生成临时签名
  if (userId) this.assertOwnedKey(normalized, module, userId);
  return await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
}
```

### 3.5 服务端上传

[`uploadFile()`](apps/api/src/common/upload/upload.service.ts:373) 是 admin-next 使用的服务端中转上传方式：

```typescript
async uploadFile(file: Express.Multer.File, folder: string = 'treasures', articleId?: string) {
  const fileExt = extname(file.originalname);
  const key = `${folder}/${uuidv4()}${fileExt}`;

  const result = await this.internalPutToS3(file.buffer, key, this.publicBucket, file.mimetype, false);
  const url = `${this.publicDomain.replace(/\/$/, '')}/${key}`;

  // 如果提供 articleId，入队媒体处理任务
  if (articleId) {
    const isVideo = file.mimetype.startsWith('video/');
    const jobName = isVideo ? 'transcode-video' : 'compress-image';
    // ... 设置 meta.video.status = 'pending' ...
    this.mediaProcessorQueue.add(jobName, { articleId, imageKey: key, videoKey: key, mimeType: file.mimetype });
  }

  return { ...result, url, originalName: file.originalname };
}
```

### 3.6 获取文件 Buffer

[`getFileBuffer()`](apps/api/src/common/upload/upload.service.ts:279) 从 S3 下载文件内容，用于服务端处理：

```typescript
async getFileBuffer(key: string, module: string = 'kyc', userId: string): Promise<Buffer> {
  const { bucket, isPrivate } = this.getBucketConfig(module);
  if (isPrivate) this.assertOwnedKey(normalized, module, userId);

  const data = await this.s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const byteArray = await data.Body!.transformToByteArray();
  return Buffer.from(byteArray);
}
```

---

## 4. API 上传控制器

[`UploadController`](apps/api/src/common/upload/upload.controller.ts:42) 提供 admin-next 使用的上传端点：

### `POST /admin/upload/image`

```typescript
@Post('image')
@UseGuards(JwtAuthGuard)
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
async uploadMedia(
  @UploadedFile(new ParseFilePipe({ validators: [new FileTypeValidator({
    fileType: /(jpg|jpeg|png|gif|webp|mp4|avi|mov|mkv|webm)$/i,
  })]}))
  file: Express.Multer.File,
  @Body() dto: UploadFolderDto,
) {
  const isVideo = file.mimetype.startsWith('video/');
  const target = dto.folder ?? (isVideo ? 'videos' : 'images');

  // 文件夹级文件大小限制
  const maxSize = FILE_SIZE_LIMITS[target] ?? FILE_SIZE_LIMITS.treasures;
  if (file.size > maxSize) throw new BadRequestException(...);

  return this.uploadService.uploadFile(file, target, dto.articleId);
}
```

**文件大小限制**：

| 目标文件夹 | 最大大小 |
|-----------|---------|
| `images` | 20MB |
| `videos` | 200MB |
| `treasures` | 5MB |
| `chat/images` | 10MB |
| Multer 硬限制 | 200MB |

---

## 5. Chat 模块：上传 Token

[`ChatController.getUploadToken()`](apps/api/src/common/chat/chat.controller.ts:254) 提供聊天场景的预签名 URL 生成：

```typescript
@Post('upload-token')
async getUploadToken(@CurrentUserId() userId: string, @Body() body: GetUploadTokenDto) {
  return this.uploadService.generatePresignedUrl(userId, body.fileName, body.fileType, 'chat');
}
```

返回结构：
```json
{
  "url": "https://r2.cloudflarestorage.com/mini-shop/uploads/chat/user_123/uuid.jpg?X-Amz-Signature=...",
  "key": "uploads/chat/user_123/uuid.jpg",
  "cdnUrl": "https://img.joyminis.com/uploads/chat/user_123/uuid.jpg",
  "isPrivate": false
}
```

---

## 6. KYC 模块：服务端上传 + AI 处理

[`KycService.submitKyc()`](apps/api/src/client/kyc/kyc.service.ts:265) 展示了最复杂的上传场景——**并行上传 + AI 处理**：

```typescript
return this.prismaService.$transaction(async (ctx) => {
  // ... 验证 session ...

  // 并行执行：活体比对 + 上传前后面 + 后端接收
  const [verificationResult, frontUploadResult, backUploadResult] =
    await Promise.all([
      // CPU 任务：AWS 活体比对
      this.kycProvider.verifyLivenessAndMatchIdCard(sessionId, ...),
      // IO 任务：上传正面到私有桶
      this.uploadService.uploadBuffer(frontFile.buffer, 'kyc', userId, 'image/jpeg', 'id_front'),
      // IO 任务：上传反面
      backFile ? this.uploadService.uploadBuffer(backFile.buffer, 'kyc', userId, 'image/jpeg', 'id_back') : null,
    ]);

  // ... 上传活体参考图 ...
  this.uploadService.uploadBuffer(imageBuffer, 'kyc', userId, 'image/jpeg', 'liveness');

  // ... 原子提交 ...
});
```

关键模式：**CPU 密集型 AI 任务**（人脸比对）和 **IO 密集型上传任务**（S3 uploadBuffer）通过 `Promise.all` 并行执行，互不阻塞。

---

## 7. KYC 证据查看：签名 URL 生成

[`KycService.transformRecord()`](apps/api/src/admin/kyc/kyc.service.ts:99) 在返回 KYC 记录时并行生成所有证据的签名 URL：

```typescript
const [idCardFrontUrl, idCardBackUrl, faceImage] = await Promise.all([
  record.idCardFront ? this.uploadService.getDownloadUrl(record.idCardFront, 'kyc', record.userId) : null,
  record.idCardBack  ? this.uploadService.getDownloadUrl(record.idCardBack, 'kyc', record.userId) : null,
  record.faceImage   ? this.uploadService.getDownloadUrl(record.faceImage, 'kyc', record.userId) : null,
]);
```

由于 `kyc` 属于私有模块，getDownloadUrl 返回 5 分钟有效的签名 URL，管理员审核时通过 [`KycAuditModal`](apps/admin-next/src/views/kyc/KycAuditModal.tsx:32) 展示。

---

## 8. Flutter 端：GlobalUploadService

[`GlobalUploadService`](docs/blog/articles/flutter/global-upload-service-s3-compression-mime.md) 是 Flutter 移动端的统一上传服务，提供完整的客户端上传管道：

### 8.1 三种上传模式

```dart
class GlobalUploadService {
  static final GlobalUploadService _instance = GlobalUploadService._();
  factory GlobalUploadService() => _instance;
  GlobalUploadService._();

  final UploadQueue _queue = UploadQueue(maxConcurrent: 3);
  final MimeDetector _mimeDetector = MimeDetector();
  final CompressionPipeline _compressionPipeline = CompressionPipeline();

  /// 单文件上传
  Future<UploadResult> upload(UploadRequest request) => _queue.enqueue(() => _performUpload(request));

  /// 多文件上传
  Future<List<UploadResult>> uploadMultiple(List<UploadRequest> requests) => Future.wait(requests.map(upload));

  /// 压缩后上传
  Future<UploadResult> uploadWithCompression(UploadRequest request) async {
    final compressed = await _compressionPipeline.compress(request);
    return upload(compressed);
  }

  /// 批量压缩上传
  Future<List<UploadResult>> uploadMultipleWithCompression(List<UploadRequest> requests) async {
    final compressed = await Future.wait(requests.map((r) => _compressionPipeline.compress(r)));
    return uploadMultiple(compressed);
  }
}
```

### 8.2 上传流程：从 API 预签名到 S3 直传

```dart
Future<UploadResult> _performUpload(UploadRequest request) async {
  // Step 1: 魔数 MIME 检测
  final correctedMime = await _mimeDetector.detect(request.filePath);
  final mimeType = correctedMime ?? request.mimeType ?? 'application/octet-stream';

  // Step 2: 获取预签名 URL（调用 API）
  final presignedUrl = await _fetchPresignedUrl(
    fileName: p.basename(request.filePath),
    mimeType: mimeType,
    module: request.module,
  );

  // Step 3: 直传 S3（不经过 API 服务器）
  final result = await _uploadToS3(
    url: presignedUrl.url,
    filePath: request.filePath,
    mimeType: mimeType,
    onProgress: request.onProgress,
  );

  return UploadResult(
    url: presignedUrl.cdnUrl ?? presignedUrl.url,
    key: presignedUrl.key,
    // ...
  );
}
```

### 8.3 预签名 URL 获取

```dart
Future<PresignedUrlResponse> _fetchPresignedUrl({
  required String fileName,
  required String mimeType,
  required String module,
}) async {
  final response = await http.post(
    Uri.parse('$apiBaseUrl/upload/presigned'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({ 'fileName': fileName, 'mimeType': mimeType, 'module': module }),
  );
  // ...
  return PresignedUrlResponse(
    url: data['url'] as String,        // 临时上传链接
    key: data['key'] as String,        // 存数据库的 Key
    bucket: data['bucket'] as String,
    cdnUrl: data['cdnUrl'] as String?, // 公开模块的永久 CDN 链接
  );
}
```

### 8.4 魔数 MIME 检测

[`MimeDetector`](docs/blog/articles/flutter/global-upload-service-s3-compression-mime.md#6-自动-mime-类型检测与校正) 读取文件头部的签名字节（magic bytes），而非依赖扩展名：

```dart
String? _matchMagicBytes(Uint8List bytes) {
  if (bytes.length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) return 'image/png';
  if (bytes.length >= 12 && bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46) return 'image/webp';
  // ... PDF, MP4, HEIC, GIF ...
}
```

支持的格式：

| 格式 | 魔数 | 正确 MIME |
|------|------|-----------|
| JPEG | `FF D8 FF` | `image/jpeg` |
| PNG | `89 50 4E 47` | `image/png` |
| GIF | `47 49 46 38` / `47 49 46 39` | `image/gif` |
| WebP | `52 49 46 46 ... 57 45 42 50` | `image/webp` |
| PDF | `25 50 44 46` | `application/pdf` |
| MP4 | `... 66 74 79 70` | `video/mp4` |
| HEIC | `... 66 74 79 70 68 65 69 63` | `image/heic` |

### 8.5 压缩管道

[`CompressionPipeline`](docs/blog/articles/flutter/global-upload-service-s3-compression-mime.md#5-上传前压缩管道) 在上传前应用客户端优化：

```
Image Upload Path:
  Original (12MP, 4032×3024, 12MB)
    → Resize to max 2048px (longest dimension)
    → Quality 80%
    → Compressed (~450KB, -96% savings)

Video Upload Path:
  Video file
    → Extract thumbnail (poster frame)
    → Upload thumbnail separately
    → Upload original video
```

### 8.6 上传队列与重试

[`UploadQueue`](docs/blog/articles/flutter/global-upload-service-s3-compression-mime.md#8-上传队列并发限制--重试--取消) 管理并发和重试：

| 特性 | 配置 |
|------|------|
| 最大并发数 | 3 |
| 最大重试次数 | 3 |
| 退避策略 | 指数退避（2s → 4s） |
| 不可重试错误 | 401、403、无效文件 |

### 8.7 大文件分片

对于 > 100MB 的文件（如视频），切换到 Multipart Upload：

```
Client                          Server/S3
  │                              │
  │  1. POST /multipart/init     │
  │  ──────────────────────────> │  CreateUpload
  │  <────────────────────────── │  uploadId
  │                              │
  │  2. PUT {presignedUrl[i]}    │
  │  ──────────────────────────> │  直接上传分片到 S3
  │  <────────────────────────── │  ETag
  │                              │
  │  3. POST /multipart/complete │
  │  ──────────────────────────> │  CompleteUpload
  │  <────────────────────────── │  Final URL
```

---

## 9. admin-next 端：HttpClient.upload

[`HttpClient.upload()`](apps/admin-next/src/api/http.ts:540) 是 admin-next 管理后台的文件上传入口：

```typescript
public async upload<T = any>(
  url: string,
  file: File | FormData,
  onProgress?: (percent: number) => void,
  config?: RequestConfig & { extraFields?: Record<string, string> },
): Promise<T> {
  const formData = file instanceof FormData ? file : new FormData();
  if (file instanceof File) formData.append('file', file);

  // 附加额外字段（如 articleId）
  if (config?.extraFields) {
    for (const [key, value] of Object.entries(config.extraFields)) {
      if (value) formData.append(key, value);
    }
  }

  const res = await this.instance.post<ApiResponse<T>>(url, formData, {
    ...config,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded * 100) / e.total));
      }
    },
  });
  return res.data.data;
}
```

### uploadApi 封装

```typescript
export const uploadApi = {
  uploadMedia: (file: File, onProgress?: (percent: number) => void, extraFields?: Record<string, string>) =>
    http.upload<{ url: string; key: string }>('/v1/admin/upload/image', file, onProgress, { extraFields }),

  uploadMultiple: (files: File[]) => {
    const formData = new FormData();
    files.forEach((file, index) => formData.append(`files[${index}]`, file));
    return http.upload<{ urls: string[] }>('/upload/multiple', formData);
  },
};
```

**和 Flutter 的区别**：admin-next 通过服务器中转上传（文件先到 API 再转发到 R2），而 Flutter 使用预签名 URL 直传。原因是：
- admin-next 上传后可能需要立即触发媒体处理（压缩/转码）
- admin-next 处于内网/高速网络环境，中转开销可接受
- 管理后台文件通常较小（头像、商品图）

---

## 10. admin-next CDN 工具函数

[`media-utils.ts`](apps/admin-next/src/lib/media-utils.ts:1) 提供浏览器端媒体 URL 解析：

```typescript
const IMG_BASE_URL = process.env.NEXT_PUBLIC_IMG_BASE_URL ?? 'https://img.joyminis.com';

// S3 Key → CDN URL
export function resolveMediaUrl(content: string): string {
  if (!content) return '';
  if (content.startsWith('https://') || content.startsWith('http://')) return content;
  if (content.startsWith('uploads/')) return `${IMG_BASE_URL}/${content}`;
  return `${IMG_BASE_URL}/${content.replace(/^\//, '')}`;
}

// CDN URL + Cloudflare Image Resize
export function resolveImageUrl(content: string, width = 240): string {
  const base = resolveMediaUrl(content);
  if (!base || !base.includes('uploads/')) return base;
  const key = base.substring(base.indexOf('uploads/'));
  return `${IMG_BASE_URL}/cdn-cgi/image/width=${width},quality=75,fit=cover,f=auto/${key}`;
}
```

[`resolveMediaUrl()`](apps/admin-next/src/lib/media-utils.ts:8) 将 S3 key 转换为完整 CDN URL，[`resolveImageUrl()`](apps/admin-next/src/lib/media-utils.ts:16) 额外利用 Cloudflare Image Resize 进行服务端图片变换（缩放、质量、格式自适应）。

---

## 11. 媒体处理管道（BullMQ）

当 admin-next 上传博客文章媒体时，[`UploadService.uploadFile()`](apps/api/src/common/upload/upload.service.ts:373) 会入队 BullMQ 任务：

```
User uploads image via admin-next
         │
         ▼
  POST /admin/upload/image
         │
         ▼
  UploadService.uploadFile()
    → 上传原图到 R2
    → 入队 compress-image 任务
         │
         ▼
  MediaProcessor (BullMQ Worker)
    → sharp 处理：生成 WebP (thumbnail/webp, medium/webp, large/webp) + JPG (large/jpg)
    → uploadToPublicBucket() 上传到 R2
    → 更新 BlogArticle.meta

User uploads video via admin-next
         │
         ▼
  UploadService.uploadFile()
    → 上传原视频到 R2
    → 设置 meta.video.status = 'pending'
    → 入队 transcode-video 任务
         │
         ▼
  MediaProcessor (BullMQ Worker)
    → ffmpeg HLS 转码 (360p, 480p, 720p, 1080p)
    → 提取 poster.jpg
    → uploadDirectory() 上传分片到 R2
    → master.m3u8 最后上传（关键顺序）
```

---

## 12. 安全架构总览

| 层级 | 机制 | 覆盖场景 |
|------|------|---------|
| **认证** | `@UseGuards(JwtAuthGuard)` | 所有上传端点 |
| **文件类型验证** | FileTypeValidator regex | admin-next 上传 |
| **文件大小验证** | 文件夹级大小限制 + Multer 硬限制 | admin-next 上传 |
| **MIME 矫正** | 魔数检测（Flutter 端） | 移动端客户端直传 |
| **预签名有效期** | 10min（上传）/ 5min（下载） | 预签名 URL 端点 |
| **Key 归属验证** | `assertOwnedKey()` 检查 `uploads/${module}/${userId}/` | 私有桶读写 |
| **公私桶隔离** | 敏感模块路由到私有桶 | 所有上传 |
| **服务端加密** | AES256（私有桶） | uploadBuffer 私有模块 |
| **分布式锁** | `@DistributedLock`（KYC 提交） | 并发提交保护 |
| **节流** | `@Throttle(1/min)`（KYC session） | 敏感操作限流 |

---

## 13. 跨平台对比

### 上传路径

| 特性 | Flutter (GlobalUploadService) | admin-next (HttpClient.upload) |
|------|------------------------------|-------------------------------|
| 上传方式 | 客户端直传 S3 | 服务器中转 |
| 文件流经服务器 | ❌ 否 | ✅ 是 |
| 压缩 | ✅ 客户端压缩（resize + quality） | ❌ 依赖服务端 BullMQ |
| MIME 检测 | ✅ 魔数检测 | ❌ 依赖扩展名 + FileTypeValidator |
| 并发控制 | ✅ 队列（max 3） | ❌ 浏览器原生限制 |
| 重试 | ✅ 指数退避 × 3 | ❌ Axios retry 可选 |
| 进度追踪 | ✅ Stream<double> | ✅ onUploadProgress |
| 大文件分片 | ✅ > 100MB Multipart Upload | ❌ 单次上传（服务器 200MB 限制） |
| 调用场景 | 商品图片、KYC 证件、聊天附件、头像 | 博客媒体、管理后台图片 |

### 安全对比

| 安全机制 | Flutter 路径 | admin-next 路径 |
|----------|-------------|----------------|
| 上传认证 | POST presigned-url → Bearer Token | multipart → JwtAuthGuard |
| 文件校验 | 客户端魔数 + 服务端生成 URL 时的 mimeType | 服务端 FileTypeValidator + 大小限制 |
| 权限控制 | API 颁发 URL 时控制 module | 直接由 JWT guard 控制 |
| 数据隔离 | S3 桶内按 `module/userId/` 路径隔离 | 同左 |

---

## 14. 与 C1 FCM 推送的架构对比

| 维度 | C1: 端到端推送通知 | C4: 全栈文件上传 |
|------|-------------------|-----------------|
| 数据流向 | API → FCM → Flutter（下行） | Flutter/admin-next → API → R2（上行） |
| 中间件 | Firebase Cloud Messaging | Cloudflare R2 (S3-compatible) |
| 客户端角色 | 接收者（被动） | 发送者（主动） |
| 异步处理 | EventEmitter → PushListener | BullMQ → MediaProcessor |
| 安全焦点 | Device Token 管理、FCM 认证 | 预签名 URL、Key 归属、公私桶隔离 |
| 关键设计 | 推送优先级、预览文本生成 | 魔数 MIME 矫正、客户端压缩、上传队列 |

---

## 15. 总结

全栈文件上传管道是本项目中最关键的通用基础设施之一，覆盖了从客户端选择文件到 CDN 分发的完整生命周期：

| 组件 | 文件 | 核心职责 |
|------|------|---------|
| **API UploadService** | [`apps/api/src/common/upload/upload.service.ts`](apps/api/src/common/upload/upload.service.ts:27) | S3 客户端、双桶路由、预签名 URL、服务端上传、媒体处理入队 |
| **API UploadController** | [`apps/api/src/common/upload/upload.controller.ts`](apps/api/src/common/upload/upload.controller.ts:42) | 文件类型/大小验证、文件夹路由 |
| **Chat Upload Token** | [`apps/api/src/common/chat/chat.controller.ts`](apps/api/src/common/chat/chat.controller.ts:254) | 聊天模块预签名 URL 生成 |
| **KYC Upload** | [`apps/api/src/client/kyc/kyc.service.ts`](apps/api/src/client/kyc/kyc.service.ts:265) | 并行 uploadBuffer + AI 处理 |
| **Admin KYC Evidence** | [`apps/api/src/admin/kyc/kyc.service.ts`](apps/api/src/admin/kyc/kyc.service.ts:99) | 并行 getDownloadUrl 生成签名 URL |
| **Flutter GlobalUploadService** | `JoyMini_Flutter_App/lib/services/global_upload_service.dart` | 客户端直传、魔数 MIME、压缩、队列、分片 |
| **admin-next HttpClient** | [`apps/admin-next/src/api/http.ts`](apps/admin-next/src/api/http.ts:540) | Axios multipart 上传 + 进度 |
| **admin-next uploadApi** | [`apps/admin-next/src/api/index.ts`](apps/admin-next/src/api/index.ts:591) | 上传 API 封装 |
| **admin-next media-utils** | [`apps/admin-next/src/lib/media-utils.ts`](apps/admin-next/src/lib/media-utils.ts:1) | CDN URL 解析 + Cloudflare Image Resize |

### 相关文章

- [端到端推送通知：API FCM → Flutter FCM](./end-to-end-push-notification.md)
- [全栈 KYC 验证：Flutter KycGuard → API Gemini+Rekognition → Admin Audit](./full-stack-kyc-verification.md)
- [全栈认证：API JWT → Flutter AuthNotifier → admin-next Middleware](./full-stack-authentication.md)
- [admin-next UI 组件库：Button、Card、Modal 等 12 个基础组件](./ui-components-library.md)
- [KYC 审核表单系统：KycAuditModal + KycFormModal](./kyc-audit-form-system.md)
