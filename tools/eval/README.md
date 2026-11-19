# tools/eval — 意图准确率回放（T0-3）

> 设计说明：[docs/AI-joymini/94-意图准确率基线-T0-3.md](../../docs/AI-joymini/94-意图准确率基线-T0-3.md)

## 一条命令

```bash
# 前置：后端在跑（make up-backend 或 docker compose up -d db redis backend nginx）
tools/eval/run-replay.sh
```

它会在 `lucky-backend-dev` 容器里临时签一个只读 admin token（不打印、不落盘），
逐条调用 `POST /admin/intent-examples/test`，然后把报告写到 `tools/eval/reports/`。

## 常用参数

```bash
tools/eval/run-replay.sh --limit 10 --verbose   # 调试前 10 条
tools/eval/run-replay.sh --tag trap             # 只跑陷阱题
tools/eval/run-replay.sh --fail-under 0.7       # 准确率低于 70% 退出码 1
tools/eval/run-replay.sh --update-baseline      # 人工确认后更新基线
tools/eval/run-replay.sh --delay 0              # 不怕限流时关掉间隔
```

## 看看它测什么

| 测 | 不测（用别的工具） |
|---|---|
| 意图分类 Top-1 准确率、每域精确率/召回率、混淆矩阵 | 回答质量 |
| 分类方式（embedding / llm_fallback）分布 | 转人工判定 → `scripts/ai-e2e-smoke.sh` |
| 单次分类 p50 / p95 延迟 | 端到端耗时 → `chat.done.totalMs` |

## 两个坑

1. **全局限流 60 次 / 60 秒**（`app.module.ts:149`）。63 条题一分钟内打完必被拦。
   脚本已内置：命中 429 时按 `Retry-After` 退避重试（最多 6 次），
   并在每条之间停 0.5 秒。**别把 429 记成"答错"** —— 那是 harness 的问题。
   有请求失败时脚本直接退出 1，且拒绝更新基线。
2. **基线只在干净跑之后更新**。`--update-baseline` 之前先看一眼「请求失败」是不是 0。

## 文件

| 文件 | 说明 |
|---|---|
| `golden/intent.jsonl` | 153 条人工标注题（9 个意图，每个 ≥16 条；一行一条 JSON） |
| `replay.py` | 回放 + 打分 + 出报告（含 95% Wilson 置信区间，仅标准库） |
| `run-replay.sh` | 签 token → 查重门禁 → 调 Python |
| `check_duplicates.py` | 题集内部/线上例句库查重；有重复则拒绝回放 |
| `compare.py` | 两次回放的 McNemar 配对检验（改前 vs 改后） |
| `seed-zh-examples.py` | 把代码 seed 里的中文示例 append 进 `intent_examples`（一次性运维） |
| `baseline.json` | 当前基线（提交进仓库，改代码后对比它） |
| `reports/*.md` / `*.json` | 每次运行的完整结果，`*.md` 给人看 |

## 改了代码，怎么证明变好了

```bash
# 1) 改前跑一次，记下报告路径
tools/eval/run-replay.sh

# 2) 改完再跑一次
tools/eval/run-replay.sh

# 3) 配对检验：同一批题上的差异是不是噪音
python3 tools/eval/compare.py \
  tools/eval/reports/<改前>.json tools/eval/reports/<改后>.json \
  --out tools/eval/reports/compare-<日期>.md
```

结论只看 McNemar 的 p 值（<0.05 才算显著），不要只看准确率的百分点。
样本量小时置信区间会很宽，报告里已同时给出 95% CI。

## 查重门禁

`run-replay.sh` 每次都会先跑 `check_duplicates.py`：规范化后完全相同的样本、
或相似度 ≥0.9 的样本，都会拒绝回放。默认只查题集内部；加
`EVAL_DEDUP_AGAINST_API=1` 会和线上 `intent_examples` 表比对（需要后端与 token）。

## 更新基线前的自查

- [ ] 「请求失败」= 0
- [ ] 答错的题逐条看过：是系统错了，还是标签错了？
- [ ] 若是标签错：改 golden set 的 `note` 写清理由，再重跑
- [ ] 再 `--update-baseline`
