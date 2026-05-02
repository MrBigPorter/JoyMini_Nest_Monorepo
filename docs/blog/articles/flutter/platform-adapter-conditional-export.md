---
title: "Platform Adapter: Conditional Export — Cross-Platform Conditional Compilation Pattern"
description: "Exploration of the Platform Adapter pattern using Dart's conditional exports to encapsulate platform-specific implementations behind a unified interface, supporting iOS, Android, and Web with proper dead code elimination."
slug: platform-adapter-conditional-export
tags: [Flutter, Architecture, CrossPlatform, ConditionalExport, Adapter]
---

## 1. Problem Context

In Flutter cross-platform applications, approximately 15-20% of code requires **platform-specific implementations**:

| Feature | iOS | Android | Web |
|------|-----|---------|-----|
| **Status Bar** | SystemChrome | SystemChrome | Not supported |
| **Haptic Feedback** | `HapticFeedback.mediumImpact` | `HapticFeedback.mediumImpact` | Silent |
| **Local Notifications** | `UNUserNotificationCenter` | `FCM + NotificationCompat` | Not supported |
| **In-App Payments** | StoreKit | Google Play Billing | Not supported |
| **File Picker** | `UIImagePickerController` | `ActivityResultContracts` | `<input type="file">` |
| **Clipboard** | `UIPasteboard` | `ClipboardManager` | `navigator.clipboard` |

**Platform Adapter** pattern uses **Conditional Export** to encapsulate platform differences behind an adapter interface.

## 2. Conditional Export Principles

### 2.1 Dart Conditional Export

Dart achieves platform specialization through `export` + conditional directives:

```dart
// core/adapter/platform_adapter.dart
export 'platform_adapter_stub.dart'
    if (dart.library.io) 'platform_adapter_io.dart'
    if (dart.library.html) 'platform_adapter_web.dart';
```

**Key Rules**:
- `stub` version serves as default (compile-time fallback)
- `dart.library.io` matches iOS/Android/macOS
- `dart.library.html` matches Web
- The compiler selects the matching implementation at compile time

### 2.2 Abstract Interface Definition

```dart
// platform_adapter_stub.dart (default implementation)
abstract class PlatformAdapter {
  /// Platform name
  String get platformName => 'unknown';

  /// Whether local notifications are supported
  bool get supportsLocalNotifications => false;

  /// Whether in-app purchases are supported
  bool get supportsInAppPurchase => false;

  /// Show a toast
  void showToast(String message) {}

  /// Copy to clipboard
  Future<void> copyToClipboard(String text) async {}

  /// Get device model
  String getDeviceModel() => 'unknown';

  /// Get system version
  String getSystemVersion() => '0.0';
}
```

## 3. Platform Implementations

### 3.1 iOS/Android Native Implementation

```dart
// platform_adapter_io.dart
import 'package:flutter/services.dart';

class PlatformAdapter {
  String get platformName => 'mobile';

  bool get supportsLocalNotifications => true;

  bool get supportsInAppPurchase => true;

  void showToast(String message) {
    HapticFeedback.lightImpact();
    // Use FlutterToast or SnackBar
    Fluttertoast.showToast(msg: message);
  }

  Future<void> copyToClipboard(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    HapticFeedback.mediumImpact();
    showToast('Copied to clipboard');
  }

  String getDeviceModel() {
    // Via MethodChannel
    return _deviceInfo.model ?? 'unknown';
  }

  String getSystemVersion() {
    return Platform.operatingSystemVersion;
  }
}
```

### 3.2 Web Implementation

```dart
// platform_adapter_web.dart
import 'dart:html' as html;

class PlatformAdapter {
  String get platformName => 'web';

  bool get supportsLocalNotifications => false;

  bool get supportsInAppPurchase => false;

  void showToast(String message) {
    // Web uses DOM Toast
    final toast = html.DivElement()
      ..text = message
      ..style.position = 'fixed'
      ..style.bottom = '24px'
      ..style.left = '50%'
      ..style.transform = 'translateX(-50%)'
      ..style.padding = '12px 24px'
      ..style.background = '#333'
      ..style.color = '#fff'
      ..style.borderRadius = '8px'
      ..style.zIndex = '9999';

    html.document.body?.append(toast);
    Future.delayed(const Duration(seconds: 2), () => toast.remove());
  }

  Future<void> copyToClipboard(String text) async {
    await html.window.navigator.clipboard?.writeText(text);
  }

  String getDeviceModel() => html.window.navigator.userAgent ?? 'unknown';

  String getSystemVersion() => html.window.navigator.appVersion ?? '0.0';
}
```

## 4. Adapter Factory

### 4.1 Singleton Access

```dart
// platform_adapter.dart
import 'platform_adapter_stub.dart'
    if (dart.library.io) 'platform_adapter_io.dart'
    if (dart.library.html) 'platform_adapter_web.dart';

class PlatformAdapterFactory {
  static PlatformAdapter? _instance;

  static PlatformAdapter get instance {
    _instance ??= PlatformAdapter();
    return _instance!;
  }

  /// Platform type detection
  static bool get isMobile =>
      instance.platformName == 'mobile' || instance.platformName == 'ios';

  static bool get isIOS {
    // Via defaultTargetPlatform
    return defaultTargetPlatform == TargetPlatform.iOS;
  }

  static bool get isAndroid {
    return defaultTargetPlatform == TargetPlatform.android;
  }

  static bool get isWeb => kIsWeb;
}
```

### 4.2 Context Extension

```dart
extension PlatformContextExtension on BuildContext {
  PlatformAdapter get adapter => PlatformAdapterFactory.instance;

  bool get isMobile => PlatformAdapterFactory.isMobile;
  bool get isIOS => PlatformAdapterFactory.isIOS;
  bool get isAndroid => PlatformAdapterFactory.isAndroid;
  bool get isWeb => PlatformAdapterFactory.isWeb;
}
```

## 5. Adapter Pattern Applications in Flutter

### 5.1 StatusBar Adapter

```dart
class StatusBarAdapter {
  static void setStyle(Brightness brightness) {
    if (kIsWeb) return; // Web not supported

    SystemChrome.setSystemUIOverlayStyle(
      SystemUIOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: brightness,
      ),
    );
  }

  static void setHidden(bool hidden) {
    if (kIsWeb) return;

    SystemChrome.setEnabledSystemUIMode(
      hidden ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge,
    );
  }
}
```

### 5.2 Haptic Feedback Adapter

```dart
class HapticAdapter {
  static void lightTap() {
    if (kIsWeb) return; // Web has no vibration API
    HapticFeedback.lightImpact();
  }

  static void mediumTap() {
    if (kIsWeb) return;
    HapticFeedback.mediumImpact();
  }

  static void heavyTap() {
    if (kIsWeb) return;
    HapticFeedback.heavyImpact();
  }

  static void selectionClick() {
    if (kIsWeb) return;
    HapticFeedback.selectionClick();
  }
}
```

### 5.3 Keyboard Adapter

```dart
class KeyboardAdapter {
  /// Dismiss keyboard (behavior varies by platform)
  static void dismiss(BuildContext context) {
    final currentFocus = FocusScope.of(context);

    if (!currentFocus.hasPrimaryFocus) {
      currentFocus.unfocus();
    }

    // iOS: also needs resignFirstResponder
    if (Platform.isIOS) {
      SystemChannels.textInput.invokeMethod('TextInput.hide');
    }
  }

  /// Whether keyboard is visible
  static bool get isKeyboardVisible {
    // Via MediaQuery or ViewInsets
    return WidgetsBinding.instance.window.viewInsets.bottom > 0;
  }
}
```

### 5.4 Safe Area Adapter

```dart
class SafeAreaAdapter {
  /// Get bottom safe area padding
  static double getBottomPadding(BuildContext context) {
    if (kIsWeb) return 0;
    return MediaQuery.of(context).padding.bottom;
  }

  /// Get top safe area padding
  static double getTopPadding(BuildContext context) {
    if (kIsWeb) return 0;
    return MediaQuery.of(context).padding.top;
  }

  /// iPhone X+ notch adaptation
  static Widget wrapWithSafeArea({
    required Widget child,
    bool top = true,
    bool bottom = true,
  }) {
    if (kIsWeb) return child;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: SafeArea(
        top: top,
        bottom: bottom,
        child: child,
      ),
    );
  }
}
```

## 6. Advanced Adaptation: Feature Adapter

For large features (e.g., payments, notifications), use the **Feature Adapter** pattern:

```dart
// Payment adapter interface
abstract class PaymentAdapter {
  Future<bool> isAvailable();
  Future<PaymentResult> processPayment(PaymentRequest request);
  Stream<PaymentEvent> get paymentEvents;
}

// iOS implementation
class IosPaymentAdapter extends PaymentAdapter {
  @override
  Future<bool> isAvailable() async {
    // SKPaymentQueue.canMakePayments()
    return true;
  }

  @override
  Future<PaymentResult> processPayment(PaymentRequest request) async {
    // StoreKit implementation
  }
}

// Android implementation
class AndroidPaymentAdapter extends PaymentAdapter {
  @override
  Future<bool> isAvailable() async {
    // Google Play Billing
    return true;
  }
}

// Web implementation (no-op)
class WebPaymentAdapter extends PaymentAdapter {
  @override
  Future<bool> isAvailable() async => false;

  @override
  Future<PaymentResult> processPayment(PaymentRequest request) async {
    throw UnsupportedError('Payments not available on web');
  }
}
```

### 6.1 Runtime Injection

```dart
class PaymentAdapterFactory {
  static PaymentAdapter create() {
    if (kIsWeb) return WebPaymentAdapter();

    return switch (defaultTargetPlatform) {
      TargetPlatform.iOS => IosPaymentAdapter(),
      TargetPlatform.android => AndroidPaymentAdapter(),
      _ => throw UnsupportedError('Platform not supported'),
    };
  }
}
```

## 7. Conditional Export vs Runtime Checking

| Aspect | Conditional Export | Runtime Checking (kIsWeb / Platform) |
|--------|-------------------|---------------------------------------|
| **Check Timing** | Compile time | Runtime |
| **Dead Code Elimination** | ✅ Fully removed | ❌ All branches retained |
| **Bundle Size** | Smaller (target platform code only) | Larger (all platforms included) |
| **Testability** | Needs mock compile config | Can directly mock Platform |
| **Complexity** | Multi-file maintenance | Single-file if/else |
| **Use Case** | Platform-specific imports (dart:html) | Simple behavioral differences |

**Best Practices**:
- **Conditional Export**: Platform-specific imports (e.g., `dart:html`, `package:storekit`)
- **Runtime Checking**: Simple behavioral differences (e.g., animation duration, layout direction)

## 8. Complete Example: File Picker

```dart
// 1. Abstract interface (stub)
// file_picker_stub.dart
abstract class FilePickerAdapter {
  Future<List<PlatformFile>> pickImages({bool multiple = false});
}

// 2. iOS/Android implementation
// file_picker_io.dart
class FilePickerAdapter {
  Future<List<PlatformFile>> pickImages({bool multiple = false}) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: multiple,
    );
    return result?.files ?? [];
  }
}

// 3. Web implementation
// file_picker_web.dart
class FilePickerAdapter {
  Future<List<PlatformFile>> pickImages({bool multiple = false}) async {
    final input = html.FileUploadInputElement()
      ..accept = 'image/*'
      ..multiple = multiple;
    input.click();

    // Wait for user selection
    await input.onChange.first;
    return input.files!.map((file) => PlatformFile(
      name: file.name,
      size: file.size,
      bytes: await file.readAsBytes(),
    )).toList();
  }
}

// 4. Conditional export
// file_picker.dart
export 'file_picker_stub.dart'
    if (dart.library.io) 'file_picker_io.dart'
    if (dart.library.html) 'file_picker_web.dart';
```

## 9. Testing Strategy

```dart
void main() {
  group('PlatformAdapter', () {
    test('uses io implementation on mobile', () {
      // Simulate via compile config
      // dart test --define=flutter.platform=ios
      final adapter = PlatformAdapterFactory.instance;
      expect(adapter.platformName, anyOf('mobile', 'ios'));
    });

    test('copyToClipboard works on all platforms', () async {
      final adapter = PlatformAdapterFactory.instance;
      await adapter.copyToClipboard('test');
      // No exception thrown = pass
    });
  });
}
```
