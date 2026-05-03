---
title: "GlobalHandler + CallKit + WebRTC Calls: Global Event Bus and Real-Time Call Architecture"
description: "A unified global event handling system using GlobalHandler for event routing with priority levels, integrated with WebRTC peer-to-peer calling, iOS CallKit integration via MethodChannel, and call recovery management."
slug: global-handler-callkit-webrtc
tags: [flutter, webrtc, callkit, architecture, real-time]
---

# GlobalHandler + CallKit + WebRTC Calls: Global Event Bus and Real-Time Call Architecture

## 1. Problem Background

JoyMini, as a social application, needs to handle multiple types of **externally triggered events** simultaneously:

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

**GlobalHandler** unifies all these events into a single entry point, dispatching them by **event priority**.

## 2. GlobalHandler — Global Event Hub

### 2.1 Event Routing

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

### 2.2 Event Model

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

### 2.3 Push Notification Handling

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

## 3. WebRTC Call System

### 3.1 Call State Machine

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

### 3.2 WebRTC Service

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

### 3.3 Call Signaling via WebSocket

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

## 4. CallKit Integration (iOS)

### 4.1 Native CallKit Handling

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

### 4.2 Flutter Side MethodChannel

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

## 5. Call UI Layer

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

### 5.2 Call Duration Formatting

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

## 6. Complete Call Flow

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

## 7. Fault Tolerance and Recovery

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

## 8. Summary

| Component | Responsibility | Key Pattern |
|-----------|---------------|-------------|
| **GlobalHandler** | Unified event entry and dispatch | Strategy pattern + Event priority |
| **WebRTCService** | P2P media connection management | State machine + ICE restart |
| **CallSignalService** | Signaling via WebSocket | Publish-subscribe pattern |
| **CallKitBridge** | iOS native call integration | MethodChannel bridge |
| **CallRecoveryManager** | Disconnect reconnection and recovery | ICE restart + Session recovery |

**Architecture Highlights**:
1. **Single Event Entry**: All external events handled through `GlobalHandler.handle()` unified entry
2. **Priority Scheduling**: Call invitations are `critical` level, can interrupt current operations
3. **CallKit Integration**: iOS system-level incoming call display, works even if app is killed
4. **WebRTC + TURN**: P2P preferred, falls back to TURN relay when NAT traversal fails
5. **State Machine**: Call has 6 well-defined states, avoiding race conditions
