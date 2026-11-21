# 多轮会话评测集（Phase 0 契约）

本目录是新评测契约的第一份数据集，格式由 `tools/eval/schema/case.schema.json` 定义。

## 文件

| 文件 | 说明 |
|---|---|
| `golden.jsonl` | 10 条从 `task/golden.jsonl` 迁移的单轮用例，`datasetVersion=2026-11-21.1` |

旧的 `tools/eval/task/golden.jsonl` 保留给现有单轮 runner，不删除、不改写；新用例统一进本目录。

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
