# ServerTimeHelper 时间校准 + Countdown 倒计时 — 服务端时间同步系统

> **Article F17** | **Difficulty:** ⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/time/`

## 1. 问题背景

移动端时间处理面临多个棘手问题：

| 问题 | 影响 | 示例 |
|------|------|------|
| **用户篡改系统时间** | 倒计时不准、签到作弊 | 用户把手机时间调快 1 小时后领取签到奖励 |
| **时区不一致** | 显示时间混乱 | 用户手机时区 = EST，服务器时区 = PHT |
| **网络延迟** | 倒计时开始时间漂移 | API 返回 `2024-03-15T10:00:00Z`，收到时已过 2s |
| **跨天计算** | 日期计算错误 | `DateTime.now().day` 在 UTC+8 凌晨可能还是前一天 |

**ServerTimeHelper** 的解法：**以服务器时间为唯一基准**，客户端只计算偏移量。

## 2. 时间校准核心

### 2.1 校准算法

```dart
class ServerTimeHelper {
  static final ServerTimeHelper _instance = ServerTimeHelper._();
  factory ServerTimeHelper() => _instance;
  ServerTimeHelper._();

  /// 服务器与客户端的时间差（毫秒）
  /// serverTime = clientTime + _offset
  int _offset = 0;

  /// 校准状态
  bool _isCalibrated = false;

  /// 最后一次校准时间
  DateTime? _lastCalibratedAt;

  /// 校准精度（毫秒）
  int _precisionMs = 0;

  /// 获取校准后的服务器时间
  DateTime get serverNow {
    return DateTime.now().add(Duration(milliseconds: _offset));
  }

  /// 获取当前时间戳（毫秒，服务器时间）
  int get serverTimestamp {
    return DateTime.now().millisecondsSinceEpoch + _offset;
  }

  /// 执行校准
  Future<void> calibrate() async {
    final stopwatch = Stopwatch()..start();

    try {
      // 发送请求，记录客户端发送时间
      final clientSendTime = DateTime.now();

      final response = await Http.get('/api/v1/system/time');

      // 记录客户端接收时间
      final clientRecvTime = DateTime.now();

      // 服务器返回的时间（RFC 3339）
      final serverTimeStr = response.data['serverTime'] as String;
      final serverTime = DateTime.parse(serverTimeStr);

      // 估算网络往返时间（RTT）
      final rtt = clientRecvTime.difference(clientSendTime);

      // 估算服务器在处理请求时的时间
      // 假设网络延迟对称：服务器处理时间 ≈ RTT / 2
      final estimatedServerTime = clientSendTime.add(rtt ~/ 2);

      // 计算偏移
      _offset = serverTime.difference(estimatedServerTime).inMilliseconds;
      _precisionMs = rtt.inMilliseconds;
      _isCalibrated = true;
      _lastCalibratedAt = DateTime.now();

      Logger.info('[TimeSync] Calibrated: offset=${_offset}ms, '
          'rtt=${rtt.inMilliseconds}ms');
    } catch (e) {
      // 校准失败，使用上次偏移或默认为 0
      Logger.warning('[TimeSync] Calibration failed: $e');
      if (!_isCalibrated) {
        _offset = 0;
      }
    }
  }
}
```

### 2.2 自动定期校准

```dart
class TimeSyncScheduler {
  Timer? _timer;

  /// 启动定期校准（默认每 5 分钟一次）
  void start({Duration interval = const Duration(minutes: 5)}) {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) async {
      await ServerTimeHelper().calibrate();
    });
  }

  /// 应用从后台恢复时立即校准
  void onAppResumed() {
    ServerTimeHelper().calibrate();
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }
}
```

## 3. 倒计时组件

### 3.1 CountdownController

```dart
class CountdownController {
  Timer? _timer;
  final VoidCallback? onTick;
  final VoidCallback? onFinish;

  DateTime? _targetTime;  // 服务器时间基准的目标时间
  Duration _remaining = Duration.zero;

  /// 当前剩余时间
  Duration get remaining => _remaining;

  /// 是否运行中
  bool get isRunning => _timer?.isActive ?? false;

  CountdownController({this.onTick, this.onFinish});

  /// 启动倒计时（targetTime 为服务器时间戳）
  void start({
    required DateTime targetTime,
    Duration? initialRemaining,
  }) {
    _targetTime = targetTime;
    _remaining = initialRemaining ??
        targetTime.difference(ServerTimeHelper().serverNow);

    if (_remaining.isNegative) {
      _remaining = Duration.zero;
      onFinish?.call();
      return;
    }

    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      _tick();
    });
  }

  void _tick() {
    // 使用服务器时间重新计算
    _remaining = _targetTime!
        .difference(ServerTimeHelper().serverNow);

    if (_remaining.isNegative) {
      _remaining = Duration.zero;
      _timer?.cancel();
      onFinish?.call();
      return;
    }

    onTick?.call();
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() => stop();
}
```

### 3.2 CountdownText Widget

```dart
class CountdownText extends StatefulWidget {
  final DateTime targetTime;
  final TextStyle? style;
  final CountdownFormat format;

  const CountdownText({
    super.key,
    required this.targetTime,
    this.style,
    this.format = CountdownFormat.hms,
  });

  @override
  State<CountdownText> createState() => _CountdownTextState();
}

class _CountdownTextState extends State<CountdownText> {
  late final CountdownController _controller;
  String _display = '';

  @override
  void initState() {
    super.initState();
    _controller = CountdownController(
      onTick: () => setState(() => _updateDisplay()),
      onFinish: () => setState(() => _display = '00:00:00'),
    );
    _controller.start(targetTime: widget.targetTime);
    _updateDisplay();
  }

  void _updateDisplay() {
    final remaining = _controller.remaining;
    _display = _formatDuration(remaining, widget.format);
  }

  String _formatDuration(Duration d, CountdownFormat format) {
    final hours = d.inHours;
    final minutes = d.inMinutes.remainder(60);
    final seconds = d.inSeconds.remainder(60);

    return switch (format) {
      CountdownFormat.hms =>
        '${_pad(hours)}:${_pad(minutes)}:${_pad(seconds)}',
      CountdownFormat.ms =>
        '${_pad(minutes)}:${_pad(seconds)}',
      CountdownFormat.full =>
        hours > 0
            ? '${hours}h ${minutes}m ${seconds}s'
            : '${minutes}m ${seconds}s',
    };
  }

  String _pad(int n) => n.toString().padLeft(2, '0');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Text(_display, style: widget.style);
  }
}

enum CountdownFormat {
  /// HH:MM:SS
  hms,

  /// MM:SS（小时为 0 时不显示）
  ms,

  /// Xh Xm Xs
  full,
}
```

### 3.3 倒计时 Circular Progress

```dart
class CountdownCircle extends StatelessWidget {
  final CountdownController controller;
  final double size;
  final Duration totalDuration;

  const CountdownCircle({
    super.key,
    required this.controller,
    this.size = 48,
    required this.totalDuration,
  });

  @override
  Widget build(BuildContext context) {
    final progress = controller.remaining.inMilliseconds /
        totalDuration.inMilliseconds;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          CircularProgressIndicator(
            value: progress.clamp(0.0, 1.0),
            strokeWidth: 3,
            backgroundColor: Colors.grey[300],
            valueColor: AlwaysStoppedAnimation(
              progress < 0.2 ? Colors.red : Colors.blue,
            ),
          ),
          Text(
            '${controller.remaining.inSeconds}s',
            style: TextStyle(
              fontSize: size * 0.3,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}
```

## 4. 服务器时间戳拦截器

### 4.1 自动校准拦截器

```dart
class TimeSyncInterceptor extends Interceptor {
  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    // 从响应头获取服务器时间
    final serverDate = response.headers.value('Date');
    if (serverDate != null) {
      try {
        final serverTime = HttpDate.parse(serverDate);
        final clientNow = DateTime.now();
        final offset = serverTime.difference(clientNow).inMilliseconds;

        // 更新偏移（加权移动平均，防止单次抖动）
        final helper = ServerTimeHelper();
        final currentOffset = helper.offset;
        helper.updateOffset(
          (currentOffset * 0.7 + offset * 0.3).round(),
        );
      } catch (_) {
        // 解析失败忽略
      }
    }

    handler.next(response);
  }
}
```

## 5. 业务场景

### 5.1 签到

```dart
class CheckInService {
  Future<bool> canCheckIn() async {
    final serverNow = ServerTimeHelper().serverNow;

    // 读取上次签到时间（已转为服务器时间存储）
    final lastCheckIn = await Storage().getString('last_check_in');
    if (lastCheckIn == null) return true;

    final lastDate = DateTime.parse(lastCheckIn);
    // 使用服务器时间判断是否新的一天
    return serverNow.day != lastDate.day ||
        serverNow.month != lastDate.month ||
        serverNow.year != lastDate.year;
  }
}
```

### 5.2 闪购倒计时

```dart
class FlashSaleCountdown extends StatelessWidget {
  final DateTime startTime;
  final DateTime endTime;

  @override
  Widget build(BuildContext context) {
    final now = ServerTimeHelper().serverNow;

    if (now.isBefore(startTime)) {
      // 未开始：显示开始倒计时
      return Column(
        children: [
          const Text('Starts in'),
          CountdownText(
            targetTime: startTime,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: Colors.red,
            ),
          ),
        ],
      );
    } else if (now.isBefore(endTime)) {
      // 进行中：显示结束倒计时
      return CountdownText(
        targetTime: endTime,
        format: CountdownFormat.full,
      );
    } else {
      // 已结束
      return const Text('Flash Sale Ended');
    }
  }
}
```

### 5.3 抽奖倒计时

```dart
class LuckyDrawTimer extends StatefulWidget {
  final DateTime drawTime;

  @override
  Widget build(BuildContext context) {
    return CountdownCircle(
      controller: CountdownController(
        onFinish: () => _triggerDraw(),
      )..start(targetTime: drawTime),
      totalDuration: drawTime.difference(
        ServerTimeHelper().serverNow,
      ),
    );
  }
}
```

## 6. 时间格式化工具

```dart
class TimeFormatter {
  /// 相对时间（基于服务器时间）
  static String relative(DateTime targetTime) {
    final now = ServerTimeHelper().serverNow;
    final diff = targetTime.difference(now);

    if (diff.isNegative) {
      final past = -diff;
      if (past.inSeconds < 60) return 'Just now';
      if (past.inMinutes < 60) return '${past.inMinutes}m ago';
      if (past.inHours < 24) return '${past.inHours}h ago';
      if (past.inDays < 7) return '${past.inDays}d ago';
      return '${(past.inDays / 7).floor()}w ago';
    } else {
      if (diff.inSeconds < 60) return 'In ${diff.inSeconds}s';
      if (diff.inMinutes < 60) return 'In ${diff.inMinutes}m';
      if (diff.inHours < 24) return 'In ${diff.inHours}h';
      return _formatDate(targetTime);
    }
  }

  /// 日期格式
  static String _formatDate(DateTime date) {
    return '${date.year}-${_pad(date.month)}-${_pad(date.day)}';
  }

  static String _pad(int n) => n.toString().padLeft(2, '0');
}
```

## 7. 完整校准流程

```
App Launch
    ↓
ServerTimeHelper.calibrate()
    ↓
GET /api/v1/system/time
    ↓
Server returns: { serverTime: "2024-03-15T10:00:00.000Z" }
    ↓
计算：
  clientSendTime = 10:00:00.100
  clientRecvTime = 10:00:00.300
  RTT = 200ms
  estimatedServerTime = clientSendTime + RTT/2 = 10:00:00.200
  offset = serverTime - estimatedServerTime = -200ms
  → 客户端比服务器快 200ms
    ↓
ServerTimeHelper.serverNow == DateTime.now() - 200ms
    ↓
所有倒计时、签到判断使用校准后的服务器时间
```

## 8. 测试

```dart
void main() {
  group('ServerTimeHelper', () {
    test('calibrates correctly', () async {
      final helper = ServerTimeHelper();
      await helper.calibrate();
      expect(helper.isCalibrated, true);
    });

    test('serverNow is close to DateTime.now()', () {
      final helper = ServerTimeHelper();
      // 未校准时应接近本地时间
      final diff = helper.serverNow.difference(DateTime.now());
      expect(diff.inMilliseconds.abs(), lessThan(100));
    });
  });

  group('CountdownController', () {
    test('counts down correctly', () async {
      final controller = CountdownController();
      final target = DateTime.now().add(const Duration(seconds: 5));

      controller.start(targetTime: target);
      expect(controller.remaining.inSeconds, 5);

      await Future.delayed(const Duration(seconds: 2));
      expect(controller.remaining.inSeconds, lessThanOrEqualTo(3));

      controller.dispose();
    });
  });
}
```

---

**下一篇预告**: [F18 — ImageCacheManager L1/L2 + ResponsiveImageService CDN 阶梯] — 图片缓存与 CDN 自适应
