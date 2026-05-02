# Redis 分布式锁系统：基于装饰器的并发控制

**Date:** 2026-05-01  
**Tags:** `NestJS` `Redis` `Distributed Lock` `Concurrency` `Decorator` `TypeScript` `Cron` `Idempotency`  
**Code Reference:** [`redis-lock.service.ts`](apps/api/src/common/redis/redis-lock.service.ts) | [`distributed-lock.decorator.ts`](apps/api/src/common/decorators/distributed-lock.decorator.ts)

---

## 目录

1. [架构概览](#1-架构概览)
2. [Redis 锁服务 — 核心实现](#2-redis-锁服务--核心实现)
3. [分布式锁装饰器 — 声明式 API](#3-分布式锁装饰器--声明式-api)
4. [使用模式](#4-使用模式)
5. [Lua 脚本解锁 — 原子性保证](#5-lua-脚本解锁--原子性保证)
6. [对比：RedisLock 与其他方案](#6-对比redislocks-与其他方案)
7. [关键要点](#7-关键要点)

---

## 1. 架构概览

分布式锁系统采用**双层架构**：

```
┌─────────────────────────────────────────────┐
│         @DistributedLock(key, ttl)          │
│           方法装饰器（声明式）                │
│                                              │
│  - 键解析（参数插值）                         │
│  - 自动从 this 上下文查找 lockService         │
│  - 服务缺失时的优雅回退                       │
└───────────────────┬─────────────────────────┘
                    │ 调用
                    ▼
┌─────────────────────────────────────────────┐
│          RedisLockService                    │
│       核心实现（命令式）                      │
│                                              │
│  - 专用 Redis 连接                           │
│  - SET NX PX（原子锁获取）                   │
│  - Lua 脚本（原子解锁）                      │
│  - 重连策略                                  │
└─────────────────────────────────────────────┘
```

`@DistributedLock` 装饰器为方法级锁定提供了**声明式 API**，而 `RedisLockService` 负责处理实际的 Redis 通信。这种分离使得装饰器可以在零样板代码的情况下使用。

---

## 2. Redis 锁服务 — 核心实现

[`RedisLockService`](apps/api/src/common/redis/redis-lock.service.ts) 使用**专用 Redis 连接**（与缓存 Redis 分离），以避免与缓存操作产生争用。

### 2.1 专用连接

```typescript
@Injectable()
export class RedisLockService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | undefined;

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
          if (retries > 10) return new Error('已达到最大重连次数');
          return Math.min(retries * 100, 3000);  // 增量退避：100ms，200ms，...
        },
      },
    });
    await this.client.connect();
  }
}
```

**为什么需要专用连接？** 锁操作需要即时一致性。如果缓存 Redis 连接正忙于慢速的 `MGET` 或 `SCAN` 操作，锁获取可能会延迟，导致不必要的争用。

### 2.2 锁获取（SET NX PX）

```typescript
async runWithLock<T>(
  key: string,
  ttl: number,        // 毫秒
  callback: () => Promise<T>,
  throwOnFail = true,  // Cron 任务设为 false
): Promise<T | undefined> {
  if (!this.client?.isOpen) throw new Error('Redis 锁客户端未连接');

  const lockValue = crypto.randomUUID();  // 此锁实例的唯一标识符

  // 原子锁获取
  const result = await this.client.set(key, lockValue, {
    NX: true,   // 仅在键不存在时设置
    PX: ttl,    // 在 TTL 毫秒后过期
  });

  if (result !== 'OK') {
    // 锁被另一个实例持有
    if (throwOnFail) throw new Error(`锁繁忙: ${key}`);
    else return undefined;  // Cron 任务静默跳过
  }
  // ... 执行回调
}
```

关键设计选择：
- **`crypto.randomUUID()`** — 唯一锁值防止其他实例释放我们的锁
- **`NX`（键不存在时才设置）** — 原子的检查并设置，保证只有一个实例能获取锁
- **`PX`（毫秒 TTL）** — 防止持有者崩溃时出现死锁

### 2.3 原子解锁（Lua 脚本）

```typescript
const UNLOCK_SCRIPT = `
   if redis.call("get", KEYS[1]) == ARGV[1] then
       return redis.call("del", KEYS[1])
   else
       return 0
   end
`;

// 在 finally 块中：
await this.client.eval(UNLOCK_SCRIPT, {
  keys: [key],
  arguments: [lockValue],
});
```

Lua 脚本确保了**原子的获取并删除**——只有拥有锁的实例才能释放它。如果没有这个脚本，可能会出现竞态条件：
1. 实例 A 获取锁（值："uuid-a"）
2. 实例 A 的锁过期（TTL）
3. 实例 B 获取锁（值："uuid-b"）
4. 实例 A 调用 `DEL`——释放了实例 B 的锁！❌

使用 Lua 脚本后，步骤 4 检查 `GET key === "uuid-a"` → 不匹配 → 不删除。✅

---

## 3. 分布式锁装饰器 — 声明式 API

[`@DistributedLock`](apps/api/src/common/decorators/distributed-lock.decorator.ts) 装饰器可以将任何方法转变为分布式临界区，无需任何样板代码。

### 3.1 使用方法

```typescript
@Injectable()
export class SomeService {
  constructor(public readonly lockService: RedisLockService) {}

  @DistributedLock('daily:settlement:{0}', 30000, false)  // 30s TTL，Cron 模式
  async runDailySettlement(date: string) {
    // 这段代码在分布式锁下运行
    // 同一时刻只有一个实例执行它
  }

  @DistributedLock('payment:process:{0}', 10000)  // 10s TTL，API 模式
  async processPayment(orderId: string) {
    // 如果锁繁忙，调用者会收到错误（throwOnFail = true）
  }
}
```

### 3.2 带参数插值的键解析

装饰器支持从方法参数进行**动态键解析**：

```typescript
// 键模式：'daily:settlement:{0}'
// {0} = 第一个参数（日期字符串）
// {1.userId} = args[1].userId（嵌套属性访问）
// {2.order.id} = args[2].order.id（深度嵌套）

let finalKey = keyPattern.replace(/{(\d+)(\.[\w.]+)?}/g, (match, indexStr, path) => {
  const index = parseInt(indexStr);
  const arg = args[index];
  if (arg === undefined || arg === null) return 'undefined';
  if (!path) return String(arg);              // {0} → 直接参数
  const pathParts = path.substring(1).split('.');  // {1.userId} → path = ['.', 'u', 's', ...]
  let val = arg;
  for (const part of pathParts) {
    val = val?.[part];
  }
  return String(val ?? 'undefined');
});
```

这支持丰富的键模式，例如：
- `'user:{0}:lock'` — 按用户 ID 锁定（第一个参数）
- `'order:{1.orderId}:payment'` — 按嵌套属性锁定
- `'daily:report:{0.date}'` — 按选项对象中的日期锁定

### 3.3 自动服务检测

```typescript
// 自动查找 lockService，兼容两种命名习惯
const lockService = this.lockService || this.redisLockService;

if (!lockService) {
  logger.error(`[LockError] ${target.constructor.name} 缺少 'lockService'`);
  return await originalMethod.apply(this, args);  // 优雅降级
}
```

装饰器同时检查 `this.lockService` 和 `this.redisLockService`，支持不同的命名习惯而无需配置。

### 3.4 优雅降级

如果锁服务不可用，装饰器会：
1. 记录错误（以便开发者知晓）
2. **仍然执行原始方法**（降级而非崩溃）

这确保了 Redis 宕机不会导致整个应用瘫痪——操作在没有锁的情况下继续执行，以一致性换取可用性。

---

## 4. 使用模式

### 模式 1：Cron 任务（throwOnFail = false）

```typescript
@DistributedLock('cron:daily:settlement', 300000, false)
//                           TTL: 5 分钟   throwOnFail: false
async handleDailySettlement() {
  // 仅在一个实例上运行
  // 其他实例静默跳过
}
```

对于定时任务，`throwOnFail: false` 意味着：
- 第一个实例获取锁 → 执行任务
- 其他实例发现锁繁忙 → **静默返回 undefined**
- 无错误日志、无堆栈跟踪、无噪音

### 模式 2：API 端点（throwOnFail = true）

```typescript
@DistributedLock('payment:deduct:{0}', 10000)
//                           TTL: 10s   throwOnFail: true（默认）
async deductBalance(userId: string, amount: number) {
  // 如果有其他请求正在处理该用户的支付：
  // → 抛出 Error('锁繁忙: payment:deduct:xxx')
  // → 控制器返回 409 Conflict
}
```

对于面向用户的端点，`throwOnFail: true` 意味着：
- 第一个请求获取锁 → 正常处理
- 重复请求发现锁繁忙 → 抛出错误 → HTTP 409
- 防止重复扣费、重复创建订单

### 模式 3：嵌套临界区

```typescript
@DistributedLock('inventory:reserve:{0}', 5000)
async reserveInventory(productId: string, quantity: number) {
  // 锁 A：产品级库存预留
}

@DistributedLock('order:create:{0}', 10000)
async createOrder(userId: string) {
  // 锁 B：用户级订单创建（防止重复订单）
}
```

---

## 5. Lua 脚本解锁 — 原子性保证

解锁脚本是系统安全性的**关键部分**：

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

**为什么这很重要：**

```
时间 | 实例 A              | 实例 B              | Redis 状态
-----|-----------------------|-----------------------|-------------
T1   | SET lock "uuid-a" NX  |                       | lock = "uuid-a"（A 持有）
T2   |（处理中...）           |                       |
T3   |                       | SET lock "uuid-b" NX  | 失败（锁已存在）
T4   | 锁过期（TTL）         |                       | lock = <空>
T5   |                       | SET lock "uuid-b" NX  | lock = "uuid-b"（B 持有）
T6   |（A 的 finally 块）    |                       |
T7   | EVAL 脚本             |                       | GET lock = "uuid-b"
     | 检查 "uuid-a"=="uuid-b"? → 否 → 不 DEL       |
T8   | （B 安全继续）         |                       | lock = "uuid-b"（仍然是 B 的）
```

如果没有 Lua 脚本，在 T7 时一个简单的 `DEL lock` 会删除实例 B 的锁，导致两个实例同时执行。

---

## 6. 对比：RedisLock 与其他方案

| 特性 | RedisLock（本项目） | 数据库咨询锁 | 内存互斥锁 |
|---------|------------------------|----------------------|-----------------|
| **分布式？** | ✅ 是（跨实例） | ✅ 是（共享数据库） | ❌ 否（单进程） |
| **死锁保护** | ✅ TTL 自动过期 | ❌ 必须手动释放 | ❌ 崩溃 = 永久锁定 |
| **所有者验证** | ✅ Lua 脚本（原子） | ❌ 无法验证所有者 | 不适用 |
| **性能** | ⚡ ~1ms（Redis 内存） | 🐢 ~10-50ms（数据库查询） | ⚡ ~0.001ms |
| **粒度** | ✅ 从参数动态生成键 | ✅ 表级别 | ❌ 进程级别 |
| **优雅降级** | ✅ 无锁时仍执行 | ❌ 抛出错误 | 不适用 |
| **专用连接** | ✅ 独立 Redis 客户端 | 不适用 | 不适用 |

---

## 7. 关键要点

1. **基于装饰器的 API** — `@DistributedLock(key, ttl, throwOnFail)` 可将任何方法转变为分布式临界区，零样板代码。键模式支持参数插值，实现动态锁粒度。

2. **双模式设计** — `throwOnFail: true` 用于 API 端点（争用时返回 HTTP 409），`throwOnFail: false` 用于 Cron 任务（静默跳过重复执行）。

3. **通过 Lua 实现原子解锁** — `EVAL` 脚本防止了"由错误所有者释放锁"的竞态条件，这是最常见的分布式锁缺陷。

4. **专用 Redis 连接** — 锁操作拥有独立的 Redis 客户端，避免与缓存操作争用，确保即时一致性。

5. **优雅降级** — 如果 Redis 宕机，装饰器会记录错误但仍执行方法。当锁服务失败时，可用性优先于严格一致性。

6. **自动服务发现** — 装饰器自动查找 `lockService` 或 `redisLockService`，支持不同的命名习惯而无需配置。
