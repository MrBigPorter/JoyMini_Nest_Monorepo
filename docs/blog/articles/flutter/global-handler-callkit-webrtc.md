# GlobalHandler + CallKit + WebRTC 通话 — 全局事件总线与实时通话架构

> **Article F14** | **Difficulty:** ⭐⭐⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/global_handler/`, `joy_mini_app/lib/features/call/`

## 1. 问题背景

JoyMini 作为社交应用，需要同时处理多种 **外部触发的事件**：

```
外部事件来源：
  ├── Push Notification (FCM)
  │   ├── 新消息通知 → 打开聊天
  │   ├── 来电通知 → 显示通话界面
  │   ├── 订单状态 → 打开订单详情
  │   └── 营销通知 → 打开活动页面
  ├── Deep Link
  │   ├── OAuth 回调 → 处理登录
  │   └── 支付回调 → 显示支付结果
  ├── WebSocket 事件
  │   ├── 通话邀请 → 接听/拒绝
  │   └── 好友请求 → 显示处理
  └── CallKit (iOS)
      └── 来电显示 → 接通/挂断
```

**GlobalHandler** 将所有这些事件统一到一个入口，按 **事件优先级** 分配处理。

## 2. GlobalHandler — 全局事件中枢

### 2.1 事件路由

```dart
class GlobalHandler {
  static final GlobalHandler _instance = GlobalHandler._();
  factory GlobalHandler() => _instance;
  GlobalHandler._();

  final Logger _logger = Logger('GlobalHandler');

  /// 处理传入事件（统一入口）
  Future<void> handle(IncomingEvent event) async {
    _logger.info('[GlobalHandler] Event: ${event.type} (${event.id})');

    // 检查应用是否在前台
    final isForeground = await _isAppForeground();

    if (!isForeground) {
      // 后台启动 — 需要先导航到目标页面
      await _handleBackgroundEvent(event);
      return;
    }

    // 前台事件 — 根据类型分发
    await _dispatchForegroundEvent(event);
  }

  Future<void> _dispatchForegroundEvent(IncomingEvent event) async {
    switch (event.type) {
      case EventType.callInvite:
        await _handleCallInvite(event);
      case EventType.newMessage:
        await _handleNewMessage(event);
      case EventType.orderUpdate:
        await _handleOrderUpdate(event);
      case EventType.promotion:
        await _handlePromotion(event);
      case EventType.oauthCallback:
        await _handleOAuthCallback(event);
      case EventType.deepLink:
        await _handleDeepLink(event);
    }
  }

  Future<void> _handleBackgroundEvent(IncomingEvent event) async {
    // 存储待处理事件
    _pendingEvent = event;

    // 如果应用在后台被杀，冷启动时处理
    // 如果只是在后台，等用户点击通知后再处理
  }
}
```

### 2.2 事件模型

```dart
enum EventType {
  callInvite,
  callEnded,
  newMessage,
  messageRecall,
  orderUpdate,
  promotion,
  oauthCallback,
  deepLink,
}

class IncomingEvent {
  final String id;
  final EventType type;
  final Map<String, dynamic> payload;
  final DateTime receivedAt;
  final EventPriority priority;

  const IncomingEvent({
    required this.id,
    required this.type,
    required this.payload,
    DateTime? receivedAt,
    this.priority = EventPriority.normal,
  }) : receivedAt = receivedAt ?? DateTime.now();

  T? get<T>(String key) => payload[key] as T?;
}

enum EventPriority {
  /// 通话邀请（必须立即处理）
  critical,

  /// 新消息、订单更新
  high,

  /// 营销、推广
  normal,

  /// 后台静默事件
  low,
}
```

### 2.3 推送通知处理

```dart
class PushNotificationHandler {
  final GlobalHandler _handler = GlobalHandler();

  /// FCM 前台消息
  Future<void> onMessage(RemoteMessage message) async {
    final event = _parseRemoteMessage(message);
    await _handler.handle(event);
  }

  /// FCM 后台消息（用户点击通知）
  Future<void> onMessageOpenedApp(RemoteMessage message) async {
    final event = _parseRemoteMessage(message);
    await _handler.handle(event);
  }

  /// FCM 静默消息（不显示通知栏）
  Future<void> onBackgroundMessage(RemoteMessage message) async {
    final event = _parseRemoteMessage(message);

    // 后台 isolate 有限制，只处理关键事件
    if (event.priority == EventPriority.critical) {
      await _handler.handle(event);
    }
  }

  IncomingEvent _parseRemoteMessage(RemoteMessage message) {
    final data = message.data;
    return IncomingEvent(
      id: data['event_id'] as String,
      type: _parseEventType(data['type'] as String),
      payload: data,
    );
  }
}
```

## 3. WebRTC 通话系统

### 3.1 通话状态机

```dart
enum CallState {
  /// 空闲
  idle,

  /// 呼出中（主叫等待接听）
  calling,

  /// 来电中（被叫收到邀请）
  ringing,

  /// 通话中（连接已建立）
  connected,

  /// 挂断中
  ending,

  /// 已结束
  ended,
}

enum CallDirection {
  /// 主叫
  outgoing,

  /// 被叫
  incoming,
}
```

### 3.2 WebRTC 服务

```dart
class WebRTCService {
  final RTCPeerConnection _peerConnection;
  final MediaStream _localStream;
  final WebSocketService _wsService;
  final Logger _logger = Logger('WebRTC');

  StreamSubscription? _signalSub;

  Future<void> startCall(String targetUserId) async {
    // 1. 获取本地媒体流
    _localStream = await _getUserMedia();

    // 2. 创建 PeerConnection
    final config = Configuration(
      iceServers: [
        RTCIceServer(url: 'stun:stun.l.google.com:19302'),
        RTCIceServer(
          url: 'turn:turn.joymini.app:3478',
          username: _config.turnUsername,
          credential: _config.turnCredential,
        ),
      ],
    );
    _peerConnection = await RTCPeerConnection.create(config);

    // 3. 添加本地流
    _peerConnection.addStream(_localStream);

    // 4. 监听 ICE candidate
    _peerConnection.onIceCandidate = (candidate) {
      _wsService.send(CallSignal(
        type: SignalType.iceCandidate,
        targetUserId: targetUserId,
        data: {'candidate': candidate.toMap()},
      ));
    };

    // 5. 监听远程流
    _peerConnection.onAddStream = (stream) {
      _onRemoteStream(stream);
    };

    // 6. 创建 Offer
    final offer = await _peerConnection.createOffer();
    await _peerConnection.setLocalDescription(offer);

    _wsService.send(CallSignal(
      type: SignalType.offer,
      targetUserId: targetUserId,
      data: {'sdp': offer.sdp},
    ));
  }

  Future<void> acceptCall(CallSignal signal) async {
    // 1. 设置远程描述
    await _peerConnection.setRemoteDescription(
      RTCSessionDescription(signal.data['sdp'], 'offer'),
    );

    // 2. 创建 Answer
    final answer = await _peerConnection.createAnswer();
    await _peerConnection.setLocalDescription(answer);

    _wsService.send(CallSignal(
      type: SignalType.answer,
      targetUserId: signal.fromUserId,
      data: {'sdp': answer.sdp},
    ));
  }

  Future<void> handleIceCandidate(CallSignal signal) async {
    final candidate = RTCIceCandidate(
      signal.data['candidate']['candidate'],
      signal.data['candidate']['sdpMid'],
      signal.data['candidate']['sdpMLineIndex'],
    );
    await _peerConnection.addCandidate(candidate);
  }

  Future<void> endCall() async {
    await _peerConnection.close();
    await _localStream.dispose();
    _signalSub?.cancel();

    _logger.info('[WebRTC] Call ended');
  }
}
```

### 3.3 通话信令通过 WebSocket

```dart
class CallSignalService {
  final WebSocketService _ws;
  final Logger _logger = Logger('CallSignal');

  void connect() {
    // 监听通话信令
    _ws.onMessage('call:invite', _handleCallInvite);
    _ws.onMessage('call:accept', _handleCallAccept);
    _ws.onMessage('call:ice_candidate', _handleIceCandidate);
    _ws.onMessage('call:end', _handleCallEnd);
    _ws.onMessage('call:missed', _handleCallMissed);
  }

  void _handleCallInvite(Map<String, dynamic> data) {
    final signal = CallSignal.fromJson(data);
    final state = _callStateMachine.currentState;

    if (state == CallState.idle) {
      // 显示来电界面
      _callStateMachine.transitionTo(CallState.ringing);
      GlobalHandler().handle(IncomingEvent(
        id: data['call_id'],
        type: EventType.callInvite,
        payload: data,
        priority: EventPriority.critical,
      ));
    } else {
      // 通话中 → 返回 busy
      _ws.send(CallSignal(
        type: SignalType.busy,
        targetUserId: signal.fromUserId,
        data: {'call_id': data['call_id']},
      ));
    }
  }

  void _handleCallAccept(Map<String, dynamic> data) {
    _callStateMachine.transitionTo(CallState.connected);
    _logger.info('[CallSignal] Call accepted');
  }

  void _handleCallEnd(Map<String, dynamic> data) {
    _callStateMachine.transitionTo(CallState.ended);
    _cleanup();

    // 弹出通话结束页面
    _showCallEndedScreen(data);
  }
}
```

## 4. CallKit 集成（iOS）

### 4.1 原生侧 CallKit 处理

```objc
// CallKitManager.swift
import CallKit
import Flutter

class CallKitManager: NSObject, CXProviderDelegate {
    static let shared = CallKitManager()
    private let provider: CXProvider
    private let controller = CXCallController()

    override private init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.iconTemplateImageData = UIImage(named: "call_icon")?.pngData()

        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    func reportIncomingCall(
        uuid: UUID,
        handle: String,
        callerName: String,
        hasVideo: Bool
    ) {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: handle)
        update.localizedCallerName = callerName
        update.hasVideo = hasVideo

        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                // 发送到 Flutter
                self.sendToFlutter(
                    method: "onCallError",
                    arguments: ["error": error.localizedDescription]
                )
            }
        }
    }

    func endCall(uuid: UUID) {
        let action = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: action)
        controller.request(transaction) { error in
            if let error = error {
                print("End call error: \(error)")
            }
        }
    }

    // MARK: - CXProviderDelegate

    func providerDidReset(_ provider: CXProvider) {
        sendToFlutter(method: "onCallReset", arguments: nil)
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        sendToFlutter(method: "onCallAnswered", arguments: [
            "callUuid": action.callUUID.uuidString
        ])
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        sendToFlutter(method: "onCallEnded", arguments: [
            "callUuid": action.callUUID.uuidString
        ])
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        sendToFlutter(method: "onCallHold", arguments: [
            "callUuid": action.callUUID.uuidString,
            "isOnHold": action.isOnHold
        ])
        action.fulfill()
    }

    private func sendToFlutter(method: String, arguments: Any?) {
        if let channel = FlutterMethodChannelManager.shared.channel {
            channel.invokeMethod(method, arguments: arguments)
        }
    }
}
```

### 4.2 Flutter 侧 MethodChannel

```dart
class CallKitBridge {
  static const _channel = MethodChannel('com.joymini/callkit');

  static final _eventController = StreamController<CallKitEvent>.broadcast();
  static Stream<CallKitEvent> get events => _eventController.stream;

  static void init() {
    _channel.setMethodCallHandler(_handleMethodCall);
  }

  static Future<dynamic> _handleMethodCall(MethodCall call) async {
    switch (call.method) {
      case 'onCallAnswered':
        final uuid = call.arguments['callUuid'] as String;
        _eventController.add(CallKitEvent.answered(uuid));
        // 启动 WebRTC 通话
        await WebRTCService().acceptCall();
        break;

      case 'onCallEnded':
        final uuid = call.arguments['callUuid'] as String;
        _eventController.add(CallKitEvent.ended(uuid));
        await WebRTCService().endCall();
        break;

      case 'onCallHold':
        final uuid = call.arguments['callUuid'] as String;
        final isOnHold = call.arguments['isOnHold'] as bool;
        _eventController.add(CallKitEvent.holdChanged(uuid, isOnHold));
        break;

      case 'onCallError':
        _eventController.add(CallKitEvent.error(
          call.arguments['error'] as String,
        ));
        break;
    }
  }

  /// 通知 CallKit 有来电
  static Future<void> reportIncomingCall({
    required String callId,
    required String callerName,
    bool hasVideo = false,
  }) async {
    await _channel.invokeMethod('reportIncomingCall', {
      'callId': callId,
      'callerName': callerName,
      'hasVideo': hasVideo,
    });
  }

  /// 结束 CallKit 通话
  static Future<void> endCall(String callId) async {
    await _channel.invokeMethod('endCall', {'callId': callId});
  }
}
```

## 5. 通话 UI 层

### 5.1 CallScreen

```dart
class CallScreen extends StatefulWidget {
  final CallDirection direction;
  final String callerName;
  final String? callerAvatar;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen>
    with WidgetsBindingObserver {
  final WebRTCService _webrtc = WebRTCService();
  CallState _state = CallState.connecting;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // 远程视频
          _buildRemoteVideo(),
          // 本地小窗
          Positioned(
            top: 60,
            right: 16,
            child: _buildLocalPreview(),
          ),
          // 控制栏
          Positioned(
            bottom: 48,
            left: 0,
            right: 0,
            child: _buildCallControls(),
          ),
          // 呼叫状态
          if (_state == CallState.ringing ||
              _state == CallState.calling)
            Center(
              child: _buildCallingState(),
            ),
        ],
      ),
    );
  }

  Widget _buildCallControls() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        // 麦克风
        _ControlButton(
          icon: _isMuted ? Icons.mic_off : Icons.mic,
          onTap: () => _webrtc.toggleMute(),
        ),
        // 扬声器
        _ControlButton(
          icon: _isSpeakerOn
              ? Icons.volume_up
              : Icons.volume_down,
          onTap: () => _webrtc.toggleSpeaker(),
        ),
        // 挂断
        _ControlButton(
          icon: Icons.call_end,
          color: Colors.red,
          size: 64,
          onTap: () => _webrtc.endCall(),
        ),
        // 切换摄像头
        _ControlButton(
          icon: Icons.flip_camera_ios,
          onTap: () => _webrtc.switchCamera(),
        ),
        // 视频开关
        _ControlButton(
          icon: _isVideoOn
              ? Icons.videocam
              : Icons.videocam_off,
          onTap: () => _webrtc.toggleVideo(),
        ),
      ],
    );
  }
}
```

### 5.2 通话时长格式化

```dart
class CallDurationFormatter {
  static String format(Duration duration) {
    final hours = duration.inHours;
    final minutes = duration.inMinutes.remainder(60);
    final seconds = duration.inSeconds.remainder(60);

    if (hours > 0) {
      return '${_pad(hours)}:${_pad(minutes)}:${_pad(seconds)}';
    }
    return '${_pad(minutes)}:${_pad(seconds)}';
  }

  static String _pad(int value) => value.toString().padLeft(2, '0');
}
```

## 6. 完整通话流程

```
Alice calls Bob:

Alice (Flutter)                    Server (WebSocket)                Bob (Flutter)
    |                                    |                              |
    |--- call:invite {target: Bob} ----->|                              |
    |                                    |--- push:call_invite -------->|
    |                                    |                              |--- CallKit: reportIncomingCall
    |                                    |                              |--- Show incoming call UI
    |                                    |                              |
    |                                    |<--- call:accept -------------|
    |<--- call:accept -------------------|                              |
    |                                    |                              |
    |--- ICE Candidates (STUN/TURN) ---->|                              |
    |                                    |--- ICE Candidates --------->|
    |<--- ICE Candidates ----------------|                              |
    |                                    |                              |
    |========= DTLS/SRTP established ====|======= 通话中 ===============|
    |                                    |                              |
    |--- call:end ---------------------->|                              |
    |                                    |--- call:end --------------->|
    |                                    |                              |
    |============= 通话结束 =============|==============================|

    Alice: WebRTC cleanup                Bob: CallKit endCall
          CallScreen pop                       CallScreen pop
```

## 7. 容错与恢复

```dart
class CallRecoveryManager {
  /// 通话中断恢复
  Future<void> recoverCall(String callId) async {
    // 检查服务器是否还有通话会话
    final session = await api.getCallSession(callId);

    if (session == null || session.status == 'ended') {
      _logger.info('[Call] Session already ended: $callId');
      return;
    }

    // 重新建立 PeerConnection
    await _webrtc.reconnect(session);

    // 通知对方重新发送 ICE
    _ws.send(CallSignal(
      type: SignalType.reconnect,
      targetUserId: session.peerId,
      data: {'call_id': callId},
    ));
  }

  /// 网络切换处理（WiFi → 4G）
  Future<void> onNetworkChanged() async {
    // 重新 ICE restart
    await _webrtc.restartIce();
  }
}
```

## 8. 总结

| 组件 | 职责 | 关键模式 |
|------|------|----------|
| **GlobalHandler** | 统一事件入口和分发 | 策略模式 + 事件优先级 |
| **WebRTCService** | P2P 媒体连接管理 | 状态机 + ICE restart |
| **CallSignalService** | 信令通过 WebSocket | 发布-订阅模式 |
| **CallKitBridge** | iOS 原生通话集成 | MethodChannel 桥接 |
| **CallRecoveryManager** | 断线重连和恢复 | ICE restart + 会话恢复 |

**架构要点**：
1. **单一事件入口**：所有外部事件通过 `GlobalHandler.handle()` 统一处理
2. **优先级调度**：通话邀请为 `critical` 级别，可打断当前操作
3. **CallKit 集成**：iOS 系统级来电显示，即使 App 被杀死
4. **WebRTC + TURN**：P2P 优先，NAT 穿透失败时回退 TURN 中继
5. **状态机**：通话有 6 个明确状态，避免竞态条件

---

**下一篇预告**: [F15 — ErrorStrategy 5 种策略 + 可配置决策表] — 应用级错误处理框架
