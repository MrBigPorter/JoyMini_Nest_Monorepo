# iOS HLS 视频播放的坑与解：CoreMediaErrorDomain -12642 全面分析

## 引言

在移动端开发中，视频播放是最常见的功能之一。然而，iOS 上的 HLS（HTTP Live Streaming）播放经常遇到各种问题。其中最令人头疼的莫过于 `CoreMediaErrorDomain error -12642 (FormatUnsupported)`。

这个错误通常发生在新上传的视频上，而旧的视频却能正常播放，让人摸不着头脑。本文将通过一个真实的排查案例，深入分析这个错误的根本原因，并提供一套通用的解决策略。

## 什么是 CoreMediaErrorDomain -12642?

`CoreMediaErrorDomain error -12642` 在 Apple 的 CoreMedia 框架中定义为 `kCMFormatDescriptionError_FormatUnsupported`。当 `AVPlayer` 尝试播放一段视频，但 `VideoToolbox`（iOS 硬件视频解码器）无法解码时，就会抛出这个错误。

简单来说，系统告诉你："这段视频我解码不了"。

## 系统架构

我们使用 NestJS 作为后端服务，通过 FFmpeg 将用户上传的视频转码为 HLS 格式：

```
用户上传 MP4 → FFmpeg 转码 HLS → 上传到 R2/CDN → 前端播放
                                                      ↓
                                            hls.js (Web) / AVPlayer (iOS)
```

### 后端转码流程

后端使用 `child_process.spawn` 执行 FFmpeg，为每个视频生成三个质量版本（480p、720p、1080p），每个版本包含：
- 一个 `playlist.m3u8`（变体播放列表）
- 多个 `.ts` 分段（MPEG-TS 容器中的 H.264 视频）
- 一个 `master.m3u8`（主播放列表，引用所有变体）

### 上传流程

上传顺序至关重要：先上传 TS 分段和变体播放列表，最后上传 `master.m3u8`。这样可以确保当客户端获取 `master.m3u8` 时，所有资源都已经可用。

## 排查过程

### 第一阶段：初步分析

最初的 FFmpeg 命令缺少对 iOS 兼容性的关键参数。通过分析错误的触发条件，我们添加了：

```
-profile:v main     # H.264 Main Profile
-pix_fmt yuv420p    # 4:2:0 色度采样
-level 4.0          # Level 4.0
```

### 第二阶段：发现真正的罪魁祸首

部署后发现 iOS**仍然**报错。于是我们开始深入检查 `master.m3u8`：

```
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=860:480
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1288:720
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1934:1080
```

**问题 1：非标准分辨率**

iOS VideoToolbox 硬件解码器要求宽度是 16 的倍数（宏块对齐）。而：
- `860 % 16 = 12` ❌
- `1288 % 16 = 8` ❌
- `1934 % 16 = 6` ❌

**问题 2：缺少 CODECS 属性**

`master.m3u8` 中没有 `CODECS` 属性。Apple 的 HLS 编写规范要求所有包含 H.264 视频和 AAC 音频的流都必须包含此属性，否则 AVFoundation 无法在播放前预先验证解码器兼容性。

### 第三阶段：解码 TS 分段

为了验证实际的编码参数，我们远程下载了一个 TS 分段，并通过十六进制解码 H.264 SPS（序列参数集）NAL 单元：

```
SPS: 67 4d 40 28 ec a0 6c 1e f3 70 80...

0x67 → NAL 单元类型 7 (SPS)
0x4d → profile_idc = 77 (Main Profile) ✅
0x40 → constraint_set1_flag
0x28 → level_idc = 40 (Level 4.0) ✅

编码宽度: (53 + 1) × 16 = 864 ✅ (16 对齐)
编码高度: (29 + 1) × 16 = 480 ✅ (16 对齐)
```

### 第四阶段：服务器日志的意外发现

查看服务器日志中的 ffprobe 输出，发现了一个被忽略的关键信息：

```
Stream #0:0: Video: h264 (Main), yuv420p, 1920x926, 47.19 fps, 60 tbr
com.apple.quicktime.author: ReplayKitRecording
```

**源视频是 iOS ReplayKit 屏幕录制，帧率 47.19fps！**

H.264 Level 4.0 在 1080p 时的最大帧率是 **30fps**。47fps 的源视频意味着 1080p 变体严重超标。这解释了为什么分辨率修复后问题仍然存在。

## 最终解决方案

针对发现的问题，我们实施了以下修复：

### 修复 1：编码参数

```bash
-profile:v main       # iOS VideoToolbox 兼容
-pix_fmt yuv420p      # 4:2:0 色度
-level 4.0            # Level 4.0
```

### 修复 2：标准分辨率 + Padding

采用 `force_original_aspect_ratio=decrease` + `pad` 滤镜组合：

```typescript
const scaleFilter =
  `scale=${qt.width}:${qt.height}:force_original_aspect_ratio=decrease,` +
  `pad=${qt.width}:${qt.height}:(ow-iw)/2:(oh-ih)/2`;
```

这样即使源视频不是 16:9（例如 1920×926 的电影宽屏），也会被缩放并填充到精确的标准分辨率。

### 修复 3：帧率限制

```bash
-r 30  # 强制 30fps
```

这确保了 Level 4.0 约束在任何源视频下都能满足。

### 修复 4：CODECS 属性

```typescript
const codecs = 'avc1.4D4028,mp4a.40.2';
// 生成:
// #EXT-X-STREAM-INF:...,CODECS="avc1.4D4028,mp4a.40.2"
```

`avc1.4D4028` 的含义：
- `4D` (77) = Main Profile
- `40` = constraint_set1_flag
- `28` (40) = Level 4.0

## 修复后的 Master Playlist

```
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854:480,CODECS="avc1.4D4028,mp4a.40.2"
480p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280:720,CODECS="avc1.4D4028,mp4a.40.2"
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920:1080,CODECS="avc1.4D4028,mp4a.40.2"
1080p/playlist.m3u8
```

包含 `CODECS` 属性和标准分辨率后，iOS 播放验证通过。

## 为什么旧视频能正常播放？

一个常见的困惑是：为什么几个月前上传的旧视频能正常播放，而新视频却不行？

答案通常是**源视频特性不同**。旧视频可能是标准的 30fps 16:9 视频，恰好满足 iOS 的兼容性要求。而新视频（尤其是来自 ReplayKit 等屏幕录制的视频）可能具有非标准的帧率、分辨率或编码参数，一旦后端转码逻辑不能妥善处理，就会触发错误。

## 技术要点总结

### H.264 Level 约束

| Level | 最大分辨率 | 最大帧率 | 最大宏块/秒 |
|-------|-----------|---------|------------|
| 3.1   | 1280×720 | 30fps   | 180,000 |
| 4.0   | 1920×1080 | 30fps  | 245,760 |
| 4.1   | 1920×1080 | 30fps  | 245,760 |
| 4.2   | 1920×1080 | 60fps  | 522,240 |

### iOS VideoToolbox 要求

| 参数 | 要求 |
|------|------|
| H.264 配置文件 | Baseline, Main, High |
| 色度采样 | 4:2:0 (yuv420p) |
| 宽度对齐 | 16 的倍数（宏块） |
| CODECS 属性 | **必需**（Apple HLS 规范） |

### 故障排查清单

当 iOS HLS 播放失败时，按此顺序检查：

1. **Master Playlist** → 检查分辨率、CODECS 属性
2. **TS 分段 SPS** → 解码验证 profile、level、分辨率
3. **源视频属性** → 检查帧率（>30fps @ 1080p？）
4. **FFmpeg 命令** → 是否包含所有必要参数？
5. **上传顺序** → master.m3u8 是否最后上传？

## 结论

iOS HLS 的 `-12642` 错误通常是多个因素共同作用的结果。在我们的案例中，罪魁祸首包括：非标准分辨率、缺失 CODECS 属性、以及被忽视的源视频高帧率问题。

通过系统性的排查——从 Playlist 分析到 TS 分段解码，再到服务器日志审查——我们找到了所有问题并逐一修复。修复后的转码流程能够自动处理所有非标准输入，确保在任何 iOS 设备上都能流畅播放 HLS 视频。

关键经验：**不要对源视频做任何假设**。一个健壮的转码服务应该能够处理各种非标准的输入，并将其转换为符合 iOS 标准的输出。
