# API 安全与数据处理管道 — NestJS Guards / Interceptors / Pipes / Filters 四层架构

## 一、概述

在 JoyMini API 中，我们基于 NestJS 的 **四层管道架构**（Guard → Interceptor → Pipe → Filter）构建了一套完整的请求处理链路。每个 HTTP 请求在到达 Controller 之前和返回 Response 之后，都会依次经过这四层处理，实现认证、授权、数据清洗、异常兜底等横切关注点。

```
Request
  │
  ▼
┌──────────────┐
│  Middleware   │  ← CSRF / RequestId / 请求级前置处理
├──────────────┤
│   Guards     │  ← JwtAuthGuard → PermissionsGuard → DeviceSecurityGuard
├──────────────┤
│ Interceptors │  ← ResponseWrapInterceptor / ServerTimeInterceptor / PublicCacheInterceptor
├──────────────┤
│    Pipes     │  ← XssSanitizePipe / ValidationPipe (class-validator)
├──────────────┤
│  Controller  │  ← 业务逻辑处理
├──────────────┤
│    Filter    │  ← AllExceptionsFilter (全局异常兜底)
  │
  ▼
Response
```

本文档深入剖析每层的实现细节，以及它们之间的协作机制。

---

## 二、Guards（守卫层）— 认证与授权

### 2.1 JwtAuthGuard — 基于 Passport 的 JWT 认证

```typescript
// apps/api/src/common/jwt/jwt.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

这一层极简——直接继承 Passport 的 `AuthGuard('jwt')`。真正的认证逻辑在 [`jwt.strategy.ts`](apps/api/src/common/jwt/jwt.strategy.ts) 中，负责：

1. 从 `Authorization: Bearer <token>` 中提取 JWT
2. 验证 JWT 签名（使用 `JWT_SECRET` 或 `ADMIN_JWT_SECRET`）
3. 解析 Payload，将 `{ sub, role, ... }` 挂载到 `request.user`

> 💡 **设计亮点**：API 支持两种 JWT Secret（client / admin），WebSocket Gateway 中会依次尝试两种 Secret 验证。

### 2.2 PermissionsGuard — 基于角色的细粒度权限

```typescript
// apps/api/src/common/guards/permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. 获取路由上的 @RequirePermission 装饰器值
    const requiredPermission = this.reflector.get<string>(
      PERMISSION_KEY, context.getHandler(),
    );

    // 2. 如果没加装饰器 → 放行
    if (!requiredPermission) return true;

    // 3. 获取用户角色
    const request = context.switchToHttp().getRequest();
    const role = request.user?.role;

    // 4. 超级管理员跳过检查
    if (role === Role.SUPER_ADMIN) return true;

    // 5. 查权限配置表
    const userPermissions = RolePermissions[role] ?? [];
    const hasPermission = userPermissions.includes(requiredPermission);
    if (!hasPermission) {
      throw new ForbiddenException(`no permission: ${requiredPermission}`);
    }
    return true;
  }
}
```

**关键设计**：

- 权限字符串格式：`${module}:${action}`（如 `marketing:create`、`user_management:view_user`）
- 权限定义位于 `@lucky/shared` 包的 `RolePermissions` 常量中
- 使用装饰器 [`@RequirePermission`](apps/api/src/common/decorators/require-permission.decorator.ts) 声明式绑定：

```typescript
@RequirePermission(OpModule.USER, OpAction.USER.VIEW)
@Get()
async listUsers() { ... }
```

### 2.3 DeviceSecurityGuard — 设备风控守卫

```typescript
// apps/api/src/common/guards/device-security.guard.ts
@Injectable()
export class DeviceSecurityGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const level = this.reflector.get<DeviceSecurityLevel>(
      DEVICE_SECURITY_KEY, context.getHandler(),
    );
    if (!level) return true;

    const request = context.switchToHttp().getRequest();
    const userId = extractUserId(request);
    const deviceInfo = {
      ip: getRealIp(request),
      deviceId: getDeviceId(request),
      deviceModel: getDeviceModel(request),
      userAgent: getUserAgent(request),
    };

    // 基础检查：记录设备指纹，黑名单拦截
    await this.deviceSecurityService.validateAndLogDevice(userId, deviceInfo);

    // 严格模式：提现风控（24h 新设备冻结期）
    if (level === DeviceSecurityLevel.STRICT_CHECK) {
      await this.deviceSecurityService.checkWithdrawEligibility(
        userId, deviceInfo.deviceId,
      );
    }
    return true;
  }
}
```

通过 `@DeviceSecurity(DeviceSecurityLevel.STRICT_CHECK)` 装饰器标记需要风控的路由。

### 2.4 OtpThrottlerGuard — OTP 限流守卫

```typescript
// apps/api/src/common/guards/otp-throttler.guard.ts
export class OtpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): string | string[] {
    const ip = normalizeIp(xffStr) ?? normalizeIp(r.ip) ?? 'ip:unknown';
    const path = r.originalUrl || r.url;

    if (/\/(otp\/|auth\/login\/otp)/.test(path)) {
      const phoneTail = String(r.body?.phone ?? '').slice(-6);
      return [`ip:${ip}`, `p:${phoneTail}`]; // 双重限流键
    }
    return `ip:${ip}`;
  }
}
```

**组合键限流**：对 OTP 接口同时使用 IP + 手机号尾号作为限流键，防止单一维度被绕过。

---

## 三、Pipes（管道层）— 数据清洗与验证

### 3.1 XssSanitizePipe — XSS 内容净化

```typescript
// apps/api/src/common/pipes/xss-sanitize.pipe.ts
@Injectable()
export class XssSanitizePipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    return this.sanitizeValue(value);
  }

  private sanitizeValue(value: any): any {
    if (typeof value === 'string') {
      return DOMPurify.sanitize(value, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br', 'p', 'ul', 'ol', 'li'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button'],
        FORBID_ATTR: ['onload', 'onerror', 'onclick', 'style', 'class'],
      }).trim();
    }
    if (Array.isArray(value)) return value.map(v => this.sanitizeValue(v));
    if (value && typeof value === 'object') {
      const sanitized: Record<string, any> = {};
      for (const key in value) sanitized[key] = this.sanitizeValue(value[key]);
      return sanitized;
    }
    return value;
  }
}
```

**技术选型**：使用 `DOMPurify` + `jsdom`（服务端 DOM 模拟），递归净化所有字符串字段。白名单只允许基本的格式标签，禁止所有事件处理器和脚本标签。

### 3.2 ValidationPipe — DTO 验证

NestJS 内置的 `ValidationPipe` 结合 `class-validator` 装饰器，对所有 DTO 进行声明式验证：

```typescript
// apps/api/src/client/orders/dto/checkout.dto.ts
export class CheckoutDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  couponId?: string;
}
```

验证失败时自动返回 `400` + `PARAMETER_ERROR` 错误码。

---

## 四、Interceptors（拦截器层）— 响应包装与横切逻辑

### 4.1 ResponseWrapInterceptor — 统一响应格式

```typescript
// apps/api/src/common/interceptors/response-wrap.interceptor.ts
@Injectable()
export class ResponseWrapInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 检查 @SkipWrap 装饰器
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_WRAP, [
      context.getHandler(), context.getClass(),
    ]);
    if (skip) return next.handle(); // 直接跳过

    // 生成 trace id
    const req = context.switchToHttp().getRequest();
    const reqId = req?.id ?? req?.headers?.['x-request-id'];
    const tid = reqId ? String(reqId) : randomUUID().replace(/-/g, '');

    return next.handle().pipe(
      map((data) => {
        // 流式文件 → 直接返回
        if (data instanceof StreamableFile) return data;
        // Buffer → 直接返回
        if (Buffer.isBuffer(data)) return data;
        // 已包装 → 防止双重包装
        if (data && typeof data === 'object' && 'code' in data && 'data' in data) return data;

        return { code: 10000, message: 'success', tid, data: data ?? null };
      }),
    );
  }
}
```

**统一格式**：
```json
{ "code": 10000, "message": "success", "tid": "abc123", "data": { ... } }
```

**三个跳过规则**：
1. `@SkipWrap()` 装饰器 — 手动控制不包装
2. `StreamableFile` / `Buffer` — 文件下载场景
3. 已含 `code` + `data` 字段的对象 — 防止双重包装

### 4.2 ServerTimeInterceptor — 服务端时间戳

```typescript
// apps/api/src/common/interceptors/server-time.interceptor.ts
@Injectable()
export class ServerTimeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        if (!response.headersSent) {
          response.setHeader('x-server-time', Date.now().toString());
        }
      }),
    );
  }
}
```

在响应头中注入 `x-server-time`，Flutter 客户端可用此校准本地时钟。

### 4.3 PublicCacheInterceptor — 公共缓存拦截器

```typescript
// apps/api/src/common/cache/public-cache.interceptor.ts
export class PublicCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();

    // 仅缓存 GET
    if (req.method !== 'GET') return undefined;

    // 调试绕过
    if (req.query?.__nocache === '1') return undefined;

    // 带鉴权头 → 不缓存
    if (req.headers?.authorization) return undefined;

    // 维度隔离：locale + platform
    const locale = normalizeHeader(req.headers['x-locale'], 'en');
    const platform = normalizeHeader(req.headers['x-platform'], 'h5');

    // 缓存键格式
    const base = `v1|${method}|${path}?${queryStr}|${locale}|${platform}`;
    if (base.length > 512) return `v1|${path}|${locale}|${platform}|h:${sha1(base)}`;
    return base;
  }
}
```

**缓存键隔离维度**：路径 + Query + Locale（多语言）+ Platform（H5/App），确保多语言多端不会串缓存。

---

## 五、Filters（过滤器层）— 全局异常兜底

### 5.1 AllExceptionsFilter — 统一异常处理

```typescript
// apps/api/src/common/filters/all-exceptions.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // 生成 trace id
    const tid = reqId ?? randomUUID().replaceAll('-', '');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = CODE.SYSTEM_ERROR;
    let key: CodeKey = 'SYSTEM_ERROR';
    let message = MESSAGE[key];
    let details: unknown;

    // 分支 1: BizException（业务异常）
    if (exception instanceof BizException) {
      status = exception.getStatus?.() ?? 400;
      code = exception.code;
      key = exception.key;
      message = MESSAGE[key];
      details = exception.extra;
    }
    // 分支 2: HttpException（NestJS 内置 + class-validator）
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      // ... 提取 message，处理验证错误数组 ...
    }
    // 分支 3: 未知异常
    else {
      // 记录完整错误日志
    }

    const payload = { code, message, tid, data: null, details };
    if (!res.headersSent) {
      httpAdapter.reply(res, payload, status);
    }
  }
}
```

**三层异常分类**：
| 异常类型 | 代表场景 | HTTP Status | 错误码 |
|---------|---------|-------------|--------|
| `BizException` | 余额不足、订单不存在 | 400 | 自定义业务码 |
| `HttpException` | class-validator 校验失败 | 400 | `PARAMETER_ERROR` |
| 未知异常 | 未捕获的系统错误 | 500 | `SYSTEM_ERROR` |

### 5.2 BizException — 业务异常类

```typescript
// apps/api/src/common/exceptions/biz.exception.ts
export class BizException extends HttpException {
  constructor(
    public readonly code: number,
    public readonly key: CodeKey,
    httpStatus = 400,
    public readonly extra?: unknown,
  ) {
    super(key, httpStatus);
  }
}

export const throwBiz = (key: CodeKey, httpStatus = 400, extra?: unknown): never => {
  const code = CODE[key] as CodeValue;
  throw new BizException(code, key, httpStatus, extra);
};
```

**使用方式**：
```typescript
throwBiz('INSUFFICIENT_BALANCE', 400, { balance: 0, required: 100 });
// → { code: 40009, message: 'Insufficient Balance', tid: '...', data: null, details: { balance: 0, required: 100 } }
```

---

## 六、错误码体系

错误码统一管理在 [`error-codes.gen.ts`](apps/api/src/common/error-codes.gen.ts)，自动从 Google Sheets 生成：

```typescript
export const CODE = {
  SUCCESS: 10000,
  SYSTEM_ERROR: 10001,
  PARAMETER_ERROR: 10002,
  OTP_EXPIRED: 11002,
  TOO_MANY_OTP_ATTEMPTS: 11004,
  INVALID_JWT_TOKEN: 20062,
  INSUFFICIENT_BALANCE: 40009,
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  DEVICE_BLACKLISTED: 40310,
  DEVICE_NOT_TRUSTED: 40320,
  DEVICE_WITHDRAW_LOCKED_TEMP: 40323,
  NOT_FOUND: 40400,
  TOO_MANY_REQUESTS: 42900,
  USER_NOT_FOUND: 92000,
} as const;
```

**错误码分段**：
| 区间 | 含义 |
|-----|------|
| 10000-19999 | 通用成功/系统错误 |
| 11000-11999 | OTP/认证相关 |
| 20000-29999 | JWT/Token 相关 |
| 40000-40999 | 业务逻辑错误 |
| 40100-40199 | 未授权 |
| 40300-40399 | 禁止访问/风控 |
| 40400-40499 | 资源不存在 |
| 42900-42999 | 限流 |
| 92000-92999 | 用户相关 |

---

## 七、四层协作流程（完整示例）

以 `POST /api/v1/admin/orders` 创建订单为例：

```
Step 1: Middleware
  ├─ RequestIdMiddleware → 注入 x-request-id header
  └─ CsrfMiddleware → 检查 CSRF Token（JWT 请求跳过）

Step 2: Guards
  ├─ JwtAuthGuard → 验证 JWT Token，挂载 user 到 request
  ├─ PermissionsGuard → 检查 order:create 权限
  └─ DeviceSecurityGuard → 风控检查（如提现才启用）

Step 3: Interceptors
  ├─ ResponseWrapInterceptor → 等待 Controller 返回后包装
  ├─ ServerTimeInterceptor → 注入 x-server-time header
  └─ PublicCacheInterceptor → POST 请求跳过

Step 4: Pipes
  ├─ XssSanitizePipe → 净化所有字符串参数
  └─ ValidationPipe → DTO 字段验证

Step 5: Controller
  └─ createOrder() → 执行业务逻辑

Step 6: Filter（如果异常）
  └─ AllExceptionsFilter → 统一异常格式返回
```

---

## 八、与前端对比

| 维度 | API (NestJS) | admin-next (Next.js) |
|------|-------------|---------------------|
| 认证 | `JwtAuthGuard` + Passport Strategy | Edge Middleware `decodeJwtPayload` |
| 授权 | `PermissionsGuard` + `@RequirePermission` | `RolesGuard` |
| 数据验证 | `ValidationPipe` + `class-validator` DTO | Zod schemas (`security-utils.ts`) |
| XSS 防护 | `XssSanitizePipe` (DOMPurify 服务端) | `sanitizeInput` / `escapeHtml` |
| 响应格式 | `ResponseWrapInterceptor` → `{code, message, data, tid}` | `ApiResponse<T>` interceptor |
| 错误处理 | `AllExceptionsFilter` + `BizException` | `handleBizError` + `handleHttpError` |
| 限流 | `OtpThrottlerGuard` (ThrottlerModule) | — |
| CSRF | `CsrfMiddleware` + `CsrfTokenMiddleware` | — |

---

## 九、最佳实践

1. **守卫层顺序固定**：`JwtAuthGuard` → `PermissionsGuard` → `DeviceSecurityGuard`，因为后者依赖前者的 `request.user`
2. **`@SkipWrap()` 用于流式响应**：文件下载、图片验证码等场景必须跳过包装
3. **错误码使用 Key 而非 Magic Number**：`throwBiz('INSUFFICIENT_BALANCE')` 比 `throw new BizException(40009, ...)` 更可读
4. **Filters 中检查 `headersSent`**：防止业务代码已发送响应后，异常过滤器再次发送
5. **XSS Pipe 在 Validation Pipe 之前**：先净化再验证，避免恶意输入污染验证逻辑
