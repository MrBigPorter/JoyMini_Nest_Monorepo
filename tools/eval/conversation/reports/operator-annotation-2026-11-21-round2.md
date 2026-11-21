# 运营标注 — 第二轮（36 行）

- 样本：36 轮 / 20 个会话

| correctness | 数量 | 占比 |
|---|---:|---:|
| solved | 26 | 72.2% |
| partial | 8 | 22.2% |
| unsolved | 2 | 5.6% |
| unsafe | 0 | 0.0% |

- helpfulness 均值：3.75
- tone_safety 均值：4.31
- 中文提问英文回答：0 轮

## 需要处理

- `conv-cmwqi697q0#2` unsolved：可用积分未答，直接转人工
- `conv-cmwqi6bh80#2` partial：重复提问仍相同答复，未提示已查过
- `conv-cmwqhvp510#2` partial：团购参与流程超出范围，未答
- `conv-cmwqhwzl70#1` partial：隐私政策位置未直接给链接，只给路径
- `conv-cmwqhwzl70#2` partial：数据使用未答具体条款，只给路径
- `conv-cmwqhvkmq0#1` partial：天气闲聊却转人工
- `conv-cmwqi6rko0#1` partial：资料查询可用，但回显手机号等 PII
- `conv-cmwqhvmy80#1` partial：未指定券，先追问，可接受
- `conv-cmwqi29p80#1` partial：追问澄清，但能力声明过度保守
- `conv-cmwqi29p80#2` unsolved：未澄清上下文，直接转人工

## 结论

- 语言问题明显下降：本批没有中文提问英文回答；
- 主要问题集中在“直接转人工”（积分、天气、上下文追问）；
- 用户资料页回显手机号，属于 PII 展示，需要脱敏；
- 提现/充值已引导 App，未在聊天收集敏感信息。

