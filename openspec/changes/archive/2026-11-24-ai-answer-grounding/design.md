# Design

## Context

现状（读代码确认）：

- 检索只有两个入口：意图为 `rag` 时的 direct handler（`direct-handlers.ts` → `handleRagQuery`），以及编排收尾的知识兜底（`orchestrator.node.ts` → `shouldUseKnowledgeFallback`）。域意图（order/wallet/coupon/user/product/kyc/lucky-draw）在执行工具后直接合成回复，不检索知识库。
- 知识兜底要同时满足「用户问句命中 `INFORMATIONAL` 中文正则」且「所有 Agent 输出都命中 `SCOPE_REFUSAL`」才触发；英文问句完全不命中。
- 最终回复在 `ai-customer.service.ts` 的多条出口（正常回复、转人工、离线留言）分别调用 `publishAiReply`；观测记录在 `recordTrace` 处写 `metadata.ragSourceCount`，工具调用已在 `params.streamUsage.toolSpans` 里。
- 检索层 `RagRetrievalService.retrieve()` 只接受单个 query，四层召回（向量 / Meilisearch / chunk 关键词 / 文档关键词）后做 RRF + rerank。
- 评测侧 `tools/eval/e2e` 已能按 `ai_traces` + `ai_spans` 把回答分为 kb / tool / none / fallback，基线见 `reports/20261124-005755-rejudged/summary.md`。

## Goals / Non-Goals

**Goals:**

- 业务意图下的信息类问题在回答前一定经过知识库检索，且额外延迟尽量被并行掩盖。
- 无依据回答在发布前被拦住并降级，同时保留纯澄清追问。
- 依据分型在运行时落库，评测不再靠脚本猜测。
- 中文问句能命中英文知识库，且改写失败不影响回答。

**Non-Goals:**

- 不调 rerank 阈值、不改四层召回的合并公式（只在入口增加 query 变体）。
- 不重写 golden 数据集、不修 KYC 文档漂移、不改商品搜索。
- 不引入新的向量库或新的 embedding 供应商（继续用现有 Jina embedding + rerank）。
- 不把「无依据率」做进前端看板，只保证数据可被现有评测与 trace 查询读取。

## Decisions

### D1. 强制检索放在编排收尾，以「追加输出」参与合成

在流水线循环结束后、合成之前增加一次检索：当意图属于业务域或 `rag`、问句是信息类、且本轮还没有知识库 sources 时，调用 `handleRagQuery`；命中时把 `rag` 输出**追加**到 `agentOutputs` 而不是替换（现有兜底是替换），让合成器同时看到工具事实与政策依据。

- 为什么不是把 `rag` 加进分类结果：让意图置信度决定是否检索，会把「检索不到」变成分类问题；且分类结果允许多标签，容易重复检索。
- 为什么不是让域 Agent 自己调知识检索工具：检索与否不可观测、不可控，prompt 一改行为就漂移。
- 为什么追加而不是替换：余额、订单状态这类工具事实不在知识库，替换会丢事实。
- 防止拖尾：在进入流水线循环前用 `Promise` 预取检索结果（信息类 + 业务意图时），收尾时**有界等待**（默认 2500ms，`AI_GROUNDING_PREFETCH_WAIT_MS` 可覆盖）；超时丢弃预取结果、按「检索了但 0 候选」继续，并在 trace 记 `retrieval.timedOut=true`；检索异常只记录跳过原因，不阻塞回答。
  （2026-11-24 enforce 全量验收发现：工具类问题 Agent 只需 2s 级，收尾等检索 + 中文改写会把 p95 拉高 19.4%，超过 15% 预算，因此从「无界 await」改为有界等待。）

### D2. 信息类判定收敛为一个共享谓词

把 `INFORMATIONAL` 扩展为 `isInformationalQuestion()`：中文标记（现有词 + 「哪些」「什么材料」「需要什么」「要准备」）与英文标记（how / what / where / when / can I / do I need / policy / rules / require / how long），放在 `orchestrator-utils/knowledge-fallback.ts` 单处导出；`turn-failure.ts`、强制检索、兜底判定都从这里取用。

- 为什么不交给 LLM 判定：每轮多一次模型调用，且判定结果不可复现；也与 `intent-classification` 的「门禁只有一个事实来源」原则冲突。
- 代价：正则必然有漏网。漏网的后果只是回到「不强制检索 → 依据门禁降级」，不会产生无依据事实答复。

### D3. 双语检索：只对含 CJK 的问句做英文改写，作为 query 变体进入同一次检索

- `RagRetrievalService` 的 `RetrievalOptions` 增加 `queryVariants?: string[]`；四层召回对 `[原问句, ...variants]` 分别执行，层内按 chunkId 去重保留高分，再进入现有 RRF + rerank。这样只 rerank 一次，排序口径不变。
- 改写由一个小的 `QueryRewriteService` 完成：输入问句，输出英文短查询；用现有 chat 模型配置、temperature 0，3 秒超时。结果按规范化问句哈希缓存（Redis，7 天）。
- 只对含 CJK 的问句改写：英文问句直接检索，避免无谓调用。
- 改写失败/超时：只用原问句检索，并记录 `rewrite=failed`；不向用户暴露。

备选：维护中英术语表 → 只能覆盖已知词，长尾无效；直接用多语 embedding 不做改写 → 正是当前 53.8% 的现状，已证明不够。

### D4. 发布门禁是「单点纯函数」，放在最终回复发布前

新增 `grounding-gate.ts`：

- `classifyGrounding({ canned, ragSourceCount, toolCallCount })` → `kb | tool | none | fallback`，优先级 `fallback > tool > kb > none`，与评测口径一字不差。
- `isClarificationOnly(content)`：回复以问号结尾，且**陈述从句**不含金额/时效/规则/状态类断言（数字+单位、`政策`、`规则`、`支持`、`可以` 等）时视为澄清。追问从句（`您是想…还是…`、`are you asking…`、含 `吗/呢/请问` 的句子）本身不承担事实，不参与断言判断。
  （2026-11-24 shadow 全量复核把这条规则收紧过：旧版对整段做断言检测，把「您是想了解优惠券的使用规则，还是需要我帮您查一下？」这类纯追问误判为规则断言，12 条 degrade 里有 8 条是这种二选一追问。）
- `decideGroundingGate({ grounding, intent, clarificationOnly, factualAssertion })` → `allow | degrade`。`degrade` 仅当：分型为 `none`、意图属于业务域或 `rag`、不是纯澄清、**且回复含事实断言**（金额/时效/规则/状态；`factualAssertion` 缺省按 `true` fail-closed）。
  （2026-11-24 enforce 验收发现：地址动作流里模型没出确认卡、只回流程性文字，门禁把它降级转人工，整条动作流中断，业务动作 7/7 → 5/7。门禁要拦的是「编造的事实」，不含断言的流程性回复应放行。）

门禁放在 `ai-customer.service.ts` 里「拿到最终回复、准备发布」的位置，覆盖正常回复与转人工告别语；`publishAiReply` 自身不加门禁——它也用于离线留言与确认卡，不能误伤。`degrade` 时复用 `routeTransfer` 路径，用新的 `NO_EVIDENCE_HANDOFF_REPLY`（如「这个问题我需要先确认，已为您转人工客服，请稍等」），并记 `transfer{reason:'no_evidence'}`，与模型失败的 `AI_FAILURE_REPLY` 区分。

### D5. 依据分型在写 trace 时落库

`recordTrace` 已有 `params.ragSources` 与 `params.streamUsage.toolSpans`，在同一处计算 `grounding` 与 `toolCallCount` 写进 `metadata`：

```
grounding: classifyGrounding({ canned, ragSourceCount, toolCallCount })
```

`canned` 用与 `ai-failure-handler.ts` 同一份兜底话术常量比对，并加上 enforce 自己的 `NO_EVIDENCE_HANDOFF_REPLY`：降级后的转人工通知同样是兜底，不是回答，否则 enforce 的降级会被 trace 记成「无依据作答」，指标方向反了。评测侧 `judge.mjs` 的 `CANNED_REPLIES` 同步加一条，两者应一致；任务里加一个「两口径一致性」核对项。

### D6. 门禁分两阶段上线：先 shadow，后 enforce

环境变量 `AI_GROUNDING_GATE=off|shadow|enforce`，默认 `shadow`：shadow 阶段门禁只写日志与 trace（`groundingGateDecision`），不改回复；验收通过后切 `enforce`。回滚只需改环境变量，不发版。

## Risks / Trade-offs

- **误降级**（把合法的澄清/寒暄拦掉）→ 门禁只作用于业务与 `rag` 意图、且排除纯澄清；shadow 阶段先核对决定与实际回复，再切 enforce。
- **额外时延**（多一次检索 + 一次改写）→ 检索预取与 Agent 并行，收尾有界等待 2500ms；只对 CJK 改写；改写结果缓存；改写超时不阻塞主链路。验收看 p95 不回退超过 15%。
- **改写召回噪声**（英文改写引入无关文档）→ rerank 阈值不变，且依据分型只要求「有 sources」，kb 组准确率是最终验收；若 Hit@3 改善但准确率下降，回退改写（保留原检索）。
- **门禁把「工具执行了但工具本身失败」当成无依据**→ 分型只看工具 span 是否存在结果，工具失败仍可能被记为 `tool`；任务要求用 span 状态区分，失败工具不算依据。
- **`fallback` 判定与评测文本脱敏不一致**（回复先脱敏再落库）→ `canned` 比对用未脱敏原文（常量本身无 PII），trace 里同时保留 `answered=false` 语义。

## Migration Plan

1. 上线代码，`AI_GROUNDING_GATE=shadow`：只记录门禁决定与依据分型，行为不变。
2. 用 `tools/eval/e2e` 全量跑一轮，核对 shadow 决定与人工判断，确认误降级可接受。
3. 切 `AI_GROUNDING_GATE=enforce`，再跑一轮验收：无依据作答数应下降，kb 组准确率不得低于 85.5%，真实回答率的下滑需逐条归因。
4. 回滚：环境变量切回 `shadow` 或 `off`。

## Open Questions

- 改写缓存放 Redis 哪个键空间、是否与现有检索缓存共用前缀；实现时按 `rag:rewrite:*` 新增，不影响现有键。
- `isClarificationOnly` 的关键词表上线后是否需要随误判样本补充；先按评测结果调整，不改规格。
