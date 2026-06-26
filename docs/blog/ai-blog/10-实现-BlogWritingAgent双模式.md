# 10. 实现 BlogWritingAgent 双模式

## 🎯 本步骤目标

为管理后台创建一个 **BlogWritingAgent**，提供两种模式：
1. **ReAct Agent（快速模式）** — 单轮对话 + 单工具调用，即时响应
2. **Workflow Graph（结构化模式）** — 多步编排 + HITL 人工审核，支持断点续写

---

## 📖 背景说明

### 承上

已完成 Blog Agent 面向用户的 4 个专业 Agent（搜索/评论审核/翻译质量/内容推荐）和 MultiAgentSupervisor 编排层。但这些都是面向**前端用户**的。

### 这一步要解决的问题

管理后台的编辑操作目前全部是手动 CRUD。管理员需要：
- 根据主题快速生成大纲
- 基于参考文章写草稿
- 润色已有文章
- 提取摘要和推荐标签
- 完整创作流程需要人工审核

### 设计决策

| 决策 | 选项 | 选择 |
|------|------|------|
| 模式选择 | 单一 Agent / 双模式 | **双模式** — ReAct 处理快速任务，Workflow 处理完整创作 |
| 架构定位 | 挂在 MultiAgentSupervisor 下 / 独立 | **独立** — 面向管理员，不走用户意图路由 |
| 复用基础 | 另起炉灶 / 复用 AiService | **复用 AiService** — generateText、generateEmbedding |
| 工具写法 | 手动函数 / `tool()` API | **`tool()` API + Zod schema** — 参考 jisugou 02 |
| 审核机制 | 直接发布 / 中断审核 | **中断审核** — 参考 workflow-agent 11 + python-ai-quickstart 13 |

### 从教学项目提取的模式

| 教学项目 | 模式 | 应用 |
|----------|------|------|
| `jisugou-ai-agent/02-tool-system.md` | `tool()` API + Zod schema | 工具定义规范 |
| `travel-agent/backend/src/tools/itinerary.tool.ts` | 工具内部调 LLM | 写作工具内部调 AiService |
| `travel-agent/backend/src/agent/agent.service.ts` | `AsyncGenerator` 流式 | SSE 流式推送 |
| `workflow-agent/11-human-approval.md` | `interrupt()` + Checkpoint | HITL 审核 |
| `python-ai-quickstart/11-react-agent.md` | `createReactAgent` | ReAct 快速模式 |
| `python-ai-quickstart/13-human-in-the-loop.md` | `interrupt()` + `Command(resume=...)` | 审核恢复 |
| `general-agent/13-multi-agent-orchestration.md` | Planner/Writer/Critic 角色 | 写作角色分工 |
| `general-agent/18-agent-thinking-real-time-display.md` | SSE 事件协议 | 实时推送 |
| `workmind-ai/04-content-generation-workflow.md` | WorkflowTemplate + Node 状态 | 结构化流程 |

---

## ⚙️ 前置条件

### 环境要求

- NestJS + LangGraph 已安装
- `@langchain/langgraph` 依赖可用
- `@langchain/core` 依赖可用
- AiService 已集成 Ollama

### 文件/配置准备

```
apps/api/src/blog/agent/
├── tools/
│   └── writing.tools.ts          # 11 - 写作工具集（下一步创建）
├── nodes/
│   ├── writing-agent.node.ts     # 10 - ReAct Agent Node
│   └── writing-workflow.node.ts  # 10 - Workflow Node
├── graph/
│   └── writing.graph.ts          # 10 - Workflow Graph 定义
├── writing-agent.controller.ts   # 10 - Admin API
├── writing-agent.service.ts      # 10 - 主编排服务
```

### 知识准备

- [LangGraph ReAct Agent](https://langchain-ai.github.io/langgraph/how-tos/create-react-agent/)
- [LangGraph interrupt()](https://langchain-ai.github.io/langgraph/how-tos/human-in-the-loop/)

---

## 📝 实现步骤

### Step 1: 定义双模式状态

`writing-agent.service.ts` 定义两种状态：

```typescript
// === ReAct 模式状态（轻量） ===
export interface ReActWritingState {
  messages: BaseMessage[];       // 对话历史
  toolCalls: number;             // 工具调用计数
  maxToolCalls: number;          // 上限保护
}

// === Workflow 模式状态（完整） ===
export interface WorkflowWritingState {
  // 阶段控制
  stage: WorkflowStage;          // plan → research → draft → review → publish
  stageHistory: WorkflowStage[];

  // 写作输入
  topic: string;                 // 主题
  locale: string;                // 语言
  style?: string;                // 风格（正式/轻松/技术）
  referenceArticleIds?: string[]; // 参考文章 ID

  // 中间产出
  outline?: string;              // 大纲
  researchNotes?: ResearchNote[]; // 研究笔记
  draftContent?: string;         // 草稿内容
  polishedContent?: string;      // 润色后内容
  abstract?: string;             // 摘要
  suggestedTags?: string[];      // 推荐标签

  // HITL
  requiresApproval: boolean;     // 是否需要审核
  approvalTaskId?: string;       // 审核任务 ID
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'edit';
  editorFeedback?: string;       // 编辑反馈

  // 元数据
  errors: string[];
  startTime: Date;
}

export enum WorkflowStage {
  PLAN = 'plan',
  RESEARCH = 'research',
  DRAFT = 'draft',
  POLISH = 'polish',
  REVIEW = 'review',
  PUBLISH = 'publish',
  DONE = 'done',
}
```

### Step 2: 实现 ReAct Agent（快速模式）

使用 `createReactAgent` 创建快速写作 Agent，参考 python-ai-quickstart 11-react-agent 的模式。

`writing-agent.node.ts`:

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOllama } from '@langchain/ollama';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export async function createQuickWritingAgent(aiService: AiService) {
  // 使用 AiService 的 LLM（或直接 ChatOllama 写模式）
  const llm = new ChatOllama({
    model: 'qwen3.5:0.8b',          // 轻量模型，快速响应
    temperature: 0.7,
    baseUrl: 'http://localhost:11434',
  });

  // 加载写作工具集（从 doc 11 导入）
  const tools = await loadWritingTools(aiService);

  const agent = createReactAgent({
    llm,
    tools,
    stateModifier: (state) => {
      // 系统提示词：快速写作模式
      return [
        systemPrompt`你是 JoyMini 博客的管理员写作助手（快速模式）。
        管理员会给你一个写作任务，使用工具快速完成。
        每次调用一个工具，不要多步骤。
        完成时用 "DONE: [摘要]" 标记结束。`,
        ...state.messages,
      ];
    },
    maxToolCalls: 5,  // 防止死循环
  });

  return agent;
}
```

**ReAct 模式执行流程**（参考 travel-agent 的 `streamChat` 方法）：

```typescript
async *streamQuickWrite(userId: string, message: string): AsyncGenerator<string> {
  const agent = await this.getQuickWritingAgent();
  const config = { configurable: { thread_id: `quick-${userId}-${Date.now()}` } };

  const eventStream = await agent.streamEvents(
    { messages: [new HumanMessage(message)] },
    { ...config, version: 'v2' },
  );

  for await (const event of eventStream) {
    if (event.event === 'on_chat_model_stream') {
      const token = event.data?.chunk?.content;
      if (token) yield `data: ${JSON.stringify({ type: 'token', content: token })}\n\n`;
    }
    if (event.event === 'on_tool_start') {
      yield `data: ${JSON.stringify({ type: 'step', status: 'running', tool: event.name })}\n\n`;
    }
  }
}
```

### Step 3: 实现 Workflow Graph（结构化模式）

参考 general-agent 13 的 Planner/Writer/Critic 角色分工，结合 workmind-ai 04 的工作流节点状态。

`writing.graph.ts`:

```typescript
import { StateGraph, Annotation, interrupt, Command } from '@langchain/langgraph';

const WritingStateAnnotation = Annotation.Root({
  stage: Annotation<WorkflowStage>(),
  topic: Annotation<string>(),
  locale: Annotation<string>(),
  outline: Annotation<string>(),
  researchNotes: Annotation<ResearchNote[]>(),
  draftContent: Annotation<string>(),
  polishedContent: Annotation<string>(),
  abstract: Annotation<string>(),
  suggestedTags: Annotation<string[]>(),
  requiresApproval: Annotation<boolean>(),
  approvalTaskId: Annotation<string>(),
  approvalStatus: Annotation<'pending' | 'approved' | 'rejected' | 'edit'>(),
  editorFeedback: Annotation<string>(),
  errors: Annotation<string[]>(),
});

// 节点定义
async function planNode(state: typeof WritingStateAnnotation.State) {
  // 调用 LLM 生成大纲
  const outline = await generateOutline(state.topic, state.locale);
  return { ...state, stage: WorkflowStage.RESEARCH, outline };
}

async function researchNode(state: typeof WritingStateAnnotation.State) {
  // 搜索已有文章和知识库
  const notes = await researchTopic(state.outline, state.locale);
  return { ...state, stage: WorkflowStage.DRAFT, researchNotes: notes };
}

async function draftNode(state: typeof WritingStateAnnotation.State) {
  // 基于大纲+研究笔记写草稿
  const draft = await writeFullArticle(state.outline, state.researchNotes, state.locale);
  return { ...state, stage: WorkflowStage.POLISH, draftContent: draft };
}

async function polishNode(state: typeof WritingStateAnnotation.State) {
  // 润色草稿
  const polished = await polishArticle(state.draftContent, state.style);
  const abstract = await summarizeToAbstract(polished);
  const tags = await suggestTags(polished);
  return {
    ...state,
    stage: WorkflowStage.REVIEW,
    polishedContent: polished,
    abstract,
    suggestedTags: tags,
  };
}

async function reviewNode(state: typeof WritingStateAnnotation.State) {
  // ⚠️ HITL 中断点 — 等待管理员审核
  const task = await this.approvalService.createTask({
    type: 'writing_review',
    data: {
      topic: state.topic,
      outline: state.outline,
      draftContent: state.draftContent,
      polishedContent: state.polishedContent,
      abstract: state.abstract,
      suggestedTags: state.suggestedTags,
    },
    createdBy: 'system',
  });

  const result = interrupt({
    type: 'writing_review',
    taskId: task.id,
    message: '请审核文章草稿，可批准、驳回或提供修改意见',
  });

  // 处理审核结果
  return handleApprovalResult(state, result, task.id);
}

async function publishNode(state: typeof WritingStateAnnotation.State) {
  // 调用 BlogService.createArticle 发布
  const article = await this.blogService.createArticle(state.adminId, {
    title: extractTitle(state.polishedContent),
    content: state.polishedContent,
    summary: state.abstract,
    tags: state.suggestedTags,
    locale: state.locale,
  });
  return { ...state, stage: WorkflowStage.DONE, articleId: article.id };
}
```

### Step 4: 构建 Workflow Graph

```typescript
function buildWritingGraph() {
  const workflow = new StateGraph(WritingStateAnnotation)
    .addNode('plan', planNode)
    .addNode('research', researchNode)
    .addNode('draft', draftNode)
    .addNode('polish', polishNode)
    .addNode('review', reviewNode)
    .addNode('publish', publishNode)

    // 顺序流转
    .addEdge('__start__', 'plan')
    .addEdge('plan', 'research')
    .addEdge('research', 'draft')
    .addEdge('draft', 'polish')
    .addEdge('polish', 'review')

    // review → conditional → publish or back to draft
    .addConditionalEdges('review', (state) => {
      if (state.approvalStatus === 'approved') return 'publish';
      if (state.approvalStatus === 'reject') return '__end__';
      return 'draft'; // edit → 回到草稿修改
    })

    .addEdge('publish', '__end__')
    .compile();
}
```

### Step 5: 创建 Admin API 端点

`writing-agent.controller.ts`:

```typescript
@ApiTags('Admin Blog - Writing Agent')
@Controller('admin/blog/writing-agent')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class WritingAgentController {
  constructor(private readonly writingAgentService: WritingAgentService) {}

  // === ReAct 快速模式 ===
  @Post('quick-write')
  @ApiOperation({ summary: '快速写作（ReAct 模式）' })
  async quickWrite(@Body() dto: { message: string }, @Req() req: Request) {
    return this.writingAgentService.quickWrite(req.user.id, dto.message);
  }

  // === ReAct 快速模式（SSE 流式） ===
  @Post('quick-write/stream')
  @ApiOperation({ summary: '快速写作流式（SSE）' })
  @Header('Content-Type', 'text/event-stream')
  async quickWriteStream(
    @Body() dto: { message: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = this.writingAgentService.streamQuickWrite(req.user.id, dto.message);
    for await (const chunk of stream) {
      res.write(chunk);
    }
    res.end();
  }

  // === Workflow 结构化写作 ===
  @Post('workflow/start')
  @ApiOperation({ summary: '启动结构化写作流程' })
  async startWorkflow(@Body() dto: StartWorkflowDto, @Req() req: Request) {
    return this.writingAgentService.startWorkflow(req.user.id, dto);
  }

  // === Workflow 审核操作 ===
  @Post('workflow/approve')
  @ApiOperation({ summary: '审核文章' })
  async approveWorkflow(@Body() dto: ApproveWorkflowDto) {
    return this.writingAgentService.handleApproval(dto);
  }

  // === Workflow 流式推送 ===
  @Post('workflow/stream')
  @ApiOperation({ summary: 'Workflow 写作流式推送（SSE）' })
  @Header('Content-Type', 'text/event-stream')
  async streamWorkflow(
    @Body() dto: { threadId: string },
    @Res() res: Response,
  ) {
    // SSE 流式推送 Workflow 执行进度
    const stream = this.writingAgentService.streamWorkflow(dto.threadId);
    for await (const chunk of stream) {
      res.write(chunk);
    }
    res.end();
  }
}
```

### Step 6: 双模式对比总结

| 维度 | ReAct 快速模式 | Workflow 结构化模式 |
|------|---------------|-------------------|
| **适用场景** | 补摘要、写标签、翻译片段 | 完整创作：写一篇新文章 |
| **状态管理** | 无状态，单轮对话 | 多状态节点，Checkpoint 持久化 |
| **工具调用** | 每次 1 个工具，最多 5 次 | 多个节点，每节点可工具调用 |
| **LLM 模型** | 轻量模型（qwen3.5:0.8b） | 重量模型（qwen7b/14b） |
| **审核** | 无 HITL | HITL 中断审核 |
| **持久化** | 无 | Checkpointer 支持断点续写 |
| **SSE 推送** | token 级流式 | token + step 级流式 |
| **响应时间** | 秒级 | 分钟级（含审核时间） |

---

## ✅ 验收方式

### 手动验证

1. **快速模式测试**：
   ```bash
   curl -X POST http://localhost:3000/admin/blog/writing-agent/quick-write \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"message": "给这篇文章写一个摘要：...文章内容..."}'
   ```

2. **快速模式 SSE 测试**：
   ```bash
   curl -N -X POST http://localhost:3000/admin/blog/writing-agent/quick-write/stream \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"message": "写一篇关于 NestJS 最佳实践的文章大纲"}'
   ```

3. **Workflow 启动测试**：
   ```bash
   curl -X POST http://localhost:3000/admin/blog/writing-agent/workflow/start \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"topic": "如何用 Docker 部署 NestJS 应用", "locale": "zh", "style": "技术教程"}'
   ```

### 自动化测试

```typescript
describe('WritingAgentService', () => {
  it('quickWrite 应返回摘要文本', async () => {
    const result = await service.quickWrite('admin-1', '写一个摘要');
    expect(result).toContain('DONE:');
  });

  it('streamQuickWrite 应流式输出 token', async () => {
    const chunks: string[] = [];
    for await (const chunk of service.streamQuickWrite('admin-1', '写摘要')) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toContain('data:');
  });

  it('Workflow 启动应返回 threadId', async () => {
    const result = await service.startWorkflow('admin-1', {
      topic: '测试主题',
      locale: 'zh',
    });
    expect(result).toHaveProperty('threadId');
    expect(result).toHaveProperty('stage', 'plan');
  });
});
```

---

## 🔜 下一步预告

继续阅读 [11-实现-写作工具集工厂函数](11-实现-写作工具集工厂函数.md) — 为 WritingAgent 实现 9 个写作工具。
