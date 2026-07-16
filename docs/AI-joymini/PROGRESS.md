# AI JoyMini 项目进度

> 最后更新: 2026-07-16
>
> ## 🆕 最新交付 (2026-07-16)
>
> - **#72 SSE 数据格式规范与工具名显示** — SSE 扁平化 + displayName + 意图 JSON 过滤 ✅
> - **#73 统一客服后端架构重设计** — 一个客服架构 spec：统一 SUPPORT 类型、AI 默认处理、SSE→Socket 转接 ✅
> - **#74 Flutter ChatPage AI 合并评估报告** — 13 场景 + 6 关键问题分析 ✅
> - **#75 AI 客服 Socket 统一消息通道** — 全走 Socket 架构：`/chat/message` → LangGraph → Socket `ai_token` ✅
>
> 后端:
> - `ChatService.sendMessage()` → SUPPORT 对话触发 AI (`AI_MESSAGE_REQUESTED`)
> - `AiCustomerService.chatStream()` dispatch `ai_token`/`ai_done` 到 Socket
> - `EventsGateway` 注入 + AI 事件常量 (`AI_TOKEN`/`AI_STEP`/`AI_DONE`/`AI_ERROR`/`AI_TRANSFER`)
>
> Flutter:
> - `SocketChatMixin` 加 `aiEventStream`
> - `ChatEventHandler` 订阅 AI 事件 + token 累积 + DB 持久化
> - `LocalDatabaseService.saveAiMessage()` 新增
> - `ChatPage` AI 模式使用统一 AppBar + `ModernChatInputBar`（移除"AI 智能客服"标签）
> - 对话列表去掉强制注入的 AI 条目
>

---

## 图例

| 图标 | 含义                         |
| :--: | :--------------------------- |
|  ✅  | 代码已实现                   |
|  ❌  | 代码未实现                   |
|  ⛔  | 方案已废弃                   |
|  ⚪  | 纯文档/分析/规划，不涉及代码 |

---

## 一、所有文档状态

### AI 客服核心引擎

|   #    | 文档                |  代码  | 说明                                                   |
| :----: | :------------------ | :----: | :----------------------------------------------------- |
|   01   | AiService + Ollama  |   ✅   | `ai.service.ts` + `ollama.provider.ts`                 |
|   02   | LangGraph 依赖      |   ✅   | `package.json`                                         |
|   03   | Module + GraphState |   ✅   | `state.ts` 已重构为 8 字段                             |
|   04   | 9 Intent 路由       |   ✅   | 重构为 `intent-router.node.ts`                         |
|   05   | AnswerSynthesizer   |   ✅   | 合并到 `orchestrator.node.ts`                          |
|   21   | IntentGateway       |   ✅   | `customer.graph.ts:37`                                 |
|   22   | WalletAgent 修复    |   ✅   | 4个问题全修                                            |
|   23   | AgentReroute        |   ⛔   | 已被 orchestrator 替代                                 |
| **63** | **Score Gap Check** |   ⛔   | **已被 #70 的 LLM 判断替代**                           |
| **70** | **本地 Infinity + 多意图 LLM** | **✅** | **bge-m3 自建 + 拆融合 + LLM 反问/全执行**            |
|   39   | 状态管理升级        |   ✅   | `state.ts` 8字段 + flowState                           |
|   40   | 上下文隔离          |   ✅   | `flowState` + `topicSwitch`                            |

### Agent + 工具

|  #   | 文档                | 代码 | 工具数 |
| :--: | :------------------ | :--: | :----: |
|  06  | Order Agent         |  ✅  |   2    |
|  07  | Wallet Agent        |  ✅  |   7    |
|  08  | Coupon Agent        |  ✅  |   4    |
|  09  | Product Agent       |  ✅  |   5    |
|  09  | UserAddress Agent   |  ✅  |   6    |
|  10  | Multi-Label Intent  |  ✅  |   -    |
|  10  | Product Group Agent |  ✅  | 已合并 |
|  11  | LuckyDraw Agent     |  ✅  |   7    |
| 11.5 | KYC Agent           |  ✅  |   2    |

### RAG 知识库

|  #  | 文档              |                  代码                   |
| :-: | :---------------- | :-------------------------------------: |
| 12  | 知识文档          |     ✅ 29篇 .md，功能已升级到4层RAG     |
| 13  | Prisma + pgvector |        ✅ `vector(1024)` bge-m3         |
| 17  | 完整RAG节点       | ✅ 在 orchestrator 中，4层检索+reranker |
| 57  | RAG 基础设施升级  |   ✅ Meilisearch + Infinity bge-m3 embedding + Jina reranker |

### Admin 面板

|   #   | 文档           |                    代码                    |
| :---: | :------------- | :----------------------------------------: |
| 52/53 | Prompt 管理    |          ✅ `AiPromptClient.tsx`           |
|  54   | PromptResolver |      ✅ `prompt-resolver.service.ts`       |
|  55   | IntentExamples |       ✅ `IntentExamplesClient.tsx`        |
|  56   | BullMQ         |      ✅ `rag-embedding.processor.ts`       |
|   -   | Knowledge CRUD | ✅ `KnowledgeBaseClient.tsx` + Reindex All |

### ⚪ 纯分析/规划文档（不涉及代码实现）

|   #   | 文档                        |
| :---: | :-------------------------- |
|  21   | 数据层融合方案 Spec-Coding  |
|  22   | 数据层融合实现步骤          |
|  24   | Supervisor 架构总结         |
|  29   | PromptInjection 三级防护    |
|  33   | 16 工作流挑战对标           |
|  34   | 13 对话式挑战对标           |
|  35   | 19 通用型挑战对标           |
|  36   | 企业级运维规划              |
|  37   | Prompt 架构分析             |
|  37   | RAG 升级计划                |
|  38   | Agent 风险分析              |
|  38   | RAG 企业级实施              |
|  41   | Embedding 意图分类          |
|  42   | 企业架构路线图              |
|  42   | Agent 上线检查清单          |
|  43   | bge-m3 集成与排查           |
|  44   | Lucky Agent spec            |
|  45   | KYC Agent spec              |
| 46-51 | Agent 重构 + Embedding 计划 |
| **72** | **SSE 数据格式规范与工具名显示** |
| **73** | **统一客服后端架构重设计** |
| **74** | **Flutter ChatPage AI 合并评估报告** |
| **75** | **AI 客服 Socket 统一消息通道架构** |

---

### ✅ 代码已实现（文档#14、#15、#16 已完成）

|   #    | 文档                        | 领域       | 代码证据                              |
| :----: | :-------------------------- | :--------- | :------------------------------------ |
| **14** | **SSE 流式接口**            | **核心**   | 后端已提交 `c8ffba45` + Flutter SseClient + Page |
|   15   | Flutter Chat 页面           | Flutter    | `app/page/ai_chat/ai_chat_page.dart`  |
|   16   | Flutter Chat Client         | Flutter    | `core/services/ai/sse_client.dart`    |

### ❌ 代码未实现（14篇）

|   #    | 文档                        | 领域       | 代码证据                              |
| :----: | :-------------------------- | :--------- | :------------------------------------ |
| **18** | **PostgreSQL Checkpointer** | **持久化** | 只用 `MemorySaver`（内存）            |
|   19   | MultiAgentSupervisor        | ⛔ 废弃    | Supervisor LLM 幻觉，方案放弃         |
|   20   | Flutter 人工融合            | Flutter    | 无 Flutter                            |
|   23   | ProductReview 模型          | Review     | `search_files: 0 results`             |
|   24   | ProductReview API           | Review     | `search_files: 0 results`             |
|   25   | AI 审核管线                 | Review     | `search_files: 0 results`             |
|   26   | Admin 审核面板              | Review     | `search_files: 0 results`             |
|   27   | Flutter 评论 UI             | Flutter    | 无 Flutter                            |
|   28   | 评论分析统计                | Review     | `search_files: 0 results`             |
| **30** | **长期记忆持久化**          | **记忆**   | `search_files: 0 results`             |
| **31** | **LLM 结果缓存**            | **优化**   | `search_files: 0 results`             |
| **32** | **动态模型选择**            | **优化**   | `search_files: 0 results`             |
|   33   | AI 测试智能体               | 测试       | `search_files: 0 results`             |

---

## 二、按优先级排列的待办

|  优先级   | 功能                    |    文档     | 影响             |    工作量     |
| :-------: | :---------------------- | :---------: | :--------------- | :-----------: |
|   🔴 高   | **SSE 流式接口**        |     14      | 代码写完待联调   |     ~1天      |
|   🟡 中   | PostgreSQL Checkpointer |     18      | 重启丢对话记忆   |     ~1天      |
|   🟡 中   | 端到端测试              |     无      | 缺质量保障       |     ~2天      |
|   🟢 低   | LLM 缓存                |     31      | 重复问题重算     |     ~1天      |
|   🟢 低   | 意图例句微调            |     无      | 偶尔误分类       |    ~0.5天     |
|   🟢 低   | Score Gap Check         |     63      | 多标签无差别执行 | ✅ **已完成** |
|   🟢 低   | Flutter SSE 基础集成    |   15,16     | SSE 打字机聊天   | ✅ **已完成** |
| ⚫ 不计划 | Product Review          |    23-28    | 独立产品线       |       -       |

---

## 三、统计

```
总文档数: 65
├─ ✅ 代码已实现: 44 (68%)
├─ ❌ 代码未实现: 14 (22%)
│   ├─ PostgreSQL Checkpointer: 1
│   ├─ Product Review: 6
│   ├─ 持久化/缓存: 4
│   └─ 测试/废弃: 3
├─ ⛔ 方案废弃: 2 (3%)
└─ ⚪ 纯分析文档: 19 (不涉及代码)

核心对话 + RAG:        ████████████████████ 95%
Admin 管理:            ██████████████████░░ 90%
SSE 流式:              ████████████████████ 95%（后端+Flutter 基础流打通 ✅）
持久化/缓存:           ░░░░░░░░░░░░░░░░░░░░ 0%
```
