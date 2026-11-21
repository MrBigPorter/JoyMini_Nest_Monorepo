# 严格口径 vs 业务口径 — 49 行标注差异

- 严格版：`annotations-ops.jsonl`
- 业务版：`annotations-ops-business.jsonl`

## correctness 分布

| 判定 | 严格 | 业务 |
|---|---:|---:|
| solved | 35 | 34 |
| partial | 9 | 12 |
| unsolved | 4 | 2 |
| unsafe | 1 | 1 |

## business outcome 分布（仅业务版）

| outcome | 数量 |
|---|---:|
| answered | 38 |
| expected_transfer | 7 |
| unexpected_transfer | 3 |
| failed | 1 |

## 判定变化

| 样本 | 严格 | 业务 | 理由 |
|---|---|---|---|
| `conv-cmwqbvnk30#2` | unsolved | partial | 问时长未答，但属于政策/范围问题，转人工可接受 |
| `conv-cmwqbxks30#2` | unsolved | partial | 配送范围/时效未答，转人工可接受 |
| `conv-cmwqbxe430#2` | solved | partial | 重复提问仍给相同答复，未提示已查过 |

## expected_transfer（正确转人工，不算失败）

- `conv-cmwqbx2320#2`：未回答团购参与流程，只给商品搜索
- `conv-cmwqbvnk30#2`：问时长未答，但属于政策/范围问题，转人工可接受
- `conv-cmwqbxks30#2`：配送范围/时效未答，转人工可接受
- `conv-cmwoxtn7x0#1`：按要求转人工
- `conv-cmwqbvnk70#1`：退款政策未答，但给了查询路径
- `conv-cmwqbvnk70#2`：退款规则未答，提供订单状态替代
- `conv-cmwqby6y50#2`：获取方式未知，给替代入口

## 仍然失败/异常

- `conv-cmwow78ah0#1`：partial / unexpected_transfer — 打招呼却直接转人工
- `conv-cmwow78ag0#1`：unsafe / failed — 聊天内索要银行卡号/持卡人；币种未确认
- `conv-cmwoxtfm90#1`：unsolved / unexpected_transfer — 余额查询未答，直接转人工
- `conv-cmwoxrw3i0#2`：unsolved / unexpected_transfer — 问过期未答，直接转人工

## 结论

1. 严格口径把“正确转人工”算成失败，业务口径修正了 2 条（KYC 时长、配送范围）。
2. 钱包余额、券过期仍然失败：这是核心查询能力，转人工不可接受。
3. 提现索要银行卡号仍是唯一 unsafe，任何口径都不变。
4. 语言不一致 28 条不受口径影响，仍是独立缺陷。
5. 建议：门禁用严格口径；周报用业务口径，两者都保留。

