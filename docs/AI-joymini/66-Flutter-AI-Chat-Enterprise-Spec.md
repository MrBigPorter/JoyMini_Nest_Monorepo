# AI Chat Flutter 集成 — 企业级规格说明书

> 参考: `65-Flutter-AI-Chat-SSE-Integration.md`（技术实现细节）
> 版本: v1.0
> 状态: Draft

---

## 1. 产品流程图（泳道图）

### 1.1 AI 对话主流程

```
用户                    Flutter App                 Backend SSE
│                        │                          │
│  1. 打开 AI 聊天        │                          │
│   ──────────────────→   │                          │
│                        │  2. 初始化 sessionId      │
│                        │  3. 加载历史消息           │
│                        │                          │
│  4. 输入"取500"         │                          │
│   ──────────────────→   │                          │
│                        │  5. POST /chat-stream     │
│                        │  ──────────────────────→  │
│                        │                          │  6. Intent 分类
│                        │                          │  7. Wallet Agent
│                        │                          │  8. Score Gap Check
│                        │                          │
│                        │  9. ← step(thinking)     │
│                        │  10. ← step(tool_start)  │
│                        │  11. ← step(tool_end)    │
│                        │                          │
│  12. 显示"正在查余额..." │                          │
│                        │                          │
│                        │  13. ← action_card       │
│                        │     {withdraw, data...}   │
│                        │                          │
│  14. 显示取款确认卡片    │                          │
│     金额: ₱500         │                          │
│     手续费: ₱15        │                          │
│     [确认取款]          │                          │
│                        │                          │
│  15. 点击确认取款       │                          │
│   ──────────────────→   │                          │
│                        │  16. POST /wallet/withdraw ← 直接调 API，不经过 AI
│                        │  ──────────────────────→  │
│                        │  ← 取款成功               │
│  17. 显示取款结果       │                          │
```

### 1.2 转人工流程

```
用户                    Flutter App                 Backend SSE              Socket.IO
│                        │                          │                        │
│  点击"转人工"           │                          │                        │
│  ──────────────────→   │                          │                        │
│                        │  关闭 SSE                 │                        │
│                        │  ──────────────────────→  │                        │
│                        │                          │  返回 transfer 事件     │
│                        │                          │                        │
│                        │  进入客服排队             │                        │
│                        │  ──────────────────────────────────────────────→  │
│                        │                          │                        │  分配客服
│                        │  ← 排队位置 #3            │                        │
│                        │                          │                        │
│  显示"排队中，位置 #3"   │                          │                        │
│                        │                          │                        │
│                        │  ← 客服上线               │                        │
│                        │                          │                        │
│  切换到人工客服聊天       │                          │                        │
│  （携带 AI 对话历史）     │                          │                        │
```

---

## 2. API 契约

### 2.1 SSE 事件 JSON Schema

所有事件格式：`data: JSON\n\n`

```typescript
// SSE 事件联合类型
type SseEvent =
  | TokenEvent
  | StepEvent
  | ActionCardEvent
  | DoneEvent
  | ErrorEvent
  | TransferEvent;

// 1. 逐 token 流
interface TokenEvent {
  type: "token";
  content: string; // Markdown 文本片段
}

// 2. 中间步骤状态
interface StepEvent {
  type: "step";
  step: "thinking" | "tool_start" | "tool_end";
  data?: {
    tool?: string;
    content?: string;
  };
}

// 3. 操作卡片（金融操作安全确认）
interface ActionCardEvent {
  type: "action_card";
  action: "withdraw" | "deposit" | "kyc" | "order_cancel" | "address_change";
  data: Record<string, any>; // action 不同，data 结构不同
}

// 取款卡片 data 结构
interface WithdrawCardData {
  amount: number; // 取款金额（分）
  fee: number; // 手续费（分）
  channel: string; // 通道: GCash / Bank / Maya
  account: string; // 脱敏账户: ****1234
  balance: number; // 当前余额（分）
  minAmount?: number; // 最低取款额
  maxAmount?: number; // 最高取款额
}

// 4. 流结束
interface DoneEvent {
  type: "done";
}

// 5. 错误
interface ErrorEvent {
  type: "error";
  code: string; // 错误码，见第 4 节
  message: string; // 用户可见的错误信息
}

// 6. 转人工
interface TransferEvent {
  type: "transfer";
  reason: string;
  queuePosition?: number;
}
```

### 2.2 请求/响应

```http
POST /api/v1/ai/customer/chat-stream
Authorization: Bearer {token}
Content-Type: application/json

{
  "message": "我要取500比索",
  "sessionId": "session_abc123"
}

--- 响应（SSE 流）---

data: {"type":"step","step":"thinking","data":{"content":"正在分析您的问题..."}}
data: {"type":"step","step":"tool_start","data":{"tool":"getWalletBalance"}}
data: {"type":"step","step":"tool_end","data":{"tool":"getWalletBalance"}}
data: {"type":"action_card","action":"withdraw","data":{"amount":500,"fee":15,"channel":"GCash","account":"****1234","balance":1500}}
data: {"type":"done"}
```

---

## 3. 数据库设计

### 3.1 AI 会话表

```sql
CREATE TABLE ai_conversations (
  id          TEXT PRIMARY KEY,        -- UUID
  user_id     TEXT NOT NULL,           -- 用户 ID
  session_id  TEXT NOT NULL,           -- AI 会话 ID（前后端对齐）
  title       TEXT DEFAULT '',         -- 自动生成: "取款咨询" / "商品咨询"
  status      TEXT DEFAULT 'active',   -- active / transferred / closed
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  transferred_at INTEGER,              -- 转人工时间
  UNIQUE(user_id, session_id)
);
```

### 3.2 AI 消息表

```sql
CREATE TABLE ai_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id),
  role            TEXT NOT NULL,        -- 'user' / 'ai' / 'system'
  content         TEXT NOT NULL,        -- Markdown 原文
  content_type    TEXT DEFAULT 'text',  -- 'text' / 'action_card'
  card_action     TEXT,                 -- 'withdraw' / 'deposit' / 'kyc'
  card_data       TEXT,                 -- JSON
  token_count     INTEGER DEFAULT 0,    -- SSE token 数
  latency_ms      INTEGER DEFAULT 0,    -- SSE 总耗时
  created_at      INTEGER NOT NULL
);
```

### 3.3 Flutter 端本地存储

```dart
// SharedPreferences key
const kAiSessionId = 'ai_session_id';    // 当前 sessionId
const kAiMessages = 'ai_messages_cache'; // 最近 50 条消息缓存
```

---

## 4. 错误码规范

| code                | HTTP | 含义              | 前端处理             |
| ------------------- | ---- | ----------------- | -------------------- |
| `RATE_LIMIT_USER`   | 429  | 用户级限流        | 提示"已有活跃连接"   |
| `RATE_LIMIT_IP`     | 429  | IP 限流           | 提示"IP 连接数超限"  |
| `RATE_LIMIT_GLOBAL` | 429  | 全局限流          | 提示"服务器繁忙"     |
| `RATE_LIMIT_TOKEN`  | 429  | 令牌桶限流        | 提示"操作太频繁"     |
| `AUTH_EXPIRED`      | 401  | Token 过期        | 刷新 token 后重试    |
| `AI_TIMEOUT`        | 504  | AI 无响应         | 30s 超时提示         |
| `SSE_DISCONNECT`    | -    | 网络中断          | 自动重试（指数退避） |
| `PARSE_ERROR`       | -    | SSE JSON 解析失败 | 跳过，不中断流       |

---

## 5. 埋点与监控

### 5.1 产品指标

```dart
// AI 聊天页面埋点
Analytics.track(AiChatEvent.open);                    // 打开 AI 聊天
Analytics.track(AiChatEvent.send, {                    // 发送消息
  messageLength: text.length,
  sessionId: sessionId,
});
Analytics.track(AiChatEvent.actionCardShown, {         // 展示操作卡片
  action: 'withdraw',
  amount: 500,
});
Analytics.track(AiChatEvent.actionCardConfirmed, {     // 确认操作卡片
  action: 'withdraw',
  latencyMs: 3500,
});
Analytics.track(AiChatEvent.transferToHuman, {         // 转人工
  reason: 'user_request',
  roundCount: 5,
});
Analytics.track(AiChatEvent.error, {                   // 错误
  code: 'AI_TIMEOUT',
});
```

### 5.2 性能监控

| 指标                   | 说明         | 阈值          |
| ---------------------- | ------------ | ------------- |
| `ai_first_token_ms`    | 首字延迟     | P99 < 2000ms  |
| `ai_total_duration_ms` | 完整回复耗时 | P99 < 10000ms |
| `ai_token_count`       | token 数     | 监控异常值    |
| `ai_transfer_rate`     | 转人工率     | > 30% 需优化  |
| `ai_card_confirm_rate` | 卡片确认率   | < 50% 需优化  |

---

## 6. 多语言

所有文本用 Flutter 的 `tr()` 方法，不要硬编码：

```dart
// ❌ 不要
'正在查余额...'

// ✅ 要用
'tr('ai.status.checking_balance')'
```

需要新增的 key：

```dart
// en.json
"ai": {
  "status": {
    "thinking": "analyzing your question...",
    "checking_balance": "checking your balance...",
    "checking_kyc": "checking verification status..."
  },
  "card": {
    "withdraw_title": "Withdraw Confirmation",
    "confirm": "Confirm Withdrawal",
    "cancel": "Cancel"
  },
  "action": {
    "transfer": "Talk to Human Agent"
  },
  "error": {
    "no_response": "AI didn't respond, please try again",
    "rate_limit": "Please wait a moment and try again"
  }
}
```

---

## 7. Action Card 类型矩阵

| action           | 触发场景       | 用户确认后                     |
| ---------------- | -------------- | ------------------------------ |
| `withdraw`       | 用户要取款     | App 调 `POST /wallet/withdraw` |
| `deposit`        | 用户要充值     | App 跳转到充值页面             |
| `kyc`            | KYC 未完成     | App 跳转到 KYC 页面            |
| `order_cancel`   | 用户要取消订单 | App 调 `POST /order/cancel`    |
| `address_change` | 用户要改地址   | App 跳转到地址管理页面         |
| `coupon_claim`   | 用户要领券     | App 调 `POST /coupon/claim`    |

---

## 8. 版本兼容

| 场景                | 策略                                |
| ------------------- | ----------------------------------- |
| 后端新加 event type | App 忽略未知 type，不做任何处理     |
| 后端删除 event type | App 不再收到该事件，不影响          |
| 后端修改 data 结构  | 新增字段向后兼容，不删旧字段        |
| App 版本过旧        | 后端保证 v1 事件格式至少支持 6 个月 |

---

## 9. 实施步骤（8 步）

| 步  | 内容                                                  | 依赖      |
| --- | ----------------------------------------------------- | --------- |
| 1   | 后端: `action_card` SSE 事件 + Agent 不直接调金融工具 | 先做      |
| 2   | 后端: 错误码规范化                                    | 可并行    |
| 3   | 后端: 数据库表 `ai_conversations` + `ai_messages`     | 第 1 步后 |
| 4   | Flutter: SseClient（行缓冲）+ 事件解析                | 第 1 步后 |
| 5   | Flutter: ActionCard 组件（取款/充值/KYC/取消订单）    | 第 4 步后 |
| 6   | Flutter: AI 聊天页面 + Markdown + 打字机              | 第 5 步后 |
| 7   | Flutter: 转人工逻辑 + Socket.IO 衔接                  | 第 6 步后 |
| 8   | Flutter: 埋点 + 多语言                                | 全程      |
