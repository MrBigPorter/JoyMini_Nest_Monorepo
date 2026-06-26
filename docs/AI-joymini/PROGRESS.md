# AI 客服项目 — 进度

> 项目文档: `docs/AI-joymini/` 系列
> 知识图谱: 搜索 `AI客服项目-当前进度`

## ✅ 已完成

| # | 文档 | 状态 |
|---|------|------|
| 01 | AiService + Ollama 集成 | ✅ 含故障排查 |
| 02 | LangGraph 依赖安装 | ✅ |
| 03 | AiCustomerModule + GraphState | ✅ |
| 04 | 9 Intent 路由节点 | ✅ **API 验证通过** |
| 05 | AnswerSynthesizer + Graph 组装 | ✅ **6 个文件已创建** |
| 06 | orderAgent (ReAct Agent) | ✅ **3 文件新建 + 2 文件修改** |

### Doc 04 验证

```bash
POST /api/v1/ai-customer/test-intent
{"message":"I want to check my order status"} → {"intent":"order"}  # 9/9 正确
```

### Doc 05 创建的文件

```bash
apps/api/src/client/ai-customer/
├── graph/
│   ├── state.ts                          # +agentOutput + userId 字段
│   ├── customer.graph.ts                 # StateGraph 组装
│   └── nodes/
│       ├── answer-synthesizer.node.ts    # 3 种情况合成
│       ├── general-chat.node.ts          # 闲聊节点
│       └── rag.node.ts                   # 知识库 Phase 1 占位
├── ai-customer.service.ts                # +OnModuleInit 启动编译
└── ai-customer.module.ts                 # Provider 注册
```

### Doc 06 — orderAgent (ReAct Agent)

**新建文件 (3):**
| 文件 | 内容 |
|------|------|
| [`order-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/order-agent.node.ts) | stub + `createOrderAgentNode` 工厂（`createAgent` from `langchain`） |
| [`order-tools.ts`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts) | `getUserOrders` + `getOrderInfo`（方案A: userId 在 Zod schema） |

**修改文件 (2):**
| 文件 | 变更 |
|------|------|
| [`customer.graph.ts`](apps/api/src/client/ai-customer/graph/customer.graph.ts) | 注册 `orderAgent` 节点 + 路由 |
| [`state.ts`](apps/api/src/client/ai-customer/graph/state.ts) | 新增 `userId` 字段 |

**当前 Graph 节点流程:**
```
User Input → [intentRouter] → [orderAgent / ragNode / generalChat] → [answerSynthesizer] → Response
```

**清理工作:**
- 修复 tsconfig.json 的 `moduleResolution`（commonjs + paths 映射解决 `@langchain/langgraph/prebuilt` 导入问题）
- 清理 ~1113 个意外生成的 `.js`/`.d.ts` 文件

## ⏳ 待开始

| # | 文档 | 内容 |
|---|------|------|
| 07-12 | 各 Agent 节点 | Wallet/Coupon/User/Product/RAG etc. |

## 🔧 基础设施

| 组件 | 状态 | 说明 |
|------|------|------|
| Ollama | Docker Compose 内运行 | qwen3.5:0.8b + mxbai-embed-large |
| Backend | http://ollama:11434 | Docker 内部网络通信 |
| CSRF | 非生产环境跳过 | NODE_ENV 环境门控 |
| tsconfig paths | `@langchain/langgraph/prebuilt` | paths 映射解决 exports subpath 问题 |
