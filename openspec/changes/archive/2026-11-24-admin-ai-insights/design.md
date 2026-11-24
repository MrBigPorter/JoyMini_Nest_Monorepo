# Design

## Decisions

- 口径 UTC；只做只读聚合
- 转人工率 = transferReason 非空会话 / SUPPORT+AI 会话
- 重复追问/放弃来自隐式反馈
- 不查向量/不重建事件表

## Risks

- 指标依赖隐式反馈完整性；页面展示 notes 说明口径
