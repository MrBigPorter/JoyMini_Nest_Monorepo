# LuckyDrawService 抽奖系统：加权随机 + 原子化票务引擎

> **源码参考**: [`lucky-draw.service.ts`](apps/api/src/common/lucky-draw/lucky-draw.service.ts) (478 行)

---

## 概述

`LuckyDrawService` 实现了完整的 **抽奖/彩票系统**，用于拼团成功后的用户抽奖。核心功能：

- **出票**: 拼团成功后自动发放抽奖券（Ticket）
- **开奖**: 加权随机抽奖 + 原子化防重
- **奖品发放**: 优惠券/金币/现金/谢谢参与
- **查询**: 票务列表 + 开奖结果分页

---

## 数据模型

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ LuckyDraw   │     │ LuckyDraw    │     │ LuckyDraw    │
│ Activity    │──┬──│ Ticket       │──┬──│ Result       │
│             │  │  │              │  │  │              │
│ - id        │  │  │ - id         │  │  │ - id         │
│ - startDate │  │  │ - userId     │  │  │ - ticketId   │
│ - endDate   │  │  │ - activityId │  │  │ - prizeType  │
│ - status    │  │  │ - orderId    │  │  │ - prizeName  │
│ - rules     │  │  │ - isUsed     │──┘  │ - isWin      │
└─────────────┘  │  │ - createdAt  │     │ - drawnAt    │
                 │  └──────────────┘     └──────────────┘
                 │  ┌──────────────────┐
                 └──│ LuckyDrawPrize   │
                    │                  │
                    │ - activityId     │
                    │ - prizeType      │ (1=coupon, 2=coin, 3=cash, 4=none)
                    │ - totalQuantity  │
                    │ - drawnQuantity  │
                    │ - weight         │ (0-10000, 加权)
                    └──────────────────┘
```

---

## 1. 出票系统

### 1.1 批量出票 — `issueTicketsForGroup()`

```typescript
async issueTicketsForGroup(groupId: string): Promise<void> {
  const group = await this.prisma.treasureGroup.findUnique({
    where: { id: groupId },
    include: { members: true },
  });

  // 为每个成员发一张票
  for (const member of group.members) {
    this.issueTicketForOrder(member.userId, member.orderId).catch(
      (e: unknown) => {
        this.logger.error(`Failed to issue ticket for order ${member.orderId}`, e);
      },
    );
  }
}
```

关键设计点 — **fire-and-forget**: 使用 `.catch()` 而不是 `await`，确保一个成员的出票失败不影响其他成员。

### 1.2 单张出票 — `issueTicketForOrder()`

```typescript
async issueTicketForOrder(userId: string, orderId: string): Promise<void> {
  const activity = await this.findActiveActivity(null);
  if (!activity) return;  // 没有进行中的活动

  await this.issueOneTicket(userId, orderId, activity.id).catch(
    (e: unknown) => {
      this.logger.error(`Issue ticket failed for user ${userId}`, e);
    },
  );
}

private async issueOneTicket(
  userId: string, orderId: string, activityId: string,
) {
  // 1. 查找未使用的票
  const existingTicket = await this.prisma.luckyDrawTicket.findFirst({
    where: { userId, orderId, isUsed: false },
  });

  if (existingTicket) return; // 已有未使用的票，不重复发放

  // 2. 创建新票
  const ticket = await this.prisma.luckyDrawTicket.create({
    data: { userId, orderId, activityId },
  });

  // 3. Socket 通知
  this.eventsGateway.notifyUser(userId, 'lucky_draw_ticket_issued', {
    ticketId: ticket.id,
    activityId,
  });
}
```

---

## 2. 核心抽奖引擎 — `draw()`

这是最复杂的函数（约 140 行），采用 **事务内原子化** 设计：

### 2.1 完整流程

```typescript
async draw(userId: string, ticketId: string): Promise<DrawResult> {
  return this.prisma.$transaction(async (tx) => {
    // Step 1: 原子锁定票
    // 使用 $executeRaw UPDATE 防止并发抽奖
    const updated = await tx.$executeRaw`
      UPDATE lucky_draw_tickets
      SET is_used = true
      WHERE id = ${ticketId}
        AND user_id = ${userId}
        AND is_used = false
    `;

    if (updated === 0) {
      throw new BadRequestException('Ticket already used or not found');
    }

    // Step 2: 查询票详情
    const ticket = await tx.luckyDrawTicket.findUnique({
      where: { id: ticketId },
    });

    // Step 3: 获取活动奖品
    const prizes = await tx.luckyDrawPrize.findMany({
      where: {
        activityId: ticket.activityId,
        status: 'ACTIVE',
      },
    });

    if (prizes.length === 0) {
      return this.createResult('no_prize', ticket); // 仅记录
    }

    // Step 4: 加权随机选择
    const selectedPrize = this.weightedRandomSelection(prizes);

    // Step 5: 原子扣减库存（使用原始 SQL 防并发）
    const deducted = await tx.$executeRaw`
      UPDATE lucky_draw_prizes
      SET drawn_quantity = drawn_quantity + 1
      WHERE id = ${selectedPrize.id}
        AND drawn_quantity < total_quantity
    `;

    if (deducted === 0) {
      // 库存不足，回退到谢谢参与
      return this.fallbackToThankYou(ticket, tx);
    }

    // Step 6: 发放奖品
    const result = await this.deliverPrize(selectedPrize, ticket, tx);

    // Step 7: 记录开奖结果
    await tx.luckyDrawResult.create({
      data: {
        ticketId: ticket.id,
        userId: ticket.userId,
        prizeId: selectedPrize.id,
        prizeType: selectedPrize.prizeType,
        prizeName: selectedPrize.prizeName,
        isWin: selectedPrize.prizeType !== 4,
        drawnAt: new Date(),
      },
    });

    return result;
  });
}
```

### 2.2 加权随机算法

```typescript
private weightedRandomSelection(prizes: any[]): any {
  // 计算总权重
  const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);

  // 生成随机数 (0 ~ totalWeight)
  const random = Math.floor(Math.random() * totalWeight);

  // 权重累积选择
  let cumulativeWeight = 0;
  for (const prize of prizes) {
    cumulativeWeight += prize.weight;
    if (random < cumulativeWeight) {
      return prize;
    }
  }

  // 兜底：返回最后一个奖品
  return prizes[prizes.length - 1];
}
```

**算法原理**:
- 每个奖品配置 `weight`（权重值，范围 0-10000）
- 计算总权重（如 10000）
- 生成 `[0, 10000)` 的随机数
- 按权重累积分布选择奖品

示例：
```
奖品 A: weight=1000  (10%)
奖品 B: weight=2000  (20%)
奖品 C: weight=3000  (30%)
奖品 D: weight=4000  (40%)

随机数 0-999   → 奖品 A
随机数 1000-2999 → 奖品 B
随机数 3000-5999 → 奖品 C
随机数 6000-9999 → 奖品 D
```

### 2.3 原子扣减

无论是锁定票还是扣减库存，都使用 `$executeRaw` 原始 SQL 而不是 Prisma 的 `update`：

```sql
UPDATE lucky_draw_tickets
SET is_used = true
WHERE id = ${ticketId}
  AND user_id = ${userId}
  AND is_used = false
```

**为什么用 `$executeRaw` 而不是 `update`？**

| 方面 | `prisma.update` | `$executeRaw UPDATE` |
|------|----------------|---------------------|
| 原子性 | ✅ WHERE 条件 | ✅ WHERE 条件 |
| 返回值 | 抛出 `NotFoundError` (affected=0) | 返回 `affected rows count` |
| 并发安全 | 依赖 Prisma client | 原生 PostgreSQL 行锁 |
| 控制流 | try/catch 异常 | `if (updated === 0)` 条件分支 |

使用 `$executeRaw` 可以精确控制 affected rows = 0 时的逻辑流（走 `fallbackToThankYou` 分支）。

### 2.4 回退链

```typescript
private async fallbackToThankYou(ticket: any, tx: Tx): Promise<DrawResult> {
  // 查找谢谢参与奖
  const thankYouPrize = await tx.luckyDrawPrize.findFirst({
    where: {
      activityId: ticket.activityId,
      prizeType: 4,  // prizeType=4 = 谢谢参与
    },
  });

  return {
    prizeType: 4,
    prizeName: thankYouPrize?.prizeName || 'Thank you',
    prizeValue: null,
    isWin: false,
    resultId: null,
    drawnAt: new Date(),
  };
}
```

**回退链优先级**:
1. 首选奖品 → 库存不足
2. `fallbackToThankYou` → 发谢谢参与奖
3. 无需事务回滚 — 因为抽奖不是关键业务，发谢谢参与也能完成用户体验

---

## 3. 奖品发放 — `deliverPrize()`

### 3.1 奖品类型

| prizeType | 奖品类型 | 发放逻辑 |
|-----------|----------|----------|
| 1 | 优惠券 | `issueCouponInTx()` — 创建用户优惠券记录 |
| 2 | 金币 | `walletService.creditCoin()` — 增加用户金币 |
| 3 | 现金 | `walletService.creditCash()` — 增加用户现金余额 |
| 4 | 谢谢参与 | 仅记录结果，不发放 |

### 3.2 优惠券发放

```typescript
private async issueCouponInTx(
  couponDefId: string, userId: string, tx: Tx,
) {
  // 1. 验证优惠券定义
  const couponDef = await tx.couponDefinition.findUnique({
    where: { id: couponDefId },
  });

  if (!couponDef || couponDef.status !== 'ACTIVE') {
    throw new Error('Coupon definition not available');
  }

  if (couponDef.totalQuantity <= couponDef.issuedQuantity) {
    throw new Error('Coupon quantity exhausted');
  }

  // 2. 创建用户优惠券
  const userCoupon = await tx.userCoupon.create({
    data: {
      userId,
      couponDefinitionId: couponDefId,
      code: this.generateCouponCode(),
      status: 'ACTIVE',
      validFrom: this.calculateValidFrom(couponDef),
      validTo: this.calculateValidTo(couponDef),
    },
  });

  // 3. 增加已发放数量
  await tx.couponDefinition.update({
    where: { id: couponDefId },
    data: { issuedQuantity: { increment: 1 } },
  });

  return userCoupon;
}
```

**`validType` 两种模式**:
- `validType = 1` (日期范围): 使用预设的 `validFrom` / `validTo`
- `validType = 2` (相对天数): 从领取时开始计算 `NOW() + validDays`

---

## 4. 查询接口

### 4.1 `listTickets()` — 票务列表

```typescript
async listTickets(
  userId: string,
  opts: { page: number; pageSize: number },
) {
  const where = { userId };

  const [list, total] = await Promise.all([
    this.prisma.luckyDrawTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    this.prisma.luckyDrawTicket.count({ where }),
  ]);

  return {
    list: list.map(t => ({
      id: t.id,
      isUsed: t.isUsed,
      createdAt: t.createdAt,
      activityId: t.activityId,
    })),
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}
```

### 4.2 `listResults()` — 开奖结果

```typescript
async listResults(userId: string, opts: { page: number; pageSize: number }) {
  const where = { userId };

  const [list, total] = await Promise.all([
    this.prisma.luckyDrawResult.findMany({
      where,
      orderBy: { drawnAt: 'desc' },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    this.prisma.luckyDrawResult.count({ where }),
  ]);

  return {
    list: list.map(r => ({
      id: r.id,
      prizeType: r.prizeType,
      prizeName: r.prizeName,
      isWin: r.isWin,
      drawnAt: r.drawnAt,
    })),
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}
```

---

## 5. 活动查询

```typescript
private async findActiveActivity(treasureId: string | null) {
  const now = new Date();

  return this.prisma.luckyDrawActivity.findFirst({
    where: {
      status: 'ACTIVE',
      startDate: { lte: now },
      endDate: { gte: now },
      ...(treasureId ? {
        OR: [
          { applicableTreasures: { has: treasureId } },
          { applicableTreasures: { equals: [] } }, // 空数组 = 所有商品
        ],
      } : {}),
    },
  });
}
```

**`OR` 条件设计**: `applicableTreasures` 数组为空表示该活动适用于所有商品；有值时只限于指定商品。

---

## 6. 事务边界与并发控制

| 操作 | 事务 | 并发控制 |
|------|------|----------|
| 出票 | 无事务（fire-and-forget） | 查重（先查是否存在未使用票） |
| 抽奖 | ✅ `$transaction` | `$executeRaw` 原子 UPDATE |
| 库存扣减 | ✅ 同一事务 | `$executeRaw` + WHERE 条件 |
| 优惠券发放 | ✅ 同一事务 | `issuedQuantity` 递增检查 |
| 结果记录 | ✅ 同一事务 | 无竞争（各用户独立） |

---

## 总结

`LuckyDrawService` 展示了高并发场景下的抽奖系统设计：

1. **原子锁票**: 使用 `$executeRaw UPDATE ... WHERE is_used = false` 防止同一张票被多次抽奖
2. **加权随机**: 基于权重数组的累积分布算法，精确控制中奖概率
3. **原子库存**: 使用原始 SQL 条件更新防止奖品超发
4. **优雅降级**: 库存不足时自动回退到"谢谢参与"奖
5. **事务内发放**: 优惠券/金币/现金的发放都在同一个事务中完成
6. **Fire-and-forget 出票**: 出票失败不影响拼团主流程
