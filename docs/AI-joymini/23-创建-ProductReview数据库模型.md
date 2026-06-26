# 23. 创建 ProductReview 数据库模型

> **系列**: JoyMini 电商评论 + AI 审核功能
> **前置步骤**: 无（本系列第一步）
> **下一步**: [24. 创建 ProductReview 客户端 API](24-创建-ProductReview客户端API.md)
> **对应代码**: [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma)

---

## 🎯 本步骤目标

1. 在 Prisma schema 中添加 `ProductReviewStatus` 枚举
2. 添加 `ProductReview` 数据模型（含 AI 审核字段、质量评分字段）
3. 运行 Prisma 迁移生成数据库表
4. 更新 `packages/shared/src/types/enums.ts` 共享枚举

完成本步骤后，数据库中有 `product_reviews` 表，API 可通过 Prisma Client 读写评论数据。

---

## 📖 开发背景

### 为什么要做这一步

JoyMini 电商项目目前**没有产品评论功能**。用户购买产品后无法留下评价，新用户也看不到其他用户的真实反馈。对比分析已确认：
- `BlogComment` — 博客文章评论，不是产品评论
- `customer_service_sessions.rating` — 客服满意度评分，不是产品评价
- 数据库设计文档里没有 `product_reviews` 表

### 设计决策

| 决策点 | 选项 | 选择 | 原因 |
|--------|------|------|------|
| 评论关联产品 | Treasure / Product | **Treasure** | JoyMini 的产品模型是 Treasure，抽奖产品即商品 |
| 是否强制关联订单 | 强制 / 可选 | **可选** | 中奖记录（WinningRecord）也可以评论，不强制 |
| 状态枚举 | 3 态 / 4 态 | **4 态** | PENDING→APPROVED/REJECTED/FLAGGED，FLAGGED 需要人工审核 |
| 图片存储 | 单独表 / JSON 数组 | **JSON 数组** | 简单、查询快，图片数量有限 |
| AI 审核字段 | 复用 BlogComment 模式 | **复制相同字段** | 保持一致性，便于 generalize |

---

## ⚙️ 前置条件

### 环境要求
- [ ] PostgreSQL 运行中
- [ ] `yarn workspace @lucky/api prisma:generate` 可用

### 文件/配置准备
- [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma) — 主 schema 文件
- [`packages/shared/src/types/enums.ts`](../../packages/shared/src/types/enums.ts) — 共享枚举

---

## 📝 实现步骤

### Step 1: 添加 ProductReviewStatus 枚举

**在哪里改**：[`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma) — 在文件末尾，最后一个 model 之后

**做什么**：添加 4 态枚举

```prisma
enum ProductReviewStatus {
  PENDING     // 待AI审核
  APPROVED    // 已通过并展示
  REJECTED    // 已拒绝含违规原因
  FLAGGED     // 标记待人工审核
}
```

**为什么这样设计**：
- `PENDING` → 用户提交后立即进入此状态，异步 AI 审核
- `APPROVED` → AI 判定安全或人工审核通过
- `REJECTED` → AI 判定违规或人工拒绝
- `FLAGGED` → AI 无法确定，需要管理员人工审核（对应三档决策的 30-70 分区间）

---

### Step 2: 添加 ProductReview 模型

**在哪里改**：[`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma) — 在枚举之后

**做什么**：创建完整的产品评论模型

```prisma
/// 产品评价表 Product Review
model ProductReview {
  id          String          @id @default(cuid()) @db.VarChar(32)
  productId   String          @db.VarChar(32)
  product     Treasure        @relation(fields: [productId], references: [treasureId], onDelete: Cascade)
  orderId     String?         @db.VarChar(32)
  order       Order?          @relation(fields: [orderId], references: [id])
  userId      String          @db.VarChar(32)
  user        User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// 评价内容
  rating      Int             // 1-5 星
  content     String          @db.Text
  images      Json?           // ["url1","url2"]

  /// 状态
  status      ProductReviewStatus  @default(PENDING)

  /// AI审核字段
  aiModerationScore      Int?       @map("ai_moderation_score") @db.SmallInt
  aiModerationReason     String?    @map("ai_moderation_reason") @db.Text
  aiModerationCategories String?    @map("ai_moderation_categories") @db.VarChar(255)
  aiModeratedAt          DateTime?  @map("ai_moderated_at")

  /// AI质量评分（用于评论排序）
  aiQualityScore         Int?       @map("ai_quality_score") @db.SmallInt

  /// 管理员审核
  reviewedBy  String?     @db.VarChar(32)
  reviewNote  String?     @db.Text
  reviewedAt  DateTime?

  /// 商家回复
  replyContent String?    @map("reply_content") @db.Text
  repliedAt    DateTime?

  /// 有帮助计数
  helpfulCount Int        @default(0) @map("helpful_count")

  /// 追加评价
  supplement  String?     @db.Text
  supplementedAt DateTime?

  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")

  @@index([productId, status])
  @@index([userId])
  @@index([rating])
  @@index([aiModerationScore])
  @@index([aiQualityScore])
  @@map("product_reviews")
}
```

**关键设计说明**：
1. `orderId` 是可选的一因为中奖记录评论不需要关联订单
2. `aiQualityScore` 用于 Feature 4 质量评分排序，0-100 分
3. `supplement` / `supplementedAt` — 支持追加评价（电商常见需求）
4. 5 个索引：按产品+状态查 / 按用户查 / 按评分查 / 按 AI 分查 / 按质量分查

---

### Step 3: 同步共享枚举

**在哪里改**：[`packages/shared/src/types/enums.ts`](../../packages/shared/src/types/enums.ts)

**做什么**：如果前端或共享包需要引用 `ProductReviewStatus`，添加共享枚举

```typescript
export enum ProductReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  FLAGGED = 'FLAGGED',
}
```

**注意**：先检查 `packages/shared/src/types/enums.ts` 是否已有其他状态枚举，遵循相同风格。

---

### Step 4: 运行 Prisma 迁移

**在哪里改**：终端（项目根目录）

**做什么**：生成迁移文件并应用到数据库

```bash
# 1. 生成迁移文件
yarn workspace @lucky/api prisma:migrate --name add_product_review

# 2. 生成 Prisma Client
yarn workspace @lucky/api prisma:generate
```

**验证**：
```bash
# 确认 product_reviews 表已创建
yarn workspace @lucky/api prisma:studio
# 在 Studio 中查看 product_reviews 表结构
```

---

## ✅ 验收方式

### 自动验证

```bash
# 1. 迁移文件已生成
ls apps/api/prisma/migrations/*add_product_review/ -d

# 2. Prisma Client 可编译
cd apps/api && npx tsc --noEmit --pretty 2>&1 | head -20
```

### 手动验证

1. 在 Prisma Studio 中确认 `ProductReview` 模型存在，所有字段匹配
2. 确认 `ProductReviewStatus` 枚举有 4 个值
3. 确认 `Treasure` 模型有 `reviews` 反向关联（自动生成）
4. 确认 `User` 模型有 `reviews` 反向关联（自动生成）

### 预期结果

```
product_reviews 表已创建，包含：
- 25 个字段（含自动生成的 createdAt/updatedAt）
- 5 个索引
- 关联到 treasures、orders、users 表
- ProductReviewStatus 枚举（PENDING/APPROVED/REJECTED/FLAGGED）
```

---

## 🔜 下一步预告

下一步：[24. 创建 ProductReview 客户端 API](24-创建-ProductReview客户端API.md)

数据库模型已就绪，下一步将实现 8 个客户端 REST 端点：
- `POST /client/product-reviews` — 创建评论
- `GET /client/product-reviews/:productId` — 公开评论列表
- `GET /client/product-reviews/my` — 我的评论
- `PUT /client/product-reviews/:id` — 编辑/删除/补充
