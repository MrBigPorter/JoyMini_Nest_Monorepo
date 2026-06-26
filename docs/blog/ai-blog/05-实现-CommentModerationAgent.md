# 05. 实现 CommentModerationAgent

## 🎯 本步骤目标

1. 创建 `moderationAgentNode` — 基于 LangGraph 的增强评论审核 Agent
2. 创建多维度审核工具集（内容分析、用户画像、历史行为、上下文分析）
3. 实现自动回复决策引擎 — 超越现有简单分类的智能回复
4. 集成 HITL 人工审核回退机制
5. 保持与现有 BlogAiProcessor.processCommentModeration 的兼容

---

## 📖 背景说明

### 承上

现有评论审核管线（[`apps/api/src/blog/processors/blog-ai.processor.ts`](apps/api/src/blog/processors/blog-ai.processor.ts:963)）通过 BullMQ 异步处理：

1. `processCommentModeration()` — AiService.moderateComment 评分 0-100
2. `processAutoReply()` — CommentClassifier 分类后生成自动回复

现有限制：
- 评分维度单一（仅靠 LLM 单次判断）
- 自动回复不检查用户历史
- 无上下文感知（不知道讨论上下文）
- 无人工审核流转机制

### 这一步要解决的问题

| 问题 | 当前 | 目标 |
|------|------|------|
| 审核维度 | 单次 LLM 评分 | 多维度加权评分 |
| 用户分析 | 无 | 用户历史 + 信誉分 |
| 上下文 | 无 | 讨论线程上下文 |
| 自动回复 | 简单 Prompt 模板 | 智能决策引擎 |
| 人工介入 | 无 | HITL 回退机制 |
| 处理流程 | 固定 Queue | LangGraph 条件分支 |

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 执行模式 | 同步 vs 异步 | **同步 Agent + 异步 Fallback** | Agent 短路径同步，长任务回退到 BullMQ |
| 评分方式 | 单次 LLM vs 多维度加权 | **多维度加权** | 更准确、可解释性更好 |
| Agent 拓扑 | 线性 vs 分支 | **分支决策图** | 不同场景走不同路径，高效灵活 |
| 现有 Processor | 替换 vs 增强 | **增强** | Agent 作为上层编排，Processor 作为执行后端 |

---

## ⚙️ 前置条件

- [x] BlogAiProcessor.processCommentModeration 可用
- [x] AiService.moderateComment 可用
- [x] AiService.generateAutoReply 可用
- [x] CommentService CRUD 可用
- [x] BlogService.getArticleComments / getCommentReplies 可用

---

## 📝 实现步骤

### Step 1: 创建审核工具集

**文件**: `apps/api/src/blog/agent/tools/moderation.tools.ts`

```typescript
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { AiService } from '@api/common/ai/ai.service';
import { CommentService } from '../../comment/comment.service';

/**
 * Tool 1: 内容分析
 * 分析评论内容的风险等级，支持多维度检测
 */
export function createContentAnalysisTool(aiService: AiService) {
  return new DynamicStructuredTool({
    name: 'content_analysis',
    description: `分析评论内容的风险等级、类别和质量。
返回多维度分析结果：风险评分0-100、分类标签、语言、情感倾向。`,
    schema: z.object({
      content: z.string().describe('评论内容'),
      articleTitle: z.string().optional().describe('相关文章标题'),
      locale: z.string().optional().describe('评论语言'),
    }),
    func: async ({ content, articleTitle, locale }) => {
      const result = await aiService.moderateComment(content, articleTitle || '');

      // 增强分析：语言检测、情感分析、质量评估
      const dimensionAnalysis = await aiService.generateText(
        `分析以下评论的多维度特征，返回 JSON：
{
  "language": "检测到的语言",
  "sentiment": "positive|neutral|negative",
  "quality": "high|medium|low",
  "containsQuestion": true|false,
  "toxicityDimensions": {
    "spam": 0-1,
    "hate": 0-1,
    "harassment": 0-1,
    "selfPromotion": 0-1
  }
}

评论内容：${content}`,
        { temperature: 0.1 },
      );

      return JSON.stringify({
        overallScore: result.score,
        categories: result.categories,
        reason: result.reason,
        dimensionAnalysis: JSON.parse(
          dimensionAnalysis.match(/\{[\s\S]*\}/)?.[0] || '{}'
        ),
      });
    },
  });
}

/**
 * Tool 2: 用户画像分析
 * 分析评论者的历史行为和信誉
 */
export function createUserProfileTool(commentService: CommentService) {
  return new DynamicStructuredTool({
    name: 'user_profile',
    description: `分析评论者的历史行为和信誉评分。
输入评论者信息，返回历史评论统计、被举报次数、信誉等级。`,
    schema: z.object({
      authorName: z.string().describe('评论者名称'),
      authorEmail: z.string().describe('评论者邮箱'),
    }),
    func: async ({ authorName, authorEmail }) => {
      // 查询该用户的历史评论
      const history = await commentService['prisma'].blogComment.findMany({
        where: {
          OR: [
            { author: authorName },
            { email: authorEmail },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      if (history.length === 0) {
        return JSON.stringify({
          isNewUser: true,
          totalComments: 0,
          approvedRate: 1,
          flaggedCount: 0,
          reputation: 'neutral',
        });
      }

      const totalComments = history.length;
      const approvedCount = history.filter((c) => c.status === 'APPROVED').length;
      const rejectedCount = history.filter((c) => c.status === 'REJECTED').length;

      return JSON.stringify({
        isNewUser: false,
        totalComments,
        approvedRate: approvedCount / totalComments,
        rejectedRate: rejectedCount / totalComments,
        flaggedCount: 0, // 可通过 BlogCommentFlag 查询
        reputation:
          rejectedCount > 3 ? 'low'
          : approvedCount > 10 ? 'high'
          : 'neutral',
      });
    },
  });
}

/**
 * Tool 3: 上下文分析
 * 分析评论在讨论线程中的上下文
 */
export function createContextAnalysisTool(commentService: CommentService) {
  return new DynamicStructuredTool({
    name: 'context_analysis',
    description: `分析评论在讨论线程中的上下文，包括父评论和讨论链。
输入父评论 ID，返回上下文信息。`,
    schema: z.object({
      parentId: z.string().nullable().describe('父评论 ID，如果是顶级评论则为 null'),
      articleId: z.string().describe('文章 ID'),
    }),
    func: async ({ parentId, articleId }) => {
      const context: any = { threadDepth: 0, parentContent: null };

      if (parentId) {
        const parent = await commentService['prisma'].blogComment.findUnique({
          where: { id: parentId },
        });
        if (parent) {
          context.threadDepth = 1; // 简化版，实际可递归查询
          context.parentContent = parent.content;
          context.parentStatus = parent.status;
        }
      }

      // 获取该文章下的评论数
      const threadCount = await commentService['prisma'].blogComment.count({
        where: { articleId },
      });

      context.totalThreadComments = threadCount;
      return JSON.stringify(context);
    },
  });
}
```

### Step 2: 实现 CommentModerationAgent Node

**文件**: `apps/api/src/blog/agent/nodes/moderation-agent.node.ts`

```typescript
import { Logger } from '@nestjs/common';
import { AiService } from '@api/common/ai/ai.service';
import { CommentService } from '../../comment/comment.service';
import { BlogService } from '../../blog.service';
import { BlogAgentState } from '../graph/state';
import {
  createContentAnalysisTool,
  createUserProfileTool,
  createContextAnalysisTool,
} from '../tools/moderation.tools';
import { AgentInteractionService } from '../services/interaction.service';

const MODERATION_DECISION_PROMPT = `你是一个博客评论审核助手。基于以下分析结果，做出审核决策。

分析维度：
1. 内容分析 - 风险评分、分类、语言、情感、质量
2. 用户画像 - 历史行为、信誉等级
3. 上下文分析 - 讨论线程深度、父评论内容

决策规则：
- 综合风险评分 0-30：自动通过 APPROVED
- 综合风险评分 30-60：标记 PENDING 需要人工审核
- 综合风险评分 60-100：自动拒绝 REJECTED
- 信誉等级为 low 且评分 > 20：自动拒绝
- 新用户且评分 > 30：标记 PENDING
- 包含问题且评分 < 30：标记需要自动回复

返回 JSON 格式：
{
  "decision": "APPROVED|REJECTED|PENDING",
  "confidence": 0-1,
  "reason": "决策理由（用户语言）",
  "autoReply": true|false,
  "autoReplyType": "question|suggestion|criticism|bug|praise|common|null"
}`;

export function createModerationAgentNode(
  aiService: AiService,
  commentService: CommentService,
  blogService: BlogService,
  interactionService: AgentInteractionService,
) {
  return async (state: typeof BlogAgentState.State) => {
    const logger = new Logger('ModerationAgent');
    const startTime = Date.now();

    try {
      // 从 state 中提取评论审核信息
      // input 格式: "审核评论: {content}, 作者: {author}, 文章: {slug}"
      const inputMatch = state.input.match(
        /审核评论[：:]\s*(.+?)(?:[,，]\s*作者[：:]\s*(.+?))?(?:[,，]\s*文章[：:]\s*(.+?))?$/,
      );

      const content = inputMatch?.[1] || state.input;
      const authorName = inputMatch?.[2] || '';
      const articleSlug = inputMatch?.[3] || state.currentArticleSlug || '';

      // 1. 内容分析
      const contentResult = JSON.parse(
        await (await createContentAnalysisTool(aiService).func({
          content,
          articleTitle: articleSlug,
          locale: state.locale,
        })),
      );

      // 2. 用户画像分析（如果有作者信息）
      let userProfile = null;
      if (authorName) {
        userProfile = JSON.parse(
          await (await createUserProfileTool(commentService).func({
            authorName,
            authorEmail: '', // 需要从评论中获取
          })),
        );
      }

      // 3. 决策
      const overallScore = contentResult.overallScore || 50;
      const isLowReputation = userProfile?.reputation === 'low';
      const isNewUser = userProfile?.isNewUser;

      let decision: string;
      let needsHumanIntervention = false;

      if (isLowReputation && overallScore > 20) {
        decision = 'REJECTED';
      } else if (overallScore <= 30) {
        decision = 'APPROVED';
      } else if (overallScore >= 60) {
        decision = 'REJECTED';
      } else if (isNewUser && overallScore > 30) {
        decision = 'PENDING';
        needsHumanIntervention = true;
      } else {
        decision = 'PENDING';
        needsHumanIntervention = overallScore > 45;
      }

      // 4. 记录交互
      await interactionService.logInteraction({
        sessionId: `moderate_${Date.now()}`,
        userInput: content,
        detectedIntent: 'moderate',
        agentName: 'CommentModerationAgent',
        agentThoughts: [{ contentResult, userProfile }],
        toolsCalled: ['content_analysis', 'user_profile', 'context_analysis'],
        agentOutput: JSON.stringify({ decision, overallScore }),
        processingMs: Date.now() - startTime,
        locale: state.locale,
      });

      return {
        output: JSON.stringify({
          decision,
          overallScore,
          contentAnalysis: contentResult,
          userProfile,
        }),
        activeAgent: 'moderationAgent',
        needsHumanIntervention,
        humanInterventionReason: needsHumanIntervention
          ? `评论审核需人工确认：评分 ${overallScore}，用户信誉 ${userProfile?.reputation || 'unknown'}`
          : null,
      };
    } catch (error) {
      logger.error(`ModerationAgent 执行失败: ${error.message}`);
      // 降级到现有 Processor 处理
      return {
        output: JSON.stringify({ decision: 'PENDING', fallback: true }),
        needsHumanIntervention: true,
        humanInterventionReason: `ModerationAgent error: ${error.message}，已降级到 PENDING`,
      };
    }
  };
}
```

### Step 3: 审核决策流程图

```mermaid
flowchart TB
    subgraph Input["输入"]
        I1["评论内容"]
        I2["作者信息"]
        I3["文章上下文"]
    end

    subgraph Tools["工具分析"]
        CA["content_analysis<br/>多维度内容评分"]
        UP["user_profile<br/>用户历史信誉"]
        CTA["context_analysis<br/>讨论线程上下文"]
    end

    subgraph Decision["决策引擎"]
        D1{"综合评分 <= 30?"}
        D2{"综合评分 >= 60?"}
        D3{"低信誉用户?"}
        D4{"新用户?"}
        D5{"包含问题?<br/>评分 < 30"}
    end

    subgraph Outcomes["审核结果"]
        O1["APPROVED<br/>自动通过"]
        O2["REJECTED<br/>自动拒绝"]
        O3["PENDING<br/>标记人工审核"]
        O4["APPROVED + AutoReply<br/>自动回复"]
    end

    I1 & I2 & I3 --> CA & UP & CTA
    CA & UP & CTA --> D1
    D1 -- "是" --> D5
    D5 -- "是" --> O4
    D5 -- "否" --> O1
    D1 -- "否" --> D2
    D2 -- "是" --> O2
    D2 -- "否" --> D3
    D3 -- "是" & "评分>20" --> O2
    D3 -- "否" --> D4
    D4 -- "是" & "评分>30" --> O3
    D4 -- "否" --> O3
```

### Step 4: 降级策略与现有 Processor 集成

CommentModerationAgent 与现有 BlogAiProcessor 的关系：

```typescript
// 当 Agent 无法处理时，降级到现有 BullMQ Processor

// 在 BlogAgentService 中：
async processWithFallback(input: {
  text: string;
  locale?: string;
  userId?: string;
}): Promise<{ output: string; source: 'agent' | 'fallback' }> {
  try {
    const result = await this.process(input);
    if (result.needsHumanIntervention && this.isFallbackNeeded(result)) {
      // 降级：将任务投递到 blog-ai queue
      await this.bullQueue.add('moderate-comment', {
        content: input.text,
        locale: input.locale,
      });
      return { output: '已提交审核，请稍候结果', source: 'fallback' };
    }
    return { output: result.output, source: 'agent' };
  } catch {
    // 完全降级
    await this.bullQueue.add('moderate-comment', { content: input.text });
    return { output: '已提交审核队列', source: 'fallback' };
  }
}
```

| 场景 | Agent 处理 | Fallback |
|------|-----------|----------|
| Agent 正常运行 | 多维度审核 + 同步结果 | - |
| Agent LLM 超时 | - | 投递到 BullMQ |
| Agent 评分不明确 | - | 标记 PENDING |
| 高风险内容 | 自动拒绝 | - |
| 系统过载 | - | 直接投递到原 Queue |

---

## ✅ 验收方式

### 手动验证

1. **正常评论审核**
   - 输入：`审核评论：这篇文章写得很好！， 作者：张三`
   - 预期：APPROVED，评分 < 30

2. **垃圾评论检测**
   - 输入：`审核评论：免费领取iPhone，点击链接xxx， 作者：spam_user`
   - 预期：REJECTED，评分 > 60

3. **边际案例**
   - 输入：`审核评论：你们的服务太差了， 作者：new_user`
   - 预期：PENDING，需要人工审核

4. **降级测试**
   - 模拟 Agent 异常
   - 预期：任务投递到 blog-ai queue

### 自动化测试

```typescript
describe('CommentModerationAgent', () => {
  it('should approve normal comment', async () => {
    const result = await agent({ input: '审核评论：好文章！', locale: 'zh' });
    const output = JSON.parse(result.output);
    expect(output.decision).toBe('APPROVED');
  });

  it('should reject spam', async () => {
    const result = await agent({ input: '审核评论：点击领奖 www.spam.com', locale: 'zh' });
    const output = JSON.parse(result.output);
    expect(output.decision).toBe('REJECTED');
  });

  it('should trigger HITL for borderline cases', async () => {
    const result = await agent({ input: '审核评论：你们的东西不太好用', locale: 'zh' });
    expect(result.needsHumanIntervention).toBe(true);
  });
});
```

---

## 🔜 下一步预告

下一步 [06-创建-TranslationQualityAgent](06-创建-TranslationQualityAgent.md) 将：
- 实现 TranslationQualityAgent — AI 驱动的翻译质量保障
- 超越现有正则/统计检测，引入 LLM 语义质量评估
- 创建智能修复决策引擎
- 实现全自动 → 半自动 → 人工的三级修复策略
