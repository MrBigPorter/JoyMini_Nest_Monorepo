# 抽奖功能设计文档

> 状态：已实现（核心链路已落地，本文档保留为设计与复盘）  
> 作者：Copilot 设计审计  
> 日期：2026-03-18
> 最后对齐时间：2026-03-19（当前执行状态以 `.github/copilot-instructions.md` 为准）

---

## 一、业务定义

### 1.1 是什么

抽奖是**平台福利性激励功能**，与 Treasure 主商品购买完全独立：

| 维度             | 说明                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| 用户费用         | **零成本**，用户不需要付任何额外的钱                                 |
| 触发条件（团购） | **团成功（GROUP_STATUS = SUCCESS）** 后，该团所有真人成员各得 1 张券 |
| 触发条件（单买） | 单独购买（isGroup=false）订单支付成功后，得 1 张券                   |
| 参与方式         | 用户**主动点击「抽一下」**才消耗券，不点就永久保留                   |
| 奖品范围         | 优惠券 / 金币 / 余额充值 / 谢谢参与（保底）                          |
| 没抽中           | 无任何损失，商品该得到照拿                                           |

### 1.2 不是什么

- ❌ 不是 Treasure 主商品的开奖（Treasure 仍是全员发货的团购）
- ❌ 不是付费彩票
- ❌ 不是强制参与（券可以不用）

### 1.3 核心价值

```
用户下单成功 → 多一次免费抽奖机会 → 提升留存 / 复购率
```

---

## 二、数据模型设计

### 2.1 ER 关系图

```
LuckyDrawActivity  (活动配置，admin 创建)
  │
  ├──< LuckyDrawPrize    (奖品配置，设置概率和奖励内容)
  │       │
  │       └──< LuckyDrawResult  (抽奖结果，每次抽奖写一条)
  │
  └──< LuckyDrawTicket   (抽奖券，下单成功后自动发放)
          │
          └──  LuckyDrawResult  (ticket:result = 1:1)
```

### 2.2 四张新表说明

#### `lucky_draw_activities` — 抽奖活动

| 字段          | 类型          | 说明                                    |
| ------------- | ------------- | --------------------------------------- |
| `id`          | String (cuid) | PK                                      |
| `title`       | String        | 活动名称（如"购买后得好礼"）            |
| `description` | String?       | 活动说明                                |
| `treasure_id` | String?       | 绑定商品ID，**为空=全平台任意订单触发** |
| `status`      | Int           | 0=禁用 1=启用                           |
| `start_at`    | DateTime?     | 活动开始时间（空=立即生效）             |
| `end_at`      | DateTime?     | 活动结束时间（空=永久）                 |

> `treasure_id` 可为空，设计支持"买JM-001才能抽"和"任何订单都能抽"两种场景。

#### `lucky_draw_prizes` — 奖品配置

| 字段          | 类型          | 说明                                             |
| ------------- | ------------- | ------------------------------------------------ |
| `id`          | String (cuid) | PK                                               |
| `activity_id` | String        | FK → LuckyDrawActivity                           |
| `prize_type`  | Int           | **1=优惠券 2=金币 3=余额 4=谢谢参与**            |
| `prize_name`  | String        | 展示名（如"₱50 优惠券"、"100金币"）              |
| `coupon_id`   | String?       | 关联 Coupon 模板ID（type=1时必填）               |
| `prize_value` | Decimal?      | 金币数量或余额金额（type=2/3时必填）             |
| `probability` | Decimal       | 中奖权重 0-100，**同一活动所有奖品权重之和=100** |
| `stock`       | Int           | 剩余数量（-1=不限）                              |
| `sort_order`  | Int           | 展示排序                                         |

#### `lucky_draw_tickets` — 抽奖券

| 字段          | 类型          | 说明                                   |
| ------------- | ------------- | -------------------------------------- |
| `id`          | String (cuid) | PK                                     |
| `user_id`     | String        | FK → User                              |
| `activity_id` | String        | FK → LuckyDrawActivity                 |
| `order_id`    | String        | 来源订单ID（幂等用，一个订单只发一张） |
| `used`        | Boolean       | false=未使用 true=已使用               |
| `used_at`     | DateTime?     | 使用时间                               |
| `expire_at`   | DateTime?     | 券过期时间（空=永不过期）              |

#### `lucky_draw_results` — 抽奖结果

| 字段             | 类型           | 说明                                            |
| ---------------- | -------------- | ----------------------------------------------- |
| `id`             | String (cuid)  | PK                                              |
| `ticket_id`      | String @unique | FK → LuckyDrawTicket（1:1，保证一票只能用一次） |
| `user_id`        | String         | FK → User（冗余，方便查询）                     |
| `prize_id`       | String         | FK → LuckyDrawPrize（抽中的奖品）               |
| `prize_snapshot` | Json           | 抽奖时奖品的快照（防止奖品被改后对账出问题）    |

---

## 三、核心流程

### 3.1 发券流程

发券有**两条触发路径**，分别对应团购和单买：

#### 路径 A：团购 → 团成功时给所有真人成员发券

```
团满员 → handleGroupSuccessInTx()
    ↓
emitGroupSuccessSignal (BullMQ)
    ↓
GroupProcessor 处理 activate_orders（现有逻辑，不变）
    ↓
[事务外，fire-and-forget] LuckyDrawService.issueTicketsForGroup(groupId)
    │
    ├── 查询该团所有真人成员（memberType=0）及其 orderId / treasureId
    │
    ├── 查找匹配的活动：status=1 AND 时间有效 AND
    │              (treasure_id IS NULL OR treasure_id = group.treasureId)
    │
    ├── 幂等检查：(orderId, activityId) 是否已有 ticket
    │
    └── 为每位真人成员 createMany LuckyDrawTicket（used=false）
```

> **为什么在团成功时发，而不是下单时发**：  
> 若团失败 → 成员被退款，但抽奖券已发出 → 用户拿回了钱还有券，不合理。  
> 团成功才是"购买真正完成"的时刻，此时发券语义正确。

> **机器人不发券**：`memberType=1` 的机器人跳过，不创建 ticket。

#### 路径 B：单独购买（isGroup=false）→ 下单成功即发券

```
checkOut(isGroup=false) 事务提交成功
    ↓
[事务外，fire-and-forget] LuckyDrawService.issueTicketForOrder(userId, treasureId, orderId)
    │
    ├── 查找活动：status=1 AND 时间有效 AND
    │             (treasure_id IS NULL OR treasure_id = treasureId)
    │
    ├── 幂等检查：(orderId, activityId) 是否已有 ticket
    │
    └── 创建 LuckyDrawTicket（used=false）
```

> **两条路径共用同一个幂等键**：`(order_id, activity_id)` 联合唯一索引，无论哪条路径触发，DB 层保证不重复。

### 3.2 抽奖流程（用户点击「抽一下」时触发）

```
POST /client/lucky-draw/draw/:ticketId
    │
    ├── 1. 验证 ticket 归属当前 userId，且 used=false，且未过期
    │
    ├── 2. 读取 activity 的所有 prizes（按 sort_order 排序）
    │
    ├── 3. 过滤掉 stock=0 的奖品（已抢光）
    │
    ├── 4. 概率抽签（见 3.3 算法）
    │
    ├── 5. 原子扣减 prize.stock（-1=不限则跳过）
    │       └── 若扣减失败（库存为0），降级到"谢谢参与"奖品
    │
    ├── 6. 奖品下发（见 3.4 下发逻辑）
    │
    ├── 7. 写入 LuckyDrawResult（含 prize_snapshot）
    │
    └── 8. 更新 ticket.used=true, used_at=now
```

> **整个 5-8 步在一个 Prisma $transaction 内完成**，保证原子性。

### 3.3 概率算法

使用**加权随机抽签**，精度到 0.01%：

```typescript
// 所有有效奖品的权重（stock > 0 或 stock = -1）
// 假设: [ {prize: A, prob: 10}, {prize: B, prob: 20}, {prize: C, prob: 70} ]
// 累积: A → [0, 10), B → [10, 30), C → [30, 100)

const PRECISION = 10000; // 精度: 0.01%
const roll = crypto.randomInt(0, PRECISION); // [0, 9999]

let cumulative = 0;
for (const prize of prizes) {
  cumulative += Math.round(prize.probability.toNumber() * 100);
  if (roll < cumulative) return prize;
}
return fallbackPrize; // 兜底谢谢参与
```

> 使用 `crypto.randomInt`（Node.js 内置），比 `Math.random()` 具备密码学随机性，更难被预测。

### 3.4 奖品下发逻辑

| prize_type   | 下发方式                                                       | 依赖 |
| ------------ | -------------------------------------------------------------- | ---- |
| 1 = 优惠券   | 复用 `ClientCouponService.claimCoupon(userId, prize.couponId)` | 已有 |
| 2 = 金币     | 调用 `WalletService.creditCoin(userId, prize.prizeValue)`      | 已有 |
| 3 = 余额     | 调用 `WalletService.creditCash(userId, prize.prizeValue)`      | 已有 |
| 4 = 谢谢参与 | 无操作，仅记录 result                                          | —    |

> 奖品下发失败（如优惠券库存为0）**不应抛出异常让整个事务回滚**，而是降级为"谢谢参与"并记录降级原因到 `prize_snapshot`。

---

## 四、API 接口设计

### 4.1 Client 端接口

| 方法   | 路径                                | 说明                         |
| ------ | ----------------------------------- | ---------------------------- |
| `GET`  | `/client/lucky-draw/my-tickets`     | 查询我的抽奖券列表（带分页） |
| `POST` | `/client/lucky-draw/draw/:ticketId` | 执行一次抽奖（消耗券）       |
| `GET`  | `/client/lucky-draw/my-results`     | 查询我的抽奖历史             |

#### 实时事件（Socket / `dispatch`）

| 事件 type                  | 说明                   | 触发时机                       |
| -------------------------- | ---------------------- | ------------------------------ |
| `lucky_draw_ticket_issued` | 通知用户有新抽奖券可用 | 团成功后发券成功（逐用户推送） |

事件 payload（当前实现）

```json
{
  "type": "lucky_draw_ticket_issued",
  "data": {
    "groupId": "grp_xxx",
    "ticketId": "tkt_xxx",
    "activityId": "act_xxx",
    "orderId": "ord_xxx",
    "issuedAt": 1760000000000
  }
}
```

#### `GET /client/lucky-draw/my-tickets` 响应

```typescript
{
  total: number;
  list: {
    ticketId: string;
    activityTitle: string;
    orderId: string;
    expireAt: string | null;
    createdAt: string;
  }
  [];
}
```

#### `POST /client/lucky-draw/draw/:ticketId` 响应

```typescript
{
  prizeType: 1 | 2 | 3 | 4;
  prizeName: string;        // "₱50 优惠券" / "100金币" / "谢谢参与"
  prizeValue?: number;      // 金额或金币数
  isWin: boolean;           // type != 4 为 true
  // 若中了优惠券，直接返回 userCouponId 供前端跳转
  userCouponId?: string;
}
```

#### `GET /client/lucky-draw/my-results` 响应

```typescript
{
  total: number;
  page: number;
  pageSize: number;
  list: {
    id: string;
    prizeName: string; // "₱50 优惠券" / "100金币" / "谢谢参与"
    prizeType: 1 | 2 | 3 | 4;
    isWin: boolean; // prizeType != 4
    createdAt: string; // ISO8601（抽奖时间）
  }
  [];
}
```

> **注意**：客户端响应不含 `userId / userNickname`（用户自知其身份，无需冗余字段）。  
> Admin 侧才返回用户信息（见 §4.2）。

### 4.2 Admin 端接口

| 方法     | 路径                                      | 说明                                                              |
| -------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/admin/lucky-draw/activities`            | 活动列表（含 `treasureName` / `prizeCount` / `ticketCount` JOIN） |
| `POST`   | `/admin/lucky-draw/activities`            | 创建活动                                                          |
| `PATCH`  | `/admin/lucky-draw/activities/:id`        | 更新活动（改时间/状态/绑商品）                                    |
| `DELETE` | `/admin/lucky-draw/activities/:id`        | 删除活动                                                          |
| `GET`    | `/admin/lucky-draw/activities/:id/prizes` | 查活动奖品列表（含 `couponName` JOIN）                            |
| `POST`   | `/admin/lucky-draw/activities/:id/prizes` | 添加奖品                                                          |
| `PATCH`  | `/admin/lucky-draw/prizes/:prizeId`       | 更新奖品（改概率/库存）                                           |
| `DELETE` | `/admin/lucky-draw/prizes/:prizeId`       | 删除奖品                                                          |
| `GET`    | `/admin/lucky-draw/results`               | 抽奖结果记录（带 `userId` / `activityId` / `page` 过滤）          |

#### `GET /admin/lucky-draw/activities` 响应（后端需做 JOIN + COUNT）

后端 Service 必须：

1. **JOIN** `Treasure` → 返回 `treasureName`（`treasure.productName`）
2. **COUNT** `_count.prizes` → 返回 `prizeCount`
3. **COUNT** `_count.tickets` → 返回 `ticketCount`（已发券总数）

```typescript
// 响应体（对应 Admin 前端 LuckyDrawActivity 类型）
{
  list: {
    id: string;
    title: string;
    description: string | null;
    treasureId: string | null;
    treasureName: string | null; // JOIN 后填充
    status: number;
    startAt: number | null; // Unix timestamp ms（null = 立即生效）
    endAt: number | null; // null = 永久
    prizeCount: number; // 该活动下奖品数量
    ticketCount: number; // 已发券总数
  }
  [];
}
```

#### `GET /admin/lucky-draw/results` 响应（含 JOIN 用户信息）

后端 Service 必须 JOIN `User` 表取 `nickName`（注意：User 模型字段名是 `nickName`，不是 `nickname`）。

```typescript
// Query Params
{
  activityId?: string;
  page?: number;        // 默认 1
  pageSize?: number;    // 默认 20
}

// 响应体（对应 Admin 前端 LuckyDrawResult 类型）
{
  total: number;
  page: number;
  pageSize: number;
  list: {
    id: string;
    userId: string;
    userNickname: string;   // JOIN User.nickName
    prizeName: string;
    prizeType: 1 | 2 | 3 | 4;
    isWin: boolean;
    createdAt: number;      // Unix timestamp ms
  }[];
}
```

---

## 五、模块架构

```
apps/api/src/
├── common/
│   └── lucky-draw/
│       ├── lucky-draw.service.ts   ← 核心：概率抽签 + 奖品下发
│       └── lucky-draw.module.ts    ← 导出 LuckyDrawService 供 OrderModule 使用
│
├── admin/
│   └── lucky-draw/
│       ├── lucky-draw.controller.ts   ← 活动/奖品 CRUD + 结果查询
│       ├── lucky-draw.service.ts      ← Admin CRUD 逻辑
│       ├── lucky-draw.module.ts
│       └── dto/
│           ├── create-activity.dto.ts
│           ├── update-activity.dto.ts
│           ├── create-prize.dto.ts
│           └── update-prize.dto.ts
│
└── client/
    └── lucky-draw/
        ├── lucky-draw.controller.ts   ← my-tickets / draw / my-results
        ├── lucky-draw.module.ts       ← 引入 common LuckyDrawModule + WalletModule
        └── dto/
            └── query-tickets.dto.ts
```

### 依赖关系图

```
触发点 A：团成功
  GroupService.handleGroupSuccessInTx()
    └── [setImmediate / fire-and-forget]
        └── LuckyDrawService.issueTicketsForGroup(groupId)

触发点 B：单独购买
  OrderService.checkOut(isGroup=false)
    └── [事务外 fire-and-forget]
        └── LuckyDrawService.issueTicketForOrder(userId, treasureId, orderId)

ClientLuckyDrawModule
  └── depends on: PrismaModule, WalletModule, CouponModule, LuckyDrawModule(common)

AdminLuckyDrawModule
  └── depends on: PrismaModule

GroupModule（common）
  └── 新增引入: LuckyDrawModule(common)  ← 用于团成功时发券
```

> ⚠️ **循环依赖检查**：GroupModule → LuckyDrawModule(common)，LuckyDrawModule 只依赖 PrismaModule / WalletModule / CouponModule，不回引 GroupModule，无循环。

---

## 六、数据合法性约束（防坑）

### 6.1 概率之和校验

Admin 添加/修改奖品时，后端校验：

```
同一 activity 下所有 prizes 的 probability 之和 = 100
```

若违反，返回 `400 BadRequest: Probabilities must sum to 100`。

### 6.2 必须有"谢谢参与"兜底

每个活动必须有至少一个 `prize_type=4` 的奖品作为兜底，否则概率计算时若其他奖品库存耗尽会出错。

> Admin 删除奖品时检查，若剩余非4类型奖品概率之和 < 100 且无4类型奖品，拒绝删除。

### 6.3 幂等防重复发券

`LuckyDrawTicket` 表在 `(order_id, activity_id)` 上加联合唯一索引，从数据库层保证一个订单对同一活动只发一张券。

### 6.4 抽奖并发防重

`LuckyDrawResult.ticket_id` 字段为 `@unique`。抽奖时先 `UPDATE tickets SET used=true WHERE id=? AND used=false`，若更新行数为 0（说明已被并发消耗），直接抛出 `409 Conflict`，BullMQ 重试无意义。

---

## 七、Schema Prisma 完整定义

```prisma
/// 抽奖活动
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

/// 奖品配置
model LuckyDrawPrize {
  id          String            @id @default(cuid())
  createdAt   DateTime          @default(now()) @map("created_at")
  activityId  String            @map("activity_id")
  /// 1=优惠券 2=金币 3=余额 4=谢谢参与
  prizeType   Int               @map("prize_type") @db.SmallInt
  prizeName   String            @map("prize_name") @db.VarChar(100)
  /// 关联优惠券模板（type=1 时必填）
  couponId    String?           @map("coupon_id") @db.VarChar(32)
  /// 奖励数量/金额（type=2/3 时必填）
  prizeValue  Decimal?          @map("prize_value") @db.Decimal(10, 2)
  /// 权重 0-100，同一活动所有奖品之和必须 = 100
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

/// 用户抽奖券（下单成功时自动发放）
model LuckyDrawTicket {
  id         String            @id @default(cuid())
  createdAt  DateTime          @default(now()) @map("created_at")
  userId     String            @map("user_id") @db.VarChar(32)
  activityId String            @map("activity_id")
  /// 来源订单（幂等键，一个订单对同一活动只能有一张）
  orderId    String            @map("order_id") @db.VarChar(32)
  used       Boolean           @default(false)
  usedAt     DateTime?         @map("used_at")
  expireAt   DateTime?         @map("expire_at")
  user       User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  activity   LuckyDrawActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  result     LuckyDrawResult?

  @@unique([orderId, activityId], map: "uk_order_activity")
  @@index([userId, used])
  @@map("lucky_draw_tickets")
}

/// 抽奖结果记录
model LuckyDrawResult {
  id             String          @id @default(cuid())
  createdAt      DateTime        @default(now()) @map("created_at")
  /// 1:1 ticket，保证一张券只对应一次结果
  ticketId       String          @unique @map("ticket_id")
  userId         String          @map("user_id") @db.VarChar(32)
  prizeId        String          @map("prize_id")
  /// 抽奖时的奖品快照（防止奖品被修改后对账出错）
  prizeSnapshot  Json            @map("prize_snapshot")
  ticket         LuckyDrawTicket @relation(fields: [ticketId], references: [id])
  prize          LuckyDrawPrize  @relation(fields: [prizeId], references: [id])
  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([prizeId])
  @@map("lucky_draw_results")
}
```

### 7.2 现有模型需追加的反向关联

以下三个模型**已存在**，只需在对应位置追加一行反向关联字段：

```prisma
// model Treasure — 在 flashSaleProducts 字段后追加：
luckyDrawActivities  LuckyDrawActivity[]

// model Coupon — 在 userCoupons 字段后追加：
luckyDrawPrizes      LuckyDrawPrize[]

// model User — 在已有关联字段末尾追加：
luckyDrawTickets     LuckyDrawTicket[]
luckyDrawResults     LuckyDrawResult[]
```

> ⚠️ **注意命名区分**：User 模型上同时会有：
>
> - `luckyDrawResults LuckyDrawResult[]` ← 本文档（福利抽奖结果）
> - `lotteryResults   LotteryResult[]` ← `LOTTERY_AND_FLASHSALE_IMPL_CN.md`（商品开奖结果）
>
> 两张表用途完全不同，**绝对不能混用字段名**。  
> 同理，`TreasureGroup` 模型需追加 `lotteryResults LotteryResult[]`（见 `LOTTERY_AND_FLASHSALE_IMPL_CN.md §2.4`），
> 这两次 migrate 建议合并成一次执行，避免遗漏。

> ⚠️ **关于 Admin 前端已有的旧类型**（`apps/admin-next/src/type/types.ts`）：
>
> | 旧类型名          | 含义                                             | 处理建议                                                       |
> | ----------------- | ------------------------------------------------ | -------------------------------------------------------------- |
> | `LotteryDraw`     | 旧占位（团购开奖 UI 展示）                       | 标记 `@deprecated`，实现后用 `LotteryResult` 替代              |
> | `LotteryActivity` | 旧占位（付费转盘/礼盒模板，有 `wheel/box/grid`） | 标记 `@deprecated`，功能完全不同于本文档的 `LuckyDrawActivity` |
> | `ActivityPrize`   | `LotteryActivity` 的子类型                       | 标记 `@deprecated`                                             |
> | `ActivityRule`    | `LotteryActivity` 的子类型                       | 标记 `@deprecated`                                             |
>
> 新增本文档类型（`LuckyDrawActivity` 等）时，**在旧类型上方加 `/** @deprecated \*/` 注释\*\*，防止后来开发者误用。

## 八、后端实现规范补充

### 8.1 Admin 接口安全（必须遵守）

所有 `/admin/lucky-draw/*` 接口必须受 `AdminJwtAuthGuard` + `RolesGuard` 保护，
与项目其他 admin 模块完全一致：

```typescript
// admin/lucky-draw/lucky-draw.controller.ts
@Controller('admin/lucky-draw')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminLuckyDrawController { ... }
```

### 8.2 Prisma v6 规范（违反会导致 TS 错误）

在 `LuckyDrawService` 实现中必须遵守：

| 禁止写法 ❌                    | 正确写法 ✅                                                          |
| ------------------------------ | -------------------------------------------------------------------- |
| `catch (e: any)` + `e.message` | `catch (e: unknown)` + `e instanceof Error ? e.message : String(e)`  |
| `$queryRawUnsafe<T>(...)`      | `await $queryRawUnsafe(...)` 后再 `as T`                             |
| JSON 字段写 `null`             | `Prisma.JsonNull`（prizeSnapshot 字段不存在此问题，但 future-proof） |

### 8.3 DTO class-validator（NestJS 规范）

所有 DTO 类必须使用 `class-validator` 装饰器，示例：

```typescript
// dto/create-activity.dto.ts
import {
  IsString,
  IsOptional,
  IsInt,
  IsDateString,
  Min,
  Max,
} from "class-validator";

export class CreateLuckyDrawActivityDto {
  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  treasureId?: string; // 空 = 全平台

  @IsInt()
  @Min(0)
  @Max(1)
  @IsOptional()
  status?: number;

  @IsDateString()
  @IsOptional()
  startAt?: string;

  @IsDateString()
  @IsOptional()
  endAt?: string;
}

// dto/create-prize.dto.ts
export class CreateLuckyDrawPrizeDto {
  @IsInt()
  @Min(1)
  @Max(4)
  prizeType!: number;

  @IsString()
  prizeName!: string;

  @IsString()
  @IsOptional()
  couponId?: string;

  @IsString()
  @IsOptional()
  prizeValue?: string; // Decimal as string

  @IsString()
  probability!: string; // "20.00"，后端用 parseFloat 转换

  @IsInt()
  @IsOptional()
  stock?: number; // -1 = 不限

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
```

---

## 九、关键风险点速查

| 风险                   | 预防措施                                                                          |
| ---------------------- | --------------------------------------------------------------------------------- |
| 同一订单重复发券       | `(order_id, activity_id)` 联合唯一索引                                            |
| 用户重复点击导致抽两次 | `ticket.used` + `result.ticket_id @unique` + 事务内先 `UPDATE WHERE used=false`   |
| 奖品库存超发           | `$executeRaw UPDATE SET stock=stock-1 WHERE id=? AND stock > 0`，影响行数=0则降级 |
| 下发优惠券失败炸事务   | try/catch 降级到"谢谢参与"，记录 `prize_snapshot.fallback=true`                   |
| 概率设置不合法         | 后端 create/update prize 时校验同活动概率之和 = 100                               |
| Admin 接口未鉴权       | controller 加 `@UseGuards(AdminJwtAuthGuard, RolesGuard)`                         |
| Prisma v6 TS 错误      | catch 用 `e: unknown`，JSON 字段用 `Prisma.JsonNull`                              |

---

## 十、前端设计

---

### 10.1 Admin 后台（Next.js）

> 所有实现必须严格遵守 `copilot-instructions.md` 技术规范：
>
> - 表单：`react-hook-form` + `zod` + `@hookform/resolvers@5`
> - **禁止** Zod schema 用 `.default()` → 改用 `useForm({ defaultValues: {...} })`
> - **禁止** Zod schema 用 `.transform()` → 在 submit handler 里手动转换
> - 数据请求：`ahooks/useRequest`
> - 多语言：en + zh 两个 key 都必须补全，写进 `src/constants.ts`

---

#### 10.1.1 文件清单（需新建的文件）

```
apps/admin-next/src/
├── app/(dashboard)/lucky-draw/
│   └── page.tsx                          ← 路由入口，只 render 视图组件
├── views/
│   └── LuckyDrawManagement.tsx           ← 主视图（含所有子组件）
├── type/types.ts                         ← 追加 Lucky Draw 相关接口类型
├── api/index.ts                          ← 追加 luckyDrawApi
├── constants.ts                          ← 追加 luckyDraw 翻译 key
└── routes/index.ts                       ← 追加路由配置
```

---

#### 10.1.2 路由注册（`routes/index.ts`）

在 `flash-sale` 条目**后面**追加：

```typescript
// routes/index.ts
import { Sparkles } from 'lucide-react'; // ⚠️ 用 Sparkles 不用 Gift（Gift 已被隐藏路由 /activity 占用）

{
  path: '/lucky-draw',
  name: 'luckyDraw',        // 对应 TRANSLATIONS key
  icon: Sparkles,
  group: 'Operations',
},
```

---

#### 10.1.3 多语言（`constants.ts`）

在 `en` 和 `zh` 两个对象里同时追加，**位置在 `flashSale` 后面**：

```typescript
// en 对象
flashSale: 'Flash Sale',
luckyDraw: 'Lucky Draw',   // ← 新增

// zh 对象
flashSale: '秒杀活动',
luckyDraw: '抽奖活动',     // ← 新增
```

---

#### 10.1.4 路由页面（`app/(dashboard)/lucky-draw/page.tsx`）

与 `flash-sale/page.tsx` 完全一致的模式：

```typescript
import React from 'react';
import { LuckyDrawManagement } from '@/views/LuckyDrawManagement';

export default function LuckyDrawPage() {
  return <LuckyDrawManagement />;
}
```

---

#### 10.1.5 TS 类型定义（`type/types.ts` 末尾追加）

```typescript
// ─── Lucky Draw ───────────────────────────────────────────────────────────────

export interface LuckyDrawActivity {
  id: string;
  title: string;
  description: string | null;
  treasureId: string | null;
  treasureName: string | null; // 后端 JOIN 后返回
  status: number; // 0=禁用 1=启用
  startAt: number | null; // Unix timestamp ms
  endAt: number | null;
  prizeCount: number;
  ticketCount: number; // 已发券总数
}

export interface LuckyDrawPrize {
  id: string;
  prizeType: 1 | 2 | 3 | 4; // 1=优惠券 2=金币 3=余额 4=谢谢参与
  prizeName: string;
  couponId: string | null;
  couponName: string | null; // 后端 JOIN 后返回
  prizeValue: string | null; // Decimal → string（type=2/3 时有值）
  probability: string; // Decimal → string，如 "20.00"
  stock: number; // -1=不限
  sortOrder: number;
}

export interface LuckyDrawResult {
  id: string;
  userId: string;
  userNickname: string;
  prizeName: string;
  prizeType: number;
  isWin: boolean;
  createdAt: number; // Unix timestamp ms
}

export interface CreateLuckyDrawActivityPayload {
  title: string;
  description?: string;
  treasureId?: string; // 空 = 全平台
  status?: number;
  startAt?: string; // ISO8601
  endAt?: string;
}

export type UpdateLuckyDrawActivityPayload =
  Partial<CreateLuckyDrawActivityPayload>;

export interface CreateLuckyDrawPrizePayload {
  prizeType: 1 | 2 | 3 | 4;
  prizeName: string;
  couponId?: string;
  prizeValue?: string;
  probability: string;
  stock?: number;
  sortOrder?: number;
}

export type UpdateLuckyDrawPrizePayload = Partial<CreateLuckyDrawPrizePayload>;

export interface LuckyDrawResultQueryParams {
  activityId?: string;
  page?: number;
  pageSize?: number;
}
```

---

#### 10.1.6 API 封装（`api/index.ts` 末尾追加）

```typescript
// api/index.ts — 追加在文件末尾
export const luckyDrawApi = {
  // ── 活动 ──────────────────────────────────────────────────────
  getActivities: () =>
    http.get<{ list: LuckyDrawActivity[] }>("/v1/admin/lucky-draw/activities"),

  createActivity: (data: CreateLuckyDrawActivityPayload) =>
    http.post<LuckyDrawActivity>("/v1/admin/lucky-draw/activities", data),

  updateActivity: (id: string, data: UpdateLuckyDrawActivityPayload) =>
    http.patch<LuckyDrawActivity>(
      `/v1/admin/lucky-draw/activities/${id}`,
      data,
    ),

  deleteActivity: (id: string) =>
    http.delete(`/v1/admin/lucky-draw/activities/${id}`),

  // ── 奖品 ──────────────────────────────────────────────────────
  getPrizes: (activityId: string) =>
    http.get<{ list: LuckyDrawPrize[] }>(
      `/v1/admin/lucky-draw/activities/${activityId}/prizes`,
    ),

  createPrize: (activityId: string, data: CreateLuckyDrawPrizePayload) =>
    http.post<LuckyDrawPrize>(
      `/v1/admin/lucky-draw/activities/${activityId}/prizes`,
      data,
    ),

  updatePrize: (prizeId: string, data: UpdateLuckyDrawPrizePayload) =>
    http.patch<LuckyDrawPrize>(`/v1/admin/lucky-draw/prizes/${prizeId}`, data),

  deletePrize: (prizeId: string) =>
    http.delete(`/v1/admin/lucky-draw/prizes/${prizeId}`),

  // ── 结果记录 ──────────────────────────────────────────────────
  getResults: (params: LuckyDrawResultQueryParams) =>
    http.get<PaginatedResponse<LuckyDrawResult>>(
      "/v1/admin/lucky-draw/results",
      params,
    ),
};
```

---

#### 10.1.7 Zod Schema 设计（⚠️ 禁止 `.default()` / `.transform()`）

> **必须**引入 `zodResolver`，表单验证才能生效：
>
> ```typescript
> import { zodResolver } from "@hookform/resolvers/zod";
> ```

```typescript
// 活动表单 schema — 无 .default()，用 useForm defaultValues 代替
const activitySchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string(),
  treasureId: z.string(), // 空字符串 = 全平台（submit 时手动转 undefined）
  status: z.number(),
  startAt: z.string(), // datetime-local string，submit 时手动转 ISO
  endAt: z.string(),
});
type ActivityForm = z.infer<typeof activitySchema>;

// ✅ 正确：resolver + defaultValues 配合使用
const {
  register,
  handleSubmit,
  watch,
  formState: { errors },
} = useForm<ActivityForm>({
  resolver: zodResolver(activitySchema), // ← 必须加
  defaultValues: {
    title: activity?.title ?? "",
    description: activity?.description ?? "",
    treasureId: activity?.treasureId ?? "",
    status: activity?.status ?? 1,
    startAt: activity?.startAt
      ? format(new Date(activity.startAt), "yyyy-MM-dd'T'HH:mm")
      : "",
    endAt: activity?.endAt
      ? format(new Date(activity.endAt), "yyyy-MM-dd'T'HH:mm")
      : "",
  },
});

// ✅ 正确：submit handler 里手动转换（替代 .transform()）
const onSubmit = async (values: ActivityForm) => {
  const payload: CreateLuckyDrawActivityPayload = {
    title: values.title,
    description: values.description || undefined,
    treasureId: values.treasureId || undefined, // 空字符串 → undefined（全平台）
    status: values.status,
    startAt: values.startAt || undefined,
    endAt: values.endAt || undefined,
  };
  // ...调用 API
};
```

```typescript
// 奖品表单 schema
const prizeSchema = z.object({
  prizeType: z.number(),
  prizeName: z.string().min(1, "Required"),
  couponId: z.string(),
  prizeValue: z.string(),
  probability: z.string().min(1, "Required"),
  stock: z.number(),
  sortOrder: z.number(),
});
type PrizeForm = z.infer<typeof prizeSchema>;

const { register, handleSubmit, watch } = useForm<PrizeForm>({
  resolver: zodResolver(prizeSchema), // ← 必须加
  defaultValues: {
    prizeType: prize?.prizeType ?? 4, // 默认"谢谢参与"
    prizeName: prize?.prizeName ?? "",
    couponId: prize?.couponId ?? "",
    prizeValue: prize?.prizeValue ?? "",
    probability: prize?.probability ?? "",
    stock: prize?.stock ?? -1,
    sortOrder: prize?.sortOrder ?? 0,
  },
});

// submit 时手动处理条件字段
const onSubmit = async (values: PrizeForm) => {
  const payload: CreateLuckyDrawPrizePayload = {
    prizeType: values.prizeType,
    prizeName: values.prizeName,
    probability: values.probability,
    stock: values.stock,
    sortOrder: values.sortOrder,
    // type=1 才传 couponId
    ...(values.prizeType === 1 ? { couponId: values.couponId } : {}),
    // type=2/3 才传 prizeValue
    ...(values.prizeType === 2 || values.prizeType === 3
      ? { prizeValue: values.prizeValue }
      : {}),
  };
  // ...调用 API
};
```

---

#### 10.1.8 `useRequest` 数据请求模式

与 `FlashSaleManagement.tsx` 完全一致的写法：

```typescript
// 活动列表
const {
  data,
  loading,
  run: refreshActivities,
} = useRequest(() => luckyDrawApi.getActivities());
const activities = data?.list ?? [];

// 奖品列表（依赖选中的 activityId）
const {
  data: prizeData,
  loading: prizeLoading,
  run: refreshPrizes,
} = useRequest(() => luckyDrawApi.getPrizes(selectedActivity!.id), {
  refreshDeps: [selectedActivity?.id],
  ready: !!selectedActivity,
});
const prizes = prizeData?.list ?? [];

// 结果记录（分页）
const { data: resultData, run: refreshResults } = useRequest(
  () =>
    luckyDrawApi.getResults({
      activityId: selectedActivity?.id,
      page,
      pageSize: 10,
    }),
  { refreshDeps: [selectedActivity?.id, page] },
);
```

> **Mutation 操作**（新建/删除）不用 `useRequest`，直接 `await` API，catch 错误后 `refresh()`，
> 与 `FlashSaleManagement.tsx` 保持一致。

---

#### 10.1.9 页面结构与组件拆分

文件 `views/LuckyDrawManagement.tsx` 内部组件划分：

```
LuckyDrawManagement          ← 主组件（export）
  ├── ActivityModal          ← 新建/编辑活动弹窗（useForm）
  ├── PrizeModal             ← 新建/编辑奖品弹窗（useForm）
  └── PrizesPanel            ← 右侧奖品面板（含概率合计校验 + 结果表格）
```

**主组件布局逻辑**：

```
FlashSaleManagement 的布局参考：
  - 未选中活动 → 显示活动列表（全宽）
  - 选中活动   → 显示 PrizesPanel（带返回按钮）

LuckyDrawManagement 采用双栏布局（与 FlashSale 不同，需并排展示）：
  - 左栏（1/3）：活动列表，点击高亮选中
  - 右栏（2/3）：选中活动的 PrizesPanel + 结果记录
  - 未选中时右栏显示空状态提示"← 请选择左侧活动"
```

**概率合计实时校验逻辑**：

```typescript
// 在 PrizesPanel 内部计算
const totalProbability = prizes.reduce(
  (sum, p) => sum + parseFloat(p.probability),
  0,
);
const isValid = Math.abs(totalProbability - 100) < 0.01; // 浮点误差容忍

// 展示
<span className={isValid ? 'text-green-500' : 'text-red-500'}>
  概率合计: {totalProbability.toFixed(2)} / 100 {isValid ? '✅' : '⚠️'}
</span>

// 新建奖品按钮：totalProbability >= 100 时 disabled
<button disabled={totalProbability >= 100} onClick={() => setShowPrizeModal(true)}>
  + Add Prize
</button>
```

**奖品类型动态字段**（watch prizeType）：

```typescript
const prizeType = watch('prizeType');

// 渲染
{prizeType === 1 && (
  <div>
    <label>Coupon Template *</label>
    <input {...register('couponId')} placeholder="Coupon ID" />
  </div>
)}
{(prizeType === 2 || prizeType === 3) && (
  <div>
    <label>{prizeType === 2 ? 'Coins Amount' : 'Balance (PHP)'} *</label>
    <input {...register('prizeValue')} type="number" step="0.01" />
  </div>
)}
{/* prizeType === 4：无额外字段 */}
```

---

#### 10.1.10 页面结构示意图

```
┌─────────────────────────────────────────────────────────────────────┐
│  PageHeader: "Lucky Draw Management"              [+ New Activity]   │
├─────────────────────────────┬───────────────────────────────────────┤
│  左栏 (w-1/3)               │  右栏 (w-2/3)                         │
│                             │                                       │
│  ┌─────────────────────┐   │  ┌─── 奖品配置 ─────────────────────┐  │
│  │ 🎯 购买后得好礼      │   │  │ [+ Add Prize]   合计: 100/100 ✅  │  │
│  │ 全平台 | 启用        │◀选│  │                                   │  │
│  │ 已发券: 128          │   │  │  奖品名     类型  概率  库存  操作  │  │
│  └─────────────────────┘   │  │  ₱50优惠券  券    20%  100   ✏️🗑  │  │
│                             │  │  100金币    金币  30%   -1   ✏️🗑  │  │
│  ┌─────────────────────┐   │  │  谢谢参与   保底  40%   -1   ✏️🗑  │  │
│  │ 🎯 JM-001专属活动   │   │  └───────────────────────────────────┘  │
│  │ JM-001 | 禁用        │   │                                       │
│  └─────────────────────┘   │  ┌─── 抽奖结果记录 ──────────────────┐  │
│                             │  │  用户       奖品      时间         │  │
│                             │  │  @alice     100金币   03-18 14:23  │  │
│                             │  │  @bob       谢谢参与  03-18 14:20  │  │
│                             │  │  [分页]                            │  │
│                             │  └───────────────────────────────────┘  │
└─────────────────────────────┴───────────────────────────────────────┘
```

---

### 10.2 Flutter 客户端

> 以下只描述**页面结构、状态逻辑、API 调用时机、UX 流程**，不涉及具体 Widget 代码。

---

#### 10.2.1 整体导航位置

抽奖功能的入口有**三处**，覆盖不同场景下的用户触达：

| 入口   | 位置                               | 触发条件                             |
| ------ | ---------------------------------- | ------------------------------------ |
| 入口 A | 订单成功页 → 底部 Banner / 卡片    | 购买成功 / 团成功后跳转到此页时展示  |
| 入口 B | 首页 Tab / 个人中心 → "我的抽奖券" | 用户主动查看                         |
| 入口 C | Push 通知 / Socket 推送            | 团成功时后端推送，点击通知直达抽奖页 |

---

#### 10.2.2 页面清单

```
LuckyDrawTicketListPage    // 我的抽奖券列表
LuckyDrawPage              // 单次抽奖交互页（核心）
LuckyDrawHistoryPage       // 抽奖历史记录
```

---

#### 10.2.3 LuckyDrawTicketListPage（我的抽奖券）

**数据来源**

```
GET /v1/client/lucky-draw/my-tickets
```

**页面状态**

```
loading | empty | list
```

**展示内容（每张券卡片）**

- 活动名称（如"购买后得好礼"）
- 来源订单号（截断展示后6位）
- 过期时间（如有）；若过期用灰色 + 已过期标签
- **「立即抽奖」按钮**（used=false 且未过期才可点）

**交互逻辑**

- 点击「立即抽奖」→ 带 `ticketId` 跳转到 `LuckyDrawPage`
- 列表按 `used + expireAt` 排序：未使用未过期在前，已使用/过期在后

---

#### 10.2.4 LuckyDrawPage（核心抽奖页）

这是用户体验最关键的页面，UX 设计决定激励效果。

**入参**

```dart
ticketId: String
activityTitle: String   // 展示用
```

**页面状态机**

```
idle → animating → revealed → (navigating away)
```

| 状态        | 展示内容                                             |
| ----------- | ---------------------------------------------------- |
| `idle`      | 抽奖按钮可点，显示转盘/礼盒 UI                       |
| `animating` | 播放转动/拆礼盒动画（建议 1.5~2s），期间禁止重复点击 |
| `revealed`  | 停止动画，展示中奖结果弹层（见下）                   |

**调用 API 时机**

```
用户点击「抽一下」
  → 立即进入 animating 状态（锁定按钮）
  → 同时发起 POST /v1/client/lucky-draw/draw/:ticketId
  → 等动画播放完 + API 返回（取两者中较晚的那个）
  → 进入 revealed 状态，展示结果
```

> **为什么动画和请求并发**：先播动画再等结果会让用户感觉快，但要保证动画不在结果返回前结束（用 `Future.wait([animFuture, apiFuture])`）。

**结果弹层内容（prizeType 决定展示）**

| prizeType    | 标题          | 图标     | 描述                   | CTA 按钮                       |
| ------------ | ------------- | -------- | ---------------------- | ------------------------------ |
| 1 = 优惠券   | 🎉 恭喜获得！ | 券图标   | "₱50 优惠券已存入钱包" | 「去使用」→ 跳转到我的优惠券页 |
| 2 = 金币     | 🪙 获得金币！ | 金币图标 | "100 金币已到账"       | 「查看钱包」→ 跳转到钱包页     |
| 3 = 余额     | 💰 获得余额！ | 钱包图标 | "₱30 已充入余额"       | 「查看钱包」→ 跳转到钱包页     |
| 4 = 谢谢参与 | 😊 谢谢参与   | 礼盒图标 | "下次好运！"           | 「关闭」                       |

**错误处理**

- 网络失败 → 动画停止 → Toast 提示"抽奖失败，请重试"，**不消耗 ticket**（因为后端事务未完成）
- 409 Conflict（票已被用）→ 提示"该券已使用"，返回券列表

---

#### 10.2.5 LuckyDrawHistoryPage（抽奖历史）

**数据来源**

```
GET /v1/client/lucky-draw/my-results?page=1&pageSize=20
```

**展示内容（每条记录）**

- 奖品名称 + 类型图标
- 抽奖时间
- 是否中奖（type != 4 显示绿色"已获得"，type=4 显示灰色"未中奖"）

---

#### 10.2.6 实时触达：Socket / Push 通知

**场景：团成功并完成发券 → 用户获得抽奖券**

后端在 `GroupService.notifyMembersOfResult(groupId, true)` 中已有：

- Socket 推送（`PushEventType.GROUP_SUCCESS`）
- FCM 推送

后端在 `LuckyDrawService.issueTicketsForGroup(groupId)` 中新增：

- 逐用户 Socket 推送 `SocketEvents.LUCKY_DRAW_TICKET_ISSUED`
- 推送房间：`user_{userId}`（私有房间，不走大厅广播）

客户端建议优先监听 `lucky_draw_ticket_issued`，并保留 `GROUP_SUCCESS` 兜底刷新：

```
收到 lucky_draw_ticket_issued Socket 事件
  │
  ├── 1. 直接把 badge +1（或触发一次 my-tickets 增量刷新）
  │
  └── 2. 展示提示：
         "🎉 你获得了新的抽奖券"
         [立即抽奖] → 跳转 LuckyDrawTicketListPage

收到 GROUP_SUCCESS Socket 事件（兜底）
  │
  ├── 1. 刷新"我的抽奖券"列表数据（调用 GET my-tickets）
  │
  └── 2. 展示提示（Toast / SnackBar）：
         "🎉 拼团成功！你有 1 次抽奖机会"
         [立即抽奖] 按钮 → 跳转到 LuckyDrawTicketListPage
```

FCM 通知点击（App 在后台/被杀死）：

```
点击通知 → cold start / resume → 解析 payload.type == 'lucky_draw'
  → 直接跳转到 LuckyDrawTicketListPage
```

---

#### 10.2.7 Badge（未使用券数量）

在入口 B（个人中心 / Tab）上展示红点 badge，数字 = 未使用 ticket 数量。

**获取方式**：`GET /v1/client/lucky-draw/my-tickets` 响应中 `total` 字段（只查 `used=false`）。

**刷新时机**：

- App 启动时初始化
- 收到 `GROUP_SUCCESS` Socket 事件时 +1
- 用户完成一次抽奖后 -1（本地即时更新，无需重新请求）

---

#### 10.2.8 状态管理建议（Provider / Riverpod / Bloc 均可）

```
LuckyDrawNotifier / LuckyDrawCubit
  state:
    tickets: List<LuckyDrawTicket>      // 未使用的券
    unreadCount: int                    // badge 数
    isDrawing: bool                     // 防止重复点击
    lastResult: LuckyDrawDrawResult?    // 最新一次抽奖结果

  actions:
    loadTickets()                       // 初始化拉取
    draw(ticketId)                      // 执行抽奖
    markTicketUsed(ticketId)            // 抽完后本地更新
    handleGroupSuccessEvent()           // 收到 Socket 事件时 +1
```

---

#### 10.2.9 客户端 API 接口汇总

| 接口                                        | 调用时机                      |
| ------------------------------------------- | ----------------------------- |
| `GET /v1/client/lucky-draw/my-tickets`      | 进入券列表页 / App 启动初始化 |
| `POST /v1/client/lucky-draw/draw/:ticketId` | 用户点击「抽一下」            |
| `GET /v1/client/lucky-draw/my-results`      | 进入历史记录页                |

**请求/响应类型（Dart 侧 Model 对应）**

```
// GET my-tickets 响应
{
  total: int,
  list: [
    {
      ticketId: String,
      activityTitle: String,
      orderId: String,
      expireAt: String?,     // ISO8601 or null
      createdAt: String,
    }
  ]
}

// POST draw/:ticketId 响应
{
  prizeType: int,            // 1/2/3/4
  prizeName: String,         // "₱50 优惠券" / "100金币" / "谢谢参与"
  prizeValue: double?,       // 金额或金币数
  isWin: bool,               // prizeType != 4
  userCouponId: String?,     // 中了优惠券时返回
}

// GET my-results 响应
{
  total: int,
  page: int,
  pageSize: int,
  list: [
    {
      id: String,
      prizeName: String,
      prizeType: int,
      isWin: bool,
      createdAt: String,
    }
  ]
}
```

---

#### 10.2.10 UX 细节注意事项

1. **动画时长 vs 网络延迟**：抽奖动画建议最短 1.5s。若 API 响应快于动画，等动画播完再显示结果；若 API 慢，动画可循环播放直到结果返回。

2. **防连击**：点击「抽一下」后立即将按钮置为 disabled + loading 态，API 返回（无论成功/失败）后才恢复，防止用户连点。

3. **离线/弱网提示**：抽奖失败时明确告知"抽奖未完成，券未消耗，请重试"，避免用户误以为券被扣了。

4. **优惠券中奖后的引导**：结果弹层的"去使用"CTA 直接跳转到优惠券列表，并高亮刚获得的那张，引导用户继续下单（提升 GMV）。

5. **谢谢参与的包装**：type=4 不要展示"未中奖"字眼，改为"谢谢参与，下次更幸运！"配合可爱的 emoji 或动画，减少负面感受。

---

## 十一、完整实现 Checklist（按执行顺序）

> 状态说明：A-H 为仓库内历史实施清单（主链路已落地并归档）；Phase I 为 Flutter 团队外部待办。
> 本节用于复盘与追溯，不作为当前开发待办入口。

### Phase A — 数据库（历史已完成）

- [x] `schema.prisma` 添加四张新表（`LuckyDrawActivity / Prize / Ticket / Result`）
- [x] `schema.prisma` 在 `Treasure / Coupon / User` 现有模型追加反向关联字段（见 7.2）
- [x] 宿主机执行：`node apps/api/node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma`
- [x] 容器内执行：`prisma migrate dev --name add_lucky_draw`
- [x] 重启 backend 容器：`docker compose --env-file deploy/.env.dev up -d backend`

### Phase B — 后端 Common（核心服务，历史已完成）

- [x] `common/lucky-draw/lucky-draw.service.ts`
  - `issueTicketsForGroup(groupId)` — 团成功时给所有真人成员发券
  - 发券成功后 `dispatchToUser(userId, lucky_draw_ticket_issued, payload)` 实时通知
  - `issueTicketForOrder(userId, treasureId, orderId)` — 单买时发券
  - `draw(userId, ticketId)` — 抽奖核心逻辑（验证→抽签→下发→记录，全在 `$transaction`）
  - 所有 catch 用 `(e: unknown)` + `e instanceof Error ? e.message : String(e)`（Prisma v6）
- [x] `common/lucky-draw/lucky-draw.module.ts` — exports `LuckyDrawService`

### Phase C — 后端 GroupModule 接入（触发点 A，历史已完成）

> ⚠️ **执行顺序约束**：`issueTicketsForGroup` 必须在 `LotteryService.drawWinner` **之后**（事务外）触发。  
> 即：先开奖决定商品归属，再 fire-and-forget 给所有真人发福利券。  
> 完整合并流程见 `LOTTERY_AND_FLASHSALE_IMPL_CN.md §2.6`。

- [x] `common/group/group.module.ts` — imports `LuckyDrawModule`（common）
- [x] `common/group/group.service.ts` — 在 `GroupProcessor.handleOrderActivation` 调用 `drawWinner` 完成后（事务外）追加：
  ```typescript
  // 在 LotteryService.drawWinner(groupId, tx) 调用完成后（事务外）
  setImmediate(() => {
    this.luckyDrawService
      .issueTicketsForGroup(groupId)
      .catch((e) => this.logger.error(`LuckyDraw issue failed: ${String(e)}`));
  });
  ```

### Phase D — 后端 OrderService 接入（触发点 B，历史已完成）

- [x] `client/orders/order.service.ts` — checkOut 成功后（事务外）追加 fire-and-forget 发券：
  ```typescript
  if (!isSoloBuy) return result; // 团购由团成功时触发，这里跳过
  this.luckyDrawService
    .issueTicketForOrder(userId, treasureId, order.orderId)
    .catch((e) => this.logger.warn(`LuckyDraw issue skipped: ${String(e)}`));
  ```

### Phase E — 后端 Admin 模块（历史已完成）

- [x] `admin/lucky-draw/dto/create-activity.dto.ts` — class-validator 装饰器（见 8.3）
- [x] `admin/lucky-draw/dto/create-prize.dto.ts` — class-validator 装饰器（见 8.3）
- [x] `admin/lucky-draw/lucky-draw.service.ts` — 活动/奖品 CRUD + 结果分页查询
- [x] `admin/lucky-draw/lucky-draw.controller.ts` — 加 `@UseGuards(AdminJwtAuthGuard, RolesGuard)`
- [x] `admin/lucky-draw/lucky-draw.module.ts`
- [x] `admin/admin.module.ts` — imports `AdminLuckyDrawModule`

### Phase F — 后端 Client 模块（历史已完成）

- [x] `client/lucky-draw/dto/query-tickets.dto.ts`
- [x] `client/lucky-draw/lucky-draw.controller.ts` — `my-tickets / draw / my-results`（加 `JwtAuthGuard`）
- [x] `client/lucky-draw/lucky-draw.module.ts` — imports `LuckyDrawModule(common)` + `WalletModule` + `CouponModule`
- [x] `client/client.module.ts` — imports `ClientLuckyDrawModule`

### Phase G — Seed（本地演示，可选，历史已完成）

- [x] `scripts/seed/seed-lucky-draw.ts` — 1 个全平台活动 + 4 个奖品（优惠券 20% / 金币 30% / 余额 10% / 谢谢参与 40%）
- [x] `scripts/seed/index.ts` — 引入并在 `[8] seedCoupons` 后调用

### Phase H — Admin Next.js 前端（历史已完成）

- [x] `routes/index.ts` — `flashSale` 后追加 `luckyDraw`（`Sparkles` 图标，`Operations` 分组）
- [x] `constants.ts` — en `luckyDraw: 'Lucky Draw'`、zh `luckyDraw: '抽奖活动'`
- [x] `type/types.ts` — 追加 Lucky Draw 相关类型（见 10.1.5）
- [x] `api/index.ts` — 追加 `luckyDrawApi`（见 10.1.6）
- [x] `app/(dashboard)/lucky-draw/page.tsx` — render `<LuckyDrawManagement />`
- [x] `views/LuckyDrawManagement.tsx` — 实现双栏视图：
  - `ActivityModal`：`resolver: zodResolver(activitySchema)` + `defaultValues` + submit 手动转换
  - `PrizeModal`：`resolver: zodResolver(prizeSchema)` + `watch('prizeType')` 动态字段
  - `PrizesPanel`：`useRequest` + 概率合计实时校验 + 结果分页表格
  - 主组件：`useRequest` + `PageHeader`（from `@/components/scaffold/PageHeader`）
  - 路由注册：`icon: Sparkles`（`import { Sparkles } from 'lucide-react'`，**不用 `Gift`**）

### Phase I — Flutter 客户端（交由 Flutter 团队实现，外部待办）

- [ ] `LuckyDrawTicketListPage` — 券列表 + badge
- [ ] `LuckyDrawPage` — 状态机（idle → animating → revealed）+ `Future.wait` 并发
- [ ] `LuckyDrawHistoryPage` — 历史记录分页
- [ ] `LuckyDrawNotifier/Cubit` — tickets / unreadCount / isDrawing / lastResult
- [ ] API 层封装三个接口（my-tickets / draw / my-results）
- [ ] Socket `lucky_draw_ticket_issued` → badge +1 + SnackBar（`GROUP_SUCCESS` 保底刷新）
- [ ] FCM `payload.type == 'lucky_draw'` → 跳转券列表页
- [ ] 个人中心 / Tab 入口注册 Badge
- [ ] 订单成功页增加抽奖入口 Banner
