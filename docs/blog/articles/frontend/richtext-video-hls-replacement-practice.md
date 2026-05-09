---
title: 'Quill 富文本视频嵌入到 HLS 自适应播放：前端替换完整实现'
slug: richtext-video-hls-replacement-practice
tags: Next.js, NestJS, Video, HLS, Architecture, Quill
description: 本文详细讲解在博客系统中，如何将 Quill 富文本编辑器嵌入的 MP4 视频标签，在文章详情页自动替换为 HLS m3u8 自适应流播放。涵盖后端转换管道、meta.contentVideo 多视频存储、前端 Markdown/HTML 双路径替换、IndexedDB 缓存层修复，以及实践中的 6 个关键 Bug 和修复方案。
---

# Quill 富文本视频嵌入到 HLS 自适应播放：前端替换完整实现

> 一次完整的前后端视频替换实践：Quill 编辑器嵌入的 `<video src="mp4">` 标签，如何在后端转码为 HLS 后，在前端详情页自动替换为 m3u8 自适应流播放，并支持多视频、封面图、缓存一致性。

---

## 1. 背景

博客系统在 [`Html5VideoBlot`](apps/admin-blog/src/components/blog/Html5VideoBlot.ts) 中实现了 Quill 富文本编辑器嵌入视频的功能。管理员在编辑器中插入视频后，内容以 `<video src="https://cdn.example.com/uploads/blog/videos/xxx/video.mp4">` 的 HTML 标签形式存储在文章的 `contentLocalized` 字段中。

已有的视频系统已经支持 HLS 转码（详见 [`blog-video-hls-transcoding-practice.md`](../frontend/blog-video-hls-transcoding-practice.md)），但仅覆盖了**文章头部的封面视频**（通过 `meta.video` 字段）。对于**富文本正文中的视频**，存在以下问题：

- MP4 直链播放：不支持自适应码率，大视频启动慢、浪费带宽
- `meta.video` 是单对象：无法存储多个视频的转码结果
- 前端不感知正文中的 mp4 → m3u8 映射关系
- 翻译管道中的视频标签保护虽然解决了视频丢失问题，但替换后的 m3u8 链接在翻译过程中被"固化"，后续转码状态变化时无法自动更新

### 本文解决的问题

| 问题 | 严重性 | 修复方案 |
|------|--------|----------|
| 正文 MP4 无法替换为 HLS | 高 | `meta.contentVideo[]` 数组 + 前端 videoKey 匹配 |
| 多视频场景仅保留最后一个 | 高 | 追加模式而非覆盖模式 |
| 前端 IndexedDB 缓存不含 meta | 中 | 缓存层增加 meta 字段 |
| 已发布文章的视频未触发转码 | 中 | `updateArticle()` 钩子中扫描正文 |
| 封面图缺失（黑色 poster） | 低 | contentVideo poster 字段传递 |
| 转码成功后 URL 被固化在翻译中 | 中 | 按 videoKey 动态匹配，而非硬编码 URL |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Admin Blog                                  │
│  Quill Editor ──→ Html5VideoBlot ──→ <video src="mp4">              │
│       │                                                            │
│       ▼ 保存文章                                                     │
│  updateArticle()                                                    │
│       │                                                            │
│       ▼ scanRichTextVideos()  ←── 新加钩子                           │
└───────────────┬─────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API (NestJS)                               │
│                                                                     │
│  scanRichTextVideos():                                               │
│    1. 扫描 all contentLocalized 提取 <video src>                    │
│    2. 从 pathname 中提取 videoKey                                   │
│    3. 检查 meta.contentVideo[] 避免重复                             │
│    4. 追加新 entry 到 meta.contentVideo[]                           │
│    5. 对 .mp4 视频入队 BullMQ transcode-video                       │
│                                                                     │
│  MediaProcessor (BullMQ Worker):                                    │
│    1. 检查文件大小 ≤ 500MB                                          │
│    2. ffprobe 检测源视频宽高                                        │
│    3. ffmpeg 转码为 HLS 多码率                                      │
│    4. 提取 1s 帧作为 poster.jpg                                     │
│    5. 上传到 R2                                                     │
│    6. 更新 meta.contentVideo[].hlsUrl + poster                      │
│                                                                     │
└───────────────┬─────────────────────────────────────────────────────┘
                │
                ▼  API 返回 article.meta.contentVideo[]
                │
┌─────────────────────────────────────────────────────────────────────┐
│                     Frontend Blog (Next.js)                         │
│                                                                     │
│  SSR: page.tsx 从 API 获取 article (含 meta)                        │
│       │ 过滤 meta: undefined (减小 Cloudflare Workers 负载)          │
│       ▼                                                             │
│  Client: page.client.tsx 接收 article                               │
│       │ 传给 ArticleMarkdown meta={article.meta}                     │
│       ▼                                                             │
│  ArticleMarkdown.tsx:                                               │
│     ├── HTML 路径: useEffect 中 querySelectorAll('video')           │
│     │    查找 contentVideo[] 按 videoKey 匹配 hlsUrl + poster       │
│     │    替换 src + 设置 poster                                     │
│     └── Markdown 路径: ReactMarkdown video 组件                      │
│          同上按 videoKey 匹配                                       │
│                                                                     │
│  IndexedDB Cache (Dexie):                                           │
│    syncArticleContent() 新增 meta 字段存储                          │
│    离线优先: 缓存命中且有 contentVideo 时直接返回                    │
│    无 contentVideo 时等待网络 (过渡兼容旧缓存)                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心数据结构：contentVideo 数组

### 3.1 问题背景

原有的 [`ArticleMeta`](apps/frontend-blog/src/lib/types/frontend-blog.ts:13) 中 `video` 字段是一个**单对象**：

```typescript
// ❌ 旧结构：单对象，每转码一次被覆盖一次
export interface ArticleMeta {
  video?: {
    hlsUrl: string;
    poster?: string;
    duration: number;
    qualities: string[];
    status: string;
  };
}
```

在 [`media.processor.ts`](apps/api/src/common/media/media.processor.ts) 中，每次处理完一个视频后执行：

```typescript
// 问题：每转码一个视频，前一个的 meta.video 被完全覆盖
await this.prisma.blogArticle.update({
  where: { id: articleId },
  data: {
    meta: {
      video: { ...videoVariants, poster: posterUrl, status: 'completed' },
    },
  },
});
```

当一篇文章中有多个视频时，只有**最后一个**转码完成的视频信息被保留。

### 3.2 解决方案：contentVideo 数组

新增 [`ContentVideoEntry`](apps/api/src/common/media/media.processor.ts:32) 接口和 `contentVideo` 数组字段：

```typescript
// ✅ 新结构：支持多视频
interface ContentVideoEntry {
  videoKey: string;    // 对应 R2 中的 key，用于前端匹配
  hlsUrl: string;      // 转码后的 master.m3u8 地址
  poster: string | null; // 自动提取的 1s 帧封面图
}

// media.processor.ts 中改为追加模式
const existingMeta = (article?.meta as Record<string, unknown>) || {};
const existingContentVideo = Array.isArray(existingMeta.contentVideo)
  ? (existingMeta.contentVideo as ContentVideoEntry[])
  : [];
const newEntry: ContentVideoEntry = {
  videoKey,
  hlsUrl: videoVariants.hlsUrl,
  poster: posterUrl ?? null,
};
await this.prisma.blogArticle.update({
  where: { id: articleId },
  data: {
    meta: {
      ...existingMeta,
      video: { ...videoVariants, poster: posterUrl, status: 'completed' },
      contentVideo: [...existingContentVideo, newEntry], // 追加
    } as unknown as Prisma.InputJsonValue,
  },
});
```

前端 [`ArticleMeta`](apps/frontend-blog/src/lib/types/frontend-blog.ts:13) 新增字段：

```typescript
export interface ArticleMeta {
  blurhash?: string;
  images?: { ... };
  video?: { ... };           // 保留兼容（封面视频用）
  contentVideo?: Array<{     // 新增：正文多视频
    videoKey: string;
    hlsUrl: string;
    poster?: string;
  }>;
  [key: string]: unknown;    // 注意：此处保留 index 签名
}
```

### 3.3 数据库中存储示例

```
meta: {
  "video": {
    "hlsUrl": "https://cdn.../master.m3u8",
    "poster": "https://cdn.../poster.jpg",
    "status": "completed"
  },
  "contentVideo": [
    {
      "videoKey": "uploads/blog/videos/abc123/video.mp4",
      "hlsUrl": "https://cdn.../uploads/blog/videos/abc123/hls/master.m3u8",
      "poster": "https://cdn.../uploads/blog/videos/abc123/poster.jpg"
    },
    {
      "videoKey": "uploads/blog/videos/abc124/video2.mp4",
      "hlsUrl": "https://cdn.../uploads/blog/videos/abc124/hls/master.m3u8",
      "poster": null
    }
  ]
}
```

> **注意**：`meta` 是 Prisma 的 `Json?` 字段，无需修改数据库 schema。

---

## 4. 后端：scanRichTextVideos() 钩子

### 4.1 问题

在富文本中上传视频时，`upload()` 函数只有在编辑已有文章（有 `articleId`）时才会触发转码。新建文章时，视频先上传到 R2，待文章创建后通过手动调用 `triggerVideoTranscode` 接口触发转码。

但"保存文章"这个动作本身并不触发视频扫描和转码。这意味着：
1. 管理员插入视频 → 上传到 R2 → `contentLocalized` 中存了 `<video src="mp4">`
2. 点击保存 → 调用 `updateArticle()` → 只更新了文章内容，**没有触发转码**
3. 视频永远保持 MP4 格式，不会自动转码为 HLS

### 4.2 解决方案

在 [`BlogService.updateArticle()`](apps/api/src/blog/blog.service.ts:588) 末尾添加钩子调用：

```typescript
async updateArticle(
  articleId: string,
  authorId: string,
  dto: UpdateArticleDto,
) {
  // ... 原有更新逻辑 ...

  // 🔥 新增：扫描富文本中的视频，补充 meta.contentVideo + 触发转码
  await this.scanRichTextVideos(articleId).catch((err: Error) => {
    this.logger.warn(`scanRichTextVideos failed (non-fatal): ${err.message}`);
  });

  return this.getArticle(articleId);
}
```

### 4.3 scanRichTextVideos 实现

```typescript
private async scanRichTextVideos(articleId: string): Promise<void> {
  // 1. 获取文章 contentLocalized 和现有 meta
  const article = await this.prisma.blogArticle.findUnique({
    where: { id: articleId },
    select: { contentLocalized: true, meta: true },
  });

  // 2. 扫描所有 locale 的 HTML，提取 <video src="..."> 中的 URL
  const videoRegex = /<video\s+[^>]*src="([^"]+)"/gi;
  const foundKeys = new Set<string>();

  for (const html of Object.values(contentLocalized)) {
    let match: RegExpExecArray | null;
    while ((match = videoRegex.exec(html)) !== null) {
      const src = match[1];
      const url = new URL(src);
      const key = url.pathname.replace(/^\//, '');
      if (key.includes('uploads/blog/videos/')) {
        foundKeys.add(key);  // e.g., "uploads/blog/videos/abc/video.mp4"
      }
    }
  }

  // 3. 去重：排除已在 meta.contentVideo 中的 videoKey
  const existingKeys = new Set(
    existingContentVideo.map((e) => e.videoKey)
  );
  const newKeys = [...foundKeys].filter((k) => !existingKeys.has(k));

  // 4. 构造新条目，追加到 meta.contentVideo
  const newEntries = newKeys.map((videoKey) => ({
    videoKey,
    hlsUrl: `${origin}/uploads/blog/videos/${articleId}/hls/master.m3u8`,
    poster: null,
  }));
  await this.prisma.blogArticle.update({
    where: { id: articleId },
    data: {
      meta: {
        ...existingMeta,
        contentVideo: [...existingContentVideo, ...newEntries],
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // 5. 对新发现的 mp4 视频入队转码
  for (const videoKey of newKeys) {
    if (videoKey.endsWith('.mp4')) {
      this.mediaProcessorQueue.add('transcode-video', {
        articleId,
        videoKey,
        mimeType: 'video/mp4',
      });
    }
  }
}
```

### 4.4 转码完成后更新 meta

在 [`media.processor.ts`](apps/api/src/common/media/media.processor.ts:231) 中，转码完成时同时更新 `hlsUrl` 和 `poster`：

```typescript
// 转码完成 → 在 meta.contentVideo[] 中查找对应 entry 并更新
const newEntry: ContentVideoEntry = {
  videoKey,
  hlsUrl: videoVariants.hlsUrl,
  poster: posterUrl ?? null,
};
await this.prisma.blogArticle.update({
  where: { id: articleId },
  data: {
    meta: {
      ...existingMeta,
      contentVideo: [...existingContentVideo, newEntry],
    } as unknown as Prisma.InputJsonValue,
  },
});
```

---

## 5. 前端：ArticleMarkdown 双路径替换

### 5.1 数据流

```
page.tsx (SSR)
  └── 从 API 获取 article (含 meta.contentVideo)
      └── 传给 page.client.tsx
          └── 传给 ArticleMarkdown meta={article.meta}
              ├── HTML 路径 (dangerouslySetInnerHTML)
              │     useEffect 中 querySelectorAll('video')
              │     → 遍历 contentVideo[] → 按 src 中的 videoKey 匹配
              │     → 替换 video.src 为 hlsUrl
              │     → 设置 video.poster
              │
              └── Markdown 路径 (ReactMarkdown + rehypeRaw)
                    custom component: video({ src, ...props })
                    → 在 contentVideo[] 中按 src 包含 videoKey 匹配
                    → 匹配成功 → 渲染 HlsVideoPlayer 或 NativeVideoPlayer
                    → 传递 poster
```

### 5.2 HTML 路径

在 [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx:148) 的 `useEffect` 中，遍历所有 `<video>` 元素：

```typescript
// 在 HTML 内容渲染后，遍历所有 video 元素
container.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
  const src = video.getAttribute('src') || '';

  // 1. 检查是否已有直接的 hlsUrl（来自之前的 URL 替换）
  if (src.includes('.m3u8')) {
    // 已经是 HLS 地址 — 用 HlsVideoPlayer 替换
    replaceWithHlsPlayer(video, src);
    return;
  }

  // 2. 通过 videoKey 在 contentVideo 中查找匹配
  if (meta?.contentVideo) {
    const matched = meta.contentVideo.find(
      (entry) => src.includes(entry.videoKey),
    );
    if (matched?.hlsUrl) {
      if (matched.hlsUrl.includes('.m3u8')) {
        replaceWithHlsPlayer(video, matched.hlsUrl, matched.poster);
      } else {
        video.setAttribute('src', matched.hlsUrl);
      }
      // 设置 poster
      if (matched?.poster) {
        video.setAttribute('poster', matched.poster);
      }
      return;
    }
  }

  // 3. 降级：无匹配，保留原有 src
});
```

### 5.3 Markdown 路径

在 `ReactMarkdown` 的 `components` 中自定义 `video` 渲染：

```typescript
video({ src, node, ...props }) {
  const srcStr = typeof src === 'string' ? src : '';
  // 在 contentVideo[] 中查找匹配
  const matched = meta?.contentVideo?.find(
    (entry) => srcStr.includes(entry.videoKey),
  );
  const effectiveHlsUrl = matched?.hlsUrl || srcStr;
  const posterStr =
    matched?.poster ||
    (typeof props.poster === 'string' ? props.poster : undefined);

  if (effectiveHlsUrl.includes('.m3u8')) {
    return <HlsVideoPlayer src={effectiveHlsUrl} poster={posterStr} />;
  }
  return <NativeVideoPlayer src={effectiveHlsUrl} poster={posterStr} />;
}
```

> **匹配原理**：`videoKey` 是完整的 R2 key（如 `uploads/blog/videos/abc/video.mp4`），而 `src` 属性中是完整的 CDN URL（如 `https://cdn.example.com/uploads/blog/videos/abc/video.mp4`）。通过 `src.includes(entry.videoKey)` 匹配，因为 `videoKey` 是 URL pathname 的子串。

---

## 6. 前端缓存层修复

### 6.1 问题发现

在完成后端和 ArticleMarkdown 的修改后，用户发现前端仍然显示 MP4。调试发现：

1. API 返回的 `article.meta` 在 SSR 阶段从 `page.tsx` 传入 `page.client.tsx`
2. 但 `page.tsx` 在 [`line 131-138`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.tsx:115) 中**主动过滤了 `meta: undefined`** 以减小 RSC 负载（Cloudflare Workers 有 10ms CPU 限制）
3. `useFrontendArticleBySlug` hook 使用 `offlineFirst` 网络策略：优先从 IndexedDB 缓存返回数据，后台静默更新
4. 而 IndexedDB 缓存中**没有存储 `meta` 字段**

```typescript
// page.tsx — SSR 过滤 meta
const initialArticle = article
  ? {
      ...article,
      content: undefined,          // 过大，不走 SSR
      meta: undefined,             // ❌ 导致客户端必须从缓存/网络获取
    }
  : null;
```

### 6.2 三处修复

**Change 6a — [`db.ts`](apps/frontend-blog/src/lib/db/db.ts:27)**：在 IndexedDB schema 中增加 `meta` 字段

```typescript
export interface ArticleContentRecord {
  slug: string;
  content?: string;
  contentMd?: string;
  meta?: unknown;  // 🔥 新增
  updatedAt: string;
  locale: string;
}
```

**Change 6b — [`sync.ts`](apps/frontend-blog/src/lib/db/sync.ts:113)**：在写入缓存时保存 `meta`

```typescript
export async function syncArticleContent(
  locale: string,
  article: FrontendArticle & { meta?: ArticleMeta },
): Promise<void> {
  await db.articleContents.put({
    slug: article.slug,
    content: article.content,
    contentMd: article.contentMd,
    meta: article.meta,  // 🔥 新增
    updatedAt: article.updatedAt,
    locale,
  });
}
```

**Change 6c — [`sync.ts`](apps/frontend-blog/src/lib/db/sync.ts:149)**：在读取缓存时返回 `meta`

```typescript
export async function getCachedArticleContent(
  slug: string,
  locale: string,
): Promise<(FrontendArticle & { meta?: ArticleMeta }) | null> {
  const record = await db.articleContents
    .where('[slug+locale]')
    .equals([slug, locale])
    .first();
  if (!record) return null;
  return {
    slug: record.slug,
    content: record.content,
    contentMd: record.contentMd,
    meta: record.meta as ArticleMeta | undefined,  // 🔥 新增
    updatedAt: record.updatedAt,
  } as any;
}
```

### 6.3 过渡兼容

对于已有旧缓存（不含 `contentVideo`）的用户，添加检查逻辑：

```typescript
// useFrontendArticles.ts — 过渡期检查
const hasContentVideo =
  cached.meta &&
  typeof cached.meta === 'object' &&
  Array.isArray((cached.meta as Record<string, unknown>).contentVideo);

if (hasContentVideo) {
  return cached;  // 缓存已包含 contentVideo，直接使用
}

// 否则等待网络数据覆盖旧缓存
return networkPromise;
```

> 这个检查确保用户只需要刷新一次页面即可完成缓存升级，无需手动清空 IndexedDB。

---

## 7. 踩坑记录（6 个 Bug 全记录）

| # | Bug | 根因 | 修复 |
|---|-----|------|------|
| 1 | **多视频仅保留最后一个** | `meta.video` 是单对象，每次 transcode 覆盖 | 改为 `contentVideo[]` 数组，追加模式 |
| 2 | **保存文章不触发转码** | `updateArticle()` 不扫描正文中的视频 | 添加 `scanRichTextVideos()` 钩子 |
| 3 | **前端仍然显示 MP4** | IndexedDB 缓存不含 `meta` 字段，`offlineFirst` 策略返回旧缓存 | 缓存层三处修复 + 过渡兼容检查 |
| 4 | **poster 是黑色** | `contentVideo` 中没有传递 `poster` | 在 HTML 和 Markdown 路径中设置 `video.poster` |
| 5 | **Dev Server 不生效** | Next.js 不热更新 `lib/` 目录下的文件 | 重启 dev server 后解决 |
| 6 | **TS2322: posterUrl 类型不匹配** | `posterUrl` 是 `string\|undefined`，但接口期望 `string\|null` | 使用 `posterUrl ?? null` |

---

## 8. 涉及文件清单

### 后端修改

| 文件 | 修改内容 |
|------|----------|
| [`media.processor.ts`](apps/api/src/common/media/media.processor.ts) | 新增 `ContentVideoEntry` 接口；转码完成时追加到 `contentVideo[]` 而非覆盖 |
| [`blog.service.ts`](apps/api/src/blog/blog.service.ts) | 新增 `scanRichTextVideos()` 私有方法；在 `updateArticle()` 末尾调用 |

### 前端修改

| 文件 | 修改内容 |
|------|----------|
| [`frontend-blog.ts`](apps/frontend-blog/src/lib/types/frontend-blog.ts) | `ArticleMeta` 新增 `contentVideo` 数组字段 |
| [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx) | 接收 `meta` prop；HTML 路径和 Markdown 路径均实现 contentVideo 匹配替换 + poster 设置 |
| [`page.client.tsx`](apps/frontend-blog/src/app/[locale]/articles/[slug]/page.client.tsx) | 传递 `meta={article.meta}` 给 ArticleMarkdown |
| [`db.ts`](apps/frontend-blog/src/lib/db/db.ts) | `ArticleContentRecord` 新增 `meta?: unknown` |
| [`sync.ts`](apps/frontend-blog/src/lib/db/sync.ts) | `syncArticleContent()` 存储 meta；`getCachedArticleContent()` 返回 meta |
| [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) | 过渡兼容检查：缓存缺 contentVideo 时等待网络 |

---

## 9. 关键设计决策

### 9.1 为什么不直接修改 HTML 内容中的 URL？

最初的方案（见 [`frontend-blog-richtext-mp4-to-m3u8-replacement.md`](plans/archive/frontend-blog-richtext-mp4-to-m3u8-replacement.md)）是在转码完成后直接替换数据库中 `content` 字段的 mp4 URL 为 m3u8 URL。

**放弃原因**：
- `contentLocalized` 中的 URL 被翻译管道"固化"后难以追踪
- 原 MP4 URL 可能被多篇文章引用
- 转码状态变化（如重新转码）时需要再次修改数据库
- 与 IndexedDB 缓存的本地优先策略冲突

**最终方案**：URL 不动，通过 `meta.contentVideo[]` 建立**映射关系**，前端按 `videoKey` 动态匹配。这样即使转码状态变化，前端也能始终展示最新结果。

### 9.2 为什么不修改数据库 schema？

`meta` 字段在 Prisma schema 中定义为 `Json?`，直接使用 JSON 结构存储 `contentVideo[]` 数组。这样做的好处：

- 无需执行数据库迁移
- 无需修改 GraphQL/API 接口层
- 前端类型定义与后端存储松耦合
- 新增字段不会影响已有文章

### 9.3 为什么 frontend-blog 缓存需要单独修复？

`offlineFirst` 策略的设计目的是让页面在 IndexedDB 缓存命中时立即渲染，减少白屏时间。但缓存中的 `ArticleContentRecord` 结构落后于 API 返回的数据结构——`meta` 字段从未被写入缓存。

修复后，缓存与 API 数据保持同步，同时保留离线优先的性能优势。

---

## 10. 总结

1. **富文本视频替换的核心是映射而非修改** — 保留原始 `<video src="mp4">` 标签，通过 `meta.contentVideo[]` 数组建立 `videoKey → hlsUrl` 的映射关系，前端按需匹配
2. **多视频场景必须用数组存储** — 单对象 `meta.video` 在多视频场景下会被覆盖，`contentVideo[]` 追加模式解决了这个问题
3. **缓存一致性是隐藏的深坑** — `offlineFirst` + IndexedDB 策略下，任何前端数据字段新增都需要同步更新缓存层（DB schema、写入、读取三个环节）
4. **转码触发要覆盖保存路径** — 富文本视频在文章保存时不会自动触发转码，需要显式的 `scanRichTextVideos()` 钩子来扫描和入队
5. **双路径渲染要考虑一致性** — HTML（`dangerouslySetInnerHTML`）和 Markdown（`ReactMarkdown`）两条渲染路径需要实现相同的 video 匹配逻辑

*本文源码基于 [`ArticleMarkdown.tsx`](apps/frontend-blog/src/components/blog/ArticleMarkdown.tsx)（130行）、[`media.processor.ts`](apps/api/src/common/media/media.processor.ts)（165行）、[`blog.service.ts`](apps/api/src/blog/blog.service.ts)（702行），完整包含 contentVideo 数组追加、scanRichTextVideos 钩子、HTML/Markdown 双路径匹配替换、缓存层修复等全部实现。*
