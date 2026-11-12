# 93 · 确认链路三个洞（T1-2）修复规格

> 状态: ✅ 已实施并验证（2026-11-12）
> 日期: 2026-11-12
> 关联: [#85 P1-7 / P1-17 / P1-18](./85-生产化差距审计与企业上线清单.md)、[#87](./87-全项目问题总清单.md) 四道可靠性题第 ② 题、[`current-task.md`](../current-task.md) T1-2
> 前置阅读: [#83 确认卡片详细设计](./83-AI操作确认卡片详细设计.md)、[#84 现状差距](./84-AI操作确认卡片现状差距与实施计划.md)

---

## 0. 一句话

提现确认这条路上有 3 个洞：**2 个是用户正常操作就会踩到的体验事故**（输错一次码、输码慢一点），
**1 个是服务端校验被绕过**。三个洞共用一段代码，一起改，改动量约 0.5 天。

---

## 1. 先把链路读明白

### 1.1 正常路径的时间轴

以「用户让 AI 帮忙提现」为例：

| 时刻 | 发生了什么 | 代码位置 | 有效期 |
|:--:|---|---|---|
| t=0 | 图里判定要写操作 → 生成**卡片凭证** token | `ai-action-confirm.service.ts:23 generate()` | `TTL_SEC = 60`（第 13 行） |
| t≤60 | 用户点卡片【确认】→ `POST /ai/customer/confirm` | `ai-customer.service.ts:547 confirmAction()` | 凭证被 `consume()` 原子读+删 |
| t≈60 | 发短信验证码 + 把**待执行任务**暂存进 Redis | `ai-customer.service.ts:564`、`:569` | `OTP_TTL_SECONDS = 300`（`otp.service.ts:15`）／暂存 `TTL_SEC = 60` |
| t≤? | 用户看短信、切应用、输 6 位码 → `POST /ai/customer/confirm/otp` | `ai-customer.service.ts:599 confirmWithdrawOtp()` | — |
| 末 | 验码通过 → 真正执行提现 | `client-wallet.service.ts:424 applyWithdraw()` | — |

**关键不变式**：写操作只有这一个执行点，服务端在用户确认前绝不先执行。这一点是对的，不要动。

### 1.2 生活类比

你去银行办提现，柜员给了你一张**号单**（卡片 token），让你去另一个窗口**输手机验证码**。

- 洞 1 = 第二个窗口的柜员**先把号单收走撕了，再让你输码**。输错一位，号单没了，得回去从头排队。
- 洞 2 = 号单上印的"今日有效"是 1 小时，但验证码的"5 分钟有效"才是真的——你排了 6 分钟，号单作废。
- 洞 3 = 窗口说"金额我帮你填好了"，但**跳过了复核环节**：你说"abc"，他也照单收下。

---

## 2. 三个洞

### 洞 1（P1-7）：先撕票，再验码

**代码**：`ai-customer.service.ts:599-620`

```
confirmWithdrawOtp(code, userId):
  ① popPendingExecution(userId)   ← getDel，读的同时就删了（第 601 行）
  ② otpService.verify(...)        ← 验码（第 614 行）
  ③ 验证通过才执行
```

**为什么错**：`popPendingExecution` 内部是 `redisService.getDel(key)`（`ai-action-confirm.service.ts:68`）——**原子读+删**。这个原子性本身是对的（防重放），但用错了顺序：用户在 ① 和 ② 之间只要输错一位，待执行任务已经被删，② 一失败就直接返回 400，**任务永久丢失**。

**什么时候踩到**：任何一次手滑。这是这条链路上最容易发生的失败，不是边缘情况。

**怎么改**：

```
① peekPendingExecution(userId)   ← 新增：只 GET，不删
② otpService.verify(...)
③ popPendingExecution(userId)    ← 验码通过后才删（getDel 保留原子性）
④ 执行
```

**为什么安全**：OTP 本身是一次性的——`otp.service.ts:130` 用 `updateMany` 把记录从 `PENDING` 改成 `VERIFIED`，`updateMany.count !== 1` 就抛错。所以并发两次请求只有一次能过 ②，第二次会先失败，不依赖 ③ 的原子性。③ 仍然用 `getDel`，是为了"同一张 OTP 被执行两次"这种极端情况的最后一道闸。

**验证**：
- 单测：`pop` 不被调用于验码失败分支；`peek` 后 `pop` 成功时只执行一次。
- 手工：故意输错一次 → 再输正确的 → 应当成功（修复前必然 400）。

---

### 洞 2（P1-17）：两张票的有效期不一致

**代码**：`ai-action-confirm.service.ts:13`（`TTL_SEC = 60`）vs `otp.service.ts:15`（`OTP_TTL_SECONDS = 300`）

**同一个常量被用在两个语义不同的地方**：

| 用途 | 合理值 | 现在 |
|---|---|:--:|
| 卡片凭证 token（用户点不点还在犹豫） | 60s，短一点更安全 | 60s ✅ |
| 待执行任务 pending（用户要去看短信、输码） | ≥ OTP 有效期 | 60s ❌ |

**什么时候踩到**：用户点完确认后 60 秒内没输完码（切应用看短信、接了个电话、验证码延迟到达）。此时 pending 已过期，`popPendingExecution` 返回 null → `No pending withdraw action found`，而短信里的码明明还有 4 分钟有效期。

**怎么改**：拆成两个常量，pending 的 TTL 从 OTP 配置推导：

```ts
const TOKEN_TTL_SEC = 60;                                  // 卡片有效期，不变
const PENDING_TTL_SEC = (Number(process.env.OTP_TTL_SECONDS) || 300) + 30;  // 比 OTP 多 30s
```

> 为什么 +30：留出"验码成功 → 执行"这段时间，避免极端情况下状态刚好在中间过期。

**验证**：单测断言 `stagePendingExecution` 写入的 TTL ≥ 300；手工把 `OTP_TTL_SECONDS` 调成 10 跑一遍，观察 pending 跟着变。

---

### 洞 3（P1-18）：手搓 DTO，绕过校验

**代码**：`ai-customer.service.ts:625-629`

```ts
const dto = new ApplyWithdrawDto();
dto.amount = Number(params.amount);
dto.channelId = Number(params.channelId);
dto.account = String(params.account ?? '');
dto.accountName = String(params.accountName ?? '');
```

**为什么错**：`ApplyWithdrawDto` 上的 `@IsNumber()`、`@Min(100)`（`apply-withdraw.dto.ts:16-17`）**只有 Nest 的 ValidationPipe 在 controller 层才会执行**。这里 `new` 出来直接赋属性，装饰器一次都不会跑。

后果链：
1. `params.amount = "abc"` → `Number("abc")` = `NaN`
2. `applyWithdraw` 里 `if (channel.minAmount && NaN < min)` → `false`；`NaN > max` → `false`，两道金额边界全绕过（`client-wallet.service.ts:437-447`）
3. `new Prisma.Decimal(NaN)` 大概率抛错 → 用户拿到 500 而不是 400

即使最终被 Decimal 拦下，它也是"靠下游意外崩溃"挡住，而不是校验挡住——下一个改 Decimal 版本的人就会把它打开。

**怎么改**：用 class-validator 真跑一次。

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const dto = plainToInstance(ApplyWithdrawDto, params);
const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
if (errors.length > 0) {
  throw new BadRequestException(
    errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; '),
  );
}
```

> 注意 `whitelist: true` + `forbidNonWhitelisted: true`：顺带把 LLM 塞进来的多余字段拒掉，
> 不让 `params` 里夹带的东西一路走到 `applyWithdraw`。

**验证**：单测三例——`amount="abc"` → 400；`amount=1`（低于 `@Min(100)`）→ 400；合法参数 → 进入执行。

---

## 3. 施工顺序

三步都在 `ai-customer` 一个模块里，可以分三次提交，每步单独可验证：

| 步骤 | 文件 | 改什么 | 怎么验 |
|:--:|---|---|---|
| 1 | `ai-action-confirm.service.ts` | 新增 `peekPendingExecution`；拆 `TOKEN_TTL_SEC` / `PENDING_TTL_SEC` | 单测：TTL 常量、peek 不删 |
| 2 | `ai-customer.service.ts:599` | `pop` → `peek` … `verify` … `pop` | 单测：验码失败不删任务 |
| 3 | `ai-customer.service.ts:625` | 手搓 DTO → `plainToInstance` + `validate` | 单测：三例非法/合法参数 |

**为什么这个顺序**：步骤 2 依赖步骤 1 的新方法；步骤 3 独立但同一函数，放最后减少一次改动窗口。

### 3.1 实施结果（2026-11-12）

| 步骤 | 实际改动 | 验证 |
|:--:|---|---|
| 1 | `TOKEN_TTL_SEC = 60` / `PENDING_TTL_SEC = (OTP_TTL_SECONDS \|\| 300) + 30`；新增 `peekPendingExecution`（`get`） | `ai-action-confirm.service.spec.ts` 6 例：卡片 TTL=60、待办 TTL=330 且 ≥300、peek 不调 `getDel`、pop 不调 `get` |
| 2 | `confirmWithdrawOtp` 改为 `peek → verify → pop`；验码失败时任务保留 | `ai-customer.service.spec.ts`：验码失败断言 `popPendingExecution` 未被调用；调用顺序 `peek < verify < pop` |
| 3 | `plainToInstance + validate({whitelist, forbidNonWhitelisted})`；**删除**校验后回写 `Number(params.x)` 的四行旧代码 | `amount='abc'` / `amount=50` / 多余字段 → 均 400，`applyWithdraw` 未调用 |

**验证汇总**：新增 14 例单测全绿；`tsc --noEmit` 0 error；API 全量 **300 passed**（3 例失败仍是 `auth` / `flash-sale` 两个已知过期 suite，与本次无关）。

**实施中额外发现**：步骤 3 容易只加 `validate()` 却留下旧的四行 `dto.amount = Number(params.amount)` —— 那等于用未校验值覆盖已校验值，必须一起删。

---

## 4. 测试计划

| 层级 | 覆盖 | 说明 |
|---|---|---|
| 单测 | 洞 1 的 peek/pop 语义、洞 2 的 TTL 常量、洞 3 的 DTO 校验 | 主战场。这三个洞都能用纯单测证明，不需要外部服务 |
| E2E | ❌ 不覆盖 | 需要真实短信 OTP，`ai-e2e-smoke.sh` 拿不到验证码。要覆盖得先做测试 OTP provider（属 T1-1 范围） |
| 手工 | 输错一次再输对；输码等 90 秒 | 上线前各做一遍，写进发布检查单 |

---

## 5. 不做的事（边界）

- **不改 OTP 下发通道**（短信 provider、pepper、明文日志）→ 那是 T1-1。
- **不改前端卡片**：`AI_CONFIRM` 的 payload 和 `expiresAt` 语义不变。
- **不动非提现 action**：`claim_coupon` / `redeem_code` / `draw` / `delete_address` 走 `confirmAction` 直接执行，没有 OTP、没有 pending，不受这三个洞影响。
- **不改 `consume()` 的 60s**：卡片凭证短有效期是有意的安全设计。

---

## 6. 已知未覆盖的后续风险（记下来，别当已解决）

1. **OTP 锁定后无法重发**：用户连续输错到上限后 OTP 锁定，而卡片 token 已被 `consume`，只能重开一轮对话。修复这三个洞会让这种情况**变少**（输错不再毁任务），但没消除。
2. **pending 只按 `userId` 键**：同一用户同时有两个提现确认时，后者覆盖前者（`ai:confirm:pending:<userId>`）。当前产品假设一人一次，未做多任务队列。
3. **`params` 的来源仍是 LLM**：洞 3 修完是"格式与范围受控"，但"金额是不是用户真想要的"仍靠卡片摘要让用户确认，不是技术能保证的。

---

## 7. 文件索引

| 文件 | 作用 |
|---|---|
| `apps/api/src/client/ai-customer/ai-action-confirm.service.ts` | 卡片 token + pending 暂存（洞 1、洞 2 主战场） |
| `apps/api/src/client/ai-customer/ai-customer.service.ts` | `confirmAction()` / `confirmWithdrawOtp()`（洞 1、洞 3） |
| `apps/api/src/client/wallet/dto/apply-withdraw.dto.ts` | 校验装饰器定义（洞 3 的依据） |
| `apps/api/src/client/wallet/client-wallet.service.ts:424` | `applyWithdraw()`：金额边界的最后一道 |
| `apps/api/src/client/otp/otp.service.ts` | OTP 一次性语义 + 300s TTL（改洞 2 时读它） |
