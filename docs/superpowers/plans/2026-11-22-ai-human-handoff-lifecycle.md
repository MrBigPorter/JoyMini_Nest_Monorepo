# AI ↔ 人工交接生命周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI / 排队 / 人工 / 关闭四态收敛成一套可验证的交接状态机，并让切回 AI 不继承失败计数。

**Architecture:** 新增 `HandoffLifecycleService` 作为唯一状态写入口，用 CAS 更新 `Conversation` 并在 `aiMetadata` 写复位/留言/审计；cron 只调用它做 10/60 分钟自动回 AI；AI 回合开始消费 `handoffResetPending` 重置图状态。管理端与 Flutter 只读状态、不本地改写。

**Tech Stack:** NestJS + Prisma + Redis + Socket.IO + LangGraph；Next.js admin-next；Flutter。

**Spec:** [docs/superpowers/specs/2026-11-22-ai-human-handoff-lifecycle-design.md](../specs/2026-11-22-ai-human-handoff-lifecycle-design.md)

## Global Constraints

- **不新增数据库列/表**；状态与审计放 `Conversation.aiMetadata`，合并写，保留 `trafficSource`。
- 超时默认值：无人认领 **10 分钟**、坐席不活跃 **60 分钟**；`0` 表示关闭该项。
- `repeatCount` 阈值 **3**，只统计连续失败；成功、换 intent、转人工、回 AI 都清零。
- 只有客服/管理员能手动切回 AI；用户不能。
- 转人工前检查在线客服；无人在线时 `handlerId` 保持 null，走留言分支。
- 关闭后的 SUPPORT 会话收到新消息时同会话重开。
- 所有用户可见文案中文；Flutter 不硬编码英文 `Transferred to human agent`。
- 复用现有 `AWAITING_HUMAN`、`ConversationStatus`、`CHAT_EVENTS`、metrics、Socket.IO Redis adapter。
- 所有改动先写失败测试，再实现，再跑测试并提交。

## Review Focus

- 用户消息与客服认领/自动回 AI 竞态：消息不能被已经失去归属的 AI 回合消费。
- 自动回 AI 与客服认领同时发生：只能有一个状态转换成功。
- `handoffResetPending` 重复消费：重置只能执行一次，崩溃后可恢复。
- 在线检查异常：fail-open 不能变成“永远转人工”，fail-closed 不能把用户卡死。
- 关闭后重开：必须同时覆盖 HTTP 与 Socket 两个入口，并重新触发 AI。

---

### Task 1: 交接状态机与生命周期服务

**Files:**
- Create: `apps/api/src/common/chat/handoff/handoff-state.ts`
- Create: `apps/api/src/common/chat/handoff/handoff-lifecycle.service.ts`
- Create: `apps/api/src/common/chat/handoff/handoff.module.ts`
- Modify: `packages/shared/src/im/constants.ts`（新增 `AI_HANDOFF_RETURNED = 'ai_handoff_returned'`）
- Test: `apps/api/src/common/chat/handoff/handoff-lifecycle.service.spec.ts`

**Interfaces:**
- Produces:
  - `type HandoffState = 'AI_ACTIVE' | 'WAITING_HUMAN' | 'HUMAN_ACTIVE' | 'CLOSED'`
  - `deriveHandoffState(conv: { status: number; handlerId: string | null }): HandoffState`
  - `returnToAi(id: string, reason: 'waiting_timeout' | 'inactive_timeout' | 'admin_return' | 'closed_reopen', opts?: { actor?: string; now?: Date }): Promise<boolean>`
  - `sweepTimedOut(now?: Date): Promise<{ returned: Array<{ id: string; reason: string }>; skipped: number }>`
  - `reopenForUser(id: string): Promise<boolean>`

- [ ] **Step 1: 写失败测试**

```ts
it('waiting 超时：CAS 成功、清归属、写系统消息和 reset flag', async () => {
  // seed conversation status=1, handlerId='awaiting_human', transferredAt=now-11m
  const ok = await service.returnToAi(conv.id, 'waiting_timeout', { now });
  expect(ok).toBe(true);
  const after = await prisma.conversation.findUnique(...);
  expect(after.handlerId).toBeNull();
  expect(after.transferredAt).toBeNull();
  expect(after.aiMetadata.handoffResetPending).toMatchObject({ reason: 'waiting_timeout' });
});

it('认领后 sweep 不再释放', async () => { /* handlerId=adminId → sweepTimedOut 在 60 分钟内不返回 */ });
it('重复调用只写一条系统消息', async () => { /* 第二次 returnToAi 返回 false */ });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test -- --runInBand src/common/chat/handoff/handoff-lifecycle.service.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现服务**

`returnToAi` 用一条 `updateMany` CAS：

```ts
where: reason === 'waiting_timeout'
  ? {
      id, status: NORMAL, handlerId: AWAITING_HUMAN,
      // 旧数据可能没有 transferredAt，用 handlerAssignedAt 兜底
      OR: [
        { transferredAt: { lt: cutoff } },
        { transferredAt: null, handlerAssignedAt: { lt: cutoff } },
      ],
    }
  : { id, status: NORMAL, handlerId: { not: AWAITING_HUMAN }, handlerAssignedAt: { lt: cutoff } }
data: { handlerId: null, handlerAssignedAt: null, transferredAt: null, transferReason: null }
```

`count === 0` 直接返回 false。成功后在事务内：

- 合并 `aiMetadata.handoffResetPending = { at, reason }`、`handoffHistory` 追加一条（最多 10 条）
- `lastMsgSeqId+1`，创建系统消息（`type=MSG_TYPE_SYSTEM`）：「人工服务已结束，AI 继续为您服务。」
- 提交后 dispatch `MESSAGE_CREATED`、`AI_HANDOFF_RETURNED`、`SUPPORT_QUEUE_CHANGED('released')`

`reopenForUser` 用 CAS `{ id, status: ARCHIVED, type: SUPPORT }` 恢复 `status=NORMAL`、`handlerId=null`，写 reset flag 和系统消息「会话已重新打开，智能助手继续」。

新增 `HandoffModule`（imports `PrismaModule`，providers/exports `HandoffLifecycleService`），并在 `AiCustomerModule`、`AdminChatModule` 的 imports 中引入；`EventsGateway` 已全局导出，无需重复 import。

- [ ] **Step 4: 运行测试确认通过**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/common/chat/handoff
git commit -m "feat(chat): add handoff lifecycle state machine"
```

---

### Task 2: 在线客服 presence

**Files:**
- Modify: `apps/api/src/common/events/events.gateway.ts`
- Create: `apps/api/src/common/chat/handoff/handoff-presence.service.ts`
- Test: `apps/api/src/common/chat/handoff/handoff-presence.service.spec.ts`

**Interfaces:**
- Produces:
  - `EventsGateway.countOnlineAgents(): Promise<number>`
  - `HandoffPresenceService.isAnyAgentOnline(): Promise<{ online: boolean; degraded: boolean; count: number }>`

- [ ] **Step 1: 写失败测试**

```ts
it('adapter 正常时按 admin_online 房间计数', async () => { /* fetchSockets 返回 2 → online true, count 2 */ });
it('adapter 异常且 fail-open=true：online=true, degraded=true', async () => { /* 并断言计数指标 */ });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test -- --runInBand src/common/chat/handoff/handoff-presence.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

- `handleConnection` 在 `isAdmin` 时 `client.join('admin_online')`；disconnect 自动离开房间
- `countOnlineAgents` 用 `this.server.in('admin_online').fetchSockets()` 返回长度
- `HandoffPresenceService` 捕获异常，读 `HANDOFF_PRESENCE_FAIL_OPEN`（默认 true），异常时 `incCounter('handoff_presence_check_failed_total')`

- [ ] **Step 4: 运行测试确认通过**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/common/events/events.gateway.ts apps/api/src/common/chat/handoff
git commit -m "feat(chat): track online support agents"
```

---

### Task 3: 转人工入口接入在线检查与留言分支

**Files:**
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts`（routeTransfer）
- Modify: `apps/api/src/client/ai-customer/ai-failure-handler.ts`
- Test: `apps/api/src/client/ai-customer/ai-customer.transfer.spec.ts`

**Interfaces:**
- Consumes: `HandoffPresenceService.isAnyAgentOnline()`、`HandoffLifecycleService`
- Produces: `routeTransfer` 在线 → `awaiting_human`；离线 → `handlerId=null` + `aiMetadata.handoffCallback`

- [ ] **Step 1: 写失败测试**

```ts
it('无客服在线：不写 awaiting_human，写 callback 元数据与离线提示', async () => { ... });
it('有客服在线：保持现有 awaiting_human 与 SUPPORT_QUEUE_CHANGED', async () => { ... });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test -- --runInBand src/client/ai-customer/ai-customer.transfer.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

- 从 `HandoffPresenceService` 取在线状态；`HANDOFF_PRESENCE_CHECK_ENABLED=false` 时视为在线（兼容）
- 离线：`aiMetadata = { ...old, handoffCallback: { status:'pending', requestedAt, reason } }`，发固定提示，dispatch `AI_TRANSFER { mode:'offline', reason }`
- `degradeToHuman` 复用同一分支，并补发 `recordImplicit`（修现有漏项）

- [ ] **Step 4: 运行测试确认通过**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "feat(ai): check online agents before handoff"
```

---

### Task 4: 统一自动回 AI 调度

**Files:**
- Modify: `apps/api/src/admin/chat/support-queue.service.ts`
- Modify: `apps/api/src/admin/chat/admin-chat.service.ts`（reply 更新 `handlerAssignedAt`；switchHandler 走 CAS；列表返回 handoff 字段与 callback 过滤）
- Modify: `apps/api/src/common/chat/chat.service.ts`（删除 110-148 懒超时）
- Modify: `apps/api/src/common/events/events.gateway.ts`（删除用户消息刷新 `handlerAssignedAt`）
- Test: `apps/api/src/admin/chat/support-queue.service.spec.ts`

**Interfaces:**
- Consumes: `HandoffLifecycleService.sweepTimedOut`
- Produces: `SUPPORT_WAIT_TIMEOUT_MINUTES`（10）、`SUPPORT_IDLE_TIMEOUT_MINUTES`（60，默认变更）；`handlerAssignedAt` = 最后人工活动

- [ ] **Step 1: 写失败测试**

```ts
it('排队 10 分钟回 AI；已认领 60 分钟内不回收', async () => { ... });
it('env=0 时对应项关闭', async () => { ... });
it('客服回复会刷新 handlerAssignedAt，用户消息不刷新', async () => { ... });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test -- --runInBand src/admin/chat/support-queue.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

- `SupportQueueService` 每分钟（保留 Redis 锁 `cron:support-queue-sweep`）只调 `sweepTimedOut`；删除 `remindStaleQueue` 或保留为纯提醒（默认删）
- 删除 `chat.service.ts` 的 `HANDLER_TIMEOUT_MS` 懒释放块，以及 `events.gateway` 里用户消息刷新 `handlerAssignedAt` 的分支（HTTP 与 Socket 都只能由客服回复刷新）
- `admin-chat.replyToConversation` 发送成功后 `updateMany({ id, handlerId: adminId, status: NORMAL }, { handlerAssignedAt: now })`
- `switchHandler('ai')` 改为 `returnToAi(id, 'admin_return', { actor })`；`'human'` 从已认领状态调用时 no-op
- `admin-chat` 列表返回 `handoffState`（`deriveHandoffState`）、`handlerName`、`autoReturnAt`（waiting=transferredAt+waitTimeout，human=handlerAssignedAt+idleTimeout）；`queue=callback` 过滤 `aiMetadata.handoffCallback.status='pending'`

- [ ] **Step 4: 运行测试确认通过**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/admin/chat apps/api/src/common/chat/chat.service.ts
git commit -m "feat(chat): unify automatic return to AI"
```

---

### Task 5: AI 门禁、复位消费与关闭重开

**Files:**
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts`（chatStream 入口）
- Modify: `apps/api/src/client/ai-customer/ai-message.listener.ts`（图执行前）
- Modify: `apps/api/src/common/chat/chat.service.ts`、`apps/api/src/common/events/events.gateway.ts`（关闭重开）
- Test: `apps/api/src/client/ai-customer/ai-customer.handoff-gate.spec.ts`

**Interfaces:**
- Consumes: `HandoffLifecycleService.reopenForUser`
- Produces: `AiCustomerService.consumeHandoffReset(conversationId, threadId)`

- [ ] **Step 1: 写失败测试**

```ts
it('handlerId!=null：消息落库但不跑图、不写 trace', async () => { ... });
it('handoffResetPending：调用 updateState 清零 repeatCount 并清标记', async () => { ... });
it('status=ARCHIVED 的 SUPPORT 会话收到消息：先重开再跑 AI', async () => { ... });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test -- --runInBand src/client/ai-customer/ai-customer.handoff-gate.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

- `chatStream` 与 `AiMessageListener` 在跑图前查 `{status, handlerId, type, aiMetadata}`；`status!=NORMAL || handlerId!=null` 直接 `onDone()`，不写 trace
- 读到 `aiMetadata.handoffResetPending`：`compiledGraph.updateState(config, { repeatCount:0, previousIntent:'', intent:'', labels:[], pendingConfirm:null, transferToHuman:false, transferReason:'' })`，不清 messages；随后 `updateMany` 清标记（条件仍包含该标记，保证只消费一次）
- HTTP/Socket 写消息前，若 `status=ARCHIVED && type=SUPPORT` 调 `reopenForUser`

- [ ] **Step 4: 运行测试确认通过**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer apps/api/src/common/chat apps/api/src/common/events
git commit -m "feat(ai): consume handoff reset before graph runs"
```

---

### Task 6: 失败驱动的 repeatCount

**Files:**
- Create: `apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/turn-failure.ts`
- Modify: `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts`
- Modify: `apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/knowledge-fallback.ts`
- Modify: `apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/transfer-detector.ts`
- Test: `apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/turn-failure.spec.ts`

**Interfaces:**
- Produces:
  - `evaluateTurnFailure(input: { userInput: string; outputs: Array<{ content: string; success?: boolean; error?: string }>; ragSourceCount: number; hasAgentError: boolean }): { failed: boolean; reason: 'tool_error'|'refusal'|'no_evidence'|null }`
  - `isScopeRefusal(text: string): boolean`（从 knowledge-fallback 导出）

- [ ] **Step 1: 写失败测试**

```ts
it('工具失败优先：failed=true, reason=tool_error', ...);
it('全部输出为拒绝：reason=refusal', ...);
it('信息题、无 RAG、查不到：reason=no_evidence', ...);
it('正常回答：failed=false', ...);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test -- --runInBand src/client/ai-customer/graph/nodes/orchestrator-utils/turn-failure.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现并接入 orchestrator**

- `evaluateTurnFailure` 按 tool_error → refusal → no_evidence 优先级
- orchestrator 主 return 与所有 early return（转人工、澄清、LLM 失败）统一经过 `finalizeUpdate`：
  - `previousIntent: update.previousIntent ?? state.intent`
  - `repeatCount: turnFailed && state.intent === state.previousIntent ? (state.repeatCount ?? 0)+1 : 0`
  - 转人工分支强制 `repeatCount: 0`
- `transfer-detector` 保持 `repeatCount >= 3`，不再自己重新计算

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn workspace @lucky/api test -- --runInBand src/client/ai-customer/graph/nodes/orchestrator-utils`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer/graph/nodes
git commit -m "fix(ai): count repeated handoffs by failures only"
```

---

### Task 7: 管理端交接状态

**Files:**
- Modify: `apps/admin-next/src/components/customer-service/ChatWindow.tsx`
- Modify: `apps/admin-next/src/components/customer-service/ConversationItem.tsx`
- Modify: `apps/admin-next/src/api/index.ts`、`src/type/types.ts`、i18n
- Test: `apps/admin-next/src/__tests__/views/CustomerServiceDesk.test.tsx`

**Interfaces:**
- Consumes: `PATCH /v1/admin/chat/conversations/:id/handler {mode:'ai'|'human'}`
- Produces: 列表/详情展示 `AI / 待接入 / 客服名`；`queue=callback` 过滤

- [ ] **Step 1: 写失败测试**

```tsx
it('awaiting_human 显示「待接入」和等待时长', ...);
it('handlerId=admin 显示客服名与「切回 AI」', ...);
it('点击切回 AI 先弹确认，调用 API 后以返回结果刷新', ...);
it('callback 队列显示留言会话', ...);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/admin-next test -- CustomerServiceDesk`
Expected: FAIL

- [ ] **Step 3: 实现**

- 后端 `admin-chat` 列表返回 `handoffState/handlerName/autoReturnAt`（10/60 由后端算）
- 删除本地 `conversation.handlerId = 'me'` 直接赋值，统一 refetch/invalidate
- 新增确认弹窗；「切回 AI」只在 WAITING/HUMAN 显示
- 增加 `queue=callback` tab 与计数

- [ ] **Step 4: 运行测试确认通过**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/admin-next
git commit -m "feat(admin): show handoff state and return control"
```

---

### Task 8: Flutter 交接状态

**Files:**
- Modify: `packages/shared/src/im/constants.ts`
- Modify: `/Users/porter/Developer/JoyMini_Flutter_App/lib/core/constants/socket_events.dart`
- Modify: `/Users/porter/Developer/JoyMini_Flutter_App/lib/core/services/socket/socket_service.dart`
- Modify: `/Users/porter/Developer/JoyMini_Flutter_App/lib/ui/chat/handlers/chat_event_handler.dart`
- Modify: `/Users/porter/Developer/JoyMini_Flutter_App/lib/ui/chat/providers/chat_view_model.dart`、chat page banner
- Test: `test/providers/handoff_state_test.dart`

**Interfaces:**
- Consumes: `AI_TRANSFER { mode?: 'online'|'offline' }`、`AI_HANDOFF_RETURNED`
- Produces: 可见横幅状态与中文系统提示

- [ ] **Step 1: 写失败测试**

```dart
test('ai_transfer online -> banner 已转人工，输入仍可用');
test('ai_transfer offline -> banner 客服不在线，可留言');
test('ai_handoff_returned -> banner 清除，提示 AI 继续');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `flutter test test/providers/handoff_state_test.dart`
Expected: FAIL

- [ ] **Step 3: 实现**

- 共享常量加 `AI_HANDOFF_RETURNED`
- socket 分发加入新事件；handler 按 mode 设置 banner
- 列表快照文案改中文，不再出现 `Transferred to human agent`
- 不新增用户切回 AI 的入口

- [ ] **Step 4: 运行测试确认通过**

Run: `flutter test test/providers/handoff_state_test.dart`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib test
git commit -m "feat(chat): show human handoff and return state"
```

---

### Task 9: 可观测、文档与回归

**Files:**
- Modify: `apps/api/src/common/metrics/metrics.ts`
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts`（trace metadata）
- Test: metrics + trace specs

- [ ] **Step 1: 写失败测试**

```ts
it('转人工/回 AI 各递增对应指标', ...);
it('trace metadata 带 handoffState/handoffReason', ...);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test -- --runInBand src/common/metrics src/client/ai-customer`
Expected: FAIL

- [ ] **Step 3: 实现并更新文案**

- `handoff_escalations_total{reason,source}`、`handoff_returns_total{reason}`、`handoff_presence_check_failed_total`
- `emitStage('handoff', ...)`；trace metadata 增加 handoff 字段
- 更新 `docs/AI-joymini/115` 的交接章节，链接本次设计文档

- [ ] **Step 4: 运行全量验证**

```bash
yarn workspace @lucky/api test
yarn workspace @lucky/api tsc --noEmit --pretty
cd apps/admin-next && ../../node_modules/.bin/tsc --noEmit
cd /Users/porter/Developer/JoyMini_Flutter_App && dart analyze && flutter test
```

Expected: 全部通过（允许仓库中既有的 info 级 warning）

- [ ] **Step 5: 手工回归**

1. 触发转人工 → 管理端出现待接入
2. 10 分钟（可临时调小 env）无人认领 → 自动回 AI，系统消息出现
3. 认领后客服回复 → 计时刷新；60 分钟无回复 → 回 AI
4. 切回 AI 后立即问同意图 → 不转人工
5. 关闭会话后用户再发消息 → 同会话重开并走 AI
6. 停掉所有客服 socket → 转人工不进入队列，留言可见
7. Flutter 横幅/输入框/重进会话

- [ ] **Step 6: 提交**

```bash
git add apps/api apps/admin-next docs
git commit -m "feat(chat): complete handoff lifecycle observability"
```
