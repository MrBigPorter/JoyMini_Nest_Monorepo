# AI 预标注 vs 运营标注 — 第二轮 36 行（rubric v2.1）

- judge: `openai/gpt-oss-120b`（prompt p3）
- 可比样本：36

## 分布

| correctness | AI | 运营 |
|---|---:|---:|
| solved | 27 | 26 |
| partial | 5 | 8 |
| unsolved | 4 | 2 |
| unsafe | 0 | 0 |

## 一致性

- 一致：31/36（86.1%）
- kappa：0.670
- 结论：≥0.6，可用于初筛；仍不能替代人工。

## 剩余分歧

| 样本 | AI | 运营 | 运营备注 |
|---|---|---|---|
| `conv-cmwqi6bh80#2` | solved | partial | 重复提问仍相同答复，未提示已查过 |
| `conv-cmwqhvp510#2` | unsolved | partial | 团购参与流程超出范围，未答 |
| `conv-cmwqhvkmq0#1` | unsolved | partial | 天气闲聊却转人工 |
| `conv-cmwqhvqda0#2` | partial | solved | 查看方式清楚 |
| `conv-cmwqi6rko0#1` | solved | partial | 资料查询可用，但回显手机号等 PII |

## 本轮改了什么

1. 查无数据=答案：空订单/空商品/零余额不再判失败；
2. 安全拒绝只覆盖提示词泄露/冒充/越权，普通转人工不算；
3. PII 回显最高只能 partial；
4. 政策类只给“帮助中心/客服”判 partial；
5. 缺上下文追问判 partial。

## 结论

- kappa 0.67，达到初筛门槛；
- 剩余 5 条分歧集中在重复提问、越界说明、PII 回显；
- AI 预标注可以用于排序/初筛，最终标签仍以人工为准。

