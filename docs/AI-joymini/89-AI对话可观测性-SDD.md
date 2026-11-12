# 89 · AI 对话可观测性（traceId + 意图 + 耗时 + token）— SDD

> 版本: v1.6
> 状态: 已完成（本地验收通过；生产 Loki 验收待发布，对应 AC-9/AC-10）
> 日期: 2026-11-11
> 关联: [#87 P2-3](./87-全项目问题总清单.md)、[#85 P2-3](./85-生产化差距审计与企业上线清单.md)、[#86 §10](./86-岗位匹配度评估与两周补齐路线图.md)、`docs/current-task.md` T0-2
> 对应代码: `apps/api/src/client/ai-customer/`、`apps/api/src/common/logger/`（新建）、`apps/api/src/common/middleware/request-id.ts`

---

## 一、概述

### 1.1 背景

`docs/current-task.md` 的 T0-2 要求：**一次 AI 对话能按 traceId 串起来，并看到意图、各阶段耗时、token 用量。** 这是 T0-3（评测）和 T2（AI 质量修复）的前置条件——没有度量，改完无法证明变好。

### 1.2 现状实测（2026-11-11）

| 能力 | 现状 | 问题 |
|---|---|---|
| 请求 ID | 已有 `common/middleware/request-id.ts`，写入 `req.id` 和 `x-request-id` 响应头 | AI 链路**完全没用它**，日志里没有这个字段 |
| 日志格式 | 散落的 `logger.log('[chatStream] message=...')`、`logger.log('[orchestrator] processing labels...')`、`logger.log('[retrieve] ...')` | 纯文本、格式各异，无法 grep 出一次对话 |
| 意图 | `orchestrator.node.ts` 打印 labels 和 fallback 原因 | 只有人眼可读的一句话，没有结构化字段（intent、score、fallback 原因） |
| 耗时 | 无 | 不知道慢在意图、检索还是 LLM |
| token | **全仓零统计**（`grep usage_metadata` 无结果） | 不知道每次对话花多少钱，也无法算成本 |
| 转人工 | `state.transferToHuman` 最终有值 | 只在业务逻辑里用，没有可统计的事件 |
| 日志隔离 | 无请求级上下文 | 并发对话的日志交错，无法区分 |
| 采集端 | **已对接 Loki + Grafana**（infra-platform，`monitor.joyminis.com`）。2026-11-11 实地确认：监控栈与 `lucky-backend-prod` 运行在同一台主机（`129.121.97.120`），同机有 `infra-promtail` / `infra-loki`；Promtail 通过 `docker.sock` 自动发现容器，Loki 日志保留 10 天 | 有地方查，但现有日志是纯文本，Loki 里只能全文 grep，无法按意图/耗时/token 聚合 |

### 1.3 设计原则

1. **复用已有设施**：traceId 用中间件已生成的 `req.id`；日志直接以**纯 JSON 行写 stdout**，由已存在的 Loki 采集与查询。不引入 OpenTelemetry / Prometheus / 新依赖。JSON 行同时是 OTel 的天然上游——以后要接 trace/metrics，字段可直接迁移。
2. **只记录、不改业务**：埋点失败不能影响对话；所有埋点 `try/catch` 包裹，任何异常只 warn 一次。
3. **不记录内容**：用户问题与 AI 回答只记录长度和哈希，不落原文（P2-7 数据合规的前置约束）。
4. **一个请求一条链**：traceId 在一次 SSE 请求内不变，贯穿 controller → service → LangGraph 节点 → 检索层。
5. **可单测**：trace 上下文和日志格式器是纯函数/纯工具，不依赖 Nest 容器。

---

## 二、目标

| ID | 目标 | 衡量 |
|:--:|---|---|
| G1 | 一次对话的全部关键节点可按 traceId 串起来 | 用 `x-request-id: obs-test-1` 请求一次，grep 出 6+ 条同 traceId 日志 |
| G2 | 每个阶段有耗时 | `intent` / `retrieval` / `llm` 三条事件均带 `latencyMs` |
| G3 | 知道每次对话的 token 消耗 | `llm.usage` 事件含 `promptTokens` / `completionTokens` / `totalTokens` |
| G4 | 转人工与错误可统计 | `chat.done` 带 `transferred`；`chat.error` 带错误类型与阶段 |

**本期不做**：OTel 接入、Prometheus 指标、日志采集/告警、前端展示、badcase 回流、成本看板、采样。

---

## 三、功能需求

### FR-1 trace 上下文（新建 `common/logger/trace-context.ts`）

用 `AsyncLocalStorage` 保存当前请求的 traceId，避免把 traceId 作为参数穿过 10 层函数。

```ts
runWithTrace<T>(traceId: string, fn: () => Promise<T>): Promise<T>
getTraceId(): string | undefined
```

接入点：

- `ai-customer.controller.ts` 的 SSE 入口（`chatStream` 与 `chatStreamLegacy` 两处）：`await runWithTrace(req.id ?? randomUUID(), () => this.aiCustomerService.chatStream(...))`
- traceId 直接取中间件已生成的 `req.id`，客户端传 `x-request-id` 时沿用，便于跨系统排障。
- 无 trace 上下文时 `getTraceId()` 返回 `undefined`，日志器降级为 `"traceId":"-"`，不抛错。

**兜底**：若实测发现 LangGraph 内部丢失 ALS 上下文，则在 `streamEvents(config)` 里同时放入 `configurable: { thread_id, traceId }`，节点从第二个参数 `config` 读取。两条路径以实测结果为准，接口不变。

### FR-2 结构化日志器（新建 `common/logger/structured-logger.ts`）

```ts
emitStage(stage: Stage, fields: Record<string, unknown>): void
```

输出**一行纯 JSON 到 stdout**（`process.stdout.write(JSON.stringify(obj) + '\n')`）：

```json
{"ts":"2026-11-11T10:00:00.123Z","level":"info","app":"api","env":"production","traceId":"obs-test-1","conversationId":"c-1","stage":"intent","intent":"order","labels":[{"label":"order","score":0.87}],"fallback":"none","latencyMs":182}
```

**为什么不走 Nest `Logger.log`**：Nest 会在每行前面加 `[Nest] pid - timestamp LOG [Context]`，整行不再是合法 JSON，Loki 的 `| json` 解析器无法直接取字段，只能退回脆弱的正则。AI 对话的结构化事件直接写 stdout，Loki 收到的就是 JSON 对象；其余模块的普通日志保持原样（纯文本），互不影响。

约定：

- 固定字段：`ts`（ISO8601）、`level`（`info`/`warn`/`error`）、`env`（`NODE_ENV`）、`traceId`、`stage`。
- **不要输出 `service` 字段**：Loki 已有来自 compose 的 `service="backend"` label，同名字段在查询时会被重命名为 `service_extracted`，徒增困惑。用 `app: "api"` 表达应用名。
- 可选上下文：`conversationId`、`userId`（仅 ID，不含昵称/手机号）。
- `stage` 枚举：`chat.start` / `intent` / `retrieval` / `llm.usage` / `tool.start` / `tool.end` / `transfer` / `chat.done` / `chat.error`。
- 序列化用 `JSON.stringify`；异常对象只取 `name` / `message`（不展开堆栈）；禁止多行字符串，保证一行一条。
- `emitStage` 自身用 `try/catch` 包裹，任何失败只 `logger.warn` 一次，绝不向上抛。
- 日志级别映射到 `level` 字段，不依赖 Nest 的日志级别过滤。

### FR-3 各阶段埋点

| stage | 位置 | 必填字段 |
|---|---|---|
| `chat.start` | `ai-customer.service.ts` `chatStream()` 入口 | `entryPoint?`、`messageLength`、`conversationId?` |
| `intent` | `orchestrator.node.ts`（三处 return 前：空 labels / 低于 MIN_SCORE / 正常路由） | `intent`（最高分 label 或 `general`）、`labels`（top3 label+score）、`fallback`（`no_labels`/`below_min_score`/`none`）、`latencyMs`（进入节点到决策完成） |
| `retrieval` | `rag-retrieval.service.ts` `retrieve()` 返回前 | `layers`（各层命中数）、`candidates`、`returned`、`topScore`、`latencyMs` |
| `llm.usage` | `ai-stream.handler.ts` 收 `on_chat_model_end` | `model?`、`node`、`promptTokens`、`completionTokens`、`totalTokens`、`usageSource`（`provider`/`unavailable`） |
| `tool.start` / `tool.end` | `ai-stream.handler.ts` 现有分支 | `tool`、`durationMs`（end 时） |
| `transfer` | `ai-customer.service.ts` `routeTransfer()` 前 | `reason`（来自 `transfer-detector` 或 state）、`source` |
| `chat.done` | `finalizeAfterStream()` 三路分发完成前 | `totalMs`、`transferred`、`confirmCard`、`tokenTotal` |
| `chat.error` | `handleStreamError()` | `errorName`、`errorMessage`、`stage`（尽量标出出错阶段）、`totalMs` |

意图节点的 `latencyMs` 从节点函数第一行 `Date.now()` 开始计时；检索耗时在 `retrieve()` 内部计时；LLM 耗时按模型调用累计（见 FR-4）。

### FR-4 token 用量

1. `graph/llm-factory.ts` 的 `ChatOpenAI` 构造参数增加 `streamUsage: true`（`@langchain/openai` v1.5.3 已支持，已在 `types.d.ts:47` 确认）。
2. `ai-stream.handler.ts` 监听 `on_chat_model_end`，从 `data.output?.usage_metadata` 读取 `input_tokens` / `output_tokens` / `total_tokens`，每次调用发一条 `llm.usage`。
3. 一条对话可能有多次模型调用（意图、工具循环、最终回答），`chat.done.tokenTotal` 为累计值。
4. **降级**：`usage_metadata` 缺失（本地 Ollama、或供应商未返回）时，发一条 `usageSource: "unavailable"` 的 `llm.usage`，字段为 `null`，不重试、不抛错。
5. 成本不在代码里固化价格表；后续用日志里的 token 数按当时单价离线计算。

**验证**：对 DeepSeek 发一次真实对话，`chat.done.tokenTotal > 0`；对本地 Ollama 发一次，日志出现 `unavailable` 且对话正常完成。

### FR-5 意图可观测性

`orchestrator.node.ts` 的三条出口都要发 `intent` 事件，并区分原因：

| 出口 | `intent` | `fallback` |
|---|---|---|
| `labels.length === 0` | `general` | `no_labels` |
| 无 label 达到 `MIN_SCORE` | `general` | `below_min_score` |
| 正常路由 | top-1 label | `none` |

`labels` 只记 top3，避免超长日志。

### FR-6 检索可观测性

`retrieve()` 内部记录每层命中数（`vector` / `meilisearch` / `ilike` / `fulltext`）、合并候选数、rerank 后返回数、最高分、耗时。**不改变 `retrieve()` 的返回类型和签名**——埋点从 ALS 读取 traceId 后直接输出，调用方无感知。

### FR-7 不记录内容（隐私约束）

- 用户消息：只记 `messageLength` + `sha256` 前 8 位（便于关联同一条问题，不可还原）。
- AI 回答：只记 `answerLength`。
- 不记录 token 原文、手机号、地址、订单号等业务字段。
- 兼容性：`chatStream` 现有 `logger.log(\`[chatStream] message="${message.slice(0,50)}..."\`)` **删除**，改为 `messageLength`。

### FR-8 失败隔离

- `emitStage` 内部 `try/catch`：序列化失败、循环引用 → 输出 `{"stage":"logger.error","reason":"..."}`，不抛。
- 埋点失败绝不进入 `handleStreamError`，不影响 SSE 输出字节。
- 每请求日志条数上限约 10 条，不做批量/缓冲。

### FR-9 Loki 对接约定

**已核实的环境（2026-11-11）**：

| 项 | 实际情况 |
|---|---|
| 监控栈位置 | `129.121.97.120`：`infra-promtail`、`infra-loki`、`infra-auth`，与 `lucky-backend-prod` 同机 |
| 采集方式 | Promtail `docker_sd_configs` 挂载 `docker.sock`，自动发现所有容器（不需要按项目配置） |
| Loki 版本 / 存储 | Loki 3.4 / filesystem chunks，`retention_period: 240h`（10 天） |
| 自动标签 | `container`、`compose_project`、`service`、`stream`、`level` |
| Promtail JSON 解析 | `json` stage 提取 `level` / `msg` / `requestId` / `context`，仅把 `level` 提升为 label；未配置 `drop_malformed`，非 JSON 行**原样透传**（不会被丢弃，但查询时 `\| json` 会跳过） |
| 本仓库 Docker 日志驱动 | `json-file`，`max-size:10m, max-file:3`；Promtail 持续 tail，轮转不影响已采集数据 |
| 实测现有日志行 | `lucky-backend-prod` 已入库（Loki 返回 1684 行/15 分钟），stream 标签：`compose_project="lucky"`、`service="backend"`、`container`、`stream="stdout"`、`detected_level="unknown"`；行内容带 **Nest 前缀 + ANSI 颜色码**（`\u001b[32m[Nest] 49 - ...`） |
| 结论 | 现有文本行无法 `\| json`；结构化事件必须纯 JSON、无 ANSI——确认了 FR-2 走 `process.stdout.write` 的必要性 |

本仓库只需保证**输出契约**：

| 约定 | 说明 |
|---|---|
| 单行纯 JSON | 事件行必须能被 Promtail `json` stage 和 Loki `\| json` 解析；不带 ANSI 颜色码、不带 Nest 前缀、不含换行 |
| `level` 字段 | 会被提升为 Loki label（低基数），只使用 `info` / `warn` / `error` |
| 字段命名稳定 | 驼峰、不复用同义字段（如不要同时出现 `intent` 和 `intentName`） |
| traceId 不做 label | Loki label 是低基数索引，traceId 基数极高；只作为 JSON 字段，用 `\| json` 过滤。**不需要改 Promtail 配置** |
| 不记录内容 | 见 FR-7，Loki 10 天留存期内也不能出现用户原文 |
| 与普通日志共存 | 非 JSON 文本行同样入库；查询时用 `stage` 字段过滤，避免噪声 |
| 避免与 stream label 撞名 | Promtail 已注入 `container` / `compose_project` / `service` / `stream` / `level`。事件里不要再用这些名字做 JSON 字段（`level` 例外：它会被提升为同名 label，正是我们需要的）；撞名字段会被 LogQL 改名为 `xxx_extracted` |
| 无 ANSI | 实测现有 Nest 文本日志带颜色码；结构化事件必须走 `process.stdout.write`，不能经过 Nest `Logger`（会自动着色） |

LogQL 示例（发布后可直接在 Grafana Explore 使用）：

```logql
# 一次对话的完整链路（container 名已在生产环境确认）
{container="lucky-backend-prod"} | json | traceId="obs-test-1"

# 最近 1 小时意图分布
sum by (intent) (count_over_time({container="lucky-backend-prod"} | json | stage="intent" [1h]))

# LLM 阶段 P95 耗时
quantile_over_time(0.95, {container="lucky-backend-prod"} | json | stage="llm.usage" | unwrap latencyMs [1h])

# 转人工率
sum(count_over_time({container="lucky-backend-prod"} | json | stage="chat.done" | transferred="true" [1h]))
/
sum(count_over_time({container="lucky-backend-prod"} | json | stage="chat.done" [1h]))
```

**已知限制**：

- Loki 保留 10 天，超过后自动删除；需要长期留存要改 infra-platform 配置（不在本期范围）。
- Promtail 的 `positions.yaml` 在 `/tmp`，容器重启后可能重读部分日志，产生少量重复行——对按 traceId 查询无影响。
- 生产主机上同时存在两个 `lucky-backend-prod` 容器（`129.121.97.120` 与 `107.175.53.104` 各一套），需确认哪个是真正对外服务的生产环境；本文默认 `129.121.97.120`。若实际不是，查询时把 `container` 换成实际主机上的容器名即可，字段契约不变。

---

## 四、非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | 单条 `emitStage` < 1ms（`JSON.stringify` + 一次 stdout 写） |
| 输出 | 单行纯 JSON，可被 Loki `\| json` 解析；无 Nest 前缀、无颜色码、无换行 |
| 依赖 | **不新增 npm 包**；不引入 OTel |
| 并发 | 5 个并发会话，日志中不得出现 traceId 与 conversationId 交叉错配 |
| 兼容 | 本地 Ollama、DeepSeek 云端都能跑；无 trace 上下文的旧调用路径正常 |
| 可回滚 | 所有埋点都是旁路；删除 `common/logger/` 并还原 5 处调用即可回滚，无 DB/接口变更 |

---

## 五、文件清单

| 文件 | 动作 | 内容 |
|---|---|---|
| `apps/api/src/common/logger/trace-context.ts` | 新建 | AsyncLocalStorage + `runWithTrace` / `getTraceId` |
| `apps/api/src/common/logger/structured-logger.ts` | 新建 | `emitStage`：纯 JSON 写 stdout、字段白名单、错误隔离 |
| `apps/api/src/common/logger/trace-context.spec.ts` | 新建 | 并发隔离、嵌套、无上下文 |
| `apps/api/src/common/logger/structured-logger.spec.ts` | 新建 | JSON 结构、隐私字段、循环引用不抛 |
| `apps/api/src/client/ai-customer/ai-customer.controller.ts` | 修改 | 两处 SSE 入口包 `runWithTrace` |
| `apps/api/src/client/ai-customer/ai-customer.service.ts` | 修改 | `chat.start` / `transfer` / `chat.done` / `chat.error`，删原文日志 |
| `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts` | 修改 | 三条出口发 `intent` 事件 |
| `apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts` | 修改 | `retrieve()` 结束发 `retrieval` 事件 |
| `apps/api/src/client/ai-customer/ai-stream.handler.ts` | 修改 | `on_chat_model_end` → `llm.usage`；tool 耗时 |
| `apps/api/src/client/ai-customer/graph/llm-factory.ts` | 修改 | `streamUsage: true` |

预计改动 ~250 行（含测试），1~1.5 天。

---

## 六、测试计划

### 6.1 单元测试

| 用例 | 断言 |
|---|---|
| `runWithTrace` 嵌套 | 内层取到内层 id，外层取回外层 id |
| 5 个并发 `runWithTrace` | 每个回调内 `getTraceId()` 与传入值一致，无交叉 |
| 无上下文调用 | `getTraceId()` 返回 `undefined`，`emitStage` 输出 `"traceId":"-"` |
| `emitStage` 隐私 | 传入 `message` 字段不会被输出；只允许白名单字段 |
| `emitStage` 循环引用 | 不抛异常，输出降级行 |

### 6.2 手工验收命令

```bash
# 1. 发一次带固定 request-id 的对话（token 从现有登录流程获取，不在此文档贴明文）
curl -N -H "Authorization: Bearer <TOKEN>" \
     -H "x-request-id: obs-test-1" \
     -H "Content-Type: application/json" \
     -d '{"message":"怎么退货"}' \
     http://localhost:3000/api/v1/client/ai-customer/chat

# 2. 按 traceId 还原整条链路
docker logs lucky-backend-dev 2>&1 | grep 'obs-test-1'
```

预期至少出现：`chat.start` → `intent` → `retrieval` → 若干 `llm.usage` → `chat.done`。

### 6.3 并发验收

同时发 5 个不同 `x-request-id` 的请求，确认每条日志的 `traceId` 各自一致、`conversationId` 不串。

---

## 七、验收标准

| ID | 验收 | 判定 |
|:--:|---|---|
| AC-1 | 一次请求产出 6 条以上同 traceId 的 JSON 日志，覆盖 start/intent/retrieval/llm/done | grep 通过 |
| AC-2 | `intent` 事件含 top3 labels、选定意图、fallback 原因 | 三种出口各跑一次 |
| AC-3 | `retrieval` 事件含各层命中数、候选数、topScore、耗时 | 日志字段齐全 |
| AC-4 | DeepSeek 对话 `tokenTotal > 0`；Ollama 对话出现 `usageSource:"unavailable"` 且不报错 | 两次真实对话 |
| AC-5 | `chat.done` 含 `transferred`；触发转人工时另有 `transfer` 事件 | 构造关键词触发 |
| AC-6 | 日志中搜不到用户原文（用一段独特字符串发请求后 grep 不到） | grep 无结果 |
| AC-7 | 5 个并发请求 traceId 不交叉 | 人工核对 |
| AC-8 | `tsc --noEmit` 0 error；现有单测全绿；SSE 输出行为不变 | CI 命令 |
| AC-9 | 部署后 Loki 中 `{container="lucky-backend-prod"} \| json \| traceId="<id>"` 可查到一次对话的全部阶段 | Grafana Explore 手工验证（AC-9 依赖部署，不阻塞本地验收） |
| AC-10 | 事件行能被 Promtail `json` stage 解析（`level` 成为 label，其余字段可查询） | 部署后在 Grafana 按 `level="info"` + `traceId` 过滤验证 |

---

## 七之二、验收记录（2026-11-11，本地 dev 环境）

实施完成后用真实对话验证（`lucky-backend-dev`，DeepSeek，Flutter web 客户端）。

| ID | 结果 | 证据 |
|:--:|---|---|
| AC-1 | ✅ | `a087bacc6e3640c4bc97b721f351008c` 一条 traceId 串起 5 条：`chat.start` → 2×`llm.usage` → `transfer` → `chat.done`；另一次对话 `a57dbf40…` 串起 7 条（含 `intent`、`retrieval`） |
| AC-2 | ✅（4 出口全覆盖） | `below_min_score`（15:17）与 `none`（15:09）实测；`no_labels` 由 `orchestrator.node.spec.ts` 单元用例覆盖；**转人工出口原先不发 `intent`**，复审时补上（`intent:'transfer'`, `fallback:'transfer_request'`），否则意图分布会漏掉全部转人工对话（#87 N-11） |
| AC-3 | ✅ | `{"layers":{"vector":20,"meili":0,"chunk":0,"doc":0},"candidates":20,"returned":3,"topScore":0.5967,"latencyMs":2650}` |
| AC-4 | ✅ | `tokenTotal` 实测 1275 / 1072 / 120，均 `usageSource:"provider"` |
| AC-5 | ✅ | 发送「我要转人工」→ `transfer` 事件 + `chat.done.transferred:true`。复审修正：`reason` 原先写死 `transfer_flag`、Socket 用 `ai_determined`，现已统一为 `explicit_request / negative_sentiment / repeated_attempts`（#87 N-11） |
| AC-6 | ⚠️ 口径修正 | 结构化事件 0 泄露。全量 `grep` 命中的原文来自基础设施日志，见下方「实施中发现并修复」；残留的 SQL/请求体日志仅 dev 生效（`isDev` / `!isProd` 开关），生产不输出 |
| AC-7 | ⚠️ | 单测覆盖 5 并发随机延迟隔离；真实并发未压测 |
| AC-8 | ✅ | `tsc --noEmit` 0 error；`src/common` + `src/client/ai-customer` 共 13 suites / 187 tests 全绿（含 `transfer-detector.spec.ts` 20 例、`orchestrator.node.spec.ts` 4 例、`events.gateway.spec.ts` 4 例）。API 全量 279 例中 3 例失败（`auth` 1 / `flash-sale` 2），已验证在本次改动前的基线上同样失败，与可观测性无关 |
| AC-9 | ⏳ | 依赖发布到 `lucky-backend-prod` |
| AC-10 | ⏳ | 依赖发布后 Grafana 验证 |

### 实施中发现并修复（超出原设计范围）

1. **事件入口没有 traceId**：App 的 AI 对话走的是 `AiMessageListener`（`AI_MESSAGE_REQUESTED` 事件），不是 SSE 两阶段接口，没有 `req.id`，导致全部事件 `traceId:"-"`。已在监听器入口用 `randomUUID()` 建上下文。
2. **转人工检测被分数门槛短路**（行为缺陷）：`detectTransferRequest` 原本在 `MIN_SCORE` 过滤之后，低置信度请求在到达它之前就 `return` 了——用户越着急、表达越不标准，越检测不到转人工。已把检测块移到函数最前（见 `orchestrator.node.ts` 第 0 节）。
3. **三处隐私泄露**（PR-7）：
   - `MeilisearchService` 打印检索全文 → 改为字符数
   - `EventsGateway.dispatch` 打印 payload 前 200 字符 → 生产环境 `[redacted]`
   - `AiMessageListener` 打印用户消息前 50 字 → 改为字符数
   另清理 `intent-router` / `intent-classifier` / `multi-intent-decider` / `orchestrator` 中 7 处日志原文。

### 尚未覆盖

- ~~**socket 重连后不重放 `join_chat`**~~ → 已在 #87 N-9 从服务端解决（2026-11-12）：`publishAiReply` 原来只发会话房间，导致 `SocketListener` 的私有房间兜底从未生效。现改为 `EventsGateway.dispatchToConversation`（会话房间 + 成员 `user_X` 私有房间，`.except()` 去重），投递不再依赖客户端是否重放 `join_chat`。真机验证待一次后端重启后进行。

---

## 八、风险与权衡

| 风险 | 影响 | 应对 |
|---|---|---|
| LangGraph 内部任务丢失 ALS 上下文 | 节点日志无 traceId | 兜底：`configurable.traceId` 传入，节点从 `config` 读取；不改变调用方接口 |
| DeepSeek 不返回 usage（或 `streamUsage` 未生效） | token 指标缺失 | 发 `usageSource:"unavailable"` 并在验收时显式检查；确认 `@langchain/openai` 版本支持 `stream_options.include_usage` |
| 一次对话多次模型调用导致日志过多 | 日志噪声 | 每次调用一条 `llm.usage`，总量仍 < 10 条/轮；后续可加采样 |
| 结构化 JSON 嵌在 Nest 文本日志里 | 采集器解析不便 | **已规避**：事件直接写 stdout，Loki `\| json` 直接解析；普通文本日志不受影响 |
| Docker 日志轮转 10m × 3 | 已核实：Promtail 持续 tail，轮转不影响已采集数据；真正的留存上限是 Loki 10 天 | 无需处理；长期留存另行调整 infra-platform |
| 埋点侵入业务代码 | 回归风险 | 纯旁路 + 单测 + 埋点失败隔离；回滚只需删 5 处调用 |

**为什么不直接上 OpenTelemetry**：Loki 已经能查日志，本期缺的是"日志里有没有可用字段"；先把字段和 traceId 补齐，Loki 立刻能按意图/耗时/token 聚合。OTel 的 span/attribute 与本文字段一一对应，等要做指标看板或分布式追踪时再迁移，不需要返工。

---

## 九、实施顺序（教学式，一步一文件）

1. `trace-context.ts` + 单测
2. `structured-logger.ts` + 单测
3. `ai-customer.controller.ts` 注入 trace（验证 `chat.start` 能打出 traceId）
4. `ai-customer.service.ts` 的 start/done/error/transfer
5. `orchestrator.node.ts` 的 `intent`
6. `rag-retrieval.service.ts` 的 `retrieval`
7. `llm-factory.ts` + `ai-stream.handler.ts` 的 token 与 tool 耗时
8. 跑 AC 验收命令，回填 #87 P2-3 / current-task T0-2

---

## 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-11 | v1.0 | 首版：基于现有 `request-id` 中间件 + Nest Logger，定义 trace 上下文、结构化事件、意图/检索/token/转人工埋点与验收标准 |
| 2026-11-11 | v1.1 | 按「Loki 已对接」修订：事件改为纯 JSON 写 stdout（避开 Nest 前缀导致 `\| json` 失败）；新增 FR-9 Loki 对接约定与 LogQL 示例、AC-9；补充日志轮转限制 |
| 2026-11-11 | v1.2 | 实地核实监控栈：与 `lucky-backend-prod` 同机（`129.121.97.120`），Promtail docker.sock 采集、Loki 3.4 保留 10 天、仅 `level` 提升为 label；按实际 Promtail 配置更新 FR-9，新增 AC-10；记录双生产容器待确认 |
| 2026-11-11 | v1.3 | Loki API 实测：`lucky-backend-prod` 已在入库（`compose_project="lucky"`、`service="backend"`），现有行含 Nest 前缀与 ANSI，确认必须纯 JSON；事件字段去掉 `service`（与 label 撞名）改用 `app`，补充撞名与 ANSI 约定 |
| 2026-11-11 | v1.4 | 实施完成并本地验收：状态改为已完成；新增「七之二 验收记录」（AC-1~AC-8 结果与证据）；记录实施中发现的 3 类问题（事件入口缺 traceId、转人工检测被分数门槛短路、三处隐私泄露）及修复；AC-9/AC-10 待发布后验证 |
| 2026-11-11 | v1.5 | 提交后代码复审：修 2 个逻辑缺陷（N-10 转人工词表 `'烦'`/`'没用'` 子串误判；N-11 转人工原因丢失 / SSE 转人工帧从不发送 / `transferred` 与路由不一致），补 `intent` 到转人工出口并新增 17 个单测；AC-2 更新为 4 出口全覆盖，AC-5/AC-8 证据同步 |
| 2026-11-12 | v1.6 | 投递链路修复同步：#87 N-9 从服务端解决（双通道投递），AC-8 证据更新为 13 suites / 187 tests，并记录 API 全量中 3 例既有失败（`auth` / `flash-sale`，基线同样失败） |
