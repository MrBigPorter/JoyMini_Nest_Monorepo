# Spec Delta

## ADDED Requirements

### Requirement: 检索质量必须分层度量

系统 SHALL 在检索评测中分别统计向量层、全文层与关键词层的召回指标；MUST NOT 只用最终 top-K 的命中率推断某一层的效果。任一层召回变化时，报告 MUST 能定位到该层。

#### Scenario: 分词修复后的验收

- **WHEN** 变更只影响关键词层
- **THEN** 报告给出关键词层 Recall@K 的改前/改后对比，而不是只报端到端 Hit@K

#### Scenario: 端到端被重排掩盖

- **WHEN** 最终 Hit@K 不变但关键词层召回已改变
- **THEN** 报告 MUST 显示分层指标，不能据此判定关键词层无变化

### Requirement: 检索评测必须包含无答案样本

系统 SHALL 在检索评测集中包含无答案或域外问题，并统计其误召回率；没有负样本时 MUST NOT 对相关性门槛类改动作出验收结论。

#### Scenario: 负样本误召回

- **WHEN** 用户提出域外问题
- **THEN** 评测记录返回的候选数量与最高分，用于计算误召回率

#### Scenario: 缺少负样本

- **WHEN** 评测集没有无答案样本
- **THEN** 报告 MUST 标注相关性门槛无法验收，而不是只凭正样本 Hit@K 下结论
