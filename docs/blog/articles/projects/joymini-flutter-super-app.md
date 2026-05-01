---
title: "JoyMini Flutter App — 跨平台超级 App 架构实践"
description: "基于 Flutter + Riverpod + GoRouter + Dio 构建的社交媒体电商一体化超级 App，覆盖 IM、LuckyDraw、KYC、电商、钱包等核心功能"
category: "Projects"
tags: [project-showcase, portfolio, flutter, riverpod, mobile-app, cross-platform, im, ecommerce, gorouter, dio]
---

# JoyMini Flutter App — 跨平台超级 App 架构实践

> **定位：** 集社交、电商、通讯、娱乐于一体的超级 App，覆盖菲律宾等东南亚市场。
>
> **平台：** iOS + Android + Web + Windows + macOS + Linux — 一套代码 6 端运行
>
> **规模：** 100+ 页面 | 200+ 组件 | 50+ Riverpod Provider | 10+ 核心 Feature 模块

---

## 一、项目概述

JoyMini Flutter App 不是传统意义上的"购物 App"或"聊天 App"，而是一个 **社交驱动的电商平台**。用户可以在 App 中聊天交友、参与组团抽奖、购买商品、完成 KYC 认证、管理钱包资产 — 所有功能在一个统一的用户体验流中无缝衔接。

**核心功能矩阵：**

| 模块 | 功能 | 技术亮点 |
|------|------|---------|
| 💬 即时通讯 | 文字/图片/语音/视频消息，WebRTC 通话 | CallKit + WebRTC |
| 🎲 LuckyDraw | 组团抽奖 + 拼团 + 机器人填充 | Redis 分布式锁 |
| 🛒 电商 | 商品浏览/下单/支付/物流 | S3 直传 + 钱包 |
| 🔐 KYC | 实名认证 + 活体检测 | Gemini OCR + Liveness |
| 💰 钱包 | 充值/提现/交易记录 | 乐观锁 + Decimal |
| 👥 群组 | 创建/搜索/成员管理 | Avatar 自动合成 |
| 🔗 社交 | 好友/关注/分享 | DeepLink + OAuth |

---

## 二、技术架构总览

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                       UI Layer                               │
│  Pages / Components / Widgets / Animation / Theme Tokens    │
├─────────────────────────────────────────────────────────────┤
│                    State Management (Riverpod)               │
│  AuthNotifier │ UserStore │ WalletStore │ ConfigStore      │
│  ChatProvider │ GroupProvider │ OrderProvider │ ...        │
├───────────────┬──────────────────────┬──────────────────────┤
│    Routing     │      Network         │      Cache           │
│   GoRouter     │  Dio + 2 instances  │  ApiCacheManager     │
│  ShellRoute    │  UnifiedInterceptor │  Hive + SP dual      │
│  AuthGuard     │  Single-fly refresh │  SWR strategy        │
├───────────────┴──────────────────────┴──────────────────────┤
│                   Services / Platform                        │
│  Firebase │ WebRTC │ DeepLink │ Share │ Upload │ DeviceFingerprint│
├─────────────────────────────────────────────────────────────┤
│                      Data Layer                              │
│     REST API (Dio)  ←→  JoyMini API (NestJS)                │
│     Local DB (SQLite)  ←→  HydratedStorage (Hive)           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 技术选型

| 层次 | 选型 | 选择理由 |
|------|------|---------|
| **框架** | Flutter 3.x | 跨平台统一代码，6 端覆盖 |
| **状态管理** | Riverpod 2.x + Code Gen | 编译安全、依赖注入、自动 dispose |
| **路由** | GoRouter + ShellRoute | 声明式路由、嵌套导航、深度链接 |
| **网络** | Dio（双实例）+ UnifiedInterceptor | 双 Base URL、Token 自动刷新 |
| **持久化** | Hive + SharedPreferences + HydratedStorage | Web WASM 兼容 + 高性能 |
| **缓存** | ApiCacheManager（Hive + SP 双存储） | SWR 策略、离线降级 |
| **IM** | WebRTC + CallKit | P2P 音视频通话 |
| **推送** | Firebase Cloud Messaging | 跨平台推送通知 |
| **CI/CD** | GitHub Actions（5 workflows） | 自动化构建 + 测试 + 部署 |

> **💡 录屏建议：** 在 VS Code 中展开 `JoyMini_Flutter_App/lib/` 目录，展示 Feature 模块组织方式，以及 `pubspec.yaml` 中的关键依赖。

---

## 三、核心功能模块详解

### 3.1 即时通讯系统

JoyMini 的 IM 系统是一个完整的即时通讯解决方案，覆盖从文字聊天到音视频通话的全场景。

**消息类型：**

| 类型 | 内容 | 实现 |
|------|------|------|
| Text | 纯文字消息 | `content` 字段直接显示 |
| Image | 图片消息 | 缩略图 + 原图 CDN URL |
| Voice | 语音消息 | 音频 URL + 播放时长 |
| Video | 视频消息 | 视频 URL + 封面截图 |
| Location | 位置分享 | 经纬度 + 地图缩略图 |
| Contact Card | 名片分享 | 用户信息 + 头像 |
| System | 系统通知 | 群组变更/红包/抽奖结果 |

**WebRTC 音视频通话：**

```dart
// CallManager 调度架构
class CallDispatcher {
  static final CallDispatcher instance = CallDispatcher._();

  // 统一入口：无论从何种渠道收到通话请求
  Future<void> dispatch(Map<String, dynamic> data) async {
    // 1. 黑名单检查
    if (_isBlocked(data['callerId'])) return;
    
    // 2. 防抖检查：同一用户 30 秒内不重复弹窗
    if (_isDuplicate(data)) return;
    
    // 3. 决定交互方式
    if (_isAppForeground) {
      // App 前台 → 显示 App 内通话 UI
      _showInAppCallUI(data);
    } else {
      // App 后台/锁屏 → 弹出 CallKit
      _showCallKitNotification(data);
    }
  }
}
```

**技术要点：**
- [`CallDispatcher`](JoyMini_Flutter_App/lib/ui/chat/core/call_manager/call_dispatcher.dart) 作为统一入口，处理所有通道的通话请求
- Firebase Messaging 后台消息通过 [`firebaseMessagingBackgroundHandler`](JoyMini_Flutter_App/lib/app/bootstrap.dart:24) 无缝路由到 Dispatch
- 防抖机制：同一用户 30 秒内重复通话请求自动忽略
- ICE Server 配置由后台 [`ChatService.getIceServers()`](apps/api/src/common/chat/chat.service.ts:886) 动态下发

> **💡 录屏建议：** 在真机或模拟器中演示 IM 聊天，展示文字/图片/语音消息的发送和接收，再演示 WebRTC 通话发起流程。

---

### 3.2 LuckyDraw 抽奖系统

LuckyDraw 是 JoyMini 社交电商的核心玩法，采用 **组团抽奖** 模式：用户开团 → 邀请好友参与 → 满员开奖。

**业务流程：**

```
用户开团
    │
    ▼
GoRouter 导航到 GroupLobbyPage
    │
    ▼
创建团购订单（扣余额）
    │
    ▼
Redis 分布式锁（防超卖）
    │
    ▼
后台 GroupService 处理
    ├─ 检查库存 + 创建群组
    ├─ 等待其他成员加入
    └─ 满员 → 自动开奖
         ├─ 中奖 → 发放奖品
         └─ 未中奖 → 退款
```

**Flutter 端关键页面：**

| 页面 | 功能 | 文件 |
|------|------|------|
| [`GroupLobbyPage`](JoyMini_Flutter_App/lib/app/page/group_lobby/group_lobby_ui.dart) | 团购大厅，展示可参与的团 | Group lobby UI |
| [`LuckyDrawPage`](JoyMini_Flutter_App/lib/app/page/lucky_draw/lucky_draw_page.dart) | 抽奖活动列表 | Lucky draw page |
| [`LuckyDrawWheelPage`](JoyMini_Flutter_App/lib/app/page/lucky_draw/lucky_draw_wheel_page.dart) | 转盘抽奖动画 | Wheel animation |
| [`GroupRoomPage`](JoyMini_Flutter_App/lib/app/page/group_room_page.dart) | 团购房间，实时显示成员 | Group room |
| [`ProductGroupPage`](JoyMini_Flutter_App/lib/app/page/product_group_page.dart) | 商品关联的团体 | Product groups |

**实时更新：** 团购房间使用 Riverpod 的 `StreamProvider` 实时监听团购状态变化，成员加入/开奖结果即时刷新。

> **💡 录屏建议：** 演示完整的开团、分享、成团、开奖流程，展示 GroupLobbyPage 的实时状态刷新效果。

---

### 3.3 KYC 实名认证

JoyMini 的 KYC 系统分多级认证，从基础的身份信息录入到活体检测，覆盖不同安全等级的需求。

**认证流程（Flutter 端）：**

```
KycScanPage
  │  扫描身份证件（手机摄像头）
  ▼
KycInformationConfirmPage
  │  AI OCR 结果 → 用户确认/修改
  ▼
KycVerifyPage
  │  人脸自拍（Liveness Detection）
  ▼
KycStatusPage
  │  认证结果展示（通过/驳回/待审核）
```

**Flutter 端关键页面：**

| 页面 | 功能 |
|------|------|
| [`KycScanPage`](JoyMini_Flutter_App/lib/app/page/kyc_scan_page.dart) | 摄像头扫描身份证件 |
| [`KycInformationConfirmPage`](JoyMini_Flutter_App/lib/app/page/kyc_information_confirm_page.dart) | OCR 结果确认/编辑 |
| [`KycVerifyPage`](JoyMini_Flutter_App/lib/app/page/kyc_verify/kyc_verify_page.dart) | 活体检测（眨眼/转头） |
| [`KycStatusPage`](JoyMini_Flutter_App/lib/app/page/kyc_status_page.dart) | 认证状态展示 |

**双引擎验证：**
1. **Gemini Vision OCR** — 提取证件信息（姓名/证件号/生日等），由后端 [`KycProviderService`](apps/api/src/common/kyc-provider/kyc-provider.service.ts) 处理
2. **Liveness Detection** — 活体检测确保是真人操作，防止照片/视频欺骗

> **💡 录屏建议：** 用手机真机演示 KYC 流程，展示摄像头扫描证件、AI 自动填充信息、人脸自拍验证的全过程。

---

### 3.4 电商与钱包系统

**商品浏览与下单：**

```
HomePage → ProductPage → ProductDetailPage → PaymentPage
                │                                  │
                ▼                                  ▼
          ProductItem                          InsufficientBalanceSheet
          (网格列表)                           PaymentSuccessSheet
```

**核心页面：**

| 页面 | 功能 |
|------|------|
| [`HomePage`](JoyMini_Flutter_App/lib/app/page/home_page.dart) | 首页（Banner + 推荐商品） |
| [`ProductPage`](JoyMini_Flutter_App/lib/app/page/product_page.dart) | 商品列表/分类浏览 |
| [`ProductDetailPage`](JoyMini_Flutter_App/lib/app/page/product_detail_page.dart) | 商品详情 + 下单 |
| [`PaymentPage`](JoyMini_Flutter_App/lib/app/page/payment/payment_page.dart) | 支付确认页面 |
| [`OrderListPage`](JoyMini_Flutter_App/lib/app/page/order_list_page.dart) | 订单列表 |
| [`DepositPage`](JoyMini_Flutter_App/lib/app/page/deposit/deposit_page.dart) | 充值页面 |
| [`WithdrawPage`](JoyMini_Flutter_App/lib/app/page/withdraw/withdraw_page.dart) | 提现页面 |

**钱包状态管理：**

```dart
// 使用 HydratedStateNotifier 自动持久化钱包状态
@riverpod
class WalletNotifier extends _$WalletNotifier {
  @override
  Future<WalletState> build() async {
    // 从本地存储恢复状态或初始化
    return WalletState.initial();
  }

  Future<void> fetchBalance() async {
    final balance = await _api.getBalance();
    state = AsyncData(state.requireValue.copyWith(balance: balance));
  }
}
```

钱包数据使用 [`HydratedStateNotifier`](JoyMini_Flutter_App/lib/core/store/hydrated_state_notifier.dart) 自动持久化到本地，App 重启后余额立即恢复，无需等待网络请求。

> **💡 录屏建议：** 演示完整的购物流程：浏览商品 → 查看详情 → 下单 → 支付成功页面展示，再展示钱包充值和提现操作。

---

## 四、关键技术亮点

### 4.1 AppBootstrap — 5 路并行初始化 + 数据屏障

[`AppBootstrap`](JoyMini_Flutter_App/lib/app/bootstrap.dart) 是 App 启动的总指挥，采用 **两阶段初始化** 策略：

```dart
class AppBootstrap {
  /// 阶段一：系统级初始化（5 路并行）
  static Future<void> initSystem() async {
    // 先设置错误处理器
    _setupErrorHandlers();
    
    // 五项独立任务同时启动
    await Future.wait([
      AssetManager.init(),
      EasyLocalization.ensureInitialized(),
      ApiCacheManager.init(),
      Http.init(),
      _setupFirebase(),
    ]);
    
    // DeepLink 初始化（fire-and-forget）
    DeepLinkService().init();
  }

  /// 阶段二：数据级初始化
  static Future<List<Override>> loadInitialOverrides() async {
    // 读取 Token → 清洗脏数据 → 准备 Riverpod Overrides
    // 确保 runApp 之前所有数据已就绪
  }
}
```

**数据屏障（Data Barrier）：** 在 `runApp()` 之前，Bootstrap 完成所有关键数据加载（Token、用户信息、配置、主题）。如果 Token 存在但用户信息缺失（脏数据），自动清理并重置为未登录状态。这一机制彻底杜绝了"闪一下登录态然后变未登录"的不良体验。

### 4.2 UnifiedInterceptor — 错误策略分发 + 单飞 Token 刷新

Dio 拦截器体系采用 **双实例 + 统一拦截** 设计：

```dart
class UnifiedInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // 1. 根据 HTTP 状态码和执行策略
    switch (err.response?.statusCode) {
      case 401:
        return _handleUnauthorized(err, handler);  // 单飞 Token 刷新
      case 403:
        return _handleForbidden(err, handler);      // 权限拒绝
      case 429:
        return _handleRateLimited(err, handler);    // 限流等待
      case >= 500:
        return _handleServerError(err, handler);    // 服务端错误
      default:
        return _handleNetworkError(err, handler);   // 网络错误
    }
  }
}
```

**单飞 Token 刷新：** 当收到 401 时，所有并发请求共享一个 Refresh Token 请求，避免多个请求同时刷新 Token 导致冲突。

### 4.3 ApiCacheManager — 双存储 + SWR 缓存策略

[`ApiCacheManager`](JoyMini_Flutter_App/lib/core/cache/api_cache_manager.dart) 实现了 **SWR（Stale-While-Revalidate）** 缓存策略：

- **L1 缓存（Hive/SharedPreferences）** — 持久化 JSON 缓存，带 TTL
- **L2 缓存（内存）** — Riverpod Provider 自动缓存，页面间共享
- **SWR 策略** — 过期数据先展示，后台异步刷新

```dart
// SWR 读取：先返回旧数据，后台刷新
CacheReadResult result = ApiCacheManager.getCacheEntry(key);
if (result.state == CacheState.stale) {
  // 数据已过期但仍有值 → 先展示旧数据，后台发起刷新
  scheduleMicrotask(() => _refreshData(key));
}
return result.data; // 立即返回（即使过期）
```

**平台自适应：** Web/WASM 使用 `SharedPreferences`，移动端使用 `Hive` 高性能存储，初始化失败时自动降级。

### 4.4 Design Tokens 生成系统

JoyMini Flutter App 采用 **设计令牌（Design Tokens）** 体系，所有颜色、间距、字体大小从 [`variables.tokens.json`](JoyMini_Flutter_App/assets/variables.tokens.json) 源文件自动生成。

```dart
// 自动生成的 Design Tokens（design_tokens.g.dart）
class TokensLight {
  static const Color textPrimary900 = Color(0xff181d27);
  static const Color bgBrandSolid = Color(0xfffc7701);
  static const Color borderPrimary = Color(0xffd5d7da);
  // ... 1200+ 行自动生成的令牌
}
```

**生成管道：** [`gen_tokens_flutter.dart`](JoyMini_Flutter_App/tool/gen_tokens_flutter.dart) 脚本读取 JSON 源文件 → 生成 Dart 代码 → TypeScript 类型提示 → Tailwind CSS 配置。一套设计规范，三端代码共享。

### 4.5 DeviceFingerprint — 设备指纹 + 风控体系

设备指纹模块在 App 启动时采集设备特征，生成唯一标识，用于风控和反欺诈：

- 硬件特征：设备型号、CPU 架构、内存大小
- 软件特征：操作系统版本、Flutter 版本、时区
- 网络特征：IP、运营商、WiFi BSSID（如有权限）
- **不可变性：** 即使 App 被卸载重装，设备指纹保持不变

### 4.6 Deep Link OAuth + GlobalOAuthHandler

JoyMini 支持完整的 Deep Link OAuth 流程：

```
外部浏览器/OAuth 回调
    │
    ▼
DeepLinkService 解析 URL
    │
    ▼
GlobalOAuthHandler 分发
    ├─ Facebook OAuth → 获取 token → 登录
    ├─ Google OAuth → 获取 token → 登录
    └─ 邀请链接 → 解析参数 → 跳转页面
```

```dart
// DeepLink + OAuth 统一处理
class GlobalOAuthHandler {
  Future<void> handleCallback(Uri uri) async {
    // 解析回调参数
    final code = uri.queryParameters['code'];
    final state = uri.queryParameters['state'];
    
    // 根据 state 识别 OAuth 提供商
    switch (state) {
      case 'facebook':
        return _handleFacebookCallback(code);
      case 'google':
        return _handleGoogleCallback(code);
    }
  }
}
```

### 4.7 GoRouter ShellRoute + RouteAuthConfig 路由守卫

使用 GoRouter 的 [`ShellRoute`](JoyMini_Flutter_App/lib/app/routes/app_router.dart) 实现底部 Tab 导航 + 嵌套路由：

```dart
final router = GoRouter(
  initialLocation: '/home',
  routes: [
    ShellRoute(
      builder: (context, state, child) => LuckyTabBar(child: child),
      routes: [
        GoRoute(path: '/home', ...),       // 首页 Tab
        GoRoute(path: '/products', ...),   // 商品 Tab
        GoRoute(path: '/winners', ...),    // 获奖 Tab
        GoRoute(path: '/me', ...),         // 我的 Tab
      ],
    ),
    // 全屏页面（不在 Tab 内）
    GoRoute(path: '/chat/:id', ...),
    GoRoute(path: '/payment', ...),
  ],
);
```

**路由守卫：** [`RouteAuthConfig`](JoyMini_Flutter_App/lib/app/routes/route_auth_config.dart) 定义需要登录的路由前缀，GoRouter 的 redirect 机制在导航前检查认证状态，未登录时自动跳转登录页。

### 4.8 GlobalUploadService — S3 直传 + 压缩管道

媒体上传服务实现 **S3 直传**，减少服务器中转：

```
用户选择图片/视频
    │
    ▼
GlobalUploadService
    ├─ 1. 获取上传 Token（从 API）
    ├─ 2. 前端压缩（图片质量/视频分辨率）
    ├─ 3. S3 直传（Presigned URL）
    └─ 4. 返回 CDN URL
```

- 图片压缩在前端完成（使用 `flutter_image_compress`）
- 视频压缩可选（用户可 Skip）
- 上传失败自动重试 + 断点续传
- 上传进度通过 Riverpod 暴露给 UI 展示进度条

> **💡 录屏建议：** 演示 App 启动过程，用 DevTools 性能面板展示 5 路并行初始化的火焰图。展示 Dio 拦截器日志中的 401 自动刷新流程。

---

## 五、离线与性能优化

### 5.1 离线支持

| 机制 | 实现 | 效果 |
|------|------|------|
| **ApiCacheManager** | Hive + SP 双存储 | 离线可浏览历史数据 |
| **HydratedStateNotifier** | 自动持久化 State | 钱包/用户信息离线可用 |
| **OfflineQueueManager** | 消息队列（待实现） | 离线消息发送排队 |

### 5.2 性能优化

**启动速度优化：**
- [`AppBootstrap`](JoyMini_Flutter_App/lib/app/bootstrap.dart) 5 路并行初始化，关键路径 < 500ms
- 延迟初始化非关键服务（DeepLink、Firebase Analytics）
- [`AppStartup`](JoyMini_Flutter_App/lib/app/app_startup.dart) 在 runApp 后异步预热数据

**渲染性能：**
- [`ScrollAwarePreloader`](JoyMini_Flutter_App/lib/components/preloader/scroll_aware_preloader.dart) — 列表滚动预加载
- `ImageCacheManager` L1/L2 双缓存 — 图片缓存复用
- `PerformanceDashboard` — 开发模式 FPS/内存监控面板

**缓存策略：**

```
ImageCacheManager
├── L1 Memory Cache (200 images)
│   ├─ 哈希键：image_url + width + height
│   └─ LRU 淘汰策略
└── L2 Disk Cache (500 images)
    ├─ 通过 flutter_cache_manager 管理
    └─ 过期自动清理
```

---

## 六、AI 与未来扩展方向

### 6.1 现有 AI 能力

| 能力 | 实现方式 | 场景 |
|------|---------|------|
| KYC OCR | Gemini Vision → 后端 OCR | 身份证信息自动提取 |
| Liveness 活体检测 | 第三方 SDK + 后端验证 | 人脸认证 |
| 内容审核 | 敏感词 DFA 过滤 | 聊天/评论审核 |

### 6.2 未来规划

**AI 扩展方向：**
- AI 聊天助手（集成到 IM 对话中）
- RAG 客服（基于知识库的自动回复）
- 智能推荐（个性化商品/内容推荐）
- 语音转文字（语音消息自动转文字）

**WEB3 扩展方向：**
- 加密钱包集成
- NFT 数字藏品
- 链上抽奖验证
- 去中心化身份（DID）

> **💡 录屏建议：** 展示 KYC 页面中 Gemini OCR 自动填充身份信息的 AI 识别效果。

---

## 七、技术栈总结

| 层次 | 技术 | 用途 |
|------|------|------|
| **框架** | Flutter 3.x | 跨平台 UI |
| **状态管理** | Riverpod 2.x + Code Gen | 编译安全状态管理 |
| **路由** | GoRouter + ShellRoute | 声明式嵌套路由 |
| **网络** | Dio（双实例） | HTTP/HTTPS 请求 |
| **缓存** | Hive + SharedPreferences | 本地持久化缓存 |
| **IM** | WebRTC + CallKit | 音视频通话 |
| **推送** | Firebase Cloud Messaging | 跨平台推送 |
| **认证** | JWT + OAuth 2.0 | 用户认证 |
| **支付** | 钱包系统 + 支付渠道 | 充值/提现/支付 |
| **CI/CD** | GitHub Actions（5 workflows） | 自动化构建部署 |
| **工具链** | FVM + Shorebird + Codegen | 版本管理 + 热修复 + 代码生成 |

---

## 相关阅读

- [JoyMini Blog — 多语言博客平台的 SSG/SSR/ISR 混合渲染实践](joymini-blog-platform.md) — 前端博客技术解析
- [JoyMini Admin — Next.js 智能管理后台架构实践](joymini-admin-nextjs.md) — 运营后台技术解析
- [JoyMini API — 企业级 NestJS 后端架构实践](joymini-api-nestjs.md) — 后端 API 技术解析

---

*撰写于 2026 年 · JoyMini 技术团队*
