# 多轮会话评测集（Phase 0 契约）

本目录是新评测契约的第一份数据集，格式由 `tools/eval/schema/case.schema.json` 定义。

## 文件

| 文件 | 说明 |
|---|---|
| `golden.jsonl` | 10 条从 `task/golden.jsonl` 迁移的单轮用例，`datasetVersion=2026-11-21.1` |
| `selection-2026-11-21.jsonl` | 20 条已落库会话的选择清单（Phase 1） |
| `run.sh` | 对选择清单跑确定性 evaluator，只读 `ChatMessage/AiTrace` |
| `reports/` | 每次运行的 JSON/Markdown/feedback JSONL |

旧的 `tools/eval/task/golden.jsonl` 保留给现有单轮 runner，不删除、不改写；新用例统一进本目录。

## 跑 Phase 1

```bash
tools/eval/conversation/run.sh \
  --dataset tools/eval/conversation/selection-2026-11-21.jsonl
```

输出：

- `reports/<runId>.json`：完整结果 + manifest；
- `reports/<runId>.md`：总体、切片、失败明细；
- `reports/<runId>.feedback.jsonl`：key 级 feedback，可被 `validate.py` 校验。

evaluator：`language_match / answered / latency / trace_present / sensitive_request / action_completed`。
`source=drill` 的会话默认从聚合中排除，只在失败明细里标注。
`action_completed` 依赖 `ai_action_requests`；历史会话没有生命周期记录时按失败计，
新流量从确认卡片产生那一刻起有终态。

## 每日抽样（Phase 4）

```bash
# 默认抽前一天、只抽 real 会话、30 条
tools/eval/conversation/daily.sh

# 本地验证（当前数据都是 sim）
DATE=2026-11-20 DAILY_SOURCES=sim tools/eval/conversation/daily.sh

# 开启阻断（确定性指标不达标时退出码 1）
DAILY_GATE=1 tools/eval/conversation/daily.sh
```

规则：

- 窗口：UTC `[date, date+1)`；
- 排除 drill、空会话、少于 2 条消息、重复首问；
- 按 `language × outcome` 分层轮转，`DAILY_SEED` 可复现；
- 默认只抽 `real`；`sim` 通过 `aiMetadata.trafficSource` 标记；
- 报告输出到 `reports/daily-<date>/`，JSON 内含 `gates` 与 `gatePassed`。

门禁阈值（advisory，`--gate` 时阻断）：语言 ≥98%、answered ≥99%、latency ≥95%、
trace ≥99%、sensitive 失败数 = 0、action ≥95%。


## 校验

```bash
python3 tools/eval/validate.py --dataset tools/eval/conversation/golden.jsonl
python3 tools/eval/test_validate.py
```

## 规则

- 一条 Case 至少 1 轮，`turn` 从 1 连续递增；
- `datasetVersion` 必须全局一致；
- `id` 全局唯一，格式 `^[a-z0-9][a-z0-9-]{2,63}$`；
- `source`：`real / sim / drill`，drill 默认不进质量指标；
- 写操作（领券/提现/兑换码）的 `expectOutcome` 必须是 `confirm_card`，不能是 `executed`；
- 变更 dataset 必须升版本，不允许原地修改。
