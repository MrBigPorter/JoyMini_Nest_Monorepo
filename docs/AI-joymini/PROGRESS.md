# AI JoyMini 项目进度

> 最后更新: 2026-07-16

---

## 🆕 最新交付 (2026-07-16)

### 后端

- **#76-77 AI Socket 统一** — 分析 Flutter 3 条发送路径（HTTP/SSE/Socket），统一方案：HTTP POST + Socket 推送 ✅
- **#78 Intent 配置化** — Admin 面板可直接管理 intent domain，无需改代码 ✅
- **#79 转人工 LLM 回复** — human_support 检测时 LLM 生成友好回复再转人工 ✅
- **#80 超时刷新修复** — Review 发现 handlerAssignedAt 不刷新 bug，已修复 ✅
- **handlerId + handlerAssignedAt** — Conversation 表新增，标记转人工状态 + 超时 ✅
- **handlerId 检查** — ChatService + EventsGateway 只 handlerId=null 时触发 AI ✅
- **10 分钟超时** — 每次发消息刷新 handlerAssignedAt，超时自动切回 AI ✅

### Flutter

- **SSE 废弃标记** — 15 个文件加 @deprecated 注释 ✅
- **ChatPage 统一** — 移除 useAiMode 分支，所有对话用 ChatViewModel ✅
- **AI streaming 状态** — ChatListState 加 isAiStreaming/currentAiToken ✅
- **ChatEventHandler streaming** — \_onAiEvent 推 token 到 ChatViewModel ✅

---

## 图例

| 图标 | 含义             |
| :--: | :--------------- |
|  ✅  | 代码已实现       |
|  ❌  | 代码未实现       |
|  ⛔  | 方案已废弃       |
|  ⚪  | 纯文档/分析/规划 |

---

## 所有文档状态

### AI 客服核心引擎

|   #    | 文档                           |  代码  | 说明                                       |
| :----: | :----------------------------- | :----: | :----------------------------------------- |
|   01   | AiService + Ollama             |   ✅   | `ai.service.ts` + `ollama.provider.ts`     |
|   02   | LangGraph 依赖                 |   ✅   | `package.json`                             |
|   03   | Module + GraphState            |   ✅   | `state.ts` 已重构为 8 字段                 |
|   04   | 9 Intent 路由                  |   ✅   | 重构为 `intent-router.node.ts`             |
|   05   | AnswerSynthesizer              |   ✅   | 合并到 `orchestrator.node.ts`              |
|   21   | IntentGateway                  |   ✅   | `customer.graph.ts:37`                     |
|   22   | WalletAgent 修复               |   ✅   | 4个问题全修                                |
|   23   | AgentReroute                   |   ⛔   | 已被 orchestrator 替代                     |
|   63   | Score Gap Check                |   ⛔   | 已被 #70 的 LLM 判断替代                   |
| **70** | **本地 Infinity + 多意图 LLM** | **✅** | **bge-m3 自建 + 拆融合 + LLM 反问/全执行** |
|   39   | 状态管理升级                   |   ✅   | `state.ts` 8字段 + flowState               |
|   40   | 上下文隔离                     |   ✅   | `flowState` + `topicSwitch`                |
| **76** | **Flutter-AI-Socket 统一分析** |   ✅   | 3 路径分析 + 废弃标记                      |
| **77** | **AI-Socket 统一实施**         |   ✅   | 4 Phase 实施                               |
| **78** | **Intent 配置化**              |   ✅   | Admin 管理 domain                          |
| **79** | **转人工 LLM 回复**            |   ✅   | orchestrator LLM 生成回复                  |
| **80** | **超时刷新 Bug 修复**          |   ✅   | 每次发消息刷新 handlerAssignedAt           |
| **81** | **确认卡片 + Callback 补全**   |   ⚪   | 文档阶段                                   |
| **82** | **AI 回复 IM 同步修复**       |   ✅   | 停 saveContext 写 chat_message + 数据清理  |
| **83** | **确认卡片详细设计**          |   ⚪   | 详细方案：流程/API/token/Flutter/工作量   |

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

|  #  | 文档              |                       代码                       |
| :-: | :---------------- | :----------------------------------------------: |
| 12  | 知识文档          |                   ✅ 29篇 .md                    |
| 13  | Prisma + pgvector |             ✅ `vector(1024)` bge-m3             |
| 17  | 完整RAG节点       |         ✅ orchestrator 4层检索+reranker         |
| 57  | RAG 基础设施升级  | ✅ Meilisearch + Infinity bge-m3 + Jina reranker |

### Admin 面板

|   #   | 文档           |              代码               |
| :---: | :------------- | :-----------------------------: |
| 52/53 | Prompt 管理    |     ✅ `AiPromptClient.tsx`     |
|  54   | PromptResolver | ✅ `prompt-resolver.service.ts` |
|  55   | IntentExamples |  ✅ `IntentExamplesClient.tsx`  |
|  56   | BullMQ         | ✅ `rag-embedding.processor.ts` |

### ⚪ 纯分析/规划文档

|   #   | 文档                                       |
| :---: | :----------------------------------------- |
|  21   | 数据层融合方案 Spec-Coding                 |
|  22   | 数据层融合实现步骤                         |
|  24   | Supervisor 架构总结                        |
|  29   | PromptInjection 三级防护                   |
| 33-38 | 挑战对标/运维/Prompt/RAG 分析              |
| 41-51 | Embedding/Agent spec/重构计划              |
| 72-75 | SSE 规范/客服架构/Flutter 评估/Socket 通道 |

---

## 按优先级排列的待办

| 优先级 | 功能                    | 文档 | 影响                | 工作量 |
| :----: | :---------------------- | :--: | :------------------ | :----: |
| 🟡 中  | PostgreSQL Checkpointer |  18  | 重启丢对话记忆      |  ~1天  |
| 🟡 中  | Flutter SSE 代码清理    | 76.5 | 删除已废弃 SSE 代码 |  ~1天  |
| 🟡 中  | Flutter 重建部署        |  -   | 切到 HTTP 路径      |  ~1天  |
| 🟢 低  | LLM 缓存                |  31  | 重复问题重算        |  ~1天  |
| 🟢 低  | 中文 human_support 示例 |  78  | Admin 面板添加      | ~0.5天 |
| 🟢 低  | ChatPage handlerId 判断 |  77  | 刷新后正确显示模式  | ~0.5天 |

---

## 统计

```
总文档数: 81
├─ ✅ 代码已实现: 50 (62%)
├─ ❌ 代码未实现: 12 (15%)
├─ ⛔ 方案废弃: 2 (2%)
└─ ⚪ 纯分析文档: 17 (21%)

AI 客服核心:     ████████████████████ 95%
转人工:         ██████████████████░░ 85%
Flutter 统一:   ████████████████░░░░ 70%
确认卡片:       ░░░░░░░░░░░░░░░░░░░░ 0%
持久化/缓存:    ░░░░░░░░░░░░░░░░░░░░ 0%
```
