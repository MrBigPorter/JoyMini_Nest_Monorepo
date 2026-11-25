# Spec Delta — ai-customer/quality-loop

## MODIFIED Requirements

### Requirement: 任务成功率必须独立判定

系统 SHALL 在意图准确率之外判定「问题是否被解决」，判定 MUST 由与被测模型不同厂商的模型完成，且 MUST 有人工抽检校准。人工校准结果 MUST 持久化并记录标注者与指南版本；样本量低于 20 时 MUST 不下结论。

#### Scenario: 不同厂商 judge

- **WHEN** 执行任务成功率评测
- **THEN** 判分模型与被测模型不属于同一厂商

#### Scenario: 人工校准

- **WHEN** 抽检不少于 10% 且样本量至少 20 条的样本与 judge 结论对比
- **THEN** 一致率 MUST 不低于 80%，低于则需调整判定标准或改用人工；样本量不足 20 条时 MUST 标注「样本不足」且不下结论

#### Scenario: 写操作不被真实执行

- **WHEN** 评测样本涉及写操作
- **THEN** 系统只判定确认卡片是否正确生成，不真正执行写操作
