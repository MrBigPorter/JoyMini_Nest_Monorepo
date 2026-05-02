# ShareService + DeepLinkService：多平台分享与深度链接集成

> **目标读者：** Flutter 移动端工程师
> **标签：** `#Flutter` `#Sharing` `#DeepLink` `#PlatformIntegration` `#Navigation`
> **难度：** 中级
> **预计阅读时间：** 15 分钟

---

## 概述

分享和深度链接系统由两个处理外部通信的服务组成：

- [`ShareService`](JoyMini_Flutter_App/lib/features/share/services/share_service.dart)（172 行）— 多平台分享，支持平台特定的 URL scheme
- [`DeepLinkService`](JoyMini_Flutter_App/lib/features/share/services/deep_link_service.dart)（126 行）— 深度链接拦截，支持冷启动/热启动处理
- [`ShareContent`](JoyMini_Flutter_App/lib/features/share/models/share_content.dart)（50 行）— 类型化分享内容模型，带工厂构造函数

---

## 1. ShareService：多平台分享

该服务为系统分享和平台特定的社交分享提供统一 API。

### 系统分享

```dart
class ShareService {
  /// 原生系统分享面板
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

### 平台特定分享

平台特定分享使用在 iOS 和 Android 之间不同的 URL scheme：

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
    // 如果未安装 WhatsApp，回退到系统分享
    await shareNative(text: text);
  }
}
```

| 平台 | iOS URL Scheme | Android URL Scheme |
|----------|---------------|-------------------|
| WhatsApp | `https://api.whatsapp.com/send?text=` | `whatsapp://send?text=` |
| Telegram | `tg://msg?text=` | `tg://msg?text=` |
| Twitter/X | `https://twitter.com/intent/tweet?text=` | 相同（基于 Web） |
| Facebook | `fb://share?text=` | `fb://share?text=` |

### iPad 分享位置

在 iPad 上，系统分享面板需要指定来源位置：

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

### 缩略图预下载

对于包含图片的分享，缩略图会在分享前预下载，并设置 3 秒超时：

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
    return null;  // 缩略图加载失败不影响主要分享流程
  }
}
```

### Web 回退

在 Web 上，原生分享可能不可用：

```dart
static void openSystemOrSheet({
  required String text,
  required BuildContext context,
}) {
  if (kIsWeb) {
    // Web：使用自定义分享面板替代系统对话框
    showCustomShareSheet(context, text);
  } else {
    // 原生：尝试系统分享，失败时回退
    shareNative(text: text).catchError((_) {
      showCustomShareSheet(context, text);
    });
  }
}
```

---

## 2. ShareContent 模型

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
      title: '团购：$productName',
      description: '与 $memberCount 人一起参与团购！',
      linkUrl: 'https://joymini.com/group/$groupId',
    );
  }
}
```

---

## 3. DeepLinkService：深度链接处理

深度链接服务处理冷启动（通过链接启动应用）和热启动（应用已在运行）两种场景。

### 初始化

在 [`AppBootstrap.initSystem()`](app-bootstrap-data-barrier-parallel-init.md) 中作为 fire-and-forget 初始化：

```dart
class DeepLinkService {
  static Uri? _pendingLink;
  static DateTime? _lastProcessTime;
  
  static void init() {
    // 冷启动：检查应用是否通过深度链接启动
    _checkInitialLink();
    
    // 热启动：监听传入的链接
    _listenForLinks();
  }
}
```

### 冷启动处理

```dart
static Future<void> _checkInitialLink() async {
  final initialUri = await appLinks.getInitialLink();
  if (initialUri != null) {
    // 存储，供 GoRouter 重定向时使用
    _pendingLink = initialUri;
  }
}
```

待处理链接由 GoRouter 的重定向逻辑消费：

```dart
// 在 GoRouter 重定向中：
final pendingLink = DeepLinkService._pendingLink;
if (pendingLink != null && isAppRouterReady) {
  DeepLinkService._pendingLink = null;
  return pendingLink.toString();
}
```

### 热启动处理

```dart
static void _listenForLinks() {
  appLinks.uriLinkStream.listen((Uri uri) {
    // 重复预防
    if (_isDuplicate(uri)) return;
    
    _lastProcessTime = DateTime.now();
    _lastProcessedLink = uri.toString();
    
    // 过滤 OAuth URL（单独处理）
    if (_isOAuthUrl(uri)) return;
    
    // 通过 GoRouter 导航
    GoRouter.of(navigatorKey.currentContext!).go(uri.toString());
  });
}

static bool _isDuplicate(Uri uri) {
  final now = DateTime.now();
  return uri.toString() == _lastProcessedLink &&
      now.difference(_lastProcessTime!).inMilliseconds < 1000;
}
```

### OAuth URL 过滤

包含 OAuth 回调 URL（例如 `/auth/google/login`）的深度链接会被有意排除在导航处理之外——它们由专门的 OAuth 流程处理：

```dart
static bool _isOAuthUrl(Uri uri) {
  return uri.path.startsWith('/auth/') || 
         uri.path.startsWith('/oauth/') ||
         uri.host == '__/auth';  // Firebase OAuth 回调
}
```

### GoRouter 就绪协调

一个关键的同步点：深度链接服务必须等待 GoRouter 完全初始化后才能处理深度链接：

```dart
// 在全局 handler 或路由器设置中
static bool isAppRouterReady = false;

// 深度链接 handler 等待路由器就绪
static void _processPendingLink() {
  if (_pendingLink == null) return;
  
  // 轮询直到路由器就绪
  Future.delayed(Duration(milliseconds: 100), () {
    if (isAppRouterReady) {
      GoRouter.of(navigatorKey.currentContext!)
          .go(_pendingLink!.toString());
      _pendingLink = null;
    } else {
      _processPendingLink();  // 重试
    }
  });
}
```

---

## 4. 分享 + 深度链接集成流程

```
用户点击分享链接
         │
         ▼
┌─────────────────┐
│ 系统通过 URL    │
│ scheme 打开应用 │
└────────┬────────┘
         │
    ┌────┴────┐
    │ 冷启动   │          热启动
    └────┬────┘     ┌───────────┐
         │          │ uriLink-  │
    ┌────▼────┐     │ Stream    │
    │ get-    │     │ 触发      │
    │ Initial-│     └─────┬─────┘
    │ Link()  │           │
    └────┬────┘           │
         │                │
         ▼                ▼
    ┌────────────────────────┐
    │ DeepLinkService        │
    │ 处理 URI               │
    └────────┬───────────────┘
             │
             ▼
    ┌────────────────────────┐
    │ 过滤：OAuth？→ 跳过   │
    │ 重复？→ 跳过          │
    └────────┬───────────────┘
             │
             ▼
    ┌────────────────────────┐
    │ GoRouter 重定向        │
    │ 导航到 URI             │
    │ (未就绪时等待)         │
    └────────────────────────┘
```

---

## 5. 设计决策

| 决策 | 理由 |
|----------|-----------|
| **Fire-and-forget 初始化** | 深度链接设置不阻塞应用启动——注册后到达的链接通过 stream 处理 |
| **重复预防** | `_lastProcessedLink` + 时间窗口防止异步竞态导致的双重导航 |
| **OAuth URL 过滤** | OAuth 回调有自己的流程（令牌提取、状态验证）——避免与通用导航冲突 |
| **GoRouter 就绪轮询** | 深度链接可能在 GoRouter 初始化之前到达；轮询确保可靠导航 |
| **平台特定 URL scheme** | iOS 和 Android 对同一社交应用有不同的 URL scheme |
| **3 秒缩略图超时** | 分享图片是可选的，非关键——超时防止分享因图片加载慢而阻塞 |

---

## 关键要点

1. **`ShareService`** 提供原生系统分享 + 平台特定分享（WhatsApp/Telegram/Twitter/Facebook），支持 iPad 位置适配和缩略图预下载。
2. **`DeepLinkService`** 处理冷启动（通过 `getInitialLink`）和热启动（通过 `uriLinkStream`），并具备重复预防机制。
3. **`ShareContent`** 工厂构造函数（`product()`、`group()`）为不同场景提供类型安全的分享。
4. **OAuth URL 过滤** 防止深度链接导航与 OAuth 回调处理之间的冲突。
5. 通过轮询实现的 **GoRouter 就绪协调** 确保深度链接即使在路由器初始化之前到达也能可靠处理。
6. **平台自适应 URL scheme** 针对 iOS 和 Android 社交分享，在目标应用未安装时优雅回退到系统分享。
