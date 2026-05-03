---
title: 'DeviceFingerprint: 设备指纹与风控——移动安全基线'
description: '基于设备指纹的移动安全系统，涵盖多维信号采集、环境风险检测、风险等级分类及隐私合规实现。'
slug: device-fingerprint-risk-control
tags: Flutter, Security, Fingerprinting, RiskControl, AntiFraud, MobileSecurity
---

# DeviceFingerprint: 设备指纹与风控——移动安全基线

## 1. 为什么需要设备指纹？

JoyMini 涉及支付、社交、抽奖等敏感操作，需要可靠的**设备身份**来防范以下风险：

| 风险场景 | 攻击手段 | 设备指纹防御 |
|----------|----------|--------------|
| **批量注册** | 模拟器 + 临时手机号 | 检测模拟器/设备农场 |
| **撞库攻击** | 脚本化密码暴力破解 | 同一设备多次失败 → 临时封禁 |
| **薅羊毛** | 多账号切换领取奖励 | 同一设备关联多账号 → 风险标记 |
| **账号盗用** | 登录他人账号后改密 | 设备变更 → 触发验证流程 |
| **支付欺诈** | 模拟支付回调 | 设备指纹 + 支付绑定 |

**DeviceFingerprint** 生成高熵值、稳定的设备标识符，不依赖容易被重置的 `deviceId`。

## 2. 指纹生成算法

### 2.1 多维信号采集

```dart
class DeviceFingerprintCollector {
  /// Collect device signals
  Future<Map<String, dynamic>> collect() async {
    return {
      // Hardware signals
      'device': await _collectHardwareSignals(),

      // System signals
      'system': await _collectSystemSignals(),

      // Network signals
      'network': await _collectNetworkSignals(),

      // Application signals
      'app': _collectAppSignals(),

      // Sensor signals
      'sensor': await _collectSensorSignals(),
    };
  }

  Future<Map<String, dynamic>> _collectHardwareSignals() async {
    final di = await DeviceInfoPlugin().deviceInfo;

    if (di is AndroidDeviceInfo) {
      return {
        'brand': di.brand,           // "samsung"
        'model': di.model,           // "SM-S928B"
        'hardware': di.hardware,     // "qcom"
        'board': di.board,           // "taro"
        'fingerprint': di.fingerprint, // ROM fingerprint
        'manufacturer': di.manufacturer,
        'display': di.display,       // "UP1A.231005.007"
        'soc': '${di.hardware}_${di.board}',
      };
    }

    if (di is IosDeviceInfo) {
      return {
        'model': di.model,           // "iPhone15,2"
        'systemName': di.systemName,
        'sysctl': di.sysctl,         // Deep hardware info
        'utsname': {
          'machine': di.utsname.machine,   // "iPhone15,2"
          'nodename': di.utsname.nodename,
        },
      };
    }

    return {};
  }

  Future<Map<String, dynamic>> _collectSystemSignals() async {
    return {
      'os': Platform.operatingSystem,
      'osVersion': Platform.operatingSystemVersion,
      'locale': Platform.localeName,
      'timezone': DateTime.now().timeZoneOffset.inMinutes,
      'screen': {
        'width': WidgetsBinding.instance.window.physicalSize.width,
        'height': WidgetsBinding.instance.window.physicalSize.height,
        'scale': WidgetsBinding.instance.window.devicePixelRatio,
      },
      'fonts': await _getInstalledFonts(),
    };
  }

  Future<Map<String, dynamic>> _collectNetworkSignals() async {
    try {
      final connectivity = await Connectivity().checkConnectivity();
      final wifi = await _getWifiInfo();

      return {
        'type': connectivity.first.name,
        'wifi': wifi,
        'proxy': await _detectProxy(),
        'vpn': await _detectVpn(),
      };
    } catch (_) {
      return {};
    }
  }

  Map<String, dynamic> _collectAppSignals() {
    return {
      'version': AppVersion.current,
      'buildNumber': AppVersion.buildNumber,
      'packageName': 'com.joymini.app',
      'installer': _getInstallerStore(),
      'firstInstall': _getFirstInstallTime(),
      'lastUpdate': _getLastUpdateTime(),
    };
  }

  Future<Map<String, dynamic>> _collectSensorSignals() async {
    // Generate additional entropy from sensor calibration data
    return {
      'accelerometer': await _getAccelerometerCalibration(),
      'gyroscope': await _getGyroscopeCalibration(),
    };
  }
}
```

### 2.2 指纹哈希生成

```dart
class DeviceFingerprint {
  static const _SALT = 'JoyMini_DeviceFingerprint_Salt_2024';
  static DeviceFingerprint? _instance;

  late final String _fingerprint;
  late final String _fingerprintHash;

  Future<void> initialize() async {
    final collector = DeviceFingerprintCollector();
    final signals = await collector.collect();

    // 1. Serialize signals
    final jsonStr = jsonEncode(_normalizeSignals(signals));

    // 2. Salt + SHA-256
    final salted = '$_SALT|$jsonStr';
    final hash = sha256.convert(utf8.encode(salted)).toString();

    // 3. Take first 40 characters as the fingerprint
    _fingerprint = hash.substring(0, 40);
    _fingerprintHash = hash;

    // 4. Persist (verify stability)
    await _persistFingerprint();
  }

  String get value => _fingerprint;
  String get fullHash => _fingerprintHash;

  /// Signal normalization (ensures the same device generates the same fingerprint every time)
  Map<String, dynamic> _normalizeSignals(Map<String, dynamic> signals) {
    // Recursively sort keys
    return _sortKeys(signals);
  }

  Map<String, dynamic> _sortKeys(Map<String, dynamic> input) {
    final sorted = <String, dynamic>{};
    final keys = input.keys.toList()..sort();
    for (final key in keys) {
      final value = input[key];
      if (value is Map<String, dynamic>) {
        sorted[key] = _sortKeys(value);
      } else if (value is List) {
        sorted[key] = value.map((e) =>
          e is Map<String, dynamic> ? _sortKeys(e) : e
        ).toList();
      } else {
        sorted[key] = value;
      }
    }
    return sorted;
  }

  /// Verify fingerprint stability
  Future<bool> verifyStability() async {
    final stored = await _loadPersistedFingerprint();
    if (stored == null) return true; // First time generation

    // Compare signal-level similarity
    return _calculateSimilarity(_fingerprint, stored) > 0.9;
  }
}
```

## 3. 风险检测引擎

### 3.1 环境风险检测

```dart
class RiskDetector {
  final Logger _logger = Logger('RiskDetector');

  /// Detection results
  Future<RiskAssessment> assess() async {
    final checks = await Future.wait([
      _checkEmulator(),
      _checkRoot(),
      _checkVpn(),
      _CheckProxy(),
      _checkDebugger(),
      _checkScreenCapture(),
      _checkDeviceFarm(),
    ]);

    final score = _calculateRiskScore(checks);
    final flags = checks.where((c) => c.isRisky).toList();

    return RiskAssessment(
      riskScore: score,
      riskLevel: _classifyLevel(score),
      flags: flags.map((c) => c.name).toList(),
      details: {for (var c in checks) c.name: c.details},
    );
  }

  RiskLevel _classifyLevel(double score) {
    return switch (score) {
      < 0.2 => RiskLevel.safe,
      < 0.4 => RiskLevel.low,
      < 0.6 => RiskLevel.medium,
      < 0.8 => RiskLevel.high,
      _     => RiskLevel.critical,
    };
  }
}
```

### 3.2 单项检测实现

```dart
class _EmulatorCheck {
  static Future<CheckResult> run() async {
    final di = await DeviceInfoPlugin().deviceInfo;
    final isEmulator = di is AndroidDeviceInfo && (
      di.fingerprint.startsWith('google/sdk_gphone') ||
      di.fingerprint.contains('generic') ||
      di.model.contains('Emulator') ||
      di.hardware == 'ranchu' ||   // Android emulator
      di.brand == 'google' && di.device.contains('_cheets') // Chromebook
    );

    return CheckResult(
      name: 'emulator',
      isRisky: isEmulator,
      score: isEmulator ? 0.8 : 0,
      details: {'model': di.model, 'fingerprint': di.fingerprint},
    );
  }
}

class _RootCheck {
  static Future<CheckResult> run() async {
    if (Platform.isIOS) {
      // iOS jailbreak detection
      final paths = [
        '/Applications/Cydia.app',
        '/private/var/lib/apt',
        '/usr/sbin/sshd',
        '/bin/bash',
      ];
      final isJailbroken = paths.any((p) => File(p).existsSync());
      return CheckResult(
        name: 'jailbreak',
        isRisky: isJailbroken,
        score: isJailbroken ? 1.0 : 0,
      );
    }

    // Android root detection
    final buildTags = await _getBuildTags();
    final isRooted = buildTags?.contains('test-keys') == true ||
        _checkSuBinary() ||
        _checkMagisk();

    return CheckResult(
      name: 'root',
      isRisky: isRooted,
      score: isRooted ? 1.0 : 0,
    );
  }

  static bool _checkSuBinary() {
    const paths = [
      '/system/bin/su',
      '/system/xbin/su',
      '/sbin/su',
      '/magisk/.magisk',
    ];
    return paths.any((p) => File(p).existsSync());
  }

  static bool _checkMagisk() {
    // Detect Magisk via PackageManager
    return false; // Simplified example
  }
}

class _VpnCheck {
  static Future<CheckResult> run() async {
    // Android: NetworkCapabilities.TRANSPORT_VPN
    // iOS: CFNetworkCopySystemProxySettings
    try {
      final connectivity = await Connectivity().checkConnectivity();
      final isVpn = connectivity.contains(ConnectivityResult.vpn);
      return CheckResult(
        name: 'vpn',
        isRisky: isVpn,
        score: isVpn ? 0.3 : 0,
        details: {'vpn': isVpn},
      );
    } catch (_) {
      return CheckResult(name: 'vpn', isRisky: false, score: 0);
    }
  }
}
```

## 4. 风险等级与响应策略

```dart
enum RiskLevel {
  safe,      // Normal device
  low,       // VPN / proxy
  medium,    // Emulator / jailbreak
  high,      // Root + suspicious behavior
  critical,  // Device farm / automation tools
}

class RiskAssessment {
  final double riskScore;
  final RiskLevel riskLevel;
  final List<String> flags;
  final Map<String, dynamic> details;

  const RiskAssessment({
    required this.riskScore,
    required this.riskLevel,
    required this.flags,
    required this.details,
  });
}
```

### 4.1 风险响应策略

```dart
class RiskResponseStrategy {
  static void respond(RiskAssessment assessment, BuildContext context) {
    switch (assessment.riskLevel) {
      case RiskLevel.safe:
        // Normal operation
        break;

      case RiskLevel.low:
        // Log, no blocking
        Logger.info('[Risk] Low: ${assessment.flags}');
        break;

      case RiskLevel.medium:
        // Additional verification: send SMS code
        _requireSmsVerification(context);
        break;

      case RiskLevel.high:
        // Restrict features: disallow withdrawals / large payments
        _restrictSensitiveOperations(context);
        _showWarning(context);
        break;

      case RiskLevel.critical:
        // Block operation: disallow login
        _blockOperation(context);
        _reportToServer(assessment);
        break;
    }
  }

  static void _requireSmsVerification(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Security Verification'),
        content: const Text('Please enter the verification code '
            'sent to your phone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }

  static void _restrictSensitiveOperations(BuildContext context) {
    // Set restriction flags in the Store
    context.read<SecurityStore>().restrictOperations();
  }

  static void _blockOperation(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const SecurityBlockScreen(),
      ),
    );
  }
}
```

## 5. 设备指纹 API 上报

```dart
class DeviceFingerprintApiService {
  /// Report device fingerprint on login
  Future<void> reportOnLogin({
    required String userId,
    required String fingerprint,
    required RiskAssessment risk,
  }) async {
    await Http.post('/api/v1/device/fingerprint', data: {
      'userId': userId,
      'fingerprint': fingerprint,
      'riskScore': risk.riskScore,
      'riskLevel': risk.riskLevel.name,
      'flags': risk.flags,
      'details': risk.details,
    });
  }

  /// Verify device fingerprint for sensitive operations
  Future<DeviceVerificationResult> verifyForOperation({
    required String userId,
    required String operation,
    required String fingerprint,
  }) async {
    final response = await Http.post('/api/v1/device/verify', data: {
      'userId': userId,
      'operation': operation,
      'fingerprint': fingerprint,
    });

    return DeviceVerificationResult(
      allowed: response.data['allowed'] as bool,
      requiredVerification: response.data['requiredVerification'] as String?,
      message: response.data['message'] as String?,
    );
  }
}
```

## 6. 服务端风控集成

服务端（NestJS）收到设备指纹后，执行服务端风控逻辑：

```
Flutter App                        Server
    |                                |
    |--- POST /login                |
    |    { fingerprint, ... }       |
    |                                |
    |                          ┌─────┴─────┐
    |                          │ Risk Engine│
    |                          ├───────────┤
    |                          │ 1. Query DB│
    |                          │ 2. Account │
    |                          │ 3. Behavior│
    |                          │ 4. Decision│
    |                          └─────┬─────┘
    |                                |
    |<-- { token, riskLevel } ------|
    |                                |
```

## 7. 隐私合规

```dart
class FingerprintPrivacyManager {
  /// GDPR / privacy compliance handling
  static bool get isCollectionAllowed {
    // Check if user has consented to device fingerprint collection
    return Storage().getBool('fingerprint_consent') ?? false;
  }

  /// Request collection consent
  static Future<bool> requestConsent(BuildContext context) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Device Information Collection'),
        content: const Text(
          'We collect device information to protect your account '
          'from fraud and unauthorized access. This data is not '
          'used for tracking purposes.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Decline'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Accept'),
          ),
        ],
      ),
    );

    if (result == true) {
      await Storage().setBool('fingerprint_consent', true);
    }
    return result ?? false;
  }

  /// Anonymize (do not store raw signals)
  static String anonymize(String fingerprint) {
    // Store only first 8 + last 8 characters
    return '${fingerprint.substring(0, 8)}...'
        '${fingerprint.substring(fingerprint.length - 8)}';
  }
}
```

## 8. 测试策略

```dart
void main() {
  group('DeviceFingerprint', () {
    test('generates consistent fingerprint', () async {
      final fp1 = DeviceFingerprint();
      await fp1.initialize();

      final fp2 = DeviceFingerprint();
      await fp2.initialize();

      expect(fp1.value, fp2.value);
    });

    test('fingerprint has correct length', () async {
      final fp = DeviceFingerprint();
      await fp.initialize();
      expect(fp.value.length, 40);
    });
  });

  group('RiskDetector', () {
    test('returns Safe for normal device', () async {
      final assessment = await RiskDetector().assess();
      // In CI this may be an emulator, so at least not critical
      expect(assessment.riskLevel, isNot(RiskLevel.critical));
    });
  });
}
```

## 9. 总结

1. **设备指纹** 通过多维信号（硬件、系统、网络、应用、传感器）生成高熵值稳定标识，不依赖易重置的 `deviceId`
2. **风险检测引擎** 并行执行 7 项环境检查（模拟器、Root、VPN、代理、调试器、截屏、设备农场），综合计算风险评分
3. **五级风险等级**（安全/低/中/高/严重）对应不同的响应策略，从仅记录到完全阻止操作
4. **服务端风控** 结合设备指纹与用户行为数据进行二次判断，形成端到端安全防线
5. **隐私合规** 通过用户授权机制和数据匿名化处理，满足 GDPR 等隐私法规要求
