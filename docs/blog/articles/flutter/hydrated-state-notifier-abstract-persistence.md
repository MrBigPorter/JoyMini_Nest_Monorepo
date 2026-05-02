---
title: "HydratedStateNotifier: Abstract State Persistence in Flutter"
description: "Exploration of HydratedStateNotifier, an abstract base class that automatically persists and restores state using configurable storage backends, solving state survival across app restarts for theme preferences, locale, onboarding, and more."
slug: hydrated-state-notifier-abstract-persistence
tags: [Flutter, StateManagement, Persistence, Hydrated, Riverpod]
---

## 1. Overview

Mobile state management faces a challenge — **state must survive app restarts**. The user's theme preference, selected language, or partially filled form should persist across process termination. This article explores `HydratedStateNotifier` — an abstract base class that automatically persists and restores state using a configurable storage backend.

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

## 2. The Problem

Without persistence:

```dart
class ThemeNotifier extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.light;  // Resets to light mode on every app restart!

  void toggle() {
    _mode = _mode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
    notifyListeners();
  }
}
```

User selects dark mode → switches app → system kills process → user returns → **back to light mode**. Frustrating.

---

## 3. HydratedStateNotifier Implementation

### 3.1 Abstract Base Class

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

### 3.2 Storage Backend Interface

```dart
abstract class StorageBackend {
  Future<Map<String, dynamic>?> read(String key);
  Future<void> write(String key, Map<String, dynamic> value);
  Future<void> delete(String key);
  Future<void> clear();
}
```

### 3.3 File Storage Implementation

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

## 4. Concrete Examples

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

## 5. Initialization Flow

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

## 6. Migration Strategy

When the state schema changes (e.g., new fields are added), handle migrations:

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

## 7. Testing

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

## 8. Comparison with Alternatives

| Approach | Pros | Cons |
|----------|------|------|
| **HydratedStateNotifier** | Abstract, testable, migration support, any storage backend | Requires manual implementation |
| **HydratedBloc** (package) | Built-in, works with Bloc, JSON codegen | Heavy dependency, Bloc-only |
| **SharedPreferences** | Simple, built-in | Unencrypted, callback-based, no hydration lifecycle |
| **Riverpod + codegen** | Type-safe, automated | Requires riverpod_generator, less custom storage flexibility |
| **getStorage** | Fast, simple | No migration support, basic types only |

---

## 9. Production Readiness Checklist

- [ ] **Encryption** — Use `encrypted_storage` backend for sensitive state (auth tokens, PII)
- [ ] **Debounced Writes** — For rapidly changing state (search input, scroll position), debounce persistence to reduce flash wear
- [ ] **Version Field** — Always include `_version` in persisted JSON for future migrations
- [ ] **Error Tolerance** — Corrupted files should fall back to `defaultValue`, not crash the app
- [ ] **Selective Hydration** — Not all state needs persistence; hydrate only notifiers that require it
- [ ] **Storage Limits** — Consider a maximum storage size (e.g., 1MB) and clean up old/unused keys
- [ ] **Testing** — Use `InMemoryStorageBackend` for unit tests; test migration paths for each schema version

---

## 10. Summary

- **HydratedStateNotifier<T>** is an abstract base class that adds automatic persistence to any `ChangeNotifier`
- **StorageBackend** interface allows swapping between FileStorage, SharedPreferences, encrypted storage, or in-memory storage (for testing)
- **Schema Versioning** via `_version` field enables smooth data migration across app updates
- **Hydration** happens at app startup, before the first frame, ensuring state is immediately available
- **Debounced Persistence** reduces write frequency for rapidly changing state
