# 25. 实现 ProductReview AI 审核管线

> **系列**: JoyMini 电商评论 + AI 审核功能
> **前置步骤**: [24. 创建 ProductReview 客户端 API](24-创建-ProductReview客户端API.md)
> **下一步**: [26. 创建 Admin 评论审核面板](26-创建-Admin评论审核面板.md)
> **对应代码**: [`apps/api/src/client/product-review/processors/`](../../apps/api/src/client/product-review/processors/)

---

## 🎯 本步骤目标

1. 泛化 `AiService.moderateComment()` → `AiService.moderateContent()`
2. 创建 Bull Queue 处理器 `product-review-moderation`
3. 实现三档 AI 审核决策（0-30 通过 / 30-70 标记 / 70-100 拒绝）
4. 实现虚假评论检测（购买验证 + 重复检测）
5. 实现 AI 自动回复生成

完成本步骤后，用户提交评论后自动触发 AI 审核，正常评论即时展示，可疑评论进入人工审核队列。

---

## 📖 开发背景

### 承上：上一步做了什么？

[24-创建-ProductReview客户端API.md](24-创建-ProductReview客户端API.md) 完成了：
- 8 个 REST 端点（创建/列表/编辑/删除/补充/有帮助）
- 评论创建后入队 `product-review-moderation` 队列
- 目前所有评论都是 `PENDING` 状态

### 这一步要解决的问题

评论提交后卡在 `PENDING` 状态，没有任何自动处理。需要实现 AI 审核管线来自动处理评论。

### 设计决策

| 决策点 | 选项 | 选择 | 原因 |
|--------|------|------|------|
| 审核方式 | 同步 / 异步 | **异步 Bull Queue** | 与现有 blog-ai 模式一致，不阻塞用户请求 |
| 三档阈值 | 不同分段 | **0-30 / 30-70 / 70-100** | 与 blog-ai 现有阈值一致 |
| 自动回复 | 独立队列 / 同一队列 | **独立队列** | 解耦，审核失败不阻塞回复 |
| 虚假检测 | 同步 / 异步 | **同步（在 Service 层）** | 购买验证必须同步返回 |

---

## ⚙️ 前置条件

- [x] Step 24 已完成（客户端 API + 队列注册）
- [x] [`AiService.moderateComment()`](../../apps/api/src/blog/processors/blog-ai.processor.ts#L993) 可作为参考
- [x] [`AutoReplyService`](../../apps/api/src/common/ai/auto-reply/interfaces/auto-reply.types.ts) 已注入

---

## 📝 实现步骤

### Step 1: 泛化 AiService — moderateContent

**在哪里改**：[`apps/api/src/common/ai/ai.service.ts`](../../apps/api/src/common/ai/ai.service.ts)

**做什么**：将现有的 `moderateComment()` 泛化为 `moderateContent()`，使其同时支持博客评论和产品评论

```typescript
// 新增类型
export type ModerationSubjectType = 'blog-comment' | 'product-review';

export interface AiModerationResult {
  score: number;        // 0-100
  passed: boolean;      // score < 30
  reason: string;       // 审核理由
  categories: string[]; // 违规分类
}

// 新增泛化方法
async moderateContent(
  content: string,
  title: string,
  subjectType: ModerationSubjectType = 'blog-comment',
): Promise<AiModerationResult> {
  // 构建 prompt，根据 subjectType 调整上下文
  const systemPrompt = subjectType === 'product-review'
    ? `You are a product review moderator. Score 0-100:
      0-30: Normal product review, auto-approve
      30-70: Suspicious, flag for human review
      70-100: Violates policy, auto-reject
      Check for: spam, profanity, off-topic, fake review patterns`
    : `You are a blog comment moderator. Score 0-100...`; // 原有的 prompt

  // 调用 LLM
  return this.callModerationLLM(content, title, systemPrompt);
}

// 保留向后兼容
async moderateComment(content: string, articleTitle: string): Promise<AiModerationResult> {
  return this.moderateContent(content, articleTitle, 'blog-comment');
}
```

**为什么这样设计**：
- 单一方法处理所有审核需求，减少重复代码
- 通过 `subjectType` 区分不同场景的 prompt
- 向后兼容：现有 `moderateComment` 调用不受影响

---

### Step 2: 创建审核队列处理器

**文件**: [`apps/api/src/client/product-review/processors/product-review-moderation.processor.ts`](../../apps/api/src/client/product-review/processors/product-review-moderation.processor.ts)

```typescript
import { Processor, WorkerHost, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';

@Processor('product-review-moderation')
export class ProductReviewModerationProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {
    super();
  }

  @Process('moderate')
  async processModeration(job: Job<{ reviewId: string; content: string; productId: string }>) {
    const { reviewId, content } = job.data;

    // 获取产品名称作为上下文
    const product = await this.prisma.treasure.findUnique({
      where: { treasureId: job.data.productId },
      select: { name: true },
    });

    // 1. AI 内容审核
    const result = await this.aiService.moderateContent(
      content,
      product?.name || '',
      'product-review',
    );

    // 2. 三档决策
    let status: string;
    if (result.score <= 30) {
      status = 'APPROVED';
    } else if (result.score >= 70) {
      status = 'REJECTED';
    } else {
      status = 'FLAGGED';
    }

    // 3. 更新数据库
    await this.prisma.productReview.update({
      where: { id: reviewId },
      data: {
        status: status as any,
        aiModerationScore: result.score,
        aiModerationReason: result.reason,
        aiModerationCategories: result.categories.join(', '),
        aiModeratedAt: new Date(),
      },
    });

    // 4. 如果通过，触发自动回复
    if (status === 'APPROVED') {
      // 这里可以添加另一个队列任务或直接调用 AutoReplyService
    }

    return { status, score: result.score };
  }
}
```

**参考源**：[`blog-ai.processor.ts`](../../apps/api/src/blog/processors/blog-ai.processor.ts#L963-L1094) — 完全复用其模式

---

### Step 3: 虚假评论检测（在 Service 层同步执行）

**在哪里改**：[`apps/api/src/client/product-review/product-review.service.ts`](../../apps/api/src/client/product-review/product-review.service.ts) — 在 `create()` 方法中增强

**做什么**：在创建评论时同步检查虚假评论特征

```typescript
// 在 create() 方法中，保存评论之前添加检测

// 1. 检查该用户是否购买了此产品（如果传了 orderId 则已验证）
// 如果没有传 orderId，但产品是普通商品（非抽奖），可以拒绝
const product = await this.prisma.treasure.findUnique({
  where: { treasureId: dto.productId },
  select: { type: true },
});

// 2. 检查用户近期评论频率（1小时内超过3条 = 可疑）
const recentCount = await this.prisma.productReview.count({
  where: {
    userId,
    createdAt: { gte: new Date(Date.now() - 3600000) },
  },
});
if (recentCount >= 3) {
  // 标记为 FLAGGED 而不是 PENDING
  createData.status = 'FLAGGED';
  createData.aiModerationReason = 'Suspicious: too many reviews in short time';
}

// 3. 可选：检查评论内容是否与其他评论相似（pgvector）
// 如果 pgvector 已启用，可以调用向量相似度搜索
```

---

### Step 4: 创建自动回复队列处理器

**文件**: [`apps/api/src/client/product-review/processors/product-review-auto-reply.processor.ts`](../../apps/api/src/client/product-review/processors/product-review-auto-reply.processor.ts)

```typescript
import { Processor, WorkerHost, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Processor('product-review-auto-reply')
export class ProductReviewAutoReplyProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    // private autoReplyService: AutoReplyService, // 复用现有 AutoReplyService
  ) {
    super();
  }

  @Process('generate-reply')
  async processAutoReply(job: Job<{ reviewId: string }>) {
    const { reviewId } = job.data;

    const review = await this.prisma.productReview.findUnique({
      where: { id: reviewId },
      include: { product: true },
    });
    if (!review || review.replyContent) return; // 已有回复则跳过

    // 根据评分生成不同风格的回复
    let replyContent: string;
    if (review.rating >= 4) {
      replyContent = `感谢您的好评！我们会继续努力提供更好的产品和服务。`;
    } else if (review.rating === 3) {
      replyContent = `感谢您的反馈。如果您有任何具体的改进建议，欢迎联系客服，我们将持续优化产品体验。`;
    } else {
      replyContent = `很抱歉给您带来了不好的体验。我们非常重视您的反馈，建议您联系客服，我们将尽快为您解决问题。`;
    }

    await this.prisma.productReview.update({
      where: { id: reviewId },
      data: {
        replyContent,
        repliedAt: new Date(),
      },
    });
  }
}
```

**参考源**：
- [`auto-reply.types.ts`](../../apps/api/src/common/ai/auto-reply/interfaces/auto-reply.types.ts) — `CommentType`、`ReplyResult` 接口
- [`blog-ai.processor.ts`](../../apps/api/src/blog/processors/blog-ai.processor.ts#L1096-L1160) — 现有自动回复逻辑

---

### Step 5: 注册处理器到模块

**在哪里改**：[`apps/api/src/client/product-review/product-review.module.ts`](../../apps/api/src/client/product-review/product-review.module.ts)

```typescript
import { ProductReviewModerationProcessor } from './processors/product-review-moderation.processor';
import { ProductReviewAutoReplyProcessor } from './processors/product-review-auto-reply.processor';

@Module({
  providers: [
    ProductReviewService,
    ProductReviewModerationProcessor,
    ProductReviewAutoReplyProcessor,
  ],
})
```

同时添加 auto-reply 队列注册：
```typescript
BullModule.registerQueue(
  { name: 'product-review-moderation' },
  { name: 'product-review-auto-reply' },
)
```

---

## ✅ 验收方式

### 自动验证

```bash
# 1. 编译检查
cd apps/api && npx tsc --noEmit --pretty 2>&1 | grep -i "product-review"

# 2. 测试 AI 审核
curl -X POST http://localhost:3000/client/product-reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"productId":"xxx","rating":5,"content":"非常好的产品！"}'
# 等待几秒后检查状态
curl http://localhost:3000/client/product-reviews/xxx
```

### 手动验证

1. 提交正常评论（如"产品很好，物流快"）→ 几秒后状态变为 `APPROVED`
2. 提交违规评论（如包含脏话）→ 状态变为 `REJECTED`，有 `aiModerationReason`
3. 已通过的评论 → 自动生成 `replyContent`
4. 同一用户 1 小时内提交 4 条 → 第 4 条标记为 `FLAGGED`

### 预期结果

```
正常评论：PENDING → APPROVED（1-3 秒内）+ 自动回复生成
违规评论：PENDING → REJECTED + aiModerationReason 含违规说明
可疑评论：PENDING → FLAGGED + 进入待人工审核
高频评论：PENDING → FLAGGED（直接标记，不经 AI）
```

---

## 🔜 下一步预告

下一步：[26. 创建 Admin 评论审核面板](26-创建-Admin评论审核面板.md)

AI 审核管线已就绪，但 `FLAGGED` 的评论需要管理员人工处理。下一步将实现：
- Admin 后端 API（列表 + 审核 + 回复）
- Admin 前端 React 组件（审核弹窗 + 列表 + 详情）
