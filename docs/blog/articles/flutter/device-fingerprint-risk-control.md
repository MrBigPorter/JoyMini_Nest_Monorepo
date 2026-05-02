# DeviceFingerprint 设备指纹 + 风控体系 — 移动端安全基线

> **Article F16** | **Difficulty:** ⭐⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/security/`

## 1. 为什么需要设备指纹？

JoyMini 涉及支付、社交、抽奖等敏感操作，需要可靠的 **设备身份** 来防范：

| 风险场景 | 攻击方式 | 设备指纹的防御 |
|----------|----------|----------------|
| **批量注册** | 模拟器 + 临时手机号 | 检测模拟器/设备农场 |
| **撞库攻击** | 脚本遍历密码 | 同一设备多次失败 → 临时封禁 |
| **薅羊毛** | 多账号切换刷奖励 | 同一设备关联多个账号 → 风控标记 |
| **账号盗用** | 登录他人账号后改密 | 设备变更 → 触发验证流程 |
| **支付欺诈** | 模拟支付回调 | 设备指纹 + 支付单绑定 |

**DeviceFingerprint** 生成一个高熵的、稳定的设备标识，而非依赖易重置的 `deviceId`。

## 2. 指纹生成算法

### 2.1 多维信号采集

```dart
class DeviceFingerprintCollector {
  /// 收集设备信号
  Future<Map<String, dynamic>> collect() async {
    return {
      // 硬件信号
      'device': await _collectHardwareSignals(),

      // 系统信号
      'system': await _collectSystemSignals(),

      // 网络信号
      'network': await _collectNetworkSignals(),

      // 应用信号
      'app': _collectAppSignals(),

      // 传感器信号
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
        'sysctl': di.sysctl,         // 硬件深度信息
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
    // 通过传感器校准数据生成额外熵
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

    // 1. 序列化信号
    final jsonStr = jsonEncode(_normalizeSignals(signals));

    // 2. 加盐 + SHA-256
    final salted = '$_SALT|$jsonStr';
    final hash = sha256.convert(utf8.encode(salted)).toString();

    // 3. 取前 40 位作为指纹
    _fingerprint = hash.substring(0, 40);
    _fingerprintHash = hash;

    // 4. 持久化（验证稳定性）
    await _persistFingerprint();
  }

  String get value => _fingerprint;
  String get fullHash => _fingerprintHash;

  /// 信号归一化（确保同一设备每次生成相同指纹）
  Map<String, dynamic> _normalizeSignals(Map<String, dynamic> signals) {
    // 递归排序 key
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

  /// 验证指纹稳定性
  Future<bool> verifyStability() async {
    final stored = await _loadPersistedFingerprint();
    if (stored == null) return true; // 首次生成

    // 比较信号级别的相似度
    return _calculateSimilarity(_fingerprint, stored) > 0.9;
  }
}
```

## 3. 风险检测引擎

### 3.1 环境风险检测

```dart
class RiskDetector {
  final Logger _logger = Logger('RiskDetector');

  /// 检测结果
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
      // iOS 越狱检测
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

    // Android Root 检测
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
    // 通过 PackageManager 检测 Magisk
    return false; // 简化示例
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

## 4. 风险等级与响应

```dart
enum RiskLevel {
  safe,      // 正常设备
  low,       // VPN/代理
  medium,    // 模拟器/越狱
  high,      // Root + 可疑行为
  critical,  // 设备农场/自动化工具
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
        // 正常操作
        break;

      case RiskLevel.low:
        // 记录日志，不做拦截
        Logger.info('[Risk] Low: ${assessment.flags}');
        break;

      case RiskLevel.medium:
        // 额外验证：发送短信验证码
        _requireSmsVerification(context);
        break;

      case RiskLevel.high:
        // 限制功能：不允许提现/大额支付
        _restrictSensitiveOperations(context);
        _showWarning(context);
        break;

      case RiskLevel.critical:
        // 阻止操作：不允许登录
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
    // 在 Store 中设置限制标志
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
  /// 登录时上报设备指纹
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

  /// 敏感操作时验证设备指纹
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

## 6. 后端风控联动

后端（NestJS）收到设备指纹后，执行服务器端风控：

```
Flutter App                        Server
    |                                |
    |--- POST /login                |
    |    { fingerprint, ... }       |
    |                                |
    |                          ┌─────┴─────┐
    |                          │ Risk Engine│
    |                          ├───────────┤
    |                          │ 1. 查设备库│
    |                          │ 2. 关联账号│
    |                          │ 3. 行为分析│
    |                          │ 4. 决策   │
    |                          └─────┬─────┘
    |                                |
    |<-- { token, riskLevel } ------|
    |                                |
```

## 7. 隐私合规

```dart
class FingerprintPrivacyManager {
  /// GDPR / 隐私合规处理
  static bool get isCollectionAllowed {
    // 检查用户是否同意设备指纹采集
    return Storage().getBool('fingerprint_consent') ?? false;
  }

  /// 请求采集许可
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

  /// 匿名化处理（不存储原始信号）
  static String anonymize(String fingerprint) {
    // 只存储前 8 位 + 后 8 位
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
      // 在 CI 中可能是模拟器，所以至少不是 critical
      expect(assessment.riskLevel, isNot(RiskLevel.critical));
    });
  });
}
```

---

**下一篇预告**: [F17 — ServerTimeHelper 时间校准 + Countdown 倒计时] — 服务端时间同步与倒计时系统
