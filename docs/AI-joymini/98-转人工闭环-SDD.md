# 98 · 转人工闭环（T2-5 / N-13、N-14）

> 状态: 📋 规格已定，待实施
> 日期: 2026-11-13
> 关联: [#85 N-13 / N-14](./85-生产化差距审计与企业上线清单.md)、[`current-task.md`](../current-task.md) T2-5
> 前置阅读: [#89 可观测性 SDD](./89-AI对话可观测性-SDD.md)（`chat.done` 已记 `transferred`）

---

## 0. 一句话

AI 对用户说「已为您转接人工」之后，**系统里没有任何人知道这件事发生了**：
客服端收不到通知、列表里看不出谁在等、没人认领、用户沉默时永远卡在 `awaiting_human`。

修法不是「多发一个事件」，而是把转人工从一个**一次性事件**，
升级成一条**有状态、有记录、有人负责、会超时**的工单。

---

## 1. 现在发生了什么（逐条核过代码）

| # | 环节 | 代码 | 结果 |
|:--:|---|---|---|
| 1 | 用户触发转人工 | `ai-customer.service.ts:373` 读 `transferToHuman` | ✅ 判定正确 |
| 2 | 标记待接入 | `ai-customer.service.ts:448-451` 置 `handlerId='awaiting_human'` | ✅ 状态写进去了 |
| 3 | AI 告别语落库 | `ai-customer.service.ts:456-471` `publishAiReply` | ✅ 用户看得到 |
| 4 | 广播 `AI_TRANSFER` | `ai-customer.service.ts:473-481` → `dispatchToConversation` | ⚠️ 只发给**会话成员**（`events.gateway.ts:232-256`）。客服不是成员 → **收不到** |
| 5 | 客服列表 | `admin-chat.service.ts:41-44` 默认查 `SUPPORT` | ⚠️ 没有 `handlerId` 过滤，**看不出谁在等** |
| 6 | 客服进入会话 | `useChatSocket.ts:195` emit `join_chat` | ❌ **T1-4 门禁拒绝**（`events.gateway.ts:326-333`）—— 见 §2 G6 |
| 7 | 客服回复 | `admin-chat.service.ts:181-188` 走 bot 成员 | ⚠️ 只刷新 `handlerAssignedAt`（`chat.service.ts:125-129`），**不认领** |
| 8 | 超时回收 | `chat.service.ts:103-137`、`events.gateway.ts:519-549` | ❌ **懒判定**：只有用户再发消息才检查。用户沉默 = 永久卡住 |
| 9 | 关闭会话 | `admin-chat.service.ts:251-313` | ❌ 置 `CLOSED` 但**不清 `handlerId`** |
| 10 | 转人工记录 | — | ❌ 原因只存在于 socket 事件里，**没有任何持久化** |

**结论**：链路在「AI 决定转人工」和「客服真的接上」之间**断开了**。断点不在 AI 侧，在客服侧。

---

## 2. 缺口清单

| ID | 缺口 | 影响 | 对应 AC |
|:--:|---|---|:--:|
| **G1** | 转人工无实时通知 | 客服不刷新就永远不知道有人等 | AC-1 |
| **G2** | 列表无「待接入」视图/过滤 | 几十条会话里靠肉眼找 | AC-1 |
| **G3** | 无「认领」动作 | 两个客服可能同时回同一个用户；也不知道谁负责 | AC-2 |
| **G4** | 超时只在用户发消息时判定 | 用户沉默 → 会话永久停在 `awaiting_human`，AI 也救不回来 | AC-4 |
| **G5** | 无转人工记录 | 无法统计「转人工率 / 平均响应时长 / 无人接听率」 | AC-5 |
| **G6** | **T1-4 回归**：客服 `join_chat` 被拒 | 客服打开的会话**收不到实时消息**，只能靠轮询 | AC-6 |
| **G7** | 关闭不清 `handlerId` | 统计不变式被破坏：已关闭会话仍算「人工处理中」 | AC-7 |
| **G8** | 客服回复后状态不变 | 回复完仍是 `awaiting_human`，别人还能来抢 | AC-2 |
| **G9** | 无未读/红点/提示音 | 客服切到别的页面就漏单 | AC-1 |

> **G6 是本次审计新发现的**，不在 #85 台账里。#85 写于 T1-4 之前，T1-4 的成员校验把客服端一起挡在了门外。
> 这不是 T1-4 做错了 —— 那条修法是对的（普通用户不该乱进别人会话），**是客服端从来没有一条合法入口**，T1-4 只是把它暴露出来。

---

## 3. 目标与非目标

### 3.1 目标（全部可测）

| AC | 标准 | 验证方式 |
|:--:|---|---|
| AC-1 | 用户触发转人工后 **≤2s**，所有在线客服的「待接入」列表出现该会话，**无需刷新** | E2E 脚本 + 双浏览器 |
| AC-2 | 客服 A 点「认领」后 **≤1s**，客服 B 的列表移除该会话；客服 B 再点认领返回 **409** | 单测（CAS）+ 手工双开 |
| AC-3 | 待接入超过 `QUEUE_TIMEOUT_MS`（默认 10min）无人认领 → 记 `warn` 日志 + 重新广播提醒（限频） | 单测 + 调小阈值实测 |
| AC-4 | 人工处理中超过 `IDLE_TIMEOUT_MS`（默认 10min）**无论用户是否发消息**，由 cron 主动切回 AI | 单测 + 实测 |
| AC-5 | 每条转人工记录 `transferReason` / `transferredAt` / 认领人 / 认领时间 / `firstResponseAt` | 查库断言 |
| AC-6 | 客服 socket 能 join 任意 SUPPORT 会话；普通用户仍然只能 join 自己是成员的会话 | 单测（两条路径都要断言） |
| AC-7 | 会话关闭后 `handlerId` 为空；`handlerId != null` 的会话全部 `status != CLOSED` | 单测 + 数据巡检 SQL |

### 3.2 非目标（本次不做，见 §10）

- 技能组 / 按业务路由 / 负载均衡派单
- 客服在线状态（上线/忙碌/离线）
- 独立工单系统、SLA 超时升级到主管
- 转接历史表（一个会话多次转人工的完整流水）→ 放 T4

---

## 4. 状态机

沿用现有字段，不新增枚举列（`handlerId` 本身就是状态）：

```
                    handlerId = null
                    ┌──────────────┐
                    │   AI 处理中   │
                    └──────┬───────┘
                           │ ① AI 判定转人工
                           ▼
                handlerId = 'awaiting_human'
                ┌──────────────────────────┐
                │  待接入（排队中）          │
                │  handlerAssignedAt = 入队时间│
                └──────┬────────────┬──────┘
        ② 客服认领(CAS)│            │ ③ 超时 10min 无人接
                       ▼            └──────▶ 重新广播提醒（仍在队列）
        handlerId = <adminId>
        ┌──────────────────────────┐
        │  人工处理中                │──── ④ 客服首次回复 → firstResponseAt
        │  handlerAssignedAt = 认领时间│
        └──────┬────────────┬──────┘
   ⑤ 客服主动切回 AI │            │ ⑥ 空闲 10min / 用户关闭 / 关闭会话
                    ▼            ▼
              handlerId = null（回到 AI）
```

**关键不变式**

1. `handlerId == 'awaiting_human'` ⟺ 会话在待接入队列里
2. `handlerId` 为真实 adminId ⟹ `handlerAssignedAt != null`
3. `status == CLOSED` ⟹ `handlerId == null`
4. `firstResponseAt != null` ⟹ 至少有一条该会话的客服回复，且时间 **≥** 认领时间

---

## 5. 数据模型改动

**只加可空列 + 一个索引，纯 additive，可安全回滚。**

```prisma
model Conversation {
  // ... 现有字段保持不变

  /// 转人工原因: explicit_request / negative_sentiment / repeated_attempts / ai_error
  transferReason    String?   @map("transfer_reason") @db.VarChar(50)
  /// 本轮转人工的入队时间（与服务端 handlerAssignedAt 同义，但语义更明确，便于统计）
  transferredAt     DateTime? @map("transferred_at")
  /// 客服首次回复时间（用于算响应时长；只写一次）
  firstResponseAt   DateTime? @map("first_response_at")

  /// 待接入队列查询: WHERE type='SUPPORT' AND handler_id='awaiting_human' ORDER BY handler_assigned_at
  @@index([type, handlerId, handlerAssignedAt], map: "idx_conv_support_queue")
}
```

> **为什么不用新表**：一个会话当前只可能处在**一个**转接周期里，队列查询要的是「当前状态」而不是「历史」。
> 历史流水（谁转给谁、转了几次）是分析需求，放 T4，不在本次范围。

---

## 6. 后端方案

### 6.1 抽一个 `SupportHandlerService`（消除现有重复）

现状：**同一段超时判定被抄了两份** —— `chat.service.ts:103-137` 和 `events.gateway.ts:519-549`，内容几乎一致。
两份迟早会漂移（比如一边改了阈值），必须先合。

新建 `apps/api/src/common/chat/support-handler.service.ts`：

```ts
class SupportHandlerService {
  /** 认领：CAS，只有 pending 才能被拿走 */
  claim(conversationId, adminId): Promise<'claimed' | 'conflict'>

  /** 空闲回收：CAS，只有仍归这个人才能被收回 */
  releaseIfIdle(conversationId, now = new Date()): Promise<boolean>

  /** 定时扫描：批量回收所有空闲会话（带 Redis 实例锁） */
  sweepIdle(): Promise<number>

  /** 待接入超时提醒：批量找出超时会话，限频广播 */
  sweepQueueTimeout(): Promise<number>
}
```

**认领用 CAS，理由和 T1-5 / T1-6 完全一样**（先查后写会两个客服同时抢到）：

```ts
const r = await this.prisma.conversation.updateMany({
  where: { id: conversationId, handlerId: 'awaiting_human' },
  data: { handlerId: adminId, handlerAssignedAt: new Date() },
});
if (r.count !== 1) return 'conflict';   // 别人先接了
```

**回收同样 CAS**，防止「客服刚认领，cron 按旧数据把他踢掉」：

```ts
const r = await this.prisma.conversation.updateMany({
  where: {
    id,
    handlerId: { not: null },
    handlerAssignedAt: { lt: new Date(Date.now() - IDLE_TIMEOUT_MS) },
  },
  data: { handlerId: null, handlerAssignedAt: null, transferredAt: null },
});
```

### 6.2 接入点改造

| 位置 | 现状 | 改为 |
|---|---|---|
| `chat.service.ts:103-137` | 内联懒判定 | `await supportHandler.releaseIfIdle(conversationId)` |
| `events.gateway.ts:519-549` | 同一段复制 | 同上（**删掉重复实现**） |
| `admin-chat.service.ts:181-188` 回复 | 不认领 | 回复前：若 `handlerId === 'awaiting_human'` → 自动 `claim(conversationId, adminId)`；首次回复写 `firstResponseAt`（CAS：`where firstResponseAt: null`） |
| `admin-chat.service.ts:316` `switchHandler('human')` | 置 `awaiting_human` | 保持（admin 手动转人工 = 重新入队） |
| `admin-chat.service.ts:251` 关闭会话 | 不清 handler | 事务内补 `handlerId: null, handlerAssignedAt: null` |
| `ai-customer.service.ts:448-451` 转人工 | 只写 handler | 补写 `transferReason`、`transferredAt` |

### 6.3 通知：复用现有 admin 广播模式

`socket.listener.ts:162-195` 已有先例：查 `adminUser` 全量在线私有房间 `user_<id>` 推 `support_new_conversation`。
转人工照抄这个模式，新增监听：

```ts
@OnEvent(CHAT_EVENTS.SUPPORT_TRANSFER_REQUESTED)
async handleSupportTransferRequested(event) {
  const admins = await this.prisma.adminUser.findMany({
    where: { status: 1, deletedAt: null }, select: { id: true },
  });
  admins.forEach((a) => this.eventsGateway.dispatch(
    `user_${a.id}`, 'support_transfer_requested',
    { conversationId, reason, userId, waitingSince: Date.now() },
  ));
}
```

**新增 socket 事件（前端 `dispatch.type`）**

| type | 收件人 | 载荷 | 用途 |
|---|---|---|---|
| `support_transfer_requested` | 所有客服私有房间 | `{conversationId, reason, waitingSince}` | 待接入列表插入 + 红点 + 提示音 |
| `support_transfer_claimed` | 所有客服私有房间 | `{conversationId, adminId, adminName}` | 其他人列表移除 |
| `support_transfer_released` | 所有客服私有房间 | `{conversationId, cause:'idle'\|'closed'}` | 列表状态刷新 |
| `ai_transfer_reverted` | 用户私有房间 + 会话房间 | `{conversationId}` | 端上从人工态切回 AI 态 |

### 6.4 G6 修复：给客服一条合法入口

`handleConnection` 已经在用两个 secret 试 token（`events.gateway.ts:96-112`），
但**试成功后没有记住「这是客服还是用户」**。补一个标记：

```ts
// handleConnection
for (const secret of secrets) {
  try {
    const payload = this.jwtService.verify(token, { secret });
    userId = payload.sub;
    setSocketRole(client, secret === process.env.ADMIN_JWT_SECRET ? 'admin' : 'user');
    break;
  } catch { /* next */ }
}
```

`isConversationMember` 前置一行：

```ts
if (getSocketRole(client) === 'admin') return true;  // 客服可以进任何客服会话
```

> **为什么不用「把 admin 加进 ChatMember」**：那会在用户端会话成员里凭空多出一个人，
> Flutter 要额外过滤；而且客服本来就是后台身份，不该混进 IM 成员表。
> **为什么不能放开成「已登录即可 join」**：那 T1-4 就白修了。**只认 admin JWT**。

### 6.5 定时任务：SLA 扫描

新建 `apps/api/src/admin/chat/support-sla.task.ts`：

```ts
@Cron(CronExpression.EVERY_MINUTE)
async sweep() {
  if (!await this.redisLock.acquire('lock:support-slave', 50_000)) return; // 多实例只跑一个
  await this.supportHandler.sweepQueueTimeout();   // 待接入超时提醒
  await this.supportHandler.sweepIdle();           // 空闲自动回收
}
```

> ⚠️ **多实例**：`@Cron` 在每个 API 实例上都会触发。现有 `finance.task.ts` / `group.service.ts` 的 cron **没有实例锁**，
> 属既有隐患；本次新任务必须加（Redis `SET NX PX`），并把现有 cron 的锁缺口记进 #87 待办。

---

## 7. 接口契约

| 方法 | 路径 | 入参 | 成功 | 失败 |
|---|---|---|---|---|
| `POST` | `/admin/chat/conversations/:id/claim` | 无（admin 从 JWT 取） | `200 {success:true, handlerId, claimedAt}` | `409 CONFLICT` 已被他人认领；`404` 会话不存在；`400` 会话不在待接入状态 |
| `GET` | `/admin/chat/conversations` | 新增 `handlerStatus?: 'all'\|'ai'\|'awaiting'\|'assigned'`（默认 `all`，**行为不变**） | 现有结构 + `handlerId`/`transferredAt`/`waitingMs` | — |
| `PATCH` | `/admin/chat/conversations/:id/handler` | `{mode:'ai'\|'human'}`（现有） | — | `human` 时清 `firstResponseAt`，重新入队 |

**列表过滤映射**

| handlerStatus | Prisma where |
|---|---|
| `ai` | `handlerId: null` |
| `awaiting` | `handlerId: 'awaiting_human'` |
| `assigned` | `handlerId: { notIn: [null, 'awaiting_human'] }` |
| `all` | 不加条件（默认，保持兼容） |

`handlerStatus='awaiting'` 时排序改为 `handlerAssignedAt: 'asc'`（先来先接），其余仍按 `lastMsgTime desc`。

---

## 8. 前端方案（admin-next）

| 文件 | 改动 |
|---|---|
| `components/customer-service/ConversationList.tsx` | 顶部加「全部 / 待接入(N) / 处理中 / AI」分段控件；待接入项显示等待时长 + 红点 |
| `components/customer-service/ConversationItem.tsx` | 待接入态加倒计时徽标；本人处理中加 👤 标识 |
| `components/customer-service/ChatWindow.tsx` | 顶部加「认领」按钮（`awaiting_human` 时显示）；认领成功后切到人工态 |
| `hooks/useChatSocket.ts` | 监听 4 个新事件；`support_transfer_requested` 触发列表刷新 + 提示音（可静音） |
| `CustomerServiceClient.tsx` | 待接入数量写入页面标题 `(3) 客服`，切后台也看得见 |

---

## 9. 施工顺序（4 步，每步都能独立上线）

| 步 | 内容 | 可独立上线的理由 |
|:--:|---|---|
| **S1** | Prisma 迁移 3 列 + 索引；`SupportHandlerService` + `claim` CAS + 单测 | 只加字段和接口，无行为变化 |
| **S2** | 列表 `handlerStatus` 过滤；`replyToConversation` 自动认领 + `firstResponseAt`；关闭清 `handlerId` | 客服手动刷新即可用，不依赖通知 |
| **S3** | 4 个 socket 事件 + `socket.listener` 广播；G6 admin 角色放行；`useChatSocket` 监听 | 实时性上线 |
| **S4** | SLA cron（含 Redis 实例锁）+ 回收逻辑合并（删掉两份重复） | 把「懒判定」升级成「主动兜底」 |

**每步之前先跑**：`yarn workspace @lucky/api tsc --noEmit --pretty`；**每步之后补单测**（见 §11）。

---

## 10. 测试计划

### 10.1 单测（新增，按文件）

| 文件 | 用例 | 断言重点 |
|---|---|---|
| `support-handler.service.spec.ts` | 认领成功 / 已被认领返回 conflict / `updateMany.count=0` 时不发通知 | **WHERE 里必须带 `handlerId:'awaiting_human'`**（CAS 探针） |
| 同上 | `releaseIfIdle` 超时回收 / 未超时不动 | **WHERE 里必须带 `handlerAssignedAt < cutoff`** + `handlerId not null` |
| 同上 | 回收后广播 `support_transfer_released{cause:'idle'}` | 事件载荷 |
| `socket.listener.spec.ts`（扩） | 转人工 → 给每个 admin 私有房间投递 | 房间名集合 |
| `events.gateway.spec.ts`（扩） | admin 角色 join 任意会话 ✅；普通用户 join 非成员会话 ❌ | **两条路径都要断言**，防 G6 修复把 T1-4 打穿 |
| `admin-chat.service.spec.ts`（扩） | 回复 `awaiting_human` → 自动认领；再次回复不重复写 `firstResponseAt` | CAS 只写一次 |
| 同上 | 列表 `handlerStatus` 四态映射 | where 形状 |

### 10.2 集成 / 手工

1. 扩展 `scripts/ai-e2e-smoke.sh`：触发转人工 → 断言库里 `handlerId='awaiting_human'` 且 `transferReason` 非空
2. 双浏览器：客服 A 认领 → 客服 B 列表 1s 内消失，B 再点得到 409
3. 把 `IDLE_TIMEOUT_MS` 调到 1 分钟：客服认领后什么都不做 → 1 分钟后用户再说话，走的是 AI
4. 关闭会话 → 查库 `handlerId IS NULL`

---

## 11. 风险与回滚

| 风险 | 说明 | 处置 |
|---|---|---|
| 迁移 | 3 个可空列 + 1 个索引，纯 additive | 回滚直接 drop，无数据丢失 |
| 多实例 cron | 每个实例都会触发 | Redis `SET NX PX` 实例锁；获取失败直接跳过 |
| admin 放行打穿 T1-4 | 若把 `role==='admin'` 判断写松（比如只看 userId 存在） | **必须有专门的单测**：普通用户 join 非成员会话仍被拒 |
| 阈值太激进 | 10 分钟切回 AI，可能误伤慢回复的客服 | 走 env：`SUPPORT_QUEUE_TIMEOUT_MS` / `SUPPORT_IDLE_TIMEOUT_MS`，默认 10min |
| 通知风暴 | 全量 admin 广播，admin 多了会放大 | 在线优先（`socket.server.adapter.rooms.get('user_'+id)` 非空才发）；后续可加分页游标 |

**灰度**：`SUPPORT_SLA_ENABLED=false` 时 S4 的 cron 直接 return，其余步骤不依赖它。

---

## 12. 不做的事（边界）

- ❌ 技能组 / 语言路由 / 按业务线派单
- ❌ 客服在线状态与「忙碌勿扰」
- ❌ 转接历史表（一个会话多次转接的完整流水）→ T4
- ❌ 超时升级到主管 / 短信告警
- ❌ 客服绩效看板（响应时长分布、接单量）→ 依赖 §6 的 `firstResponseAt` 落库后再做

---

## 13. 验收清单（写进 current-task.md 的完成判据）

- [ ] `tsc --noEmit` 0 error
- [ ] 新增单测 ≥ 10 条，其中 **2 条是 CAS 探针**（claim / release）
- [ ] 双账号手工验证：待接入通知、认领互斥、超时回收、关闭清态
- [ ] 数据巡检 SQL 通过：`SELECT count(*) FROM conversations WHERE status = 2 AND handler_id IS NOT NULL` = 0
- [ ] 一条会话能在日志里按 traceId 串起：`AI 转人工 → 入队 → 认领 → 首次回复 → 关闭`
