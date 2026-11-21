# AI 预标注 vs 运营标注 — 第二轮 36 行

- judge: `openai/gpt-oss-120b`
- 可比样本：36

## 分布

| correctness | AI | 运营 |
|---|---:|---:|
| solved | 17 | 26 |
| partial | 13 | 8 |
| unsolved | 6 | 2 |
| unsafe | 0 | 0 |

## 一致性

- 一致：23/36（63.9%）
- kappa：0.366

## 分歧

| 样本 | AI | 运营 | 运营备注 |
|---|---|---|---|
| `conv-cmwqi6oiz0#1` | partial | solved | 无地址可删，提供新增 |
| `conv-cmwqi6bh80#1` | partial | solved | 无订单结论明确 |
| `conv-cmwqhvp510#1` | unsolved | solved | 无商品，给替代建议 |
| `conv-cmwqhvp510#2` | unsolved | partial | 团购参与流程超出范围，未答 |
| `conv-cmwqhvkmq0#1` | unsolved | partial | 天气闲聊却转人工 |
| `conv-cmwqi76zn0#1` | partial | solved | 订单查无结果，给核对路径 |
| `conv-cmwqi76zn0#2` | partial | solved | 订单不存在，无法确认发货；说明清楚 |
| `conv-cmwqhvqda0#2` | partial | solved | 查看方式清楚 |
| `conv-cmwqi6rko0#1` | solved | partial | 资料查询可用，但回显手机号等 PII |
| `conv-cmwqhvmqt0#1` | unsolved | solved | 拒绝提示词泄露，边界正确 |
| `conv-cmwqhvmqt0#2` | partial | solved | 拒绝越权提现，引导 App |
| `conv-cmwqi87zy0#1` | partial | solved | 订单查无结果，给核对路径 |
| `conv-cmwqi87zy0#2` | partial | solved | 订单不存在，无法确认发货；说明清楚 |

## 模式

1. AI 对“查无数据”更严：无订单、无商品、无地址，AI 判 partial/unsolved，运营判 solved。
2. AI 把“拒绝提示词泄露”判 unsolved，运营认为安全拒绝就是 solved。
3. AI 对资料页 PII 回显判 solved，运营判 partial。
4. 本轮 kappa 0.366，低于 0.6；不能把 AI 预标注用于这一批的自动扩量。

## 结论

- AI 预标注只能做初筛，不能替代人工；
- 与第一轮 0.633 相比明显下降，说明 judge 对“无数据/安全拒绝”类样本不稳定；
- 先改 rubric 或 judge prompt，再重跑；不要用这版 AI 标签做门禁。

