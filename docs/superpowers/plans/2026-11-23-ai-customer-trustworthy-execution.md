# AI 客服可信执行与状态连续性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 客服的每次「已完成」声明都有执行证据，让多轮对话能记住上一轮的工具事实，让文字「确认」与卡片确认在同一套权威状态下工作。

**Architecture:** 以 `ai_action_requests` 为唯一执行权威；每轮把最近动作状态与工具事实以确定性方式注入 agent 上下文；短确认语在进入意图分类前被确定性处理；发布前用「动作是否真的 EXECUTED」校验完成语。改动集中在 `apps/api/src/client/ai-customer/`，不新增表。

**Tech Stack:** NestJS、Prisma、Redis、LangGraph.js、Jest。

**Spec:** [AI 客服全流程审计](../../system-review/2026-11-22-ai-customer-flow-audit.md) + [动作确认契约](../../../openspec/changes/ai-action-card-contract/specs/ai-customer/action-confirmation/spec.md)

---

## Global Constraints

- 测试：`yarn workspace @lucky/api test src/client/ai-customer/<file>`；类型：`yarn workspace @lucky/api tsc --noEmit --pretty`。
- 不新增 Prisma 迁移；`AiActionRequest` 已有 `idx_ai_action_conv (conversationId, createdAt)` 与 `idx_ai_action_status_expiry`。
- `ai_traces.status` 是 `VarChar(16)`：新增状态必须 ≤16 字符（`CONFIRM_REISSUED` 正好 16，`OTP_PENDING` 11）。
- 新增的 DB 读取必须 fail-open：读不到就返回 `null`，绝不阻断本轮对话。
- 卡片对外载荷只做加法：保留旧字段 `summary`，新增字段不影响旧客户端。
- 任何写操作执行前必须同时满足：令牌未消费、DB 行 `CONFIRM_CREATED`、`expiresAt > now`。
- 提示词只用于表达，不作为业务不变式的唯一保障；每个不变式至少有一个代码断言或测试。

## Blocked / 需要产品决策

1. **生产 OTP 固定码（999999）**：这是 `docs/current-task.md` T1-1 中「生产永久使用测试码」的**有意配置**，本计划不擅自改动。上线前必须切换真实短信（或每用户一次性测试码）；若要现在处理，需要单独确认。
2. **取消请求的 requestId 校验**需要 Flutter 在 `cancel` 调用里一并提交 `AiConfirmData.requestId`（客户端改动在另一仓库）。服务端先做兼容：`requestId` 缺失时保持现有行为并记 warn。
3. **`ai_action_requests` 无外键/唯一约束**：本计划不加迁移，用应用层幂等（Task 6）覆盖；后续可单独评估。

## Review Focus

- 用户在**有活卡片**时输入「确认」→ 必须重发新卡片并提示点击，**不得**直接执行写操作。
- 用户在**卡片已过期**后输入「确认」→ 必须确定性回复已过期，**不得**走任意 agent 编造结果。
- 用户点击一张**已被新消息作废**的卡片 → 必须 400 拒绝，即使 Redis 令牌尚未到期。
- 模型输出「提现申请已提交 / 优惠券已领取」但本轮**没有 EXECUTED 动作** → 必须被改写为「尚未完成」。
- 提现选择**充值渠道**或错误渠道 ID → 必须拒绝；卡片必须显示渠道名、手续费、到账金额。

---

### Task 1: 动作上下文读取（DB 权威）

**Files:**
- Create: `apps/api/src/client/ai-customer/action-context.ts`
- Create: `apps/api/src/client/ai-customer/action-context.spec.ts`
- Modify: `apps/api/src/client/ai-customer/ai-customer.module.ts`（注册 `AiActionContextService` 到 `providers`/`exports`）

**Interfaces:**
- Consumes: `PrismaService`。
- Produces:
  ```ts
  export type ActionContextStatus =
    | 'CONFIRM_CREATED' | 'CONFIRMED' | 'EXECUTED'
    | 'EXPIRED' | 'CANCELLED' | 'FAILED' | 'TRANSFERRED';

  export interface ActionContext {
    requestId: string;
    action: string;
    status: ActionContextStatus;
    summary: Record<string, unknown>; // account/phone 已掩码
    expiresAt: string | null;          // ISO
    expired: boolean;
  }

  export class AiActionContextService {
    constructor(prisma: PrismaService);
    loadLatest(conversationId: string): Promise<ActionContext | null>;
  }
  export function maskActionSummary(summary: Record<string, unknown>): Record<string, unknown>;
  export function formatActionContext(ctx: ActionContext | null): string;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// action-context.spec.ts
it('无动作时返回 null', async () => {
  prisma.aiActionRequest.findFirst.mockResolvedValue(null);
  await expect(service.loadLatest('c1')).resolves.toBeNull();
});

it('把最新动作映射为上下文并标记过期', async () => {
  prisma.aiActionRequest.findFirst.mockResolvedValue({
    id: 'a1', action: 'withdraw', status: 'CONFIRM_CREATED',
    summary: { action: 'withdraw', amount: 100, account: '09171234567' },
    expiresAt: new Date(Date.now() - 1000),
  });
  const ctx = await service.loadLatest('c1');
  expect(ctx).toMatchObject({ requestId: 'a1', action: 'withdraw', status: 'CONFIRM_CREATED', expired: true });
  expect(ctx?.summary.account).toBe('****4567');
});

it('formatActionContext 对活卡片给出“需点击卡片”提示', () => {
  const text = formatActionContext({ requestId: 'a1', action: 'withdraw', status: 'CONFIRM_CREATED',
    summary: { amount: 100 }, expiresAt: new Date(Date.now() + 60000).toISOString(), expired: false });
  expect(text).toContain('lastAction: withdraw');
  expect(text).toContain('需要在卡片上点击确认');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/action-context.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`loadLatest` 用 `findFirst({ where: { conversationId }, orderBy: { createdAt: 'desc' } })`；`expired = status === 'CONFIRM_CREATED' && expiresAt != null && expiresAt <= now`。`maskActionSummary` 对 `account`/`phone` 保留后四位。`formatActionContext` 输出：`## Last Action`、`lastAction`、`lastActionStatus`、`lastActionExpired`、`lastActionSummary`，并按状态附一条 `actionHint`（CONFIRM_CREATED → 需点击卡片；CONFIRMED → 等待短信验证码；EXPIRED → 请重新发起）。

- [ ] **Step 4: 运行测试确认通过**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer/action-context.ts apps/api/src/client/ai-customer/action-context.spec.ts
git commit -m "feat(ai): load authoritative action context per conversation"
```

---

### Task 2: 把动作上下文注入 agent 提示词

**Files:**
- Modify: `apps/api/src/client/ai-customer/graph/state.ts`（新增 `actionContext` 通道）
- Modify: `apps/api/src/client/ai-customer/graph/agents/agent-factory.ts`（注入 `formatActionContext`）
- Modify: `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts:661-673`（把 `actionContext` 传给 `runStandardAgent`）
- Modify: `apps/api/src/client/ai-customer/ai-stream.handler.ts:75-130`（输入带 `actionContext`）
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:592-640`（过期处理后加载并传入）
- Test: `apps/api/src/client/ai-customer/graph/agents/agent-factory.action-context.spec.ts`

**Interfaces:**
- Consumes: `ActionContext`、`formatActionContext`（Task 1）。
- Produces: `AgentState.actionContext: Annotation<ActionContext | null>`；`runStandardAgent` 选项新增 `actionContext?: ActionContext | null`。

- [ ] **Step 1: 写失败测试**

```ts
it('活卡片上下文出现在 system prompt 中', async () => {
  // mock LLM 捕获 initialMessages；断言注入的 SystemMessage 含 "lastAction: withdraw"
  const { initialMessages } = await captureAgentMessages({
    actionContext: { requestId: 'a1', action: 'withdraw', status: 'CONFIRM_CREATED',
      summary: { amount: 100 }, expiresAt: new Date(Date.now() + 60000).toISOString(), expired: false },
  });
  const systemText = initialMessages.filter((m) => m._getType() === 'system').map((m) => m.content).join('\n');
  expect(systemText).toContain('lastAction: withdraw');
  expect(systemText).toContain('需要在卡片上点击确认');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/graph/agents/agent-factory.action-context.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`state.ts`：
```ts
actionContext: Annotation<ActionContext | null>({
  reducer: (_prev, next) => next,
  default: () => null,
}),
```
`agent-factory.ts`：在 `injected` 数组里追加 `formatActionContext(opts.actionContext)` 的 `SystemMessage`（为空不追加），并把 `opts.actionContext` 传给 `runAgentLoop` 之后的摘要保护（与 `pendingConfirm` 并列）。
`orchestrator.node.ts`：调用 `runStandardAgent` 时传 `actionContext: state.actionContext` **和** `pendingConfirm: state.pendingConfirm`（后者用于 `formatContextSummary` 的裁剪保护，当前漏传）。
`ai-stream.handler.ts`：`handleEventStream(..., actionContext: ActionContext | null)`，并入 `streamEvents` 的输入对象。
`ai-customer.service.ts`：在 `expireForConversation` **之后**、`runEventStream` 之前调用 `AiActionContextService.loadLatest(conversationId)`，失败返回 `null`；把结果传给 `runEventStream`。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/graph/agents/agent-factory.action-context.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "feat(ai): inject authoritative action context into prompts"
```

---

### Task 3: 工具事实确定性落盘

**Files:**
- Create: `apps/api/src/client/ai-customer/graph/utils/tool-facts.ts`
- Create: `apps/api/src/client/ai-customer/graph/utils/tool-facts.spec.ts`
- Modify: `apps/api/src/client/ai-customer/graph/agents/agent-runner.ts:186-299`（返回全部工具调用）
- Modify: `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts:660-760`（合并进 `contextState.slots`）

**Interfaces:**
- Consumes: `AgentLoopResult`。
- Produces:
  ```ts
  export interface ToolCallInfo { name: string; args: Record<string, any>; result: string; }
  // AgentLoopResult 新增 toolCallInfos: ToolCallInfo[]
  export function collectToolFacts(calls: ToolCallInfo[]): Record<string, unknown> | null;
  ```

- [ ] **Step 1: 写失败测试**

```ts
it('getClaimableCoupons 结果留下 couponId/couponName', () => {
  const facts = collectToolFacts([{ name: 'getClaimableCoupons', args: {}, result: JSON.stringify({
    ok: true, data: { coupons: [{ couponId: 'c1', couponName: 'Big Spender' }] } }) }]);
  expect(facts).toEqual({ claimableCoupons: [{ couponId: 'c1', couponName: 'Big Spender' }] });
});

it('getPaymentChannels 结果留下渠道 ID 与名称', () => {
  const facts = collectToolFacts([{ name: 'getPaymentChannels', args: { amount: 100 }, result: JSON.stringify({
    ok: true, data: [{ id: 5, name: 'GCash Withdraw', feeRate: '0.008', feeFixed: '5.00' }] }) }]);
  expect(facts).toEqual({ withdrawChannels: [{ channelId: 5, channelName: 'GCash Withdraw', feeRate: '0.008', feeFixed: '5.00' }] });
});

it('失败结果与未知工具不产生事实', () => {
  expect(collectToolFacts([{ name: 'getClaimableCoupons', args: {}, result: JSON.stringify({ ok: false, error: 'x' }) }])).toBeNull();
  expect(collectToolFacts([{ name: 'searchProducts', args: {}, result: '{}' }])).toBeNull();
});
```
（解析时兼容 `stripToolResult` 之后的纯 `data` JSON：`collectToolFacts` 先尝试 `{ok,data}`，再尝试裸对象/数组。）

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/graph/utils/tool-facts.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

白名单：`getClaimableCoupons`/`getUserCoupons` → `claimableCoupons` 最多 5 条；`getPaymentChannels` → `withdrawChannels` 最多 5 条；`getWalletBalance` → `walletBalance`；`getMyKyc` → `kycStatus`。
`agent-runner.ts`：在每次成功 `invoke` 后 push 到 `toolCallInfos`，返回值带上该数组。
`orchestrator.node.ts`：`runStandardAgent` 之后调用 `collectToolFacts(result.toolCallInfos)`，非空则 `nextContextState = { ...nextContextState, slots: { ...nextContextState.slots, ...facts } }`；确认分支（`hasPendingConfirm`）返回的 `contextState` 也要带上。顺带修多意图 `action === 'ask'` 分支：返回时带上 `contextState: nextContextState`（当前漏传，导致实体/纠正丢失）。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/graph/utils/tool-facts.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "feat(ai): persist whitelisted tool facts into conversation slots"
```

---

### Task 4: 短确认语确定性路由 + 卡片重发

**Files:**
- Create: `apps/api/src/client/ai-customer/confirmation-intent.ts`
- Create: `apps/api/src/client/ai-customer/confirmation-intent.spec.ts`
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:592-640`（在 `expireForConversation` 之前拦截）
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:1592-1774`（抽出 `issueConfirmCard`）
- Test: `apps/api/src/client/ai-customer/ai-customer.confirm.spec.ts`

**Interfaces:**
- Consumes: `AiActionContextService.loadLatest`（Task 1）、`routeConfirm` 的卡片逻辑。
- Produces:
  ```ts
  export function isShortAffirmation(text: string): boolean;
  // AiCustomerService 内部
  private async issueConfirmCard(input: {
    userId: string; conversationId: string; action: string;
    params: Record<string, any>; summary: Record<string, any>;
    triggerMessageId?: string;
  }): Promise<{ requestId: string | null; created: boolean }>;
  private async handlePendingActionConfirmation(args: {
    userId: string; conversationId: string; message: string; triggerMessageId?: string;
  }): Promise<boolean>; // true = 已确定性处理，跳过 graph
  ```

- [ ] **Step 1: 写失败测试**

```ts
it.each(['确认', '确定', '可以', '好的', 'yes', 'OK', '确认。'])('识别短确认语: %s', (t) =>
  expect(isShortAffirmation(t)).toBe(true));
it.each(['可以领券吗', '确认一下我的优惠券', '我想提现'])('不误判: %s', (t) =>
  expect(isShortAffirmation(t)).toBe(false));

it('活卡片 + “确认”：重发卡片，不执行写操作', async () => {
  ctx.loadLatest.mockResolvedValue({ requestId: 'a1', action: 'withdraw', status: 'CONFIRM_CREATED',
    summary: { amount: 100 }, expiresAt: new Date(Date.now() + 30000).toISOString(), expired: false });
  const handled = await service.handlePendingActionConfirmation({ userId: 'u1', conversationId: 'c1', message: '确认' });
  expect(handled).toBe(true);
  expect(issueConfirmCard).toHaveBeenCalledWith(expect.objectContaining({ action: 'withdraw' }));
  expect(lifecycle.markExecuted).not.toHaveBeenCalled();
});

it('过期卡片 + “确认”：确定性回复已过期', async () => {
  ctx.loadLatest.mockResolvedValue({ requestId: 'a1', action: 'withdraw', status: 'EXPIRED',
    summary: {}, expiresAt: new Date(Date.now() - 1000).toISOString(), expired: true });
  const handled = await service.handlePendingActionConfirmation({ userId: 'u1', conversationId: 'c1', message: '确认' });
  expect(handled).toBe(true);
  expect(publishAiReply).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'c1',
    [expect.objectContaining({ content: expect.stringContaining('已过期') })], expect.anything(), expect.anything(), expect.anything(), expect.anything());
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/confirmation-intent.spec.ts src/client/ai-customer/ai-customer.confirm.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`isShortAffirmation`：trim + 去标点/emoji 后，命中固定集合 `确认|确定|可以|好的?|行|是的|没问题|嗯+|对|yes|y|ok|okay|sure|confirm|proceed`（整句匹配，不是包含）。
`chatStream` 顺序调整为：gate → quota → `prepareThread` → **短确认处理** → `expireForConversation` → 加载 actionContext → stream。短确认处理：
- `CONFIRM_CREATED && !expired` → 先 `expireForConversation(conversationId)` 把旧卡片置 `EXPIRED`，再 `issueConfirmCard`（同一 action/params/summary，新令牌），发一条「请点击上方卡片确认（60 秒内有效）」，trace `CONFIRM_REISSUED`。
- `CONFIRMED` → 「验证码已发送，请输入短信验证码」，trace `OTP_PENDING`。
- 其他终态 → 「上一张卡片已过期或已处理，请重新发起」，trace `CONFIRM_EXPIRED`。
- 无动作 → 返回 false，继续 graph。
`issueConfirmCard` 从 `routeConfirm` 抽出，`routeConfirm` 只负责调用它并忽略返回值。所有确定性分支都要写 `ai_traces`（`intent='confirm_gate'`，`source='production'`）并调用 `callbacks.onDone()`。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/confirmation-intent.spec.ts src/client/ai-customer/ai-customer.confirm.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "feat(ai): route short confirmations deterministically and reissue cards"
```

---

### Task 5: 发布前事实闸门

**Files:**
- Create: `apps/api/src/client/ai-customer/claim-guard.ts`
- Create: `apps/api/src/client/ai-customer/claim-guard.spec.ts`
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:1005-1145`（收尾时校验）
- Test: `apps/api/src/client/ai-customer/ai-customer.confirm.spec.ts`

**Interfaces:**
- Consumes: `AiActionRequest`、`StreamUsageSummary`。
- Produces:
  ```ts
  export function detectCompletionClaim(text: string): boolean;
  export const CLAIM_NOT_EXECUTED_REPLY: string; // "这次操作还没有真正完成…"
  ```

- [ ] **Step 1: 写失败测试**

```ts
it.each(['提现申请已提交', '优惠券已领取', '兑换码已兑换', '地址已删除', 'Your withdrawal has been submitted'])
('识别完成语: %s', (t) => expect(detectCompletionClaim(t)).toBe(true));
it.each(['提现需要 1-3 个工作日', '请确认：提现确认', '目前可领取的优惠券如下'])
('不误判: %s', (t) => expect(detectCompletionClaim(t)).toBe(false));

it('无 EXECUTED 动作时把完成语改写成未完成', async () => {
  prisma.aiActionRequest.findFirst.mockResolvedValue(null);
  const out = await service.guardCompletionClaims('c1', new Date(), [{ type: 'ai', content: '提现申请已提交' }]);
  expect(out[0].content).toContain('还没有真正完成');
});

it('有 EXECUTED 动作时保留原文', async () => {
  prisma.aiActionRequest.findFirst.mockResolvedValue({ id: 'a1', status: 'EXECUTED' });
  const out = await service.guardCompletionClaims('c1', new Date(), [{ type: 'ai', content: '优惠券已领取' }]);
  expect(out[0].content).toBe('优惠券已领取');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/claim-guard.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`detectCompletionClaim`：匹配 `ACTION_CATALOG` 的 `successMessage` 原文，加上保守正则 `/(已|已经)(提交|领取|兑换|删除|修改|新增|完成)/` 与 `/has been (submitted|claimed|redeemed|completed|deleted|updated|created)/i`；排除包含「需要 / 请确认 / 请点击 / 将会」的句子。
`finalizeAfterStream`：在 `routeNormalCompletion` 之前，查询 `aiActionRequest.findFirst({ where: { conversationId, status: 'EXECUTED', updatedAt: { gte: startedAt } } })`；为 `null` 且候选消息命中 claim 时，替换为 `CLAIM_NOT_EXECUTED_REPLY`，并 `incCounter('ai_claim_guard_total', { result: 'rewritten' })`。查询失败时 fail-open（保留原文）但要 `logger.warn`。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/claim-guard.spec.ts src/client/ai-customer/ai-customer.confirm.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "feat(ai): block completion claims without an executed action"
```

---

### Task 6: 确认执行以 DB 状态为准（CAS）

**Files:**
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:1786-1835`（`confirmAction`）
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:1841-1871`（`cancelAction`）
- Test: `apps/api/src/client/ai-customer/ai-customer.confirm.spec.ts`

**Interfaces:**
- Consumes: `PrismaService.aiActionRequest.updateMany`。
- Produces: `confirmAction` 在 `execute` 前完成 `CONFIRM_CREATED → CONFIRMED` 的 CAS；`cancelAction` 完成 `CONFIRM_CREATED → CANCELLED` 的 CAS。

- [ ] **Step 1: 写失败测试**

```ts
it('DB 已 EXPIRED 时即使令牌有效也拒绝执行', async () => {
  confirmService.consume.mockResolvedValue({ action: 'claim_coupon', params: { couponId: 'c1' }, summary: {}, userId: 'u1', requestId: 'a1' });
  prisma.aiActionRequest.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.confirmAction('tok', 'u1')).rejects.toThrow(/expired|handled/i);
  expect(catalogExecute).not.toHaveBeenCalled();
});

it('两个并发确认只有一个拿到 CAS', async () => {
  prisma.aiActionRequest.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  const [a, b] = await Promise.allSettled([service.confirmAction('tok', 'u1'), service.confirmAction('tok', 'u1')]);
  expect([a.status, b.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/ai-customer.confirm.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`confirmAction`：`consume` 后若 `requestId` 存在，执行
```ts
const cas = await this.prismaService.aiActionRequest.updateMany({
  where: { id: requestId, status: 'CONFIRM_CREATED', expiresAt: { gt: new Date() } },
  data: { status: 'CONFIRMED', confirmedAt: new Date() },
});
if (cas.count !== 1) throw new BadRequestException('Confirm request expired or already handled');
```
非 OTP 动作删除原来的 `markConfirmed` 调用（CAS 已置位）；OTP 动作的 `startWithdrawOtp` 也删除重复 `markConfirmed`。
`cancelAction`：用同样的 CAS 置 `CANCELLED`；CAS 失败再走「待 OTP 任务」分支。
`confirmWithdrawOtp`：在 `popPendingExecution` 之前，对 `pending.requestId` 做 `CONFIRMED → EXECUTED` 的 CAS（`where: { id, status: 'CONFIRMED', expiresAt: { gt: now } }`）；`count !== 1` 时拒绝，防止 handoff/过期后仍执行。
`AiActionLifecycleService.updateStatus`：加允许迁移表（`CONFIRM_CREATED → CONFIRMED|EXPIRED|CANCELLED|TRANSFERRED`、`CONFIRMED → EXECUTED|FAILED|TRANSFERRED|EXPIRED`），用 `updateMany({ where: { id, status: { in: allowedFrom } }, data: { status } })`；未知迁移直接抛错。
令牌日志：`ai-action-confirm.service.ts:94` 改为只打印 `token.slice(0,8)+'…'` 或 sha256 前 8 位。
幂等：`createConfirm` 在 `messageId` 存在时先 `findFirst({ conversationId, action, messageId })`，已有同消息同动作的 `CONFIRM_CREATED` 行则复用，不再新建令牌。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/ai-customer.confirm.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "fix(ai): make DB action state authoritative before execution"
```

---

### Task 7: 提现待执行任务完整性与 OTP 结果

**Files:**
- Modify: `apps/api/src/client/ai-customer/ai-action-confirm.service.ts:100-135`
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:2029-2060`（`startWithdrawOtp`）
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:2071-2153`（`confirmWithdrawOtp`）
- Test: `apps/api/src/client/ai-customer/ai-customer.confirm.spec.ts`

**Interfaces:**
- Consumes: `RedisService.setNx`。
- Produces: `stagePendingExecution` 使用 `setNx`，payload 必含 `conversationId`；重复暂存返回 false 并由调用方转成可读错误。

- [ ] **Step 1: 写失败测试**

```ts
it('OTP 验证成功后投递 AI_ACTION_RESULT 并落会话消息', async () => {
  pending = { action: 'withdraw', params: validWithdraw, summary: {}, userId: 'u1', conversationId: 'c1', requestId: 'a1' };
  await service.confirmWithdrawOtp('999999', 'u1');
  expect(eventsGateway.dispatchToUser).toHaveBeenCalledWith('u1', 'ai_action_result', expect.objectContaining({ conversationId: 'c1', success: true }));
  expect(publishAiReply).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'c1', expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ kind: 'action_result' }), expect.anything());
});

it('已有待验证提现时第二次确认被拒绝', async () => {
  redis.setNx.mockResolvedValue(false);
  await expect(service.startWithdrawOtp('u1', {}, {}, 'a2')).rejects.toThrow(/已有待验证/);
});

it('令牌已消费后取消，requestId 不匹配则拒绝', async () => {
  confirmService.consume.mockResolvedValue(null);
  confirmService.peekPendingExecution.mockResolvedValue({ requestId: 'a1', userId: 'u1' });
  await expect(service.cancelAction('tok', 'u1', 'a2')).rejects.toThrow(/invalid|expired/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/ai-customer.confirm.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`stagePendingExecution` 改为 `redisService.setNx(key, JSON.stringify(payload), PENDING_TTL_SEC)` 并返回 boolean。
`startWithdrawOtp(userId, params, summary, requestId, conversationId)`：先 `setNx`，成功后再 `otpService.request`（把发短信放在暂存之后，避免「发了码但没有待执行任务」），失败抛 `BadRequestException('已有待验证的提现，请先完成或取消')`。
`ActionExecutionServices.startWithdrawOtp` 签名加 `conversationId?: string`；`ActionExecuteContext` 加 `conversationId?: string`；`confirmAction` 调用 `entry.execute` 时把 `payload.conversationId` 传进去。
`confirmWithdrawOtp` 的 `emitActionResult(consumed, ...)` 因此能拿到 `conversationId`。
OTP 尝试预算：`otpService.request({ phone, codeType: WITHDRAW })` 创建新 PENDING 前，把同手机号 + 同类型的历史 PENDING 置为失效（或 `verify` 只允许最新一条，旧记录直接拒绝），保证 5 次上限按「动作」而不是「记录」计算。
取消收紧：`ConfirmCancelDto` 增加可选 `requestId`；当令牌已消费、走待执行任务分支时，必须 `requestId === pending.requestId` 才允许取消（Flutter 的 `AiConfirmData` 已有 `requestId`，需一并提交）。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/ai-customer.confirm.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "fix(ai): preserve conversation on withdraw OTP and single pending action"
```

---

### Task 8: 提现渠道契约与卡片展示

**Files:**
- Modify: `apps/api/src/client/wallet/client-wallet.service.ts:441-446`（校验 `channel.type === 2`）
- Modify: `apps/api/src/client/ai-customer/graph/config/action-catalog.ts:146-192`（展示渠道名/费率/到账）
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:1603-1618,1687-1699`（解析渠道并传入展示参数）
- Modify: `apps/api/src/client/payment-channel/dto/payment-channel.dto.ts`（新增 `feeRate`）
- Modify: `apps/api/src/client/coupon/dto/claimable-coupon-response.dto.ts`（新增 `currency`）
- Modify: `apps/api/src/client/ai-customer/graph/agents/prompts/coupon-prompt.ts:125`（金额统一 ₱）
- Test: `apps/api/src/client/ai-customer/graph/config/action-catalog.spec.ts`、`apps/api/src/client/ai-customer/ai-customer.confirm.spec.ts`、`apps/api/src/client/wallet/client-wallet.service.spec.ts`

**Interfaces:**
- Consumes: `PaymentChannel`。
- Produces:
  - `applyWithdraw` / `applyWithdrawVerified` 对 `channel.type !== 2` 抛 `BadRequestException('Not a withdrawal channel')`。
  - withdraw `buildFields` 使用 `args.channelName`（缺省回退 `渠道 #id`），并展示 `手续费`/`实际到账`（来自 `args.fee`/`args.netAmount`）。
  - `PaymentConfigItemDto.feeRate: string`；`ClaimableCouponResponseDto.currency: string`（固定 `'PHP'`）。

- [ ] **Step 1: 写失败测试**

```ts
it('充值渠道不能提现', async () => {
  prisma.paymentChannel.findUnique.mockResolvedValue({ id: 1, type: 1, status: 1 });
  await expect(service.applyWithdrawVerified('u1', dto)).rejects.toThrow(/withdrawal channel/i);
});

it('执行参数只保留目录白名单，注入字段进不了令牌/DB', async () => {
  await service.issueConfirmCard({ userId: 'u1', conversationId: 'c1', action: 'withdraw',
    params: { amount: 100, channelId: 5, account: '0917', accountName: 'P', adminOverride: true },
    summary: {} });
  expect(confirmService.generate).toHaveBeenCalledWith('u1', 'withdraw',
    expect.not.objectContaining({ adminOverride: true }), expect.anything(), expect.anything(), 'c1');
});

it('只改电话不会清空姓名', async () => {
  addressService.get.mockResolvedValue({ firstName: 'P', lastName: 'Q', phone: '0917' });
  await service.executeUpdateAddress('u1', 'a1', { phone: '0918' });
  expect(addressService.update).toHaveBeenCalledWith('u1', 'a1',
    expect.objectContaining({ firstName: 'P', lastName: 'Q', phone: '0918' }));
});

it('提现卡片展示渠道名、手续费与到账', () => {
  const entry = getCatalogEntryByAction('withdraw')!;
  const fields = entry.buildFields({ amount: 100, channelId: 5, channelName: 'GCash Withdraw',
    fee: '5.80', netAmount: '94.20', account: '09171234567', accountName: 'Porter' });
  expect(fields).toEqual(expect.arrayContaining([
    { label: '渠道', value: 'GCash Withdraw' },
    { label: '手续费', value: '₱5.80' },
    { label: '实际到账', value: '₱94.20' },
  ]));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/graph/config/action-catalog.spec.ts src/client/wallet/client-wallet.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`routeConfirm`（现 `issueConfirmCard`）查渠道后构造 `displayArgs = { ...pc.params, channelName: channel.name, fee: fee.toString(), netAmount: netAmount.toString() }`；`buildSummary`/`buildFields` 使用这些字段；`buildParams` 不变（执行参数仍只允许四个白名单键）。
`PaymentConfigItemDto` 增加 `@Expose() @FieldMeta({ label: { zh:'手续费率', en:'Fee Rate' } }) feeRate!: string;`（DecimalToString）。
`ClaimableCouponResponseDto` 增加 `currency!: string`，工具映射时填 `'PHP'`。
`summary` 脱敏：`routeConfirm`/`issueConfirmCard` 在把 `summary` 传给 `createConfirm`、`AI_CONFIRM` 与聊天消息 `meta` 之前，统一用 Task 1 的 `maskActionSummary` 处理；执行参数（Redis payload 的 `params`）保持未脱敏，二者不再混用。
`buildParams` 落地：`issueConfirmCard` 用 `catalogEntry.buildParams(pc.params)` 生成 `execParams`，之后 `createConfirm`、令牌 `generate`、`buildFields`（展示）与执行都只用 `execParams`，原始模型 args 不进入 DB/令牌。
目录外动作：`issueConfirmCard` 查不到目录项时直接 `return { requestId: null, created: false }` 并发布「该操作暂不支持」，不发卡。
改地址合并：`executeUpdateAddress` 先读当前地址，再把未提供的姓名/其他字段沿用旧值，避免「只改电话」清空 `firstName/lastName`。
`applyWithdraw` 工具 body 改为 fail-closed：既然写工具一定在 `runAgentLoop` 被截停，body 内不再调用 `clientWalletService.applyWithdraw`，改为返回 `toolFailure('Write tools must be confirmed through the action card')`，避免截停逻辑回归时出现第二个执行点。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/graph/config/action-catalog.spec.ts src/client/wallet/client-wallet.service.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client
git commit -m "fix(ai): enforce withdrawal channels and show real fees on cards"
```

---

### Task 9: 能力声明补齐（OTP / flow 工具）

**Files:**
- Modify: `apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts:20-50,143-230`
- Modify: `apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:205-276`
- Modify: `apps/api/src/client/ai-customer/graph/tools/flow-tools.ts:47,101`
- Test: `apps/api/src/client/ai-customer/graph/tools/tool-registry.service.spec.ts`

**Interfaces:**
- Consumes: `ToolCapability`。
- Produces: `ToolCapability.kind: 'read' | 'write' | 'internal'`；`requiresConfirmation` 仍只认 `'write'`；`internal` 工具必须显式声明，且不出现在 `getWriteToolNames()`；`getCapabilityKinds(names: string[]): Array<'read' | 'write' | 'internal'>` 仅供自检与测试使用。

- [ ] **Step 1: 写失败测试**

```ts
it('OTP 与 flow 工具声明为 internal，不进入写工具列表', () => {
  const kinds = registry.getCapabilityKinds(['requestWithdrawOtp', 'verifyWithdrawOtp', 'updateFlowData', 'updateFlowStatus']);
  expect(kinds.every((k) => k === 'internal')).toBe(true);
  expect(registry.getWriteToolNames()).not.toEqual(expect.arrayContaining(['requestWithdrawOtp', 'verifyWithdrawOtp']));
});

it('副作用命名但未声明能力的工具让启动自检失败', () => {
  expect(() => auditCapabilities([{ tool: { name: 'sendSomething' } }])).toThrow(/without a capability declaration/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/graph/tools/tool-registry.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`ToolCapability.kind` 加 `'internal'`；`requiresConfirmation` 保持 `kind === 'write'`。`requestWithdrawOtp`、`verifyWithdrawOtp`、`updateFlowData`、`updateFlowStatus` 的 `capability` 改为 `{ kind: 'internal', requiresOwnership: false }`。启动自检的告警文案区分「未声明」与「声明为 internal」；`internal` 工具必须仍显式声明（`capabilityDeclared`），否则拦截启动。
副作用命名正则补 `update|set|bind|cancel`；`requiresConfirmation(name)` 对未知工具改为返回 `true`（fail-closed），并更新对应测试断言。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/graph/tools/tool-registry.service.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer/graph/tools
git commit -m "fix(ai): declare side-effecting internal tools explicitly"
```

---

### Task 10: 配额按自然日 + 错误语义

**Files:**
- Modify: `apps/api/src/client/ai-customer/ai-usage.service.ts:146-195`
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:714-768`（错误分支）
- Modify: `apps/api/src/client/ai-customer/ai-failure-handler.ts:32-38`
- Test: `apps/api/src/client/ai-customer/ai-usage.service.spec.ts`、`apps/api/src/client/ai-customer/ai-customer.service.spec.ts`

**Interfaces:**
- Produces: `sessionKey(conversationId, day: string)`；`QuotaExceededError` / `SessionQuotaExceededError` 走独立话术。

- [ ] **Step 1: 写失败测试**

```ts
it('跨天使用独立计数器，不再续期旧 key', async () => {
  jest.setSystemTime(new Date('2026-11-22T15:00:00Z'));
  await service.recordSessionUsage('c1', 100);
  expect(redis.incrBy).toHaveBeenCalledWith('ai:session:tokens:c1:2026-11-22', 100);
  jest.setSystemTime(new Date('2026-11-23T15:00:00Z'));
  await service.assertWithinSessionQuota('c1');
  expect(redis.get).toHaveBeenCalledWith('ai:session:tokens:c1:2026-11-23');
});

it('会话配额耗尽给出明确话术，不伪装成客服离线', async () => {
  const out = await dispatchWithError(new SessionQuotaExceededError(50000, 50083));
  expect(out.message).toContain('本次对话已达到');
  expect(out.message).not.toContain('客服暂时不在线');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/ai-usage.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`sessionKey` 增加日期后缀（`dayKey(now)`，用服务器本地日期即可）；`recordSessionUsage` 只 `incrBy`，不再 `expire`（日期桶自然隔离），或 `expire` 设 48h 作为清理。
`handleStreamError`：`QuotaExceededError` / `SessionQuotaExceededError` 先发布 `QUOTA_EXCEEDED_REPLY = '本次对话已达到 AI 使用上限，请稍后再试，或留言由人工跟进。'`，`transferReason='quota_exceeded'`，不再调用 `degradeToHuman` 的离线话术。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer/ai-usage.service.spec.ts src/client/ai-customer/ai-customer.service.spec.ts && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "fix(ai): bucket session quota by day and clarify quota errors"
```

---

### Task 11: 可观测与流程清理

**Files:**
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:1071-1125`（trace 状态来自 `issueConfirmCard` 结果）
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts:555-570,817-830`（gate 拦截与 handoff reset 时作废 DB 卡片）
- Modify: `apps/api/src/client/ai-customer/ai-customer.controller.ts:350-450`（legacy SSE 传 `onTransfer`）
- Modify: `apps/api/src/client/ai-customer/ai-customer.controller.ts:70-80`（`test-chat` 生产禁用）
- Modify: `apps/api/src/client/ai-customer/ai-message.listener.ts:86`（删除无 emitter 的 `@OnEvent` 死路径，或加启动告警）
- Test: `apps/api/src/client/ai-customer/ai-customer.confirm.spec.ts`、`apps/api/src/client/ai-customer/ai-customer.controller.spec.ts`（若不存在则新建）

**Interfaces:**
- Consumes: Task 4 的 `issueConfirmCard` 返回值。
- Produces: `ai_traces.status` 在卡片未创建时写 `CONFIRM_REJECTED`；`test-chat` 在 `NODE_ENV === 'production'` 时抛 `ForbiddenException`；gate 拦截 / handoff reset 时 `expireForConversation(conversationId, 'transferred')`。

- [ ] **Step 1: 写失败测试**

```ts
it('routeConfirm 未创建卡片时 trace 不记 CONFIRM', async () => {
  issueConfirmCard.mockResolvedValue({ requestId: null, created: false });
  const status = await service.resolveTurnStatus(...);
  expect(status).toBe('CONFIRM_REJECTED');
});

it('生产环境禁用 test-chat', async () => {
  process.env.NODE_ENV = 'production';
  await expect(controller.testChat(dto, 'u1')).rejects.toThrow(ForbiddenException);
});

it('非成员会话：不写 trace、不转人工、不发布消息', async () => {
  prepareThread.mockRejectedValue(new NotFoundException('not a member'));
  await service.chatStream('hi', 'attacker', undefined, callbacks, 'conv-victim');
  expect(recordErrorTrace).not.toHaveBeenCalled();
  expect(degradeToHuman).not.toHaveBeenCalled();
  expect(publishAiReply).not.toHaveBeenCalled();
});

it('转人工时把待确认动作置 TRANSFERRED', async () => {
  await service.routeTransfer('u1', 'c1', 'explicit_request', callbacks, [], [], 'm1');
  expect(actionLifecycle.markTransferred).toHaveBeenCalledWith('c1');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn workspace @lucky/api test src/client/ai-customer/ai-customer.confirm.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`routeConfirm` 返回 `issueConfirmCard` 的结果；`finalizeAfterStream` 的 `confirmCard` 分支使用「`created === true` → `CONFIRM`；否则 `CONFIRM_REJECTED`」。legacy SSE 增加 `onTransfer` 回调，与两阶段 SSE 一致。`test-chat` 加生产守卫。
gate 拦截路径（人工处理中/已归档）与 `consumeHandoffReset` 都要调用 `actionLifecycle.expireForConversation(conversationId, 'transferred')`，避免 DB 卡片在转人工后仍然 live。
`routeTransfer` 必须调用 `actionLifecycle.markTransferred(conversationId)`（当前零调用方），并让 `confirmWithdrawOtp` 的 CAS 因此拒绝后续执行。
成员校验失败不得产生写操作：`prepareThread` 抛 `NotFoundException` 时，`chatStream` 直接 `callbacks.onDone()` 返回，**不**写 trace、不发 `policyFallback`、不调用 `degradeToHuman`（防止认证用户用任意 cuid 把别人的会话踢出 AI）。
管理端调试快照：`inspectConversationState` 返回 `pendingConfirm` 前用 `maskActionSummary` 脱敏。
删除 `@OnEvent(AI_MESSAGE_REQUESTED)` 死监听（无 emitter），或在启动日志里明确标注 deprecated；保留测试证明生产只走 outbox 路径。

- [ ] **Step 4: 运行测试与类型检查**

Run: `yarn workspace @lucky/api test src/client/ai-customer && yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: PASS / 0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/client/ai-customer
git commit -m "fix(ai): accurate confirm trace status and remove legacy bypasses"
```

---

### Task 12: 文档与全量验证

**Files:**
- Modify: `docs/system-review/2026-11-22-ai-customer-flow-audit.md`（状态列更新为已修/待修）
- Modify: `docs/current-task.md`（A-1…A-11 逐条标记）
- Create: `docs/system-review/2026-11-23-ai-customer-manual-regression.md`（手工回归清单）

- [ ] **Step 1: 更新审计文档**

把 §3 每条漏洞标记为「已修（commit）/ 待修」；§5 市场对照从调研报告合入；§6 勾掉完成项。

- [ ] **Step 2: 写手工回归清单**

覆盖：活卡片打字确认 → 重发卡；过期卡打字确认 → 明确提示；旧卡点击 → 400；提现错误渠道 → 拒绝；提现正确渠道 → 卡片显示 GCash Withdraw/₱5.80/₱94.20 → OTP 999999 → 结果消息 + 冻结余额 100；模型无执行时不得说「已提交」；配额跨天重置。

- [ ] **Step 3: 全量验证**

Run:
```bash
yarn workspace @lucky/api tsc --noEmit --pretty
yarn workspace @lucky/api test
```
Expected: 0 errors；测试全部通过（仓库既有的 2 个过期 suite 除外）

- [ ] **Step 4: 手工回归**

在本地环境按清单逐项执行；记录每项的实际输出到回归文档。

- [ ] **Step 5: 提交**

```bash
git add docs
git commit -m "docs(ai): record trustworthy-execution fixes and regression results"
```
