# NestJS 后台技术全景分析

> 用途：架构总结 / 技术分享  
> 项目：`apps/api`  
> 更新：2026-03-24

---

## 一、技术栈总览

| 层次     | 技术                                    | 说明                       |
| -------- | --------------------------------------- | -------------------------- |
| 框架     | NestJS 10.x                             | 模块化 IoC + 装饰器驱动    |
| 语言     | TypeScript 5.x                          | 全量类型约束               |
| ORM      | Prisma v6                               | PostgreSQL + 事务 + 连接池 |
| 缓存     | Redis + `cache-manager-redis-yet`       | 全局 Key 前缀 + TTL        |
| 队列     | BullMQ                                  | 异步任务（头像生成等）     |
| 实时     | Socket.IO (`@WebSocketGateway`)         | IM 聊天 + 拼团大厅推送     |
| 支付     | Xendit SDK                              | 菲律宾充值 / 代付          |
| 邮件     | Resend                                  | Email OTP                  |
| 定时任务 | `@nestjs/schedule` (`@Cron`)            | 卡单自动同步               |
| 验证     | `class-validator` + `class-transformer` | DTO 白名单校验             |
| 配置     | `@nestjs/config` + Joi                  | 启动时环境变量校验         |
| 安全     | Helmet + ThrottlerModule                | HTTP 安全头 + 全局限流     |
| 文档     | Swagger (`@nestjs/swagger`)             | 开发环境自动生成           |

---

## 二、架构分层（从外到内）

```
main.ts 启动层
  ├── 中间件：requestId（链路追踪 tid）
  ├── 安全：Helmet + CookieParser + CORS 白名单
  ├── trust proxy（正确获取真实 IP，位于 Nginx 后）
  ├── 全局 Pipe：ValidationPipe（whitelist + forbidNonWhitelisted）
  ├── 全局 Interceptor：ResponseWrapInterceptor + ServerTimeInterceptor
  └── 全局 Filter：AllExceptionsFilter

AppModule 根模块
  ├── ConfigModule（Joi 环境变量校验，abortEarly:false）
  ├── CacheModule（Redis Store，isGlobal，keyPrefix + TTL）
  ├── ThrottlerModule（OtpThrottlerGuard 全局限流，60s/60次）
  ├── BullModule（指数补偿重试，失败保留，成功清理）
  ├── ScheduleModule（Cron 定时任务）
  ├── AdminModule（后台 /admin/* 路由域）
  └── ClientModule（客户端 /client/* 路由域）

Common 公共层（跨域复用）
  ├── PrismaService（ORM + 慢查询日志 + 8次重试连接）
  ├── RedisLockService（分布式锁，独立 Redis 连接）
  ├── PaymentService（Xendit 支付网关）
  ├── ChatService（IM 消息引擎）
  ├── EventsGateway（Socket.IO WebSocket）
  ├── LotteryService（加权随机开奖）
  ├── Guards / Interceptors / Filters / Decorators
  └── BizException / error-codes.gen（统一错误体系）
```

---

## 三、核心技术点

### 3.1 双域 JWT 认证体系 ⭐⭐⭐

**核心设计**：Admin 与 Client 使用**两套独立 JWT Secret**，物理隔离权限边界。

```
Client JWT：JWT_SECRET → JwtAuthGuard → { sub: userId }
Admin  JWT：ADMIN_JWT_SECRET → AdminJwtAuthGuard → { sub, role, type:'admin' }
```

- **Client 认证**：Email OTP + OAuth 三端（Google / Facebook / Apple），均自研 Provider，不依赖 Passport
- **Admin 认证**：用户名 / 密码 + bcrypt + RBAC（`@Roles()` + `RolesGuard`）
- **Refresh Token**：`findFirst` 时校验用户 status，防止封禁用户"僵尸复活"
- **OAuth**：调用三方 tokeninfo 接口验签（Google tokeninfo，Apple JWKS），验证 `aud` 防 token 盗用

> ❓ **心智模型提问**：为什么不复用同一个 JWT Secret，用 `type` 字段区分？  
> ✅ 若只靠字段区分，一旦 Secret 泄露，攻击者可构造任意 `type` 的 Token。双 Secret 是物理层面隔离：即使 Client Secret 泄露，Admin 接口仍安全。

---

### 3.2 设备安全守卫（风控层）⭐⭐⭐

`DeviceSecurityGuard` + `@DeviceSecurity()` 装饰器，两级风控模式：

```typescript
// LOG_ONLY：仅记录设备指纹（登录、KYC）
@DeviceSecurity(DeviceSecurityLevel.LOG_ONLY)

// STRICT_CHECK：新设备 24h 禁止提现
@DeviceSecurity(DeviceSecurityLevel.STRICT_CHECK)
async withdraw(...) {}
```

Guard 提取：`deviceId`（自定义 Header）/ `deviceModel` / `userAgent` / 真实 IP，执行：

1. 设备黑名单检查
2. 新设备检测 + 记录
3. STRICT 模式：`checkWithdrawEligibility` — 新设备 24h 冷却期

> ❓ **心智模型提问**：设备冷却期如何应对用户换手机的正常场景？  
> ✅ 24h 是风控与体验的权衡阈值。正常换机用户会触发冷却，但相比防盗号提现的价值，误伤成本可接受，且可配合客服申诉通道解除。

---

### 3.3 全链路 tid 追踪 ⭐⭐

每个请求都有追踪 ID 贯穿全链路：

```
requestId 中间件 → req.id = uuid（或读 x-request-id Header）
                                 ↓
ResponseWrapInterceptor → { code, data, tid, message }
AllExceptionsFilter     → 错误响应也携带 tid
ServerTimeInterceptor   → 响应头 x-server-time（客户端时差校准）
```

> ❓ **心智模型提问**：为什么 tid 要在中间件层生成，而不是在 Interceptor 里生成？  
> ✅ 中间件在 Guard / Pipe / Interceptor 之前执行。如果 Guard 阶段就抛出 401，Interceptor 根本不会运行，但 AllExceptionsFilter 仍能从 `req.id` 读到 tid，保证所有错误响应都有追踪 ID。

---

### 3.4 分布式锁 + AOP 装饰器 ⭐⭐⭐

**底层** `RedisLockService`：独立 Redis 连接 + **Lua 原子脚本解锁**（防止误删他人持有的锁）：

```lua
-- 只有锁的持有者（lockValue 匹配）才能删除
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

**AOP 层** `@DistributedLock()` 装饰器：支持参数路径插值：

```typescript
@DistributedLock('finance:audit:{0}', 10_000)
async auditWithdraw(withdrawId: string) { ... }
// → 锁 Key: 'finance:audit:abc-123'
```

| 场景                 | `throwOnFail`  | 行为                         |
| -------------------- | -------------- | ---------------------------- |
| API 接口（提现审核） | `true`（默认） | 抢锁失败 → 抛异常 → 返回 4xx |
| Cron 定时任务        | `false`        | 抢锁失败 → 静默跳过          |

> ❓ **心智模型提问**：为什么不用 `SETNX + EXPIRE` 两条命令，而要用 `SET NX PX` 单条命令？  
> ✅ 两条命令之间如果进程崩溃，锁永远不过期（死锁）。`SET key value NX PX ttl` 是原子操作，要么同时设值和过期，要么完全失败，消除了死锁风险。

---

### 3.5 密码学安全开奖（核心业务）⭐⭐⭐

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
// uk_lottery_group：重复调用直接报唯一约束错误，永远不会重复开奖
```

整个开奖在 `$transaction` 内原子执行：winner → `WAIT_DELIVERY`，其余 → `COMPLETED`。

> ❓ **心智模型提问**：为什么不在应用层用 `findFirst` 检查再 `create`，而要依赖唯一索引幂等？  
> ✅ `findFirst` + `create` 是两步操作，并发场景下存在 check-then-act 竞态。唯一索引是数据库层面的原子约束，并发 100 个请求也只有 1 个能 `create` 成功。

---

### 3.6 实时 IM 架构 + 大群熔断 ⭐⭐⭐⭐

**解耦设计**：Service → EventEmitter2 → Listener → Gateway，避免 ChatService 直接依赖 Socket 层。

```
sendMessage()
  ↓ EventEmitter2.emit(CHAT_EVENTS.MESSAGE_CREATED)
  ↓ @OnEvent 监听（SocketListener）
  ↓ 1. 房间广播（O(1)）→ 聊天窗口实时更新
  ↓ 2. 个人分发（forEach userId）→ 会话列表预览角标
      ⚠️ 大群熔断：memberIds > 500 时跳过 forEach
         超大群靠"客户端前台自愈"同步
```

**WebSocket 连接认证**：握手时从 query/auth 取 JWT，轮询 Client + Admin 双 Secret 验签，验证通过后加入私人房间 `user_${userId}`。

> ❓ **心智模型提问**：大群熔断后，用户如何感知到新消息？  
> ✅ 客户端进入会话列表时主动拉取 `/conversations`（HTTP 轮询或重新订阅房间），房间广播保证聊天窗口内实时，列表预览的角标更新靠"前台自愈"补偿，接受最终一致性。

---

### 3.7 Cron + Redis 锁防多实例重入 ⭐⭐

金融卡单同步任务（每 10 分钟）：

```typescript
@Cron(CronExpression.EVERY_10_MINUTES)
async handleStuckOrders() {
  await this.lockService.runWithLock(
    'cron:stuck_recharges',
    60_000,
    async () => {
      // 只处理最多 20 笔，每笔间隔 500ms（对 Xendit API 礼貌）
      for (const order of stuckOrders) {
        await this.financeService.syncRechargeStatus(order.rechargeId, 'SYSTEM_BOT');
        await sleep(500);
      }
    },
    false, // 抢锁失败静默跳过
  );
}
```

BullMQ 默认配置：`attempts: 3`，指数补偿重试，`removeOnFail: false`（失败保留排查），`removeOnComplete: true`。

> ❓ **心智模型提问**：Redis 锁 TTL 设 60s，但任务可能超过 60s，怎么办？  
> ✅ 本任务最多处理 20 笔 × 500ms = 10s，TTL 60s 足够。对于运行时间不确定的长任务，应考虑"看门狗"续期机制（如 Redisson），或将任务拆小。

---

### 3.8 BizException + 自动生成错误码 ⭐⭐

`error-codes.gen.ts` **自动生成自 Google Sheets**，前后端错误码完全统一：

```typescript
// 使用：一行抛业务异常
throwBiz(ERROR_KEYS.INSUFFICIENT_BALANCE); // code: 40009, HTTP 400
throwBiz(ERROR_KEYS.UNAUTHORIZED, 401); // code: 40100, HTTP 401
```

`AllExceptionsFilter` 三级处理：

1. `BizException` → 业务错误码 + tid + 详情
2. `HttpException`（含 class-validator 校验错误数组）→ 统一包装
3. `Unknown`（非预期系统错误）→ 500 兜底，**不向客户端泄露堆栈**

---

### 3.9 Prisma 连接管理 + 慢查询监控 ⭐⭐

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

## 四、核心亮点

| 亮点                  | 核心技术                                       | 价值                                               |
| --------------------- | ---------------------------------------------- | -------------------------------------------------- |
| 双域 JWT 物理隔离     | 独立 Secret + type 字段                        | Admin 与 Client 权限完全隔绝，一个泄露不影响另一个 |
| 设备风控守卫          | 设备指纹 + 24h 冷却 + Guard                    | 防新设备账号盗用提现，零侵入业务层                 |
| AOP 分布式锁装饰器    | Lua 原子解锁 + 参数插值                        | 防超卖/重复支付，声明式零侵入                      |
| 加权密码学随机开奖    | `crypto.randomInt` + 幂等事务                  | 公平性保证 + 并发防重放                            |
| IM 大群熔断机制       | EventEmitter2 解耦 + 阈值断路器                | 500 人以上群不做 O(N) 逐人推送，防雪崩             |
| 全链路 tid 追踪       | requestId 中间件 → Filter → Interceptor        | 生产排障效率极大提升                               |
| Cron + 分布式锁防重入 | Redis SETNX + throwOnFail=false                | 多实例安全运行，静默跳过不刷屏                     |
| 错误码自动生成        | Google Sheets → codegen → `error-codes.gen.ts` | 前后端零手动同步                                   |
| Joi 启动校验          | ConfigModule + validationSchema                | 环境变量缺失，程序启动即报错，不等到运行时崩溃     |

---

## 五、压轴题

### Q1：提现如何防止并发超额？

> 双重防护：
>
> 1. `@DistributedLock('finance:audit:{0}')` — 同一提现 ID 同一时刻只有一个请求持锁
> 2. Prisma `$transaction` 内原子查余额、扣款、写记录 — 数据库层面不存在脏读
>
> 即使分布式锁因极端情况失效，数据库事务仍是最后一道防线。

### Q2：开奖结果如何保证公平和幂等？

> - `crypto.randomInt` — 密码学安全随机，不可预测
> - 按 `buyQuantity` 加权 — 多买多机会，规则透明
> - `lotteryResult.create` 在事务内 + `uk_lottery_group` 唯一索引 — 并发 100 个请求也只有 1 个成功，永远不会重复开奖

### Q3：大群 IM 推送如何不压垮服务器？

> 设计了大群熔断阈值（500 人）：
>
> - 聊天窗口：**O(1) 房间广播**（Socket.IO room emit），始终有效
> - 会话列表角标：只对 ≤500 人的群做逐人分发；超过阈值靠客户端前台拉取补偿
>
> 牺牲会话列表的强实时性，换取服务端稳定性。

### Q4：多实例 Cron 如何防止重复执行？

> Cron 入口调 `runWithLock('cron:xxx', ttl, fn, false)`，Redis `SETNX` 确保同一时刻只有一个实例真正运行，`throwOnFail=false` 让其他实例静默跳过而非抛错刷屏日志。

### Q5：为什么 OAuth 自研 Provider 而不用 Passport？

> Passport 适合 Web Session 场景（重定向流），而这里是**移动端 Token 验证模式**：客户端拿到 OAuth idToken 后直接发给后端验签，没有重定向。自研 Provider 代码更轻量可控（Google ~57 行、Apple ~60 行），避免 Passport 的 Session / Strategy 概念负担。

---

## 六、描述模板

> 主导基于 **NestJS 10 + Prisma v6 + PostgreSQL + Redis** 的电商后台 API 建设（20+ 业务模块）；设计 Admin / Client **双域 JWT 隔离认证**体系，集成 Google / Facebook / Apple OAuth 三端登录及 Email OTP；落地 **Redis 分布式锁**（Lua 原子解锁 + AOP 装饰器）解决提现并发超额问题；实现基于 **Socket.IO + EventEmitter2 解耦架构**的 IM 实时推送，设计大群熔断机制（>500 人走 O(1) 房间广播）防雪崩；通过 **BullMQ + Cron + Redis 锁**实现多实例安全定时任务，接入 Xendit 支付网关完成充值 / 代付全链路，错误码由 Google Sheets 自动生成前后端同步。
