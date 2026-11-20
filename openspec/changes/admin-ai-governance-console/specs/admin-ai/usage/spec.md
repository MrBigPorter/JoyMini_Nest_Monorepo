# Spec Delta

## Purpose

规定 admin 端 AI token 用量的读取契约，明确口径，避免把不完整数据当成完整成本。

## ADDED Requirements

### Requirement: 用量汇总必须标明口径

系统 SHALL 展示 token/请求数/用户数汇总与按天序列；MUST 标明仅 AI 客服主链路、成功流、UTC 日期。

#### Scenario: 查看汇总

- **WHEN** 运营打开 `/ai-ops/usage`
- **THEN** 页面展示汇总与 coverage note

### Requirement: 用户用量必须可分页查询

系统 SHALL 按日期范围分页展示用户 token 用量，并标记超过日配额的用户。

#### Scenario: 超限用户

- **WHEN** 用户当日 token 达到 `AI_DAILY_TOKEN_LIMIT`
- **THEN** 列表标记 overDailyLimit

### Requirement: 配额必须只读展示

系统 SHALL 展示当前每日/会话配额；本期 MUST NOT 提供在线修改。

#### Scenario: 查看配额

- **WHEN** 页面加载
- **THEN** 显示 `AI_DAILY_TOKEN_LIMIT` / `AI_SESSION_TOKEN_LIMIT` 当前值
