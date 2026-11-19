# Spec Delta

## ADDED Requirements

### Requirement: 无关问题必须拒答

系统 SHALL 在关键词层没有任何候选且 rerank 最高分低于配置阈值时返回空结果，不得把低相关文档交给回答模型。阈值 MUST 可配置，默认值 MUST 由正负样本校准得出。

#### Scenario: 域外问题

- **WHEN** 用户询问与知识库无关的问题
- **THEN** 关键词层无候选且 rerank 分数低于阈值，系统返回空结果

#### Scenario: 关键词命中

- **WHEN** 问题命中知识库关键词
- **THEN** 即使 rerank 分数偏低，该文档仍可保留

#### Scenario: reranker 不可用

- **WHEN** reranker 未启用或返回空
- **THEN** 系统不套用该阈值，继续使用 RRF 降级排序
