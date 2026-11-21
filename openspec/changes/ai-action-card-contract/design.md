# Design

## Context

现状由四份互不校验的名单拼成：后端写工具（7 个）、`mapToolToAction`（5 个）、`confirmAction` switch（5 个）、Flutter 动作映射（5 个，且执行走业务接口）。`ai-customer/agent-trust-boundary` 已要求“有副作用的工具必须经确认”，但实现没有覆盖 `createAddress` / `updateAddress`，启动自检又是空转。

客户端侧还有三处独立缺陷：`ai_confirm` / `ai_action_result` 未进入 `dispatch` 分发；`copyWith` 无法把 `confirmData` 置空；过期时间只解析不使用。提现 OTP 已实现于确认端点，但客户端从未调用该端点。

本设计的目标不是再补一份名单，而是**让名单只剩一份**。

## Goals / Non-Goals

**Goals:**

- 动作目录成为唯一事实源，写工具、确认分支、卡片展示三者可被自动校验。
- 客户端只认识“令牌 + 通用卡片”，不再按动作写执行分支。
- 提现在聊天与 App 页面都经过 OTP，且只有一次执行点。
- 卡片状态、结果事件、动作记录在真实用户路径上可见。
- 旧客户端行为不劣化：卡片当前本就不工作，不构成回归。

**Non-Goals:**

- 不改造 OTP 短信通道、固定验证码策略或风控规则。
- 不引入服务端推送新通道；仍使用 `dispatch` 私有房间。
- 不新增客户端形态；本次只改 Flutter。
- 不把卡片做成长期可操作对象：有效期仍为 60 秒。

## Decisions

### D1. 动作目录下沉到后端，卡片改为服务端渲染字段

后端维护唯一 `ACTION_CATALOG`：`action / toolName / title / fields(params) / needsOtp / idempotencyKey / ttl`。`mapToolToAction`、`buildConfirmSummary`、`confirmAction` 的 action 分支、启动自检都从目录派生。

`AI_CONFIRM` 载荷改为通用结构：

```json
{
  "conversationId": "...",
  "action": "withdraw",
  "title": "提现确认",
  "fields": [{ "label": "金额", "value": "₱500" }],
  "confirmToken": "...",
  "expiresAt": 1730000000000,
  "requestId": "...",
  "needsOtp": true
}
```

Flutter 只渲染 `title + fields`，不再按 action 维护标题/字段/图标；确认时只提交 `confirmToken`。新增或修改动作不需要改客户端映射。

**替代方案**：在 `packages/shared` 定义目录并生成 Flutter 常量。跨语言生成链更重，且字段仍要客户端拼装；服务端渲染字段更彻底。

### D2. 客户端确认只走确认端点

Flutter 确认按钮调用 `POST /ai/customer/confirm { token }`，服务端按目录执行。提现返回 `{ needOtp: true }`，客户端展示 6 位验证码输入，再调 `POST /ai/customer/confirm/otp { code }`。客户端不再直接调用领券、抽奖、地址、提现业务接口。

`lucky_api.confirmAction(action, params)` 删除；业务接口保留给非 AI 页面使用。

**替代方案**：继续直调业务接口 + 前端校验 token。令牌无法防篡改、生命周期无法回写，弃用。

### D3. 提现执行拆成“公开入口”和“已验签内部入口”

- `ClientWalletService.applyWithdrawVerified(userId, dto)`：真正的唯一执行点，不做 OTP 校验，只允许内部调用。
- `POST /wallet/withdraw/apply` 要求 `otpCode`：先 `otpService.verify(WITHDRAW)`，再调 `applyWithdrawVerified`。
- 卡片路径：`/confirm/otp` 验码后直接调 `applyWithdrawVerified`，不重复验码。
- App 提现页面改为“请求验证码 → 提交带 `otpCode` 的申请”。

**替代方案**：域名接口只信任登录态，OTP 仅卡片路径。等于保留绕过口，弃用。

### D4. 取消需要服务端终态

新增 `POST /ai/customer/confirm/cancel { token }`：带 owner 校验消费令牌，把 `ai_action_requests` 置为 `CANCELLED`。客户端取消按钮调用它，失败也本地关闭卡片。新增状态 `CANCELLED`，与 `EXPIRED` 区分。

### D5. 卡片不恢复为可操作态

服务端在 socket 不可用时仍把卡片消息落库（`ChatMessage.meta.kind=confirm_card`），用于审计与运营诊断。客户端重连/重启后若从历史看到它，只渲染为已过期/只读样式；不恢复令牌，用户需重新发起。60 秒令牌使恢复没有实际价值。

### D6. 自检改为跨层一致性断言

启动时与测试中校验：

1. 所有 `capability.kind === 'write'` 工具都存在于 `ACTION_CATALOG`；
2. 目录中每个 action 都有确认分支；
3. 目录外 action 不得出现在映射或 switch；
4. 未声明能力的副作用命名工具阻断启动（当前仅告警）。

单元测试覆盖“故意漏登记一个动作 → 启动自检失败”。

### D7. Flutter 事件与状态修复

- `socket_service._handleDispatch` 增加 `aiConfirm` / `aiActionResult` 分支；
- `chat_view_model.copyWith` 增加 `clearConfirm` 标志（与 `clearAiError` 同模式），使成功/取消可置空；
- 卡片按 `expiresAt` 启动定时器，到点置 `expired`；
- 新增 `ai_action_result` 解析，更新卡片与会话消息；
- 卡片支持 OTP 输入态（`needsOtp`）。

### D8. 可观测

- 每次动作状态迁移写 `ai_action_requests`；
- 工具调用写入 `ai_spans`（`type=tool`，含工具名、状态、耗时、参数摘要脱敏）；
- 新增计数器 `ai_action_total{action,result}`；
- 会话诊断已能读动作记录，改造后应出现真实用户数据。

## Risks / Trade-offs

- **动作目录成为新的单点**：目录写错会影响全部动作 → 目录用类型约束 + 启动自检 + 每动作单测覆盖。
- **服务端渲染字段丢失富样式**：卡片统一为键值列表，图标与特殊布局退化 → 保留 `action` 供客户端可选映射图标，字段仍由服务端给。
- **提现 OTP 强制化影响旧版 App 页面** → 用 `WITHDRAW_OTP_ENFORCE` 灰度开关：先发布新 App，再开启强制；开关关闭时仅记录“未携带 OTP”指标。
- **OTP 短信成本与限流**：沿用现有 5 分钟有效期与重发限流；不新增发送入口。
- **pending 按用户单键**：同一用户并发两笔提现会互相覆盖（既有问题），本次不扩大；目录层限制单用户同时一个提现动作。
- **旧数据**：历史 `CONFIRM_CREATED` 记录由 cron 置 `EXPIRED`，无需迁移。

## Migration Plan

1. 后端先上目录、自检、`cancel` 端点与 `result` 事件，保持现有行为；
2. Flutter 发布事件分发、token 确认、OTP 输入与状态修复；
3. 打开 `WITHDRAW_OTP_ENFORCE` 观察指标，确认无绕过调用后转为默认强制；
4. 移除旧 `confirmAction(action, params)` 直调分支；
5. 回滚策略：关闭 OTP 强制开关即可恢复旧页面行为；确认端点与目录可独立回滚。

## Open Questions

无。动作范围、提现政策（卡片 + OTP）与客户端路径已在 proposal 阶段确定。
