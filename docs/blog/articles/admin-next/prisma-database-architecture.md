# Prisma 数据库架构设计：30+ 模型的分层体系与最佳实践

## 1. 架构概览

本项目采用 **Prisma ORM** + **PostgreSQL** 作为数据层，schema 文件位于 [`apps/api/prisma/schema.prisma`](../../../apps/api/prisma/schema.prisma)，共计 **1691 行**，定义了 **30+ 个模型**，覆盖用户、电商、支付、IM 聊天、抽奖、内容、管理后台等完整业务域。

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x", "linux-musl-openssl-3.0.x", "linux-arm64-openssl-1.1.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Prisma Client 编译为可执行二进制文件，针对不同部署环境（macOS 开发、Debian 生产、ARM 服务器）配置了多平台 targets。连接字符串通过环境变量 `DATABASE_URL` 注入，支持本地开发与云环境无缝切换。

### PrismaService 封装

服务层通过 [`PrismaService`](../../../apps/api/src/common/prisma/prisma.service.ts) 继承 `PrismaClient`，作为 NestJS 的全局单例注入：

```typescript
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      errorFormat: process.env.NODE_ENV !== 'production' ? 'pretty' : 'minimal',
      log: LOG_CONFIG,
    });
  }
}
```

关键工程特性：
- **指数退避重连**：`onModuleInit` 中最多重试 8 次，退避策略 `1000 * 2^(i-1)`，最大 10s
- **慢查询监控**：开发环境阈值 80ms，生产环境 200ms，打印 SQL 耗时与参数
- **连接优雅关闭**：`onModuleDestroy` 确保应用退出时断开数据库连接

![Prisma 架构分层图](https://via.placeholder.com/800x400?text=Prisma+Architecture+Layers)

---

## 2. 模型分组与领域划分

全部模型按业务域可分为 **10 个领域**：

| 领域 | 模型 | 数量 |
|------|------|------|
| 👤 用户中心 | `User`, `UserDevice`, `DeviceBlacklist`, `UserLoginLog`, `Device`(FCM) | 5 |
| 🔐 认证与安全 | `OauthAccount`, `SmsVerificationCode`, `OtpThrottle` | 3 |
| 🛒 电商核心 | `Treasure`, `TreasureCategory`, `TreasureGroup`, `TreasureGroupMember`, `ProductCategory`, `Order` | 6 |
| 💰 财务系统 | `UserWallet`, `WalletTransaction`, `RechargeOrder`, `WithdrawOrder`, `PaymentChannel` | 5 |
| 🎁 营销系统 | `Coupon`, `UserCoupon`, `Banner`, `Advertisement`, `ActSection`, `ActSectionItem` | 6 |
| 🎲 抽奖系统 | `LuckyDrawActivity`, `LuckyDrawPrize`, `LuckyDrawTicket`, `LuckyDrawResult`, `LotteryResult` | 5 |
| ⚡ 秒杀系统 | `FlashSaleSession`, `FlashSaleProduct` | 2 |
| 💬 即时通讯 | `Conversation`, `ChatMessage`, `ChatMessageHide`, `ChatMember`, `Friend`, `FriendRequest`, `GroupJoinRequest` | 7 |
| 📝 内容管理 | `BlogArticle`, `BlogCategory`, `BlogTag`, `BlogComment`, `UserBookmark`, `TranslationJob` | 6 |
| 🔧 管理后台 | `AdminUser`, `AdminRegisterApplication`, `AdminOperationLog`, `AdminPushLog`, `SystemConfig` | 5 |
| 🏛️ 地理信息 | `Province`, `City`, `Barangay`, `UserAddress` | 4 |
| 🆔 KYC 认证 | `KycRecord`, `KycLivenessAttempt`, `KycLivenessSession`, `KycIdType`, `KycOccupationType` | 5 |
| 📞 客服系统 | `SupportChannel` | 1 |

> **注意**：部分模型跨领域关联，如 `Order` 关联 `Treasure`、`User`、`FlashSaleProduct`、`UserCoupon` 等多个领域。

---

## 3. 命名规范与设计约定

### 3.1 表名与列名

所有表名使用 **snake_case** 复数形式，通过 `@@map()` 指定：

```prisma
@@map("users")          // users
@@map("oauth_accounts") // oauth_accounts
@@map("user_login_logs") // user_login_logs
```

所有列名使用 **snake_case**，通过 `@map()` 指定：

```prisma
id        String @id @default(cuid()) @map("id") @db.VarChar(32)
createdAt DateTime @default(now()) @map("created_at")
updatedAt DateTime @updatedAt @map("updated_at")
```

这意味着 Prisma 侧的 camelCase 字段名映射到数据库的 snake_case 列名——开发者享受 TypeScript 的 camelCase 自动补全，数据库层面保持 PostgreSQL 惯例。

### 3.2 ID 主键策略

统一使用 **CUID** 作为字符串主键，长度限制为 `VarChar(32)`：

```prisma
id String @id @default(cuid()) @map("id") @db.VarChar(32)
```

**例外情况**：
- `ProductCategory`, `PaymentChannel`, `Province`, `City`, `Barangay`：使用 `autoincrement()` 整数主键（配置表、地理信息表）
- `Device`：以 FCM Token 作为主键（`token String @id`）
- `SystemConfig`：以配置 key 作为主键
- `KycIdType`：手动分配 ID（`id Int @id @map("id")`）

### 3.3 字段类型选择

| Prisma 类型 | 数据库类型 | 适用场景 |
|-------------|-----------|---------|
| `String @db.VarChar(32)` | `VARCHAR(32)` | 主键、ID 字段 |
| `String @db.VarChar(255)` | `VARCHAR(255)` | URL、邮箱、名称 |
| `Decimal @db.Decimal(10, 2)` | `DECIMAL(10,2)` | 金额字段 |
| `Int @db.SmallInt` | `SMALLINT` | 枚举/状态字段 |
| `Json?` | `JSONB` | 灵活元数据 |
| `DateTime @db.Timestamptz(3)` | `TIMESTAMPTZ` | 带时区的时间戳 |

### 3.4 时间戳统一规范

```prisma
createdAt DateTime @default(now()) @map("created_at")
updatedAt DateTime @updatedAt @map("updated_at")
```

- `createdAt`：首次插入时设置
- `updatedAt`：Prisma 的 `@updatedAt` 自动在每次更新时刷新
- 时区敏感字段（如 `lastLoginAt`）使用 `@db.Timestamptz(3)` 存储时区信息

---

## 4. 关系模式深度解析

### 4.1 级联删除策略

本项目采用 **分级级联策略**：

| 策略 | 使用场景 | 示例 |
|------|---------|------|
| `onDelete: Cascade` | 子表强依赖父表 | `User` → `Order`, `User` → `KycRecord` |
| `onDelete: Restrict` | 保护历史记录 | `AdminUser` → `AdminOperationLog`, `AdminUser` → `BlogArticle` |
| `onDelete: SetNull` | 保留记录但解除关联 | `User` → `Device`(FCM) |

```prisma
// Cascade — 用户删除时同时删除订单
user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

// Restrict — 保护操作日志不丢失
admin AdminUser? @relation(fields: [adminId], references: [id], onDelete: Restrict)

// SetNull — FCM 设备保留记录，但 userId 置空
user User? @relation(fields: [userId], references: [id], onDelete: SetNull)
```

### 4.2 双向关系

User 模型拥有最多双向关系（15+ 个关联字段），例如好友关系的自引用：

```prisma
model User {
  friends     Friend[] @relation("UserFriends")
  friendOf    Friend[] @relation("FriendUsers")
  sentRequests     FriendRequest[] @relation("RequestSent")
  receivedRequests FriendRequest[] @relation("RequestReceived")
}

model Friend {
  userId   String @map("user_id")
  user     User   @relation("UserFriends", fields: [userId], references: [id])
  friendId String @map("friend_id")
  friend   User   @relation("FriendUsers", fields: [friendId], references: [id])
}
```

这允许通过 `User.friends` 查询自己的好友列表，通过 `User.friendOf` 查询谁把自己加为好友。

### 4.3 多对多关系

```prisma
// BlogArticle <-> BlogTag 多对多
model BlogArticle {
  tags BlogTag[] @relation("BlogArticleTags")
}
model BlogTag {
  articles BlogArticle[] @relation("BlogArticleTags")
}

// Treasure <-> ProductCategory 多对多（通过中间表 TreasureCategory）
model TreasureCategory {
  treasureId String
  categoryId Int
  @@unique([treasureId, categoryId])
}
```

Prisma 对隐式多对多（`BlogArticleTags`）自动生成中间表；对需要额外字段的多对多（如 `TreasureCategory`）使用显式中间模型。

---

## 5. 索引策略

### 5.1 覆盖索引

为常见查询模式设计复合索引，覆盖 WHERE 条件和 ORDER BY：

```prisma
@@index([conversationId, seqId])  // ChatMessage：按会话拉取历史消息
@@index([userId, status])          // UserCoupon：查询用户可用优惠券
@@index([groupId, status])         // GroupJoinRequest：管理员查待办
@@index([orderStatus, payStatus])  // Order：按状态筛选订单
@@index([status, startAt, endAt])  // LuckyDrawActivity：按时间范围查活动
```

### 5.2 时间范围索引

用于定时任务和报表查询：

```prisma
@@index([createdAt], map: "idx_user_created_at")
@@index([loginTime], map: "idx_login_log_time")
@@index([activityAtStart, activityAtEnd], map: "idx_activity_time")
@@index([validStartAt, validEndAt])
@@index([startTime, endTime])
@@index([expiresAt], map: "idx_sms_expires_at")
@@index([lastActive])
```

### 5.3 唯一索引与业务约束

```prisma
@@unique([provider, providerUserId])   // OauthAccount：防止重复绑定
@@unique([orderId, activityId])        // LuckyDrawTicket：幂等
@@unique([userId, friendId])           // Friend：防止重复加好友
@@unique([groupId, userId])            // TreasureGroupMember：一人一成员
@@unique([userId, articleId])          // UserBookmark：一人一收藏
@@unique([userId, deviceId])           // UserDevice：设备绑定
@@unique([slug])                        // BlogArticle/BlogCategory/BlogTag
```

---

## 6. 状态机模式

项目中多处使用 `SmallInt` 字段实现状态机模式：

### 6.1 Order 状态机（三轴联动）

```prisma
model Order {
  orderStatus   Int @default(1) @db.SmallInt  // 1待支付 2已支付 3取消 4退款
  payStatus     Int @default(0) @db.SmallInt  // 0未支付 1已支付
  refundStatus  Int @default(0) @db.SmallInt  // 0无 1申请中 2已通过 3已拒绝
  shippingStatus Int @default(0) @db.SmallInt // 0待发货 1已发货 2已签收
}
```

三个维度的状态组合覆盖订单全生命周期：
- **支付前**：`orderStatus=1, payStatus=0` → 取消走 `orderStatus=3`
- **支付后**：`orderStatus=2, payStatus=1` → 退款走 `refundStatus=1→2/3`
- **发货后**：`shippingStatus=0→1→2`

### 6.2 KYC 状态机

```prisma
// User 维度
kycStatus Int @default(0) @db.SmallInt  // 0未认证 1审核中 2审核失败 3待补充 4已认证

// KycRecord 维度
kycStatus Int @default(0) @db.SmallInt  // 同上
```

### 6.3 常见状态枚举模式

| 模型 | 字段 | 状态值 |
|------|------|--------|
| `Coupon` | `status` | 0=禁用 1=启用 |
| `UserCoupon` | `use_status` | 0=未使用 1=已使用 2=已过期 3=作废 |
| `WithdrawOrder` | `withdraw_status` | 1=待审核 2=已通过 3=已拒绝 4=已打款 |
| `AdminRegisterApplication` | `status` | `pending` / `approved` / `rejected` |
| `FriendRequest` | `status` | 0=待处理 1=已同意 2=已拒绝 |
| `BlogComment` | `status` | PENDING / APPROVED / REJECTED |

状态模式的优势：无需维护独立的 `Enum` 表，状态迁移由业务层 Service 通过 `Prisma.$transaction` 原子化控制。

---

## 7. 乐观锁并发控制

在 **高并发写入** 场景使用乐观锁：

```prisma
model Treasure {
  version Int @default(0) @map("version")
}

model TreasureGroup {
  version Int @default(0) @map("version")
}
```

更新操作在 Service 层实现 CAS（Compare-And-Swap）：

```typescript
const result = await this.prisma.treasureGroup.updateMany({
  where: {
    groupId,
    version: oldVersion,  // 条件版本
    currentMembers: { lt: maxMembers },
  },
  data: {
    currentMembers: { increment: 1 },
    version: { increment: 1 },
  },
});

if (result.count === 0) {
  // 要么版本冲突，要么已满员
  throw new BizException('Group is full or concurrent conflict');
}
```

这种模式避免了悲观锁（`SELECT ... FOR UPDATE`）的性能开销，适用于拼团入团等高频写入场景。

---

## 8. 财务字段精度与审计

### 8.1 金额字段

所有金额字段使用 `Decimal(10, 2)`，避免浮点精度问题：

```prisma
unitAmount Decimal @default(1.00) @map("unit_amount") @db.Decimal(10, 2)
finalAmount Decimal @map("final_amount") @db.Decimal(10, 2)
```

### 8.2 WalletTransaction 审计

```prisma
model WalletTransaction {
  beforeBalance Decimal @map("before_balance") @db.Decimal(10, 2)
  afterBalance  Decimal @map("after_balance") @db.Decimal(10, 2)
  transactionNo String  @unique @map("transaction_no") @db.VarChar(50)
  relatedId     String? @map("related_id")
  relatedType   String? @map("related_type")
}
```

通过 `beforeBalance` / `afterBalance` 记录每次变更前后的余额快照，结合 `transactionNo` 唯一索引实现幂等。`relatedId` + `relatedType` 提供多态关联（可关联 Order、RechargeOrder 等）。

---

## 9. 客服与 IM 聊天架构

### 9.1 Conversation 多态设计

```prisma
enum ConversationType {
  GROUP     // 手动创建的群
  DIRECT    // 私聊
  SUPPORT   // 客服聊天
  BUSINESS  // 自动业务群
}

model Conversation {
  id              String            @id @default(cuid())
  type            ConversationType
  businessId      String?           @unique  // 业务钩子
  status          Int               @default(1)
  lastMsgContent  String?
  lastMsgSeqId    Int               @default(0)  // 全局 SeqID
}
```

`Conversation` 通过 `type` 枚举区分四种会话类型，`businessId` 作为业务钩子关联外部业务实体（如 `TreasureGroup.groupId`）。

### 9.2 SeqID 消息序列

```prisma
model ChatMessage {
  seqId        Int           // 序列号
  clientTempId String?       // 前端去重
  isRecalled   Boolean       @default(false)
  hiddenByUsers ChatMessageHide[]
}
```

- `seqId`：全局单调递增的消息序号，用于消息排序和未读数计算
- `clientTempId`：前端生成的 UUID，用于消息去重和 ACK 确认
- `ChatMessageHide`：软删除机制（仅对特定用户隐藏，不实际删除消息）

### 9.3 ChatMember 未读计数

```prisma
model ChatMember {
  lastReadSeqId  Int   @default(0)
  clearedSeqId   Int   @default(0) @map("cleared_seq_id")
  isPinned       Boolean @default(false)
  isMuted        Boolean @default(false)
  mutedUntil     DateTime?
}
```

未读消息数 = `Conversation.lastMsgSeqId - ChatMember.lastReadSeqId`，这是 IM 系统的经典设计模式，无需额外计数表。

---

## 10. 博客系统多语言架构

### 10.1 渐进式多语言迁移

```prisma
model BlogArticle {
  // 原始单语言字段
  title   String  @db.VarChar(255)
  content String  @db.Text

  // 新增多语言 Json 字段
  titleLocalized   Json?   // { "en": "Title", "tl": "Pamagat" }
  contentLocalized Json?

  // 旧英文翻译字段（过渡期保留）
  titleEn   String? @db.VarChar(255)
  contentEn String? @db.Text

  // 翻译状态
  translationStatus TranslationStatus @default(PENDING)
}
```

采用 **渐进式迁移** 策略：
1. 原始字段保留兼容
2. 新增 `*Localized` Json 字段存储多语言内容
3. `TranslationStatus` 枚举跟踪翻译进度（PENDING → TRANSLATING → COMPLETED）

### 10.2 TranslationJob 任务队列

```prisma
model TranslationJob {
  type       String @db.VarChar(50)   // translate-article | translate-category | translate-tag
  targetId   String @db.VarChar(32)
  targetLang String @db.VarChar(10)
  status     String @db.VarChar(20)   // QUEUED | PROCESSING | COMPLETED | FAILED
  progress   Int    @default(0) @db.SmallInt
}
```

翻译任务通过 `type` + `targetId` 组合关联到不同内容类型（文章、分类、标签），支持异步翻译管道处理。

---

## 11. 优惠券与营销数据模型

### 11.1 Coupon 模板 vs UserCoupon 实例

```prisma
// 模板表（印钞模板）
model Coupon {
  couponName    String       @map("coupon_name")
  couponType    Int          @db.SmallInt  // 1=满减 2=折扣 3=无门槛
  discountValue Decimal      @db.Decimal(10, 2)
  totalQuantity Int          @default(-1)  // -1=不限量
  perUserLimit  Int          @default(1)
  validType     Int          @default(1)   // 1=固定日期 2=领券后N天
}

// 实例表（用户手里的券）
model UserCoupon {
  status       Int       @default(0) @db.SmallInt  // 0=未使用 1=已使用 2=已过期
  validStartAt DateTime  @map("valid_start_time")
  validEndAt   DateTime  @map("valid_end_time")
  discountAmount Decimal? @map("discount_amount")
}
```

**双表设计原则**：
- `Coupon`：定义优惠券的"模板"（面额、类型、总量）
- `UserCoupon`：用户领取后的"实例"（有效期固化、使用状态追踪）
- `validStartAt/validEndAt` 在领券时从模板复制并固化，避免模板修改后影响已发放的券

### 11.2 LuckyDrawPrize 权重设计

```prisma
model LuckyDrawPrize {
  prizeType   Int      @db.SmallInt  // 1=优惠券 2=金币 3=余额 4=谢谢参与
  probability Decimal  @db.Decimal(5, 2)  // 权重 0-100，总和=100
  stock       Int      @default(-1)  // -1=不限
  prizeValue  Decimal? @db.Decimal(10, 2)
}
```

- `probability`：同一活动内所有奖品的权重之和必须等于 100
- `stock`：有限库存，支持 `-1` 表示无限
- `prizeSnapshot` 在抽奖结果中记录快照，防篡改

---

## 12. KYC 安全数据模型

### 12.1 KycRecord 完整审计

```prisma
model KycRecord {
  // 身份信息
  realName      String?  @db.VarChar(150)
  idNumber      String?  @db.VarChar(50)
  birthday      DateTime?
  gender        String?  @db.VarChar(10)

  // 文件证据
  idCardFront   String?  @db.VarChar(255)
  idCardBack    String?  @db.VarChar(255)
  faceImage     String?  @db.VarChar(255)
  selfiePhoto   String?  @db.VarChar(255)

  // 风控数据
  riskLevel     Int      @default(0) @db.SmallInt
  securityFlags Json?
  ocrRawData    Json?

  // 审核审计
  auditorId     String?
  auditResult   String?
  rejectReason  String?  @db.VarChar(255)
  submittedAt   DateTime?
  auditedAt     DateTime?
}
```

### 12.2 KycLivenessAttempt 活体验证

```prisma
model KycLivenessAttempt {
  userId    String   @unique @map("user_id")
  attemptId String   @map("attempt_id")
  token     String   @map("token")
  expiresAt DateTime @map("expires_at")
}
```

`userId` 唯一约束保证同一用户只能有一个活跃的活体检测会话，`expiresAt` 索引用于清理过期会话。

---

## 13. 金融级数据一致性

### 13.1 Prisma $transaction

```typescript
await this.prisma.$transaction(async (tx: AuthTx) => {
  // 1. 查询 OauthAccount
  const oauthAccount = await tx.oauthAccount.findUnique({ ... });
  // 2. 创建/查找用户
  const user = await tx.user.upsert({ ... });
  // 3. 创建 OauthAccount 记录
  await this.upsertOauthAccount(tx, { ... });
  // 4. 记录登录日志
  await this.writeOauthLoginLog(tx, { ... });
  // 5. 颁发 Token
  return this.issueToken(user);
});
```

事务用于：
- **OAuth 登录**：5 步操作（查询 OauthAccount → upsert User → upsert OauthAccount → 写日志 → 发 Token）
- **退款审核**：验证订单 → 更新状态 → 恢复钱包余额 → 记录流水 → 恢复秒杀库存
- **KYC 提交**：更新用户状态 → 创建认证记录 → 记录安全日志

### 13.2 幂等键模式

```prisma
// 防止重复抽奖券
@@unique([orderId, activityId], map: "uk_ticket_order_activity")

// 防止重复好友申请
@@unique([fromUserId, toUserId])

// 防止重复加群申请（同一用户对同一群只能有一个 pending 申请）
@@unique([groupId, applicantId, status])
```

---

## 14. 妙用 Json 字段

### 14.1 Json 字段清单

| 模型 | Json 字段 | 用途 |
|------|-----------|------|
| `Treasure` | `mainImageList` | 产品主图列表（灵活扩展） |
| `Treasure` | `bonusConfig` | 奖励配置（结构多变） |
| `Banner` | `bannerArray` | 轮播图数组 |
| `Banner` | `extra` | 兜底扩展字段 |
| `Order` | `shippingAddress` | 收货地址快照 |
| `RechargeOrder` | `callbackData` | 支付回调原始数据 |
| `KycRecord` | `ocrRawData` | OCR 原始识别结果 |
| `KycRecord` | `securityFlags` | 安全风控标志 |
| `KycRecord` | `currentAddressJson` | 当前地址（灵活字段） |
| `BlogArticle` | `titleLocalized`, `contentLocalized` | 多语言内容 |
| `BlogCategory` | `name`, `description` | 多语言名称（JsonB） |
| `LuckyDrawResult` | `prizeSnapshot` | 奖品快照 |

### 14.2 Json vs 关系表选择标准

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 结构频繁变化 | Json | 避免频繁 DDL |
| 需要查询过滤 | 关系表 | Json 查询性能差 |
| 数据量大 (N > 100) | 关系表 | 索引优势 |
| 配置/元数据 | Json | 灵活性强 |
| 需要事务一致性 | 关系表 | 外键约束 |

---

## 15. 地理信息层级

```prisma
model Province {
  provinceId   Int      @id @default(autoincrement())
  provinceName String   @unique @db.VarChar(100)
  cities       City[]
}

model City {
  cityId    Int       @id @default(autoincrement())
  provinceId Int
  province  Province  @relation(fields: [provinceId], references: [provinceId])
  barangays Barangay[]
}

model Barangay {
  barangayId Int @id @default(autoincrement())
  cityId     Int
  city       City @relation(fields: [cityId], references: [cityId])
}
```

**三级层级**（菲律宾行政区划）：Province → City → Barangay

`UserAddress` 同时存储 ID 引用（外键约束保证完整性）和冗余名称字段（避免 JOIN 查询）：

```prisma
model UserAddress {
  province    String    @db.VarChar(50)   // 冗余名称
  provinceId  Int
  provinceRel Province  @relation(fields: [provinceId], references: [provinceId])
}
```

---

## 16. 性能优化最佳实践

### 16.1 查询优化

```typescript
// ✅ 按需查询（select）
const user = await prisma.user.findUnique({
  where: { id },
  select: { id: true, nickname: true, avatar: true },
});

// ✅ 批量查询（findMany + 分页）
const [list, total] = await Promise.all([
  prisma.order.findMany({ skip, take, where, orderBy }),
  prisma.order.count({ where }),
]);

// ✅ 并行查询（Promise.all）
const [userCount, orderCount, revenue] = await Promise.all([
  prisma.user.count(),
  prisma.order.count({ where: { orderStatus: 2 } }),
  prisma.order.aggregate({ _sum: { finalAmount: true } }),
]);
```

### 16.2 报表专用原生 SQL

对于复杂报表，使用 `$queryRaw` 执行原生 SQL 获得 PostgreSQL 完整能力：

```typescript
const orderTrend = await this.prisma.$queryRaw<Array<{
  date: string;
  count: bigint;
  revenue: string;
}>>`
  SELECT
    TO_CHAR(created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
    COUNT(*)::text AS count,
    COALESCE(SUM(CASE WHEN order_status = 2 THEN final_amount ELSE 0 END), 0)::text AS revenue
  FROM orders
  WHERE created_at >= ${cutoff}
  GROUP BY date ORDER BY date ASC
`;
```

### 16.3 连接池配置

Prisma 内部维护连接池，通过 PrismaService 的指数退避重试机制确保高可用。慢查询阈值根据环境动态调整（开发 80ms / 生产 200ms），配合日志监控及时发现性能瓶颈。

---

## 17. 总结

本项目 Prisma Schema 的设计体现了以下核心原则：

| 原则 | 体现 |
|------|------|
| **约定优于配置** | 统一的 snake_case 命名、CUID 主键、时间戳规范 |
| **分层设计** | 10+ 业务领域清晰分离，模型职责单一 |
| **事务一致性** | $transaction 包裹关键业务流程，原子化提交 |
| **并发控制** | 乐观锁 version 字段 + CAS 模式 |
| **灵活性与性能平衡** | Json 字段处理多变结构，关系表保证查询效率 |
| **审计安全** | beforeBalance/afterBalance 快照、操作日志、幂等键 |
| **渐进式迁移** | 多语言字段双写过渡、兼容旧字段 |

理解这套数据库架构，是掌握整个项目后端的基础——每一层 Service 的业务逻辑，最终都映射到这个 Prisma Schema 的定义之上。

### 相关文章

- [admin-next 订单管理系统](./order-management-system.md)
- [OAuth 多供应商认证体系](./oauth-multi-provider-authentication.md)
- [仪表盘 & 数据统计系统](./dashboard-statistics-system.md)
- [全栈 KYC 验证系统](./full-stack-kyc-verification.md)
- [OTP & SMS 验证系统](./otp-sms-verification-system.md)
