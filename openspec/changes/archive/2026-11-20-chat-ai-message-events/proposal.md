# Proposal

## Why

AI 回复目前绕过 `MESSAGE_CREATED`：socket 实时投递靠手动双通道补上了，但离线用户的 FCM 推送、以及未来任何 `MESSAGE_CREATED` 消费者都看不到 AI 消息。同时消息没有可对外使用的 `isAi` 标记，Flutter 端无法区分 AI 与人工，违反 AI 披露要求（#85 P1-1/P1-2）。

## What Changes

- AI 消息落库继续使用 `role='assistant'`、`source='ai'`，对外统一暴露 `isAi`（历史接口 + socket payload）
- `publishAiReply` 落库后 emit 一次 `MESSAGE_CREATED`，删除直接 `dispatchToConversation`
- 事件补齐 `memberIds` / `pushMemberIds`（过滤 `isMuted`），离线 FCM 生效
- 写库事务同步更新 `Conversation.lastMsgContent/lastMsgType/lastMsgTime`
- Flutter 模型与气泡增加 `isAi` 标识，历史回放同样生效
- 重放命中 `P2002` 不再 emit；转人工告别语 emit 先于 `AI_TRANSFER`

## Capabilities

### New Capabilities

- `chat/message-events`: 消息创建后的统一事件契约——哪些消息走事件、事件带哪些字段、socket/FCM/历史接口如何保持一致。

### Modified Capabilities

（无）

## Impact

- 后端：`ai-reply-publisher.ts`、`chat.service.ts`、`common/chat/events/chat.events.ts`、`socket.listener.ts`、`push.listener.ts`
- Flutter：`conversation.dart`、`parse_step.dart`、`chat_ui_model.dart`、`chat_ui_model_mapper.dart`
- 不新增数据库列；`isAi` 由 `source === 'ai'` 派生
