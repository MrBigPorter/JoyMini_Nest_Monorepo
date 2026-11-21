# AI ↔ 人工会话交接生命周期 — 设计文档

> 日期: 2026-11-22
> 状态: Draft
> 关联: `docs/AI-joymini/115-AI-Operations-运营化设计.md`、`docs/superpowers/specs/2026-11-14-ai-agent-prd.md`
> 决策已确认：保留上下文+重置计数 / 10 分钟无人认领 / 60 分钟坐席不活跃 / 仅客服可手动切回 / 转人工前检查在线 / 无人在线留在 AI 并记录留言 / 关闭后同会话重开

---

## 1. 问题

现在的转人工是“单向且有状态残留”的：

- 转人工写入 `handlerId='awaiting_human'` 后，AI 门禁 `handlerId == null` 不再触发 AI
- `repeatCount` 按“同一 intent 连续”累加，不区分成功/失败，并存在图 checkpoint 里
- 手动切回 AI 只清 `handlerId/transferredAt`，**不重置 `repeatCount/previousIntent`**
- 于是切回后第一句同意图消息会立即再次 `repeated_attempts` 转人工，返回“无法查看，请联系人工”
- 自动回 AI 目前有两套不一致的实现：`SupportQueueService.sweepIdle`（已认领 10 分钟）和 `chat.service` 懒判定（任意 handler 10 分钟，含排队），都不重置图状态、不通知用户
- 人工对话不会进入图 `messages`，回 AI 后模型看到的是旧的失败上下文

## 2. 目标与非目标

**目标**

- 明确 AI / 排队 / 人工 / 关闭四态，以及每个转换的触发者
- 切回 AI 后不继承失败计数，但保留可读上下文
- 自动回 AI 有统一策略、可配置、可观测、幂等
- 没有客服在线时不把用户丢进空队列
- 关闭后同会话重开时走 AI，历史保留

**非目标**

- 不做客服排班/工时系统
- 不做用户主动“切回 AI”入口
- 不改变转人工的触发关键词/情绪规则本身
- 不引入新的工单平台

## 3. 当前实现地图

| 能力 | 位置 | 现状 |
|---|---|---|
| 会话归属字段 | `prisma/schema.prisma` Conversation | `handlerId` null/AWAITING/adminId；`handlerAssignedAt`、`transferredAt`、`transferReason`、`threadId`、`aiMetadata` |
| 进入人工 | `ai-customer.service.ts` routeTransfer；`ai-failure-handler.ts` | 写 awaiting_human；后者漏发队列事件 |
| AI 门禁 | `chat.service.ts`、`events.gateway.ts` | 仅 `handlerId == null` 触发 AI |
| 认领/回复/关闭/切换 | `support-handler.service.ts`、`admin-chat.service.ts` | 有 CAS 认领；切换只改 DB，不重置图 |
| 空闲回收 | `support-queue.service.ts` sweep | 已认领 10 分钟回收；只广播，不通知用户 |
| 懒超时 | `chat.service.ts` | 任意 handler 10 分钟释放，含排队；与 sweep 冲突 |
| 重复计数 | `graph/state.ts`、`orchestrator.node.ts`、`transfer-detector.ts` | 同 intent 累加；阈值 3；早期 return 不带 repeatCount |
| 图状态重置 | `rollbackConversationState` | 仅版本回滚使用 |

## 4. 状态机

| 状态 | 判定 | 谁能进入 | AI 是否接话 |
|---|---|---|---|
| `AI_ACTIVE` | `handlerId=null`，`status=NORMAL` | 初始、回 AI | 是 |
| `WAITING_HUMAN` | `handlerId='awaiting_human'` | AI 触发转人工、管理员切人工 | 否 |
| `HUMAN_ACTIVE` | `handlerId=<adminId>` | 客服认领/回复接管 | 否 |
| `CLOSED` | `status=ARCHIVED(2)` | 客服关闭 | 否；用户再发消息时重开 |

转换与责任人：

```
AI_ACTIVE --(明确要求 / 负面 / 连续失败 / agent_request / ai_error)--> WAITING_HUMAN
AI_ACTIVE --(管理员手动切人工)--> WAITING_HUMAN
WAITING_HUMAN --(客服认领/回复)--> HUMAN_ACTIVE
WAITING_HUMAN --(10 分钟无人认领 / 管理员切回 AI)--> AI_ACTIVE
HUMAN_ACTIVE --(60 分钟坐席无回复 / 管理员切回 AI)--> AI_ACTIVE
WAITING_HUMAN|HUMAN_ACTIVE --(客服关闭)--> CLOSED
CLOSED --(用户新消息)--> AI_ACTIVE（同会话重开、历史保留、状态重置）
```

所有转换由**一个 HandoffService** 写入；其他模块只调用它，不直接改 `handlerId`。

## 5. 设计决策

### D1. 统一交接服务

新增 `HandoffService`（`src/common/chat/handoff.service.ts` 或 admin/chat 下）：

- `toWaiting(conversationId, reason, actor)`：AI 触发时先做在线检查
- `claim(conversationId, adminId)`：复用现有 CAS
- `returnToAi(conversationId, reason)`：清 handler、写审计、重置 AI 状态、插系统消息
- `close(conversationId, adminId, reason)`
- `reopenForUser(conversationId)`：关闭后收到用户消息时恢复 NORMAL

`admin-chat.service.switchHandler`、`support-handler.releaseIfIdle`、`support-queue.sweep` 都改为调用它，避免三处各写一套。

### D2. 切回 AI 的复位

用户已确认：**保留最近上下文 + 重置失败计数**。

- 插入系统消息：「人工服务已结束，智能助手继续为您服务」
- 重置图状态：`repeatCount=0`、`previousIntent=''`、清 `transferToHuman/transferReason/pendingConfirm`
- 保留 `messages` 最近 N 轮（现有 context 窗口），但**不把人工消息塞进图**
- 清 `transferredAt/transferReason`；保留审计在 `aiMetadata.handoff` 或独立审计表

实现方式：交接服务在同一个事务里写 `aiMetadata.handoffResetPending = { at, reason }`，不直接跨模块调用图。下一次 AI 回合开始时，`AiCustomerService` 读到该标记，用 `compiledGraph.updateState` 重置 `repeatCount/previousIntent/intent/labels/pendingConfirm/transfer*`（保留 `messages`、`userMemory`、flow），然后清掉标记。这样：

- 不引入 admin → ai-customer 的模块依赖
- 进程崩溃后标记仍在，下一次消息可确定性恢复
- 多实例下由 DB 标记保证只消费一次

### D3. 失败驱动的 repeatCount

`turnFailed` 由确定性规则计算，不由模型判断：

- Agent 抛错 / 工具失败且无成功工具
- 所有 Agent 输出命中“拒绝/不在范围/建议人工”（复用 `shouldUseKnowledgeFallback` 的拒绝识别）
- 无 RAG、无工具数据，却回答“查不到/没有权限”

规则：

- `repeatCount = turnFailed ? repeatCount + 1 : 0`
- intent 变化、成功回答、转人工、回 AI 都清零
- 早期 return（转人工/澄清）必须显式带 `repeatCount`，不能沿用旧值
- 阈值保持 3

### D4. 统一的自动回 AI

替换现有两套超时，只保留一个 cron，可配置（0 = 关闭该项）：

```
# 规范名（推荐）
SUPPORT_WAIT_TIMEOUT_MINUTES=10   # WAITING_HUMAN 超时回 AI（0=关闭）
SUPPORT_IDLE_TIMEOUT_MINUTES=60   # HUMAN_ACTIVE 坐席不活跃超时回 AI（0=关闭）

# 兼容别名（优先级低于规范名，保留旧部署不漂移）
# SUPPORT_QUEUE_TIMEOUT_MINUTES / HANDOFF_NO_CLAIM_MINUTES → SUPPORT_WAIT_TIMEOUT_MINUTES
# HANDOFF_INACTIVE_MINUTES → SUPPORT_IDLE_TIMEOUT_MINUTES
```

- 坐席不活跃以**客服最后一条消息**为准，不是用户消息。复用 `handlerAssignedAt`，把它定义为“最后一次人工侧活动”：认领时写入、客服每次回复时更新；用户发消息不再刷新它
- cron 用 Redis 锁保证多实例只跑一次；每条转换在 CAS 条件里带上当前状态，避免和认领/关闭竞态
- 不新增 `lastAgentReplyAt` 列，避免 schema 变更；代价是 `handlerAssignedAt` 的语义从“分配时间”变为“最后人工活动”，需要在列表/提示文案里按这个口径解释
- 回 AI 前发系统消息：「人工客服暂时无法继续，智能助手已恢复」
- 删除 `chat.service.ts` 的懒 10 分钟释放，以及 `support-queue.sweepIdle` 的旧 10 分钟逻辑（合并进新服务）
- 保留排队超时“提醒客服”的能力，但不再由它改状态

### D5. 在线客服检查

- 管理员 socket 连接时加入 `admin_online` 房间；`EventsGateway.countOnlineAgents()` 用 `server.in('admin_online').fetchSockets()` 统计，Redis adapter 已启用，可跨实例
- `routeTransfer` / `degradeToHuman` 调 `HandoffPresenceService.isAnyAgentOnline()`
- adapter 异常时按 `HANDOFF_PRESENCE_FAIL_OPEN` 处理（默认 true，记 `handoff_presence_check_failed_total`）
- 无人在线：
  - 不转人工，`handlerId` 保持 null，AI 继续服务
  - 发一条固定提示：「人工客服暂时不在线，您可以先留言，我们会尽快联系您」
  - 在 `aiMetadata.handoffCallback = { status: 'pending', requestedAt, reason }` 记录；不新增表
  - 管理端会话列表增加 `queue=callback` 过滤，展示并处理这些会话；客服回复后清空 `handoffCallback`
- 离线分支不发 `SUPPORT_QUEUE_CHANGED` 的 awaiting 事件，改发 `reason='callback_pending'`

### D6. 关闭后重开

- 用户向 `status=ARCHIVED` 的 SUPPORT 会话发消息时，在写消息前调用 `HandoffLifecycleService.reopenForUser(conversationId)`
- 恢复 `status=NORMAL`、`handlerId=null`、清 `transferredAt/transferReason`，写 `aiMetadata.handoffResetPending`，插入系统消息「会话已重新打开，智能助手继续」
- 随后按正常 AI 流程处理这条消息；HTTP 与 Socket 两个入口都要接，不能只在其中一处

### D7. 管理端

- 会话列表显示：`AI / 待接入 / 客服名`，不再只区分 awaiting 与 truthy
- ChatWindow：AI 状态显示「切人工」，人工状态显示「切回 AI」；操作前二次确认
- 显示 `transferredAt` 起算的等待时长，以及当前坐席最后回复时间
- 新增「留言/待回电」筛选，读取 `aiMetadata.handoffCallback.status='pending'` 的会话
- 切换成功后以后端返回为准刷新，不再本地直接改 `handlerId='me'`

### D8. Flutter

- 新增共享事件 `AI_HANDOFF_RETURNED = 'ai_handoff_returned'`，与 `AI_TRANSFER` 同通道
- `ai_transfer`：
  - `mode='offline'` → 横幅「客服暂时不在线，可以先留言」
  - 正常转人工 → 横幅「已转人工，客服会尽快回复」；列表快照改中文
- `ai_handoff_returned` → 清除横幅/流式状态，提示「人工服务已结束，AI 继续」；系统消息也会落库，重进会话仍可见
- 用户仍可发送消息（消息落库，人工可见）；不提供用户切回 AI 的按钮
- 会话列表可显示「人工处理中」小标识（可选）

### D9. 可观测与评测

- 指标：`handoff_escalations_total{reason}`、`handoff_returns_total{reason}`、`handoff_queue_wait_seconds`、`handoff_agent_idle_seconds`、`handoff_false_escalation_total`（抽样）
- 审计：每次转换记录 `from/to/actor/reason/time`
- trace `metadata` 增加 `handoffState` 与 `handoffReason`
- 评测：追加“误转率”和“该转未转”样本，避免只看转人工率

## 6. 迁移与兼容

- **无 schema 变更**：复用 `handlerAssignedAt` 作为“最后人工活动”，`aiMetadata` 追加 `handoffResetPending / handoffCallback / handoffHistory`（合并写，不覆盖 `trafficSource`）
- 通知事件：新增 `AI_HANDOFF_RETURNED`；`AI_TRANSFER` 增加可选 `mode: 'online'|'offline'`
- 旧会话：`handlerAssignedAt` 缺失时按 `transferredAt` 兜底；`awaiting_human` 且无 `transferredAt` 的脏数据按 `handlerAssignedAt` 兜底
- 功能开关：`HANDOFF_AUTO_RETURN_ENABLED`（默认 false，灰度后开启）、`HANDOFF_PRESENCE_CHECK_ENABLED`（默认 true）、`HANDOFF_PRESENCE_FAIL_OPEN`（默认 true）；超时值 0 即关闭
- 上线顺序：后端状态机/新事件/precence shadow（开关关）→ 管理端 → Flutter → 打开自动回 AI → 打开在线检查

## 7. 测试矩阵

| 场景 | 期望 |
|---|---|
| 同一意图连续 3 次成功回答 | 不转人工 |
| 同一意图连续 3 次失败 | 转人工，reason=repeated_attempts |
| 转人工后手动切回 AI，再问同意图 | 不立刻转人工，repeatCount=0 |
| 排队 10 分钟无人认领 | 回 AI，系统消息可见，repeatCount=0 |
| 已认领 60 分钟坐席无回复 | 回 AI；用户最后发言不影响计时 |
| 坐席 59 分钟前刚回复 | 不回收 |
| 客服认领与超时同时发生 | CAS 只有一个成功，无双重状态 |
| 无客服在线时触发转人工 | 不转，AI 继续，留言可创建 |
| 关闭后用户再发消息 | 同会话重开，AI 接话 |
| 管理员切人工再切回 | 管理端状态与服务端一致 |
| Flutter 收到 ai_transfer / 自动回 AI | 横幅出现/消失，输入不被禁用 |

## 8. 风险

- **在线状态误判**：只看 socket 会把“挂着后台”的客服算在线；后续可加“接单中/离开”状态
- **自动回 AI 打断人工**：60 分钟是保守值；坐席刚回复就重置
- **历史上下文污染**：保留上下文可能让模型继续引用旧失败；通过重置计数 + 系统消息 + 后续可加摘要缓解
- **两套超时删除不彻底**：必须删掉 `chat.service` 懒释放，否则行为仍不一致
- **留言表合规**：只存用户主动提供的联系方式，展示时脱敏

## 9. 验证

- 单测：`transfer-detector`、`orchestrator` repeatCount、`HandoffService` 每个转换、CAS 竞态、在线检查
- 集成：模拟 10/60 分钟（可注入时钟），检查 DB/消息/事件/指标
- 手工：管理端切人工/切回、关闭重开、Flutter 横幅、无客服在线留言
- 回归：`yarn jest`、`tsc --noEmit`、`dart analyze`、`flutter test`

## 10. 参考做法（市场调研）

- PolyAI Retry with handoff：失败 3 次转人工，成功即清零
- Voiceflow Return to AI：人工会话真正结束后走单独返回分支，注入人工处理摘要
- Twilio AI-to-human handoff：交接前生成 3 行摘要，避免人工/机器人各自丢失上下文
- Zendesk / Intercom：人工接管后通常到会话关闭或明确交还才回 Bot，不用“处理中计时器”强行抢回
- Chatfuel / ONOXIA：坐席不活跃 30–60 分钟或无人认领 5 分钟回 AI，可配置

来源：
- https://docs.poly.ai/learn/recipes/retry-with-handoff
- https://www.voiceflow.com/docs/documentation/handoff/return-to-ai
- https://www.twilio.com/en-us/blog/insights/ai-to-human-handoff-context
- https://www.stacktie.com/blog/intercom-vs-zendesk
- https://chatfuel.com/docs/ai-features/how-to-automatically-return-chat-to-ai

## 11. 待确认（不阻塞设计）

- 「留言/待回电」入口放在人工客服侧栏还是 AI Ops，取决于运营习惯
- 在线状态是否需要“离开/勿扰”手动开关，建议二期
- `HANDOFF_PRESENCE_FAIL_OPEN` 在生产默认取 true 还是 false，需要上线前确认
