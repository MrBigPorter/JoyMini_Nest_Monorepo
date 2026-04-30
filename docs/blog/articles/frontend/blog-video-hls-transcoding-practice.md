---
title: Next.js 博客视频系统架构：从上传到 HLS 自适应播放的完整实现
slug: blog-video-hls-transcoding-practice
tags: Next.js, Video, HLS, Cloudflare, Architecture
---

# Next.js 博客视频系统架构：从上传到 HLS 自适应播放的完整实现

> 本文分享在一个 Next.js 博客系统中实现视频上传、自动转码为 HLS 自适应流格式的完整方案。涵盖 R2 存储、BullMQ 异步转码管道、前端 hls.js 播放器，以及在实践中遇到的 10 个坑和修复方案。

---

## 1. 背景：为什么博客需要视频系统？

传统博客的内容以文字和图片为主，但随着用户对多媒体内容的需求增加，视频成了提升内容表现力的关键手段。我们的博客系统需要一个完整的视频解决方案：

- **管理员上传视频** → 自动转码 → HLS 自适应流
- **前端播放** → 支持直播流、封面图、自适应码率
- **多语言翻译** → 视频标签在翻译过程中不丢失

> 为什么选择 HLS 而不是直接 MP4？

| 方面 | MP4 直链 | HLS |
|------|----------|-----|
| 启动播放 | 必须下载完整文件或用 Range 请求 | 2-4 秒内开始播放（首个 .ts 分片） |
| 自适应码率 | 不支持 | 根据网络自动切换质量 |
| 浏览器支持 | 原生支持 | Safari 原生 + hls.js 兼容其他 |
| 行业标准 | 传统方案 | YouTube、Netflix 等主流平台 |

## 2. 整体架构

视频系统分为四个阶段：

```
管理员上传 → R2 对象存储 → BullMQ 异步转码 → HLS 前端播放
                              │
                              ├── ffprobe 检测源视频尺寸
                              ├── ffmpeg 保持比例转码为 HLS
                              └── 提取 1 秒帧作为封面图
```

### 核心组件

**后端处理管道：**
- `MediaProcessorService` — ffmpeg HLS 转码 + 封面提取
- `MediaProcessor` — BullMQ WorkerHost，处理 `transcode-video` 任务
- `UploadController` / `UploadService` — 文件上传 + 入队转码

**管理后台：**
- 文章编辑器内嵌入视频（Quill Editor + Html5VideoBlot）
- 创建文章时的视频暂存 + 创建后触发转码

**前端播放器：**
- `HlsVideoPlayer` — hls.js 播放器，支持封面图、播放按钮、加载状态、错误重试

## 3. 视频上传流程

### 编辑已有文章（有 articleId）

管理员在编辑器中插入视频 → 上传到 R2 → 立即入队转码任务：

```
编辑器 → POST /upload/image + file + articleId → R2 存储
    → 如果有 articleId → BullMQ 入队 transcode-video 任务
    → 返回 { url, key } → 编辑器插入 <video> 标签
```

### 新建文章（无 articleId）

文章还不存在，所以分两步走：

1. 上传视频到 R2（临时位置），前端用 `useRef` 记录 `videoKey`
2. 提交文章创建后，通过 `POST /articles/:id/trigger-video-transcode` 触发转码

这个流程解决了"创建页面没有 articleId，导致视频永远不会被转码"的经典问题。

## 4. HLS 转码管道详解

### 处理步骤

```
1. 检查文件大小（不超过 500MB）
2. 从 R2 下载原始视频到临时目录
3. ffprobe 检测源视频的 width 和 height
4. 根据源视频宽高比计算各质量档位
5. 对每个质量档位：
   a. 计算高度：round(targetWidth / aspectRatio)
   b. 限制不超过源尺寸（防止放大低清视频）
   c. 确保宽高为偶数（H.264 编码要求）
   d. ffmpeg：缩放 + 转码为 HLS 分片
6. 生成 master.m3u8 主播放列表
7. 提取 1 秒帧作为封面图
8. 上传所有文件到 R2
9. 更新 article.meta.video
```

### 质量档位

| 质量 | 目标宽度 | 码率 | 条件 |
|------|---------|------|------|
| 480p | 854px | 800kbps | 始终生成 |
| 720p | 1280px | 2800kbps | 始终生成 |
| 1080p | 1920px | 5000kbps | 仅源高度 >= 1080 时 |

每个档位的实际宽度会 `clamp` 到不超过源视频宽度，防止低清视频被放大。

### 输出结构（R2 中）

```
uploads/blog/videos/{articleId}/
├── master.m3u8              # 主播放列表
├── poster.jpg               # 1 秒帧封面
├── 480p/
│   ├── playlist.m3u8
│   ├── segment-001.ts
│   └── ...
├── 720p/...
└── 1080p/ (条件生成)
```

### meta.video 数据结构

存储在 BlogArticle 的 `meta` JSON 字段中：

```json
{
  "video": {
    "hlsUrl": "https://cdn.joyminis.com/uploads/blog/videos/{id}/master.m3u8",
    "poster": "https://cdn.joyminis.com/uploads/blog/videos/{id}/poster.jpg",
    "duration": 120.5,
    "qualities": ["480p", "720p"],
    "status": "completed"
  }
}
```

状态流转：`pending → processing → completed` 或 `failed`（最多重试 3 次）

## 5. 最关键的修复：宽高比保持

这是整个过程**最容易出错的地方**，也是我们踩的最深的坑。

### 错误做法：硬编码 16:9

最初的实现直接使用了固定的分辨率：

```typescript
// ❌ 强制 16:9
const resolutions = ["854:480", "1280:720", "1920:1080"];
// ffmpeg -vf "scale=1280:720"
```

问题：
- 9:16 的竖屏视频会被拉伸成 16:9
- 21:9 的超宽屏视频会被裁剪/拉伸
- 总之，只要不是 16:9 的视频都会变形

### 正确做法：动态计算

```typescript
// ✅ 先检测源视频宽高比
const sourceAspectRatio = sourceWidth / sourceHeight;
// 限制不超过源宽度（防止放大）
const targetWidth = Math.min(qt.targetWidth, sourceWidth);
// 根据宽高比计算实际高度
const computedHeight = Math.round(targetWidth / sourceAspectRatio);
const targetHeight = Math.min(computedHeight, sourceHeight);
// 确保偶数（H.264 要求）
const evenWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1;
const evenHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;
// ffmpeg -vf "scale=720:1280:force_original_aspect_ratio=decrease"
```

同时，ffprobe 检测也要从"只检测高度"改为"检测宽高"：

```bash
# ❌ 旧：只检测高度
ffprobe -v error -select_streams v:0 -show_entries stream=height

# ✅ 新：检测宽+高
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0
```

### 为什么需要 force_original_aspect_ratio=decrease？

没有这个 ffmpeg 标志，`scale=720:1280` 会强制拉伸视频精确填充目标尺寸。加上这个标志后，ffmpeg 会在保持比例的前提下缩放，不足的部分用黑边（letterbox/pillarbox）填充。

### 为什么需要偶数尺寸？

H.264 编码器的色度子采样（4:2:0）要求宽高为偶数。奇数尺寸会导致编码错误或自动取整，产生意外的结果。

## 6. 前端 HLS 播放器

### HlsVideoPlayer 组件

核心思路：利用 `hls.js` 库实现跨浏览器兼容的 HLS 播放。

行为逻辑：
1. 挂载时创建 hls.js 实例
2. 附加到 `<video>` 元素
3. 加载 master.m3u8 地址
4. 解析到 `MANIFEST_PARSED` 后：
   - Safari：Safari 原生支持 HLS，所以 detach hls.js
   - 其他浏览器：用 hls.js 驱动播放
5. 未播放时显示可点击的播放按钮（SVG 图标）
6. 有封面图时显示封面
7. 缓冲时显示加载动画
8. 出错时显示错误状态 + 重试按钮

### 视频渲染位置

| 位置 | 播放器 | 条件 |
|------|--------|------|
| 首页头条区域 | HlsVideoPlayer | `meta?.video?.hlsUrl` 存在 |
| 文章卡片封面 | HlsVideoPlayer | 视频 URL + hlsUrl 存在 |
| 文章详情页 | HlsVideoPlayer | 详情页头条视频 |
| 正文内容 | DOMPurify 渲染的 `<video>` | 正文中含视频 HTML |

### 封面图优先级

```
1. meta.video.poster       ← 自动生成的 JPEG 封面（最佳）
2. coverImage（非视频）    ← 原始图片路径
3. undefined               ← 无封面
```

⚠️ **关键注意**：不要用视频 URL 作为 `<video>` 的 `poster` 属性 — 浏览器不能把视频文件显示为封面图。

## 7. 翻译中的视频标签保护

### 问题

AI 翻译处理文章时，将 Markdown 内容发给 AI → AI 返回翻译后的 Markdown → 渲染为 HTML。
但 `<video>` 和 `<figure>` 等 HTML 标签不是 Markdown 语法，翻译过程中被剥离了。

### 修复 1：查询时合并

后端 `getLocalizedString()` 检查翻译后的内容是否缺失视频标签。如果缺失，从源语言（中文）内容中提取视频标签并前置到翻译内容前：

```typescript
if (翻译内容缺少视频标签 && 源内容有视频标签) {
  return 视频标签 + 翻译内容;
}
```

### 修复 2：翻译时保留

在保存翻译内容前，从原始 HTML 中提取视频标签，追加到翻译输出末尾：

```typescript
const originalHtml = sourceContent;
const videoTags = originalHtml中匹配到的视频标签;
contentLocalized[targetLang] = translatedHtml + "\n" + videoTags;
```

两重保险确保翻译后的文章不会丢失视频。

## 8. 踩坑记录（10 个 Bug 全记录）

| # | Bug | 根因 | 修复 |
|---|-----|------|------|
| 1 | **视频变形** | ffmpeg 硬编码 16:9 | 动态计算宽高比 |
| 2 | **新建文章无法转码** | upload() 无 articleId | useRef 暂存 key，创建后触发 |
| 3 | **翻译后视频丢失** | renderMarkdown 剥离 HTML 标签 | 查询时合并 + 翻译时保留双重保险 |
| 4 | **封面图黑屏/空白** | 视频 URL 用作 poster 属性 | 强制使用图片类型作封面 |
| 5 | **播放器黑屏** | 播放覆盖层 pointer-events:none + 缓存 | 可点击播放按钮 + 缩短缓存 |
| 6 | **卡片点击跳转而非播放** | 整个 ArticleCard 套在 Link 里 | 媒体区域独立，仅文字导航 |
| 7 | **媒体管道死代码** | articleId 从未传到上传接口 | 补充 UploadFolderDto 参数链 |
| 8 | **变体上传到错误存储桶** | 使用了私有桶 | 创建 uploadToPublicBucket() |
| 9 | **大视频 OOM** | 无文件大小检查 | 处理前检查，上限 500MB |
| 10 | **DOMPurify SSR 崩溃** | Turbopack 静态解析动态导入 | next/dynamic 加 ssr:false |

## 9. 总结

一个看似简单的"博客里加个视频"功能，背后涉及了完整的视频处理管道、多端兼容、翻译保护等复杂问题。关键经验：

1. **宽高比保持是视频转码的第一要务** — 永远不要假设输入视频是 16:9
2. **异步转码管道需要处理好状态流转** — pending → processing → completed/failed
3. **多端视频渲染需要统一的数据结构** — `meta.video` 作为唯一数据源
4. **翻译系统与富媒体内容的兼容性** — 需要在翻译管道中额外保护非文本内容
5. **前端 HLS 播放需要兼容 Safari 原生支持和 hls.js** — 两种模式，一个组件
