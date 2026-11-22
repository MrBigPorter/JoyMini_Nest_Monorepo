# Spec Delta — coupon/claimable-coupons

## ADDED Requirements

### Requirement: 可领取列表 MUST 只包含当前有效的券

系统 SHALL 同时按 `issueType=2`、`status=1` 与有效期窗口过滤券模板：

- `validType=1`（固定窗口）：`validEndTime` MUST 非空且 `>= now`；`validStartTime` 为空或 `<= now`。
- `validType=2`（领取后 N 天）：`validDays` MUST 非空且 `> 0`。

系统 MUST NOT 返回已过期、尚未开始或没有有效期的券模板。

已抢光或用户已达限领的**有效**券仍 SHALL 返回，并通过 `canClaim=false` / `hasReachedLimit` / `isSoldOut` 表达；调用方（AI 工具）再决定是否展示。

#### Scenario: 已过期的固定窗口券被隐藏

- **WHEN** 模板 `validType=1` 且 `validEndTime < now`
- **THEN** 该模板 MUST NOT 出现在可领取列表

#### Scenario: 尚未开始的固定窗口券被隐藏

- **WHEN** 模板 `validType=1` 且 `validStartTime > now`
- **THEN** 该模板 MUST NOT 出现在可领取列表

#### Scenario: 缺少有效期的固定窗口券被隐藏

- **WHEN** 模板 `validType=1` 且 `validEndTime` 为空
- **THEN** 该模板 MUST NOT 出现在可领取列表

#### Scenario: 领取后 N 天的券仍可领取

- **WHEN** 模板 `validType=2` 且 `validDays > 0`
- **THEN** 该模板 SHALL 出现在可领取列表

#### Scenario: 无有效天数的相对券被隐藏

- **WHEN** 模板 `validType=2` 且 `validDays` 为空或 `<= 0`
- **THEN** 该模板 MUST NOT 出现在可领取列表

#### Scenario: 已抢光但未过期的券仍返回

- **WHEN** 模板有效但 `issuedQuantity >= totalQuantity`
- **THEN** 列表 SHALL 返回该模板，`canClaim=false`、`isSoldOut=true`
- **AND** 已过期的券仍然 MUST NOT 返回

---

### Requirement: 领券执行 MUST 与列表口径一致

`claimCoupon` SHALL 在执行时独立校验，不得依赖列表已过滤：

- `status !== 1` → 拒绝
- 发放方式与入口不一致 → 拒绝
- `validType=1` 且 `now > validEndTime` → 拒绝
- `validType=2` 且 `validDays` 为空或 `<= 0` → 拒绝
- 库存扣减、每人限领的既有顺序（先原子扣库存、后查限领）MUST 保持不变

#### Scenario: 过期券在列表后被领

- **WHEN** 券在列表展示后、确认前过期，用户仍提交确认
- **THEN** 执行 MUST 拒绝
- **AND** 库存不得扣减、用户不得新增券

#### Scenario: 正常领取

- **WHEN** 券有效、未过期、未抢光、未达限领
- **THEN** 执行成功，库存与用户券在同一事务内更新

#### Scenario: 并发与限领行为不回归

- **WHEN** 同一券并发领取或同一用户并发突破限领
- **THEN** 既有 T1-5 / T1-6 的行为 MUST 保持不变

#### Scenario: 相对券没有有效天数

- **WHEN** `validType=2` 且 `validDays` 为空或 `<= 0`
- **THEN** 执行 MUST 拒绝，不得发一张立即过期的券

---

### Requirement: 我的券 MUST 反映真实过期状态

`getMyCoupons` SHALL 在读取前把「未使用但已过 `validEndAt`」的用户券标记为 `status=2`，并 MUST NOT 把它们当作未使用券展示。

#### Scenario: 已过期的持有券

- **WHEN** 用户持有的券 `status=0` 且 `validEndAt < now`
- **THEN** 返回状态 MUST 为 `2`（已过期）
- **AND** 按 `status=0` 过滤时 MUST NOT 返回它
