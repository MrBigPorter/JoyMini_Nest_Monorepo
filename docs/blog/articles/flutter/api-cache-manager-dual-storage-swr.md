---
title: "ApiCacheManager: Dual Storage + SWR Cache Strategy"
description: "Analysis of ApiCacheManager, a dual-storage cache (RAM + Disk) using SWR (Stale-While-Revalidate) strategy for handling unreliable mobile networks and preventing blank UI states."
slug: api-cache-manager-dual-storage-swr
tags: [Flutter, Caching, SWR, Performance, Offline]
---

## 1. Overview

Mobile applications face unreliable networks — users riding elevators, entering tunnels, or experiencing weak signals. A caching layer ensures the UI never shows a blank state. This article analyzes `ApiCacheManager`, a dual-storage cache (RAM + Disk) employing the **SWR (Stale-While-Revalidate)** strategy.

| Component | Storage | Speed | Capacity | Persistence |
|-----------|---------|-------|----------|-------------|
| **L1: InMemoryCache** | RAM (`Map`) | Instant | 50 entries | Lost on app restart |
| **L2: DiskCache** | SQLite/File | Fast | 500+ entries | Survives restart |

---

## 2. SWR Strategy

**Stale-While-Revalidate (SWR)** works as follows:

1. **Immediately** return cached data (even if stale) → instant UI
2. **In the background**, fetch the latest data from the network → update cache
3. Update UI when fresh data arrives

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

### 2.1 TTL Configuration

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

## 3. In-Memory Cache (L1)

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

## 4. Disk Cache (L2)

### 4.1 SQLite-Based Disk Cache

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

## 5. ApiCacheManager — Coordinator

### 5.1 Implementation

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

### 5.2 Usage in Repository

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

## 6. Cache Invalidation Strategy

### 6.1 When to Invalidate

| Event | Cache Key Pattern | Action |
|-------|-------------------|--------|
| User creates article | `articles:*` | Invalidate all article caches |
| User updates profile | `user:*` | Invalidate user-related caches |
| Admin publishes banner | `banners:*` | Invalidate banner caches |
| User logs out | `user:*`, `orders:*` | Clear all user-related caches |
| Network returns 404 | Specific key | Remove that single cache entry |
| Periodic cleanup | N/A | Clear expired entries every hour |

### 6.2 Push-Based Invalidation

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

## 7. Testing

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

## 8. Production Tuning

| Parameter | Recommended Value | Rationale |
|-----------|-------------------|-----------|
| L1 max entries | 50-100 | Limited mobile RAM; 50 entries cover visible screen |
| L2 max entries | 500-1000 | SQLite handles easily; clean on app startup |
| Stale TTL (articles) | 2 minutes | Content changes frequently |
| Stale TTL (categories) | 10 minutes | Rarely changes |
| Stale TTL (banners) | 5 minutes | Campaigns update periodically |
| Max TTL | 1-24 hours | Force refresh at least once per session |
| SWR | Enabled | Critical for perceived performance |

---

## 9. Summary

- **Dual Storage**: L1 (RAM, instant, 50 entries) + L2 (SQLite, fast, 500+ entries, persistent)
- **SWR Strategy**: Return stale data immediately, refresh in background — eliminates loading spinners
- **Configurable TTLs**: Per-endpoint stale/max TTL settings for granular control
- **Cache Invalidation**: Prefix-based invalidation triggered on relevant events (create, update, delete)
- **Fire-and-Forget Refresh**: SWR background refresh never throws — stale data remains usable on network failure
