---
title: 'GlobalHandler + CallKit + WebRTC: 全局事件总线与实时通话架构'
description: 统一的全局事件处理系统，通过 GlobalHandler 实现带优先级的消息路由，集成 WebRTC 点对点通话、iOS CallKit 原生集成（MethodChannel）以及通话恢复管理。
slug: global-handler-callkit-webrtc
tags: Flutter, WebRTC, CallKit, Architecture, Realtime
---

# GlobalHandler + CallKit + WebRTC: 全局事件总线与实时通话架构

## 1. 问题背景

JoyMini 作为社交应用，需要同时处理多种类型的**外部触发事件**：

```
External Event Sources:
  ├── Push Notification (FCM)
  │   ├── New message notification → Open chat
  │   ├── Incoming call notification → Show call screen
  │   ├── Order status → Open order details
  │   └── Marketing notification → Open campaign page
  ├── Deep Link
  │   ├── OAuth callback → Handle login
  │   └── Payment callback → Show payment result
  ├── WebSocket Events
  │   ├── Call invitation → Accept/Reject
  │   └── Friend request → Show processing
  └── CallKit (iOS)
      └── Incoming call display → Connect/Hang up
```

**GlobalHandler** 将所有事件统一到单一入口，按**事件优先级**进行分发。

## 2. GlobalHandler——全局事件中枢

### 2.1 事件路由

```dart
class GlobalHandler {
  static final GlobalHandler _instance = GlobalHandler._();
  factory GlobalHandler() => _instance;
  GlobalHandler._();

  final Logger _logger = Logger('GlobalHandler');

  /// Handle incoming event (unified entry point)
  Future<void> handle(IncomingEvent event) async {
    _logger.info('[GlobalHandler] Event: ${event.type} (${event.id})');

    // Check if app is in foreground
    final isForeground = await _isAppForeground();

    if (!isForeground) {
      // Background launch — navigate to target page first
      await _handleBackgroundEvent(event);
      return;
    }

    // Foreground event — dispatch by type
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
    // Store pending event
    _pendingEvent = event;

    // If app was killed while in background, handle on cold start
    // If just in background, wait for user to tap notification
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
  /// Call invitation (must be handled immediately)
  critical,

  /// New messages, order updates
  high,

  /// Marketing, promotions
  normal,

  /// Background silent events
  low,
}
```

### 2.3 推送通知处理

```dart
class PushNotificationHandler {
  final GlobalHandler _handler = GlobalHandler();

  /// FCM foreground message
  Future<void> onMessage(RemoteMessage message) async {
    final event = _parseRemoteMessage(message);
    await _handler.handle(event);
  }

  /// FCM background message (user tapped notification)
  Future<void> onMessageOpenedApp(RemoteMessage message) async {
    final event = _parseRemoteMessage(message);
    await _handler.handle(event);
  }

  /// FCM silent message (no notification bar)
  Future<void> onBackgroundMessage(RemoteMessage message) async {
    final event = _parseRemoteMessage(message);

    // Background isolate has limitations, only handle critical events
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
  /// Idle
  idle,

  /// Calling (caller waiting for answer)
  calling,

  /// Ringing (callee received invitation)
  ringing,

  /// Connected (connection established)
  connected,

  /// Ending
  ending,

  /// Ended
  ended,
}

enum CallDirection {
  /// Outgoing call
  outgoing,

  /// Incoming call
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
    // 1. Get local media stream
    _localStream = await _getUserMedia();

    // 2. Create PeerConnection
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

    // 3. Add local stream
    _peerConnection.addStream(_localStream);

    // 4. Listen for ICE candidates
    _peerConnection.onIceCandidate = (candidate) {
      _wsService.send(CallSignal(
        type: SignalType.iceCandidate,
        targetUserId: targetUserId,
        data: {'candidate': candidate.toMap()},
      ));
    };

    // 5. Listen for remote stream
    _peerConnection.onAddStream = (stream) {
      _onRemoteStream(stream);
    };

    // 6. Create Offer
    final offer = await _peerConnection.createOffer();
    await _peerConnection.setLocalDescription(offer);

    _wsService.send(CallSignal(
      type: SignalType.offer,
      targetUserId: targetUserId,
      data: {'sdp': offer.sdp},
    ));
  }

  Future<void> acceptCall(CallSignal signal) async {
    // 1. Set remote description
    await _peerConnection.setRemoteDescription(
      RTCSessionDescription(signal.data['sdp'], 'offer'),
    );

    // 2. Create Answer
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

### 3.3 WebSocket 信令

```dart
class CallSignalService {
  final WebSocketService _ws;
  final Logger _logger = Logger('CallSignal');

  void connect() {
    // Listen for call signaling
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
      // Show incoming call UI
      _callStateMachine.transitionTo(CallState.ringing);
      GlobalHandler().handle(IncomingEvent(
        id: data['call_id'],
        type: EventType.callInvite,
        payload: data,
        priority: EventPriority.critical,
      ));
    } else {
      // Busy — return busy signal
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

    // Show call ended screen
    _showCallEndedScreen(data);
  }
}
```

## 4. CallKit 集成（iOS）

### 4.1 原生 CallKit 处理

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
                // Send to Flutter
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

### 4.2 Flutter 端 MethodChannel

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
        // Start WebRTC call
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

  /// Notify CallKit of incoming call
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

  /// End CallKit call
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
          // Remote video
          _buildRemoteVideo(),
          // Local preview
          Positioned(
            top: 60,
            right: 16,
            child: _buildLocalPreview(),
          ),
          // Control bar
          Positioned(
            bottom: 48,
            left: 0,
            right: 0,
            child: _buildCallControls(),
          ),
          // Call state
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
        // Microphone
        _ControlButton(
          icon: _isMuted ? Icons.mic_off : Icons.mic,
          onTap: () => _webrtc.toggleMute(),
        ),
        // Speaker
        _ControlButton(
          icon: _isSpeakerOn
              ? Icons.volume_up
              : Icons.volume_down,
          onTap: () => _webrtc.toggleSpeaker(),
        ),
        // Hang up
        _ControlButton(
          icon: Icons.call_end,
          color: Colors.red,
          size: 64,
          onTap: () => _webrtc.endCall(),
        ),
        // Switch camera
        _ControlButton(
          icon: Icons.flip_camera_ios,
          onTap: () => _webrtc.switchCamera(),
        ),
        // Video toggle
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
    |========= DTLS/SRTP established ====|======= In Call ==============|
    |                                    |                              |
    |--- call:end ---------------------->|                              |
    |                                    |--- call:end --------------->|
    |                                    |                              |
    |============= Call Ended ===========|==============================|

    Alice: WebRTC cleanup                Bob: CallKit endCall
          CallScreen pop                       CallScreen pop
```

## 7. 容错与恢复

```dart
class CallRecoveryManager {
  /// Call interruption recovery
  Future<void> recoverCall(String callId) async {
    // Check if server still has call session
    final session = await api.getCallSession(callId);

    if (session == null || session.status == 'ended') {
      _logger.info('[Call] Session already ended: $callId');
      return;
    }

    // Re-establish PeerConnection
    await _webrtc.reconnect(session);

    // Notify peer to resend ICE
    _ws.send(CallSignal(
      type: SignalType.reconnect,
      targetUserId: session.peerId,
      data: {'call_id': callId},
    ));
  }

  /// Network switch handling (WiFi → 4G)
  Future<void> onNetworkChanged() async {
    // Perform ICE restart
    await _webrtc.restartIce();
  }
}
```

## 8. 总结

| 组件 | 职责 | 关键模式 |
|-----------|---------------|-------------|
| **GlobalHandler** | 统一事件入口与分发 | 策略模式 + 事件优先级 |
| **WebRTCService** | P2P 媒体连接管理 | 状态机 + ICE restart |
| **CallSignalService** | WebSocket 信令 | 发布-订阅模式 |
| **CallKitBridge** | iOS 原生通话集成 | MethodChannel 桥接 |
| **CallRecoveryManager** | 断线重连与恢复 | ICE restart + 会话恢复 |

**架构亮点**：
1. **单一事件入口**：所有外部事件通过 `GlobalHandler.handle()` 统一入口处理
2. **优先级调度**：通话邀请为 `critical` 级别，可中断当前操作
3. **CallKit 集成**：iOS 系统级来电显示，即使 App 被杀死也能工作
4. **WebRTC + TURN**：优先 P2P，NAT 穿透失败时回退到 TURN 中继
5. **状态机**：通话有 6 个明确定义的状态，避免竞态条件
