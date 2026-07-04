# JoyMini 业务知识图谱 (Business Knowledge Graph)

> **目的**：记录已实现的业务领域实体-关系三元组，逐步构建可被 LLM 查询的结构化知识。
> **原则**：每完成一个 Agent/功能，就总结其对应的实体和关系。
> **状态**：🟢 已总结  🟡 部分完成  🔴 待总结

---

## 总览：实体类型一览

| 实体类型 | 说明 | 当前状态 |
|---------|------|:--------:|
| `User` | 平台用户 | 🟢 |
| `Order` | 用户订单 | 🟢 |
| `Wallet` | 用户钱包 | 🟢 |
| `KYC` | 实名认证 | 🟢 |
| `PaymentChannel` | 提现/充值渠道 | 🟢 |
| `Coupon` | 优惠券（模板） | 🟢 |
| `UserCoupon` | 用户领取的优惠券 | 🟢 |
| `CouponCode` | 兑换码 | 🟢 |
| `Address` | 收货地址 | 🟢 |
| `WithdrawRequest` | 提现申请 | 🟢 |
| `WithdrawOTP` | 提现 OTP 验证 | 🟢 |
| `Transaction` | 交易/充值/提现记录 | 🟢 |

---

## 领域 1：用户 (User Agent) 🟢

> 代码：[`user-tools.ts`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts)
> 节点：[`user-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/user-agent.node.ts)

### 实体

```
User = {
  nickname: string,
  avatar: string,
  phone: string,
  inviteCode: string,
  vipLevel: number,
  kycStatus: string,
  lastLoginTime: string
}

Address = {
  addressId: string,
  contactName: string,
  phone: string,
  province: string,
  city: string,
  barangay: string,
  fullAddress: string,
  label: string,
  isDefault: boolean
}
```

### 三元组关系

| # | 主语 (Subject) | 关系 (Relation) | 宾语 (Object) | 来源代码 |
|---|---------------|----------------|--------------|---------|
| 1 | `User` | `has_profile` | `nickname, avatar, phone` | [`getUserProfile`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:66) |
| 2 | `User` | `has_invite_code` | `inviteCode` | [`getUserProfile`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:66) |
| 3 | `User` | `has_vip_level` | `vipLevel` | [`getUserProfile`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:66) |
| 4 | `User` | `has_kyc_status` | `kycStatus` | [`getUserProfile`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:66) |
| 5 | `User` | `has_address` | `Address` | [`listAddresses`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:111) |
| 6 | `Address` | `belongs_to` | `User` | [`listAddresses`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:111) |
| 7 | `User` | `can_create` | `Address` | [`createAddress`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:229) |
| 8 | `User` | `can_update` | `Address` | [`updateAddress`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:356) |
| 9 | `User` | `can_delete` | `Address` | [`deleteAddress`](apps/api/src/client/ai-customer/graph/tools/user-tools.ts:429) |

### 业务规则

| # | 规则 | 说明 |
|---|------|------|
| R1 | 创建地址需两阶段确认 | 先展示预览 → 用户确认 → 执行创建 |
| R2 | 修改/删除地址需两阶段确认 | 先展示变化 → 用户确认 → 执行修改/删除 |
| R3 | 地址使用文本地区名 | province/city/barangay 用文本名，系统自动解析为 ID |

---

## 领域 2：钱包 (Wallet Agent) 🟢

> 代码：[`wallet-tools.ts`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts)
> 节点：[`wallet-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/wallet-agent.node.ts)

### 实体

```
Wallet = {
  realBalance: Decimal,    // 现金余额（可提现）
  coinBalance: Decimal,    // 虚拟币余额（不可提现）
  frozenBalance: Decimal,  // 冻结金额（提现中）
  totalRecharge: Decimal,  // 累计充值
  totalWithdraw: Decimal   // 累计提现
}

KYC = {
  kycStatus: 'pending' | 'approved' | 'rejected',
  riskLevel: 'low' | 'medium' | 'high',
  documents: KycDocument[]
}

PaymentChannel = {
  channelId: number,
  channelName: string,
  minAmount: number,
  maxAmount: number,
  feeRate: number,
  fixedFee: number,
  currency: string,
  description: string
}

WithdrawRequest = {
  withdrawId: string,
  withdrawNo: string,
  withdrawAmount: number,
  withdrawStatus: string
}

WithdrawOTP = {
  phone: string,
  code: string (6-digit)
}

Transaction = {
  // recharge
  rechargeId, rechargeAmount, rechargeStatus, rechargeTime, ...
  // withdrawal
  withdrawalId, withdrawalAmount, withdrawalStatus, withdrawalTime, ...
}
```

### 三元组关系

| # | 主语 | 关系 | 宾语 | 来源代码 |
|---|------|------|------|---------|
| 1 | `User` | `has_wallet` | `Wallet` | [`getWalletBalance`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:99) |
| 2 | `Wallet` | `has_balance` | `realBalance` | [`getWalletBalance`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:99) |
| 3 | `Wallet` | `has_coin_balance` | `coinBalance` | [`getWalletBalance`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:99) |
| 4 | `Wallet` | `has_frozen` | `frozenBalance` | [`getWalletBalance`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:99) |
| 5 | `User` | `has_kyc` | `KYC` | [`getKycStatus`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:303) |
| 6 | `User` | `can_withdraw_via` | `PaymentChannel` | [`getPaymentChannels`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:353) |
| 7 | `PaymentChannel` | `has_min_amount` | `minAmount` | [`getPaymentChannels`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:353) |
| 8 | `PaymentChannel` | `has_max_amount` | `maxAmount` | [`getPaymentChannels`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:353) |
| 9 | `PaymentChannel` | `has_fee` | `fixedFee + feeRate` | [`getPaymentChannels`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:353) |
| 10 | `User` | `has_transactions` | `Transaction[]` | [`getWalletTransactions`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:254) |
| 11 | `User` | `submits` | `WithdrawRequest` | [`applyWithdraw`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:431) |
| 12 | `WithdrawRequest` | `requires` | `WithdrawOTP` | [`requestWithdrawOtp`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:143) |
| 13 | `WithdrawOTP` | `verifies_for` | `User` | [`verifyWithdrawOtp`](apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts:180) |

### 业务规则

| # | 规则 | 说明 |
|---|------|------|
| R4 | 提现前必须 KYC 已通过 | `kycStatus !== 'approved'` → 拒绝提现 |
| R5 | 提现金额不能超过余额 | `amount > realBalance` → 拒绝 |
| R6 | 30 秒内相同提现幂等 | 重复提现请求直接返回成功（不重复执行） |
| R7 | 提现渠道按金额过滤 | 只返回 `minAmount ≤ amount ≤ maxAmount` 的渠道 |
| R8 | 提现 OTP 两阶段 | request→ 发送验证码 → 用户输入 → verify → 执行提现 |
| R9 | 隐藏固定金额列表 | `fixedAmounts` 从渠道信息中删除，防止 LLM 金额幻觉 |

---

## 领域 3：订单 (Order Agent) 🟢

> 代码：[`order-tools.ts`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts)
> 节点：[`order-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/order-agent.node.ts)

### 实体

```
Order = {
  orderId: string,
  orderNo: string,
  orderStatus: string,  // paid, unpaid, refunded, cancelled
  productName: string,
  productAmount: number,
  quantity: number,
  totalAmount: number,
  currency: string,
  createTime: string
}
```

### 三元组关系

| # | 主语 | 关系 | 宾语 | 来源代码 |
|---|------|------|------|---------|
| 1 | `User` | `has_order` | `Order` | [`getUserOrders`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts:69) |
| 2 | `Order` | `belongs_to` | `User` | [`getUserOrders`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts:69) |
| 3 | `Order` | `has_status` | `orderStatus` | [`getUserOrders`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts:69) |
| 4 | `Order` | `has_total` | `totalAmount` | [`getUserOrders`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts:69) |
| 5 | `Order` | `contains_product` | `productName` | [`getOrderInfo`](apps/api/src/client/ai-customer/graph/tools/order-tools.ts:110) |

### 业务规则

| # | 规则 | 说明 |
|---|------|------|
| R10 | 只能查自己的订单 | `orderService.getOrderDetail(userId, orderId)` — 服务层强制用户隔离 |
| R11 | 订单状态过滤 | 支持 `all, paid, unpaid, refunded, cancelled` |

---

## 领域 4：优惠券 (Coupon Agent) 🟢

> 代码：[`coupon-tools.ts`](apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts)
> 节点：[`coupon-agent.node.ts`](apps/api/src/client/ai-customer/graph/nodes/coupon-agent.node.ts)

### 实体

```
CouponTemplate = {
  couponId: string,
  couponName: string,
  couponType: string,
  discountValue: number,
  minOrderAmount: number,
  validFrom: string,
  validTo: string,
  status: number  // 1=active
}

UserCoupon = {
  userCouponId: string,
  couponName: string,
  status: number,  // 0=unused, 1=used, 2=expired
  discountValue: number,
  validFrom: string,
  validTo: string
}

CouponCode = {
  code: string (case-insensitive)
}
```

### 三元组关系

| # | 主语 | 关系 | 宾语 | 来源代码 |
|---|------|------|------|---------|
| 1 | `Platform` | `offers` | `CouponTemplate` | [`getClaimableCoupons`](apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts:188) |
| 2 | `User` | `claims` | `UserCoupon` (from `CouponTemplate`) | [`claimCoupon`](apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts:115) |
| 3 | `User` | `has_coupon` | `UserCoupon` | [`getUserCoupons`](apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts:85) |
| 4 | `UserCoupon` | `has_status` | `0=unused, 1=used, 2=expired` | [`getUserCoupons`](apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts:85) |
| 5 | `CouponCode` | `redeems_to` | `UserCoupon` | [`redeemCouponCode`](apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts:150) |
| 6 | `User` | `redeems` | `CouponCode` | [`redeemCouponCode`](apps/api/src/client/ai-customer/graph/tools/coupon-tools.ts:150) |

### 业务规则

| # | 规则 | 说明 |
|---|------|------|
| R12 | 只能领取 active (status=1) 的优惠券 | `getClaimableCoupons` 自动过滤 |
| R13 | 兑换码不区分大小写 | `couponService.redeemCode` 内部处理 |
| R14 | 领券、兑换写操作需两阶段确认 | 先展示预览 → 用户确认 → 执行 |

---

## 领域 5：流程状态 (Flow Tools) 🟢

> 代码：[`flow-tools.ts`](apps/api/src/client/ai-customer/graph/tools/flow-tools.ts)

### 实体

```
FlowType = 'DEPOSIT' | 'WITHDRAWAL' | 'COUPON_CLAIM' | 'BALANCE_QUERY'
         | 'ORDER_QUERY' | 'COUPON_QUERY' | 'POLICY' | 'GENERAL'

FlowStatus = 'IDLE' | 'FILLING' | 'CONFIRMING' | 'QUERYING' | 'COMPLETED' | 'FAILED'
```

### 三元组关系

| # | 主语 | 关系 | 宾语 | 来源代码 |
|---|------|------|------|---------|
| 1 | `Conversation` | `has_flow_type` | `FlowType` | [`updateFlowStatus`](apps/api/src/client/ai-customer/graph/tools/flow-tools.ts:112) |
| 2 | `Conversation` | `has_flow_status` | `FlowStatus` | [`updateFlowStatus`](apps/api/src/client/ai-customer/graph/tools/flow-tools.ts:112) |
| 3 | `Conversation` | `has_flow_data` | `key-value pairs` | [`updateFlowData`](apps/api/src/client/ai-customer/graph/tools/flow-tools.ts:53) |

### 业务规则

| # | 规则 | 说明 |
|---|------|------|
| R15 | FlowStatus 转换受 FLOW_TYPE_REGISTRY 校验 | 非法状态转换被拒绝 |
| R16 | FlowData 支持 slot filling | 逐步收集表单数据，merge 到 flowData |

---

## 跨领域关系

| # | 主语 | 关系 | 宾语 | 说明 |
|---|------|------|------|------|
| C1 | `User` | `can_use_coupon_on` | `Order` | 优惠券可应用于订单（需实现）🔴 |
| C2 | `Order` | `paid_via` | `Wallet` | 订单通过钱包支付（需实现）🔴 |
| C3 | `Coupon` | `excludes` | `Coupon` | 某些优惠券互斥不能叠加使用（需实现）🔴 |
| C4 | `User` (VIP) | `has_extra_discount` | `Order` | VIP 用户享额外折扣（需实现）🔴 |
| C5 | `KYC` | `required_for` | `WithdrawRequest` | 提现必须完成 KYC ✅ (R4) |

---

## 更新记录

| 日期 | 领域 | 操作 | 说明 |
|------|------|------|------|
| 2026-07-03 | 全部 5 领域 | 🟢 创建 | 初始版本，覆盖 User/Wallet/Order/Coupon/Flow |
| — | — | 🔴 待补充 | Cross-domain relations (C1~C4) |
| — | — | 🔴 待补充 | 产品/商品实体 (Product Agent) |
| — | — | 🔴 待补充 | Lucky Draw 实体 (Lucky Draw Agent) |
| — | — | 🔴 待补充 | 政策知识实体 (RAG Node) |
