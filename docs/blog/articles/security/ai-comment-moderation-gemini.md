# AI 评论审核：Gemini 2.0 Flash 零成本实现自动内容过滤

> **Tags:** `AI`, `Gemini`, `Comment`, `Content Moderation`, `Security`, `NestJS`

## 1. 背景：垃圾评论的困境

博客系统上线后，垃圾评论问题接踵而至：

1. **广告机器人**：每小时上千条垃圾评论
2. **违规内容**：恶意链接、不当言论
3. **审核人力**：管理员根本看不过来
4. **用户响应**：正常评论得不到及时回复

传统方案要么贵（付费 AI API），要么不准（简单关键词过滤）。我们的方案选择了 **Google Gemini 2.0 Flash**——永久免费，中文识别准确率优秀。

---

## 2. 方案选型

| 方案 | 成本 | 质量 | 限制 |
|------|------|------|------|
| **Gemini 2.0 Flash** | **永久免费** | ⭐⭐⭐⭐⭐ | 15 RPM / 100 万 TPM |
| GPT-4o Mini | $0.15/1M tokens | ⭐⭐⭐⭐ | 付费 |
| Llama 3 70B | $0.60/1M tokens | ⭐⭐⭐ | 付费 |
| 本地模型 | 服务器成本 | ⭐⭐ | 性能开销大 |

**选择 Gemini 2.0 Flash 的理由**：
- 完全免费，无任何额度限制
- 响应速度 < 500ms
- 中文识别准确率优秀
- Google 全球基础设施可靠性

---

## 3. 系统架构

### 3.1 整体设计

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  用户提交评论   │────▶│  写入数据库     │────▶│  投递AI队列     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                           │
                                                           ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  自动回复用户   │◀────│  AI后台处理     │◀────│  BullMQ 工作者   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 3.2 核心组件

**1. `AiService` — 通用 AI 服务层**

全局单例，统一 AI 调用入口，支持文本生成、内容审核、向量嵌入。AI 不可用时自动降级跳过，不影响主业务。

**2. `BlogAiProcessor` — 队列处理器**

后台异步处理，不阻塞用户请求。自动重试机制 + 指数退避，并发控制避免 API 限流。

### 3.3 三级审核机制

| 风险评分 | 处理策略 |
|----------|----------|
| 0 – 30 | ✅ 自动通过 + 智能自动回复 |
| 30 – 70 | ⏳ 进入人工审核队列 |
| 70 – 100 | ❌ 自动拒绝屏蔽 |

---

## 4. 工作流程

### 4.1 评论提交流程

```
1. 用户提交评论 → API 接收
2. 写入数据库 → 状态为 PENDING
3. 投递 BullMQ 队列 → moderate-comment 任务（延迟 1 秒）
4. 返回用户 → 100ms 内完成，用户无感知

--- 异步执行 ---
5. BullMQ Worker 消费任务
6. 调用 Gemini API 审核内容
7. 根据评分更新状态：
   - 评分 < 50 → APPROVED + 投递自动回复任务（延迟 30 秒）
   - 评分 >= 50 → REJECTED
```

**关键设计**：用户请求在 < 100ms 内完成，所有 AI 操作完全在后台执行。用户提交评论后立即看到"评论已提交，审核中"的反馈。

### 4.2 自动回复流程

审核通过后延迟 30 秒发送自动回复，模拟真人操作：

- 回复内容基于文章上下文 + 用户评论内容智能生成
- 支持多语言自动匹配（用户用中文评论就用中文回复）
- 每次回复增加随机延迟（30-45 秒），避免模式化

---

## 5. 技术实现细节

### 5.1 Gemini 安全配置

```typescript
// Gemini 安全阈值配置：全部设为不拦截
// 由我们自己的业务逻辑来判断，避免 Google 误判
safetySettings: [
  { category: HATE_SPEECH, threshold: BLOCK_NONE },
  { category: DANGEROUS_CONTENT, threshold: BLOCK_NONE },
  { category: SEXUALLY_EXPLICIT, threshold: BLOCK_NONE },
  { category: HARASSMENT, threshold: BLOCK_NONE },
];
```

为什么要关掉 Google 的安全拦截？因为 Google 的安全标准是面向全球的，对于中文博客场景误判率极高。我们自己实现的业务逻辑更精准，只标记真正违规的内容。

### 5.2 数据库扩展字段

审核结果持久化到数据库，方便后续审计和分析：

| 字段 | 类型 | 说明 |
|------|------|------|
| `aiModerationScore` | Int | AI 风险评分 0-100 |
| `aiModerationReason` | String | 风险原因 |
| `aiModerationCategories` | String | 风险分类 |
| `aiModeratedAt` | DateTime | AI 审核时间 |
| `isAiGenerated` | Boolean | 是否 AI 生成内容 |

### 5.3 非阻塞设计要点

```typescript
// 用户请求：直接通过，不等待 AI
async submitComment(articleId: string, content: string) {
  const comment = await this.prisma.comment.create({
    data: { articleId, content, status: 'PENDING' },
  });

  // 投递异步队列，不 await
  this.blogAiQueue.add('moderate-comment', { commentId: comment.id });

  return comment;
}

// AI 队列处理器：异步执行
@Process('moderate-comment')
async handleModeration(job: Job) {
  const comment = await this.commentService.findById(job.data.commentId);
  const result = await this.aiService.moderate(comment.content);

  await this.commentService.updateStatus(comment.id, result);
}
```

---

## 6. 成本分析

| 场景 | 月度成本 |
|------|----------|
| 100 条评论/天 | **¥ 0.00** |
| 1,000 条评论/天 | **¥ 0.00** |
| 10,000 条评论/天 | 约 ¥ 3/月 |

Gemini 2.0 Flash 的永久免费额度（15 RPM / 100 万 TPM）完全满足绝大多数博客场景。

---

## 7. 自动回复 Prompt 设计

这是我们反复调优后的 Gemini Prompt：

```
你是一个技术博客的智能助手。
请基于以下文章内容和用户评论，生成一段友好的自动回复。

文章标题：{articleTitle}
文章摘要：{articleExcerpt}
用户评论：{commentContent}

要求：
1. 回复要有实际价值，能解决用户的问题或感谢用户
2. 语言风格热情、专业
3. 长度控制在 50-150 字
4. 如果评论包含问题，优先回答问题
5. 回复语言与用户评论语言一致
```

---

## 8. 部署与监控

### 环境变量

```bash
# 必需
GOOGLE_VISION_CREDENTIALS=your-credentials-json

# 可选
AI_MODERATION_ENABLED=true          # 默认开启
AI_MODERATION_THRESHOLD=50          # 审核阈值，默认 50
AI_AUTO_REPLY_ENABLED=true          # 自动回复，默认开启
```

### 启动验证

启动时查看日志确认 AI 服务初始化成功：

```
[Nest] 12345  - AI Service initialized successfully
[Nest] 12345  - Gemini 2.0 Flash ready (free tier)
[Nest] 12345  - Blog AI Queue workers started
```

---

## 9. 扩展能力

这套架构预留了完整的扩展接口：

1. **语义搜索**：向量嵌入接口已预留
2. **内容摘要**：文章自动生成摘要
3. **智能推荐**：基于内容相似度推荐
4. **自动分类**：AI 自动分类文章
5. **垃圾邮件检测**：进阶反垃圾算法

所有扩展只需要新增一个 BullMQ 任务类型和对应的 Prompt，无需改动核心架构。

---

## 10. 总结

这套 AI 审核系统最大的优势是**零成本 + 零侵入**：

- **零成本**：Gemini 2.0 Flash 永久免费
- **零侵入**：异步队列处理，不阻塞用户请求
- **零感知**：用户提交评论后完全无感，AI 在后台默默工作
- **高可靠性**：AI 不可用时自动降级，不影响主业务

核心经验：**不要把 AI 放在用户请求的同步路径上**。异步 + 队列的模式让 AI 的延迟（即使 500ms）对用户完全透明，同时还能享受免费额度带来的成本优势。
