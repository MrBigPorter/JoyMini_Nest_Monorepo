---
title: 管理后台大文件上传优化：从 Multer OOM 到预签名 URL 直传的踩坑实录
slug: presigned-url-direct-upload
tags: NestJS, Next.js, File Upload, Cloudflare R2, Axios, Performance
---

# 管理后台大文件上传优化：从 Multer OOM 到预签名 URL 直传的踩坑实录

> 本文记录将一个 Next.js 管理后台的文章图片/视频上传从传统的 Multer 服务端中转改造为**浏览器直传 Cloudflare R2** 的全过程，以及在改造中遇到的 3 个坑和修复方案。

---

## 1. 背景：上传大文件一直 loading

管理后台允许管理员在文章编辑器中上传图片和视频。早期设计使用 NestJS 的 Multer 接收文件 → `UploadService.uploadBuffer()` 转发到 R2：

```
浏览器 → POST /upload/image (multipart) → Multer 接收 (内存 Buffer) → UploadService → R2
```

这个模式对于图片（通常 < 5MB）毫无问题，但一旦上传**几百 MB 的视频**，就会暴露两个致命缺陷：

| 问题 | 原因 | 后果 |
|------|------|------|
| **内存爆炸** | Multer 将整个文件读入 Node.js 堆内存 | 250MB 视频在 2GB VPS 上直接 OOM |
| **HTTP 超时** | Nginx 的 `proxy_read_timeout` 默认 60s | 大文件上传中途断连 |
| **无进度反馈** | 服务端上传没有进度回调 | 前端一直显示 "loading" |

用户反馈："上传大文件一直 loading"——实际上不是前端卡住，而是后端在内存中默默挣扎，直到超时或 OOM 崩溃。

---

## 2. 方案设计：三种方案的技术选型

经过分析，有三种可行的改造方向：

### 方案 A：预签名 URL 直传（✅ 最终选择）

```
浏览器 → POST /presigned-url (获取签名链接) → 浏览器 PUT 文件直传到 R2 → POST /confirm (触发媒体处理)
```

**优点：**
- 零服务器内存消耗（文件不经过应用服务器）
- 利用浏览器原生上传能力，支持进度追踪
- 对现有 BullMQ 转码管道无影响

**缺点：**
- 需要改造前端上传流程（3 步代替 1 步）
- 无法在服务端做文件类型校验

### 方案 B：Multer 磁盘存储

将 Multer 从内存存储改为磁盘存储（`multer.diskStorage`），文件先写磁盘再上传。

**优点：** 改动最小
**缺点：** 需要磁盘 I/O，2GB VPS 的磁盘空间同样有限，只是推迟了 OOM

### 方案 C：分片上传（Chunked Upload）

前端将文件切成 5MB 的分片，逐个上传到服务端，服务端再合并。

**优点：** 支持断点续传
**缺点：** 实现复杂，需要分片编排、合并逻辑、进度聚合

**决策**：方案 A（预签名 URL）既有 Flutter 客户端的成功先例（`GlobalUploadService`），改动量适中，且对后端完全无压力，是最优解。

---

## 3. 实现：三步上传流程

改造后的上传流程变为 3 个 REST 调用：

### 3.1 后端：生成预签名 URL

[`UploadService.generatePresignedUrl()`](apps/api/src/common/upload/upload.service.ts:174) 是已有的方法，使用 `@aws-sdk/s3-request-presigner` 签发一个 **10 分钟有效**的 PUT 签名 URL：

```typescript
async generatePresignedUrl(userId: string, fileName: string, fileType: string, module = 'blog') {
  const { bucket } = this.getBucketConfig(module);
  const key = `uploads/${module}/${userId}/${uuidv4()}${extname(fileName)}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: fileType,
  });

  const url = await getSignedUrl(this.s3Client, command, { expiresIn: 600 });

  return { url, key, cdnUrl: `${this.publicDomain}/${key}` };
}
```

新增的 [`POST /admin/upload/presigned-url`](apps/api/src/common/upload/upload.controller.ts:104) 端点直接调用此方法，返回 `{ url, key, cdnUrl }`。

### 3.2 后端：确认上传并触发媒体处理

新增 [`POST /admin/upload/confirm`](apps/api/src/common/upload/upload.controller.ts:124) 端点，浏览器完成直传后调用：

```typescript
async confirmUpload(key: string, originalName: string, articleId?: string, mimeType?: string) {
  // 根据文件扩展名或 MIME 类型判断是否需要处理
  const isVideo = /\.(mp4|avi|mov|mkv|webm)$/i.test(key) || mimeType?.startsWith('video/');

  if (articleId && isVideo) {
    await this.mediaProcessorService.enqueueTranscodeVideo(articleId, key);
  } else if (articleId && this.isImage(key)) {
    await this.mediaProcessorService.enqueueCompressImage(articleId, key);
  }

  return { url: `${this.publicDomain}/${key}`, key };
}
```

### 3.3 前端：三步上传封装

在 [`HttpClient.uploadDirect()`](apps/admin-blog/src/api/http.ts:559) 中封装了完整的三步流程：

```typescript
// Step 1: 获取预签名 URL
const { url: uploadUrl, key } = await this.instance.post('/presigned-url', {
  fileName: file.name, fileType: file.type,
});

// Step 2: PUT 文件直传到 R2
await this.instance.put(uploadUrl, file, {
  headers: { 'Content-Type': file.type },
  onUploadProgress: (e) => { /* 进度回调 */ },
});

// Step 3: 确认上传
await this.instance.post('/confirm', { key, originalName: file.name, articleId });
```

---

## 4. 踩坑记录

改造过程中遇到了三个坑，每一个都值得单独拿出来说。

### 坑 1：axios 拦截器"顺手"破坏了预签名 URL ⚠️

**现象**：Step 1（获取预签名 URL）成功返回，但 Step 2（PUT 直传）返回 **400 Bad Request**。

**排查**：一开始怀疑 AWS SDK 版本问题、R2 兼容性、签名算法差异。直到对比了项目中已有的聊天模块代码才发现端倪：

聊天模块（工作正常）使用**原生 `fetch()`**：
```typescript
await fetch(tokenResult.url, {
  method: 'PUT',
  headers: { 'Content-Type': file.type },
  body: file,
});
```

而我们的新代码使用 axios 实例：

```typescript
await this.instance.put(uploadUrl, file, {
  headers: { 'Content-Type': file.type },
  // ...
});
```

**根因**：检查 [`HttpClient.setupInterceptors()`](apps/admin-blog/src/api/http.ts:93) 发现，请求拦截器给**每个请求**自动加上了：

```typescript
config.headers.Authorization = `Bearer ${token}`;
config.headers['Accept-Language'] = lang;
```

预签名 URL 的签名只包含了 `PUT` 方法和 `Content-Type` 头。当 axios 多送了一个 `Authorization: Bearer xxx` 头时，R2 校验签名发现多出来的 header 不在签名范围内 → **400 Bad Request**。

**修复**：改用原生 `XMLHttpRequest` 做 PUT（既绕过拦截器，又保留上传进度追踪）：

```typescript
await new Promise<void>((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', uploadUrl);
  xhr.setRequestHeader('Content-Type', file.type);

  xhr.upload.onprogress = (e) => {
    if (onProgress && e.lengthComputable) {
      onProgress(Math.round((e.loaded * 100) / e.total));
    }
  };

  xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject();
  xhr.onerror = () => reject(new Error('Upload failed'));
  xhr.send(file);
});
```

**教训**：当预签名 URL 和 axios 拦截器相遇时，拦截器添加的"额外" header 就是签名验证的"毒药"。直传 S3/R2 的场景，务必使用原生 HTTP 客户端。

### 坑 2：`isVideo` 检测只依赖 MIME type 不够

**现象**：某些浏览器（特别是移动端 Safari）上传 `.mp4` 文件时，`file.type` 为 `application/octet-stream`，导致 `file.mimetype.startsWith('video/')` 判断为 false，视频被当作图片处理。

**修复**：增加文件扩展名兜底检测：

```typescript
const VIDEO_EXT = /\.(mp4|avi|mov|mkv|webm)$/i;

const isVideo = mimeType?.startsWith('video/') || VIDEO_EXT.test(key);
```

### 坑 3：`onProgress` 回调链断裂

**现象**：改造前 `onSubmitAction` 传给上传组件的 `onProgress` 回调是 `undefined`，导致进度条完全不显示。

**根因**：组件链中一个中间函数没有透传 `onProgress` 参数。

**修复**：确保回调链完整传递，并用原生 XHR 的 `upload.onprogress` 事件代替 axios 的 `onUploadProgress`。

---

## 5. 效果对比

| 指标 | 改造前 (Multer 中转) | 改造后 (预签名直传) |
|------|---------------------|-------------------|
| 服务器内存占用 | 文件大小 × 并发数（OOM 风险） | 几乎为零 |
| 上传路径 | 浏览器 → NestJS → R2 | 浏览器 → R2 |
| 上传速度 | 受限于 API 服务器带宽 | 利用客户端上行带宽 |
| 进度跟踪 | 无 | 原生 XHR 实时进度 |
| 视频转码管道 | 不受影响 | 不受影响 |
| 最大文件支持 | ~200MB（受限于 VPS 内存） | R2 限制（默认 5GB） |

---

## 6. 架构总结

```
改造前：             改造后：
浏览器              浏览器
  │                    │
  ▼                    ├──→ POST /presigned-url (小请求)
NestJS Multer          │       ← { url, key }
  │                    ├──→ PUT {url} (文件直传 R2)
  ▼                    │       └─ XHR, 有进度回调
Cloudflare R2          ├──→ POST /confirm (小请求)
                       │       └─ 入队转码/压缩
                       ▼
                   Cloudflare R2
                   
                   服务器零内存消耗 ✅
```

关键设计原则：
1. **大文件不经过应用服务器**——预签名 URL 将上传路径从 "浏览器 → 服务器 → 存储" 缩短为 "浏览器 → 存储"
2. **原生 HTTP 客户端直传**——避免 axios 拦截器污染签名
3. **确认端点解耦**——文件上传和媒体处理分离，上传失败不影响已有数据

---

## 7. 如果重来一次

1. **一开始就应该上预签名 URL**——Multer 中转上传只适合小文件（< 10MB），视频类媒体从第一天就该直传
2. **始终用原生 `XMLHttpRequest` 或 `fetch` 做 S3 PUT**——axios 拦截器和预签名 URL 天生不兼容
3. **双重检测 MIME type**——`startsWith('video/')` + 正则兜底，应对浏览器的 `application/octet-stream`
