# Proposal

## Why

2026-11-23 用 12 个真实账号跑完 240 例端到端验收，2026-11-24 离线重判后得到可信基线：
145 条真实回答里 83 条有知识库依据、36 条只有工具数据，**26 条（17.9%）既没检索知识库、也没调用任何工具，却仍以事实口吻作答**；域意图（订单/钱包/优惠券/商品/KYC 等）收到流程、规则、政策类问题时默认不检索知识库，只靠模型自带知识；中文问句检索英文知识库的 Hit@3 只有 53.8%。结果是答案无法追溯出处，出错时既不能定位是检索问题还是生成问题，也无法在发布前拦住无依据的断言。

## What Changes

- 域意图收到信息类问题（流程/规则/政策/多久/能不能等）时，回答前 SHALL 先咨询知识库，而不是只依赖域工具或模型自带知识；工具结果仍可并存，但不得作为政策类断言的唯一依据。
- 新增发布前依据门禁：一条回复既没有知识库 sources、也没有工具结果时，**BREAKING** 不再作为事实答复直接下发，改为澄清追问或转人工话术，并在链路中标记 `grounding=none`。
- 每条 AI 回复 SHALL 记录依据来源分型（`kb` / `tool` / `none` / `fallback`），随 `ai_traces.metadata` 落库，供质量运营统计。
- 检索前 SHALL 同时使用原问句与中文→知识库语言（英文）的改写问句，使中文提问能够命中英文文档；效果按 Hit@3 验收。
- 验收口径沿用 `tools/eval/e2e`：真实回答率、kb 组准确率（基线 71/83 = 85.5%）、无依据作答数（基线 26）、检索 Hit@3（基线 53.8%）。

## Capabilities

### New Capabilities

- `ai-customer/answer-grounding`: 规定一条 AI 回复必须具备何种依据才能发布、依据来源如何分型记录，以及无依据时如何降级，而不是让模型自带知识直接成为事实答复。

### Modified Capabilities

- `ai-customer/rag-retrieval`: 新增「信息类问题必须触发检索」与「中文问句必须能命中英文知识库」两条检索行为要求。
- `ai-customer/quality-loop`: 新增「无依据作答率」作为必报指标，并规定它不进准确率分母、只作风险指标。

## Impact

- 代码：`apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts`（路由与兜底）、`graph/nodes/orchestrator-utils/knowledge-fallback.ts`（触发条件）、`graph/nodes/orchestrator-utils/result-utils.ts`（合成）、`knowledge/rag-retrieval.service.ts`（双语查询）、`ai-reply-publisher.ts` / `ai-customer.service.ts`（发布门禁与 `ai_traces.metadata`）。
- 行为：部分此前被直接回答的问题会改为追问或转人工；域意图的回复可能新增 `meta.sources`。
- 性能与成本：每个信息类问题最多多一次检索与一次查询改写调用，需纳入时延与配额验收。
- 数据与评测：沿用 `tools/eval/e2e` 的真实账号链路，不新增数据集；基线报告 `tools/eval/e2e/reports/20261124-005755-rejudged/summary.md`。
- 不在本次范围：golden `expectedDocIds` 补全、KYC 文档与产品数据漂移、商品搜索中英匹配（另开变更）。
