# AI 回复 IM 同步修复与数据清理

## 问题

AI 回复写入 `chat_message` 表后出现：
1. **seqId 重复** — 同一条对话里多条消息共用相同 seqId
2. **消息重复** — 同一对话出现多条相同内容的记录
3. **isMe 错位** — 用户消息被标记为 `isMe=false`，显示在左侧
4. **sender=null** — AI 回复的 `senderId` 为空

## 根因

`ai-memory.service.ts` 的 `saveContext` 方法在保存 AI 对话上下文时，**同时写入了 IM 的 `chat_message` 表**：

```typescript
// ai-memory.service.ts:181 — 问题代码
await tx.chatMessage.createMany({ data: messageData });
```

其中：
- `senderId: null` — 导致 Flutter 无法判断发送者身份
- `type: mapRoleToChatType(role)` — human→0, ai→8（混入 IM 消息类型）
- `getNextSeqId()` — 独立递增 seqId，与 gateway 冲突

这导致**三个地方独立管理 seqId**：

| 来源 | 操作 | seqId |
|------|------|-------|
| gateway `handleSendMessage` | 用户消息 | increment ✅ |
| `saveContext` | AI 上下文 | 独立 increment ❌ |
| `ai-customer.service.ts` | AI 回复 | 独立 increment ❌ |

`saveContext` 的 `senderId: null` 写入后，Flutter 的 `ChatUiModelMapper.fromApiModel` 中 `apiMsg.sender?.id == currentUserId` 因 sender 为 null 而无法命中，导致 `isMe` 永远为 `false`。

## 修复

### 1. 停掉 saveContext 写 chat_message

`saveContext` 只缓存到 Redis（AI 热恢复用），不再写入 `chat_message` 表。IM 消息完整性由 gateway 和 AiCustomerService 负责。

**改动的文件**：`apps/api/src/common/ai/ai-memory.service.ts`

### 2. 清理数据库

```sql
-- 删除垃圾数据：type=8（旧 AI 格式）和 senderId 为空的记录
DELETE FROM "ChatMessage" WHERE type = 8 OR "senderId" IS NULL;

-- 重置 conversation 的 IM 字段
UPDATE "Conversation" 
SET "lastMsgSeqId" = 0, 
    "lastMsgContent" = '', 
    "lastMsgType" = 0;
```

**清理结果**：350 条垃圾数据被删除，3 个 conversation 重置。

### 3. Flutter 端恢复

`chat_event_handler.dart` 的 `aiDone` 恢复 `_saveAiMessage` 调用。

## 验证

- [x] 用户消息 seqId 正确，无重复
- [x] AI 回复 seqId 正确，无重复
- [x] 用户消息 `isMe=true`，显示在右侧
- [x] AI 回复 `isMe=false`，显示在左侧
- [x] 退出重进后位置不变
- [x] 增量同步不拉取垃圾数据
