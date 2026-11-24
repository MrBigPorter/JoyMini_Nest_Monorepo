# 评测指标规范（METRIC_SPEC_VERSION = 3）

> 本文件是评测口径的唯一文本来源。任何指标含义、分母或排除项的变化，都必须同时提升 `METRIC_SPEC_VERSION`，否则历史结果不得与新结果直接比较。
>
> 代码实现见 `metrics-spec.mjs`；运行记录会把版本号写入 `AiEvalRun.metricSpecVersion`。
>
> 判官口径由两个版本共同决定：`judgeSpecVersion`（输入规范：给哪些文档、预算、脱敏）与
> `judgePromptVersion`（提示词）。两者任一不同，`kbAccuracy` 不得直接跨轮比较；
> 离线重判报告头会同时打印这两个版本。

## 1. 指标定义

| 指标 | 含义 | 分母 | 排除项 | 数据来源 |
| --- | --- | --- | --- | --- |
| `answeredRate` | 真实回答率 | 全部评测轮次 | 命中固定兜底话术的轮次 | `ai_traces.output` + `isCannedReply()` |
| `kbAccuracy` | 知识问答与 golden（及回答本轮实际引用文档）一致的比例 | `correct + incorrect` | `judge_error`；依据分型不是 `kb` 的用例 | `AiEvalResult.answerVerdict` + `grounding` |
| `judgeAgreement` | 判官重复采样的一致性：全票一致用例 / 有 ≥2 次成功判定的用例 | 有 `judgeSuccessfulAttempts >= 2` 的用例 | 只成功 1 次、没有逐次记录的旧数据 | `AiEvalRun.summary.judgeAgreement` + `detail.json` 的 `judgeAttempts` |
| `ungroundedRisk` | 无依据且发布事实断言的条数 | 知识类用例（`knowledge` + `multi`） | 纯澄清追问；兜底话术 | `ai_traces.metadata.grounding` + 门禁的 `factualAssertion` |
| `hitAt3` | 检索前三命中 golden 文档 | 带 golden 文档的用例 | 无 golden 文档的用例 | `ai_spans(type='rag')` |
| `judgeErrorRate` | 判官失败占全部判定的比例 | 实际调用过判官的判定 | 没调过判官的用例；`harness` / `not_applicable`（不是判官失败） | `AiEvalResult.answerVerdict == 'judge_error'` + `judgeErrorKind` |
| `p95Latency` | 单轮时延 95 分位 | 全部评测轮次 | 无 | `ai_traces.latency_ms` |

### 1.1 `kbAccuracy` 的判官输入范围（v3）

判官可见来源 = **golden 文档 ∪ 回答本轮实际引用的文档**：

- harness 分别传 `expectedDocIds` 与 `citedDocIds`；服务端按 golden 优先合并、去重，
  仍限制 10 篇、单篇 2000 字符、合计 8000 字符，并对回答与来源做同一套脱敏。
- 回答引用了 golden 之外、但本轮真实检索到的文档并据此作答时，判官必须看到它，
  不得把该事实判成「无依据」。
- 错误归属仍然判负：把规则、路径或政策安到并不包含它的文档上，即使扩大了来源范围，
  判决仍为 `incorrect`。
- **严格 golden-only 口径只作离线诊断**（`rejudge --with-strict`，写入
  `rejudge.strictAgreement`），报告并列展示，但不得用于基线验收或决定 6.2 收口。

## 2. 答案判定三态

判官对「答案是否正确」的结论存于 `answerVerdict`，与任务成功率 `verdict`（`solved / partial / unsolved`）是两个维度：

- `correct`：回答与给定来源一致，或与 golden 期望一致。
- `incorrect`：回答与来源/期望冲突，或包含来源不支持的事实断言。
- `judge_error`：判官未给出有效判定（超时、鉴权、限流、输出格式错误、内容策略拦截，
  以及重复判定平票/成功次数不足的 `judge_disagreement`）。

`judge_error` 不是回答质量信号，**不得进入任何准确率分母**。

### 2.1 重复采样与聚合（v3）

- 每次答案判定默认重复 3 次（`EVAL_JUDGE_REPEATS`，只接受 1/3/5；默认 3）。
- 成功 = 返回可解析的 `faithful` 布尔值；按多数聚合，`score` / `reason` /
  `unsupportedClaims` 取多数阵营的首次结果。
- 平票或成功次数 < 2 → 记 `judge_error`，`reason = judge_disagreement`，
  单列「判官分歧」，不得计为回答错误。
- `judgeAgreement` = 多数阵营票数 / 成功次数（全票 1.0、2:1 为 0.67）；
  报告只把成功 ≥2 次的用例计入稳定性分母。
- `EVAL_JUDGE_REPEATS=1` 时行为等价单次判定，`judgeAgreement=1` 但标记
  `judgeLowAttempts`，不计入稳定性分母。

## 3. 依据分型

每条回答按运行时记录分为：

- `kb`：本轮有知识库 sources。
- `tool`：本轮执行了工具且无知识库 sources。
- `none`：既无 sources 也无工具结果。
- `fallback`：命中兜底话术（转人工、离线、配额、无依据降级）。

分型必须来自运行时记录，不得由脚本根据回答文本猜测；记录缺失时标为 `unknown` 并单列。

## 4. 基线登记条件

一次运行只有同时满足以下条件，才可登记为新基线：

1. 状态为 `COMPLETED`；
2. `judgeErrorRate < 0.02`（可用 `EVAL_MAX_JUDGE_ERROR_RATE` 调整）；
3. `codeVersion`、`datasetSnapshot.hash`、`judgeSpecVersion`、`metricSpecVersion` 全部存在；
4. `metricSpecVersion` 与当前一致；
5. 与待比较基线使用同一 `datasetSnapshot.hash`；否则只能做「不可直接比较」的诊断；
6. `summary.judgeAgreement >= 0.95`（可用 `EVAL_MIN_JUDGE_AGREEMENT` 调整）；
   缺失时视为无法验证判官稳定性，同样拒绝登记；
7. `scope = full`（子集运行只做变更诊断，不得登记为基线）；
8. `knowledgeSnapshot.stable = true`，且运行记录指纹非空。

任一条件不满足时，报告必须标注「仅诊断」，且不得更新基线。

### 4.1 发布证据（比基线更严）

`GET /v1/admin/ai-eval/runs/:id/evidence` 在基线条件之外，还要求：

- 运行指纹等于**当前**语料指纹（运行后语料又变过，证据失效）；
- `knowledgeSnapshot.pendingActivation` 为空（没有等待激活/索引的文档）；
- 实际执行结果数等于 `datasetSnapshot.cases` 数（防「大量跳过后的高准确率」）；
- harness 失败率 ≤5%（`EVAL_MAX_HARNESS_FAILURE_RATE` 可调）。

证据不通过时，默认 `advisory` 只告警；切到 `enforce` 后部署阻断。子集运行永远不能
作为发布证据。

登记入口：`POST /admin/ai-eval/runs/:id/promote`（SUPER_ADMIN / ADMIN）。服务端会
逐条校验上述条件并给出可读原因；通过后在事务内清掉旧基线、把本条置为
`isBaseline=true`，全局至多一条。之后同数据集的运行未显式传 `baselineRunId` 时，
自动以它作为对比基线。

## 5. 版本历史

| 版本 | 变更 |
| --- | --- |
| v2 | 首次成文：三态判定、判官错误不计入准确率、脱敏对称后的判官输入、基线资格条件。 |
| v3 | 判官输入扩为 golden ∪ 回答实际引用文档；每题重复 3 次按多数聚合；新增 `judgeAgreement` 与基线稳定性门槛；严格 golden-only 降为离线诊断。v2 与 v3 的 `kbAccuracy` 不可直接比较。 |
