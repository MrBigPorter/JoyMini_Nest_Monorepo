---
title: '订单支付管道：优惠券 + 秒杀 + 金币 + 拼团四层价格计算'
description: '深入解析 NestJS 项目中的 OrderService.checkOut 方法，展示如何在 Prisma 事务中串联四层价格计算（秒杀、优惠券、金币、拼团）和五个子系统，涵盖乐观锁扣款、原子库存扣减与完整退款流程'
tags:
  - NestJS
  - E-commerce
  - Order
  - Payment
  - Flash Sale
  - Coupon
  - Prisma
---

# 订单支付管道：优惠券 + 秒杀 + 金币 + 拼团四层价格计算

## 1. 引言

订单支付系统是电商业务的核心——它需要在单个事务中完成价格计算、库存扣减、钱包扣款、优惠券核销、拼团加入等多个步骤，同时保证数据一致性。

本文将深入解析一个 NestJS 项目中的 [`checkOut`](apps/api/src/client/orders/order.service.ts:52) 方法（730 行 `OrderService`），展示如何在一个 Prisma 事务中串联四层价格计算和五个子系统。

## 2. 核心事务概览

### 2.1 Checkout 流程图

```
checkOut(userId, dto)
  │
  ├─ 1. 参数校验
  │    ├─ entries ≥ 1
  │    └─ paymentMethod ∈ {1(cash), 2(coin)}
  │
  ├─ 2. Prisma $transaction 开始
  │    │
  │    ├─ 2.1 汇率查询 (systemConfig.exchange_rate)
  │    │
  │    ├─ 2.2 商品校验
  │    │    ├─ state === ACTIVE?
  │    │    ├─ maxPerBuyQuantity 限制
  │    │    └─ 库存充足？
  │    │
  │    ├─ 2.3 单价决策
  │    │    ├─ 拼团价 (unitAmount)
  │    │    └─ 单独购买 (soloAmount)
  │    │
  │    ├─ 2.4 秒杀价覆盖 (可选)
  │    │    └─ 原子扣减 flash_stock
  │    │
  │    ├─ 2.5 优惠券抵扣 (可选)
  │    │    ├─ FULL_REDUCTION / DISCOUNT
  │    │    └─ 防御：不超过 originalAmount
  │    │
  │    ├─ 2.6 金币抵扣 (可选)
  │    │    └─ rate 转换 + coinBalance 检查
  │    │
  │    ├─ 2.7 钱包扣款
  │    │    ├─ debitCoin (乐观锁)
  │    │    └─ debitCash (乐观锁)
  │    │
  │    ├─ 2.8 原子库存扣减
  │    │    └─ $executeRaw UPDATE
  │    │
  │    ├─ 2.9 创建订单
  │    │
  │    ├─ 2.10 拼团加入/创建
  │    │
  │    └─ 2.11 更新订单 groupId
  │
  ├─ 3. 事务提交
  │
  └─ 4. 异步：发放抽奖券 (fire-and-forget)
```

### 2.2 价格计算链

```
originalAmount = unitPrice × entries
       │
       ▼
    - couponAmount   (优惠券)
       │
       ▼
    remainingAmount
       │
       ▼
    - coinAmount     (金币，按汇率转换)
       │
       ▼
    finalAmount      (最终现金支付额)
```

## 3. 第一层：秒杀价格注入

秒杀是最需要防超卖的场景。[`checkOut`](apps/api/src/client/orders/order.service.ts:171) 使用原始 SQL 原子操作来处理秒杀库存扣减。

### 3.1 秒杀校验

```typescript
if (flashSaleProductId) {
  const fsp = await tx.flashSaleProduct.findUnique({
    where: { id: flashSaleProductId },
    include: { session: true },
  });
  const now = new Date();

  if (!fsp) throw new BadRequestException('Flash sale product not found');
  if (fsp.treasureId !== treasureId)
    throw new BadRequestException('Flash sale product mismatch');
  if (fsp.session.status !== 1)
    throw new BadRequestException('Flash sale session is not active');
  if (now < fsp.session.startTime || now > fsp.session.endTime)
    throw new BadRequestException('Flash sale is not in progress');
```

完整校验链：商品关联 → 场次状态 → 时间窗口。

### 3.2 原子库存扣减

```typescript
const deducted = await tx.$executeRaw`
  UPDATE flash_sale_products
     SET flash_stock = flash_stock - ${entries}
   WHERE id = ${flashSaleProductId}
     AND flash_stock >= ${entries}
`;
if (deducted !== 1)
  throw new BadRequestException('Flash sale stock insufficient');
```

关键设计：**使用 `$executeRaw` 而非 Prisma 的 `update`**，因为原始 SQL 的 `WHERE flash_stock >= entries` 是真正的原子操作——数据库行锁 + 条件检查同时完成。如果使用 Prisma 的 `findFirst` + `update` 两步操作，在高并发下必然出现超卖。

## 4. 第二层：优惠券抵扣

[优惠券逻辑](apps/api/src/client/orders/order.service.ts:215) 支持两种类型，并对满减漏洞做了防御。

### 4.1 类型判断

```typescript
if (userCoupon.coupon.discountType === COUPON_TYPE.FULL_REDUCTION) {
  // 1 = Fixed amount deduction
  couponAmount = userCoupon.coupon.discountValue;
} else if (userCoupon.coupon.discountType === COUPON_TYPE.DISCOUNT) {
  // 2 = Percentage discount
  const discount = originalAmount.mul(
    userCoupon.coupon.discountValue.div(100),
  );
  const maxDiscount = userCoupon.coupon.maxDiscount
    ? userCoupon.coupon.maxDiscount
    : null;
  couponAmount =
    maxDiscount && discount.greaterThan(maxDiscount)
      ? maxDiscount
      : discount;
}
```

### 4.2 满减防御

这是最容易被忽视的问题：

```typescript
// 核心防御：优惠券抵扣金额【绝不能超过】商品原本的总价！
// 例如商品 50 块，满减券 100 块，实际只能抵扣 50 块。
if (couponAmount.greaterThan(originalAmount)) {
  couponAmount = originalAmount;
}
```

如果没有这一层防御，一张 100 元的满减券购买 50 元商品会导致 `remainingAmount` 变为负数，进而导致系统赚到"负收入"。

### 4.3 优惠券状态更新

```typescript
// 立即更新优惠券为已使用状态，并记录【真实抵扣金额】
await tx.userCoupon.update({
  where: { id: couponId },
  data: {
    status: 1,
    usedAt: new Date(),
    discountAmount: couponAmount,  // 记录实际抵扣金额
  },
});
```

注意 `discountAmount` 记录的是**实际抵扣金额**而非券面值（因为满减防御可能截断），这对财务对账至关重要。

## 5. 第三层：金币抵扣

[金币逻辑](apps/api/src/client/orders/order.service.ts:279) 实现了"金币 + 现金"混合支付。

### 5.1 汇率转换

```typescript
const w = await this.wallet.ensureWallet(userId, tx);
const coinsNeededForRemaining = remainingAmount.mul(rate);
```

汇率来自 `systemConfig` 表的 `exchange_rate` 配置项，在事务开始时查询以确保一致性。

### 5.2 金币上限控制

```typescript
const maxCoinUsable = coinsNeededForRemaining;
const canUseCoins = w.coinBalance.lessThan(maxCoinUsable)
  ? w.coinBalance
  : maxCoinUsable;

coinUsed = canUseCoins;
coinAmount = canUseCoins.div(rate);
```

```
示例：
  商品价格: 100 元
  优惠券扣减: 30 元
  remainingAmount: 70 元
  汇率: 10 (1元 = 10金币)
  需要金币: 700
  用户余额: 500 金币
  
  实际使用: min(500, 700) = 500 金币
  coinAmount: 500 / 10 = 50 元
  finalAmount: 70 - 50 = 20 元 (现金支付)
```

### 5.3 钱包扣款

```typescript
if (paymentMethod == 2 && coinUsed.gt(0)) {
  const { transactionId: coinTxnId } = await this.wallet.debitCoin(
    { userId, coins: coinUsed, ... },
    tx,
  );
}

if (finalAmount.gt(0)) {
  const { transactionId } = await this.wallet.debitCash(
    { userId, amount: finalAmount, ... },
    tx,
  );
}
```

wallet 的 `debitCoin` / `debitCash` 方法内部使用 `RealBalance Update with WHERE realBalance >= amount` 的乐观锁模式（详见[钱包乐观锁文章](docs/blog/articles/backend/nestjs-wallet-optimistic-locking.md)），在事务上下文中执行保证了扣款一致性。

## 6. 库存扣减：原子操作

所有价格计算完成后，进行最终的库存扣减：

```typescript
const uqd = await tx.$executeRaw`
  UPDATE treasures
     SET seq_buy_quantity = seq_buy_quantity + ${entries}
   WHERE treasure_id = ${treasureId}
     AND state = ${TREASURE_STATE.ACTIVE}
     AND (seq_shelves_quantity - seq_buy_quantity) >= ${entries}
`;

if (uqd !== 1) {
  throw new BadRequestException('insufficient treasure stock');
}
```

这个 `$executeRaw` 的原子操作包含三个条件：

| 条件 | 目的 |
|------|------|
| `state = ACTIVE` | 防止商品已被下架/删除后继续售卖 |
| `(seq_shelves_quantity - seq_buy_quantity) >= entries` | 真正的库存校验，利用数据库行锁 |
| `SET seq_buy_quantity = seq_buy_quantity + entries` | 原地增量，无需先查询 |

这样设计的本质是**将库存计算交给数据库**，而不是在应用层做"查询→判断→更新"三步操作——那在高并发下必然出现超卖。

## 7. 拼团集成

库存扣减和订单创建完成后，如果是拼团模式（`isSoloBuy === false`），调用 GroupService 的 [`joinOrCreateGroup`](apps/api/src/client/orders/order.service.ts:428)：

```typescript
if (!isSoloBuy) {
  const res = await this.group.joinOrCreateGroup(
    { userId, treasureId, orderId: order.orderId, groupId: groupId },
    tx,
  );
  finalGroupId = res.finalGroupId;
  isOwner = res.isOwner;
  alreadyInGroup = res.alreadyInGroup;
}

await tx.order.update({
  where: { orderId: order.orderId },
  data: { groupId: finalGroupId, isGroupOwner: isOwner },
});
```

注意 `joinOrCreateGroup` 接受 `tx`（`Prisma.TransactionClient`）参数，确保拼团创建在同一事务中——如果后续步骤失败，拼团操作也会回滚。

## 8. 异步发放抽奖券

事务提交后，使用 `setImmediate` **异步**发放福利抽奖券：

```typescript
if (dto.isGroup === false) {
  setImmediate(() => {
    this.luckyDraw
      .issueTicketForOrder(userId, dto.treasureId, result.orderId)
      .catch((e: unknown) => {
        this.logger.warn(
          `LuckyDraw solo ticket failed for order ${result.orderId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });
  });
}
```

设计考量：

| 决策 | 理由 |
|------|------|
| **`setImmediate` 而非 `await`** | 抽奖券发放不是支付核心链路，失败不应阻塞下单 |
| **`catch` 吞掉异常** | 只记录 warn 日志，不影响用户体验 |
| **仅在 solo buy 时触发** | 拼团成功后另有抽奖逻辑 |
| **`issueTicketForOrder` 可重入** | 即使发放失败，用户仍可联系客服补发 |

## 9. 退款流程

[`applyRefund`](apps/api/src/client/orders/order.service.ts:484) 实现了退款申请的状态机转换。

### 9.1 状态校验链

```typescript
// 1. 订单归属校验
if (order.userId !== userId)
  throw new ForbiddenException('You do not have permission to refund');

// 2. 支付状态校验（必须已支付）
if (order.payStatus !== PAY_STATUS.PAID || order.orderStatus !== ORDER_STATUS.PAID)
  throw new BadRequestException('Only paid orders can be refunded');

// 3. 重复退款校验
if (order.refundStatus !== REFUND_STATUS.NO_REFUND)
  throw new BadRequestException('Refund is already in progress or completed.');
```

### 9.2 状态转换

```
NO_REFUND(0) → REFUNDING(1) → REFUNDED(2)
                              → REFUND_FAILED(3)
```

## 10. 订单列表与筛选

[`listOrders`](apps/api/src/client/orders/order.service.ts:532) 通过 [`whereByStatus`](apps/api/src/client/orders/order.service.ts:685) 实现状态筛选：

```typescript
private whereByStatus(userId, status, treasureId?): Prisma.OrderWhereInput {
  switch (status) {
    case 'paid':
      return { ...base, payStatus: PS.PAID, orderStatus: OS.PAID,
               refundStatus: RS.NO_REFUND };
    case 'unpaid':
      return { ...base, payStatus: PS.UNPAID, orderStatus: OS.PENDING_PAYMENT };
    case 'refunded':
      return { ...base, refundStatus: { in: [RS.REFUNDING, RS.REFUNDED, RS.REFUND_FAILED] } };
    case 'cancelled':
      return { ...base, orderStatus: OS.CANCELED };
    default:
      return base;
  }
}
```

关键设计：**"已支付"订单排除 `refundStatus !== NO_REFUND`** 的记录——一旦订单进入退款流程（无论成功还是失败），就不应再出现在"已支付"列表中。这确保了用户界面上的数据一致性。

## 11. 架构总结

### 11.1 子系统依赖关系

```
OrderService
  │
  ├─ WalletService      — 钱包扣款（乐观锁防超扣）
  ├─ GroupService       — 拼团管理（事务内创建/加入）
  ├─ LuckyDrawService   — 抽奖券发放（异步非阻塞）
  ├─ PrismaService      — 数据库（事务、原子SQL）
  └─ @lucky/shared      — 枚举常量、OrderNoHelper
```

### 11.2 防超卖的三层保险

| 层级 | 机制 | 对象 |
|------|------|------|
| 第一层 | 事务前商品查询 + 库存估算 | 应用层 |
| 第二层 | `$executeRaw` 原子 `UPDATE` + `WHERE` 条件 | 数据库层 |
| 第三层 | 钱包乐观锁 `update where { realBalance: { gte: amt } }` | 数据库层 |

### 11.3 金额计算安全检查

```
金额检查点：
  1. couponAmount ≤ originalAmount    （防御满减超限）
  2. remainingAmount = max(0, 余量)     （防止负数）
  3. coinUsed ≤ coinBalance             （防止透支）
  4. finalAmount + coinAmount + couponAmount = originalAmount（会计恒等式）
```

### 11.4 设计模式

1. **事务性工作单元（Unit of Work）**——整个 checkout 在一个 `$transaction` 中完成，任一环节失败全部回滚
2. **乐观锁 + 原子 SQL**——钱包用 Prisma 乐观锁，库存用原生 SQL 原子操作，各取所长
3. **异步非核心路径**——抽奖券发放使用 `setImmediate` + `catch`，确保不影响主流程
4. **状态机模式**——订单状态 `UNPAID → PAID → REFUNDING → REFUNDED` 严格单向流转

---

*本文源码基于 [`apps/api/src/client/orders/order.service.ts`](apps/api/src/client/orders/order.service.ts)（730行），完整包含 checkout 事务、秒杀原子库存、优惠券满减防御、金币汇率转换、拼团集成、退款流程、订单筛选等全部实现。*
