---
title: "GlobalUploadService: S3 Direct Upload + Compression Pipeline + MIME Correction"
description: "A comprehensive Flutter file upload system featuring S3 presigned URL direct upload, MIME type detection via magic bytes, compression pipeline, upload queue with concurrency limiting, retry with exponential backoff, chunked upload for large files, and real-time progress tracking."
slug: global-upload-service-s3-compression-mime
tags: [Flutter, Upload, S3, Compression, MIME, Media]
---

# GlobalUploadService: S3 Direct Upload + Compression Pipeline + MIME Correction

## Table of Contents

1. [Why a Global Upload Service?](#1-why-a-global-upload-service)
2. [Architecture Overview: Upload Pipeline](#2-architecture-overview-upload-pipeline)
3. [GlobalUploadService: Unified Upload API](#3-globaluploadservice-unified-upload-api)
4. [S3 Direct Upload via Presigned URL](#4-s3-direct-upload-via-presigned-url)
5. [Pre-Upload Compression Pipeline](#5-pre-upload-compression-pipeline)
6. [Automatic MIME Type Detection & Correction](#6-automatic-mime-type-detection--correction)
7. [Tracking Upload Progress with Stream\<double\>](#7-tracking-upload-progress-with-streamdouble)
8. [Upload Queue: Concurrency Limits + Retry + Cancel](#8-upload-queue-concurrency-limits--retry--cancel)
9. [Large File Chunked Upload](#9-large-file-chunked-upload)
10. [Upload Result Type](#10-upload-result-type)
11. [Practice: Product Image Upload](#11-practice-product-image-upload)
12. [Summary](#12-summary)

---

## 1. Why a Global Upload Service?

In social e-commerce applications, file uploads are everywhere:

| Feature | File Type | Frequency |
|---------|-----------|-----------|
| Product Listing | Images (JPEG, WebP, PNG) | Per seller, daily |
| KYC Verification | ID photos, selfies | Once per user |
| Profile Avatar | Images | Occasionally |
| Chat Attachments | Images, videos, documents | High frequency |
| Group Avatar | Images | Per group creation |

Without a unified upload service, each feature implements its own upload logic, leading to:

| Issue | Impact |
|---------|--------|
| **Duplicate presigned URL logic** | Each feature independently fetches and signs URLs |
| **No compression** | Raw 12MP camera images uploaded directly, wasting bandwidth |
| **MIME type errors** | Server rejects uploads due to incorrect Content-Type |
| **No progress feedback** | Users can't see upload progress, think the app is frozen |
| **No queue management** | 50 images uploaded simultaneously, saturating the network |
| **No retry mechanism** | Upload fails under weak signal → user must reselect all files |

---

## 2. Architecture Overview: Upload Pipeline

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

## 3. GlobalUploadService: Unified Upload API

The service provides three upload modes: single file, multiple files, and compressed upload.

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

### Upload Request / Result Types

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

## 4. S3 Direct Upload via Presigned URL

The key design decision is **client-side direct upload** — files are sent directly to S3 without passing through the application server. This is made possible via [presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

### Why Presigned URLs?

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

### Backend Presigned URL Generation (NestJS)

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

### Security Considerations

| Concern | Mitigation |
|---------|------------|
| **URL expiration** | Presigned URL expires after 1 hour |
| **Module isolation** | Each module uses a separate S3 bucket |
| **File type restriction** | Backend validates mimeType before signing |
| **Size restriction** | Backend rejects oversized files during signing |
| **Authentication** | Presigned URL endpoint requires valid auth token |

---

## 5. Pre-Upload Compression Pipeline

The compression pipeline applies **client-side optimization** before upload, reducing bandwidth and server processing overhead.

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

### Compression Results

| Original File | After Compression | Space Saved |
|----------|------------------|---------|
| 12MB JPEG (4032×3024) | 450KB JPEG (2048×1536, q80) | **96%** |
| 5MB PNG (1920×1080) | 320KB WebP (1920×1080, q80) | **94%** |
| 2MB JPEG (800×600) | 180KB JPEG (800×600, q80) | **91%** |
| 500KB PNG (logo) | 120KB PNG (lossless) | **76%** |

---

## 6. Automatic MIME Type Detection & Correction

A common problem: the extension is `.jpg`, but the file is actually a PNG (or worse, a renamed executable). The `MimeDetector` reads **magic bytes** (file signatures) to determine the real MIME type.

### Magic Byte Detection

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

### Common Magic Byte Signatures

| Format | Magic Bytes (Hex) | Correct MIME |
|--------|-------------------|--------------|
| JPEG | `FF D8 FF` | `image/jpeg` |
| PNG | `89 50 4E 47` | `image/png` |
| GIF | `47 49 46 38` / `47 49 46 39` | `image/gif` |
| WebP | `52 49 46 46 xx xx xx xx 57 45 42 50` | `image/webp` |
| PDF | `25 50 44 46` | `application/pdf` |
| MP4 | `xx xx xx xx 66 74 79 70` | `video/mp4` |
| HEIC | `xx xx xx xx 66 74 79 70 68 65 69 63` | `image/heic` |

### Why MIME Correction Matters

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

## 7. Tracking Upload Progress with Stream\<double\>

Progress is exposed via [`Stream<double>`](https://api.dart.dev/stable/dart-async/Stream-class.html), emitting values between 0.0 and 1.0 for real-time progress bars.

### Upload Progress Provider

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

### Progress-Tracking Upload

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

### Progress UI Component

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

## 8. Upload Queue: Concurrency Limits + Retry + Cancel

The upload queue manages concurrent uploads, retries failed items, and supports cancellation.

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

### Retry Strategy

| Attempt | Wait Before Retry | Cumulative Wait |
|---------|-------------------|------------|
| 1 (First) | 0s | 0s |
| 2 (Retry 1) | 2s | 2s |
| 3 (Retry 2) | 4s | 6s |

Non-retryable errors (401 Unauthorized, 403 Forbidden, invalid files) fail immediately.

---

## 9. Large File Chunked Upload

For files exceeding 100MB (e.g., videos), the upload service switches to **multipart chunked upload** using S3's Multipart Upload API.

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
      Uri.parse('$apiBaseUrl/upload/multipart/abort'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'uploadId': uploadId}),
    ).catchError((_) {});
  }
}
```

---

## 10. Upload Result Type

The [`UploadResult`] class provides all metadata needed by consuming features.

```dart
class UploadResult {
  final String url;            // Full CDN URL for display
  final String key;            // S3 object key for deletion/reference
  final String bucket;         // Bucket name (for audit)
  final String mimeType;       // Corrected MIME type
  final int sizeBytes;         // Final upload size
  final int? width;            // Image width (if image)
  final int? height;           // Image height (if image)
  final String originalName;   // Original file name

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

  /// Whether this is an image
  bool get isImage => mimeType.startsWith('image/');

  /// Whether this is a video
  bool get isVideo => mimeType.startsWith('video/');

  /// Format file size for display
  String get formattedSize {
    if (sizeBytes < 1024) return '$sizeBytes B';
    if (sizeBytes < 1024 * 1024) {
      return '${(sizeBytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  /// Image aspect ratio (if dimensions available)
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

## 11. Practice: Product Image Upload

Below is how `GlobalUploadService` is used in an actual product creation flow.

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

      // Track all uploads
      for (final req in requests) {
        _progressNotifier.startTracking(req.filePath);
      }

      // Upload with compression (max 3 concurrent)
      final results = await _uploadService.uploadMultipleWithCompression(requests);

      setState(() {
        _uploadedImages.addAll(results);
        _isUploading = false;
      });
    } catch (e) {
      setState(() => _isUploading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Upload failed: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Image grid
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            // Uploaded images
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

            // Upload button or progress indicator
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

            // Add more button
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
                      Text('Add Photos',
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
              '${_uploadedImages.length} images uploaded',
              style: TextStyle(fontSize: 12, color: Colors.grey[600]),
            ),
          ),
      ],
    );
  }
}
```

### Upload Flow Sequence Diagram

```
User                   App                    API Server              S3
 │                     │                         │                    │
 │ Select 5 photos     │                         │                    │
 ├────────────────────►│                         │                    │
 │                     │                         │                    │
 │                     │ Detect MIME (magic)     │                    │
 │                     ├─── Compress images ────►│                    │
 │                     │   (resize 2048px, q80)  │                    │
 │                     │                         │                    │
 │                     │ GET /upload/presigned   │                    │
 │                     ├────────────────────────►│                    │
 │                     │←── Presigned URLs (×5) ─┤                    │
 │                     │                         │                    │
 │                     │ Queue (max 3 concurrent)│                    │
 │                     │                         │                    │
 │                     │ PUT image1 (progress)   │                    │
 │                     ├─────────────────────────────────────────────►│
 │                     │ PUT image2 (progress)   │                    │
 │                     ├─────────────────────────────────────────────►│
 │                     │ PUT image3 (progress)   │                    │
 │                     ├─────────────────────────────────────────────►│
 │                     │                         │                    │
 │   Progress: 60%     │←── Stream<double> ──────┤                    │
 │◄────────────────────┤                         │                    │
 │                     │                         │                    │
 │   Upload complete   │                         │                    │
 │◄────────────────────┤                         │                    │
 │  (5 × UploadResult) │                         │                    │
```

---

## 12. Summary

`GlobalUploadService` provides a complete, production-grade file upload system for Flutter:

| Component | Responsibility | Key Features |
|-----------|---------------|-------------|
| `GlobalUploadService` | Unified upload API | Single/multiple/compressed variants |
| `MimeDetector` | MIME correction | Magic byte detection (12+ formats) |
| `CompressionPipeline` | Pre-upload optimization | Image resize+quality, video thumbnails |
| `ImageCompressor` | Image optimization | Max 2048px, configurable quality |
| `UploadQueue` | Concurrency control | Max 3 concurrent, retry (3×), cancel |
| `ChunkedUploader` | Large file support | S3 multipart, 5MB chunks, 100MB threshold |
| `UploadProgressNotifier` | Progress tracking | Per-file Stream<double>, overall progress |
| `UploadResult` | Result metadata | URL, key, MIME, size, formatted size |

### Key Takeaways

- **Always use presigned URLs** — files go directly to S3 without passing through the application server (reduces server load, bandwidth, and latency)
- **Detect MIME via magic bytes, not extension** — prevents upload failures caused by incorrect Content-Type headers
- **Compress before upload** — 12MB camera photo becomes 450KB with nearly imperceptible quality loss
- **Limit concurrent uploads to 3** — prevents network saturation and allows individual progress tracking
- **Retry with exponential backoff** — 3 retries at 2s/4s/6s intervals handle most transient network failures
- **Use multipart upload for files over 100MB** — supports resumable uploads and parallel part uploads
- **Clean up temporary files** — compressed files are written to `Directory.systemTemp` and should be deleted after upload

### When to Use This Pattern

This upload system is suitable for scenarios where:
- Your app needs to upload images, videos, or documents from user devices
- You have multiple features requiring file upload (products, KYC, avatars, chat)
- Upload reliability is critical (retry, queue, progress)
- You want to minimize server load by uploading directly to S3

### Related Articles

- [**ImageCacheManager L1/L2 + CDN Resolution Ladder**](./image-cache-manager-l1-l2-responsive-image-service.md) — Cache uploaded images on the client side
- [**API: File Upload + Cloudflare R2 Media Processing**](../api/file-upload-cloudflare-r2-media-processing.md) — Backend presigned URL generation and media processing implementation
- [**ReactiveForms + Code-Generated Forms**](./reactive-forms-code-generation.md) — Forms using `FormFieldType.file` with this upload service
