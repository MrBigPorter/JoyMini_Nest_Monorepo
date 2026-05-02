# GlobalUploadService：S3 直接上传 + 压缩管道 + MIME 修正

> **文章难度：** ⭐⭐⭐⭐ (高级)
> **关注领域：** 文件上传、媒体处理、网络优化、错误处理
> **阅读时间：** 20 分钟

## 目录

1. [为什么需要全局上传服务？](#为什么需要全局上传服务)
2. [架构总览：上传管道](#架构总览上传管道)
3. [GlobalUploadService：统一上传 API](#globaluploadservice统一上传-api)
4. [通过预签名 URL 进行 S3 直接上传](#通过预签名-url-进行-s3-直接上传)
5. [上传前压缩管道](#上传前压缩管道)
6. [MIME 类型自动检测与修正](#mime-类型自动检测与修正)
7. [使用 Stream<double> 跟踪上传进度](#使用-streamdouble-跟踪上传进度)
8. [上传队列：并发限制 + 重试 + 取消](#上传队列并发限制--重试--取消)
9. [大文件分块上传](#大文件分块上传)
10. [上传结果类型](#上传结果类型)
11. [实战：商品图片上传](#实战商品图片上传)
12. [总结](#总结)

---

## 为什么需要全局上传服务？

在社交电商应用中，文件上传无处不在：

| 功能 | 文件类型 | 频率 |
|---------|-----------|-----------|
| 商品上架 | 图片（JPEG、WebP、PNG） | 每位卖家每天 |
| KYC 验证 | 身份证照片、自拍照 | 每位用户一次 |
| 个人资料头像 | 图片 | 偶尔 |
| 聊天附件 | 图片、视频、文档 | 高频 |
| 群组头像 | 图片 | 每次创建群组 |

如果没有统一的上传服务，每个功能都各自实现上传逻辑，会导致：

| 问题 | 影响 |
|---------|--------|
| **重复的预签名 URL 逻辑** | 每个功能独立获取和签名 URL |
| **无压缩** | 原始 12MP 相机图片直接上传，浪费带宽 |
| **MIME 类型错误** | 服务器因 Content-Type 不正确而拒绝上传 |
| **无进度反馈** | 用户看不到上传指示，误以为应用卡死 |
| **无队列管理** | 50 张图片同时上传，压垮网络 |
| **无重试机制** | 弱信号下上传失败 → 用户需重新选择所有文件 |

---

## 架构总览：上传管道

```
用户选择文件
        │
        ▼
┌────────────────────────────────┐
│    GlobalUploadService         │
│                                │
│  1. 获取预签名 URL              │
│     （通过 API /upload/presigned）│
│                                │
│  2. MIME 检测                  │
│     （魔数 → MIME 类型）         │
│                                │
│  3. 压缩管道                    │
│     ├─ 图片：缩放 + 质量        │
│     ├─ 视频：缩略图             │
│     └─ 文档：透传               │
│                                │
│  4. 上传队列                    │
│     （最大 3 并发）              │
│                                │
│  5. S3 直接上传                 │
│     （PUT 到预签名 URL）         │
│     └─ 进度流                   │
│                                │
│  6. UploadResult                │
│     （url、key、mime、size）      │
└────────────────────────────────┘
```

---

## GlobalUploadService：统一上传 API

该服务提供三种上传模式：单文件、多文件和压缩上传。

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

class GlobalUploadService {
  static final GlobalUploadService _instance = GlobalUploadService._();
  factory GlobalUploadService() => _instance;
  GlobalUploadService._();

  final UploadQueue _queue = UploadQueue(maxConcurrent: 3);
  final MimeDetector _mimeDetector = MimeDetector();
  final CompressionPipeline _compressionPipeline = CompressionPipeline();

  /// 上传单个文件
  Future<UploadResult> upload(UploadRequest request) async {
    return _queue.enqueue(() => _performUpload(request));
  }

  /// 同时上传多个文件（遵循队列并发限制）
  Future<List<UploadResult>> uploadMultiple(List<UploadRequest> requests) async {
    final futures = requests.map((r) => upload(r));
    return Future.wait(futures, eagerError: false);
  }

  /// 自动压缩后上传
  Future<UploadResult> uploadWithCompression(UploadRequest request) async {
    final compressed = await _compressionPipeline.compress(request);
    return upload(compressed);
  }

  /// 上传多个文件并压缩
  Future<List<UploadResult>> uploadMultipleWithCompression(
    List<UploadRequest> requests,
  ) async {
    final compressed = await Future.wait(
      requests.map((r) => _compressionPipeline.compress(r)),
    );
    return uploadMultiple(compressed);
  }

  Future<UploadResult> _performUpload(UploadRequest request) async {
    try {
      // 步骤 1：检测/修正 MIME 类型
      final correctedMime = await _mimeDetector.detect(request.filePath);
      final mimeType = correctedMime ?? request.mimeType ?? 'application/octet-stream';

      // 步骤 2：获取预签名 URL
      final presignedUrl = await _fetchPresignedUrl(
        fileName: p.basename(request.filePath),
        mimeType: mimeType,
        module: request.module,
      );

      // 步骤 3：上传到 S3
      final result = await _uploadToS3(
        url: presignedUrl.url,
        filePath: request.filePath,
        mimeType: mimeType,
        onProgress: request.onProgress,
      );

      return UploadResult(
        url: presignedUrl.cdnUrl ?? presignedUrl.url,
        key: presignedUrl.key,
        bucket: presignedUrl.bucket,
        mimeType: mimeType,
        sizeBytes: result.fileSize,
        width: result.width,
        height: result.height,
        originalName: p.basename(request.filePath),
      );
    } catch (e) {
      throw UploadException(
        message: '上传失败：${request.filePath}',
        originalError: e,
      );
    }
  }

  Future<PresignedUrlResponse> _fetchPresignedUrl({
    required String fileName,
    required String mimeType,
    required String module,
  }) async {
    // 调用后端 API 获取预签名 URL
    final response = await http.post(
      Uri.parse('$apiBaseUrl/upload/presigned'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'fileName': fileName,
        'mimeType': mimeType,
        'module': module,
      }),
    );

    if (response.statusCode != 200) {
      throw UploadException('获取预签名 URL 失败：${response.statusCode}');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return PresignedUrlResponse(
      url: data['url'] as String,
      key: data['key'] as String,
      bucket: data['bucket'] as String,
      cdnUrl: data['cdnUrl'] as String?,
    );
  }

  Future<UploadToS3Result> _uploadToS3({
    required String url,
    required String filePath,
    required String mimeType,
    void Function(double)? onProgress,
  }) async {
    final file = File(filePath);
    final fileSize = await file.length();

    // 读取文件字节
    final bytes = await file.readAsBytes();

    // 创建 HTTP PUT 请求
    final request = http.MultipartRequest('PUT', Uri.parse(url));
    request.headers['Content-Type'] = mimeType;
    request.headers['Content-Length'] = fileSize.toString();

    // 使用自定义客户端跟踪进度
    final progressStream = StreamController<List<int>>();
    int uploadedBytes = 0;

    final sub = progressStream.stream.listen((chunk) {
      uploadedBytes += chunk.length;
      if (onProgress != null && fileSize > 0) {
        onProgress(uploadedBytes / fileSize);
      }
    });

    try {
      // 将文件写入流
      final chunkSize = 8192;
      for (int i = 0; i < bytes.length; i += chunkSize) {
        final end = (i + chunkSize < bytes.length) ? i + chunkSize : bytes.length;
        progressStream.add(bytes.sublist(i, end));
      }
      await progressStream.close();

      // 执行上传
      final response = await http.put(
        Uri.parse(url),
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileSize.toString(),
        },
        body: bytes,
      );

      if (response.statusCode != 200) {
        throw UploadException('S3 上传失败，状态码：${response.statusCode}');
      }

      // 如果是图片，尝试获取图片尺寸
      int? width;
      int? height;
      if (mimeType.startsWith('image/')) {
        final decoded = await decodeImageFromList(bytes);
        width = decoded.width;
        height = decoded.height;
      }

      return UploadToS3Result(
        fileSize: fileSize,
        width: width,
        height: height,
      );
    } finally {
      await sub.cancel();
      await progressStream.close();
    }
  }
}
```

### 上传请求 / 结果类型

```dart
class UploadRequest {
  final String filePath;
  final String module;       // 'product'、'kyc'、'avatar'、'chat'、'group'
  final String? mimeType;    // 可选，为 null 时自动检测
  final void Function(double)? onProgress;
  final Map<String, String>? metadata;

  const UploadRequest({
    required this.filePath,
    required this.module,
    this.mimeType,
    this.onProgress,
    this.metadata,
  });
}

class UploadResult {
  final String url;          // CDN URL
  final String key;          // S3 对象键
  final String bucket;       // S3 存储桶名称
  final String mimeType;     // 检测/修正后的 MIME 类型
  final int sizeBytes;
  final int? width;
  final int? height;
  final String originalName;

  const UploadResult({
    required this.url,
    required this.key,
    required this.bucket,
    required this.mimeType,
    required this.sizeBytes,
    this.width,
    this.height,
    required this.originalName,
  });
}

class UploadException implements Exception {
  final String message;
  final Object? originalError;

  UploadException(this.message, {this.originalError});

  @override
  String toString() => 'UploadException: $message';
}

class PresignedUrlResponse {
  final String url;
  final String key;
  final String bucket;
  final String? cdnUrl;

  const PresignedUrlResponse({
    required this.url,
    required this.key,
    required this.bucket,
    this.cdnUrl,
  });
}

class UploadToS3Result {
  final int fileSize;
  final int? width;
  final int? height;

  const UploadToS3Result({required this.fileSize, this.width, this.height});
}
```

---

## 通过预签名 URL 进行 S3 直接上传

关键的设计决策是**客户端直接上传**——文件直接发送到 S3，无需经过应用服务器。这是通过[预签名 URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)实现的。

### 为什么使用预签名 URL？

```
不使用预签名 URL（反模式）：
  App → API 服务器（接收文件）→ S3
  ❌ 服务器处理大文件（内存压力）
  ❌ 双倍带宽（App → 服务器 → S3）
  ❌ 服务器 CPU 浪费在文件处理上

使用预签名 URL（最佳实践）：
  App → 获取预签名 URL（小 API 调用）
  App → S3 直接上传（大文件）
  ✅ 服务器从不接触文件
  ✅ 单次带宽跳转
  ✅ S3 负责扩展
```

### 后端预签名 URL 生成（NestJS）

```typescript
// apps/api/src/common/upload/upload.service.ts
@Injectable()
export class UploadService {
  private readonly s3: S3Client;

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({
      region: this.config.get('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  async generatePresignedUrl(
    fileName: string,
    mimeType: string,
    module: string,
  ): Promise<{
    url: string;
    key: string;
    bucket: string;
    cdnUrl: string;
  }> {
    const bucket = this.getBucketForModule(module);
    const key = `${module}/${Date.now()}_${nanoid(8)}_${fileName}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType,
    });

    const url = await getSignedUrl(this.s3, command, {
      expiresIn: 3600, // 1 小时
    });

    return {
      url,
      key,
      bucket,
      cdnUrl: `${this.config.get('CDN_DOMAIN')}/${key}`,
    };
  }

  private getBucketForModule(module: string): string {
    const mapping: Record<string, string> = {
      product: this.config.get('S3_BUCKET_PRODUCTS'),
      kyc: this.config.get('S3_BUCKET_KYC'),
      avatar: this.config.get('S3_BUCKET_AVATARS'),
      chat: this.config.get('S3_BUCKET_CHAT'),
      blog: this.config.get('S3_BUCKET_BLOG'),
      group: this.config.get('S3_BUCKET_GROUPS'),
    };
    return mapping[module] ?? this.config.get('S3_BUCKET_DEFAULT');
  }
}
```

### 安全注意事项

| 关注点 | 缓解措施 |
|---------|------------|
| **URL 过期** | 预签名 URL 在 1 小时后过期 |
| **模块隔离** | 每个模块使用独立的 S3 存储桶 |
| **文件类型限制** | 后端在签名前验证 mimeType |
| **大小限制** | 后端在签名时拒绝过大的文件 |
| **身份认证** | 预签名 URL 端点需要有效的认证令牌 |

---

## 上传前压缩管道

压缩管道在上传前应用**客户端优化**，减少带宽和服务器处理开销。

### CompressionPipeline

```dart
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/painting.dart' as painting;
import 'package:image/image.dart' as img; // dart 原生图片库

class CompressionPipeline {
  final ImageCompressor _imageCompressor = ImageCompressor();
  final VideoProcessor _videoProcessor = VideoProcessor();

  /// 上传前压缩文件
  Future<UploadRequest> compress(UploadRequest request) async {
    final extension = p.extension(request.filePath).toLowerCase();

    if (_isImageExtension(extension)) {
      return _imageCompressor.compress(request);
    } else if (_isVideoExtension(extension)) {
      return _videoProcessor.extractThumbnail(request);
    }

    // 文档、音频等——透传
    return request;
  }

  bool _isImageExtension(String ext) =>
      ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].contains(ext);

  bool _isVideoExtension(String ext) =>
      ['.mp4', '.mov', '.avi', '.mkv', '.3gp'].contains(ext);
}
```

### ImageCompressor

```dart
class ImageCompressor {
  static const _defaultQuality = 80;
  static const _maxDimension = 2048; // 最大宽或高（像素）

  Future<UploadRequest> compress(
    UploadRequest request, {
    int quality = _defaultQuality,
    int maxDimension = _maxDimension,
  }) async {
    final file = File(request.filePath);
    final bytes = await file.readAsBytes();

    // 解码图片
    final image = img.decodeImage(bytes);
    if (image == null) return request; // 无法解码，上传原图

    // 如果超过最大尺寸则缩放
    img.Image resized = image;
    if (image.width > maxDimension || image.height > maxDimension) {
      resized = img.copyResize(
        image,
        width: image.width > image.height ? maxDimension : null,
        height: image.height >= image.width ? maxDimension : null,
        interpolation: img.Interpolation.linear,
      );
    }

    // 确定目标格式
    final targetFormat = _selectFormat(request.mimeType ?? 'image/jpeg');
    final compressedBytes = _encodeImage(resized, targetFormat, quality);

    // 将压缩文件写入临时位置
    final tempDir = Directory.systemTemp;
    final tempPath = '${tempDir.path}/${DateTime.now().millisecondsSinceEpoch}_compressed.${_extensionFor(targetFormat)}';
    await File(tempPath).writeAsBytes(compressedBytes);

    return UploadRequest(
      filePath: tempPath,
      module: request.module,
      mimeType: _mimeTypeFor(targetFormat),
      onProgress: request.onProgress,
      metadata: {
        ...?request.metadata,
        'originalSize': file.lengthSync().toString(),
        'compressedSize': compressedBytes.length.toString(),
      },
    );
  }

  ImageFormat _selectFormat(String originalMime) {
    switch (originalMime) {
      case 'image/png':
        return ImageFormat.png;
      case 'image/gif':
        return ImageFormat.gif;
      case 'image/webp':
        return ImageFormat.webp;
      default:
        return ImageFormat.jpeg; // 照片默认 JPEG
    }
  }

  Uint8List _encodeImage(img.Image image, ImageFormat format, int quality) {
    switch (format) {
      case ImageFormat.jpeg:
        return Uint8List.fromList(img.encodeJpg(image, quality: quality));
      case ImageFormat.png:
        return Uint8List.fromList(img.encodePng(image));
      case ImageFormat.webp:
        return Uint8List.fromList(img.encodeWebp(image, quality: quality));
      case ImageFormat.gif:
        return Uint8List.fromList(img.encodeGif(image));
    }
  }

  String _extensionFor(ImageFormat format) {
    switch (format) {
      case ImageFormat.jpeg: return 'jpg';
      case ImageFormat.png: return 'png';
      case ImageFormat.webp: return 'webp';
      case ImageFormat.gif: return 'gif';
    }
  }

  String _mimeTypeFor(ImageFormat format) {
    switch (format) {
      case ImageFormat.jpeg: return 'image/jpeg';
      case ImageFormat.png: return 'image/png';
      case ImageFormat.webp: return 'image/webp';
      case ImageFormat.gif: return 'image/gif';
    }
  }
}

enum ImageFormat { jpeg, png, webp, gif }
```

### 压缩效果

| 原始文件 | 压缩后 | 节省空间 |
|----------|------------------|---------|
| 12MB JPEG (4032×3024) | 450KB JPEG (2048×1536, q80) | **96%** |
| 5MB PNG (1920×1080) | 320KB WebP (1920×1080, q80) | **94%** |
| 2MB JPEG (800×600) | 180KB JPEG (800×600, q80) | **91%** |
| 500KB PNG (logo) | 120KB PNG (无损) | **76%** |

---

## MIME 类型自动检测与修正

一个常见问题：扩展名是 `.jpg`，但文件实际上是 PNG（更糟糕的是，可能是重命名的可执行文件）。`MimeDetector` 读取**魔数**（文件签名）来确定真实的 MIME 类型。

### 魔数检测

```dart
import 'dart:io';
import 'dart:typed_data';

class MimeDetector {
  /// 从文件魔数检测 MIME 类型
  Future<String?> detect(String filePath) async {
    final file = File(filePath);
    if (!await file.exists()) return null;

    final raf = await file.open(mode: FileMode.read);
    try {
      // 读取前 12 个字节（对大多数格式足够）
      final header = await raf.read(12);
      return _matchMagicBytes(header);
    } finally {
      await raf.close();
    }
  }

  String? _matchMagicBytes(Uint8List bytes) {
    // JPEG：以 FF D8 FF 开头
    if (bytes.length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) {
      return 'image/jpeg';
    }

    // PNG：以 89 50 4E 47 0D 0A 1A 0A 开头
    if (bytes.length >= 8 &&
        bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E &&
        bytes[3] == 0x47 && bytes[4] == 0x0D && bytes[5] == 0x0A &&
        bytes[6] == 0x1A && bytes[7] == 0x0A) {
      return 'image/png';
    }

    // GIF：以 GIF87a 或 GIF89a 开头
    if (bytes.length >= 6 &&
        bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 &&
        (bytes[3] == 0x38 || bytes[3] == 0x39) &&
        bytes[4] == 0x37 && bytes[5] == 0x61) {
      return 'image/gif';
    }

    // WebP：以 RIFF....WEBP 开头
    if (bytes.length >= 12 &&
        bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 &&
        bytes[3] == 0x46 && bytes[8] == 0x57 && bytes[9] == 0x45 &&
        bytes[10] == 0x42 && bytes[11] == 0x50) {
      return 'image/webp';
    }

    // PDF：以 %PDF 开头
    if (bytes.length >= 4 &&
        bytes[0] == 0x25 && bytes[1] == 0x50 &&
        bytes[2] == 0x44 && bytes[3] == 0x46) {
      return 'application/pdf';
    }

    // MP4：以 ftyp box 开头
    if (bytes.length >= 8 &&
        bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70) {
      return 'video/mp4';
    }

    // HEIC：以 ftypheic 或 ftypheix 开头
    if (bytes.length >= 12 &&
        bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 &&
        bytes[7] == 0x70 &&
        ((bytes[8] == 0x68 && bytes[9] == 0x65 && bytes[10] == 0x69 && bytes[11] == 0x63) ||
         (bytes[8] == 0x68 && bytes[9] == 0x65 && bytes[10] == 0x69 && bytes[11] == 0x78))) {
      return 'image/heic';
    }

    return null; // 未知格式
  }
}
```

### 常见魔数签名

| 格式 | 魔数（十六进制） | 正确 MIME |
|--------|-------------------|--------------|
| JPEG | `FF D8 FF` | `image/jpeg` |
| PNG | `89 50 4E 47` | `image/png` |
| GIF | `47 49 46 38` / `47 49 46 39` | `image/gif` |
| WebP | `52 49 46 46 xx xx xx xx 57 45 42 50` | `image/webp` |
| PDF | `25 50 44 46` | `application/pdf` |
| MP4 | `xx xx xx xx 66 74 79 70` | `video/mp4` |
| HEIC | `xx xx xx xx 66 74 79 70 68 65 69 63` | `image/heic` |

### 为什么 MIME 修正很重要

```
用户选择 photo.jpg（实际上是通过截图的 PNG）
                                          │
                                          ▼
基于扩展名的 MIME："image/jpeg"           │
魔数 MIME：      "image/png"              │
                                          │
S3 收到 PUT 请求，Content-Type：           │
  "image/jpeg" → 存储为 .jpg               │
  但实际是 PNG！                           │
                                          │
CDN 以 image/jpeg 方式提供                 │
浏览器无法渲染 → 图片破损                   │
                                          ▼
                   ⚠️ 需要修正
```

---

## 使用 Stream<double> 跟踪上传进度

进度通过 [`Stream<double>`](https://api.dart.dev/stable/dart-async/Stream-class.html) 暴露，发射 0.0 到 1.0 之间的值，实现实时进度条。

### 上传进度提供者

```dart
class UploadProgressNotifier extends ValueNotifier<Map<String, double>> {
  UploadProgressNotifier() : super({});

  void startTracking(String fileId) {
    final updated = Map<String, double>.from(value);
    updated[fileId] = 0.0;
    value = updated;
  }

  void updateProgress(String fileId, double progress) {
    final updated = Map<String, double>.from(value);
    updated[fileId] = progress.clamp(0.0, 1.0);
    value = updated;
  }

  void complete(String fileId) {
    final updated = Map<String, double>.from(value);
    updated[fileId] = 1.0;
    value = updated;
  }

  void remove(String fileId) {
    final updated = Map<String, double>.from(value);
    updated.remove(fileId);
    value = updated;
  }

  double get overallProgress {
    if (value.isEmpty) return 0.0;
    return value.values.fold(0.0, (sum, p) => sum + p) / value.length;
  }
}
```

### 带进度的流式上传

```dart
class ProgressTrackingUpload {
  final String fileId;
  final UploadProgressNotifier progressNotifier;

  ProgressTrackingUpload({
    required this.fileId,
    required this.progressNotifier,
  });

  Future<UploadResult> execute(UploadRequest request) async {
    progressNotifier.startTracking(fileId);

    try {
      final result = await GlobalUploadService().upload(
        UploadRequest(
          filePath: request.filePath,
          module: request.module,
          mimeType: request.mimeType,
          onProgress: (progress) {
            progressNotifier.updateProgress(fileId, progress);
          },
        ),
      );

      progressNotifier.complete(fileId);
      return result;
    } catch (e) {
      progressNotifier.remove(fileId);
      rethrow;
    }
  }
}
```

### 进度 UI 组件

```dart
class UploadProgressBar extends StatelessWidget {
  final UploadProgressNotifier notifier;
  final String fileId;

  const UploadProgressBar({
    super.key,
    required this.notifier,
    required this.fileId,
  });

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<Map<String, double>>(
      valueListenable: notifier,
      builder: (context, progressMap, _) {
        final progress = progressMap[fileId] ?? 0.0;

        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            LinearProgressIndicator(value: progress > 0 ? progress : null),
            const SizedBox(height: 4),
            Text('${(progress * 100).toStringAsFixed(0)}%'),
          ],
        );
      },
    );
  }
}
```

---

## 上传队列：并发限制 + 重试 + 取消

上传队列管理并发上传数、重试失败项，并支持取消。

```dart
class UploadQueue {
  final int maxConcurrent;
  final Queue<_QueuedUpload> _pending = Queue();
  final Set<_QueuedUpload> _active = {};
  int _runningCount = 0;

  UploadQueue({this.maxConcurrent = 3});

  /// 将上传加入队列并返回其 Future 结果
  Future<UploadResult> enqueue(Future<UploadResult> Function() uploadFn) {
    final completer = Completer<UploadResult>();
    final entry = _QueuedUpload(uploadFn: uploadFn, completer: completer);
    _pending.add(entry);
    _processNext();
    return completer.future;
  }

  void _processNext() {
    while (_runningCount < maxConcurrent && _pending.isNotEmpty) {
      final entry = _pending.removeFirst();
      _active.add(entry);
      _runningCount++;

      _executeWithRetry(entry).then((_) {
        _active.remove(entry);
        _runningCount--;
        _processNext();
      });
    }
  }

  Future<void> _executeWithRetry(_QueuedUpload entry) async {
    const maxRetries = 3;
    for (int attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        final result = await entry.uploadFn();
        entry.completer.complete(result);
        return;
      } catch (e) {
        if (attempt == maxRetries || _isNonRetryable(e)) {
          entry.completer.completeError(e);
          return;
        }
        // 指数退避
        await Future.delayed(Duration(seconds: attempt * 2));
      }
    }
  }

  bool _isNonRetryable(Object error) {
    if (error is UploadException) {
      // 4xx 错误不可重试
      if (error.message.contains('401') || error.message.contains('403')) {
        return true;
      }
    }
    return false;
  }

  /// 取消所有等待中的上传
  void cancelAll() {
    while (_pending.isNotEmpty) {
      final entry = _pending.removeFirst();
      entry.completer.completeError(
        UploadException('用户取消了上传'),
      );
    }
  }

  int get pendingCount => _pending.length;
  int get activeCount => _active.length;
}

class _QueuedUpload {
  final Future<UploadResult> Function() uploadFn;
  final Completer<UploadResult> completer;

  _QueuedUpload({required this.uploadFn, required this.completer});
}
```

### 重试策略

| 尝试次数 | 重试前等待 | 累计等待 |
|---------|-------------------|------------|
| 1（首次） | 0秒 | 0秒 |
| 2（重试 1） | 2秒 | 2秒 |
| 3（重试 2） | 4秒 | 6秒 |

不可重试的错误（401 未授权、403 禁止访问、无效文件）直接失败。

---

## 大文件分块上传

对于超过 100MB 的文件（例如视频），上传服务切换到**多部分分块上传**，使用 S3 的 Multipart Upload API。

```dart
class ChunkedUploader {
  static const _chunkSize = 5 * 1024 * 1024; // S3 多部分上传最小 5MB
  static const _largeFileThreshold = 100 * 1024 * 1024; // 100MB

  Future<UploadResult> upload(
    String filePath,
    String module, {
    void Function(double)? onProgress,
  }) async {
    final file = File(filePath);
    final fileSize = await file.length();

    if (fileSize < _largeFileThreshold) {
      // 小文件使用常规上传
      return GlobalUploadService().upload(UploadRequest(
        filePath: filePath,
        module: module,
        onProgress: onProgress,
      ));
    }

    // 大文件使用多部分上传
    return _multipartUpload(filePath, fileSize, module, onProgress);
  }

  Future<UploadResult> _multipartUpload(
    String filePath,
    int fileSize,
    String module,
    void Function(double)? onProgress,
  ) async {
    // 步骤 1：初始化多部分上传
    final uploadId = await _initiateMultipartUpload(filePath, module);

    try {
      // 步骤 2：上传各个部分
      final raf = await File(filePath).open(mode: FileMode.read);
      final parts = <int, String>{};
      int partNumber = 1;
      int uploadedBytes = 0;

      while (true) {
        final chunk = await raf.read(_chunkSize);
        if (chunk.isEmpty) break;

        final etag = await _uploadPart(uploadId, partNumber, chunk);
        parts[partNumber] = etag;
        partNumber++;

        uploadedBytes += chunk.length;
        if (onProgress != null && fileSize > 0) {
          onProgress(uploadedBytes / fileSize);
        }
      }

      await raf.close();

      // 步骤 3：完成多部分上传
      final result = await _completeMultipartUpload(uploadId, parts);
      return result;
    } catch (e) {
      // 失败时中止
      await _abortMultipartUpload(uploadId);
      rethrow;
    }
  }

  Future<String> _initiateMultipartUpload(String filePath, String module) async {
    final response = await http.post(
      Uri.parse('$apiBaseUrl/upload/multipart/init'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'fileName': p.basename(filePath),
        'module': module,
      }),
    );

    if (response.statusCode != 200) {
      throw UploadException('初始化多部分上传失败');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return data['uploadId'] as String;
  }

  Future<String> _uploadPart(
    String uploadId,
    int partNumber,
    Uint8List data,
  ) async {
    final response = await http.put(
      Uri.parse('$apiBaseUrl/upload/multipart/part'),
      headers: {'Content-Type': 'application/octet-stream'},
      body: jsonEncode({
        'uploadId': uploadId,
        'partNumber': partNumber,
        'data': base64Encode(data),
      }),
    );

    if (response.statusCode != 200) {
      throw UploadException('上传第 $partNumber 部分失败');
    }

    return response.headers['etag'] ?? '';
  }

  Future<UploadResult> _completeMultipartUpload(
    String uploadId,
    Map<int, String> parts,
  ) async {
    final response = await http.post(
      Uri.parse('$apiBaseUrl/upload/multipart/complete'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'uploadId': uploadId,
        'parts': parts.entries.map((e) => {
          'partNumber': e.key,
          'etag': e.value,
        }).toList(),
      }),
    );

    if (response.statusCode != 200) {
      throw UploadException('完成多部分上传失败');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return UploadResult(
      url: data['url'] as String,
      key: data['key'] as String,
      bucket: data['bucket'] as String,
      mimeType: data['mimeType'] as String,
      sizeBytes: data['size'] as int,
      originalName: data['originalName'] as String,
    );
  }

  Future<void> _abortMultipartUpload(String uploadId) async {
    await http.post(
      Uri.parse('$apiBaseUrl/upload/multipart/abort'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'uploadId': uploadId}),
    ).catchError((_) {});
  }
}
```

---

## 上传结果类型

[`UploadResult`] 类提供消费功能所需的所有元数据。

```dart
class UploadResult {
  final String url;            // 用于展示的完整 CDN URL
  final String key;            // 用于删除/引用的 S3 对象键
  final String bucket;         // 存储桶名称（用于审计）
  final String mimeType;       // 修正后的 MIME 类型
  final int sizeBytes;         // 最终上传大小
  final int? width;            // 图片宽度（如果是图片）
  final int? height;           // 图片高度（如果是图片）
  final String originalName;   // 原始文件名

  const UploadResult({
    required this.url,
    required this.key,
    required this.bucket,
    required this.mimeType,
    required this.sizeBytes,
    this.width,
    this.height,
    required this.originalName,
  });

  /// 是否为图片
  bool get isImage => mimeType.startsWith('image/');

  /// 是否为视频
  bool get isVideo => mimeType.startsWith('video/');

  /// 格式化文件大小用于展示
  String get formattedSize {
    if (sizeBytes < 1024) return '$sizeBytes B';
    if (sizeBytes < 1024 * 1024) {
      return '${(sizeBytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  /// 图片宽高比（如果有尺寸信息）
  double? get aspectRatio {
    if (width == null || height == null || height == 0) return null;
    return width! / height!;
  }

  Map<String, dynamic> toJson() => {
    'url': url,
    'key': key,
    'bucket': bucket,
    'mimeType': mimeType,
    'sizeBytes': sizeBytes,
    'width': width,
    'height': height,
    'originalName': originalName,
  };
}
```

---

## 实战：商品图片上传

以下是 `GlobalUploadService` 在实际商品创建流程中的使用方式。

```dart
class ProductImageUploader extends StatefulWidget {
  @override
  State<ProductImageUploader> createState() => _ProductImageUploaderState();
}

class _ProductImageUploaderState extends State<ProductImageUploader> {
  final GlobalUploadService _uploadService = GlobalUploadService();
  final UploadProgressNotifier _progressNotifier = UploadProgressNotifier();
  final List<UploadResult> _uploadedImages = [];
  bool _isUploading = false;

  Future<void> _pickAndUploadImages() async {
    final picker = ImagePicker();
    final images = await picker.pickMultiImage();

    if (images.isEmpty) return;

    setState(() => _isUploading = true);

    try {
      final requests = images.map((image) => UploadRequest(
        filePath: image.path,
        module: 'product',
        onProgress: (progress) {
          _progressNotifier.updateProgress(image.name, progress);
        },
      )).toList();

      // 跟踪所有上传
      for (final req in requests) {
        _progressNotifier.startTracking(req.filePath);
      }

      // 压缩后上传（最大 3 并发）
      final results = await _uploadService.uploadMultipleWithCompression(requests);

      setState(() {
        _uploadedImages.addAll(results);
        _isUploading = false;
      });
    } catch (e) {
      setState(() => _isUploading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('上传失败：$e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 图片网格
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            // 已上传的图片
            ..._uploadedImages.map((result) => Stack(
              children: [
                Image.network(
                  result.url,
                  width: 100,
                  height: 100,
                  fit: BoxFit.cover,
                ),
                Positioned(
                  top: 0,
                  right: 0,
                  child: IconButton(
                    icon: const Icon(Icons.close, size: 18, color: Colors.red),
                    onPressed: () {
                      setState(() {
                        _uploadedImages.remove(result);
                      });
                    },
                  ),
                ),
              ],
            )),

            // 上传按钮或进度指示
            if (_isUploading)
              ..._uploadedImages.length < _progressNotifier.value.length
                  ? [
                      Container(
                        width: 100,
                        height: 100,
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.grey[300]!),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Center(
                          child: ValueListenableBuilder<Map<String, double>>(
                            valueListenable: _progressNotifier,
                            builder: (context, progress, _) {
                              final overall = progress.values.isEmpty
                                  ? 0.0
                                  : progress.values.fold(0.0, (a, b) => a + b) /
                                      progress.values.length;
                              return Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  CircularProgressIndicator(value: overall),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${(overall * 100).toStringAsFixed(0)}%',
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                ],
                              );
                            },
                          ),
                        ),
                      ),
                    ]
                  : [],

            // 添加更多按钮
            if (!_isUploading)
              GestureDetector(
                onTap: _pickAndUploadImages,
                child: Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.grey[300]!),
                    borderRadius: BorderRadius.circular(8),
                    color: Colors.grey[100],
                  ),
                  child: const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_photo_alternate, size: 32, color: Colors.grey),
                      SizedBox(height: 4),
                      Text('添加照片',
                        style: TextStyle(fontSize: 12, color: Colors.grey),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),

        if (_uploadedImages.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              '已上传 ${_uploadedImages.length} 张图片',
              style: TextStyle(fontSize: 12, color: Colors.grey[600]),
            ),
          ),
      ],
    );
  }
}
```

### 上传流程时序图

```
用户                   App                    API 服务器              S3
 │                     │                         │                    │
 │ 选择 5 张照片        │                         │                    │
 ├────────────────────►│                         │                    │
 │                     │                         │                    │
 │                     │ 检测 MIME（魔数）         │                    │
 │                     ├─── 压缩图片 ────────────►│                    │
 │                     │   （缩放 2048px, q80）    │                    │
 │                     │                         │                    │
 │                     │ GET /upload/presigned    │                    │
 │                     ├────────────────────────►│                    │
 │                     │←── 预签名 URL（×5）──────┤                    │
 │                     │                         │                    │
 │                     │ 队列（最大 3 并发）       │                    │
 │                     │                         │                    │
 │                     │ PUT image1（进度）        │                    │
 │                     ├─────────────────────────────────────────────►│
 │                     │ PUT image2（进度）        │                    │
 │                     ├─────────────────────────────────────────────►│
 │                     │ PUT image3（进度）        │                    │
 │                     ├─────────────────────────────────────────────►│
 │                     │                         │                    │
 │   进度：60%          │←── Stream<double> ──────┤                    │
 │◄────────────────────┤                         │                    │
 │                     │                         │                    │
 │   上传完成           │                         │                    │
 │◄────────────────────┤                         │                    │
 │  （5 × UploadResult）│                         │                    │
```

---

## 总结

`GlobalUploadService` 为 Flutter 提供了一个完整、生产级的文件上传系统：

| 组件 | 职责 | 关键特性 |
|-----------|---------------|-------------|
| `GlobalUploadService` | 统一上传 API | 单文件/多文件/压缩变体 |
| `MimeDetector` | MIME 修正 | 魔数检测（12+ 格式） |
| `CompressionPipeline` | 上传前优化 | 图片缩放+质量、视频缩略图 |
| `ImageCompressor` | 图片优化 | 最大 2048px，可配置质量 |
| `UploadQueue` | 并发控制 | 最大 3 并发，重试（3×），取消 |
| `ChunkedUploader` | 大文件支持 | S3 多部分，5MB 分块，100MB 阈值 |
| `UploadProgressNotifier` | 进度跟踪 | 每文件 Stream<double>，总体进度 |
| `UploadResult` | 结果元数据 | URL、键、MIME、尺寸、格式化大小 |

### 关键要点

- **始终使用预签名 URL**——文件直接发送到 S3，不经过应用服务器（减少服务器负载、带宽和延迟）
- **通过魔数检测 MIME，而非扩展名**——防止因 Content-Type 头部不正确导致的上传失败
- **上传前压缩**——12MB 的相机照片变为 450KB，画质损失几乎不可察觉
- **将并发上传限制为 3 个**——防止网络饱和，并允许单独的进度跟踪
- **使用指数退避重试**——在 2秒/4秒/6秒 间隔内重试 3 次，可处理大多数瞬时网络故障
- **超过 100MB 的文件使用多部分上传**——支持可恢复上传和并行部分上传
- **清理临时文件**——压缩后的文件写入 `Directory.systemTemp`，上传后应删除

### 何时使用此模式

此上传系统适用于以下场景：
- 您的应用需要从用户设备上传图片、视频或文档
- 您有多个需要文件上传的功能（商品、KYC、头像、聊天）
- 上传可靠性至关重要（重试、队列、进度）
- 您希望通过直接上传到 S3 来最小化服务器负载

### 相关文章

- [**F18：ImageCacheManager L1/L2 + CDN 分辨率阶梯**](./image-cache-manager-l1-l2-responsive-image-service.md) — 在客户端缓存已上传的图片
- [**API：文件上传 + Cloudflare R2 媒体处理**](../api/file-upload-cloudflare-r2-media-processing.md) — 后端预签名 URL 生成和媒体处理实现
- [**F20：ReactiveForms + 代码生成表单**](./reactive-forms-code-generation.md) — 使用此上传服务的 `FormFieldType.file` 表单
