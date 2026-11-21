# 确认卡执行链路 E2E（2026-11-21）

## 结论

`ai_confirm → POST /ai/customer/confirm → claimCoupon → action EXECUTED` 全链路通过。

## 成功用例

- 会话：`cmwqhimo3002iw7y5cx56c3dp`
- 动作：`claim_coupon`
- action id：`cmwqhiruw0036w7y51zxuuwqk`
- 确认接口：`HTTP 200`，返回新建用户券：
  - `couponId=aiq_fixture_coupon_01`
  - `status=0`（未使用）
- 最终状态：

```text
ai_action_requests.status = EXECUTED
error = null
```

## 失败用例

- 会话：`cmwqhhbrx001mw7y5boi8ejxp`
- 动作：`claim_coupon`（Big Spender）
- 确认接口：`HTTP 400 Coupon is not available or inactive`
- 最终状态：

```text
ai_action_requests.status = FAILED
error = "Coupon is not available or inactive"
```

原因：fixture 券 `validEndAt=2026-08-10`，已过期。不是确认链路 bug。

## 关键点

1. 确认事件先于聊天消息发送，客户端不会把卡片当普通回复；
2. 聊天消息只写“请确认：领取优惠券”，不含敏感参数；
3. 确认后由 `confirmAction` 单点执行，成功后写 `EXECUTED`；
4. 失败写 `FAILED` 和错误摘要，不静默吞掉；
5. 测试账号、会话 ID 均保留，未记录 token。

## 复现方式

用测试账号建立 `simulation_support_v1` 会话，发送：

```text
帮我看看有哪些优惠券可以领
帮我领 Fixture ₱10 Off
```

捕获 `ai_confirm` 的 `confirmToken`，调用：

```http
POST /api/v1/ai/customer/confirm
Authorization: Bearer <client token>
{ "token": "<confirmToken>" }
```

然后查询 `ai_action_requests` 对应 `requestId` 的状态。

## 注意

- 模拟器安全约束仍禁止自动调用 `/confirm`；本次是一次性人工授权验证；
- 领取的是测试券，不涉及资金/提现；
- 生产环境应使用真实用户和真实券种验证。
