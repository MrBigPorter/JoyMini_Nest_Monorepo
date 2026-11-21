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

模式：

```bash
run.sh --dataset ... --mode=shadow     # 只报告，永不非零退出
run.sh --dataset ... --mode=advisory   # 报告，退出码 0（默认）
run.sh --dataset ... --mode=blocking   # 不达标退出码 1
```

报告同时输出 `fairness`：按 language/intent/source 切片，每层 n≥30 才比较；
层间差 >10 个百分点标记为需调查。

## 人工标注（Phase 3）

2026-11-21 重新生成流量后：

- `selection-2026-11-21.jsonl`：30 个会话；
- `selection-train-2026-11-21.jsonl`：20 个训练会话；
- `holdout-2026-11-21.jsonl`：10 个 holdout 会话（冻结，不参与标注/调参）；
- 训练集工作表：36 行；
- 第二轮运营标注：36/36，solved 26 / partial 8 / unsolved 2；
  报告见 [`reports/operator-annotation-2026-11-21-round2.md`](./reports/operator-annotation-2026-11-21-round2.md)；
- 第二轮 AI 预标注：36/36，rubric v2.1 后与运营一致率 86.1%、kappa 0.67；
  可用于初筛，仍不能替代人工。见
  [`reports/ai-vs-operator-2026-11-21-round2.md`](./reports/ai-vs-operator-2026-11-21-round2.md)。

> 旧的 `selection-2026-11-22.jsonl` 引用的 sim 会话已在清理中删除，仅作历史记录，
> 不能重跑。
工作表在 `annotations/worksheet-2026-11-21.jsonl`（gitignored，含原文）。

```bash
# 导出工作表（标签为空）
cd apps/api
../../node_modules/.bin/tsx --env-file=.env scripts/export-annotation-worksheet.ts \
  --dataset tools/eval/conversation/selection-2026-11-22.jsonl \
  --out tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl

# 两人独立标注后算 kappa
python3 tools/eval/conversation/annotate.py score \
  --a annotations-a.jsonl --b annotations-b.jsonl \
  --out tools/eval/conversation/reports/annotation-kappa.md
```

规则见 [`annotation-guide.md`](./annotation-guide.md)：盲标、kappa ≥0.6、n<30 只作参考。

分批标注：

```bash
python3 tools/eval/conversation/split-annotation-batches.py \
  --worksheet tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl \
  --out-dir tools/eval/conversation/annotations/batches --size 10
```

生成 5 批（10/10/10/10/9）；每批标完先 `annotate.py validate`，全部完成后
`cat batch-*.jsonl > annotations-a.jsonl`。

### 首轮运营标注（单遍，不是 kappa）

`annotations-ops.jsonl` 是对 49 行的第一遍运营视角标注（Claude 代标，本地文件）。
结果见 [`reports/operator-annotation-2026-11-21.md`](./reports/operator-annotation-2026-11-21.md)：

- solved 35 / partial 9 / unsolved 4 / unsafe 1；
- 中文提问、英文回答 28 轮（57.1%）；
- unsafe：提现会话在聊天里索要银行卡号。

这是一次单遍标注，**不能单独用于 kappa**；要算 kappa 仍需第二遍独立标注。

业务口径对比见
[`reports/operator-annotation-business-diff-2026-11-21.md`](./reports/operator-annotation-business-diff-2026-11-21.md)：

- outcome：answered 38 / expected_transfer 7 / unexpected_transfer 3 / failed 1；
- 严格→业务只改 3 条（2 条正确转人工、1 条重复提问）；
- 钱包余额、券过期仍失败；提现索要卡号仍是唯一 unsafe；
- 建议门禁用严格口径，周报用业务口径。

### 标注队列 UI

后台路径：`/ai-ops/annotations`（AI Operations · 工程，ADMIN/SUPER）。

- 读最新 `worksheet-*.jsonl`；
- 每个管理员写自己的 `annotations-<adminId>.jsonl`；
- 支持待标注/已完成筛选、保存并下一条、进度统计；
- 写文件使用临时文件 + rename，进程内串行；多实例部署需换 DB 或分布式锁。

### AI 预标注（可选）

```bash
cd apps/api
# 先 dry-run 检查 prompt
../../node_modules/.bin/tsx --env-file=.env scripts/prelabel-annotations.ts \
  --worksheet tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl \
  --out tools/eval/conversation/annotations/annotations-ai.jsonl \
  --dry-run --limit=3

# 有 AI_PRELABEL_API_KEY / GROQ_API_KEY 后正式跑
../../node_modules/.bin/tsx --env-file=.env scripts/prelabel-annotations.ts \
  --worksheet tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl \
  --out tools/eval/conversation/annotations/annotations-ai.jsonl --resume
```

预标注只是草稿，**不参与最终 kappa**；实现细节、prompt、输出格式、隐私与
限制见 [`prelabel-guide.md`](./prelabel-guide.md)。

已跑结果（`openai/gpt-oss-120b`）：49/49 ok；与严格运营一致率 81.6%、
kappa 0.633；与业务运营一致率 75.5%、kappa 0.519。
分歧与 invalid 明细见
[`reports/ai-vs-operator-2026-11-21.md`](./reports/ai-vs-operator-2026-11-21.md)。

## 定时运行

```bash
# crontab: 每天 01:10 UTC 跑前一天
10 1 * * * /path/to/repo/tools/eval/conversation/daily-cron.sh
```

日志在 `logs/daily-<date>.log`；非零退出码由 cron 邮件/上层监控告警。
脚本不主动向外部服务发送数据。


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
