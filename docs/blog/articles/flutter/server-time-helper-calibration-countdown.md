---
title: "ServerTimeHelper: Time Calibration + Countdown — Server Time Sync System"
description: "Analysis of ServerTimeHelper for synchronizing mobile client time with server time, solving issues like user clock tampering, timezone inconsistencies, and network latency in countdown timers and check-in logic."
slug: server-time-helper-calibration-countdown
tags: [Flutter, Time, Sync, Countdown, Calibration]
---

## 1. Problem Context

Mobile time handling faces several thorny issues:

| Problem | Impact | Example |
|------|------|------|
| **User Tampering with System Time** | Inaccurate countdowns, check-in cheating | User sets phone clock ahead 1 hour to claim check-in reward |
| **Timezone Inconsistency** | Confusing time display | User timezone = EST, server timezone = PHT |
| **Network Latency** | Countdown start time drift | API returns `2024-03-15T10:00:00Z`, received 2s later |
| **Cross-Day Calculation** | Date calculation errors | `DateTime.now().day` at UTC+8 midnight may still be previous day |

**ServerTimeHelper's** solution: **Use server time as the sole authority**, the client only calculates the offset.

## 2. Time Calibration Core

### 2.1 Calibration Algorithm

```dart
class ServerTimeHelper {
  static final ServerTimeHelper _instance = ServerTimeHelper._();
  factory ServerTimeHelper() => _instance;
  ServerTimeHelper._();

  /// Time difference between server and client (milliseconds)
  /// serverTime = clientTime + _offset
  int _offset = 0;

  /// Calibration status
  bool _isCalibrated = false;

  /// Last calibration time
  DateTime? _lastCalibratedAt;

  /// Calibration precision (milliseconds)
  int _precisionMs = 0;

  /// Get calibrated server time
  DateTime get serverNow {
    return DateTime.now().add(Duration(milliseconds: _offset));
  }

  /// Get current timestamp (milliseconds, server time)
  int get serverTimestamp {
    return DateTime.now().millisecondsSinceEpoch + _offset;
  }

  /// Perform calibration
  Future<void> calibrate() async {
    final stopwatch = Stopwatch()..start();

    try {
      // Send request, record client send time
      final clientSendTime = DateTime.now();

      final response = await Http.get('/api/v1/system/time');

      // Record client receive time
      final clientRecvTime = DateTime.now();

      // Server returned time (RFC 3339)
      final serverTimeStr = response.data['serverTime'] as String;
      final serverTime = DateTime.parse(serverTimeStr);

      // Estimate network round-trip time (RTT)
      final rtt = clientRecvTime.difference(clientSendTime);

      // Estimate the server time when processing the request
      // Assuming symmetric network latency: server processing time ≈ RTT / 2
      final estimatedServerTime = clientSendTime.add(rtt ~/ 2);

      // Calculate offset
      _offset = serverTime.difference(estimatedServerTime).inMilliseconds;
      _precisionMs = rtt.inMilliseconds;
      _isCalibrated = true;
      _lastCalibratedAt = DateTime.now();

      Logger.info('[TimeSync] Calibrated: offset=${_offset}ms, '
          'rtt=${rtt.inMilliseconds}ms');
    } catch (e) {
      // Calibration failed, use previous offset or default to 0
      Logger.warning('[TimeSync] Calibration failed: $e');
      if (!_isCalibrated) {
        _offset = 0;
      }
    }
  }
}
```

### 2.2 Automatic Periodic Calibration

```dart
class TimeSyncScheduler {
  Timer? _timer;

  /// Start periodic calibration (default every 5 minutes)
  void start({Duration interval = const Duration(minutes: 5)}) {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) async {
      await ServerTimeHelper().calibrate();
    });
  }

  /// Calibrate immediately when app resumes from background
  void onAppResumed() {
    ServerTimeHelper().calibrate();
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }
}
```

## 3. Countdown Component

### 3.1 CountdownController

```dart
class CountdownController {
  Timer? _timer;
  final VoidCallback? onTick;
  final VoidCallback? onFinish;

  DateTime? _targetTime;  // Target time based on server time
  Duration _remaining = Duration.zero;

  /// Current remaining time
  Duration get remaining => _remaining;

  /// Whether running
  bool get isRunning => _timer?.isActive ?? false;

  CountdownController({this.onTick, this.onFinish});

  /// Start countdown (targetTime is server timestamp)
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
    // Recalculate using server time
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

  /// MM:SS (hides hours when zero)
  ms,

  /// Xh Xm Xs
  full,
}
```

### 3.3 Countdown Circular Progress

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

## 4. Server Time Interceptor

### 4.1 Auto-Calibration Interceptor

```dart
class TimeSyncInterceptor extends Interceptor {
  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    // Get server time from response header
    final serverDate = response.headers.value('Date');
    if (serverDate != null) {
      try {
        final serverTime = HttpDate.parse(serverDate);
        final clientNow = DateTime.now();
        final offset = serverTime.difference(clientNow).inMilliseconds;

        // Update offset (weighted moving average to prevent single jitter)
        final helper = ServerTimeHelper();
        final currentOffset = helper.offset;
        helper.updateOffset(
          (currentOffset * 0.7 + offset * 0.3).round(),
        );
      } catch (_) {
        // Ignore parse failures
      }
    }

    handler.next(response);
  }
}
```

## 5. Business Scenarios

### 5.1 Check-In

```dart
class CheckInService {
  Future<bool> canCheckIn() async {
    final serverNow = ServerTimeHelper().serverNow;

    // Read last check-in time (stored as server time)
    final lastCheckIn = await Storage().getString('last_check_in');
    if (lastCheckIn == null) return true;

    final lastDate = DateTime.parse(lastCheckIn);
    // Use server time to determine if it's a new day
    return serverNow.day != lastDate.day ||
        serverNow.month != lastDate.month ||
        serverNow.year != lastDate.year;
  }
}
```

### 5.2 Flash Sale Countdown

```dart
class FlashSaleCountdown extends StatelessWidget {
  final DateTime startTime;
  final DateTime endTime;

  @override
  Widget build(BuildContext context) {
    final now = ServerTimeHelper().serverNow;

    if (now.isBefore(startTime)) {
      // Not started: show start countdown
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
      // In progress: show end countdown
      return CountdownText(
        targetTime: endTime,
        format: CountdownFormat.full,
      );
    } else {
      // Ended
      return const Text('Flash Sale Ended');
    }
  }
}
```

### 5.3 Lucky Draw Countdown

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

## 6. Time Formatting Utilities

```dart
class TimeFormatter {
  /// Relative time (based on server time)
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

  /// Date format
  static String _formatDate(DateTime date) {
    return '${date.year}-${_pad(date.month)}-${_pad(date.day)}';
  }

  static String _pad(int n) => n.toString().padLeft(2, '0');
}
```

## 7. Complete Calibration Flow

```
App Launch
    ↓
ServerTimeHelper.calibrate()
    ↓
GET /api/v1/system/time
    ↓
Server returns: { serverTime: "2024-03-15T10:00:00.000Z" }
    ↓
Calculation:
  clientSendTime = 10:00:00.100
  clientRecvTime = 10:00:00.300
  RTT = 200ms
  estimatedServerTime = clientSendTime + RTT/2 = 10:00:00.200
  offset = serverTime - estimatedServerTime = -200ms
  → Client is 200ms ahead of server
    ↓
ServerTimeHelper.serverNow == DateTime.now() - 200ms
    ↓
All countdowns, check-in decisions use calibrated server time
```

## 8. Testing

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
      // Should be close to local time when not calibrated
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
