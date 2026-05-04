---
title: "admin-next 抽奖管理系统——活动配置、奖品权重与并发安全的抽奖算法"
slug: "lucky-draw-management-system"
date: "2026-05-04"
description: "深入分析 admin-next 抽奖管理模块的完整实现，涵盖活动/奖品 CRUD、概率总和约束、四类奖品校验、核心 draw() 七步事务、加权随机算法、原子并发控制、PrizeSnapshot 快照以及前端 ActivityModal/PrizeModal/PrizesPanel/ResultsPanel 组件"
tags: ["admin-next", "React", "LuckyDraw", "Prize", "Prisma", "$transaction", "concurrency", "weighted-random", "Zod"]
---

# admin-next 抽奖管理系统——活动配置、奖品权重与并发安全的抽奖算法

## 1. 背景

抽奖（Lucky Draw）是电商运营中提升用户活跃度和购买转化率的关键营销工具。用户在购买商品后获得一张抽奖券，抽奖券可在活动有效期内使用，每次抽取按照权重随机获得奖品。

本系统覆盖四个核心实体：**活动（Activity）→ 奖品（Prize）→ 抽奖券（Ticket）→ 抽奖结果（Result）**，涉及三个层面的代码：

| 层面 | 文件 | 角色 |
|------|------|------|
| Admin 后台 CRUD | [`AdminLuckyDrawController`](../../../apps/api/src/admin/lucky-draw/lucky-draw.controller.ts) + [`AdminLuckyDrawService`](../../../apps/api/src/admin/lucky-draw/lucky-draw.service.ts) | 管理员管理活动和奖品配置 |
| 核心抽奖引擎 | [`LuckyDrawService`](../../../apps/api/src/common/lucky-draw/lucky-draw.service.ts)（478 行） | 发券、抽奖、奖品下发 |
| 客户端接口 | [`ClientLuckyDrawController`](../../../apps/api/src/client/lucky-draw/lucky-draw.controller.ts) | 用户查券、抽奖、查结果 |
| 前端管理界面 | [`LuckyDrawClient.tsx`](../../../apps/admin-next/src/components/lucky-draw/LuckyDrawClient.tsx)（1154 行） | admin-next 活动/奖品/结果管理 UI |

本文将按照 **数据模型 → Admin CRUD → 发券与抽奖算法 → 前端组件** 的顺序全面解析。

---

## 2. 数据模型设计

抽奖系统的四个模型定义在 [`schema.prisma`](../../../apps/api/prisma/schema.prisma:1396-1481) 中，构成了一个完整的数据流链条。

### 2.1 LuckyDrawActivity——活动配置

```prisma
/// 抽奖活动配置（admin 创建）
model LuckyDrawActivity {
  id          String            @id @default(cuid())
  createdAt   DateTime          @default(now()) @map("created_at")
  updatedAt   DateTime          @updatedAt @map("updated_at")
  title       String            @db.VarChar(100)
  description String?           @db.VarChar(500)
  /// 绑定商品（null = 全平台任意订单触发）
  treasureId  String?           @map("treasure_id") @db.VarChar(32)
  /// 0=禁用 1=启用
  status      Int               @default(1) @db.SmallInt
  startAt     DateTime?         @map("start_at")
  endAt       DateTime?         @map("end_at")
  treasure    Treasure?         @relation(fields: [treasureId], references: [treasureId])
  prizes      LuckyDrawPrize[]
  tickets     LuckyDrawTicket[]

  @@index([status, startAt, endAt])
  @@map("lucky_draw_activities")
}
```

关键设计决策：

- **`treasureId` 可为空**：null 表示全平台任意订单触发抽奖，非空则只有购买该特定商品才发券。`findActiveActivity` 中使用了 `OR: [{ treasureId: null }, ...(treasureId ? [{ treasureId }] : [])]` 来实现"全平台匹配 + 指定商品匹配"的逻辑。
- **复合索引 `[status, startAt, endAt]`**：`findActiveActivity` 按 `status=1` + 时间范围查询，该索引恰好覆盖所有过滤条件。
- **`status` 使用 `SmallInt`**：0=禁用，1=启用。SmallInt 比 Boolean 更具扩展性（未来可增加归档等状态）。

### 2.2 LuckyDrawPrize——奖品配置

```prisma
/// 奖品配置
model LuckyDrawPrize {
  id          String            @id @default(cuid())
  activityId  String            @map("activity_id")
  /// 1=优惠券 2=金币 3=余额 4=谢谢参与
  prizeType   Int               @map("prize_type") @db.SmallInt
  prizeName   String            @map("prize_name") @db.VarChar(100)
  /// 关联优惠券模板（type=1 时必填）
  couponId    String?           @map("coupon_id") @db.VarChar(32)
  /// 奖励数量/金额（type=2/3 时必填）
  prizeValue  Decimal?          @map("prize_value") @db.Decimal(10, 2)
  /// 权重 0-100，同一活动所有奖品之和必须 ≤ 100
  probability Decimal           @db.Decimal(5, 2)
  /// 剩余库存（-1 = 不限）
  stock       Int               @default(-1)
  sortOrder   Int               @default(0) @map("sort_order")
  activity    LuckyDrawActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  coupon      Coupon?           @relation(fields: [couponId], references: [id])
  results     LuckyDrawResult[]

  @@index([activityId])
  @@map("lucky_draw_prizes")
}
```

字段要点：

- **`prizeType`（1-4）**：1=优惠券（需 `couponId`），2=金币（需 `prizeValue`），3=余额（需 `prizeValue`），4=谢谢参与（无附加字段）。对应常量 `LUCKY_DRAW_PRIZE_TYPE`。
- **`probability` 使用 `Decimal(5, 2)`**：精度 0.01，范围 0.00-100.00。虽然 `Decimal` 在 JS 中操作不便（需 `.toNumber()`），但确保了数据库层面的精度，避免浮点误差累积。加权随机时乘以 `PRECISION=10000` 转换为整数。
- **`stock = -1` 表示不限**：有库存限制的奖品在抽中时通过 `$executeRaw` 原子扣减，扣减失败（库存不足）则降级到 `prizeType=4`。
- **`onDelete: Cascade`**：删除活动时级联删除奖品（与 Ticket 也是 Cascade），确保数据一致性。

### 2.3 LuckyDrawTicket——抽奖券

```prisma
/// 用户抽奖券（下单成功时自动发放）
model LuckyDrawTicket {
  id         String            @id @default(cuid())
  userId     String            @map("user_id") @db.VarChar(32)
  activityId String            @map("activity_id")
  /// 来源订单（幂等键：一个订单对同一活动只能有一张券）
  orderId    String            @map("order_id") @db.VarChar(32)
  used       Boolean           @default(false)
  usedAt     DateTime?         @map("used_at")
  expireAt   DateTime?         @map("expire_at")
  user       User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  activity   LuckyDrawActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  result     LuckyDrawResult?

  @@unique([orderId, activityId], map: "uk_ticket_order_activity")
  @@index([userId, used])
  @@map("lucky_draw_tickets")
}
```

设计亮点：

- **`@@unique([orderId, activityId])`**：复合唯一约束确保同一订单对同一活动只能生成一张券，是幂等性的第一道防线。`issueOneTicket` 的 Prisma `create` 在重复时会抛出唯一约束异常，`catch` 后只是 log warning，不影响主流程。
- **`@@index([userId, used])`**：覆盖 `listTickets` 按用户+未使用状态的查询。
- **`result` 为可选 1:1 关系**：一张券最多对应一个结果（抽奖后才创建），未抽的券 `result` 为 null。这是通过 `LuckyDrawResult.ticketId` 的 `@unique` 实现的。

### 2.4 LuckyDrawResult——抽奖结果

```prisma
/// 抽奖结果记录
model LuckyDrawResult {
  id            String          @id @default(cuid())
  createdAt     DateTime        @default(now()) @map("created_at")
  /// 1:1 ticket，保证一张券只对应一次结果
  ticketId      String          @unique @map("ticket_id")
  userId        String          @map("user_id") @db.VarChar(32)
  prizeId       String          @map("prize_id")
  /// 抽奖时的奖品快照（防止奖品被修改后对账出错）
  prizeSnapshot Json            @map("prize_snapshot")
  ticket        LuckyDrawTicket @relation(fields: [ticketId], references: [id])
  prize         LuckyDrawPrize  @relation(fields: [prizeId], references: [id])
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([prizeId])
  @@map("lucky_draw_results")
}
```

关键设计：

- **`prizeSnapshot` 为 `Json` 类型**：在抽奖那一刻冻结奖品配置的快照，包括 `id`、`prizeType`、`prizeName`、`prizeValue`、`couponId`。即使管理员后续修改了奖品配置，历史结果仍保留当时的数据，用于对账和审计。如果奖品下发失败（fallback），还会附加 `fallback: true` 和 `fallbackReason`。
- **`ticketId @unique`**：确保一张券只能抽一次，与 `draw()` 中的原子标记 `used=true` 形成双重保障。
- **`@@index([prizeId])`**：支持按奖品统计中奖次数的后台查询。

---

## 3. Admin 活动管理 CRUD

Admin 活动管理由 [`AdminLuckyDrawController`](../../../apps/api/src/admin/lucky-draw/lucky-draw.controller.ts) 和 [`AdminLuckyDrawService`](../../../apps/api/src/admin/lucky-draw/lucky-draw.service.ts) 实现，使用 `AdminJwtAuthGuard + RolesGuard` 进行权限控制。

### 3.1 路由与权限

```typescript
@Controller('admin/lucky-draw')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminLuckyDrawController {
  // 活动 CRUD——所有操作开放给 SUPER_ADMIN / ADMIN / EDITOR
  @Get('activities')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  listActivities(@Query() paginateDto: PaginateDto) { ... }

  @Post('activities')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  createActivity(@Body() dto: CreateActivityDto) { ... }

  // 删除活动——仅限 SUPER_ADMIN / ADMIN（DELETE 是高风险操作）
  @Delete('activities/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  deleteActivity(@Param('id') id: string) { ... }

  // 奖品 CRUD——创建/更新开放给 EDITOR，删除仅限 SUPER_ADMIN/ADMIN
  @Delete('prizes/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  deletePrize(@Param('id') id: string) { ... }

  // 查看结果——仅限 SUPER_ADMIN / ADMIN（含用户数据）
  @Get('activities/:activityId/results')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  listResults(...) { ... }
}
```

权限梯度清晰：**EDITOR 可管理活动和奖品但不能删除，SUPER_ADMIN/ADMIN 拥有全部权限**。结果列表因包含用户中奖敏感数据，也限制为 SUPER_ADMIN/ADMIN。

### 3.2 活动创建——时间范围 + 商品绑定校验

```typescript
async createActivity(dto: CreateActivityDto) {
  // 1. 如果传了 startAt/endAt，校验 endAt > startAt
  this.validateTimeRange(dto.startAt, dto.endAt);
  // 2. 如果绑定了商品，校验商品存在
  if (dto.treasureId) {
    await this.validateTreasure(dto.treasureId);
  }
  // 3. 创建活动
  return this.prisma.luckyDrawActivity.create({
    data: {
      title: dto.title,
      description: dto.description ?? null,
      treasureId: dto.treasureId ?? null,
      status: dto.status ?? 1,
      startAt: dto.startAt ? new Date(dto.startAt) : null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
    },
  });
}
```

时间校验的逻辑简单直接：`new Date(startAt) >= new Date(endAt)` 则抛错。需要注意的是 `startAt`/`endAt` 均为可选字段（可为 null = 不限时间），此时跳过校验。

### 3.3 活动更新——手动字段映射

```typescript
async updateActivity(id: string, dto: UpdateActivityDto) {
  const activity = await this.requireActivity(id);
  const raw = dto as Record<string, unknown>;

  // 手动从 Record 提取字段，区分 undefined（不更新）和 null（置空）
  const title = this.asOptionalString(raw.title);
  const description = this.asOptionalNullableString(raw.description);
  const treasureId = this.asOptionalNullableString(raw.treasureId);
  // ...

  const data: Prisma.LuckyDrawActivityUncheckedUpdateInput = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  // ...

  return this.prisma.luckyDrawActivity.update({ where: { id }, data });
}
```

这里使用了一种**手动字段映射**模式：通过 `asOptionalString` / `asOptionalNullableString` 辅助方法提取字段值，区分 `undefined`（不更新）和 `null`（置空）。这是因为 Patch 请求中，客户端传 `null` 表示清空字段，不传表示保持原值。

辅助方法签名：

```typescript
private asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

private asOptionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;  // 不传 = undefined = 不更新
}
```

### 3.4 活动列表——带统计的分页

```typescript
async listActivities(paginate: PaginateDto) {
  const [total, list] = await this.prisma.$transaction([
    this.prisma.luckyDrawActivity.count(),
    this.prisma.luckyDrawActivity.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        treasure: { select: { treasureName: true } },
        _count: { select: { prizes: true, tickets: true } },
      },
    }),
  ]);

  return {
    total,
    list: list.map((item) => ({
      ...item,
      treasureName: item.treasure?.treasureName,
      prizesCount: item._count.prizes,
      ticketsCount: item._count.tickets,
    })),
    page,
    pageSize,
  };
}
```

使用 `$transaction` 并行执行 count + findMany，同时通过 `_count` 计算出奖品数和已发放的抽奖券数，方便管理员评估活动参与度。

---

## 4. Admin 奖品管理 CRUD

奖品管理涉及比活动更复杂的约束校验。

### 4.1 四类奖品校验

```typescript
const LUCKY_DRAW_PRIZE_TYPE = {
  COUPON: 1,   // 优惠券——需 couponId
  COIN: 2,     // 金币——需 prizeValue > 0
  BALANCE: 3,  // 余额——需 prizeValue > 0
  THANKS: 4,   // 谢谢参与——无附加字段
} as const;

private validatePrizePayload(
  prizeType: number,
  couponId?: string | null,
  prizeValue?: number | null,
) {
  if (prizeType < 1 || prizeType > 4) {
    throw new BadRequestException('prizeType must be between 1 and 4.');
  }
  // 优惠券奖品必须绑定 coupon
  if (prizeType === LUCKY_DRAW_PRIZE_TYPE.COUPON && !couponId) {
    throw new BadRequestException('Coupon ID is required for coupon prizes.');
  }
  // 金币/余额奖品必须有正数金额
  if (
    (prizeType === LUCKY_DRAW_PRIZE_TYPE.COIN ||
      prizeType === LUCKY_DRAW_PRIZE_TYPE.BALANCE) &&
    (!prizeValue || prizeValue <= 0)
  ) {
    throw new BadRequestException(
      'A positive prizeValue is required for coin/balance prizes.',
    );
  }
}
```

### 4.2 概率总和约束

```typescript
private async validateProbabilitySum(
  activityId: string,
  excludePrizeId: string | null,
  newProbability: number,
) {
  const agg = await this.prisma.luckyDrawPrize.aggregate({
    _sum: { probability: true },
    where: {
      activityId,
      ...(excludePrizeId && { id: { not: excludePrizeId } }),
    },
  });
  const existing = agg._sum.probability?.toNumber() ?? 0;
  if (existing + newProbability > 100) {
    throw new BadRequestException(
      `Probability sum would exceed 100 (current: ${existing}, adding: ${newProbability}).`,
    );
  }
}
```

`validateProbabilitySum` 使用 Prisma `aggregate` 的 `_sum` 计算同一活动下已有奖品的概率总和（通过 `excludePrizeId` 排除自身），加上新概率后不得超过 100。注意这里用的是 **≤100 而非 =100**，允许管理员配置总和小于 100 的活动（剩余概率视为"谢谢参与"的隐式权重）。

### 4.3 创建奖品——类型相关字段处理

```typescript
async createPrize(dto: CreatePrizeDto) {
  const { activityId, probability, prizeType, couponId, prizeValue } = dto;

  await this.requireActivity(activityId);                   // 活动必须存在
  await this.validateProbabilitySum(activityId, null, probability); // 概率总和 ≤ 100
  this.validatePrizePayload(prizeType, couponId, prizeValue);       // 类型校验
  if (prizeType === LUCKY_DRAW_PRIZE_TYPE.COUPON && couponId) {
    await this.validateCoupon(couponId);                   // 优惠券模板存在
  }

  return this.prisma.luckyDrawPrize.create({
    data: {
      activityId,
      prizeType,
      prizeName: dto.prizeName,
      // type=1 才存 couponId，type=2/3 才存 prizeValue
      couponId: prizeType === LUCKY_DRAW_PRIZE_TYPE.COUPON ? (couponId ?? null) : null,
      prizeValue:
        prizeType === LUCKY_DRAW_PRIZE_TYPE.COIN ||
        prizeType === LUCKY_DRAW_PRIZE_TYPE.BALANCE
          ? new Prisma.Decimal(prizeValue as number)
          : null,
      stock: dto.stock ?? -1,
      sortOrder: dto.sortOrder ?? 0,
      probability: new Prisma.Decimal(probability),
    },
  });
}
```

注意 `couponId` 和 `prizeValue` 的存储是类型相关的——非对应类型的奖品该字段存为 null，避免数据冗余。

### 4.4 更新奖品——类型变更时的字段兼容

```typescript
async updatePrize(id: string, dto: UpdatePrizeDto) {
  const prize = await this.requirePrize(id);

  // 如果有新概率，重新校验总和
  if (probability !== undefined) {
    await this.validateProbabilitySum(prize.activityId, id, probability);
  }

  // 取最终值（dto 的值优先，未传则用 prize 的当前值）
  const finalType = dto.prizeType ?? prize.prizeType;
  const finalCouponId = dto.couponId === undefined ? prize.couponId : dto.couponId;
  const finalPrizeValue = dto.prizeValue === undefined
    ? (prize.prizeValue?.toNumber() ?? null)
    : dto.prizeValue;

  // 用最终值校验
  this.validatePrizePayload(finalType, finalCouponId, finalPrizeValue);
  // ...
}
```

更新时的一个微妙场景：**管理员可能同时修改 `prizeType` 和相关字段**。例如将奖品从"金币"改为"优惠券"时，`prizeValue` 不再需要但 `couponId` 变为必填。实现中先计算"最终值"再进行校验，确保类型转换的正确性。

### 4.5 结果列表——多层 include 查询

```typescript
async listResults(activityId: string, paginate: PaginateDto) {
  // ... count + findMany
  this.prisma.luckyDrawResult.findMany({
    where: { ticket: { activityId } },  // 通过 ticket 关联到活动
    orderBy: { createdAt: 'desc' },
    include: {
      ticket: { select: { activityId: true, orderId: true } },
      user: { select: { nickname: true, avatar: true } },
      prize: {
        include: {
          coupon: { select: { couponName: true } },
          activity: {
            select: {
              title: true,
              treasure: { select: { treasureName: true } },
            },
          },
        },
      },
    },
  });
}
```

结果列表需要展示：用户头像昵称、中奖奖品名及类型、来源订单号、关联商品名、优惠券名。通过 4 层 `include`（Result → Ticket → User/Prize → Coupon/Activity → Treasure）一次查询完成，避免 N+1。

---

## 5. 发券机制

发券（Issue Ticket）发生在用户购买成功后，由 [`LuckyDrawService`](../../../apps/api/src/common/lucky-draw/lucky-draw.service.ts) 实现。有两种触发场景。

### 5.1 查找活跃活动

```typescript
private async findActiveActivity(treasureId: string | null) {
  const now = new Date();
  return this.prisma.luckyDrawActivity.findFirst({
    where: {
      status: 1,  // 仅启用
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },         // 已开始或不限
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },             // 未结束或不限
        {
          OR: [
            { treasureId: null },                                        // 全平台活动
            ...(treasureId ? [{ treasureId }] : []),                     // 或匹配商品
          ],
        },
      ],
    },
  });
}
```

这个查询巧妙地处理了"全平台活动"和"指定商品活动"的混合场景：如果商品绑定了活动，则优先匹配该活动；如果没有找到指定活动，但存在全平台活动（`treasureId: null`），则返回到全平台活动。

### 5.2 团购发券

```typescript
async issueTicketsForGroup(groupId: string): Promise<void> {
  const group = await this.prisma.treasureGroup.findUnique({
    where: { groupId },
    select: {
      treasureId: true,
      members: {
        where: { memberType: 0 },  // 普通成员（非团长）
        select: { userId: true, orderId: true },
      },
    },
  });
  if (!group) return;

  const activity = await this.findActiveActivity(group.treasureId);
  if (!activity) return;

  // 为每个团员 fire-and-forget 发券
  for (const m of group.members) {
    if (!m.orderId) continue;
    await this.issueOneTicket(m.userId, m.orderId, activity.id)
      .then((ticket) => {
        // 通过 WebSocket 通知用户
        this.eventsGateway.dispatchToUser(
          m.userId,
          SocketEvents.LUCKY_DRAW_TICKET_ISSUED,
          { groupId, ticketId: ticket.id, activityId: ticket.activityId, orderId: ticket.orderId, issuedAt: ticket.createdAt.getTime() },
        );
      })
      .catch((e: unknown) => {
        // 错误仅 warn，不影响主流程
        this.logger.warn(`LuckyDraw ticket skip (group ${groupId}, user ${m.userId}): ${e instanceof Error ? e.message : String(e)}`);
      });
  }
}
```

### 5.3 单独购买发券

```typescript
async issueTicketForOrder(
  userId: string,
  treasureId: string,
  orderId: string,
): Promise<void> {
  const activity = await this.findActiveActivity(treasureId);
  if (!activity) return;
  await this.issueOneTicket(userId, orderId, activity.id).catch(
    (e: unknown) => {
      this.logger.warn(`LuckyDraw ticket skip (solo order ${orderId}): ${e instanceof Error ? e.message : String(e)}`);
    },
  );
}
```

两个发券方法都是 **fire-and-forget**——调用方（`GroupProcessor` / `OrderService.checkOut`）不 await 结果，发券失败仅记录 warning，不阻塞订单/团购主流程。幂等性由数据库的 `@@unique([orderId, activityId])` 约束保障。

---

## 6. 核心抽奖算法——`draw()` 七步事务

`draw()` 是整个系统的核心，使用 `$transaction` 包裹 7 个步骤，确保抽奖的原子性和一致性。

```typescript
async draw(userId: string, ticketId: string): Promise<DrawResult> {
  return this.prisma.$transaction(async (tx) => {

    // ========== Step 1: 原子标记 ticket（并发安全） ==========
    const updated = await tx.$executeRaw`
      UPDATE lucky_draw_tickets
         SET used = true, used_at = NOW()
       WHERE id = ${ticketId}
         AND user_id = ${userId}
         AND used = false
    `;
    if (updated === 0) {
      const ticket = await tx.luckyDrawTicket.findUnique({ where: { id: ticketId } });
      if (!ticket || ticket.userId !== userId) {
        throw new NotFoundException('Ticket not found');
      }
      throw new ConflictException('Ticket already used');
    }

    // ========== Step 2: 读取可用奖品（有库存的） ==========
    const prizes = await tx.luckyDrawPrize.findMany({
      where: {
        activityId: ticket.activityId,
        OR: [{ stock: -1 }, { stock: { gt: 0 } }],  // 不限库存 或 有剩余
      },
      orderBy: { sortOrder: 'asc' },
    });
    if (prizes.length === 0) {
      throw new NotFoundException('No prizes configured for this activity');
    }

    // ========== Step 3: 加权随机抽签 ==========
    const PRECISION = 10000;  // 精度 0.01%
    const roll = randomInt(0, PRECISION);
    let cumulative = 0;
    let selectedPrize = prizes[prizes.length - 1]; // 兜底：最后一个奖品
    for (const prize of prizes) {
      cumulative += Math.round(prize.probability.toNumber() * PRECISION);
      if (roll < cumulative) {
        selectedPrize = prize;
        break;
      }
    }

    // ========== Step 4: 原子库存扣减 ==========
    if (selectedPrize.stock !== -1) {
      const deducted = await tx.$executeRaw`
        UPDATE lucky_draw_prizes
           SET stock = stock - 1
         WHERE id = ${selectedPrize.id}
           AND stock > 0
      `;
      if (deducted === 0) {
        // 库存不足，降级到 "谢谢参与"
        selectedPrize = prizes.find((p) => p.prizeType === 4) ?? selectedPrize;
      }
    }

    // ========== Step 5: 奖品快照（对账用） ==========
    const prizeSnapshot = {
      id: selectedPrize.id,
      prizeType: selectedPrize.prizeType,
      prizeName: selectedPrize.prizeName,
      prizeValue: selectedPrize.prizeValue?.toNumber() ?? null,
      couponId: selectedPrize.couponId ?? null,
    };

    // ========== Step 6: 奖品下发 ==========
    let userCouponId: string | undefined;
    let fallbackReason: string | undefined;

    try {
      if (selectedPrize.prizeType === 1 && selectedPrize.couponId) {
        userCouponId = await this.issueCouponInTx(tx, userId, selectedPrize.couponId);
      } else if (selectedPrize.prizeType === 2 && selectedPrize.prizeValue) {
        await this.wallet.creditCoin(
          { userId, coins: selectedPrize.prizeValue, related: { id: ticketId, type: 'LUCKY_DRAW' }, desc: `Lucky Draw: ${selectedPrize.prizeName}` },
          tx as unknown as Tx,
        );
      } else if (selectedPrize.prizeType === 3 && selectedPrize.prizeValue) {
        await this.wallet.creditCash(
          { userId, amount: selectedPrize.prizeValue, related: { id: ticketId, type: 'LUCKY_DRAW' }, desc: `Lucky Draw: ${selectedPrize.prizeName}` },
          tx as unknown as Tx,
        );
      }
    } catch (e: unknown) {
      fallbackReason = e instanceof Error ? e.message : String(e);
      this.logger.warn(`LuckyDraw prize issue failed, fallback: ${fallbackReason}`);
      selectedPrize = prizes.find((p) => p.prizeType === 4) ?? selectedPrize;
      userCouponId = undefined;
    }

    // ========== Step 7: 写入抽奖结果 ==========
    const drawResult = await tx.luckyDrawResult.create({
      data: {
        ticketId,
        userId,
        prizeId: selectedPrize.id,
        prizeSnapshot: {
          ...(prizeSnapshot as Prisma.JsonObject),
          ...(fallbackReason ? { fallback: true, fallbackReason } : {}),
        },
      },
      select: { id: true, createdAt: true },
    });

    return {
      prizeType: selectedPrize.prizeType as 1 | 2 | 3 | 4,
      prizeName: selectedPrize.prizeName,
      prizeValue: selectedPrize.prizeValue?.toNumber(),
      isWin: selectedPrize.prizeType !== 4,
      userCouponId,
      resultId: drawResult.id,
      drawnAt: drawResult.createdAt.getTime(),
    };
  });
}
```

### 6.1 并发安全设计

抽奖是典型的并发高竞争场景，系统通过 **三重保障** 确保安全：

| 层级 | 机制 | 说明 |
|------|------|------|
| 数据库约束 | `LuckyDrawResult.ticketId @unique` | 一张券只能对应一条结果记录 |
| 乐观锁 | `$executeRaw` 原子 UPDATE | `UPDATE ... WHERE used = false`，affected=0 表示已被使用 |
| 事务隔离 | Prisma `$transaction` | 所有步骤在同一个 DB 事务中执行 |

Step 1 使用 RAW SQL 而非 Prisma Client 的 `update`，是因为 `$executeRaw` 返回 affected rows 数，可以判断是否有行被实际更新。这是实现**乐观锁**的关键。

### 6.2 加权随机算法

```typescript
const PRECISION = 10000;
const roll = randomInt(0, PRECISION);
let cumulative = 0;
let selectedPrize = prizes[prizes.length - 1];
for (const prize of prizes) {
  cumulative += Math.round(prize.probability.toNumber() * PRECISION);
  if (roll < cumulative) {
    selectedPrize = prize;
    break;
  }
}
```

算法说明：

1. **`randomInt` 来自 Node.js `crypto` 模块**：提供密码学安全的随机数，比 `Math.random()` 更不可预测，防止恶意用户预测抽奖结果。
2. **`PRECISION = 10000`**：对应 `Decimal(5,2)` 的概率精度。30% 的概率表示为 0.30，乘以 10000 后为 3000。
3. **累积概率法**：奖品按 `sortOrder` 排序，逐个累加概率值，当随机数落在当前累积区间内时选中该奖品。
4. **兜底逻辑**：`selectedPrize` 初始化为最后一个奖品（通常为"谢谢参与"），即使概率总和小于 100 也能兜底。

### 6.3 奖品下发与降级

Step 6 中的 `try/catch` 是关键的安全网：

- **优惠券下发** (`issueCouponInTx`)：在校验优惠券可用性（`status=1`、库存未满）后，原子递增 `issuedQuantity` 并创建 `UserCoupon`。该方法设计为接受外部 `Prisma.TransactionClient` 参数，避免嵌套事务。
- **金币/余额下发**：调用 `wallet.creditCoin` / `wallet.creditCash`，同样在事务内执行。
- **降级策略**：任何下发异常都被 `catch`，奖品降级为 `prizeType=4`（谢谢参与），并在 `prizeSnapshot` 中记录 `fallback: true` 和 `fallbackReason` 用于审计。

### 6.4 优惠券下发事务

```typescript
private async issueCouponInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  couponId: string,
): Promise<string> {
  const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
  if (!coupon || coupon.status !== 1) {
    throw new Error(`Coupon ${couponId} unavailable`);
  }
  if (coupon.totalQuantity !== -1 && coupon.issuedQuantity >= coupon.totalQuantity) {
    throw new Error(`Coupon ${couponId} fully claimed`);
  }

  const now = new Date();
  const validStart = coupon.validType === 1
    ? (coupon.validStartAt ?? now)
    : now;
  const validEnd = coupon.validType === 1
    ? (coupon.validEndAt ?? new Date(now.getTime() + 365 * 86400_000))
    : new Date(now.getTime() + (coupon.validDays ?? 30) * 86400_000);

  // 原子递增发放数量
  await tx.coupon.update({
    where: { id: couponId },
    data: { issuedQuantity: { increment: 1 } },
  });

  // 创建用户优惠券
  const uc = await tx.userCoupon.create({
    data: {
      userId, couponId,
      receiveType: 1,  // 抽奖发放
      status: 0,       // 未使用
      validStartAt: validStart,
      validEndAt: validEnd,
    },
    select: { id: true },
  });

  return uc.id;
}
```

### 6.5 查询——订单页展示

```typescript
async getTicketByOrder(userId: string, orderId: string) {
  const ticket = await this.prisma.luckyDrawTicket.findFirst({
    where: { userId, orderId },
    include: {
      activity: { select: { title: true, endAt: true } },
      result: {
        select: {
          id: true, createdAt: true, prizeSnapshot: true,
          prize: { select: { prizeName: true, prizeType: true, prizeValue: true } },
        },
      },
    },
  });

  if (!ticket) {
    return { hasTicket: false as const };  // discriminated union
  }

  return {
    hasTicket: true as const,
    ticket: { /* ... full ticket detail */ },
  };
}
```

使用 `hasTicket` 作为 discriminated union 的 discriminant，TypeScript 可以自动收窄类型。前端订单详情页据此判断"显示抽奖入口 / 已抽过显示中奖结果"。

---

## 7. admin-next 前端组件

前端管理界面位于 [`LuckyDrawClient.tsx`](../../../apps/admin-next/src/components/lucky-draw/LuckyDrawClient.tsx)（1154 行），使用 `react-hook-form` + `zod` + `useRequest` 技术栈。

### 7.1 组件架构

```
LuckyDrawManagement（主入口）
├── PageHeader（标题 + 创建活动按钮）
├── TabBar（activities | results 双标签切换）
├── Activity List（左侧主区域）
│   ├── Refresh + 搜索
│   └── Activity 卡片列表
│       ├── 活动信息（title, status, time, treasure）
│       ├── 统计（prizesCount, ticketsCount）
│       └── 操作（edit, delete）
├── PrizesPanel（右侧边栏）
│   ├── Prize 列表（type badge, probability, stock）
│   └── Prize 操作（add, edit, delete）
├── ActivityModal（创建/编辑活动弹窗）
├── PrizeModal（创建/编辑奖品弹窗）
└── ResultsPanel（结果列表标签页）
    └── 分页表格（time, user, prize, coupon, order）
```

### 7.2 ActivityModal——Zod superRefine 时间校验

```typescript
const activitySchema = useMemo(
  () =>
    z
      .object({
        title: z.string().min(1, t('luckyDraw.titleIsRequired')),
        description: z.string().optional(),
        treasureId: z.string().optional(),
        startAt: z.string().min(1),
        endAt: z.string().min(1),
        status: z.number(),
      })
      .superRefine((value, ctx) => {
        if (value.startAt && value.endAt) {
          const start = new Date(value.startAt).getTime();
          const end = new Date(value.endAt).getTime();
          if (end <= start) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('luckyDraw.endTimeAfterStart'),
              path: ['endAt'],
            });
          }
        }
      }),
  [t],
);
```

使用 `superRefine` 进行跨字段校验：当 `endAt <= startAt` 时，在 `endAt` 字段上添加自定义校验错误。这比在 `endAt` 单独使用 `.refine` 更精确，因为错误可以定位到具体字段。

### 7.3 PrizeModal——条件表单

```typescript
const prizeSchema = useMemo(
  () =>
    z
      .object({
        prizeType: z.coerce.number().min(1).max(4),
        prizeName: z.string().min(1, t('luckyDraw.prizeNameRequired')),
        couponId: z.string().optional(),
        amount: z.coerce.number().optional(),
        probability: z.coerce.number().min(0).max(100),
        stock: z.coerce.number().min(-1).default(-1),
        sortOrder: z.coerce.number().default(0),
      })
      .superRefine((value, ctx) => {
        if (value.prizeType === 1 && !value.couponId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('luckyDraw.couponRequired'), path: ['couponId'] });
        }
        if ((value.prizeType === 2 || value.prizeType === 3) && (!value.amount || value.amount <= 0)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('luckyDraw.amountRequired'), path: ['amount'] });
        }
      }),
  [t],
);
```

条件渲染逻辑：

- `prizeType=1`（优惠券）：显示优惠券下拉选择器，`amount` 隐藏
- `prizeType=2/3`（金币/余额）：显示金额输入框，`couponId` 隐藏
- `prizeType=4`（谢谢参与）：两者皆隐藏，字段自动赋空值

前端提交时，也会根据 `prizeType` 清理无效字段：

```typescript
const payload: CreateLuckyDrawPrizePayload = {
  activityId: activityId,
  prizeType: values.prizeType,
  prizeName: values.prizeName,
  probability: values.probability,
  stock: values.stock,
  sortOrder: values.sortOrder,
  // 只提交相关字段
  ...(values.prizeType === 1 ? { couponId: values.couponId } : {}),
  ...(values.prizeType === 2 || values.prizeType === 3
    ? { prizeValue: values.amount }
    : {}),
};
```

### 7.4 PrizesPanel——侧边栏奖品列表

```typescript
function PrizesPanel({
  activityId,
  t,
}: {
  activityId: string;
  t: TFunc;
}) {
  // 获取奖品列表
  const { data: prizes = [], loading, refresh } = useRequest(
    () => luckyDrawApi.listPrizes(activityId),
    { refreshDeps: [activityId] },
  );

  // 计算总概率
  const totalProbability = useMemo(
    () => prizes.reduce((sum, p) => sum + p.probability, 0),
    [prizes],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* 总概率指示器 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {t('luckyDraw.totalProbability')}: {totalProbability.toFixed(2)}%
        </span>
      </div>

      {/* 奖品列表 */}
      {prizes.map((item) => (
        <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIZE_TYPE_COLORS[item.prizeType]}`}>
            {PRIZE_TYPE_LABELS[item.prizeType]}
          </span>
          <span className="flex-1 text-sm">{item.prizeName}</span>
          <span className="text-xs text-gray-400">{item.probability}%</span>
          <span className="text-xs text-gray-400">
            {item.stock === -1 ? '∞' : item.stock}
          </span>
          {/* hover 时显示编辑/删除按钮 */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button onClick={() => handleEdit(item)}><Edit2 size={14} /></button>
            <button onClick={() => handleDelete(item.id)}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### 7.5 ResultsPanel——分页结果表格

```typescript
function ResultsPanel({ t }: { t: TFunc }) {
  const [params, setParams] = useState<QueryLuckyDrawResultsParams>({
    activityId: '',
    page: 1,
    pageSize: 20,
  });

  const { data, loading } = useRequest(
    () => activityId ? luckyDrawApi.listResults(params) : Promise.resolve({ list: [], total: 0 }),
    { refreshDeps: [params] },
  );

  return (
    <div>
      {/* 活动选择器 */}
      <select onChange={(e) => setParams((prev) => ({ ...prev, activityId: e.target.value, page: 1 }))}>
        <option value="">{t('luckyDraw.selectActivity')}</option>
        {activities.map((item) => (
          <option key={item.id} value={item.id}>{item.title}</option>
        ))}
      </select>

      {/* 结果表格 */}
      <table>
        <thead>
          <tr>
            <th>{t('luckyDraw.time')}</th>
            <th>{t('luckyDraw.user')}</th>
            <th>{t('luckyDraw.prize')}</th>
            <th>{t('luckyDraw.coupon')}</th>
            <th>{t('luckyDraw.order')}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((item) => (
            <tr key={item.id}>
              <td>{formatDateTime(item.createdAt)}</td>
              <td>{item.userNickname}</td>
              <td>{item.prizeName}</td>
              <td>{item.couponName ?? '—'}</td>
              <td>{shortId(item.orderId)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 分页 */}
      <Pagination
        current={params.page}
        total={data?.total ?? 0}
        onChange={(page) => setParams((prev) => ({ ...prev, page }))}
      />
    </div>
  );
}
```

### 7.6 LuckyDrawManagement——主布局

```typescript
export function LuckyDrawManagement() {
  const [tab, setTab] = useState<Tab>('activities');
  const [selectedActivity, setSelectedActivity] = useState<LuckyDrawActivity | null>(null);
  const [activityModal, setActivityModal] = useState<boolean | LuckyDrawActivity>(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('luckyDraw.title')}
        actions={
          <Button onClick={() => setActivityModal(true)}>
            <Plus size={16} /> {t('luckyDraw.createActivity')}
          </Button>
        }
      />

      {/* 双标签切换 */}
      <div className="flex gap-4 border-b">
        {(['activities', 'results'] as Tab[]).map((item) => (
          <button key={item} onClick={() => setTab(item)}
            className={tab === item ? 'border-b-2 border-blue-500' : ''}>
            {t(`luckyDraw.tab.${item}`)}
          </button>
        ))}
      </div>

      {tab === 'activities' ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          {/* 左侧：活动列表 */}
          <section>
            {/* 活动卡片列表 */}
            {activities.map((activity) => (
              <div key={activity.id}
                className={`p-4 rounded-xl cursor-pointer ${selectedActivity?.id === activity.id ? 'ring-2 ring-blue-500' : ''}`}
                onClick={() => setSelectedActivity(activity)}>
                {/* 活动信息 */}
              </div>
            ))}
          </section>

          {/* 右侧：选中活动的奖品管理 */}
          <aside>
            {selectedActivity ? (
              <PrizesPanel activityId={selectedActivity.id} t={t} />
            ) : (
              <p className="text-gray-400">{t('luckyDraw.selectActivityHint')}</p>
            )}
          </aside>
        </div>
      ) : (
        <ResultsPanel t={t} />
      )}

      {activityModal !== false && (
        <ActivityModal
          activity={activityModal === true ? null : activityModal}
          onClose={() => setActivityModal(false)}
          onSaved={handleRefresh}
          t={t}
        />
      )}
    </div>
  );
}
```

布局采用 **双栏 grid 布局**（`xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]`），左侧为活动列表，右侧为选中活动的奖品管理面板。选中活动通过 `ring-2 ring-blue-500` 高亮显示。

---

## 8. 客户端接口

客户端（Flutter App）通过 [`ClientLuckyDrawController`](../../../apps/api/src/client/lucky-draw/lucky-draw.controller.ts) 与抽奖系统交互，使用 `JwtAuthGuard`（用户认证）。

```typescript
@Controller('lucky-draw')
@UseGuards(JwtAuthGuard)
export class ClientLuckyDrawController {
  // GET /v1/lucky-draw/order/:orderId/ticket
  // 订单详情页——该订单是否有抽奖券
  @Get('order/:orderId/ticket')
  getTicketByOrder(@CurrentUserId() userId: string, @Param('orderId') orderId: string) {
    return this.luckyDraw.getTicketByOrder(userId, orderId);
  }

  // GET /v1/lucky-draw/my-tickets
  // 用户抽奖券列表（支持过滤未使用）
  @Get('my-tickets')
  myTickets(@CurrentUserId() userId: string, @Query() dto: QueryTicketsDto) {
    return this.luckyDraw.listTickets(userId, { page: dto.page ?? 1, pageSize: dto.pageSize ?? 20, unusedOnly: dto.unusedOnly });
  }

  // POST /v1/lucky-draw/tickets/:ticketId/draw
  // 用户点击「抽一下」
  @Post('tickets/:ticketId/draw')
  draw(@CurrentUserId() userId: string, @Param('ticketId') ticketId: string) {
    return this.luckyDraw.draw(userId, ticketId);
  }

  // GET /v1/lucky-draw/my-results
  // 用户历史中奖记录
  @Get('my-results')
  myResults(@CurrentUserId() userId: string, @Query() dto: QueryTicketsDto) {
    return this.luckyDraw.listResults(userId, { page: dto.page ?? 1, pageSize: dto.pageSize ?? 20 });
  }
}
```

---

## 9. 安全与容错设计总结

| 场景 | 风险 | 解决方案 |
|------|------|----------|
| 并发抽奖（同一张券） | 重复抽奖 | `$executeRaw` 原子 UPDATE + `LuckyDrawResult.ticketId @unique` |
| 库存超发 | 库存为负 | `$executeRaw` 原子扣减 + `WHERE stock > 0` |
| 奖品下发失败 | 用户未收到奖励 | try/catch 降级到 "谢谢参与"，快照记录 fallback |
| 重复发券 | 同一订单得两张券 | `@@unique([orderId, activityId])` |
| 概率总和溢出 | 概率超过 100% | `validateProbabilitySum` 前置校验 |
| 奖品配置篡改 | 历史对账不准确 | `prizeSnapshot` 抽奖时冻结配置 |
| 预测抽奖结果 | 用户预测随机数 | `crypto.randomInt` 密码学安全随机数 |
| 奖品类型错误 | 优惠券奖品无 coupon | `validatePrizePayload` 类型相关字段校验 |

---

## 10. 总结

抽奖管理系统展示了 NestJS + Prisma 在**高并发、高一致性要求**场景下的典型设计模式：

1. **`$transaction` 包裹 7 步操作**：从标记券到写结果，保证事务级原子性
2. **`$executeRaw` 乐观锁**：RAW SQL 的 affected rows 判断 + WHERE 条件检查，替代 Prisma Client 的 `update`
3. **权重随机 + 降级兜底**：`crypto.randomInt` + 累积概率 + 谢谢参与兜底 + try/catch 降级
4. **Fire-and-forget 发券**：抽奖券发放不阻塞订单主流程，错误仅记录日志
5. **PrizeSnapshot 快照**：JSON 冻结 + fallback 标记，保障对账审计
6. **前端 Zod superRefine**：跨字段校验 `endAt > startAt`，条件表单 `prizeType` 联动

### 相关文章

- [admin-next 订单管理系统](order-management-system.md)
- [优惠券营销系统](coupon-marketing-system.md)
- [Prisma 数据库架构设计](prisma-database-architecture.md)
