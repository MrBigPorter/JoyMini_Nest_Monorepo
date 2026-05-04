---
title: '支付 Webhook & 回调处理深度解析 — 乐观锁、幂等性、原子化钱包操作'
description: '深入解析 PaymentWebhookController（单端点路由 + callback-token 鉴权）→ handleUniversalWebhook（充值/提现分流）→ handleInvoiceWebhook（updateMany 乐观锁 + creditCash）→ handlePayoutWebhook（原子 unfreeze + CRITICAL 降级）→ WalletService（ensureWallet / creditCash / freezeCash / unfreezeCash + beforeBalance/afterBalance 审计流水）'
slug: payment-webhook-callback-processing
tags: Payment, Webhook, Callback, Optimistic Lock, Idempotency, Wallet, Transaction, Prisma
---

# 支付 Webhook & 回调处理深度解析 — 乐观锁、幂等性、原子化钱包操作

## 1. 背景

本项目的支付体系通过 Xendit 网关处理充值和提现，而 **Webhook（回调）** 是整个支付链路中最关键的环节——它负责将网关侧的支付结果（成功/失败）同步回内部系统，并原子化地更新用户余额。

现有文章 [`payment-full-chain-xendit.md`](docs/blog/articles/admin-next/payment-full-chain-xendit.md) 从全链路视角讲解了 Flutter → API → Xendit → admin-next 财务审核的完整流程，而本篇将**聚焦于 Webhook 回调的内部实现**，深入剖析以下核心机制：

| 关注点 | 说明 |
|--------|------|
| **单端点路由** | 一个 `POST /payment/webhook/:channel` 入口，按 channel 分派 |
| **回调鉴权** | `x-callback-token` 头比对，防止伪造回调 |
| **通用路由器** | `handleUniversalWebhook` 通过 event/external_id 识别回调类型 |
| **充值乐观锁** | `updateMany` + `rechargeStatus=PENDING` 条件，防止重复入账 |
| **幂等性保障** | 已成功的订单直接返回，不重复处理 |
| **提现原子 unfreeze** | `frozenBalance: { gte }` 条件锁定，CRITICAL 降级兜底 |
| **钱包原子操作** | `ensureWallet` upsert + `creditCash`/`debitCash`/`freezeCash`/`unfreezeCash` |
| **审计流水** | 每次操作记录 `walletTransaction` 含 `beforeBalance`/`afterBalance` |
| **CSRF 绕过** | Webhook 路径免 CSRF 校验 |

---

## 2. Webhook 控制器架构

### 2.1 单端点设计

[`PaymentWebhookController`](apps/api/src/client/wallet/payment-webhook.controller.ts:17) 只暴露了一个端点：

```typescript
@Controller('payment')
export class PaymentWebhookController {
  constructor(
    private paymentService: PaymentService,
    private clientWalletService: ClientWalletService,
  ) {}

  @Post('webhook/:channel')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('channel') channel: string,
    @Body() payload: any,
    @Headers('x-callback-token') token: string,
  ) {
    if (channel === 'xendit') {
      if (!this.paymentService.verifyCallbackToken(token)) {
        throw new UnauthorizedException('Invalid callback token');
      }
      await this.clientWalletService.handleUniversalWebhook(payload);
    }
    // 未来可扩展其他渠道：channel === 'stripe', 'paypal'...
    return { status: 'OK' };
  }
}
```

关键设计决策：

| 决策 | 理由 |
|------|------|
| `@HttpCode(HttpStatus.OK)` | 支付网关要求回调总是返回 200（返回 4xx/5xx 会触发重试风暴） |
| `body: any` | 防止网关增加字段导致 DTO 校验失败（Xendit 偶尔会扩展 payload 结构） |
| `@Headers('x-callback-token')` | 从请求头提取回调令牌，比从 body 提取更安全 |
| `channel` 路由参数 | 预留多网关扩展能力（未来可加 Stripe、PayPal） |

### 2.2 回调令牌验证

[`PaymentService.verifyCallbackToken`](apps/api/src/common/payment/payment.service.ts:28) 的实现：

```typescript
verifyCallbackToken(token: string): boolean {
  const mySecretToken = this.configService.get<string>('XENDIT_CALLBACK_TOKEN');
  if (!mySecretToken) {
    this.logger.error('XENDIT_CALLBACK_TOKEN is not set in env');
    return false;
  }
  return token === mySecretToken;
}
```

通过比对 `XENDIT_CALLBACK_TOKEN` 环境变量与请求头中的 `x-callback-token` 来验证回调来源。这是一个**静态令牌校验**——虽然不如 HMAC 签名强，但配合 HTTPS 传输已满足支付网关场景的安全需求。

---

## 3. 通用 Webhook 路由器 — `handleUniversalWebhook`

[`handleUniversalWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:51) 是回调入口后的第一层路由，负责识别回调类型并分派到对应的处理方法：

```typescript
async handleUniversalWebhook(payload: unknown) {
  if (!isRecord(payload)) {
    this.logger.warn(`[Webhook Router] Unknown payload format, ignored.`);
    return { status: 'IGNORED', reason: 'Unknown Format' };
  }

  const event = typeof payload.event === 'string' ? payload.event : null;

  // 判定逻辑 1: 是否为代付/提现 (Payout)
  // 依据：Xendit Payout V2 API 回调一定包含 event 字段，且以 'payout.' 开头
  if (event && event.startsWith('payout.')) {
    return this.handlePayoutWebhook(payload.data);
  }

  // 判定逻辑 2: 依据 external_id
  // Xendit Invoice 回调包含 external_id，与内部订单号关联
  if (typeof payload.external_id === 'string') {
    return this.handleInvoiceWebhook(payload);
  }

  // 兜底逻辑：无法识别
  return { status: 'IGNORED', reason: 'Unknown Format' };
}
```

### 路由判定策略

| 优先级 | 判定条件 | 回调类型 | 数据源 |
|--------|----------|----------|--------|
| 1 | `event.startsWith('payout.')` | 提现回调 | `payload.data` |
| 2 | `payload.external_id` 为 string | 充值回调 | `payload` 本身 |
| 3 | 以上都不满足 | 忽略并记录 WARN 日志 | — |

这种**双路径判定**的设计原因：

- **Payout V2 API** 使用 `event` 字段标记回调类型（如 `payout.completed`、`payout.failed`），实际数据嵌套在 `data` 对象中
- **Invoice API** 使用 `external_id` 关联业务订单号，数据在顶层对象中

---

## 4. 充值回调 — `handleInvoiceWebhook`

### 4.1 数据提取与校验

[`handleInvoiceWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:85) 首先从 payload 提取关键字段并做基础校验：

```typescript
private async handleInvoiceWebhook(payload: unknown) {
  if (!isRecord(payload)) {
    return { status: 'IGNORED', message: 'Invalid Payload' };
  }

  const orderNo = typeof payload.external_id === 'string' ? payload.external_id : null;
  const status = typeof payload.status === 'string' ? payload.status : null;
  const amount = payload.amount;
  const transactionId = typeof payload.id === 'string' ? payload.id : null;

  if (!orderNo || !status || !transactionId) {
    return { status: 'IGNORED', message: 'Missing Required Fields' };
  }

  if (typeof amount !== 'number' && typeof amount !== 'string') {
    return { status: 'IGNORED', message: 'Invalid Amount' };
  }

  // 验证订单号前缀是否为充值（DEPOSIT）
  // 防止 payout 回调误入此分支
  if (!orderNo.startsWith(BizPrefix.DEPOSIT)) {
    return { status: 'IGNORED', message: 'Not a deposit order' };
  }

  // 仅处理成功状态：PAID / SETTLED / SUCCESS
  const validStatuses = ['PAID', 'SETTLED', 'SUCCESS'];
  if (!validStatuses.includes(status.toUpperCase())) {
    return { status: 'IGNORED', message: `Status ${status} not handled` };
  }
  // ...
}
```

### 4.2 乐观锁更新 — `updateMany`

核心的余额更新逻辑使用 **`updateMany` 乐观锁** 模式：

```typescript
return this.prismaService.$transaction(async (ctx) => {
  const amountDecimal = new Prisma.Decimal(amount);
  const invoicePayload = payload as InvoiceWebhookPayload;

  // 乐观锁更新：只有 PENDING + 金额匹配的订单才能被更新
  // 如果 count === 0，说明订单已被其他回调处理或金额不匹配
  const updateResult = await ctx.rechargeOrder.updateMany({
    where: {
      rechargeNo: orderNo,
      rechargeStatus: RECHARGE_STATUS.PENDING,          // 乐观锁条件
      rechargeAmount: amountDecimal,                     // 双重检查金额
    },
    data: {
      rechargeStatus: RECHARGE_STATUS.SUCCESS,
      thirdPartyOrderNo: invoicePayload.id,
      paidAt: new Date(),
      callbackData: invoicePayload,                      // 保存原始回调数据用于对账
    },
  });

  // 幂等性检查：如果 count === 0，说明订单已不是 PENDING 状态
  if (updateResult.count === 0) {
    const order = await ctx.rechargeOrder.findUnique({
      where: { rechargeNo: orderNo },
    });

    // 已成功处理过 → 幂等返回
    if (order?.rechargeStatus === RECHARGE_STATUS.SUCCESS) {
      return { status: 'SUCCESS', message: 'Idempotent: Already Processed' };
    }

    // 非幂等情况（金额不匹配/订单不存在/订单已取消）
    throw new InternalServerErrorException(
      `Failed to update recharge order ${orderNo}: count=0`,
    );
  }

  // 更新用户余额
  await this.walletService.creditCash(
    {
      userId: order.userId,
      amount: amountDecimal,
      related: { id: order.rechargeId, type: RelatedType.RECHARGE },
      desc: `Recharge via Xendit. Txn: ${invoicePayload.id}`,
    },
    ctx,  // 传入 transaction context，与订单更新在同一事务中
  );

  return { status: 'SUCCESS' };
});
```

### 4.3 乐观锁与幂等性设计分析

这个模式是金融系统中最关键的设计之一，需要仔细理解：

```
Q: Xendit 为什么可能重复发送回调？
A: 网络抖动、网关重试机制会导致同一支付结果被多次投递。
   如果没有幂等性，用户充值 100 元可能变成 200 元。

Q: updateMany 的 where 条件如何防止重复入账？
A: rechargeStatus: PENDING 确保只有未处理的订单能被更新。
   第一次回调将状态改为 SUCCESS，后续回调的 count 必然为 0。

Q: 为什么还要检查 rechargeAmount？
A: 防止网关回调 orderNo 正确但金额异常的极端情况。
   双重校验保证金额精确匹配。
```

| 场景 | count | 处理方式 |
|------|-------|----------|
| 首次回调（正常） | 1 | 更新状态 + creditCash |
| 重复回调（幂等） | 0（已 SUCCESS） | 返回 `Idempotent: Already Processed` |
| 订单已被取消 | 0（已取消/退款） | 抛 `InternalServerErrorException`，人工介入 |
| 金额不匹配 | 0（金额条件不满足） | 抛异常，记录错误日志 |

---

## 5. 提现代付回调 — `handlePayoutWebhook`

提现回调比充值回调更复杂，因为它需要处理**成功**和**失败**两个路径，且涉及**冻结余额**的释放逻辑。

### 5.1 数据提取与幂等性检查

[`handlePayoutWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:201) 的入口：

```typescript
private async handlePayoutWebhook(payload: unknown) {
  // ... 数据提取 ...
  
  return this.prismaService.$transaction(async (ctx) => {
    const order = await ctx.withdrawOrder.findUnique({
      where: { withdrawNo: orderNo },
    });

    if (!order) {
      throw new NotFoundException(`Withdrawal order not found: ${orderNo}`);
    }

    // 幂等性检查：如果订单已处理，直接返回
    if (
      order.withdrawStatus === WITHDRAW_STATUS.SUCCESS ||
      order.withdrawStatus === WITHDRAW_STATUS.FAILED
    ) {
      return { message: 'Withdrawal order already processed', order };
    }
    // ...
  });
}
```

### 5.2 SUCCESS 路径 — 原子释放冻结余额

当网关返回提现成功时，需要**原子化地**从冻结余额中扣除金额：

```typescript
if (status === 'SUCCEEDED' || status === 'COMPLETED') {
  // 原子化操作：只有 frozenBalance 充足时才扣减
  // gte (Greater Than or Equal) 确保不会扣成负数
  const r = await ctx.userWallet.updateMany({
    where: {
      userId: order.userId,
      frozenBalance: { gte: amount },  // 乐观锁条件
    },
    data: {
      frozenBalance: { decrement: amount },
      totalWithdraw: { increment: amount },
    },
  });

  // CRITICAL PATH: 冻结余额不足！
  if (r.count !== 1) {
    // 这种情况理论上不应该发生（提现审核时已冻结），
    // 但为了防止 Xendit 成功打款后我们扣不了钱，
    // 使用 fallback 强制扣减（无 gte 条件）
    this.logger.error(
      `CRITICAL: User ${order.userId} withdraw ${amount} success ` +
      `but insufficient frozenBalance! Forced decrement.`,
    );

    await ctx.userWallet.update({
      where: { userId: order.userId },
      data: {
        frozenBalance: { decrement: amount },
        totalWithdraw: { increment: amount },
      },
    });
  }

  // 更新钱包交易流水状态
  await ctx.walletTransaction.updateMany({
    where: { relatedId: order.withdrawId, status: TRANSACTION_STATUS.PENDING },
    data: { status: TRANSACTION_STATUS.SUCCESS },
  });

  // 更新提现订单状态
  await ctx.withdrawOrder.update({
    where: { withdrawId: order.withdrawId },
    data: {
      withdrawStatus: WITHDRAW_STATUS.SUCCESS,
      completedAt: new Date(),
    },
  });
}
```

### 5.3 FAILED 路径 — 解冻余额

当提现失败时，需要将冻结的余额**归还**到可用余额：

```typescript
else if (status === 'FAILED') {
  // 解冻：将 frozenBalance 转回 realBalance
  await this.walletService.unfreezeCash(
    {
      userId: order.userId,
      amount,
      related: { id: order.withdrawId, type: RelatedType.WITHDRAWAL },
      desc: `Withdrawal failed: ${payoutPayload.failure_code ?? 'UNKNOWN'}`,
    },
    ctx,
  );

  // 更新提现订单状态
  await ctx.withdrawOrder.update({
    where: { withdrawId: order.withdrawId },
    data: {
      withdrawStatus: WITHDRAW_STATUS.FAILED,
      completedAt: new Date(),
      rejectReason: `Disbursement failed: ${payoutPayload.failure_code ?? 'UNKNOWN'}`,
    },
  });
}
```

### 5.4 CRITICAL 降级路径分析

SUCCESS 路径中的 CRITICAL 日志是一个**容错设计**，值得深入理解：

```
正常流程:
  admin 审核提现 → freezeCash (冻结) → Xendit disbursement → webhook SUCCESS → unfreeze
    
异常场景（冻结余额不足）:
  管理员手动取消了冻结？系统 BUG 导致余额不一致？
  → Xendit 已经打款成功！我们必须扣钱！
  → 使用 fallback: update (无 gte) 强制扣减
  → 记录 CRITICAL 日志，由运维人工介入对账
```

这是**先保证业务正确，再修复数据一致性**的策略——绝不允许出现"Xendit 打了钱但我们记录没扣"的资金不一致问题。

---

## 6. 原子化钱包操作

### 6.1 钱包模型

[`UserWallet`](apps/api/prisma/schema.prisma:656) 采用**三余额设计**：

```prisma
model UserWallet {
  id            String    @id @default(cuid())
  userId        String    @unique
  realBalance   Decimal   @default(0)  // 可用余额（充值入账 / 提现解冻）
  coinBalance   Decimal   @default(0)  // 虚拟币余额
  frozenBalance Decimal   @default(0)  // 冻结余额（提现申请后冻结）
  totalRecharge Decimal   @default(0)  // 累计充值额（统计用）
  totalWithdraw Decimal   @default(0)  // 累计提现额（统计用）
  // ...
}
```

三余额之间的转换关系：

```
充值成功: realBalance += amount, totalRecharge += amount
提现申请: realBalance -= amount, frozenBalance += amount (freezeCash)
提现成功: frozenBalance -= amount, totalWithdraw += amount (unfreeze + deduct)
提现失败: frozenBalance -= amount, realBalance += amount (unfreezeCash)
消费扣款: realBalance -= amount (debitCash)
退款:     realBalance += amount (creditCash, type=RECHARGE)
```

### 6.2 `ensureWallet` — 惰性创建

[`ensureWallet`](apps/api/src/client/wallet/wallet.service.ts:55) 使用 `upsert` 模式——用户首次使用钱包功能时自动创建：

```typescript
async ensureWallet(userId: string, tx?: Tx) {
  const db = this.orm(tx);
  return await db.userWallet.upsert({
    where: { userId },
    create: { userId },
    update: {},  // 已存在则无操作
    select: {
      id: true, userId: true,
      realBalance: true, coinBalance: true,
      totalRecharge: true, frozenBalance: true, totalWithdraw: true,
    },
  });
}
```

设计要点：
- **不在注册时创建**：只有用户首次充值/提现/消费时才会创建钱包，减少无用数据
- **所有 wallet 操作前调用**：`creditCash`、`debitCash`、`freezeCash`、`unfreezeCash` 均内置 `ensureWallet` 调用

### 6.3 `creditCash` — 充值/入账

[`creditCash`](apps/api/src/client/wallet/wallet.service.ts:95) 是最核心的入账操作：

```typescript
async creditCash(params: {
  userId: string;
  amount: number | string | Prisma.Decimal;
  related?: { id: string; type: string };
  desc?: string;
  type?: number;
}, tx?: Tx) {
  const db = this.orm(tx);
  const { userId, amount, related, desc, type } = params;
  const amt = D(amount);

  if (amt.lte(0)) throw new BadRequestException('amount must be positive');

  await this.ensureWallet(userId, db);

  // 1. 原子化余额更新 + 返回更新后的记录
  const updateWallet = await db.userWallet.update({
    where: { userId },
    data: {
      realBalance: { increment: amt },
      totalRecharge: type === TRANSACTION_TYPE.RECHARGE || !type
        ? { increment: amt }  // 充值才累加 totalRecharge
        : undefined,           // 退款等其他入账不增加累计充值额
    },
    select: { realBalance: true, id: true },
  });

  const after = updateWallet.realBalance;
  const before = after.sub(amt);  // 通过当前值反算更新前余额

  // 2. 写入交易流水（审计线索）
  const txn = await db.walletTransaction.create({
    data: {
      transactionNo: generateTransactionNo(),
      userId,
      walletId: updateWallet.id,
      transactionType: type ?? TRANSACTION_TYPE.RECHARGE,
      balanceType: BALANCE_TYPE.CASH,
      amount: amt,
      beforeBalance: before,
      afterBalance: after,
      relatedId: related?.id,
      relatedType: related?.type,
      description: desc,
      status: TRANSACTION_STATUS.SUCCESS,
    },
    select: { id: true },
  });

  return { realBalance: after, transactionId: txn.id };
}
```

### 6.4 `debitCash` — 扣款

[`debitCash`](apps/api/src/client/wallet/wallet.service.ts:159) 使用 `gte` 乐观锁防止超扣：

```typescript
async debitCash(params: {
  userId: string;
  amount: number | string | Prisma.Decimal;
  related?: { id: string; type: string };
  desc?: string;
}, tx?: Tx) {
  const db = this.orm(tx);
  const amt = D(params.amount);

  if (amt.lte(0)) throw new BadRequestException('amount must be positive');

  await this.ensureWallet(params.userId, db);

  // 原子化扣款：只有 realBalance >= amt 时才允许扣减
  const updateWallet = await db.userWallet.update({
    where: {
      userId: params.userId,
      realBalance: { gte: amt },  // 乐观锁：余额不足时 Prisma 抛错
    },
    data: { realBalance: { decrement: amt } },
    select: { realBalance: true, id: true },
  });

  // 计算前后余额并记录流水
  const before = updateWallet.realBalance;
  const after = before.sub(amt);  // 注意：realBalance 是更新后的值
  // ... 记录 walletTransaction ...
}
```

### 6.5 `freezeCash` — 冻结

[`freezeCash`](apps/api/src/client/wallet/wallet.service.ts:353) 将可用余额转为冻结余额：

```typescript
async freezeCash(params: {
  userId: string;
  amount: Prisma.Decimal | number | string;
  related?: { id: string; type: string };
  desc?: string;
}, tx?: Tx) {
  const db = this.orm(tx);
  const amt = D(params.amount);
  const { userId, related, desc } = params;

  if (amt.lte(0)) throw new BadRequestException('amount must be positive');

  await this.ensureWallet(userId, db);

  // 原子操作：realBalance -= amt, frozenBalance += amt
  const r = await db.userWallet.updateMany({
    where: { userId, realBalance: { gte: amt } },
    data: {
      realBalance: { decrement: amt },
      frozenBalance: { increment: amt },
    },
  });

  if (r.count !== 1) {
    throw new BadRequestException('Insufficient balance');
  }

  // 获取更新后余额
  const wallet = await db.userWallet.findUnique({
    where: { userId },
    select: { realBalance: true, frozenBalance: true, id: true },
  });

  // 记录冻结流水
  // ...
}
```

### 6.6 `unfreezeCash` — 解冻

[`unfreezeCash`](apps/api/src/client/wallet/wallet.service.ts:418) 是冻结的逆操作（提现失败时回退）：

```typescript
async unfreezeCash(params: {
  userId: string;
  amount: Prisma.Decimal | number | string;
  related?: { id: string; type: string };
  desc?: string;
}, tx?: Tx) {
  const db = this.orm(tx);
  const amt = D(params.amount);
  const { userId, related, desc } = params;

  if (amt.lte(0)) throw new BadRequestException('amount must be positive');

  await this.ensureWallet(userId, db);

  // 原子操作：frozenBalance -= amt, realBalance += amt
  const r = await db.userWallet.updateMany({
    where: { userId, frozenBalance: { gte: amt } },
    data: {
      frozenBalance: { decrement: amt },
      realBalance: { increment: amt },
    },
  });

  if (r.count !== 1) {
    throw new BadRequestException('Insufficient frozen balance');
  }

  // 获取更新后余额并记录流水
  // ...
}
```

### 6.7 `walletTransaction` — 审计流水

每次余额变更都会记录一条 [`WalletTransaction`](apps/api/prisma/schema.prisma:704) 记录，形成完整的审计线索：

```prisma
model WalletTransaction {
  id              String   @id @default(cuid())
  transactionNo   String   @unique    // 格式: TRF{YYYYMMDDHHmmssSSS}{6位随机}
  userId          String
  walletId        String
  transactionType Int                // 1-充值 2-消费 3-退款 4-提现 5-冻结 6-解冻
  balanceType     Int                // 1-现金 2-虚拟币
  amount          Decimal
  relatedId       String?            // 关联业务 ID (rechargeId/withdrawId/orderId)
  relatedType     String?            // 关联业务类型 (RECHARGE/WITHDRAWAL/ORDER)
  description     String?
  status          Int                // 1-SUCCESS 2-PENDING 3-FAILED
  beforeBalance   Decimal            // 更新前余额（审计关键）
  afterBalance    Decimal            // 更新后余额（审计关键）
  createdAt       DateTime
  // ...
}
```

`beforeBalance` 和 `afterBalance` 的设计值得注意：

```typescript
// creditCash 中的计算方式
const after = updateWallet.realBalance;     // 更新后的余额（数据库返回）
const before = after.sub(amt);               // 反推更新前余额

// debitCash 中的计算方式（注意方向相反）
const after = updateWallet.realBalance;      // 更新后的余额
// ... 实际上，由于 update 返回的是更新后的值，before 应该是 after + amt
```

> **设计考量**：为什么不直接读一次数据库获取 before，再写一次？
> 因为无法保证两次操作之间的原子性。通过 `update` 返回更新后的值再反算 `before`，避免了一次额外的查询和并发问题。

---

## 7. 手续费计算

### 7.1 提现手续费

[`applyWithdraw`](apps/api/src/client/wallet/client-wallet.service.ts:388) 中的手续费计算：

```typescript
// Fee = (Amount × Rate) + Fixed
// Actual = Amount - Fee
const feeRate = channel.feeRate;    // Decimal, e.g. 0.02 = 2%
const feeFixed = channel.feeFixed;  // Decimal, e.g. 10.00 PHP

const fee = D(amount).mul(feeRate).plus(feeFixed);
const actualAmount = D(amount).sub(fee);

// 兜底：如果实际到账 ≤ 0，拒绝提现
if (actualAmount.lte(0)) {
  throw new BadRequestException(
    `Withdrawal amount too small after fees: ${actualAmount}`,
  );
}
```

| 场景 | 费率 | 固定费 | 提现金额 | 手续费 | 实际到账 |
|------|------|--------|----------|--------|----------|
| 小额提现 | 2% | PHP 10 | PHP 100 | PHP 12 | PHP 88 |
| 大额提现 | 2% | PHP 10 | PHP 5,000 | PHP 110 | PHP 4,890 |
| 金额过小 | 2% | PHP 10 | PHP 5 | PHP 10.10 | PHP -5.10 ❌ |

### 7.2 充值 Bonus（非 Webhook 逻辑但相关）

充值渠道配置了 `fixedAmounts` 和 `bonusAmount` 字段，用于首充奖励和活动充值加赠。这部分在充值订单创建时计算，Webhook 回调仅做 `creditCash` 处理，Bonus 逻辑在充值创建时已完成。

---

## 8. 安全设计

### 8.1 CSRF 绕过

Webhook 路径在 [`csrf.middleware.ts`](apps/api/src/common/middleware/csrf.middleware.ts) 中被排除：

```typescript
// main.ts 中的 CSRF 配置
// CSRF 中间件跳过 /api/v1/payment/ 和 /api/v1/webhook/ 路径
```

理由：Webhook 请求来自支付网关（服务端→服务端），不携带浏览器 Cookie/CSRF Token。如果强制 CSRF 校验会导致所有回调返回 403。

### 8.2 安全措施总结

| 风险 | 应对措施 |
|------|----------|
| **伪造回调** | `x-callback-token` 静态令牌验证 |
| **重复回调** | `updateMany` 乐观锁 + 幂等性返回 |
| **金额篡改** | Webhook 中双重校验：`orderNo` + `rechargeAmount` |
| **Webhook 路径 CSRF** | 中间件白名单绕过 |
| **余额超扣** | `gte` 条件 + Prisma 行级锁 |
| **冻结余额不一致** | CRITICAL 降级 + 强制扣减 + 人工对账 |

---

## 9. 完整 Webhook 回调时序

### 9.1 充值回调

```
Xendit                     PaymentWebhookController        ClientWalletService              WalletService
  │                               │                              │                              │
  │ POST /payment/webhook/xendit  │                              │                              │
  │ ─────────────────────────────►│                              │                              │
  │                               │ 1. verifyCallbackToken       │                              │
  │                               │ 2. handleUniversalWebhook    │                              │
  │                               │ ───────────────────────────► │                              │
  │                               │                              │ 3. external_id → invoice     │
  │                               │                              │ 4. $transaction start        │
  │                               │                              │    ┌──────────────────────┐  │
  │                               │                              │    │ 5. updateMany          │  │
  │                               │                              │    │    rechargeStatus:    │  │
  │                               │                              │    │    PENDING → SUCCESS  │  │
  │                               │                              │    │    (乐观锁 count=1)    │  │
  │                               │                              │    │ 6. creditCash()         │  │
  │                               │                              │    │ ──────────────────────► │  │
  │                               │                              │    │                       │  │
  │                               │                              │    │   7. ensureWallet      │  │
  │                               │                              │    │   8. update realBalance │  │
  │                               │                              │    │   9. create transaction│  │
  │                               │                              │    │ ◄────────────────────── │  │
  │                               │                              │    └──────────────────────┘  │
  │ ◄─────────────────────────────│─────────────────────────────│─────────────────────────────│
  │ { status: 'OK' } (HTTP 200)   │                              │                              │
```

### 9.2 提现回调

```
Xendit                     PaymentWebhookController        ClientWalletService              WalletService
  │                               │                              │                              │
  │ POST /payment/webhook/xendit  │                              │                              │
  │ ─────────────────────────────►│                              │                              │
  │                               │ 1. verifyCallbackToken       │                              │
  │                               │ 2. handleUniversalWebhook    │                              │
  │                               │ ───────────────────────────► │                              │
  │                               │                              │ 3. event.startsWith('payout.')│
  │                               │                              │                              │
  │                               │                              │ ┌── SUCCESS ──────────────┐  │
  │                               │                              │ │ 4. updateMany           │  │
  │                               │                              │ │    frozenBalance gte    │  │
  │                               │                              │ │ 5. 更新流水状态          │  │
  │                               │                              │ │ 6. 更新 withdrawOrder   │  │
  │                               │                              │ └─────────────────────────┘  │
  │                               │                              │                              │
  │                               │                              │ ┌── FAILED ───────────────┐  │
  │                               │                              │ │ 4. unfreezeCash()        │  │
  │                               │                              │ │ ───────────────────────► │  │
  │                               │                              │ │   5. frozenBalance gte   │  │
  │                               │                              │ │   6. realBalance += amt │  │
  │                               │                              │ │ 7. 更新 withdrawOrder   │  │
  │                               │                              │ └─────────────────────────┘  │
  │ ◄─────────────────────────────│─────────────────────────────│─────────────────────────────│
  │ { status: 'OK' } (HTTP 200)   │                              │                              │
```

---

## 10. 与现有文章的对比

本篇文章与 [`payment-full-chain-xendit.md`](docs/blog/articles/admin-next/payment-full-chain-xendit.md) 的关系：

| 维度 | `payment-full-chain-xendit.md` | 本篇文章 |
|------|-------------------------------|----------|
| **视角** | 全链路：Flutter → API → Xendit → admin-next | 深度聚焦：Webhook 回调处理 |
| **强调点** | 流程时序、网关对接、admin 财务审核 | 乐观锁模式、幂等性、原子操作、审计流水 |
| **Xendit 集成** | `PaymentService` 的 Invoice/Payout 创建 | `verifyCallbackToken` + 回调路由 |
| **钱包操作** | 仅提及 `creditCash`/`freezeCash` | 完整展示 6 个原子操作的代码与设计 |
| **事务分析** | 提到 `$transaction` | 深入分析 `updateMany` 乐观锁 + count 检查 |
| **安全** | 全局安全性描述 | 专门展开 CSRF 绕过与回调鉴权 |
| **前置阅读** | 无需前置知识 | 建议先阅读 `payment-full-chain-xendit.md` |

---

## 11. 总结

支付 Webhook 处理是本项目中最**敏感**的代码之一——它直接操作资金余额，任何 BUG 都可能导致资金不一致。通过本篇文章的分析，可以总结出以下设计模式：

| 模式 | 应用 | 关键代码 |
|------|------|----------|
| **单端点路由** | 一个入口按 channel 分派 | `POST /payment/webhook/:channel` |
| **静态令牌鉴权** | 验证回调来源 | `verifyCallbackToken()` |
| **双路径路由** | event → payout, external_id → invoice | `handleUniversalWebhook()` |
| **updateMany 乐观锁** | 防止充值重复入账 | `where: { rechargeStatus: PENDING, rechargeAmount }` |
| **幂等性检查** | 已处理的订单直接返回 | `order.rechargeStatus === SUCCESS → return` |
| **gte 条件锁** | 防止余额超扣 | `where: { frozenBalance: { gte: amount } }` |
| **CRITICAL 降级** | 容错：强制扣减不阻塞 | `update (无 gte) + CRITICAL 日志` |
| **ensureWallet upsert** | 惰性创建钱包 | `upsert({ where: { userId }, create: { userId } })` |
| **反算 beforeBalance** | 避免竞态条件 | `after = wallet.realBalance; before = after.sub(amt)` |
| **三余额设计** | 可用/冻结/虚拟币分离 | `realBalance + frozenBalance + coinBalance` |

### 相关文章

- [`payment-full-chain-xendit.md`](docs/blog/articles/admin-next/payment-full-chain-xendit.md) — 支付全链路：Flutter → API → Xendit → admin-next 财务审核
- [`finance-audit-withdrawal-adjust-workflow.md`](docs/blog/articles/admin-next/finance-audit-withdrawal-adjust-workflow.md) — 财务审核工作流
- [`finance-deposit-transaction-tracking.md`](docs/blog/articles/admin-next/finance-deposit-transaction-tracking.md) — 充值流水与交易追踪
- [`prisma-database-architecture.md`](docs/blog/articles/admin-next/prisma-database-architecture.md) — Prisma 数据库架构设计（含 Wallet/Transaction 模型详解）
- [`full-stack-authentication.md`](docs/blog/articles/admin-next/full-stack-authentication.md) — 全栈认证体系（Webhook CSRF 白名单的认证上下文）
