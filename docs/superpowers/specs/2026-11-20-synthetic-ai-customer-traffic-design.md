# 合成 AI 客服流量系统 — 设计

## 1. 目标与为什么

在生产专用渠道里，用一批受控测试账号模拟真实用户向 AI 客服提问，稳定积累：

- 会话、消息、意图、RAG 来源、工具调用
- token 用量、队列/Outbox、flow binding、memory
- 转人工/重复追问/放弃等隐式反馈
- 可回放的评测样本

不是压测，也不是造假数据：所有流量走真实 `chat/business → Socket send_message → AI 队列 → LangGraph → 消息推送` 链路。

## 2. 已确认的约束

- 第一批：**30 个账号，5 并发**
- 环境：**生产专用渠道**
- 写操作只到确认卡片，**永远不执行确认**
- 账号通过固定 OTP `999999` 登录并 upsert
- 不能污染真实客服会话与用户指标

## 3. 非目标

- 不做容量压测/极限 QPS
- **P0 不执行存款、取款、购买等真实资金/库存流程**：只触发到确认卡片，由人工后续单独验证
- 不生成显式 feedback（避免伪造人工标注）
- 不做多租户/多语言全量覆盖（先中英）

> 资金/库存流程需要 sandbox 支付与结算环境，属于独立工作；P0 生产模拟器明确不调用 `/confirm`、`/confirm/otp`，也不创建支付单、订单或提现单。

## 4. 方案选择

### 方案 A：人工 Flutter 点

真实但量少，不可持续。只保留为验收手段。

### 方案 B：Flutter integration_test

真实客户端路径，能测 UI；但 30 账号串行太慢、CI 重。保留为每周/发版 smoke。

### 方案 C：Flutter 同协议无头客户端（采用）

用 Node 实现，调用与 Flutter 相同的：

- `GET /chat/business?businessId=simulation_support_v1`
- Socket `send_message`
- 监听 AI 消息/转人工/确认事件

好处：30 账号可并发、可持续跑、协议真实；不依赖模拟器/真机。
Flutter integration_test 只负责验证 UI 能收到同样的消息。

## 5. 架构

```text
Account Pool (30)
  └─ persona + deviceId + token
        ↓
Scenario/Question Generator
  ├─ 场景库（9 intents + transfer + confirm + correction + injection）
  ├─ 槽位随机（订单号、城市、金额、语言）
  └─ LLM 改写（可选，DeepSeek，低温度）
        ↓
Traffic Driver (5 concurrent)
  ├─ GET /chat/business
  ├─ Socket send_message
  ├─ 等待 AI reply / transfer / confirm
  └─ 随机 5–60s 后下一轮
        ↓
Production API + AI graph + Redis/Postgres
        ↓
Admin AI Ops 页面 / AiEvalRun / 指标
```

## 6. 账号与渠道

### 6.1 专用渠道

- 首选专用 `SupportChannel.id = simulation_support_v1`（一次性创建）
- 若无法创建专用渠道：复用 `official_platform_support_v1`，请求带 `trafficSource=simulation_support_v1`，会话仍按 aiMetadata 隔离
- 新建 SUPPORT 会话时写入 `Conversation.aiMetadata.trafficSource = 'simulation_support_v1'`
- `Conversation.businessId` 是拼团业务唯一钩子，不能用于渠道隔离
- P1 后台按 `aiMetadata.trafficSource` 过滤

### 6.2 账号池

- 30 个唯一手机号，昵称 `sim_<persona>_<n>`
- 固定 OTP `999999`，通过 OTP request + login upsert
- 每个账号独立 `deviceId`，避免设备桶互相影响
- 登录阶段受 IP 5/min 限制：分批创建，30 个约 6 分钟
- token 落本地加密文件/环境变量，不写日志

## 7. 问题生成

### 7.1 场景库

每个 intent 至少 3 个场景：

- order：查最近订单、查指定订单、物流到哪
- wallet：余额、充值、提现（停在确认卡）
- coupon：我的券、领券（停在确认卡）、兑换码
- product：搜商品、团购价、详情
- user：资料、地址增删改（停在确认卡）
- kyc：认证状态、如何认证
- lucky-draw：抽奖券、抽奖（停在确认卡）
- rag：退款政策、配送时效、隐私政策
- general：问候、感谢、闲聊
- 特殊：转人工、指代不明、改口、注入、长会话

### 7.2 像人

- 消息长度随机：短句/完整句/带错别字
- 语言：中文为主，20% 英文
- 间隔 5–60s，连续追问 2–6 轮
- 根据 AI 回复决定下一句（LLM 或规则）
- 遇到确认卡立即停止；遇到转人工结束会话
- 同账号冷却 10–30 分钟

### 7.3 覆盖控制

- 每天每个 intent 至少 10 次
- 特殊场景至少 5 次
- 单账号不连续重复同一 intent
- 覆盖率写本地 run report

## 8. 数据与安全

### 数据隔离

- 会话：`aiMetadata.trafficSource=simulation_support_v1`
- 用户：通过专用渠道 botUserId 归属识别；昵称由后端生成 `ms_*`，不依赖前缀
- 后台页面后续加「模拟流量」过滤；先按 aiMetadata.trafficSource 区分

### 安全阀

- 总开关、每日 token 预算、最大并发 5
- 队列 waiting > 50 自动降速
- 禁止调用 confirm/OTP 接口
- 不传真实用户 PII；问题中不出现真实手机号/地址
- 一键停止：结束进程 + 让账号停止发消息

## 9. 数据沉淀与评测

- 每轮对话自然写 Conversation/ChatMessage/意图/token/flow/memory
- 隐式反馈由现有逻辑产生
- 每天抽样 20 条会话跑 `AiEvalRun`（judge），失败样本进 golden set
- 不做显式 feedback 伪造

## 10. 实施阶段

### P0（本次）

1. 创建 `simulation_support_v1` 渠道 + 30 账号
2. 场景库（9 intents + 特殊）
3. Node 无头 driver（5 并发、随机间隔、停确认）
4. 运行报告 + 覆盖统计
5. 后台验证：会话/消息/flow/usage 有数据

### P1

- LLM 改写 + 多轮回复驱动
- 账号冷却/自动补号
- Admin 模拟流量过滤

### P2

- Flutter integration_test 子集
- 夜间自动跑 + 自动评测

## 11. 验证

- 30 账号全部登录成功
- 5 并发跑 30 分钟不触发限流/队列积压
- 9 个 intent 全覆盖，特殊场景覆盖
- 确认卡片生成但无写操作执行（查 DB 无提现/领券/抽奖记录）
- 会话都落在 `simulation_support_v1`
- 后台 `/ai-ops` 能查到对应数据

## 12. 风险

- 生产账号/渠道创建需 admin 权限 → 一次性 seed/人工创建
- 同 IP OTP 限流 → 分批建号
- LLM 生成问题成本 → 先规则模板，P1 再接 LLM
- 模拟流量污染指标 → 专用 businessId + 后续过滤
