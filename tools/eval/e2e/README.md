# 真实账号端到端 AI 客服验收

用**真实注册的测试账号**走 Flutter App 的生产链路（HTTP 发消息 + Socket 收回
复），跑现有**人工题库**与业务场景，对**回答里真实携带的 sources** 做 LLM
判定，产出一份带分子/分母的报告。

- 题目来源：`tools/eval/rag/golden.jsonl`(129) + `golden.realistic.jsonl`(66)
  + `tools/simulator/scenarios.mjs` 既有场景。不改编、不由模型生成。
  唯一例外：`update_address` 补了 1 句人工题（报告中单列）。
- 业务数据：**只走产品接口**（客户端 + admin），不插 DB、不写 fixture 注入。
- 不查库统计：DB/读接口只用于核验副作用。

## 前置

```bash
make up-backend        # API + DB + Redis（本地 dev）
# admin 前端可选：验证会话页时再起

node -v                # ≥ 20（用全局 fetch / AbortSignal.timeout）
yarn install           # socket.io-client 等
```

后端必须是 `NODE_ENV=development`：手机 OTP 走固定码。固定码从后端容器的
`OTP_FIXED_CODE` / `OTP_DEV_CODE` 读取（未设置时退回 `999999`），也可以用
`E2E_OTP_CODE` 显式覆盖。

管理员令牌按优先级获取，无需手工配置：

1. `E2E_ADMIN_TOKEN`（显式注入时直接用）；
2. `POST /v1/auth/admin/test-login`（读后端容器 env 的测试凭据）；
3. 本地签一个 SUPER_ADMIN JWT（读容器 env 的密钥 + DB 里的 SUPER_ADMIN id）。

凭据只在内存里，**不打印、不写报告**。

## 运行

```bash
# 单测（纯函数）
node --test tools/eval/e2e/*.test.mjs

# 冒烟：3 道知识题 + 1 个动作
E2E_KINDS=knowledge,action E2E_LIMIT=3 E2E_ACTIONS=claim_coupon \
  node tools/eval/e2e/run.mjs

# 全量（约 20–35 分钟，主要受全局限流约束）
node tools/eval/e2e/run.mjs

# 断点续跑（复用 .runtime/cases/ 里已完成的用例）
E2E_RESUME=1 node tools/eval/e2e/run.mjs

# 离线重判（不重跑用例，只重判已有回答；输出到 <run>-rejudged/）
node tools/eval/e2e/rejudge.mjs tools/eval/e2e/reports/<run>/detail.json

# 放宽口径诊断：判 B 时把回答实际引用的文档也交给判官，用来区分「编造」与「golden 集不全」。
# 只做诊断，不替代严格口径。
node tools/eval/e2e/rejudge.mjs tools/eval/e2e/reports/<run>/detail.json --include-cited
```

重判报告头会打印本次使用的 `judgeSpecVersion`（判官输入规范）、`judgePromptVersion`
（判官提示词）与 `metricSpecVersion`（指标定义）。三者任一不同，数字就不能直接和上一轮比。

报告：`tools/eval/e2e/reports/<YYYYMMDD-HHmmss>/summary.md` + `detail.json`
（文件 600）。账号池：`tools/eval/e2e/.runtime/accounts.json`（目录 700）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `E2E_API_BASE_URL` | `http://localhost:3000/api` | 后端 API |
| `E2E_SOCKET_URL` | `http://localhost:3000/events` | Socket.IO |
| `E2E_ALLOW_REMOTE` | — | 非 localhost 必须显式设 `1` |
| `E2E_BUSINESS_ID` | `simulation_support_v1` | 隔离渠道，不动正式客服统计 |
| `E2E_TRAFFIC_SOURCE` | `e2e_acceptance_v1` | 流量来源标签 |
| `E2E_ACCOUNT_COUNT` | `12` | 真实注册账号数（1–40） |
| `E2E_FIXTURE_ACCOUNTS` | `3` | 前置业务数据建在几个账号上（动作/读类/边界用例在它们之间轮转） |
| `E2E_FIXTURE_ACCOUNT_OFFSET` | `0` | 从账号池第几个开始挑 fixture 账号；当日配额被知识题烧完时换一批 |
| `E2E_CONCURRENCY` | `4` | 并发用例数（1–8） |
| `E2E_HTTP_PER_MINUTE` | `50` | 客户端 + admin + judge 合计上限（≤55） |
| `E2E_LIMIT` | `0` | 知识题条数（0 = 全部 195） |
| `E2E_MULTI_LIMIT` | `20` | 多轮配对数 |
| `E2E_KINDS` | 全部 | `knowledge,multi,action,read,boundary` 子集 |
| `E2E_ACTIONS` | 全部 | `claim_coupon,redeem_code,draw,create_address,update_address,delete_address,withdraw` 子集 |
| `E2E_SKIP` | — | 跳过指定用例 id / 类别（逗号分隔） |
| `E2E_RESUME` | — | `1` = 断点续跑 |
| `E2E_CHAT_MODEL` | 自动 | 报告头里写的被测模型（默认从容器 env 推断） |
| `E2E_RUNTIME_DIR` / `E2E_REPORTS_DIR` | `.runtime` / `reports` | 落盘位置 |
| `E2E_BACKEND_CONTAINER` / `E2E_DB_CONTAINER` / `E2E_DB_NAME` | `lucky-backend-dev` / `lucky-db` / `joy_mini` | 取管理员令牌用 |

后端全局限流是 60 次/分/IP，client、admin、judge 三类请求共用同一个节流器。
调高 `E2E_HTTP_PER_MINUTE` 只会撞 429，不会更快。

## 判定口径（务必区分）

| 名称 | 用什么 sources | 回答什么 |
| --- | --- | --- |
| **忠实度（A）** | 回答消息里真实下发的 `meta.sources` | 「回答是否被自己引用的内容支持」；回答没引用就**不判**，不进分母 |
| **与 golden 一致（B）** | golden 文档 docId 交给判官端点取 chunk | 「答对了没有」，与 A 分开报 |
| **检索命中** | 回答 `meta.sources` 的 `docId` 顺序 vs `expectedDocIds` | Hit@1 / Hit@3 |
| **业务动作** | 卡片 → `/ai/customer/confirm`（提现再 `/confirm/otp`）→ 客户端读接口核验 | 动作是否真的执行并落库 |
| **任务完成度** | `POST /admin/ai-eval/judge` | 读类问答的 solved / partial / unsolved |
| **边界/安全** | 纯规则（泄露关键词、是否发卡/执行、转人工信号…） | 不引入模型判定 |

A 不是正确率。报告里把两者分开写，避免「拿忠实度冒充正确率」。

**B 只在「知识库依据」组上计算。** 每条回答按 `ai_traces`（`intent`、`metadata.flow`、
`metadata.ragSourceCount`、`metadata.grounding`）+ `ai_spans`（`type='tool'`）分四类，优先级
**fallback > tool > kb > none**：

> 依据分型来源：新版本运行时直接写 `ai_traces.metadata.grounding`，评测**优先读它**
> （报告中标记为 `trace_metadata`）；只有旧 trace 没写时才按 `ragSourceCount` + 工具
> span 推断（标记为 `inferred`）。报告「依据来源与可判性」一节会分别计数——混用两种
> 口径时，分组对比只看同一来源内部的变化。

| 依据来源 | 是否进 B 分母 | 说明 |
| --- | --- | --- |
| kb | ✅ | 检索后作答；准确率只在这一组算 |
| tool | ❌ | 余额/订单/KYC/商品等工具事实不在知识库里，判「无依据」是测量错误 |
| none | ❌ | 无依据作答，单列为幻觉风险指标 |
| fallback | ❌ | 三句兜底话术（`ai-failure-handler.ts`）不是回答，`answered=false` |

**无依据作答率** = `none` 条数 / 真实回答数（排除兜底）。它是风险指标，**不并入**
准确率分母：`none` 是「既没检索也没调工具」的模型自述，判 B 无意义。新版本还会把
「检索是否尝试过、为什么跳过」写进 `ai_traces.metadata.retrieval`，用于区分
「没检索」和「检索了但 0 候选」。

### `AI_GROUNDING_GATE` 对验收的影响

发布门禁对「业务意图 + 完全无依据 + 非澄清」的回答做拦截，三态：

| 值 | 行为 | 验收含义 |
| --- | --- | --- |
| `off` | 不运行 | 与上线前一致 |
| `shadow`（默认） | 只把决定写入 `ai_traces.metadata.groundingGate`，不改回复 | **shadow 报告的结果不能当作 enforce 结果** |
| `enforce` | degrade 的回复替换为转人工话术，记 `transfer{reason:'no_evidence'}` | 无依据作答会体现为新增的 `fallback`（转人工话术） |

切 enforce 前先用 shadow 跑一轮全量，逐条复核 `groundingGateDecision` 的 degrade
清单；误降级（正常回答/澄清被拦）不可接受时先调判定规则，不要直接上线。

## 判官输入规范（JudgeInputSpec）

`POST /admin/rag/documents/judge` 是唯一拼判官输入的地方
（`apps/api/src/admin/rag/judge-input-spec.ts`），harness 不再自行挑 sources：

- 传 `sources`：按传入内容判（忠实度 A 用回答真实下发的 sources）。
- 传 `expectedDocIds` / `citedDocIds`：服务端按 docId 取 chunk（`docId + locale`
  定位文档），按问题/回答词面相关度挑 chunk；每篇文档先保一条覆盖，再填满预算。
- 预算：单条 2000 字符、合计 8000 字符；同分按原始顺序，保证 `judgeInputHash` 稳定。
- 脱敏：answer 与 sources 用同一个 `redactForJudge()`，同一邮箱在两处形态一致。
- 响应带 `judgeInputHash`、`judgeSpecVersion`、`sourceCount`；run 元数据记录同一个版本。

版本：`EVAL_JUDGE_SPEC=v1` 保留旧口径（不脱敏、按传入顺序截断），**默认 v2**。
v1 与 v2 的准确率不可混比——换口径必须同时换 `metricSpecVersion`，历史结果按版本分组。

旧实现让长文档后半段的事实永远判「无依据」；v2 由端点按相关度挑 chunk 填满预算，
`goldenSources()` 已移除。

## 运行记录与基线

每轮 harness 仍以 JSON 报告为主产物，同时把结果写入 `ai_eval_runs`：

1. `POST /admin/ai-eval/runs/external` 创建 `EXTERNAL` 运行（记录 `codeVersion`、
   `gateMode`、`judgeSpecVersion`、`metricSpecVersion`）；
2. 跑完后 `POST /admin/ai-eval/runs/:id/external-results` 写入三态结果并收尾；
3. `GET /admin/ai-eval/runs/:id` 读回库内 `summary`，报告新增
   「运行记录与基线（库内 summary）」一节，并逐字段核对「库内 summary vs 本地提交结果」。

登记基线：`POST /admin/ai-eval/runs/:id/promote`。只有 `COMPLETED`、判官失败率低于
`EVAL_MAX_JUDGE_ERROR_RATE`（默认 2%）、四个版本字段齐全且 `metricSpecVersion`
与当前一致的运行才能通过；通过后全局至多一条 `isBaseline`。同一数据集的新运行
未显式传 `baselineRunId` 时会自动以它作为对比基线，报告里出现
`baselineAccuracy / delta / newFailures / fixed`。

## 用例构成

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 知识问答 | 163 | golden 正样本，原文直发 |
| 负样本 | 32 | `expectedDocIds: []`，含注入句；断言不编造、不引用无关文档、不泄露 |
| 多轮追问 | ≤20 对 | 同一 expectedDoc 或同域的两条既有题，按 id 排序相邻配对；两轮都在既有题库里 |
| 业务动作 | 7 | 领券、兑换码、抽奖、新增/修改/删除地址、提现（真实执行 + 读接口核验） |
| 读类问答 | 12 | 余额、订单、物流、券、商品、抽奖、KYC、资料 |
| 边界/安全 | 6 | 注入、转人工、改口、指代不明、长会话、重复提问 |

写动作的前置数据全部用产品接口造：admin 券续期/建兑换码、admin KYC 审批、
admin 余额调整、客户端单人下单（异步发抽奖券）、客户端建地址。每一步
「先查后建」；造不出来就把依赖用例标记 **skipped 并写明原因**，不算失败。

前置数据默认建在 3 个账号上（`E2E_FIXTURE_ACCOUNTS`），动作/读类/边界用例在
这些账号之间轮转。原因有两个：地址、KYC、余额、订单本来就是**账号私有**的，
用例必须在「有这些数据的那个账号」上跑才有意义；同时后端有「每用户每天 20
万 token」的 AI 配额（`AI_DAILY_TOKEN_LIMIT`），全压在一个账号上几次运行就
会把配额打满。轮转后，动作/读类/边界用例不会打到空账号，也不会把单个账号的
配额打爆。

这 3 个账号在池里被**保留**（`reserved`）：知识题/多轮题只从非保留账号里取，
不会先把 fixture 账号的日配额烧光。只有非保留账号全部耗尽时才会借用保留账号。
某天配额已经烧完、想换一批账号跑动作用例，用 `E2E_FIXTURE_ACCOUNT_OFFSET`
从池里第 N 个开始挑。

## 会话与限流

- 每道题一个干净会话：`GET /chat/business` 会复用未关闭的会话，所以用例结束
  用 `PATCH /admin/chat/conversations/:id/close` 关单，下一个用例再建联。
- 首次使用某账号时，先关掉上次运行可能留下的旧会话。
- 发送走 `POST /v1/chat/message`（客户端生成 UUID），回复走 Socket `dispatch`。
- 超时会 `PATCH .../handler {mode:'ai'}` 把会话切回 AI 再重发一次，轮次里标
  `rescued: true`，不把重发成功伪装成一次成功。
- socket 发送令牌桶 1/s（突发 6）由后端限制；用例并发 4、每账号互斥。
- socket.io 开启自动重连：断线后重建连接并重新 `join_chat` 当前会话。等待
  回答期间掉线会立刻结束该轮（`outcome: disconnected`），重连后重发一次，
  轮次标 `socketDropped` —— 不把「连接掉了」算成「AI 不回」。全量跑时出现过
  4 个 client 同一秒被掐断的情况，没有重连会让后面每一轮都白等 90 秒。
- 账号日配额耗尽时，后端会回固定话术；脚本识别后把该用例标 **skipped（写明
  原因）**，并把该账号从池里摘掉，不算成答案质量问题。
- 地址增改是「表单式」工具（AI 逐字段追问）。脚本像真实用户一样逐条回答
  追问（`answers.mjs`：姓名/电话/省/市/barangay/详细地址），再回「确认」——
  这是用真实对话把流程走完，不是改题。

## 最近一次全量结果（2026-11-23，本地 dev）

12 个真实账号，240 例（完成 238 / 跳过 2 配额耗尽 / 异常 0），提交 `5712ab4f`。

| 维度 | 结果 |
| --- | --- |
| 知识问答 · 真实回答率（排除兜底） | 145/162 = 89.5% |
| 知识问答 · 兜底话术 | 17/162 = 10.5% |
| 知识问答 · 检索知识库（kb） | 83/145 = 57.2% |
| 知识问答 · 与 golden 一致（**kb 组**） | **71/83 = 85.5%**（旧口径 94/162 = 58.0%） |
| 知识问答 · 工具数据（不适用判 B） | 36 条 |
| 知识问答 · 无依据作答（风险指标） | 26 条 |
| 知识问答 · 忠实度（有引用才判） | 66/83 = 79.5% |
| 负样本 · 泄露 / 引用无关文档 | 0 / 0（32 条） |
| 业务动作 · 执行并核验 | 7/7 |
| 读类问答 · solved | 6/12 |
| 边界/安全 | 5/6（重复提问相似度 96%） |
| 语言一致 | 129/140 = 92.1% |
| 时延 p50 / p95 | 6886ms / 9667ms（298 轮） |

重判后的可信数字：[`reports/20261124-005755-rejudged/summary.md`](reports/20261124-005755-rejudged/summary.md)；
问题清单：[`reports/20261124-005755/findings.md`](reports/20261124-005755/findings.md)。

旧口径 58.0% 的差额来源：17 条兜底话术被算成回答、36 条工具数据被拿去和知识库比、
11 条长文档因判官只收到前 8 个 chunk 被误判。剩下 12 条不一致里，
3 条是 PII 脱敏伪差异、8 条是 golden 文档集不全、1 条是真内容错误（`knowledge:r14` COD 与券）。
最值得先修的是：地址写动作偶发把 userId 当 addressId（2/5 失败）、
AI 回复脱敏把客服邮箱打码、43% 的知识类问题根本没走检索、中文问句检索不到英文文档。

## 未覆盖（如实声明）

- **充值**：只有 Xendit 线上支付，本地 dev 无法完成。
- **用户自助 KYC 提交**：依赖 AWS Rekognition + Gemini + R2，本地不可用；
  提现前置的 KYC 是 admin 接口真实审批。
- `update_address` 的 1 句人工题（已批准，报告中标注）。
- 新增地址、提现两例在场景问句后追加了「补参数」的一轮用户发言（联系人/
  电话/收款账号），原因是工具必填字段；这不改变题目来源。
- 未评价 AI 工具未覆盖的能力（充值、KYC 自助提交）。

## 安全

- 账号令牌存 `.runtime/accounts.json`（700/600，已加入 `.gitignore`）。
- 报告落盘前统一脱敏：`confirmToken` / `token` / `otp` / `csrf` 等字段整棵
  剔除；手机号在任意文本里打码。
- 管理员凭据、容器密钥只读不打印；`E2E_ADMIN_TOKEN` 只经环境变量传入。
