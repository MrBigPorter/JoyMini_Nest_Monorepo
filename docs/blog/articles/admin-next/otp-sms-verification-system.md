---
title: "OTP & SMS 验证系统——Pepper 哈希 + DB 限流 + 状态机 + 重放攻击防护"
slug: "otp-sms-verification-system"
date: "2026-05-03"
description: "深度解析 NestJS OTP 验证系统：SmsVerificationCode 模型 17 字段状态机设计、SHA-256 Pepper 哈希防泄露、60s DB 限流 + 5 次尝试锁定、并发安全更新、Throttler 双重防护、生产/开发双模式"
tags: ["NestJS", "OTP", "SMS", "security", "hash", "rate-limiting", "Prisma", "concurrency"]
---

# OTP & SMS 验证系统——Pepper 哈希 + DB 限流 + 状态机 + 重放攻击防护

## 1. 架构总览

OTP（One-Time Password）验证系统是平台身份认证的第一道防线，涵盖**验证码请求 → 存储 → 校验 → 状态流转**全链路。代码集中在：

- **后端 Service**: [`apps/api/src/client/otp/otp.service.ts`](apps/api/src/client/otp/otp.service.ts)
- **后端 Controller**: [`apps/api/src/client/otp/otp.controller.ts`](apps/api/src/client/otp/otp.controller.ts)
- **数据库模型**: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) — `SmsVerificationCode`
- **哈希工具**: [`apps/api/src/common/otp.util.ts`](apps/api/src/common/otp.util.ts)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Client (Flutter / Web)                                             │
│                                                                      │
│  POST /v1/otp/request  ────── 请求验证码                             │
│  POST /v1/otp/verify   ────── 校验验证码                             │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  NestJS API (apps/api/src/client/otp/)                              │
│                                                                      │
│  OtpController                                                      │
│  ├─ POST /otp/request    ← @Throttle(5/60s)                         │
│  └─ POST /otp/verify     ← @Throttle(10/60s)                        │
│                                                                      │
│  OtpService                                                          │
│  ├─ request() → DB 限流 → gen6Code → otpHash → INSERT              │
│  └─ verify()  → 查 PENDING 记录 → 过期检查 → 尝试上限 →            │
│                 哈希比对 → updateMany 原子更新                       │
│                                                                      │
│  Utils                                                               │
│  ├─ otpHash(phone, code, pepper)  → SHA-256                         │
│  └─ verifyOtpHash(...)            → constant-time compare           │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (Prisma)                                                │
│                                                                      │
│  sms_verification_codes                                             │
│  ├─ id (PK) / phone / countryCode                                   │
│  ├─ codeHash (SHA-256: phone+code+pepper) ★ 不存明文                │
│  ├─ codeType (1-注册/2-登录/3-改密/4-绑手机/5-提现)                │
│  ├─ sendStatus (1-待发送/2-已发送/3-失败)                           │
│  ├─ verifyStatus (0-PENDING/1-VERIFIED/2-EXPIRED/3-LOCKED)          │
│  ├─ verifyTimes / maxVerifyTimes (上限 5 次)                        │
│  └─ expiresAt / verifiedAt / requestIp                               │
│  索引: [phone], [codeType], [verifyStatus], [expiresAt], [createdAt] │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 数据库设计

### 2.1 SmsVerificationCode 模型

[`SmsVerificationCode`](apps/api/prisma/schema.prisma:284) 模型以 17 个字段覆盖验证码全生命周期：

```prisma
model SmsVerificationCode {
  id             String    @id @default(cuid()) @map("code_id")
  createdAt      DateTime  @default(now()) @map("created_at")
  phone          String    @map("phone") @db.VarChar(20)
  countryCode    String    @default("63") @map("country_code") @db.VarChar(10)

  // ── 验证码（哈希存储）──
  codeHash       String    @map("code_hash") @db.VarChar(100)

  // ── 类型 ──
  codeType       Int       @map("code_type") @db.SmallInt
  // 1=注册, 2=登录, 3=修改密码, 4=绑定手机, 5=提现

  // ── 发送状态 ──
  sendStatus     Int       @default(1) @map("send_status")
  // 1=待发送, 2=已发送, 3=发送失败
  sendResult     String?   @map("send_result")
  smsProvider    String?   @map("sms_provider") @db.VarChar(50)
  smsMessageId   String?   @map("sms_message_id") @db.VarChar(100)

  // ── 验证状态机 ──
  verifyStatus   Int       @default(0) @map("verify_status")
  // 0=PENDING, 1=VERIFIED, 2=EXPIRED, 3=LOCKED
  verifyTimes    Int       @default(0) @map("verify_times")
  maxVerifyTimes Int       @default(5) @map("max_verify_times")
  expiresAt      DateTime  @map("expires_at")
  verifiedAt     DateTime? @map("verified_at")

  // ── 安全 ──
  requestIp      String?   @map("request_ip") @db.VarChar(100)

  @@index([phone])
  @@index([codeType])
  @@index([verifyStatus])
  @@index([expiresAt])
  @@index([createdAt])
  @@map("sms_verification_codes")
}
```

### 2.2 状态枚举

验证码生命周期使用独立的枚举值管理，来自 `@lucky/shared`：

```typescript
// VERIFY_STATUS
const VERIFY_STATUS = {
  PENDING:  0,  // 待验证（初始状态）
  VERIFIED: 1,  // 已验证成功
  EXPIRED:  2,  // 已过期（超过 TTL）
  LOCKED:   3,  // 已锁定（超过最大尝试次数）
} as const;

// SEND_STATUS
const SEND_STATUS = {
  PENDING: 1,  // 待发送
  SENT:    2,  // 已发送
  FAILED:  3,  // 发送失败
} as const;

// CODE_TYPE
const CODE_TYPE = {
  REGISTER:   1,  // 注册
  LOGIN:      2,  // 登录
  RESET_PWD:  3,  // 修改密码
  BIND_PHONE: 4,  // 绑定手机
  WITHDRAW:   5,  // 提现
} as const;
```

## 3. 核心安全设计

### 3.1 SHA-256 Pepper 哈希（不存明文）

验证码在数据库中**绝不存储明文**，而是通过 [`otpHash`](apps/api/src/common/otp.util.ts:23) 计算 `SHA-256(phone + code + pepper)` 存入 `codeHash` 字段：

```typescript
export function otpHash(phone: string, code: string, pepper: string): string {
  return sha256(`${phone}:${code}:${pepper}`);
}
```

**Pepper** 是服务端密钥（`OTP_PEPPER` 环境变量），区别于数据库泄漏时仍可逆的 Salt（Salt 通常和哈希一起存），Pepper 单独存储在环境变量中，即使数据库被拖库，攻击者也无法还原验证码。

### 3.2 常量时间比较

校验时使用 [`verifyOtpHash`](apps/api/src/common/otp.util.ts:28) 进行**常量时间比较**，防止时序攻击（Timing Attack）：

```typescript
export function verifyOtpHash(
  phone: string,
  code: string,
  expectedHash: string,
  pepper: string,
): boolean {
  const actualHash = otpHash(phone, code, pepper);
  return timingSafeEqual(actualHash, expectedHash);
}
```

普通字符串 `===` 比较在发现第一个不同字符时立即返回，攻击者可通过响应时间逐位猜测验证码。常量时间比较确保无论匹配与否，执行时间恒定。

### 3.3 双层限流

系统使用**两层限流**防止暴力枚举：

| 层级 | 实现 | 粒度 | 限制 |
|------|------|------|------|
| 应用层 | `@Throttle()` 装饰器 | IP 维度 | request: 5/60s, verify: 10/60s |
| 数据库层 | DB 查询 | 手机号维度 | 60s 内禁止重复请求 |

```typescript
// 应用层：NestJS @nestjs/throttler
@Post('request')
@Throttle({ otpRequest: { limit: 5, ttl: 60_000 } })
async request(@Body() dto: OtpRequestDto) { ... }

@Post('verify')
@Throttle({ otpRequest: { limit: 10, ttl: 60_000 } })
async verify(@Body() dto: OtpVerifyDto) { ... }
```

```typescript
// 数据库层：同手机号 60s 内只能请求一次
const recent = await this.prisma.smsVerificationCode.findFirst({
  where: {
    phone: p,
    codeType: CODE_TYPE.LOGIN,
    createdAt: { gte: new Date(Date.now() - OTP_INTERVAL_SECONDS * 1000) },
  },
  select: { id: true },
});
if (recent) {
  throwBiz(ERROR_KEYS.TOO_MANY_REQUESTS);
}
```

### 3.4 最大尝试次数锁定

每条验证码记录有独立的最大尝试计数，`OTP_MAX_ATTEMPTS = 5`，**超过自动锁定**：

```typescript
if (req.verifyTimes >= OTP_MAX_ATTEMPTS) {
  await this.prisma.smsVerificationCode.update({
    where: { id: req.id, verifyStatus: VERIFY_STATUS.PENDING },
    data: { verifyStatus: VERIFY_STATUS.LOCKED },
  });
  throwBiz(ERROR_KEYS.TOO_MANY_OTP_ATTEMPTS);
}
```

锁定后该条记录无效，用户必须重新请求验证码。

### 3.5 过期机制

验证码有效期由 `OTP_TTL_SECONDS`（默认 300s = 5 分钟）控制：

```typescript
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS) || 300;

// 过期检查
if (isBefore(req.expiresAt, new Date())) {
  await this.prisma.smsVerificationCode.update({
    where: { id: req.id },
    data: { verifyStatus: VERIFY_STATUS.EXPIRED },
  });
  throwBiz(ERROR_KEYS.OTP_EXPIRED);
}
```

## 4. 请求流程详解

### 4.1 请求验证码

```http
POST /v1/otp/request
Content-Type: application/json

{
  "phone": "9878129723"
}
```

[`OtpService.request()`](apps/api/src/client/otp/otp.service.ts:31) 完整流程：

```
用户请求 OTP
    │
    ▼
① 参数校验（phone 必填）
    │
    ▼
② DB 限流检查（同一手机号 60s 内只能请求 1 次）
    │
    ▼
③ 生成验证码
   ├─ 生产环境: gen6Code() → 6 位随机码
   └─ 开发环境: process.env.OTP_DEV_CODE ?? '999999'
    │
    ▼
④ 计算 codeHash = SHA-256(phone:code:pepper)
    │
    ▼
⑤ 入库（codeType=LOGIN, verifyStatus=PENDING,
          verifyTimes=0, maxVerifyTimes=5, expiresAt=now+300s）
    │
    ▼
⑥ 发送 SMS
   ├─ 生产环境: TODO（接供应商 SDK）
   └─ 开发环境: console.log + 返回 devCode
```

**生产/开发双模式**：

```typescript
const isProd = process.env.NODE_ENV === 'production';
const code = isProd ? gen6Code() : (process.env.OTP_DEV_CODE ?? '999999');

if (!isProd) {
  await this.sendSmsDev(p, code);
  return { devCode: code };  // 开发环境直接返回验证码方便调试
}
```

### 4.2 校验验证码

```http
POST /v1/otp/verify
Content-Type: application/json

{
  "phone": "9878129723",
  "code": "123456"
}
```

[`OtpService.verify()`](apps/api/src/client/otp/otp.service.ts:80) 完整流程：

```
用户提交验证码
    │
    ▼
① 参数校验（phone + code 必填）
    │
    ▼
② 查找最近一条 PENDING 状态的验证码记录
   （WHERE phone=X AND codeType=LOGIN AND verifyStatus=PENDING
    ORDER BY createdAt DESC）
    │
    ├─ 记录不存在 → throw "Otp not found"
    │
    ▼
③ 过期检查
    ├─ isBefore(expiresAt, now) → 标记 EXPIRED → throw "OTP_EXPIRED"
    └─ 未过期 → 继续
    │
    ▼
④ 尝试次数检查
    ├─ verifyTimes >= maxVerifyTimes (5) → 标记 LOCKED → throw "TOO_MANY_OTP_ATTEMPTS"
    └─ 未超上限 → 继续
    │
    ▼
⑤ 哈希比对
   verifyOtpHash(phone, code, codeHash, pepper) → boolean
    │
    ▼
⑥ 原子更新（updateMany 防并发）
   WHERE id=req.id AND verifyStatus=PENDING AND verifyTimes < maxVerifyTimes
    │
    ├─ 匹配成功 → { verifyStatus: VERIFIED, verifiedAt: now, verifyTimes++ }
    └─ 匹配失败 → { verifyTimes++ }
    │
    ├─ updated.count !== 1 → 并发冲突 → throw "ALREADY_USED"
    │
    ▼
⑦ 二次更新记录 verifyTimes++
    │
    ▼
⑧ 结果处理
    ├─ 匹配成功 → return '9999'（后续业务用 token）
    └─ 匹配失败 → 检查是否达到上限 → throw "Invalid code"
```

### 4.3 并发安全设计

验证码校验最复杂的部分是**并发安全**。当用户快速点击多次时，必须确保：

1. 同一个验证码**不能被多次使用**（防重放）
2. 尝试计数**准确递增**（不能漏计也不能多计）

解决方案：使用 `updateMany` 的 `where` 条件实现乐观锁：

```typescript
// 原子更新：只有记录仍为 PENDING 且未超上限时才更新
const updated = await this.prisma.smsVerificationCode.updateMany({
  where: {
    id: req.id,
    verifyStatus: VERIFY_STATUS.PENDING,      // 必须是待验证状态
    verifyTimes: { lt: req.maxVerifyTimes },   // 尝试次数未超上限
  },
  data: isMatch
    ? {
        verifyStatus: VERIFY_STATUS.VERIFIED,
        verifiedAt: new Date(),
        verifyTimes: { increment: 1 },
      }
    : {
        verifyTimes: { increment: 1 },
      },
});

// 并发下可能被别的请求先处理，这里兜底
if (updated.count !== 1) {
  throwBiz(ERROR_KEYS.OTP_NOT_VERIFIED_OR_ALREADY_USED);
}
```

**关键点**：
- `updateMany` 是数据库层面的原子操作
- `verifyStatus: PENDING` 条件确保只能被验证一次（后续请求 `where` 不匹配，`updated.count === 0`）
- `verifyTimes: { lt: maxVerifyTimes }` 条件确保不超过上限

## 5. 应用层限流配置

Controller 层使用 `@nestjs/throttler` 的 `@Throttle()` 装饰器：

```typescript
@Post('request')
@Throttle({ otpRequest: { limit: 5, ttl: 60_000 } })  // 5 次/60秒
async request(@Body() dto: OtpRequestDto) { ... }

@Post('verify')
@Throttle({ otpRequest: { limit: 10, ttl: 60_000 } }) // 10 次/60秒
async verify(@Body() dto: OtpVerifyDto) { ... }
```

| 端点 | 速率限制 | 限流维度 | 目的 |
|------|---------|---------|------|
| `POST /otp/request` | 5 次/分钟 | IP | 防止短信轰炸 |
| `POST /otp/verify` | 10 次/分钟 | IP | 防止暴力枚举 |

`@Throttle()` 在 NestJS 中默认基于 `ExpressRequest.ip` 进行限流。如需更精细的手机号维度限流（防止模拟 IP），可配合自定义 `ThrottlerGuard` 或使用 OTP 模块内部的 DB 限流。

## 6. DTO 校验

使用 `class-validator` 装饰器进行请求参数校验：

```typescript
export class OtpRequestDto {
  @IsString()
  phone!: string;
}

export class OtpVerifyDto {
  @IsString()
  phone!: string;

  @IsString()
  @Length(4, 8)  // 4~8 位验证码
  code!: string;
}
```

## 7. 安全防护总结

| 威胁 | 防护措施 | 实现 |
|------|---------|------|
| 验证码泄露 | 哈希存储 + Pepper | SHA-256(phone:code:pepper)，Pepper 在环境变量 |
| 时序攻击 | 常量时间比较 | `timingSafeEqual()` 替代 `===` |
| 暴力枚举 | 尝试次数限制 + 自动锁定 | 5 次错误后标记 LOCKED |
| 重放攻击 | 状态机 + 幂等校验 | VERIFIED 后无法再次验证 |
| 短信轰炸 | 双层限流 | DB 60s 间隔 + Throttler IP 限流 |
| 并发冲突 | 乐观锁 | updateMany + where 条件保证原子性 |
| 过期使用 | TTL 强制过期 | 5 分钟后自动标记 EXPIRED |

## 8. 验证码状态机

```
                     ┌──────────┐
                     │ PENDING  │ ← 初始状态（创建即待验证）
                     │  (0)     │
                     └────┬─────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
      ┌──────────┐  ┌──────────┐  ┌──────────┐
      │ VERIFIED │  │ EXPIRED  │  │  LOCKED  │
      │  (1)     │  │  (2)     │  │  (3)     │
      └──────────┘  └──────────┘  └──────────┘
      ↑ 验证成功    ↑ 超过 TTL    ↑ 超过 5 次尝试
```

状态转换规则：
- **PENDING → VERIFIED**：用户输入正确的验证码（唯一正向路径）
- **PENDING → EXPIRED**：`expiresAt` 时间到达，自动过期
- **PENDING → LOCKED**：验证尝试达到 `maxVerifyTimes`（5 次）
- 一旦离开 PENDING 状态，**不可逆**

## 9. 配置化设计

所有 OTP 参数均通过环境变量配置：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `OTP_PEPPER` | `''` | Pepper 密钥 |
| `OTP_TTL_SECONDS` | `300` | 验证码有效期（秒） |
| `OTP_MAX_ATTEMPTS` | `5` | 最大验证次数 |
| `OTP_INTERVAL_SECONDS` | `60` | 发送间隔（秒） |
| `OTP_DEV_CODE` | `'999999'` | 开发环境固定验证码 |
| `NODE_ENV` | - | 生产/开发模式切换 |

设计意图：**通过配置而非硬编码**调整安全策略。例如在促销期间可以适当放宽 `OTP_INTERVAL_SECONDS`，或在安全升级时降低 `OTP_MAX_ATTEMPTS`。

## 10. 扩展建议

1. **短信供应商接入**：在 `request()` 的 `TODO` 位置接入真实 SMS SDK（如 Twilio、Voyager Innovations），按 `smsProvider` 字段记录供应商
2. **IP 维度的限流增强**：记录 `requestIp` 到 DB，配合 Redis 实现更细粒度的 IP + 手机号双维度限流
3. **图形验证码**：在登录/注册前增加图形验证码（CAPTCHA），防止自动化脚本触发 OTP 请求
4. **语音验证码**：对未收到 SMS 的用户提供语音播报验证码的备选方案
5. **国际手机号**：利用 `countryCode` 字段，根据不同国家/地区适配短信路由

## 11. 总结

OTP & SMS 验证系统展示了**生产级验证码安全架构**的核心设计模式：

- **安全**: SHA-256 Pepper 哈希 + 常量时间比较 + 双层限流 + 自动锁定，覆盖 OWASP 推荐的验证码安全最佳实践
- **数据库**: SmsVerificationCode 模型 17 字段实现完整状态机（PENDING → VERIFIED/EXPIRED/LOCKED），5 个索引支持高效查询
- **并发**: `updateMany` + 乐观锁条件确保验证码一次性使用，防止重放攻击
- **配置**: 全部 6 个参数通过环境变量可调，开发/生产双模式切换
- **限流**: @Throttle 应用层限流 + DB 间隔限流的双层防护
