# AI 客服可信执行 · 手工回归清单

> 环境：本地 Docker（`make start-dev` + `make start-admin`），Flutter App 连本地后端。
> 开发环境 OTP 固定码：`999999`。
> 每个场景记录：实际输入、AI 回复、`ai_action_requests` 状态、`user_wallets` 变化。

## 1. 确认路由

| # | 操作 | 预期 |
|---|---|---|
| 1.1 | 让 AI 生成一张领券卡片，**打字**回「确认」 | 旧卡片置 `EXPIRED`；生成**新卡片**；回复「请点击上方卡片确认」；`markExecuted` 未触发 |
| 1.2 | 卡片过期后**打字**回「确认」 | 回复「上一张卡片已过期或已处理」；不创建新卡；`ai_traces.status=CONFIRM_EXPIRED` |
| 1.3 | 卡片过期后**点击**卡片确认 | 400；`ai_action_requests` 不出现 `EXECUTED` |
| 1.4 | 有活卡片时发一条业务问题（如「我的余额」） | 旧卡片 `EXPIRED`；正常回答余额；不会误弹旧卡 |

## 2. 事实闸门

| # | 操作 | 预期 |
|---|---|---|
| 2.1 | 在没有任何工具调用/动作的情况下，诱导模型说「已提交」 | 发布文本被改写成「这次操作还没有真正完成…」；指标 `ai_claim_guard_total{result="rewritten"}` +1 |
| 2.2 | 正常领券成功 | 「优惠券已领取」保留原文；`ai_action_total{result="executed"}` +1 |

## 3. 提现全流程

| # | 操作 | 预期 |
|---|---|---|
| 3.1 | 「提现 100 到 GCash Withdraw，账号 09171234567，姓名 Porter」→ 确认 → 点卡片 | 卡片显示渠道 **GCash Withdraw**、手续费 **₱5.8**、到账 **₱94.2**；`ai_action_requests.status=CONFIRMED` |
| 3.2 | 输入 OTP `999999` | 收到成功结果消息；`status=EXECUTED`；`user_wallets.frozen_balance` +100 |
| 3.3 | 选充值渠道（如 `channelId=1`）发起提现 | 不发卡；回复「这个渠道不支持提现」；`applyWithdrawVerified` 抛 `Not a withdrawal channel` |
| 3.4 | 提现确认后、未输码时被转人工 | 待执行任务失效；输码返回 400；不会产生提现 |
| 3.5 | 同用户并发两笔提现 | 第二笔返回「已有待验证的提现」；只存在一个 pending |

## 4. 跨轮上下文

| # | 操作 | 预期 |
|---|---|---|
| 4.1 | 让 AI 列出优惠券，再回「第 1 张帮我领了」 | 模型使用列表里的真实 `couponId`，不把序号当 ID |
| 4.2 | 查余额后再问「那我能提多少」 | 回答基于上一轮余额，不需要重新查 |

## 5. 配额与错误语义

| # | 操作 | 预期 |
|---|---|---|
| 5.1 | 临时把 `AI_SESSION_TOKEN_LIMIT` 调到很小，继续对话 | 回复「本次对话已达到 AI 使用上限…」；**不**出现「客服暂时不在线」；不产生人工待接入记录 |
| 5.2 | 跨过 Asia/Manila 午夜后再聊 | 会话配额从 0 开始（新日期桶） |

## 6. 越权与转人工

| # | 操作 | 预期 |
|---|---|---|
| 6.1 | 用 A 用户 token 向 B 用户的 conversationId 发消息 | 直接收尾，不写 trace、不落消息、不把 B 的会话置 `awaiting_human` |
| 6.2 | AI 转人工后再点旧确认卡 | 400；DB 行为 `TRANSFERRED/EXPIRED` |

## 7. 可观测

| # | 检查 | 预期 |
|---|---|---|
| 7.1 | 卡片被守卫拦下（不存在的券） | `ai_traces.status=CONFIRM_REJECTED`，不是 `CONFIRM` |
| 7.2 | 生产环境调用 `/ai/customer/test-chat` | 403 |

## 结果记录

| 场景 | 结果 | 证据（时间/ID） |
|---|---|---|
| 1.1 | | |
| 1.2 | | |
| 3.1 | | |
| 3.2 | | |
| 3.3 | | |
| 5.1 | | |
| 6.1 | | |
