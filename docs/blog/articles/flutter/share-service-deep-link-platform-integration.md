---
title: "ShareService + DeepLinkService: Multi-Platform Sharing and Deep Link Integration"
slug: share-service-deep-link-platform-integration
tags: Flutter, Sharing, DeepLink, PlatformIntegration, Navigation
description: A multi-platform sharing and deep link system with platform-specific URL schemes, cold/warm start handling, duplicate prevention, and OAuth URL filtering.
---

# ShareService + DeepLinkService: Multi-Platform Sharing and Deep Link Integration

## Overview

The sharing and deep link system consists of two services handling external communication:

- [`ShareService`](JoyMini_Flutter_App/lib/features/share/services/share_service.dart) (172 lines) — Multi-platform sharing with platform-specific URL schemes
- [`DeepLinkService`](JoyMini_Flutter_App/lib/features/share/services/deep_link_service.dart) (126 lines) — Deep link interception with cold/warm start handling
- [`ShareContent`](JoyMini_Flutter_App/lib/features/share/models/share_content.dart) (50 lines) — Typed share content model with factory constructors

---

## 1. ShareService: Multi-Platform Sharing

The service provides a unified API for system sharing and platform-specific social sharing.

### System Sharing

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

### Platform-Specific Sharing

Platform-specific sharing uses URL schemes that differ between iOS and Android:

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

| Platform | iOS URL Scheme | Android URL Scheme |
|----------|---------------|-------------------|
| WhatsApp | `https://api.whatsapp.com/send?text=` | `whatsapp://send?text=` |
| Telegram | `tg://msg?text=` | `tg://msg?text=` |
| Twitter/X | `https://twitter.com/intent/tweet?text=` | Same (web-based) |
| Facebook | `fb://share?text=` | `fb://share?text=` |

### iPad Share Positioning

On iPad, the system share sheet needs an origin position:

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

### Thumbnail Pre-download

For shares containing images, thumbnails are pre-downloaded before sharing with a 3-second timeout:

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

### Web Fallback

On web, native sharing may not be available:

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

## 2. ShareContent Model

[`ShareContent`](JoyMini_Flutter_App/lib/features/share/models/share_content.dart) is a typed model providing factory constructors for different share scenarios:

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

## 3. DeepLinkService: Deep Link Handling

The deep link service handles both cold starts (app launched via link) and warm starts (app already running).

### Initialization

Initialized as fire-and-forget in [`AppBootstrap.initSystem()`](app-bootstrap-data-barrier-parallel-init.md):

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

### Cold Start Handling

```dart
static Future<void> _checkInitialLink() async {
  final initialUri = await appLinks.getInitialLink();
  if (initialUri != null) {
    // Store for GoRouter redirect consumption
    _pendingLink = initialUri;
  }
}
```

The pending link is consumed by GoRouter's redirect logic:

```dart
// In GoRouter redirect:
final pendingLink = DeepLinkService._pendingLink;
if (pendingLink != null && isAppRouterReady) {
  DeepLinkService._pendingLink = null;
  return pendingLink.toString();
}
```

### Warm Start Handling

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

### OAuth URL Filtering

Deep links containing OAuth callback URLs (e.g., `/auth/google/login`) are intentionally excluded from navigation handling — they are processed by the dedicated OAuth flow:

```dart
static bool _isOAuthUrl(Uri uri) {
  return uri.path.startsWith('/auth/') || 
         uri.path.startsWith('/oauth/') ||
         uri.host == '__/auth';  // Firebase OAuth callback
}
```

### GoRouter Readiness Coordination

A critical synchronization point: the deep link service must wait for GoRouter to be fully initialized before processing deep links:

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

## 4. Share + Deep Link Integration Flow

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

## 5. Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Fire-and-forget init** | Deep link setup doesn't block app startup — links arriving after registration are handled via stream |
| **Duplicate prevention** | `_lastProcessedLink` + time window prevents double-navigation from async races |
| **OAuth URL filtering** | OAuth callbacks have their own flow (token extraction, state validation) — avoid conflict with generic navigation |
| **GoRouter readiness polling** | Deep links may arrive before GoRouter init; polling ensures reliable navigation |
| **Platform-specific URL schemes** | iOS and Android use different URL schemes for the same social apps |
| **3-second thumbnail timeout** | Share images are optional, non-critical — timeout prevents slow image loading from blocking share |

---

## Key Takeaways

1. **`ShareService`** provides native system share + platform-specific sharing (WhatsApp/Telegram/Twitter/Facebook) with iPad positioning and thumbnail pre-download.
2. **`DeepLinkService`** handles cold starts (via `getInitialLink`) and warm starts (via `uriLinkStream`) with duplicate prevention.
3. **`ShareContent`** factory constructors (`product()`, `group()`) provide type-safe sharing for different scenarios.
4. **OAuth URL filtering** prevents conflict between deep link navigation and OAuth callback handling.
5. **GoRouter readiness coordination** via polling ensures reliable deep link handling even if links arrive before router initialization.
6. **Platform-adaptive URL schemes** target iOS and Android social sharing, gracefully falling back to system sharing when the target app is not installed.
