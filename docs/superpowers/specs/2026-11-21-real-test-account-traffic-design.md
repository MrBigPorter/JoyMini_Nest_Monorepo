# 真实测试账号全流程演练 — 设计

> 状态：规划完成，待实施
> 环境：开发环境优先
> 目标：用真实注册的测试账号，真实登录、真实开客服、真实随机提问，让 AI 和业务链路自然产生数据。

## 1. 为什么重做

上一轮为了快速填充 AI Operations 页面，直接往开发库写了 `diag_*` 种子行。那是假数据，不能证明链路跑通，也不能作为运营或面试证据。

本方案只接受一种数据来源：

```text
真实账号注册
→ 真实 OTP 验证
→ 真实登录
→ 真实 /chat/business 建会话
→ 真实 Socket send_message
→ 真实 AI 队列与 LangGraph
→ 真实消息落库
```

## 2. 绝对原则

1. 账号必须是 OTP 注册出来的，不用 SQL 插 User
2. 对话必须来自 Socket/HTTP 真实请求，不直接插 ChatMessage
3. 禁止直接 INSERT feedback / security / eval / outbox / sla / memory / usage
4. 显式反馈、评测集、关闭会话由真实管理员操作
5. 死信/Outbox FAILED 由受控故障演练产生
6. 写操作只到确认卡片，永不确认
7. 存款/取款/购买由人工在受控环境验证

## 3. 全流程

| 环节 | 真实动作 | 数据 |
|---|---|---|
| 注册 | OTP request → verify → login/otp | User、登录日志 |
| 开客服 | `GET /chat/business` | SUPPORT Conversation、成员、aiMetadata |
| 发消息 | Socket `send_message` | ChatMessage、Outbox、AI job |
| AI 处理 | LangGraph | AI 消息、意图、RAG、工具、token |
| 多轮 | 随机追问/改口 | contextState、corrections |
| 流程 | 工具推进 | flowState、FlowBinding |
| 转人工 | 用户要求/负面情绪 | handlerId、SLA、隐式反馈 |
| 确认卡片 | 领券/提现/充值/抽奖 | pendingConfirm（Redis，不执行） |
| 记忆 | 叫我小明/来自上海/已实名 | AiUserMemory |
| 注入 | 忽略指令/索要系统提示 | AiSecurityEvent |
| 用量 | 每轮真实 token | AiUsageDaily |
| 评测 | 管理员创建并运行 | EvalDataset/Case/Run/Result |
| 死信 | 停 Redis / worker 抛错 | BullMQ failed、Outbox FAILED |

## 4. 账号设计

- 开发环境第一批 **15 个真实账号**
- 生产沿用 30 个
- 手机号使用 PH 格式，每个账号独立 `deviceId`
- 账号状态：`available` / `transferred` / `failed`
- 一个账号只能复用一个 SUPPORT 会话；转人工后作废
- 每批跑完统计可用账号，不足则补新号

## 5. 问题如何像真人

### 5.1 场景种子

- 9 个 intent：order / wallet / coupon / product / user / kyc / lucky-draw / rag / general
- 特殊：转人工、确认卡片、改口、指代不明、注入、重复追问、记忆
- 每个 intent 至少 3 个场景

### 5.2 随机化

- 每个场景生成 5 个口语化变体（DeepSeek，缓存）
- 随机人格：着急 / 礼貌 / 只发关键词 / 中英混合
- 消息间隔 5–60 秒，2–6 轮
- 允许错别字、语气词、短句

### 5.3 多轮跟随

- AI 说没有订单 → 追问“昨天的呢”
- AI 出确认卡片 → 停止
- AI 转人工 → 结束
- AI 回答模糊 → 改口/纠正

## 6. 开发环境配置

```bash
# 恢复本地容器
docker compose up -d db redis meilisearch backend

# 本地固定 OTP
SIM_OTP_CODE=123456

# 注入检测
AI_INJECTION_DETECTION_MODE=log

# 反馈 UI（管理员真实标注用）
AI_FEEDBACK_UI_ENABLED=true
```

渠道：

- 本地已有 `official_platform_support_v1`
- 模拟流量使用 `trafficSource=simulation_support_v1`
- 已知缺口：`driver.mjs` / `provision.mjs` 目前没有透传 `trafficSource`，后端会回退为 `businessId`。实施时优先建专用渠道 `simulation_support_v1`，或补透传；否则隔离标记不成立。

## 7. 数据来源边界

| 数据 | 允许来源 | 不允许 |
|---|---|---|
| 会话/消息/AI 回复 | 真实 Socket | 直接 INSERT |
| 意图/RAG/工具 | LangGraph 运行 | 手写日志 |
| token | recordUsage | 手工 INSERT |
| 记忆 | 真实用户消息抽取 | 手工 INSERT |
| 隐式反馈 | 转人工/重复追问/放弃 | 手工 INSERT |
| 显式反馈 | 管理员真实标注 | 脚本 INSERT |
| 评测 | 管理员创建/运行 | 脚本 INSERT 结果 |
| 安全事件 | 注入场景命中 | 手工 INSERT |
| SLA | 转人工会话 + cron | 手工 INSERT |
| Outbox FAILED | 故障演练 | 手工 INSERT |
| 死信 | worker 故障演练 | 手工 INSERT |

## 8. 故障演练

开发环境：

1. 停 Redis 30 秒
2. 用测试账号发消息
3. 观察 Outbox PENDING / FAILED
4. 恢复 Redis
5. 观察 relay 补投
6. 让 AI worker 抛错（chaos）
7. 在 `/ai-ops/runtime` 重放

生产不做故障演练。

## 9. 验收

- 15 个账号全部来自 OTP 注册
- 15 会话覆盖 9 intent
- 至少 1 次转人工、1 张确认卡片、1 条注入命中、1 条隐式反馈
- 页面计数 = 运行报告计数
- 无 `diag_*` 假数据
- 无资金/库存写操作

## 10. 非目标

- 不写业务代码
- 不伪造数据
- 不做生产故障演练
- 不执行存款/取款/购买
