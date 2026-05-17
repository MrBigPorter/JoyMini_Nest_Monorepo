# iOS HLS Playback Issue: CoreMediaErrorDomain -12642 修复总结

## 问题

用户在 iOS 设备上播放 HLS 视频时遇到 `CoreMediaErrorDomain error -12642 (FormatUnsupported)` 错误。后端使用 NestJS + FFmpeg 将上传的视频转码为 HLS 格式，前端使用 `react-native-video` (AVPlayer) 在 iOS 上播放。系统会回退到 MP4 播放，但 HLS 无法正常工作。

## 调查过程

### 第 1 步：分析 Master Playlist

通过 curl 获取 `master.m3u8`，发现分辨率不符合标准 16:9：

```
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=860:480
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1288:720
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1934:1080
```

iOS VideoToolbox 硬件解码器要求宽度为 16 的倍数（宏块对齐），而 `860 % 16 = 12`、`1288 % 16 = 8`、`1934 % 16 = 6`。

### 第 2 步：分析 TS 分段（深层剖析）

通过远程下载 TS 分段并对 SPS（序列参数集）NAL 单元进行十六进制解码，验证了实际的编码流参数：

```
SPS: 67 4d 40 28 ec a0 6c 1e f3 70 80...
- profile_idc: 0x4d = 77 = Main Profile
- level_idc: 0x28 = 40 = Level 4.0
- 编码宽度: 864 (54 × 16 宏块)
- 编码高度: 480 (30 × 16 宏块)
```

### 第 3 步：发现隐藏问题

服务器日志中的 ffprobe 输出揭示：

```
Stream #0:0: Video: h264 (Main), yuv420p, 1920x926, 47.19 fps, 60 tbr
com.apple.quicktime.author: ReplayKitRecording
```

源视频是 **47.19fps 的 iOS ReplayKit 屏幕录制**！这导致：
- 1080p 变体超出 H.264 Level 4.0 约束（最大 30fps @ 1080p）
- `master.m3u8` 缺少 `CODECS` 属性，AVFoundation 无法预验证解码器兼容性

## 修复方案

### 修复 1：H.264 编码参数

```bash
-profile:v main       # iOS VideoToolbox 仅支持到 Main Profile
-pix_fmt yuv420p      # iOS HW 解码器仅支持 4:2:0 色度采样
-level 4.0            # 涵盖 1080p@30fps，兼容性最广
```

### 修复 2：标准分辨率 + Pad

对非 16:9 源视频采用 `force_original_aspect_ratio=decrease` + `pad`：

```bash
-vf "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2"
```

质量目标使用标准 16:9 分辨率：

| Variant | 分辨率 |
|---------|----------|
| 480p    | 854 × 480 |
| 720p    | 1280 × 720 |
| 1080p   | 1920 × 1080 |

### 修复 3：帧率限制

```bash
-r 30  # 强制 30fps 输出，确保 Level 4.0 合规
```

### 修复 4：CODECS 属性

Apple HLS 编写规范明确要求 H.264 + AAC 流必须包含 CODECS 属性：

```
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854:480,CODECS="avc1.4D4028,mp4a.40.2"
```

其中 `avc1.4D4028`：
- `4D` = Main Profile (profile_idc=77)
- `40` = constraint_set1_flag
- `28` = Level 4.0

## 验证

修复后输出正确的 Master Playlist：

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

iOS HLS 播放经过实际设备验证，确认正常工作。

## 经验教训

1. **不要假设源视频参数** — ReplayKit 屏幕录制可能具有非标准的帧率和分辨率
2. **H.264 Level 约束很重要** — Level 4.0 @ 1080p 最大 30fps，Level 4.1 @ 1080p 最大 30fps（相同），Level 4.2 @ 1080p 最大 60fps
3. **Apple 的 CODECS 是必需项** — 尽管 RFC 说 "SHOULD"，但 Apple 实现将其视为 "MUST"
4. **务必检查索引宏块对齐** — iOS VideoToolbox 要求宽度为 16 的倍数
5. **服务器端日志包含无价的信息** — ffprobe 输出揭示了源视频的真实特性
