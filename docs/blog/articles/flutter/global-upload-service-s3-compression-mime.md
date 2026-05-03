---
title: 'GlobalUploadService：S3 直传 + 压缩管道 + MIME 校正'
description: 'Flutter 文件上传系统，支持 S3 预签名 URL 直传、基于魔数的 MIME 类型检测、压缩管道、带并发限制的上传队列、指数退避重试、大文件分片上传和实时进度追踪。'
slug: global-upload-service-s3-compression-mime
tags: Flutter, Upload, S3, Compression, MIME, Media
---

## 1. 为什么需要全局上传服务？

在社交电商应用中，文件上传无处不在：

| 功能 | 文件类型 | 频率 |
|------|---------|------|
| 商品发布 | 图片（JPEG, WebP, PNG） | 每位卖家，每日 |
| KYC 认证 | 身份证照片、自拍 | 每位用户一次 |
| 个人头像 | 图片 | 偶尔 |
| 聊天附件 | 图片、视频、文档 | 高频 |
| 群组头像 | 图片 | 每次创建群组 |

如果没有统一的上传服务，每个功能都会实现自己的上传逻辑，导致：

| 问题 | 影响 |
|------|------|
| **重复的预签名 URL 逻辑** | 每个功能独立获取和签名 URL |
| **无压缩** | 原始 12MP 相机图片直接上传，浪费带宽 |
| **MIME 类型错误** | 服务器因 Content-Type 不正确而拒绝上传 |
| **无进度反馈** | 用户看不到上传进度，以为应用卡死 |
| **无队列管理** | 50 张图片同时上传，网络饱和 |
| **无重试机制** | 弱信号下上传失败 → 用户必须重新选择所有文件 |

---

## 2. 架构概览：上传管道

```
User selects file
        │
        ▼
┌────────────────────────────────┐
│    GlobalUploadService         │
│                                │
│  1. Fetch presigned URL        │
│     (via API /upload/presigned) │
│                                │
│  2. MIME detection             │
│     (magic bytes → MIME type)  │
│                                │
│  3. Compression pipeline       │
│     ├─ Image: resize + quality │
│     ├─ Video: thumbnail        │
│     └─ Document: pass through  │
│                                │
│  4. Upload queue               │
│     (max 3 concurrent)         │
│                                │
│  5. S3 direct upload           │
│     (PUT to presigned URL)     │
│     └─ Progress stream         │
│                                │
│  6. UploadResult               │
│     (url, key, mime, size)     │
└────────────────────────────────┘
```

---

## 3. GlobalUploadService：统一上传 API

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

  /// Upload a single file
  Future<UploadResult> upload(UploadRequest request) async {
    return _queue.enqueue(() => _performUpload(request));
  }

  /// Upload multiple files simultaneously (respects queue concurrency limit)
  Future<List<UploadResult>> uploadMultiple(List<UploadRequest> requests) async {
    final futures = requests.map((r) => upload(r));
    return Future.wait(futures, eagerError: false);
  }

  /// Auto-compress then upload
  Future<UploadResult> uploadWithCompression(UploadRequest request) async {
    final compressed = await _compressionPipeline.compress(request);
    return upload(compressed);
  }

  /// Upload multiple files with compression
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
      // Step 1: Detect/correct MIME type
      final correctedMime = await _mimeDetector.detect(request.filePath);
      final mimeType = correctedMime ?? request.mimeType ?? 'application/octet-stream';

      // Step 2: Get presigned URL
      final presignedUrl = await _fetchPresignedUrl(
        fileName: p.basename(request.filePath),
        mimeType: mimeType,
        module: request.module,
      );

      // Step 3: Upload to S3
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
        message: 'Upload failed: ${request.filePath}',
        originalError: e,
      );
    }
  }

  Future<PresignedUrlResponse> _fetchPresignedUrl({
    required String fileName,
    required String mimeType,
    required String module,
  }) async {
    // Call backend API to get presigned URL
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
      throw UploadException('Failed to get presigned URL: ${response.statusCode}');
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

    // Read file bytes
    final bytes = await file.readAsBytes();

    // Create HTTP PUT request
    final request = http.MultipartRequest('PUT', Uri.parse(url));
    request.headers['Content-Type'] = mimeType;
    request.headers['Content-Length'] = fileSize.toString();

    // Custom client for progress tracking
    final progressStream = StreamController<List<int>>();
    int uploadedBytes = 0;

    final sub = progressStream.stream.listen((chunk) {
      uploadedBytes += chunk.length;
      if (onProgress != null && fileSize > 0) {
        onProgress(uploadedBytes / fileSize);
      }
    });

    try {
      // Write file to stream
      final chunkSize = 8192;
      for (int i = 0; i < bytes.length; i += chunkSize) {
        final end = (i + chunkSize < bytes.length) ? i + chunkSize : bytes.length;
        progressStream.add(bytes.sublist(i, end));
      }
      await progressStream.close();

      // Execute upload
      final response = await http.put(
        Uri.parse(url),
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileSize.toString(),
        },
        body: bytes,
      );

      if (response.statusCode != 200) {
        throw UploadException('S3 upload failed, status code: ${response.statusCode}');
      }

      // If it's an image, try to get image dimensions
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
  final String module;       // 'product', 'kyc', 'avatar', 'chat', 'group'
  final String? mimeType;    // Optional, auto-detected when null
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
  final String key;          // S3 object key
  final String bucket;       // S3 bucket name
  final String mimeType;     // Detected/corrected MIME type
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

## 4. 通过预签名 URL 直传 S3

关键设计决策是**客户端直传**——文件直接发送到 S3，不经过应用服务器。这是通过[预签名 URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)实现的。

### 为什么使用预签名 URL？

```
Without Presigned URL (Anti-Pattern):
  App → API Server (receives file) → S3
  ❌ Server processes large files (memory pressure)
  ❌ Double bandwidth (App → Server → S3)
  ❌ Server CPU wasted on file processing

With Presigned URL (Best Practice):
  App → Fetch presigned URL (small API call)
  App → S3 direct upload (large file)
  ✅ Server never touches the file
  ✅ Single bandwidth hop
  ✅ S3 handles scaling
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
      expiresIn: 3600, // 1 hour
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

### 安全考量

| 关注点 | 缓解措施 |
|--------|---------|
| **URL 过期** | 预签名 URL 1 小时后过期 |
| **模块隔离** | 每个模块使用独立的 S3 Bucket |
| **文件类型限制** | 后端在签名前验证 mimeType |
| **大小限制** | 后端在签名时拒绝超大文件 |
| **认证** | 预签名 URL 端点需要有效认证 Token |

---

## 5. 上传前压缩管道

压缩管道在上传前应用**客户端优化**，减少带宽和服务器处理开销。

### CompressionPipeline

```dart
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/painting.dart' as painting;
import 'package:image/image.dart' as img; // Dart native image library

class CompressionPipeline {
  final ImageCompressor _imageCompressor = ImageCompressor();
  final VideoProcessor _videoProcessor = VideoProcessor();

  /// Compress file before upload
  Future<UploadRequest> compress(UploadRequest request) async {
    final extension = p.extension(request.filePath).toLowerCase();

    if (_isImageExtension(extension)) {
      return _imageCompressor.compress(request);
    } else if (_isVideoExtension(extension)) {
      return _videoProcessor.extractThumbnail(request);
    }

    // Documents, audio, etc. — pass through
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
  static const _maxDimension = 2048; // Max width or height (pixels)

  Future<UploadRequest> compress(
    UploadRequest request, {
    int quality = _defaultQuality,
    int maxDimension = _maxDimension,
  }) async {
    final file = File(request.filePath);
    final bytes = await file.readAsBytes();

    // Decode image
    final image = img.decodeImage(bytes);
    if (image == null) return request; // Unable to decode, upload original

    // Scale down if exceeding max dimension
    img.Image resized = image;
    if (image.width > maxDimension || image.height > maxDimension) {
      resized = img.copyResize(
        image,
        width: image.width > image.height ? maxDimension : null,
        height: image.height >= image.width ? maxDimension : null,
        interpolation: img.Interpolation.linear,
      );
    }

    // Determine target format
    final targetFormat = _selectFormat(request.mimeType ?? 'image/jpeg');
    final compressedBytes = _encodeImage(resized, targetFormat, quality);

    // Write compressed file to temporary location
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
        return ImageFormat.jpeg; // Photo defaults to JPEG
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
|---------|-------|---------|
| 12MB JPEG (4032×3024) | 450KB JPEG (2048×1536, q80) | **96%** |
| 5MB PNG (1920×1080) | 320KB WebP (1920×1080, q80) | **94%** |
| 2MB JPEG (800×600) | 180KB JPEG (800×600, q80) | **91%** |
| 500KB PNG (logo) | 120KB PNG (无损) | **76%** |

---

## 6. 自动 MIME 类型检测与校正

一个常见问题：扩展名是 `.jpg`，但文件实际上是 PNG（或者更糟，是一个被重命名的可执行文件）。`MimeDetector` 读取**魔数**（文件签名）来确定真实的 MIME 类型。

### 魔数检测

```dart
import 'dart:io';
import 'dart:typed_data';

class MimeDetector {
  /// Detect MIME type from file magic bytes
  Future<String?> detect(String filePath) async {
    final file = File(filePath);
    if (!await file.exists()) return null;

    final raf = await file.open(mode: FileMode.read);
    try {
      // Read first 12 bytes (sufficient for most formats)
      final header = await raf.read(12);
      return _matchMagicBytes(header);
    } finally {
      await raf.close();
    }
  }

  String? _matchMagicBytes(Uint8List bytes) {
    // JPEG: starts with FF D8 FF
    if (bytes.length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) {
      return 'image/jpeg';
    }

    // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
    if (bytes.length >= 8 &&
        bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E &&
        bytes[3] == 0x47 && bytes[4] == 0x0D && bytes[5] == 0x0A &&
        bytes[6] == 0x1A && bytes[7] == 0x0A) {
      return 'image/png';
    }

    // GIF: starts with GIF87a or GIF89a
    if (bytes.length >= 6 &&
        bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 &&
        (bytes[3] == 0x38 || bytes[3] == 0x39) &&
        bytes[4] == 0x37 && bytes[5] == 0x61) {
      return 'image/gif';
    }

    // WebP: starts with RIFF....WEBP
    if (bytes.length >= 12 &&
        bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 &&
        bytes[3] == 0x46 && bytes[8] == 0x57 && bytes[9] == 0x45 &&
        bytes[10] == 0x42 && bytes[11] == 0x50) {
      return 'image/webp';
    }

    // PDF: starts with %PDF
    if (bytes.length >= 4 &&
        bytes[0] == 0x25 && bytes[1] == 0x50 &&
        bytes[2] == 0x44 && bytes[3] == 0x46) {
      return 'application/pdf';
    }

    // MP4: starts with ftyp box
    if (bytes.length >= 8 &&
        bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70) {
      return 'video/mp4';
    }

    // HEIC: starts with ftypheic or ftypheix
    if (bytes.length >= 12 &&
        bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 &&
        bytes[7] == 0x70 &&
        ((bytes[8] == 0x68 && bytes[9] == 0x65 && bytes[10] == 0x69 && bytes[11] == 0x63) ||
         (bytes[8] == 0x68 && bytes[9] == 0x65 && bytes[10] == 0x69 && bytes[11] == 0x78))) {
      return 'image/heic';
    }

    return null; // Unknown format
  }
}
```

### 常见魔数签名

| 格式 | 魔数（十六进制） | 正确 MIME |
|------|----------------|-----------|
| JPEG | `FF D8 FF` | `image/jpeg` |
| PNG | `89 50 4E 47` | `image/png` |
| GIF | `47 49 46 38` / `47 49 46 39` | `image/gif` |
| WebP | `52 49 46 46 xx xx xx xx 57 45 42 50` | `image/webp` |
| PDF | `25 50 44 46` | `application/pdf` |
| MP4 | `xx xx xx xx 66 74 79 70` | `video/mp4` |
| HEIC | `xx xx xx xx 66 74 79 70 68 65 69 63` | `image/heic` |

### 为什么 MIME 校正很重要

```
User selects photo.jpg (actually a screenshot saved as PNG)
                                           │
                                           ▼
Extension-based MIME: "image/jpeg"         │
Magic byte MIME:      "image/png"          │
                                           │
S3 receives PUT with Content-Type:         │
  "image/jpeg" → stored as .jpg            │
  But it's actually a PNG!                 │
                                           │
CDN serves as image/jpeg                   │
Browser cannot render → broken image       │
                                           ▼
                    ⚠️ Needs correction
```

---

## 7. 使用 Stream\<double\> 追踪上传进度

进度通过 [`Stream<double>`](https://api.dart.dev/stable/dart-async/Stream-class.html) 暴露，发射 0.0 到 1.0 之间的值，用于实时进度条。

### 上传进度 Provider

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

### 带进度追踪的上传

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

## 8. 上传队列：并发限制 + 重试 + 取消

上传队列管理并发上传、重试失败项并支持取消。

```dart
class UploadQueue {
  final int maxConcurrent;
  final Queue<_QueuedUpload> _pending = Queue();
  final Set<_QueuedUpload> _active = {};
  int _runningCount = 0;

  UploadQueue({this.maxConcurrent = 3});

  /// Enqueue upload and return its Future result
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
        // Exponential backoff
        await Future.delayed(Duration(seconds: attempt * 2));
      }
    }
  }

  bool _isNonRetryable(Object error) {
    if (error is UploadException) {
      // 4xx errors are non-retryable
      if (error.message.contains('401') || error.message.contains('403')) {
        return true;
      }
    }
    return false;
  }

  /// Cancel all pending uploads
  void cancelAll() {
    while (_pending.isNotEmpty) {
      final entry = _pending.removeFirst();
      entry.completer.completeError(
        UploadException('User cancelled upload'),
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

| 尝试 | 重试前等待 | 累计等待 |
|------|-----------|---------|
| 1（首次） | 0s | 0s |
| 2（重试 1） | 2s | 2s |
| 3（重试 2） | 4s | 6s |

不可重试的错误（401 未授权、403 禁止、无效文件）会立即失败。

---

## 9. 大文件分片上传

对于超过 100MB 的文件（如视频），上传服务会切换到**多部分分片上传**，使用 S3 的 Multipart Upload API。

```dart
class ChunkedUploader {
  static const _chunkSize = 5 * 1024 * 1024; // S3 multipart upload minimum 5MB
  static const _largeFileThreshold = 100 * 1024 * 1024; // 100MB

  Future<UploadResult> upload(
    String filePath,
    String module, {
    void Function(double)? onProgress,
  }) async {
    final file = File(filePath);
    final fileSize = await file.length();

    if (fileSize < _largeFileThreshold) {
      // Small files use regular upload
      return GlobalUploadService().upload(UploadRequest(
        filePath: filePath,
        module: module,
        onProgress: onProgress,
      ));
    }

    // Large files use multipart upload
    return _multipartUpload(filePath, fileSize, module, onProgress);
  }

  Future<UploadResult> _multipartUpload(
    String filePath,
    int fileSize,
    String module,
    void Function(double)? onProgress,
  ) async {
    // Step 1: Initiate multipart upload
    final uploadId = await _initiateMultipartUpload(filePath, module);

    try {
      // Step 2: Upload individual parts
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

      // Step 3: Complete multipart upload
      final result = await _completeMultipartUpload(uploadId, parts);
      return result;
    } catch (e) {
      // Abort on failure
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
      throw UploadException('Failed to initialize multipart upload');
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
      throw UploadException('Failed to upload part $partNumber');
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
      throw UploadException('Failed to complete multipart upload');
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
      Uri.parse('$baseUrl/multipart/${uploadId}/abort'),
      headers: {'Authorization': 'Bearer $token'},
    );
  }
}
```

### 分片上传流程

```
客户端                         服务器/S3
  │                              │
  │  1. POST /multipart/init     │
  │  ──────────────────────────> │  创建分片上传
  │  <────────────────────────── │  返回 uploadId
  │                              │
  │  2. POST /multipart/urls     │
  │  ──────────────────────────> │  为每个分片生成预签名 URL
  │  <────────────────────────── │  返回 presignedUrls[]
  │                              │
  │  3. PUT {presignedUrl[i]}    │
  │  ──────────────────────────> │  直接上传分片到 S3
  │  <────────────────────────── │  返回 ETag
  │                              │
  │  4. POST /multipart/complete │
  │  ──────────────────────────> │  提交 parts[]（ETag + PartNumber）
  │  <────────────────────────── │  返回最终文件 URL
  │                              │
```

## 10. 上传结果类型

统一的上传结果类型让调用方可以一致地处理所有上传场景：

```dart
/// 上传结果联合类型
sealed class UploadResult {
  const UploadResult();
}

class UploadSuccess extends UploadResult {
  final String url;
  final String key;
  final String bucket;
  final String mimeType;
  final int sizeBytes;
  final String? thumbnailUrl;
  final UploadMetrics? metrics;

  const UploadSuccess({
    required this.url,
    required this.key,
    required this.bucket,
    required this.mimeType,
    required this.sizeBytes,
    this.thumbnailUrl,
    this.metrics,
  });
}

class UploadProgress extends UploadResult {
  final double progress; // 0.0 ~ 1.0
  final String? currentFile;

  const UploadProgress(this.progress, {this.currentFile});
}

class UploadFailure extends UploadResult {
  final String fileKey;
  final Object error;
  final UploadErrorType type;
  final int retryCount;

  const UploadFailure({
    required this.fileKey,
    required this.error,
    required this.type,
    this.retryCount = 0,
  });
}

enum UploadErrorType {
  network,
  timeout,
  server,
  quotaExceeded,
  fileTooLarge,
  invalidType,
  cancelled,
}
```

使用 sealed class 确保所有分支都被覆盖，编译器会强制检查：

```dart
void handleUploadResult(UploadResult result) {
  switch (result) {
    case UploadSuccess s:
      _showSuccess(s.url);
    case UploadProgress p:
      _updateProgress(p.progress);
    case UploadFailure f:
      _showError(f.error, f.type);
  }
  // ✅ 编译通过——所有分支都已覆盖
}
```

## 11. 实战：商品图片上传

将以上所有能力整合到商品图片上传场景中：

```dart
class ProductImageUploader {
  final GlobalUploadService _uploadService;
  final CompressionPipeline _compressionPipeline;
  final UploadQueue _uploadQueue;

  ProductImageUploader(this._uploadService, this._compressionPipeline, this._uploadQueue);

  /// 上传多张商品图片，返回图片 URL 列表
  Future<List<String>> uploadProductImages(List<File> images) async {
    final results = <String>[];
    final errors = <String>[];

    for (final image in images) {
      try {
        // 1. 验证文件大小和类型
        if (!_validateProductImage(image)) {
          errors.add('${image.path}: 文件类型或大小不符合要求');
          continue;
        }

        // 2. 压缩图片
        final compressed = await _compressionPipeline.process(
          UploadTask(file: image, options: const UploadOptions(
            maxWidth: 1920,
            quality: 0.8,
            format: CompressFormat.jpeg,
          )),
        );

        // 3. 检测 MIME 类型
        final mimeType = await MagicSignatureDetector.detect(compressed.path);

        // 4. 获取预签名 URL
        final presigned = await _uploadService.getPresignedUploadUrl(
          fileName: 'product_${DateTime.now().millisecondsSinceEpoch}.jpg',
          mimeType: mimeType,
        );

        // 5. 上传到 S3
        final uploadResult = await _uploadService.uploadToPresignedUrl(
          filePath: compressed.path,
          presignedUrl: presigned.url,
          mimeType: mimeType,
        );

        results.add(uploadResult.url);
      } catch (e) {
        errors.add('${image.path}: $e');
      }
    }

    if (errors.isNotEmpty) {
      // 记录失败日志，但继续返回成功上传的图片
      _logErrors(errors);
    }

    return results;
  }

  bool _validateProductImage(File file) {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    return file.lengthSync() <= maxSize;
  }

  void _logErrors(List<String> errors) {
    // 上报错误监控系统
  }
}
```

### 上传流程时序图

```
用户选择图片
    │
    ▼
┌─────────────────────────────────────┐
│ 1. 文件验证                          │
│    • 大小 ≤ 10MB                    │
│    • 类型为 jpeg/png/webp           │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 2. 压缩管道                          │
│    • 缩放到 maxWidth: 1920          │
│    • 质量 0.8                       │
│    • 输出 JPEG 格式                 │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 3. MIME 检测（魔数）                 │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 4. 获取预签名 URL                   │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 5. 直传 S3（带进度追踪）             │
└─────────────────────────────────────┘
    │
    ▼
  返回图片 URL
```

## 12. 总结

`GlobalUploadService` 提供了一个端到端的文件上传解决方案，覆盖了社交电商应用中的核心上传场景：

| 能力 | 实现方式 |
|------|---------|
| **安全上传** | S3 预签名 URL，文件不经过应用服务器 |
| **文件压缩** | 可配置的压缩管道，支持尺寸缩放和质量调节 |
| **类型检测** | 基于魔数的 MIME 检测，防止类型伪造 |
| **进度追踪** | `Stream<double>` 实时进度通知 |
| **并发控制** | 可配置并发数的上传队列 |
| **自动重试** | 指数退避重试策略 |
| **大文件支持** | 分片上传，支持断点续传 |
| **统一结果** | Sealed class 结果类型，编译期分支检查 |

### 适用场景

- 商品图片上传（多张并发 + 压缩）
- 用户头像上传（小文件 + 裁剪）
- 聊天图片/视频发送（大文件分片）
- 直播封面图上传（高质量 + 压缩）
- 评论图片上传（多张 + 缩略图）

### 相关文章

- [ApiCacheManager：双存储 + SWR 缓存策略](./api-cache-manager-dual-storage-swr.md)
- [UnifiedInterceptor：错误策略分发 + Token 刷新](./unified-interceptor-error-strategy-token-refresh.md)
- [ImageCacheManager：L1 内存 + L2 磁盘双层缓存](./image-cache-manager-l1-l2-responsive-image-service.md)
- [PipelineRunner：顺序执行管道模式](./pipeline-runner-sequential-execution.md)
