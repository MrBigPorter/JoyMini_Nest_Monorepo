---
title: 'ShareService + DeepLinkService: 多平台分享与深度链接集成'
slug: share-service-deep-link-platform-integration
tags: Flutter, Sharing, DeepLink, PlatformIntegration, Navigation
description: 一个多平台分享和深度链接系统，支持平台特定的 URL Scheme、冷启动/热启动处理、重复预防和 OAuth URL 过滤。
---

# ShareService + DeepLinkService: 多平台分享与深度链接集成

## 1. 背景

分享和深度链接系统由两个服务组成，处理外部通信：

- [`ShareService`](JoyMini_Flutter_App/lib/features/share/services/share_service.dart)（172 行）——多平台分享，支持平台特定的 URL Scheme
- [`DeepLinkService`](JoyMini_Flutter_App/lib/features/share/services/deep_link_service.dart)（126 行）——深度链接拦截，支持冷启动/热启动处理
- [`ShareContent`](JoyMini_Flutter_App/lib/features/share/models/share_content.dart)（50 行）——类型化的分享内容模型，提供工厂构造函数

---

## 2. ShareService：多平台分享

该服务为系统分享和平台特定的社交分享提供统一 API。

### 2.1 系统分享

```dart
class ShareService {
  /// Native system share sheet
  static Future<void> shareNative({
    required String text,
    String? subject,
    List<XFile>? files,
  }) async {
    await SharePlus.instance.share(
      ShareParams(
        text: text,
        subject: subject,
        files: files,
      ),
    );
  }
}
```

### 2.2 平台特定分享

平台特定的分享使用 iOS 和 Android 之间不同的 URL Scheme：

```dart
static Future<void> shareWhatsApp({
  required String text,
  String? url,
}) async {
  final whatsappUrl = Platform.isAndroid
      ? 'whatsapp://send?text=${Uri.encodeComponent(text)}'
      : 'https://api.whatsapp.com/send?text=${Uri.encodeComponent(text)}';
  
  if (await canLaunchUrl(Uri.parse(whatsappUrl))) {
    await launchUrl(Uri.parse(whatsappUrl));
  } else {
    // Fallback to system share if WhatsApp not installed
    await shareNative(text: text);
  }
}
```

| 平台 | iOS URL Scheme | Android URL Scheme |
|------|---------------|-------------------|
| WhatsApp | `https://api.whatsapp.com/send?text=` | `whatsapp://send?text=` |
| Telegram | `tg://msg?text=` | `tg://msg?text=` |
| Twitter/X | `https://twitter.com/intent/tweet?text=` | 相同（基于 Web） |
| Facebook | `fb://share?text=` | `fb://share?text=` |

### 2.3 iPad 分享定位

在 iPad 上，系统分享面板需要一个原点位置：

```dart
static Future<void> shareNative({required BuildContext context, ...}) async {
  final renderBox = context.findRenderObject() as RenderBox;
  final position = renderBox.localToGlobal(Offset.zero);
  
  await SharePlus.instance.share(
    ShareParams(
      text: text,
      subject: subject,
      sharePositionOrigin: Rect.fromLTWH(
        position.dx, position.dy, renderBox.size.width, renderBox.size.height,
      ),
    ),
  );
}
```

### 2.4 缩略图预下载

对于包含图片的分享，缩略图在分享前预下载，超时时间为 3 秒：

```dart
static Future<XFile?> _preloadThumbnail(String url) async {
  try {
    final response = await http.get(Uri.parse(url))
        .timeout(Duration(seconds: 3));
    final tempDir = await getTemporaryDirectory();
    final file = File('${tempDir.path}/share_thumb.jpg');
    await file.writeAsBytes(response.bodyBytes);
    return XFile(file.path);
  } catch (_) {
    return null;  // Thumbnail failure doesn't block main share flow
  }
}
```

### 2.5 Web 回退

在 Web 上，原生分享可能不可用：

```dart
static void openSystemOrSheet({
  required String text,
  required BuildContext context,
}) {
  if (kIsWeb) {
    // Web: use custom share sheet instead of system dialog
    showCustomShareSheet(context, text);
  } else {
    // Native: try system share, fallback on failure
    shareNative(text: text).catchError((_) {
      showCustomShareSheet(context, text);
    });
  }
}
```

---

## 3. ShareContent 模型

[`ShareContent`](JoyMini_Flutter_App/lib/features/share/models/share_content.dart) 是一个类型化模型，为不同的分享场景提供工厂构造函数：

```dart
class ShareContent {
  final String title;
  final String description;
  final String? imageUrl;
  final String? linkUrl;
  
  factory ShareContent.product({
    required String name,
    required String description,
    String? imageUrl,
    String? productId,
  }) {
    return ShareContent(
      title: name,
      description: description,
      imageUrl: imageUrl,
      linkUrl: 'https://joymini.com/product/$productId',
    );
  }
  
  factory ShareContent.group({
    required String groupId,
    required String productName,
    int memberCount = 0,
  }) {
    return ShareContent(
      title: 'Group Buy: $productName',
      description: 'Join $memberCount people in this group buy!',
      linkUrl: 'https://joymini.com/group/$groupId',
    );
  }
}
```

---

## 4. DeepLinkService：深度链接处理

深度链接服务处理冷启动（通过链接启动应用）和热启动（应用已在运行）。

### 4.1 初始化

在 [`AppBootstrap.initSystem()`](app-bootstrap-data-barrier-parallel-init.md) 中以 fire-and-forget 方式初始化：

```dart
class DeepLinkService {
  static Uri? _pendingLink;
  static DateTime? _lastProcessTime;
  
  static void init() {
    // Cold start: check if app was launched via deep link
    _checkInitialLink();
    
    // Warm start: listen for incoming links
    _listenForLinks();
  }
}
```

### 4.2 冷启动处理

```dart
static Future<void> _checkInitialLink() async {
  final initialUri = await appLinks.getInitialLink();
  if (initialUri != null) {
    // Store for GoRouter redirect consumption
    _pendingLink = initialUri;
  }
}
```

待处理链接由 GoRouter 的重定向逻辑消费：

```dart
// In GoRouter redirect:
final pendingLink = DeepLinkService._pendingLink;
if (pendingLink != null && isAppRouterReady) {
  DeepLinkService._pendingLink = null;
  return pendingLink.toString();
}
```

### 4.3 热启动处理

```dart
static void _listenForLinks() {
  appLinks.uriLinkStream.listen((Uri uri) {
    // Duplicate prevention
    if (_isDuplicate(uri)) return;
    
    _lastProcessTime = DateTime.now();
    _lastProcessedLink = uri.toString();
    
    // Filter OAuth URLs (handled separately)
    if (_isOAuthUrl(uri)) return;
    
    // Navigate via GoRouter
    GoRouter.of(navigatorKey.currentContext!).go(uri.toString());
  });
}

static bool _isDuplicate(Uri uri) {
  final now = DateTime.now();
  return uri.toString() == _lastProcessedLink &&
      now.difference(_lastProcessTime!).inMilliseconds < 1000;
}
```

### 4.4 OAuth URL 过滤

包含 OAuth 回调 URL（例如 `/auth/google/login`）的深度链接被有意排除在导航处理之外——它们由专门的 OAuth 流程处理：

```dart
static bool _isOAuthUrl(Uri uri) {
  return uri.path.startsWith('/auth/') || 
         uri.path.startsWith('/oauth/') ||
         uri.host == '__/auth';  // Firebase OAuth callback
}
```

### 4.5 GoRouter 就绪协调

一个关键的同步点：深度链接服务必须等待 GoRouter 完全初始化后才能处理深度链接：

```dart
// In global handler or router setup
static bool isAppRouterReady = false;

// Deep link handler waits for router readiness
static void _processPendingLink() {
  if (_pendingLink == null) return;
  
  // Poll until router is ready
  Future.delayed(Duration(milliseconds: 100), () {
    if (isAppRouterReady) {
      GoRouter.of(navigatorKey.currentContext!)
          .go(_pendingLink!.toString());
      _pendingLink = null;
    } else {
      _processPendingLink();  // Retry
    }
  });
}
```

---

## 5. 分享 + 深度链接集成流程

```
User taps shared link
         │
         ▼
┌─────────────────┐
│ System opens app│
│ via URL scheme  │
└────────┬────────┘
         │
    ┌────┴────┐
    │ Cold    │          Warm
    │ Start   │     ┌───────────┐
    └────┬────┘     │ uriLink-  │
         │          │ Stream    │
    ┌────▼────┐     │ triggers  │
    │ get-    │     └─────┬─────┘
    │ Initial-│           │
    │ Link()  │           │
    └────┬────┘           │
         │                │
         ▼                ▼
    ┌────────────────────────┐
    │ DeepLinkService        │
    │ processes URI          │
    └────────┬───────────────┘
             │
             ▼
    ┌────────────────────────┐
    │ Filter: OAuth? → Skip  │
    │ Duplicate? → Skip      │
    └────────┬───────────────┘
             │
             ▼
    ┌────────────────────────┐
    │ GoRouter redirect      │
    │ navigates to URI       │
    │ (waits if not ready)   │
    └────────────────────────┘
```

---

## 6. 设计决策

| 决策 | 理由 |
|------|------|
| **Fire-and-forget 初始化** | 深度链接设置不阻塞应用启动——注册后到达的链接通过流处理 |
| **重复预防** | `_lastProcessedLink` + 时间窗口防止异步竞态导致的双重导航 |
| **OAuth URL 过滤** | OAuth 回调有自己的流程（Token 提取、状态验证）——避免与通用导航冲突 |
| **GoRouter 就绪轮询** | 深度链接可能在 GoRouter 初始化之前到达；轮询确保可靠导航 |
| **平台特定 URL Scheme** | iOS 和 Android 对同一社交应用使用不同的 URL Scheme |
| **3 秒缩略图超时** | 分享图片是可选的、非关键的——超时防止慢速图片加载阻塞分享 |

---

## 7. 总结

1. **`ShareService`** 提供原生系统分享 + 平台特定分享（WhatsApp/Telegram/Twitter/Facebook），支持 iPad 定位和缩略图预下载。
2. **`DeepLinkService`** 处理冷启动（通过 `getInitialLink`）和热启动（通过 `uriLinkStream`），具备重复预防机制。
3. **`ShareContent`** 工厂构造函数（`product()`、`group()`）为不同场景提供类型安全的分享。
4. **OAuth URL 过滤**防止深度链接导航与 OAuth 回调处理之间的冲突。
5. **GoRouter 就绪协调**通过轮询确保深度链接的可靠处理，即使链接在路由器初始化之前到达。
6. **平台自适应 URL Scheme**针对 iOS 和 Android 社交分享，在目标应用未安装时优雅回退到系统分享。
