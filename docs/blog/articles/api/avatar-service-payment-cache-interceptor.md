# 头像服务、支付集成与公共缓存拦截器

> **Audience:** 后端工程师，全栈开发者  
> **Tag:** `#NestJS` `#Payment` `#Xendit` `#Avatar` `#Caching` `#Sharp`  
> **Difficulty:** 中级  
> **Estimate:** 约 20 分钟阅读

---

## 1. 概述

本文涵盖了三个处理不同关注点的后端服务——面向用户的图像处理、金融交易和 API 响应缓存：

| 组件 | 文件 | 角色 |
|-----------|------|------|
| **AvatarService** | [`avatar.service.ts`](apps/api/src/common/avatar/avatar.service.ts) | 从多张图片生成合成头像 |
| **AvatarProcessor** | [`avatar.processor.ts`](apps/api/src/common/avatar/avatar.processor.ts) | 用于异步头像生成的 BullMQ 工作者 |
| **PaymentService** | [`payment.service.ts`](apps/api/src/common/payment/payment.service.ts) | Xendit 支付网关（Invoice + Disbursement） |
| **PublicCacheInterceptor** | [`public-cache.interceptor.ts`](apps/api/src/common/cache/public-cache.interceptor.ts) | 公共 GET 端点的自定义缓存键 |

这些组件展示了三种重要模式：**图像合成管道**、**第三方支付网关抽象**和**自定义缓存键生成**。

---

## 2. 头像服务 — 合成图像生成

### 2.1 问题

当用户加入群组（例如寻宝群或聊天会话）时，应用需要显示一个合成头像，展示最多 4 名成员的头像。与其让客户端下载 4 张独立图片并在本地合成（慢、数据量大），我们在服务端生成单一的合成图像。

### 2.2 实现

[`AvatarService`](apps/api/src/common/avatar/avatar.service.ts:7) 使用 [`sharp`](https://sharp.pixelplumbing.com/) 库来下载、调整大小并将多张图片拼贴到一张图中：

```typescript
// avatar.service.ts
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  async generateCompositeAvatar(
    imageUrls: string[],
    outputKey: string,
  ): Promise<void> {
    const validUrls = imageUrls.filter(Boolean).slice(0, 4);
    if (validUrls.length === 0) return;

    // Step 1: 并行下载所有图片
    const responses = await Promise.all(
      validUrls.map((url) => fetch(url)),
    );

    const buffers = await Promise.all(
      responses
        .filter((r) => r.ok)
        .map((r) => r.arrayBuffer().then((ab) => Buffer.from(ab))),
    );

    // Step 2: 将每张图调整为正方形，并以 2×2 网格拼贴
    const size = 200;        // 每个拼贴：200×200
    const gap = 4;           // 拼贴之间的 4px 间距
    const cols = 2;
    const rows = Math.ceil(buffers.length / cols);

    const compositeInputs = await Promise.all(
      buffers.map(async (buf, index) => {
        const resized = await sharp(buf)
          .resize(size, size, { fit: 'cover' })
          .toBuffer();

        const col = index % cols;
        const row = Math.floor(index / cols);
        return {
          input: resized,
          top: row * (size + gap),
          left: col * (size + gap),
        };
      }),
    );

    // Step 3: 合成到透明画布上
    const canvasWidth = cols * size + (cols - 1) * gap;
    const canvasHeight = rows * size + (rows - 1) * gap;

    await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(compositeInputs)
      .png()
      .toFile(`/tmp/avatars/${outputKey}.png`);
  }
}
```

### 2.3 网格布局逻辑

| 成员数量 | 网格 | 尺寸 |
|-------------|------|-----------|
| 1 | 单块 | `200×200` |
| 2 | 1 行 × 2 列 | `408×200` |
| 3 | 2 行 × 2 列（右下角空置） | `408×408` |
| 4 | 2 行 × 2 列（完整） | `408×408` |

`slice(0, 4)` 上限防止了超过 4 个成员时出现不规则的布局。

### 2.4 异步头像处理器

头像生成无需阻塞 API 响应，而是作为 **BullMQ 工作者**运行——[`AvatarProcessor`](apps/api/src/common/avatar/avatar.processor.ts:13)：

```typescript
// avatar.processor.ts
@Processor(AVATAR_QUEUE_NAME)
export class AvatarProcessor extends WorkerHost {
  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'treasure_group':
        return this.handleTreasureGroup(job);
      case 'chat_group':
        return this.handleChatGroup(job);
    }
  }

  private async handleTreasureGroup(job: Job<{ groupId: string }>) {
    // 获取群组成员，收集他们的头像 URL
    const members = await this.prisma.treasureGroupMember.findMany({
      where: { groupId: job.data.groupId },
      include: { user: { select: { avatarUrl: true } } },
    });
    const urls = members.map((m) => m.user.avatarUrl);

    // 生成合成头像并上传到 S3
    const outputKey = `group_${job.data.groupId}`;
    await this.avatarService.generateCompositeAvatar(urls, outputKey);
    await this.uploadToS3(outputKey);

    // 用新的头像 URL 更新群组
    await this.prisma.treasureGroup.update({
      where: { id: job.data.groupId },
      data: { avatarUrl: `https://cdn.example.com/avatars/${outputKey}.png` },
    });
  }
}
```

**关键特性：**

| 特性 | 实现 |
|---------|---------------|
| **任务去重** | `jobId: 'avatar_{groupId}'` 防止重复生成 |
| **并行下载** | `Promise.all()` 并发获取所有成员头像 |
| **回退机制** | 过滤掉 falsy 的 URL；如果所有成员都没有头像，则不生成合成图 |
| **错误隔离** | 工作者捕获每个任务的失败；一张坏图不会让队列崩溃 |

### 2.5 触发头像生成

[`GroupService`](./group-service-redis-lock-settlement.md) 在群组创建后通过队列触发头像生成：

```typescript
private triggerAvatarUpdate(groupId: string) {
  this.avatarQueue.add('treasure_group', { groupId }, {
    jobId: `avatar_${groupId}`,  // 去重键
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  }).catch((err) => this.logger.error('Failed to queue avatar job', err));
}
```

---

## 3. 支付服务 — Xendit 网关

### 3.1 问题

应用需要处理：

1. **充值** — 用户通过 Xendit Invoice 为钱包充值
2. **提现** — 管理员通过 Xendit Disbursement/Payout 发放奖金
3. **回调验证** — 验证来自 Xendit 的 Webhook 回调

Xendit 是东南亚（菲律宾、印度尼西亚、马来西亚）领先的支付网关，支持 GCash、PayMaya、银行转账和线下渠道。

### 3.2 实现

[`PaymentService`](apps/api/src/common/payment/payment.service.ts:13) 抽象了 Xendit 的 REST API：

```typescript
// payment.service.ts
@Injectable()
export class PaymentService {
  private readonly xendit: XenditClient;
  private readonly callbackToken: string;

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.getOrThrow('XENDIT_SECRET_KEY');
    this.callbackToken = this.configService.getOrThrow('XENDIT_CALLBACK_TOKEN');

    this.xendit = new XenditClient({
      secretKey,
      xenditURL: 'https://api.xendit.co',
    });
  }
```

### 3.3 创建充值 Invoice

当用户充值钱包时，API 创建一个 Xendit Invoice：

```typescript
async createRechargeLink(
  userId: string,
  amount: number,
  externalId: string,
): Promise<{ invoiceUrl: string; invoiceId: string }> {
  const invoice = await this.xendit.Invoice.create({
    externalId,
    amount,
    description: `Wallet recharge for user ${userId}`,
    currency: 'PHP',
    payerEmail: `${userId}@lucky-app.com`,
    customer: { userId },
    successRedirectUrl: this.configService.get('XENDIT_SUCCESS_URL'),
    failureRedirectUrl: this.configService.get('XENDIT_FAILURE_URL'),
    invoiceDuration: 86400, // 24 小时过期
  });

  return {
    invoiceUrl: invoice.invoiceUrl,
    invoiceId: invoice.id,
  };
}
```

**关键设计决策：**

| 决策 | 理由 |
|----------|-----------|
| `externalId` 是服务端生成的 UUID | 防止重复发票（幂等性） |
| `invoiceDuration: 86400` | 24 小时过期；过期发票自动作废 |
| `payerEmail` 使用 `userId` 前缀 | 允许将 Webhook 回调与内部用户匹配，同时不暴露 PII |

### 3.4 创建 Disbursement（付款）

当用户请求提现时，管理员触发付款：

```typescript
async createDisbursement(payload: {
  externalId: string;
  amount: number;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  description?: string;
}) {
  return this.xendit.Disbursement.create({
    externalId: payload.externalId,
    amount: payload.amount,
    bankCode: payload.bankCode,
    accountNumber: payload.accountNumber,
    accountHolderName: payload.accountHolderName,
    description: payload.description || 'Withdrawal',
    idempotencyKey: payload.externalId,  // 防止重复付款
  });
}
```

**幂等性**对于付款至关重要——没有它，网络重试可能导致资金被发送两次。`idempotencyKey` 参数确保重试同一请求不会创建重复的付款。

### 3.5 回调验证

Xendit 发送 Webhook 回调以通知应用支付状态变更。回调 Token 验证确保只有合法的 Xendit 请求被处理：

```typescript
verifyCallbackToken(token: string): boolean {
  return token === this.callbackToken;
}
```

在 Webhook 控制器中应用：

```typescript
@Post('xendit-callback')
async handleXenditCallback(
  @Headers('x-callback-token') token: string,
  @Body() callback: XenditCallback,
) {
  if (!this.paymentService.verifyCallbackToken(token)) {
    throw new UnauthorizedException('Invalid callback token');
  }

  switch (callback.event) {
    case 'invoice.paid':
      return this.walletService.creditByInvoice(callback.data);
    case 'disbursement.completed':
      return this.walletService.confirmWithdrawal(callback.data);
  }
}
```

### 3.6 查询方法

```typescript
async getInvoiceByExternalId(externalId: string) {
  try {
    const invoices = await this.xendit.Invoice.getByExternalId(externalId);
    return invoices[0] ?? null;
  } catch {
    return null;
  }
}

async getDisbursementByExternalId(externalId: string) {
  try {
    return await this.xendit.Disbursement.getByExternalId(externalId);
  } catch {
    return null;
  }
}
```

### 3.7 错误处理

```typescript
private handleXenditError(error: unknown, context: string) {
  if (error instanceof XenditError) {
    this.logger.error(`Xendit ${context} 失败`, {
      errorCode: error.errorCode,
      message: error.message,
      payload: error.payload,  // Xendit 的响应体
    });
    throw new BadGatewayException(`Payment provider error: ${error.message}`);
  }
  throw error;
}
```

`XenditError` 中的 `payload` 字段特别有价值——它包含 Xendit API 的原始响应体，其中包括验证错误和拒绝原因。

---

## 4. 公共缓存拦截器

### 4.1 问题

NestJS 内置的 `CacheInterceptor` 使用完整的请求 URL（包括查询参数）作为缓存键。对于有大量可选查询参数的端点，这会产生过多的缓存条目。例如：

```
GET /api/articles?locale=en&page=1&pageSize=10
GET /api/articles?locale=en&page=1&pageSize=10&t=1234567890  // 由于缓存破坏器导致缓存未命中
```

我们需要一个更智能的缓存键，能够：

1. 规范化查询参数顺序（按字母顺序）
2. 排除缓存破坏参数（例如 `t`、`_`）
3. 包含相关头部，如 `Accept-Language`

### 4.2 实现

[`PublicCacheInterceptor`](apps/api/src/common/cache/public-cache.interceptor.ts:27) 继承 `CacheInterceptor` 并重写 `trackBy()`：

```typescript
// public-cache.interceptor.ts
function normalizeHeader(v: unknown, fallback: string): string {
  if (typeof v === 'string') return v.split(',')[0].trim().toLowerCase();
  return fallback;
}

function serializeQuery(q: Record<string, any> | undefined): string {
  if (!q) return '';
  return Object.keys(q)
    .filter((k) => k !== 't' && k !== '_' && k !== 'cachebuster')
    .sort()
    .map((k) => `${k}=${q[k]}`)
    .join('&');
}

@Injectable()
export class PublicCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest();
    const { httpAdapter } = this.httpAdapterRef;

    const method = httpAdapter.getRequestMethod(request);
    if (method !== 'GET') return undefined;  // 仅缓存 GET

    const url = httpAdapter.getRequestUrl(request);
    const query = serializeQuery(request.query);
    const locale = normalizeHeader(request.headers['accept-language'], 'en');

    // 缓存键：路径 + 排序后的查询（无缓存破坏器） + 语言
    return `${url}?${query}#locale=${locale}`;
  }
}
```

### 4.3 缓存键示例

| 请求 URL | 缓存键 |
|------------|-----------|
| `GET /api/articles?locale=en&page=1` | `/api/articles?locale=en&page=1#locale=en` |
| `GET /api/articles?locale=en&page=1&t=1234` | `/api/articles?locale=en&page=1#locale=en` |
| `GET /api/articles?page=1&locale=en` | `/api/articles?locale=en&page=1#locale=en` |
| `GET /api/banners`（无查询） | `/api/banners?#locale=en` |

**关键行为：**

- `t`、`_` 和 `cachebuster` 参数被剔除（防止分析/缓存破坏导致的缓存污染）
- 查询参数按字母顺序排序以规范化键
- 从 `Accept-Language` 头部提取语言信息，并作为片段附加
- 非 GET 方法完全绕过缓存

### 4.4 使用方法

```typescript
@Controller('articles')
export class ArticleController {
  @UseInterceptors(PublicCacheInterceptor)
  @Get()
  async list(@Query() dto: QueryArticleDto) { ... }
}
```

### 4.5 缓存失效

拦截器与 NestJS 的 `@CacheKey()` 和 `@CacheTTL()` 装饰器配合使用：

```typescript
@UseInterceptors(PublicCacheInterceptor)
@CacheKey('articles:featured')   // 覆盖自动生成的键
@CacheTTL(300)                    // 5 分钟
@Get('featured')
async getFeatured() { ... }
```

对于失效操作，注入 `CacheManager` 并手动清除键：

```typescript
await this.cacheManager.del('/api/articles?locale=en&page=1#locale=en');
await this.cacheManager.reset();  // 清除所有缓存（简单粗暴）
```

考虑使用 **缓存标签**（通过 `cache-manager` v5+ 配合 `keyv`）进行精准失效：

```
articles:list → /api/articles?locale=en&page=1#locale=en
articles:list → /api/articles?locale=en&page=2#locale=en
// 通过单个标签操作使所有文章列表失效
```

---

## 5. 横切关注点

### 5.1 头像生成触发

当群组创建或新成员加入时，头像更新流经以下链路：

```
GroupService.joinOrCreateGroup()
  → triggerAvatarUpdate(groupId)
    → AvatarQueue.add('treasure_group', { groupId })
      → AvatarProcessor.handleTreasureGroup()
        → AvatarService.generateCompositeAvatar()
          → 上传到 S3
          → 更新数据库中的 group.avatarUrl
```

这个异步管道确保 API 响应不会被图像处理阻塞。

### 5.2 支付 + 钱包集成

```
用户点击"充值"
  → POST /wallet/recharge
    → PaymentService.createRechargeLink()
      → 返回 Xendit 发票 URL
      → 用户被重定向到 Xendit 结账

Xendit 发送回调
  → POST /wallet/xendit-callback
    → PaymentService.verifyCallbackToken()
    → WalletService.creditByInvoice()
      → 在数据库事务中更新用户余额
```

### 5.3 缓存公共数据

公共端点（文章、横幅、分类）使用 `PublicCacheInterceptor` 来减少数据库负载：

```
缓存未命中 → 查询数据库 → 存入缓存 → 返回响应
缓存命中  → 返回缓存的响应（无需查询数据库）
```

---

## 6. 测试策略

### 6.1 头像服务

```typescript
describe('AvatarService', () => {
  it('should generate composite for 2 images', async () => {
    const url1 = 'https://example.com/avatar1.png';
    const url2 = 'https://example.com/avatar2.png';
    await service.generateCompositeAvatar([url1, url2], 'test_group');
    // 验证输出文件是否存在
    expect(fs.existsSync('/tmp/avatars/test_group.png')).toBe(true);
  });

  it('should handle empty URL list gracefully', async () => {
    await expect(service.generateCompositeAvatar([], 'empty_group'))
      .resolves.not.toThrow();
  });
});
```

### 6.2 支付服务

```typescript
describe('PaymentService', () => {
  it('should create Xendit invoice', async () => {
    const result = await service.createRechargeLink('user1', 100, 'txn-001');
    expect(result.invoiceUrl).toContain('xendit.co');
    expect(result.invoiceId).toBeDefined();
  });

  it('should verify callback token', () => {
    expect(service.verifyCallbackToken('correct-token')).toBe(true);
    expect(service.verifyCallbackToken('wrong-token')).toBe(false);
  });
});
```

### 6.3 缓存拦截器

```typescript
describe('PublicCacheInterceptor', () => {
  it('should normalize query order', () => {
    const key1 = interceptor['trackBy'](mockContext('GET', '/articles?page=1&locale=en'));
    const key2 = interceptor['trackBy'](mockContext('GET', '/articles?locale=en&page=1'));
    expect(key1).toBe(key2);
  });

  it('should strip cachebuster params', () => {
    const key = interceptor['trackBy'](mockContext('GET', '/articles?t=1234&page=1'));
    expect(key).not.toContain('t=');
  });

  it('should skip non-GET methods', () => {
    const key = interceptor['trackBy'](mockContext('POST', '/articles'));
    expect(key).toBeUndefined();
  });
});
```

---

## 7. 生产环境检查清单

- [ ] **AvatarService** — 确保 `/tmp/avatars/` 目录存在且可写；或使用内存缓冲区 + S3 上传来避免临时文件
- [ ] **AvatarProcessor** — 配置 `concurrency: 2` 以避免 Sharp 并行处理过载
- [ ] **PaymentService** — 将 `XENDIT_SECRET_KEY` 和 `XENDIT_CALLBACK_TOKEN` 存储在环境变量/密钥管理器中，绝不硬编码在代码中
- [ ] **Webhook 安全** — Xendit 回调端点应仅使用 HTTPS，并在每次请求时验证 `x-callback-token`
- [ ] **缓存失效** — 当文章/横幅更新时，使相应的缓存键失效；考虑使用缓存标签
- [ ] **缓存 TTL** — 按端点调优 `@CacheTTL()`：静态数据（分类）可设为 10+ 分钟，动态数据（文章列表）设为 1-5 分钟
- [ ] **Xendit 测试模式** — 开发时使用 Xendit 的测试 API 密钥；使用 [Xendit Webhook 模拟器](https://dashboard.xendit.co/settings/webhooks) 测试回调
- [ ] **幂等性** — 在 `external_id` 上设置数据库级唯一约束，作为 Xendit 的 `idempotencyKey` 之外的纵深防御

---

## 8. 总结

这三个组件处理了不同但关键的需求：

- **AvatarService** + **AvatarProcessor** — 通过 Sharp 和 BullMQ 实现异步合成图像生成，具备任务去重和错误隔离
- **PaymentService** — Xendit 网关抽象，用于钱包充值（Invoice）和提现（Disbursement），具备回调 Token 验证和幂等性键
- **PublicCacheInterceptor** — 智能缓存键生成，规范化查询参数、剔除缓存破坏器，并为多语言端点包含语言头部

每个组件都遵循 NestJS 最佳实践：依赖注入、使用 BullMQ 进行异步处理，以及使用声明式装饰器处理横切关注点。
