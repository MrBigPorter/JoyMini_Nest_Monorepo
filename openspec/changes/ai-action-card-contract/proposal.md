# Proposal

## Why

AI 写操作确认卡片现在有后端、有 Flutter UI、也有测试，但**端到端跑不通**：Flutter 只监听 `dispatch` 事件，却没把 `ai_confirm` / `ai_action_result` 放进分发 switch，卡片到达客户端即被丢弃；即使显示，确认按钮也直接调业务接口，绕过 `confirmToken` 与提现 OTP。与此同时，7 个写工具里有 2 个（新增/修改地址）没有动作映射与确认分支，启动自检又拿名单跟自己比，永远报不出缺漏。

## What Changes

- 建立**单一动作目录**：每个写工具对应 `action id / 标题 / 展示字段 / 执行参数 / 是否 OTP / 幂等键 / 过期时间`，三端从同一目录生成或校验，禁止手工维护第二份名单。
- 补齐 `createAddress`、`updateAddress` 两张卡片：动作映射、摘要、后端确认分支、Flutter 展示与执行。
- 修复 Flutter 卡片链路：`ai_confirm` / `ai_action_result` 进入事件分发；确认改调 `POST /ai/customer/confirm`（携带 token）；提现再走 `POST /ai/customer/confirm/otp`。
- 修复卡片状态机：过期真实生效（按 `expiresAt`）、成功后卡片可关闭、取消有明确终态。
- 恢复聊天提现：确认卡片 + 短信 OTP 双保险；禁止收集卡号/CVV/密码，只收渠道收款账号。
- 后端补强：写工具必须进入确认流程的启动自检改为**跨目录一致性检查**；未声明能力的副作用工具阻断启动。
- 可观测：动作事件写入 trace/指标，运营可在会话详情看到“卡片已展示 / 已确认 / 已执行 / 已失败 / 已过期”。

## Capabilities

### New Capabilities

- `ai-customer/action-confirmation`: 写操作确认卡片的动作目录、一次性令牌协议、客户端消费方式、提现 OTP、生命周期状态与结果事件。

### Modified Capabilities

<!-- 无。`ai-customer/agent-trust-boundary` 已规定“有副作用的工具必须经确认”，本次是实现对齐，不改变该能力的要求文本。 -->

## Impact

- 后端：`graph/tools/*`（能力声明）、`orchestrator-utils/confirm-utils.ts`（动作目录）、`ai-customer.service.ts`（确认分支、OTP、结果事件）、`tool-registry.service.ts`（自检）、`ai-action-lifecycle.service.ts`（状态机）。
- Flutter：`socket_service.dart`（事件分发）、`chat_event_handler.dart`（解析）、`chat_view_model.dart`（状态与关闭）、`ai_confirm_card.dart`（字段与过期）、`lucky_api.dart`（确认端点）。
- 协议：`AI_CONFIRM` 增加 `requestId`；新增 `AI_ACTION_RESULT` 实际发送；`POST /ai/customer/confirm` 与 `/confirm/otp` 成为客户端唯一确认入口。
- 数据：`ai_action_requests` 状态流转补全；不新增表。
- 文档：本变更取代 `docs/AI-joymini/83` §9.8“客户端直接调业务 API”的旧结论，并关闭 `84` 中 P1-1/P1-2 的未闭环项。
- 非目标：不改 OTP 下发通道与短信供应商；不引入新客户端形态；不改变各业务接口自身语义（仅增加提现的 OTP/令牌校验）。
