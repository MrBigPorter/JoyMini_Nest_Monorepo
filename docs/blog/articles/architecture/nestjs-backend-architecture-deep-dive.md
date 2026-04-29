---
title: 'NestJS 后端架构深度解析：双域 JWT、设备安全守卫与分布式锁'
slug: 'nestjs-backend-architecture-deep-dive'
tags: NestJS, Backend, Security, Architecture, WebSocket
---

# NestJS 后端架构深度解析：双域 JWT、设备安全守卫与分布式锁

## 1. 概述

本文剖析一个基于 **NestJS 10 + Prisma v6 + PostgreSQL + Redis** 的电商后台 API（`apps/api`），涵盖 9 个核心技术点。

### 技术栈一览

| 层次 | 技术 | 说明 |
|------|------|------|
| 框架 | NestJS 10.x | 模块化 IoC + 装饰器驱动 |
| ORM | Prisma v6 | PostgreSQL + 事务 + 连接池 |
| 缓存 | Redis + `cache-manager-redis-yet` | 全局 Key 前缀 + TTL |
| 队列 | BullMQ | 异步任务（头像生成等） |
| 实时 | Socket.IO (`@WebSocketGateway`) | IM 聊天 + 拼团大厅推送 |
| 支付 | Xendit SDK | 菲律宾充值 / 代付 |
| 邮件 | Resend | Email OTP |
| 定时任务 | `@nestjs/schedule` | 卡单自动同步 |
| 验证 | class-validator + class-transformer | DTO 白名单校验 |

### 架构分层

```
main.ts 启动层
  ├── 中间件：requestId（链路追踪 tid）
  ├── 安全：Helmet + CookieParser + CORS 白名单
  ├── trust proxy（正确获取真实 IP）
  ├── 全局 Pipe：ValidationPipe（whitelist + forbidNonWhitelisted）
  ├── 全局 Interceptor：ResponseWrapInterceptor + ServerTimeInterceptor
  └── 全局 Filter：AllExceptionsFilter

AppModule 根模块
  ├── ConfigModule（Joi 环境变量校验）
  ├── CacheModule（Redis Store）
  ├── ThrottlerModule（全局限流）
  ├── BullModule（指数补偿重试）
  ├── ScheduleModule（Cron 定时任务）
  ├── AdminModule（后台 /admin/*）
  └── ClientModule（客户端 /client/*）

Common 公共层
  ├── PrismaService（ORM + 慢查询日志）
  ├── RedisLockService（分布式锁）
  ├── ChatService（IM 消息引擎）
  ├── EventsGateway（Socket.IO）
  ├── Guards / Interceptors / Filters / Decorators
  └── BizException / error-codes（统一错误体系）
```

---

## 2. 双域 JWT 认证体系 ⭐⭐⭐

### 核心设计

Admin 与 Client 使用**两套独立 JWT Secret**，物理隔离权限边界：

```
Client JWT：JWT_SECRET → JwtAuthGuard → { sub: userId }
Admin  JWT：ADMIN_JWT_SECRET → AdminJwtAuthGuard → { sub, role, type:'admin' }
```

### 为什么不用单 Secret + type 字段？

```typescript
// ❌ 错误：单 Secret + type 区分
const payload = { sub: userId, type: 'admin' };
// 一旦 Secret 泄露，攻击者可构造任意 type 的 Token

// ✅ 正确：双 Secret 物理隔离
// Client Secret 泄露 → Admin 接口仍安全
// Admin Secret 泄露 → Client 接口仍安全
```

双 Secret 是物理层面的隔离。即使 Client Secret 泄露，攻击者也只能伪造 Client Token，无法访问任何 Admin 接口。

### OAuth 自研 Provider

客户端 OAuth 采用**移动端 Token 验证模式**：客户端拿到 OAuth idToken 后直接发给后端验签，没有重定向。因此自研 Provider 而非使用 Passport：

```typescript
// Google Provider (~57 行)
async verify(token: string): Promise<OAuthUser> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
  );
  const data = await response.json();
  // 验证 aud 字段防 token 盗用
  if (data.aud !== GOOGLE_CLIENT_ID) throw new Error('Invalid audience');
  return { email: data.email, name: data.name, avatar: data.picture };
}
```

Passport 适合 Web Session 场景（重定向流），而这里是 Token 验证模式，自研 Provider 更轻量可控。

---

## 3. 设备安全守卫（风控层）⭐⭐⭐

`DeviceSecurityGuard` + `@DeviceSecurity()` 装饰器实现两级风控：

```typescript
// LOG_ONLY：仅记录设备指纹（登录、KYC）
@DeviceSecurity(DeviceSecurityLevel.LOG_ONLY)

// STRICT_CHECK：新设备 24h 禁止提现
@DeviceSecurity(DeviceSecurityLevel.STRICT_CHECK)
async withdraw(...) {}
```

Guard 提取的指纹信息：`deviceId`（自定义 Header）、`deviceModel`、`userAgent`、真实 IP。

执行流程：

1. **设备黑名单检查** — 已标记的设备直接拒绝
2. **新设备检测 + 记录** — 首次出现的设备指纹写入数据库
3. **STRICT 模式**：`checkWithdrawEligibility` — 新设备 24h 冷却期

### 设计的权衡

24h 冷却期是风控与体验的权衡阈值。正常换机用户会触发冷却，但相比防盗号提现的价值，误伤成本可接受，且可配合客服申诉通道解除。

---

## 4. 分布式锁 + AOP 装饰器 ⭐⭐⭐

### 底层：RedisLockService

独立 Redis 连接 + **Lua 原子脚本解锁**（防止误删他人持有的锁）：

```lua
-- 只有锁的持有者（lockValue 匹配）才能删除
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

### AOP 层：@DistributedLock() 装饰器

支持参数路径插值，声明式加锁：

```typescript
@DistributedLock('finance:audit:{0}', 10_000)
async auditWithdraw(withdrawId: string) { ... }
// → 锁 Key: 'finance:audit:abc-123'
```

| 场景 | throwOnFail | 行为 |
|------|------------|------|
| API 接口（提现审核） | `true`（默认） | 抢锁失败 → 抛异常 → 返回 4xx |
| Cron 定时任务 | `false` | 抢锁失败 → 静默跳过 |

### 为什么必须用原子操作？

```typescript
// ❌ 错误：两条命令有死锁风险
await redis.set(key, value, 'NX');
await redis.expire(key, ttl);  // 如果这行之前崩溃，锁永不过期

// ✅ 正确：SET NX PX 单条原子命令
await redis.set(key, value, 'NX', 'PX', ttl);
// 要么同时设值和过期，要么完全失败
```

---

## 5. 密码学安全开奖 ⭐⭐⭐

加权随机 + 密码学安全 + 幂等事务：

```typescript
// 1. 按购买份数加权（买 3 份 = 3 张签）
for (const m of members) {
  const qty = order?.buyQuantity ?? 1;
  for (let i = 0; i < qty; i++) tickets.push({ userId, orderId });
}

// 2. 密码学安全随机（比 Math.random 更难预测）
const idx = randomInt(0, tickets.length); // crypto.randomInt

// 3. 事务内执行 + 唯一索引保证幂等
await db.lotteryResult.create({ data: { groupId, winnerId, ... } });
// uk_lottery_group：重复调用直接报唯一约束错误
```

整个开奖在 `$transaction` 内原子执行：winner → `WAIT_DELIVERY`，其余 → `COMPLETED`。

### 为什么依赖唯一索引而不是 findFirst + create？

`findFirst` + `create` 是两步操作，并发场景下存在 check-then-act 竞态。唯一索引是数据库层面的原子约束，并发 100 个请求也只有 1 个能 `create` 成功。

---

## 6. 实时 IM 架构 + 大群熔断 ⭐⭐⭐⭐

### 解耦设计

Service → EventEmitter2 → Listener → Gateway，避免 ChatService 直接依赖 Socket 层：

```
sendMessage()
  ↓ EventEmitter2.emit(CHAT_EVENTS.MESSAGE_CREATED)
  ↓ @OnEvent 监听（SocketListener）
  ↓ 1. 房间广播（O(1)）→ 聊天窗口实时更新
  ↓ 2. 个人分发（forEach userId）→ 会话列表预览角标
      ⚠️ 大群熔断：memberIds > 500 时跳过 forEach
         超大群靠"客户端前台自愈"同步
```

### WebSocket 认证

握手时从 query/auth 取 JWT，轮询 Client + Admin 双 Secret 验签，验证通过后加入私人房间 `user_${userId}`。

### 熔断后的补偿

大群熔断后，客户端进入会话列表时主动拉取 `/conversations`（HTTP 轮询或重新订阅房间），房间广播保证聊天窗口内实时，列表预览的角标更新靠"前台自愈"补偿，接受最终一致性。

---

## 7. Cron + Redis 锁防多实例重入 ⭐⭐

金融卡单同步任务（每 10 分钟）：

```typescript
@Cron(CronExpression.EVERY_10_MINUTES)
async handleStuckOrders() {
  await this.lockService.runWithLock(
    'cron:stuck_recharges',
    60_000,
    async () => {
      // 只处理最多 20 笔，每笔间隔 500ms
      for (const order of stuckOrders) {
        await this.financeService.syncRechargeStatus(order.rechargeId, 'SYSTEM_BOT');
        await sleep(500);
      }
    },
    false, // 抢锁失败静默跳过
  );
}
```

BullMQ 默认配置：`attempts: 3`，指数补偿重试，`removeOnFail: false`（保留失败记录排查），`removeOnComplete: true`。

### TTL 设置原则

上述任务最多 20 笔 × 500ms = 10s，TTL 60s 足够。对于运行时间不确定的长任务，应考虑"看门狗"续期机制（如 Redisson），或将任务拆分。

---

## 8. BizException + 自动生成错误码 ⭐⭐

`error-codes.gen.ts` 自动生成自 Google Sheets，前后端错误码完全统一：

```typescript
// 使用：一行抛业务异常
throwBiz(ERROR_KEYS.INSUFFICIENT_BALANCE); // code: 40009, HTTP 400
throwBiz(ERROR_KEYS.UNAUTHORIZED, 401);     // code: 40100, HTTP 401
```

`AllExceptionsFilter` 三级处理：

1. `BizException` → 业务错误码 + tid + 详情
2. `HttpException`（含 class-validator 校验错误数组）→ 统一包装
3. `Unknown`（非预期系统错误）→ 500 兜底，**不向客户端泄露堆栈**

---

## 9. Prisma 连接管理 + 慢查询监控 ⭐⭐

```typescript
// 启动重试：最多 8 次，失败后服务退出
async onModuleInit() {
  for (let i = 1; i <= 8; i++) {
    try { await this.$connect(); return; }
    catch { await sleep(/* 指数回退 */); }
  }
}

// 慢查询阈值：dev = 80ms / prod = 200ms
// 开发打印：🐢 SLOW 500ms SELECT ...
// 生产只输出 warn/error，不输出 query
```

---

## 10. 全链路 tid 追踪 ⭐⭐

每个请求都有追踪 ID 贯穿全链路：

```
requestId 中间件 → req.id = uuid（或读 x-request-id Header）
                                  ↓
ResponseWrapInterceptor → { code, data, tid, message }
AllExceptionsFilter     → 错误响应也携带 tid
ServerTimeInterceptor   → 响应头 x-server-time（客户端时差校准）
```

### 为什么 tid 在中间件层生成？

中间件在 Guard / Pipe / Interceptor 之前执行。如果 Guard 阶段就抛出 401，Interceptor 不会运行，但 AllExceptionsFilter 仍能从 `req.id` 读到 tid，保证**所有错误响应都有追踪 ID**。

---

## 11. 核心亮点总结

| 亮点 | 核心技术 | 价值 |
|------|---------|------|
| 双域 JWT 物理隔离 | 独立 Secret + type 字段 | Admin 与 Client 权限完全隔绝 |
| 设备风控守卫 | 设备指纹 + 24h 冷却 + Guard | 防新设备账号盗用提现 |
| AOP 分布式锁装饰器 | Lua 原子解锁 + 参数插值 | 防超卖/重复支付 |
| 加权密码学随机开奖 | `crypto.randomInt` + 幂等事务 | 公平性保证 + 并发防重放 |
| IM 大群熔断机制 | EventEmitter2 解耦 + 阈值断路器 | 500 人以上不做 O(N) 逐人推送 |
| 全链路 tid 追踪 | requestId 中间件 → Filter → Interceptor | 生产排障效率极大提升 |
| Cron + 分布式锁防重入 | Redis SETNX + throwOnFail=false | 多实例安全运行 |
| 错误码自动生成 | Google Sheets → codegen | 前后端零手动同步 |
| Joi 启动校验 | ConfigModule + validationSchema | 环境变量缺失即报错 |
