# 95 · 提现冻结状态机与统一结算点（T1-3）

> 状态: ✅ 已实施并验证（2026-11-12）
> 日期: 2026-11-12
> 关联: [#85 P0-3](./85-生产化差距审计与企业上线清单.md)、[#87](./87-全项目问题总清单.md)、[`current-task.md`](../current-task.md) T1-3
> 前置阅读: [#85 §P0-3](./85-生产化差距审计与企业上线清单.md)（现状与影响）

---

## 0. 一句话

申请提现时冻结了 100 块，**但这 100 块现在没有任何可靠的出口**：审核抢先把订单置成 `SUCCESS`，
回调进门看到 `SUCCESS` 就掉头走，钱包四个字段再没人动过。修法是把「结算」收成一个函数，
**`SUCCESS` / `FAILED` 只许它写**，三个入口（审核 / 回调 / 补单）都调它。

---

## 1. 现在的钱去哪了（逐条核过代码）

| # | 路径 | 代码 | 结果 |
|:--:|---|---|---|
| 1 | 申请提现 | `client-wallet.service.ts:489` `freezeCash` | `real −100`、`frozen +100` ✅ |
| 2 | 审核通过 | `finance.service.ts:374` 直接置 `SUCCESS` | 订单说成功了，钱包**一分没动** ❌ |
| 3 | Xendit 回调到达 | `client-wallet.service.ts:279` 看到 `SUCCESS` 即 return | 解冻代码**永不执行** ❌ |
| 4 | 审核时 Xendit 抛错 | `finance.service.ts:352` 置 `FAILED` | 不解冻 ❌ |
| 5 | 补单 cron 判幽灵单 | `finance.task.ts:148` 置 `FAILED`，注释"财务手动处理" | 不解冻 ❌ |
| 6 | 审核拒绝 | `finance.service.ts:382` 事务内解冻 + 写退款流水 | ✅（唯一正确的一条，可作模板） |

**额外发现（#85 未记）**：冻结的是 `withdrawAmount`（毛额 100，含手续费），
回调成功只扣 `actualAmount`（净额 95，`client-wallet.service.ts:295`）。
即使回调路径走通，**手续费 5 块也永远卡在 `frozenBalance` 里**，账永远对不平。

---

## 2. 状态机

```
PENDING_AUDIT ──审核通过──▶ PROCESSING ──settle(SUCCESS)──▶ SUCCESS
      │
      └──审核拒绝──▶ REJECTED
                     
PROCESSING ──settle(FAILED)──▶ FAILED
```

**三条铁律**：

1. 审核（人工）**只能**写 `PROCESSING`，不能写 `SUCCESS` / `FAILED`。
2. `SUCCESS` / `FAILED` **只有** `settleWithdrawal()` 能写。
3. 进入终态后再 settle = 幂等 no-op，不抛错、不改账（回调重放、cron 重扫都会遇到）。

> `WITHDRAW_STATUS.APPROVED`（=2）在本流程里不使用，保持空置，不引入第四条路径。

---

## 3. 账目不变式

| 时刻 | realBalance | frozenBalance | totalWithdraw | 流水 |
|---|:--:|:--:|:--:|---|
| 申请（冻结毛额） | −100 | +100 | — | `WITHDRAWAL` −100 |
| 结算成功 | — | **−100** | **+95** | 冻结流水描述改「已完成」 |
| 结算失败 | **+100** | **−100** | — | `REFUND` +100 |
| 审核拒绝 | **+100** | **−100** | — | `REFUND` +100 |

**口径**：冻结扣**毛额**（用户填的金额），`totalWithdraw` 记**净额**（实际到账），差额即平台手续费收入。
两个数字不一致是**设计**，不是 bug——但必须写进注释，否则下一个人会以为是笔误。

**可断言的不变式**：

- 任意时刻 `realBalance + frozenBalance` 守恒（除手续费结转为平台收入）。
- `sum(该用户所有 WITHDRAWAL 类型冻结流水) == frozenBalance`。
- 同一 `withdrawId` 的结算只会发生一次。

---

## 4. `settleWithdrawal()` 设计

**落点**：新建 `apps/api/src/client/wallet/withdraw-settlement.service.ts`。
不放 `WalletService`（那是通用台账，不知道提现单）、不放 `ClientWalletService`（已经 500 行，
且它自己是被注入方，避免循环依赖）。由 `WalletModule` 导出，`finance.service.ts` / `finance.task.ts` /
`client-wallet.service.ts` 共用。

**签名**：

```ts
export type WithdrawOutcome = 'SUCCESS' | 'FAILED';

async settleWithdrawal(params: {
  withdrawId: string;
  outcome: WithdrawOutcome;
  thirdPartyOrderNo?: string;
  reason?: string;
}): Promise<{ settled: boolean; order: WithdrawOrder }>
```

**四步**（全程一个 `$transaction`）：

| 步 | 动作 | 失败处理 |
|:--:|---|---|
| 1 | 读订单；不存在 → 抛 `NotFoundException` | 无副作用，可重试 |
| 2 | 已是 `SUCCESS`/`FAILED` → 直接返回 `{ settled: false }` | **幂等出口**，不抛错 |
| 3 | `updateMany({ where: { withdrawId, withdrawStatus: { notIn: [SUCCESS, FAILED] } }, data: { withdrawStatus: outcome, completedAt, ... } })`，`count !== 1` → 返回 `{ settled: false }` | 行锁保证并发只有一次生效 |
| 4 | 动钱包：成功扣冻结、失败解冻（复用 `unfreezeCash`） | 见下 |

**为什么用「订单状态条件更新」当幂等键**：它本身就是一次行级 CAS，`count === 1` 的那次才是唯一的赢家。
#85 建议的"结算流水是否已存在"更严格，但需要给 `wallet_transactions` 加唯一约束（迁移）；
在状态机收口之后，状态不会再被第三方抢先改写，CAS 已经足够。加约束列入 §8 后续。

**失败处理（fail-closed）**：

| 场景 | 处理 |
|---|---|
| `SUCCESS` 但 `frozenBalance < 毛额` | 钱已经出去了，**不能回滚**。`logger.error` 打 CRITICAL + 强制扣减（允许负数），订单照常置 `SUCCESS` |
| `FAILED` 但 `frozenBalance < 毛额` | 钱没出去，**抛错回滚**，让调用方重试 / 告警 |
| 钱包行不存在 | `NotFoundException`，整笔回滚 |

---

## 5. 施工顺序

**先修通，再收口。** 前三步是真正的 bug 修复，每一步都能独立上线；第四步才是把重复逻辑合成一个函数的重构。

| 步 | 文件 | 改什么 | 验收 |
|:--:|---|---|---|
| 1 | `finance.service.ts:374` | **删掉**审核末尾把订单置 `SUCCESS` 的那段 `update`，改为返回当前订单（状态仍是 `PROCESSING`） | 审核通过后订单停在 `PROCESSING`；回调到达后由回调置 `SUCCESS` 并扣账 |
| 2 | `client-wallet.service.ts:295` | 成功分支扣冻结改用 `withdrawAmount`（毛额），与冻结算术一致 | 结算后 `frozenBalance` 归零（不再残留手续费） |
| 3 | `finance.service.ts:352`、`finance.task.ts:148/160/178` | 失败路径必须解冻（复核后统一走 §4 的失败处理） | 任何失败路径执行后 `real += 毛额`、`frozen −毛额` |
| 4 | 新建 `withdraw-settlement.service.ts` + `wallet.module.ts` | 把步骤 1~3 里重复的「查终态 → 改单 → 动钱包 → 写流水」收成 `settleWithdrawal()`，三处改为调用 | 行为与步骤 1~3 完全一致，全量测试不变 |
| 5 | 新增 spec | 覆盖 §6 的 8 个用例 | 全绿 + `tsc --noEmit` 0 error |

> 为什么重构放在第 4 步而不是第 1 步：前三步每一步都能独立验证、独立回滚；先建抽象再修 bug，会让"修没修好"和"抽象建得对不对"两个问题绞在一起。步骤 4 的验收标准是**行为零变化**——如果它改变了任何一条路径的结果，说明重构写错了。

> 步骤 3 注意：**Xendit 超时属于"状态未知"，不能走 FAILED 分支**，必须留在 `PROCESSING` 等 cron 复查（见 §8 第 1 条）。

### 5.1 实施结果（2026-11-12）

| 步 | 实际改动 | 验证 |
|:--:|---|---|
| 1 | `auditWithdraw` 末尾不再置 `SUCCESS`，只补记 `thirdPartyOrderNo` / `auditResult`；**catch 分支也不再置 `FAILED`**（`PaymentService` 把所有异常统一包成 500，调用方分不清"明确拒绝"和"超时"，只能交给对账） | 审核通过后订单停在 `PROCESSING` |
| 2 | 回调分支拆 `freezeAmount = withdrawAmount`（动冻结）/ `receivedAmount = actualAmount`（记累计），成功与失败两条路径都用毛额 | 结算后 `frozenBalance` 归零，手续费不再残留 |
| 3 | 补单 cron 三个分支改为调 `settleWithdrawal`；**修掉「查询异常被当成查无此单」**——查询失败时 `continue`，不落任何状态 | 网络抖动不会误判退款 |
| 4 | 新增 `withdraw-settlement.service.ts`（幂等出口 + 原子抢占 + 成功/失败两分支），`WalletModule` 注册导出；回调、审核失败、补单三处统一走它 | 回调代码由 ~100 行降到 ~40 行 |
| 5 | 新增 `withdraw-settlement.service.spec.ts` 8 例：成功/终态幂等/并发抢占失败/失败解冻/冻结不足强扣/订单不存在/抢占条件含终态排除/复用外部事务 | 8/8 通过 |

**验证汇总**：`tsc --noEmit` 0 error；API 全量 **308 passed**（3 例失败仍是 `auth` / `flash-sale` 两个已知过期 suite）；`finance.task` 的 `xenditData.status` 类型只接受 `SUCCEEDED`，`COMPLETED` 只存在于 webhook 的字符串 payload 中，两处判断已按各自类型区分。

**管理端影响**：审核接口 `POST /admin/finance/withdrawals/audit` 的入参仍是 `4-approve / 5-reject`（未变），但回执中的订单状态会停在 `PROCESSING`，等回调或 cron 落定后才变 `SUCCESS`。前端 `WithdrawAuditModal` 不读返回值，只触发列表刷新，无需改动。

---

## 6. 测试计划

| 用例 | 断言 |
|---|---|
| 成功结算一次 | `frozen −100`、`totalWithdraw +95`、订单 `SUCCESS` |
| 成功结算重复投递 | 第二次 `settled === false`，钱包不变 |
| 失败结算 | `real +100`、`frozen −100`、`REFUND` 流水 +100、订单 `FAILED` |
| 回调先到、审核后到 | 审核看到 `SUCCESS` 不覆盖；只结算一次 |
| 审核先到、回调后到 | 回调 `settled === false`；只结算一次 |
| 幽灵单（Xendit 查无此单） | 订单 `FAILED` 且已解冻 |
| 成功但冻结不足 | 订单仍 `SUCCESS`、CRITICAL 日志、`frozen` 强制扣减 |
| 失败且冻结不足 | 抛错、整笔回滚、订单状态不变 |

---

## 7. 不做的事（边界）

- **不改申请提现的计费口径**（冻结毛额这件事不动，只把结算对齐到毛额）。
- **不改 `unfreezeCash` / `freezeCash` 本身**，只复用。
- **不改 Xendit 接口调用方式**（超时、重试、幂等 external_id 另属 P1）。
- **不引入 `WITHDRAW_STATUS.APPROVED`**，不新增长期并存的状态。
- **不做对账报表**（§8 第 3 条），本任务只保证单笔守恒。

---

## 8. 已知未覆盖的后续风险

1. **失败时"钱到底出没出去"仍靠 Xendit 查询**：`settle(FAILED)` 的前提是调用方能确定失败了。
   如果 Xendit 超时（未知状态），不能直接 settle 成 `FAILED`，必须留在 `PROCESSING` 等 cron 复查。
   ——本任务不改成这个行为，但**修改代码时不得把超时归到 FAILED 分支**。
2. **没有数据库级唯一约束**：`wallet_transactions` 无 `(relatedId, relatedType, transactionType)` 唯一索引，
   幂等只靠状态 CAS。后续可补迁移做双保险。
3. **缺对账任务**：`sum(冻结流水) == frozenBalance` 目前只能靠单测和人工 SQL 验证，没有定时报表。
4. **历史脏数据**：修复上线前已经卡死的 `frozenBalance` 不会自动归零，需要一次性的修复脚本（另开任务）。
5. **审核失败后管理员无法立即重试**：`auditWithdraw` 的抢占条件是 `PENDING_AUDIT`，Xendit 调用失败后订单停在 `PROCESSING`，再点一次会收到 "Withdrawal order already processed"，只能等补单 cron（10 分钟）落定。Xendit 侧有 `idempotencyKey=payout-<withdrawNo>`，后续可以把"重试 PROCESSING"做成安全操作，但需要单独评估。
6. **手续费没有入账**：成功结算时 `frozen −100`、`totalWithdraw +95`，差额 5 元从钱包消失但没有进任何平台收入科目。要做完整复式记账需要新增平台账户表。
