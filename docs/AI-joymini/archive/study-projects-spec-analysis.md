# Study Projects Spec Analysis

> 使用 Spec Coding 方法论分析 4 个 LLM 教学项目的架构、特点和技术选择

---

## 项目一：AI 标注平台 (`ai-annotation-platform`)

### 概述

AI 训练数据标注平台，支持 **RLHF**（对话偏好）、**文本分类**、**命名实体识别（NER）**、**图片目标检测** 四种标注类型。含完整任务流转和质检系统。

### 技术栈

| 维度 | 选择 |
|------|------|
| 框架 | Vue 3 + Vite |
| UI | Element Plus |
| 状态管理 | Pinia（任务状态机） |
| Canvas 引擎 | Fabric.js v5 |
| 数据 | 全 Mock |

### 核心架构

```
任务状态机: idle → claimed → annotating → submitted → approved/rejected
```

**4 种标注页面共享同一套状态机**，通过 Pinia 全局 store 同步：

- [`stores/task.js`](study/LLM/ai-annotation-platform/src/stores/task.js) — 状态定义 + actions + getters
- 各标注页调 `claimTask()`、`submitTask()` 等，状态自动同步到任务列表和质检页

### AI 相关技术点

| 标注类型 | 技术 | 教学点 |
|----------|------|--------|
| RLHF | 双列对比 + 多维评分 + 快捷键 | 人类反馈数据采集 |
| 文本分类 | 数字键 1-4 快速标注 | 分类标注效率优化 |
| NER | 鼠标选区自动打标 + 嵌套实体 | 序列标注交互 |
| 图片标注 | Fabric.js Canvas 深度封装 | Canvas 标注引擎二次开发 |

### 对我们项目的参考价值

| 可借鉴 | 说明 |
|--------|------|
| **Fabric.js Canvas 引擎** | 如果 JoyMini 未来需要图片/商品标注功能 |
| **任务状态机模式** | 如果有后台人工审核 AI 回答的需求 |
| **快捷键系统** | 提高客服操作效率 |

---

## 项目二：AI 运营平台 (`ai-ops-platform`)

### 概述

面向运营和产品团队的 AI 产品可视化管理后台，含 **Prompt 版本管理**、**知识库维护**、**对话质量监控**、**Token 用量统计** 四个模块。

### 技术栈

| 维度 | 选择 |
|------|------|
| 框架 | Vue 3 + Vite |
| UI | Element Plus |
| 图表 | ECharts |
| API | DeepSeek 流式 API |
| 状态 | 局部 ref（无共享状态） |

### 核心架构

四个模块相互独立，无共享状态：

```
AI 运营平台
├── Prompt 管理 (版本/Diff/A-B测试/流式调试)
├── 知识库管理 (文档分块/编辑/向量化/命中率)
├── 监控看板 (SSE实时指标/异常回放)
└── Token 统计 (趋势/饼图/CSV导出)
```

### AI 相关技术点

| 模块 | 技术 | 教学点 |
|------|------|--------|
| Prompt 管理 | 版本 Diff + A/B 测试配置 | 提示词工程迭代流程 |
| 知识库管理 | 文档分块 + 增量向量化 + 命中率热力图 | RAG 知识库运维 |
| 监控看板 | SSE 实时推送 + ECharts 滚动图表 | AI 服务可观测性 |
| Token 统计 | 堆叠图 + 费用明细导出 | AI 成本控制 |

### 对我们项目的参考价值

| 可借鉴 | 说明 |
|--------|------|
| **知识库管理界面** | 我们 AI 客服的 RAG 知识库管理可直接复用此设计理念 |
| **监控看板 SSE 模式** | 我们 AI 客服的 SSG 流式输出监控可以参考 |
| **Token 统计** | 如果 JoyMini 需要统计 AI 调用成本 |
| **Prompt 版本管理** | 提示词版本管理对 AI 客服长期维护很重要 |

---

## 项目三：Journey AI 旅行助手 (`journey-ai`)

### 概述

基于 **LangGraph Agent** 架构的 AI 旅行规划助手。8 个专业工具通过 **ReAct 模式** 编排，支持 Web UI + CLI 双模式。

### 技术栈

| 维度 | 选择 |
|------|------|
| 框架 | NestJS + TypeScript |
| AI | LangGraph StateGraph + ToolNode |
| LLM | DeepSeek Chat |
| 校验 | Zod |
| 记忆 | JSON 文件持久化 |
| 流式 | SSE |
| 前端 | 内嵌 Web UI (Vanilla JS) |
| 部署 | Docker |

### 核心架构 — LangGraph Agent

```
START → call_model → should_continue → (call_tool → process_result → call_model) / END
```

**Agent State 定义：**
```typescript
interface AgentState {
  messages: BaseMessage[];     // 对话历史
  nextAction: string | null;   // 下一步动作
  toolCalls: ToolCall[];       // 工具调用记录
  memory: UserMemory | null;   // 用户记忆
  error: string | null;        // 错误信息
}
```

**8 个工具：**
1. `generateItinerary` — 行程规划
2. `getWeather` — 天气查询
3. `getAttractions` — 景点推荐
4. `calculateBudget` — 预算估算
5. `checkVisa` — 签证指导
6. `convertCurrency` — 货币换算
7. `generatePackingList` — 打包清单
8. `translatePhrases` — 翻译助手

### SSE 流式输出

```
TypeScript: chat.service.ts 中 streamChat() 方法
每个事件通过 res.write(`data: ${JSON.stringify(event)}\n\n`) 推送
```

### 对我们项目的参考价值

| 可借鉴 | 说明 |
|--------|------|
| **LangGraph ReAct 模式** | 和 jisu-ai-customer 类似但更完整的 Agent 循环 |
| **ToolNode 统一注册** | 工具集中管理、自动调用的模式 |
| **Zod Schema 参数校验** | 我们 Phase 1 的 tool schema 设计可直接参考 |
| **JSON 记忆系统** | 简单但有效的记忆持久化方案 |
| **SSE 流式设计** | 我们 AI 客服的流式输出架构 |

---

## 项目四：LangGraph NestJS 实战 (`langchain`)

### 概述

最全面的 LangGraph 教学项目，从基础到高级覆盖 **10 种工作流模式**。NestJS 后端 + React 前端（Ant Design）+ Ollama 本地模型。

### 技术栈

| 维度 | 选择 |
|------|------|
| 后端 | NestJS 11 |
| AI | LangGraph 1.2.x (StateGraph + MemorySaver) |
| LLM | Ollama (qwen3.5:0.8b) / DeepSeek |
| 前端 | React + Ant Design + TypeScript |
| 部署 | Docker + GitHub Actions + Vercel |
| 工作流引擎 | Workflow Editor 可视化编排 |

### 10 种 LangGraph 工作流模式

| # | 模式 | 文件 | 教学点 |
|---|------|------|--------|
| 1 | 无记忆对话 | [`langgraph.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/langgraph.service.ts:31) | 最小化 StateGraph |
| 2 | 有记忆对话 | [`langgraph.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/langgraph.service.ts:44) | MemorySaver |
| 3 | 文章摘要流水线 | [`article.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/article.service.ts) | Pipeline 模式 |
| 4 | ReAct Agent | [`react-agent.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/react-agent.service.ts) | createReactAgent |
| 5 | 条件路由 | [`routing.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/routing.service.ts) | Conditional edges |
| 6 | 并行分支 | [`parallel.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/parallel.service.ts) | Parallel nodes |
| 7 | Supervisor 监督 | [`supervisor.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/supervisor.service.ts) | Multi-Agent |
| 8 | 内容创作流水线 | [`pipeline.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/pipeline.service.ts) | Multi-step pipeline |
| 9 | 代码审查 | [`code-review.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/code-review.service.ts) | Parallel review |
| 10 | 邮件审批 | [`email-approval.service.ts`](study/LLM/langchain/langgraph-backend/src/langgraph/email-approval.service.ts) | Human-in-the-loop |

### React 前端架构

[`App.tsx`](study/LLM/langchain/langgraph-ui/src/App.tsx) — 6 个页面：

| 路由 | 页面 | 功能 |
|------|------|------|
| `/chat` | 对话记忆 | 无记忆/有记忆对话测试 |
| `/agent` | Agent 调试 | ReAct Agent 交互调试 |
| `/workflow` | 工作流图 | 可视化工作流状态 |
| `/workflow-editor` | 工作流编排 | 可视化编排 LangGraph |
| `/approval` | 邮件审批 | Human-in-the-loop 演示 |
| `/research` | 技术调研 | 综合项目演示 |

### 对我们项目的参考价值

| 可借鉴 | 说明 |
|--------|------|
| **NestJS + LangGraph 集成模式** | 和我们 JoyMini 架构完全一致，可直接参考 |
| **10 种工作流模式** | 我们 AI 客服的 StateGraph 可以借鉴其中的 ReAct、Pipeline 模式 |
| **Human-in-the-loop** | 未来 AI 客服需要人工审核时可直接参考 |
| **React Ant Design UI 模式** | 我们 admin-next 同样使用 Ant Design |
| **Docker + Vercel 部署** | 可以复用部署配置 |

---

## 五项目对比总表

| 特征 | jisu-ai-customer | ai-annotation | ai-ops | journey-ai | langchain |
|------|------------------|---------------|--------|------------|-----------|
| **后端框架** | Express | 无 | 无 | NestJS | NestJS 11 |
| **前端框架** | Vue 3 | Vue 3 | Vue 3 | Vanilla JS | React + Ant Design |
| **AI 框架** | LangChain LCEL + StateGraph | 无 | DeepSeek API | LangGraph StateGraph | LangGraph 1.2.x |
| **LLM** | Gemini/Groq/DeepSeek | 无 | DeepSeek | DeepSeek | Ollama / DeepSeek |
| **RAG** | ✅ pgvector | ❌ | ✅ 知识库管理 | ❌ | ❌ |
| **Agent** | ✅ ReAct (createReactAgent) | ❌ | ❌ | ✅ ReAct (ToolNode) | ✅ ReAct + Multi-Agent |
| **流式** | ✅ SSE (7 事件类型) | ❌ | ✅ SSE 调试 | ✅ SSE | ✅ SSE |
| **状态管理** | 全局 ChatService | Pinia 状态机 | 局部 ref | JSON 文件 | MemorySaver |
| **数据库** | PostgreSQL + pgvector | Mock | Mock | JSON 文件 | 无 |
| **部署** | 纯 Node | Vite build | Vite build | Docker | Docker + Vercel |
| **教学重点** | LLM 应用全栈 | 标注交互 UI | AI 运营工具 | LangGraph Agent | LangGraph 全模式 |

### 和 JoyMini 的匹配度

```
jisu-ai-customer → 最适合：AI 客服的 LLM 架构可直接映射
    匹配度: 95% — 意图路由 + Agent + RAG + StateGraph

ai-annotation-platform → 参考：标注系统的状态机设计
    匹配度: 20% — 非核心功能

ai-ops-platform → 参考：RAG 知识库管理界面 + Token 监控
    匹配度: 40% — RAG 管理界面设计理念可复用

journey-ai → 学习：LangGraph ReAct Agent 的完整实现
    匹配度: 70% — NestJS + LangGraph 集成 + ToolNode 模式

langchain → 学习：NestJS + LangGraph 10 种工作流模式
    匹配度: 85% — 最接近 JoyMini 的 NestJS + LangGraph 架构
```

---

## 对 JoyMini AI 客服的启发

### 架构层面（从 langchain + journey-ai 学）

1. **NestJS Module 组织方式** — `langgraph.module.ts` + service 的模式可直接复制
2. **ToolNode 统一注册** — journey-ai 的 `tools/index.ts` 模式优于 jisu-ai-customer 的分散注册
3. **MemorySaver** — langchain 的 `MemorySaver` 比 JSON 文件更适合生产
4. **Human-in-the-loop** — langchain 的邮件审批模式，未来可做 AI 回答人工审核

### 前端层面（从 ai-ops 学）

1. **RAG 知识库管理** — ai-ops 的文档分块编辑 + 命中率热力图可复用
2. **监控面板** — ai-ops 的 SSE 实时指标 + ECharts 图表
3. **Token 统计** — ai-ops 的用量统计 + CSV 导出

### 直接可复用的代码模式

```typescript
// 从 langchain 复用的 NestJS + LangGraph 模式
@Injectable()
export class AiCustomerService {
  private graph: CompiledStateGraph;

  onModuleInit() {
    this.graph = new StateGraph(Annotation.Root({...}))
      .addNode('intentRouter', intentRouterNode)
      .addNode('agent', orderAgentNode)
      .addConditionalEdges('intentRouter', routeByIntent, {...})
      .compile({ checkpointer: new MemorySaver() });
  }

  async chat(message: string, userId: string) {
    return this.graph.stream(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: userId } }
    );
  }
}
```

---

## 总结

| 项目 | 核心价值 | 对我们最有用的一点 |
|------|---------|-------------------|
| jisu-ai-customer | **LLM 应用架构蓝图** | 5 节点 StateGraph + 意图路由 |
| ai-annotation-platform | **复杂 UI 交互设计** | 任务状态机管理 |
| ai-ops-platform | **AI 产品运维工具** | RAG 知识库管理界面 |
| journey-ai | **LangGraph Agent 教学** | ToolNode + Zod 校验 |
| langchain | **NestJS + LangGraph 实战** | 10 种工作流模式 + 部署 |

