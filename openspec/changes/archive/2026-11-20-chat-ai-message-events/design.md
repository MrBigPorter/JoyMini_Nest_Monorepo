# Design

## Context

事实见 `proposal.md`。关键调用链：

- `chat.service.ts` / `events.gateway.ts` 写消息后 emit `MESSAGE_CREATED`，SocketListener 负责房间 + 私有房间，PushListener 负责 FCM。
- `publishAiReply` 写库后直接 `dispatchToConversation(CHAT_MESSAGE)`，没有 emitter。
- `MessageCreatedEvent` 没有 `isAi/role/source`；`getMessages` 与 socket payload 也没有。
- Flutter 的 `SocketMessage`/`ChatMessage`/`ChatUiModel` 没有 `isAi`。

## Goals / Non-Goals

**Goals:** AI 消息可识别、走统一事件、FCM 可用、历史与实时一致。

**Non-Goals:** 不新增 `isAi` 数据库列；不解决 bot 冒用真人 senderId；不改管理员关闭会话消息的旁路。

## Decisions

### D1. `isAi` 由 `source` 派生，不新增列

持久化已有 `source='ai'`。历史接口与 socket payload 用 `source === 'ai'` 计算 `isAi`，避免迁移和回填。`MessageCreatedEvent` 末尾加可选 `isAi`，既有 emit 点不受影响。

### D2. 只保留事件路径

`publishAiReply` 注入 `EventEmitter2`，落库成功后 emit 一次；删除直接 `dispatchToConversation`。SocketListener 继续负责房间 + 私有房间，避免重复投递。不要照抄 WebSocket 路径“直接 dispatch + emit”的双发先例。

### D3. 推送名单在 publisher 查询

publisher 需要 `memberIds` 与 `pushMemberIds`（过滤 `isMuted`）。调用方当前只传 `userId/memberIds`；在 publisher 内查一次 `ChatMember` 比改 3 个调用方签名更稳。失败退化为仅提问者，不阻断消息。

### D4. 事务内补会话快照

写 AI 回复的同一事务更新 `lastMsgSeqId`、`lastMsgContent`、`lastMsgType`、`lastMsgTime`，否则会话列表仍停留在用户消息。

### D5. Flutter 只加模型与展示

`SocketMessage`/`ChatMessage`/`ChatUiModel` 增加 `isAi`（默认 false），解析层与 mapper 透传；气泡显示 AI 标识。不改消息排序/未读逻辑。

## Risks / Trade-offs

- **[重复广播]** → 删除直接 dispatch，测试断言只 emit 一次。
- **[事件晚于 AI_TRANSFER]** → EventEmitter2 默认同步派发；转人工路径保持先 emit 再派发 transfer。
- **[P2002 重放]** → 冲突分支直接 return，不 emit。
- **[离线推送噪音]** → PushListener 只排除 senderId；bot 发送者不是用户，提问者可能收到自己的 AI 回复推送。先保持与普通消息一致，后续再加前台判断。
- **[Flutter 兼容]** → `isAi` 默认 false，旧服务端缺字段时不崩。
