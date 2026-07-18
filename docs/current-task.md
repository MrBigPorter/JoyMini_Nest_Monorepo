# Current Task — AI 操作确认卡片 + Callback 机制补全

---

## 需求背景

两个问题共享同一个根因——**callback 机制不完整**：

| 问题 | 现象 | 根因 |
|------|------|------|
| **转人工信号被吞** | Socket 路径转人工后 handlerId 没写，下次消息又触发 AI | `AiMessageListener` 传的 callbacks 缺 `onTransfer` |
| **写操作无卡片确认** | 提现/领券全靠 LLM 文字"确认吗？"，可被 prompt injection 绕过 | 没有 `AI_CONFIRM` 事件 + 按钮回调机制 |

详见 `docs/AI-joymini/81-AI操作确认卡片与Callback补全.md`

---

## 实施计划（分批）

### P0 🚨 — 修 listener callback（~0.5d）

| 改动 | 文件 | 说明 |
|------|------|------|
| 补全 `onTransfer` | `ai-message.listener.ts` | 加 onTransfer callback，确保 Socket 路径转人工正常 |
| 确认所有路径一致 | `ai-customer.controller.ts`、`ai-message.listener.ts` | onTransfer/onConfirm 全部传参 |

### P1 🔵 — 后端确认机制（~1.5d）

| 改动 | 文件 | 说明 |
|------|------|------|
| 新建 `AiActionConfirmService` | `ai-action-confirm.service.ts` | ConfirmToken 生成/验证/过期管理（UUID + 60s TTL） |
| 扩展 Socket 事件 | `packages/shared/src/im/constants.ts` | +3 事件：AI_CONFIRM / AI_CONFIRM_RESPONSE / AI_ACTION_RESULT |
| 修改 orchestrator | `orchestrator.node.ts` | 写操作前插入确认检查点，替代直接调 tool |
| 声明需要卡片确认的操作 | `wallet-tools.ts`、`coupon-tools.ts`、`lucky-tools.ts`、`user-tools.ts` | 标记写操作为 confirm-required |
| 扩展 callback 接口 | 相关文件 | onConfirm/onConfirmResult |

### P2 🟢 — Flutter 确认卡片 UI（~1d）

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增数据模型 | `ai_action_model.dart` | AI_CONFIRM / ACTION_RESULT 模型 |
| 新增卡片 widget | `ai_confirm_card.dart` | 确认卡片（金额/渠道/费用 + 确认/取消按钮） |
| 修改 chat_bubble | `chat_bubble.dart` | _buildContentFactory 加 case MessageType.card |
| 处理 AI_CONFIRM 事件 | `chat_event_handler.dart` | 收到确认事件 → 渲染卡片 |
| 同步事件常量 | `socket_events.dart`、`chat_extension.dart` | 后端事件 + 发送确认回执 |

### 📋 待办（低优先级，不 blocking）

| 任务 | 优先级 |
|------|--------|
| Flutter SSE 代码清理（删除已标记文件） | 🟡 中 |
| Flutter 端重新编译部署 | 🟡 中 |
| 中文 human_support 示例（Admin 面板） | 🟢 低 |
| ChatPage 刷新后 handlerId 判断 | 🟢 低 |

---

## Review 发现的 Bug（code-review + security-review）

### 🔴 需要在本任务中修复

| Bug | 文件 | 说明 |
|-----|------|------|
| Socket 路径缺 conversation type 过滤 | `events.gateway.ts:419` | 群聊/私聊也会触发 AI（只检查 handlerId，没检查对话类型） |
| Socket 路径 handler 永不超时 | `events.gateway.ts:412-417` | 无 timeout 检查，无条件刷新 handlerAssignedAt |
| listener 缺 onTransfer | `ai-message.listener.ts` | 转人工信号被静默吞掉 |
| applyWithdraw 无 OTP 强制校验 | `wallet-tools.ts:387` | 纯靠 LLM prompt 约束，可被 bypass |
| 超时 reset 在事务外 | `chat.service.ts:107-136` | 事务失败时 handlerId 已修改，无法回滚 |

### 🟡 已知但非阻塞

| Bug | 文件 | 说明 |
|-----|------|------|
| LLM 转人工文案没流到用户 | `orchestrator.node.ts:713` | model.invoke() 非流式，transfer 路径不 token |
| LLM 异常时无 fallback 消息 | `orchestrator.node.ts:722` | catch 返回 messages: undefined |
| 缺 previousIntent | `orchestrator.node.ts:713` | human_support 路径漏了 |

---

## 参考文档

| 文档 | 内容 |
|------|------|
| `docs/AI-joymini/81-AI操作确认卡片与Callback补全.md` | 完整规格：方案/状态穷举/技术方案/工作量 |
| `docs/AI-joymini/PROGRESS.md` | 项目整体进度 |
| `docs/coding-standards.md` | 9 维度检查清单 |
