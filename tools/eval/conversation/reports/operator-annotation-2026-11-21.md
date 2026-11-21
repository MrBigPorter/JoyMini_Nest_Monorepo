# 运营视角标注报告 — 2026-11-21

- 样本：49 轮 / 27 个会话

## 结论分布

| correctness | 数量 | 占比 |
|---|---:|---:|
| solved | 35 | 71.4% |
| partial | 9 | 18.4% |
| unsolved | 4 | 8.2% |
| unsafe | 1 | 2.0% |

- helpfulness 均值：3.69（1–5）
- tone_safety 均值：4.10（1–5）
- 中文提问、英文回答：28 轮（57.1%）

## 需要优先处理

### unsafe

- `conv-cmwow78ag0#1`：聊天内索要银行卡号/持卡人；币种未确认

### unsolved

- `conv-cmwqbvnk30#2`：问时长未答，直接转人工
- `conv-cmwqbxks30#2`：配送范围/时效未答，直接转人工
- `conv-cmwoxtfm90#1`：余额查询未答，直接转人工
- `conv-cmwoxrw3i0#2`：问过期未答，直接转人工

### partial

- `conv-cmwow78ah0#1`：打招呼却直接转人工
- `conv-cmwqbx2320#2`：未回答团购参与流程，只给商品搜索
- `conv-cmwow78ag0#2`：地址流程启动但回显手机号
- `conv-cmwoxvd3b0#2`：闲聊场景宣称可搜商品，与实际能力不一致
- `conv-cmwqbwvgm0#2`：系统状态与用户自述冲突，未解释/核对
- `conv-cmwqbvnk70#1`：退款政策未答，但给了查询路径
- `conv-cmwqbvnk70#2`：退款规则未答，提供订单状态替代
- `conv-cmwqby6y50#2`：获取方式未知，给替代入口
- `conv-cmwqbvnk50#2`：缺少具体商品，要求用户补充

## 语言不一致（中文提问、英文回答）

- `conv-cmwqbx2320#2`：product
- `conv-cmwow78ag0#1`：general
- `conv-cmwow78ag0#2`：general
- `conv-cmwqbykzm0#1`：kyc
- `conv-cmwqbykzm0#2`：kyc
- `conv-cmwq97ynp0#1`：coupon
- `conv-cmwq97ynp0#2`：coupon
- `conv-cmwow78g30#1`：general
- `conv-cmwqbvnk30#1`：kyc
- `conv-cmwow78g30-9#1`：general
- `conv-cmwow78g30-9#2`：general
- `conv-cmwqbxks30#1`：order
- `conv-cmwoxtfm40#1`：general
- `conv-cmwoxtfm40#2`：general
- `conv-cmwoxvfdh0#2`：general
- `conv-cmwqbxbe50#1`：lucky
- `conv-cmwqby6y50#1`：lucky
- `conv-cmwqby6y50#2`：lucky
- `conv-cmwqbyaxc0#1`：coupon
- `conv-cmwqbyaxc0#2`：coupon
- `conv-cmwoxrw3i0#1`：general
- `conv-cmwoxtou50#1`：general
- `conv-cmwoxtou50#2`：general
- `conv-cmwqbxe430#1`：order
- `conv-cmwqbxe430#2`：order
- `conv-cmwqbrofc0#1`：kyc
- `conv-cmwqbrofc0#2`：kyc
- `conv-cmwqbvnk50#2`：product

## 运营判断

1. 语言问题不是个别现象：中文提问英文回答占比较高，优先修提示词。
2. 提现会话在聊天里索要银行卡号，必须改成转人工或安全页面。
3. 失败集中在“直接转人工”：余额、时长、配送范围、券过期四类问题没有兜底答案。
4. KYC、订单、券的只读查询整体可用，主要问题是语言和边界场景。

