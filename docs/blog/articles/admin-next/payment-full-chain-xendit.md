---
title: '支付流程全链路 — API Xendit → Flutter App → admin-next 财务审核'
description: 'NestJS PaymentService（Xendit Invoice/Payout网关）→ ClientWalletService（充值/提现/Webhook回调业务）→ admin-next Finance 页面（WithdrawalList、DepositList、TransactionList）'
slug: payment-full-chain-xendit
tags: Payment, Xendit, Wallet, Webhook, Finance, Audit, Disbursement
---

# 支付流程全链路 — API Xendit → Flutter App → admin-next 财务审核

## 1. 背景

本项目的支付体系以 [**Xendit**](https://www.xendit.co/) 作为菲律宾本地支付网关，覆盖两大核心业务流程：

| 流程 | 方向 | 支付方式 | 涉及模块 |
|------|------|---------|---------|
| **充值** | 用户 → 平台 | Xendit Invoice（GCash / PayMaya / GrabPay / BDO） | Flutter → API → Xendit → Webhook → Wallet |
| **提现** | 平台 → 用户 | Xendit Payout（Disbursement 代付） | admin-next 审核 → API → Xendit → Webhook → Wallet |

整条支付链路横跨 **Flutter 移动端**（用户发起充值/提现）、**API 服务端**（处理业务逻辑与 Xendit 通信）、**admin-next 管理后台**（财务审核与流水追踪），是一套完整的全栈支付系统。

> 本篇文章重点讲解 **API 层支付处理逻辑** 与 **admin-next 财务页面的集成**，假设读者已阅读以下文章了解基础 UI 组件：
> - [`finance-audit-withdrawal-adjust-workflow.md`](docs/blog/articles/admin-next/finance-audit-withdrawal-adjust-workflow.md) — 提现列表、审核弹窗、手动调账
> - [`finance-deposit-transaction-tracking.md`](docs/blog/articles/admin-next/finance-deposit-transaction-tracking.md) — 充值列表、交易流水、详情弹窗

---

## 2. 全链路架构

```
┌─────────────────────────────────────────────────────────────┐
│                     用户 (Flutter App)                        │
│  ┌───────────┐           ┌──────────────────┐              │
│  │ 充值请求   │           │ 提现申请          │              │
│  └─────┬─────┘           └──────┬───────────┘              │
│        │                        │                           │
└────────┼────────────────────────┼───────────────────────────┘
         │                        │
    ┌────▼────────────────────────▼────┐
    │          API (NestJS)             │
    │  ┌────────────────────────────┐   │
    │  │   WalletController         │   │
    │  │  POST /wallet/recharge/*   │   │
    │  │  POST /wallet/withdraw/*   │   │
    │  └──────────┬─────────────────┘   │
    │             │                      │
    │  ┌──────────▼──────────────────┐  │
    │  │  ClientWalletService        │  │
    │  │  createRecharge()           │  │
    │  │  applyWithdraw()            │  │
    │  │  handleInvoiceWebhook()     │  │
    │  │  handlePayoutWebhook()      │  │
    │  └──────────┬──────────────────┘  │
    │             │                      │
    │  ┌──────────▼──────────────────┐  │
    │  │  PaymentService             │  │
    │  │  createRechargeLink() (Invoice) │
    │  │  createDisbursement() (Payout)  │
    │  │  verifyCallbackToken()      │  │
    │  └──────────┬──────────────────┘  │
    └─────────────┼─────────────────────┘
                  │
         ┌────────▼────────┐
         │   Xendit API    │
         │  (Payment GW)   │
         └────────┬────────┘
                  │
         ┌────────▼────────┐
         │   Webhook       │
         │  POST /payment/ │
         │  webhook/xendit │
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────────────┐
    │    API (callback handler)         │
    │  handleUniversalWebhook()         │
    │   ├─ payout.* → handlePayoutWebhook│
    │   └─ external_id → handleInvoiceWebhook│
    └───────────────────────────────────┘

                    ┌───────────────────────┐
                    │   admin-next 财务后台   │
                    │  WithdrawalList        │
                    │   → WithdrawAuditModal │
                    │  DepositList           │
                    │   → DepositDetailModal │
                    │  TransactionList       │
                    │   → TransactionDetail  │
                    └───────────────────────┘
```

### 流程时序（充值）

```
Flutter                    API                      Xendit
  │                         │                         │
  │  POST /wallet/recharge  │                         │
  │  /create                │                         │
  │ ──────────────────────► │                         │
  │                         │  1. 校验渠道/金额        │
  │                         │  2. 创建 rechargeOrder   │
  │                         │     (status=PENDING)    │
  │                         │                         │
  │                         │  POST /invoices          │
  │                         │ ─────────────────────►  │
  │                         │  ◄── invoiceUrl ─────── │
  │  ◄── { payUrl } ────── │                         │
  │                         │                         │
  │  用户打开 payUrl 支付     │                         │
  │ ───────────────────────────────────────────────►  │
  │                         │                         │
  │                         │  POST /payment/webhook  │
  │                         │  /xendit                │
  │                         │ ◄────────────────────── │
  │                         │                         │
  │                         │  3. verifyCallbackToken  │
  │                         │  4. handleInvoiceWebhook │
  │                         │     - updateMany (乐观锁) │
  │                         │     - creditCash        │
  │                         │     - return SUCCESS    │
  │                         │                         │
```

### 流程时序（提现）

```
Flutter         admin-next                  API                         Xendit
  │                │                         │                           │
  │ 申请提现        │                         │                           │
  │ ────────────►  │                         │                           │
  │                │  POST /wallet/withdraw   │                           │
  │                │  /apply                  │                           │
  │                │ ───────────────────────► │                           │
  │                │                         │  1. 校验渠道/金额/手续费     │
  │                │                         │  2. freezeCash            │
  │                │                         │  3. 创建 withdrawOrder     │
  │                │                         │     (status=PENDING_AUDIT) │
  │                │                         │                           │
  │  审核通过       │                         │                           │
  │                │  WithdrawAuditModal      │                           │
  │                │  → 审核通过              │                           │
  │                │  POST /admin/finance     │                           │
  │                │  /withdraw/audit         │                           │
  │                │ ───────────────────────► │                           │
  │                │                         │  POST /payouts            │
  │                │                         │  (idempotencyKey)         │
  │                │                         │ ────────────────────────► │
  │                │                         │  ◄── payout created ──── │
  │                │                         │                           │
  │                │                         │  POST /payment/webhook    │
  │                │                         │  /xendit                  │
  │                │                         │ ◄──────────────────────── │
  │                │                         │                           │
  │                │                         │  4. handlePayoutWebhook   │
  │                │                         │     - SUCCEEDED:          │
  │                │                         │       unfreeze + complete │
  │                │                         │     - FAILED:             │
  │                │                         │       unfreezeCash back   │
```

---

## 3. [PaymentService](apps/api/src/common/payment/payment.service.ts:12) — Xendit 网关封装

[`PaymentService`](apps/api/src/common/payment/payment.service.ts:12) 是支付网关的统一封装层，通过 [`xendit-node`](https://www.npmjs.com/package/xendit-node) SDK 与 Xendit API 通信。

### 3.1 初始化

```typescript
@Injectable()
export class PaymentService {
  private readonly xenditClient: Xendit;

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('XENDIT_SECRET_KEY');
    this.xenditClient = new Xendit({ secretKey: secretKey || '' });
  }
}
```

密钥来源于环境变量 `XENDIT_SECRET_KEY`，通过 [`ConfigService`](apps/api/src/common/config) 注入。

### 3.2 [verifyCallbackToken](apps/api/src/common/payment/payment.service.ts:28) — 回调验证

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

Xendit 在每个 webhook 回调请求的 HTTP 头 `x-callback-token` 中附带一个 token，服务端通过比对 `XENDIT_CALLBACK_TOKEN` 环境变量来验证回调来源的合法性。

### 3.3 [createRechargeLink](apps/api/src/common/payment/payment.service.ts:46) — 充值链接（Invoice）

```typescript
async createRechargeLink(
  orderNo: string,
  amount: number,
  redirectUrl: string,
  channelCode?: string,
  userEmail?: string,
) {
  const invoiceData: CreateInvoiceRequest = {
    externalId: orderNo,        // 业务订单号
    amount: amount,
    description: `${RelatedType.RECHARGE} - ${orderNo}`,
    invoiceDuration: 86400,     // 24小时过期
    currency: 'PHP',            // 菲律宾比索
    payerEmail: userEmail,
    successRedirectUrl: `${redirectUrl}wallet/recharge/success/${orderNo}`,
    failureRedirectUrl: `${redirectUrl}wallet/recharge/failure/${orderNo}`,
  };

  if (channelCode) {
    const method = channelCode.replace('PH_', '');  // PH_GCASH → GCASH
    invoiceData.paymentMethods = [method];
  }

  const response = await this.xenditClient.Invoice.createInvoice({
    data: invoiceData,
  });
  return response.invoiceUrl;
}
```

关键设计点：

| 参数 | 值 | 说明 |
|------|-----|------|
| `externalId` | 业务订单号 `rechargeNo` | 用于 webhook 回调时关联到内部订单 |
| `invoiceDuration` | 86400 (24h) | Xendit 发票过期时间 |
| `currency` | `PHP` | 菲律宾比索，固定 |
| `paymentMethods` | `channelCode` 去掉 `PH_` 前缀 | 如 `PH_GCASH` → `GCASH` |
| `successRedirectUrl` | 带 `rechargeNo` 的重定向 URL | 用户支付完成后跳回 App |

### 3.4 [createDisbursement](apps/api/src/common/payment/payment.service.ts:86) — 代付（Payout）

```typescript
async createDisbursement(payload: {
  orderNo: string;
  amount: number;
  bankCode: string;      // 如 'PH_GCASH', 'PH_BPI'
  accountNumber: string;
  accountName: string;
  description?: string;
}) {
  const response = await this.xenditClient.Payout.createPayout({
    idempotencyKey: `payout-${payload.orderNo}`,
    data: {
      referenceId: payload.orderNo,
      currency: 'PHP',
      channelCode: payload.bankCode,
      channelProperties: {
        accountNumber: payload.accountNumber,
        accountHolderName: payload.accountName,
      },
      amount: payload.amount,
      description: payload.description || `${RelatedType.WITHDRAWAL}-${payload.orderNo}`,
    },
  });
  return response;
}
```

**幂等性设计**：`idempotencyKey: payout-${orderNo}` 确保同一笔提现订单不会重复发出代付请求。即使 admin 操作员重复点击审核按钮，Xendit 也只会处理一次。

### 3.5 查询接口

| 方法 | 用途 | 参数 |
|------|------|------|
| [`getInvoiceById`](apps/api/src/common/payment/payment.service.ts:131) | 按 Xendit Invoice ID 查询 | `invoiceId: string` |
| [`getInvoiceByExternalId`](apps/api/src/common/payment/payment.service.ts:146) | 按外部订单号查询 | `externalId: string` |
| [`getDisbursementByExternalId`](apps/api/src/common/payment/payment.service.ts:171) | 按 reference_id 查询代付状态 | `externalId: string` |

### 3.6 [handleXenditError](apps/api/src/common/payment/payment.service.ts:195) — 统一错误处理

```typescript
private handleXenditError(error: unknown, context: string) {
  const msg = error instanceof Error ? error.message : String(error);
  this.logger.error(`[Xendit Error - ${context}] ${msg}`);
  if (error !== null && typeof error === 'object') {
    if ('response' in error) {
      console.error('Xendit Response Body:', JSON.stringify(
        (error as { response: unknown }).response, null, 2));
    }
    if ('issues' in error) {
      console.error('Xendit Issues:', JSON.stringify(
        (error as { issues: unknown }).issues, null, 2));
    }
  }
  throw new InternalServerErrorException(`Payment Gateway Error: ${context}`);
}
```

所有 Xendit API 异常统一由 `handleXenditError` 处理——记录详细错误上下文（response body、issues），然后抛出 `InternalServerErrorException`。

---

## 4. [PaymentModule](apps/api/src/common/payment/payment.module.ts:4) — 全局模块注册

```typescript
@Global()
@Module({
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
```

[`PaymentModule`](apps/api/src/common/payment/payment.module.ts:4) 使用 `@Global()` 装饰器，使 `PaymentService` 在整个应用中随处可用，无需在每个业务模块重复导入。

---

## 5. 充值流程

### 5.1 [WalletController.createRecharge](apps/api/src/client/wallet/wallet.controller.ts:79)

```
POST /wallet/recharge/create
Body: { channelId, amount, redirectUrl }
```

客户端（Flutter App）调用该接口发起充值请求。

### 5.2 [ClientWalletService.createRecharge](apps/api/src/client/wallet/client-wallet.service.ts:475)

```typescript
async createRecharge(userId: string, dto: CreateRechargeDto) {
  const amount = new Prisma.Decimal(dto.amount);
  const { redirectUrl } = dto;

  // 1. 校验渠道是否存在、是否可用
  const channel = await this.prismaService.paymentChannel.findUnique({
    where: { id: dto.channelId, status: 1 },
  });
  if (!channel) {
    throw new NotFoundException('Payment channel not found or inactive');
  }

  // 金额范围校验
  if (channel.minAmount && amount.lessThan(channel.minAmount)) { ... }
  if (channel.maxAmount && amount.greaterThan(channel.maxAmount)) { ... }

  // 2. 生成订单号
  const rechargeNo = OrderNoHelper.generate(BizPrefix.DEPOSIT);

  // 3. 创建充值订单 (PENDING)
  const order = await this.prismaService.rechargeOrder.create({
    data: {
      rechargeNo,
      userId,
      rechargeAmount: amount,
      actualAmount: amount,
      rechargeStatus: RECHARGE_STATUS.PENDING,
      paymentMethod: channel.type,
      channelCode: channel.code,
      channelId: channel.id,
      paymentChannel: channel.name,
    },
  });

  // 4. 调用 Xendit 生成支付链接
  const paymentUrl = await this.paymentService.createRechargeLink(
    order.rechargeNo,
    amount.toNumber(),
    redirectUrl,
    channel.code,  // 如 'PH_GCASH'
  );

  return {
    rechargeNo: order.rechargeNo,
    rechargeAmount: order.rechargeAmount.toString(),
    payUrl: paymentUrl,
    rechargeStatus: order.rechargeStatus,
    channelId: channel.id,
  };
}
```

**流程步骤**：
1. **渠道校验**：查询 `paymentChannel` 表，确保渠道 ID 有效且 `status = 1`（启用）
2. **金额校验**：`minAmount` ≤ `amount` ≤ `maxAmount`
3. **订单创建**：写入 `rechargeOrder` 表，状态为 `PENDING`
4. **Xendit 支付链接**：调用 `PaymentService.createRechargeLink()` 获得 Xendit Invoice URL
5. **返回**：将 `payUrl` 返回给 Flutter 客户端，用户打开该 URL 完成支付

### 5.3 PaymentChannel 数据模型

渠道信息存储在 `paymentChannel` 表中：

| 字段 | 示例值 | 说明 |
|------|--------|------|
| `code` | `PH_GCASH` | 渠道代码，传给 Xendit |
| `name` | `GCash` | 渠道显示名称 |
| `type` | EWallet / Bank | 渠道类型 |
| `minAmount` | 50.00 | 最小充值/提现金额 |
| `maxAmount` | 50000.00 | 最大充值/提现金额 |
| `feeRate` | 0.02 (2%) | 手续费率 |
| `feeFixed` | 5.00 | 固定手续费 |
| `status` | 1 | 是否启用 |

---

## 6. Webhook 回调处理

### 6.1 [PaymentWebhookController](apps/api/src/client/wallet/payment-webhook.controller.ts:17)

```typescript
@Controller('payment')
export class PaymentWebhookController {
  @Post('webhook/:channel')
  async handleWebhook(
    @Param('channel') channel: string,
    @Body() payload: any,
    @Headers('x-callback-token') token: string,
  ) {
    if (channel === 'xendit') {
      // 1. 校验回调 token
      if (!this.paymentService.verifyCallbackToken(token)) {
        throw new UnauthorizedException('Invalid callback token');
      }
      // 2. 路由到通用 webhook 处理器
      await this.clientWalletService.handleUniversalWebhook(payload);
    }
    return { status: 'OK' };
  }
}
```

Xendit 支付完成后会向此接口发送回调通知。控制器的职责：
1. 根据 `:channel` 参数区分不同支付渠道
2. 验证 `x-callback-token` HTTP 头
3. 委托给 [`ClientWalletService.handleUniversalWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:51)

### 6.2 [handleUniversalWebhook](apps/api/src/client/wallet/client-wallet.service.ts:51) — Webhook 路由器

```typescript
async handleUniversalWebhook(payload: unknown) {
  if (!isRecord(payload)) {
    return { status: 'IGNORED', reason: 'Unknown Format' };
  }

  const event = typeof payload.event === 'string' ? payload.event : null;

  // 判定逻辑 1: 代付回调 (Payout)
  if (event && event.startsWith('payout.')) {
    return this.handlePayoutWebhook(payload.data);
  }

  // 判定逻辑 2: 充值回调 (Invoice)
  if (typeof payload.external_id === 'string') {
    return this.handleInvoiceWebhook(payload);
  }

  return { status: 'IGNORED', reason: 'Unknown Format' };
}
```

**路由策略**：

| 判定条件 | 目标方法 | 典型 payload 特征 |
|----------|---------|-------------------|
| `event.startsWith('payout.')` | [`handlePayoutWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:201) | `{ event: 'payout.succeeded', data: { reference_id: '...' } }` |
| `typeof payload.external_id === 'string'` | [`handleInvoiceWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:85) | `{ external_id: 'DEP20260101...', status: 'PAID', amount: 100 }` |

### 6.3 [handleInvoiceWebhook](apps/api/src/client/wallet/client-wallet.service.ts:85) — 充值回调核心逻辑

```typescript
private async handleInvoiceWebhook(payload: unknown) {
  const orderNo = payload.external_id;
  const status = payload.status;
  const amount = payload.amount;
  const transactionId = payload.id;

  // 前缀校验: 只处理 DEP 开头的订单
  if (!orderNo.startsWith(BizPrefix.DEPOSIT)) {
    return { status: 'IGNORED', message: 'Invalid Prefix' };
  }

  // 仅处理成功状态
  if (status !== 'PAID' && status !== 'SETTLED' && status !== 'SUCCESS') {
    return { status: 'IGNORED', message: `Status is ${status}` };
  }

  const amountDecimal = new Prisma.Decimal(amount);

  return this.prismaService.$transaction(async (ctx) => {
    // 乐观锁: 仅当订单仍为 PENDING 时才更新
    const updateResult = await ctx.rechargeOrder.updateMany({
      where: {
        rechargeNo: orderNo,
        rechargeStatus: RECHARGE_STATUS.PENDING,  // 仅 PENDING 态可更新
        rechargeAmount: amountDecimal,             // 金额双重校验
      },
      data: {
        rechargeStatus: RECHARGE_STATUS.SUCCESS,
        thirdPartyOrderNo: transactionId,
        paidAt: new Date(),
        callbackData: payload,
      },
    });

    if (updateResult.count === 0) {
      // 幂等性检查: 如果已经是 SUCCESS，直接返回
      const order = await ctx.rechargeOrder.findUnique({
        where: { rechargeNo: orderNo },
      });
      if (order.rechargeStatus === RECHARGE_STATUS.SUCCESS) {
        return { status: 'SUCCESS', message: 'Idempotent: Already Processed' };
      }
      throw new InternalServerErrorException(
        'Failed to update recharge order, possible concurrency issue',
      );
    }

    // 入账到钱包
    const order = await ctx.rechargeOrder.findUnique({
      where: { rechargeNo: orderNo },
      select: { rechargeId: true, userId: true },
    });
    await this.walletService.creditCash({
      userId: order!.userId,
      amount: amountDecimal,
      related: { id: order!.rechargeId, type: RelatedType.RECHARGE },
      desc: `Recharge via Xendit. Txn: ${transactionId}`,
    }, ctx);

    return { status: 'SUCCESS', message: 'Recharge processed successfully' };
  });
}
```

#### 安全机制详解

| 机制 | 实现方式 | 目的 |
|------|---------|------|
| **订单前缀校验** | `orderNo.startsWith(BizPrefix.DEPOSIT)` | 防止非充值回调被误处理 |
| **状态过滤** | 仅接受 `PAID` / `SETTLED` / `SUCCESS` | 忽略中间态或失败态 |
| **乐观锁** | `updateMany` + `WHERE rechargeStatus = PENDING` | 并发安全：只有 PENDING 态可被更新 |
| **金额双重校验** | `rechargeAmount: amountDecimal` 也加入 WHERE 条件 | 防止金额篡改 |
| **幂等性** | 更新 count = 0 时查询是否已 SUCCESS | 多次回调不重复入账 |
| **事务一致性** | `$transaction` 包裹订单更新 + 钱包入账 | 两者原子提交 |
| **精确入账** | `creditCash` 传入 `related` 关联 ID | 交易流水可追溯 |

### 6.4 [handlePayoutWebhook](apps/api/src/client/wallet/client-wallet.service.ts:201) — 代付回调核心逻辑

```typescript
private async handlePayoutWebhook(payload: unknown) {
  const orderNo = payload.reference_id;
  const status = payload.status;
  const failureCode = payload.failure_code;

  // 前缀校验
  if (!orderNo.startsWith(BizPrefix.WITHDRAW)) {
    return { status: 'IGNORED', message: 'Invalid Prefix' };
  }

  return this.prismaService.$transaction(async (ctx) => {
    const order = await ctx.withdrawOrder.findUnique({
      where: { withdrawNo: orderNo },
    });
    if (!order) throw new NotFoundException(`Withdrawal order not found: ${orderNo}`);

    // 幂等性检查
    if (order.withdrawStatus === WITHDRAW_STATUS.SUCCESS ||
        order.withdrawStatus === WITHDRAW_STATUS.FAILED) {
      return { message: 'Withdrawal order already processed', order };
    }

    const amount = order.actualAmount;

    if (status === 'SUCCEEDED' || status === 'COMPLETED') {
      // 代付成功：释放冻结金额
      const r = await ctx.userWallet.updateMany({
        where: { userId: order.userId, frozenBalance: { gte: amount } },
        data: {
          frozenBalance: { decrement: amount },
          totalWithdraw: { increment: amount },
        },
      });

      if (r.count !== 1) {
        // 严重警报：冻结金额不足，强制扣减
        this.logger.error(
          `CRITICAL: User ${order.userId} withdraw success but insufficient frozen balance!`);
        await ctx.userWallet.update({
          where: { userId: order.userId },
          data: {
            frozenBalance: { decrement: amount },
            totalWithdraw: { increment: amount },
          },
        });
      }

      // 更新交易流水状态
      await ctx.walletTransaction.updateMany({
        where: { relatedId: order.withdrawId, relatedType: RelatedType.WITHDRAWAL },
        data: { status: TRANSACTION_STATUS.SUCCESS, description: 'Withdrawal completed' },
      });

      await ctx.withdrawOrder.update({
        where: { withdrawId: order.withdrawId },
        data: { withdrawStatus: WITHDRAW_STATUS.SUCCESS, completedAt: new Date() },
      });

    } else if (status === 'FAILED') {
      // 代付失败：退回冻结金额
      await this.walletService.unfreezeCash({
        userId: order.userId,
        amount: amount,
        related: { id: order.withdrawId, type: RelatedType.WITHDRAWAL },
        desc: `Withdrawal failed: ${failureCode ?? 'UNKNOWN'}`,
      }, ctx);

      await ctx.withdrawOrder.update({
        where: { withdrawId: order.withdrawId },
        data: {
          withdrawStatus: WITHDRAW_STATUS.FAILED,
          completedAt: new Date(),
          rejectReason: `Disbursement failed: ${failureCode ?? 'UNKNOWN'}`,
        },
      });
    }
  });
}
```

#### 代付成功 vs 失败处理

| 场景 | 钱包操作 | 订单状态 | 补偿机制 |
|------|---------|---------|---------|
| **SUCCEEDED / COMPLETED** | `frozenBalance -= amount` + `totalWithdraw += amount` | `SUCCESS` | 冻结金额不足时强制扣减（严重日志兜底） |
| **FAILED** | `unfreezeCash()` 退回可用余额 | `FAILED` + `rejectReason` | 自动解冻，用户可重新提现 |

**冻结金额临界保护**：代付成功时使用 `updateMany` + `frozenBalance: { gte: amount }` 条件，正常情况下冻结余额 ≥ 提现金额。若因数据异常导致冻结金额不足，记录严重日志并执行强制扣减，避免回调死循环。

---

## 7. 提现流程

### 7.1 [WalletController.applyWithdraw](apps/api/src/client/wallet/wallet.controller.ts:63)

```
POST /wallet/withdraw/apply
Body: { channelId, amount, account, accountName }
```

用户（Flutter App）申请提现。

### 7.2 [ClientWalletService.applyWithdraw](apps/api/src/client/wallet/client-wallet.service.ts:388)

```typescript
async applyWithdraw(userId: string, dto: ApplyWithdrawDto) {
  const { amount: amountNum, account, accountName } = dto;

  // 1. 渠道校验
  const channel = await this.prismaService.paymentChannel.findUnique({
    where: { id: dto.channelId, status: 1 },
  });
  if (!channel) throw new NotFoundException('Payment channel not found or inactive');

  // 金额范围校验
  if (channel.minAmount && amountNum < channel.minAmount.toNumber()) { ... }
  if (channel.maxAmount && amountNum > channel.maxAmount.toNumber()) { ... }

  const withdrawAmount = new Prisma.Decimal(amountNum);

  // 2. 手续费计算
  // Fee = (Amount × Rate) + Fixed
  const feeRate = channel.feeRate || new Prisma.Decimal(0);
  const feeFixed = channel.feeFixed || new Prisma.Decimal(0);
  const calcFee = withdrawAmount.mul(feeRate).add(feeFixed);
  const actualAmount = withdrawAmount.sub(calcFee);  // 实际到账

  if (actualAmount.lessThanOrEqualTo(0)) {
    throw new InternalServerErrorException(
      'Calculated actual amount is zero or negative due to fees');
  }

  // 3. 事务：创建订单 + 冻结金额
  return this.prismaService.$transaction(async (ctx) => {
    const order = await ctx.withdrawOrder.create({
      data: {
        withdrawNo: OrderNoHelper.generate(BizPrefix.WITHDRAW),
        userId,
        withdrawAmount,
        actualAmount,
        feeAmount: calcFee,
        withdrawStatus: WITHDRAW_STATUS.PENDING_AUDIT,
        accountName,
        withdrawAccount: account,
        channelCode: channel.code,     // 'PH_GCASH'
        withdrawMethod: channel.type,
        bankName: channel.name,
      },
    });

    await this.walletService.freezeCash({
      userId, amount: withdrawAmount,
      related: { id: order.withdrawId, type: RelatedType.WITHDRAWAL },
      desc: 'Apply for withdrawal, freeze amount',
    }, ctx);

    return order;
  });
}
```

#### 手续费计算公式

```
手续费 = 提现金额 × 手续费率 + 固定手续费
实际到账 = 提现金额 - 手续费
```

例如：提现 100 PHP，费率 2% + 固定 5 PHP：
- 手续费 = 100 × 0.02 + 5 = 7 PHP
- 实际到账 = 100 - 7 = 93 PHP（冻结 100 PHP）

> **安全兜底**：如果 `actualAmount ≤ 0`（手续费超过提现金额），直接拒绝该笔提现请求。

### 7.3 订单状态机

```
提现状态 (withdrawOrder.withdrawStatus):
  PENDING_AUDIT ─► PROCESSING ─► SUCCESS
       │               │
       │               └──► FAILED (代付失败)
       └──► REJECTED (审核拒绝)

充值状态 (rechargeOrder.rechargeStatus):
  PENDING ─► SUCCESS (回调通知)
     │
     └──► FAILED
```

---

## 8. 管理后台财务页面

以下内容建立在之前文章的 UI/组件描述之上，重点展示 **admin-next 与 API 之间的数据交互**。

### 8.1 [WithdrawalList](docs/blog/articles/admin-next/finance-audit-withdrawal-adjust-workflow.md) — 提现列表

[`WithdrawalList`](apps/admin-next/src/views/finance/WithdrawalList.tsx) 展示所有提现订单，通过 `financeApi.getWithdrawals()` 调用 API。

**API 对接**：

```
GET /admin/finance/withdrawals?page=1&pageSize=10&status=PENDING_AUDIT
```

| 列 | 数据来源 | 说明 |
|----|---------|------|
| 用户信息 | `order.user` | 用户 ID、昵称 |
| 提现金额 | `order.withdrawAmount` | 原始提现金额 |
| 手续费 | `order.feeAmount` | 计算后的手续费 |
| 实际到账 | `order.actualAmount` | 扣手续费后的金额 |
| 渠道 | `order.bankName` + `order.channelCode` | GCash / PayMaya / BDO |
| 状态 | `order.withdrawStatus` | 带颜色 Badge |
| 操作 | 审核 / 查看 | WithdrawAuditModal |

**状态颜色映射**（[`getStatusConfig`](apps/admin-next/src/views/finance/type.ts:10)）：

| 状态 | 颜色 | 说明 |
|------|------|------|
| `PENDING_AUDIT` | 🟡 yellow | 待审核 |
| `PROCESSING` | 🔵 blue | 处理中（已调用代付） |
| `SUCCESS` | 🟢 green | 提现成功 |
| `REJECTED` | 🔴 red | 审核拒绝 |

### 8.2 [WithdrawAuditModal](docs/blog/articles/admin-next/finance-audit-withdrawal-adjust-workflow.md) — 审核弹窗

管理员审核提现时，发起代付请求：

```typescript
// admin-next → API → Xendit
// 审核通过
POST /admin/finance/withdraw/audit
Body: { withdrawId, action: 'APPROVE' }
→ API calls PaymentService.createDisbursement()
→ Xendit Payout API (idempotencyKey: payout-${withdrawNo})

// 审核拒绝
POST /admin/finance/withdraw/audit
Body: { withdrawId, action: 'REJECT', rejectReason: '...' }
→ API calls walletService.unfreezeCash()
→ 冻结金额退回可用余额
```

### 8.3 [DepositList](docs/blog/articles/admin-next/finance-deposit-transaction-tracking.md) — 充值列表

[`DepositList`](apps/admin-next/src/views/finance/DepositList.tsx) 展示充值记录，通过 `financeApi.getDeposits()` 调用 API。

```
GET /admin/finance/deposits?page=1&pageSize=10
```

**手动同步机制**：对于 `PENDING` 状态的充值订单，管理员可以手动触发同步：

```typescript
// 点击同步按钮 → 调用 Xendit 查询接口
POST /admin/finance/recharge/sync
Body: { rechargeNo }
→ API calls paymentService.getInvoiceByExternalId(rechargeNo)
→ 如果 Xendit 返回 PAID，触发 handleInvoiceWebhook 同等逻辑
→ 订单标记为 SUCCESS，入账钱包
```

同步 API 返回三种状态：

| 响应 | 含义 | UI 反馈 |
|------|------|---------|
| `SYNCED_SUCCESS` | 同步成功，已入账 | 🟢 绿色成功提示 |
| `SYNCED_EXPIRED` | 发票已过期，无支付记录 | 🟡 黄色警告 |
| `PENDING` | 发票未支付 | 无变化 |

### 8.4 [TransactionList](docs/blog/articles/admin-next/finance-deposit-transaction-tracking.md) — 交易流水

[`TransactionList`](apps/admin-next/src/views/finance/TransactionList.tsx) 展示钱包交易流水，通过 `financeApi.getTransactions()` 调用 API。

```
GET /admin/finance/transactions?page=1&pageSize=10&type=RECHARGE|WITHDRAWAL
```

**AmountDisplay 颜色编码**：

| 交易类型 | 颜色 | 图标 |
|----------|------|------|
| 收入（充值/退款） | 🟢 emerald | `ArrowDownRight` |
| 支出（提现/消费） | 🔴 rose | `ArrowUpRight` |
| 冻结/解冻 | 🔵 blue | `Repeat` |

**余额快照**：每条交易记录附带操作前后的余额状态，便于财务对账。

### 8.5 渠道筛选

[`getChannelOptions`](apps/admin-next/src/views/finance/type.ts:70) 提供筛选选项：

```typescript
export function getChannelOptions(t: TLabelFn) {
  return [
    { label: t('finance.channels.gcash'), value: 'PH_GCASH' },
    { label: t('finance.channels.paymaya'), value: 'PH_PAYMAYA' },
    { label: t('finance.channels.grabpay'), value: 'PH_GRABPAY' },
    { label: t('finance.channels.bankTransfer'), value: 'PH_BDO' },
  ];
}
```

### 8.6 Server Action 缓存失效

管理员执行审核、调账、同步后，通过 Server Actions 使 ISR 缓存失效：

```typescript
// apps/admin-next/src/views/finance/finance-revalidate.ts
'use server';

export async function revalidateFinanceAfterWithdrawAudit() {
  revalidatePath('/[locale]/admin/finance/withdrawal');
  revalidatePath('/[locale]/admin/finance/transaction');
}

export async function revalidateFinanceAfterRechargeSync() {
  revalidatePath('/[locale]/admin/finance/deposit');
}

export async function revalidateFinanceAfterAdjust() {
  revalidatePath('/[locale]/admin/finance/transaction');
  revalidatePath('/[locale]/admin/finance/withdrawal');
}
```

| 操作 | 触发 revalidate |
|------|----------------|
| 提现审核通过/拒绝 | `revalidateFinanceAfterWithdrawAudit()` |
| 充值手动同步 | `revalidateFinanceAfterRechargeSync()` |
| 手动调账 | `revalidateFinanceAfterAdjust()` |

---

## 9. 安全架构总览

| 层次 | 安全措施 | 位置 |
|------|---------|------|
| **网关认证** | `XENDIT_CALLBACK_TOKEN` 比对 | [`PaymentWebhookController`](apps/api/src/client/wallet/payment-webhook.controller.ts:33) |
| **乐观锁** | `updateMany` + `WHERE status=PENDING` | [`handleInvoiceWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:128) |
| **金额双重校验** | `WHERE rechargeAmount = amount` | [`handleInvoiceWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:132) |
| **订单前缀校验** | `startsWith(BizPrefix.DEPOSIT/WITHDRAW)` | webhook 处理器 |
| **幂等性** | 二次回调检测已 SUCCESS | [`handleInvoiceWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:153) |
| **事务原子性** | Prisma `$transaction` | 所有写操作 |
| **冻结金额保护** | `updateMany` + `gte` + 强制扣减兜底 | [`handlePayoutWebhook`](apps/api/src/client/wallet/client-wallet.service.ts:259) |
| **代付幂等 Key** | `idempotencyKey: payout-${orderNo}` | [`PaymentService.createDisbursement`](apps/api/src/common/payment/payment.service.ts:101) |
| **金额下限保护** | `actualAmount ≤ 0` 拒绝提现 | [`applyWithdraw`](apps/api/src/client/wallet/client-wallet.service.ts:427) |
| **渠道状态检查** | `status: 1` 才允许操作 | `createRecharge` / `applyWithdraw` |

---

## 10. 工作流集成

### 10.1 充值全链路数据流

```
Flutter                     API                          admin-next
  │                          │                              │
  │  POST recharge/create    │                              │
  │ ──────────────────────►  │                              │
  │                          │ 1. 校验 paymentChannel       │
  │                          │ 2. 创建 rechargeOrder        │
  │                          │ 3. Xendit createInvoice     │
  │  ◄── { payUrl } ──────  │                              │
  │                          │                              │
  │  用户支付完成             │                              │
  │  ── Xendit Webhook ──►  │                              │
  │                          │ 4. handleInvoiceWebhook      │
  │                          │ 5. creditCash                │
  │                          │                              │
  │                          │             充值记录同步      │
  │                          │ ◄────────────────────────── │
  │                          │      (admin 手动同步)       │
  │                          │ ──────────────────────────► │
  │                          │    DepositList 显示成功      │
  │                          │    TransactionList 显示流水  │
```

### 10.2 提现全链路数据流

```
Flutter                     API                         admin-next
  │                          │                              │
  │  POST withdraw/apply     │                              │
  │ ──────────────────────►  │                              │
  │                          │ 1. 校验渠道 + 计算手续费      │
  │                          │ 2. freezeCash                │
  │                          │ 3. 创建 withdrawOrder        │
  │                          │                              │
  │                          │    提现记录同步到            │
  │                          │ ──────────────────────────► │
  │                          │    WithdrawalList 显示待审核  │
  │                          │                              │
  │                          │     管理员审核通过           │
  │                          │ ◄────────────────────────── │
  │                          │ 4. createDisbursement         │
  │                          │ 5. Xendit Payout API         │
  │                          │                              │
  │                          │  Xendit Payout Webhook       │
  │                          │ ◄────────────────────────── │
  │                          │                              │
  │                          │ 6. SUCCEEDED: unfreeze       │
  │                          │ 7. WithdrawalList 更新状态   │
  │                          │ ──────────────────────────► │
```

---

## 11. 与 C1 推送通知架构的对比

如同 [端到端推送通知](docs/blog/articles/admin-next/end-to-end-push-notification.md) 一样，支付系统也采用了 **三层回调架构**：

| 特性 | C1 FCM 推送 | C5 Xendit 支付 |
|------|-------------|----------------|
| 外部服务 | Firebase Cloud Messaging | Xendit Payment Gateway |
| API 封装 | [`NotificationService`](apps/api/src/client/notification/notification.service.ts:7) | [`PaymentService`](apps/api/src/common/payment/payment.service.ts:12) |
| 事件驱动 | `MessageCreatedEvent` → `PushListener` | Xendit Webhook → `handleUniversalWebhook` |
| 幂等性 | FCM 不保证去重，业务层处理 | 订单状态检查 + `idempotencyKey` |
| 回调认证 | 无（FCM 不提供） | `x-callback-token` 头验证 |
| 管理员操作 | 发送通知（Broadcast/Targeted） | 审核提现、手动同步充值 |
| 缓存刷新 | 推送日志 ISR | 财务页面 ISR revalidate |

---

## 12. 总结

本文详细介绍了项目的支付全链路实现：

- **[PaymentService](apps/api/src/common/payment/payment.service.ts:12)** — Xendit 网关封装层，提供 Invoice 创建、Payout 代付、回调验证功能
- **[ClientWalletService](apps/api/src/client/wallet/client-wallet.service.ts:43)** — 核心业务逻辑层：`createRecharge` 充值流程、`applyWithdraw` 提现流程、`handleInvoiceWebhook` / `handlePayoutWebhook` 回调处理
- **[WalletController](apps/api/src/client/wallet/wallet.controller.ts:37)** — 客户端接口层，提供 RESTful 端点
- **[PaymentWebhookController](apps/api/src/client/wallet/payment-webhook.controller.ts:17)** — 回调接收层，Token 验证 + 通用路由
- **admin-next 财务页面** — `WithdrawalList`（提现管理）、`DepositList`（充值管理）、`TransactionList`（流水追踪）、Server Action（ISR 缓存失效）

**核心设计原则**：
1. **乐观锁 + 幂等性**：不依赖 Xendit 去重，业务层保证每笔订单只处理一次
2. **事务一致性**：订单更新和钱包操作在一个 Prisma `$transaction` 中原子执行
3. **金额边界保护**：冻结金额临界保护、手续费超额拒绝、金额双重校验
4. **可追溯性**：每笔交易通过 `walletTransaction` 的 `relatedId` / `relatedType` 关联原始订单

### 相关文章

- [`finance-audit-withdrawal-adjust-workflow.md`](docs/blog/articles/admin-next/finance-audit-withdrawal-adjust-workflow.md) — 提现审核 + 手动调账 UI 实现
- [`finance-deposit-transaction-tracking.md`](docs/blog/articles/admin-next/finance-deposit-transaction-tracking.md) — 充值列表、交易流水 UI 实现
- [`full-stack-file-upload.md`](docs/blog/articles/admin-next/full-stack-file-upload.md) — 文件上传管道（另一跨项目集成案例）
- [`end-to-end-push-notification.md`](docs/blog/articles/admin-next/end-to-end-push-notification.md) — 端到端推送通知（三层回调架构对比）
