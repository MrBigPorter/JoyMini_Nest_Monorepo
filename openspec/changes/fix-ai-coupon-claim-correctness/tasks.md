# Tasks — 修复 AI 领券的有效期与序号绑定

> 每个任务按 TDD：先写失败测试 → 跑红 → 最小实现 → 跑绿 → 提交。
> 测试命令：`yarn workspace @lucky/api test <path>`；类型检查：`yarn workspace @lucky/api tsc --noEmit --pretty`。

## 1. 可领取列表按有效期过滤

**Files**
- Modify: `apps/api/src/client/coupon/coupon.service.ts`（`getClaimableCoupons`）
- Test: `apps/api/src/client/coupon/coupon.service.spec.ts`

- [x] 1.1 写失败测试

```ts
it('validType=1 已过期的券不出现在可领取列表');
it('validType=1 未开始的券不出现在可领取列表');
it('validType=1 validEndTime 为空的券不出现在可领取列表');
it('validType=2 validDays>0 的券仍出现在可领取列表');
it('validType=2 validDays 为 0/null 的券不出现在可领取列表');
it('有效但已抢光/已达限领的券仍返回，canClaim=false');
```

- [x] 1.2 运行测试确认失败

Run: `yarn workspace @lucky/api test src/client/coupon/coupon.service.spec.ts`
Expected: 新增用例 FAIL（其余通过）

- [x] 1.3 实现过滤条件

新增导出的纯函数 `isCouponClaimableNow(coupon, now)`：

```
validType=1: validEndAt 非空且 >= now
             且 (validStartAt 为空或 <= now)
validType=2: validDays > 0
```

`getClaimableCoupons` 仍查 `issueType=2`、`status=1`，再 `.filter(isCouponClaimableNow)`。

- [x] 1.4 运行测试确认通过 + 类型检查

Run: 同上，然后 `tsc`
Expected: PASS / 0 errors

- [x] 1.5 提交

```bash
git add apps/api/src/client/coupon/coupon.service.ts apps/api/src/client/coupon/coupon.service.spec.ts
git commit -m "fix(coupon): hide expired and not-started coupons from claimable list"
```

## 2. 领取执行补 validType=2 兜底

**Files**
- Modify: `apps/api/src/client/coupon/coupon.service.ts`（`claimCoupon`）
- Test: `apps/api/src/client/coupon/coupon.service.spec.ts`

- [x] 2.1 写失败测试

```ts
it('validType=2 且 validDays 为 0/null 时拒绝领取');
it('validType=1 已过期时拒绝领取（既有行为回归）');
it('并发/限领顺序测试保持绿色');
```

- [x] 2.2 运行测试确认失败

Run: `yarn workspace @lucky/api test src/client/coupon/coupon.service.spec.ts`
Expected: 新用例 FAIL

- [x] 2.3 实现

在 `validType===2` 分支计算有效期前，`validDays` 为空或 `<= 0` 直接抛错；不动库存扣减与限领检查顺序。

- [x] 2.4 运行测试确认通过 + 类型检查

- [x] 2.5 提交

```bash
git commit -m "fix(coupon): reject relative-day coupons without a valid period"
```

## 3. 领券卡守卫与错误本地化

**Files**
- Modify: `apps/api/src/client/ai-customer/ai-customer.service.ts`（领券守卫、动作结果）
- Test: `apps/api/src/client/ai-customer/ai-customer.confirm.spec.ts`

- [ ] 3.1 写失败测试

```ts
it('过期券不在可领取结果 → 不建卡、不写 CONFIRM_CREATED');
it('守卫拒绝话术包含真实原因，不是「没有找到」');
it('claimCoupon 返回 This coupon has expired → 用户结果中文化');
it('已知四条错误均有中文映射');
```

- [ ] 3.2 运行测试确认失败

Run: `yarn workspace @lucky/api test src/client/ai-customer/ai-customer.confirm.spec.ts`
Expected: 新用例 FAIL

- [ ] 3.3 实现

- `issueConfirmCard` 的 claim 守卫：匹配失败时按「过期/限领/抢光/不可领取」生成可读原因。
- 动作结果发布前，对 `claim_coupon` 的已知错误做中文映射（仅 AI 层，不改服务层英文错误）。

- [ ] 3.4 运行测试确认通过 + 类型检查

- [ ] 3.5 提交

```bash
git commit -m "fix(ai): truthful coupon card rejection and localized claim errors"
```

## 4. 序号绑定与列表展示规则

**Files**
- Modify: `apps/api/src/client/ai-customer/graph/agents/prompts/coupon-prompt.ts`
- Test: `apps/api/src/client/ai-customer/graph/agents/prompt-builder.spec.ts` 或新增 coupon prompt 测试
- Acceptance: 使用真实数据手工验证

- [ ] 4.1 写失败测试（prompt 内容约束）

```ts
it('coupon prompt 要求序号只绑定最近展示的列表');
it('coupon prompt 要求同时展示时编号只属于可领取分区');
it('coupon prompt 要求弹卡前复述券名与序号');
it('coupon prompt 要求不可领时解释原因、不换券');
```

- [ ] 4.2 运行测试确认失败

- [ ] 4.3 修改 prompt

- 明确「序号只指向最近展示列表」。
- 默认先展示可领取（带编号），已持有随后展示（不带编号或标注不可领取）。
- 弹卡前复述券名；不可领解释原因；切换列表重新展示。

- [ ] 4.4 运行测试确认通过

- [ ] 4.5 手工验收（真实数据）

1. `Fixture ₱10 Off`：用户已持有，`per_user_limit=1`
2. `Big Spender`：`valid_end_time=2026-08-10` 已过期

步骤：

- 发「帮我看看优惠券」→ 可领取列表为空；已持有列表不带编号，Big Spender 标已过期
- 发「帮我领取1」→ 回复没有可领取的券，解释 Fixture 已持有/Big Spender 已过期；**不建卡、不产生动作记录**
- 让一张有效券变为可领（如提高 Fixture 限领或使用有效测试券）→ 「领取1」→ 卡片券名与列表第 1 项一致 → 确认 → EXECUTED

- [ ] 4.6 提交

```bash
git commit -m "fix(ai): bind coupon ordinals to the last presented list"
```

## 5. 全量验证与文档

- [ ] 5.1 运行全量测试

Run: `yarn workspace @lucky/api test`
Expected: 全部通过

- [ ] 5.2 运行类型检查

Run: `yarn workspace @lucky/api tsc --noEmit --pretty`
Expected: 0 errors

- [ ] 5.3 更新验收记录

- `docs/current-task.md` 的 A-12 / A-13 标记为已修
- `docs/system-review/2026-11-22-ai-customer-flow-audit.md` §7 补充状态

- [ ] 5.4 提交

```bash
git commit -m "docs(coupon): record claim correctness fixes and acceptance results"
```

## 回归清单

- [ ] T1-5 领券原子扣减测试保持绿色
- [ ] T1-6 每人限领并发/顺序探针保持绿色
- [ ] 兑码（redeemCode）路径不受影响
- [ ] App 领券中心空列表无异常
- [ ] 提现/存款流程不受影响
