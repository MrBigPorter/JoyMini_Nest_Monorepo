# 合成 AI 客服流量 P0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在生产专用渠道 `simulation_support_v1` 中，用 30 个测试账号、5 并发、像人一样的随机问题，真实走 `chat/business + Socket send_message`，积累会话、意图、RAG、token、flow 与隐式反馈数据。

**Architecture:** 一次性创建专用客服渠道与 30 个账号池；Node 无头 driver 复用 Flutter 同一协议（HTTP 登录 + Socket 发消息），按场景库随机提问；纯函数生成问题/延迟，driver 负责会话与等待 AI 回复；运行报告输出覆盖率与异常。

**Tech Stack:** Node 18+ ESM、`socket.io-client`、`fetch`、`node:test`；无新增运行时依赖（`socket.io-client` 已在仓库）。

**Spec:** `docs/superpowers/specs/2026-11-20-synthetic-ai-customer-traffic-design.md`

## Global Constraints

- 账号数：30；并发：5
- 渠道：`simulation_support_v1`（或复用 official + `trafficSource=simulation_support_v1`）
- 固定 OTP：`999999`
- 写操作只到确认卡片，永不调用 `/confirm` 或 `/confirm/otp`
- 存款、取款、购买、领券、抽奖等真实资金/库存流程不在 P0 执行；由人工后续验证
- 消息间隔 5–60 秒；每会话 2–6 轮
- 不把 token/手机号写入日志；运行态文件放 `tools/simulator/.runtime/` 并 gitignore
- 不新增数据库表；数据隔离靠 `Conversation.aiMetadata.trafficSource` + 专用渠道 botUserId

## Review Focus

- **确认卡片被误执行**：driver 必须把 `ai_confirm` 视为终止信号，不调用任何确认接口；也不得创建支付单/订单/提现单
- **OTP 建号被 IP 限流**：30 个账号必须分批，每批 5 个、间隔 60 秒
- **Socket 事件形态不一致**：等待 `chat_message` 时同时兼容 `isAi=true` 与 `senderId=botUserId`
- **模拟流量污染真实指标**：所有会话必须带 `aiMetadata.trafficSource=simulation_support_v1`，报告按该标记校验
- **无回复/超时**：每轮等待上限 90 秒，超时记 `no_reply` 并结束会话，不无限挂起

---

### Task 1: 专用渠道与账号池

**Files:**

- Create: `tools/simulator/config.mjs`
- Create: `tools/simulator/provision.mjs`
- Create: `tools/simulator/README.md`
- Modify: `.gitignore`（追加 `tools/simulator/.runtime/`）
- Test: 手动运行 `node tools/simulator/provision.mjs --count 2`（临时 2 个）

**Interfaces:**

- Produces: `loadConfig(): { apiBaseUrl, socketUrl, businessId, accountCount, concurrency, otpCode, runtimeDir }`
- Produces: `provisionAccounts({ count, startIndex }): Promise<Account[]>`
- `Account = { phone, userId, token, refreshToken, deviceId }`
- Produces: `.runtime/accounts.json`（权限 600）

- [ ] **Step 1: 写配置读取**

`config.mjs` 从 env 读取并给默认值：
`SIM_API_BASE_URL=https://api.joyminis.com/api`、`SIM_SOCKET_URL=https://api.joyminis.com/events`、`SIM_BUSINESS_ID=simulation_support_v1`、`SIM_ACCOUNT_COUNT=30`、`SIM_CONCURRENCY=5`、`SIM_OTP_CODE=999999`。API 路径统一写 `/v1/...`，socket 连接使用 `/events` namespace。

- [ ] **Step 2: 写建号脚本**

`provision.mjs`：

1. 生成 PH 手机号 `+63917` + 7 位数字
2. `POST /api/v1/otp/request {phone}`
3. `POST /api/v1/otp/verify {phone, code}`
4. `POST /api/v1/auth/login/otp {phone}`
5. 取 `data.tokens.accessToken`、`data.tokens.refreshToken` 与 `data.id`（兼容 `data.user.id`）
6. 每个账号 `deviceId = sim-<phone>-<random>`
7. 每 5 个账号等待 60 秒；写入 `.runtime/accounts.json`

- [ ] **Step 3: 渠道存在性检查**

启动时 `GET /api/v1/chat/business?businessId=simulation_support_v1` 用第一个账号 token 探测；404/403 时提示先创建渠道，不自动创建。

- [ ] **Step 4: 文档**

README 写：如何创建渠道（admin UI/API）、如何跑 provision、如何清理。

- [ ] **Step 5: 验证**

Run: `node tools/simulator/provision.mjs --count 2`
Expected: `.runtime/accounts.json` 有 2 个账号，token 可用 `/api/v1/auth/profile` 返回 200。

- [ ] **Step 6: Commit**

```bash
git add tools/simulator .gitignore
git commit -m "feat(sim): 合成流量账号池与配置"
```

---

### Task 2: 场景库与问题生成

**Files:**

- Create: `tools/simulator/scenarios.mjs`
- Test: `tools/simulator/scenarios.test.mjs`

**Interfaces:**

- `SCENARIOS: Scenario[]`，`Scenario = { id, intent, turns: string[], expectConfirm?: boolean, expectTransfer?: boolean, special?: string }`
- Produces: `pickScenario(options?: { excludeIntents?: string[] }): Scenario`
- Produces: `renderTurns(scenario, rng): string[]`（替换 `{city}`、`{amount}`、`{orderId}` 等槽位）
- Produces: `coverageOf(used: Scenario[]): Record<string, number>`

- [ ] **Step 1: 写失败测试**

`scenarios.test.mjs`：

```js
test("场景覆盖 9 个 intent + 特殊场景", () => {
  const intents = new Set(SCENARIOS.map((s) => s.intent));
  for (const i of [
    "order",
    "wallet",
    "coupon",
    "product",
    "user",
    "kyc",
    "lucky-draw",
    "rag",
    "general",
  ]) {
    assert.ok(intents.has(i), i);
  }
  assert.ok(SCENARIOS.some((s) => s.expectTransfer));
  assert.ok(SCENARIOS.some((s) => s.expectConfirm));
  assert.ok(SCENARIOS.some((s) => s.special === "injection"));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tools/simulator/scenarios.test.mjs`
Expected: FAIL，`SCENARIOS` 未定义。

- [ ] **Step 3: 实现场景库**

每个 intent 至少 3 个场景；`expectConfirm: true` 的场景只发到确认卡片；`special` 覆盖 `transfer`、`correction`、`injection`、`ambiguous`。

- [ ] **Step 4: 实现随机与渲染**

`pickScenario` 用加权随机，避免连续重复；`renderTurns` 用固定槽位库替换；`coverageOf` 计数。

- [ ] **Step 5: 运行测试**

Run: `node --test tools/simulator/scenarios.test.mjs`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add tools/simulator/scenarios.mjs tools/simulator/scenarios.test.mjs
git commit -m "feat(sim): 场景库与随机问题生成"
```

---

### Task 3: 像人一样的消息节奏

**Files:**

- Create: `tools/simulator/humanize.mjs`
- Test: `tools/simulator/humanize.test.mjs`

**Interfaces:**

- `nextDelayMs(rng): number`（5000–60000）
- `humanize(text, rng, opts?: { language?: 'zh'|'en' }): string`（偶尔加语气词/错别字）
- `pickPersona(rng): Persona`，`Persona = { language, style: 'short'|'normal'|'impatient' }`

- [ ] **Step 1: 写失败测试**

```js
test("delay 在 5–60 秒", () => {
  for (let i = 0; i < 100; i++) {
    const d = nextDelayMs(Math.random);
    assert.ok(d >= 5000 && d <= 60000);
  }
});
test("humanize 不改变空串", () => assert.equal(humanize("", Math.random), ""));
```

- [ ] **Step 2: 实现**

`nextDelayMs` 用 `rng()` 映射；`humanize` 对非空文本 20% 追加“呢/啊/谢谢”，5% 把“的”换成“得”等轻量噪声；不做不可读乱码。

- [ ] **Step 3: 运行测试**

Run: `node --test tools/simulator/humanize.test.mjs`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add tools/simulator/humanize.mjs tools/simulator/humanize.test.mjs
git commit -m "feat(sim): 人类化延迟与文本扰动"
```

---

### Task 4: Socket 单会话 driver

**Files:**

- Create: `tools/simulator/driver.mjs`
- Test: 无单测；用 Task 5 的 `--once` 做集成验证

**Interfaces:**

- `runConversation(account, scenario, opts): Promise<ConversationResult>`
- `ConversationResult = { conversationId, turnsSent, replies, confirms, transferred, noReply, errors }`
- Driver 在 401 时调用 `refreshAccountToken` 并重试一次
- Consumes `Account`、`Scenario`、`renderTurns`、`humanize`、`nextDelayMs`
- 使用 `socket.io-client`，连接 `socketUrl`，`auth: { token }`

- [ ] **Step 1: 实现 HTTP 开会话**

`GET /api/v1/chat/business?businessId=simulation_support_v1`，带 `Authorization: Bearer`；返回 `conversationId`。

- [ ] **Step 2: 实现 Socket 连接**

`io(socketUrl, { auth: { token }, transports: ['websocket'] })`；等待 `connect`，超时 10s 报错。

- [ ] **Step 3: 发送与等待**

对每个 turn：

- `emit('send_message', { conversationId, content, type:0, tempId: randomUUID() }, ack)`
- 等待 `chat_message` 且 `conversationId` 匹配且 `isAi === true`（兼容 `senderId === botUserId`）
- 同时监听 `ai_confirm`（标记 `confirm` 并结束）、`ai_transfer`（标记 transferred 并结束）
- 90s 无回复 → `noReply++` 并结束

- [ ] **Step 4: 确认安全**

driver 不 import/调用 `/confirm`、`/confirm/otp`；`expectConfirm` 场景只等待 `ai_confirm` 后结束。

- [ ] **Step 5: 关闭会话**

`emit('leave_chat')` 或 `socket.disconnect()`；不调用关闭会话 API。

- [ ] **Step 6: 集成验证**

Run: `node tools/simulator/run.mjs --once --scenario order_status`
Expected: 生成一条 conversation，DB 有用户消息与 AI 回复；无确认执行。

- [ ] **Step 7: Commit**

```bash
git add tools/simulator/driver.mjs
git commit -m "feat(sim): Socket 单会话 driver"
```

---

### Task 5: 5 并发 runner 与报告

**Files:**

- Create: `tools/simulator/run.mjs`
- Create: `tools/simulator/report.mjs`
- Test: `tools/simulator/report.test.mjs`

**Interfaces:**

- `runSwarm({ accounts, scenarios, concurrency, rounds }): Promise<RunResult[]>`
- `summarize(results: RunResult[]): { conversations, replies, confirms, transfers, noReply, byIntent }`
- CLI: `node tools/simulator/run.mjs [--once] [--rounds 3] [--concurrency 5] [--scenario id]`

- [ ] **Step 1: 写报告测试**

```js
test("summary 统计 intent 与异常", () => {
  const s = summarize([
    {
      intent: "order",
      replies: 2,
      confirms: 0,
      transferred: false,
      noReply: false,
      turnsSent: 2,
    },
  ]);
  assert.equal(s.conversations, 1);
  assert.equal(s.byIntent.order, 1);
});
```

- [ ] **Step 2: 实现 report**

`summarize` 纯函数；`writeReport` 输出 `.runtime/runs/<ISO>/summary.json` 与 `events.jsonl`。

- [ ] **Step 3: 实现 runner**

账号池轮转；`p-limit` 自写小并发（Promise 池）避免新增依赖；每轮随机场景、排除最近 intent；错误计入结果不崩进程；`SIGINT` 停止调度。

- [ ] **Step 4: 运行测试**

Run: `node --test tools/simulator/report.test.mjs`
Expected: PASS。

- [ ] **Step 5: 小规模 smoke**

Run: `node tools/simulator/run.mjs --once --concurrency 1`
Expected: 1 会话完成，summary 有 1 conversation。

- [ ] **Step 6: Commit**

```bash
git add tools/simulator/run.mjs tools/simulator/report.mjs tools/simulator/report.test.mjs
git commit -m "feat(sim): 并发 runner 与覆盖报告"
```

---

### Task 6: 生产验证

**Files:**

- Modify: `tools/simulator/README.md`（生产运行步骤）

- [ ] **Step 1: 创建渠道**

在 admin `/support-channels` 创建 `simulation_support_v1`，名称 `Simulation Support`，启用。

- [ ] **Step 2: 建 30 账号**

Run: `node tools/simulator/provision.mjs --count 30`
Expected: 30 个账号，约 6 分钟（OTP IP 限流）。

- [ ] **Step 3: 跑 30 分钟**

Run: `node tools/simulator/run.mjs --rounds 6 --concurrency 5`
Expected: 无进程崩溃；summary 覆盖 9 intents；队列 waiting 不持续增长。

- [ ] **Step 4: 安全检查**

查询 DB：`ChatMessage` 中无 confirm 执行记录；`"ai_metadata"->>'trafficSource'='simulation_support_v1'` 全部隔离；后台 `/ai-ops` 有数据。

- [ ] **Step 5: Commit 报告**

```bash
git add tools/simulator/README.md
git commit -m "docs(sim): 生产运行与验证步骤"
```

---

## 验证

```bash
node --test tools/simulator/*.test.mjs
node tools/simulator/provision.mjs --count 2
node tools/simulator/run.mjs --once --concurrency 1
```

- 2 个账号可登录
- 1 会话有 AI 回复
- 报告 JSON 有 intent/confirm/transfer 计数
- 不产生写操作
- 确认卡片生成后结束，不调用 `/confirm`、`/confirm/otp`

## 人工后续（不在本计划）

- 存款：sandbox 支付回调或人工调账
- 取款：测试通道/人工审核，不对接真实打款
- 购买：测试 SKU、独立库存，不共享生产库存

这些由人工在预发/受控环境验证，不进入生产合成流量 P0。
