# AI 操作确认卡片 + Callback 机制补全

> 版本: v1.0
> 状态: Draft
> 关联文档: #77 AI-Socket统一实施、#79 转人工友好提示、#80 超时刷新修复

---

## 1. 背景

### 1.1 两个问题，一个根因

当前 AI 客服在两个地方暴露了同一个架构缺陷——**callback 机制不完整**：

| 问题 | 现象 | 根因 |
|------|------|------|
| **转人工信号被吞** | AI 说了"转人工"但 handlerId 没写，下条消息又触发 AI | `AiMessageListener` 传的 callbacks 缺 `onTransfer` |
| **写操作用文字确认** | 提现/领券/抽奖全靠 LLM 文字问"确认吗？"，无服务端强制 | 没有 `AI_CONFIRM` 事件让 Flutter 渲染卡片 + 按钮回调 |

现在的架构只有**单向通道**：

```
Server → AI_TOKEN / AI_STEP / AI_DONE → Client（Flutter）
```

缺少的是**半双工通道**——AI 说"需要你做决定"，等前端回传"用户选了确认/取消"：

```
Server → AI_CONFIRM { action, params, token } → Flutter 渲染卡片
                                                     ↓ 用户点按钮
Flutter → AI_CONFIRM_RESPONSE { token, accepted } → Server 执行/取消
```

### 1.2 安全问题背景

从 security-review 发现：`applyWithdraw` 工具执行提现时**无服务端 OTP 强制校验**，纯靠 LLM prompt 约束。可以被 prompt injection 绕过直接提现。卡片 + 按钮确认可以在用户侧增加一道物理防误触，但服务端仍需 OTP gate。

---

## 2. 影响范围

### 2.1 受影响的写操作

| 操作 | 工具名 | 风险 | 目前确认方式 |
|------|--------|------|-------------|
| `applyWithdraw` 提现 | wallet-tools.ts | 🔴 资金 | LLM 文字确认 |
| `claimCoupon` 领券 | coupon-tools.ts | 🟡 | LLM 文字确认 |
| `redeemCouponCode` 兑换码 | coupon-tools.ts | 🟡 | LLM 文字确认 |
| `draw` 抽奖 | lucky-tools.ts | 🟡 | LLM 文字确认 |
| `deleteAddress` 删地址 | user-tools.ts | 🟡 | LLM 文字确认 |

### 2.2 不需要卡片（文字确认够）

| 操作 | 原因 |
|------|------|
| `createAddress` | 新增地址，影响可逆 |
| `updateAddress` | 修改地址，影响可逆 |

### 2.3 受 callback 影响的路径

| 路径 | 当前状态 | 问题 |
|------|----------|------|
| SSE Controller | 有 `onToken/onStep/onDone/onError/onTransfer` | 正常 |
| Socket Listener（`ai-message.listener.ts`） | 只有 `onToken/onStep/onDone/onError` | **缺 onTransfer！** |
| Socket Listener（加上卡片后） | 还需加 `onConfirm/onCancel` | **缺 onConfirm！** |

---

## 3. 方案设计

### 3.1 总体流程图

```
用户: "提现 500 到 GCash"
  │
  ▼
┌─────────────────────────────────────────────────┐
│ LangGraph 流水线                                  │
│   1. intentRouter → 分类为 wallet                 │
│   2. orchestrator → walletAgent 执行              │
│      (当前: 直接调 applyWithdraw)                  │
│      (新: 不调 tool，返回确认请求)                   │
└─────────────────────────────────────────────────┘
  │ 确认请求
  ▼
AiCustomerService → 检查是否需要确认
  │ 发送 AI_CONFIRM 事件（含 confirmToken）
  ▼
EventsGateway.dispatch → Socket IO
  │
  ▼
┌─────────────────────────────────────────────────┐
│ Flutter 渲染确认卡片                               │
│ ┌──────────────────────────┐                     │
│ │ 💳 提现确认              │                     │
│ │ 金额: ₱500               │                     │
│ │ 渠道: GCash               │                     │
│ │ 手续费: ₱10              │                     │
│ │ 预计到账: 1-3工作日       │                     │
│ │                          │                     │
│ │ [✅ 确认]  [❌ 取消]     │                     │
│ └──────────────────────────┘                     │
└─────────────────────────────────────────────────┘
  │ 用户点"确认"
  ▼
Flutter → Socket 发送 AI_CONFIRM_RESPONSE { token, accepted: true }
  │
  ▼
EventsGateway → 触发 onConfirm 回调
  │
  ▼
AiCustomerService → 验证 token → 执行 applyWithdraw
  │ 发送 AI_DONE / 操作结果
  ▼
用户看到结果

```

### 3.2 Socket 事件定义

在 `packages/shared/src/im/constants.ts` 新增：

```typescript
export const SocketEvents = {
  // ...现有事件...
  
  // ── AI 操作确认 ──
  AI_CONFIRM: "ai_confirm",           // Server → Client: 需要用户确认
  AI_CONFIRM_RESPONSE: "ai_confirm_response",  // Client → Server: 用户确认/取消
  AI_ACTION_RESULT: "ai_action_result", // Server → Client: 操作执行结果
};
```

**AI_CONFIRM 事件 payload**:

```typescript
{
  conversationId: string;
  action: string;            // 'withdraw' | 'claim_coupon' | 'redeem_code' | 'draw' | 'delete_address'
  params: Record<string, any>;  // 操作参数（用于渲染卡片）
  summary: {                  // 展示信息
    title: string;           // "提现确认"
    amount?: string;         // "₱500"
    channel?: string;        // "GCash"
    fee?: string;            // "₱10"
    account?: string;        // "0917****89"（脱敏）
    items?: Array<{ label: string; value: string }>; // 通用键值对
  };
  confirmToken: string;      // 一次性 token，锁定参数
  expiresAt: number;         // Token 过期时间（60s）
}
```

**AI_CONFIRM_RESPONSE 事件 payload**:

```typescript
{
  conversationId: string;
  confirmToken: string;
  accepted: boolean;         // true=确认, false=取消
  userId: string;
}
```

### 3.3 ConfirmToken 安全设计

`ai-action-confirm.service.ts`（新增）：

```typescript
class AiActionConfirmService {
  // 生成 token，绑定参数
  generate(userId: string, action: string, params: object): {
    token: string;     // UUID
    expiresAt: number; // 60s TTL
  }
  
  // 验证并消费 token
  consume(token: string): {
    valid: boolean;
    userId: string;
    action: string;
    params: object;
  } | null
  
  // Token 属性
  // - UUID 不可猜测
  // - 60s 过期
  // - 一次性使用（消费后删除）
  // - 绑定 userId + action + params（防止篡改）
  // - 存储: Redis（生产）/ Map（开发）
}
```

### 3.4 Callback 机制统一

当前 callback 接口：

```typescript
interface AiStreamCallbacks {
  onToken: (token: string) => void;
  onStep: (step: string, data: any) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  onTransfer?: (reason: string) => void;  // 已有，但部分调用方没传
}
```

扩展为：

```typescript
interface AiStreamCallbacks {
  onToken: (token: string) => void;
  onStep: (step: string, data: any) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  onTransfer?: (reason: string) => void;
  onConfirm?: (action: string, params: object, summary: object, confirmToken: string) => void;
  onConfirmResult?: (token: string, accepted: boolean) => Promise<boolean>;
}
```

**所有调用方必须传完整 callbacks**：

| 调用方 | onTransfer | onConfirm | 状态 |
|--------|-----------|-----------|------|
| SSE Controller | ✅ 有 | 需新增 | ⚠️ |
| `AiMessageListener`（Socket） | 🔴 缺 | 需新增 | 🚨 要修 |
| testChat（测试） | N/A | N/A | ✅ |

### 3.5 状态管理流程

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  PENDING     │────→│  AWAITING    │────→│  COMPLETED   │
│  (AI 刚返回)  │     │  (等待用户)   │     │  (执行成功)   │
└──────────────┘     └──────────────┘     └──────────────┘
                           │
                           │ 超时 / 取消
                           ▼
                     ┌──────────────┐
                     │  CANCELLED   │
                     │  (未执行)     │
                     └──────────────┘
```

- ConfirmToken 存储在 Redis，key=`confirm:{token}`
- TTL 60s，到期自动删除 → 用户点确认时 token 无效 → 提示"已过期"
- 用户点了确认但 token 已过期 → 提示"确认已过期，请让 AI 重新发起"

---

## 4. 状态穷举

### 4.1 确认卡片

| 状态 | 表现 | 处理 |
|------|------|------|
| ✅ 正常 | 卡片展示金额/渠道/费用 + 确认/取消按钮 | 点确认→执行，点取消→放弃 |
| 🔴 错误 | Socket 断开，卡片出不来 | 提示"网络异常，请重试" |
| 🟡 边界 | 余额不足 / 已达上限 / KYC 未完成 | 卡片底部显示红色提示 |
| 🟡 边界 | 操作参数包含敏感信息（完整手机号） | 卡片上手机号脱敏显示 |
| 🔵 加载 | 用户点了"确认"后按钮变 loading | disable 按钮 + spinner |
| 🟡 边界 | 用户点确认但 token 已过期 | 提示"确认已过期" |
| 🟡 边界 | 用户快速连点两次确认 | 防重放（token 一次性） |
| ⚪ 空 | （不适用） | - |
| ⚠️ 中断 | 用户切到后台再回来，卡片还在 | token 可能过期，检查后显示 |

### 4.2 Callback 缺失场景（转人工）

| 状态 | 表现 | 处理 |
|------|------|------|
| ✅ 正常 | `onTransfer` 存在 → 写 handlerId + dispatc AI_TRANSFER | 正常转人工 |
| 🔴 错误 | `onTransfer` 不存在 → 走到 else → `onDone()` | **当前 bug！转人工被吞** |
| 🟡 边界 | `onTransfer` 存在但 DB 写入失败 | 记录日志，重试 |

---

## 5. 技术方案

### 5.1 后端改动

#### 新增文件

| 文件 | 职责 | 行数 |
|------|------|------|
| `apps/api/src/client/ai-customer/graph/ai-action-confirm.service.ts` | ConfirmToken 生成/验证/过期管理 | ~80 |
| （不需要额外模块，直接注册到 ai-customer.module.ts） | | |

#### 修改文件

| 文件 | 改动 | 行数 |
|------|------|------|
| `packages/shared/src/im/constants.ts` | +3 事件常量 | ~5 |
| `apps/api/src/client/ai-customer/ai-customer.service.ts` | chatStream 方法加 onConfirm 处理分支 | ~40 |
| `apps/api/src/client/ai-customer/ai-customer.service.ts` | 修复 transfer 分支（确保 onTransfer 存在才进） | ~5 |
| `apps/api/src/client/ai-customer/ai-message.listener.ts` | 补全 onTransfer + onConfirm callbacks | ~15 |
| `apps/api/src/client/ai-customer/ai-customer.controller.ts` | SSE 路径补全 onConfirm callback | ~10 |
| `apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts` | 写操作前插入 confirm 检查点（替代直接调 tool） | ~50 |
| `apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts` | 声明哪些操作需要确认（meta 数据） | ~10 |
| `apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts` | 同上 | ~5 |
| `apps/api/src/client/ai-customer/graph/tools/lucky-tools.ts` | 同上 | ~5 |
| `apps/api/src/client/ai-customer/graph/tools/user-tools.ts` | 同上（deleteAddress） | ~5 |
| `apps/api/src/client/ai-customer/graph/state.ts` | 可选：加 confirmRequest 字段 | ~10 |
| `apps/api/src/client/ai-customer/ai-customer.module.ts` | 注册 ai-action-confirm.service | ~3 |

### 5.2 Flutter 改动

#### 新增文件

| 文件 | 职责 | 行数 |
|------|------|------|
| `lib/ui/chat/models/ai_action_model.dart` | AI_CONFIRM/ACTION_RESULT 数据模型 | ~60 |
| `lib/ui/chat/components/bubbles/ai_confirm_card.dart` | 确认卡片 widget | ~120 |

#### 修改文件

| 文件 | 改动 | 行数 |
|------|------|------|
| `lib/ui/chat/components/chat_bubble.dart` | _buildContentFactory 加 case MessageType.card | ~8 |
| `lib/ui/chat/handlers/chat_event_handler.dart` | _onAiEvent 加 ai_confirm 处理 | ~30 |
| `lib/ui/chat/providers/chat_view_model.dart` | 加 confirmRequest/confirmResult 状态 | ~15 |
| `lib/core/constants/socket_events.dart` | 同步后端事件名 | ~5 |
| `lib/core/services/socket/chat_extension.dart` | 加 ai_confirm_response 发送方法 | ~10 |

### 5.3 依赖关系

```
P0: 修 callback（listener 缺 onTransfer）
  │
  ├──→ P1: 加 onConfirm callback（复用同一机制）
  │        │
  │        └──→ P2: AI_CONFIRM 事件 + 后端 confirm token
  │                 │
  │                 └──→ P3: Flutter 确认卡片 UI
```

- P0 和 P1-P3 **不能并行**（P1 依赖 callback 机制就绪）
- P2 和 P3 **可以并行**（后端发事件 + Flutter 收事件可同时开发）

---

## 6. 工作量评估

### 6.1 按层估算

| 层级 | 新增文件 | 修改文件 | 代码行数 | 预估 |
|------|----------|----------|----------|------|
| 后端 callback 修 bug | 0 | 3 | ~30 | **0.5d** |
| 后端 confirm token | 1 | 6 | ~150 | **1d** |
| 后端 orchestrator 确认点 | 0 | 2 | ~60 | **0.5d** |
| Flutter 卡片 UI | 2 | 5 | ~250 | **1d** |
| **合计** | **3** | **16** | **~490** | **3d** |

### 6.2 分批建议

| 批次 | 内容 | 预估 | 交付物 |
|------|------|------|--------|
| **P0 🚨** | 修 `AiMessageListener` 缺 `onTransfer` 的 bug | **0.5d** | 转人工不再被吞 |
| **P1** | `AiActionConfirmService` + callback 扩展 + orchestrator 确认点 | **1.5d** | 后端确认机制就绪 |
| **P2** | Flutter 确认卡片 UI + Socket 事件对接 | **1d** | 用户可见卡片 |

---

## 7. 安全设计

| 风险 | 防护 | 实现 |
|------|------|------|
| prompt injection 绕过确认 | 服务端硬性要求 confirmToken 验证 | `AiActionConfirmService.consume()` |
| token 被截获重放 | 一次性 + 60s TTL | UUID + Redis 自动过期 |
| 篡改操作参数 | token 签名绑定 params + userId | 生成时锁死参数，验证时比对 |
| 用户误触"确认" | 卡片清晰展示所有参数 + 金额高亮 | UI 设计 |
| 跨用户确认 | token 绑定 userId | 验证时校验 userId 是否匹配 |

---

## 8. 验证方式

### 单元测试

| 测试项 | 输入 | 预期 |
|--------|------|------|
| confirm token 生成 | userId + action + params | 返回有效的 UUID token |
| token 验证通过 | 正确的 token | 返回绑定的 params |
| token 重放 | 已消费的 token | 返回 null |
| token 过期 | 超过 60s 的 token | 返回 null |
| token 参数篡改 | 修改过的 params | 验证失败 |

### 集成测试

| 场景 | 步骤 | 预期 |
|------|------|------|
| 完整确认流程 | AI 返回请求 → 卡片 → 点确认 → 执行 | 操作成功 |
| 用户取消 | 卡片 → 点取消 | 不执行操作 |
| token 过期后点确认 | 等 61s → 点确认 | 提示"已过期" |

### 验收标准

- [ ] 转人工不再被 Socket 路径吞掉
- [ ] 5 个写操作（提现/领券/兑换码/抽奖/删地址）都走卡片确认
- [ ] confirmToken 防重放、防篡改
- [ ] TypeScript 编译 0 error
- [ ] Flutter 卡片渲染 + 按钮交互正常
- [ ] AI 文案不是英文
