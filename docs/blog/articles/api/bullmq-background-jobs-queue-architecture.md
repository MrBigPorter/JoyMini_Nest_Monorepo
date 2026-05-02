# API 后台任务体系 — BullMQ 队列架构与 Worker 实现

## 一、概述

JoyMini API 使用 **BullMQ**（Redis 驱动的队列系统）处理所有异步后台任务。整个体系包含 **3 个队列** 和 **4 个 Worker**，涵盖图片压缩、视频转码、头像合成、AI 翻译、评论审核等场景。

```
┌───────────────────────────────────────────────────┐
│                    Redis                           │
│   BullMQ Queue Storage (jobs, results, events)     │
└──────┬──────────┬──────────┬──────────────────────┘
       │          │          │
       ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌───────────────┐
│ media-   │ │ avatar_  │ │ blog-ai       │
│ processor│ │composition│ │               │
├──────────┤ ├──────────┤ ├───────────────┤
│ compress │ │treasure  │ │translate-     │
│ -image   │ │_group    │ │article        │
├──────────┤ ├──────────┤ ├───────────────┤
│ transcode│ │chat_group│ │moderate-      │
│ -video   │ │          │ │comment        │
└──────────┘ └──────────┘ └───────────────┘
       │          │                  │
       ▼          ▼                  ▼
┌──────────┐ ┌──────────┐ ┌───────────────┐
│ Sharp    │ │ Sharp +  │ │ Google Gemini │
│ FFmpeg   │ │ Axios    │ │ API           │
└──────────┘ └──────────┘ └───────────────┘
```

---

## 二、队列总览

| 队列名 | Queue 名称 | Worker | Job 类型 | 用途 |
|--------|-----------|--------|---------|------|
| Media Processor | `media-processor` | [`MediaProcessor`](apps/api/src/common/media/media.processor.ts) | `compress-image`, `transcode-video` | 图片压缩 + 视频转码 HLS |
| Avatar Composition | `avatar_composition` | [`AvatarProcessor`](apps/api/src/common/avatar/avatar.processor.ts) | `update_treasure_group`, `update_chat_group` | 群头像合成 |
| Blog AI | `blog-ai` | (via BullMQ) | `translate-article`, `moderate-comment`, `auto-reply` | AI 翻译、评论审核、自动回复 |
| Group Settlement | `group_settlement` | (via BullMQ) | `activate_orders` | 拼团结算 |

---

## 三、MediaProcessor — 图片与视频处理

### 3.1 Worker 配置

```typescript
@Processor(MEDIA_PROCESSOR_QUEUE, { concurrency: 2 })
export class MediaProcessor extends WorkerHost {
  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'compress-image': return this.handleCompressImage(job);
      case 'transcode-video': return this.handleTranscodeVideo(job);
    }
  }
}
```

`concurrency: 2` — 同时最多处理 2 个任务，防止 CPU 过载。

### 3.2 图片压缩流水线

```typescript
private async handleCompressImage(job: Job<CompressImageJobData>) {
  // 1. 文件大小预检（HeadObject 避免 OOM）
  const sizeOk = await this.checkFileSize(imageKey, 50 * 1024 * 1024, 'compress-image');
  if (!sizeOk) return;

  // 2. 从 R2 下载原始文件
  const buffer = await this.uploadService.getFileBuffer(imageKey, 'blog', articleId);

  // 3. Sharp 处理：生成 BlurHash + 3 种大小 × 2 种格式
  const variants = await this.mediaProcessorService.compressImage(buffer, articleId, imageKey);

  // 4. 更新 Prisma
  await this.prisma.blogArticle.update({
    where: { id: articleId },
    data: { meta: { ...existingMeta, images: variants } },
  });
}
```

### 3.3 MediaProcessorService — Sharp 图像处理

[`MediaProcessorService`](apps/api/src/common/media/media-processor.service.ts) 使用 Sharp 实现完整的图片处理管道：

```typescript
async compressImage(buffer: Buffer, articleId: string, originalKey: string): Promise<ImageVariants> {
  // 1. 尺寸保护（超过 4000px 预缩放）
  if (width > 4000 || height > 4000) {
    buffer = await sharp(buffer).resize(4000, 4000, { fit: 'inside' }).toBuffer();
  }

  // 2. 生成 BlurHash（32×32 缩略图 → 编码）
  const blurhash = await this.generateBlurHash(buffer, width, height);

  // 3. 并行生成 6 个变体
  const [thumbnail, medium, largeWebp, largeJpg] = await Promise.all([
    this.resizeAndConvert(buffer, 300, 'webp'),   // 缩略图
    this.resizeAndConvert(buffer, 800, 'webp'),   // 中等
    this.resizeAndConvert(buffer, 1600, 'webp'),  // 大图 WebP
    this.resizeAndConvert(buffer, 1600, 'jpeg'),  // 大图 JPEG
  ]);

  // 4. 上传所有变体到 R2
  // 5. 返回变体 URL
  return { blurhash, original, large: { webp, jpg }, medium: { webp, jpg }, thumbnail: { webp, jpg } };
}
```

**输出结构**：
```json
{
  "blurhash": "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
  "original": "https://cdn.example.com/uploads/blog/images/xxx.jpg",
  "large": { "webp": ".../large.webp", "jpg": ".../large.jpg" },
  "medium": { "webp": ".../medium.webp", "jpg": ".../medium.jpg" },
  "thumbnail": { "webp": ".../thumbnail.webp", "jpg": ".../thumbnail.jpg" }
}
```

### 3.4 BlurHash 生成

```typescript
private async generateBlurHash(buffer: Buffer, width: number, height: number): Promise<string> {
  const tinyBuffer = await sharp(buffer)
    .resize(32, 32, { fit: 'cover' })
    .raw().ensureAlpha().toBuffer();

  const pixels = new Uint8ClampedArray(tinyBuffer.buffer);
  return blurhashEncode(pixels, 32, 32, 4, 3); // components: 4x3
}
```

### 3.5 视频转码 HLS

```typescript
async transcodeVideoToHls(buffer: Buffer, articleId: string): Promise<VideoVariants> {
  // 1. 写入临时文件
  // 2. ffprobe 获取时长 + 分辨率
  // 3. 根据源分辨率决定质量档位（480p / 720p / 1080p）
  const qualityTargets = [
    { name: '480p', targetWidth: 854, bandwidth: '800k' },
    { name: '720p', targetWidth: 1280, bandwidth: '2800k' },
  ];
  if (sourceHeight >= 1080) {
    qualityTargets.push({ name: '1080p', targetWidth: 1920, bandwidth: '5000k' });
  }

  // 4. 为每个质量档位执行 ffmpeg 转码
  for (const qt of qualityTargets) {
    execSync(`ffmpeg -i "${inputPath}" ` +
      `-vf "scale=${resolution}:force_original_aspect_ratio=decrease" ` +
      `-c:v libx264 -crf 23 -preset medium ` +
      `-c:a aac -b:a 128k ` +
      `-hls_time 6 -hls_playlist_type vod ` +
      `-hls_segment_filename "${qualityDir}/segment_%03d.ts" ` +
      `"${qualityDir}/playlist.m3u8"`, { timeout: 300000 });
  }

  // 5. 生成 master.m3u8
  // 6. 上传到 R2（master.m3u8 最后上传）
}
```

**Critical Upload Order**（关键修复）：
```
Phase 1: 子目录（各质量档位的 .ts 分片）
Phase 2: 普通文件（playlist.m3u8）
Phase 3: master.m3u8 ← 最后上传
```
防止 Cloudflare 负缓存导致 master.m3u8 出现时变体 playlist 还不存在。

### 3.6 视频封面提取

```typescript
async extractVideoThumbnail(buffer: Buffer, articleId: string): Promise<string> {
  execSync(
    `ffmpeg -i "${inputPath}" -ss 00:00:01 -vframes 1 -vf "scale=1280:-1" -q:v 3 "${outputPath}"`,
    { timeout: 30000 },
  );
  // 上传到 R2
  return `${publicDomain}/uploads/blog/videos/${articleId}/poster.jpg`;
}
```

---

## 四、AvatarProcessor — 群头像合成

### 4.1 工作流程

```typescript
@Processor('avatar_composition')
export class AvatarProcessor extends WorkerHost {
  async process(job: Job) {
    switch (job.name) {
      case 'update_treasure_group':
        return this.handleTreasureGroup(job);   // 夺宝团头像
      case 'update_chat_group':
        return this.handleChatGroup(job);        // 聊天群头像
    }
  }
}
```

### 4.2 Sharp 合成逻辑

[`AvatarService.generateCompositeAvatar()`](apps/api/src/common/avatar/avatar.service.ts) 使用 Sharp 将最多 9 个头像合成一张 400×400 的网格图：

```typescript
async generateCompositeAvatar(avatarUrls: string[], contextId: string) {
  const validUrls = avatarUrls.filter(Boolean).slice(0, 9);
  const canvasSize = 400;
  const gap = 15;
  const bgColor = { r: 235, g: 235, b: 235, alpha: 1 };

  // 动态网格（1人→1列，2-4人→2列，5-9人→3列）
  let columns = 1;
  if (count >= 2 && count <= 4) columns = 2;
  if (count >= 5) columns = 3;

  // 并发下载所有头像
  const compositeInputs = await Promise.all(
    validUrls.map(async (url, index) => {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 3000 });
      const inputBuffer = Buffer.from(response.data);

      // 圆角 Mask
      const roundedMask = Buffer.from(
        `<svg><rect width="${cellSize}" height="${cellSize}" rx="${cellSize * 0.1}" /></svg>`
      );
      const resizedBuffer = await sharp(inputBuffer)
        .resize(cellSize, cellSize, { fit: 'cover' })
        .composite([{ input: roundedMask, blend: 'dest-in' }])
        .png().toBuffer();

      return { input: resizedBuffer, top: y, left: x };
    })
  );

  // 合成 + 上传 R2
  const finalBuffer = await sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: bgColor } })
    .composite(validInputs)
    .jpeg({ quality: 85 }).toBuffer();

  const uploadResult = await this.uploadService.uploadBuffer(finalBuffer, 'group-avatars', contextId, 'image/jpeg');
  return this.uploadService.getDownloadUrl(uploadResult.key, 'group-avatars');
}
```

### 4.3 合成后推送

群头像更新后，通过 Socket 实时推送给所有群成员：

```typescript
// 房间广播
this.eventsGateway.dispatch(conversationId, SocketEvents.CONVERSATION_UPDATED, { id, avatar });

// 成员个人频道广播（列表页刷新）
for (const member of allMembers) {
  this.eventsGateway.dispatch(`user_${member.userId}`, SocketEvents.CONVERSATION_UPDATED, { id, avatar });
}
```

---

## 五、QueueMonitorService — 队列监控

[`QueueMonitorService`](apps/api/src/common/queue/queue-monitor.service.ts) 提供运维 API，查看三个队列的健康状态：

```typescript
async getQueueStats(): Promise<QueueMonitoringResponse> {
  return {
    queues: [
      {
        name: 'blog-ai',
        waiting: 0, active: 1, completed: 152, failed: 3, delayed: 0, total: 156,
        isPaused: false,
        rateLimit: { max: 15, duration: 60000 }, // Google Gemini 配额
      },
      // avatar, group_settlement ...
    ],
    jobStats: {
      'blog-ai': [
        { type: 'translate-article', count: 89, lastCompleted: Date, avgProcessingTime: 12500 },
        { type: 'moderate-comment', count: 63, lastCompleted: Date, avgProcessingTime: 3200 },
      ],
    },
    system: { redisConnected: true, uptime: 123456, memoryUsage: { ... } },
  };
}
```

**运维操作**：
| 操作 | 说明 |
|------|------|
| `pauseQueue(name)` | 暂停队列（维护时使用） |
| `resumeQueue(name)` | 恢复队列 |
| `cleanQueue(name, grace)` | 清理超过 grace 期的已完成/失败任务 |

---

## 六、与前端对比

| 维度 | API (NestJS + BullMQ) | admin-next (Next.js) |
|------|----------------------|---------------------|
| 队列框架 | BullMQ (Redis) | —（浏览器无后台任务）|
| Worker 模式 | `WorkerHost` + `@Processor` | — |
| 任务类型 | 图片压缩 / 视频转码 / AI 翻译 / 头像合成 | — |
| 并发控制 | `concurrency: 2` | — |
| 事件监听 | `@OnWorkerEvent('completed'/'failed')` | — |
| 队列监控 | `QueueMonitorService`（运维 API） | — |
| 重试机制 | BullMQ 内置（`attempts` 配置） | `withRetry` 线性退避 |
| 错误处理 | Worker 内 try/catch + 状态更新 | Promise catch |

---

## 七、最佳实践

1. **文件大小预检**：Worker 中使用 `HeadObject` 先检查文件大小，避免下载超大文件导致 OOM
2. **并发控制**：`concurrency: 2` 防止 CPU 过载，配合 Sharp 的流式处理
3. **上传顺序**：HLS 文件上传时，`master.m3u8` 必须最后上传，防止 Cloudflare 缓存 404
4. **临时文件清理**：ffmpeg 处理完后，`finally` 块中递归删除临时目录
5. **错误状态传播**：视频处理失败后，`meta.video.status` 更新为 `'failed'`，前端可展示错误提示
6. **队列监控**：内置监控 API 可查看队列积压、平均处理时间，便于及时发现异常
