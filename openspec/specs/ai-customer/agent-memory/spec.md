# ai-customer/agent-memory Specification

## Purpose
规定 AI 客服跨会话用户记忆的存储、读取、注入、过期与删除契约。目标是让用户在换会话或重启后仍能被认出，同时以白名单约束敏感信息，保证记忆可追溯、可过期、可删除，并严格按用户隔离。

## Requirements

### Requirement: 记忆必须按用户隔离

系统 SHALL 以触发本轮消息的用户为主体存取记忆；MUST NOT 按会话或线程共享记忆，客服会话中的其他成员不得读取该用户记忆。

#### Scenario: 客服会话

- **WHEN** 同一会话中存在用户与人工客服
- **THEN** 记忆只属于提问用户，不因会话共享而互相可见

### Requirement: 记忆不得保存敏感原文

系统 SHALL 只保存蒸馏后的偏好、事实与摘要；MUST NOT 保存手机号、证件号、地址、订单号、验证码、支付信息或完整对话原文。

#### Scenario: 用户提供手机号

- **WHEN** 用户消息包含手机号
- **THEN** 记忆抽取不写入该号码，只允许保存“已绑定手机”这类布尔提示

### Requirement: 记忆必须可过期、可删除、可追溯

系统 SHALL 为每条记忆记录来源、版本、置信度与过期时间；用户注销或主动删除时 MUST 删除或匿名化对应记忆。

#### Scenario: 用户注销

- **WHEN** 用户完成账号注销流程
- **THEN** 该用户的长期记忆被删除或匿名化，并留下删除审计

### Requirement: 记忆注入必须覆盖所有回答路径

系统 SHALL 在统一入口读取记忆并注入标准 Agent、闲聊、RAG 与合成器路径；MUST NOT 只修改单条 Agent 的 prompt 构造。

#### Scenario: RAG 回答

- **WHEN** 用户问题走 RAG 路径
- **THEN** 回答仍能看到该用户的偏好/摘要，而不是只有标准 Agent 能看到

### Requirement: 记忆不得写入会话消息通道

系统 SHALL 将记忆作为独立上下文注入；MUST NOT 写入 `state.messages` 或持久化为用户/AI 原话，避免污染对话与放大隐私数据。

#### Scenario: 下一轮上下文

- **WHEN** 注入过记忆的会话进入下一轮
- **THEN** 记忆不会被当成上一轮用户或 AI 的原话重复出现

### Requirement: 记忆写入失败不得阻断回复

系统 SHALL 异步写入记忆；抽取或存储失败 MUST 只记录，不影响本轮回答。

#### Scenario: 存储故障

- **WHEN** 记忆表写入失败
- **THEN** 用户仍收到正常回复，错误进入日志与指标
