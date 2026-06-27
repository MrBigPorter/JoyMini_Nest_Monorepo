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
| 07 | 📦 LLM Factory 封装 | ✅ **统一 createLLM()，支持 Ollama/DeepSeek 切换** |
| — | **FieldMeta Phase 1** — 装饰器 + toLLM | ✅ **14 字段，已验证 Working** |
| — | **FieldMeta Phase 2** — Swagger 元数据注入 | ✅ **description + x-field-meta，验证通过** |
| — | **FieldMeta Phase 3** — 前端类型生成 | ✅ **2 文件 17 字段自动生成** |
| — | **FieldMeta classNameMap 优化** | ✅ **消除 DTO 注册表，零维护** |

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
| [`order-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/order-agent.node.ts) | stub + `createOrderAgentNode` 工厂 |
| [`order-tools.ts`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts) | `getUserOrders` + `getOrderInfo`（方案A: userId 在 Zod schema） |

**修改文件 (2):**
| 文件 | 变更 |
|------|------|
| [`customer.graph.ts`](apps/api/src/client/ai-customer/graph/customer.graph.ts) | 注册 `orderAgent` 节点 + 路由 |
| [`state.ts`](apps/api/src/client/ai-customer/graph/state.ts) | 新增 `userId` 字段 |

**生产就绪修复 (2026-06-27):**

| 优先级 | 问题 | 修复 |
|--------|------|------|
| **P0** | `lastCall` vs `lastToolCall` 变量名不匹配 → 运行时 ReferenceError | 统一命名为 `lastToolCall` |
| **P0** | 无 `maxIterations` 限制 → 工具无限循环 | 替换 `createAgent` 为手动 `llm.bindTools(tools)` + `while` 循环，`MAX_ITERATIONS = 3` |
| **P0** | `BizException` 通过工具传播 → HTTP 400 | 两个 tool 函数内加 try-catch，返回 JSON 错误字符串给 LLM |
| **P1** | Agent 节点无 try-catch 兜底 | 外层 `while` 循环加 try-catch，异常时返回 fallback 消息 |
| **P1** | systemPrompt 无错误处理指引 | 增加规则 #7：工具返回错误时指导 LLM 回应 |
| **P2** | 对话历史无限增长 | `state.messages.slice(-6)` 窗口限制 |
| **P2** | `console.log` / `console.error` | 替换为 `Logger` from `@nestjs/common` |

**关键架构决策:** `createAgent` (langchain) → 手动 Agent 循环
- `langchain` 包的 `createAgent` 类型定义不支持 `maxIterations`
- `@langchain/langgraph/prebuilt` 的 `createReactAgent` 已弃用
- 最终方案: `llm.bindTools(tools)` + `while` 循环，精确控制迭代次数

**验证结果:**
```bash
POST /api/v1/ai-customer/test-chat
{"message":"Show my orders"} → code: 10000 ✅
# debug.toolCalls: 1 (maxIterations 生效)
# 返回格式化订单详情表格
```

**清理工作:**
- 修复 tsconfig.json 的 `moduleResolution`（commonjs + paths 映射解决 `@langchain/langgraph/prebuilt` 导入问题）
- 清理 ~1113 个意外生成的 `.js`/`.d.ts` 文件
- 删除重复注释块（方案A注释重复了两遍）

### Doc 07 — 📦 LLM Factory 封装

**问题背景:** Graph 节点直接硬编码 `ChatOllama`（本地 `http://ollama:11434`），导致：
- 部署时 LLM 不可用（Ollama 未运行）→ 全系统瘫痪
- AiService（用 DeepSeek API）和 Graph（用 Ollama）用两套不同 Provider，响应慢（55s 含 AI 超时）
- 开发环境必须启动 Ollama Docker，本地调试成本高

**解决方案:** 创建 [`llm-factory.ts`](apps/api/src/client/ai-customer/graph/llm-factory.ts)，通过 `AI_LLM_PROVIDER=deepseek|ollama` 环境变量统一切换 Provider，所有 Graph 节点通过 `createLLM()` 获取 LLM 实例。

**新建文件 (1):**
| 文件 | 内容 |
|------|------|
| [`graph/llm-factory.ts`](apps/api/src/client/ai-customer/graph/llm-factory.ts) | `createLLM()` 工厂函数（`ChatOpenAI`/`ChatOllama` 二选一） |

**新增依赖:**
| 包名 | 版本 | 用途 |
|------|------|------|
| `@langchain/openai` | ^1.5.3 | DeepSeek API（OpenAI 兼容） |
| `langchain` | 1.5.2 | `createAgent`（已弃用 → 替换为手动 Agent 循环） |

**修改文件 (5):**
| 文件 | 变更 |
|------|------|
| [`intent-router.node.ts`](apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts) | 改用 `createLLM()` 替代 direct `ChatOllama` |
| [`order-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/order-agent.node.ts) | 改用 `createLLM()` + `createAgent` from `langchain`（`model`/`systemPrompt` 新 API） |
| [`general-chat.node.ts`](apps/api/src/client/ai-customer/graph/nodes/general-chat.node.ts) | 改用 `createLLM()` 替代 direct `ChatOllama` |
| [`answer-synthesizer.node.ts`](apps/api/src/client/ai-customer/graph/nodes/answer-synthesizer.node.ts) | 改用 `createLLM()` 替代 direct `ChatOllama` |
| [`apps/api/.env`](apps/api/.env) | 新增 `AI_LLM_PROVIDER=deepseek` |

**当前 Graph 节点流程:**
```
User Input → [intentRouter(createLLM)] → [orderAgent(createLLM+createAgent) / ragNode / generalChat(createLLM)] → [answerSynthesizer(createLLM)] → Response
```

所有节点统一通过 `createLLM()` 获取 LLM 实例，Provider 切换只需改 `.env` 一行配置。

### FieldMeta Phase 1 — 装饰器 + toLLM

**设计文档:** [`docs/AI-joymini/field-meta-architecture.md`](docs/AI-joymini/field-meta-architecture.md)

**核心文件:**
| 文件 | 操作 | 说明 |
|------|------|------|
| [`packages/shared/src/decorators/field-meta.ts`](packages/shared/src/decorators/field-meta.ts) | 新增 | `@FieldMeta` 装饰器 + WeakMap/classNameMap 双存储 |
| [`apps/api/src/common/ai/utils/to-llm.ts`](apps/api/src/common/ai/utils/to-llm.ts) | 新增 | `toLLM()` 通用 AI 序列化器 |
| [`apps/api/src/client/orders/dto/order-item.dto.ts`](apps/api/src/client/orders/dto/order-item.dto.ts) | 修改 | 14 字段加 `@FieldMeta` 装饰器 |
| [`apps/api/src/client/ai-customer/graph/tools/order-tools.ts`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts) | 修改 | 两个 tool 函数改用 `toLLM()` |

**验证结果:**
```bash
yarn workspace @lucky/api build        # ✅ 构建成功
# 调用 /test-chat 验证输出语义化数据  # ✅ Working
```

### FieldMeta Phase 2 — Swagger 元数据注入

**问题:** `@ApiProperty({ description: 'orderStatus' })` 只有字段名没有语义描述，Swagger UI 不可读。

**方案:** 创建 `applyFieldMetaToSwagger()` 纯函数，在 Swagger 导出时遍历 schema，通过 `classNameMetadata` 自动匹配 `@FieldMeta` 元数据，注入 `description` + `x-field-meta` OpenAPI Extension。

**新增/修改文件:**
| 文件 | 操作 | 说明 |
|------|------|------|
| [`apps/api/src/common/ai/utils/apply-field-meta.ts`](apps/api/src/common/ai/utils/apply-field-meta.ts) | 新增 | `applyFieldMetaToSwagger()` — 遍历 schema 注入 description + x-field-meta |
| [`apps/api/src/main.ts`](apps/api/src/main.ts) | 修改 | 在 createDocument 后调用 |
| [`apps/api/scripts/cli/export-swagger.ts`](apps/api/scripts/cli/export-swagger.ts) | 修改 | 导出时同样调用 |

**验证结果:**
```bash
cd apps/api && yarn export:swagger:full
# ✅ 14 个 x-field-meta 字段注入成功
# 示例: orderStatus.description = "订单状态 (1=待支付, 2=已支付...)"
```

### FieldMeta Phase 3 — 前端类型生成

**问题:** 前端需要手动复制 Swagger 类型，繁琐且易错。

**方案:** 创建 `gen-types.ts` CLI 脚本，读取 Phase 2 导出的 `swagger-spec.json`（含 `x-field-meta`），自动生成 TypeScript 类型文件到 `packages/shared/src/types/gen/`。

**新增/修改文件:**
| 文件 | 操作 | 说明 |
|------|------|------|
| [`apps/api/scripts/cli/gen-types.ts`](apps/api/scripts/cli/gen-types.ts) | 新增 | 从 swagger-spec.json 的 `x-field-meta` 生成 `.generated.ts` |
| [`apps/api/package.json`](apps/api/package.json) | 修改 | 添加 `gen-types` / `gen-types:full` script |
| [`packages/shared/src/types/gen/order-item-dto.generated.ts`](packages/shared/src/types/gen/order-item-dto.generated.ts) | 生成 | 14 字段自动生成 |

**验证结果:**
```bash
cd apps/api && yarn export:swagger:full && yarn gen-types
# ✅ 2 个文件，17 个字段
# ✅ order-item-dto.generated.ts: 14 fields
# ✅ treasure-d-to.generated.ts: 3 fields
```

### FieldMeta classNameMap 优化（消除注册表）

**问题:** 最初需要手动维护 `dto-registry.ts`（`DTO_MAP = new Map(...)`），每新增一个 DTO 都要手动注册。

**方案:** 在 `FieldMeta()` 装饰器中新增 `classNameMetadata` Map，通过 `target.constructor?.name` 自动按类名索引。Swagger/gen-types 通过 `getFieldMetasByClassName("OrderItemDto")` 直接查询，无需手动注册。

**修改文件:**
| 文件 | 操作 | 说明 |
|------|------|------|
| [`packages/shared/src/decorators/field-meta.ts`](packages/shared/src/decorators/field-meta.ts) | 增强 | 新增 `classNameMetadata` + 查询函数 |
| [`apps/api/src/common/ai/utils/apply-field-meta.ts`](apps/api/src/common/ai/utils/apply-field-meta.ts) | 简化 | 移除 `dtoMap` 参数 |
| [`apps/api/src/main.ts`](apps/api/src/main.ts) | 简化 | 移除 `DTO_MAP` import |
| [`apps/api/scripts/cli/export-swagger.ts`](apps/api/scripts/cli/export-swagger.ts) | 简化 | 移除 `DTO_MAP` import |
| [`apps/api/src/common/dto/dto-registry.ts`](apps/api/src/common/dto/dto-registry.ts) | **删除** | 不再需要 |

**当前工作流:** 开发者只需在 DTO 属性上加 `@FieldMeta()`，其余全部自动完成。

## 📖 经验总结（LLM Factory 封装）

### 问题根因
Graph 各节点直接硬编码 `ChatOllama`，和 `AiService`（DeepSeek）是两套独立的 AI 调用链路，导致：
1. **Ollama 不可用 → Graph 全挂**：上线后若 Ollama 未部署或资源不足，所有 Agent 节点直接报错
2. **响应延迟翻倍**：AiService 55s 超时等待 → Graph 再 55s → 用户等 110s
3. **开发环境负担重**：本地必须起 Ollama Docker，macOS 资源吃紧

### Factory Pattern 解决思路
```
┌─────────────────────────────────┐
│        createLLM(options)       │
│                                 │
│  AI_LLM_PROVIDER=deepseek ──────┤──→ ChatOpenAI (DeepSeek API)
│  AI_LLM_PROVIDER=ollama ────────┤──→ ChatOllama (local)
└─────────────────────────────────┘
```
- 6 个节点原来各自 `new ChatOllama(...)` → 全部改为 `createLLM({ temperature })`
- `.env` 一行 `AI_LLM_PROVIDER=deepseek` 即可切换 Provider
- 开发用 Ollama，生产用 DeepSeek，互不干扰

### createAgent API 迁移教训
`@langchain/langgraph/prebuilt` 的 `createReactAgent` 已被弃用，迁移到 `langchain` 包的 `createAgent`：

| 旧 API | 新 API |
|--------|--------|
| `import { createReactAgent } from '@langchain/langgraph/prebuilt'` | `import { createAgent } from 'langchain'` |
| 参数: `llm` | 参数: `model` |
| 参数: `messageModifier` / `prompt` | 参数: `systemPrompt` |

### 依赖安装教训
Monorepo 中安装 LangChain 相关包必须用 `yarn workspace`：
```bash
yarn workspace @lucky/api add @langchain/core @langchain/langgraph   # 核心
yarn workspace @lucky/api add @langchain/openai                      # 用于 DeepSeek
yarn workspace @lucky/api add langchain                              # 用于 createAgent (1.5.2)
```
⚠️ 注意：`@langchain/ollama` 的 `peerDependencies` 不自动安装 `@langchain/core` 和 `@langchain/langgraph`，需显式安装。
⚠️ `langchain` 包（~3.12 MiB）需手动安装，`createAgent` 不会通过其他包传递进来。

### VSCode 缓存陷阱
VSCode 可能显示不存在的文件路径（如 `graph/graph/llm-factory.ts`）——实际文件在 `graph/llm-factory.ts`。这是由于 VSCode TS 缓存 + 错误路径引用导致。用 `ls` 确认磁盘真实目录结构即可解决。

## 🎯 技术总结 & 面试准备

### 当前完成: OrderAgent 生产就绪

**Bug 修复 (7 项, P0-P2):** ✅ 全部完成并实测验证
**关键架构决策:** `createAgent` → 手动 `llm.bindTools(tools)` + `while` 循环
**验证:** POST /test-chat → code: 10000 ✅, debug.toolCalls: 1

### 面试 Q&A 文档

创建于 [`docs/study/interview-ai-agent-order-system.md`](docs/study/interview-ai-agent-order-system.md)

### 未来扩展方向

| 方向 | 说明 |
|------|------|
| Promise.all 并行 tool 调用 | 当 LLM 一次返回多个 tool_calls 时并行执行，降低延迟 |
| SSE 流式输出 | 把 Agent 思考过程（调用了什么工具、拿到了什么数据）流式推给前端 |
| 缓存策略 | 相同用户的订单列表短时缓存，减少 DB 查询 |
| 更多 Agent | walletAgent、couponAgent、userAgent 等已预留路由，待接入 |

## ⏳ 待开始

| # | 文档 | 内容 |
|---|------|------|
| 08-12 | 各 Agent 节点 | Wallet/Coupon/User/Product/RAG etc. |

## 🔧 基础设施

| 组件 | 状态 | 说明 |
|------|------|------|
| Ollama | Docker Compose 内运行 | qwen3.5:0.8b + mxbai-embed-large |
| Backend | http://ollama:11434 | Docker 内部网络通信 |
| CSRF | 非生产环境跳过 | NODE_ENV 环境门控 |
| tsconfig paths | `@langchain/langgraph/prebuilt` | paths 映射解决 exports subpath 问题 |
| LLM Factory | `AI_LLM_PROVIDER=deepseek\|ollama` | 通过 `.env` 一行配置切换 Provider |
| AI 依赖 | `@langchain/openai` + `langchain` | 新增包：DeepSeek API 兼容 + createAgent |
| **FieldMeta 元数据体系** | **✅ Phase 1/2/3 完成** | **WeakMap + classNameMap 双存储，自动注册，零维护** |
