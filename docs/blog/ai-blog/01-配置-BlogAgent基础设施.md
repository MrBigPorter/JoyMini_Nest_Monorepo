# 01. 配置 BlogAgent 基础设施

## 🎯 本步骤目标

1. 创建 `BlogAgentModule` — 博客 AI Agent 的 NestJS 模块定义
2. 创建 `GraphState` 定义 — 全局 Agent 状态接口
3. 配置 LangGraph 依赖 — 安装 `@langchain/langgraph`、`@langchain/core`
4. 复用现有 `AiService` — 作为 Agent 的 LLM 调用后端
5. 初始化 Graph 编排框架

完成本步骤后，Blog AI Agent 的基础骨架搭建完毕，可以开始添加具体 Agent 节点。

---

## 📖 背景说明

### 承上

[00-博客系统架构分析](00-博客系统架构分析.md) 全面剖析了博客系统现有的能力：
- BlogAiProcessor 提供翻译管线和评论审核
- AiService 提供多 Provider 的 LLM 调用
- BullMQ 队列处理异步任务
- 多语言内容系统支持 6 种语言的 LocalizedString

现有 AI 能力是**任务驱动**的（Queue + Processor），缺少**智能编排**：
- 无法根据上下文动态选择处理策略
- 缺少意图识别和路由
- 没有多步推理和工具调用
- 无法优雅处理边界情况

### 这一步要解决的问题

引入 LangGraph 作为 Agent 编排框架，将 Blog AI 从被动任务处理升级为主动智能体：

| 当前（Queue） | 目标（Agent） |
|--------------|--------------|
| 固定处理流程 | 动态意图路由 |
| 单向任务执行 | 多步推理+工具调用 |
| 无状态处理 | Stateful Graph |
| 单一任务类型 | 多 Agent 协作 |
| 无人工介入 | HITL 支持 |

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 编排框架 | LangGraph vs 自定义FSM | **LangGraph** | 社区活跃、React Agent 成熟、与 LangChain 生态兼容 |
| 模块位置 | 独立 Module vs BlogModule 内部 | **独立 BlogAgentModule** | 职责分离，可独立启用/停用，降低 BlogService 耦合 |
| 状态管理 | 内存 vs Redis | **内存+可选 Checkpointer** | 初期内存足够，后续按需引入 PostgreSQL Checkpointer |
| LLM 复用 | 新创建 vs 复用 AiService | **复用 AiService** | 已有 Circuit Breaker、Rate Limit、多 Provider 路由 |
| 文件结构 | 分散 vs 集中 | **graph/ 子目录集中** | 与现有 ai-customer 模式一致，便于管理 |

---

## ⚙️ 前置条件

### 环境要求

- [x] Node.js 18+，NestJS 10+
- [x] 项目已安装 `@nestjs/bull`、`bullmq`
- [x] AiService 已配置并可用（Gemini / Groq / DeepSeek）
- [x] 了解 LangGraph 基本概念：StateGraph、Node、Edge、State

### 文件/配置准备

- [x] `apps/api/src/common/ai/ai.service.ts` — AiService 已存在
- [x] `apps/api/src/prisma/schema.prisma` — 数据模型已存在

---

## 📝 实现步骤

### Step 1: 创建 BlogAgentModule

**文件**: `apps/api/src/blog/agent/blog-agent.module.ts`

创建博客 Agent 的 NestJS 模块，导入所需依赖并注册 Provider。

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiModule } from '@api/common/ai/ai.module';
import { BlogModule } from '../blog.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'blog-ai' }),
    BullModule.registerQueue({ name: 'media-processor' }),
    AiModule,
    // 循环引用：BlogModule 引用 BlogAgentModule 时需要 forwardRef
    forwardRef(() => BlogModule),
  ],
  providers: [
    // Graph 编排服务（后续步骤实现）
    BlogAgentService,
    // 各 Agent 节点（后续步骤注册）
  ],
  exports: [BlogAgentService],
})
export class BlogAgentModule {}
```

**设计决策**：
- 使用 `forwardRef` 解决 BlogModule ↔ BlogAgentModule 循环依赖
- 复用 `blog-ai` 队列，不创建新队列（Agent 可能触发翻译/审核任务）
- `BlogAgentService` 作为 Facade 对外暴露

### Step 2: 定义 GraphState

**文件**: `apps/api/src/blog/agent/graph/state.ts`

定义 Agent 全局状态接口，各节点通过 State 共享信息。

```typescript
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { Annotation, StateGraph } from '@langchain/langgraph';

/**
 * Blog Agent Graph State
 *
 * 节点间共享的全局状态，每个节点可以读取和写入。
 */
export const BlogAgentState = {
  // ── 输入 ──
  /** 原始用户输入 */
  input: Annotation<string>,
  /** 用户语言（zh/en/ja/ko/fr/de） */
  locale: Annotation<string>,
  /** 用户 ID（如果已登录） */
  userId: Annotation<string | null>,

  // ── 意图 ──
  /** 识别到的用户意图 */
  intent: Annotation<string>,
  /** 意图置信度 0-1 */
  intentConfidence: Annotation<number>,

  // ── 上下文 ──
  /** 当前文章 ID（如果在文章上下文中） */
  currentArticleId: Annotation<string | null>,
  /** 当前文章 Slug */
  currentArticleSlug: Annotation<string | null>,
  /** 对话历史 */
  messages: Annotation<BaseMessage[]>,

  // ── Agent 路由 ──
  /** 当前活跃的 Agent 名称 */
  activeAgent: Annotation<string | null>,
  /** 已访问的 Agent 列表（防止循环） */
  visitedAgents: Annotation<string[]>,

  // ── 结果 ──
  /** Agent 的最终输出 */
  output: Annotation<string | null>,
  /** 是否需要人工介入 */
  needsHumanIntervention: Annotation<boolean>,
  /** 人工介入原因 */
  humanInterventionReason: Annotation<string | null>,
};
```

**设计决策**：
- 使用 LangGraph `Annotation` 模式（推荐方式）而非 `StateSchema`
- `messages` 字段存储对话历史，支持多轮交互
- `visitedAgents` 防止 Agent 路由循环
- `needsHumanIntervention` 标志启用 HITL 模式

### Step 3: 创建 BlogAgentService

**文件**: `apps/api/src/blog/agent/blog-agent.service.ts`

Agent 编排服务，负责初始化 Graph、处理用户请求、协调各 Agent 节点。

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, CompiledStateGraph } from '@langchain/langgraph';
import { AiService } from '@api/common/ai/ai.service';
import { BlogService } from '../blog.service';
import { BlogAgentState } from './graph/state';

@Injectable()
export class BlogAgentService {
  private readonly logger = new Logger(BlogAgentService.name);
  private graph: CompiledStateGraph | null = null;

  constructor(
    private readonly aiService: AiService,
    private readonly blogService: BlogService,
  ) {}

  /**
   * 初始化 Agent Graph（在 Module 初始化时调用）
   */
  async initializeGraph(): Promise<void> {
    const workflow = new StateGraph(BlogAgentState);

    // ── 节点注册（后续步骤逐步添加） ──
    // workflow.addNode('intentRouter', this.intentRouterNode.bind(this));
    // workflow.addNode('searchAgent', this.searchAgentNode.bind(this));
    // workflow.addNode('moderationAgent', this.moderationAgentNode.bind(this));
    // workflow.addNode('translationQualityAgent', this.translationQualityNode.bind(this));
    // workflow.addNode('answerSynthesizer', this.answerSynthesizerNode.bind(this));

    // ── 入口 ──
    // workflow.setEntryPoint('intentRouter');

    // ── 边定义（后续步骤添加） ──
    // workflow.addConditionalEdges('intentRouter', this.routeByIntent.bind(this));
    // workflow.addEdge('searchAgent', 'answerSynthesizer');
    // workflow.addEdge('answerSynthesizer', END);

    this.graph = workflow.compile();
    this.logger.log('Blog Agent Graph initialized');
  }

  /**
   * 处理用户请求
   */
  async process(input: {
    text: string;
    locale?: string;
    userId?: string;
    articleSlug?: string;
  }): Promise<{ output: string; needsHumanIntervention: boolean }> {
    if (!this.graph) {
      await this.initializeGraph();
    }

    const initialState = {
      input: input.text,
      locale: input.locale || 'zh',
      userId: input.userId || null,
      currentArticleSlug: input.articleSlug || null,
      currentArticleId: null,
      messages: [],
      intent: '',
      intentConfidence: 0,
      activeAgent: null,
      visitedAgents: [],
      output: null,
      needsHumanIntervention: false,
      humanInterventionReason: null,
    };

    const finalState = await this.graph!.invoke(initialState);
    return {
      output: finalState.output || '',
      needsHumanIntervention: finalState.needsHumanIntervention,
    };
  }
}
```

### Step 4: 注册 BlogAgentModule

**文件**: `apps/api/src/blog/blog.module.ts`

将 BlogAgentModule 注册到 BlogModule。

```typescript
// 在 blog.module.ts 的 imports 中添加：
import { BlogAgentModule } from './agent/blog-agent.module';

@Module({
  imports: [
    // ... 现有 imports ...
    forwardRef(() => BlogAgentModule),
  ],
})
```

**设计决策**：
- `forwardRef` 解决两个 Module 互相引用的循环依赖
- BlogAgentModule 可以访问 BlogService 的能力
- BlogModule 可以通过 BlogAgentService 使用 Agent 能力

---

## ✅ 验收方式

### 手动验证

1. **Module 初始化**
   - 启动 API 服务，观察控制台日志
   - 预期：`Blog Agent Graph initialized` 日志出现

2. **Graph 编译**
   - 调用 `BlogAgentService.process()` 测试接口
   - 预期：Graph 正常编译，返回响应

3. **AiService 集成**
   - 确认 Agent 内部调用 `aiService.generateText()` 正常
   - 预期：Agent 可以调用 LLM

### 自动化测试

```typescript
describe('BlogAgentModule', () => {
  it('should initialize graph', async () => {
    const service = module.get(BlogAgentService);
    await service.initializeGraph();
    expect(service['graph']).toBeDefined();
  });

  it('should process input', async () => {
    const result = await service.process({ text: 'hello' });
    expect(result).toHaveProperty('output');
  });
});
```

---

## 🔜 下一步预告

下一步 [02-创建-BlogAgent数据模型](02-创建-BlogAgent数据模型.md) 将：
- 创建 Agent 知识库 Prisma 模型（向量存储）
- 配置 pgvector 扩展
- 创建 Agent 交互日志模型
- 实现知识库文档 CRUD 基础服务
