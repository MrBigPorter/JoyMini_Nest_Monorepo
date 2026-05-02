# Media Processing Pipeline: Sharp 图像压缩 + FFmpeg HLS 视频转码

> 自动化的博客媒体处理管道 — BullMQ 驱动，支持图像多格式变体生成、BlurHash 编码、视频 HLS 自适应转码

## Table of Contents

- [1. 架构总览](#1-架构总览)
- [2. 图像处理管道](#2-图像处理管道)
  - [2.1 尺寸安全钳](#21-尺寸安全钳)
  - [2.2 BlurHash 生成](#22-blurhash-生成)
  - [2.3 多格式变体](#23-多格式变体)
  - [2.4 R2 上传编排](#24-r2-上传编排)
- [3. 视频处理管道](#3-视频处理管道)
  - [3.1 视频元数据探测](#31-视频元数据探测)
  - [3.2 质量分级策略](#32-质量分级策略)
  - [3.3 HLS 分段编码](#33-hls-分段编码)
  - [3.4 Master Playlist 生成](#34-master-playlist-生成)
  - [3.5 视频缩略图提取](#35-视频缩略图提取)
  - [3.6 关键上传顺序：CF 负缓存 Bug 修复](#36-关键上传顺序cf-负缓存-bug-修复)
- [4. BullMQ 作业编排](#4-bullmq-作业编排)
  - [4.1 作业类型](#41-作业类型)
  - [4.2 文件大小预检](#42-文件大小预检)
  - [4.3 状态生命周期](#43-状态生命周期)
  - [4.4 并发与超时](#44-并发与超时)
- [5. 与 UploadService 的集成](#5-与-uploadservice-的集成)
- [6. 关键设计决策](#6-关键设计决策)
- [7. 完整工作流](#7-完整工作流)
- [8. 关键要点](#8-关键要点)

---

## 1. 架构总览

媒体处理管道由两个核心组件组成：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Media Module (NestJS)                        │
│                                                                 │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │  MediaProcessorService│    │     MediaProcessor           │   │
│  │  (Sharp + FFmpeg)    │    │     (BullMQ WorkerHost)      │   │
│  │                      │    │                              │   │
│  │  • compressImage()   │◄───│  • handleCompressImage()     │   │
│  │  • transcodeVideo()  │◄───│  • handleTranscodeVideo()    │   │
│  │  • generateBlurHash()│    │  • checkFileSize()           │   │
│  │  • extractThumbnail()│    │  • setVideoStatus()          │   │
│  │  • uploadDirectory() │    │                              │   │
│  └──────────────────────┘    └──────────┬───────────────────┘   │
│                                         │                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              UploadService (R2/S3 存储层)               │    │
│  │  getFileBuffer() / uploadToPublicBucket() / getFileSize()│   │
│  └─────────────────────────────────────────────────────────┘    │
│                                         │                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              PrismaService (Meta 更新)                   │    │
│  │  blogArticle.update({ meta: { images/video: ... } })   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**数据流：**

1. 前端上传图片/视频 → UploadService 存 R2 → 触发 BullMQ Job
2. `MediaProcessor` 接收 Job → 检查文件大小 → 下载原始文件
3. `MediaProcessorService` 处理（Sharp 压缩 / FFmpeg 转码）→ 上传变体到 R2
4. `MediaProcessor` 更新 Prisma `blogArticle.meta` 记录变体 URL + 状态

---

## 2. 图像处理管道

图像处理由 [`MediaProcessorService.compressImage()`](apps/api/src/common/media/media-processor.service.ts:31) 驱动，分 4 个阶段。

### 2.1 尺寸安全钳

Sharp 在处理超大图片时可能耗尽内存。管道在第一阶段设置 **4000px 硬限制**：

```typescript
const MAX_DIMENSION = 4000;
if ((width > MAX_DIMENSION || height > MAX_DIMENSION) && metadata.width && metadata.height) {
  buffer = await sharp(buffer)
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();
}
```

`fit: 'inside'` 保持宽高比，`withoutEnlargement` 确保小图不被放大。裁剪后的元数据重新读取用于后续 BlurHash 计算。

### 2.2 BlurHash 生成

BlurHash 是一个将图像编码为短字符串的算法，用于 SSR 渲染时的模糊占位符：

```typescript
private async generateBlurHash(buffer: Buffer, width: number, height: number): Promise<string> {
  const tinyBuffer = await sharp(buffer)
    .resize(32, 32, { fit: 'cover' })
    .raw()
    .ensureAlpha()
    .toBuffer();

  const pixels = new Uint8ClampedArray(tinyBuffer.buffer);
  return blurhashEncode(pixels, 32, 32, 4, 3);  // 4x3 分量
}
```

关键细节：
- **32x32 极小缩略图**：原始图像缩放到 32x32 后再编码，保证性能
- **`ensureAlpha()`**：`raw()` 输出 RGB（3 通道），但 BlurHash 需要 RGBA（4 通道）
- **4x3 分量**：BlurHash 的 `componentX=4, componentY=3` 在字符长度和图像质量之间取得平衡
- **失败降级**：`try/catch` 捕获异常，失败时返回空字符串（非致命）

### 2.3 多格式变体

使用 `Promise.all` 并行生成 4 种变体：

| 变体 | 宽度 | 格式 | 质量 | 用途 |
|------|------|------|------|------|
| thumbnail | 300px | WebP | 80 | 列表页缩略图 |
| medium | 800px | WebP | 80 | 文章内插图（默认） |
| large | 1600px | WebP | 80 | 大屏/高清显示 |
| large | 1600px | JPEG | 85 | 兼容性回退 |

所有变体共享 `resizeAndConvert()` 方法：

```typescript
private async resizeAndConvert(buffer: Buffer, width: number, format: 'webp' | 'jpeg'): Promise<Buffer> {
  const safeWidth = Math.min(width, MAX_DIMENSION);  // 安全钳
  const pipeline = sharp(buffer).resize(safeWidth, null, {
    fit: 'cover',
    withoutEnlargement: true,
  });

  if (format === 'webp') return pipeline.webp({ quality: 80 }).toBuffer();
  return pipeline.jpeg({ quality: 85, progressive: true }).toBuffer();
}
```

注意 `large` 同时输出 WebP 和 JPEG — WebP 优先（更小体积），JPEG 作为不支持 WebP 的旧浏览器的回退。

### 2.4 R2 上传编排

变体上传到 `uploads/blog/images/{articleId}/` 路径：

```
uploads/blog/images/{articleId}/
├── thumbnail.webp    (300w, WebP)
├── medium.webp       (800w, WebP)
├── large.webp        (1600w, WebP)
├── large.jpg         (1600w, JPEG)
└── original          (原图 URL)
```

上传后，`ImageVariants` 对象存入 Prisma：

```typescript
interface ImageVariants {
  blurhash: string;
  original: string;
  large: { webp: string; jpg: string };
  medium: { webp: string; jpg: string };
  thumbnail: { webp: string; jpg: string };
}
```

---

## 3. 视频处理管道

视频处理比图像复杂得多，涉及 FFmpeg 调用、多码率自适应流、以及 Cloudflare 负缓存 Bug 的规避。

### 3.1 视频元数据探测

使用 `ffprobe` 在 FFmpeg 转码前获取视频信息：

```typescript
// 获取时长
const durationStr = execSync(
  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`,
  { encoding: 'utf-8' },
).trim();

// 获取源视频尺寸（用于保持宽高比 + 判断是否支持 1080p）
const probeDimensions = execSync(
  `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`,
  { encoding: 'utf-8' },
).trim();
```

探测结果用于：
1. `parseFloat(durationStr)` → 写入 `VideoVariants.duration`
2. `sourceWidth / sourceHeight` → 计算宽高比 → 推导每个质量等级的实际分辨率

### 3.2 质量分级策略

```typescript
const qualityTargets: QualityTarget[] = [
  { name: '480p', targetWidth: 854, bandwidth: '800k' },
  { name: '720p', targetWidth: 1280, bandwidth: '2800k' },
];

// 仅当源视频高度 ≥ 1080 时才生成 1080p
if (sourceHeight >= 1080) {
  qualityTargets.push({ name: '1080p', targetWidth: 1920, bandwidth: '5000k' });
}
```

每个质量等级的实际分辨率动态计算以保持源宽高比：

```
targetWidth  = min(qt.targetWidth, sourceWidth)   // 防止放大
computedHeight = targetWidth / sourceAspectRatio
targetHeight = min(computedHeight, sourceHeight)   // 再次钳制

// H.264 要求偶尺寸（chroma subsampling 4:2:0）
evenWidth  = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1
evenHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1
```

**为什么不生码率阶梯？** 视频 Bitrate 直接使用固定值（800k/2800k/5000k）而非动态检测。对于博客文章场景这足够，但严格的流媒体场景应考虑使用 `two-pass` 或 `CRF` 加最大 bitrate 约束。

### 3.3 HLS 分段编码

使用 `libx264` 编码器，每个质量等级输出独立的 HLS 子播放列表：

```bash
ffmpeg -i "input.mp4" \
  -vf "scale=854:480:force_original_aspect_ratio=decrease" \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "480p/segment_%03d.ts" \
  -start_number 0 \
  "480p/playlist.m3u8"
```

| 参数 | 值 | 说明 |
|------|-----|------|
| `-crf 23` | 23 | H.264 质量参数，23 = 默认（越低质量越好，18=无损视觉） |
| `-preset medium` | medium | 编码速度/压缩比权衡，medium 是默认平衡点 |
| `-hls_time 6` | 6 秒 | 每段 TS 的时长 |
| `-hls_playlist_type vod` | VOD | 点播模式，播放列表是静态的（非直播） |
| `-c:a aac -b:a 128k` | AAC 128k | 音频编码 |

**超时：** FFmpeg 调用设置 `timeout: 300000`（5 分钟），对于较长的视频可能需要调整。

### 3.4 Master Playlist 生成

所有质量等级编码完成后，手动拼接 master playlist：

```
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480
480p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8
```

播放器加载 `master.m3u8` 后根据带宽自动选择最佳质量等级。

### 3.5 视频缩略图提取

视频转码完成后，从 1 秒处提取一帧 JPEG 作为海报图：

```typescript
execSync(
  `ffmpeg -i "${inputPath}" -ss 00:00:01 -vframes 1 -vf "scale=1280:-1" -q:v 3 "${outputPath}"`,
  { encoding: 'utf-8', timeout: 30000 },
);
```

- `-ss 00:00:01`：定位到第 1 秒
- `-vframes 1`：只取一帧
- `-vf "scale=1280:-1"`：宽度缩放至 1280px，高度自动保持比例
- `-q:v 3`：JPEG 质量（1-31，越小越好），3 是高质量

缩略图生成失败**不中断**主流程 — 只打警告日志，视频播放列表仍然有效。

### 3.6 关键上传顺序：CF 负缓存 Bug 修复

这是整个管道中最微妙的设计决策。`uploadDirectory()` 方法强制分 4 阶段上传：

```
Phase 1: 递归上传所有子目录（480p/ 720p/ 1080p/ 的所有 .ts 段）
Phase 2: 收集普通文件（排除 master.m3u8）
Phase 3: 上传所有普通文件（variant playlist.m3u8 等）
Phase 4: 上传 master.m3u8 — 绝对最后
```

**为什么？** Cloudflare 的缓存机制有一个负面行为：如果客户端请求 `master.m3u8` 时文件尚未存在（因为正在上传），CF 会缓存 404 响应长达 **4 小时**。即使后续文件上传完成，用户仍然得到 404。

通过确保 `master.m3u8` **最后上传**，所有子播放列表和 TS 段都已就绪，播放器加载 master playlist 时所有资源立即可用。

---

## 4. BullMQ 作业编排

[`MediaProcessor`](apps/api/src/common/media/media.processor.ts) 是一个 BullMQ `WorkerHost`，管理作业生命周期。

### 4.1 作业类型

| Job Name | 数据载荷 | 处理逻辑 |
|----------|---------|---------|
| `compress-image` | `{ articleId, imageKey, mimeType }` | 下载 → Sharp 压缩 → 上传变体 → 更新 meta.images |
| `transcode-video` | `{ articleId, videoKey, mimeType }` | 下载 → FFmpeg HLS → 上传 → 提取缩略图 → 更新 meta.video |

### 4.2 文件大小预检

在下载原始文件前，先通过 `UploadService.getFileSize()` 检查文件大小，避免大文件浪费带宽：

```typescript
const MAX_IMAGE_PROCESS_SIZE = 50 * 1024 * 1024;   // 50MB
const MAX_VIDEO_PROCESS_SIZE = 500 * 1024 * 1024;  // 500MB
```

如果文件超限：
- **图像**：跳过处理（图片会以原始格式使用，但无优化）
- **视频**：跳过处理 + 设置 `meta.video.status = 'failed'` 通知前端

`checkFileSize()` 的 fail-safe 策略：如果无法获取文件大小（如 S3 HeadObject 失败），**仍然尝试处理**，而非静默跳过。

### 4.3 状态生命周期

视频处理有明确的状态机，通过 `meta.video.status` 字段跟踪：

```
                   ┌──────────┐
                   │  pending  │  (初始状态，由前端设置)
                   └─────┬─────┘
                         │
                   ┌─────▼─────┐
                   │ processing│  (开始转码时设置)
                   └─────┬─────┘
                         │
               ┌─────────┴─────────┐
               │                   │
          ┌────▼────┐        ┌────▼────┐
          │completed│        │  failed │  (超限或转码异常)
          └─────────┘        └─────────┘
```

`setVideoStatus()` 是一个专用的 Prisma 辅助方法，只更新 `meta.video.status` 字段，不影响其他 meta 数据。

### 4.4 并发与超时

| 配置 | 值 | 说明 |
|------|-----|------|
| `concurrency` | 2 | 最多 2 个作业同时处理 |
| compress-image 实际超时 | 取决于 Sharp (通常 < 10s) | 内存密集型 |
| transcode-video 实际超时 | 5 min (FFmpeg timeout) | CPU 密集型 |

`concurrency: 2` 是一个保守值 — 视频转码是 CPU 密集型操作，过高的并发可能导致服务器过载。

---

## 5. 与 UploadService 的集成

媒体管道深度依赖 [`UploadService`](apps/api/src/common/upload/upload.service.ts) 提供存储层能力：

| 方法 | 用途 | 调用位置 |
|------|------|---------|
| `getFileBuffer(key, module, articleId)` | 从 R2 下载原始文件 | 两个 Job Handler |
| `getFileSize(key, module)` | 预检文件大小（HeadObject） | `checkFileSize()` |
| `uploadToPublicBucket(key, buffer, mimeType)` | 上传处理后的变体到 R2 | `compressImage()` + `uploadDirectory()` |

`getPublicDomain()` 从 `process.env.CF_R2_PUBLIC_DOMAIN` 读取公共域名，用于构建可公开访问的 URL。

---

## 6. 关键设计决策

| 决策 | 选择 | 替代方案 | 理由 |
|------|------|---------|------|
| **图像格式** | WebP + JPEG 回退 | 仅 WebP | 兼容性优先，JPEG 作为旧浏览器回退 |
| **视频编码** | H.264 (libx264) | H.265/VP9 | 兼容性最佳，所有现代浏览器/移动设备支持 |
| **自适应流** | HLS | DASH | iOS Safari 原生支持，Cloudflare 优化良好 |
| **缩略图提取** | FFmpeg 运行时 | 预先上传 | 减少上传次数，视频处理时自动完成 |
| **并发数** | 2 | N/A | 视频转码 CPU 密集，保守并发 |
| **上传顺序** | 4 阶段上传 | 简单递归 | 规避 Cloudflare 负缓存 Bug |
| **文件大小预检** | S3 HeadObject | 先下载再判断 | 避免大文件浪费带宽 |

---

## 7. 完整工作流

```
用户上传图片/视频
       │
       ▼
┌─────────────────┐
│  UploadService   │  存储到 R2
│  返回 key        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  前端/BlogService │  添加 BullMQ Job 到 MEDIA_PROCESSOR_QUEUE
│  触发处理        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MediaProcessor  │
│  checkFileSize() │─── 超限 ───→ 跳过/标记 failed
│       │         │
│  下载原始文件    │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌────────────┐
│  Image  │ │   Video     │
│ Sharp  │ │  FFmpeg     │
│        │ │            │
│ 1. 预缩 │ │ 1. 元数据探测│
│ 2. BH  │ │ 2. 质量分级  │
│ 3. 变体 │ │ 3. HLS 编码 │
│ 4. 上传 │ │ 4. 缩略图   │
│        │ │ 5. 4 阶段上传│
└───┬────┘ └──────┬─────┘
    │             │
    └──────┬──────┘
           ▼
┌──────────────────┐
│  Prisma Update    │
│  meta.images      │  ← ImageVariants
│  meta.video       │  ← VideoVariants + poster + status
└──────────────────┘
           │
           ▼
┌──────────────────┐
│    完成           │
│ 前端可访问变体    │
└──────────────────┘
```

---

## 8. 关键要点

1. **双阶段架构**：`MediaProcessorService`（纯处理逻辑）与 `MediaProcessor`（作业编排）分离，职责清晰，易于测试
2. **BlurHash 零依赖编码**：直接使用 Sharp `raw()` + `blurhash` 包编码，无需 `react-blurhash` 等前端库依赖
3. **尺寸安全三重保障**：4000px 预缩 → `withoutEnlargement` → `Math.min()` 安全钳，全方位防止 Sharp OOM
4. **H.264 + HLS 兼容性优先**：牺牲一点点压缩率换取最广泛的设备和浏览器支持
5. **CF 负缓存 Bug 修复**：`master.m3u8` 最后上传的策略是一个从生产环境学到的关键教训
6. **非致命降级**：BlurHash 失败（返回空字符串）、缩略图提取失败（无 poster）、文件大小检测失败（继续处理）— 所有辅助操作都有降级路径
7. **文件大小预检**：S3 HeadObject 先于下载，避免大文件浪费带宽和处理时间
