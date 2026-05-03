---
title: 'ApiCacheManager: 双存储 + SWR 缓存策略'
description: 分析 ApiCacheManager 双存储缓存（RAM + 磁盘）如何利用 SWR（Stale-While-Revalidate）策略应对不可靠的移动网络，防止 UI 空白状态。
slug: api-cache-manager-dual-storage-swr
tags: Flutter, Caching, SWR, Performance, Offline
---

# ApiCacheManager: 双存储 + SWR 缓存策略

## 1. 概述

移动应用面临不可靠的网络——用户乘坐电梯、进入隧道或信号弱时。缓存层确保 UI 永远不会显示空白状态。本文分析 `ApiCacheManager`，一个采用 **SWR（Stale-While-Revalidate）** 策略的双存储缓存（RAM + 磁盘）。

| 组件 | 存储 | 速度 | 容量 | 持久性 |
|-----------|---------|-------|----------|-------------|
| **L1：InMemoryCache** | RAM（`Map`） | 即时 | 50 条 | 应用重启后丢失 |
| **L2：DiskCache** | SQLite/文件 | 快速 | 500+ 条 | 重启后存活 |

---

## 2. SWR 策略

**Stale-While-Revalidate（SWR）** 的工作方式如下：

1. **立即**返回缓存数据（即使已过期）→ 即时 UI
2. **在后台**从网络获取最新数据 → 更新缓存
3. 新数据到达时更新 UI

```
Request ─→ L1 RAM ─→ L2 Disk ─→ Network
               │          │          │
               │          │          ▼
               │          │     (Fetch Fresh)
               │          │          │
               ▼          ▼          ▼
           Return      Return     Update L1+L2
          (Instant)   (Fast)     → Notify UI
```

### 2.1 TTL 配置

```dart
class CacheConfig {
  final Duration staleTtl;   // Data is considered "stale" after this
  final Duration maxTtl;     // Data "expires" after this (force refresh)
  final bool swrEnabled;     // Enable stale-while-revalidate

  const CacheConfig({
    this.staleTtl = const Duration(minutes: 5),
    this.maxTtl = const Duration(hours: 1),
    this.swrEnabled = true,
  });

  // Predefined configurations
  static const articles = CacheConfig(staleTtl: Duration(minutes: 2), maxTtl: Duration(hours: 1));
  static const categories = CacheConfig(staleTtl: Duration(minutes: 10), maxTtl: Duration(hours: 24));
  static const banners = CacheConfig(staleTtl: Duration(minutes: 5), maxTtl: Duration(hours: 6));
  static const userProfile = CacheConfig(staleTtl: Duration(seconds: 30), maxTtl: Duration(minutes: 5));
}
```

---

## 3. 内存缓存（L1）

```dart
class InMemoryCache {
  final Map<String, _CacheEntry> _store = {};
  final int maxEntries;

  InMemoryCache({this.maxEntries = 50});

  void set(String key, dynamic data, CacheConfig config) {
    if (_store.length >= maxEntries) {
      _evictOldest();
    }
    _store[key] = _CacheEntry(
      data: data,
      cachedAt: DateTime.now(),
      config: config,
    );
  }

  CacheResult? get(String key) {
    final entry = _store[key];
    if (entry == null) return null;

    final age = DateTime.now().difference(entry.cachedAt);

    if (age > entry.config.maxTtl) {
      _store.remove(key);  // Expired
      return CacheResult.expired();
    }

    if (age > entry.config.staleTtl) {
      return CacheResult.stale(entry.data);  // Stale but usable
    }

    return CacheResult.fresh(entry.data);
  }

  void invalidate(String keyPrefix) {
    _store.removeWhere((key, _) => key.startsWith(keyPrefix));
  }

  void clear() => _store.clear();

  void _evictOldest() {
    final oldest = _store.entries.reduce(
      (a, b) => a.value.cachedAt.isBefore(b.value.cachedAt) ? a : b,
    );
    _store.remove(oldest.key);
  }
}

class _CacheEntry {
  final dynamic data;
  final DateTime cachedAt;
  final CacheConfig config;
  _CacheEntry({required this.data, required this.cachedAt, required this.config});
}

class CacheResult {
  final bool isFresh;
  final bool isStale;
  final dynamic data;

  CacheResult._({required this.isFresh, required this.isStale, this.data});

  factory CacheResult.fresh(dynamic data) => CacheResult._(isFresh: true, isStale: false, data: data);
  factory CacheResult.stale(dynamic data) => CacheResult._(isFresh: false, isStale: true, data: data);
  factory CacheResult.expired() => CacheResult._(isFresh: false, isStale: false);
}
```

---

## 4. 磁盘缓存（L2）

### 4.1 基于 SQLite 的磁盘缓存

```dart
class DiskCache {
  Database? _db;

  Future<void> init() async {
    _db = await openDatabase(
      'api_cache.db',
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE cache (
            key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            stale_ttl_ms INTEGER NOT NULL,
            max_ttl_ms INTEGER NOT NULL
          )
        ''');
      },
    );
  }

  Future<void> set(String key, String data, CacheConfig config) async {
    await _db!.insert(
      'cache',
      {
        'key': key,
        'data': data,
        'cached_at': DateTime.now().millisecondsSinceEpoch,
        'stale_ttl_ms': config.staleTtl.inMilliseconds,
        'max_ttl_ms': config.maxTtl.inMilliseconds,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<CacheResult?> get(String key) async {
    final rows = await _db!.query('cache', where: 'key = ?', whereArgs: [key]);
    if (rows.isEmpty) return null;

    final row = rows.first;
    final cachedAt = DateTime.fromMillisecondsSinceEpoch(row['cached_at'] as int);
    final staleTtl = Duration(milliseconds: row['stale_ttl_ms'] as int);
    final maxTtl = Duration(milliseconds: row['max_ttl_ms'] as int);
    final age = DateTime.now().difference(cachedAt);

    if (age > maxTtl) {
      await _db!.delete('cache', where: 'key = ?', whereArgs: [key]);
      return CacheResult.expired();
    }

    if (age > staleTtl) {
      return CacheResult.stale(row['data']);
    }

    return CacheResult.fresh(row['data']);
  }

  Future<void> invalidate(String keyPrefix) async {
    await _db!.delete('cache', where: 'key LIKE ?', whereArgs: ['$keyPrefix%']);
  }

  Future<void> clear() async {
    await _db!.delete('cache');
  }
}
```

---

## 5. ApiCacheManager——协调器

### 5.1 实现

```dart
class ApiCacheManager {
  final InMemoryCache _l1;
  final DiskCache _l2;
  final Logger _logger = Logger('ApiCache');

  ApiCacheManager({
    InMemoryCache? l1,
    DiskCache? l2,
  })  : _l1 = l1 ?? InMemoryCache(),
        _l2 = l2 ?? DiskCache();

  Future<void> init() async {
    await _l2.init();
  }

  Future<T> fetch<T>({
    required String cacheKey,
    required CacheConfig config,
    required Future<T> Function() networkCall,
    required T Function(String json) fromJson,
    String Function(T data)? toJson,
  }) async {
    // Step 1: Check L1 (RAM)
    final l1Result = _l1.get(cacheKey);
    if (l1Result != null && l1Result.isFresh) {
      _logger.fine('L1 hit: $cacheKey');
      return fromJson(l1Result.data as String);
    }

    // Step 2: Check L2 (Disk)
    final l2Result = await _l2.get(cacheKey);
    if (l2Result != null && l2Result.isFresh) {
      _logger.fine('L2 hit (fresh): $cacheKey');
      _l1.set(cacheKey, l2Result.data, config);  // Promote to L1
      return fromJson(l2Result.data as String);
    }

    // Step 3: SWR — return stale data immediately, refresh in background
    if (config.swrEnabled && l2Result != null && l2Result.isStale) {
      _logger.fine('SWR: $cacheKey (stale, refreshing)');
      _refreshCache(cacheKey, config, networkCall, toJson!);  // Fire-and-forget
      return fromJson(l2Result.data as String);
    }

    // Step 4: No cache — fetch from network
    _logger.fine('Cache miss: $cacheKey (fetching network)');
    return _fetchAndCache(cacheKey, config, networkCall, fromJson, toJson!);
  }

  Future<T> _fetchAndCache<T>(
    String key,
    CacheConfig config,
    Future<T> Function() networkCall,
    T Function(String) fromJson,
    String Function(T) toJson,
  ) async {
    final data = await networkCall();
    final json = toJson(data);
    _l1.set(key, json, config);
    await _l2.set(key, json, config);
    return data;
  }

  Future<void> _refreshCache<T>(
    String key,
    CacheConfig config,
    Future<T> Function() networkCall,
    String Function(T) toJson,
  ) async {
    try {
      final data = await networkCall();
      final json = toJson(data);
      _l1.set(key, json, config);
      await _l2.set(key, json, config);
    } catch (e) {
      _logger.warning('SWR refresh failed: $key ($e)');
      // Keep stale data; user experience unaffected
    }
  }

  Future<void> invalidate(String keyPrefix) async {
    _l1.invalidate(keyPrefix);
    await _l2.invalidate(keyPrefix);
  }

  Future<void> clear() async {
    _l1.clear();
    await _l2.clear();
  }
}
```

### 5.2 在 Repository 中使用

```dart
class ArticleRepository {
  final ApiCacheManager _cache;
  final Http _http;

  ArticleRepository({required ApiCacheManager cache, required Http http})
    : _cache = cache, _http = http;

  Future<List<Article>> getArticles(String locale, int page) async {
    final cacheKey = 'articles:$locale:$page';

    return _cache.fetch<List<Article>>(
      cacheKey: cacheKey,
      config: CacheConfig.articles,
      networkCall: () => _http.get<List<Article>>(
        '/articles',
        queryParams: {'locale': locale, 'page': page.toString()},
        fromJson: (json) => (json as List).map((e) => Article.fromJson(e)).toList(),
      ),
      fromJson: (json) => (jsonDecode(json) as List).map((e) => Article.fromJson(e)).toList(),
      toJson: (data) => jsonEncode(data.map((e) => e.toJson()).toList()),
    );
  }
}
```

---

## 6. 缓存失效策略

### 6.1 何时失效

| 事件 | 缓存键模式 | 操作 |
|-------|-------------------|--------|
| 用户创建文章 | `articles:*` | 使所有文章缓存失效 |
| 用户更新资料 | `user:*` | 使用户相关缓存失效 |
| 管理员发布横幅 | `banners:*` | 使横幅缓存失效 |
| 用户退出登录 | `user:*`, `orders:*` | 清除所有用户相关缓存 |
| 网络返回 404 | 特定键 | 移除该缓存条目 |
| 定期清理 | N/A | 每小时清除过期条目 |

### 6.2 推送式失效

```dart
class CacheInvalidator {
  final ApiCacheManager _cache;

  void onArticleCreated() => _cache.invalidate('articles:');
  void onArticleUpdated(String slug) => _cache.invalidate('articles:$slug');
  void onUserUpdated(String userId) => _cache.invalidate('user:$userId');
  void onBannersChanged() => _cache.invalidate('banners:');
  void onLogout() => _cache.clear();  // Full clear on logout
}
```

---

## 7. 测试

```dart
void main() {
  group('ApiCacheManager', () {
    test('should return fresh data from L1', () async {
      final cache = ApiCacheManager(l1: InMemoryCache(), l2: MockDiskCache());
      await cache.init();

      // Pre-fill cache
      await cache.fetch(
        cacheKey: 'test',
        config: CacheConfig(),
        networkCall: () async => 'fresh-data',
        fromJson: (json) => json,
        toJson: (data) => data,
      );

      // Second call should hit L1
      final result = await cache.fetch(
        cacheKey: 'test',
        config: CacheConfig(),
        networkCall: () async => 'should-not-call',
        fromJson: (json) => json,
        toJson: (data) => data,
      );

      expect(result, 'fresh-data');
    });

    test('should return stale data and refresh in background (SWR)', () async {
      final cache = ApiCacheManager(l1: InMemoryCache(), l2: MockDiskCache());
      await cache.init();

      // Insert stale entry
      await cache._l2.set('test', 'stale-data', CacheConfig(staleTtl: Duration(seconds: 1)));
      await Future.delayed(const Duration(milliseconds: 1100));  // Exceeds stale TTL

      var networkCalled = false;
      final result = await cache.fetch<String>(
        cacheKey: 'test',
        config: CacheConfig(swrEnabled: true),
        networkCall: () async {
          networkCalled = true;
          return 'fresh-data';
        },
        fromJson: (json) => json,
        toJson: (data) => data,
      );

      // Should return stale data immediately
      expect(result, 'stale-data');
      expect(networkCalled, true);  // Background refresh triggered
    });
  });
}
```

---

## 8. 生产调优

| 参数 | 推荐值 | 理由 |
|-----------|-------------------|-----------|
| L1 最大条目数 | 50-100 | 移动端 RAM 有限；50 条覆盖可见屏幕 |
| L2 最大条目数 | 500-1000 | SQLite 轻松处理；应用启动时清理 |
| 过期 TTL（文章） | 2 分钟 | 内容频繁变化 |
| 过期 TTL（分类） | 10 分钟 | 很少变化 |
| 过期 TTL（横幅） | 5 分钟 | 活动定期更新 |
| 最大 TTL | 1-24 小时 | 每个会话至少强制刷新一次 |
| SWR | 启用 | 对感知性能至关重要 |

---

## 9. 总结

- **双存储**：L1（RAM，即时，50 条）+ L2（SQLite，快速，500+ 条，持久化）
- **SWR 策略**：立即返回过期数据，后台刷新——消除加载转圈
- **可配置 TTL**：每个端点的过期/最大 TTL 设置，实现精细控制
- **缓存失效**：基于前缀的失效，在相关事件（创建、更新、删除）时触发
- **即发即忘刷新**：SWR 后台刷新永不抛出异常——网络故障时过期数据仍可用
