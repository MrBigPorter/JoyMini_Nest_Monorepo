---
title: 'UserStore / WalletStore / ConfigStore: Hydrated 三件套——Flutter 持久化状态管理'
description: 分析基于 HydratedStateNotifier 的三个核心 Store——UserStore 管理用户档案与本地 DB 初始化、WalletStore 缓存余额、ConfigStore 缓存动态配置，以及登录后的并行刷新策略。
slug: user-store-wallet-store-config-store-hydrated-triple
tags: Flutter, StateManagement, Riverpod, Hydrated, Persistence
---

# UserStore / WalletStore / ConfigStore: Hydrated 三件套——Flutter 持久化状态管理

## 1. 背景

在 Flutter 应用中，有三类状态必须在应用重启后存活且响应式更新：

| 状态 | 说明 | 重启丢失的影响 |
|------|------|---------------|
| **用户信息** | 用户档案、ID、头像 | 必须重新登录或闪白屏 |
| **钱包余额** | 可用余额、金币余额 | 显示为 0，体验差 |
| **系统配置** | KYC 开关、汇率、Web 基础 URL | 功能逻辑可能异常 |

本文分析的三个 Store——[`UserNotifier`](JoyMini_Flutter_App/lib/core/store/user_store.dart:7)、[`WalletNotifier`](JoyMini_Flutter_App/lib/core/store/wallet_store.dart:7)、[`SystemConfigNotifier`](JoyMini_Flutter_App/lib/core/store/config_store.dart:6)——均继承自 [`HydratedStateNotifier`](JoyMini_Flutter_App/lib/core/store/hydrated_state_notifier.dart:22)，通过 SharedPreferences 自动持久化状态。

| 组件 | 文件 | 行数 | 初始状态 |
|------|------|------|----------|
| **`HydratedStateNotifier<T>`** | `hydrated_state_notifier.dart` | 64L | 抽象基类 |
| **`UserNotifier`** | `user_store.dart` | 52L | `null` |
| **`WalletNotifier`** | `wallet_store.dart` | 31L | `Balance(0, 0)` |
| **`SystemConfigNotifier`** | `config_store.dart` | 34L | 带默认值的 DynamicSystemConfig |

---

## 2. HydratedStateNotifier——抽象持久化基类

### 2.1 完整实现

[`HydratedStateNotifier<T>`](JoyMini_Flutter_App/lib/core/store/hydrated_state_notifier.dart:22) 是 Riverpod 的 `StateNotifier<T>` 的持久化扩展：

```dart
abstract class HydratedStateNotifier<T> extends StateNotifier<T> {
  HydratedStateNotifier(super.initialState) {
    _load();  // 构造时自动加载
  }

  /// SharedPreferences 中的唯一存储键
  String get storageKey;

  /// JSON → 状态对象
  T fromJson(Map<String, dynamic> json);

  /// 状态对象 → JSON
  Map<String, dynamic> toJson(T state);

  /// 从 SharedPreferences 加载
  Future<void> _load() async {
    final sp = await SharedPreferences.getInstance();
    final raw = sp.getString(storageKey);
    if (raw == null) return;

    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      final loaded = fromJson(map);
      super.state = loaded;  // 用 super.state 避免触发 _save
    } catch (e) {
      // JSON 解析失败时保持初始状态
    }
  }

  /// 持久化到 SharedPreferences
  Future<void> _save(T value) async {
    final sp = await SharedPreferences.getInstance();
    final map = toJson(value);
    await sp.setString(storageKey, jsonEncode(map));
  }

  @override
  set state(T value) {
    super.state = value;
    _save(value);  // 每次状态变化自动持久化
  }
}
```

### 2.2 关键设计点

| 设计 | 说明 |
|------|------|
| **构造时自动加载** | `_load()` 在 `super(initialState)` 后异步执行，不阻塞 UI |
| **`super.state` 避免递归** | `_load()` 中直接设置 `super.state`，不走 setter 的 `_save()` |
| **setter 自动持久化** | 外部通过 `state = newValue` 修改时，自动触发 `_save()` |
| **错误隔离** | JSON 解析失败仅保持初始状态，不抛出异常 |
| **泛型抽象** | `T` 允许任何可 JSON 序列化的类型 |

---

## 3. UserNotifier——用户档案 + 本地 DB 初始化

### 3.1 实现

[`UserNotifier`](JoyMini_Flutter_App/lib/core/store/user_store.dart:7) 管理用户信息状态，状态类型为 `UserInfo?`：

```dart
class UserNotifier extends HydratedStateNotifier<UserInfo?> {
  UserNotifier() : super(null);

  @override
  String get storageKey => 'user_info_storage';

  @override
  UserInfo? fromJson(Map<String, dynamic> json) {
    if (json.isEmpty) return null;  // 空 Map → null（登出状态）
    return UserInfo.fromJson(json);
  }

  @override
  Map<String, dynamic> toJson(UserInfo? state) {
    if (state == null) return {};  // null → 空 Map
    return state.toJson();
  }

  Future<void> fetchProfile() async {
    try {
      final user = await Api.getUserInfo();
      await LocalDatabaseService.init(user.id);  // 核心：拿到用户 ID 后初始化本地 DB
      state = user;
    } catch (e) {
      rethrow;
    }
  }

  void logout() {
    state = null;  // toJson 返回 {}，清空持久化
  }
}
```

### 3.2 状态转换图

```
应用启动
    │
    ├─ 有持久化用户信息 → state = UserInfo（跳过登录）
    │
    └─ 无持久化信息 → state = null（显示登录页）
    
用户登录成功 → fetchProfile()
    │
    ├─ Api.getUserInfo() → 获取用户档案
    ├─ LocalDatabaseService.init(user.id) → 初始化本地数据库
    └─ state = user → 自动持久化

退出登录 → logout()
    │
    └─ state = null → toJson 返回 {} → 存储清空
```

### 3.3 三个修复点

代码中的三个关键修复解决了线上 Bug：

| 修复点 | 问题 | 解决 |
|--------|------|------|
| `fromJson` 空 Map 判断 | 登出后存了 `{}`，下次启动读回非 null 的空 Map | 空 Map → 返回 `null` |
| `toJson` null → `{}` | `toJson` 不能返回 `null`（SharedPreferences setString 不允许） | null 时返回 `{}` |
| 移除 `clear()` 调用 | 基类无 `clear()` 方法 | 直接 `state = null` 即可 |

### 3.4 `fetchProfile` 中的 DB 初始化

`LocalDatabaseService.init(user.id)` 是 `fetchProfile` 中的关键步骤——它确保在拉取用户信息后，立即初始化用户专属的本地数据库（用于聊天记录缓存等）。**这个初始化的时机至关重要**：必须在拿到 `user.id` 之后、在其他模块访问数据库之前完成。

---

## 4. WalletNotifier——余额缓存

### 4.1 实现

[`WalletNotifier`](JoyMini_Flutter_App/lib/core/store/wallet_store.dart:7) 管理钱包余额，状态类型为 `Balance`：

```dart
class WalletNotifier extends HydratedStateNotifier<Balance> {
  WalletNotifier() : super(Balance(realBalance: 0, coinBalance: 0));

  @override
  String get storageKey => 'wallet_balance_storage';

  @override
  Balance fromJson(Map<String, dynamic> json) => Balance.fromJson(json);

  @override
  Map<String, dynamic> toJson(Balance state) => state.toJson();

  Future<void> fetchBalance() async {
    final data = await Api.getWalletBalanceApi();
    state = data;  // 自动持久化
  }
}
```

**与 UserNotifier 的关键区别：**

| 方面 | UserNotifier | WalletNotifier |
|------|-------------|---------------|
| 状态类型 | `UserInfo?`（可空） | `Balance`（非空） |
| 初始值 | `null` | `Balance(0, 0)`（零余额） |
| 空值处理 | 空 Map → null | 直接 deserialize |
| 刷新频率 | 每次启动 + 登录时 | 每次启动 + 登录后 + 交易后 |

零余额初始值 `Balance(realBalance: 0, coinBalance: 0)` 确保了钱包相关 UI 在数据加载前即可安全渲染，不会因 null 而崩溃。

---

## 5. SystemConfigNotifier——动态配置缓存

### 5.1 实现

[`SystemConfigNotifier`](JoyMini_Flutter_App/lib/core/store/config_store.dart:6) 管理服务端动态配置，状态类型为 `DynamicSystemConfig`：

```dart
class SystemConfigNotifier extends HydratedStateNotifier<DynamicSystemConfig> {
  SystemConfigNotifier() : super(DynamicSystemConfig(configs: {
    'kyc_and_phone_verification': '1',  // KYC + 手机验证开关
    'web_base_url': '',                  // Web 基础 URL
    'exchange_rate': '1.0',              // 汇率
  }));

  @override
  String get storageKey => 'sys_config_storage';

  @override
  DynamicSystemConfig fromJson(Map<String, dynamic> json) =>
      DynamicSystemConfig.fromJson(json);

  @override
  Map<String, dynamic> toJson(DynamicSystemConfig state) => state.toJson();

  Future<void> fetchLatest() async {
    try {
      final config = await Api.getDynamicSystemConfig();
      state = config;  // 自动持久化
    } catch (_) {
      // 失败时维持旧配置
    }
  }
}
```

### 5.2 默认值策略

```dart
// 默认配置——确保所有功能在无网络时仍可正常运行
DynamicSystemConfig(configs: {
  'kyc_and_phone_verification': '1',  // 默认开启 KYC 验证
  'web_base_url': '',                  // 空 URL，后续由服务端提供
  'exchange_rate': '1.0',              // 默认 1:1 汇率
})
```

| 配置项 | 默认值 | 作用 |
|--------|--------|------|
| `kyc_and_phone_verification` | `'1'` | KYC 验证默认开启，防止绕过 |
| `web_base_url` | `''` | H5 页面基础 URL，启动后由服务端覆盖 |
| `exchange_rate` | `'1.0'` | 货币汇率，加载前使用默认值 |

### 5.3 静默失败策略

```dart
catch (_) {
  // 失败时维持旧配置
}
```

`fetchLatest()` 在失败时**静默忽略**异常，维持上一次成功加载的配置。这是合理的——动态配置不像用户信息那样需要强一致性，旧配置的短期使用不会造成功能错误。

---

## 6. Provider 注册

三个 Store 通过 `StateNotifierProvider` 注册为 Riverpod Provider：

```dart
// user_store.dart
final userProvider = StateNotifierProvider<UserNotifier, UserInfo?>((ref) {
  return UserNotifier();
});

// wallet_store.dart
final walletProvider = StateNotifierProvider<WalletNotifier, Balance>((ref) {
  return WalletNotifier();
});

// config_store.dart
final configProvider =
    StateNotifierProvider<SystemConfigNotifier, DynamicSystemConfig>((ref) {
  return SystemConfigNotifier();
});
```

**在 UI 中使用：**

```dart
// 监听用户状态
final user = ref.watch(userProvider);
if (user == null) {
  return LoginPage();
}
return Text('欢迎回来, ${user.nickname}');

// 监听钱包余额
final balance = ref.watch(walletProvider);
Text('余额: ¥${balance.realBalance}');

// 监听系统配置
final config = ref.watch(configProvider);
final kycEnabled = config.configs['kyc_and_phone_verification'] == '1';
```

---

## 7. 启动流程与并行刷新

### 7.1 启动后数据流

```
应用启动
    │
    ├─ HydratedStateNotifier 构造 → _load()
    │   ├─ UserNotifier → 读取 user_info_storage → state = UserInfo | null
    │   ├─ WalletNotifier → 读取 wallet_balance_storage → state = Balance
    │   └─ ConfigNotifier → 读取 sys_config_storage → state = DynamicSystemConfig
    │
    └─ UI 可以立即使用缓存数据渲染（零闪白）
    
用户已登录 → 并行刷新
    │
    ├─ Future.wait([
    │     userProvider.notifier.fetchProfile(),
    │     walletProvider.notifier.fetchBalance(),
    │     configProvider.notifier.fetchLatest(),
    │   ]);
    │
    └─ 所有数据更新后 → setState → UI 自动响应
```

### 7.2 为什么需要并行刷新？

| 串行执行 | 并行执行 |
|----------|----------|
| 用户 API(300ms) → 钱包 API(200ms) → 配置 API(150ms) = **650ms** | 所有 API 同时发起 = **300ms** |

通过 `Future.wait` 将三个独立的 API 调用并行化，将启动数据加载时间从串行的 ~650ms 降低到 ~300ms。

---

## 8. 与 HydratedStateNotifier 抽象文章的对比

[`HydratedStateNotifier` 抽象文章](hydrated-state-notifier-abstract-persistence.md) 讨论了通用持久化方案（主题偏好、语言、引导页等简单状态）。而本文的三个 Store 展示了该抽象**在生产环境中的真实应用**：

| 维度 | 抽象文章 | 本文三件套 |
|------|---------|-----------|
| 状态类型 | 简单值（ThemeMode、Locale） | 复杂对象（UserInfo、Balance、DynamicSystemConfig） |
| 生命周期 | 仅读写 | fetchProfile 触发 DB 初始化 |
| 错误处理 | 静默忽略 | fetchProfile rethrow（需要上层处理） |
| 空值策略 | 简单默认值 | UserInfo? 可空、Balance 零值安全、Config 默认值 |
| 组合使用 | 独立使用 | 三者配合，登录后并行刷新 |

---

## 9. 总结

`UserNotifier` / `WalletNotifier` / `SystemConfigNotifier` 三件套展示了 `HydratedStateNotifier` 在真实项目中的完整应用模式：

- **UserNotifier**：最复杂的管理者——从 SharedPreferences 恢复用户档案、API 拉取最新数据、初始化本地数据库、处理登出清空
- **WalletNotifier**：最轻量的缓存者——零余额初始值确保 UI 安全、自动持久化避免频繁 API 调用
- **SystemConfigNotifier**：最稳定的配置者——默认值策略确保离线可用、静默失败维持旧配置

三者共享同一个抽象基类，受益于「构造时加载 + setter 自动保存」的核心机制，实现了「启动零闪白、数据零丢失、代码零重复」的目标。

### 相关文章

- [`HydratedStateNotifier` 抽象持久化](hydrated-state-notifier-abstract-persistence.md)
- [AuthNotifier + TokenStorage 认证状态机](auth-notifier-token-storage-auth-state-machine.md)
- [AppBootstrap 数据屏障 + 5 路并行初始化](app-bootstrap-data-barrier-parallel-init.md)
