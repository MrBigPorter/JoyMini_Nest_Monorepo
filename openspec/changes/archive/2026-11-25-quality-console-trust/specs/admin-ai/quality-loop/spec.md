# Spec Delta — admin-ai/quality-loop

## ADDED Requirements

### Requirement: 批量排除必须逐条反馈结果

批量排除 SHALL 通过一次服务端批量接口完成，单次请求 MUST NOT 超过 50 条；响应 MUST 逐条给出成功标识与被跳过原因。MUST NOT 由前端并发逐条提交，MUST NOT 只返回成功数量，MUST NOT 默认排除判官失败（`MODEL_ERROR`）记录。

#### Scenario: 部分记录不可排除

- **WHEN** 一次批量排除包含已处理或不满足排除条件的记录
- **THEN** 响应 MUST 分别列出成功标识与被跳过记录的原因

#### Scenario: 超过单次上限

- **WHEN** 请求包含超过 50 条记录
- **THEN** 系统 MUST 返回参数错误，MUST NOT 截断后继续执行

#### Scenario: 包含判官失败记录

- **WHEN** 批量选择中包含判官失败记录
- **THEN** 该记录 MUST 被跳过并在结果中说明，MUST NOT 被静默排除
