# GroupService 拼团系统：Redis 乐观锁 + BullMQ 结算队列

> **源码参考**: [`group.service.ts`](apps/api/src/common/group/group.service.ts) (672 行)

---

## 概述

`GroupService` 实现了 **拼团（Group Buying）** 的完整生命周期，是平台电商模块的核心引擎。它涉及：

- **拼团创建与加入**: 用户发起/参与拼团
- **机器人自动填团**: 30 秒定时器填满未完成的团
- **成团结算**: 通过 BullMQ `group_settlement` 队列异步处理
- **超时处理**: 每分钟检查过期团并退款
- **Socket 通知**: 实时推送拼团状态变化

---

## 架构总览

```
                  ┌──────────────┐
                  │  joinOrCreate │
                  │  Group()     │
                  └──────┬───────┘
                         │
              ┌──────────┴──────────┐
              │                     │
     ┌────────▼────────┐  ┌────────▼────────┐
     │  Existing Group  │  │  New Group       │
     │  (optimistic     │  │  (create + join) │
     │   lock check)    │  │                  │
     └────────┬─────────┘  └────────┬─────────┘
              │                     │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  Check Group        │
              │  Capacity Reached?  │
              └──────┬──────┬───────┘
                     │      │
                     YES    NO
                     │      │
            ┌────────▼┐     │ (wait for robots)
            │  Handle │     │
            │  Success│     │
            └────┬────┘     │
                 │          │
         ┌───────▼──────┐   │
         │ BullMQ Queue │   │
         │  settlement  │   │
         └──────────────┘   │
                            │
                    ┌───────▼───────┐
                    │  Cron: 30s   │
                    │  Robot Fill  │
                    └───────────────┘
```

---

## 1. 加入/创建拼团 — `joinOrCreateGroup()`

这是入口方法，处理两种路径：

### 1.1 加入已有团

```typescript
async joinOrCreateGroup(
  userId: string,
  treasureId: string,
  quantity: number = 1,
) {
  // 1. 查找可加入的团
  const availableGroup = await this.prisma.treasureGroup.findFirst({
    where: {
      treasureId,
      status: 'PENDING',
      currentQuantity: { lt: this.prisma.treasureGroup.fields.minQuantity },
      NOT: { members: { some: { userId } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (availableGroup) {
    // 2. 乐观锁加入
    const result = await this.prisma.$transaction(async (tx) => {
      // 版本号检查（乐观锁）
      const group = await tx.treasureGroup.findUnique({
        where: { id: availableGroup.id },
      });

      if (group.version !== availableGroup.version) {
        throw new ConcurrencyError('Group was modified concurrently');
      }

      // 更新数量 + 版本号
      const updated = await tx.treasureGroup.update({
        where: { id: group.id },
        data: {
          currentQuantity: { increment: quantity },
          version: { increment: 1 },
        },
      });

      // 创建 member 记录
      await tx.groupMember.create({
        data: { groupId: group.id, userId, quantity },
      });

      return updated;
    });

    // 3. 检查是否达到成团条件
    if (result.currentQuantity >= result.minQuantity) {
      await this.handleGroupSuccessInTx(result.id);
    }

    return result;
  }

  // 创建新团...
}
```

**乐观锁原理**: 使用 `version` 字段比较——读取时记录版本号，更新时 `version: { increment: 1 }` + `where: { version: oldVersion }`。如果并发修改导致版本不匹配，`update` 不会匹配任何记录（affected rows = 0），但 Prisma 的 `update` 在这种情况下会抛 `NotFoundError`。

### 1.2 创建新团

```typescript
// 创建新团
const newGroup = await this.prisma.treasureGroup.create({
  data: {
    treasureId,
    creatorId: userId,
    minQuantity: treasure.minQuantity,   // 成团人数
    currentQuantity: quantity,
    maxQuantity: treasure.maxQuantity,   // 封团人数
    status: 'PENDING',
    version: 1,
    members: {
      create: { userId, quantity },
    },
  },
  include: { members: true },
});

// 触发头像更新
this.triggerAvatarUpdate(newGroup.id);

// 通知 lobby
this.notifyGroupChange(newGroup.id);

return newGroup;
```

---

## 2. 机器人自动填团 — `handleRobotIntervention()`

### 2.1 Cron 调度

```typescript
@Cron(CronExpression.EVERY_30_SECONDS)
async handleRobotIntervention() {
  return await this.lockService.runWithLock(
    'group:robot:fill',
    5000,  // 5 秒 TTL
    async () => {
      const pendingGroups = await this.prisma.treasureGroup.findMany({
        where: {
          status: 'PENDING',
          currentQuantity: { lt: this.prisma.treasureGroup.fields.minQuantity },
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: 5,  // 每次最多处理 5 个团
      });

      for (const group of pendingGroups) {
        await this.fillSingleRobot(group);
      }
    },
  );
}
```

**关键设计**:
- `EVERY_30_SECONDS` — 30 秒轮询
- `group:robot:fill` — Redis 分布式锁防止多实例并发
- `take: 5` — 每次最多填 5 个团，避免一次性处理太多
- `expiresAt: { gt: new Date() }` — 只处理未过期的团

### 2.2 单个机器人填充

```typescript
private async fillSingleRobot(group: any) {
  await this.prisma.$transaction(async (tx) => {
    // 1. 乐观锁更新
    const updated = await tx.treasureGroup.updateMany({
      where: {
        id: group.id,
        version: group.version,
        currentQuantity: { lt: tx.treasureGroup.fields.minQuantity },
      },
      data: {
        currentQuantity: { increment: 1 },
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) return; // 被并发抢了

    // 2. 检查是否成团
    const freshGroup = await tx.treasureGroup.findUnique({
      where: { id: group.id },
    });

    const shouldTriggerSuccess =
      freshGroup.currentQuantity >= freshGroup.minQuantity;

    // 3. 创建机器人成员
    await tx.groupMember.create({
      data: {
        groupId: group.id,
        userId: ROBOT_USER_ID,
        quantity: 1,
        isRobot: true,
      },
    });

    return { shouldTriggerSuccess };
  });

  // 4. 异步处理成团信号（事务外）
  if (result?.shouldTriggerSuccess) {
    await this.handleGroupSuccessInTx(group.id);
  }
}
```

**`updateMany` 代替 `update`**: 这里使用 `updateMany` 而不是 `update`，因为 `updateMany` 在 affected rows = 0 时不会抛异常，而是返回 `{ count: 0 }`。这更适合乐观锁场景。

---

## 3. 成团处理 — `handleGroupSuccessInTx()`

### 3.1 事务内处理

```typescript
private async handleGroupSuccessInTx(groupId: string) {
  await this.prisma.$transaction(async (tx) => {
    // 1. 更新团状态
    await tx.treasureGroup.update({
      where: { id: groupId },
      data: { status: 'SUCCESS' },
    });

    // 2. 为每个成员创建订单
    const members = await tx.groupMember.findMany({
      where: { groupId },
      include: { user: true },
    });

    for (const member of members) {
      await tx.order.create({
        data: {
          userId: member.userId,
          groupId,
          quantity: member.quantity,
          status: 'PENDING',
        },
      });
    }
  });

  // 3. 事务外发送成功信号
  setImmediate(() => {
    this.emitGroupSuccessSignal(groupId);
  });
}
```

**`setImmediate`**: 将 Socket 通知和队列任务放在事务外，避免事务长时间占用数据库连接。

### 3.2 成功信号

```typescript
private async emitGroupSuccessSignal(groupId: string) {
  // 1. 添加结算队列
  await this.settlementQueue.add('group_settlement', {
    groupId,
    type: 'settlement',
  });

  // 2. Socket 通知
  this.notifyGroupChange(groupId);

  // 3. 触发头像更新
  this.triggerAvatarUpdate(groupId);
}
```

---

## 4. 超时处理 — `handleExpiredGroups()`

### 4.1 Cron 调度

```typescript
@Cron(CronExpression.EVERY_MINUTE)
async handleExpiredGroups() {
  return await this.lockService.runWithLock(
    'group:expire',
    30000,
    async () => {
      const expiredGroups = await this.prisma.treasureGroup.findMany({
        where: {
          status: 'PENDING',
          expiresAt: { lt: new Date() },
        },
        take: 50,  // 批量处理 50 个
      });

      // Promise.allSettled 确保不互相影响
      const results = await Promise.allSettled(
        expiredGroups.map(g => this.processGroupFailure(g.id))
      );

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          this.logger.error(`Failed to expire group ${expiredGroups[i].id}`, r.reason);
        }
      });
    },
  );
}
```

**`Promise.allSettled` 的重要性**: 与 `Promise.all` 不同，`allSettled` 不会因为某个团退款失败而影响其他团的退款。50 个团中即便有 3 个处理失败，其余 47 个仍能正常退款。

### 4.2 退款处理

```typescript
private async processGroupFailure(groupId: string) {
  await this.prisma.$transaction(async (tx) => {
    // 1. 更新团状态
    await tx.treasureGroup.update({
      where: { id: groupId },
      data: { status: 'FAILED' },
    });

    // 2. 获取所有成员
    const members = await tx.groupMember.findMany({
      where: { groupId },
    });

    // 3. 逐个退款
    for (const member of members) {
      await this.refundSingleOrder(
        { userId: member.userId, quantity: member.quantity },
        tx,
      );
    }
  });

  // 4. 通知
  await this.notifyMembersOfResult(groupId, false);
  this.notifyGroupChange(groupId);
}
```

### 4.3 `refundSingleOrder()` — 三方退款

```typescript
private async refundSingleOrder(order: any, tx: Tx) {
  // 1. 现金退款
  await this.walletService.creditCash({
    userId: order.userId,
    amount: order.totalCash,
    tx,  // 同一个事务
  });

  // 2. 金币退款
  await this.walletService.creditCoin({
    userId: order.userId,
    amount: order.totalCoin,
    tx,
  });

  // 3. 恢复秒杀库存（如果是闪购商品）
  if (order.flashSaleId) {
    await tx.$executeRaw`
      UPDATE flash_sale_products
      SET sold_quantity = sold_quantity - ${order.quantity}
      WHERE id = ${order.flashSaleProductId}
    `;
  }
}
```

**事务内退款**: 使用 `tx` 参数确保所有退款操作在同一个 Prisma 事务中执行，要么全部成功，要么全部回滚。

---

## 5. Socket 通知系统

### 5.1 `notifyGroupChange()`

```typescript
private async notifyGroupChange(groupId: string) {
  const group = await this.prisma.treasureGroup.findUnique({
    where: { id: groupId },
    include: {
      treasure: {
        select: { id: true, title: true, image: true },
      },
      _count: { select: { members: true } },
    },
  });

  // 广播到 lobby
  this.eventsGateway.broadcastToLobby({
    type: 'group_update',
    data: {
      id: group.id,
      status: group.status,
      currentQuantity: group.currentQuantity,
      minQuantity: group.minQuantity,
      updatedAt: new Date().toISOString(),  // 前端 dedup 用
    },
  });
}
```

**前端 Dedup**: `updatedAt` 时间戳用于前端去重——如果连续收到两个相同 `updatedAt` 的更新，只处理一次。

---

## 6. 头像队列

```typescript
private triggerAvatarUpdate(groupId: string) {
  this.avatarQueue.add('treasure_group_avatar', {
    groupId,
  }, {
    jobId: `avatar_${groupId}`,  // 去重 key
    removeOnComplete: true,
  });
}
```

**`jobId` 去重**: BullMQ 的 `jobId` 选项确保同一团不会同时有多个头像生成任务排队。如果已有相同 `jobId` 的任务在队列中，新任务会被忽略。

---

## 7. 查询接口

### 7.1 `listGroupForTreasure()`

```typescript
async listGroupForTreasure(treasureId: string, page: number, pageSize: number) {
  const where = {
    treasureId,
    status: 'PENDING' as const,
  };

  const [groups, total] = await Promise.all([
    this.prisma.treasureGroup.findMany({
      where,
      include: {
        _count: { select: { members: true } },
        treasure: {
          select: { title: true, image: true, price: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    this.prisma.treasureGroup.count({ where }),
  ]);

  return {
    list: groups.map(g => ({
      id: g.id,
      currentQuantity: g.currentQuantity,
      minQuantity: g.minQuantity,
      maxQuantity: g.maxQuantity,
      expiresAt: g.expiresAt,
      memberCount: g._count.members,
      treasure: g.treasure,
    })),
    total,
    page,
    pageSize,
  };
}
```

### 7.2 `getGroupDetail()`

```typescript
async getGroupDetail(groupId: string) {
  return this.prisma.treasureGroup.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, nickname: true, avatar: true },
          },
        },
      },
      treasure: true,
    },
  });
}
```

---

## 8. 完整生命周期状态机

```
                  ┌──────────┐
                  │  PENDING │ (初始状态)
                  └────┬─────┘
                       │
            ┌──────────┼──────────┐
            │          │          │
     ┌──────▼────┐  ┌──▼───┐  ┌──▼──────┐
     │ current >= │  │ time │  │ current │
     │ min        │  │ out  │  │ < min   │
     └──────┬─────┘  └──┬───┘  └──┬──────┘
            │           │         │
     ┌──────▼────┐  ┌──▼───────┐ │ (robot fills)
     │  SUCCESS  │  │  FAILED  │ │
     │           │  │          │ │
     │ → settle  │  │ → refund │ │
     │ → tickets │  │ → notify │ │
     └───────────┘  └──────────┘ │
                                 │
                          ┌──────▼──────┐
                          │  PENDING    │ (loop: 30s cron)
                          │  (retry)    │
                          └─────────────┘
```

---

## 总结

`GroupService` 展示了 NestJS 中复杂电商业务的最佳实践：

| 关注点 | 实现 |
|--------|------|
| **并发控制** | `version` 乐观锁 + `updateMany` 无异常模式 |
| **异步处理** | BullMQ `group_settlement` 队列 |
| **定时任务** | `@Cron` 30 秒/分钟 + Redis 分布式锁 |
| **容错** | `Promise.allSettled` 批量处理 |
| **实时通知** | Socket `broadcastToLobby` + FCM Push |
| **事务一致性** | `$transaction` + `tx` 参数传播 |
| **去重** | BullMQ `jobId` 去重 |
