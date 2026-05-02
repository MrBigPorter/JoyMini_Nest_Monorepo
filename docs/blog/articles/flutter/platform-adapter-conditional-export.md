# Platform Adapter 条件导出 — 跨平台代码的条件编译模式

> **Article F12** | **Difficulty:** ⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/adapter/`

## 1. 问题背景

Flutter 跨平台应用中，约 15-20% 的代码需要 **平台特定实现**：

| 功能 | iOS | Android | Web |
|------|-----|---------|-----|
| **状态栏** | SystemChrome | SystemChrome | 不支持 |
| **Haptic Feedback** | `HapticFeedback.mediumImpact` | `HapticFeedback.mediumImpact` | 静默 |
| **本地通知** | `UNUserNotificationCenter` | `FCM + NotificationCompat` | 不支持 |
| **App 内支付** | StoreKit | Google Play Billing | 不支持 |
| **文件选择** | `UIImagePickerController` | `ActivityResultContracts` | `<input type="file">` |
| **剪贴板** | `UIPasteboard` | `ClipboardManager` | `navigator.clipboard` |

**Platform Adapter** 模式用 **条件导出**（Conditional Export）将平台差异封装在适配器接口之后。

## 2. 条件导出原理

### 2.1 Dart 的条件导出

Dart 通过 `export` + `part` 的条件指令实现平台特化：

```dart
// core/adapter/platform_adapter.dart
export 'platform_adapter_stub.dart'
    if (dart.library.io) 'platform_adapter_io.dart'
    if (dart.library.html) 'platform_adapter_web.dart';
```

**关键规则**：
- `stub` 版本作为默认（编译时兜底）
- `dart.library.io` 匹配 iOS/Android/macOS
- `dart.library.html` 匹配 Web
- 编译器在编译期选择匹配的实现

### 2.2 抽象接口定义

```dart
// platform_adapter_stub.dart (默认实现)
abstract class PlatformAdapter {
  /// 平台名称
  String get platformName => 'unknown';

  /// 是否支持本地通知
  bool get supportsLocalNotifications => false;

  /// 是否支持 App 内支付
  bool get supportsInAppPurchase => false;

  /// 显示 Toast
  void showToast(String message) {}

  /// 复制到剪贴板
  Future<void> copyToClipboard(String text) async {}

  /// 获取设备型号
  String getDeviceModel() => 'unknown';

  /// 获取系统版本
  String getSystemVersion() => '0.0';
}
```

## 3. 各平台实现

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
    // 使用 FlutterToast 或 SnackBar
    Fluttertoast.showToast(msg: message);
  }

  Future<void> copyToClipboard(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    HapticFeedback.mediumImpact();
    showToast('Copied to clipboard');
  }

  String getDeviceModel() {
    // 通过 MethodChannel 获取
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
    // Web 使用 DOM Toast
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

  /// 平台类型判断
  static bool get isMobile =>
      instance.platformName == 'mobile' || instance.platformName == 'ios';

  static bool get isIOS {
    // 通过 defaultTargetPlatform 判断
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

## 5. 适配器模式在 Flutter 中的应用

### 5.1 StatusBar 适配

```dart
class StatusBarAdapter {
  static void setStyle(Brightness brightness) {
    if (kIsWeb) return; // Web 不支持

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

### 5.2 Haptic 反馈适配

```dart
class HapticAdapter {
  static void lightTap() {
    if (kIsWeb) return; // Web 无震动 API
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

### 5.3 键盘适配

```dart
class KeyboardAdapter {
  /// 关闭键盘（各平台行为不同）
  static void dismiss(BuildContext context) {
    final currentFocus = FocusScope.of(context);

    if (!currentFocus.hasPrimaryFocus) {
      currentFocus.unfocus();
    }

    // iOS: 还需要 resignFirstResponder
    if (Platform.isIOS) {
      SystemChannels.textInput.invokeMethod('TextInput.hide');
    }
  }

  /// 是否显示键盘
  static bool get isKeyboardVisible {
    // 通过 MediaQuery 或 ViewInsets
    return WidgetsBinding.instance.window.viewInsets.bottom > 0;
  }
}
```

### 5.4 安全区域适配

```dart
class SafeAreaAdapter {
  /// 获取底部安全区域高度
  static double getBottomPadding(BuildContext context) {
    if (kIsWeb) return 0;
    return MediaQuery.of(context).padding.bottom;
  }

  /// 获取顶部安全区域高度
  static double getTopPadding(BuildContext context) {
    if (kIsWeb) return 0;
    return MediaQuery.of(context).padding.top;
  }

  /// iPhone X+ 刘海屏适配
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

## 6. 更复杂的适配：Feature Adapter

对于大型功能（如支付、通知），使用 **Feature Adapter** 模式：

```dart
// 支付适配器接口
abstract class PaymentAdapter {
  Future<bool> isAvailable();
  Future<PaymentResult> processPayment(PaymentRequest request);
  Stream<PaymentEvent> get paymentEvents;
}

// iOS 实现
class IosPaymentAdapter extends PaymentAdapter {
  @override
  Future<bool> isAvailable() async {
    // SKPaymentQueue.canMakePayments()
    return true;
  }

  @override
  Future<PaymentResult> processPayment(PaymentRequest request) async {
    // StoreKit 实现
  }
}

// Android 实现
class AndroidPaymentAdapter extends PaymentAdapter {
  @override
  Future<bool> isAvailable() async {
    // Google Play Billing
    return true;
  }
}

// Web 实现（空操作）
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

## 7. 条件导出 vs 运行时判断

| 方面 | 条件导出 (Conditional Export) | 运行时判断 (kIsWeb / Platform) |
|------|-----------------------------|-------------------------------|
| **检查时机** | 编译期 | 运行时 |
| **死代码消除** | ✅ 彻底移除 | ❌ 保留所有分支 |
| **包体积** | 更小（仅包含目标平台代码） | 更大（包含所有平台） |
| **可测试性** | 需要 mock 编译配置 | 可直接 mock Platform |
| **复杂度** | 多文件维护 | 单文件 if/else |
| **适用场景** | 平台特定依赖（dart:html） | 简单行为差异 |

**最佳实践**：
- **条件导出**：平台特有的 import（如 `dart:html`、`package:storekit`）
- **运行时判断**：简单的行为差异（如动画时长、布局方向）

## 8. 完整示例：文件选择器

```dart
// 1. 抽象接口 (stub)
// file_picker_stub.dart
abstract class FilePickerAdapter {
  Future<List<PlatformFile>> pickImages({bool multiple = false});
}

// 2. iOS/Android 实现
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

// 3. Web 实现
// file_picker_web.dart
class FilePickerAdapter {
  Future<List<PlatformFile>> pickImages({bool multiple = false}) async {
    final input = html.FileUploadInputElement()
      ..accept = 'image/*'
      ..multiple = multiple;
    input.click();

    // 等待用户选择
    await input.onChange.first;
    return input.files!.map((file) => PlatformFile(
      name: file.name,
      size: file.size,
      bytes: await file.readAsBytes(),
    )).toList();
  }
}

// 4. 条件导出
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
      // 通过编译配置模拟
      // dart test --define=flutter.platform=ios
      final adapter = PlatformAdapterFactory.instance;
      expect(adapter.platformName, anyOf('mobile', 'ios'));
    });

    test('copyToClipboard works on all platforms', () async {
      final adapter = PlatformAdapterFactory.instance;
      await adapter.copyToClipboard('test');
      // 不抛出异常 = 通过
    });
  });
}
```

---

**下一篇预告**: [F14 — GlobalHandler + CallKit + WebRTC 通话] — 全局事件总线和通话系统
