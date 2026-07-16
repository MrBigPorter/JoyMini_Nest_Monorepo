# Current Task — AI Chat 集成到现有 ChatPage + 数据融合

**目标**: 废弃独立的 AiChatPage，把 AI 聊天嵌入现有的聊天系统（对话列表 → ChatPage），并实现长期记忆持久化
**方案**: [`docs/AI-joymini/67-AI-Chat-ChatPage-Integration-Plan.md`](docs/AI-joymini/67-AI-Chat-ChatPage-Integration-Plan.md)
**数据融合**: [`docs/AI-joymini/68-IM-AI-Conversation-Data-Fusion.md`](docs/AI-joymini/68-IM-AI-Conversation-Data-Fusion.md)
**Flutter**: `/Users/porter/Developer/JoyMini_Flutter_App/`

---

## ✅ 已完成

| 模块 | 说明 | 位置 |
|------|------|------|
| 后端 SSE 接口 | POST `/api/v1/ai/customer/chat-stream` (token/step/done/error) | 已提交 `c8ffba45` |
| Redis 5 层限流 + 熔断 | SseRateLimiterService | Nest `apps/api/` |
| Score Gap Check | orchestrator MIN_SCORE=0.65 + SCORE_GAP=0.15 | Nest `apps/api/` |
| SseClient | Dio 流 + 行缓冲 + 4 种事件解析 | Flutter `core/services/ai/sse_client.dart` |
| AiChatState | 消息列表 + 打字机追加 + sessionId | Flutter `core/store/ai_chat/ai_chat_state.dart` |
| MessageType.ai(8) + card(9) | 枚举已加 | Flutter `chat_ui_model.dart` |
| **Prisma schema 扩展** | Conversation 加 threadId/aiTitle/aiMetadata | `apps/api/prisma/schema.prisma` |
| | ChatMessage 加 role/tokenCount/source | |
| | ConversationType 枚举加 AI | |
| **OrbStack → Colima** | 换用轻量 Docker 虚拟机 + 磁盘移 MySSD | `~/.colima/` → `/Volumes/MySSD/colima` |
| **Makefile 重构** | 按阶段分组、各容器独立开关、本地开发命令 | `Makefile` |
| **Claude Code Skills** | superpowers/jr-code-review/flutter-gen/frontend-design/excalidraw-diagram/skill-creator | `.claude/skills/` |
| **#70 本地 Infinity bge-m3** | 替换 Jina AI embedding → 自建服务器跑 bge-m3，reranker 保持 Jina | `infinity.provider.ts` + `compose.prod.yml` |
| **MIN_SCORE 0.65→0.5** | 对齐 IntentClassifier 阈值 | `orchestrator.node.ts` |
| **BM25+vector 拆开 + 多意图 LLM** | 去除融合/SCORE_GAP，多 domain 时 LLM 反问/全执行 | `intent-classifier.ts` + `orchestrator.node.ts` |
| **#71 Flutter SSE 总结** | 完整端到端总结文档 | `docs/AI-joymini/71-Flutter-SSE全链路打通与后端总结.md` |

## ❌ 待办（实施顺序 — 后端优先）

| 步 | 任务 | 层 | 文件 | 说明 |
|----|------|-----|------|------|
| 1 | **AiMemoryService 改造** | 后端 | `common/ai/ai-memory.service.ts` | 写 Conversation + ChatMessage，含原子 seqId |
| 2 | **SSE 接口传 userId** | 后端 | `client/ai-customer/` | done 事件后调 saveContext |
| 3 | AiChatViewModel 重构 | Flutter | `core/store/ai_chat/` | SessionService + SseStreamService 提取 |
| 4 | MessageRepository 加 AI 方法 | Flutter | `ui/chat/repository/message_repository.dart` | saveOrUpdateAiMessages / getAiMessages |
| 5 | ConversationList 注入 AI 条目 | Flutter | `ui/chat/providers/conversation_provider.dart` | build() 内加载 |
| 6 | AiMsgBubble + ChatBubble.ai 分支 | Flutter | `ui/chat/components/` | 打字机气泡 |
| 7 | ChatPage AI 模式 + 路由 | Flutter | `chat_room/chat_page.dart` + `app_router.dart` | 集成 |

## ⏸️ 延期

| 功能 | 原因 |
|------|------|
| Action Card | 用户说后面再做 |
| 转人工 | 非基础路径 |
| Markdown 渲染 | 纯文本可用 |
| PostgreSQL Checkpointer | LangGraph 状态持久化 |

## 关键路径

```
后端 Phase 1-2 → Flutter Phase 3-7 →
  1 (AiMemoryService) → 2 (SSE userId) → 3 (ViewModel) → 4 (Repo) → 5 (ConvList)
                                                              ↘ 6 (Bubble) → 7 (ChatPage)
```
