# 26. 创建 Admin 评论审核面板

> **系列**: JoyMini 电商评论 + AI 审核功能
> **前置步骤**: [25. 实现 ProductReview AI 审核管线](25-实现-ProductReviewAI审核管线.md)
> **下一步**: [27. 创建 Flutter 评论 UI](27-创建-Flutter评论UI.md)
> **对应代码**: 
> - 后端: [`apps/api/src/admin/product-review/`](../../apps/api/src/admin/product-review/)
> - 前端: [`apps/admin-next/src/views/product-review/`](../../apps/admin-next/src/views/product-review/)

---

## 🎯 本步骤目标

1. 创建 Admin 后端模块（4 个端点：列表/详情/审核/回复）
2. 创建 Admin 前端评论列表页（带筛选 + 分页）
3. 创建审核弹窗组件（复用 KycAuditModal 三动作模式）
4. 创建商家回复编辑组件

完成本步骤后，管理员可以在后台管理评论审核流程。

---

## 📖 开发背景

### 承上：上一步做了什么？

[25-实现-ProductReviewAI审核管线.md](25-实现-ProductReviewAI审核管线.md) 完成了：
- AI 自动审核管线（三档评分决策）
- 虚假评论检测
- 自动回复生成
- `FLAGGED` 状态的评论等待人工处理

### 这一步要解决的问题

目前 `FLAGGED` 评论没人处理，管理员：
- 看不到有哪些待审核评论
- 不能查看 AI 审核报告
- 无法手动通过/拒绝评论
- 不能编辑商家回复

### 设计决策

| 决策点 | 选项 | 选择 | 原因 |
|--------|------|------|------|
| 审核弹窗复用 | 新写 / 复用 KycAuditModal | **复用 KycAuditModal 模式** | 三动作审核（Approve/Reject/NeedMore）完全匹配 |
| 列表位置 | 新页面 / 嵌入 KYC | **独立页面** | 评论审核是独立的后台功能 |
| 回复功能 | 管理员直接编辑 / 先AI生成再编辑 | **AI 生成 + 管理员可编辑** | 减少管理员打字工作量 |

---

## ⚙️ 前置条件

- [x] Step 25 已完成（AI 审核管线已就绪）
- [x] 已有一些 `FLAGGED` 状态的评论可用于测试
- [x] 了解 [`KycAuditModal.tsx`](../../apps/admin-next/src/views/kyc/KycAuditModal.tsx) 的组件结构

---

## 📝 实现步骤

### Step 1: 创建 Admin 后端模块

**目录**: [`apps/api/src/admin/product-review/`](../../apps/api/src/admin/product-review/)

#### 1a. Admin Controller

**文件**: [`apps/api/src/admin/product-review/product-review.controller.ts`](../../apps/api/src/admin/product-review/product-review.controller.ts)

```typescript
import { Controller, Get, Put, Param, Query, Body, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '@api/admin/auth/admin-jwt.guard';
import { RolesGuard } from '@api/admin/auth/roles.guard';
import { Roles } from '@api/admin/auth/roles.decorator';
import { ProductReviewAdminService } from './product-review.service';

@Controller('admin/product-reviews')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
export class ProductReviewAdminController {
  constructor(private readonly service: ProductReviewAdminService) {}

  @Get()
  findAll(@Query() query: ListReviewDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id/audit')
  audit(@Param('id') id: string, @Body() dto: AuditReviewDto, @CurrentAdmin() admin: any) {
    return this.service.audit(id, dto, admin.id);
  }

  @Put(':id/reply')
  reply(@Param('id') id: string, @Body() dto: ReplyReviewDto) {
    return this.service.reply(id, dto.content);
  }
}
```

#### 1b. Admin Service

**文件**: [`apps/api/src/admin/product-review/product-review.service.ts`](../../apps/api/src/admin/product-review/product-review.service.ts)

```typescript
@Injectable()
export class ProductReviewAdminService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: ListReviewDto) {
    const { page = 1, limit = 20, status, rating, productId, startDate, endDate } = query;
    const where: Prisma.ProductReviewWhereInput = {};

    if (status) where.status = status;
    if (rating) where.rating = rating;
    if (productId) where.productId = productId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [list, total] = await Promise.all([
      this.prisma.productReview.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, nickname: true, avatar: true } },
          product: { select: { treasureId: true, name: true, cover: true } },
        },
      }),
      this.prisma.productReview.count({ where }),
    ]);

    return { list, total, page, limit };
  }

  async findOne(id: string) {
    return this.prisma.productReview.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, nickname: true, avatar: true, email: true } },
        product: { select: { treasureId: true, name: true, cover: true, price: true } },
      },
    });
  }

  async audit(id: string, dto: AuditReviewDto, reviewerId: string) {
    const review = await this.prisma.productReview.findUnique({ where: { id } });
    if (!review) throw new NotFoundException();

    return this.prisma.productReview.update({
      where: { id },
      data: {
        status: dto.action, // APPROVED | REJECTED | FLAGGED
        reviewedBy: reviewerId,
        reviewNote: dto.note,
        reviewedAt: new Date(),
      },
    });
  }

  async reply(id: string, content: string) {
    return this.prisma.productReview.update({
      where: { id },
      data: {
        replyContent: content,
        repliedAt: new Date(),
      },
    });
  }
}
```

#### 1c. DTOs

**文件**: [`apps/api/src/admin/product-review/dto/audit-review.dto.ts`](../../apps/api/src/admin/product-review/dto/audit-review.dto.ts)
```typescript
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProductReviewStatus } from '@prisma/client';

export class AuditReviewDto {
  @IsEnum(ProductReviewStatus)
  action: ProductReviewStatus.APPROVED | ProductReviewStatus.REJECTED | ProductReviewStatus.FLAGGED;

  @IsOptional()
  @IsString()
  note?: string;
}
```

**文件**: [`apps/api/src/admin/product-review/dto/reply-review.dto.ts`](../../apps/api/src/admin/product-review/dto/reply-review.dto.ts)
```typescript
import { IsString, MinLength } from 'class-validator';

export class ReplyReviewDto {
  @IsString()
  @MinLength(1)
  content: string;
}
```

**文件**: [`apps/api/src/admin/product-review/dto/list-review.dto.ts`](../../apps/api/src/admin/product-review/dto/list-review.dto.ts)
```typescript
import { IsOptional, IsEnum, IsInt, IsString } from 'class-validator';
import { ProductReviewStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class ListReviewDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 20;

  @IsOptional()
  @IsEnum(ProductReviewStatus)
  status?: ProductReviewStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rating?: number;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
```

#### 1d. Admin Module

**文件**: [`apps/api/src/admin/product-review/product-review.module.ts`](../../apps/api/src/admin/product-review/product-review.module.ts)

注册到 [`apps/api/src/admin/admin.module.ts`](../../apps/api/src/admin/admin.module.ts) 的 `imports` 数组中。

---

### Step 2: 创建 Admin 前端页面

**目录**: [`apps/admin-next/src/views/product-review/`](../../apps/admin-next/src/views/product-review/)

#### 2a. 评论列表页

**文件**: [`apps/admin-next/src/views/product-review/ProductReviewList.tsx`](../../apps/admin-next/src/views/product-review/ProductReviewList.tsx)

```
布局:
┌─────────────────────────────────────────────────────────┐
│  Filter Bar                                              │
│  [Status ▼] [Rating ▼] [Product Search] [Date Range]    │
│  [FLAGGED: 12] [PENDING: 3] [APPROVED: 245] [REJECTED: 8]│
├─────────────────────────────────────────────────────────┤
│  Table                                                    │
│  ├─────────┬──────┬────────┬──────────┬──────┬──────────┤│
│  │ Product │ User │ Rating │ Content  │ AI   │ Status   ││
│  ├─────────┼──────┼────────┼──────────┼──────┼──────────┤│
│  │ iPhone  │ John │ ⭐⭐⭐⭐⭐ │ Great!   │ 12   │ ✅ APPROVED│
│  │ MacBook │ Jane │ ⭐⭐    │ Bad...   │ 45   │ ⚠️ FLAGGED│
│  └─────────┴──────┴────────┴──────────┴──────┴──────────┘│
│  [Pagination: < 1 2 3 ... 10 >]                           │
└─────────────────────────────────────────────────────────┘
```

**功能**：
- 状态筛选标签（全部/待审核/已通过/已拒绝/标记）
- 评分筛选下拉框
- 产品搜索输入框
- 日期范围选择器
- 表格展示：产品名 / 用户 / 评分 / 内容摘要 / AI 分 / 状态徽标
- 点击行 → 打开审核弹窗
- 分页器

**参考源**：[`apps/admin-next/src/views/kyc/`](../../apps/admin-next/src/views/kyc/) — 列表布局模式

---

#### 2b. 审核弹窗

**文件**: [`apps/admin-next/src/views/product-review/ProductReviewAuditModal.tsx`](../../apps/admin-next/src/views/product-review/ProductReviewAuditModal.tsx)

```
┌─────────────────────────────────────────────────┐
│  Review Audit                        [X] Close  │
├─────────────────────────────────────────────────┤
│  User Info                                       │
│  ┌──┐ John Doe · j***@email.com                  │
│  └──┘                                             │
│                                                   │
│  Product: iPhone 15 Pro Max                       │
│  Rating: ⭐⭐⭐⭐⭐                                │
│  Content: 非常好的产品，物流也快，推荐购买！       │
│  Images: [img1.jpg] [img2.jpg]                    │
│  Created: 2026-06-24 14:30                        │
│                                                   │
│  ─── AI Moderation Report ───                     │
│  Score: 12/100 (PASS)                             │
│  Reason: Normal product review, no violations     │
│  Categories: -                                    │
│                                                   │
│  Review Note:                                      │
│  [Textarea: Optional review note...]              │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  ✅ Approve│  │  ❌ Reject│  │  ⚠️ Flag     │   │
│  └──────────┘  └──────────┘  └──────────────┘   │
└─────────────────────────────────────────────────┘
```

**参考源**：[`KycAuditModal.tsx`](../../apps/admin-next/src/views/kyc/KycAuditModal.tsx#L1) — 三动作审核弹窗，完全复用其模式

**关键 Props**：
```typescript
interface ProductReviewAuditModalProps {
  visible: boolean;
  review: ProductReviewDetail | null;
  onClose: () => void;
  onAudit: (id: string, action: 'APPROVED' | 'REJECTED' | 'FLAGGED', note?: string) => void;
}
```

---

#### 2c. 商家回复编辑

**文件**: [`apps/admin-next/src/views/product-review/ProductReviewDetail.tsx`](../../apps/admin-next/src/views/product-review/ProductReviewDetail.tsx)

在审核弹窗底部或独立区域：
```
  ─── Merchant Reply ───
  AI Suggested Reply (editable):
  [Textarea: 感谢您的好评！我们会继续努力...]

  ┌──────────┐
  │  💾 Save │
  └──────────┘
```

---

### Step 3: 注册路由

**在哪里改**：检查 `apps/admin-next/src/router.tsx` 或类似的路由配置文件

添加路由：
```typescript
{
  path: '/product-reviews',
  element: <ProductReviewList />,
}
```

侧边栏导航添加入口（在菜单配置文件中）：
```typescript
{
  label: '评论审核',
  path: '/product-reviews',
  icon: <CommentOutlined />,
}
```

---

## ✅ 验收方式

### 自动验证

```bash
# 1. 后端编译检查
cd apps/api && npx tsc --noEmit --pretty 2>&1 | grep -i "product-review"

# 2. 前端编译检查
cd apps/admin-next && npx tsc --noEmit --pretty 2>&1 | grep -i "product-review"
```

### 手动验证

1. 访问 `/admin/product-reviews` 看到评论列表
2. 筛选状态=FLAGGED → 只看到待审核评论
3. 点击一条 FLAGGED 评论 → 打开审核弹窗
4. 点击 Approve → 评论状态变为 APPROVED，列表刷新
5. 编辑商家回复 → 点击 Save → 回复内容更新
6. 检查数据库确认 `reviewedBy` 和 `reviewedAt` 已更新

### 预期结果

```
Admin 列表：显示所有评论，可按状态/评分/日期筛选
审核弹窗：显示完整评论 + AI 审核报告 + 三动作按钮
审核通过：评论变为 APPROVED，前端列表同步更新
商家回复：AI 自动生成，管理员可编辑后保存
```

---

## 🔜 下一步预告

下一步：[27. 创建 Flutter 评论 UI](27-创建-Flutter评论UI.md)

Admin 面板已就绪，但用户在手机上还不能提交和查看评论。下一步将在 Flutter 客户端实现：
- 产品详情页的评论展示区
- 评论提交表单（星级评分 + 文字 + 图片）
- 有帮助按钮
