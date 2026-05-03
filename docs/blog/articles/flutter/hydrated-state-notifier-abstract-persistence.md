---
title: 'HydratedStateNotifier：Flutter 中的抽象状态持久化'
description: 探讨 HydratedStateNotifier 抽象基类，它通过可配置的存储后端自动持久化和恢复状态，解决主题偏好、语言、引导页等状态在应用重启后的存活问题。
slug: hydrated-state-notifier-abstract-persistence
tags: Flutter, StateManagement, Persistence, Hydrated, Riverpod
---

## 1. 概述

移动端状态管理面临一个挑战——**状态必须在应用重启后存活**。用户的主题偏好、选择的语言或部分填写的表单应在进程终止后持久保留。本文探讨 `HydratedStateNotifier`——一个通过可配置存储后端自动持久化和恢复状态的抽象基类。

```
           HydratedStateNotifier<T>
                    │
        ┌───────────┴───────────┐
        │                       │
    Save State              Restore State
        │                       │
        ▼                       ▼
   Storage Backend          Storage Backend
   (Write)                  (Read)
        │                       │
    ┌───┴───┐               ┌───┴───┐
    │       │               │       │
  JSON   Binary            JSON   Binary
  File   Database          File   Database
```

---

## 2. 问题

没有持久化的情况：

```dart
class ThemeNotifier extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.light;  // Resets to light mode on every app restart!

  void toggle() {
    _mode = _mode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
    notifyListeners();
  }
}
```

用户选择深色模式 → 切换应用 → 系统杀死进程 → 用户返回 → **回到浅色模式**。令人沮丧。

---

## 3. HydratedStateNotifier 实现

### 3.1 抽象基类

```dart
abstract class HydratedStateNotifier<T> extends ChangeNotifier {
  T _state;
  StorageBackend? _storage;
  String get storageKey;  // Unique key per notifier

  HydratedStateNotifier(this._state);

  T get state => _state;

  // --- Abstract methods for subclasses to implement ---

  /// Convert state to a persistable Map
  Map<String, dynamic> toJson(T state);

  /// Restore state from a persisted Map
  T fromJson(Map<String, dynamic> json);

  /// Default state when no persisted data exists
  T get defaultValue;

  // --- Hydration ---

  /// Attach storage backend and restore state
  Future<void> hydrate(StorageBackend storage) async {
    _storage = storage;
    final saved = await _storage.read(storageKey);
    if (saved != null) {
      try {
        _state = fromJson(saved);
        notifyListeners();
      } catch (e) {
        // Corrupted data — use default value
        _state = defaultValue;
      }
    }
  }

  // --- State Mutations ---

  void update(T newState) {
    _state = newState;
    notifyListeners();
    _persist();
  }

  void updateSilent(T newState) {
    _state = newState;
    _persist();  // Persist without notifying UI
  }

  // --- Persistence ---

  Future<void> _persist() async {
    final storage = _storage;
    if (storage != null) {
      await storage.write(storageKey, toJson(_state));
    }
  }

  /// Clear persisted state
  Future<void> clear() async {
    final storage = _storage;
    if (storage != null) {
      await storage.delete(storageKey);
    }
  }
}
```

### 3.2 存储后端接口

```dart
abstract class StorageBackend {
  Future<Map<String, dynamic>?> read(String key);
  Future<void> write(String key, Map<String, dynamic> value);
  Future<void> delete(String key);
  Future<void> clear();
}
```

### 3.3 文件存储实现

```dart
class FileStorageBackend implements StorageBackend {
  final Directory _baseDir;

  FileStorageBackend(this._baseDir);

  Future<Map<String, dynamic>?> read(String key) async {
    try {
      final file = File('${_baseDir.path}/$key.json');
      if (!await file.exists()) return null;
      final content = await file.readAsString();
      return jsonDecode(content) as Map<String, dynamic>;
    } catch (e) {
      return null;  // Corrupted file → treat as cache miss
    }
  }

  Future<void> write(String key, Map<String, dynamic> value) async {
    final file = File('${_baseDir.path}/$key.json');
    await file.writeAsString(jsonEncode(value));
  }

  Future<void> delete(String key) async {
    final file = File('${_baseDir.path}/$key.json');
    if (await file.exists()) await file.delete();
  }

  Future<void> clear() async {
    final files = await _baseDir.list().toList();
    for (final entity in files) {
      if (entity is File && entity.path.endsWith('.json')) {
        await entity.delete();
      }
    }
  }
}
```

---

## 4. 具体示例

### 4.1 ThemePreferenceNotifier

```dart
class ThemePreferenceNotifier extends HydratedStateNotifier<ThemeMode> {
  ThemePreferenceNotifier() : super(ThemeMode.light);

  @override
  String get storageKey => 'theme_preference';

  @override
  ThemeMode get defaultValue => ThemeMode.light;

  @override
  Map<String, dynamic> toJson(ThemeMode state) => {
    'mode': state.name,
  };

  @override
  ThemeMode fromJson(Map<String, dynamic> json) {
    return ThemeMode.values.firstWhere(
      (m) => m.name == json['mode'],
      orElse: () => ThemeMode.light,
    );
  }

  void setTheme(ThemeMode mode) => update(mode);
  void toggle() => update(
    state == ThemeMode.light ? ThemeMode.dark : ThemeMode.light,
  );
}
```

### 4.2 LocaleNotifier

```dart
class LocaleNotifier extends HydratedStateNotifier<Locale> {
  LocaleNotifier() : super(const Locale('en'));

  @override
  String get storageKey => 'app_locale';

  @override
  Locale get defaultValue => const Locale('en');

  @override
  Map<String, dynamic> toJson(Locale state) => {
    'languageCode': state.languageCode,
    'countryCode': state.countryCode,
  };

  @override
  Locale fromJson(Map<String, dynamic> json) {
    return Locale(
      json['languageCode'] as String,
      json['countryCode'] as String?,
    );
  }

  void setLocale(Locale locale) => update(locale);
}
```

### 4.3 OnboardingNotifier

```dart
class OnboardingNotifier extends HydratedStateNotifier<bool> {
  OnboardingNotifier() : super(false);  // Not completed

  @override
  String get storageKey => 'onboarding_completed';

  @override
  bool get defaultValue => false;

  @override
  Map<String, dynamic> toJson(bool state) => {'completed': state};

  @override
  bool fromJson(Map<String, dynamic> json) => json['completed'] as bool;

  void complete() => update(true);
  void reset() => update(false);
}
```

---

## 5. 初始化流程

```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize storage
  final storageDir = await getApplicationDocumentsDirectory();
  final storage = FileStorageBackend(storageDir);

  // Create and hydrate notifiers
  final themeNotifier = ThemePreferenceNotifier();
  await themeNotifier.hydrate(storage);

  final localeNotifier = LocaleNotifier();
  await localeNotifier.hydrate(storage);

  final onboardingNotifier = OnboardingNotifier();
  await onboardingNotifier.hydrate(storage);

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: themeNotifier),
        ChangeNotifierProvider.value(value: localeNotifier),
        ChangeNotifierProvider.value(value: onboardingNotifier),
      ],
      child: const LuckyApp(),
    ),
  );
}
```

---

## 6. 迁移策略

当状态 Schema 发生变化时（例如新增字段），需要处理迁移：

```dart
class UserPreferencesNotifier extends HydratedStateNotifier<UserPreferences> {
  // ...

  @override
  UserPreferences fromJson(Map<String, dynamic> json) {
    final version = json['_version'] as int? ?? 1;

    if (version < 2) {
      // Migrate v1 → v2: add 'notificationsEnabled' field
      json['notificationsEnabled'] = true;
      json['_version'] = 2;
    }

    return UserPreferences(
      theme: json['theme'] as String? ?? 'light',
      language: json['language'] as String? ?? 'en',
      notificationsEnabled: json['notificationsEnabled'] as bool? ?? true,
    );
  }

  @override
  Map<String, dynamic> toJson(UserPreferences state) => {
    '_version': 2,
    'theme': state.theme,
    'language': state.language,
    'notificationsEnabled': state.notificationsEnabled,
  };
}
```

---

## 7. 测试

```dart
void main() {
  group('HydratedStateNotifier', () {
    late InMemoryStorageBackend storage;

    setUp(() {
      storage = InMemoryStorageBackend();  // Test implementation
    });

    test('should persist and restore state', () async {
      final notifier = ThemePreferenceNotifier();
      await notifier.hydrate(storage);

      expect(notifier.state, ThemeMode.light);  // Default value

      notifier.toggle();
      expect(notifier.state, ThemeMode.dark);

      // Simulate app restart
      final notifier2 = ThemePreferenceNotifier();
      await notifier2.hydrate(storage);

      expect(notifier2.state, ThemeMode.dark);  // Restored from storage
    });

    test('should clear persisted state', () async {
      final notifier = ThemePreferenceNotifier();
      await notifier.hydrate(storage);
      notifier.toggle();

      await notifier.clear();

      final notifier2 = ThemePreferenceNotifier();
      await notifier2.hydrate(storage);
      expect(notifier2.state, ThemeMode.light);  // Back to default
    });
  });
}
```

---

## 8. 方案对比

| 方案 | 优点 | 缺点 |
|----------|------|------|
| **HydratedStateNotifier** | 抽象、可测试、支持迁移、任意存储后端 | 需要手动实现 |
| **HydratedBloc**（包） | 内置、与 Bloc 配合、JSON 代码生成 | 依赖重、仅限 Bloc |
| **SharedPreferences** | 简单、内置 | 未加密、基于回调、无 hydration 生命周期 |
| **Riverpod + codegen** | 类型安全、自动化 | 需要 riverpod_generator、自定义存储灵活性低 |
| **getStorage** | 快速、简单 | 无迁移支持、仅基础类型 |

---

## 9. 生产就绪检查清单

- [ ] **加密**——对敏感状态（认证 Token、PII）使用 `encrypted_storage` 后端
- [ ] **防抖写入**——对于快速变化的状态（搜索输入、滚动位置），防抖持久化以减少闪存磨损
- [ ] **版本字段**——始终在持久化 JSON 中包含 `_version` 字段，以便未来迁移
- [ ] **错误容忍**——损坏的文件应回退到 `defaultValue`，而不是崩溃应用
- [ ] **选择性 Hydration**——并非所有状态都需要持久化；只 hydration 需要持久化的 notifier
- [ ] **存储限制**——考虑最大存储大小（例如 1MB）并清理旧的/未使用的键
- [ ] **测试**——使用 `InMemoryStorageBackend` 进行单元测试；测试每个 Schema 版本的迁移路径

---

## 10. 总结

- **HydratedStateNotifier<T>** 是一个抽象基类，为任何 `ChangeNotifier` 添加自动持久化能力
- **StorageBackend** 接口允许在 FileStorage、SharedPreferences、加密存储或内存存储（用于测试）之间切换
- **Schema 版本化**通过 `_version` 字段实现跨应用更新的平滑数据迁移
- **Hydration** 在应用启动时、首帧之前完成，确保状态立即可用
- **防抖持久化**减少快速变化状态的写入频率
