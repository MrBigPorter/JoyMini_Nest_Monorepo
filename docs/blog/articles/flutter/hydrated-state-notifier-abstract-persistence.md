# HydratedStateNotifier：Flutter 中的抽象状态持久化

> **目标读者：** Flutter 移动端工程师
> **标签：** `#Flutter` `#StateManagement` `#Persistence` `#Hydrated` `#Riverpod`
> **难度：** 中级
> **预计阅读时间：** 20 分钟

---

## 1. 概述

移动端状态管理面临一个挑战——**状态必须在应用重启后仍然存在**。用户的主题偏好、选择的语言或部分填写的表单应当在进程终止后得以保留。本文探讨 `HydratedStateNotifier`——一个抽象基类，可使用可配置的存储后端自动持久化和恢复状态。

```
           HydratedStateNotifier<T>
                    │
        ┌───────────┴───────────┐
        │                       │
   保存状态                 恢复状态
        │                       │
        ▼                       ▼
  存储后端               存储后端
  (写入)                 (读取)
        │                       │
    ┌───┴───┐               ┌───┴───┐
    │       │               │       │
  JSON   二进制             JSON   二进制
  文件   数据库            文件   数据库
```

---

## 2. 问题

没有持久化的情况下：

```dart
class ThemeNotifier extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.light;  // 每次应用重启都会重置为浅色模式！

  void toggle() {
    _mode = _mode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
    notifyListeners();
  }
}
```

用户选择深色模式 → 切换应用 → 系统杀死进程 → 用户回来 → **又回到了浅色模式**。令人沮丧。

---

## 3. HydratedStateNotifier 实现

### 3.1 抽象基类

```dart
abstract class HydratedStateNotifier<T> extends ChangeNotifier {
  T _state;
  StorageBackend? _storage;
  String get storageKey;  // 每个 notifier 的唯一键

  HydratedStateNotifier(this._state);

  T get state => _state;

  // --- 子类需要实现的抽象方法 ---

  /// 将状态转换为可持久化的 Map
  Map<String, dynamic> toJson(T state);

  /// 从持久化的 Map 恢复状态
  T fromJson(Map<String, dynamic> json);

  /// 当没有持久化数据时的默认状态
  T get defaultValue;

  // --- 水合 (Hydration) ---

  /// 附加存储后端并恢复状态
  Future<void> hydrate(StorageBackend storage) async {
    _storage = storage;
    final saved = await _storage.read(storageKey);
    if (saved != null) {
      try {
        _state = fromJson(saved);
        notifyListeners();
      } catch (e) {
        // 数据损坏 — 使用默认值
        _state = defaultValue;
      }
    }
  }

  // --- 状态变更 ---

  void update(T newState) {
    _state = newState;
    notifyListeners();
    _persist();
  }

  void updateSilent(T newState) {
    _state = newState;
    _persist();  // 持久化但不通知 UI
  }

  // --- 持久化 ---

  Future<void> _persist() async {
    final storage = _storage;
    if (storage != null) {
      await storage.write(storageKey, toJson(_state));
    }
  }

  /// 清除持久化状态
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
      return null;  // 文件损坏 → 视为未命中
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
  OnboardingNotifier() : super(false);  // 未完成

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

  // 初始化存储
  final storageDir = await getApplicationDocumentsDirectory();
  final storage = FileStorageBackend(storageDir);

  // 创建并水合 notifier
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

当状态 schema 发生变化时（例如新增字段），处理迁移：

```dart
class UserPreferencesNotifier extends HydratedStateNotifier<UserPreferences> {
  // ...

  @override
  UserPreferences fromJson(Map<String, dynamic> json) {
    final version = json['_version'] as int? ?? 1;

    if (version < 2) {
      // 迁移 v1 → v2：新增 'notificationsEnabled' 字段
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
      storage = InMemoryStorageBackend();  // 测试实现
    });

    test('应持久化并恢复状态', () async {
      final notifier = ThemePreferenceNotifier();
      await notifier.hydrate(storage);

      expect(notifier.state, ThemeMode.light);  // 默认值

      notifier.toggle();
      expect(notifier.state, ThemeMode.dark);

      // 模拟应用重启
      final notifier2 = ThemePreferenceNotifier();
      await notifier2.hydrate(storage);

      expect(notifier2.state, ThemeMode.dark);  // 从存储中恢复
    });

    test('应清除持久化状态', () async {
      final notifier = ThemePreferenceNotifier();
      await notifier.hydrate(storage);
      notifier.toggle();

      await notifier.clear();

      final notifier2 = ThemePreferenceNotifier();
      await notifier2.hydrate(storage);
      expect(notifier2.state, ThemeMode.light);  // 回到默认值
    });
  });
}
```

---

## 8. 与其他方案的比较

| 方案 | 优点 | 缺点 |
|----------|------|------|
| **HydratedStateNotifier** | 抽象、可测试、支持迁移、任意存储后端 | 需要手动实现 |
| **HydratedBloc** (包) | 内置、与 Bloc 配合、JSON 代码生成 | 依赖重、仅限 Bloc |
| **SharedPreferences** | 简单、内置 | 未加密、基于回调、无水合生命周期 |
| **Riverpod + codegen** | 类型安全、自动化 | 需要 riverpod_generator、自定义存储灵活性较低 |
| **getStorage** | 快速、简单 | 不支持迁移、仅限于基本类型 |

---

## 9. 生产环境检查清单

- [ ] **加密** — 对敏感状态（认证令牌、PII）使用 `encrypted_storage` 后端
- [ ] **防抖写入** — 对快速变化的状态（搜索输入、滚动位置），使用防抖持久化以减少闪存磨损
- [ ] **版本字段** — 在持久化的 JSON 中始终包含 `_version` 以便将来迁移
- [ ] **错误容忍** — 损坏的文件应回退到 `defaultValue`，而不是导致应用崩溃
- [ ] **选择性水合** — 并非所有状态都需要持久化；仅水合需要持久化的 notifier
- [ ] **存储限制** — 考虑最大存储大小（例如 1MB）并清理旧/未使用的键
- [ ] **测试** — 使用 `InMemoryStorageBackend` 进行单元测试；测试每个 schema 版本的迁移路径

---

## 10. 总结

- **HydratedStateNotifier<T>** 是一个抽象基类，为任何 `ChangeNotifier` 添加自动持久化能力
- **StorageBackend** 接口允许在 FileStorage、SharedPreferences、加密存储或内存存储（用于测试）之间切换
- 通过 `_version` 字段实现的 **Schema 版本管理** 支持跨应用更新的平滑数据迁移
- **水合** 在应用启动时、第一帧之前发生，确保状态立即可用
- **防抖持久化** 减少快速变化状态的写入频率
