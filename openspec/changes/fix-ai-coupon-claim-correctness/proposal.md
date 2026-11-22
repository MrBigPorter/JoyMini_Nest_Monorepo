# 修复 AI 领券的有效期与序号绑定

## Why

2026-11-22 的验收暴露两个缺陷：

- **A-12**：`💰 Big Spender — ₱200 Off` 模板已于 2026-08-10 过期，但仍出现在「可领取」列表，AI 还为它创建了确认卡；用户点确认后才收到英文错误 `This coupon has expired`。
- **A-13**：用户刚看到「我持有的券」列表（1 Fixture、2 Big Spender），说「帮我领取1」，AI 却调用了「可领取」列表，把 1 解析成了 Big Spender（用户看到的第 2 张）。序号跨列表错位。

两个问题都发生在「列表 → 卡片 → 执行」这条链路上，且都会让用户以为系统乱领。

## What Changes

1. **可领取列表按有效期过滤**：`getClaimableCoupons` 排除已过期、未开始、无有效期的券；`claimCoupon` 补齐 validType=2 的兜底。
2. **领券卡守卫与话术**：过期券不再进入可领取结果，因此不再发卡；守卫拒绝时给出真实原因，不笼统说「没有找到」。
3. **执行错误本地化**：AI 动作层把已知领券错误映射为中文可读提示，不透出英文服务错误。
4. **AI 列表与序号规则**：同一轮最多一个带编号的券列表；编号只指向最近展示的列表；弹卡前复述券名；不可领时解释原因，不换一张。
5. **我的券默认只查未使用**：`getUserCoupons` 不传 status 时只查 `status=0`；过期/已用券只在用户明确要求时查询与展示。
6. **测试与验收**：覆盖有效期边界、validType=2、并发/限领不回归、序号场景（空可领列表、单张可领、持有列表）。

## Impact

- **Affected specs**（新增 delta）：
  - `coupon/claimable-coupons`
  - `ai-customer/coupon-claim`
- **Affected code**：
  - `apps/api/src/client/coupon/coupon.service.ts`
  - `apps/api/src/client/ai-customer/ai-customer.service.ts`（领券守卫/错误映射）
  - `apps/api/src/client/ai-customer/graph/agents/prompts/coupon-prompt.ts`
  - 相关 spec 文件与测试
- **数据库**：不新增迁移。
- **兼容性**：App 领券中心不再返回已过期的可领取券（属于修正，不是契约破坏）；已持有/已抢光仍由 `canClaim` 字段表达。

## Out of Scope

- 领券库存、并发、限领顺序（T1-5/T1-6 的隐式锁）不修改。
- 不新增服务端确定性序号门禁（方案 B）；如果方案 A 在验收中仍失败，再单独提案。
- 不做 App 领券中心的视觉改版。
- 不做存款/充值功能。
