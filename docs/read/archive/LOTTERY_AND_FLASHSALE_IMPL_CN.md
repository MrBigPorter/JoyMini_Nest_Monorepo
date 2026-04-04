# 开奖逻辑 & 秒杀逻辑 — 实现分析文档

> 作者：Copilot 代码审计  
> 日期：2026-03-18  
> 基于：Phase 5 代码现状（`apps/api`）
> 状态：历史审计快照（用于复盘，不代表当前代码状态）
> 最后对齐时间：2026-03-18（当前实施进度以 `.github/copilot-instructions.md` 与 `read/IMPL_PROGRESS_CN.md` 为准）

---

## 一、现状速览

以下结论是 **Phase 5 当时审计快照**，当前仓库已完成后续改造：

| 功能         | Schema 字段                                      | 服务层逻辑                             | 结果                                         |
| ------------ | ------------------------------------------------ | -------------------------------------- | -------------------------------------------- |
| 开奖（抽奖） | `lotteryMode / drawnAt / luckyWinnersCount` 都在 | **零行**业务逻辑读取 `lotteryMode`     | 团满后全员变 `WAIT_DELIVERY`，无随机抽winner |
| 秒杀价格     | `FlashSaleProduct.flashPrice / flashStock` 都在  | `checkout` **不查** `FlashSaleProduct` | 用户下单永远用 `unitAmount`，秒杀价不生效    |

---

## 二、开奖逻辑

### 2.1 现有架构回顾

```
checkout → joinOrCreateGroup → 团满 → handleGroupSuccessInTx
                                          ↓
                                   emitGroupSuccessSignal (BullMQ)
                                          ↓
                               GroupProcessor.handleOrderActivation
                                          ↓
                       所有真人订单 PAID(3) → WAIT_DELIVERY(7)  ← 终点
```

**问题**：`WAIT_DELIVERY` 的注释写着"此时包含了抽奖结束的逻辑"，但代码里根本没有抽奖。
所有参团真人均变为待发货，等同于"人人获奖"。

### 2.2 Schema 已有但未用的字段

```prisma
// TreasureGroup
drawnAt           DateTime?   // 开奖时间 — 从未被写入
luckyWinnersCount Int         // 本团中奖人数 — 永远是 0
totalWinningTimes Int         // 累计中奖次数 — 永远是 0

// Treasure
lotteryMode       Int         // 1=售罄模式 2=定时模式 — 服务层从未读取
minBuyQuantity    Int         // 触发开奖最低份数 — 服务层从未读取

// TreasureGroupMember
memberType        Int         // 0=真人 1=机器人 — 机器人应排除在抽奖外
```

**关键缺失**：Schema 里完全没有 `winnerId` / 中奖记录表，需要新增。

### 2.3 业务规则（需和产品确认后锁定）

| 规则                        | 说明                                     | 当前状态                            |
| --------------------------- | ---------------------------------------- | ----------------------------------- |
| 每团几个winner              | 通常 1 人（送出一件商品）                | 未定义                              |
| 机器人能赢吗                | 不能，只有 `memberType=0` 的真人参与抽签 | 字段在，逻辑缺                      |
| 购买多份能多签              | 一份=一签（买 3 份有 3 倍机率）          | 未实现，`buyQuantity` 在 `Order` 上 |
| 定时开奖（`lotteryMode=2`） | 时间到了才开奖，不依赖卖完               | cron 里没有这个分支                 |
| 开奖结果通知                | Socket + FCM 推送winner和loser           | 已有通知基础设施，需接入            |

### 2.4 实现方案

#### Step 1 — 新增 Schema（1次 `prisma migrate dev`）

```prisma
/// 开奖结果记录
model LotteryResult {
  id            String        @id @default(cuid())
  createdAt     DateTime      @default(now())
  groupId       String        @map("group_id")        // 属于哪个团
  treasureId    String        @map("treasure_id")
  winnerId      String        @map("winner_id")        // 中奖用户ID
  winnerOrderId String        @map("winner_order_id")  // 中奖订单ID（注意：字段名 winnerOrderId，不是 winnerOrder）
  group         TreasureGroup @relation(fields: [groupId], references: [groupId])
  user          User          @relation(fields: [winnerId], references: [id])

  @@index([groupId])
  @@index([winnerId])
  @@map("lottery_results")
}
```

同时在现有模型追加反向关联字段（这两行单独迁移时不要漏）：

```prisma
// model TreasureGroup — 在已有关联字段末尾追加：
lotteryResults  LotteryResult[]

// model User — 在已有关联字段末尾追加：
lotteryResults  LotteryResult[]
```

#### Step 2 — 开奖核心逻辑（新增 `LotteryService`）

```typescript
// 伪代码，说明核心思路
async drawWinner(groupId: string, tx: Tx) {
  // 1. 取出该团所有真人成员的 orderId
  const members = await tx.treasureGroupMember.findMany({
    where: { groupId, memberType: 0 },  // 排除机器人
    select: { userId: true, orderId: true },
  });

  // 2. 按购买份数加权（买3份=3张签）
  const tickets: Array<{ userId: string; orderId: string }> = [];
  for (const m of members) {
    if (!m.orderId) continue;
    const order = await tx.order.findUnique({
      where: { orderId: m.orderId },
      select: { buyQuantity: true },
    });
    for (let i = 0; i < (order?.buyQuantity ?? 1); i++) {
      tickets.push({ userId: m.userId, orderId: m.orderId });
    }
  }

  if (tickets.length === 0) throw new Error('No eligible participants');

  // 3. 安全随机（crypto.randomInt 比 Math.random 更难被预测）
  const idx = crypto.randomInt(0, tickets.length);
  const winner = tickets[idx];

  // 4. 写入开奖结果
  await tx.lotteryResult.create({
    data: {
      groupId,
      treasureId: group.treasureId,
      winnerId: winner.userId,
      winnerOrderId: winner.orderId,
    },
  });

  // 5. 更新 TreasureGroup 开奖时间
  await tx.treasureGroup.update({
    where: { groupId },
    data: { drawnAt: new Date(), luckyWinnersCount: 1 },
  });

  // 6. 更新订单状态：winner → WAIT_DELIVERY，其余真人 → COMPLETED（参与奖）
  //    机器人成员没有 orderId，不处理
  await tx.order.updateMany({
    where: {
      orderId: { in: tickets.map(t => t.orderId) },
      orderId: { not: winner.orderId },
    },
    data: { orderStatus: ORDER_STATUS.COMPLETED },
  });
  await tx.order.update({
    where: { orderId: winner.orderId },
    data: { orderStatus: ORDER_STATUS.WAIT_DELIVERY },
  });

  return winner;
}
```

#### Step 3 — 接入现有流程

在 `GroupProcessor.handleOrderActivation` 中，将现在的"批量变 WAIT_DELIVERY"替换为调用 `LotteryService.drawWinner`。

#### Step 4 — 定时开奖（`lotteryMode=2`）

在 `GroupService` 中增加一个每分钟 Cron，扫描：

- `groupStatus = SUCCESS`
- `drawnAt IS NULL`（还没开过奖）
- `treasure.lotteryMode = 2` 且 `treasure.lotteryTime <= now`

触发 `LotteryService.drawWinner`。

### 2.5 难度评估

| 维度                     | 评级      | 说明                                                   |
| ------------------------ | --------- | ------------------------------------------------------ |
| Schema 改动              | 🟡 中     | 需新增 `LotteryResult` 表 + 一次 migrate               |
| 核心抽签算法             | 🟢 低     | 逻辑简单，用 `crypto.randomInt` 即可                   |
| 状态机改造               | 🟡 中     | 需修改 `GroupProcessor`，原逻辑需替换                  |
| `lotteryMode=2` 定时开奖 | 🟡 中     | 新增 Cron 分支，较独立                                 |
| 通知接入                 | 🟢 低     | 基础设施（Socket + FCM）已有，只需传 winner/loser 区分 |
| **整体**                 | **🟡 中** | 约 2-3 天工作量，主要风险在状态机改造和兼容历史订单    |

### 2.6 与福利抽奖（LuckyDraw）的合并执行顺序

> 详细福利抽奖设计见 `LUCKY_DRAW_DESIGN_CN.md`。  
> **两个系统都挂在"团成功"事件上，必须明确先后顺序，否则实现时会产生歧义。**

#### 正确执行链路

```
handleGroupSuccessInTx()
  → emitGroupSuccessSignal (BullMQ)
    → GroupProcessor.handleOrderActivation
        │
        ├── 步骤 1（本文档）：LotteryService.drawWinner(groupId, tx)
        │     ├── 随机从真人成员中选出 1 位 winner
        │     ├── winner 订单 → WAIT_DELIVERY（等待发货）
        │     └── 其余真人订单 → COMPLETED（参与奖）
        │
        └── 步骤 2（LUCKY_DRAW_DESIGN_CN.md Phase C）：
              [事务外 fire-and-forget]
              LuckyDrawService.issueTicketsForGroup(groupId)
                  ├── 查找活动：status=1 AND 时间有效
                  └── 为所有真人成员发 1 张福利抽奖券
                       （不区分 winner/loser，人人都有）
```

#### 关键约束

| 约束                   | 说明                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ |
| **顺序**：开奖先于发券 | 发券不依赖开奖结果，但逻辑上"先决定商品归属，再发福利"                         |
| **开奖在事务内**       | `drawWinner` 必须在 `$transaction` 里（原子写 `LotteryResult` + 更新订单状态） |
| **发券在事务外**       | `issueTicketsForGroup` 用 `fire-and-forget`，失败不影响订单状态机              |
| **机器人不发券**       | `memberType=1` 在发券时跳过（与开奖排除逻辑一致）                              |

---

### 2.7 核心风险

1. **历史订单兼容**：现存 `WAIT_DELIVERY` 的订单全是"假赢家"，新逻辑上线前需要数据迁移策略或标记字段区分新旧。
2. **并发安全**：开奖必须用 `$transaction` + 幂等锁（`jobId: draw_${groupId}`），防止一个团被开两次奖（BullMQ `jobId` 已有模板）。
3. **机器人补满即开奖**：`fillSingleRobot` 里的 `emitGroupSuccessSignal` 会触发开奖，但机器人没有 `orderId`，代码必须过滤 `memberType=1`（字段已在，不会漏掉）。
4. **输家体验**：输家订单应变为 `COMPLETED`（参与奖）并退还差额还是保持原价？需要产品定义，影响退款逻辑。

---

## 三、秒杀逻辑

### 3.1 现有架构回顾

```
FlashSaleService (admin)
  ├── createSession / updateSession / deleteSession   ← 只有 CRUD
  ├── bindProduct / updateProduct / removeProduct     ← 只有 CRUD
  └── ❌ 没有任何 client 侧消费这些数据

checkout (OrderService)
  └── 读 treasure.unitAmount → 下单
      ❌ 不查 FlashSaleProduct
      ❌ CheckoutDto 没有 flashSaleProductId 字段
```

秒杀数据只是展示用的，下单时完全绕过。

### 3.2 完整的秒杀下单流程（应该是这样）

```
client 传入 flashSaleProductId (可选)
           ↓
checkout 查 FlashSaleProduct
  ├── 校验场次时间（startTime <= now <= endTime）
  ├── 校验场次状态（status = 1）
  ├── 用 flashPrice 替换 unitAmount
  └── 原子扣减 flashStock（不是 seqBuyQuantity）
           ↓
创建订单，unitPrice = flashPrice
```

### 3.3 实现方案

#### Step 1 — CheckoutDto 新增字段

```typescript
// checkout.dto.ts
@IsString()
@IsOptional()
flashSaleProductId?: string;   // 秒杀时传入，普通购买不传
```

#### Step 2 — checkout 中插入秒杀价格逻辑

在 `OrderService.checkOut` 的价格计算阶段（当前 `finalUnitPrice = treasure.unitAmount` 这一行之后）插入：

```typescript
if (dto.flashSaleProductId) {
  const fsp = await tx.flashSaleProduct.findUnique({
    where: { id: dto.flashSaleProductId },
    include: { session: true },
  });
  const now = new Date();

  if (!fsp) throw new BadRequestException("Flash sale product not found");
  if (fsp.treasureId !== treasureId)
    throw new BadRequestException("Flash sale product mismatch");
  if (fsp.session.status !== 1)
    throw new BadRequestException("Flash sale session is not active");
  if (now < fsp.session.startTime || now > fsp.session.endTime)
    throw new BadRequestException("Flash sale is not in progress");
  if (fsp.flashStock <= 0)
    throw new BadRequestException("Flash sale stock sold out");

  // 用秒杀价替换
  finalUnitPrice = fsp.flashPrice as unknown as Prisma.Decimal;

  // 原子扣减秒杀库存（用 SQL 防止超卖）
  const deducted = await tx.$executeRaw`
    UPDATE flash_sale_products
       SET flash_stock = flash_stock - ${entries}
     WHERE id = ${fsp.id}
       AND flash_stock >= ${entries}
  `;
  if (deducted !== 1)
    throw new BadRequestException("Flash sale stock insufficient");
}
```

#### Step 3 — Order 表记录秒杀来源（**必须添加，不可省略**）

```prisma
// schema.prisma — Order 新增字段
flashSaleProductId String? @map("flash_sale_product_id") @db.VarChar(32)
flashSaleProduct   FlashSaleProduct? @relation(fields: [flashSaleProductId], references: [id])
```

> ⚠️ **不是"可选"** — 退款时恢复 `flashStock` 必须知道该订单是否来自秒杀（见 §3.5 风险4）。  
> 若不记录此字段，`refundSingleOrder` 无法判断是否需要 `flashStock +1`，导致秒杀库存越来越少。  
> 同时需要在 `FlashSaleProduct` 上追加反向关联：`orders Order[]`。

### 3.4 难度评估

| 维度                  | 评级         | 说明                                                                  |
| --------------------- | ------------ | --------------------------------------------------------------------- |
| DTO 改动              | 🟢 低        | 加一个可选字段                                                        |
| checkout 价格注入     | 🟢 低        | 逻辑链路清晰，插入 ~30 行                                             |
| 秒杀库存原子扣减      | 🟢 低        | 已有 `$executeRaw` 扣库存的模板（`seq_buy_quantity`），照抄改表名即可 |
| 退款时恢复 flashStock | 🟡 中        | 需要在 `refundSingleOrder` 里判断是否秒杀订单，恢复库存               |
| Schema 变更           | 🟢 低        | Order 新增一个可选字段，一次 migrate                                  |
| **整体**              | **🟢 低-中** | 约 1 天工作量，风险主要在库存防超卖                                   |

### 3.5 核心风险

1. **超卖（Oversell）**：`flashStock` 必须用 `$executeRaw` + `WHERE flash_stock >= entries` 原子扣减，不能用 `update({ data: { flashStock: { decrement: entries } } })`（Prisma ORM 不能原子检查）。
2. **价格篡改**：前端传 `flashSaleProductId`，后端必须重新查价格，绝对不能信任前端传的价格。
3. **秒杀 + 优惠券叠加**：需要产品明确是否允许，代码里目前 `couponAmount` 和 `flashPrice` 各自独立，叠加无障碍（可能不是预期）。
4. **退款恢复库存**：退款时若是秒杀订单，`flashStock` 需 +1，否则秒杀库存会越来越少。

---

## 四、两个功能对比总结

| 对比维度         | 开奖逻辑                                           | 秒杀逻辑                                  |
| ---------------- | -------------------------------------------------- | ----------------------------------------- |
| **改动范围**     | GroupProcessor + 新增 LotteryService + Schema 新表 | OrderService + CheckoutDto + (可选)Schema |
| **影响面**       | 拼团整体状态机（高风险区）                         | 仅 checkout 一条路径（低风险）            |
| **需要 migrate** | ✅ 需要（新增 LotteryResult 表）                   | 🟡 可选（Order 加字段）                   |
| **需要 Cron**    | ✅ 定时开奖场景需要                                | ❌ 不需要                                 |
| **历史数据问题** | ⚠️ 有（现有 WAIT_DELIVERY 订单全是假赢家）         | ✅ 无，新逻辑只影响新下单                 |
| **预计工时**     | 2-3 天                                             | 0.5-1 天                                  |
| **建议优先级**   | 🟡 第二（依赖产品规则确认）                        | 🔴 第一（规则明确，可直接动手）           |

---

## 五、建议执行顺序

> 以下为历史执行计划。对应改造已在后续阶段落地，保留仅供复盘。

```
Phase A（约 1 天）：秒杀逻辑
  [ ] CheckoutDto 加 flashSaleProductId
  [ ] OrderService.checkOut 插入秒杀价格校验 + 原子扣库存
  [ ] Order Schema 加 flashSaleProductId 字段 + migrate
  [ ] refundSingleOrder 恢复 flashStock
  [ ] 写 Vitest 单元测试（正常秒杀 / 超卖 / 场次未开 / 价格不一致）

Phase B（约 2-3 天）：开奖逻辑
  [ ] 和产品确认：输家订单状态、是否按份数加权、winner 数量
  [ ] 新增 LotteryResult 表 + `TreasureGroup/User` 反向关联 + migrate
  [ ] 新增 LotteryService.drawWinner（crypto.randomInt + 按份加权）
  [ ] 替换 GroupProcessor 里的批量 WAIT_DELIVERY 逻辑（接入 LotteryService，见 §2.6）
  [ ] 在 GroupProcessor 事务外追加 LuckyDrawService.issueTicketsForGroup（见 §2.6 + LUCKY_DRAW_DESIGN_CN.md）
  [ ] 新增定时开奖 Cron（lotteryMode=2 场景）
  [ ] 通知接入（winner/loser 分别推送不同消息）
  [ ] 写 Vitest 单元测试（正常开奖 / 机器人排除 / 并发幂等）
  [ ] 历史数据处理脚本（可选，若需上线前清理）
```

---

## 六、不动就上线的风险

| 风险                       | 级别  | 描述                                              |
| -------------------------- | ----- | ------------------------------------------------- |
| 秒杀活动对下单无效         | 🔴 高 | 用户看到秒杀价，但实际以原价扣款，投诉/退款率极高 |
| 所有拼团参与者都能收到商品 | 🔴 高 | 平台亏损无上限，1 个商品所有参团者都变待发货      |
| 秒杀库存无法消耗           | 🟡 中 | `flashStock` 永远不变，秒杀活动没有截止效果       |
| 开奖结果无法追溯           | 🟡 中 | 无 `LotteryResult` 表，出现纠纷时无法举证随机性   |
