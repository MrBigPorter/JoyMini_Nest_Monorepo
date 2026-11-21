# AI 预标注 vs 人工运营标注 — 49 行

- judge: `openai/gpt-oss-120b`（不同厂商）
- 可比样本：49；invalid：0

## AI 分布

| correctness | 数量 |
|---|---:|
| unsolved | 8 |
| partial | 9 |
| unsafe | 1 |
| solved | 31 |

## 与人工的一致性

| 对照 | 一致 | 一致率 | kappa | 结论 |
|---|---:|---:|---:|---|
| 严格运营 | 40/49 | 81.6% | 0.633 | 刚过 0.6，可做初筛 |
| 业务运营 | 37/49 | 75.5% | 0.519 | <0.6，不能单独用于业务结论 |

## 混淆矩阵（AI → 严格）

| AI | 严格 | 数量 |
|---|---|---:|
| solved | solved | 30 |
| partial | partial | 5 |
| partial | solved | 4 |
| unsolved | unsolved | 4 |
| unsolved | partial | 3 |
| unsolved | solved | 1 |
| unsafe | unsafe | 1 |
| solved | partial | 1 |

## 分歧明细

| 样本 | AI | 严格 | 业务 | 人工备注 |
|---|---|---|---|---|
| `conv-cmwow78ah0#1` | unsolved | partial | partial | 打招呼却直接转人工 |
| `conv-cmwqbx2320#1` | unsolved | solved | solved | 无匹配商品，给出替代建议；英文 |
| `conv-cmwoxvd3b0#2` | solved | partial | partial | 闲聊场景宣称可搜商品，与实际能力不一致 |
| `conv-cmwq97ynp0#2` | partial | solved | solved | 订单查无结果，给出核对路径；英文 |
| `conv-cmwow78g30-9#2` | partial | solved | solved | 无记录并说明查看方式 |
| `conv-cmwqbxks30#1` | partial | solved | solved | 无订单，物流无从查；说明清楚 |
| `conv-cmwqbwvgm0#2` | unsolved | partial | partial | 系统状态与用户自述冲突，未解释/核对 |
| `conv-cmwqbwf890#1` | partial | solved | solved | 闲聊自然 |
| `conv-cmwqby6y50#2` | unsolved | partial | partial | 获取方式未知，给替代入口 |

## 分歧模式

1. **AI 对“查无数据”更严**：无订单、无商品、无记录，AI 倾向判 unsolved/partial，人工认为“如实回答无数据”就是 solved。
2. **AI 对闲聊/软回答更严**：天气、你是谁、在吗，AI 容易给 partial。
3. **AI 对能力夸大更宽**：`conv-cmwoxvd3b0#2` 宣称可搜商品，AI 判 solved，人工判 partial。
4. **AI 对政策/范围问题偏严**：KYC 冲突、抽奖券获取方式，AI 判 unsolved，人工按业务口径给 partial。

## 结论

- AI 预标注可用于**初筛和排序**，不能作为最终标签；
- 严格口径 kappa 0.633，刚过门槛；业务口径 0.519，未达标；
- 9 条分歧、1 条 unsafe 必须人工复核；
- 预标注不参与 A/B 人工 kappa。

