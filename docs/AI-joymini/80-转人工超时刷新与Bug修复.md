# 转人工超时刷新与 Bug 修复

## Review 发现的问题

### 🔴 Bug 1: 超时时间不刷新

`chat.service.ts` 的 `HANDLER_TIMEOUT_MS` 检测的是 `handlerAssignedAt`（转人工时间），不是"最后一次活动时间"。如果用户持续聊天超过 10 分钟，即使一直在说话，也会被切回 AI。

**修复**: 每次发消息时刷新 `handlerAssignedAt`。

### 🔴 Bug 2: EventsGateway 没刷新 handlerAssignedAt

`events.gateway.ts` 的 Socket 消息路径也没刷新 `handlerAssignedAt`。

### ⚠️ 注意: admin 回复触发 AI 路由

`ChatService.sendMessage()` 的 handlerId 检查能拦住 AI 触发，但 admin 回复时也应该特殊跳过。

## 修复方案

在 `chat.service.ts` 的超时检测逻辑中增加刷新：

- 超时 → 重置 handlerId = null（走 AI）
- 未超时且 handlerId != null → 刷新 handlerAssignedAt（延长计时）

同样改动复制到 `events.gateway.ts`。
