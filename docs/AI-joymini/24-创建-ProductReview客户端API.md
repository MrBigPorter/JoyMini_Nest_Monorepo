# 24. 创建 ProductReview 客户端 API

> **系列**: JoyMini 电商评论 + AI 审核功能
> **前置步骤**: [23. 创建 ProductReview 数据库模型](23-创建-ProductReview数据库模型.md)
> **下一步**: [25. 实现 ProductReview AI 审核管线](25-实现-ProductReviewAI审核管线.md)
> **对应代码**: [`apps/api/src/client/product-review/`](../../apps/api/src/client/product-review/)

---

## 🎯 本步骤目标

1. 创建 `ProductReviewModule`（Controller + Service + DTOs）
2. 实现 8 个客户端 REST 端点
3. 实现购买验证逻辑（检查 Order 是否属于该用户）
4. 评论创建后自动入队 AI 审核

完成本步骤后，用户可以通过 REST API 创建、查看、编辑、删除产品评论。

---

## 📖 开发背景

### 承上：上一步做了什么？

[23-创建-ProductReview数据库模型.md](23-创建-ProductReview数据库模型.md) 完成了：
- `ProductReviewStatus` 枚举 + `ProductReview` 模型
- Prisma 迁移已运行，数据库表已创建
- Prisma Client 已重新生成

### 这一步要解决的问题

数据库有了，但还没有 API 让用户提交评论。需要实现完整的 CRUD 端点，并确保：
- 只有已登录用户可以评论
- 评论需要验证购买记录（可选）
- 创建评论后自动触发 AI 审核
- 公开列表只展示已通过的评论

### 设计决策

| 决策点 | 选项 | 选择 | 原因 |
|--------|------|------|------|
| 评论模块位置 | `client/` 下新建 | **`client/product-review/`** | 与现有 client 模块结构一致 |
| 公开列表返回内容 | 全部 / 仅 APPROVED | **仅 APPROVED** | PENDING/REJECTED/FLAGGED 不应展示给其他用户 |
| 编辑时限 | 不限 / 24h / 7天 | **24小时** | 防止评论被恶意篡改 |
| 购买验证 | 强制 / 可选 | **可选** | 中奖记录也可评论 |

---

## ⚙️ 前置条件

- [x] Step 23 已完成（数据库模型已创建）
- [x] `ProductReview` 可在 Prisma Client 中引用

---

## 📝 实现步骤

### Step 1: 创建模块骨架

**文件**: [`apps/api/src/client/product-review/product-review.module.ts`](../../apps/api/src/client/product-review/product-review.module.ts)

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { ProductReviewController } from './product-review.controller';
import { ProductReviewService } from './product-review.service';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'product-review-moderation',
    }),
  ],
  controllers: [ProductReviewController],
  providers: [ProductReviewService],
  exports: [ProductReviewService],
})
export class ProductReviewModule {}
```

**注册到 `ClientModule`**：
在 [`apps/api/src/client/client.module.ts`](../../apps/api/src/client/client.module.ts) 的 `imports` 数组中添加 `ProductReviewModule`。

---

### Step 2: 创建 DTOs

**文件**: [`apps/api/src/client/product-review/dto/create-review.dto.ts`](../../apps/api/src/client/product-review/dto/create-review.dto.ts)

```typescript
import { IsInt, IsString, IsOptional, IsArray, Min, Max, MinLength, IsUUID } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  orderId?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MinLength(10)
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
```

**文件**: [`apps/api/src/client/product-review/dto/update-review.dto.ts`](../../apps/api/src/client/product-review/dto/update-review.dto.ts)

```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreateReviewDto } from './create-review.dto';

export class UpdateReviewDto extends PartialType(CreateReviewDto) {}
```

**文件**: [`apps/api/src/client/product-review/dto/review-response.dto.ts`](../../apps/api/src/client/product-review/dto/review-response.dto.ts)

```typescript
import { ProductReviewStatus } from '@prisma/client';

export class ReviewResponseDto {
  id: string;
  productId: string;
  orderId?: string;
  userId: string;
  rating: number;
  content: string;
  images?: string[];
  status: ProductReviewStatus;
  replyContent?: string;
  repliedAt?: Date;
  helpfulCount: number;
  supplement?: string;
  supplementedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // 关联数据
  user?: {
    id: string;
    nickname: string;
    avatar?: string;
  };
}
```

**文件**: [`apps/api/src/client/product-review/dto/query-review.dto.ts`](../../apps/api/src/client/product-review/dto/query-review.dto.ts)

```typescript
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryReviewDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @IsOptional()
  sortBy?: 'newest' | 'highest' | 'helpful' = 'helpful';
}
```

---

### Step 3: 实现 Service 层

**文件**: [`apps/api/src/client/product-review/product-review.service.ts`](../../apps/api/src/client/product-review/product-review.service.ts)

```typescript
import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewDto } from './dto/query-review.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductReviewService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('product-review-moderation')
    private moderationQueue: Queue,
  ) {}

  /** 创建评论 */
  async create(userId: string, dto: CreateReviewDto) {
    // 验证产品存在
    const product = await this.prisma.treasure.findUnique({
      where: { treasureId: dto.productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    // 如果传了 orderId，验证该订单属于该用户
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, userId },
      });
      if (!order) throw new ForbiddenException('Order not found or not yours');
    }

    // 检查是否已经评论过（可选）
    const existing = await this.prisma.productReview.findFirst({
      where: { productId: dto.productId, userId },
    });
    if (existing) throw new BadRequestException('Already reviewed this product');

    // 创建评论
    const review = await this.prisma.productReview.create({
      data: {
        productId: dto.productId,
        orderId: dto.orderId,
        userId,
        rating: dto.rating,
        content: dto.content,
        images: dto.images || [],
        status: 'PENDING',
      },
      include: {
        user: { select: { id: true, nickname: true, avatar: true } },
      },
    });

    // 入队 AI 审核
    await this.moderationQueue.add('moderate', {
      reviewId: review.id,
      content: dto.content,
      productId: dto.productId,
    });

    return review;
  }

  /** 公开评论列表（仅 APPROVED） */
  async findByProduct(productId: string, query: QueryReviewDto) {
    const { page = 1, limit = 10, sortBy = 'helpful' } = query;
    const skip = (page - 1) * limit;

    let orderBy: Prisma.ProductReviewOrderByWithRelationInput;
    switch (sortBy) {
      case 'newest': orderBy = { createdAt: 'desc' }; break;
      case 'highest': orderBy = { rating: 'desc' }; break;
      case 'helpful':
      default: orderBy = { helpfulCount: 'desc' }; break;
    }

    const [list, total] = await Promise.all([
      this.prisma.productReview.findMany({
        where: { productId, status: 'APPROVED' },
        skip,
        take: limit,
        orderBy,
        include: {
          user: { select: { id: true, nickname: true, avatar: true } },
        },
      }),
      this.prisma.productReview.count({
        where: { productId, status: 'APPROVED' },
      }),
    ]);

    return { list, total, page, limit };
  }

  /** 我的评论 */
  async findByUser(userId: string) {
    return this.prisma.productReview.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { treasureId: true, name: true, cover: true } },
      },
    });
  }

  /** 更新评论 */
  async update(userId: string, id: string, dto: UpdateReviewDto) {
    const review = await this.findByIdOrThrow(id);
    if (review.userId !== userId) throw new ForbiddenException('Not your review');
    
    const hoursSinceCreate = (Date.now() - review.createdAt.getTime()) / 3600000;
    if (hoursSinceCreate > 24) throw new ForbiddenException('Can only edit within 24 hours');

    const updated = await this.prisma.productReview.update({
      where: { id },
      data: {
        ...dto,
        status: 'PENDING', // 修改后重新审核
        aiModerationScore: null,
        aiModerationReason: null,
        aiModeratedAt: null,
      },
    });

    return updated;
  }

  /** 追加评价 */
  async supplement(userId: string, id: string, content: string) {
    const review = await this.findByIdOrThrow(id);
    if (review.userId !== userId) throw new ForbiddenException('Not your review');

    return this.prisma.productReview.update({
      where: { id },
      data: {
        supplement: content,
        supplementedAt: new Date(),
      },
    });
  }

  /** 标记有帮助 */
  async markHelpful(userId: string, id: string) {
    const review = await this.findByIdOrThrow(id);
    return this.prisma.productReview.update({
      where: { id },
      data: { helpfulCount: { increment: 1 } },
    });
  }

  /** 删除评论 */
  async remove(userId: string, id: string) {
    const review = await this.findByIdOrThrow(id);
    if (review.userId !== userId) throw new ForbiddenException('Not your review');
    await this.prisma.productReview.delete({ where: { id } });
  }

  private async findByIdOrThrow(id: string) {
    const review = await this.prisma.productReview.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }
}
```

---

### Step 4: 实现 Controller

**文件**: [`apps/api/src/client/product-review/product-review.controller.ts`](../../apps/api/src/client/product-review/product-review.controller.ts)

```typescript
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { OptionalJwtAuthGuard } from '@api/common/jwt/option-jwt.guard';
import { CurrentUser } from '@api/common/jwt/current-user.decorator';
import { ProductReviewService } from './product-review.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewDto } from './dto/query-review.dto';

@Controller('client/product-reviews')
export class ProductReviewController {
  constructor(private readonly service: ProductReviewService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: any, @Body() dto: CreateReviewDto) {
    return this.service.create(user.id, dto);
  }

  @Get(':productId')
  @UseGuards(OptionalJwtAuthGuard)
  findByProduct(@Param('productId') productId: string, @Query() query: QueryReviewDto) {
    return this.service.findByProduct(productId, query);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  findByUser(@CurrentUser() user: any) {
    return this.service.findByUser(user.id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateReviewDto) {
    return this.service.update(user.id, id, dto);
  }

  @Put(':id/supplement')
  @UseGuards(JwtAuthGuard)
  supplement(@CurrentUser() user: any, @Param('id') id: string, @Body('content') content: string) {
    return this.service.supplement(user.id, id, content);
  }

  @Post(':id/helpful')
  @UseGuards(JwtAuthGuard)
  markHelpful(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.markHelpful(user.id, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
```

---

### Step 5: 路由顺序说明

注意 Controller 中的路由顺序很重要：
1. `GET /my` — 必须在 `GET /:productId` 之前
2. 否则 NestJS 会把 `my` 当作 `:productId` 参数

如果使用 express 风格路由（`@Get('my')` 放在 `@Get(':productId')` 之前）可避免此问题。

---

## ✅ 验收方式

### 自动验证

```bash
# 1. 编译检查
cd apps/api && npx tsc --noEmit --pretty 2>&1 | grep -i "product-review"

# 2. 启动开发服务器（新终端）
yarn workspace @lucky/api dev &
sleep 10

# 3. 测试创建评论
curl -X POST http://localhost:3000/client/product-reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"productId":"xxx","rating":5,"content":"非常好的产品，物流也快！"}'
```

### 手动验证

1. 创建评论后检查数据库 `product_reviews` 表是否有 `PENDING` 状态记录
2. 公开列表 `GET /client/product-reviews/:productId` 只返回 `APPROVED` 的评论
3. 用另一个用户调用 `PUT /:id` 应该返回 403
4. 超过 24 小时后编辑应该返回 403

### 预期结果

```
POST /client/product-reviews → 201 Created + 评论数据（status: PENDING）
GET /client/product-reviews/:productId → 200 + 分页列表（仅 APPROVED）
GET /client/product-reviews/my → 200 + 用户所有评论
PUT /client/product-reviews/:id → 200 + 更新后数据
DELETE /client/product-reviews/:id → 200 + 删除成功
```

---

## 🔜 下一步预告

下一步：[25. 实现 ProductReview AI 审核管线](25-实现-ProductReviewAI审核管线.md)

客户端 API 已就绪，但所有评论都是 `PENDING` 状态。下一步将实现：
- AI 自动内容审核（三档评分决策）
- 虚假评论检测（购买验证、相似度查重）
- 自动回复生成
- Bull Queue 异步处理
