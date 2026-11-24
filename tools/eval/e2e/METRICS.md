# 评测指标规范（METRIC_SPEC_VERSION = 2）

> 本文件是评测口径的唯一文本来源。任何指标含义、分母或排除项的变化，都必须同时提升 `METRIC_SPEC_VERSION`，否则历史结果不得与新结果直接比较。
>
> 代码实现见 `metrics-spec.mjs`；运行记录会把版本号写入 `AiEvalRun.metricSpecVersion`。

## 1. 指标定义

| 指标 | 含义 | 分母 | 排除项 | 数据来源 |
| --- | --- | --- | --- | --- |
| `answeredRate` | 真实回答率 | 全部评测轮次 | 命中固定兜底话术的轮次 | `ai_traces.output` + `isCannedReply()` |
| `kbAccuracy` | 知识问答与 golden 一致的比例 | `correct + incorrect` | `judge_error`；依据分型不是 `kb` 的用例 | `AiEvalResult.answerVerdict` + `grounding` |
| `ungroundedRisk` | 无依据且发布事实断言的条数 | 知识类用例（`knowledge` + `multi`） | 纯澄清追问；兜底话术 | `ai_traces.metadata.grounding` + 门禁的 `factualAssertion` |
| `hitAt3` | 检索前三命中 golden 文档 | 带 golden 文档的用例 | 无 golden 文档的用例 | `ai_spans(type='rag')` |
| `judgeErrorRate` | 判官失败占全部判定的比例 | 全部判定调用 | 无 | `AiEvalResult.answerVerdict == 'judge_error'` |
| `p95Latency` | 单轮时延 95 分位 | 全部评测轮次 | 无 | `ai_traces.latency_ms` |

## 2. 答案判定三态

判官对「答案是否正确」的结论存于 `answerVerdict`，与任务成功率 `verdict`（`solved / partial / unsolved`）是两个维度：

- `correct`：回答与给定来源一致，或与 golden 期望一致。
- `incorrect`：回答与来源/期望冲突，或包含来源不支持的事实断言。
- `judge_error`：判官未给出有效判定（超时、鉴权、限流、输出格式错误、内容策略拦截）。

`judge_error` 不是回答质量信号，**不得进入任何准确率分母**。

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
5. 与待比较基线使用同一 `datasetSnapshot.hash`；否则只能做「不可直接比较」的诊断。

任一条件不满足时，报告必须标注「仅诊断」，且不得更新基线。

## 5. 版本历史

| 版本 | 变更 |
| --- | --- |
| v2 | 首次成文：三态判定、判官错误不计入准确率、脱敏对称后的判官输入、基线资格条件。 |
