# AI Socket 统一实施提案

> 基于前序分析: [76-Flutter-AI-Socket统一分析报告](76-Flutter-AI-Socket统一分析报告.md)
> 日期: 2026-07-16

---

## 架构目标

```text
Flutter 发消息 ──→ HTTP POST /api/v1/chat/message（全部统一）
                      │
                  后端落库 + 触发 AI
                      │
               ┌──────┴──────┐
               │              │
          Socket 推送       AI 处理
        chat_message      AiCustomerService
               │              │
               │         Socket 推送
               │        ai_token / ai_done
               │              │
               └──────┬──────┘
                      │
               Flutter 收消息（全部走 Socket）
```

## 实施步骤

### Phase 1: 后端 — 修复转人工死循环（handlerId）

**问题**: `ChatService.sendMessage()` 无条件触发 AI，转人工后用户发消息 AI 会抢答。

**修复**: Conversation 表加 `handlerId` 字段，标记当前处理者。

| #   | 文件                                            | 改动                                                             |
| --- | ----------------------------------------------- | ---------------------------------------------------------------- |
| 1   | `prisma/schema.prisma`                          | Conversation 加 `handlerId String?`，`aiAssignedAt DateTime?`    |
| 2   | `prisma/migrations/`                            | 生成迁移文件                                                     |
| 3   | `common/chat/chat.service.ts:189`               | 加判断: `handlerId === null` 才触发 AI                           |
| 4   | `client/ai-customer/ai-customer.service.ts:232` | transfer 时把 conversation 的 handlerId 设为 `null`（=等待人工） |
| 5   | `events/events.gateway.ts:405`                  | 同步加 handlerId 判断                                            |

### Phase 2: Flutter — ChatPage 去掉 useAiMode 分支

**问题**: ChatPage 有两条独立路径（AI 走 SSE，IM 走 HTTP+Socket）。

**修复**: 所有对话统一用 `ChatViewModel`，AI 消息通过 Socket `ai_token`/`ai_done` 推送。

| #   | 文件                      | 改动                                                                               |
| --- | ------------------------- | ---------------------------------------------------------------------------------- |
| 6   | `chat_page.dart`          | 移除 `useAiMode` 分支，统一走 `ChatViewModel` + `ChatEventHandler`                 |
| 7   | `chat_page_widgets.dart`  | 删除 AI 专用组件（`_buildAiAppBar`, `_buildAiThinkingBubble`, `_buildAiErrorBar`） |
| 8   | `chat_view_model.dart`    | 加 `isAiStreaming`, `currentAiToken`, `aiStatusText` streaming 状态                |
| 9   | `chat_event_handler.dart` | `_onAiEvent()` 累积 token 时回调 `ChatViewModel` 更新 UI                           |
| 10  | `chat_bubble.dart`        | 加 AI streaming 打字机效果气泡                                                     |

### Phase 3: Flutter — 删除 SSE 独立路径

| #   | 文件                  | 改动                                                 |
| --- | --------------------- | ---------------------------------------------------- |
| 11  | `core/store/ai_chat/` | 删除 `ai_chat_state.dart`、`ai_chat_view_model.dart` |
| 12  | `core/services/ai/`   | 删除所有 SSE client 代码                             |
| 13  | `app_router.dart`     | 删除 `/ai/chat` 路由                                 |

### Phase 4: 转人工按钮改为 HTTP（可选）

| #   | 文件                 | 改动                                                            |
| --- | -------------------- | --------------------------------------------------------------- |
| 14  | `chat_page.dart:226` | 从 `socketService.sendMessage()` 改为 HTTP `POST /chat/message` |

---

## 验收标准

1. SUPPORT 对话用户发消息 → AI 通过 Socket `ai_token` 逐字回复（打字机效果）
2. 转人工后 → 用户发消息不再触发 AI，走 Socket `chat_message` 人工回复
3. 群聊/私聊功能不受影响
4. SSE 客户端代码删除后 Blog 前端 SSE 不受影响
5. 重连后 AI 流能继续
