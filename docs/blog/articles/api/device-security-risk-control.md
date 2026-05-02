# 设备安全与风险控制：金融科技应用的多层防御

**Date:** 2026-05-01  
**Tags:** `NestJS` `Security` `Device Fingerprinting` `Risk Control` `Redis` `Rate Limiting` `CSRF` `reCAPTCHA` `TypeScript`  
**Code Reference:** [`device-security.service.ts`](apps/api/src/common/device/device-security.service.ts) | [`device-security.guard.ts`](apps/api/src/common/guards/device-security.guard.ts) | [`otp-throttler.guard.ts`](apps/api/src/common/guards/otp-throttler.guard.ts) | [`csrf.middleware.ts`](apps/api/src/common/middleware/csrf.middleware.ts) | [`recaptcha.service.ts`](apps/api/src/common/recaptcha/recaptcha.service.ts)

---

## 目录

1. [架构概览](#1-架构概览)
2. [设备安全守卫 — 守卫层](#2-设备安全守卫--守卫层)
3. [设备安全服务 — 核心逻辑](#3-设备安全服务--核心逻辑)
4. [OTP 限流守卫 — 速率限制](#4-otp-限流守卫--速率限制)
5. [CSRF 防护 — 中间件层](#5-csrf-防护--中间件层)
6. [reCAPTCHA 集成 — 机器人检测](#6-recaptcha-集成--机器人检测)
7. [对比：API 安全栈 vs Admin-Next 安全](#7-对比api-安全栈-vs-admin-next-安全)
8. [关键要点](#8-关键要点)

---

## 1. 架构概览

安全基础设施形成了**分层防御**系统，在请求到达业务逻辑之前，在多个阶段进行验证：

```
HTTP Request
     │
     ▼
┌──────────────────┐
│  CSRF Middleware  │  ← 基于 Session：验证 Token
│  (csrf.middleware)│    JWT 方式：跳过（无状态）
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  JwtAuthGuard    │  ← 身份验证（你是谁？）
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ OtpThrottlerGuard│  ← 速率限制（OTP：复合键）
│ (otp-throttler)  │    非 OTP：基于 IP
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ DeviceSecurity   │  ← 设备验证与风险评分
│ Guard            │    黑名单 → 信任缓存 → 数据库检查
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ reCAPTCHA (可选)  │  ← 机器人检测（公共端点）
└────────┬─────────┘
         │
         ▼
     业务逻辑
```

每一层都可以通过装饰器**独立配置**，并可按路由应用。

---

## 2. 设备安全守卫 — 守卫层

[`DeviceSecurityGuard`](apps/api/src/common/guards/device-security.guard.ts) 是一个 NestJS `CanActivate` 守卫，它在允许访问敏感操作之前拦截请求并验证设备身份。

```typescript
@Injectable()
export class DeviceSecurityGuard implements CanActivate {
  constructor(
    private deviceSecurityService: DeviceSecurityService,
    private reflector: Reflector,
    private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = extractUserId(request);
    if (!userId) return false;

    // 从 @DeviceSecurity() 装饰器读取设备安全级别
    const securityLevel = this.reflector.get<DeviceSecurityLevel>(
      DEVICE_SECURITY_KEY, context.getHandler(),
    );

    // 从请求中提取设备信息（通过 @CurrentDevice 装饰器）
    const deviceInfo: DeviceInfo = {
      deviceId: request.headers['x-device-id'],
      deviceModel: request.headers['x-device-model'],
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };

    // Step 1: 验证并记录设备信息（使用 Redis 缓存）
    await this.deviceSecurityService.validateAndLogDevice(userId, deviceInfo);

    // Step 2: 对于提现操作，检查 24 小时资格
    if (securityLevel === 'WITHDRAW') {
      await this.deviceSecurityService.checkWithdrawEligibility(userId, deviceInfo.deviceId);
    }

    return true;
  }
}
```

**`@DeviceSecurity()` 装饰器**控制安全级别：

```typescript
// device-security.decorator.ts
export enum DeviceSecurityLevel {
  LOG = 'LOG',           // 仅记录设备，不验证
  VALIDATE = 'VALIDATE', // 标准验证（黑名单 + 多账户检测）
  WITHDRAW = 'WITHDRAW', // 完整检查 + 24 小时资格
}
```

---

## 3. 设备安全服务 — 核心逻辑

[`DeviceSecurityService`](apps/api/src/common/device/device-security.service.ts) 实现了实际的验证逻辑，采用**Redis 优先、数据库其次**的策略以获得最佳性能。

### 3.1 双层黑名单（Redis + DB）

```
请求 → Redis SISMEMBER（0.1ms）
          │
          ├── 已封禁 → throwBiz(DEVICE_BLACKLISTED)
          │
          └── 未找到 → 数据库检查（兜底）
                        │
                        ├── 已封禁 → 同步到 Redis + 拦截
                        │
                        └── 正常 → 继续
```

```typescript
async validateAndLogDevice(userId: string, info: DeviceInfo) {
  // 1. Redis 黑名单（快速路径）
  const isBlacklisted = await this.redisService.sismember(
    'security:device:blacklist', info.deviceId,
  );
  if (isBlacklisted) throwBiz(ERROR_KEYS.DEVICE_BLACKLISTED);

  // 2. 活动缓存检查（5 分钟 TTL — 高频请求完全跳过数据库）
  const cacheKey = `security:device:active:${userId}:${info.deviceId}`;
  const lastActive = await this.redisService.get(cacheKey);
  if (lastActive) return;  // 跳过数据库 — 设备最近已验证过

  // 3. 数据库黑名单（双重检查 — Redis 数据丢失保护）
  const dbBanned = await this.prismaService.deviceBlacklist.findUnique({
    where: { deviceId: info.deviceId }, select: { id: true },
  });
  if (dbBanned) {
    await this.redisService.sadd('security:device:blacklist', info.deviceId); // 同步回 Redis
    throwBiz(ERROR_KEYS.DEVICE_BLACKLISTED);
  }

  // 4. 多账户检测（防止设备农场）
  const existingBinding = await this.prismaService.userDevice.findUnique({
    where: { userId_deviceId: { userId, deviceId: info.deviceId } },
  });
  if (!existingBinding) {
    const linkedUsers = await this.prismaService.userDevice.count({
      where: { deviceId: info.deviceId, userId: { not: userId } },
    });
    if (linkedUsers >= 3) {
      await this.autoBlockDevice(info.deviceId, '检测到设备农场');
      throwBiz(ERROR_KEYS.DEVICE_BLACKLISTED);
    }
  }

  // 5. 更新设备记录 + 缓存 5 分钟
  await this.prismaService.userDevice.upsert({ ... });
  await this.redisService.set(cacheKey, '1', 300);
}
```

**性能优化：** 步骤 1-2（Redis 检查）约 0.1ms。步骤 3-5（数据库操作）每台设备每个用户每 5 分钟只运行一次。对于 5 分钟内发送 100 次请求的用户，98 次完全跳过数据库。

### 3.2 多账户检测

系统通过统计关联用户数量来检测**设备农场**（一个设备上有多个账户）：

| 关联用户数 | 操作 |
|-------------|--------|
| 0（首次） | 创建绑定，不检查 |
| 1-2（已知用户） | 跳过计数查询（优化） |
| 3+（可疑） | 自动封禁设备 |

**跳过优化**很重要——如果当前用户已有该设备的 `userDevice` 记录，我们完全跳过昂贵的 `COUNT` 查询。

### 3.3 提现资格（24 小时规则）

```typescript
async checkWithdrawEligibility(userId: string, deviceId: string) {
  const device = await this.prismaService.userDevice.findUnique({
    where: { userId_deviceId: { userId, deviceId } },
  });
  if (!device) throwBiz(ERROR_KEYS.DEVICE_NOT_TRUSTED);

  const hoursSinceCreated = TimeHelper.isOlderThan(device.createdAt, 24, 'hour');
  if (!hoursSinceCreated) throwBiz(ERROR_KEYS.DEVICE_NOT_TRUSTED);
}
```

新设备可以立即浏览和聊天，但提现**必须等待 24 小时**。这防止了攻击者使用窃取的凭证在新设备上清空账户资金。

### 3.4 自动黑名单

当检测到可疑活动时，设备立即被添加到 Redis 和数据库黑名单中：

```typescript
private async autoBlockDevice(deviceId: string, reason: string) {
  await this.prismaService.deviceBlacklist.create({ data: { deviceId, reason } })
    .catch(e => this.logger.error('黑名单数据库插入失败', e));
  await this.redisService.sadd('security:device:blacklist', deviceId);
}
```

---

## 4. OTP 限流守卫 — 速率限制

[`OtpThrottlerGuard`](apps/api/src/common/guards/otp-throttler.guard.ts) 扩展了 NestJS 内置的 `ThrottlerGuard`，为 OTP 端点添加了**复合限流键**。

### 4.1 复合键策略

```typescript
@Injectable()
export class OtpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): string | string[] {
    const ip = normalizeIp(req.ip);
    const path = req.route?.path || req.url;

    if (path.includes('/otp/')) {
      // OTP 端点：按 IP + 手机号后缀限速
      const phoneTail = req.body?.phone?.slice(-4);
      return phoneTail
        ? [`ip:${ip}`, `p:${phoneTail}_ip:${ip}`]
        : [`ip:${ip}`];
    }

    // 非 OTP 端点：标准基于 IP 的限速
    return `ip:${ip}`;
  }
}
```

**为什么使用复合键？**
- **IP + 手机号尾部** — 防止攻击者通过轮换 IP 来暴力破解特定手机号码的 OTP
- **仅 IP**（非 OTP）— 对于常规速率限制简单有效
- **数组返回** — 所有条件必须同时满足（AND 逻辑），增加绕过难度

### 4.2 规范化 IP

```typescript
function normalizeIp(raw?: string | null): string {
  if (!raw) return 'unknown';
  if (raw.includes('::ffff:')) return raw.split('::ffff:').pop()!;  // IPv4 映射的 IPv6
  if (raw === '::1') return '127.0.0.1';  // 本地回环
  return raw;
}
```

处理代理后面常见的 IPv4 映射 IPv6 地址，并将本地回环地址规范化。

---

## 5. CSRF 防护 — 中间件层

[`CsrfMiddleware`](apps/api/src/common/middleware/csrf.middleware.ts) 通过**智能绕过规则**防范跨站请求伪造。

### 5.1 JWT 检测 — 跳过 CSRF

```typescript
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: RequestWithSession, res: Response, next: NextFunction) {
    // 如果使用 JWT Bearer Token，完全跳过 CSRF
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) return next();

    // 基于 Session 的认证需要 CSRF Token 验证
    const csrfCookie = req.cookies?.['csrf-token'];
    const csrfHeader = req.headers['x-csrf-token'];

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        throw new ForbiddenException('Invalid CSRF token');
      }
    }

    next();
  }
}
```

**关键洞察：** 使用 JWT Bearer Token 的移动应用和 SPA 不需要 CSRF 保护（没有可供劫持的 Cookie）。中间件自动检测 JWT 使用情况并跳过验证。

### 5.2 基于路径的绕过

```typescript
const BYPASS_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/webhook',
  '/api/upload',
];
```

认证端点和 Webhook 不需要 CSRF Token（它们要么不使用 Cookie，要么是服务端对服务端的通信）。

### 5.3 CSRF Token 生成

一个独立的 [`CsrfTokenMiddleware`](apps/api/src/common/middleware/csrf.middleware.ts#L102) 为基于 Session 认证的用户生成 Token：

```typescript
@Injectable()
export class CsrfTokenMiddleware implements NestMiddleware {
  use(req: RequestWithSession, res: Response, next: NextFunction) {
    if (!req.cookies?.['csrf-token']) {
      const token = this.generateCsrfToken();
      res.cookie('csrf-token', token, {
        httpOnly: false,   // JavaScript 可访问
        secure: true,
        sameSite: 'strict',
        path: '/',
      });
    }
    next();
  }

  private generateCsrfToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
```

**`httpOnly: false`** — Token 必须能被客户端 JavaScript 读取，以便作为自定义头部发送。

---

## 6. reCAPTCHA 集成 — 机器人检测

[`RecaptchaService`](apps/api/src/common/recaptcha/recaptcha.service.ts) 为面向公共的表单（登录、注册、评论）集成了 Google reCAPTCHA v3。

### 6.1 验证流程

```typescript
@Injectable()
export class RecaptchaService {
  private readonly threshold: number = 0.5;

  async verifyToken(
    token: string,
    expectedAction?: string,
  ): Promise<RecaptchaResult> {
    try {
      const response = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        null,
        { params: { secret: this.configService.get('RECAPTCHA_SECRET_KEY'), response: token } }
      );

      const { success, score, action } = response.data;

      if (!success) return { passed: false, reason: '验证失败' };
      if (expectedAction && action !== expectedAction) {
        return { passed: false, reason: '操作不匹配' };
      }
      if (score < this.threshold) {
        return { passed: false, reason: `分数过低: ${score}` };
      }

      return { passed: true, score };
    } catch {
      // 下游降级 — Google API 失败时放行
      return { passed: true, score: 0.5 };
    }
  }
}
```

### 6.2 分数解读

| 分数 | 含义 | 操作 |
|-------|---------|--------|
| ≥ 0.5 | 可能是人类 | 放行 |
| 0.3 - 0.5 | 可疑 | 标记审查（`needsReview`） |
| < 0.3 | 可能是机器人 | 拦截（`isBot`） |

### 6.3 下游降级

`catch` 块是故意设计的——如果 Google 的 API 不可用，服务会以中性分数**放行请求**，而不是阻塞所有流量。这防止了 Google 服务故障导致应用瘫痪。

---

## 7. 对比：API 安全栈 vs Admin-Next 安全

| 安全层 | API（NestJS） | Admin-Next（Next.js） |
|---------------|--------------|---------------------|
| **身份验证** | `JwtAuthGuard`（Passport） | `middleware.ts` JWT 解码 + Cookie |
| **授权** | `PermissionsGuard` + `@RequirePermission()` | 路由 `roles` 配置在 [`routes/index.ts`](apps/admin-next/src/routes/index.ts) |
| **CSRF** | 带 JWT 绕过的中间件 | 不适用（Cookie + Bearer 混合） |
| **速率限制** | `OtpThrottlerGuard`（复合键） | Axios 拦截器重试 |
| **设备安全** | `DeviceSecurityGuard` + Redis 缓存 | [`security-utils.ts`](apps/admin-next/src/lib/security-utils.ts)（输入清理） |
| **reCAPTCHA** | `RecaptchaService`（Google v3） | 不适用（仅管理员） |
| **XSS** | `XssSanitizePipe`（DOMPurify + JSDOM） | `sanitizeInput()`（客户端） |
| **CORS** | NestJS CORS 中间件 | 不适用（服务端 API 调用） |

API 实现了 **6 层以上的纵深防御**，而 admin-next 更专注于输入清理和基于路由的访问控制，因为它是一个内部管理工具。

---

## 8. 关键要点

1. **Redis 优先，数据库其次** — 设备安全服务使用 5 分钟活动缓存，使 95% 以上的请求跳过昂贵的数据库操作，同时维护双层黑名单保护（Redis + 数据库）以确保数据安全。

2. **复合限流键** — OTP 限流使用 IP + 手机号后缀作为键，防止攻击者通过轮换 IP 来暴力破解 OTP，同时保持非 OTP 限流的简洁性。

3. **智能 CSRF 绕过** — JWT Bearer 认证自动跳过 CSRF 验证（没有可劫持的 Cookie），而基于 Session 的认证则获得完整的双重提交 Cookie 保护。

4. **全方位的优雅降级** — reCAPTCHA 在 Google API 故障时放行请求。未知设备被记录但允许进行非敏感操作。缺失安全头部不会导致服务器崩溃。

5. **24 小时提现冻结** — 新设备必须等待 24 小时才能提现，防止账户接管攻击立即清空钱包。

6. **设备农场的自动黑名单** — 如果一台设备关联了 3 个以上的账户，它会被自动添加到 Redis 和数据库黑名单中，防止自动化创建账户。
