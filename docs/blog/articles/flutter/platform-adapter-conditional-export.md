---
title: 'PlatformAdapter：条件导出——跨平台条件编译模式'
description: 深入探讨 Flutter 中利用 Dart 条件导出机制实现的 PlatformAdapter 模式，将平台特定实现封装在统一接口之后，支持 iOS、Android 和 Web，并实现死代码消除。
slug: platform-adapter-conditional-export
tags: Flutter, Architecture, CrossPlatform, ConditionalExport, Adapter
---

## 1. 背景

在 Flutter 跨平台应用中，大约 15-20% 的代码需要**平台特定实现**：

| 功能 | iOS | Android | Web |
|------|-----|---------|-----|
| **状态栏** | SystemChrome | SystemChrome | 不支持 |
| **触觉反馈** | `HapticFeedback.mediumImpact` | `HapticFeedback.mediumImpact` | 静默 |
| **本地通知** | `UNUserNotificationCenter` | `FCM + NotificationCompat` | 不支持 |
| **应用内支付** | StoreKit | Google Play Billing | 不支持 |
| **文件选择器** | `UIImagePickerController` | `ActivityResultContracts` | `<input type="file">` |
| **剪贴板** | `UIPasteboard` | `ClipboardManager` | `navigator.clipboard` |

**PlatformAdapter** 模式利用**条件导出（Conditional Export）**，将平台差异封装在适配器接口之后。

## 2. 条件导出原理

### 2.1 Dart 条件导出

Dart 通过 `export` + 条件指令实现平台特化：

```dart
// core/adapter/platform_adapter.dart
export 'platform_adapter_stub.dart'
    if (dart.library.io) 'platform_adapter_io.dart'
    if (dart.library.html) 'platform_adapter_web.dart';
```

**关键规则**：
- `stub` 版本作为默认值（编译期回退）
- `dart.library.io` 匹配 iOS/Android/macOS
- `dart.library.html` 匹配 Web
- 编译器在编译期选择匹配的实现

### 2.2 抽象接口定义

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

## 3. 平台实现

### 3.1 iOS/Android 原生实现

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

### 3.2 Web 实现

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

## 4. 适配器工厂

### 4.1 单例访问

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

### 4.2 Context 扩展

```dart
extension PlatformContextExtension on BuildContext {
  PlatformAdapter get adapter => PlatformAdapterFactory.instance;

  bool get isMobile => PlatformAdapterFactory.isMobile;
  bool get isIOS => PlatformAdapterFactory.isIOS;
  bool get isAndroid => PlatformAdapterFactory.isAndroid;
  bool get isWeb => PlatformAdapterFactory.isWeb;
}
```

## 5. Flutter 中的适配器模式应用

### 5.1 状态栏适配器

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

### 5.2 触觉反馈适配器

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

### 5.3 键盘适配器

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

### 5.4 安全区域适配器

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

## 6. 高级适配：Feature Adapter

对于大型功能（如支付、通知），使用 **Feature Adapter** 模式：

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

### 6.1 运行时注入

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

## 7. 条件导出 vs 运行时检查

| 维度 | 条件导出 | 运行时检查（kIsWeb / Platform） |
|------|---------|--------------------------------|
| **检查时机** | 编译期 | 运行时 |
| **死代码消除** | ✅ 完全移除 | ❌ 保留所有分支 |
| **包体积** | 更小（仅目标平台代码） | 更大（包含所有平台） |
| **可测试性** | 需要模拟编译配置 | 可直接模拟 Platform |
| **复杂度** | 多文件维护 | 单文件 if/else |
| **适用场景** | 平台特定导入（dart:html） | 简单行为差异 |

**最佳实践**：
- **条件导出**：平台特定导入（如 `dart:html`、`package:storekit`）
- **运行时检查**：简单行为差异（如动画时长、布局方向）

## 8. 完整示例：文件选择器

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

## 9. 测试策略

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

## 10. 总结

1. **PlatformAdapter 模式**利用 Dart 条件导出机制，在编译期将平台特定实现封装在统一接口之后，实现死代码消除。
2. **条件导出 vs 运行时检查**：条件导出在编译期选择实现，完全移除其他平台的代码，包体积更小；运行时检查保留所有分支，适用于简单行为差异。
3. **Feature Adapter** 模式适用于大型功能（支付、通知），通过抽象接口 + 运行时注入实现平台适配。
4. **测试策略**：条件导出需要模拟编译配置进行测试，运行时检查可以直接模拟 Platform 对象。
5. **最佳实践**：平台特定导入使用条件导出，简单行为差异使用运行时检查，两者互补而非互斥。
