---
title: 'iOS HLS 视频播放的坑与解：CoreMediaErrorDomain -12642 全面分析'
slug: ios-hls-12642-analysis
tags:
  - iOS
  - HLS
  - FFmpeg
  - Video
  - H.264
  - NestJS
description: 深入分析 iOS CoreMediaErrorDomain -12642 (FormatUnsupported) 错误的根本原因，通过实际案例从 FFmpeg 编码参数、HLS Playlist 配置、H.264 Level 约束等多个维度进行系统性排查与修复。
---

# iOS HLS 视频播放的坑与解：CoreMediaErrorDomain -12642 全面分析

## 1. 引言

在移动端开发中，视频播放是最常见的功能之一。然而，iOS 上的 HLS（HTTP Live Streaming）播放经常遇到各种问题。其中最令人头疼的莫过于 `CoreMediaErrorDomain error -12642 (FormatUnsupported)`。

这个错误通常发生在新上传的视频上，而旧的视频却能正常播放，让人摸不着头脑。本文将通过一个真实的排查案例，深入分析这个错误的根本原因，并提供一套通用的解决策略。

## 2. 系统架构

我们使用 NestJS 作为后端服务，通过 FFmpeg 将用户上传的视频转码为 HLS 格式：

```
用户上传 MP4 -> FFmpeg 转码 HLS -> 上传到 R2/CDN -> 前端播放
                                                        |
                                              hls.js (Web) / AVPlayer (iOS)
```

### 2.1 后端转码流程

后端使用 [`child_process.spawn`](apps/api/src/common/media/media-processor.service.ts:436) 执行 FFmpeg，为每个视频生成三个质量版本（480p、720p、1080p），每个版本包含：

- 一个 `playlist.m3u8`（变体播放列表）
- 多个 `.ts` 分段（MPEG-TS 容器中的 H.264 视频 + AAC 音频）
- 一个 `master.m3u8`（主播放列表，引用所有变体）

### 2.2 上传流程

上传顺序至关重要：先上传 TS 分段和变体播放列表，最后上传 `master.m3u8`。这样可以确保当客户端获取 `master.m3u8` 时，所有资源都已经可用。详见 [`uploadDirectory()`](apps/api/src/common/media/media-processor.service.ts:487)。

## 3. 排查过程

### 3.1 第一阶段：初步分析

最初的 FFmpeg 命令（在 [`transcodeVideoToHls()`](apps/api/src/common/media/media-processor.service.ts:241) 中）使用系统默认编码参数，缺少对 iOS 兼容性的关键配置。通过分析 `-12642` 错误的触发条件——iOS `VideoToolbox` 无法解码 H.264 流——我们首先添加了以下参数：

```bash
-profile:v main     # H.264 Main Profile
-pix_fmt yuv420p    # 4:2:0 色度采样
-level 4.0          # Level 4.0
```

### 3.2 第二阶段：发现真正的罪魁祸首

部署后发现 iOS **仍然**报错。于是我们开始深入检查生成的 `master.m3u8`：

```text
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=860:480
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1288:720
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1934:1080
```

**问题 1：非标准分辨率**

iOS VideoToolbox 硬件解码器要求宽度是 16 的倍数（宏块对齐）。而：

- `860 % 16 = 12` — 不满足 16 对齐
- `1288 % 16 = 8` — 不满足 16 对齐
- `1934 % 16 = 6` — 不满足 16 对齐

这些非标准分辨率来源于旧的转码逻辑直接使用源视频宽高比动态计算输出尺寸：

```typescript
// OLD: Dynamic aspect-ratio-based resolution (wrong)
const ratio = sourceWidth / sourceHeight;
const width = Math.round(targetHeight * ratio);
```

**问题 2：缺少 CODECS 属性**

`master.m3u8` 中没有 `CODECS` 属性。Apple 的 [HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) 要求所有包含 H.264 视频和 AAC 音频的变体流都必须包含此属性。没有它，AVFoundation 无法在播放前预先验证解码器兼容性，导致播放时触发意外错误。

### 3.3 第三阶段：解码 TS 分段验证

为了验证实际的编码参数，我们通过 curl 远程下载了一个 TS 分段，并用 Python 解析 H.264 SPS（Sequence Parameter Set）NAL 单元来验证编码配置：

```python
import struct

with open('segment_000.ts', 'rb') as f:
    data = f.read()

# Find SPS NAL unit (0x00 0x00 0x00 0x01 0x67)
idx = data.find(b'\x00\x00\x00\x01\x67')
sps = data[idx + 4:idx + 20]
print(' '.join(f'{b:02x}' for b in sps))
```

解码结果显示：

```text
SPS: 67 4d 40 28 ec a0 6c 1e f3 70 80

0x67 -> NAL unit type 7 (SPS)
0x4d -> profile_idc = 77 (Main Profile)
0x40 -> constraint_set1_flag
0x28 -> level_idc = 40 (Level 4.0)

编码宽度: (53 + 1) * 16 = 864 (16 对齐)
编码高度: (29 + 1) * 16 = 480 (16 对齐)
```

编码参数本身没有问题——profile、level、宏块对齐都正确。这说明问题不在编码层，而在 HLS Playlist 的元数据声明。

### 3.4 第四阶段：服务器日志的意外发现

查看服务器日志中的 ffprobe 输出，发现了一个被忽略的关键信息：

```text
Stream #0:0: Video: h264 (Main), yuv420p, 1920x926, 47.19 fps, 60 tbr
com.apple.quicktime.author: ReplayKitRecording
```

**源视频是 iOS ReplayKit 屏幕录制，帧率 47.19fps！**

H.264 Level 4.0 的宏块处理能力有限。根据 H.264 标准，Level 4.0 在 1080p（1920×1080）时的最大帧率是 **30fps**，对应 244,800 宏块/秒。47fps 的源视频意味着 1080p 变体严重超标——即使分辨率正确，VideoToolbox 解码器仍然会因为超出 Level 约束而拒绝解码。

## 4. 最终解决方案

综合以上发现，我们在 [`media-processor.service.ts`](apps/api/src/common/media/media-processor.service.ts) 中实施了四项修复。

### 4.1 编码参数修复

```bash
-profile:v main       # iOS VideoToolbox 兼容的 H.264 配置
-pix_fmt yuv420p      # 4:2:0 色度采样
-level 4.0            # Level 4.0
```

### 4.2 标准分辨率 + Padding

采用 `force_original_aspect_ratio=decrease` + `pad` 滤镜组合，确保输出分辨率严格对齐 16 的倍数：

```typescript
const scaleFilter =
  `scale=${qt.width}:${qt.height}:force_original_aspect_ratio=decrease,` +
  `pad=${qt.width}:${qt.height}:(ow-iw)/2:(oh-ih)/2`;
```

关键设计要点：

- `force_original_aspect_ratio=decrease` — 缩放时保持原始宽高比，不会拉伸变形，且自带防止放大功能
- `pad` — 在缩放后的视频周围填充黑边，精确填充到目标分辨率
- 这种组合可以处理任意宽高比的源视频（例如 1920×926 的电影宽屏），输出始终是标准 16:9 分辨率

对应的质量目标定义：

```typescript
const qualityTargets: QualityTarget[] = [
  { name: '480p',  width: 854,  height: 480,  bandwidth: '800k' },
  { name: '720p',  width: 1280, height: 720,  bandwidth: '2800k' },
];

if (maxSourceDimension >= 1080) {
  qualityTargets.push({ name: '1080p', width: 1920, height: 1080, bandwidth: '5000k' });
}
```

### 4.3 帧率限制

```bash
-r 30  # 强制 30fps
```

这确保了 Level 4.0 约束在任何源视频下都能满足。无论是 ReplayKit 的 47fps 还是其他高帧率源，输出始终是 30fps。

### 4.4 CODECS 属性

在生成 `master.m3u8` 时，为每个变体流添加 `CODECS` 属性：

```typescript
const codecs = 'avc1.4D4028,mp4a.40.2';

// 每个变体流都包含 CODECS
variantStreams.push(
  `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}:${height},CODECS="${codecs}"\n${name}/playlist.m3u8`,
);
```

`avc1.4D4028` 的含义：

- `4D` (77) = Main Profile
- `40` = constraint_set1_flag (符合 Main Profile 约束)
- `28` (40) = Level 4.0

`mp4a.40.2` 则是 AAC-LC（Low Complexity）音频编码的标准标识。

## 5. 修复后的效果

修复后生成的 `master.m3u8` 如下：

```text
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854:480,CODECS="avc1.4D4028,mp4a.40.2"
480p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280:720,CODECS="avc1.4D4028,mp4a.40.2"
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920:1080,CODECS="avc1.4D4028,mp4a.40.2"
1080p/playlist.m3u8
```

所有分辨率都是 16 的倍数，并且包含 `CODECS` 属性。iOS AVPlayer 可以正常解析和播放。

## 6. 为什么旧视频能正常播放？

一个常见的困惑是：为什么几个月前上传的旧视频能正常播放，而新视频却不行？

答案通常是**源视频特性不同**：

| 特性 | 旧视频（正常工作） | 新视频（-12642 失败） |
|------|---------------------|----------------------|
| 帧率 | 30fps（标准） | 47.19fps（ReplayKit） |
| 宽高比 | 16:9（标准） | 1920×926（非标准） |
| 分辨率对齐 | 自动对齐 16 倍数 | 依赖动态计算 |

旧视频恰好满足 iOS 的兼容性要求，而新视频的非标准特性被旧转码逻辑放大，最终触发了 `-12642` 错误。

## 7. 技术要点总结

### H.264 Level 约束

| Level | 最大分辨率 | 最大帧率 | 最大宏块/秒 |
|-------|-----------|---------|------------|
| 3.1 | 1280×720 | 30fps | 180,000 |
| 4.0 | 1920×1080 | 30fps | 245,760 |
| 4.1 | 1920×1080 | 30fps | 245,760 |
| 4.2 | 1920×1080 | 60fps | 522,240 |

### iOS VideoToolbox 要求

| 参数 | 要求 |
|------|------|
| H.264 配置文件 | Baseline, Main, High |
| 色度采样 | 4:2:0 (yuv420p) |
| 宽度对齐 | 16 的倍数（宏块对齐） |
| CODECS 属性 | 必需（Apple HLS 规范） |
| Level 兼容性 | 必须满足对应分辨率的帧率上限 |

### 故障排查清单

当 iOS HLS 播放失败时，按此顺序检查：

1. **Master Playlist** — 检查分辨率（% 16 对齐）、CODECS 属性
2. **TS 分段 SPS** — 解码验证 profile、level、编码分辨率
3. **源视频属性** — 检查帧率（>30fps @ 1080p？）、宽高比
4. **FFmpeg 命令** — 是否包含 `-profile:v main`、`-pix_fmt yuv420p`、`-level 4.0`、`-r 30`？
5. **上传顺序** — `master.m3u8` 是否最后上传？

## 8. 总结

1. iOS HLS 的 `-12642` 错误通常是多个因素共同作用的结果——非标准分辨率、缺失 CODECS 属性、高帧率源视频超出 Level 约束
2. FFmpeg 转码必须显式指定 `-profile:v main -pix_fmt yuv420p -level 4.0`，不能依赖默认值
3. 使用 `force_original_aspect_ratio=decrease` + `pad` 滤镜组合处理非标准宽高比源视频，确保输出分辨率严格 16 对齐
4. 始终添加 `-r 30` 限制帧率，防范 ReplayKit 等高帧率源视频超出 H.264 Level 约束
5. Apple HLS Authoring Specification 要求 `master.m3u8` 必须包含 `CODECS` 属性，否则 AVFoundation 无法预先验证解码器兼容性
6. 对源视频不做任何假设——一个健壮的转码服务应该能够处理各种非标准输入，并将其转换为符合 iOS 标准的输出

*本文源码基于 [`media-processor.service.ts`](apps/api/src/common/media/media-processor.service.ts)（241-422 行），完整包含 FFmpeg 转码参数配置、多质量版本生成、scale/pad 滤镜实现及 master.m3u8 生成逻辑。*
